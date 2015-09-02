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
 * IOET's code start here
 * */

var _ = require('lodash');
var async = require('async');
var sundial = require('sundial');
var crcCalculator = require('../crc.js');
var struct = require('../struct.js')();
var annotate = require('../eventAnnotations');

var TZOUtil = require('../TimezoneOffsetUtil');

var isBrowser = typeof window !== 'undefined';
var debug = isBrowser ? require('../bows')('BCDriver') : debug;


module.exports = function (config) {

  var cfg = _.clone(config);
  var serialDevice = config.deviceComms;
  // these thresholds values are not present into the header, but 
  // we set these default values because they are explained into
  // the page 35 of "CONTOUR Meters 3rd party CIS rev K-01.pdf"
  var DEFAULT_CONTOUR_LOW_VALUE = 10;
  var DEFAULT_CONTOUR_HI_VALUE = 600;

  cfg.tzoUtil = new TZOUtil(cfg.timezone, new Date().toISOString(), []);

  var ASCII_CONTROL = {
    ACK : 0x06,
    NAK : 0x15,
    ENQ : 0x05,
    STX : 0x02,
    ETB : 0x17,
    ETX : 0x03,
    EOT : 0x04,
    TER : 0x4c
  };

    var probe = function(cb){
     debug('attempting probe Contour');
     cb();
  };

  var bcnPacketHandler = function (buffer) {

    if (buffer.len() < 1) { //only empty buffer is no valid packet
      return false;
    }

    var packet = extractPacket(buffer.bytes());
    if (packet.packet_len !== 0) {
      // cleanup the buffer data
      buffer.discard(packet.packet_len);
    }

    if (packet.valid) {
      return packet;
    } else {
      return null;
    }
  };

  var buildPacket = function (command, cmdlength) {
    // in this protocol comms we dont use the ABC prefix, so we pack only a bit, in this case ACK
    var datalen = cmdlength;
    var buf = new ArrayBuffer(datalen);
    var bytes = new Uint8Array(buf);
    var ctr = struct.pack(bytes, 0, 'b', command);
    return buf;
  };

  var packetParser = function(result){
    var tostr = _.map(result,
                      function(e){
                        return String.fromCharCode(e);
                      }).join('');
    result.payload = tostr;
    return tostr;
  };

  var buildAckPacket = function() {
    return buildPacket(ASCII_CONTROL.ACK, 1);
  };

  var extractPacket = function (bytes) {
    //all packets passed the bcnPacketHandler validation are valid, the checksum is verified later
    var packet = {
      bytes: bytes,
      valid: false,
      packet_len: 0,
      payload: null
    };

    var packet_len = bytes.length;
    packet.packet_len = packet_len;
    packet.valid = true;

    return packet;
  };


  var buildHeaderCmd = function() {
    return {
      packet: buildAckPacket(),
      parser: packetParser
    };
  };

  var parseHeader = function (s){
    var data = s.split('\n').filter(function(e){ return e.length > 1;});
    var header = data.shift();

    if(verifyChecksum(header)){
      var patient = data.shift();
      var lineFeed = data.pop();
      var pString = header.split('|');
      var pInfo = pString[4].split('^');
      var sNum = pInfo[2];
      var records = data.filter(function(e){ return e[2] === 'R';});
      var recordAverage = records.shift(); // the first record means the average
      var ordRecords = data.filter(function(e){ return e[2] === 'O';});

      /* 
      * Thresholds are not reported in the header!
      * these default values are taken from the doc (CONTOUR Meters 3rd party CIS rev K-01.pdf page 34)
      * in that table (field #4) is specified the threshold HI/LO values for contour devices
      */
      var lowT = DEFAULT_CONTOUR_LOW_VALUE;
      var hiT = DEFAULT_CONTOUR_HI_VALUE;

      var devInfo = {
        model: pInfo[0],
        serialNumber: sNum,
        nrecs: records.length,
        recordA: recordAverage,
        rawrecords: records,
        ordRecords: ordRecords,
        lowT: lowT,
        hiT: hiT
      };

      return devInfo;
    }else{
      return null;
    }
  };

  function verifyChecksum(record){
      var str = record.trim();
      var data = str.split(String.fromCharCode(ASCII_CONTROL.ETB));
      var check = data[1];
      var sum = 0;
      var n = record.slice(0, record.length - 3);

      _.map(n, function(e){
          if(e.charCodeAt(0) !== ASCII_CONTROL.STX){
              sum += e.charCodeAt(0);
          }
      });

      if((sum % 256) !== parseInt(check, 16)){
          return null;
      }else{
          return data[0];
      }
  }  

var parseDataRecord = function (str, callback){
    var data = verifyChecksum(str);
    if(data){
      var result = data.trim().match(/^.*\d+R\|(\d+).*Glucose\|(\d+)\|(\w+\/\w+)\^\w*\|{2}(>|<|T|>\\T|<\\T|)\|(\w*)\|{4}(\d{12})$/).slice(1,7);
      callback(null, result);
    }else{
      throw( new Error('Invalid record data') );
    }

  };

  var getAnnotations = function (annotation, data){

    // we dont know if is necessary add the unreported thesholds annotation

    if (annotation.indexOf('>') !== -1) {
      return [{
        code: 'bg/out-of-range',
        threshold: data.hiT,
        value: 'high'
      }];
    } else if (annotation.indexOf('<') !== -1) {
      return [{
        code: 'bg/out-of-range',
        threshold: data.lowT,
        value: 'low'
      }];
    } else {
      return null;
    }
  };

  var isControl = function(markers) {
    if(markers.indexOf('E') !== -1) {
      debug('Marking as control test');
      return true;
    }else{
      return false;
    }
  };

  var getOneRecord = function (record, data, callback) {
    parseDataRecord(record,function(err,r){
      var robj = {};
      if (err) {
          debug('Failure trying to read record', record);
          debug(err);
          return callback(err, null);
      } else {
          robj.timestamp = parseInt(r[5]);
          robj.annotations = getAnnotations(r[3], data);
          robj.control = isControl(r[4]);
          robj.units = r[2];
          robj.glucose = parseInt(r[1]);
          robj.nrec = parseInt(r[0]);
          return callback(null, robj);
      }
    });
  };

  var listenForPacket = function (timeout, parser, callback) {
   var abortTimer = setTimeout(function () {
     clearInterval(listenTimer);
     debug('TIMEOUT');
     callback('TIMEOUT', null);
   }, timeout);

   var raw = [];

   var listenTimer = setInterval(function () {
     if (serialDevice.hasAvailablePacket()) {
      var pkt = serialDevice.nextPacket();
      var startIndex = 0;
      var rec = struct.unpack(pkt.bytes, 0, 'b', ['TYPE']);
      var hasETB = _.indexOf(pkt.bytes, ASCII_CONTROL.ETB, startIndex);
      var hasETX = _.indexOf(pkt.bytes, ASCII_CONTROL.ETX, startIndex);
      debug(rec);
      _.map(pkt.bytes,function(e){ raw.push(e); });
      if(hasETB !== -1 || hasETX !== -1){
          // send a new ACK
          var cmd = buildAckPacket();
          serialDevice.writeSerial(cmd, function () {
              debug('New ACK SENT');
          });
      }else if(rec.TYPE == ASCII_CONTROL.EOT){
          clearTimeout(abortTimer);
          clearInterval(listenTimer);
          callback(null, raw);
      }
     }
   }, 20);
  };

  var bcnCommandResponse = function (commandpacket, callback) {

    serialDevice.writeSerial(commandpacket.packet, function () {
       listenForPacket(5000, commandpacket.parser, function(err, result) {
          
            if (err === 'TIMEOUT') {
              console.log('timeout');
              callback(err, null);
            } else {
              var rawtext = commandpacket.parser(result);
              callback(err, rawtext);
            }
       });
   });
  };

  var getDeviceInfo = function (obj, cb) {
      debug('DEBUG: on getDeviceInfo');
      var cmd = buildHeaderCmd();
      bcnCommandResponse(cmd, function (err, datatxt) {
          if (err) {
              debug('Failure trying to talk to device.');
              debug(err);
              cb(null, null);
          } else {
              obj.header = datatxt;
              if(parseHeader(datatxt)){
                _.assign(obj, parseHeader(datatxt));
                cb(null, obj);
              }else{
                debug('Invalid header data');
                throw(new Error('Invalid header data'));
              }
          }
      });
  };

  var processReadings = function(readings) {
    _.each(readings, function(reading, index) {
      var dateTime = sundial.parseFromFormat(reading.timestamp, 'YYYYMMDD HHmm');
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
    }else{
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
      console.log('in setup!');
      progress(100);
      cb(null, {deviceInfo: deviceInfo});
    },

    connect: function (progress, data, cb) {
      debug('in connect!');
     cfg.deviceComms.connect(data.deviceInfo, bcnPacketHandler, probe, function(err) {
       if (err) {
         return cb(err);
       }
        progress(100);
        data.connect = true;
        cb(null, data);
     });
    },

    getConfigInfo: function (progress, data, cb) {
      debug('in getConfigInfo', data);

      getDeviceInfo({}, function (err, result) {
          progress(100);

          if(!err){
              data.connect = true;
              _.assign(data, result);

              cb(null, data);
          }else{
              cb(err,result);
          }
      });
    },

    fetchData: function (progress, data, cb) {
      debug('in fetchData', data);

      function getOneRecordWithProgress(recnum, cb) {
        var rec = data.rawrecords.shift();
        progress(100.0 * recnum / data.nrecs);
        setTimeout(function() {
          getOneRecord(rec, data, cb);
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
            delete data.post_records[i].index; 
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
        deviceManufacturers: ['Bayer'],
        deviceModel: data.model,
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
      progress(100);
      cb(null, data);
    },

    cleanup: function (progress, data, cb) {
      debug('in cleanup');
      if(!data.disconnect){
          cfg.deviceComms.disconnect(function() {
              progress(100);
              data.cleanup = true;
              data.disconnect = true;
              cb(null, data);
          });
      }else{
        progress(100);
      }
    }
  };
};
