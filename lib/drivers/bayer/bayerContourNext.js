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

/**
 * Packet message format <STX> FN text <ETX> C1 C2 <CR> <LF>
 * */
var _ = require('lodash');
var async = require('async');
var sundial = require('sundial');
var crcCalculator = require('../../crc.js');
var struct = require('../../struct.js')();
var annotate = require('../../eventAnnotations');

var TZOUtil = require('../../TimezoneOffsetUtil');

var isBrowser = typeof window !== 'undefined';
var debug = isBrowser ? require('bows')('BCNextDriver') : debug;


module.exports = function (config) {
  var cfg = _.clone(config);
  var hidDevice = config.deviceComms;
  var messageBuffer = [];
  var HID_PACKET_SIZE = 64;
  var RETRIES = 6;
  // With no date & time settings changes available,
  // timezone is applied across-the-board
  cfg.tzoUtil = new TZOUtil(cfg.timezone, new Date().toISOString(), []);

  var MAGIC_HEADER = 'ABC';

  /* end */

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

  var astmMessageBuffer = {
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
    debug('attempting probe of Bayer Contour Next');
  };

  var extractPacketIntoMessage = function (bytes) {
    var packet_len = struct.extractByte(bytes, 0);
    var byte1 = struct.extractByte(bytes, 1);
    switch(byte1){
      case ASCII_CONTROL.EOT:
      case ASCII_CONTROL.ENQ:
      case ASCII_CONTROL.STX:
        astmMessageBuffer.reset();
        break;
    }

    // Copy to the Message Buffer, discabrding the length byte from the begining
    var tmpbuff = new Uint8Array(astmMessageBuffer.messageLength + packet_len);
    struct.copyBytes(tmpbuff, 0, astmMessageBuffer.bytes, astmMessageBuffer.messageLength, 0);
    struct.copyBytes(tmpbuff, astmMessageBuffer.messageLength, bytes, packet_len, 1);
    astmMessageBuffer.bytes = tmpbuff;
    astmMessageBuffer.messageLength += packet_len;

    // We're only using FRAME_TYPE for now, but we could use the other items for extra checks
    var packetTail = struct.unpack(astmMessageBuffer.bytes, astmMessageBuffer.messageLength - 6, '2b2Z2Z', ['CR', 'FRAME_TYPE', 'CHECKSUM', 'CRLF']);

    if (packetTail['FRAME_TYPE'] === ASCII_CONTROL.ETX || // Last ASTM Message
      packetTail['FRAME_TYPE'] === ASCII_CONTROL.ETB || // End of valid ASTM Message
      byte1 === ASCII_CONTROL.EOT || // End of transmission - Abort! Abandon all ships!
      byte1 === ASCII_CONTROL.ENQ ) { // Enquiry
        astmMessageBuffer.setValid();
    }

    return astmMessageBuffer;
  };

  var buildPacket = function (command, cmdlength) {
    var datalen = cmdlength + 4; // we used 4 bytes because we add (0x41 0x42 0x43 length)
                                 // if this value is changed the driver always returns the header
    var buf = new ArrayBuffer(datalen);
    var bytes = new Uint8Array(buf);
    var ctr = struct.pack(bytes, 0, '3Z', MAGIC_HEADER );
    if (cmdlength) {
      ctr += struct.pack(bytes, ctr, 'bb', cmdlength, command);
    }
    return buf;
  };

  var buildAckPacket = function() {
    return buildPacket(ASCII_CONTROL.ACK, 1);
  };

  var buildNakPacket = function() {
    return buildPacket(ASCII_CONTROL.NAK, 1);
  };

  // header data looks like
  /*
  <STX>1H|\^&||qvqOi8|Bayer7350^01.14\01.03\04.18^7358-1611135^0000-
  |A=1^C=00^G=es,en\es\it\de\fr\hr\da\nl\fi\el\no\pt\sl\sv^I=0200^R=
  0^S=01^U=0^V=20600^X=070070070180130180070130^Y=120054252099^Z=1|4
  |||||P|1|201505291248<ETB>01<CR><LF>
  */

  var parseHeader = function (header, callback){
    var pString = header.split('|');
    var pInfo = pString[4].split('^');
    var sNum = pInfo[2].match(/^\d+\-\s*(\w+)/);
    var threshold = null;
    var thrs = pString[5].split('^');

    for (var i = 0; i < thrs.length; i++){
      var val = thrs[i].match(/^(\w+)\=/);
      if (val[1] === 'V'){
        threshold = thrs[i].match(/^.+\=(\d{2})(\d{3})/);
        break;
      }
    }

    var devInfo = {
      model: pInfo[0],
      serialNumber: sNum[1],
      nrecs: pString[6]
    };

    if(threshold){
      devInfo.lowThreshold = parseInt(threshold[1]);
      devInfo.hiThreshold = parseInt(threshold[2]);
    } else {
      devInfo.unreportedThreshold = true;
      devInfo.lowThreshold = 20;
      devInfo.hiThreshold = 600;
    }

    callback(null, devInfo);
  };

  /**
   * Calculates checksum for specified ASTM Frame.
   * @param {string} frame - The ASTM Frame to checksum
   * @return {string} Checksum value returned as a byte sized integer in hex base
   */
  function makeChecksum (frame) {
    var sum = frame.split('').reduce( function (previousValue, currentValue, currentIndex, array) {
      return (currentIndex == 1 ? previousValue.charCodeAt(0) : previousValue) + currentValue.charCodeAt(0);
    });
    return ('00' + (sum % 256).toString(16).toUpperCase()).substr(-2);
  }

  /**
   * Decodes complete ASTM message that is sent or received due
   * communication routines. It should contains checksum to be verified.
   * @param {string} message - The ASTM Message to decode
   * @return {Object} Object with the format:
   * {
   *  sequenceNumber: int,
   *  frame: string,
   *  checksum: string,
   * }
   * @throws {Error} if ASTM message is malformed or checksum verification fails.
   * TODO - return a listOfRecords, rather than a string with the whole frame? This would let us
   * dispense will all the RegExp parsing later on.
   */
  function decodeMessage (message) {

    if (!(message[0] === ASCII_CONTROL.STX &&
      message[message.length-2] === ASCII_CONTROL.CR &&
      message[message.length-1] === ASCII_CONTROL.LF ) &&
      message[0] !== ASCII_CONTROL.EOT ) {
      throw(new Error('Meter not ready. Please retry.'));
    }

    var frameLength = message.length - 6; // Would normally be - 5, but we'll unpack the sequence number directly
    var response = struct.unpack(message, 0, 'bb'+frameLength+'Z2Z2Z', ['messageType', 'sequenceNumber', 'frame', 'checksum', 'CRLF']);
    if(response['messageType'] === ASCII_CONTROL.STX) {
      // Turn sequenceNumber into an integer by subtracting ASCII ZERO (ie, 48) from it.
      response.sequenceNumber -= 48;
      var calculatedChecksum = makeChecksum(response.sequenceNumber + response.frame);
      if (calculatedChecksum != response.checksum ) {
        throw(new Error('Checksum failed. Expected ' + response.checksum + ', calculated ' + calculatedChecksum));
      }
    }

    // Discard the unnecessary response elements.
    delete response.CRLF;

    return response;
  }

  /* Record data looks like
  <STX>5R|3|^^^Glucose|93|mg/dL^P||A/M0/T1||201505261150<CR><ETB>74<CR><LF>
  */
  var parseDataRecord = function (data, callback){
    // TODO - The NextLink 2.4 also includes seconds in its timestamp (14 digits)
    var result = data.match(/^R\|(\d+)\|\^\^\^Glucose\|([0-9.]+)\|(\w+\/\w+).*\|{2}(.*)\|{2}(\d{12}).*/);
    if (result != null) {
      result = result.slice(1,6);
    }
    callback(null, result);
  };

  var getAnnotations = function (annotation, data){
    var annInfo = [];

    if (data.unreportedThreshold) {
      annInfo.push({
        code: 'bayer/smbg/unreported-hi-lo-threshold'
      });
    }
    if (annotation.indexOf('>') !== -1) {

      annInfo.push({
        code: 'bg/out-of-range',
        threshold: data.hiThreshold,
        value: 'high'
      });

      return annInfo;
    } else if (annotation.indexOf('<') !== -1) {

      annInfo.push({
        code: 'bg/out-of-range',
        threshold: data.lowThreshold,
        value: 'low'
      });

      return annInfo;
    } else {
      return null;
    }
  };

  var isControl = function(markers) {
    if(markers.indexOf('C') !== -1) {
      debug('Marking as control test');
      return true;
    } else {
      return false;
    }
  };

  var getOneRecord = function (data, callback) {
    var retry = 0;
    var robj = {};
    var cmd = buildAckPacket();
    var error = false;

    async.doWhilst(
      function (whilstCb) {
        bcnCommandResponse(cmd, function (err, record) {
          if (err) {
            if (err.name === 'TIMEOUT' || err.name === 'TypeError') {
              return whilstCb(err, null);
            } else {
              retry++;
              cmd = buildNakPacket();
            }
          } else {
            var recordType = (record.messageType === ASCII_CONTROL.STX) ?
              struct.extractByte(record.frame, 0) : record.messageType;

            robj.recordType = recordType;

            switch(recordType) {
              case 'R':
              parseDataRecord(record.frame, function(err, r) {
                if (err) {
                  debug('Failure trying to read record', record.frame);
                  debug(err);
                  return whilstCb(err);
                } else {
                  if(r) {
                    robj.timestamp = parseInt(r[4]);
                    robj.annotations = getAnnotations(r[3], data);
                    robj.control = isControl(r[3]);
                    robj.units = r[2];
                    if(robj.units === 'mmol/L') {
                      robj.glucose = parseFloat(r[1]);
                    } else {
                      robj.glucose = parseInt(r[1]);
                    }
                    robj.nrec = parseInt(r[0]);
                  }
                }
              });
              break;
              case 'H':
              robj.header = record.frame;
              parseHeader(record.frame, function(err, result) {
                if (err) {
                  debug('Invalid header data');
                  return whilstCb(new Error('Invalid header data'), null);
                } else {
                  _.assign(robj, result);
                }
              });
              break;
            }
          }
          whilstCb(null);
        });
      },
      function () { return (Object.getOwnPropertyNames(robj).length === 0 && retry < RETRIES) && !error; },
      function (err) {
        if (retry === RETRIES ) {
          err = new Error('Communication retry limit reached');
        }
        if (err) {
          error = true;
          debug('Failure trying to talk to device.');
          debug(err);
          return callback(err, null);
        } else {
          callback(null, robj);
        }
      }
    );
  };

  var bcnCommandResponse = function (commandpacket, callback) {
    hidDevice.send(commandpacket, function () {
      getASTMMessage(5000, 3, function(err, result) {
        if (err) {
          return callback(err, null);
        } else {
            callback(null, decodeMessage(result.bytes));
        }
      });
    });
  };

  var getASTMMessage = function (timeout, retries, cb) {
    var abortTimer = setTimeout(function () {
      debug('TIMEOUT');
      var e = new Error('Timeout error.');
      e.name = 'TIMEOUT';
      return cb(e, null);
    }, timeout);

    var message;

    async.doWhilst(
      function (callback) {
        hidDevice.receive(function(raw) {
          try {
            var packet = new Uint8Array(raw);
            message = extractPacketIntoMessage(packet.slice(MAGIC_HEADER.length));

            // Only process if we get data
            if ( packet.length === 0 ) {
              return callback(null, false);
            }

            var packetHead = struct.unpack(packet, 0, '3Z2b', ['HEADER', 'SIZE', 'BYTE1']);

            if(packetHead['HEADER'] !== MAGIC_HEADER){
              debug('Invalid packet from Contour device');
              clearTimeout(abortTimer);
              return callback(new Error('Invalid USB packet received.'));
            }

            // The tail of the packet starts 6 from the end, but because we haven't stripped the
            // MAGIC_HEADER and length byte from packet, we're using SIZE - 2
            var packetTail = struct.unpack(packet, parseInt(packetHead['SIZE']) - 2, '2b2Z2Z', ['CR', 'FRAME_TYPE', 'CHECKSUM', 'CRLF']);

            // HID_PACKET_SIZE - 4, because we don't include the MAGIC_HEADER or the SIZE
            if( packetHead['SIZE'] < ( HID_PACKET_SIZE - 4 ) ||
                packetHead['BYTE1'] == ASCII_CONTROL.EOT ||
                packetHead['BYTE1'] == ASCII_CONTROL.ENQ ||
                packetTail['FRAME_TYPE'] == ASCII_CONTROL.ETX ||
                packetTail['FRAME_TYPE'] == ASCII_CONTROL.ETB ) {
                clearTimeout(abortTimer);
                return callback(null, true);
            }
            return callback(null, false);
          } catch (err) {
            return callback(err);
          }
        });
      },
      function (valid) {
        return (valid !== true);
      },
      function (err) {
        return cb(err, message);
      });
  };

  var processReadings = function(readings) {
    _.each(readings, function(reading, index) {
      var dateTime = sundial.parseFromFormat(reading.timestamp, 'YYYYMMDDHHmm');
      readings[index].displayTime = sundial.formatDeviceTime(new Date(dateTime).toISOString());
      var utcInfo = cfg.tzoUtil.lookup(dateTime);
      readings[index].displayUtc = utcInfo.time;
      readings[index].timezoneOffset = utcInfo.timezoneOffset;
      readings[index].conversionOffset = utcInfo.conversionOffset;
    });
  };

  var prepBGData = function (progress, data) {
    //build missing data.id
    data.id = data.model + '-' + data.serialNumber;
    cfg.builder.setDefaults({ deviceId: data.id});
    var dataToPost = [];
    if (data.bgmReadings.length > 0) {
      for (var i = 0; i < data.bgmReadings.length; ++i) {
        var datum = data.bgmReadings[i];
        if(datum.control === true) {
          debug('Discarding control');
          continue;
        }
        var smbg = cfg.builder.makeSMBG()
          .with_value(datum.glucose)
          .with_deviceTime(datum.displayTime)
          .with_timezoneOffset(datum.timezoneOffset)
          .with_conversionOffset(datum.conversionOffset)
          .with_time(datum.displayUtc)
          .with_units(datum.units)
          .set('index', datum.nrec)
          .done();
          if (datum.annotations) {
            _.each(datum.annotations, function(ann) {
              annotate.annotateEvent(smbg, ann);
            });
          }
        dataToPost.push(smbg);
      }
    } else {
      debug('Device has no records to upload');
      throw(new Error('Device has no records to upload'));
    }

    return dataToPost;
  };

  return {
    detect: function(deviceInfo, cb){
      debug('no detect function needed', arguments);
      cb(null, deviceInfo);
    },

    setup: function (deviceInfo, progress, cb) {
      debug('in setup!');
      progress(100);
      cb(null, {deviceInfo: deviceInfo});
    },

    connect: function (progress, data, cb) {
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
      debug('in getConfigInfo', data);

      getOneRecord({}, function (err, result) {
          progress(100);

          if(!err){
              data.connect = true;
              _.assign(data, result);

              cb(null, data);
          } else {
              return cb(err,result);
          }
      });
    },

    fetchData: function (progress, data, cb) {
      debug('in fetchData', data);

      var recordType = null;
      var dataRecords = [];
      var error = false;

      async.whilst(
        // Get records from the meter until we get the Message Terminator Record (L)
        // The spec says that unless we get this, any preceding data should not be used.
        function () { return (recordType !== ASCII_CONTROL.EOT && !error); },
        function (callback) {
          getOneRecord(data, function (err, result) {
            if (err) {
              error = true;
            } else {
              recordType = result.recordType;
              // We only collect data records (R)
              if (recordType === 'R' && result.timestamp) {
                progress(100.0 * result.nrec / data.nrecs);
                dataRecords.push(result);
              }
            }
            return callback(err);
          });
        },
        function (err) {
          progress(100);
          if(err || error) {
            data.bgmReadings = [];
          } else {
            debug('fetchData', dataRecords);
            data.bgmReadings = dataRecords;
          }
          data.fetchData = true;
          cb(err, data);
        }
      );
    },

    processData: function (progress, data, cb) {
      //debug('in processData');
      progress(0);
      data.bg_data = processReadings(data.bgmReadings);
      try {
        data.post_records = prepBGData(progress, data);
        var ids = {};
        for (var i = 0; i < data.post_records.length; ++i) {
          delete data.post_records[i].index; // Remove index as Jaeb study uses logIndices instead
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
      }
      catch(err) {
        cb(new Error(err), null);
      }
    },

    uploadData: function (progress, data, cb) {
      progress(0);
      var sessionInfo = {
        deviceTags: ['bgm'],
        deviceManufacturers: ['Bayer'],
        deviceModel: 'Contour Next',
        deviceSerialNumber: data.serialNumber,
        deviceId: data.id,
        start: sundial.utcDateString(),
        timeProcessing: cfg.tzoUtil.type,
        tzName : cfg.timezone,
        version: cfg.version
      };

      cfg.api.upload.toPlatform(data.post_records, sessionInfo, progress, cfg.groupId, function (err, result) {
        progress(100);

        if (err) {
          debug(err);
          debug(result);
          return cb(err, data);
        } else {
          data.cleanup = true;
          return cb(null, data);
        }
      });

    },

    disconnect: function (progress, data, cb) {
      debug('in disconnect');
      cfg.deviceComms.removeListeners();
      // Due to an upstream bug in HIDAPI on Windoze, we have to send a command
      // to the device to ensure that the listeners are removed before we disconnect
      // For more details, see https://github.com/node-hid/node-hid/issues/61
      hidDevice.send(buildPacket([ASCII_CONTROL.EOT],1), function(err, result) {
        progress(100);
        cb(null, data);
      });
    },

    cleanup: function (progress, data, cb) {
      debug('in cleanup');
      if(!data.disconnect){
          cfg.deviceComms.disconnect(data, function() {
              progress(100);
              data.cleanup = true;
              data.disconnect = true;
              cb(null, data);
          });
      } else {
        progress(100);
      }
    }
  };
};
