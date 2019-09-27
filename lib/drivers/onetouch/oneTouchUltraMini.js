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
var crcCalculator = require('../../crc.js');
var struct = require('../../struct.js')();
var TZOUtil = require('../../TimezoneOffsetUtil');
var annotate = require('../../eventAnnotations');
var debugMode = require('../../../app/utils/debugMode');
var common = require('../../commonFunctions');

var isBrowser = typeof window !== 'undefined';
var debug = isBrowser ? require('bows')('OTMiniDriver') : debug;

module.exports = function (config) {
  var cfg = _.clone(config);
  cfg.deviceData = null;
  var serialDevice = config.deviceComms;
  // With no date & time settings changes available,
  // timezone is applied across-the-board
  cfg.tzoUtil = new TZOUtil(cfg.timezone, new Date().toISOString(), []);
  cfg.deviceTags = ['bgm'];

  var STX = 0x02;
  var ETX = 0x03;

  var LINK_CTRL_MASK = {
    MORE: 0x10,
    DISC: 0x08,
    ACK : 0x04,
    E   : 0x02,     // last bit of "expected" (receive) counter
    S   : 0x01,      // last bit of send counter
    NONE: 0x00
  };

  var send_bit = 0;
  var expected_receive_bit = 0;

  var buildLinkControlByte = function(lcb) {
    lcb |= send_bit;
    lcb |= expected_receive_bit;
    return lcb;
  };

  // builds a command in an ArrayBuffer
  // The first byte is always 0x01 (SYNC),
  // the second and third bytes are a little-endian payload length.
  // then comes the payload,
  // finally, it's followed with a 2-byte little-endian CRC of all the bytes
  // up to that point.
  // payload is any indexable array-like object that returns Numbers

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

  var buildAckPacket = function() {
    return buildPacket(LINK_CTRL_MASK.NONE, 0);
  };

  var buildDisconnectPacket = function() {
    send_bit = LINK_CTRL_MASK.S;
    expected_receive_bit = LINK_CTRL_MASK.E;
    return buildPacket(LINK_CTRL_MASK.DISC, 0);
  };

  var buildReadSoftwareVersion = function() {
    var cmd = [0x05, 0x0D, 0x02];
    return buildPacket(LINK_CTRL_MASK.NONE, cmd.length, cmd);
  };

  var buildReadSerialNumber = function() {
    var cmd = [0x05, 0x0B, 0x02, 0x00, 0x00, 0x00, 0x00, 0x84, 0x6A, 0xE8, 0x73, 0x00];
    return buildPacket(LINK_CTRL_MASK.NONE, cmd.length, cmd);
  };

  var buildDeleteAllRecords = function() {
    var cmd = [0x05, 0x1A];
    return buildPacket(LINK_CTRL_MASK.NONE, cmd.length, cmd);
  };

  var buildReadRecordNumber = function(recnum) {
    var cmd = [0x05, 0x1F, 0x00, 0x00];  // the two 0s are filled with the rec #
    struct.pack(cmd, 2, 's', recnum);
    return buildPacket(LINK_CTRL_MASK.NONE, cmd.length, cmd);
  };

  var buildGetRecordCount = function() {
    return buildReadRecordNumber(501);  // magic number that means 'tell me how many records you have'
  };

  var buildGetUnitSettings = function() {
    var cmd = [0x05, 0x09, 0x02, 0x09, 0x00, 0x00, 0x00, 0x00];
    return buildPacket(LINK_CTRL_MASK.NONE, cmd.length, cmd);
  };

  var buildReadDateFormat = function() {
    var cmd = [0x05, 0x08, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00];
    return buildPacket(LINK_CTRL_MASK.NONE, cmd.length, cmd);
  };

  var buildReadRTC = function() {
    var cmd = [0x05, 0x20, 0x02, 0x00, 0x00, 0x00, 0x00];
    return buildPacket(LINK_CTRL_MASK.NONE, cmd.length, cmd);
  };

  // accepts a stream of bytes and tries to find a packet
  // at the beginning of it.
  // returns a packet object; if valid == true it's a valid packet
  // if packet_len is nonzero, that much should be deleted from the stream
  // if valid is false and packet_len is nonzero, the previous packet
  // should be NAKed.
  // don't call this if you don't have at least 2 bytes in store (and really
  // should be at least 6)
  var extractPacket = function (bytes) {
    var packet = {
      bytes: bytes,
      valid: false,
      packet_len: 0,
      lcb: 0,
      payload: null,
      crc: 0
    };

    if (bytes[0] !== STX) {
      return packet;
    }

    var plen = bytes.length;
    var packet_len = struct.extractByte(bytes, 1);
    if (packet_len > plen) {
      return packet;  // we're not done yet
    }

    // we now have enough length for a complete packet, so calc the CRC
    packet.packet_len = packet_len;
    packet.crc = struct.extractShort(bytes, packet_len - 2);
    var crc = crcCalculator.calcCRC_A(bytes, packet_len - 2);
    if (crc !== packet.crc) {
      // if the crc is bad, we should discard the whole packet
      // (packet_len is nonzero)
      return packet;
    }

    // link control is the third byte, packet is remainder of data up to ETX
    packet.lcb = bytes[2];
    packet.payload = new Uint8Array(packet_len - 6);
    for (var i = 0; i < packet_len - 6; ++i) {
      packet.payload[i] = bytes[i + 3];
    }

    packet.valid = true;
    return packet;
  };

  // When you call this, it looks to see if a complete OneTouch packet has
  // arrived and it calls the callback with it and strips it from the buffer.
  // It returns true if a packet was found, and false if not.
  var oneTouchPacketHandler = function (buffer) {
    // for efficiency reasons, we're not going to bother to ask the driver
    // to decode things that can't possibly be a packet
    // first, discard bytes that can't start a packet
    var discardCount = 0;
    while (buffer.len() > discardCount && buffer.get(0) !== STX) {
      ++discardCount;
    }
    if (discardCount) {
      buffer.discard(discardCount);
    }

    if (buffer.len() < 6) { // all complete packets must be at least this long
      return false;       // not enough there yet
    }

    // there's enough there to try, anyway
    var packet = extractPacket(buffer.bytes());
    if (packet.packet_len !== 0) {
      // remove the now-processed packet
      buffer.discard(packet.packet_len);
    }

    if (packet.valid) {
      return packet;
    } else {
      return null;
    }
  };

  // check if the E and S flags are correct, and update the counters.
  var checkFlags = function(lcb) {
    if ((lcb & LINK_CTRL_MASK.E) !== expected_receive_bit) {
      // debug('expected receive bit is wrong; toggling it');
      expected_receive_bit ^= LINK_CTRL_MASK.E;
      return false;
    }
    if ((lcb & LINK_CTRL_MASK.S) !== send_bit) {
      debug('send bit is wrong; toggling it');
      send_bit ^= LINK_CTRL_MASK.S;
      return false;
    }
    return true;
  };

  // an ack packet is invalid if the length is not 0, or if the ack bit isn't set,
  // or if the E and S flags aren't correct.
  var isValidAcknowledgePacket = function(packet) {
    if (packet.packet_len !== 6) {
      debug(packet.packet_len);
      return false;
    }
    if ((packet.lcb & LINK_CTRL_MASK.ACK) !== LINK_CTRL_MASK.ACK) {
      debug('link ctrl mask doesn\'t validate');
      return false;
    }
    return checkFlags(packet.lcb);
  };

  var resetDevice = function() {
    return {
      packet: buildDisconnectPacket(),
      parser: function(packet) {
        if (packet.lcb & LINK_CTRL_MASK.DISC === 0) {
          debug('Disconnect request did not respond with a disconnect.');
          return false;
        }
        return true;
      }
    };
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
        // we always call the callback if we get a packet back,
        // so just cancel the timers if we do
        clearTimeout(abortTimer);
        clearInterval(listenTimer);
        pkt.parsed_payload = parser(pkt);
        callback(null, pkt);
      }
    }, 20);     // spin on this one quickly
  };

  // this sends a command, then waits for an ack and a response packet,
  // then calls the callback with the response packet
  var oneTouchCommandResponse = function (commandpacket, callback) {
    serialDevice.writeSerial(commandpacket.packet, function () {
      // once we've sent the command, start listening for a response
      // but if we don't get one in 1 second give up
      listenForPacket(1000, isValidAcknowledgePacket, function() {
        // toggle the acknowledge bit
        send_bit ^= LINK_CTRL_MASK.S;
        // eventually should probably skip listening for second packet
        // if the first didn't validate, but for now just go on
        listenForPacket(1000, commandpacket.parser, function(err, result) {
          if (err === 'TIMEOUT') {
            // after parsing, ack the packet
            var ackpacket = buildAckPacket();
            // and toggle the expected_receive bit
            expected_receive_bit ^= LINK_CTRL_MASK.E;
            // now send it
            serialDevice.writeSerial(ackpacket, function() {
              callback(err, result);
            });
          } else {
            // if we timed out, just say so
            callback(err, result);
          }
        });
      });
    });
  };

  // This resets the one-touch by sending a disconnect
  // We don't use the CommandResponse function because unlike everything
  // else, there's no second packet after the disconnect acknowledgement.
  var oneTouchDisconnect = function (callback) {
    // var p = new Uint8Array(commandpacket.packet);
    // debug(p);
    var command = resetDevice();
    serialDevice.writeSerial(command.packet, function () {
      // once we've sent the command, start listening for a response
      // but if we don't get one in 1 second give up
      listenForPacket(1000, command.parser, callback);
    });
  };

  var readSoftwareVersion = function() {
    return {
      packet: buildReadSoftwareVersion(),
      parser: function (result) {
        return struct.unpack(result.payload, 0, '...9Z8Z', ['version', 'creationDate']);
      }
    };
  };

  var readSerialNumber = function() {
    return {
      packet: buildReadSerialNumber(),
      parser: function (result) {
        // first 2 chars of payload are junk
        var sernum = String.fromCharCode.apply(null, result.payload.subarray(2));
        return { model: 'Mini', serialNumber: sernum };
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

  var readUnitSettings = function() {
    return {
      packet: buildGetUnitSettings(),
      parser: function (result) {
        return struct.unpack(result.payload, 0, '..b', ['units']);
      }
    };
  };

  var readRTC = function() {
    return {
      packet: buildReadRTC(),
      parser: function (result) {
        return struct.unpack(result.payload, 0, '..i', ['timestamp']);
      }
    };
  };

  var readRecordNumber = function(n) {
    return {
      packet: buildReadRecordNumber(n),
      parser: function (result) {
        return struct.unpack(result.payload, 0, '..ii', ['timestamp', 'glucose']);
      }
    };
  };

  var getDeviceInfo = function (obj, cb) {
    debug('resetting oneTouch Mini');
    oneTouchDisconnect(function() {
      var cmd = readSoftwareVersion();
      oneTouchCommandResponse(cmd, function (err, result) {
        if (err) {
          debug('Failure trying to talk to device.');
          debug(err);
          debug(result);
          cb(err, null);
        } else {
          _.assign(obj, result.parsed_payload);
          cb(null, obj);
        }
      });
    });
  };

  var getSerialNumber = function (obj, cb) {
    var cmd = readSerialNumber();
    oneTouchCommandResponse(cmd, function (err, result) {
      if (err) {
        debug('Failure trying to talk to device.');
        debug(err);
        debug(result);
        cb(err, null);
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
        cb(err, null);
      } else {
        _.assign(obj, result.parsed_payload);
        cb(null, obj);
      }
    });
  };

  var getRTC = function (cb) {
    var cmd = readRTC();
    oneTouchCommandResponse(cmd, function (err, result) {
      if (err) {
        debug('Failure reading RTC.');
        debug(err);
        debug(result);
        cb(err, null);
      } else {
        cb(null, result.parsed_payload);
      }
    });
  };

  var getUnitSettings = function (obj, cb) {
    var cmd = readUnitSettings();
    oneTouchCommandResponse(cmd, function (err, result) {
      if (err) {
        debug('Failure trying to talk to device.');
        debug(err);
        debug(result);
        cb(err, null);
      } else {
        if(result.parsed_payload.units === 0) {
          _.assign(obj, {units: 'mg/dL'});
        } else if (result.parsed_payload.units === 1) {
          _.assign(obj, {units: 'mmol/L'});
        } else {
          return cb(new Error('Could not read unit settings'));
        }

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
      readings[index].displayTime = new Date(reading.timestamp * 1000);
    });
  };

  var prepBGData = function (progress, data) {
    data.id = 'OneTouch'+ data.model + data.serialNumber;
    cfg.builder.setDefaults({ deviceId: data.id});
    var dataToPost = [];
    if (data.bgmReadings.length > 0) {
      for (var i = 0; i < data.bgmReadings.length; ++i) {
        var datum = data.bgmReadings[i];

        if(debugMode.isDebug) {
          debug(sundial.formatDeviceTime(datum.displayTime),':', datum.glucose);
        }

        var annotation = null;
        if (datum.glucose === 0xFFFE) {
          // When LO, meter will send 0xFFFE as value
          datum.glucose = 19;
          annotation = {
            code: 'bg/out-of-range',
            value: 'low',
            threshold: 20
          };
        } else if (datum.glucose === 0xFFFF) {
          // When HI, meter will send 0xFFFF as value
          datum.glucose = 601;
          annotation = {
            code: 'bg/out-of-range',
            value: 'high',
            threshold: 600
          };
        }

        var smbg = cfg.builder.makeSMBG()
          .with_value(datum.glucose)
          .with_deviceTime(sundial.formatDeviceTime(datum.displayTime))
          .with_units(data.units)
          .set('index', i);

        cfg.tzoUtil.fillInUTCInfo(smbg, datum.displayTime);
        delete smbg.index;

        if(annotation) {
          annotate.annotateEvent(smbg, annotation);
        }

        dataToPost.push(smbg.done());
      }
    }else{
      debug('Device has no records to upload');
    }

    return dataToPost;
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

      data.deviceInfo.deviceId = data.id;

      cfg.deviceComms.connect(data.deviceInfo, oneTouchPacketHandler, function(err) {
        if (err) {
          return cb(err);
        }
        getDeviceInfo({}, function(commsErr, obj) {
          if (commsErr) {
            cb(commsErr, obj);
          } else {
            getSerialNumber(obj, function (err, result) {
              if (err) {
                return cb(err, null);
              }
              progress(100);
              data.connect = true;
              _.assign(data, result);
              cb(null, data);
            });
          }
        });
      });
    },

    getConfigInfo: function (progress, data, cb) {
      // get the number of records
      getRecordCount({}, function(err, obj) {
        if (err) {
          return cb(err, null);
        }

        getUnitSettings(obj, function(err2, obj2) {
          if (err2) {
            return cb(err2, null);
          }

          getRTC(function(err3, obj3) {
            var currentDeviceTime = sundial.formatDeviceTime(new Date(obj3.timestamp * 1000));
            common.checkDeviceTime(currentDeviceTime, cfg, function(err) {
              progress(100);
              data.getConfigInfo = true;
              _.assign(data, obj2);
              debug('getConfigInfo', data);
              cb(err, data);
            });
          });
        });
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
        deviceTags: cfg.deviceTags,
        deviceManufacturers: ['LifeScan'],
        deviceModel: 'OneTouch UltraMini',
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
          debug(result);
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
