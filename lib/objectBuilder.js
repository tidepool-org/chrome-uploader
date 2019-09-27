/*
 Provides a set of services to build objects in a format that can
 be directly uploaded to Tidepool servers.

 Generally, call 'setDefaults' with the common fields you want to set default
 values for, then call a series of 'make' functions to build the base object,
 and then chain that to a series of 'with_' calls to set the fields. If you
 need to add a value that's not in the standard set of values for a given
 type, use the 'set' function.

 When complete, call the 'done' function, which removes the placeholders
 for optional fields and checks to make sure that required fields were
 supplied. The 'done' function returns the completed object.

 It looks like this:

 var cbg = builder.makeCBG()
 .with_value(data.glucose)
 .with_time(data.displayUtc)
 .with_deviceTime(data.displayTime)
 .set("trend", data.trendText)
 .done();

 */

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
var util = require('util');

module.exports = function () {
  var REQUIRED = '**REQUIRED**';
  var OPTIONAL = '**OPTIONAL**';

  var deviceInfo = {
    time: REQUIRED,
    timezoneOffset: REQUIRED,
    clockDriftOffset: OPTIONAL,
    conversionOffset: REQUIRED,
    deviceTime: REQUIRED
  };
  function setDefaults(info) {
    deviceInfo = _.assign({}, deviceInfo, _.pick(info, 'deviceId', 'source', 'annotations'));
  }

  function _createObject() {
    return {
      // check to see if a field has been assigned or not
      isAssigned: function(k) {
        if (this[k] === OPTIONAL || this[k] === REQUIRED) {
          return false;
        }
        else if (this[k] != null) {
          return true;
        }
        else {
          return false;
        }
      },
      // use set to specify extra values that aren't in the template for
      // the data type
      set: function set(k, v) {
        if (v == null && this[k] && this[k] !== REQUIRED) {
          delete this[k];
        } else if (v != null) {
          this[k] = v;
        }
        return this;
      },

      // checks the object, removes unused optional fields,
      // and returns a copy of the object with all functions removed.
      done: function () {
        var self = this;

        var valid = _.reduce(this, function (result, value, key) {
          if (value === REQUIRED) {
            result.push(key);
          }
          return result;
        }, []);
        if (valid.length !== 0) {
          throw new Error(util.format('Some arguments to %s(%j) were not specified!', this.type, valid.join(',')));
        }

        // TODO: delete after conclusion of Jaeb study
        var payload;
        if (!_.isEmpty(self.jaebPayload)) {
          payload = self.payload === OPTIONAL ? {} : _.clone(self.payload);
          self.payload = _.assign({}, payload, self.jaebPayload);
          delete self.jaebPayload;
        }
        else if (self.index != null) {
          payload = self.payload === OPTIONAL ? {} : _.clone(self.payload);
          self.payload = _.assign({}, payload, {logIndices: [self.index]});
        /* NB: make sure to delete the index at the top level of each object
        / before uploading...unfortunately cannot do this here as some
        / Insulet objects get entirely built before the simulator, but
        / the simulator needs the index */
        }
        // TODO: end deletion

        return _.pickBy(this, function (value) {
          return !(_.isFunction(value) || value === OPTIONAL);
        });
      },

      _bindProps: function () {
        _.forIn(this, function (value, key, obj) {
          if (!_.isFunction(value)) {
            obj['with_' + key] = obj.set.bind(obj, key);
          }
        });
      }

    };
  }

  function makeAutomatedBasal() {
    var rec = _.assign(_createObject(), deviceInfo, {
      type: 'basal',
      deliveryType: 'automated',
      scheduleName: OPTIONAL,
      rate: REQUIRED,
      duration: REQUIRED,
      payload: OPTIONAL,
      expectedDuration: OPTIONAL
    });
    rec._bindProps();
    return rec;
  }

  function makeBloodKetone() {
    var rec = _.assign(_createObject(), deviceInfo, {
      type: 'bloodKetone',
      units: 'mmol/L',
      value: REQUIRED,
      payload: OPTIONAL
    });
    rec._bindProps();
    return rec;
  }

  function makeCBG() {
    var rec = _.assign(_createObject(), deviceInfo, {
      type: 'cbg',
      value: REQUIRED,
      units: REQUIRED,
      payload: OPTIONAL
    });
    rec._bindProps();
    return rec;
  }

  function makeCGMSettings() {
    var rec = _.assign(_createObject(), deviceInfo, {
      type: 'cgmSettings',
      transmitterId: REQUIRED,
      units: REQUIRED,
      displayUnits: OPTIONAL,
      lowAlerts: REQUIRED,
      highAlerts: REQUIRED,
      rateOfChangeAlerts: REQUIRED,
      outOfRangeAlerts: OPTIONAL,
      predictiveAlerts: OPTIONAL,
      calibrationAlerts: OPTIONAL,
      payload: OPTIONAL
    });
    rec._bindProps();
    return rec;
  }

  function makeDeviceEventAlarm() {
    var rec = _.assign(_createObject(), deviceInfo, {
      type: 'deviceEvent',
      subType: 'alarm',
      alarmType: REQUIRED,
      status: OPTIONAL,
      payload: OPTIONAL
    });
    rec._bindProps();
    return rec;
  }

  function makeDeviceEventCalibration() {
    var rec = _.assign(_createObject(), deviceInfo, {
      type: 'deviceEvent',
      subType: 'calibration',
      value: REQUIRED,
      units: REQUIRED,
      payload: OPTIONAL
    });
    rec._bindProps();
    return rec;
  }

  function makeDeviceEventReservoirChange() {
    var rec = _.assign(_createObject(), deviceInfo, {
      type: 'deviceEvent',
      subType: 'reservoirChange',
      status: OPTIONAL,
      payload: OPTIONAL
    });
    rec._bindProps();
    return rec;
  }

  function makeDeviceEventPrime() {
    var rec = _.assign(_createObject(), deviceInfo, {
      type: 'deviceEvent',
      subType: 'prime',
      primeTarget: REQUIRED,
      volume: OPTIONAL
    });
    rec._bindProps();
    return rec;
  }

  function makeDeviceEventResume() {
    var rec = _.assign(_createObject(), deviceInfo, {
      type: 'deviceEvent',
      subType: 'status',
      status: 'resumed',
      reason: REQUIRED,
      payload: OPTIONAL
    });
    rec._bindProps();
    return rec;
  }

  function makeDeviceEventSuspend() {
    var rec = _.assign(_createObject(), deviceInfo, {
      type: 'deviceEvent',
      subType: 'status',
      status: 'suspended',
      reason: REQUIRED,
      payload: OPTIONAL
    });
    rec._bindProps();
    return rec;
  }

  function makeDeviceEventSuspendResume() {
    var rec = _.assign(_createObject(), deviceInfo, {
      type: 'deviceEvent',
      subType: 'status',
      status: 'suspended',
      reason: REQUIRED,
      duration: REQUIRED,
      payload: OPTIONAL
    });
    rec._bindProps();
    return rec;
  }

  function makeDeviceEventTimeChange() {
    var rec = _.assign(_createObject(), deviceInfo, {
      type: 'deviceEvent',
      subType: 'timeChange',
      change: REQUIRED,
      payload: OPTIONAL
    });
    rec._bindProps();
    return rec;
  }

  function makeDualBolus() {
    var rec = _.assign(_createObject(), deviceInfo, {
      type: 'bolus',
      subType: 'dual/square',
      normal: REQUIRED,
      extended: REQUIRED,
      duration: REQUIRED,
      expectedNormal: OPTIONAL,
      expectedExtended: OPTIONAL,
      expectedDuration: OPTIONAL,
      payload: OPTIONAL
    });
    rec._bindProps();
    return rec;
  }

  function makeFood() {
    var rec = _.assign(_createObject(), deviceInfo, {
      type: 'food',
      carbs: REQUIRED,
      payload: OPTIONAL
    });
    rec._bindProps();
    return rec;
  }

  function makeNormalBolus() {
    var rec = _.assign(_createObject(), deviceInfo, {
      type: 'bolus',
      subType: 'normal',
      normal: REQUIRED,
      payload: OPTIONAL,
      expectedNormal: OPTIONAL
    });
    rec._bindProps();
    return rec;
  }

  function makeNote() {
    var rec = _.assign(_createObject(), deviceInfo, {
      type: 'note',
      value: REQUIRED,
      payload: OPTIONAL
    });
    rec._bindProps();
    return rec;
  }

  function makePumpSettings() {
    var rec = _.assign(_createObject(), deviceInfo, {
      type: 'pumpSettings',
      activeSchedule: REQUIRED,
      units: REQUIRED,
      basalSchedules: {},
      carbRatio: [],
      insulinSensitivity: [],
      bgTarget: [],
      bolus: OPTIONAL,
      basal: OPTIONAL,
      manufacturers: OPTIONAL,
      model: OPTIONAL,
      serialNumber: OPTIONAL,
      display: OPTIONAL,
      payload: OPTIONAL
    });
    rec._bindProps();
    rec.add_basalScheduleItem = function (key, item) {
      if (!rec.basalSchedules[key]) {
        rec.basalSchedules[key] = [];
      }
      rec.basalSchedules[key].push(item);
    };
    rec.add_carbRatioItem = function (item) { rec.carbRatio.push(item); };
    rec.add_insulinSensitivityItem = function (item) { rec.insulinSensitivity.push(item); };
    rec.add_bgTargetItem = function (item) { rec.bgTarget.push(item); };
    return rec;
  }

  function makeTandemPumpSettings() {
    var rec = _.assign(_createObject(), deviceInfo, {
      type: 'pumpSettings',
      activeSchedule: REQUIRED,
      units: REQUIRED,
      basalSchedules: {},
      carbRatios: {},
      insulinSensitivities: {},
      bgTargets: {},
      insulin: OPTIONAL,
      boluses: {},
      manufacturers: OPTIONAL,
      model: OPTIONAL,
      serialNumber: OPTIONAL,
      payload: OPTIONAL
    });
    rec._bindProps();
    return rec;
  }

  function makeScheduledBasal() {
    var rec = _.assign(_createObject(), deviceInfo, {
      type: 'basal',
      deliveryType: 'scheduled',
      scheduleName: OPTIONAL,
      rate: REQUIRED,
      duration: REQUIRED,
      payload: OPTIONAL,
      expectedDuration: OPTIONAL
    });
    rec._bindProps();
    return rec;
  }

  function makeSMBG() {
    var rec = _.assign(_createObject(), deviceInfo, {
      type: 'smbg',
      value: REQUIRED,
      units: REQUIRED,
      subType: OPTIONAL,
      payload: OPTIONAL
    });
    rec._bindProps();
    return rec;
  }

  function makeSquareBolus() {
    var rec = _.assign(_createObject(), deviceInfo, {
      type: 'bolus',
      subType: 'square',
      extended: REQUIRED,
      duration: REQUIRED,
      payload: OPTIONAL,
      expectedExtended: OPTIONAL,
      expectedDuration: OPTIONAL
    });
    rec._bindProps();
    return rec;
  }

  function makeSuspendBasal() {
    var rec = _.assign(_createObject(), deviceInfo, {
      type: 'basal',
      deliveryType: 'suspend',
      duration: OPTIONAL,
      suppressed: OPTIONAL,
      payload: OPTIONAL,
      expectedDuration: OPTIONAL
    });
    rec._bindProps();
    return rec;
  }

  function makeTempBasal() {
    var rec = _.assign(_createObject(), deviceInfo, {
      type: 'basal',
      deliveryType: 'temp',
      rate: OPTIONAL,
      percent: OPTIONAL,
      duration: REQUIRED,
      suppressed: OPTIONAL,
      payload: OPTIONAL,
      expectedDuration: OPTIONAL
    });
    rec._bindProps();
    return rec;
  }

  function makeWizard() {
    var rec = _.assign(_createObject(), deviceInfo, {
      type: 'wizard',
      recommended: OPTIONAL,
      bgInput: OPTIONAL,
      carbInput: OPTIONAL,
      insulinOnBoard: OPTIONAL,
      insulinCarbRatio: OPTIONAL,
      insulinSensitivity: OPTIONAL,
      bgTarget: OPTIONAL,
      bolus: REQUIRED,
      units: REQUIRED,
      payload: OPTIONAL
    });
    rec._bindProps();
    return rec;
  }

  function makeUpload() {
    var rec = _.assign(_createObject(), {
      type: 'upload',
      computerTime: REQUIRED,
      time: REQUIRED,
      timezoneOffset: REQUIRED,
      conversionOffset: REQUIRED,
      timezone: REQUIRED,
      timeProcessing: REQUIRED,
      version: REQUIRED,
      guid: OPTIONAL,
      uploadId: OPTIONAL,
      byUser: OPTIONAL,
      deviceTags: REQUIRED,
      deviceManufacturers: REQUIRED,
      deviceModel: REQUIRED,
      deviceSerialNumber: REQUIRED,
      deviceId: REQUIRED,
      payload: OPTIONAL,
      client: REQUIRED
    });
    rec._bindProps();
    return rec;
  }

  return {
    makeAutomatedBasal: makeAutomatedBasal,
    makeBloodKetone: makeBloodKetone,
    makeCBG: makeCBG,
    makeCGMSettings: makeCGMSettings,
    makeDeviceEventAlarm: makeDeviceEventAlarm,
    makeDeviceEventCalibration: makeDeviceEventCalibration,
    makeDeviceEventReservoirChange: makeDeviceEventReservoirChange,
    makeDeviceEventResume: makeDeviceEventResume,
    makeDeviceEventSuspend: makeDeviceEventSuspend,
    makeDeviceEventSuspendResume: makeDeviceEventSuspendResume,
    makeDeviceEventTimeChange: makeDeviceEventTimeChange,
    makeDeviceEventPrime: makeDeviceEventPrime,
    makeDualBolus: makeDualBolus,
    makeFood: makeFood,
    makeNormalBolus: makeNormalBolus,
    makeNote: makeNote,
    makePumpSettings: makePumpSettings,
    makeTandemPumpSettings: makeTandemPumpSettings,
    makeScheduledBasal: makeScheduledBasal,
    makeSMBG: makeSMBG,
    makeSquareBolus: makeSquareBolus,
    makeSuspendBasal: makeSuspendBasal,
    makeTempBasal: makeTempBasal,
    makeUpload: makeUpload,
    makeWizard: makeWizard,
    setDefaults: setDefaults
  };
};
