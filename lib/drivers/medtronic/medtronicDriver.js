/*
 * == BSD2 LICENSE ==
 * Copyright (c) 2016, Tidepool Project
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
var proc = require('./processData');
var common = require('../../commonFunctions');
var medtronicSimulator = require('./medtronicSimulator');
var crcCalculator = require('../../crc.js');
var debugMode = require('../../../app/utils/debugMode');
var uploadDataPeriod = require('../../../app/utils/uploadDataPeriod');

var isBrowser = typeof window !== 'undefined';
var debug = isBrowser ? require('bows')('MedtronicDriver') : console.log;

module.exports = function (config) {
  var cfg = _.clone(config);
  var hidDevice = config.deviceComms;
  var HID_PACKET_SIZE = 64;
  var RETRIES = 5;
  var HISTORY_RETRIES = 10;
  var MAGIC_HEADER = 'ABC';
  var MEDTRONIC_PACKET_START = 33;
  var TIME_TO_WAIT = 1000;
  var STROKES_PER_UNIT = 40.0;
  var simulator = null;
  var waitingOnPacket = false;
  var rawPacket = [];

  cfg.deviceTags = ['insulin-pump', 'cgm'];

  // Metronic's Bayer Contour Next Link implementation uses polynomial 0x9b for its CRC
  crcCalculator.crc8_init(0x9b);

  var SUPPORTED_DEVICES = ['523', '551', '554', '723', '751', '754'];

  var ASCII_CONTROL = {
    ACK : 0x06,
    CR : 0x0D,
    ENQ : 0x05,
    EOT : 0x04,
    ETB : 0x17,
    ETX : 0x03,
    LF : 0x0A,
    NAK : 0x15,
    STX : 0x02
  };

  var COMMANDS = {
    // Bayer Contour Next commands to place meter
    // into remote command mode
    GET_WRITE : [0x57,0x7c], // W|
    GET_QUERY : [0x51,0x7c], // Q|
    GET_MAGIC : [0x31,0x7c], // 1|
    GET_END : [0x30,0x7c],   // 0|

    // Medtronic commands
    OPEN_CONNECTION : [0x10,  // command
                       0x01,  // retries = 0 (0 << 4 + 1 = 0x01)
                       0x1E], // timeout = 30 seconds
    SEND_MESSAGE : [0x12, // command
                    0x21, // retries = 2 (2 << 4 + 1 = 0x21 )
                    0x05] // timeout = 5 seconds
  };

  var MESSAGES = {
    WRITE_CBG_TIMESTAMP : 0x28,
    READ_TIME : 0x70,
    READ_BATTERY_STATUS: 0x72,
    READ_HISTORY : 0x80,
    READ_WIZARD_ENABLED : 0x87,
    READ_CARB_RATIOS : 0x8A,
    READ_INSULIN_SENSITIVITIES: 0x8B,
    READ_MODEL : 0x8D,
    READ_PROFILE_STD : 0x92,
    READ_PROFILE_A : 0x93,
    READ_PROFILE_B : 0x94,
    READ_CBG_HISTORY: 0x9A,
    READ_ISIG_HISTORY: 0x9B,
    READ_CURRENT_PAGE : 0x9D,
    READ_BG_TARGETS : 0x9F,
    READ_SETTINGS : 0xC0,
    READ_CURRENT_CBG_PAGE : 0xCD
  };

  var BG_UNITS = {
    1: 'mg/dL',
    2: 'mmol/L'
  };

  var CARB_UNITS = {
    1 : 'grams',
    2: 'exchanges'
  };

  var serial;
  var medtronicHeader;
  var fetchingHistory = false;

  var messageBuffer = {
    reset: function(){
      this.bytes = new Uint8Array(0);
      this.valid = false;
      this.messageLength = 0;
      this.payload = null;
      return this;
    },
    setValid: function(){
      this.payload = String.fromCharCode.apply(null, this.bytes);
      this.valid = true;
    },
    clone: function(){
      return _.clone(this);
    }
  }.reset();

  var probe = function(cb){
    debug('not probing Medtronic');
  };

  var _sum_lsb = function(bytes) {
    // checksum algorithm sums all bytes and uses lsb
    var sum = 0;
    bytes.forEach(function (byte) {
      sum += byte;
    });
    return sum & 0xff;
  };

  var buildMedtronicPacket = function (type, command, parameter, partsPerPage) {
    // first construct payload before we can determine packet length
    var payload = [];
    if(command != null) {

      if(parameter != null) {
        payload = medtronicHeader.concat(command,parameter);
        var padding = _.fill(new Array(22-parameter.length),0);
        payload = payload.concat(padding);
      } else {
        payload = medtronicHeader.concat(command,0x00);
        var payloadChecksum = crcCalculator.crc8_checksum(payload);
        payload = payload.concat(payloadChecksum);
      }
    }

    var datalen = 30 + type.length + payload.length;
    var buf = new ArrayBuffer(datalen + 4); // include 4-byte header
    var bytes = new Uint8Array(buf);

    var ctr = struct.pack(bytes, 0, '6b6z10b', 0x00, 0x00, 0x00, datalen,
                                               0x51, 0x01, // header
                                               serial, // pump serial number
                                                0, 0, 0, 0, 0, 0, 0, 0, 0, 0 // padding
                                              );
    ctr += struct.copyBytes(bytes, ctr, type, 3); // type = operation, retries and timeout

    var secondPacketLength = 44;
    var expectedBytes = 0;
    var expectedPackets = 0;
    var nakCode = 0;
    var payloadSize = payload.length;

    if(parameter != null && partsPerPage == null ) {
      partsPerPage = 4;
    }

    if(partsPerPage != null) {
      switch(partsPerPage) {
        case 3:
          expectedBytes = 192;
          expectedPackets = 4;
          break;
        case 4:
          expectedBytes = 1024;
          expectedPackets = 16;
          payloadSize = payload.length + secondPacketLength;
          break;
        case 8:
          expectedBytes = 2048;
          expectedPackets = 16;
          payloadSize = payload.length + secondPacketLength;
          break;
      }
    }

    if(expectedPackets > 0) {
      expectedPackets += 4096;
    }

    ctr += struct.pack(bytes, ctr, '2bssbi', 0, 0, expectedBytes, expectedPackets, nakCode, payloadSize);

    var checkbytes = new Uint8Array(buf.slice(4)); // checksum excludes 4-byte header
    var ctr2 = struct.copyBytes(checkbytes, ctr - 4, payload, payload.length);

    if(parameter != null) {
      var secondPacket = buildPaddingPacket(command,parameter).checksum;
      struct.pack(checkbytes, ctr2 + payload.length + 4, 'b', secondPacket);
    }
    var checksum = _sum_lsb(checkbytes);

    ctr += struct.pack(bytes, ctr, 'b', checksum);
    ctr += struct.copyBytes(bytes, ctr, payload, payload.length);

    if(debugMode.isDebug) {
      debug('Sending bytes:', common.bytes2hex(bytes));
    }
    return buf;
  };


  var buildPaddingPacket = function (command, parameter) {
    var length = 43;
    var padding = _.fill(new Array(length), 0);

    var prevPacketPadding = _.fill(new Array(22-parameter.length), 0);
    var checkbuf = medtronicHeader.concat(command,parameter,prevPacketPadding,padding);
    var checksum = crcCalculator.crc8_checksum(checkbuf);

    var datalen = length + 1; // include checksum
    var buf = new ArrayBuffer(datalen + 4 ); // include 4-byte header
    var bytes = new Uint8Array(buf);

    var ctr = struct.pack(bytes, 0, '4b', 0x00, 0x00, 0x00, datalen);
    ctr += struct.copyBytes(bytes, ctr, padding, padding.length);
    ctr += struct.pack(bytes, ctr, 'b', checksum);

    return {command : buf, checksum: checksum};
  };

  var readModel = function () {

    return {
      command: buildMedtronicPacket(COMMANDS.SEND_MESSAGE,MESSAGES.READ_MODEL),
      parser: function (packet) {
        var medtronicMessage = packet.slice(MEDTRONIC_PACKET_START);
        var messageLength = medtronicMessage[0];
        var model = struct.extractString(medtronicMessage,1,messageLength);

        return { modelNumber : model };
      }
    };
  };

  var readInsulinSensitivities = function () {

    return {
      command: buildMedtronicPacket(COMMANDS.SEND_MESSAGE,MESSAGES.READ_INSULIN_SENSITIVITIES),
      parser: function (packet) {
        var medtronicMessage = packet.slice(MEDTRONIC_PACKET_START);
        return {rawMessage : medtronicMessage};
      }
    };
  };

  var readCarbRatios = function () {

    return {
      command: buildMedtronicPacket(COMMANDS.SEND_MESSAGE,MESSAGES.READ_CARB_RATIOS),
      parser: function (packet) {
        var medtronicMessage = packet.slice(MEDTRONIC_PACKET_START);

        var carbUnits = CARB_UNITS[medtronicMessage[0]];
        var carbRatios = proc.getCarbRatios(medtronicMessage, carbUnits);

        return {carbRatios : carbRatios, carbUnits : carbUnits};
      }
    };
  };

  var readWizardEnabled = function () {

    return {
      command: buildMedtronicPacket(COMMANDS.SEND_MESSAGE,MESSAGES.READ_WIZARD_ENABLED),
      parser: function (packet) {
        var medtronicMessage = packet.slice(MEDTRONIC_PACKET_START);
        return {enabled: medtronicMessage[0] ? true : false};
      }
    };
  };

  var readBGTargets = function () {

    return {
      command: buildMedtronicPacket(COMMANDS.SEND_MESSAGE,MESSAGES.READ_BG_TARGETS),
      parser: function (packet) {
        var medtronicMessage = packet.slice(MEDTRONIC_PACKET_START);
        var bgUnits = BG_UNITS[medtronicMessage[0]];
        var bgTargets = proc.getBGTargets(medtronicMessage, bgUnits);

        return {bgTargets : bgTargets, bgUnits: bgUnits};
      }
    };
  };

  var readProfiles = function (cmd) {

    return {
      command: buildMedtronicPacket(COMMANDS.SEND_MESSAGE,cmd,null,3),
      parser: function (packet) {
        var medtronicMessage = packet.slice(MEDTRONIC_PACKET_START);
        var messageLength = medtronicMessage[0];

        var schedules = [];
        for(var j = 0; j < 47; j++ ) {
          var schedule = struct.unpack(medtronicMessage,j*3,'bbb',['rate', 'q','offset']);
          if ((schedule.offset === 0x3F) ||  // when settings are cleared, offset is 0x3F
              ((j > 0) && // only the first schedule can be {0,0,0}
              (schedule.offset === 0 && schedule.rate === 0 && schedule.q === 0 ))) {
            break;
          }
          var startTime = schedule.offset * 30 * sundial.MIN_TO_MSEC;
          schedules.push( { start: startTime, rate: schedule.rate / STROKES_PER_UNIT} );
        };

        return {schedules : schedules};
      }
    };
  };

  var readSettings = function () {

    return {
      command: buildMedtronicPacket(COMMANDS.SEND_MESSAGE,MESSAGES.READ_SETTINGS),
      parser: function (packet) {
        var medtronicMessage = packet.slice(MEDTRONIC_PACKET_START);
        return {
          activeSchedule : proc.PROFILES[medtronicMessage[11]],
          activeInsulinTime: medtronicMessage[17],
          maxBasalRate: struct.extractBEShort(medtronicMessage, 7) / STROKES_PER_UNIT,
          maxBolus: medtronicMessage[6] / 10.0,
          extendedBolusEnabled: medtronicMessage[4] ? true : false,
          tempBasalType: medtronicMessage[14] ? 'percent' : 'Units/hour',
        };
      }
    };
  };

  var writeCBGTimestamp = function () {

    return {
      command: buildMedtronicPacket(COMMANDS.SEND_MESSAGE,MESSAGES.WRITE_CBG_TIMESTAMP),
      parser: function (packet) {

        var medtronicMessage = packet.slice(MEDTRONIC_PACKET_START);

        var success = false;
        if(medtronicMessage[0] === ASCII_CONTROL.ACK) {
          success = true;
        }

        debug('Written CBG timestamp:', success);
        return { success : success };
      }
    };
  };

  var positionToPage = function (lastPosition, currentPosition, strType) {
    if ((lastPosition != null) &&
        (uploadDataPeriod.periodGlobal === uploadDataPeriod.PERIODS.DELTA)) {
      cfg.isFirstUpload = false;
      debug('Last', strType, 'page was', lastPosition, ', now at', currentPosition);
      return currentPosition - lastPosition;
    } else {
      cfg.isFirstUpload = true;
      return currentPosition;
    }
  };

  var readCurrentPage = function () {

    return {
      command: buildMedtronicPacket(COMMANDS.SEND_MESSAGE,MESSAGES.READ_CURRENT_PAGE),
      parser: function (packet) {

        var medtronicMessage = packet.slice(MEDTRONIC_PACKET_START);

        return { currentPage : struct.extractBEInt(medtronicMessage,0) };
      }
    };
  };

  var readCurrentCBGPage = function () {

    return {
      command: buildMedtronicPacket(COMMANDS.SEND_MESSAGE,MESSAGES.READ_CURRENT_CBG_PAGE),
      parser: function (packet) {

        var medtronicMessage = packet.slice(MEDTRONIC_PACKET_START);

        return {
          currentCBGPosition : struct.extractBEInt(medtronicMessage,0),
          currentGlucosePosition : struct.extractByte(medtronicMessage,5),
          currentIsigPosition : struct.extractByte(medtronicMessage,7)
        };
      }
    };
  };

  var readRTC = function () {

    return {
      command: buildMedtronicPacket(COMMANDS.SEND_MESSAGE,MESSAGES.READ_TIME),
      parser: function (packet) {

        var medtronicMessage = packet.slice(MEDTRONIC_PACKET_START);
        var dateTime = struct.unpack(medtronicMessage,0,'bbbSbb',['hours','minutes','seconds','year','month','day']);
        var jsDate = sundial.buildTimestamp(dateTime);

        return { dateTime : jsDate };
      }
    };
  };

  var readBatteryStatus = function () {

    return {
      command: buildMedtronicPacket(COMMANDS.SEND_MESSAGE,MESSAGES.READ_BATTERY_STATUS),
      parser: function (packet) {

        var result = struct.unpack(packet,MEDTRONIC_PACKET_START,'bS',['indicator','voltage']);
        var status = result.indicator ? 'low' : 'normal';

        return {
          status : status,
          voltage: result.voltage/100.0
        };
      }
    };
  };


  var sendCommand = function (cmd) {

    return {
      command: buildMedtronicPacket(COMMANDS.SEND_MESSAGE,cmd),
      parser: function (packet) {
        return {medtronicRecordType: packet[33]};
      }
    };
  };

  var readPage = function (cmd, page, partsPerPage) {
    return {
      command1: buildMedtronicPacket(COMMANDS.SEND_MESSAGE,cmd,page,partsPerPage),
      command2: buildPaddingPacket(cmd,page),
      type: cmd,
      parser: function (packet) {
        var medtronicMessage = packet.slice(MEDTRONIC_PACKET_START);
        return {message: medtronicMessage};
       }
    };
  };

  var extractPacketIntoMessage = function (bytes) {
    var packet_len = struct.extractByte(bytes, 0);
    var bytes_len = bytes.length - 1;
    if (bytes_len < packet_len) {
      packet_len = bytes_len;
    }
    if(debugMode.isDebug) {
      debug('Packet length:', packet_len);
    }

    // copying to a buffer in case there are multiple packets for one message
    // also discards the length byte from the beginning
    var tmpbuff = new Uint8Array(messageBuffer.messageLength + packet_len);
    struct.copyBytes(tmpbuff, 0, messageBuffer.bytes, messageBuffer.messageLength, 0);
    struct.copyBytes(tmpbuff, messageBuffer.messageLength, bytes, packet_len, 1);
    messageBuffer.bytes = tmpbuff;
    messageBuffer.messageLength += packet_len;
    messageBuffer.lastPacketSize = packet_len;

    messageBuffer.setValid();

    return messageBuffer;
  };

  var buildPacket = function (command, cmdlength) {
    var datalen = cmdlength + 4;
    var buf = new ArrayBuffer(datalen);
    var bytes = new Uint8Array(buf);

    var ctr = struct.pack(bytes, 0, 'bbbb', 0x00, 0x00, 0x00, cmdlength);
    ctr += struct.copyBytes(bytes, ctr, command, cmdlength);
    if(debugMode.isDebug) {
      debug('Sending bytes:', common.bytes2hex(bytes));
    }
    return {
      command: buf,
      parser: function (packet) {
        //TODO: do we need to parse the first header packet for Bayer details?
        return null;
      }
    };
  };

  var buildAckPacket = function() {
    return buildPacket(ASCII_CONTROL.ACK, 1);
  };

  var buildNakPacket = function() {
    return buildPacket(ASCII_CONTROL.NAK, 1);
  };

  function decodeMessage (parser, message) {
    var response = struct.unpack(message, 0, 'b', ['recordType']);
    var result = parser(message);
    _.assign(response, result);
    return response;
  }

  var getOneRecord = function (cmd, waitForENQ, checkNAK, callback) {

    var sendReceive = function(cb) {
      var waitTimer = setTimeout(function () {
        bcnCommandResponse(cmd, waitForENQ, 1, checkNAK, function (err, record) {
          if (err) {
            return cb(err, null);
          } else {
            if(debugMode.isDebug) {
              debug('Record:', record);
            }
            return cb(null,record);
          }
        });
      }, TIME_TO_WAIT);
    };

    async.retry({times: RETRIES, interval: TIME_TO_WAIT}, sendReceive, function(err, result) {
      callback(err, result);
    });
  };

  var getThreeRecords = function (cmd, callback) {

    var sendReceive = function(cb) {
      var waitTimer = setTimeout(function () {
        bcnCommandResponse(cmd, false, 3, true, function (err, record) {
          if (err) {
            return cb(err, null);
          } else {
            if(debugMode.isDebug) {
              debug('Record:', record);
            }
            return cb(null,record);
          }
        });
      }, TIME_TO_WAIT);
    };

    async.retry({times: RETRIES, interval: TIME_TO_WAIT}, sendReceive, function(err, result) {
      callback(err, result);
    });
  };

  var getRecords = function(packet, howMany, cb) {

    hidDevice.send(packet.command1, function (err) {
      if (err) {
        return cb(err, null);
      }
      hidDevice.send(packet.command2.command, function (err2) {
        if (err) {
          return cb(err2, null);
        }
        var page  = new Uint8Array(256 * howMany);
        var count = 0;
        var length = 0;
        var done = false;
        var nak = false;
        var COMM_ERROR_TEXT = 'Communication error. Please try to upload again.';
        async.whilst(
            function () { return !done; },
            function (callback) {
                getMessage(20000, false, 0, true, function(err, result) {
                  if (err) {
                    return callback(err, null);
                  }
                  if (result) {

                    var header = struct.extractBytes(result.bytes, 0, 2);

                    if(result.resultsInReply &&
                      header[0] !== 0x51 && header[1] !== 0x01) {

                      // for the last history page, the pump sometimes returns some
                      // of the records in the first reply... sneaky!
                      var resultsInReply = result.resultsInReply;

                      page.set(resultsInReply, 0);
                      page.set(result.bytes, resultsInReply.length);

                      if(header[0] === 0x00 && header[1] === 0x00 ) {
                        debug('Empty history page with zero header');
                        return callback(new Error(COMM_ERROR_TEXT));
                      }

                    } else {
                      var decoded = null;
                      try {
                        decoded = decodeMessage(packet.parser, result.bytes);
                      } catch (err) {
                        messageBuffer.reset();
                        return callback(err, null);
                      }

                      if (decoded.message.length === 0) {
                        debug('No data in message');
                        return callback(new Error(COMM_ERROR_TEXT));
                      };

                      if(decoded.message.length === 2 && decoded.message[0] === ASCII_CONTROL.NAK) {
                        if(debugMode.isDebug) {
                          debug('nak received');
                        }
                        nak = true;
                      } else {
                        page.set(decoded.message, length);
                        length += decoded.message.length;
                        if(debugMode.isDebug) {
                          debug('Part', count, 'of page (length: ', decoded.message.length ,'):', common.bytes2hex(decoded.message));
                        }

                        var payload = _.cloneDeep(result.bytes);
                        payload[32] = 0x00; // mask out checksum itself
                        var checksum = result.bytes[32];
                        if(_sum_lsb(payload) !== checksum) {
                          debug('Invalid checksum for message');
                          debug('Calculated checksum:', _sum_lsb(payload));
                          debug('Checksum from packet:', checksum);
                          // CGM history gets returned in pages, so we'll have to
                          // let the page checksum take care of any issues. With
                          // regular pump history we can return an error to retry.
                          if(packet.type !== MESSAGES.READ_ISIG_HISTORY &&
                            packet.type !== MESSAGES.READ_CBG_HISTORY) {
                              return callback(new Error('Invalid checksum. Please try again.'));
                            }
                        };
                      }
                    }

                    messageBuffer.reset();
                    count++;
                    if((result.lastPacketSize < 49) || (count === howMany )) {
                      done = true;
                    }
                    return callback(null, result.resultsInReply);
                  } else {
                    return callback(new Error('No results'));
                  }
                });
            },
            function (err, done) {
              if(err) {
                return cb(err,null);
              }

              if(!nak && (count < howMany)) {
                debug('Only received', count, 'of', howMany, 'pages');
                return cb(new Error('Fewer packets received than expected.'));
              }

              if(debugMode.isDebug) {
                debug('Read', count, 'parts per page.');
              }
              return cb(null, { page : page, nak: nak });
            }
        );
      });
    });
  };

  var bcnCommandResponse = function (commandpacket, waitForENQ, howManyPackets, checkNAK, callback) {

    hidDevice.send(commandpacket.command, function (err) {
      if (err) {
        return callback(err, null);
      }
      if(debugMode.isDebug) {
        debug('Sent ', common.bytes2hex(commandpacket.command));
      }

      var message;

      async.timesSeries(howManyPackets, function(n, next){

        getMessage(20000, waitForENQ, n, checkNAK, function(err, result) {
          if (err) {
            return callback(err, null);
          }
          next(null, result);
        });
      }, function(err, results) {

        try {
          var decoded = decodeMessage(commandpacket.parser, results[0].bytes);
        } catch (err) {
          messageBuffer.reset();
          return callback(err,null);
        }

        messageBuffer.reset();
        return callback(null, decoded);
      });
    });
  };

  var flush = function(cb) {
    var finished = false;

    var waitTimer = setTimeout(function () {
      finished = true;
      return cb();
    }, TIME_TO_WAIT);

    async.doWhilst(
      function (callback) {
        waitingOnPacket = true;
        hidDevice.receive(function(err, raw) {
          if (err) {
            debug('Error:', err);
          }
          if(finished) {
            // we have finished flushing, this packet should be
            // saved for getMessage()
            if(debugMode.isDebug) {
              debug('Found packet we were still waiting for');
            }
            rawPacket = raw;
            waitingOnPacket = false;
            return callback(true);
          } else {
            var packet = new Uint8Array(raw);
            if ( packet.length === 0 ) {
              return callback(true);
            }
            if(debugMode.isDebug) {
              debug('Flushing', common.bytes2hex(packet));
            }
            return callback(false);
          }
        });
      },
      function (done) {
        return (done !== true);
      },
      function () {
        if(finished) {
          // callback has already been called, just return
          return;
        }
        clearTimeout(waitTimer);
        messageBuffer.reset();
        return cb();
      }
    );
  };

  var test = true;

  var getMessage = function (timeout, waitForENQ, replyNr, checkNAK, cb) {
    var done = false;

    var abortTimer = setTimeout(function () {
      debug('TIMEOUT');
      var e = new Error('Timeout error.');
      done = true;
      e.name = 'TIMEOUT';
      return cb(e, null);
    }, timeout);

    var message;
    var firstPacket = true;

    async.doWhilst(
      function (callback) {
        var processPacket = function(packet) {
          // Only process if we get data
          if ( packet.length === 0 ) {
            return callback(false);
          }

          if(debugMode.isDebug) {
            debug('Raw packet received:', common.bytes2hex(packet));
          }

          if(checkNAK && firstPacket) {
            if(packet[31] !== 0) {
              clearTimeout(abortTimer);
              debug('Non-zero-NAK byte: ', packet[31]);
              return cb(new Error('Non-zero NAK byte'),null);
            }
          }

          var discard = MAGIC_HEADER.length;
          if(replyNr > 0 && firstPacket) {
            // if there is more than one record coming back (like with current basal profiles),
            // we need to strip out the Bayer parts of the first packet of the second record onwards
            discard += MEDTRONIC_PACKET_START;
          }
          firstPacket = false;
          message = extractPacketIntoMessage(packet.slice(discard));

          var header = packet.slice(4,12);
          var payloadLength = null;
          if(struct.extractByte(header,0) == 0x51 && _.isEqual(struct.extractString(header,2,6), serial)) {
            payloadLength = struct.extractInt(packet,32);
            if(debugMode.isDebug) {
              debug('Payload length:', payloadLength);
            }
          }

          if(debugMode.isDebug) {
            debug('Message length:', message.messageLength);
          }

          if (message.messageLength >= MEDTRONIC_PACKET_START) {
            // This is a Medtronic message
            if (payloadLength === 1 && message.bytes.slice(MEDTRONIC_PACKET_START)[0] === ASCII_CONTROL.ACK ) {
              clearTimeout(abortTimer);
              return callback(true);
            }

            if(fetchingHistory) {
              if(payloadLength && payloadLength < 256) {
                message.resultsInReply = message.bytes.slice(MEDTRONIC_PACKET_START);
                clearTimeout(abortTimer);
                return callback(true);
              }

              if(message.lastPacketSize < 60) {
                clearTimeout(abortTimer);
                return callback(true);
              }
            }
          }

          var packetHead = struct.unpack(packet, 0, '3Z2b', ['HEADER', 'SIZE', 'BYTE1']);

          if(packetHead['HEADER'] !== MAGIC_HEADER){
            debug('Invalid packet from Bayer Contour Next Link');
            clearTimeout(abortTimer);
            cb(new Error('Invalid USB packet received.'));
            return callback(true);
          }

          // The tail of the packet starts 6 from the end, but because we haven't stripped the
          // MAGIC_HEADER and length byte from packet, we're using SIZE - 2
          var packetTail = struct.unpack(packet, parseInt(packetHead['SIZE']) - 2, '2b2Z2Z', ['CR', 'FRAME_TYPE', 'CHECKSUM', 'CRLF']);
          // HID_PACKET_SIZE - 4, because we don't include the MAGIC_HEADER or the SIZE
          if(waitForENQ) {
            if (packetHead['BYTE1'] == ASCII_CONTROL.ENQ) {
              clearTimeout(abortTimer);
              return callback(true);
            }
          } else if (fetchingHistory) {
            if( packetHead['SIZE'] < ( HID_PACKET_SIZE - 4 )) {
              clearTimeout(abortTimer);
              return callback(true);
            }
          } else if( packetHead['SIZE'] < ( HID_PACKET_SIZE - 4 ) ||
              packetHead['BYTE1'] == ASCII_CONTROL.ENQ ||
              packetHead['BYTE1'] == ASCII_CONTROL.EOT ||
              packetHead['BYTE1'] == ASCII_CONTROL.ACK ||
              packetTail['FRAME_TYPE'] == ASCII_CONTROL.ETX ||
              packetTail['FRAME_TYPE'] == ASCII_CONTROL.ETB ) {
              clearTimeout(abortTimer);
              return callback(true);
          }
          return callback(false);
        };

        var packet = null;
        if(waitingOnPacket) {
          var waitTimer = setTimeout(function () {
            packet = new Uint8Array(rawPacket);
            rawPacket = [];
            processPacket(packet);
          }, TIME_TO_WAIT);
        } else {
          hidDevice.receive(function(err, raw) {
            if (err) {
              clearTimeout(abortTimer);
              return cb(err, null);
            }
            packet = new Uint8Array(raw);
            processPacket(packet);
          });
        }
      },
      function (valid) {
        return (valid !== true && done !== true);
      },
      function () {
        if(done) {
          // callback has already been called, just return
          return;
        }
        return cb(null, message);
      }
    );
  };

  var openConnection = function () {
    var command = buildMedtronicPacket(COMMANDS.OPEN_CONNECTION);
    var bytes = new Uint8Array(command);

    return {
      command: command,
      parser: function (packet) {
        if(_.isEqual(bytes.slice(4),packet)) {
          return null;
        } else {
          throw new Error('Could not open connection to pump. Please try again.');
          // One possible reason for this to happen is using a mmol/L meter
          // with a mg/dL pump. This seems highly unlikely, but could go into
          // a support article or be surfaced in the UI if it happens more frequently.
        }
      }
    };
  };

  return {
    detect: function(deviceInfo, cb){
      debug('no detect function needed', arguments);
      cb(null, deviceInfo);
    },

    setup: function (deviceInfo, progress, cb) {
      debug('in setup!');

      if(isBrowser) {
        serial = cfg.deviceInfo.serialNumber;
        medtronicHeader = [0xA7,parseInt(serial.substring(0,2),16),
                                   parseInt(serial.substring(2,4),16),
                                   parseInt(serial.substring(4,6),16)];

        progress(100);
        cb(null, {deviceInfo: deviceInfo});
      } else {
        // pages are coming from CLI
        serial = '000000';
        progress(100);
        var data = cfg.fileData;
        data.deviceInfo = deviceInfo;
        return cb(null, data);
      }
    },

    connect: function (progress, data, cb) {
      if(!isBrowser) {
        data.disconnect = false;
        return cb(null, data);
      }
      debug('in connect!');

      cfg.deviceComms.connect(data.deviceInfo, probe, function(err) {
        if (err) {
          return cb(err);
        }
        data.disconnect = false;
        progress(100);
        cb(null, data);
      });
    },

    getConfigInfo: function (progress, data, cb) {
      if(!isBrowser) {
        data.connect = true;
        return cb(null, data);
      }
      debug('in getConfigInfo', data);
      console.time('getConfigInfo elapsed');

      var ACK_ERROR = 'Expected ACK during connect:';

      async.series({


        eot : function(callback){
          debug('Connecting to meter..');
            //first, make sure we're not in remote command mode already
            getOneRecord(buildPacket([ASCII_CONTROL.EOT],1), true, false, function(err, result) {
              if(err) {
                return cb(err,null);
              }
              callback(null, 'eot');
            });
        },
        /*
        Commented this out to see if it resolves "Expected ACK during connect:ENQ" error,
        see https://trello.com/c/gWNR5JGz
        x : function(callback){
            getOneRecord(buildPacket([0x58],1), true, false, function (err, result) {
              if(err) {
                return cb(err,null);
              }
              callback(null, 'x');
            });
        },*/
        nak : function(callback){
            getOneRecord(buildPacket([ASCII_CONTROL.NAK], 1), false, false, function(err, result) {
              if(err) {
                return cb(err,null);
              }
              if(result.recordType !== ASCII_CONTROL.EOT) {
                return cb(new Error('Expected EOT.'), null);
              }
              callback(null, 'nak');
            });
        },
        enq : function(callback){
          getOneRecord(buildPacket([ASCII_CONTROL.ENQ], 1), false, false, function(err, result) {
            if(err) {
              return cb(err,null);
            }
            if(result.recordType !== ASCII_CONTROL.ACK) {
              return cb(new Error(ACK_ERROR + 'ENQ'), null);
            }
            callback(null, 'enq');
          });
        },
        write : function(callback){
          getOneRecord(buildPacket(COMMANDS.GET_WRITE, 2), false, false, function(err, result) {
            if(err) {
              return cb(err,null);
            }
            if(result.recordType !== ASCII_CONTROL.ACK) {
              return cb(new Error(ACK_ERROR + 'WRITE'), null);
            }
            callback(null, 'write');
          });
        },
        query : function(callback){
          getOneRecord(buildPacket(COMMANDS.GET_QUERY, 2), false, false, function(err, result) {
            if(err) {
              return cb(err,null);
            }
            if(result.recordType !== ASCII_CONTROL.ACK) {
              return cb(new Error(ACK_ERROR + 'QUERY'), null);
            }
            callback(null, 'query');
          });
        },
        magic : function(callback){
          getOneRecord(buildPacket(COMMANDS.GET_MAGIC, 2), false, false, function(err, result) {
            if(err) {
              return cb(err,null);
            }
            if(result.recordType !== ASCII_CONTROL.ACK) {
              return cb(new Error(ACK_ERROR + 'MAGIC'), null);
            }
            callback(null, 'magic');
          });
        },
        open_connection : function(callback){
          debug('Opening connection to pump...');
          getOneRecord(openConnection(), false, false, function(err, result) {
            if(err) {
              return cb(err, null);
            }
            callback(null, 'open');
          });
        },
        model : function(callback){
          debug('Getting model number..');
          getOneRecord(readModel(), false, true, function(err, result) {
            if (result.modelNumber.replace(/\0/g, '') === '' ) {
              return cb(new Error('Have you entered the correct serial number and is there enough battery power left?'),null);
            }
            if (_.indexOf(SUPPORTED_DEVICES,result.modelNumber) > -1 ) {
                cfg.deviceInfo.deviceId = 'MedT-' + result.modelNumber + '-' + serial;

                cfg.api.getMostRecentUploadRecord(cfg.groupId, cfg.deviceInfo.deviceId, function(apiErr, lastUpload) {
                  if (apiErr) {
                    return cb(apiErr, null);
                  }
                  cfg.lastUpload = lastUpload;
                  callback(err, result.modelNumber);
                });
              } else {
                var err = new Error('Unsupported pump model: ' + result.modelNumber);
                err.code = 'E_MEDTRONIC_UNSUPPORTED';
                cb(err);
              }
          });
        },
        profile_std : function(callback){
          debug('Getting current settings..');
          getThreeRecords(readProfiles(MESSAGES.READ_PROFILE_STD), function(err, result) {
            if(err) {
              return cb(err,null);
            }
            callback(null, {'standard' : result.schedules});
          });
        },
        profile_a : function(callback){
          getThreeRecords(readProfiles(MESSAGES.READ_PROFILE_A), function(err, result) {
            if(err) {
              return cb(err,null);
            }
            callback(null, {'pattern a' : result.schedules});
          });
        },
        profile_b : function(callback){
          getThreeRecords(readProfiles(MESSAGES.READ_PROFILE_B), function(err, result) {
            if(err) {
              return cb(err,null);
            }
            callback(null, {'pattern b' : result.schedules});
          });
        },
        bg_targets : function(callback){
          getOneRecord(readBGTargets(), false, true, function(err, result) {
            if(err) {
              return cb(err,null);
            }
            callback(null, result);
          });
        },
        carb_ratios : function(callback){
          getOneRecord(readCarbRatios(), false, true, function(err, result) {
            if(err) {
              return cb(err,null);
            }
            callback(null, result);
          });
        },
        wizard_enabled : function(callback){
          getOneRecord(readWizardEnabled(), false, true, function(err, result) {
            if(err) {
              return cb(err,null);
            }
            callback(null, result);
          });
        },
        insulin_sensitivities : function(callback){
          getOneRecord(readInsulinSensitivities(), false, true, function(err, result) {
            if(err) {
              return cb(err,null);
            }
            callback(null, result);
          });
        },
        settings : function(callback){
          getOneRecord(readSettings(), false, true, function(err, result) {
            if(err) {
              return cb(err,null);
            }
            callback(null, result);
          });
        },
        cbg_timestamp : function(callback){
          getOneRecord(writeCBGTimestamp(), false, true, function(err, result) {
            if(err) {
              return cb(err,null);
            }
            callback(null, result);
          });
        },
        current_page : function(callback){
          getOneRecord(readCurrentPage(), false, true, function(err, result) {
            if(err) {
              return cb(err,null);
            }

            // pump only stores 36 history pages
            var MAX_HISTORY_PAGES = 36;
            var lastPosition = null;
            var currentPosition = result.currentPage;

            if (_.has(cfg, 'lastUpload.client.private.delta')) {
              // retrieve last position from most recent upload record
              lastPosition = cfg.lastUpload.client.private.delta.lastPosition;
            }

            _.merge(cfg, { delta : {lastPosition : currentPosition}}); // will form part of upload record

            var currentPage = positionToPage(lastPosition, currentPosition, 'pump history');
            callback(null, { currentPage : Math.min(currentPage, MAX_HISTORY_PAGES) + 1 });
          });
        },
        current_cbg_page : function(callback){
          getOneRecord(readCurrentCBGPage(), false, true, function(err, result) {
            if(err) {
              return cb(err,null);
            }

            // pump stores a maximum of 32 glucose and ISIG history pages
            var MAX_CBG_PAGES = 32;
            var lastCBGPosition = null;
            var lastGlucosePosition = null;
            var lastIsigPosition = null;

            if (_.has(cfg, 'lastUpload.client.private.delta')) {
              // retrieve last positions from most recent upload record
              lastCBGPosition = cfg.lastUpload.client.private.delta.lastCBGPosition;
              lastGlucosePosition = cfg.lastUpload.client.private.delta.lastGlucosePosition;
              lastIsigPosition = cfg.lastUpload.client.private.delta.lastIsigPosition;
            }

            _.merge(cfg, { delta : {
              lastCBGPosition : result.currentCBGPosition,
              lastGlucosePosition : result.currentGlucosePosition,
              lastIsigPosition : result.currentIsigPosition
            }}); // will form part of upload record

            if (debugMode.isDebug) {
              debug('CBG page position - Current:', result.currentCBGPosition, 'Previous:', lastCBGPosition);
              debug('Glucose page position - Current:', result.currentGlucosePosition, 'Previous:', lastGlucosePosition);
              debug('ISIG page position - Current:', result.currentIsigPosition, 'Previous:', lastIsigPosition);
            }

            var currentPage = result.currentCBGPosition;
            var glucosePage;
            var isigPage;
            if (lastGlucosePosition && lastGlucosePosition === MAX_CBG_PAGES) {
              // if we previously read the maximum number of CBG pages, the only
              // counter that shifts is the current CGP page
              glucosePage = currentPage - lastCBGPosition;
            } else {
              glucosePage = positionToPage(lastGlucosePosition, result.currentGlucosePosition, 'glucose');
            }

            if (lastIsigPosition && lastIsigPosition === MAX_CBG_PAGES) {
              isigPage = currentPage - lastCBGPosition;
            } else {
              isigPage = positionToPage(lastIsigPosition, result.currentIsigPosition, 'isig');
            }

            callback(null, { currentPage : currentPage, glucosePage: Math.min(glucosePage + 1, MAX_CBG_PAGES), isigPage: Math.min(isigPage + 1, MAX_CBG_PAGES) });
          });
        },
        current_time : function(callback){
          getOneRecord(readRTC(), false, true, function(err, result) {
            if(err) {
              return cb(err,null);
            }
            callback(null, result);
          });
        },
        battery_status : function(callback){
          getOneRecord(readBatteryStatus(), false, true, function(err, result) {
            if(err) {
              return cb(err,null);
            }
            callback(null, result);
          });
        }
      },
      function(err, results){
          progress(100);

          if(!err){
              data.connect = true;
              var settings =  {
                modelNumber : results.model,
                deviceManufacturers : ['Medtronic'],
                serialNumber : serial,
                strokesPerUnit : STROKES_PER_UNIT
              };
              settings.basalSchedules = {};
              _.assign(settings.basalSchedules,results.profile_std);
              _.assign(settings.basalSchedules,results.profile_a);
              _.assign(settings.basalSchedules,results.profile_b);
              settings.bgTarget = results.bg_targets.bgTargets;
              settings.carbRatio = results.carb_ratios.carbRatios;
              settings.units = {
                bg : results.bg_targets.bgUnits,
                carb : results.carb_ratios.carbUnits
              };
              settings.insulinSensitivity = proc.getInsulinSensitivities(results.insulin_sensitivities.rawMessage, settings.units.bg);
              settings.activeSchedule = results.settings.activeSchedule;
              settings.currentDeviceTime = results.current_time.dateTime;

              settings.bolus = {
                amountMaximum : {
                  value: results.settings.maxBolus,
                  units: 'Units'
                },
                calculator: {
                  enabled: results.wizard_enabled.enabled
                },
                extended: {
                  enabled: results.settings.extendedBolusEnabled
                }
              };
              settings.basal = {
                rateMaximum : {
                  value: results.settings.maxBasalRate,
                  units: 'Units/hour'
                },
                temporary: {
                  type: results.settings.tempBasalType
                }
              };

              if (settings.bolus.calculator.enabled) {
                // insulin action duration is only valid when
                // bolus calculator is enabled
                settings.bolus.calculator.insulin = {
                  duration : results.settings.activeInsulinTime,
                  units: 'hours'
                };
              }

              data.settings = _.clone(settings);
              data.deviceModel = data.settings.modelNumber; // for metrics
              data.currentPage = results.current_page.currentPage;
              data.cbg = _.pick(results.current_cbg_page, ['currentPage','glucosePage', 'isigPage']);

              if (debugMode.isDebug) {
                debug('Current pump history page:', data.currentPage);
                debug('Current CGM page:', data.cbg.currentPage);
                debug('Number of glucose pages:', data.cbg.glucosePage);
                debug('Number of ISIG pages:', data.cbg.isigPage);
              }

              data.batteryStatus = _.pick(results.battery_status, ['status','voltage']);
              console.timeEnd('getConfigInfo elapsed');
              common.checkDeviceTime(settings.currentDeviceTime, cfg, function(err) {
                return cb(err, data);
              });
          } else {
            return cb(err,results);
          }
      });
    },

    fetchData: function (progress, data, cb) {
      if(!isBrowser) {
        data.fetchData = true;
        return cb(null, data);
      }
      debug('in fetchData', data);
      console.time('fetchData elapsed');
      var progressOffset = 0;

      var readHistoryPages = function(historyType, numberOfPages, currentPage, pagesCb) {

          var count = 0;
          var start = 0;
          var end = numberOfPages;
          var pages = [];
          var done = false;
          var abort = false;

          if(currentPage != null) {
            // we start from page 0 unless the start page has been moved,
            /// in which case we move the start and the end
            start = Math.max(currentPage - numberOfPages + 1, 0);
            end += start;
          }

          debug('Reading from page',start,'to', end-1); // subtract 1 because we count from 0

          async.whilst(
              function () { return ((start+count) < end) && !abort; },
              function (callback) {
                var readHistory = function(historycb) {

                  getOneRecord(sendCommand(historyType), true, true, function (err, result) {
                    if(err) {
                      if(err.name === 'TIMEOUT') {
                        return callback(err, null);
                      }
                      return historycb(err,null);
                    }
                    if(result) {
                      // if first byte of payload is empty, wait and retry
                      if(result.medtronicRecordType === undefined) {
                        messageBuffer.reset();
                        debug('Waiting and retrying..');
                        return historycb(new Error('First byte of payload is empty'));
                      } else {

                        if(result.medtronicRecordType !== ASCII_CONTROL.ACK) {
                          debug('Expected ACK, but got something else..');
                          messageBuffer.reset();
                          flush(function(flushErr) {
                            return historycb(new Error('Unexpected packet received'));
                          });
                        } else {

                          var subType, partsPerPage = null;
                          if(historyType === MESSAGES.READ_HISTORY) {
                            subType = [0x01,count+start];
                          } else {
                            subType = [0x04];
                            struct.storeBEInt(count+start,subType,1);
                          }

                          if(historyType === MESSAGES.READ_ISIG_HISTORY) {
                            partsPerPage = 8;
                          } else {
                            partsPerPage = 4;
                          }

                          getRecords(readPage(historyType,subType, partsPerPage), partsPerPage, function (err, result) {

                            if(err) {
                              debug(err);
                              debug('Waiting before retry..');
                              flush(function(flushErr) {
                                return historycb(err, null);
                              });
                            } else {
                              if(result) {

                                debug('Page', count+start, common.bytes2hex(result.page,true));

                                if(!result.page.every(function(e) { return e === 0; })) {
                                  var calculated = null, checksum = null;
                                  if(historyType === MESSAGES.READ_ISIG_HISTORY) {
                                    calculated = crcCalculator.calcCRC(result.page,2044,0xFFFF,0x0000);
                                    checksum = (result.page[2044] << 8) + result.page[2046];
                                  } else {
                                    calculated = crcCalculator.calcCRC(result.page,1022,0xFFFF,0x0000);
                                    checksum = struct.extractBEShort(result.page,1022);
                                  }
                                  if(calculated !== checksum) {
                                    debug('Checksum mismatch...');
                                    debug('Calculated checksum for page:', calculated);
                                    debug('Checksum from page:', checksum);
                                    result.valid = false;
                                  } else {
                                    result.valid = true;
                                  }

                                } else {
                                  // zero padded page
                                  result.valid = false;
                                }

                                pages[count] = result;
                                count++;
                                progress(progressOffset + ((count / (end - start)) * 20), cfg.isFirstUpload);
                                debug('Read', count, 'pages so far.');
                                messageBuffer.reset();

                                if(result.valid) {
                                  return historycb(null, count);
                                } else {
                                  flush(function(flushErr) {
                                    return historycb(flushErr, count);
                                  });
                                }

                              } else {
                                return historycb(new Error('No history'));
                              }
                            }
                          });
                        }
                      }
                    } else {
                      return historycb(new Error('No history'));
                    }
                  });
                };

                async.retry({times: HISTORY_RETRIES, interval: TIME_TO_WAIT}, readHistory, function(err, result) {
                  if(err) {
                    return callback(err,null);
                  }
                  callback(null, result);
                });

              },
              function (err, n) {
                  if(err) {
                    return pagesCb(err, null);
                  } else {
                    debug('Read', n, 'pages in total.');
                    return pagesCb(null, pages);
                  }
              }
          );
      };

      var retryInvalidPages = function(type, pages, start, retrycb) {
        async.timesSeries( pages.length, function(n, next){
          if(pages[n].valid || pages[n].nak) {
            next(null, pages[n]);
          } else {
            debug('Re-reading at position',start+n);
            readHistoryPages(type, 1, start+n, function(err, results) {
              if(results == null) {
                next(null, {valid:false});
              }
              if(debugMode.isDebug) {
                debug('Page', n, 're-read as', results[0]);
              }
              next(err,results[0]);
            });
          }
        }, function(err, results) {
          return retrycb(err,results);
        });
      };

      fetchingHistory = true;

      progress(0);
      async.series({
        readPumpHistory : function(callback){
          debug('Reading pump history..');
          readHistoryPages(MESSAGES.READ_HISTORY, data.currentPage, null, function(err, results) {
            if(err) {
              return callback(err);
            }
            retryInvalidPages(MESSAGES.READ_HISTORY, results, 0, function(err, pages) {
              _.assign(data, { pages : pages });
              progressOffset += 20;
              return callback(err);
            });
          });
        },
        readCBGHistory : function(callback) {
          debug('Reading CGM history..');
          readHistoryPages(MESSAGES.READ_CBG_HISTORY, data.cbg.glucosePage, data.cbg.currentPage, function(err, results) {
            if(err) {
              return callback(err);
            }
            retryInvalidPages(MESSAGES.READ_CBG_HISTORY, results, (data.cbg.currentPage - data.cbg.glucosePage + 1), function(err, pages) {
              _.assign(data, { cbg_pages : pages });
              progressOffset += 20;
              return callback(err);
            });
          });
        },
        readISIGHistory : function(callback) {
          debug('Reading ISIG history..');
          readHistoryPages(MESSAGES.READ_ISIG_HISTORY, data.cbg.isigPage, data.cbg.currentPage, function(err, results) {
            if(err) {
              return callback(err);
            }
            retryInvalidPages(MESSAGES.READ_ISIG_HISTORY, results, (data.cbg.currentPage - data.cbg.isigPage + 1), function(err, pages) {
              _.assign(data, { isig_pages : pages });
              return callback(err);
            });
          });
        }
      },
      function(err, results){
          if(!err){
            progress(100);
            data.fetchData = true;
            console.timeEnd('fetchData elapsed');
            cb(null, data);
          } else {
            return cb(err,results);
          }
      });
    },

    processData: function (progress, data, cb) {
      debug('in processData');
      console.time('processData elapsed');
      cfg.builder.setDefaults({ deviceId: cfg.deviceInfo.deviceId});
      progress(0);

      proc.processPages(data, function (err, records) {
        if(err) {
          return cb(err,data);
        }
        proc.processCBGPages(data, function (cgmErr, cgmRecords) {

          if(cgmErr) {
            return cb(cgmErr,data);
          }

          var dateRecords =  _.filter(records, function(event) {return event.jsDate;}); // filter out objects without dates
          if(dateRecords.length === 0) {
            return cb(new Error('No records found on pump'), null);
          }
          var mostRecent = sundial.applyTimezone(dateRecords[dateRecords.length-1].jsDate, cfg.timezone).toISOString();
          proc.init(cfg, data.settings);
          debug('Pump time changes:');
          try {
            var result = proc.buildTimeChangeRecords(records, mostRecent, 'pump');
          } catch (err) {
            return cb(err, data);
          }
          var postrecords = result.postrecords;
          cfg.tzoUtil = result.tzoUtil;

          var cgmDateRecords =  _.filter(cgmRecords, function(event) {return event.jsDate;}); // filter out objects without dates
          if(cgmDateRecords.length === 0) {
            debug('No CGM time change records found on pump');
          } else {
            debug('CGM time changes:');
            try {
              var cgmResult = proc.buildTimeChangeRecords(cgmRecords, mostRecent, 'cgm');
            } catch (err) {
              return cb(err, data);
            }
            postrecords = postrecords.concat(cgmResult.postrecords);
            cfg.cgmTzoUtil = cgmResult.tzoUtil;
            if(cfg.tzoUtil.records.length !== cfg.cgmTzoUtil.records.length) {
              debug('Pump and CGM time changes do not match!');
            }
          }

          try {
            postrecords = postrecords.concat(proc.buildBolusRecords(records));
            postrecords = postrecords.concat(proc.buildWizardRecords(records));
            postrecords = postrecords.concat(proc.buildBGRecords(records));
            postrecords = postrecords.concat(proc.buildTempBasalRecords(records));
            postrecords = postrecords.concat(proc.buildBasalRecords(records));
            var buildsettings = proc.buildSettings(records);
            postrecords = postrecords.concat(buildsettings.postrecords);
            postrecords = postrecords.concat(proc.buildSuspendResumeRecords(records));
            postrecords = postrecords.concat(proc.buildAlarmRecords(records));
            postrecords = postrecords.concat(proc.buildPrimeRecords(records));
            postrecords = postrecords.concat(proc.buildRewindRecords(records));
            postrecords = postrecords.concat(proc.buildCGMRecords(cgmRecords));
          } catch (err) {
            return cb(err,data);
          }

          simulator = medtronicSimulator.make({settings: data.settings,
                                               tzoUtil: cfg.tzoUtil,
                                               builder: cfg.builder});

          // sort by log index
          postrecords = _.sortBy(postrecords, function(d) { return d.index; });

          // use first record's date for initial settings
          var initialSettings = buildsettings.initialSettings;
          initialSettings.set('index', postrecords[0].index)
            .with_deviceTime(postrecords[0].deviceTime)
            .with_time(postrecords[0].time)
            .with_timezoneOffset(postrecords[0].timezoneOffset)
            .with_conversionOffset(postrecords[0].conversionOffset)
            .with_clockDriftOffset(postrecords[0].clockDriftOffset);
          postrecords.unshift(initialSettings);

          // sort by time
          postrecords = _.sortBy(postrecords, function(d) { return d.time; });

          try {
            for (var j = 0; j < postrecords.length; ++j) {
              var datum = postrecords[j];
              switch (datum.type) {
                case 'basal':
                  simulator.basal(datum);
                  break;
                case 'bolus':
                  simulator.bolus(datum);
                  break;
                case 'wizard':
                  simulator.wizard(datum);
                  break;
                case 'smbg':
                  simulator.smbg(datum);
                  break;
                case 'pumpSettings':
                  simulator.pumpSettings(datum);
                  break;
                case 'cbg':
                  simulator.cbg(datum);
                  break;
                case 'deviceEvent':
                  if (datum.subType === 'status') {
                    simulator.suspendResume(datum);
                  } else if (datum.subType === 'alarm') {
                    simulator.alarm(datum);
                  } else if (datum.subType === 'prime') {
                    simulator.prime(datum);
                  } else if (datum.subType === 'reservoirChange') {
                    simulator.rewind(datum);
                  } else if (datum.subType === 'timeChange') {
                    simulator.changeDeviceTime(datum);
                  } else if (datum.subType === 'calibration') {
                    simulator.calibration(datum);
                  }
                  break;
                default:
                  debug('[Hand-off to simulator] Unhandled type!', datum.type);
              }
            }
            simulator.finalize();
          } catch (err) {
            return cb(err, data);
          }

          progress(100);
          data.processData = true;

          data.post_records = simulator.getEvents();
          console.timeEnd('processData elapsed');
          cb(null, data);
        });
      });
    },

    uploadData: function (progress, data, cb) {
      progress(0);
      console.time('uploadData elapsed');

      var sessionInfo = {
        delta: cfg.delta,
        deviceTags: cfg.deviceTags,
        deviceManufacturers: data.settings.deviceManufacturers,
        deviceModel: data.settings.modelNumber,
        deviceSerialNumber: serial,
        deviceId: cfg.deviceInfo.deviceId,
        start: sundial.utcDateString(),
        timeProcessing: cfg.tzoUtil.type,
        tzName : cfg.timezone,
        version: cfg.version,
        blobId: data.blobId
      };

      cfg.api.upload.toPlatform(data.post_records, sessionInfo, progress, cfg.groupId, function (err, result) {
        progress(100);

        if (err) {
          debug(err);
          debug(result);
          return cb(err, data);
        } else {
          data.cleanup = true;
          console.timeEnd('uploadData elapsed');
          return cb(null, data);
        }
      });

    },

    disconnect: function (progress, data, cb) {
      debug('in disconnect');
      progress(100);
      cb(null,data);
    },

    cleanup: function (progress, data, cb) {
      debug('in cleanup');

      if(isBrowser) {
        if(!data.disconnect){
          getOneRecord(buildPacket([ASCII_CONTROL.EOT],1), true, false, function(err, result) {
            cfg.deviceComms.disconnect(data, function() {
                progress(100);
                data.cleanup = true;
                data.disconnect = true;
                cb(null, data);
            });
          });
        } else {
          progress(100);
          cb(null,data);
        }
      } else {
        progress(100);
        cb(null,data);
      }

    }
  };
};
