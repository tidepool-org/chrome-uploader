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
var crcCalculator = require('../crc.js');
var struct = require('../struct.js')();

var isBrowser = typeof window !== 'undefined';
var debug = isBrowser ? require('../bows')('OTVerioIQ Driver') : debug;

module.exports = function (config) {
  var cfg = _.clone(config);
  cfg.deviceData = null;
  var serialDevice = config.deviceComms;

  var STX = 0x02;
  var ETX = 0x03;
  var EPOCH = 946684800000;
  //we need this number because this is used as reference
  //this device set the timestamp counter start at the new Millennium start

  var LINK_CTRL_MASK = {
    MORE: 0x10,
    DISC: 0x08,
    ACK : 0x04,
    E   : 0x02,     
    S   : 0x01,      
    NONE: 0x00
  };

  var send_bit = 0;
  var expected_receive_bit = 0;

  var buildLinkControlByte = function(lcb) {
    lcb |= send_bit;
    lcb |= expected_receive_bit;
    return lcb;
  };

  var buildPacket = function (linkctrl, payloadLength, payload) {
    var datalen = payloadLength + 6;
    var buf = new ArrayBuffer(datalen);
    var bytes = new Uint8Array(buf);
    var link = buildLinkControlByte(linkctrl);
    var ctr = struct.pack(bytes, 0, 'bbb', STX, datalen, link);
    if (payloadLength) {
      ctr += struct.copyBytes(bytes, ctr, payload, payloadLength);
    }
    bytes[ctr++] = ETX;
    var crc = crcCalculator.calcCRC_A(bytes, ctr);
    struct.pack(bytes, ctr, 's', crc);
    return buf;
  };

  var buildReadHeader = function() {
    var cmd = [0x04, 0x06];
    return buildPacket(LINK_CTRL_MASK.NONE, cmd.length, cmd);
  };

  var buildReadSerialNumber = function() {
    var cmd = [0x04, 0x0B, 0x00, 0x02];
    return buildPacket(LINK_CTRL_MASK.NONE, cmd.length, cmd);
  };

  var buildReadRecordNumber = function(recnum) {
    var cmd = [0x04, 0x21];  
    struct.pack(cmd, 2, 's', recnum);
    return buildPacket(LINK_CTRL_MASK.NONE, cmd.length, cmd);
  };

  var buildGetRecordCount = function() {
    var cmd = [0x04, 0x27, 0x00];
    return buildPacket(LINK_CTRL_MASK.NONE, cmd.length, cmd);  
  };

  var extractPacket = function (bytes) {
    var packet = {
      bytes: bytes,
      valid: false,
      packet_len: 0,
      lcb: 0,
      payload: null,
      crc: 0
    };

    if (bytes[0] != STX) {
      return packet;
    }

    var plen = bytes.length;
    var packet_len = struct.extractByte(bytes, 1);
    if (packet_len > plen) {
      return packet; 
    }

    packet.packet_len = packet_len;
    packet.crc = struct.extractShort(bytes, packet_len - 2);
    var crc = crcCalculator.calcCRC_A(bytes, packet_len - 2);
    if (crc != packet.crc) {
      return packet;
    }

    packet.lcb = bytes[2];
    packet.payload = new Uint8Array(packet_len - 6);
    for (var i = 0; i < packet_len - 6; ++i) {
      packet.payload[i] = bytes[i + 3];
    }

    packet.valid = true;
    return packet;
  };

  var oneTouchPacketHandler = function (buffer) {

    var discardCount = 0;
    while (buffer.len() > discardCount && buffer.get(0) != STX) {
      ++discardCount;
    }
    if (discardCount) {
      buffer.discard(discardCount);
    }

    if (buffer.len() < 6) { 
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

  var oneTouchCommandResponse = function (commandpacket, callback) {
    serialDevice.writeSerial(commandpacket.packet, function () {
        listenForPacket(1000, commandpacket.parser, function(err, result) {
          if (err === 'TIMEOUT') {
          } else {
            callback(err, result);
          }
        });
    });
  };

  var readHeader = function() {
    return {
      packet: buildReadHeader(),
      parser: function (result) {
        // chars between 2 to 9 of payload give us model
        var model = String.fromCharCode.apply(null, result.payload.subarray(2,9));
        return { model: model};
      }
    };
  };

  var readSerialNumber = function() {
    return {
      packet: buildReadSerialNumber(),
      parser: function (result) {
        var sernum = String.fromCharCode.apply(null, result.payload.subarray(2));
        return { serialNumber: sernum };
      }
    };
  };

  var readRecordCount = function() {
    return {
      packet: buildGetRecordCount(),
      parser: function (result) {
        return struct.unpack(result.payload, 0, '..s', ['nrecs']);
      }
    };
  };

  var readRecordNumber = function(n) {
    return {
      packet: buildReadRecordNumber(n),
      parser: function (result) {
        return struct.unpack(result.payload, 0, '..ib', ['timestamp', 'glucose']);
      }
    };
  };

  var getDeviceInfo = function (obj, cb) {
    var cmd = readHeader();
    oneTouchCommandResponse(cmd, function (err, result) {
      if (err) {
        debug('Failure trying to talk to device.');
        debug(err);
        debug(result);
        cb(null, null);
      } else {
        _.assign(obj, result.parsed_payload);
        cb(null, obj);
      }
    });
  };

  var getSerialNumber = function (obj, cb) {
    var cmd = readSerialNumber();
    oneTouchCommandResponse(cmd, function (err, result) {
      if (err) {
        debug('Failure trying to talk to device.');
        debug(err);
        debug(result);
        cb(null, null);
      } else {
        _.assign(obj, result.parsed_payload);
        cb(null, obj);
      }
    });
  };

  var getRecordCount = function (obj, cb) {
    var cmd = readRecordCount();
    oneTouchCommandResponse(cmd, function (err, result) {
      if (err) {
        debug('Failure trying to talk to device.');
        debug(err);
        debug(result);
        cb(null, null);
      } else {
        _.assign(obj, result.parsed_payload);
        cb(null, obj);
      }
    });
  };

  var getOneRecord = function (recnum, cb) {
    var cmd = readRecordNumber(recnum);
    oneTouchCommandResponse(cmd, function (err, result) {
      if (err) {
        debug('Failure trying to read record #', recnum);
        debug(err);
        debug(result);
        cb(err, null);
      } else {
        cb(null, result.parsed_payload);
      }
    });
  };

  var processReadings = function(readings) {
    _.each(readings, function(reading, index) {
      readings[index].displayTime = sundial.formatDeviceTime(new Date((reading.timestamp * 1000) + EPOCH).toISOString());
      readings[index].displayUtc = sundial.applyTimezone(readings[index].displayTime, cfg.timezone).toISOString();
      readings[index].displayOffset = sundial.getOffsetFromZone(readings[index].displayUtc, cfg.timezone);
    });
  };

  var prepBGData = function (progress, data) {
    //build missing data.id
    data.id = 'OneTouch'+ data.model + data.serialNumber;
    cfg.builder.setDefaults({ deviceId: data.id});
    var dataToPost = [];
    if (data.bgmReadings.length > 0) {
      for (var i = 0; i < data.bgmReadings.length; ++i) {
        var datum = data.bgmReadings[i];
        var smbg = cfg.builder.makeSMBG()
          .with_value(datum.glucose)
          .with_deviceTime(datum.displayTime)
          .with_timezoneOffset(datum.displayOffset)
          .with_time(datum.displayUtc)
          .with_units('mg/dL')
          .done();
        dataToPost.push(smbg);
      }
    }else{
      debug('Device has not records to upload');
    }


    return dataToPost;
  };

  var probe = function (cb) {
    debug('attempting probe of oneTouch VerioIQ');
      var cmd = readHeader();
      oneTouchCommandResponse(cmd, function (err, result) {
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
    
    setup: function (deviceInfo, progress, cb) {
      debug('in setup!');
      progress(100);
      cb(null, {deviceInfo: deviceInfo});
    },

    connect: function (progress, data, cb) {
      debug('in connect!');
      cfg.deviceComms.connect(data.deviceInfo, oneTouchPacketHandler, probe, function(err) {
        if (err) {
          return cb(err);
        }
        getDeviceInfo({}, function(commsErr, obj) {
          if (commsErr) {
            cb(commsErr, obj);
          } else {
            getSerialNumber(obj, function (err, result) {
              progress(100);
              data.connect = true;
              _.assign(data, obj);
              cb(null, data);
            });
          }
        });
      });
    },

    getConfigInfo: function (progress, data, cb) {
      getRecordCount({}, function(err, obj) {
        progress(100);
        data.getConfigInfo = true;
        _.assign(data, obj);
        debug('getConfigInfo', data);
        cb(err, data);
      });
    },

    fetchData: function (progress, data, cb) {
      function getOneRecordWithProgress(recnum, cb) {
        progress(100.0 * recnum / data.nrecs);
        setTimeout(function() {
          getOneRecord(recnum, cb);
        }, 20);
      }

      async.timesSeries(data.nrecs, getOneRecordWithProgress, function(err, result) {
        if (err) {
          debug('fetchData failed');
          debug(err);
          debug(result);
        } else {
          debug('fetchData', result);
        }
        data.fetchData = true;
        data.bgmReadings = result;
        progress(100);
        cb(err, data);
      });
    },

    processData: function (progress, data, cb) {
      progress(0);
      data.bg_data = processReadings(data.bgmReadings);
      data.post_records = prepBGData(progress, data);
      var ids = {};
      for (var i = 0; i < data.post_records.length; ++i) {
        var id = data.post_records[i].time + '|' + data.post_records[i].deviceId;
        if (ids[id]) {
          debug('duplicate! %s @ %d == %d', id, i, ids[id] - 1);
          debug(data.post_records[ids[id] - 1]);
          debug(data.post_records[i]);
        } else {
          ids[id] = i + 1;
        }
      }
      progress(100);
      data.processData = true;
      cb(null, data);
    },

    uploadData: function (progress, data, cb) {
      progress(0);
      var sessionInfo = {
        deviceTags: ['bgm'],
        deviceManufacturers: ['LifeScan'],
        deviceModel: 'OneTouch VerioIQ',
        deviceSerialNumber: data.serialNumber,
        deviceId: data.id,
        start: sundial.utcDateString(),
        tzName : cfg.timezone,
        version: cfg.version
      };

      cfg.api.upload.toPlatform(data.post_records, sessionInfo, progress, cfg.groupId, function (err, result) {
        if (err) {
          debug(err);
          debug(result);
          progress(100);
          return cb(err, data);
        } else {
          progress(100);
          return cb(null, data);
        }
      });

      data.cleanup = true;
      cb(null, data);

    },

    disconnect: function (progress, data, cb) {
      progress(100);
      data.disconnect = true;
      cb(null, data);
    },

    cleanup: function (progress, data, cb) {
      cfg.deviceComms.clearPacketHandler();
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
