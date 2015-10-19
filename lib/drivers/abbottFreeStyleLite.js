/*
 * == BSD2 LICENSE ==
 * Copyright (c) 2014, Tidepool Project
 *
 * This program is free software; you can redistribute it and/or modify it under
 * the terms of the associated License, which is identical to the BSD 2-Clause
 * License as published by the Open Source Initiative at opensource.org.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE. See the License for more details.
 *
 * You should have received a copy of the License along with this program; if
 * not, you can obtain one from Tidepool Project at tidepool.org.
 * == BSD2 LICENSE ==
 */

var _ = require('lodash');
var async = require('async');
var sundial = require('sundial');
var struct = require('../struct.js')();
var annotate = require('../eventAnnotations');

var TZOUtil = require('../TimezoneOffsetUtil');

var debug = require('../bows')('FreeStyleLiteDriver');

module.exports = function (config) {
  var cfg = _.clone(config);
  cfg.deviceData = null;
  var serialDevice = config.deviceComms;

  // With no date & time settings changes available,
  // timezone is applied across-the-board
  cfg.tzoUtil = new TZOUtil(cfg.timezone, new Date().toISOString(), []);

  var STX = 0x02;
  var ETX = 0x03;
  var CR = 0x0D;
  var LF = 0x0A;

  var dateTimePattern = '([A-Za-z ]{4} [0-3][0-9] [0-9]{4} ' +
                        '[012][0-9]:[0-5][0-9](?::[0-6][0-9])?)';
  function parseDateTime(match, index) {
    var fmt = 'MMMM DD YYYY HH:mm:ss';
    var parsed = sundial.parseFromFormat(match[index], fmt);
    var dev = sundial.formatDeviceTime(parsed);
    var utcInfo = cfg.tzoUtil.lookup(parsed);
    return {
      dev: dev,
      utc: utcInfo.time,
      timezoneOffset: utcInfo.timezoneOffset,
      conversionOffset: utcInfo.conversionOffset
    };
  }

  var patterns = {
    serialNumber: {
      pattern: '^(?:[A-Z]-....-.....|[A-Z][A-Z][A-Z]....-.....|[XC][A-Z][GM]........)$',
      handler: function(match, packet) {
        packet.serialNumber = match[0];
      }
    },
    softwareVersion: {
      pattern: '^[0-9.]{4,13}',
      handler: function(match, packet) {
        packet.softwareVersion = match[0];
      }
    },
    deviceTime: {
      pattern: '^' + dateTimePattern + '$',
      handler: function(match, packet) {
        var times = parseDateTime(match, 1);
        packet.deviceTime = times.dev;
        packet.time = times.utc;
      }
    },
    numEntries: {
      pattern: '^(?:[0-9]{3}|Log Empty)$',
      handler: function(match, packet) {
        packet.numEntries = parseInt(match[0], 10);
        if (_.isNaN(packet.numEntries)) {
          packet.numEntries = 0;
        }
      }
    },
    notFound: {
      pattern: '^Log Not Found$',
      handler: function(match, packet) {
        packet.notFound = true;
      }
    },
    end: {
      pattern: '^END$',
      handler: function(match, packet) {
        packet.end = true;
      }
    },
    ok: {
      pattern: '^CMD OK$',
      handler: function(match, packet) {
        packet.ok = true;
      }
    },
    fail: {
      pattern: '^CMD Fail!$',
      handler: function(match, packet) {
        packet.fail = true;
      }
    },
    logEntry: {
      pattern: '^\s*([0-9HL][0-9OI][0-9 ])  ' + dateTimePattern + ' [0-9A-Fa-f][0-9A-Fa-f] (0x[0-9A-Fa-f][0-9A-Fa-f])',
      handler: function(match, packet) {
        var entry = {};
        var reading = match[1];

        var testType = match[3];

        if(testType[3] === '1') {
          debug('Marking as control test');
          entry.control = true;
        }else{
          entry.control = false;
        }

        //the HI/LO glucose range for all FreeStyle meters are 20-500 mg/dL according to spec
        if (reading == 'HI ') {
            entry.reading = 501;
            entry.annotations = [{
              code: 'bg/out-of-range',
              value: 'high',
              threshold: 500
            }];
        } else if (reading == 'LO ') {
          entry.reading = 19;
          entry.annotations = [{
            code: 'bg/out-of-range',
            value: 'low',
            threshold: 20
          }];
        } else {
          entry.reading = parseInt(reading, 10);
        }

        entry.datetime = parseDateTime(match, 2);
        packet.logEntries.push(entry);
      }
    },
    checksum: {
      pattern: '^(0x[0-9A-F]{4})  END',
      handler: function(match, packet) {
        packet.receivedChecksum = parseInt(match[1], 16);
      }
    }
  };
  var logEntry = 'logEntry';

  var extractPacket = function (bytes) {
    var packet = {
      bytes: bytes,
      valid: false,
      packet_len: 0,
      lcb: 0,
      lines: [],
      logEntries: []
    };

    var startIndex = 0;
    var endIndex = _.indexOf(bytes, ETX, startIndex + 1);
    if (endIndex === -1) {

      return packet;
    }

    function stringFromBytes(bytes, start, end) {
      var s = '';
      for (var i=start; i<end; ++i) {
        s += String.fromCharCode(bytes[i]);
      }
      return s;
    }

    function searchForSequence(bytes, sequence) {
      var found = false;
      for (var ix=0; ix<bytes.length; ++ix) {
        found = true;
        for (var jx=0; jx<sequence.length; ++jx) {
          if (bytes[ix + jx] != sequence[jx]) {
            found = false;
            break;
          }
        }
        if (found) {
          return ix;
        }
      }
      return -1;
    }

    var checksumIndex = searchForSequence(bytes, [0x0D, 0x0A, 0x30, 0x78]);
    checksumIndex += 2;
    if (checksumIndex !== -1) {
      var sum = 0;
      for (var i=startIndex; i<checksumIndex; ++i) {
        sum += bytes[i];
      }
      packet.calculatedChecksum = sum & 0xFFFF;
    }

    packet.packet_len = endIndex;

    var startLine = startIndex;
    while (startLine < endIndex) {
      var endLine = _.indexOf(bytes, CR, startLine);
      if (endLine === -1) {
        endLine = endIndex - 1;
      }
      if (bytes[endLine + 1] != LF) {
        packet.packet_len = endLine;
        return packet;
      }

      var line = stringFromBytes(bytes, startLine, endLine);
      packet.lines.push(line);
      startLine = endLine + 2;
    }

    var patkeys = _.keys(patterns);
    _.remove(patkeys, function(k) { return k === logEntry; });
    patkeys.unshift(logEntry);

    _.forEach(packet.lines, function(line, index) {
      var found = false;
      _.forEach(patkeys, function(key) {
        var m = line.trim().match(patterns[key].pattern);
        if (m) {
          found = true;
          patterns[key].handler(m, packet);
        }
      });
      if (!found && line !== '') {
        debug('No pattern match found for "' + line + '"');
      }
    });

    packet.valid = true;
    if (packet.receivedChecksum && packet.receivedChecksum != packet.calculatedChecksum) {
      debug('Failed checksum! rcv: ', packet.receivedChecksum, ' calc: ', packet.calculatedChecksum);
      packet.valid = false;
    }
    if (packet.numEntries && packet.logEntries.length !== packet.numEntries) {
      debug('Entry count failure! num: ', packet.numEntries, ' found: ', packet.logEntries.length);
      packet.valid = false;
    }
    if (packet.fail) {
      packet.valid = false;
    }
    return packet;
  };

  var freeStyleErrorHandler = function(info) {
    if (info.connectionId && info.error) {
      if (info.error == 'timeout') {
        return [ ETX ];
      }
    }
  };

  var freeStyleMessageHandler = function (buffer) {
    var discardCount = 0;
    while (buffer.len() > discardCount && buffer.get(0) == ETX) {
      ++discardCount;
    }

    if (discardCount) {
      buffer.discard(discardCount);
    }

    if (buffer.len() < 11) {
      return false;
    }

    var packet = extractPacket(buffer.bytes());
    if (packet.packet_len !== 0) {
      buffer.discard(packet.packet_len);
    }

    if (packet.valid) {
      return packet;
    } else {
      return null;
    }
  };

  var listenForPacket = function (timeout, parser, callback) {
    var abortTimer = setTimeout(function () {
      clearInterval(listenTimer);
      debug('TIMEOUT');
      callback('TIMEOUT', null);
    }, timeout);

    var listenTimer = setInterval(function () {
      if (serialDevice.hasAvailablePacket()) {
        var pkt = serialDevice.nextPacket();
        clearTimeout(abortTimer);
        clearInterval(listenTimer);
        pkt.parsed_payload = parser(pkt);
        callback(null, pkt);
      }
    }, 20);
  };

  var freeStyleCommandResponse = function (commandpacket, callback) {
    serialDevice.writeSerial(commandpacket.packet, function (err) {
      if (err) {
        callback(err, null);
      }
      listenForPacket(3000, commandpacket.parser, function(err, result) {
        if (err) {
          callback(err, null);
        } else {
          callback(err, result);
        }
      });
    });
  };

  var xtest = function() {
    return {
      packet: struct.packString('mem'),
      parser: function (result) {
        return result;
      }
    };
  };

  var xGetData = function() {
    return {
      packet: struct.packString('mem'),
      parser: function (result) {
        return result;
      }
    };
  };

  var getSerialNumber = function (obj, cb) {
    var cmd = xtest();
    freeStyleCommandResponse(cmd, function (err, result) {
      if (err) {
        debug('Failure trying to talk to device.');
        debug(err);
        debug(result);
        cb(err, null);
      } else {
        _.assign(obj, _.pick(result, 'serialNumber', 'softwareVersion', 'deviceTime'));
        obj.model = 'AbbottFreeStyleLite';
        obj.id = obj.model + ' ' + obj.serialNumber;
        cb(null, obj);
      }
    });
  };

  var getAllData = function (obj, cb) {
    var cmd = xGetData();
    freeStyleCommandResponse(cmd, function (err, result) {
      if (err) {
        debug('Failure trying to talk to device.');
        debug(err);
        debug(result);
        cb(err, null);
      } else {
        _.assign(obj, result);
        cb(null, obj);
      }
    });
  };

  var prepBGData = function (progress, data) {
    cfg.builder.setDefaults({ deviceId: data.id });
    var dataToPost = [];
    for (var i = 0; i < data.logEntries.length; ++i) {
      var datum = data.logEntries[i];

        if(datum.control === true) {
          debug('Discarding control');
          continue;
        }

        var smbg = cfg.builder.makeSMBG()
          .with_value(datum.reading)
          .with_deviceTime(datum.datetime.dev)
          .with_timezoneOffset(datum.datetime.timezoneOffset)
          .with_conversionOffset(datum.datetime.conversionOffset)
          .with_time(datum.datetime.utc)
          .with_units('mg/dL')
          .set('index', i)
          .done();
        if (datum.annotations) {
          _.each(datum.annotations, function(ann) {
            annotate.annotateEvent(smbg, ann);
          });
        }
        dataToPost.push(smbg);
    }
    return dataToPost;
  };

  var probe = function (cb) {
    var cmd = xtest();
    freeStyleCommandResponse(cmd, function (err, result) {
      if (err) {
        debug('Failure trying to talk to device.');
        debug(err);
        debug(result);
      }
      cb(err, result);
    });
  };

  return {
    // using the default detect for this driver
    // detect: function(cb) {
    // },

    // this function starts the chain, so it has to create but not accept
    // the result (data) object; it's then passed down the rest of the chain
    setup: function (deviceInfo, progress, cb) {
      debug('in setup!');
      progress(100);
      cb(null, {deviceInfo: deviceInfo});
    },

    connect: function (progress, data, cb) {
      debug('in connect!');
      var handlers = {
        packetHandler: freeStyleMessageHandler,
        errorHandler: freeStyleErrorHandler
      };

      cfg.deviceComms.connect(data.deviceInfo, handlers, probe, function(err) {
        if (err) {
          return cb(err);
        }
        getSerialNumber({}, function (err, result) {
          progress(100);
          data.connect = true;
          _.assign(data, result);
          debug(data);
          cb(null, data);
        });
      });
    },

    getConfigInfo: function (progress, data, cb) {
      progress(100);
      cb(null, data);
    },


    fetchData: function (progress, data, cb) {
      debug('in fetchData');
      getAllData({}, function (err, result) {
        progress(100);
        data.connect = true;
        debug(result);
        data.logEntries = result.logEntries;
        data.numEntries = result.numEntries;
        cb(null, data);
      });
    },

    processData: function (progress, data, cb) {
      progress(0);
      data.post_records = _.map(prepBGData(progress, data), function(d) {
        delete d.index;
        return d;
      });
      progress(100);
      data.processData = true;
      debug(data);
      cb(null, data);
    },

    uploadData: function (progress, data, cb) {
      progress(0);
      var sessionInfo = {
        deviceTags: ['bgm'],
        deviceManufacturers: ['Abbott'],
        deviceModel: 'FreeStyle Lite',
        deviceSerialNumber: data.serialNumber,
        deviceId: data.id,
        start: sundial.utcDateString(),
        timeProcessing: cfg.tzoUtil.type,
        tzName : cfg.timezone,
        version: cfg.version
      };

      cfg.api.upload.toPlatform(data.post_records, sessionInfo, progress, cfg.groupId, function (err, result) {
        if (err) {
          debug(err);
          progress(100);
          return cb(err, data);
        } else {
          progress(100);
          return cb(null, data);
        }
      });
    },

    disconnect: function (progress, data, cb) {
      progress(100);
      data.disconnect = true;
      cb(null, data);
    },

    cleanup: function (progress, data, cb) {
      cfg.deviceComms.clearPacketHandler();
      cfg.deviceComms.clearErrorHandler();
      cfg.deviceComms.disconnect(function() {
        progress(100);
        data.cleanup = true;
        cb(null, data);
      });
    },

    testDriver: function(config) {
      var progress = function(v) {
        debug('progress: ', v);
      };
      var data = {};
      this.connect(progress, data, function(err, result) {
        debug('result:', result);
      });
    }
  };

};
