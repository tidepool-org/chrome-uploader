/*
 * == BSD2 LICENSE ==
 * Copyright (c) 2014-2015, Tidepool Project
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

var async = require('async');
var _ = require('lodash');
var struct = require('../../struct.js')();
var sundial = require('sundial');
var api = require('../../core/api.js');

var tandemSimulatorMaker = require('../tandem/tandemSimulator');

var TZOUtil = require('../../TimezoneOffsetUtil');
var annotate = require('../../eventAnnotations');
var debug = require('bows')('TandemDriver');
var debugMode = require('../../../app/utils/debugMode');
var common = require('../../commonFunctions');
var uploadDataPeriod = require('../../../app/utils/uploadDataPeriod');
var rollbar = require('../../../app/utils/rollbar');

module.exports = function (config) {
  var cfg = config;
  _.assign(cfg.deviceInfo, {
    tags: ['insulin-pump'],
    manufacturers: ['Tandem'],
  });

  var SYNC_BYTE = 0x55;

  var getFlagNames = function (list, v) {
    var flags = [];
    for (var i in list) {
      if (list[i].value & v) {
        flags.push(list[i].name);
      }
    }
    return flags;
  };

  var BASAL_CHANGE_TYPE_FLAGS = [
    {value: 0x01, name: 'timed_segment'},
    {value: 0x02, name: 'new_profile'},
    {value: 0x04, name: 'temp_rate_start'},
    {value: 0x08, name: 'temp_rate_end'},
    {value: 0x10, name: 'pump_suspended'},
    {value: 0x20, name: 'pump_resumed'},
    {value: 0x40, name: 'pump_shut_down'}
  ];

  var RESPONSES = {
    VERSION_TE: {
      value: 81,
      name: 'Version Message',
      version: 36102,
      format: '16Z16Z20.ii8Zi....8Z50.iI',
      fields: ['arm_sw_ver', 'msp_sw_ver', 'pump_sn', 'pump_part_no', 'pump_rev', 'pcba_sn', 'pcba_rev', 'model_no', 'timestamp']
    },
    COMMAND_ACK: {
      value: 123,
      name: 'Command Acknowledge',
      version: 36102,
      format: 'bb',
      fields: ['msg_id', 'success']
    },
    LOG_ENTRY_TE: {
      value: 125,
      name: 'Event History Log Entry',
      version: 36102,
      format: 'i2.hiii16B',
      fields: ['index', 'header_id', 'header_ts', 'header_log_seq_no', 'header_spare', 'tdeps'],
      postprocess: function (rec) {
        addTimestamp(rec, rec.header_ts);
        var recordType = getLogRecordById(rec.header_id);
        if (recordType != null) {
          _.assign(rec, struct.unpack(rec.tdeps, 0, recordType.format, recordType.fields));
          rec.name = getLogRecordName(rec.header_id); // for debugging
          if (recordType.postprocess) {
            recordType.postprocess(rec);
          }
          delete rec.tdeps;
        }
      }
    },
    LOG_SIZE_TE: {
      value: 169,
      name: 'Event History Log Size Response',
      version: 36102,
      format: 'iii',
      fields: ['entries', 'start_seq', 'end_seq']
    },
    IDP_LIST_TE: {
      value: 174, name: 'Personal Profile List Message', version: 36102, format: 'b6b',
      fields: ['num_available',
        'slot1', /* active */  'slot2', 'slot3', 'slot4', 'slot5', 'slot6']
    },
    // tricky. contains packed structures and fixed-length
    // zero-terminated strings. be sure to test extensively.
    IDP_TE: {
      value: 176, name: 'Personal Profile Message', version: 36102, format: 'b17zb208Bhhbb',
      fields: ['idp', 'name', 'tdep_num', 'tdeps', 'insulin_duration', 'max_bolus', 'carb_entry', 'status'],
      postprocess: function (rec) {
        rec.insulin_duration = rec.insulin_duration;
        rec.max_bolus = rec.max_bolus * 0.001;

        var tdeps = [];
        var tdep_size = struct.structlen(IDP_TDEP.format);
        for (var i = 0; i < rec.tdep_num; i++) {
          tdeps.push(IDP_TDEP.postprocess(struct.unpack(rec.tdeps, i * tdep_size, IDP_TDEP.format, IDP_TDEP.fields)));
        }
        rec.tdeps = tdeps;
      }
    },
    // GLOBALS_TE is unknown endianness on half-words
    GLOBALS_TE: {
      value: 179, name: 'Globals Report Message', version: 36102, format: 'bhhbbbbbbbb',
      fields: [
        'quickbolus_active', // 0=off, 1=active
        'quickbolus_units', // 0.001u
        'quickbolus_carbs',  // 0.001 g
        'quickbolus_iscarbs', // 0=insulin, 1=carbs
        'quickbolus_status', // bit 0,1,2,3 for active, carbs, units, entry_type, respectively
        'button_annun',
        'quickbolus_annun',
        'bolus_annun',
        'reminder_annun',
        'alert_annun',
        'alarm_annun'
      ],
      postprocess: function (rec) {
        rec.quickbolus_units = rec.quickbolus_units * 0.001;
        rec.quickbolus_carbs = rec.quickbolus_carbs * 0.001;
        rec.quickbolus_type = rec.quickbolus_iscarbs ? 'carbs' : 'units';
      }
    },
    PUMP_SETTINGS_TE: {
      value: 182,
      name: 'Pump Settings Report Message',
      version: 36102,
      format: 'bbbh..hhb.b.11..h',
      fields: ['low_insulin_threshold', 'cannula_prime_size', 'auto_shutdown_en', 'auto_shutdown_hours', 'recent_bolus_no', 'recent_temp_rate_no', 'is_pump_locked', 'oled_timeout', 'status'],
      postprocess: function (rec) {
        rec.cannula_prime_size = rec.cannula_prime_size * 0.01; // hundredths, not thousandths intentionally
        rec.auto_shutdown_duration = rec.auto_shutdown_duration * sundial.MIN_TO_MSEC * 60;
        rec.oled_timeout = rec.oled_timeout * sundial.SEC_TO_MSEC;
        if ((status & 0x01) === 0) {
          delete rec.low_insulin_threshold;
        }
        if ((status & 0x02) === 0) {
          delete rec.auto_shutdown_enabled;
        }
        if ((status & 0x04) === 0) {
          delete rec.auto_shutdown_duration;
        }
        if ((status & 0x08) === 0) {
          delete rec.cannula_prime_size;
        }
        if ((status & 0x10) === 0) {
          delete rec.is_pump_locked;
        }
        if ((status & 0x20) === 0) {
          delete rec.oled_timeout;
        }
      }
    },
    REMIND_SETTINGS_TE: {
      value: 185,
      name: 'Reminder Settings Report',
      version: 36102,
      format: '99Zhhbb',
      fields: ['reminders', 'low_bg_threshold', 'high_bg_threshold', 'site_change_days', 'status']
    }
  };

  var COMMANDS = {
    VERSION_REQ: {
      value: 82,
      name: 'Version Request',
      version: 36102,
      response: RESPONSES.VERSION_TE
    },
    LOG_ENTRY_SEQ_REQ: {
      value: 151,
      name: 'Event History Log Request By Sequence',
      version: 36102,
      format: 'i',
      fields: ['seqNum'],
      response: RESPONSES.LOG_ENTRY_TE
    },
    LOG_ENTRY_SEQ_MULTI_REQ: {
      value: 152,
      name: 'Multiple Event History Log Request by Sequence',
      version: 59814,
      format: 'ii',
      fields: ['seqNum', 'count']
    },
    LOG_ENTRY_SEQ_MULTI_STOP_DUMP: {
      value: 153,
      name: 'Stops Multiple Event History Log Download',
      version: 47144
    },
    LOG_SIZE_REQ: {
      value: 168,
      name: 'Event History Log Size Request',
      version: 36102,
      response: RESPONSES.LOG_SIZE_TE
    },
    IDP_LIST_REQ: {
      value: 173,
      name: 'Personal Profile List Request',
      version: 36102,
      response: RESPONSES.IDP_LIST_TE
    },
    IDP_REQ: {
      value: 175,
      name: 'Personal Profile Request',
      version: 36102,
      format: 'b',
      fields: ['idp'],
      response: RESPONSES.IDP_TE
    },
    GLOBALS_REQ: {
      value: 178,
      name: 'Global Data Request',
      version: 36102,
      response: RESPONSES.GLOBALS_TE
    },
    PUMP_SETTINGS_REQ: {
      value: 181,
      name: 'Pump Settings Request',
      version: 36102,
      response: RESPONSES.PUMP_SETTINGS_TE
    },
    REMIND_SETTINGS_REQ: {
      value: 184,
      name: 'Reminder Settings Request',
      version: 36102,
      response: RESPONSES.REMIND_SETTINGS_TE
    }
  };

  var ALERT_ANNUN = {
    0: 'ANNUN_AUDIO_HIGH',
    1: 'ANNUN_AUDIO_MED',
    2: 'ANNUN_AUDIO_LOW',
    3: 'ANNUN_VIBE'
  };

  var PUMP_LOG_RECORDS = {
    LID_BASAL_RATE_CHANGE: {
      value: 0x03,
      name: 'Basal Rate Change Event',
      format: 'fffhb.',
      fields: ['command_basal_rate', 'base_basal_rate', 'max_basal_rate', 'idp', 'change_type'],
      postprocess: function (rec) {
        rec.change_types = getFlagNames(BASAL_CHANGE_TYPE_FLAGS, rec.change_type);
        rec.command_basal_rate = rec.command_basal_rate.toFixedNumber(SIGNIFICANT_DIGITS);
        rec.base_basal_rate = rec.base_basal_rate.toFixedNumber(SIGNIFICANT_DIGITS);
      }
    },
    LID_BG_READING_TAKEN: {
      value: 0x10,
      name: 'BG Taken Event',
      format: 'h.bfhh....',
      fields: ['bg', 'bg_source', 'iob', 'target_bg', 'isf']
    },
    LID_BOLEX_ACTIVATED: {
      value: 0x3B,
      name: 'Extended Bolus Activated Event',
      format: 'h..ff....',
      fields: ['bolus_id', 'iob', 'bolex_size'],
      postprocess: function (rec) {
        rec.bolex_size = rec.bolex_size.toFixedNumber(SIGNIFICANT_DIGITS);
        rec.iob = rec.iob.toFixedNumber(SIGNIFICANT_DIGITS);
      }
    },
    LID_BOLEX_COMPLETED: {
      value: 0x15,
      name: 'Extended Portion of a Bolus Complete Event',
      format: '..hfff',
      fields: ['bolus_id', 'iob', 'bolex_insulin_delivered', 'bolex_insulin_requested'],
      postprocess: function (rec) {
        rec.bolex_insulin_delivered = rec.bolex_insulin_delivered.toFixedNumber(SIGNIFICANT_DIGITS);
        rec.bolex_insulin_requested = rec.bolex_insulin_requested.toFixedNumber(SIGNIFICANT_DIGITS);
        rec.iob = rec.iob.toFixedNumber(SIGNIFICANT_DIGITS);
      }
    },
    LID_BOLUS_ACTIVATED: {
      value: 0x37,
      name: 'Bolus Activated Event',
      format: 'h..ff....',
      fields: ['bolus_id', 'iob', 'bolus_size'],
      postprocess: function (rec) {
        rec.bolus_size = rec.bolus_size.toFixedNumber(SIGNIFICANT_DIGITS);
        rec.iob = rec.iob.toFixedNumber(SIGNIFICANT_DIGITS);
      }
    },
    LID_BOLUS_COMPLETED: {
      value: 0x14,
      name: 'Bolus Completed Event',
      format: '..hfff',
      fields: ['bolus_id', 'iob', 'insulin_delivered', 'insulin_requested'],
      postprocess: function (rec) {
        rec.insulin_delivered = rec.insulin_delivered.toFixedNumber(SIGNIFICANT_DIGITS);
        rec.insulin_requested = rec.insulin_requested.toFixedNumber(SIGNIFICANT_DIGITS);
        rec.iob = rec.iob.toFixedNumber(SIGNIFICANT_DIGITS);
      }
    },
    LID_BOLUS_REQUESTED_MSG1: {
      value: 0x40,
      name: 'Bolus Requested Event 1 of 3',
      format: 'hbbhhfi',
      fields: ['bolus_id', 'bolus_type', 'correction_bolus_included', 'carb_amount', 'bg', 'iob', 'carb_ratio'],
      postprocess: function (rec) {
        if (rec.bolus_type === 0) {
          rec.bolus_type_str = 'insulin';
        }
        else if (rec.bolus_type === 1) {
          rec.bolus_type_str = 'carb';
        }
        rec.carb_ratio = (rec.carb_ratio * 0.001).toFixedNumber(SIGNIFICANT_DIGITS);
        rec.iob = rec.iob.toFixedNumber(SIGNIFICANT_DIGITS);
      }
    },
    LID_BOLUS_REQUESTED_MSG2: {
      value: 0x41,
      name: 'Bolus Requested Event 2 of 3',
      format: 'hbbh..hhbb..',
      fields: ['bolus_id', 'options', 'standard_percent', 'duration', 'isf', 'target_bg', 'user_override', 'declined_correction'],
      postprocess: function (rec) {
        if (rec.options === 0) {
          rec.bolus_option = 'standard';
        }
        else if (rec.options === 1) {
          rec.bolus_option = 'extended';
        }
        else if (rec.options === 2) {
          rec.bolus_option = 'quickbolus';
        }
        rec.duration = rec.duration * sundial.MIN_TO_MSEC;
      }
    },
    LID_BOLUS_REQUESTED_MSG3: {
      value: 0x42,
      name: 'Bolus Requested Event 3 of 3',
      format: 'h..fff',
      fields: ['bolus_id', 'food_bolus_size', 'correction_bolus_size', 'total_bolus_size'],
      postprocess: function (rec) {
        rec.food_bolus_size = rec.food_bolus_size.toFixedNumber(SIGNIFICANT_DIGITS);
        rec.correction_bolus_size = rec.correction_bolus_size.toFixedNumber(SIGNIFICANT_DIGITS);
        rec.total_bolus_size = rec.total_bolus_size.toFixedNumber(SIGNIFICANT_DIGITS);
      }
    },
    LID_CANNULA_FILLED: {
      value: 0x3D,
      name: 'Cannula Filled Event',
      format: 'f............',
      fields: ['prime_size'],
      postprocess: function (rec) {
        rec.prime_size = rec.prime_size.toFixedNumber(SIGNIFICANT_DIGITS);
      }
    },
    LID_CARB_ENTERED: {
      value: 0x30,
      name: 'Carbs Entered Event',
      format: 'f............',
      fields: ['carbs']
    },
    LID_CARTRIDGE_FILLED: {
      value: 0x21,
      name: 'Cartridge Filled Event',
      format: 'if........',
      fields: ['insulin_display', 'insulin_actual'],
      postprocess: function (rec) {
        rec.insulin_actual = rec.insulin_actual.toFixedNumber(SIGNIFICANT_DIGITS);
      }
    },
    LID_CORRECTION_DECLINED: {
      value: 0x5D,
      name: 'Correction Declined Event',
      format: 'hhfhh........',
      fields: ['bg', 'bolus_id', 'iob', 'target_bg', 'isf']
    },
    LID_DAILY_BASAL: {
      value: 0x51,
      name: 'Daily Basal Event',
      format: 'fff.bh',
      fields: ['daily_total_basal', 'last_basal_rate', 'iob', 'actual_battery_charge', 'lipo_mv']
    },
    LID_DATA_LOG_CORRUPTION: {
      value: 0x3C,
      name: 'Data Log Corruption Event',
      format: '................',
      fields: []
    },
    LID_DATE_CHANGED: {
      value: 0x0E,
      name: 'Date Change Event',
      format: 'ii........',
      fields: ['date_prior', 'date_after']
    },
    LID_FACTORY_RESET: {
      value: 0x52,
      name: 'Factory Reset Event',
      format: '.............',
      fields: []
    },
    LID_IDP: {
      value: 0x45,
      name: 'Personal Profile Add/Delete Event 1 of 2',
      format: 'bbb.....8Z',
      fields: ['idp', 'status', 'source_idp', 'name_start'],
      postprocess: function (rec) {
        switch (rec.status) {
          case 0:
            rec.operation = 'new';
            break;
          case 1:
            rec.operation = 'copy';
            break;
          case 2:
            rec.operation = 'delete';
            break;
          case 3:
            rec.operation = 'activate';
            break;
          case 4:
            rec.operation = 'rename';
            break;
          default:
            debug('unhandled operation in profile event', rec);
            rec.operation = 'unknown';
        }
      }
    },
    LID_IDP_BOLUS: {
      value: 0x46,
      name: 'Personal Profile Bolus Data Change Event',
      format: 'bbb.hhb.......',
      fields: ['idp', 'modification', 'bolus_status', 'insulin_duration', 'max_bolus_size', 'bolus_entry_type'],
      postprocess: function (rec) {
        rec.insulin_duration = rec.insulin_duration;
        rec.max_bolus_size = (rec.max_bolus_size * 0.001).toFixedNumber(SIGNIFICANT_DIGITS);
      }
    },
    LID_IDP_LIST: {
      value: 0x47,
      name: 'Personal Profile List Event',
      format: 'b...bbbbbb......',
      fields: ['num_profiles', 'slot1', 'slot2', 'slot3', 'slot4', 'slot5', 'slot6']
    },
    LID_IDP_MSG2: {
      value: 0x39,
      name: 'Personal Profile Add/Delete Event 2 of 2',
      format: 'b.......8Z',
      fields: ['idp', 'name_end']
    },
    LID_IDP_TD_SEG: {
      value: 0x44,
      name: 'Personal Profile Time Dependent Segment Event',
      format: 'bbbbhhhhi1',
      fields: ['idp', 'status', 'segment_index', 'modification_type', 'start_time', 'basal_rate', 'isf', 'target_bg', 'carb_ratio'],
      postprocess: function (rec) {
        rec.start_time = rec.start_time * sundial.MIN_TO_MSEC;
        rec.basal_rate = (rec.basal_rate * 0.001).toFixedNumber(SIGNIFICANT_DIGITS);
        rec.carb_ratio = (rec.carb_ratio * 0.001).toFixedNumber(SIGNIFICANT_DIGITS);
      }
    },
    LID_LOG_ERASED: {
      value: 0x00,
      name: 'Log Erased Event',
      format: 'i............',
      fields: ['num_erased']
    },
    LID_NEW_DAY: {
      value: 0x5A,
      name: 'New Day Event',
      format: 'f............',
      fields: ['commanded_basal_rate']
    },
    LID_PARAM_GLOBAL_SETTINGS: {
      value: 0x4A,
      name: 'Global Settings Change Event',
      format: 'bbbbhhbbbbbb..',
      fields: ['modified_data', 'qb_data_status', 'qb_active', 'qb_data_entry_type', 'qb_increment_units', 'qb_increment_carbs', 'button_volume', 'qb_volume', 'bolus_volume', 'reminder_volume', 'alert_volume'],
      postprocess: function (rec) {
        rec.qb_increment_units = rec.qb_increment_units * 0.001;
        rec.qb_increment_carbs = rec.qb_increment_carbs * 0.001;
      }
    },
    LID_PARAM_PUMP_SETTINGS: {
      value: 0x49,
      name: 'Pump Parameter Change Event',
      format: 'b.hbbbb.bh....',
      fields: ['modification', 'status', 'low_insulin_threshold', 'cannula_prime_size', 'is_feature_locked', 'auto_shutdown_enabled', 'oled_timeout', 'auto_shutdown_duration'],
      postprocess: function (rec) {
        rec.cannula_prime_size = rec.cannula_prime_size * 0.01;
        rec.oled_timeout = rec.oled_timeout * sundial.SEC_TO_MSEC;
        rec.auto_shutdown_duration = rec.auto_shutdown_duration * sundial.MIN_TO_MSEC * 60;
      }
    },
    LID_PARAM_REM_SETTINGS: {
      value: 0x61,
      name: 'Reminder Parameter Change Event',
      format: 'bb..hhb.......',
      fields: ['modification', 'status', 'low_bg_threshold', 'high_bg_threshold', 'site_change_days']
    },
    LID_PARAM_REMINDER: {
      value: 0x60,
      name: 'Reminder Time Based Parameter Change Event',
      format: 'bbbbihhb...',
      fields: ['modification', 'reminder_id', 'status', 'enable', 'frequency_minutes', 'start_time', 'end_time', 'active_days']
    },
    LID_PUMPING_RESUMED: {
      value: 0x0C,
      name: 'Pumping Resumed Event',
      format: '....h..........',
      fields: ['insulin_amount']
    },
    LID_PUMPING_SUSPENDED: {
      value: 0x0B,
      name: 'Pumping Suspended Event',
      format: '....hb.........',
      fields: ['insulin_amount', 'reason']
    },
    LID_TEMP_RATE_ACTIVATED: {
      value: 0x02,
      name: 'Temporary Basal Rate Activated Event',
      format: 'ff..h....',
      fields: ['percent', 'duration', 'temp_rate_id'],
      postprocess: function (rec) {
        rec.percent = rec.percent / 100;
      }
    },
    LID_TEMP_RATE_COMPLETED: {
      value: 0x0F,
      name: 'Temporary Basal Rate Completed Event',
      format: '..hi........',
      fields: ['temp_rate_id', 'time_left']
    },
    LID_TIME_CHANGED: {
      value: 0x0D,
      name: 'Time Change Event',
      format: 'ii........',
      fields: ['time_prior', 'time_after']
    },
    LID_TUBING_FILLED: {
      value: 0x3F,
      name: 'Tubing Filled Event',
      format: 'f............',
      fields: ['prime_size'],
      postprocess: function (rec) {
        rec.prime_size = rec.prime_size.toFixedNumber(SIGNIFICANT_DIGITS);
      }
    },
    LID_USB_CONNECTED: {
      value: 0x24,
      name: 'USB Connected Event',
      format: 'f............',
      fields: ['negotiated_current_mA']
    },
    LID_USB_DISCONNECTED: {
      value: 0x25,
      name: 'USB Disconnected Event',
      format: 'f............',
      fields: ['negotiated_current_mA']
    },
    LID_USB_ENUMERATED: {
      value: 0x43,
      name: 'USB Enumerated Event',
      format: 'f............',
      fields: ['negotiated_current_mA']
    },
    LID_ALARM_ACTIVATED: {
      value: 0x05,
      name: 'Alarm Activated Event',
      format: 'i............',
      fields: ['alarm_id']
    },
    LID_ALERT_ACTIVATED: {
      value: 0x04,
      name: 'Alert Activated Event',
      format: 'i............',
      fields: ['alert_id']
    },
    LID_CGM_DATA: {
      value: 0x97,
      name: 'CGM Data Sample',
      format: 'h........h....',
      fields: ['status','value']
    },
    LID_CGM_CALIBRATION: {
      value: 0xA0,
      name: 'CGM Calibration',
      format: 'iiihh',
      fields: ['current_time','timestamp','cal_timestamp','value', 'current_display_value']
    },
    LID_CGM_DATA_GX: {
      value: 0xD3,
      name: 'CGM GX Data Sample',
      format: 'sby.ysii',
      fields: ['status','type','rate','rssi','value','timestamp', 'transmitter_timestamp']
    },
    LID_CGM_CALIBRATION_GX: {
      value: 0xD2,
      name: 'CGM Calibration GX',
      format: 's..............',
      fields: ['value']
    },
    // ARM SW v83132 and above uses LID_CGM_DATA_GXB instead of LID_CGM_DATA
    LID_CGM_DATA_GXB: {
      value: 0x100,
      name: 'CGM GXB Data Sample',
      format: 'sby.ysi....',
      fields: ['status','type','rate','rssi','value','timestamp']
    },
    LID_HYPO_MINIMIZER_SUSPEND: {
      value: 0xC6,
      name: 'Hypo Minimizer Suspend',
      format: '................',
      fields: []
    },
    LID_HYPO_MINIMIZER_RESUME: {
      value: 0xC7,
      name: 'Hypo Minimizer Resume',
      format: 'i............',
      fields: ['reason']
    }
  };

  var ALARM_TYPES = {
    ALARM_OCCLUSION: { value: 2, name: 'Occlusion detected'},
    ALARM_AUTO_OFF: { value: 7, name: 'Auto Off'},
    ALARM_OUT_OF_LIQUID: { value: 8, name: 'Out of Liquid'},
    ALARM_TEMPERATURE_OUT_OF_RANGE: { value: 10, name: 'Temperature Out of Range'},
    ALARM_EXTREMELY_LOW_LIPO: { value: 12, name: 'Extremely low LiPo percent charge'},
    ALARM_STUCK_WAKE_BUTTON: { value: 22, name: 'Stuck Wake Button'},
    ALARM_PRESSURE_OUT_OF_RANGE: { value: 24, name: 'Atmosphere Pressure Out of Range'},
    ALARM_CARTRIDGE_REMOVED: { value: 25, name: 'Cartridge Removed'},
    ALARM_SECOND_OCCLUSION: { value: 26, name: 'Second Occlusion detected in a row'}
  };

  var ALERT_TYPES = {
    ALERT_LOW_INSULIN: { value: 0, name: 'Low Insulin level'},
    ALERT_LOW_LIPO_CHARGE: { value: 2, name: 'Low LiPo percent charge'},
    ALERT_VERY_LOW_LIPO_CHARGE: { value: 3, name: 'Very Low LiPo percent charge'},
    ALERT_VERY_LOW_INSULIN: { value: 17, name: 'Very Low Insulin Level'}
  };

  var CGM_STATUS = {
    CGM_NORMAL: { value: 0, name: 'Glucose Value'},
    CGM_HI: { value: 1, name: 'HI glucose reading'},
    CGM_LO: { value: 2, name: 'LO glucose reading'},
    CGM_CALIBRATION: { value: 3, name: 'Glucose Value in response to calibration'},
    CGM_HI_CALIBRATION: { value: 4, name: 'HI glucose reading in response to calibration'},
    CGM_LO_CALIBRATION: { value: 5, name: 'LO glucose reading in response to calibration'}
  };

  var CGM_GX_TYPE = {
    NOT_SET : { value: 0, name: 'EGV type not set'},
    FMR : { value: 1, name: 'Five Minute Reading (FMR)'},
    CALIBRATION: { value: 2, name: 'Calibration'},
    BACKFILL: { value: 3, name: 'Backfill'}
  };

  var CGM_GXB_TYPE = {
    FMR : { value: 1, name: 'Five Minute Reading (FMR)'},
    BACKFILL : { value: 2, name: 'Backfill'},
    IMV: { value: 4, name: 'Immediate Match Value'},
    CALIBRATION: { value: 8, name: 'Calibration'},
    NONE: {value: 16, name: 'None'}
  };

  var SUSPEND_REASON = {
    USER_ABORTED : { value: 0, name: 'User aborted'},
    ALARM : { value: 1, name: 'Terminated by alarm'},
    MALFUNCTION : { value: 2, name: 'Terminated due to malfunction'},
    PLGS : { value: 6, name: 'Auto suspend by PLGS'}
  };

  var RESUME_REASON = {
    MAX_SUSPEND : { value: 1, name:  'Resume due to Maximum Suspend Time Reached'},
    USER_OVERRIDE: { value: 2, name: 'Resume due to Suspend-Override by the user'}
  };

  var BG_READING_SOURCE = {
    MANUAL_ENTRY : { value: 0, name: 'Manual entry by the user'},
    AUTO_POPULATED : { value: 1, name: 'Auto populated BG using CGM'}
  };

  var IDP_TDEP = {
    name: 'Time Dependent Settings Segment Structure',
    format: 'hhihhb',
    fields: ['startTime', 'basalRate', 'carbRatio', 'TargetBG', 'ISF', 'status'],
    postprocess: function (rec) {
      rec.startTime = rec.startTime * sundial.MIN_TO_MSEC;
      rec.basalRate = (rec.basalRate * 0.001).toFixedNumber(SIGNIFICANT_DIGITS);
      rec.carbRatio = (rec.carbRatio * 0.001).toFixedNumber(SIGNIFICANT_DIGITS);
      return rec;
    }
  };

  // Tandem represents values with false precision (https://en.wikipedia.org/wiki/False_precision),
  // so we have to specify the number of significant digits
  var SIGNIFICANT_DIGITS = 5;
  Number.prototype.toFixedNumber = function(significant){
    var pow = Math.pow(10,significant);
    return +( Math.round(this*pow) / pow );
  };

  var pending = false;    //if serial send is pending, we have to wait before we send again
  var INTERVAL_FREQ = 10;  // time between sending serial packets
  var SEND_WAIT = 800; // time to wait when serial send is pending
  var RETRY_TIMEOUT = 1000; // time to wait before retrying to send packet
  var MAX_TRIES = 5;

  var BASE_TIME = Date.UTC(2008, 0, 1, 0, 0, 0).valueOf(); /* new Date(2008, 0, 1, 0, 0, 0).valueOf(); */
  var addTimestamp = function (o, rawTime) {
    o.rawTimestamp = BASE_TIME + rawTime * sundial.SEC_TO_MSEC;
    var dt = new Date(o.rawTimestamp); // rawTimeStamp is "UTC" unix time
    o.jsDate = dt;
    o.deviceTime = sundial.formatDeviceTime(dt);
  };
  var uploadTime = {};

  // This is a particularly weak checksum algorithm but that's what Insulet and Tandem use...
  var weakChecksum = function (bytes, offset, count) {
    var total = 0;
    for (var i = 0; i < count; ++i) {
      total += bytes[i + offset];
    }
    return total & 0xFFFF;
  };

  var _getName = function (list, idx) {
    for (var i in list) {
      if (list[i].value === idx) {
        return list[i].name;
      }
    }
    return 'UNKNOWN!';
  };

  var _getItem = function (list, idx) {
    for (var i in list) {
      if (list[i].value === idx) {
        return list[i];
      }
    }
    return null;
  };

  var getCommandName = function (idx) {
    return _getName(COMMANDS, idx);
  };

  var getResponseName = function (idx) {
    return _getName(RESPONSES, idx);
  };

  var getResponseById = function (idx) {
    return _getItem(RESPONSES, idx);
  };

  var getLogRecordName = function (idx) {
    return _getName(PUMP_LOG_RECORDS, idx);
  };

  var getAlarmName = function (idx,types) {
    return _getName(types, idx);
  };

  var getSuspendReason = function (idx) {
    return _getName(SUSPEND_REASON, idx);
  };

  var getResumeReason = function (idx) {
    return _getName(RESUME_REASON, idx);
  };

  var getLogRecordById = function (idx) {
    return _getItem(PUMP_LOG_RECORDS, idx);
  };

  // builds a command in an ArrayBuffer
  // the first byte is always 0x55 (SYNC),
  // the second byte is the command descriptor,
  // the third and fourth bytes are a little-endian payload length.
  // then comes the payload,
  // finally, it's followed with a 2-byte little-endian CRC of all the bytes
  // up to that point.
  // payload is any indexable array-like object that returns Numbers

  var buildPacket = function (descriptor, payloadLength, payload) {
    var buf = new ArrayBuffer(payloadLength + 9);
    var bytes = new Uint8Array(buf);
    var ctr = struct.pack(
      bytes,
      0,
      'bbb',
      SYNC_BYTE,
      descriptor.value,
      payloadLength
      );
    ctr += struct.copyBytes(bytes, ctr, payload, payloadLength);
    var checksum = weakChecksum(bytes, 1, ctr - 1);
    struct.pack(bytes, ctr, 'IS', 0, checksum); // the checksum is big-endian and timestamp always 0
    return buf;
  };

  // accepts a stream of bytes and tries to find a Tandem packet
  // at the beginning of it. in no case should there be fewer than 9 bytes
  // in the bytestream.
  // returns a packet object; if valid === true it's a valid packet
  // if packet_len is nonzero, that much should be deleted from the stream
  // if valid is false and packet_len is nonzero, the previous packet
  // should be NAKed.
  var extractPacket = function (bytes) {
    var packet = {
      valid: false,
      sync: 0,
      descriptor: 0,
      payload_len: 0,
      payload: null,
      crc: 0,
      packet_len: 0,
      body: null
    };

    var plen = bytes.length;
    if (plen < 9) {
      return packet;
    }

    // we know we have at least enough to check the packet header, so do that
    struct.unpack(bytes, 0, 'bbb', ['sync', 'descriptor', 'payload_len'], packet);
    // if the first byte isn't our sync byte, then just discard that
    // one byte and let our caller try again.
    if (packet.sync != SYNC_BYTE) {
      packet.packet_len = 1;
      return packet;
    }

    var need_len = packet.payload_len + 9;
    if (need_len > plen) {
      return packet;  // we don't have enough yet so go back for more
    }
    packet.packet_len = need_len;

    // we now have enough length for a complete packet, so calc the CRC
    packet.crc = struct.extractBEShort(bytes, packet.packet_len - 2);
    var checksum = weakChecksum(bytes, 1, packet.packet_len - 3);
    if (checksum != packet.crc) {
      // if the crc is bad, we should discard the whole packet
      // (packet_len is nonzero)
      debug('Bad Checksum!');
      debug('checksums:', packet.crc, checksum);
      return packet;
    }

    if (packet.payload_len) {
      packet.payload = new Uint8Array(packet.payload_len);
      for (var i = 0; i < packet.payload_len; ++i) {
        packet.payload[i] = bytes[i + 3];
      }
      var response = getResponseById(packet.descriptor);
      if (response && response.fields && response.format) {
        packet.payload = struct.unpack(bytes, 3, response.format, response.fields);
        if (response.postprocess) {
          response.postprocess(packet.payload);
        }
      }
      if(packet.descriptor === RESPONSES.IDP_TE.value) {
        // Tandem only returns timestamps for when an event occurred for
        // the event history log entries. For other records, e.g. personal profile (IDP_TE)
        // or reminder settings, the only available timestamp is the packet timestamp,
        // i.e., the device time at time of upload.
        packet.timestamp = struct.extractBEInt(bytes,packet.packet_len - 6);
        addTimestamp(uploadTime,packet.timestamp);
      }
    }
    packet.valid = true;
    return packet;
  };

  var tandemPacketHandler = function (buffer) {
    // first, discard bytes that can't start a packet
    while ((buffer.len() > 0) && (buffer.get(0) !== SYNC_BYTE)) {
      buffer.discard(1);
    }

    if (buffer.len() < 9) { // all complete packets must be at least this long
      return null; // not enough there yet
    }

    // there's enough there to try, anyway
    var packet = extractPacket(buffer.bytes());
    if (packet.packet_len !== 0) {
      // remove the now-processed packet
      buffer.discard(packet.packet_len);
    }
    if (packet.valid) {
      return packet;
    }
    else {
      return null;
    }
  };

  var listenForPacket = function (command,args,callback) {

    var abortTimer = setTimeout(function () {
      clearInterval(listenTimer);
      debug('TIMEOUT');
      callback(new Error('Timeout error'), null);
    }, RETRY_TIMEOUT * 2);

    var retryTimer = setTimeout(function() {
      console.log('Retrying with ',command, ', ',args);
      tandemCommand(command, args, function (err) {
        if(err) {
          callback(err,null);
        }
      });
    },RETRY_TIMEOUT);

    var listenTimer = setInterval(function () {
      if (cfg.deviceComms.hasAvailablePacket()) {
        var pkt = cfg.deviceComms.nextPacket();
        if (pkt.valid && (command.response.value === pkt.descriptor)) {
          clearTimeout(retryTimer);
          clearTimeout(abortTimer);
          clearInterval(listenTimer);
          callback(null, pkt);
        }else{
          console.log('Packet not valid');
        }
      }
    }, 1); // spin on this one quickly
  };

  var tandemCommand = function (command, args, callback) {
    var format = command.format;
    var payload;
    var payload_len = 0;
    if (format) {
      payload_len = struct.structlen(format);
      payload = new Uint8Array(payload_len);
      switch(args.length) {
        case 1 :
          struct.pack(payload, 0, format, args);
          break;
        case 2:
          struct.pack(payload, 0, format, args[0], args[1]);
          break;
        default:
          return callback(new Error('Unsupported number of arguments'));
      }
    }

    var commandPacket = buildPacket(command, payload_len, payload);
    cfg.deviceComms.writeSerial(commandPacket, function(err) {
      if(err) {
        console.log('Write error:',err);
        if(err.name === 'pending' || err.name === 'timeout') {
          pending = true;
          callback();
          setTimeout(function() {
            pending = false;
          },SEND_WAIT);
        } else{
          callback(err);
        }
      }else{
        callback();
      }
    });
  };

  var tandemLogRequester = function (start, end, progress, callback) {
    if (debugMode.isDebug) {
      debug('tandemLogRequester', start, end);
      var startExec = Date.now();
    }
    var sendSeq = start;
    var receiveSeq = start;
    var recovering = false;
    var percentage = 0;
    var prevPercentage = 0;
    var retryRecoverTimer;
    var tries = 0;

    var listenTimer = setInterval(function () {
      if(pending) {
        debug('pending');
      }
      while (cfg.deviceComms.hasAvailablePacket() && !pending) {
        var processPacket = function (pkt) {
          if (pkt.valid &&
            pkt.descriptor === RESPONSES.LOG_ENTRY_TE.value &&
            pkt.payload['header_log_seq_no'] >= receiveSeq) {
            if (receiveSeq != pkt.payload['header_log_seq_no']) {
              if (!recovering) {
                recovering = true;
                debug('recovering ', receiveSeq, '(received ',pkt.payload['header_log_seq_no'], ')');
                sendSeq = receiveSeq + 1;
              }

              tandemCommand(COMMANDS.LOG_ENTRY_SEQ_REQ, [receiveSeq], function (err) {

                if(err) {
                  clearInterval(sendTimer);
                  clearInterval(listenTimer);
                  callback(err,null);
                }
                retryRecoverTimer = setTimeout(function() {
                  if(recovering) {
                    debug('Retrying for..', receiveSeq);
                    tandemCommand(COMMANDS.LOG_ENTRY_SEQ_REQ, [receiveSeq], function (err) {
                      if(err) {
                        clearInterval(sendTimer);
                        clearInterval(listenTimer);
                        callback(err,null);
                      }
                    });
                  }
                },RETRY_TIMEOUT);
              });
            }
            else {
              if (recovering) {
                debug('recovered ', receiveSeq, pkt);
                clearTimeout(retryRecoverTimer);
              }
              receiveSeq = pkt.payload['header_log_seq_no'] + 1;
              recovering = false;

              if(end-start > 0) {
                percentage = ((receiveSeq-start)/(end-start) * 90) + 10;
              }

              if(percentage > (prevPercentage+1)) {
                // only update progress to UI if there's an increase of at least 1 percent
                prevPercentage = percentage;
                progress(percentage, cfg.isFirstUpload);
              }

              if (receiveSeq % 1000 === 0) {
                debug('received ', receiveSeq, ' of ', end);
              }
              if (receiveSeq > end) {
                if (debugMode.isDebug) {
                  var endExec = Date.now();
                  var time = endExec - startExec;
                  debug('Execution time of tandemLogRequester: ' + time);
                }
                cfg.deviceComms.flush(); // making sure we flush the buffers
                clearInterval(sendTimer);
                clearInterval(listenTimer);
              }
              callback(null, pkt);
            }
          }
          if(pkt.valid && pkt.descriptor === RESPONSES.COMMAND_ACK.value &&
          pkt.payload['success'] === 0) {
            tries += 1;

            if (tries > MAX_TRIES) {
              tries = 0;
              debug('Failed to recover ', receiveSeq, '. Trying next packet.');
              receiveSeq++;
            }

            if (receiveSeq <= end) {
              tandemCommand(COMMANDS.LOG_ENTRY_SEQ_REQ, [receiveSeq], function (err) {
                if(err) {
                  clearInterval(sendTimer);
                  clearInterval(listenTimer);
                  callback(err,null);
                }
              });
            } else {
              // failed to recover remaining packets, return what we have
              debug('Reached the end.');
              clearInterval(sendTimer);
              clearInterval(listenTimer);
              cfg.deviceComms.flush(); // making sure we flush the buffers
              callback(null, { end: true });
            }
          }
        };
        processPacket(cfg.deviceComms.nextPacket());
      }
    }, INTERVAL_FREQ);

    var sendTimer = setInterval(function () {
      if (sendSeq % 1000 === 0) {
        debug('requesting ', sendSeq);
      }
      if (!recovering && !pending) {
        tandemCommand(COMMANDS.LOG_ENTRY_SEQ_REQ, [sendSeq], function (err) {
          if(err) {
            clearInterval(listenTimer);
            clearInterval(sendTimer);
            callback(err,null);
          }
        });
        if ((sendSeq < end) && !recovering) {
          sendSeq++;
        }
      }
    }, INTERVAL_FREQ); // if we spin too quickly on this, packets don't get sent when window doesn't have focus
  };

  var multiLogRequester = function (start, end, progress, callback) {
    if (debugMode.isDebug) {
      debug('multiLogRequester', start, end);
      var startExec = Date.now();
    }
    var sendSeq = start;
    var receiveSeq = start;
    var percentage = 0;
    var prevPercentage = 0;
    var success = false;
    var listenTimer = null;
    var abortTimer = null;
    var lastPacketRead = null;
    var RETRIES = 10;

    var retryTimeout = function() {
        clearTimeout(retryTimer);
        clearTimeout(abortTimer);
        clearInterval(listenTimer);

        debug('Retrying from record ', receiveSeq, ' onwards.', end-receiveSeq, ' record(s) left..');

        if (_.has(lastPacketRead, 'payload.deviceTime')) {
          debug('Last record read successfully has device time', lastPacketRead.payload.deviceTime);
        }

        // first we reconnect and flush to clear any connection issues
        cfg.deviceComms.clearPacketHandler();
        cfg.deviceComms.disconnect(function () {
          cfg.deviceComms.connect(cfg.deviceInfo, tandemPacketHandler, function (err) {
            if (err) {
              callback(err,null);
            } else {
              cfg.deviceComms.flush();
            }

            // verify we can get a response from the pump
            tandemCommandResponse(COMMANDS.VERSION_REQ, null, function (err, result) {
              if (err) {
                if (rollbar) {
                  rollbar.info('Unable to get response from Tandem pump on retry');
                }
                debug(err);
                callback(err, null);
              }
              else {
                debug('Tandem found: ', result);

                // cancel outstanding multi log request just in case
                tandemCommand(COMMANDS.LOG_ENTRY_SEQ_MULTI_STOP_DUMP, null, function (err) {
                  if(err) {
                    callback(err,null);
                  } else {
                    var err = new Error('Multi-record request failed');

                    if (end-receiveSeq < 128) {
                      debug('Fewer than 128 records remaining');
                      // download remaining records one at a time
                      err.name = 'multi-fail';
                    } else {
                      err.name = 'multi-retry';
                    }

                    err.startSeq = receiveSeq;
                    err.endSeq = end;
                    return callback(err, null);
                  }
                });
              }
            });
          });
        });
    };

    var retryTimer = setTimeout(retryTimeout, RETRY_TIMEOUT);

    tandemCommand(COMMANDS.LOG_ENTRY_SEQ_MULTI_REQ, [sendSeq, end-sendSeq+1], function (err) {
      // second parameter is number of records to retrieve, which is the difference between
      // the start and end indexes plus one
      if(err) {
        callback(err,null);
      }
      else {
        listenTimer = setInterval(function () {
          if(pending) {
            debug('pending');
          }
          while (cfg.deviceComms.hasAvailablePacket() && !pending) {
            var processPacket = function (pkt) {
              if (pkt.valid &&
                pkt.descriptor === RESPONSES.LOG_ENTRY_TE.value &&
                pkt.payload['header_log_seq_no'] >= receiveSeq) {
                if (receiveSeq != pkt.payload['header_log_seq_no']) {
                  debug('Packet out of sequence');
                }
                else {
                  success = true;
                  lastPacketRead = pkt;

                  // reset timeouts
                  clearTimeout(retryTimer);
                  clearTimeout(abortTimer); // abortTimer is set by retryTimeout
                  retryTimer = setTimeout(retryTimeout, RETRY_TIMEOUT);

                  receiveSeq = pkt.payload['header_log_seq_no'] + 1;

                  if(end-start > 0) {
                    percentage = ((receiveSeq-start)/(end-start) * 90) + 10;
                  }

                  if(percentage > (prevPercentage+1)) {
                    // only update progress to UI if there's an increase of at least 1 percent
                    prevPercentage = percentage;
                    progress(percentage, cfg.isFirstUpload);
                  }

                  if (receiveSeq % 1000 === 0) {
                    debug('received ', receiveSeq, ' of ', end);
                  }
                  if (receiveSeq > end) {
                    if (debugMode.isDebug) {
                      var endExec = Date.now();
                      var time = endExec - startExec;
                      debug('Execution time of multiLogRequester: ' + time);
                    }
                    cfg.deviceComms.flush(); // making sure we flush the buffers
                    clearTimeout(retryTimer);
                    clearTimeout(abortTimer);
                    clearInterval(listenTimer);
                  }
                  callback(null, pkt);
                }
              }
              else if(success === false) {
                clearTimeout(retryTimer);
                clearTimeout(abortTimer);
                clearInterval(listenTimer);
                var err = new Error('Multi-record request failed');
                err.name = 'multi-fail';
                return callback(err,null);
              }
            };
            processPacket(cfg.deviceComms.nextPacket());
          }
        }, INTERVAL_FREQ);
      }
    });
  };

  var tandemCommandResponse = function (command, args, callback) {

    tandemCommand(command, args, function (err) {
      if(err) {
        callback(err,null);
      }
      listenForPacket(command,args,callback);
    });
  };

  // callback is called when EOF happens with all records retrieved
  var tandemDownloadRecords = function (progress, data, callback) {
    var retval = [];
    var entries;
    var end_seq;
    var start_seq;

    var isMultiRecordFirmware = function() {
      return (data.firmware_version >= COMMANDS.LOG_ENTRY_SEQ_MULTI_REQ.version);
    };

    function iterate(err, result) {
      if (err) {
        if (err.startSeq && err.endSeq) {
          start_seq = err.startSeq;
          end_seq = err.endSeq;
        }

        if(err.name === 'multi-fail') {
          debug('Falling back to regular event history requests');
          tandemLogRequester(start_seq, end_seq, progress, iterate);
        } else if (err.name === 'multi-retry') {
          multiLogRequester(start_seq, end_seq, progress, iterate);
        } else {
          debug('error retrieving record ', result);
          callback(err, null);
        }
      }
      else {
        if (result.payload && !result.payload.tdeps) {
          retval.push(result.payload);
        }
        if (result.payload && result.payload.header_log_seq_no === end_seq) {
          debug('fetched all records');
          data.log_records = retval;

          if(isMultiRecordFirmware()) {
            tandemCommand(COMMANDS.LOG_ENTRY_SEQ_MULTI_STOP_DUMP, null, function (err) {
              if(err) {
                callback(err,null);
              }
              else{
                // After a multi-record dump, we have to wait a second to be sure the pump
                // stopped dumping records and is ready for the next request.
                debug('Wait a second, phew!');
                var waitTimer = setTimeout(function () {
                  callback(null,data);
                }, 1000);
              }
            });
          } else {
            callback(null, data);
          }
        } else if (result.end) {
          debug(`finished fetching records, missing ${end_seq - retval[retval.length-1].header_log_seq_no} records at end`);
          if (rollbar) {
            rollbar.info('Unable to retrieve last records on Tandem pump');
          }
          data.log_records = retval;
          callback(null, data);
        }
      }
    }

    end_seq = data.end_seq;
    start_seq = data.start_seq;
    debug('Firmware version is #',data.firmware_version);
    if(isMultiRecordFirmware()) {
      // woohoo, we can use multi-record downloads!
      debug('Using multi-record requests');
      multiLogRequester(start_seq, end_seq, progress, iterate);
    }
    else{
      tandemLogRequester(start_seq, end_seq, progress, iterate);
    }
  };

  var tandemFetchEventRange = function (progress, data, callback) {
    tandemDownloadRecords(progress, data, function (err, retval) {
      if (err) {
        debug('fetch failed');
        callback(err, null);
      } else {
        debug('tandemFetchEventRange:', retval);
        tandemFetchSettings(progress, data, function () {
          callback(null, data);
        });
      }
    });
  };

  var tandemFetchSettings = function (progress, data, callback) {
    var profile_ids = [];
    var parsed_profiles = [];

    function iterate(err, result) {
      if (err) {
        debug('error reading settings');
        callback(err, null);
      }
      else {
        if (result.valid && result.descriptor === RESPONSES.IDP_TE.value) {
          parsed_profiles.push(result.payload);
          var profile_id = profile_ids.shift();
          if (profile_id === undefined) {
            data.profiles = parsed_profiles;
            debug('parsed profiles: ', parsed_profiles);
            callback(null, data);
          }
          else {
            tandemCommandResponse(COMMANDS.IDP_REQ, [profile_id], iterate);
          }
        }
      }
    }

    tandemCommandResponse(COMMANDS.GLOBALS_REQ, null, function (err, pkt) {
      if (err) {
        debug('Error reading globals ', err);
        callback(err, null);
      }
      else {
        tandemCommandResponse(COMMANDS.IDP_LIST_REQ, null, function (err, pkt) {
          if (err) {
            debug('Error reading globals ', err);
            callback(err, null);
          }
          else {
            var num_profiles = pkt.payload['num_available'];
            for (var i = 1; i <= num_profiles; i++) {
              profile_ids.push(pkt.payload['slot' + i]);
            }
            tandemCommandResponse(COMMANDS.IDP_REQ, [profile_ids.shift()], iterate);
          }
        });
      }
    });
  };


  var tandemFetch = function (progress, data, callback) {
    if (debugMode.isDebug) {
      var startExec = Date.now();
    }

    debug('requesting log size');
    tandemCommandResponse(COMMANDS.LOG_SIZE_REQ, null, function (err, result) {
      if (err) {
        debug('Error reading log size ', err);
        callback(err, null);
      }
      else {
        if (result.valid && (result.descriptor === RESPONSES.LOG_SIZE_TE.value)) {

          api.getMostRecentUploadRecord(cfg.groupId, cfg.deviceInfo.deviceId, function(err, lastUpload) {
            if (err) {
              return callback(err);
            }

            var lastEndPosition = _.get(lastUpload, 'client.private.delta.lastEndPosition', null);

            data.end_seq = result.payload['end_seq'];

            if ((lastEndPosition != null) &&
                (lastEndPosition <= data.end_seq) &&
                (uploadDataPeriod.periodGlobal === uploadDataPeriod.PERIODS.DELTA)) {

              if (lastEndPosition === data.end_seq) {
                return callback(new Error('No new records since last upload.'));
              }

              cfg.isFirstUpload = false;
              if (lastEndPosition < result.payload['start_seq']) {
                data.start_seq = result.payload['start_seq'];
                debug('Last record read is not on pump anymore, so reading from record', data.start_seq);
              } else  {
                debug('Last record read was', lastEndPosition, ', starting from there');
                data.start_seq = lastEndPosition;
              }
            } else {
              cfg.isFirstUpload = true;
              debug('Reading from record', result.payload['start_seq']);
              data.start_seq = result.payload['start_seq'];
            }
            debug('Reading up until record', data.end_seq);

            progress(10, cfg.isFirstUpload);
            cfg.deviceComms.flush(); // making sure we flush the buffers
            tandemFetchEventRange(progress, data, callback);
          });
        }
        else{
          console.log('Invalid log size:', result);
        }
      }
    });
  };

  var filterLogEntries = function (types, log_records) {
    var neededLogIds = [];
    types.forEach(function (element) { neededLogIds.push(element.value); });
    return log_records.filter(function (record) {
      return neededLogIds.indexOf(record.header_id) >= 0;
    });
  };

  var buildSettingsRecords = function buildSettingsRecord(data, postrecords) {
    var activeName = data.profiles[0].name; // first is always the active profile
    var basalSchedules = {};
    var carbSchedules = {};
    var sensitivitySchedules = {};
    var targetSchedules = {};
    var bolusSettings = {};
    var insulinSettings = {};
    data.profiles.forEach(function (profile) {
      var scheduleName = profile.name;
      var schedule = [];
      var carbSchedule = [];
      var sensitivitySchedule = [];
      var targetSchedule = [];
      profile.tdeps.forEach(function (tdep) {
        schedule.push({ rate: tdep['basalRate'], start: tdep['startTime'] });
        carbSchedule.push({ amount: tdep['carbRatio'], start: tdep['startTime'] });
        sensitivitySchedule.push({ amount: tdep['ISF'], 'start': tdep['startTime'] });
        targetSchedule.push({ target: tdep['TargetBG'], start: tdep['startTime'] });
      });
      basalSchedules[scheduleName] = schedule;
      carbSchedules[scheduleName] = carbSchedule;
      sensitivitySchedules[scheduleName] = sensitivitySchedule;
      targetSchedules[scheduleName] = targetSchedule;
      bolusSettings[scheduleName] = {
        amountMaximum : {
          value: profile.max_bolus,
          units: 'Units'
        },
        calculator: {
          enabled: profile.carb_entry ? true : false,
          insulin: {
            duration : profile.insulin_duration,
            units: 'minutes'
          }
        }
      };
    });

    var postsettings = cfg.builder.makeTandemPumpSettings()
      .with_activeSchedule(activeName)
      .with_units({ carb: 'grams', bg: 'mg/dL' })
      .with_basalSchedules(basalSchedules)
      .with_carbRatios(carbSchedules)
      .with_insulinSensitivities(sensitivitySchedules)
      .with_bgTargets(targetSchedules)
      .with_bolus(bolusSettings)
      .with_manufacturers(cfg.deviceInfo.manufacturers)
      .with_model(cfg.deviceInfo.model)
      .with_serialNumber(cfg.deviceInfo.serialNumber)
      .with_time(sundial.applyTimezone(uploadTime.jsDate, cfg.timezone).toISOString())
      .with_deviceTime(uploadTime.deviceTime)
      .with_timezoneOffset(sundial.getOffsetFromZone(uploadTime.jsDate, cfg.timezone))
      .with_conversionOffset(0)
      .done();

    postrecords.push(postsettings);
    return postrecords;
  };

  var buildTimeChangeRecords = function (data, records) {
    var timeChangeLogs = filterLogEntries(
      [PUMP_LOG_RECORDS.LID_TIME_CHANGED],
      data.log_records
    );

    var dateChangeLogs = filterLogEntries(
      [PUMP_LOG_RECORDS.LID_DATE_CHANGED],
      data.log_records
    );

    var isValidTimeChange = function(fromDatum, toDatum) {
      /* We need to filter out spurious time changes that appear in the data when
         the battery is left out for too long. The strategy is to filter out any
         time change to a date where the year is less than the current year
         minus one. This is the same strategy used in the Medtronic driver. */
      if (fromDatum.getUTCFullYear() < (new Date().getUTCFullYear() - 1) ||
        toDatum.getUTCFullYear() < (new Date().getUTCFullYear() - 1)) {
        debug('Excluding time change from',fromDatum.toISOString().slice(0,-5),'to', toDatum.toISOString().slice(0,-5), 'as spurious.');
        return false;
      }
      return true;
    };


    var postrecords = [];

    for (var i = 0; i < timeChangeLogs.length; ++i) {
      var tc = timeChangeLogs[i];
      var tc_base = sundial.floor(tc.rawTimestamp, 'day').valueOf();

      // look for a corresponding date change event
      var found = false;
      var index = tc.index;
      var lastIndex = data.log_records[data.log_records.length - 1].index;
      var SEARCH_THRESHOLD = 5;
      var start = index < SEARCH_THRESHOLD ? 0 : index - SEARCH_THRESHOLD; // look at x entries before
      var end = (index + SEARCH_THRESHOLD) < lastIndex ?
        index + SEARCH_THRESHOLD : lastIndex; // and up to x entries after
      for (var k = start; k <= end; k++) {
        var event = _.find(dateChangeLogs, {index: k});
        if (event) {
          found = true;
          var rawFromTime = BASE_TIME + (event.date_prior * 864e5) + tc.time_prior;
          var rawToTime = BASE_TIME + (event.date_after * 864e5) + tc.time_after;
          if (isValidTimeChange(new Date(rawFromTime), new Date(rawToTime))) {
            var datetimechange = cfg.builder.makeDeviceEventTimeChange()
              .with_change({
                from: sundial.formatDeviceTime(rawFromTime),
                to: sundial.formatDeviceTime(rawToTime),
                agent: 'manual'
              })
              .with_deviceTime(sundial.formatDeviceTime(rawToTime))
              .set('jsDate', new Date(rawToTime))
              .set('index', tc.index);
            postrecords.push(datetimechange);
          }

          // remove the date change event from dateChangeLogs so that we don't process it twice
          dateChangeLogs = _.without(dateChangeLogs, event);
        }
      }

      if (!found) { // a regular time change event
        var timechange = cfg.builder.makeDeviceEventTimeChange()
          .with_change({
            from: sundial.formatDeviceTime(tc_base + tc.time_prior),
            to: sundial.formatDeviceTime(tc_base + tc.time_after),
            agent: 'manual'
          })
          .with_deviceTime(tc.deviceTime)
          .set('jsDate', tc.jsDate)
          .set('index', tc.index);
        postrecords.push(timechange);
      }
    }

    for (var j = 0; j < dateChangeLogs.length; ++j) {
      var dc = dateChangeLogs[j];
      var dc_base = BASE_TIME;

      var rawFromTime = BASE_TIME + dc.date_prior * 864e5;
      var rawToTime = BASE_TIME + dc.date_after * 864e5;
      if (isValidTimeChange(new Date(rawFromTime), new Date(rawToTime))) {
        var datechange = cfg.builder.makeDeviceEventTimeChange()
          .with_change({
            from: sundial.formatDeviceTime(rawFromTime),
            to: sundial.formatDeviceTime(rawToTime),
            agent: 'manual'
          })
          .with_deviceTime(dc.deviceTime)
          .set('jsDate', dc.jsDate)
          .set('index', dc.index);
        postrecords.push(datechange);
      }
    }

    var mostRecent = sundial.applyTimezone(data.log_records[data.log_records.length - 1].jsDate, cfg.timezone).toISOString();
    debug('Most recent datum at', mostRecent);
    var tzoUtil = new TZOUtil(
      cfg.timezone,
      mostRecent,
      postrecords
    );

    cfg.tzoUtil = tzoUtil;
    return records.concat(tzoUtil.records);
  };

  var buildBolusRecords = function (data, records) {
    var bolusLogs = filterLogEntries([
        PUMP_LOG_RECORDS.LID_BOLUS_ACTIVATED,
        PUMP_LOG_RECORDS.LID_BOLUS_COMPLETED,
        PUMP_LOG_RECORDS.LID_BOLEX_ACTIVATED,
        PUMP_LOG_RECORDS.LID_BOLEX_COMPLETED,
        PUMP_LOG_RECORDS.LID_BOLUS_REQUESTED_MSG1,
        PUMP_LOG_RECORDS.LID_BOLUS_REQUESTED_MSG2,
        PUMP_LOG_RECORDS.LID_BOLUS_REQUESTED_MSG3
      ],
      data.log_records
    );
    var boluses = {};
    bolusLogs.forEach(function(event) {
      var bolusId = event.bolus_id;
      var bolus = _.defaults({ bolus_id: bolusId }, boluses[bolusId], event);
      if (event.header_id === PUMP_LOG_RECORDS.LID_BOLUS_ACTIVATED.value) {
        bolus.startDeviceTime = event.deviceTime;
      }
      if (event.header_id === PUMP_LOG_RECORDS.LID_BOLEX_ACTIVATED.value) {
        bolus.extendedStartDeviceTime = event.deviceTime;
      }
      if (event.header_id === PUMP_LOG_RECORDS.LID_BOLEX_COMPLETED.value) {
        bolus.endDeviceTime = event.deviceTime;
      }
      if (event.header_id === PUMP_LOG_RECORDS.LID_BOLUS_REQUESTED_MSG1.value) {
        bolus.bc_iob = event.iob;
        bolus.wizardDeviceTime = event.deviceTime;
      }
      boluses[bolusId] = bolus;
    });
    for (var key in boluses) {
      var bolus = boluses[key];
      var record;

      // bolus records
      if (bolus.bolex_size !== undefined || bolus.bolus_option === 'extended') {
        if (bolus.bolus_size !== undefined || bolus.insulin_requested !== undefined) {
          record = cfg.builder.makeDualBolus();
        }
        else {
          record = cfg.builder.makeSquareBolus();
        }
      }
      else {
        record = cfg.builder.makeNormalBolus();
      }
      record = record.with_deviceTime(bolus.deviceTime);
      if (bolus.bolex_size !== undefined) {
        // extended bolus
        // first case: extended bolus was cancelled
        if (bolus.bolex_size !== bolus.bolex_insulin_delivered) {
          if(bolus.endDeviceTime !== undefined) {
            record = record.with_duration(
              Date.parse(bolus.endDeviceTime) - Date.parse(bolus.extendedStartDeviceTime)
            );
          }
          else{
            // no end time, so extended bolus still in progress
            debug('Extended bolus in progress: ', bolus);
            continue;
          }

          // cancelled before any insulin was given on dual bolus
          if (bolus.bolex_insulin_delivered === undefined) {
            record = record.with_extended(0);
          }
          else {
            record = record.with_extended(bolus.bolex_insulin_delivered);
          }
          record = record.with_expectedExtended(bolus.bolex_insulin_requested)
            .with_expectedDuration(bolus.duration);
        }
        // other case: extended bolus completed
        else {
          record = record.with_extended(bolus.bolex_insulin_delivered);
          record = record.with_duration(bolus.duration);
        }
      }
      if (bolus.bolus_size !== undefined || bolus.insulin_delivered !== undefined) {
        if (bolus.bolus_size !== bolus.insulin_delivered) {
          record = record.with_normal(bolus.insulin_delivered);
          record = record.with_expectedNormal(bolus.insulin_requested);
        }
        else {
          record = record.with_normal(bolus.insulin_delivered);
        }
      }
      // non-extended bolus cancelled before any insulin was given
      if ((bolus.bolus_option === 'standard' || bolus.bolus_option === 'quickbolus') &&
        bolus.bolus_size === undefined) {
        record = record.with_normal(0)
          .with_expectedNormal(bolus.insulin_requested);
      }
      // extended bolus cancelled before any insulin was given
      if (bolus.bolus_option === 'extended' && bolus.bolex_size === undefined) {
        record = record.with_duration(0)
          .with_extended(0)
          .with_expectedDuration(bolus.duration)
          .with_expectedExtended(bolus.bolex_insulin_requested);
      }
      record = record.set('index', bolus.index);

      if((record.subType === 'normal' && bolus.insulin_delivered === undefined) ||
         (record.subType === 'square' && bolus.duration === undefined) ||
         (record.subType === 'dual/square' && bolus.duration === undefined)) {
        debug('Only part of a bolus received, dropping:', bolus);
      }
      else{
        cfg.tzoUtil.fillInUTCInfo(record, bolus.jsDate);
        records.push(record.done());
      }

      // wizard records
      if (_.includes(['standard', 'extended'], bolus.bolus_option) &&
        (bolus.correction_bolus_included || (bolus.food_bolus_size > 0))) {
        // a wizard bolus can be a correction bolus or food bolus (or both)

        var netBolus = null;
        if (bolus.correction_bolus_included) {
          netBolus = bolus.correction_bolus_size + bolus.food_bolus_size;
        }
        else {
          netBolus = bolus.food_bolus_size;
        }

        var wizard_record = cfg.builder.makeWizard()
          .with_deviceTime(bolus.wizardDeviceTime)
          .with_recommended({
            carb: bolus.food_bolus_size,
            correction: bolus.correction_bolus_size,
            net: netBolus.toFixedNumber(SIGNIFICANT_DIGITS)
          })
          .with_bgInput(bolus.bg)
          .with_carbInput(bolus.carb_amount)
          .with_insulinOnBoard(bolus.bc_iob)
          .with_insulinCarbRatio(bolus.carb_ratio)
          .with_insulinSensitivity(bolus.isf)
          .with_bgTarget({
            target: bolus.target_bg
          })
          .with_bolus(record)
          .with_units('mg/dL')
          .set('index', bolus.index);
        cfg.tzoUtil.fillInUTCInfo(wizard_record, bolus.jsDate);
        wizard_record = wizard_record.done();
        records.push(wizard_record);
      }
    }
    return records;
  };

  var buildBasalRecords = function (data, records) {
    var basalRecords = filterLogEntries(
      [PUMP_LOG_RECORDS.LID_BASAL_RATE_CHANGE],
      data.log_records
    );
    var postbasal = null;
    for (var b = 0; b < basalRecords.length; ++b) {
      var event = basalRecords[b];

      var changesTypesArray = event.change_types;
      var filteredChangeTypes;
      if(event.change_types.length > 1) {
        filteredChangeTypes = _.without(event.change_types,'timed_segment','new_profile').join('|');
      } else {
        filteredChangeTypes = event.change_types[0];
      }

      switch (filteredChangeTypes) {
        case 'timed_segment':
        case 'new_profile':
        case 'temp_rate_end':
        case 'temp_rate_end|pump_resumed':
        case 'pump_resumed':
          // when the command_basal_rate is not the same as the base_basal_rate
          // that means we're in a temp basal that crosses the border between
          // scheduled segments, so the temp rate is being recalculated
          // as a percentage of the current base_basal_rate (from the schedule)
          if (event.command_basal_rate !== event.base_basal_rate) {
            postbasal = cfg.builder.makeTempBasal()
              .with_deviceTime(event.deviceTime)
              .with_rate(event.command_basal_rate)
              .with_percent(event.command_basal_rate/event.base_basal_rate)
              .set('index', event.index)
              .with_payload({change_types: changesTypesArray});
            cfg.tzoUtil.fillInUTCInfo(postbasal, event.jsDate);
            break;
          }
          postbasal = cfg.builder.makeScheduledBasal()
            .with_deviceTime(event.deviceTime)
            .with_rate(event.command_basal_rate)
            .set('index', event.index)
            .with_payload({
              personalProfileIndex : event.idp,
              change_types: changesTypesArray
            });
          cfg.tzoUtil.fillInUTCInfo(postbasal, event.jsDate);
          break;
        case 'temp_rate_start':
        case 'temp_rate_start|pump_resumed':
          postbasal = cfg.builder.makeTempBasal()
            .with_deviceTime(event.deviceTime)
            .with_rate(event.command_basal_rate)
            .set('index', event.index)
            .with_payload({change_types: changesTypesArray});
          cfg.tzoUtil.fillInUTCInfo(postbasal, event.jsDate);
          break;
        case 'pump_suspended':
        case 'temp_rate_end|pump_suspended':
          postbasal = cfg.builder.makeSuspendBasal()
            .with_deviceTime(event.deviceTime)
            .set('index', event.index)
            .with_payload({change_types: changesTypesArray});
          cfg.tzoUtil.fillInUTCInfo(postbasal, event.jsDate);
          break;
        case 'pump_shut_down':
        case 'temp_rate_end|pump_shut_down':
          // no basal record gets built in this case
          break;
        default:
          debug('Event with unhandled change type:', event);
          throw new Error('Unhandled combination of basal change types: ' + event.change_types.join('|'));
      }
      if (postbasal != null) {
        if(postbasal.deliveryType === 'temp') {
          var suppressed = {
            type: 'basal',
            deliveryType: 'scheduled',
            rate: event.base_basal_rate
          };
          postbasal.set('suppressed', suppressed);
        }
        records.push(postbasal);
      }
    }
    return records;
  };

  var buildTempBasalRecords = function(data, records) {
    var tempBasalRecords = filterLogEntries([PUMP_LOG_RECORDS.LID_TEMP_RATE_ACTIVATED,PUMP_LOG_RECORDS.LID_TEMP_RATE_COMPLETED], data.log_records);

    for(var i = 0; i < tempBasalRecords.length; ++i) {
      var event = tempBasalRecords[i];
      var record = null;
      if(event.header_id === PUMP_LOG_RECORDS.LID_TEMP_RATE_ACTIVATED.value) {
        record = {
          type: 'temp-basal',
          subType: 'start',
          percent: event.percent,
          duration: event.duration
        };
      }
      else if(event.header_id === PUMP_LOG_RECORDS.LID_TEMP_RATE_COMPLETED.value) {
        record = {
          type: 'temp-basal',
          subType: 'stop',
          time_left: event.time_left
        };
      }
      record.deviceTime = event.deviceTime;
      record.index = event.index;
      cfg.tzoUtil.fillInUTCInfo(record, event.jsDate);
      records.push(record);
    }
    return records;
  };

  var buildNewDayRecords = function(data, records) {
    var newDayRecords = filterLogEntries([PUMP_LOG_RECORDS.LID_NEW_DAY], data.log_records);

    for (var b = 0; b < newDayRecords.length; ++b) {
      var event = newDayRecords[b];

      var nextEvent = data.log_records[data.log_records.indexOf(event) + 1 ];
      if( nextEvent.header_id === PUMP_LOG_RECORDS.LID_TIME_CHANGED.value ||
          nextEvent.header_id === PUMP_LOG_RECORDS.LID_DATE_CHANGED.value) {
            debug('Dropping new-day event (',event.deviceTime,') followed by date/time change (', nextEvent.deviceTime,')');
            continue;
      };

      var rate = event.commanded_basal_rate;
      if ((rate !== null) && (rate > 0)) {
        // new day event; breaks up flat-rate basals
        var postrecord = cfg.builder.makeScheduledBasal()
            .with_deviceTime(event.deviceTime)
            .with_rate(rate)
            .set('index', event.index);
        cfg.tzoUtil.fillInUTCInfo(postrecord, event.jsDate);
        postrecord.set('type', 'new-day');
        records.push(postrecord);
      }
    }
    return records;
  };

  var buildSuspendRecords = function (data, records) {
    var suspendRecords = filterLogEntries([PUMP_LOG_RECORDS.LID_PUMPING_SUSPENDED], data.log_records);

    suspendRecords.forEach(function (entry) {
      var postrecord = cfg.builder.makeDeviceEventSuspend()
          .with_deviceTime(entry.deviceTime)
          .with_payload( { reason: getSuspendReason(entry.reason) })
          .set('index', entry.index);

      if (entry.reason === SUSPEND_REASON.USER_ABORTED.value) {
        postrecord.reason = { suspended: 'manual' };
      } else {
        postrecord.reason = { suspended: 'automatic' };
      }
      cfg.tzoUtil.fillInUTCInfo(postrecord, entry.jsDate);
      records.push(postrecord.done());
    });

    return records;
  };

  var buildResumeRecords = function (data, records) {
    var resumeRecords = filterLogEntries([PUMP_LOG_RECORDS.LID_PUMPING_RESUMED, PUMP_LOG_RECORDS.LID_HYPO_MINIMIZER_RESUME], data.log_records);

    for (var i = 0; i < resumeRecords.length; i++) {
      var entry = resumeRecords[i];
      var postrecord = cfg.builder.makeDeviceEventResume()
          .with_reason({resumed: 'manual'})
          .with_deviceTime(entry.deviceTime)
          .set('index', entry.index);
      cfg.tzoUtil.fillInUTCInfo(postrecord, entry.jsDate);

      if (resumeRecords[i+1] != null && resumeRecords[i+1].header_id === PUMP_LOG_RECORDS.LID_HYPO_MINIMIZER_RESUME.value) {

        if (entry.time !== resumeRecords[i+1].time) {
          throw new Error('PLGS resume time does not match pump resume time');
        }
        // resume is due to PLGS
        i += 1;
        entry = resumeRecords[i];
        postrecord.reason = {resumed: 'automatic'};
        if (entry.reason > 0) {
          postrecord.payload = {reason: getResumeReason(entry.reason)};
        }
      }

      records.push(postrecord);
    };

    return records;
  };

  var buildCartridgeChangeRecords = function (data, records) {
    var cartridgeChangeRecords = filterLogEntries([PUMP_LOG_RECORDS.LID_TUBING_FILLED,PUMP_LOG_RECORDS.LID_CANNULA_FILLED,PUMP_LOG_RECORDS.LID_CARTRIDGE_FILLED], data.log_records);

    cartridgeChangeRecords.forEach(function (entry) {
      var cartridgeChangeRecord;
      if (entry.header_id === PUMP_LOG_RECORDS.LID_TUBING_FILLED.value) {
        cartridgeChangeRecord = cfg.builder.makeDeviceEventPrime()
          .with_primeTarget('tubing')
          .with_volume(entry.prime_size);
      } else if (entry.header_id === PUMP_LOG_RECORDS.LID_CANNULA_FILLED.value) {
        cartridgeChangeRecord = cfg.builder.makeDeviceEventPrime()
          .with_primeTarget('cannula')
          .with_volume(entry.prime_size);
      } else if (entry.header_id === PUMP_LOG_RECORDS.LID_CARTRIDGE_FILLED.value) {
        cartridgeChangeRecord = cfg.builder.makeDeviceEventReservoirChange()
          .with_payload({event: 'cartridge_filled',
                         insulin_display: entry.insulin_display,
                         insulin_actual: entry.insulin_actual});
      }

      cartridgeChangeRecord.with_deviceTime(entry.deviceTime)
          .set('index',entry.index);
      cfg.tzoUtil.fillInUTCInfo(cartridgeChangeRecord, entry.jsDate);
      records.push(cartridgeChangeRecord.done());
    });

    return records;
  };
  var buildCannulaChangeRecords = function (data, records) {
    return records;
  };

  var buildBGRecords = function (data, records) {
    var bgRecords = filterLogEntries([PUMP_LOG_RECORDS.LID_BG_READING_TAKEN], data.log_records);
    bgRecords.forEach(function (bgEntry) {
      if (bgEntry.bg_source !== BG_READING_SOURCE.AUTO_POPULATED.value) {
        var bgRecord = cfg.builder.makeSMBG()
          .with_deviceTime(bgEntry.deviceTime)
          .with_subType('manual')
          .with_value(bgEntry.bg)
          .with_units('mg/dL')
          .set('index',bgEntry.index);
        cfg.tzoUtil.fillInUTCInfo(bgRecord, bgEntry.jsDate);
        bgRecord.done();
        records.push(bgRecord);
      }
    });
    return records;
  };

  var buildAlarmRecords = function (data,records) {
    var alarmRecords = filterLogEntries([PUMP_LOG_RECORDS.LID_ALARM_ACTIVATED,PUMP_LOG_RECORDS.LID_ALERT_ACTIVATED],data.log_records);
    alarmRecords.forEach(function (alarmEntry) {
      var alarmRecord = cfg.builder.makeDeviceEventAlarm()
        .with_deviceTime(alarmEntry.deviceTime)
        .set('index', alarmEntry.index);
      cfg.tzoUtil.fillInUTCInfo(alarmRecord, alarmEntry.jsDate);

      if(alarmEntry.alarm_id != null) {
        var alarmValue = alarmEntry.alarm_id;
        var alarmText = getAlarmName(alarmValue,ALARM_TYPES);
        var postbasal = null;

        switch (alarmValue) {
          case ALARM_TYPES.ALARM_OCCLUSION.value:
            alarmRecord = alarmRecord.with_alarmType('occlusion');
            // occlusions do not create suspended basals in basal rate change events,
            // so we have to create them manually
            postbasal = cfg.builder.makeSuspendBasal()
              .with_deviceTime(alarmEntry.deviceTime)
              .with_payload({alarm_id: alarmValue})
              .set('index', alarmEntry.index);
            annotate.annotateEvent(postbasal, 'tandem/basal/fabricated-from-occlusion-alarm');
            cfg.tzoUtil.fillInUTCInfo(postbasal, alarmEntry.jsDate);
            records.push(postbasal);
            break;
          case ALARM_TYPES.ALARM_SECOND_OCCLUSION.value:
            alarmRecord = alarmRecord.with_alarmType('occlusion');
            alarmRecord = alarmRecord.with_payload({alarm_id: alarmValue, alarm_name: alarmText});
            // occlusions do not create suspended basals in basal rate change events,
            // so we have to create them manually
            postbasal = cfg.builder.makeSuspendBasal()
              .with_deviceTime(alarmEntry.deviceTime)
              .with_payload({alarm_id: alarmValue, alarm_name: alarmText})
              .set('index', alarmEntry.index);
            annotate.annotateEvent(postbasal, 'tandem/basal/fabricated-from-occlusion-alarm');
            cfg.tzoUtil.fillInUTCInfo(postbasal, alarmEntry.jsDate);
            records.push(postbasal);
            break;
          case ALARM_TYPES.ALARM_AUTO_OFF.value:
            alarmRecord = alarmRecord.with_alarmType('auto_off');
            break;
          case ALARM_TYPES.ALARM_OUT_OF_LIQUID.value:
            alarmRecord = alarmRecord.with_alarmType('no_insulin');
            break;
          case ALARM_TYPES.ALARM_EXTREMELY_LOW_LIPO.value:
            alarmRecord = alarmRecord.with_alarmType('no_power');
            break;
          case ALARM_TYPES.ALARM_TEMPERATURE_OUT_OF_RANGE:
          case ALARM_TYPES.ALARM_STUCK_WAKE_BUTTON:
          case ALARM_TYPES.ALARM_PRESSURE_OUT_OF_RANGE:
          case ALARM_TYPES.ALARM_CARTRIDGE_REMOVED:
            alarmRecord = alarmRecord.with_alarmType('other');
            alarmRecord = alarmRecord.with_payload({alarm_id: alarmValue, alarm_name: alarmText});
            break;
          default:
            alarmRecord = alarmRecord.with_alarmType('other');
            alarmRecord = alarmRecord.with_payload({alarm_id: alarmValue});
        }
      }

      if(alarmEntry.alert_id != null) {
        var alertValue = alarmEntry.alert_id;
        var alertText = getAlarmName(alertValue, ALERT_TYPES);

        switch (alertValue) {
          case ALERT_TYPES.ALERT_LOW_INSULIN.value:
            alarmRecord = alarmRecord.with_alarmType('low_insulin');
            break;
          case ALERT_TYPES.ALERT_LOW_LIPO_CHARGE.value:
          case ALERT_TYPES.ALERT_VERY_LOW_LIPO_CHARGE.value:
            alarmRecord = alarmRecord.with_alarmType('low_power');
            alarmRecord = alarmRecord.with_payload({alert_name: alertText});
            break;
          default:
            alarmRecord = alarmRecord.with_alarmType('other');
            alarmRecord = alarmRecord.with_payload({alert_id: alertValue});
        }
      }

      alarmRecord = alarmRecord.done();
      records.push(alarmRecord);
    });

    return records;
  };

  var buildCGMRecords = function(data, records) {
    var cgmRecords = filterLogEntries([
      PUMP_LOG_RECORDS.LID_CGM_DATA,
      PUMP_LOG_RECORDS.LID_CGM_CALIBRATION,
      PUMP_LOG_RECORDS.LID_CGM_DATA_GX,
      PUMP_LOG_RECORDS.LID_CGM_CALIBRATION_GX,
      PUMP_LOG_RECORDS.LID_CGM_DATA_GXB
    ], data.log_records);

    for (var b = 0; b < cgmRecords.length; ++b) {
      var event = cgmRecords[b];
      var value = event.value;
      var record = null;
      var annotation = null;

      if (event.header_id === PUMP_LOG_RECORDS.LID_CGM_CALIBRATION.value ||
          event.header_id === PUMP_LOG_RECORDS.LID_CGM_CALIBRATION_GX.value) {

        record = cfg.builder.makeDeviceEventCalibration()
          .with_value(value)
          .with_deviceTime(event.deviceTime)
          .with_units('mg/dL')      // hard-coded in mg/dL
          .set('index', event.index);

        if (event.header_id === PUMP_LOG_RECORDS.LID_CGM_CALIBRATION.value) {
          // for G4 calibrations, we have some extra info to store in payload
          record.with_payload({
            timestamp: event.timestamp,
            calibration_timestamp: event.cal_timestamp,
            current_display_value: event.current_display_value,
            current_time: event.current_time
          });
        }

        cfg.tzoUtil.fillInUTCInfo(record, event.jsDate);
        record = record.done();

      } else if ((event.header_id === PUMP_LOG_RECORDS.LID_CGM_DATA.value ||
                 (event.header_id === PUMP_LOG_RECORDS.LID_CGM_DATA_GX.value &&
                  event.type === CGM_GX_TYPE.FMR.value) || // not using calibration or backfill values
                  (event.header_id === PUMP_LOG_RECORDS.LID_CGM_DATA_GXB.value &&
                   (event.type & CGM_GXB_TYPE.FMR.value ||
                    event.type & CGM_GXB_TYPE.BACKFILL.value))) &&
                  ((value >= 40 && value <= 400) || (value === 0)) ) { // HI/LO values are 0

        record = cfg.builder.makeCBG();

        if (event.status === CGM_STATUS.CGM_CALIBRATION.value ||
            event.status === CGM_STATUS.CGM_LO_CALIBRATION.value ||
            event.status === CGM_STATUS.CGM_HI_CALIBRATION.value ||
            event.type === CGM_GX_TYPE.CALIBRATION.value) {
          // in response to calibration
          record.with_payload({
            calibration_response: true
          });
        }

        if(event.status === CGM_STATUS.CGM_HI_CALIBRATION.value ||
           event.status === CGM_STATUS.CGM_HI.value) {
             value = 401;  // value is larger than 400
             annotation = {
               code: 'bg/out-of-range',
               value: 'high',
               threshold: 400
             };
        }

        if(event.status === CGM_STATUS.CGM_LO_CALIBRATION.value ||
           event.status === CGM_STATUS.CGM_LO.value) {
             value = 39; // value is lower than 40
             annotation = {
               code: 'bg/out-of-range',
               value: 'low',
               threshold: 40
             };
        }

        if (event.header_id === PUMP_LOG_RECORDS.LID_CGM_DATA_GXB.value) {
          // use CGM timestamp inside the record as the event log timestamp
          // is the time the backfill values were received by the pump
          addTimestamp(event, event.timestamp);
        }

        record.with_value(value)
              .with_deviceTime(event.deviceTime)
              .with_units('mg/dL')      // hard-coded in mg/dL
              .set('index', event.index);

        if (event.header_id === PUMP_LOG_RECORDS.LID_CGM_DATA_GX.value) {
          record.with_payload({
            rate: event.rate,
            rssi: event.rssi,
            timestamp: event.timestamp,
            transmitter_timestamp: event.transmitter_timestamp
          });
        }

        if (event.header_id === PUMP_LOG_RECORDS.LID_CGM_DATA_GXB.value) {
          // type is required for de-duping, and removed in the simulator
          record.cgmType = getFlagNames(CGM_GXB_TYPE, event.type);

          record.with_payload({
            rate: event.rate,
            rssi: event.rssi,
            timestamp: event.timestamp,
            type:record.cgmType,
          });
        }

        cfg.tzoUtil.fillInUTCInfo(record, event.jsDate);
        record = record.done();
      }

      if (record) {
        if (annotation) {
          annotate.annotateEvent(record, annotation);
        }
        records.push(record);
      }
    }
    return records;
  };

  var tandemGetConfigInfo = function (cb, data) {
    tandemCommandResponse(COMMANDS.VERSION_REQ, null, function (err, result) {
      if (err) {
        console.log(err);
        cb(err, null);
      }
      else {
        console.log('Tandem found: ', result);
        if (data == null) {
          data = {};
        }
        data.deviceModel = result.payload.model_no.toString();
        data.pump_sn = result.payload.pump_sn;
        data.firmware_version = parseInt(result.payload.arm_sw_ver);

        if (data.firmware_version >= 51000) {
          // according to the specs, only firmware versions higher or equal to
          // 51000 can handle CGM records. We also have e-mail confirmation from
          // Tandem that this is how to determine if a pump is CGM-capable
          cfg.deviceInfo.tags = cfg.deviceInfo.tags.concat('cgm');
        }

        cfg.deviceInfo.deviceId = 'tandem' + data.deviceModel + data.pump_sn;
        cfg.builder.setDefaults({ deviceId: cfg.deviceInfo.deviceId });

        // this is required for comparing device time against server time
        var currentTime = {};
        addTimestamp(currentTime,result.payload.timestamp);
        _.assign(cfg.deviceInfo, {
          deviceTime: currentTime.deviceTime,
          model: data.deviceModel,
          serialNumber: data.pump_sn.toString(),
        });
        common.checkDeviceTime(cfg, function(err) {
          return cb(err, data);
        });
      }
    });
  };

  return {
    detect: function(deviceInfo, cb){
      debug('no detect function needed', arguments);
      cb(null, deviceInfo);
    },

    setup: function (deviceInfo, progress, cb) {
      debug('in setup!');
      progress(100);
      cb(null, { stage: 'setup', deviceInfo: deviceInfo });
    },

    connect: function (progress, data, cb) {
      console.log('connecting');
      cfg.deviceComms.connect(data.deviceInfo, tandemPacketHandler, function (err) {
        if(err) {
          cb(err,null);
        }else{
          cfg.deviceComms.flush();
          progress(100);
          data.stage = 'connect';
          cb(null, data);
        }
      });
    },

    getConfigInfo: function (progress, data, cb) {
      debug('in getConfigInfo');
      data.stage = 'getConfigInfo';
      progress(100);
      tandemGetConfigInfo(cb, data);
    },

    fetchData: function (progress, data, cb) {
      debug('in fetchData');
      tandemFetch(progress, data, cb);
      data.stage = 'fetchData';
    },

    processData: function (progress, data, cb) {
      debug('in processData');
      progress(100);
      data.stage = 'processData';
      cb(null, data);
    },

    uploadData: function (progress, data, cb) {
      data.stage = 'uploadData';
      progress(0);

      var postrecords = [], settings = null;
      /*
        Because pump shut-down interferes with BtUTC, anywhere
        where a pump shut-down appears in records to be processed
        we only attempt to process and upload the data following
        the most recent device shut-down.
      */
      if (!debugMode.isDebug) {
        data.log_records = _.takeRightWhile(data.log_records, function(rec) {
          if (rec.change_types &&
            _.includes(rec.change_types,'pump_shut_down')) {
            debug('Most recent pump shut down:', rec);
            return false;
          }
          return true;
        });
        debug('Will process', data.log_records.length, 'log records.');
      }

      if (!_.isEmpty(data.log_records)) {
        // ordering below is important for simulator, e.g.
        // buildTempBasalRecords needs to be before buildBasalRecords
        postrecords = buildSettingsRecords(data, postrecords);
        if (!_.isEmpty(postrecords)) {
          settings = postrecords[0];
        }
        postrecords = buildTimeChangeRecords(data, postrecords);
        postrecords = buildBolusRecords(data, postrecords);
        postrecords = buildTempBasalRecords(data, postrecords);
        postrecords = buildBasalRecords(data, postrecords);
        postrecords = buildNewDayRecords(data, postrecords);
        postrecords = buildBGRecords(data, postrecords);
        postrecords = buildCartridgeChangeRecords(data, postrecords);
        postrecords = buildSuspendRecords(data, postrecords);
        postrecords = buildResumeRecords(data, postrecords);
        postrecords = buildAlarmRecords(data, postrecords);
        postrecords = buildCGMRecords(data, postrecords);
        // sort by time for the simulator
        postrecords = _.sortBy(postrecords, function(d) { return d.time; });
      }
      else {
        throw new Error('No records since last upload or most recent pump shut down; nothing to upload.');
      }

      var simulator = tandemSimulatorMaker.make({settings: settings, profiles:data.profiles});

      for (var n = 0; n < postrecords.length; ++n) {
        var datum = postrecords[n];
        switch (datum.type) {
          case 'basal':
            simulator.basal(datum);
            break;
          case 'bolus':
            simulator.bolus(datum);
            break;
          case 'deviceEvent':
            if (datum.subType === 'timeChange') {
              simulator.changeDeviceTime(datum);
            }
            else if(datum.subType === 'prime' || datum.subType === 'reservoirChange'){
              simulator.cartridgeChange(datum);
            }
            else if (datum.subType === 'status') {
              if(datum.status === 'suspended') {
                simulator.suspend(datum);
              }
              else if (datum.status === 'resumed') {
                simulator.resume(datum);
              }
            }
            else if (datum.subType === 'alarm'){
              simulator.alarm(datum);
            }
            else if (datum.subType === 'calibration'){
              simulator.calibration(datum);
            }
            else {
              debug('Unknown deviceEvent subType:', datum.subType);
            }
            break;
          case 'pumpSettings':
            simulator.pumpSettings(datum);
            break;
          case 'smbg':
            simulator.smbg(datum);
            break;
          case 'wizard':
            simulator.wizard(datum);
            break;
          case 'new-day':
            simulator.newDay(datum);
            break;
          case 'temp-basal':
            simulator.tempBasal(datum);
            break;
          case 'cbg':
            simulator.cbg(datum);
            break;
          default:
            debug('[Hand-off to simulator] Unhandled type!', datum.type);
        }
      }
      simulator.finalBasal();

      data.post_records = simulator.getEvents();

      var sessionInfo = {
        delta: {lastEndPosition: data.end_seq} ,
        deviceTags: cfg.deviceInfo.tags,
        deviceTime: cfg.deviceInfo.deviceTime,
        deviceManufacturers: cfg.deviceInfo.manufacturers,
        deviceModel: cfg.deviceInfo.model,
        deviceSerialNumber: cfg.deviceInfo.serialNumber,
        deviceId: cfg.deviceInfo.deviceId,
        start: sundial.utcDateString(),
        timeProcessing: cfg.tzoUtil.type,
        tzName: cfg.timezone,
        version: cfg.version
      };

      cfg.api.upload.toPlatform(
        data.post_records,
        sessionInfo,
        progress,
        cfg.groupId,
        function (err, result) {
          if (err) {
            debug('Error: ', err);
            debug('Result: ', result);
            progress(100);
            return cb(err, data);
          } else {
            progress(100);
            return cb(null, data);
          }
        }
        );
    },

    disconnect: function (progress, data, cb) {
      debug('disconnect');
      progress(100);
      data.disconnect = true;
      cb(null, data);
    },

    cleanup: function (progress, data, cb) {
      debug('in cleanup');
      progress(0);
      cfg.deviceComms.clearPacketHandler();
      cfg.deviceComms.disconnect(function () {
        progress(100);
        data.stage = 'cleanup';
        cb(null, data);
      });
    }
  };
};
