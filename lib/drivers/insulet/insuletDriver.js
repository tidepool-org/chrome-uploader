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

/* eslint-disable import/no-extraneous-dependencies, no-param-reassign, camelcase,
    no-bitwise, no-continue, global-require, import/no-unresolved, object-curly-newline */
import _ from 'lodash';
import { promises as fs } from 'fs';
import path from 'path';
import isElectron from 'is-electron';
import sundial from 'sundial';

import structJs from '../../struct';
import annotate from '../../eventAnnotations';
import common from './common';
import commonFunctions from '../../commonFunctions';
import logic from './objectBuildingLogic';
import insuletSimulatorMaker from './insuletSimulator';
import TZOUtil from '../../TimezoneOffsetUtil';

const isBrowser = typeof window !== 'undefined';
const debug = isBrowser ? require('bows')('InsuletDriver') : console.log;

module.exports = (config) => {
  const cfg = _.clone(config);
  let buf;
  let bytes;
  const struct = structJs();

  const BG_UNITS = 'mg/dL';

  let isDash = false; // Dash PDM has different output values

  _.merge(cfg, {
    deviceInfo: {
      tags: ['insulin-pump'],
      manufacturers: ['Insulet'],
    },
  });

  // all insulin unit readings are in .01 unit increments, so we divide by 100.0 to get units
  // (multiplying by 0.01 tends to cause floating point issues)
  const toUnits = (x) => x / 100.0;

  // Insulet reports percentage temp basals as +/- integers [-100, 100+]
  // i.e., -50 for 50% of the scheduled basal rate
  const convertTempPercentageToNetBasal = (x) => {
    // 0 means there *wasn't* a temp basal in this record
    if (x === 0) {
      return null;
    }
    return 1.0 + (x / 100.0);
  };

  // This is a particularly weak checksum algorithm but that's what Insulet uses...
  const weakChecksum = (offset, count) => {
    let total = 0;
    for (let i = 0; i < count; ++i) {
      total += bytes[offset + i];
    }
    return total & 0xFFFF;
  };

  const getRecord = (offset) => {
    const recsize = struct.extractBEShort(bytes, offset);
    let retval = {};

    if (recsize) {
      if ((recsize + offset) > bytes.length) {
        return null;
      }
      retval = {
        recsize,
        packetlen: recsize + 2,
        rawdata: new Uint8Array(buf, offset + 2, recsize - 2),
        chksum: struct.extractBEShort(bytes, offset + recsize),
        calcsum: weakChecksum(offset + 2, recsize - 2),
      };
      retval.valid = (retval.calcsum === retval.chksum);
    } else {
      retval.valid = false;
    }
    return retval;
  };

  const addTimestamp = (o) => {
    const dt = sundial.buildTimestamp(o);
    if (dt) {
      o.jsDate = dt;
      o.deviceTime = sundial.formatDeviceTime(dt);
    }
  };

  const decodeSerial = (encoded) => {
    const phoneFamily = (encoded & 0x7E000000) >> 25;
    const year = (encoded & 0x01E00000) >> 21;
    const reset = (encoded & 0x001E0000) >> 17;
    const sequence = (encoded & 0x1FFFC) >> 2;

    // eslint-disable-next-line prefer-template
    const serialNumber = _.padStart(phoneFamily.toString(), 2, '0')
       + _.padStart(year.toString(), 2, '0')
       + _.padStart(reset.toString(), 2, '0')
       + '-'
       + _.padStart(sequence.toString(), 5, '0');
    return serialNumber;
  };

  // postprocess is a function that accepts a record, optionally modifies it,
  // and returns null if the record is good, and a message if processing should halt.
  const fixedRecords = {
    ibf_version: {
      format: '6S8z8z',
      fields: [
        'ibf_maj', 'ibf_min', 'ibf_patch',
        'eng_maj', 'eng_min', 'eng_patch',
        'vendorid', 'productid',
      ],
      postprocess: (rec) => {
        if ((rec.ibf_maj === 0) && (rec.ibf_min >= 1)
          && (rec.eng_maj === 0) && (rec.ibf_min >= 1)
          && (rec.vendorid === 'Insulet') && (rec.productid === 'OmniPod')) {
          return null;
        }
        return 'ibf_version record is incompatible with this driver.';
      },
    },
    pdm_version: {
      format: '3S',
      fields: [
        'pdm_maj', 'pdm_min', 'pdm_patch',
      ],
      postprocess: (rec) => {
        if (((rec.pdm_maj === 2) && (rec.pdm_min >= 3)) // Eros PDM
            || ((rec.pdm_maj === 3) && (rec.pdm_min === 0))) { // Dash PDM
          return null;
        }
        return 'pdm_version record is incompatible with this driver.';
      },
    },
    // this format gets rewritten before being used
    mfg_data: { format: '??z', fields: ['data'] },
    basal_programs_hdr: {
      format: '3S',
      fields: ['num_progs', 'enabled_idx', 'max_name_size'],
    },
    // this format gets rewritten before being used
    basal_programs_name: { format: 'S??z', fields: ['index', 'name'] },
    eeprom_settings: {
      format: '13.4i2b4.b5.b.bb8.i19.7b3sb19.bi',
      fields: [
        'BOLUS_INCR',
        'BOLUS_MAX',
        'BASAL_MAX',
        'LOW_VOL',
        'AUTO_OFF',
        'LANGUAGE',
        'EXPIRE_ALERT',
        'BG_REMINDER',
        'CONF_ALERT',
        'REMDR_ALERT',
        'REMOTE_ID',
        'TEMP_BAS_TYPE',
        'EXT_BOL_TYPE',
        'BOL_REMINDER',
        'BOL_CALCS',
        'BOL_CALCS_REVERSE',
        'BG_DISPLAY',
        'BG_SOUND',
        'BG_MIN',
        'BG_GOAL_LOW',
        'BG_GOAL_UP',
        'INSULIN_DURATION',
        'ALARM_REPAIR_COUNT',
        'PDM_CONFIG',
      ],
      postprocess: (rec) => {
        rec.bolus_incr_units = toUnits(rec.BOLUS_INCR);
        rec.bolus_max_units = toUnits(rec.BOLUS_MAX);
        rec.basal_max_units = toUnits(rec.BASAL_MAX);
        rec.low_vol_units = toUnits(rec.LOW_VOL);
        if (isDash) {
          rec.serial_number = decodeSerial(rec.REMOTE_ID);
        } else {
          rec.serial_number = rec.REMOTE_ID.toString();
        }

        if (rec.BG_DISPLAY === 0) {
          rec.units = 'mg/dL';
        } else {
          rec.units = 'mmol/L';
        }
        rec.insulin_duration_msec = rec.INSULIN_DURATION * sundial.MIN30_TO_MSEC;
        return null;
      },
    },
    profile_hdr: {
      format: 'b6.Si',
      fields: [
        'profile_idx',
        'error_code',
        'operation_time',
      ],
    },
    log_hdr: {
      format: '7bS3b.S',
      fields: [
        'logs_info_revision',
        'insulin_history_revision',
        'alarm_history_revision',
        'blood_glucose_revision',
        'insulet_stats_revision',
        'day',
        'month',
        'year',
        'seconds',
        'minutes',
        'hours',
        'num_log_descriptions',
      ],
    },
    log_description: {
      format: '5S2N',
      fields: [
        'log_index', 'backup', 'location', 'has_variable', 'record_size',
        'first_index', 'last_index',
      ],
    },
    log_record: {
      format: 'bNSSbbsbbb.i',
      fields: [
        'log_id', 'log_index', 'record_size', 'error_code',
        'day', 'month', 'year', 'seconds', 'minutes', 'hours',
        'secs_since_powerup',
      ],
    },
    history_record: {
      format: 'bNSSbbsbbb.ins..',
      fields: [
        'log_id', 'log_index', 'record_size', 'error_code',
        'day', 'month', 'year', 'seconds', 'minutes', 'hours',
        'secs_since_powerup', 'rectype', 'flags',
      ],
    },
  };

  const logRecords = {
    0x0000: {
      value: 0x0000,
      name: 'End_Marker',
      format: '',
      fields: [],
    },
    0x0001: {
      value: 0x0001,
      name: 'Deactivate',
      format: '',
      fields: [],
    },
    0x0002: {
      value: 0x0002,
      name: 'Time_Change',
      format: '3b.',
      fields: [
        'seconds',
        'minutes',
        'hours',
      ],
    },
    0x0004: {
      value: 0x0004,
      name: 'Bolus',
      format: 'ishs',
      fields: [
        'volume',
        'extended_duration_minutes',
        'calculation_record_offset',
        'immediate_duration_seconds',
      ],
      postprocess: (rec) => {
        rec.volume_units = toUnits(rec.volume);
        // this occurs if an extended bolus is programmed but the bolus is interrupted
        // before any of the extended portion is delivered!
        if (rec.extended_duration_minutes === 65535) {
          rec.extended_duration_msec = 0;
        } else if (rec.extended_duration_minutes === 0) {
          // a zero *here* means that this isn't an extended bolus
          // and we need to distinguish between two types of zeros -
          // dual-wave boluses interrupted before any of the extended was
          // delivered (i.e., the case above ^) or non-extended boluses (here)
          // so here we use null instead of 0
          rec.extended_duration_msec = null;
        } else {
          rec.extended_duration_msec = rec.extended_duration_minutes * sundial.MIN_TO_MSEC;
        }
        rec.immediate_duration_msec = rec.immediate_duration_seconds * sundial.SEC_TO_MSEC;
      },
    },
    0x0008: {
      value: 0x0008,
      name: 'Basal_Rate',
      format: 'ish',
      fields: [
        'basal_rate', 'duration', 'percent',
      ],
      postprocess: (rec) => {
        rec.basal_rate_units_per_hour = toUnits(rec.basal_rate);
        rec.duration_msec = rec.duration * sundial.MIN_TO_MSEC;
        rec.temp_basal_percent = convertTempPercentageToNetBasal(rec.percent);
      },
    },
    0x0010: {
      value: 0x0010,
      name: 'Suspend',
      format: '',
      fields: [],
    },
    0x0020: {
      value: 0x0020,
      name: 'Date_Change',
      format: 'bbs',
      fields: [
        'day',
        'month',
        'year',
      ],
    },
    0x0040: {
      value: 0x0040,
      name: 'Suggested_Calc',
      format: '4in3i6s',
      fields: [
        'correction_delivered', 'carb_bolus_delivered',
        'correction_programmed', 'carb_bolus_programmed',
        'correction_suggested', 'carb_bolus_suggested',
        'correction_iob', 'meal_iob',
        'correction_factor_used', 'current_bg',
        'target_bg', 'bg_correction_threshold',
        'carb_grams', 'ic_ratio_used',
      ],
      postprocess: (rec) => {
        rec.corr_units_delivered = toUnits(rec.correction_delivered);
        rec.carb_bolus_units_delivered = toUnits(rec.carb_bolus_delivered);
        rec.corr_units_programmed = toUnits(rec.correction_programmed);
        rec.carb_bolus_units_programmed = toUnits(rec.carb_bolus_programmed);
        rec.corr_units_suggested = toUnits(rec.correction_suggested);
        rec.carb_bolus_units_suggested = toUnits(rec.carb_bolus_suggested);
        rec.corr_units_iob = toUnits(rec.correction_iob);
        rec.meal_units_iob = toUnits(rec.meal_iob);

        if (isDash) {
          rec.correction_factor_used /= 100.0;
          rec.ic_ratio_used /= 10.0;
          rec.carb_grams /= 10.0;
        }
      },
    },
    0x0080: {
      value: 0x0080,
      name: 'Remote_Hazard_Alarm',
      format: '2bs3b.4s',
      fields: [
        'day', 'month', 'year', 'seconds', 'minutes', 'hours',
        'alarm_type', 'file_number', 'line_number', 'error_code',
      ],
    },
    0x0400: {
      value: 0x0400,
      name: 'Alarm',
      format: '2bs3b.4s',
      fields: [
        'day', 'month', 'year', 'seconds', 'minutes', 'hours',
        'alarm_type', 'file_number', 'line_number', 'error_code',
      ],
    },
    0x0800: {
      value: 0x0800,
      name: 'Blood_Glucose',
      format: 'is24z24zb.',
      fields: [
        'error_code', 'bg_reading',
        'user_tag_1', 'user_tag_2',
        'flags',
      ],
    },
    0x1000: {
      value: 0x1000,
      name: 'Carb',
      format: 'sbb',
      fields: [
        'carbs',
        'was_preset',
        'preset_type',
      ],
    },
    0x2000: {
      value: 0x2000,
      name: 'Terminate_Bolus',
      format: 'is',
      fields: [
        'insulin_left',
        'time_left_minutes',
      ],
      postprocess: (rec) => {
        rec.insulin_units_left = toUnits(rec.insulin_left);
        rec.time_left_msec = rec.time_left_minutes * sundial.MIN_TO_MSEC;
      },
    },
    0x4000: {
      value: 0x4000,
      name: 'Terminate_Basal',
      format: 's',
      fields: [
        'time_left_minutes',
      ],
      postprocess: (rec) => {
        rec.time_left_msec = rec.time_left_minutes * sundial.MIN_TO_MSEC;
      },
    },
    0x8000: {
      value: 0x8000,
      name: 'Activate',
      format: '2S6b',
      fields: [
        'lot_number', 'serial_number',
        'pod_maj', 'pod_min', 'pod_patch',
        'interlock_maj', 'interlock_min', 'interlock_patch',
      ],
    },
    0x10000: {
      value: 0x10000,
      name: 'Resume',
      format: '',
      fields: [],
    },
    0x20000: {
      value: 0x20000,
      name: 'Download',
      format: '',
      fields: [],
    },
    0x40000: {
      value: 0x40000,
      name: 'Occlusion',
      format: '',
      fields: [],
    },
  };

  const PROFILES = {
    carbRatio: {
      value: 11,
      name: 'carbRatio',
      mfrname: 'IC Ratio',
      isBasal: false,
      keyname: 'amount',
      valuename: 'value',
    },
    insulinSensitivity: {
      value: 12,
      name: 'insulinSensitivity',
      mfrname: 'Correction',
      isBasal: false,
      keyname: 'amount',
      valuename: 'value',
    },
    bgTarget: {
      value: 13,
      name: 'bgTarget',
      mfrname: 'Target BG',
      isBasal: false,
      keyname: 'low',
      valuename: 'value',
    },
    bgThreshold: {
      value: 14,
      name: 'bgThreshold',
      mfrname: 'BG Threshold',
      isBasal: false,
      keyname: 'amount',
      valuename: 'value',
    },
    basalprofile0: {
      value: 15,
      name: 'basalprofile0',
      mfrname: 'Basal Profile 0',
      isBasal: true,
      keyname: 'rate',
      valuename: 'units',
    },
    basalprofile1: {
      value: 16,
      name: 'basalprofile1',
      mfrname: 'Basal Profile 1',
      isBasal: true,
      keyname: 'rate',
      valuename: 'units',
    },
    basalprofile2: {
      value: 17,
      name: 'basalprofile2',
      mfrname: 'Basal Profile 2',
      isBasal: true,
      keyname: 'rate',
      valuename: 'units',
    },
    basalprofile3: {
      value: 18,
      name: 'basalprofile3',
      mfrname: 'Basal Profile 3',
      isBasal: true,
      keyname: 'rate',
      valuename: 'units',
    },
    basalprofile4: {
      value: 19,
      name: 'basalprofile4',
      mfrname: 'Basal Profile 4',
      isBasal: true,
      keyname: 'rate',
      valuename: 'units',
    },
    basalprofile5: {
      value: 20,
      name: 'basalprofile5',
      mfrname: 'Basal Profile 5',
      isBasal: true,
      keyname: 'rate',
      valuename: 'units',
    },
    basalprofile6: {
      value: 21,
      name: 'basalprofile6',
      mfrname: 'Basal Profile 6',
      isBasal: true,
      keyname: 'rate',
      valuename: 'units',
    },
  };

  const pump_alarm_record = {
    format: '2bs3b.b.b.2i6b',
    fields: [
      'day', 'month', 'year', 'seconds', 'minutes', 'hours',
      'alarm', 'error_code', 'lot_number', 'seq_number',
      'processor_maj', 'processor_min', 'processor_patch',
      'interlock_maj', 'interlock_min', 'interlock_patch',
    ],
  };

  const BG_FLAGS = {
    MANUAL_FLAG: { value: 0x01, name: 'MANUAL_FLAG' },
    TEMPERATURE_FLAG: { value: 0x02, name: 'TEMPERATURE_FLAG' },
    BELOW_TARGET_FLAG: { value: 0x04, name: 'BELOW_TARGET_FLAG' },
    ABOVE_TARGET_FLAG: { value: 0x08, name: 'ABOVE_TARGET_FLAG' },
    RANGE_ERROR_LOW_FLAG: { value: 0x10, name: 'RANGE_ERROR_LOW_FLAG' },
    RANGE_ERROR_HIGH_FLAG: { value: 0x20, name: 'RANGE_ERROR_HIGH_FLAG' },
    OTHER_ERROR_FLAG: { value: 0x40, name: 'OTHER_ERROR_FLAG' },
  };

  const PDM_CONFIG_FLAGS = {
    SUGGESTED_BOLUS_STYLE: { value: 0x01, name: 'SUGGESTED_BOLUS_STYLE' },
    PRODUCT_ID: { mask: 0x1E, shift: 1, name: 'PRODUCT_ID' },
    LOT_TID_SUPPORT: { value: 0x20, name: 'LOT_TID_SUPPORT' },
    BG_BOARD_TYPE: { mask: 0x3C0, shift: 6, name: 'BG_BOARD_TYPE' },
  };

  const BG_BOARD_TYPES = {
    0: { name: 'Abbott FreeStyle', highest: 500 },
    2: { name: 'LifeScan Verio', highest: 600 },
    3: { name: 'None', highest: 600 },
  };

  const LOG_FLAGS = {
    // TODO: look for this flag and use it to identify
    // extended boluses split over midnight instead of uploading
    // them separately and annotating the extended with the
    // 'insulet/bolus/split-extended' code as we're doing now
    CARRY_OVER_FLAG: { value: 0x01, name: 'CARRY_OVER_FLAG' },
    NEW_DAY_FLAG: { value: 0x02, name: 'NEW_DAY_FLAG' },
    // TODO: we should probably look for this flag on all records
    // and maybe annotate when we find it
    IN_PROGRESS_FLAG: { value: 0x04, name: 'IN_PROGRESS_FLAG' },
    END_DAY_FLAG: { value: 0x08, name: 'END_DAY_FLAG' },
    // TODO: we should probably look for this flag on all records
    // and either annotate or maybe even discard the record when we find it
    UNCOMFIRMED_FLAG: { value: 0x10, name: 'UNCOMFIRMED_FLAG' },
    REVERSE_CORR_FLAG: { value: 0x0100, name: 'REVERSE_CORR_FLAG' },
    MAX_BOLUS_FLAG: { value: 0x0200, name: 'MAX_BOLUS_FLAG' },
    // filter out records marked with ERROR flag as
    // the spec says these are "deleted" and should be ignored
    ERROR: { value: 0x80000000, name: 'ERROR' },
  };

  const LOG_TYPES = {
    HISTORY: { value: 0x03, name: 'HISTORY' },
    PUMP_ALARM: { value: 0x05, name: 'PUMP_ALARM' },
    DELETED: { mask: 0x80000000, name: 'DELETED' },
    // this is an impossible value for a 1-byte LOG_TYPE
    IGNORE: { value: 0x100, name: 'IGNORED by driver' },
  };

  const ALARM_TYPES = {
    AlrmPDM_ERROR0: { value: 0, name: 'AlrmPDM_ERROR0', explanation: 'PDM error', stopsDelivery: 'unknown' },
    AlrmPDM_ERROR1: { value: 1, name: 'AlrmPDM_ERROR1', explanation: 'PDM error', stopsDelivery: 'unknown' },
    AlrmPDM_ERROR2: { value: 2, name: 'AlrmPDM_ERROR2', explanation: 'PDM error', stopsDelivery: 'unknown' },
    AlrmPDM_ERROR3: { value: 3, name: 'AlrmPDM_ERROR3', explanation: 'PDM error', stopsDelivery: 'unknown' },
    AlrmPDM_ERROR4: { value: 4, name: 'AlrmPDM_ERROR4', explanation: 'PDM error', stopsDelivery: 'unknown' },
    AlrmPDM_ERROR5: { value: 5, name: 'AlrmPDM_ERROR5', explanation: 'PDM error', stopsDelivery: 'unknown' },
    AlrmPDM_ERROR6: { value: 6, name: 'AlrmPDM_ERROR6', explanation: 'PDM error', stopsDelivery: 'unknown' },
    AlrmPDM_ERROR7: { value: 7, name: 'AlrmPDM_ERROR7', explanation: 'PDM error', stopsDelivery: 'unknown' },
    AlrmPDM_ERROR8: { value: 8, name: 'AlrmPDM_ERROR8', explanation: 'PDM error', stopsDelivery: 'unknown' },
    AlrmPDM_ERROR9: { value: 9, name: 'AlrmPDM_ERROR9', explanation: 'PDM error', stopsDelivery: 'unknown' },
    AlrmSYSTEM_ERROR10: { value: 10, name: 'AlrmSYSTEM_ERROR10', explanation: 'system error', stopsDelivery: false },
    AlrmSYSTEM_ERROR12: { value: 12, name: 'AlrmSYSTEM_ERROR12', explanation: 'system error', stopsDelivery: 'unknown' },
    AlrmHAZ_REMOTE: { value: 13, name: 'AlrmHAZ_REMOTE', explanation: 'clock reset alarm', stopsDelivery: false },
    AlrmHAZ_PUMP_VOL: { value: 14, name: 'AlrmHAZ_PUMP_VOL', explanation: 'empty reservoir', stopsDelivery: true },
    AlrmHAZ_PUMP_AUTO_OFF: { value: 15, name: 'AlrmHAZ_PUMP_AUTO_OFF', explanation: 'auto-off', stopsDelivery: true },
    AlrmHAZ_PUMP_EXPIRED: { value: 16, name: 'AlrmHAZ_PUMP_EXPIRED', explanation: 'pod expired', stopsDelivery: true },
    AlrmHAZ_PUMP_OCCL: { value: 17, name: 'AlrmHAZ_PUMP_OCCL', explanation: 'pump site occluded', stopsDelivery: true },
    AlrmHAZ_PUMP_ACTIVATE: { value: 18, name: 'AlrmHAZ_PUMP_ACTIVATE', explanation: 'pod is a lump of coal', stopsDelivery: false },
    AlrmADV_KEY: { value: 21, name: 'AlrmADV_KEY', explanation: 'PDM stuck key detected', stopsDelivery: false },
    AlrmADV_PUMP_VOL: { value: 23, name: 'AlrmADV_PUMP_VOL', explanation: 'low reservoir', stopsDelivery: false },
    AlrmADV_PUMP_AUTO_OFF: { value: 24, name: 'AlrmADV_PUMP_AUTO_OFF', explanation: '15 minutes to auto-off warning', stopsDelivery: false },
    AlrmADV_PUMP_SUSPEND: { value: 25, name: 'AlrmADV_PUMP_SUSPEND', explanation: 'suspend done', stopsDelivery: false },
    AlrmADV_PUMP_EXP1: { value: 26, name: 'AlrmADV_PUMP_EXP1', explanation: 'pod expiration advisory', stopsDelivery: false },
    AlrmADV_PUMP_EXP2: { value: 27, name: 'AlrmADV_PUMP_EXP2', explanation: 'pod expiration alert', stopsDelivery: false },
    AlrmSYSTEM_ERROR28: { value: 28, name: 'AlrmSYSTEM_ERROR28', explanation: 'system error', stopsDelivery: 'unknown' },
    AlrmEXP_WARNING: { value: 37, name: 'AlrmEXP_WARNING', explanation: 'pod expiration advisory', stopsDelivery: false },
    AlrmHAZ_PDM_AUTO_OFF: { value: 39, name: 'AlrmHAZ_PDM_AUTO_OFF', explanation: 'auto-off', stopsDelivery: true },
  };

  const LOG_ERRORS = {
    eLogNoErr: { value: 0, name: 'eLogNoErr' },
    eLogGetEEPROMErr: { value: 3, name: 'eLogGetEEPROMErr' },
    eLogCRCErr: { value: 4, name: 'eLogCRCErr' },
    eLogLogIndexErr: { value: 6, name: 'eLogLogIndexErr' },
    eLogRecSizeErr: { value: 8, name: 'eLogRecSizeErr' },
  };

  const TEMP_BASAL_TYPES = {
    0: 'off',
    1: 'percent',
    2: 'Units/hour',
  };

  const getItemWithValue = (list, itemname, valuename, value) => {
    // eslint-disable-next-line no-restricted-syntax
    for (const i in list) {
      if (list[i][valuename] === value) {
        return list[i][itemname];
      }
    }
    return null;
  };

  const getNameForValue = (list, v) => getItemWithValue(list, 'name', 'value', v);

  const getValueForName = (list, n) => getItemWithValue(list, 'value', 'name', n);

  const getFlagNames = (list, v) => {
    const flags = [];
    // eslint-disable-next-line no-restricted-syntax
    for (const i in list) {
      if (list[i].value & v) {
        flags.push(list[i].name);
      }
    }
    return flags.join('|');
  };

  const hasFlag = (flag, v) => {
    if (flag.value & v) {
      return true;
    }
    return false;
  };

  const getFixedRecord = (recname, offset) => {
    const rec = getRecord(offset);
    const decoded = struct.unpack(rec.rawdata, 0,
      fixedRecords[recname].format, fixedRecords[recname].fields);
    _.assign(rec, decoded);
    return rec;
  };

  const getManufacturingData = (offset) => {
    const rec = getRecord(offset);
    const fmt = `${rec.recsize}z`;
    const decoded = struct.unpack(rec.rawdata, 0, fmt, fixedRecords.mfg_data.fields);
    _.assign(rec, decoded);
    return rec;
  };

  const getBasalProgramNames = (offset) => {
    const basalProgramsHeader = getFixedRecord('basal_programs_hdr', offset);
    const basalProgramNames = [];
    for (let i = 0; i < 7; ++i) {
      const prgOffset = 6 + i * (2 + basalProgramsHeader.max_name_size);
      // the format for the name data is dependent on the name size
      fixedRecords.basal_programs_name.format =
        `S${basalProgramsHeader.max_name_size}z`;
      const prog = struct.unpack(basalProgramsHeader.rawdata, prgOffset,
        fixedRecords.basal_programs_name.format,
        fixedRecords.basal_programs_name.fields);
      prog.name = prog.name.replace(/\./g, '-');
      prog.name = prog.name.replace(/\$/g, '');
      basalProgramNames.push(prog);
    }
    basalProgramsHeader.names = basalProgramNames;
    return basalProgramsHeader;
  };

  const getProfiles = (offset, basalProgramNames) => {
    const profiles = [];
    let totalLen = 0;
    // there are 11 profiles in a row
    for (let i = 0; i < 11; ++i) {
      // profiles consist of a header plus 48 integers
      const profile = getFixedRecord('profile_hdr', offset);
      profile.standard_name = getItemWithValue(PROFILES, 'mfrname', 'value', profile.profile_idx);
      if (getItemWithValue(PROFILES, 'isBasal', 'value', profile.profile_idx)) {
        // user-assigned name is at an index in the program names
        // relative to the profile index, which starts at 15 in
        // insulet data
        profile.name = basalProgramNames[profile.profile_idx - 15].name;
      }
      profile.steps = [];
      const step_offset = struct.structlen(fixedRecords.profile_hdr.format);
      for (let j = 0; j < 48; ++j) {
        let val = struct.extractInt(profile.rawdata, step_offset + j * 4);
        if (isDash) {
          if (profile.standard_name === PROFILES.carbRatio.mfrname) {
            val /= 10.0;
          }
        }

        profile.steps.push({
          // profile steps are every 30 minutes starting at midnight
          // convert them to milliseconds
          starttime: j * sundial.MIN30_TO_MSEC,
          value: val,
        });
        // if it's a basal profile, add the units conversion
        if (getItemWithValue(PROFILES, 'isBasal', 'value', profile.profile_idx)) {
          profile.steps[j].units = toUnits(profile.steps[j].value);
        }
      }
      profiles.push(profile);
      offset += profile.packetlen;
      totalLen += profile.packetlen;
    }
    profiles.packetlen = totalLen;
    return profiles;
  };

  const getLogDescriptions = (offset) => {
    const logDescriptions = getFixedRecord('log_hdr', offset);
    logDescriptions.descs = [];
    addTimestamp(logDescriptions);
    for (let i = 0; i < logDescriptions.num_log_descriptions; ++i) {
      const descOffset = 15 + i * 18;
      const desc = struct.unpack(logDescriptions.rawdata, descOffset,
        fixedRecords.log_description.format,
        fixedRecords.log_description.fields);
      logDescriptions.descs.push(desc);
    }
    return logDescriptions;
  };

  const getLogRecord = (offset) => {
    const rec = getRecord(offset);
    if (rec === null) {
      // packet is incomplete
      return null;
    }
    let logheader = struct.unpack(rec.rawdata, 0,
      fixedRecords.log_record.format,
      fixedRecords.log_record.fields);
    if (logheader.log_id === LOG_TYPES.HISTORY.value) { // history
      logheader = struct.unpack(rec.rawdata, 0,
        fixedRecords.history_record.format,
        fixedRecords.history_record.fields);
      if (logheader.error_code) {
        logheader.error_text = getNameForValue(LOG_ERRORS, logheader.error_code);
      }
      if (logheader.flags !== 0) {
        logheader.flag_text = getFlagNames(LOG_FLAGS, logheader.flags);
      }
    } else {
      // There are other record types but we don't have documentation on them,
      // so we're going to ignore them.
    }
    _.assign(rec, logheader);
    if (rec.rectype & LOG_TYPES.DELETED.mask) {
      // this is a deleted record so we're going to only return
      // a deleted flag and a size
      return { rectype: LOG_TYPES.IGNORE.value, packetlen: rec.packetlen };
    }
    // now process further data, if there is any
    if (rec.log_id === LOG_TYPES.HISTORY.value) {
      if (logRecords[rec.rectype]) {
        if (rec.rectype !== 0) {
          addTimestamp(rec);
        }
        rec.rectype_name = logRecords[rec.rectype].name;
        const detail = struct.unpack(rec.rawdata,
          struct.structlen(fixedRecords.history_record.format),
          logRecords[rec.rectype].format,
          logRecords[rec.rectype].fields);
        if (logRecords[rec.rectype].postprocess) {
          logRecords[rec.rectype].postprocess(detail);
        }
        rec.detail = detail;
      } else {
        debug('Unknown history record type %d', rec.rectype);
      }
    } else if (rec.log_id === LOG_TYPES.PUMP_ALARM.value) {
      rec.alarm = struct.unpack(rec.rawdata,
        struct.structlen(fixedRecords.log_record.format),
        pump_alarm_record.format,
        pump_alarm_record.fields);
      addTimestamp(rec.alarm);
      rec.alarm.alarm_text = getNameForValue(ALARM_TYPES, rec.alarm.alarm);
    } else {
      // all other log types are meaningless to us, we're told
      return { rectype: LOG_TYPES.IGNORE.value, packetlen: rec.packetlen };
    }
    return rec;
  };

  const getLogRecords = (recordset) => {
    // this is where we get the position-independent information
    let offset = recordset.independent_offset;
    let done = false;
    const log_records = [];
    let index = 0;
    while (!done) {
      const rec = getLogRecord(offset);
      if (rec === null) {
        // final packet is incomplete
        done = true;
      } else {
        offset += rec.packetlen;
        if (offset >= bytes.length) {
          done = true;
        }
        if (rec.rectype === LOG_TYPES.IGNORE.value) {
          continue;
        }
        if (rec.error_code) {
          // according to the spec, a record with an error code should not be parsed
          debug(`logRecord error (${rec.error_text}) at ${rec.deviceTime}, dropping.`);
        } else {
          index += 1;
          rec.index = index;
          log_records.push(rec);
        }
      }
    }

    return log_records;
  };

  // returns indices of the matching records
  const findSpecificRecords = (recordlist, rectypelist) => {
    const result = [];
    for (let i = 0; i < recordlist.length; ++i) {
      for (let j = 0; j < rectypelist.length; ++j) {
        if (recordlist[i].rectype === rectypelist[j]) {
          result.push(i);
        }
      }
    }
    return result.sort((a, b) => recordlist[a].log_index - recordlist[b].log_index);
  };

  // these aren't history records, so we have to find them separately
  const findPumpAlarmRecords = (recordlist) => {
    const result = [];
    for (let i = 0; i < recordlist.length; ++i) {
      // log_index of -1 doesn't have a timestamp, not a valid record
      if (recordlist[i].alarm != null && recordlist[i].log_index >= 0) {
        result.push(i);
      }
    }
    return result.sort((a, b) => recordlist[a].log_index - recordlist[b].log_index);
  };

  const linkWizardRecords = (data, bolusrecs) => {
    // we need to see if two (or more!) boluses come from the same calculation (wizard) record
    // if so, they're actually a dual bolus, and need to be consolidated
    // so we create a table of backlinks from the calc records to the bolus records that
    // refer to them
    const wizRecords = {};
    for (let b = 0; b < bolusrecs.length; ++b) {
      const bolus = data.log_records[bolusrecs[b]];
      let wiz_idx;
      // these are boluses not linked with wizard records (i.e., quick boluses)
      // but they could be dual-wave boluses with a normal and square component
      // so we use the UTC timestamp to index them
      if (bolus.detail.calculation_record_offset === 0) {
        bolus.index = bolus.log_index;
        cfg.tzoUtil.fillInUTCInfo(bolus, bolus.jsDate);
        wiz_idx = bolus.time;
      } else {
        wiz_idx = bolusrecs[b] + bolus.detail.calculation_record_offset;
      }

      let newOffset = null;
      if (isDash && hasFlag(LOG_FLAGS.CARRY_OVER_FLAG, bolus.flags)) {
        const sugg_calc = data.log_records[wiz_idx];
        if (sugg_calc && sugg_calc.hours > 0 && bolus.detail.extended_duration_msec !== null) {
          // wizard record for extended bolus should be at midnight, but isn't,
          // so we have to assume that the offset was not calculated correctly by the PDM

          newOffset = bolusrecs[b];
          // search for correct offset
          while (data.log_records[newOffset].hours !== 0 ||
                data.log_records[newOffset].rectype_name !== 'Suggested_Calc') {
            newOffset -= 1;
          }
          wiz_idx = newOffset;
        }
      }
      const r = wizRecords[wiz_idx] || {};
      if (newOffset) {
        // also correct immediate portion and remove incorrect offset from PDM
        r.immediate = bolusrecs[b] + 1;
        const oldRecord = _.find(wizRecords, (element) => element.immediate === r.immediate);
        if (oldRecord) {
          delete oldRecord.immediate;
        }
      }
      if (bolus.detail.extended_duration_msec !== null ||
          (r.immediate && bolus.detail.extended_duration_msec === null && bolus.detail.immediate_duration_msec === 0)) {
        // the extended portion of a dual-wave bolus is split into two records
        // if it crosses local (deviceTime) midnight, and for cancelled extended
        // boluses and extended portions after midnight the duration can be zero
        if (r.extended != null) {
          r.extended2 = bolusrecs[b];
        } else {
          r.extended = bolusrecs[b];
        }
      } else {
        r.immediate = bolusrecs[b];
      }
      if (r.immediate && r.extended) {
        r.isDual = true;
      }
      wizRecords[wiz_idx] = r;
    }
    return wizRecords;
  };

  const buildAlarmRecords = (data, records) => {
    let alarmrecs = findSpecificRecords(data.log_records, [
      getValueForName(logRecords, 'Remote_Hazard_Alarm'),
      getValueForName(logRecords, 'Alarm'),
    ]);
    const pumpAlarms = findPumpAlarmRecords(data.log_records);
    alarmrecs = alarmrecs.concat(pumpAlarms);
    const postrecords = [];

    function makeSuspended(anAlarm) {
      // only build a suspended in conjunction with a stopsDelivery alarm
      // if the alarm is a history record with a log index
      // otherwise we can't be certain of our conversion to UTC
      // and thus really don't want to be mucking with the basal events stream
      if (anAlarm.detail && anAlarm.log_index) {
        const suspend = cfg.builder.makeDeviceEventSuspend()
          .with_deviceTime(anAlarm.deviceTime)
          .with_reason({ suspended: 'automatic' });
        suspend.set('index', anAlarm.log_index);
        cfg.tzoUtil.fillInUTCInfo(suspend, anAlarm.jsDate);
        return suspend.done();
      }
      return null;
    }

    function makeSuspendBasal(anAlarm) {
      // we don't call .done() on the basal b/c it still needs duration added
      // which happens in the simulator
      // only build a suspended in conjunction with a stopsDelivery alarm
      // if the alarm is a history record with a log index
      // otherwise we can't be certain of our conversion to UTC
      // and thus really don't want to be mucking with the basal events stream
      if (anAlarm.detail && anAlarm.log_index) {
        const basal = cfg.builder.makeSuspendBasal()
          .with_deviceTime(anAlarm.deviceTime || anAlarm.alarm.deviceTime);
        basal.set('index', anAlarm.log_index);
        cfg.tzoUtil.fillInUTCInfo(basal, anAlarm.jsDate || anAlarm.alarm.jsDate);
        return basal;
      }
      return null;
    }

    for (let a = 0; a < alarmrecs.length; ++a) {
      const alarm = data.log_records[alarmrecs[a]];
      let postalarm = null;
      let postsuspend = null;
      let postbasal = null;
      let alarmValue = null;

      postalarm = cfg.builder.makeDeviceEventAlarm()
        .with_deviceTime(alarm.deviceTime || alarm.alarm.deviceTime);
      cfg.tzoUtil.fillInUTCInfo(postalarm, alarm.jsDate || alarm.alarm.jsDate);
      // handle history-style alarms
      if (alarm.detail) {
        alarmValue = alarm.detail.alarm_type;
        postalarm.set('index', alarm.log_index);
      // handle non-history alarms
      } else if (alarm.alarm.alarm_text != null) {
        // alarm.alarm.alarm is not a typo!
        alarmValue = alarm.alarm.alarm;
      } else {
        postalarm = null;
      }
      if (postalarm && postalarm.time === '**REQUIRED**') {
        // will occur for alarms that aren't bootstrappable
        // since we're no longer erroring on failure to look up UTC info
        postalarm = null;
      }
      const alarmText = getNameForValue(ALARM_TYPES, alarmValue);
      if (postalarm != null) {
        switch (alarmValue) {
          // alarmType `other`
          // History - ALARM
          case ALARM_TYPES.AlrmADV_KEY.value:
          case ALARM_TYPES.AlrmEXP_WARNING.value:
          case ALARM_TYPES.AlrmSYSTEM_ERROR10.value:
          case ALARM_TYPES.AlrmSYSTEM_ERROR12.value:
          case ALARM_TYPES.AlrmSYSTEM_ERROR28.value:
          case ALARM_TYPES.AlrmPDM_ERROR0.value:
          case ALARM_TYPES.AlrmPDM_ERROR1.value:
          case ALARM_TYPES.AlrmPDM_ERROR2.value:
          case ALARM_TYPES.AlrmPDM_ERROR3.value:
          case ALARM_TYPES.AlrmPDM_ERROR4.value:
          case ALARM_TYPES.AlrmPDM_ERROR5.value:
          case ALARM_TYPES.AlrmPDM_ERROR6.value:
          case ALARM_TYPES.AlrmPDM_ERROR7.value:
          case ALARM_TYPES.AlrmPDM_ERROR8.value:
          case ALARM_TYPES.AlrmPDM_ERROR9.value: // History - REMOTE HAZ
          case ALARM_TYPES.AlrmHAZ_REMOTE.value:
          case ALARM_TYPES.AlrmHAZ_PUMP_ACTIVATE.value:
          case ALARM_TYPES.AlrmADV_PUMP_AUTO_OFF.value:
          case ALARM_TYPES.AlrmADV_PUMP_SUSPEND.value:
          case ALARM_TYPES.AlrmADV_PUMP_EXP1.value:
          case ALARM_TYPES.AlrmADV_PUMP_EXP2.value:
            postalarm = postalarm.with_alarmType('other')
              .with_payload({
                alarmText,
                explanation: ALARM_TYPES[alarmText].explanation,
                stopsDelivery: ALARM_TYPES[alarmText].stopsDelivery,
              })
              .done();
            break;
          // Pump advisory and hazard alarm (non-History)
          // alarmType `low_insulin`
          case ALARM_TYPES.AlrmADV_PUMP_VOL.value:
            postalarm = postalarm.with_alarmType('low_insulin')
              .with_payload({
                alarmText,
                explanation: ALARM_TYPES[alarmText].explanation,
                stopsDelivery: ALARM_TYPES[alarmText].stopsDelivery,
              })
              .done();
            break;
          // alarmType `no_insulin`
          case ALARM_TYPES.AlrmHAZ_PUMP_VOL.value:
            postsuspend = makeSuspended(alarm);
            postbasal = makeSuspendBasal(alarm);
            postalarm = postalarm.with_alarmType('no_insulin')
              .with_payload({
                alarmText: getNameForValue(ALARM_TYPES, alarmValue),
                explanation: ALARM_TYPES[alarmText].explanation,
                stopsDelivery: ALARM_TYPES[alarmText].stopsDelivery,
              })
              .with_status(postsuspend)
              .done();
            break;
          // alarmType `occlusion`
          case ALARM_TYPES.AlrmHAZ_PUMP_OCCL.value:
            postsuspend = makeSuspended(alarm);
            postbasal = makeSuspendBasal(alarm);
            postalarm = postalarm.with_alarmType('occlusion')
              .with_payload({
                alarmText: getNameForValue(ALARM_TYPES, alarmValue),
                explanation: ALARM_TYPES[alarmText].explanation,
                stopsDelivery: ALARM_TYPES[alarmText].stopsDelivery,
              })
              .with_status(postsuspend)
              .done();
            break;
          // alarmType `no_delivery`
          case ALARM_TYPES.AlrmHAZ_PUMP_EXPIRED.value:
            postsuspend = makeSuspended(alarm);
            postbasal = makeSuspendBasal(alarm);
            postalarm = postalarm.with_alarmType('no_delivery')
              .with_payload({
                alarmText: getNameForValue(ALARM_TYPES, alarmValue),
                explanation: ALARM_TYPES[alarmText].explanation,
                stopsDelivery: ALARM_TYPES[alarmText].stopsDelivery,
              })
              .with_status(postsuspend)
              .done();
            break;
          // alarmType `auto_off`
          case ALARM_TYPES.AlrmHAZ_PDM_AUTO_OFF.value:
          case ALARM_TYPES.AlrmHAZ_PUMP_AUTO_OFF.value:
            // TODO: clarify with Insulet or get data to figure out whether this (below) is
            // a warning or the actual auto-off; the spec is confused
            postsuspend = makeSuspended(alarm);
            postbasal = makeSuspendBasal(alarm);
            postalarm = postalarm.with_alarmType('auto_off')
              .with_payload({
                alarmText: getNameForValue(ALARM_TYPES, alarmValue),
                explanation: ALARM_TYPES[alarmText].explanation,
                stopsDelivery: ALARM_TYPES[alarmText].stopsDelivery,
              })
              .with_status(postsuspend)
              .done();
            break;
          // for alarm codes not documented in the spec
          default:
            if (postalarm) {
              postalarm = postalarm.with_alarmType('other')
                .done();
            }
            break;
        }
        postrecords.push(postalarm);
      }
      if (postsuspend != null) {
        postrecords.push(postsuspend);
      }
      if (postbasal != null) {
        postrecords.push(postbasal);
      }
    }
    return records.concat(postrecords);
  };

  const buildBolusRecords = (data, records) => {
    const bolusrecs = findSpecificRecords(data.log_records, [
      getValueForName(logRecords, 'Bolus'),
    ]);
    const wizRecords = linkWizardRecords(data, bolusrecs);
    const postrecords = [];

    for (let b = 0; b < bolusrecs.length; ++b) {
      const bolus = data.log_records[bolusrecs[b]];
      let wiz_idx;
      // quick boluses are indexed by UTC timestamp
      if (bolus.detail.calculation_record_offset === 0) {
        wiz_idx = bolus.time;
      } else {
        wiz_idx = bolusrecs[b] + bolus.detail.calculation_record_offset;
      }

      let postbolus = null;
      if (wizRecords[wiz_idx]) {
        if (wizRecords[wiz_idx].immediate !== bolusrecs[b] && // check if bolus is linked to wizard record
            wizRecords[wiz_idx].extended !== bolusrecs[b] &&
            wizRecords[wiz_idx].extended2 !== bolusrecs[b] &&
            data.log_records[wizRecords[wiz_idx].immediate].detail.volume_units !== 0) { // and that it hasn't been interrupted
          debug(`Wizard record offset provided by PDM is incorrect: Bolus ${bolusrecs[b]} at ${bolus.deviceTime} with flag text ${bolus.flag_text} not found in wizard record ${wiz_idx} linked to ${JSON.stringify(wizRecords[wiz_idx])}`);
          continue;
        }

        // if we already did this dual or square bolus, skip it on the second round
        if (wizRecords[wiz_idx].handled) {
          continue;
        }

        if (wizRecords[wiz_idx].isDual) {
          const ext = wizRecords[wiz_idx].extended;
          const ext2 = wizRecords[wiz_idx].extended2 || null;
          const imm = wizRecords[wiz_idx].immediate;
          postbolus = cfg.builder.makeDualBolus()
            .with_normal(data.log_records[imm].detail.volume_units)
            .with_deviceTime(data.log_records[imm].deviceTime)
            .set('jsDate', data.log_records[imm].jsDate)
            .set('index', data.log_records[imm].log_index);
          cfg.tzoUtil.fillInUTCInfo(postbolus, data.log_records[imm].jsDate);
          if (ext2 != null) {
            postbolus = postbolus.with_extended(common.fixFloatingPoint(
              data.log_records[ext].detail.volume_units + data.log_records[ext2].detail.volume_units,
              2,
            ))
              .with_duration(
                data.log_records[ext].detail.extended_duration_msec + data.log_records[ext2].detail.extended_duration_msec,
              )
              .done();
          } else {
            if (data.log_records[ext].detail.extended_duration_msec === null) {
              // extended bolus was cancelled with zero duration, with either zero or a
              // very small extended portion delivered
              postbolus = postbolus.with_extended(data.log_records[ext].detail.volume_units)
                .with_duration(0);
            } else {
              postbolus = postbolus.with_extended(data.log_records[ext].detail.volume_units)
                .with_duration(data.log_records[ext].detail.extended_duration_msec);
            }
            postbolus = postbolus.done();
          }
          wizRecords[wiz_idx].handled = true;
        } else if (bolus.detail.extended_duration_msec !== null) {
          const square2 = wizRecords[wiz_idx].extended2 || null;
          postbolus = cfg.builder.makeSquareBolus()
            .with_deviceTime(bolus.deviceTime)
            .set('jsDate', bolus.jsDate)
            .set('index', bolus.log_index);
          cfg.tzoUtil.fillInUTCInfo(postbolus, bolus.jsDate);
          if (square2 != null) {
            postbolus = postbolus.with_extended(common.fixFloatingPoint(
              bolus.detail.volume_units + data.log_records[square2].detail.volume_units,
              2,
            ))
              .with_duration(
                bolus.detail.extended_duration_msec + data.log_records[square2].detail.extended_duration_msec,
              ).done();
          } else {
            postbolus.with_extended(bolus.detail.volume_units)
              .with_duration(bolus.detail.extended_duration_msec);
            const millisInDay = sundial.getMsFromMidnight(postbolus.time, postbolus.timezoneOffset);
            // extended boluses with timestamps at "precisely" (within 5 sec.) of midnight
            // might actually be the second half of a previous dual- or square-wave bolus
            // since Insulet always splits these records when they cross midnight
            // when there isn't a wizard record to tie split records together, we don't
            // know if this is a component of a split, so we annotate
            if (millisInDay <= 5000 && !data.log_records[wiz_idx]) {
              annotate.annotateEvent(postbolus, 'insulet/bolus/split-extended');
            }
            postbolus = postbolus.done();
          }
          wizRecords[wiz_idx].handled = true;
        } else if (bolus.detail.immediate_duration_msec !== 0) {
          postbolus = cfg.builder.makeNormalBolus()
            .with_normal(bolus.detail.volume_units)
            .with_deviceTime(bolus.deviceTime)
            .set('jsDate', bolus.jsDate)
            .set('index', bolus.log_index);
          cfg.tzoUtil.fillInUTCInfo(postbolus, bolus.jsDate);
          postbolus = postbolus.done();
        } else if (bolus.detail.volume_units !== 0) {
          debug('Unexpected bolus of nonzero volume %d but zero duration!', bolus.detail.volume_units);
        } else {
          // we thought we could ignore zero-volume boluses, but it turns out they could
          // be the result of an interrupted non-zero-volume bolus (when followed by a
          // bolus termination)
          postbolus = cfg.builder.makeNormalBolus()
            .with_normal(bolus.detail.volume_units)
            .with_deviceTime(bolus.deviceTime)
            .set('jsDate', bolus.jsDate)
            .set('index', bolus.log_index);
          cfg.tzoUtil.fillInUTCInfo(postbolus, bolus.jsDate);
          postbolus = postbolus.done();
        }
      }

      if (postbolus) {
        if (wizRecords[wiz_idx]) {
          const wiz = data.log_records[wiz_idx] || {};
          // wiz will be empty if the bolus was a quick bolus
          // and wiz.detail will be empty in various circumstances that share
          // the common feature that the bolus attempting to link to the
          // wizard record is the first data point (chronologically) in the
          // log records
          // presumably these wizard records are missing because this is
          // the PDM's memory cut-off
          if (!_.isEmpty(wiz) && !_.isEmpty(wiz.detail)) {
            const payload = _.assign({}, wiz.detail);
            let bg = wiz.detail.current_bg;
            if (bg === 65535) {
              // if bg was not given to the wizard, don't report it.
              bg = null;
            }
            let carb = wiz.detail.carb_grams;
            if (carb === 65535) {
              // if carb count was not given to the wizard, don't report it.
              carb = null;
            }
            postbolus.carbInput = carb; /* we need this to delete zero boluses
                                         * without wizard carbs in the simulator */
            let postwiz = cfg.builder.makeWizard()
              .with_recommended({
                carb: wiz.detail.carb_bolus_units_suggested,
                correction: wiz.detail.corr_units_suggested,
                net: logic.calculateNetRecommendation(wiz.detail),
              })
              .with_bgInput(bg)
              .with_carbInput(carb)
              .with_insulinCarbRatio(wiz.detail.ic_ratio_used)
              .with_insulinSensitivity(wiz.detail.correction_factor_used)
              .with_bolus(postbolus)
              .with_payload(payload)
              .with_deviceTime(postbolus.deviceTime) // use bolus time as wizard record may be 00h00
              .with_units(BG_UNITS)
              .set('index', postbolus.index);

            if (wiz.detail.target_bg && wiz.detail.bg_correction_threshold) {
              postwiz = postwiz.with_bgTarget({
                target: wiz.detail.target_bg,
                high: wiz.detail.bg_correction_threshold,
              });
            }

            if (wiz.detail.corr_units_iob || wiz.detail.meal_units_iob) {
              postwiz = postwiz.with_insulinOnBoard(
                common.fixFloatingPoint(wiz.detail.corr_units_iob + wiz.detail.meal_units_iob, 2),
              );
            }

            // if an extended bolus continues past midnight, the wizard entry
            // may have a timestamp of 00h00, so we use the time of the bolus
            // itself as the timestamp
            cfg.tzoUtil.fillInUTCInfo(postwiz, postbolus.jsDate);
            postwiz = postwiz.done();
            postrecords.push(postwiz);
          }
        }
        delete postbolus.jsDate;
        postrecords.push(postbolus);
      }
    }
    return records.concat(postrecords);
  };

  const buildBolusTerminations = (data, records) => {
    const termrecs = findSpecificRecords(data.log_records, [
      getValueForName(logRecords, 'Terminate_Bolus'),
    ]);
    const postrecords = [];
    let postterm = null;
    for (let t = 0; t < termrecs.length; ++t) {
      const term = data.log_records[termrecs[t]];
      // these get fed to the simulator but not uploaded (just used to modify other events)
      // hence not using the object builder
      postterm = {
        type: 'termination',
        subType: 'bolus',
        deviceTime: term.deviceTime,
        missedInsulin: term.detail.insulin_units_left,
        durationLeft: term.detail.time_left_msec,
        index: term.log_index,
      };
      cfg.tzoUtil.fillInUTCInfo(postterm, term.jsDate);
      postrecords.push(postterm);
    }
    return records.concat(postrecords);
  };

  const buildBasalRecords = (data, records) => {
    const basalrecs = findSpecificRecords(data.log_records, [
      getValueForName(logRecords, 'Basal_Rate'),
    ]);
    const postrecords = [];
    let postbasal = null;
    for (let b = 0; b < basalrecs.length; ++b) {
      const basal = data.log_records[basalrecs[b]];
      // for Tidepool's purposes, the 'duration' field of a scheduled basal is
      // how long it's supposed to last. In this case, the answer is "until the next rate
      // change" -- but it's NOT the duration field of the basal record; that's only for
      // temp basals
      if (basal.detail.duration === 0) {
        postbasal = cfg.builder.makeScheduledBasal()
          .with_scheduleName(data.basalPrograms.names[data.basalPrograms.enabled_idx].name)
          .with_rate(basal.detail.basal_rate_units_per_hour)
          .with_deviceTime(basal.deviceTime)
          .set('index', basal.log_index);
        cfg.tzoUtil.fillInUTCInfo(postbasal, basal.jsDate);
      } else {
        postbasal = cfg.builder.makeTempBasal()
          .with_rate(basal.detail.basal_rate_units_per_hour)
          .with_deviceTime(basal.deviceTime)
          .with_duration(basal.detail.duration_msec)
          .set('index', basal.log_index);
        cfg.tzoUtil.fillInUTCInfo(postbasal, basal.jsDate);
        if (basal.detail.temp_basal_percent != null) {
          const suppressed = cfg.builder.makeScheduledBasal()
            .with_rate(common.fixFloatingPoint(
              basal.detail.basal_rate_units_per_hour / basal.detail.temp_basal_percent,
              2,
            ))
            .with_deviceTime(basal.deviceTime)
            .with_time(postbasal.time)
            .with_timezoneOffset(postbasal.timezoneOffset)
            .with_conversionOffset(postbasal.conversionOffset)
            .with_duration(basal.detail.duration_msec);
          postbasal.with_percent(basal.detail.temp_basal_percent)
            .set('suppressed', suppressed);
        }
      }
      postrecords.push(postbasal);
    }
    return records.concat(postrecords);
  };

  // it turns out these records may not actually be implemented
  // occlusions are only represented through pump advisory and hazard alarms
  // TODO: maybe we should just delete this code?
  const buildOcclusionRecords = (data, records) => {
    const occlusionrecs = findSpecificRecords(data.log_records, [
      getValueForName(logRecords, 'Occlusion'),
    ]);
    const postrecords = [];
    let postocc = null;
    for (let o = 0; o < occlusionrecs.length; ++o) {
      const occlusion = data.log_records[occlusionrecs[o]];
      postocc = cfg.builder.makeDeviceEventAlarm()
        .with_deviceTime(occlusion.deviceTime)
        .with_alarmType('occlusion')
        .set('index', occlusion.log_index);
      cfg.tzoUtil.fillInUTCInfo(postocc, occlusion.jsDate);
      postocc = postocc.done();
      postrecords.push(postocc);
    }
    return records.concat(postrecords);
  };

  const buildSuspendRecords = (data, records) => {
    const suspendrecs = findSpecificRecords(data.log_records, [
      getValueForName(logRecords, 'Suspend'),
      getValueForName(logRecords, 'Deactivate'),
    ]);
    const postrecords = [];
    let postsuspend = null;
    let postbasal = null;
    let postreschange = null;
    for (let s = 0; s < suspendrecs.length; ++s) {
      const suspend = data.log_records[suspendrecs[s]];
      postsuspend = cfg.builder.makeDeviceEventSuspend()
        .with_deviceTime(suspend.deviceTime)
        // the spec doesn't really specify circumstances under which suspends happen
        // i.e., 'manual' reason code is an assumption here
        // 'Deactivate' is probably most commonly *not* manual (b/c it's pod expiration)
        // but it *can* be and the event itself doesn't identify
        // in the future we could consider keeping track of the pump warnings that precede
        // (e.g., in the simulator) and attempt to infer the proper reason code that way
        // TODO: consider an annotation here re: unknown reason code
        .with_reason({ suspended: 'manual' })
        .set('index', suspend.log_index);
      cfg.tzoUtil.fillInUTCInfo(postsuspend, suspend.jsDate);
      postsuspend = postsuspend.done();
      if (suspend.rectype_name === 'Deactivate') {
        postreschange = cfg.builder.makeDeviceEventReservoirChange()
          .with_deviceTime(suspend.deviceTime)
          .with_payload({ event: 'pod_deactivation' })
          .with_status(postsuspend)
          .set('index', suspend.log_index);
        cfg.tzoUtil.fillInUTCInfo(postreschange, suspend.jsDate);
        postreschange = postreschange.done();
        postrecords.push(postreschange);
      }
      postrecords.push(postsuspend);
      // we don't call .done() on the basal b/c it still needs duration added
      // which happens in the simulator
      postbasal = cfg.builder.makeSuspendBasal()
        .with_deviceTime(suspend.deviceTime)
        .set('index', suspend.log_index);
      cfg.tzoUtil.fillInUTCInfo(postbasal, suspend.jsDate);
      postrecords.push(postbasal);
    }
    return records.concat(postrecords);
  };

  const buildResumeRecords = (data, records) => {
    const resumerecs = findSpecificRecords(data.log_records, [
      getValueForName(logRecords, 'Resume'),
    ]);
    const postrecords = [];
    let postresume = null;
    for (let r = 0; r < resumerecs.length; ++r) {
      const resume = data.log_records[resumerecs[r]];
      // we don't call .done() on a resume b/c we still need to pair it with
      // its previous suspend in the simulator
      postresume = cfg.builder.makeDeviceEventResume()
        .with_deviceTime(resume.deviceTime)
        // the spec doesn't really specify circumstances under which resumes happen
        // i.e., 'manual' reason code is an assumption here
        .with_reason({ resumed: 'manual' })
        .set('index', resume.log_index);
      cfg.tzoUtil.fillInUTCInfo(postresume, resume.jsDate);
      postrecords.push(postresume);
    }
    return records.concat(postrecords);
  };

  const buildActivationRecords = (data, records) => {
    const activerecs = findSpecificRecords(data.log_records, [
      getValueForName(logRecords, 'Activate'),
    ]);
    const postrecords = [];
    let postactivate = null;
    for (let a = 0; a < activerecs.length; ++a) {
      const activate = data.log_records[activerecs[a]];
      postactivate = cfg.builder.makeDeviceEventResume()
        .with_deviceTime(activate.deviceTime)
        .with_reason('new_pod')
        .set('index', activate.log_index);
      cfg.tzoUtil.fillInUTCInfo(postactivate, activate.jsDate);
      postrecords.push(postactivate);
    }
    return records.concat(postrecords);
  };

  const buildTimeChangeRecords = (data, records, settings) => {
    const seenChanges = {};
    function findNearbyChanges(index) {
      let donechange = false;
      const changes = [data.log_records[index]];
      while (!donechange) {
        index -= 1;
        const currentrec = data.log_records[index];
        if (currentrec.rectype_name === 'Date_Change' || currentrec.rectype_name === 'Time_Change') {
          seenChanges[index] = true;
          changes.push(currentrec);
        } else {
          donechange = true;
        }
      }
      return changes;
    }

    const changerecs = findSpecificRecords(data.log_records, [
      getValueForName(logRecords, 'Date_Change'),
      getValueForName(logRecords, 'Time_Change'),
    ]);
    const postrecords = [];
    let postchange = null;
    for (let c = 0; c < changerecs.length; ++c) {
      if (!seenChanges[changerecs[c]]) {
        const changegroup = findNearbyChanges(changerecs[c]);
        const grouped = _.groupBy(changegroup, 'rectype_name');
        const first = changegroup[0];
        const ts = sundial.buildTimestamp(_.assign(
          {},
          grouped.Date_Change ? grouped.Date_Change[grouped.Date_Change.length - 1].detail :
            { year: first.year, month: first.month, day: first.day },
          grouped.Time_Change ? grouped.Time_Change[grouped.Time_Change.length - 1].detail :
            { hours: first.hours, minutes: first.minutes, seconds: first.seconds },
        ));
        postchange = cfg.builder.makeDeviceEventTimeChange()
          .with_deviceTime(first.deviceTime)
          .set('jsDate', ts)
          .with_change({
            from: first.deviceTime,
            to: sundial.formatDeviceTime(ts),
            agent: 'manual',
          })
          .set('index', first.log_index);
        postrecords.push(postchange);
      }
    }
    const tzoUtil = new TZOUtil(
      cfg.timezone,
      settings.time,
      // certain errors cause the OmniPod to reset the clock to 2007-01-01
      // (or to 2015-12-31 on the Dash)
      // these are not legitimate time change records for UTC "bootstrapping"
      _.filter(postrecords, (rec) => rec.change.from.slice(0, 4) > '2015'),
    );
    cfg.tzoUtil = tzoUtil;

    return records.concat(tzoUtil.records);
  };

  const buildBGRecords = (data, records) => {
    const bgrecs = findSpecificRecords(data.log_records, [
      getValueForName(logRecords, 'Blood_Glucose'),
    ]);
    const postrecords = [];
    for (let i = 0; i < bgrecs.length; ++i) {
      const bg = data.log_records[bgrecs[i]];
      // skip errored records: meter error code, temperature error flag, other error flag
      if (bg.detail.error_code !== 0
        || hasFlag(BG_FLAGS.TEMPERATURE_FLAG, bg.detail.flags)
        || hasFlag(BG_FLAGS.OTHER_ERROR_FLAG, bg.detail.flags)) {
        continue;
      }
      const bgMeter = BG_BOARD_TYPES[PDM_CONFIG_FLAGS.BG_BOARD_TYPE.mask & data.eeprom_settings.PDM_CONFIG_FLAGS];
      let postbg = cfg.builder.makeSMBG()
        .with_deviceTime(bg.deviceTime)
        .with_units(BG_UNITS)
        .with_subType(hasFlag(BG_FLAGS.MANUAL_FLAG, bg.detail.flags) ? 'manual' : 'linked')
        .set('index', bg.log_index);
      cfg.tzoUtil.fillInUTCInfo(postbg, bg.jsDate);
      let value = bg.detail.bg_reading;
      if (hasFlag(BG_FLAGS.RANGE_ERROR_LOW_FLAG, bg.detail.flags)) {
        value = 19;
        annotate.annotateEvent(postbg, { code: 'bg/out-of-range', value: 'low', threshold: 20 });
      }
      if (hasFlag(BG_FLAGS.RANGE_ERROR_HIGH_FLAG, bg.detail.flags)) {
        value = bgMeter.highest + 1;
        annotate.annotateEvent(postbg, { code: 'bg/out-of-range', value: 'high', threshold: bgMeter.highest });
      }
      postbg = postbg.with_value(value)
        .done();
      postrecords.push(postbg);
      if (bg.user_tag_1 || bg.user_tag_2) {
        const s = `${bg.user_tag_1} ${bg.user_tag_2}`;
        let note = cfg.builder.makeNote()
          .with_value(s)
          .with_deviceTime(bg.deviceTime);
        cfg.tzoUtil.fillInUTCInfo(note, bg.jsDate);
        note = note.done();
        debug('Not storing note:', s);
      }
    }
    return records.concat(postrecords);
  };

  const buildSettingsRecord = (data, records) => {
    const downloads = findSpecificRecords(data.log_records, [
      getValueForName(logRecords, 'Download'),
    ]);
    // there can in very rare circumstances be more than one download
    // so we always take the last (most current) one
    const download = data.log_records[downloads[downloads.length - 1]];

    const schedules = {};
    const generateSchedule = (prof_idx) => {
      const keyname = getItemWithValue(PROFILES, 'keyname', 'value', data.profiles[prof_idx].profile_idx);
      const valname = getItemWithValue(PROFILES, 'valuename', 'value', data.profiles[prof_idx].profile_idx);
      const sked = [];
      const addStep = (idx) => {
        const o = { start: data.profiles[prof_idx].steps[idx].starttime };
        o[keyname] = data.profiles[prof_idx].steps[idx][valname];
        sked.push(o);
      };
      addStep(0);
      for (let j = 1; j < data.profiles[prof_idx].steps.length; ++j) {
        if (data.profiles[prof_idx].steps[j][valname] !== sked[sked.length - 1][keyname]) {
          addStep(j);
        }
      }
      return sked;
    };
    const settings = {};
    for (let i = 0; i < data.profiles.length; ++i) {
      if (getItemWithValue(PROFILES, 'isBasal', 'value', data.profiles[i].profile_idx)) {
        if (data.profiles[i].name) {
          schedules[data.profiles[i].name] = generateSchedule(i);
        }
      } else {
        settings[getNameForValue(PROFILES, data.profiles[i].profile_idx)] = generateSchedule(i);
      }
    }
    const bgSettingsByStart = {};
    for (let j = 0; j < settings.bgTarget.length; ++j) {
      const target = settings.bgTarget[j];
      bgSettingsByStart[target.start] = { target };
    }
    for (let k = 0; k < settings.bgThreshold.length; ++k) {
      const threshold = settings.bgThreshold[k];
      if (bgSettingsByStart[threshold.start]) {
        bgSettingsByStart[threshold.start].threshold = threshold;
      } else {
        bgSettingsByStart[threshold.start] = { threshold };
      }
    }

    const bgTargetSettings = [];
    const starts = _.sortBy(Object.keys(bgSettingsByStart), (start) => start);

    for (let l = 0; l < starts.length; ++l) {
      const currentStart = starts[l];
      let start;
      // find the current, or most recent previous target or threshold
      // if there isn't a new one for this start time
      for (let m = l; m >= 0; --m) {
        if (bgSettingsByStart[starts[m]].target) {
          start = starts[m];
          break;
        }
      }
      const thisTarget = bgSettingsByStart[start].target;

      for (let n = l; n >= 0; --n) {
        if (bgSettingsByStart[starts[n]].threshold) {
          start = starts[n];
          break;
        }
      }
      const thisThreshold = bgSettingsByStart[start].threshold;

      bgTargetSettings.push({
        start: parseInt(currentStart, 10),
        target: thisTarget.low,
        high: thisThreshold.amount,
      });
    }

    const settingsUTCTime = sundial.applyTimezone(download.deviceTime, cfg.timezone).toISOString();

    const postsettings = cfg.builder.makePumpSettings()
      .with_activeSchedule(data.basalPrograms.names[data.basalPrograms.enabled_idx].name)
      .with_units({ carb: 'grams', bg: BG_UNITS }) // values are sent in mg/dL even on mmol/L PDMs
      .with_basalSchedules(schedules)
      .with_carbRatio(settings.carbRatio)
      .with_insulinSensitivity(settings.insulinSensitivity)
      .with_bgTarget(bgTargetSettings)
      .with_bolus({
        calculator: {
          enabled: data.eeprom_settings.BOL_CALCS > 0,
          insulin: {
            duration: data.eeprom_settings.INSULIN_DURATION * 30,
            units: 'minutes',
          },
        },
        extended: {
          // normal boluses = 0, percent = 1, units = 2
          enabled: data.eeprom_settings.EXT_BOL_TYPE > 0,
        },
        amountMaximum: {
          value: data.eeprom_settings.BOLUS_MAX / 100.0,
          units: 'Units',
        },
      })
      .with_basal({
        rateMaximum: {
          value: data.eeprom_settings.BASAL_MAX / 100.0,
          units: 'Units/hour',
        },
        temporary: {
          type: TEMP_BASAL_TYPES[data.eeprom_settings.TEMP_BAS_TYPE],
        },
      })
      .with_display({
        bloodGlucose: {
          units: data.eeprom_settings.BG_DISPLAY ? 'mmol/L' : 'mg/dL',
        },
      })
      .with_manufacturers(cfg.deviceInfo.manufacturers)
      .with_model(cfg.deviceInfo.model)
      .with_serialNumber(cfg.deviceInfo.serialNumber)
      .with_time(settingsUTCTime)
      .with_deviceTime(download.deviceTime)
      .with_timezoneOffset(sundial.getOffsetFromZone(settingsUTCTime, cfg.timezone))
      .with_conversionOffset(0)
      .done();

    records.push(postsettings);
    return records;
  };

  return {
    detect(deviceInfo, cb) {
      debug('no detect function needed');
      cb(null, deviceInfo);
    },

    // eslint-disable-next-line consistent-return
    setup(deviceInfo, progress, cb) {
      debug('Insulet Setup!');
      progress(0);
      const data = { stage: 'setup' };

      if (cfg.filename && cfg.filedata) {
        // the user has already selected a file
        buf = cfg.filedata;
        bytes = new Uint8Array(buf);
        data.filedata = cfg.filedata; // to store as blob
        progress(100);
        return cb(null, data);
      }

      // check if pdm is mounted as a drive

      // eslint-disable-next-line consistent-return
      (async () => {
        try {
          const drivelist = require('drivelist');
          const drives = await drivelist.list();

          let filePath = null;
          debug('Drives:', drives);
          // eslint-disable-next-line no-restricted-syntax
          for (const drive of drives) {
            debug(drive.description);
            if (drive.description && drive.description.toLowerCase().includes('omnipod pdm') && !drive.system) {
              if (drive.mountpoints.length > 0) {
                const devicePath = drive.mountpoints[0].path;
                // eslint-disable-next-line no-await-in-loop
                const contents = await fs.readdir(devicePath);
                const files = _.filter(contents, (file) => {
                  const regex = /(.+\.ibf)/g;
                  return file.match(regex);
                });
                // On Eros PDM there should only be one .ibf file
                filePath = path.join(devicePath, files[0]);
              } else {
                return cb(new Error('File not found. Please unplug PDM and try again.'), null);
              }
            }
          }

          if (filePath) {
            debug('filePath:', filePath);

            const res = await fs.readFile(filePath);
            buf = res.buffer;
            bytes = new Uint8Array(buf);
            progress(100);
            return cb(null, data);
          }

          // no mounted drive with .ibf file, let's try connecting over MTP (Dash)
          const WebMTP = require('webmtp');
          const mtp = new WebMTP(deviceInfo.vendorId, deviceInfo.productId);

          mtp.on('error', (err) => cb(err, null));
          mtp.on('ready', async () => {
            await mtp.openSession();
            const handles = await mtp.getObjectHandles();

            handles.sort((a, b) => b - a);
            debug('Handles:', handles);

            let fileName;
            let objectHandle;
            for (let i = 0; i < handles.length; i++) {
              objectHandle = handles[i];
              // eslint-disable-next-line no-await-in-loop
              fileName = await mtp.getFileName(objectHandle);
              if (_.endsWith(fileName, '.ibf')) {
                break;
              }
            }

            bytes = await mtp.getFile(objectHandle, fileName);
            buf = bytes.buffer;
            await mtp.close();

            progress(100);
            return cb(null, data);
          });
        } catch (err) {
          return cb(err);
        }
      })();
    },

    connect(progress, data, cb) {
      debug('Insulet Connect!');
      // let's do a validation pass
      data.stage = 'connect';
      progress(0);
      let done = false;
      let offset = 0;
      data.npackets = 0;
      while (!done) {
        const rec = getRecord(offset);
        if (rec === null) {
          // final packet is incomplete
          done = true;
        } else {
          if (!rec.valid) {
            return cb('Checksum error', rec);
          }
          data.npackets += 1;
          offset += rec.packetlen;
          if (offset >= bytes.length) {
            done = true;
          }
        }
      }

      // we made it through
      progress(100);
      return cb(null, data);
    },

    // eslint-disable-next-line consistent-return
    getConfigInfo(progress, data, cb) {
      debug('Insulet GetConfigInfo!');
      data.stage = 'getConfigInfo';
      progress(0);
      let offset = 0;
      data.ibf_version = getFixedRecord('ibf_version', offset);
      offset += data.ibf_version.packetlen;

      progress(10);
      data.pdm_version = getFixedRecord('pdm_version', offset);
      if (data.pdm_version.pdm_maj >= 3) { // Dash PDM
        isDash = true;
        cfg.deviceInfo.model = 'Dash';
      } else {
        cfg.deviceInfo.model = 'Eros';
      }
      data.deviceModel = cfg.deviceInfo.model; // for metrics

      if (!isDash) {
        // non-Dash PDM has a built-in BGM
        cfg.deviceInfo.manufacturers.push('Abbott');
        cfg.deviceInfo.tags.push('bgm');
      }

      offset += data.pdm_version.packetlen;

      progress(20);
      data.mfg_data = getManufacturingData(offset);
      offset += data.mfg_data.packetlen;

      progress(30);
      data.basalPrograms = getBasalProgramNames(offset);
      offset += data.basalPrograms.packetlen;

      progress(50);
      data.eeprom_settings = getFixedRecord('eeprom_settings', offset);
      offset += data.eeprom_settings.packetlen;

      progress(70);
      data.profiles = getProfiles(offset, data.basalPrograms.names);
      offset += data.profiles.packetlen;

      progress(80);
      data.logDescriptions = getLogDescriptions(offset);
      offset += data.logDescriptions.packetlen;
      data.independent_offset = offset;

      const recnames = ['ibf_version', 'pdm_version', 'mfg_data', 'eeprom_settings'];
      for (let i = 0; i < recnames.length; ++i) {
        if (fixedRecords[recnames[i]].postprocess) {
          const err = fixedRecords[recnames[i]].postprocess(data[recnames[i]]);
          if (err) {
            return cb(err, null);
          }
        }
      }

      _.merge(cfg, {
        deviceInfo: {
          deviceTime: data.logDescriptions.deviceTime,
          serialNumber: data.eeprom_settings.serial_number,
          deviceId: `${data.ibf_version.vendorid.slice(0, 3)}${data.ibf_version.productid.slice(0, 3)}-${data.eeprom_settings.serial_number}`,
        },
      });

      if (isElectron()) {
        commonFunctions.checkDeviceTime(cfg, (err) => {
          progress(100);
          return cb(err, data);
        });
      } else {
        return cb(null, data);
      }
    },

    fetchData(progress, data, cb) {
      debug('Insulet FetchData!');
      data.stage = 'fetchData';
      progress(0);
      const log_records = getLogRecords(data);

      /*
        Because pump shut-down interferes with BtUTC, anywhere
        where a pump shut-down appears in records to be processed
        we only attempt to process and upload the data following
        the most recent device shut-down.
      */
      data.log_records = _.takeWhile(log_records, (rec) => {
        if (rec.rectype_name
          && rec.rectype_name === 'Remote_Hazard_Alarm'
          && rec.year <= 2016) { // Eros resets clock to 2007-01-01, DASH to 2015-12-31 or 2016-01-01
          debug('Most recent pump shut down:', rec);
          return false;
        }
        return true;
      });
      debug('Will process', data.log_records.length, 'log records.');
      if (buf) {
        data.filedata = buf; // to store as blob
      }
      progress(100);
      return cb(null, data);
    },

    processData(progress, data, cb) {
      debug('Insulet ProcessData!');
      data.stage = 'processData';
      // data are processed while being loaded
      progress(100);
      return cb(null, data);
    },

    uploadData(progress, data, cb) {
      debug('Insulet UploadData!');
      data.stage = 'uploadData';

      cfg.builder.setDefaults({ deviceId: cfg.deviceInfo.deviceId });

      let postrecords = [];
      let settings = null;
      postrecords = buildSettingsRecord(data, postrecords);
      if (!_.isEmpty(postrecords)) {
        [settings] = postrecords;
      }
      // order of these matters (we use it to ensure the secondary sort order)
      postrecords = buildTimeChangeRecords(data, postrecords, settings);
      postrecords = buildActivationRecords(data, postrecords);
      postrecords = buildAlarmRecords(data, postrecords);
      postrecords = buildOcclusionRecords(data, postrecords);
      postrecords = buildSuspendRecords(data, postrecords);
      postrecords = buildResumeRecords(data, postrecords);
      postrecords = buildBasalRecords(data, postrecords);
      postrecords = buildBolusRecords(data, postrecords);
      postrecords = buildBolusTerminations(data, postrecords);
      postrecords = buildBGRecords(data, postrecords);
      // first sort by log index
      postrecords = _.sortBy(postrecords, (d) => d.index);
      // finally sort by time, including indexed (history) and non-indexed records
      postrecords = _.sortBy(postrecords, (d) => d.time);
      const simulator = insuletSimulatorMaker.make({ settings });
      for (let j = 0; j < postrecords.length; ++j) {
        const datum = postrecords[j];
        switch (datum.type) {
          case 'basal':
            simulator.basal(datum);
            break;
          case 'bolus':
            simulator.bolus(datum);
            break;
          case 'termination':
            if (datum.subType === 'bolus') {
              simulator.bolusTermination(datum);
            }
            break;
          case 'deviceEvent':
            if (datum.subType === 'status') {
              if (datum.status === 'suspended') {
                simulator.suspend(datum);
              } else if (datum.status === 'resumed') {
                if (datum.reason === 'new_pod') {
                  simulator.podActivation(datum);
                } else {
                  simulator.resume(datum);
                }
              } else {
                debug('Unknown deviceEvent status!', datum.status);
              }
            } else if (datum.subType === 'alarm') {
              simulator.alarm(datum);
            } else if (datum.subType === 'reservoirChange') {
              simulator.changeReservoir(datum);
            } else if (datum.subType === 'timeChange') {
              simulator.changeDeviceTime(datum);
            } else {
              debug('deviceEvent of subType %s not passed to simulator!', datum.subType);
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
          default:
            debug('[Hand-off to simulator] Unhandled type!', datum.type);
        }
      }
      simulator.finalBasal();

      const sessionInfo = {
        deviceTags: cfg.deviceInfo.tags,
        deviceTime: cfg.deviceInfo.deviceTime,
        deviceManufacturers: cfg.deviceInfo.manufacturers,
        deviceModel: cfg.deviceInfo.model,
        deviceSerialNumber: cfg.deviceInfo.serialNumber,
        deviceId: cfg.deviceInfo.deviceId,
        start: sundial.utcDateString(),
        timeProcessing: cfg.tzoUtil.type,
        tzName: cfg.timezone,
        version: cfg.version,
        blobId: data.blobId,
      };

      data.post_records = simulator.getEvents();

      cfg.api.upload.toPlatform(
        data.post_records,
        sessionInfo,
        progress,
        cfg.groupId,
        (err) => {
          if (err) {
            debug(err);
            progress(100);
            return cb(err, data);
          }

          progress(100);
          return cb(null, data);
        },
      );
    },

    disconnect(progress, data, cb) {
      debug('Insulet Disconnect!');
      data.stage = 'disconnect';
      progress(100);
      return cb(null, data);
    },

    cleanup(progress, data, cb) {
      debug('Insulet Cleanup!');
      data.stage = 'cleanup';
      progress(100);
      delete data.stage;
      return cb(null, data);
    },

    _decodeSerial: decodeSerial,
  };
};
