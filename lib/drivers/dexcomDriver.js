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
var annotate = require('../eventAnnotations');
var util = require('util');

var crcCalculator = require('../crc.js');
var struct = require('../struct.js')();

var mungeUserSettings = require('../dexcom/userSettingsChanges');
var TZOUtil = require('../TimezoneOffsetUtil');

var debug = require('../bows')('DexcomDriver');

module.exports = function (config) {
  var cfg = _.clone(config);
  debug('dexcom config: ', cfg);
  var serialDevice = config.deviceComms;
  var dexcomDeviceId;

  if (config.silent) {
    // debug = _.noop;
  }

  var SYNC_BYTE = 0x01;

  var CMDS = {
    NULL: { value: 0, name: 'NULL' },
    ACK: { value: 1, name: 'ACK' },
    NAK: { value: 2, name: 'NAK' },
    INVALID_COMMAND: { value: 3, name: 'Invalid Command' },
    INVALID_PARAM: { value: 4, name: 'Invalid Param' },
    INCOMPLETE_PACKET_RECEIVED: { value: 5, name: 'Incomplete Packet Received' },
    RECEIVER_ERROR: { value: 6, name: 'Receiver Error' },
    INVALID_MODE: { value: 7, name: 'Invalid Mode' },
    PING: { value: 10, name: 'Ping' },
    READ_FIRMWARE_HEADER: { value: 11, name: 'Read Firmware Header' },
    READ_DATABASE_PARTITION_INFO: { value: 15, name: 'Read Database Partition Info' },
    READ_DATA_PAGE_RANGE: { value: 16, name: 'Read Data Page Range' },
    READ_DATA_PAGES: { value: 17, name: 'Read Data Pages' },
    READ_DATA_PAGE_HEADER: { value: 18, name: 'Read Data Page Header' },
    READ_LANGUAGE: { value: 27, name: 'Read Language' },
    READ_DISPLAY_TIME_OFFSET: { value: 29, name: 'Read Display Time Offset' },
    READ_SYSTEM_TIME: { value: 34, name: 'Read System Time' },
    READ_SYSTEM_TIME_OFFSET: { value: 35, name: 'Read System Time Offset' },
    READ_GLUCOSE_UNIT: { value: 37, name: 'Read Glucose Unit' },
    READ_CLOCK_MODE: { value: 41, name: 'Read Clock Mode' }
  };

  var RECORD_TYPES = {
    MANUFACTURING_DATA: { value: 0, name: 'MANUFACTURING_DATA' },
    EGV_DATA: { value: 4, name: 'EGV_DATA' },
    METER_DATA: { value: 10, name: 'METER_DATA' },
    USER_EVENT_DATA: { value: 11, name: 'USER_EVENT_DATA' },
    USER_SETTING_DATA: { value: 12, name: 'USER_SETTING_DATA' }
  };

  var TRENDS = {
    NONE: { value: 0, name: 'None' },
    DOUBLEUP: { value: 1, name: 'DoubleUp' },
    SINGLEUP: { value: 2, name: 'SingleUp' },
    FORTYFIVEUP: { value: 3, name: 'FortyFiveUp' },
    FLAT: { value: 4, name: 'Flat' },
    FORTYFIVEDOWN: { value: 5, name: 'FortyFiveDown' },
    SINGLEDOWN: { value: 6, name: 'SingleDown' },
    DOUBLEDOWN: { value: 7, name: 'DoubleDown' },
    NOTCOMPUTABLE: { value: 8, name: 'Not Computable' }
  };

  var ENABLE_FLAGS = {
    BLINDED: { value: 0x01, name: 'BLINDED' },
    TWENTY_FOUR_HOUR_TIME: { value: 0x02, name: 'TWENTY_FOUR_HOUR_TIME'},
    MANUFACTURING_MODE: { value: 0x04, name: 'MANUFACTURING_MODE' },
    LOW_ALARM_ENABLED: { value: 0x010, name: 'LOW_ALARM_ENABLED' },
    HIGH_ALARM_ENABLED: { value: 0x020, name: 'HIGH_ALARM_ENABLED' },
    RISE_RATE_ENABLED: { value: 0x040, name: 'RISE_RATE_ENABLED' },
    FALL_RATE_ENABLED: { value:   0x080, name: 'FALL_RATE_ENABLED' },
    OUT_OF_RANGE_ENABLED: { value: 0x100, name: 'OUT_OF_RANGE_ENABLED' },
    TIME_LOSS_OCCURRED: { value: 0x200, name: 'TIME_LOSS_OCCURRED' }
  };

  var LANGUAGES = {
    ENGLISH: { value: 0x0409, name: 'English' },
    FRENCH: { value: 0x040C, name: 'French' },
    GERMAN: { value: 0x0407, name: 'German' },
    DUTCH: { value: 0x0413, name: 'Dutch' },
    SPANISH: { value: 0x040A, name: 'Spanish' },
    SWEDISH: { value: 0x041D, name: 'Swedish' },
    ITALIAN: { value: 0x0410, name: 'Italian' },
    CZECH: { value: 0x0405, name: 'Czech' },
    FINNISH: { value: 0x040B, name: 'Finnish' },
    FRENCH_CANADIAN: { value: 0x0C0C, name: 'French (Canadian)' },
    POLISH: { value: 0x0415, name: 'Polish' },
    PORTUGESE_BRAZIL: { value: 0x0416, name: 'Portugese (Brazilian)' },
    DANISH: { value: 0x0406, name: 'Danish' },
    HUNGARIAN: { value: 0x040E, name: 'Hungarian' },
    NORWEGIAN_BOKMAL: { value: 0x0414, name: 'Norwegian (Bokmål)' },
    TURKISH: { value: 0x041F, name: 'Turkish' }
  };

  var ALARM_PROFILES = [
    'Vibrate',
    'Soft',
    'Normal',
    'Attentive',
    'Hyposafe'
  ];

  var hasFlag = function (flag, v) {
    if (flag.value & v) {
      return true;
    }
    return false;
  };

  var getItemWithValue = function (list, itemname, valuename, value) {
    for (var i in list) {
      if (list[i][valuename] == value) {
        return list[i][itemname];
      }
    }
    return null;
  };

  var getNameForValue = function (list, v) {
    return getItemWithValue(list, 'name', 'value', v);
  };

  var BASE_DATE_DEVICE = Date.UTC(2009, 0, 1, 0, 0, 0).valueOf();
  debug('timezone=' + cfg.timezone + ' Device=' + BASE_DATE_DEVICE);
  debug(new Date(BASE_DATE_DEVICE));


  var getCmdName = function (idx) {
    for (var i in CMDS) {
      if (CMDS[i].value == idx) {
        return CMDS[i].name;
      }
    }
    return 'UNKNOWN COMMAND!';
  };

  var getTrendName = function (idx) {
    for (var i in TRENDS) {
      if (TRENDS[i].value == idx) {
        return TRENDS[i].name;
      }
    }
    return 'UNKNOWN TREND!';
  };

  var firmwareHeader = null, partitionInfo = null;

  // builds a command in an ArrayBuffer
  // The first byte is always 0x01 (SYNC),
  // the second and third bytes are a little-endian payload length.
  // then comes the payload,
  // finally, it's followed with a 2-byte little-endian CRC of all the bytes
  // up to that point.
  // payload is any indexable array-like object that returns Numbers

  var buildPacket = function (command, payloadLength, payload) {
    var datalen = payloadLength + 6;
    var buf = new ArrayBuffer(datalen);
    var bytes = new Uint8Array(buf);
    var ctr = struct.pack(bytes, 0, 'bsb', SYNC_BYTE,
                          datalen, command);
    ctr += struct.copyBytes(bytes, ctr, payload, payloadLength);
    var crc = crcCalculator.calcCRC_D(bytes, ctr);
    struct.pack(bytes, ctr, 's', crc);
    return buf;
  };


  var readFirmwareHeader = function () {
    return {
      packet: buildPacket(
        CMDS.READ_FIRMWARE_HEADER.value, 0, null
      ),
      parser: function (packet) {
        var data = parseXMLPayload(packet);
        firmwareHeader = data;
        return data;
      }
    };
  };

  var readPartitionInfo = function() {
    return {
      packet: buildPacket(
        CMDS.READ_DATABASE_PARTITION_INFO.value, 0, null
      ),
      parser: function (packet) {
        // TODO: skipping parseXMLPayload for now because not yet getting any attributes
        // out of this XML (waiting for response from Dexcom to decide if we need to)
        var data = struct.extractString(packet.payload, 0, packet.packet_len - 6);
        debug(data);
        partitionInfo = data;
        return data;
      }
    };
  };

  var ping = function () {
    return {
      packet: buildPacket(
        CMDS.PING.value, 0, null
      ),
      parser: function (packet) {
        debug('pong!');
        debug(packet);
      }
    };
  };

  var readDataPageRange = function (rectype) {
    return {
      packet: buildPacket(
        CMDS.READ_DATA_PAGE_RANGE.value,
        1,
        [rectype.value]
      ),
      parser: function (result) {
        return struct.unpack(result.payload, 0, 'ii', ['lo', 'hi']);
      }
    };
  };

  var makeHeaderParser = function(recordParser) {
    var headerParser = function (result) {
      var format = 'iibbiiiibb';
      var header = struct.unpack(result.payload, 0, format, [
        'index', 'nrecs', 'rectype', 'revision',
        'pagenum', 'r1', 'r2', 'r3', 'j1', 'j2'
      ]);
      return {
        header: header,
        data: recordParser(header, result.payload.subarray(struct.structlen(format)))
      };
    };

    return headerParser;
  };


  var parse_egv_records = function (header, data) {
    var all = [];
    var ctr = 0;
    var format = 'iisbs';
    var flen = struct.structlen(format);

    for (var i = 0; i < header.nrecs; ++i) {
      var rec = struct.unpack(data, ctr, format, [
        'systemSeconds', 'displaySeconds', 'glucose', 'trendArrow', 'crc'
      ]);

      rec.trendArrow &= 0xF;
      rec.trendText = getTrendName(rec.trendArrow);
      rec.systemTimeMsec = BASE_DATE_DEVICE + 1000 * rec.systemSeconds;
      rec.displayTimeMsec = BASE_DATE_DEVICE + 1000 * rec.displaySeconds;
      rec.internalTime = sundial.formatDeviceTime(new Date(rec.systemTimeMsec).toISOString());
      rec.displayDate = new Date(rec.displayTimeMsec);

      rec.data = data.subarray(ctr, ctr + flen);
      ctr += flen;

      // dexcom specs say to ignore values outside these ranges
      // some glucose records have a value with the high bit set;
      // these seem to have a time identical to the next record,
      // so we presume that they are superceded by
      // the other record (probably a calibration)
      var skip = false;
      if (rec.glucose & 0x8000) {
        skip = true;
      }

      // according to the spec, only 10 bits are valid
      rec.glucose &= 0x3FF;
      // now check for highs/lows
      if (rec.glucose < 20) {
        // it's a special value we must ignore
        skip = true;
      } else if (rec.glucose < 40) {
        // it's a LOW, mark it so
        rec.glucose = 39;
      } else if (rec.glucose > 400) {
        // it's HIGH
        rec.glucose = 401;
      }

      if (!skip) {
        all.push(rec);
      }
    }
    return all;
  };

  var parse_meter_records = function (header, data) {
    var all = [];
    var ctr = 0;
    var format = 'iisis';
    var flen = struct.structlen(format);

    for (var i = 0; i < header.nrecs; ++i) {
      var rec = struct.unpack(data, ctr, format, [
        'systemSeconds', 'displaySeconds', 'meterValue', 'meterTimeSeconds', 'crc'
      ]);

      rec.systemTimeMsec = BASE_DATE_DEVICE + 1000 * rec.systemSeconds;
      rec.displayTimeMsec = BASE_DATE_DEVICE + 1000 * rec.displaySeconds;
      // not sure what to do with the meterTime -- it's very much not definitive.
      rec.meterTimeMsec = BASE_DATE_DEVICE + 1000 * rec.meterTimeSeconds;
      rec.internalTime = sundial.formatDeviceTime(new Date(rec.systemTimeMsec).toISOString());
      rec.displayDate = new Date(rec.displayTimeMsec);
      rec.data = data.subarray(ctr, ctr + flen);
      ctr += flen;
      all.push(rec);
    }
    return all;
  };

  var parse_setting_records = function (header, data) {
    var all = [];
    var ctr = 0;
    var format = 'iiiniissssssssbbis';
    var flen = struct.structlen(format);

    for (var i = 0; i < header.nrecs; ++i) {
      var rec = struct.unpack(data, ctr, format, ['systemSeconds', 'displaySeconds',
        'systemOffset', 'displayOffset', 'transmitterId', 'enableFlags',
        'highAlarmValue', 'highAlarmSnooze', 'lowAlarmValue', 'lowAlarmSnooze',
        'riseRateValue', 'fallRateValue', 'outOfRangeSnooze', 'language',
        'alarmProfile', 'setUpState', 'reserved', 'crc'
      ]);

      rec.lowAlarmEnabled = hasFlag(ENABLE_FLAGS.LOW_ALARM_ENABLED, rec.enableFlags);
      rec.highAlarmEnabled = hasFlag(ENABLE_FLAGS.HIGH_ALARM_ENABLED, rec.enableFlags);
      rec.riseRateEnabled = hasFlag(ENABLE_FLAGS.RISE_RATE_ENABLED, rec.enableFlags);
      rec.fallRateEnabled = hasFlag(ENABLE_FLAGS.FALL_RATE_ENABLED, rec.enableFlags);
      rec.outOfRangeEnabled = hasFlag(ENABLE_FLAGS.OUT_OF_RANGE_ENABLED, rec.enableFlags);

      rec.highAlarmSnoozeMsec = rec.highAlarmSnooze * sundial.MIN_TO_MSEC;
      rec.lowAlarmSnoozeMsec = rec.lowAlarmSnooze * sundial.MIN_TO_MSEC;
      rec.outOfRangeSnoozeMsec = rec.outOfRangeSnooze * sundial.MIN_TO_MSEC;

      rec.languageName = getNameForValue(LANGUAGES, rec.language);
      rec.alarmProfileName = ALARM_PROFILES[rec.alarmProfile - 1];

      rec.systemTimeMsec = BASE_DATE_DEVICE + 1000 * rec.systemSeconds;
      rec.internalTime = sundial.formatDeviceTime(new Date(rec.systemTimeMsec).toISOString());
      var displayTimeMsec = BASE_DATE_DEVICE + 1000 * rec.displaySeconds;
      rec.jsDate = new Date(displayTimeMsec);
      rec.deviceTime = sundial.formatDeviceTime(rec.jsDate.toISOString());
      rec.data = data.subarray(ctr, ctr + flen);
      ctr += flen;
      all.push(rec);
    }
    return all;
  };

  var readDataPages = function (rectype, startPage, numPages) {
    var format = 'bib';
    var len = struct.structlen(format);
    var payload = new Uint8Array(len);
    struct.pack(payload, 0, format, rectype.value, startPage, numPages);

    var parser = null;
    if (rectype == RECORD_TYPES.EGV_DATA) {
      parser = makeHeaderParser(parse_egv_records);
    } else if (rectype == RECORD_TYPES.METER_DATA) {
      parser = makeHeaderParser(parse_meter_records);
    } else if (rectype == RECORD_TYPES.USER_SETTING_DATA) {
      parser = makeHeaderParser(parse_setting_records);
    }

    return {
      packet: buildPacket(CMDS.READ_DATA_PAGES.value, len, payload),
      parser: parser
    };
  };

  var readManufacturingDataPages = function (rectype, startPage, numPages) {
    var parser = function (result) {
      var format = 'iibbi21.';
      var hlen = struct.structlen(format);
      var xlen = result.payload.length - hlen;
      var allformat = format + xlen + 'z';
      var data = struct.unpack(result.payload, 0, allformat, [
        'index', 'nrecs', 'rectype', 'revision',
        'pagenum', 'xml'
      ]);
      data.mfgdata = parseXML(data.xml);
      return data;
    };

    var format = 'bib';
    var len = struct.structlen(format);
    var payload = new Uint8Array(len);
    struct.pack(payload, 0, format, rectype.value, startPage, numPages);

    return {
      packet: buildPacket(
        CMDS.READ_DATA_PAGES.value, len, payload
      ),
      parser: parser
    };
  };


  var readDataPageHeader = function () {
    return {
      packet: buildPacket(
        CMDS.READ_DATA_PAGE_HEADER.value, 0, null
      ),
      parser: null
    };
  };


  // accepts a stream of bytes and tries to find a dexcom packet
  // at the beginning of it.
  // returns a packet object; if valid == true it's a valid packet
  // if packet_len is nonzero, that much should be deleted from the stream
  // if valid is false and packet_len is nonzero, the previous packet
  // should be NAKed.
  var extractPacket = function (bytes) {
    var packet = {
      bytes: bytes,
      valid: false,
      packet_len: 0,
      command: 0,
      payload: null,
      crc: 0
    };

    if (bytes[0] != SYNC_BYTE) {
      return packet;
    }

    var plen = bytes.length;
    var packet_len = struct.extractShort(bytes, 1);
    // minimum packet len is 6
    if (packet_len > plen) {
      return packet;  // we're not done yet
    }

    // we now have enough length for a complete packet, so calc the CRC
    packet.packet_len = packet_len;
    packet.crc = struct.extractShort(bytes, packet_len - 2);
    var crc = crcCalculator.calcCRC_D(bytes, packet_len - 2);
    if (crc != packet.crc) {
      // if the crc is bad, we should discard the whole packet
      // (packet_len is nonzero)
      return packet;
    }

    // command is the fourth byte, packet is remainder of data
    packet.command = bytes[3];
    packet.payload = new Uint8Array(packet_len - 6);
    for (var i = 0; i < packet_len - 6; ++i) {
      packet.payload[i] = bytes[i + 4];
    }

    packet.valid = true;
    return packet;
  };


  // Takes an xml-formatted string and returns an object
  var parseXML = function (s) {
    debug(s);
    var result = {tag: '', attrs: {}};
    var tagpat = /<([A-Za-z]+)/;
    var m = s.match(tagpat);
    if (m) {
      result.tag = m[1];
    }
    var gattrpat = /([A-Za-z]+)=["']([^"']+)["']/g;
    var attrpat = /([A-Za-z]+)=["']([^"']+)["']/;
    m = s.match(gattrpat);
    for (var r in m) {
      var attr = m[r].match(attrpat);
      if (result.attrs[attr[1]]) {
        debug('Duplicated attribute!');
      }
      result.attrs[attr[1]] = attr[2];
    }
    return result;
  };


  var parseXMLPayload = function (packet) {
    if (!packet.valid) {
      return {};
    }
    if (packet.command !== 1) {
      return {};
    }

    var len = packet.packet_len - 6;
    var data = null;
    if (len) {
      data = parseXML(
        struct.extractString(packet.payload, 0, len));
    }
    return data;
  };

  // When you call this, it looks to see if a complete Dexcom packet has
  // arrived and it calls the callback with it and strips it from the buffer.
  // It returns true if a packet was found, and false if not.
  var dexcomPacketHandler = function (buffer) {
    // for efficiency reasons, we're not going to bother to ask the driver
    // to decode things that can't possibly be a packet
    // first, discard bytes that can't start a packet
    var discardCount = 0;
    while (buffer.len() > discardCount && buffer.get(0) != SYNC_BYTE) {
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

  // commandpacket is a bad name, and given that we only use the parser member from it
  // we should probably just take the parser as a parameter.
  var listenForPacket = function (timeout, commandpacket, callback) {
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
        if (pkt.command != CMDS.ACK.value) {
          callback('Bad result ' + pkt.command + ' (' +
                   getCmdName(pkt.command) + ') from data packet', pkt);
        } else {
          // only attempt to parse the payload if it worked
          if (pkt.payload) {
            pkt.parsed_payload = commandpacket.parser(pkt);
          }
          callback(null, pkt);
        }
      }
    }, 20);     // spin on this one quickly
  };

  var dexcomCommandResponse = function (commandpacket, callback) {
    // var p = new Uint8Array(commandpacket.packet);
    // debug(p);
    serialDevice.writeSerial(commandpacket.packet, function () {
      // once we've sent the command, start listening for a response
      // but if we don't get one in 1 second give up
      listenForPacket(1000, commandpacket, callback);
    });
  };

  var fetchOneDataPage = function (recordType, pagenum, callback) {
    var cmd = readDataPages(recordType, pagenum, 1);
    dexcomCommandResponse(cmd, function (err, page) {
      // debug(page.parsed_payload);
      callback(err, page);
    });
  };

  var fetchManufacturingData = function (pagenum, callback) {
    var cmd = readDataPageRange(RECORD_TYPES.MANUFACTURING_DATA);
    dexcomCommandResponse(cmd, function (err, page) {
      if (err) {
        callback(err, page);
      }
      debug('mfr range');
      var range = page.parsed_payload;
      debug(range);
      var cmd2 = readManufacturingDataPages(RECORD_TYPES.MANUFACTURING_DATA,
                                            range.lo, range.hi - range.lo + 1);
      dexcomCommandResponse(cmd2, function (err, result) {
        if (err) {
          callback(err, result);
        } else {
          callback(err, result.parsed_payload.mfgdata);
        }
      });
    });
  };

  var getFirmwareHeader = function (obj, cb) {
    debug('looking for dexcom');
    var cmd = readFirmwareHeader();
    dexcomCommandResponse(cmd, function (err, result) {
      if (err) {
        debug('Failure trying to talk to dexcom.');
        debug(err);
        debug(result);
        cb(null, null);
      } else {
        cb(null, obj);
      }
    });
  };

  var getPartitionInfo = function(obj, cb) {
    debug('getting database partition info');
    var cmd = readPartitionInfo();
    dexcomCommandResponse(cmd, function(err, result) {
      if (err) {
        debug('Failure trying to get database partition info.');
        debug(err);
        debug(result);
        cb(null, null);
      } else {
        cb(null, obj);
      }
    });
  };

  var downloadDataPages = function (recordType, progress, callback) {
    var cmd = readDataPageRange(recordType);
    dexcomCommandResponse(cmd, function (err, pagerange) {
      if (err) {
        return callback(err, pagerange);
      }
      debug('page range for', recordType.name);
      var range = pagerange.parsed_payload;
      debug(range);
      var pages = [];
      for (var pg = range.hi; pg >= range.lo; --pg) {
        pages.push(pg);
      }
      // pages = pages.slice(0, 3);      // FOR DEBUGGING!
      var npages = 0;
      var fetch_and_progress = function (data, callback) {
        progress(npages++ * 100.0 / pages.length);
        return fetchOneDataPage(recordType, data, callback);
      };
      async.mapSeries(pages, fetch_and_progress, function (err, results) {
        if (err) {
          debug('error in dexcomCommandResponse');
          debug(err);
        }
        debug(results);
        callback(err, results);
      });

    });
  };

  var downloadEGVPages = function (progress, callback) {
    downloadDataPages(RECORD_TYPES.EGV_DATA, progress, callback);
  };

  var downloadMeterPages = function (progress, callback) {
    downloadDataPages(RECORD_TYPES.METER_DATA, progress, callback);
  };

  var downloadSettingPages = function (progress, callback) {
    downloadDataPages(RECORD_TYPES.USER_SETTING_DATA, progress, callback);
  };

  var processEGVPages = function (pagedata) {
    var readings = [];
    for (var i = 0; i < pagedata.length; ++i) {
      var page = pagedata[i].parsed_payload;
      for (var j = 0; j < page.data.length; ++j) {
        var reading = _.pick(page.data[j],
                             'displaySeconds', 'displayDate', 'internalTime', 'systemSeconds',
                             'glucose', 'trendArrow', 'trendText', 'annotation');
        reading.pagenum = page.header.pagenum;
        readings.push(reading);
      }
    }
    return readings;
  };

  var processMeterPages = function (pagedata) {
    var readings = [];
    for (var i = 0; i < pagedata.length; ++i) {
      var page = pagedata[i].parsed_payload;
      for (var j = 0; j < page.data.length; ++j) {
        var reading = _.pick(page.data[j], 'displaySeconds', 'displayDate', 'internalTime',
                             'systemSeconds', 'meterValue');
        reading.pagenum = page.header.pagenum;
        readings.push(reading);
      }
    }
    return readings;
  };

  var processSettingPages = function (pagedata) {
    var settingRecords = [];
    for (var i = 0; i < pagedata.length; ++i) {
      var page = pagedata[i].parsed_payload;
      for (var j = 0; j < page.data.length; ++j) {
        var settings = _.omit(page.data[j], 'highAlarmSnooze', 'lowAlarmSnooze',
          'outOfRangeSnooze', 'language', 'enableFlags', 'reserved');
        settings.pagenum = page.header.pagenum;
        settingRecords.push(settings);
      }
    }
    console.log(_.sortBy(settingRecords, function(d) { return d.systemSeconds; }));
    var reshapedSettingsRecords = mungeUserSettings(settingRecords, {
      builder: cfg.builder,
      base_time: BASE_DATE_DEVICE
    });
    return reshapedSettingsRecords;
  };

  var getDeviceId = function (data) {
    var names = data.firmwareHeader.attrs.ProductName.split(' ');
    var shortname = _.map(names, function(name) { return name.slice(0,3); }).join('');
    return shortname + '_' + data.manufacturing_data.attrs.SerialNumber;
  };

  var prepCBGData = function (data) {
    var dataToPost = [];
    for (var i = 0; i < data.cbg_data.length; ++i) {
      var datum = data.cbg_data[i];
      var annotation = null;
      if (data.cbg_data[i].glucose < 40) {
        annotation = {
          code: 'bg/out-of-range',
          value: 'low',
          threshold: 40
        };
      } else if (data.cbg_data[i].glucose > 400) {
        annotation = {
          code: 'bg/out-of-range',
          value: 'high',
          threshold: 400
        };
      }
      var payload = { trend: datum.trendText, internalTime: datum.internalTime };
      var cbg = cfg.builder.makeCBG()
        .with_value(datum.glucose)
        .with_deviceTime(sundial.formatDeviceTime(datum.displayDate))
        .with_units('mg/dL')      // everything the Dexcom receiver stores is in this unit
        .set('index', datum.systemSeconds)
        .set('payload', payload);
      cfg.tzoUtil.fillInUTCInfo(cbg, datum.displayDate);
      cbg = cbg.done();
      delete cbg.index;
      if (annotation) {
        annotate.annotateEvent(cbg, annotation);
      }
      if (datum.annotation) {
        annotate.annotateEvent(cbg, datum.annotation);
        cbg._forceUpdate = true;
      }
      dataToPost.push(cbg);
    }

    return dataToPost;
  };

  var prepMeterData = function (data) {
    var dataToPost = [];
    for (var i = 0; i < data.calibration_data.length; ++i) {
      var datum = data.calibration_data[i];
      var cal = cfg.builder.makeDeviceEventCalibration()
        .with_value(datum.meterValue)
        .with_deviceTime(sundial.formatDeviceTime(datum.displayDate))
        .with_units('mg/dL')      // everything the Dexcom receiver stores is in this unit
        .set('index', datum.systemSeconds)
        .set('payload', {
          internalTime: datum.internalTime
        });
      cfg.tzoUtil.fillInUTCInfo(cal, datum.displayDate);
      cal = cal.done();
      delete cal.index;
      dataToPost.push(cal);
    }

    return dataToPost;
  };

  var prepSettingsData = function (data) {
    var dataToPost = [];
    for (var i = 0; i < data.setting_data.settingChanges.length; ++i) {
      var datum = data.setting_data.settingChanges[i];
      cfg.tzoUtil.fillInUTCInfo(datum, datum.jsDate);
      datum = datum.done();
      delete datum.index;
      delete datum.jsDate;
      dataToPost.push(datum);
    }

    return dataToPost;
  };

  function do_ping(cb) {
    var cmd = ping();
    dexcomCommandResponse(cmd, function (err, result) {
      if (err) {
        debug('Failure trying to talk to dexcom.');
        debug(err);
        debug(result);
        cb(null, null);
      } else {
        cb(null, null);
      }
    });
  }

  // this is the probe function passed to connect
  function probe(cb) {
    var cmd = ping();
    dexcomCommandResponse(cmd, function (err, result) {
      if (err) {
        debug('Failure trying to talk to dexcom.');
        debug(err);
        debug(result);
      }
      cb(err, result);
    });
  }


  return {
    //bypassing the detect function for now
    detect: function (obj, cb) {
      debug('Dexcom Detect!');
      cb(null, obj);
    },

    // this function starts the chain, so it has to create but not accept
    // the result (data) object; it's then passed down the rest of the chain
    setup: function (deviceInfo, progress, cb) {
      debug('STEP: setup');
      progress(100);
      cb(null, {deviceInfo: deviceInfo});
    },

    connect: function (progress, data, cb) {
      debug('STEP: connect');
      cfg.deviceComms.connect(data.deviceInfo, dexcomPacketHandler, probe, function(err) {
        if (err) {
          return cb(err);
        }
        getFirmwareHeader(true, function(firmwareErr, obj) {
          if (firmwareErr) {
            cb(firmwareErr, obj);
          } else {
            getPartitionInfo(true, function(partErr, obj) {
              if (partErr) {
                cb(partErr, obj);
              } else {
                do_ping(function (err, result) {
                  // we're talking so tell the serial device to record this port
                  cfg.deviceComms.recordPort(data.deviceInfo.driverId);
                  progress(100);
                  data.connect = true;
                  data.firmwareHeader = firmwareHeader;
                  data.partitionInfo = partitionInfo;
                  data.model = firmwareHeader.attrs.ProductId;
                  cb(null, data);
                });
              }
            });
          }
        });
      });
    },

    getConfigInfo: function (progress, data, cb) {
      debug('STEP: getConfigInfo');
      fetchManufacturingData(0, function (err, result) {
        data.manufacturing_data = result;
        data.serialNumber = result.attrs.SerialNumber;
        dexcomDeviceId = getDeviceId(data);
        cfg.builder.setDefaults({ deviceId: dexcomDeviceId });
        data.id = dexcomDeviceId;
        progress(100);
        data.getConfigInfo = true;
        cb(null, data);
      });
    },

    fetchData: function (progress, data, cb) {
      // a little helper to split up our progress bar segment
      var makeProgress = function (progfunc, start, end) {
        return function(x) {
          progfunc(start + (x/100.0)*(end-start));
        };
      };

      debug('STEP: fetchData');
      progress(0);
      // first half of the progress bar segment
      downloadEGVPages(makeProgress(progress, 0, 50), function (err, result) {
        data.egv_data = result;
        if (err == null) {
          // second half of the progress bar segment
          downloadMeterPages(makeProgress(progress, 50, 75), function (err, result) {
            data.meter_data = result;
            if (err == null) {
              downloadSettingPages(makeProgress(progress, 75, 100), function(err, result) {
                data.user_setting_data = result;
                progress(100);
                cb(err, data);
              });
            }
          });
        } else {
          progress(100);
          cb(err, data);
        }
      });
    },

    processData: function (progress, data, cb) {
      debug('STEP: processData');
      progress(0);
      data.setting_data = processSettingPages(data.user_setting_data);
      data.cbg_data = processEGVPages(data.egv_data);
      data.calibration_data = processMeterPages(data.meter_data);
      var non_setting_data = data.cbg_data.concat(data.calibration_data);
      var sorted = _.sortBy(non_setting_data, function(d) { return d.systemSeconds; });
      var mostRecent = sundial.applyTimezone(sorted[sorted.length - 1].displayDate, cfg.timezone).toISOString();
      debug('Most recent datum at', mostRecent);
      var tzoUtil = new TZOUtil(cfg.timezone, mostRecent, data.setting_data.timeChanges);
      cfg.tzoUtil = tzoUtil;
      data.post_records = cfg.tzoUtil.records;
      data.post_records = data.post_records.concat(prepCBGData(data));
      data.post_records = data.post_records.concat(prepMeterData(data));
      data.post_records = data.post_records.concat(prepSettingsData(data));
      progress(100);
      data.processData = true;
      cb(null, data);
    },

    uploadData: function (progress, data, cb) {
      debug('STEP: uploadData');
      progress(0);
      var sessionInfo = {
        deviceTags: ['cgm'],
        deviceManufacturers: ['Dexcom'],
        deviceModel: data.model,
        deviceSerialNumber: data.serialNumber,
        deviceId: dexcomDeviceId,
        start: sundial.utcDateString(),
        timeProcessing: cfg.tzoUtil.type,
        tzName : cfg.timezone,
        version: cfg.version
      };

      cfg.api.upload.toPlatform(
        data.post_records,
        sessionInfo,
        progress,
        cfg.groupId,
        function (err, result) {
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
      debug('STEP: disconnect');
      progress(100);
      data.disconnect = true;
      cb(null, data);
  },

    cleanup: function (progress, data, cb) {
      debug('STEP: cleanup');
      cfg.deviceComms.clearPacketHandler();
      cfg.deviceComms.disconnect(function() {
        progress(100);
        data.cleanup = true;
        cb(null, data);
      });
    }
  };
};
