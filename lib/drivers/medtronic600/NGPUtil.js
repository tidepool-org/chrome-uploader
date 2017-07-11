/*
 * == BSD2 LICENSE ==
 * Copyright (c) 2017, Tidepool Project
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

const sundial = require('sundial');

// NGP = Next Generation Pump. It's the acronym that Medtronic use in their code for the 600-series.
class NGPTimestamp {
  static get pumpBaseTimeMS() {
    // Midnight 1st January 2000 in your LOCAL timezone, even though it looks like an epoch value.
    return 946684800000;
  }

  static get maxRTC() {
    return 0xFFFFFFFF;
  }

  constructor(rtc, offset) {
    this.rtc = rtc;
    this.offset = offset;
  }

  toDate(timezone) {
    return sundial.applyTimezone(
      new Date(NGPTimestamp.pumpBaseTimeMS + (this.rtc * 1000) + (this.offset * 1000)),
      timezone);
  }

  rtcFromDate(userDate) {
    return ((userDate.getTime() - NGPTimestamp.pumpBaseTimeMS) / 1000) - this.offset;
  }

  static fromBuffer(buffer) {
    const rtc = buffer.readUInt32BE(0x00);
    const offset = buffer.readUInt32BE(0x04) - 0x100000000;
    return new NGPTimestamp(rtc, offset);
  }
}

// TODO - make into proper Enums?
class NGPConstants {
  static get BG_UNITS() {
    return {
      MG_DL: 0,
      MMOL_L: 1,
    };
  }

  static get CARB_UNITS() {
    return {
      GRAMS: 0,
      EXCHANGES: 1,
    };
  }

  static get BG_SOURCE() {
    return {
      EXTERNAL_METER: 1,
      BOLUS_WIZARD: 2,
      BG_EVENT_MARKER: 3,
      SENSOR_CAL: 4,
    };
  }

  static get BASAL_PATTERN_NAME() {
    return [
      'Pattern 1',
      'Pattern 2',
      'Pattern 3',
      'Pattern 4',
      'Pattern 5',
      'Workday',
      'Day Off',
      'Sick Day',
    ];
  }

  static get TEMP_BASAL_TYPE() {
    return {
      ABSOLUTE: 0,
      PERCENT: 1,
    };
  }


  static get TEMP_BASAL_PRESET_NAME() {
    return [
      'Not Preset',
      'Temp 1',
      'Temp 2',
      'Temp 3',
      'Temp 4',
      'High Activity',
      'Moderate Activity',
      'Low Activity',
      'Sick',
    ];
  }

  static get BOLUS_SOURCE() {
    return {
      MANUAL: 0,
      BOLUS_WIZARD: 1,
      EASY_BOLUS: 2,
      PRESET_BOLUS: 4,
    };
  }

  static get BOLUS_PRESET_NAME() {
    return [
      'Not Preset',
      'Bolus 1',
      'Bolus 2',
      'Bolus 3',
      'Bolus 4',
      'Breakfast',
      'Lunch',
      'Dinner',
      'Snack',
    ];
  }

  static get BOLUS_STEP_SIZE() {
    return {
      STEP_0_POINT_025: 0,
      STEP_0_POINT_05: 1,
      STEP_0_POINT_1: 2,
    };
  }

  static get CANNULA_FILL_TYPE() {
    return {
      TUBING_FILL: 0,
      CANULLA_FILL: 1,
    };
  }

  static get DUAL_BOLUS_PART() {
    return {
      NORMAL_BOLUS: 1,
      SQUARE_WAVE: 2,
    };
  }

  static get SUSPEND_REASON() {
    return {
      ALARM_SUSPEND: 1, // Battery change, cleared occlusion, etc
      USER_SUSPEND: 2,
      AUTO_SUSPEND: 3,
      LOWSG_SUSPEND: 4,
      SET_CHANGE_SUSPEND: 5, // AKA NOTSEATED_SUSPEND
      PLGM_PREDICTED_LOW_SG: 10,
    };
  }

  static get SUSPEND_REASON_NAME() {
    return {
      1: 'Alarm suspend',
      2: 'User suspend',
      3: 'Auto suspend',
      4: 'Low glucose suspend',
      5: 'Set change suspend',
      10: 'Predicted low glucose suspend',
    };
  }

  static get RESUME_REASON() {
    return {
      USER_SELECTS_RESUME: 1,
      USER_CLEARS_ALARM: 2,
      LGM_MANUAL_RESUME: 3,
      LGM_AUTO_RESUME_MAX_SUSP: 4, // After an auto suspend, but no CGM data afterwards.
      LGM_AUTO_RESUME_PSG_SG: 5, // When SG reaches the Preset SG level
      LGM_MANUAL_RESUME_VIA_DISABLE: 6,
    };
  }

  static get RESUME_REASON_NAME() {
    return {
      1: 'User resumed',
      2: 'User cleared alarm',
      3: 'Low glucose manual resume',
      4: 'Low glucose auto resume - max suspend period',
      5: 'Low glucose auto resume - preset glucose reached',
      6: 'Low glucose manual resume via disable',
    };
  }

  static get RESERVOIR_WARNING_TYPE() {
    return {
      INSULIN: 0,
      TIME: 1,
    };
  }
}

function make32BitIntFromNBitSignedInt(signedValue, nBits) {
  /* eslint-disable no-bitwise */
  const sign = ((0xFFFFFFFF << nBits) & 0xFFFFFFFF) * ((signedValue >> nBits - 1) & 1);
  return (sign | signedValue) & 0xFFFFFFFF;
  /* eslint-enable no-bitwise */
}

module.exports.NGPTimestamp = NGPTimestamp;
module.exports.NGPConstants = NGPConstants;
module.exports.make32BitIntFromNBitSignedInt = make32BitIntFromNBitSignedInt;
