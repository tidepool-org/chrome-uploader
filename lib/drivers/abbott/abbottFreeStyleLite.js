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
var struct = require('../../struct.js')();
var annotate = require('../../eventAnnotations');
var common = require('../../commonFunctions');

var TZOUtil = require('../../TimezoneOffsetUtil');

var debug = require('bows')('FreeStyleLiteDriver');

module.exports = function (config) {
  var cfg = _.clone(config);
  var serialDevice = config.deviceComms;

  // With no date & time settings changes available,
  // timezone is applied across-the-board
  cfg.tzoUtil = new TZOUtil(cfg.timezone, new Date().toISOString(), []);
  _.assign(cfg.deviceInfo, {
    tags : ['bgm'],
    manufacturers : ['Abbott']
  });

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
    // the SerialPort library does not pass on STX and ETX, so we look for the
    // 'END' characters to determine when to stop
    var endIndex = searchForSequence(bytes, [0x45, 0x4E, 0x44]);
    if (endIndex === -1) {
      return packet;
    } else {
      endIndex += 2;
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
    }, 100); // 100ms should be enough to be kind to older CPUs
  };

  var freeStyleCommandResponse = function (commandpacket, callback) {
    serialDevice.writeSerial(commandpacket.packet, function (err) {
      if (err) {
        callback(err, null);
      }
      listenForPacket(30000, commandpacket.parser, function(err, result) {
        if (err) {
          callback(err, null);
        } else {
          callback(err, result);
        }
      });
    });
  };

  var xGetData = function() {
    return {
      packet: struct.packString('$mem\r\n'),
      parser: function (result) {
        return result;
      }
    };
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

  var setDateTime = function (serverTime, cb) {
    var cmd = struct.packString('$tim,' +
        sundial.formatInTimezone(serverTime, cfg.timezone, 'MM,DD,YY,HH,mm') +
        '\r\n');

    serialDevice.writeSerial(cmd, function (err) {
      if (err) {
        cb(err, null);
      }
      debug('Device time set');
      cb(null);
    });
  };

  var prepBGData = function (progress, data) {
    cfg.builder.setDefaults({ deviceId: cfg.deviceInfo.deviceId });
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

  var disconnect = function(progress, data, cb) {
    cfg.deviceComms.clearPacketHandler();
    cfg.deviceComms.disconnect(function() {
      progress(100);
      data.cleanup = true;
      cb(null, data);
    });
  };

  return {
    // using the default detect for this driver
    detect: function (obj, cb) {
      debug('AbbottFreeStyle not using detect function');
      cb(null, obj);
    },

    // this function starts the chain, so it has to create but not accept
    // the result (data) object; it's then passed down the rest of the chain
    setup: function (deviceInfo, progress, cb) {
      debug('in setup!');
      progress(100);
      _.assign(cfg, { deviceInfo });
      cb(null, {});
    },

    connect: function (progress, data, cb) {
      debug('in connect!');
      var handlers = {
        packetHandler: freeStyleMessageHandler,
      };

      cfg.deviceComms.connect(cfg.deviceInfo, handlers, function(err) {
        if (err) {
          return cb(err);
        }
        progress(100);
        data.connect = true;
        cb(null, data);
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
        if (err) {
          return cb(err, data);
        }
        data.connect = true;
        debug(result);
        _.extend(cfg.deviceInfo, _.pick(result, 'serialNumber', 'softwareVersion', 'deviceTime'));

        if (cfg.deviceInfo.serialNumber[0] === 'C') {
          // there are a wide variety of Abbott meters that start with C and D,
          // but this is the only way to distinguish the FreeStyle Freedom Lite
          // and the FreeStyle Lite as they use the same cable, so the USB PID/VID
          // is the same.
          cfg.deviceInfo.model = 'AbbottFreeStyleFreedomLite';
        } else if (cfg.deviceInfo.serialNumber[0] === 'D') {
          cfg.deviceInfo.model = 'AbbottFreeStyleLite';
        } else {
          cfg.deviceInfo.model = 'UnknownFreeStyle';
        }
        debug('Detected as: ', cfg.deviceInfo.model);

        cfg.deviceInfo.deviceId = cfg.deviceInfo.model + ' ' + cfg.deviceInfo.serialNumber;
        data.logEntries = result.logEntries;
        data.numEntries = result.numEntries;

        common.checkDeviceTime(cfg, function (checkErr, serverTime) {
          if (checkErr) {
            if (checkErr === 'updateTime') {
              cfg.deviceInfo.annotations = 'wrong-device-time';
              setDateTime(serverTime, function(err) {
                cb(err, data);
              });
            } else {
              disconnect(progress, data, function() {
                cb(checkErr, null);
              });
            }
          } else {
            cb(null, data);
          }
        });
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
        deviceTags: cfg.deviceInfo.tags,
        deviceManufacturers: cfg.deviceInfo.manufacturers,
        deviceModel: cfg.deviceInfo.model,
        deviceSerialNumber: cfg.deviceInfo.serialNumber,
        deviceId: cfg.deviceInfo.deviceId,
        start: sundial.utcDateString(),
        timeProcessing: cfg.tzoUtil.type,
        tzName : cfg.timezone,
        version: cfg.version,
        deviceTime: cfg.deviceInfo.deviceTime
      };

      if (cfg.deviceInfo.annotations) {
        annotate.annotateEvent(sessionInfo, cfg.deviceInfo.annotations);
      }

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
      disconnect(progress, data, function() {
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
