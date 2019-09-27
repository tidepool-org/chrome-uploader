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

/* global beforeEach, describe, it */

var _ = require('lodash');
var expect = require('salinity').expect;

var pwdSimulator = require('../../../lib/drivers/insulet/insuletSimulator.js');
var builder = require('../../../lib/objectBuilder')();

describe('insuletSimulator.js', function() {
  var simulator = null;

  beforeEach(function(){
    simulator = pwdSimulator.make();
  });

  describe('smbg', function(){
    it('passes through', function(){
      var val = {
        time: '2014-09-25T01:00:00.000Z',
        deviceTime: '2014-09-25T01:00:00',
        timezoneOffset: 0,
        conversionOffset: 0,
        deviceId: 'InsOmn1234',
        units: 'mg/dL',
        type: 'smbg',
        value: 1.3
      };

      simulator.smbg(val);
      expect(simulator.getEvents()).deep.equals([val]);
    });
  });

  describe('bolus', function(){
    describe('normal', function() {
      var val = {
        time: '2014-09-25T01:00:00.000Z',
        deviceTime: '2014-09-25T01:00:00',
        timezoneOffset: 0,
        conversionOffset: 0,
        deviceId: 'InsOmn1234',
        normal: 1.3,
        type: 'bolus',
        subType: 'normal'
      };
      var term = {
        time: '2014-09-25T01:00:05.000Z',
        type: 'termination',
        subType: 'bolus',
        missedInsulin: 2.7,
        durationLeft: 0
      };

      it('passes through', function(){
        simulator.bolus(val);
        expect(simulator.getEvents()).deep.equals([val]);
      });

      it('is amended with an expectedNormal when followed by a bolus termination event', function(){
        simulator.bolus(_.cloneDeep(val));
        simulator.bolusTermination(term);
        expect(simulator.getEvents()).deep.equals([_.assign({}, val, {expectedNormal: 4.0})]);
      });

      it('is amended with an expectedNormal when followed by a bolus termination even when it has zero volume', function() {
        var zeroBolus = _.assign({}, val, {normal: 0.0});
        simulator.bolus(zeroBolus);
        simulator.bolusTermination(term);
        expect(simulator.getEvents()).deep.equals([_.assign({}, zeroBolus, {expectedNormal: 2.7})]);
      });

      it('does not pass through a zero-volume bolus that does not have an expectedNormal', function() {
        var zeroBolus = _.assign({}, val, {normal: 0.0, time: '2014-09-25T01:05:00.000Z', deviceTime: '2014-09-25T01:05:00'});
        simulator.bolus(val);
        simulator.bolus(zeroBolus);
        expect(simulator.getEvents()).deep.equals([val]);
      });
    });

    describe('square', function(){
      var val = {
        time: '2014-09-25T01:00:00.000Z',
        deviceTime: '2014-09-25T01:00:00',
        timezoneOffset: 0,
        conversionOffset: 0,
        deviceId: 'InsOmn1234',
        extended: 1.4,
        duration: 1800000,
        type: 'bolus',
        subType: 'square'
      };

      it('passes through', function(){
        simulator.bolus(val);
        expect(simulator.getEvents()).deep.equals([val]);
      });

      it('is amended with expectedExtended and expectedDuration when followed by a bolus termination', function(){
        var term = {
          time: '2014-09-25T01:30:00.000Z',
          type: 'termination',
          subType: 'bolus',
          missedInsulin: 1.4,
          durationLeft: 1800000
        };

        simulator.bolus(val);
        simulator.bolusTermination(term);
        expect(simulator.getEvents()).deep.equals([_.assign({}, val, {expectedExtended: 2.8, expectedDuration: 3600000})]);
      });
    });

    describe('dual', function(){
      var val = {
        time: '2014-09-25T01:00:00.000Z',
        deviceTime: '2014-09-25T01:00:00',
        timezoneOffset: 0,
        conversionOffset: 0,
        deviceId: 'InsOmn1234',
        normal: 1.3,
        extended: 1.4,
        duration: 0,
        type: 'bolus',
        subType: 'dual/square'
      };
      it('passes through', function(){
        simulator.bolus(val);
        expect(simulator.getEvents()).deep.equals([val]);
      });

      it('is amended with an expectedNormal, expectedExtended, and expectedDuration when two bolus terminations follow (interrupted during up-front delivery)', function(){
        var term1 = {
          time: '2014-09-25T01:00:05.000Z',
          type: 'termination',
          subType: 'bolus',
          missedInsulin: 2.7,
          durationLeft: 0
        };
        var term2 = {
          time: '2014-09-25T01:00:05.000Z',
          type: 'termination',
          subType: 'bolus',
          missedInsulin: 1.4,
          durationLeft: 3600000
        };

        simulator.bolus(val);
        simulator.bolusTermination(term1);
        simulator.bolusTermination(term2);
        expect(simulator.getEvents()).deep.equals([_.assign({}, val, {expectedNormal: 4.0, expectedExtended: 2.8, expectedDuration: 3600000})]);
      });
    });
  });

  describe('wizard', function() {
    var bolus = {
      time: '2014-09-25T01:00:00.000Z',
      deviceTime: '2014-09-25T01:00:00',
      timezoneOffset: 0,
      conversionOffset: 0,
      deviceId: 'InsOmn1234',
      normal: 1.3,
      type: 'bolus',
      subType: 'normal'
    };

    var val = {
      time: '2014-09-25T01:00:00.000Z',
      deviceTime: '2014-09-25T01:00:00',
      timezoneOffset: 0,
      conversionOffset: 0,
      deviceId: 'InsOmn1234',
      recommended: {
        carb: 1.0,
        correction: 2.0,
        net: 3.0
      },
      bgInput: 200,
      carbInput: 15,
      insulinOnBoard: 0.2,
      insulinCarbRatio: 15,
      insulinSensitivity: 50,
      bgTarget: {
        target: 100,
        high: 120
      },
      bolus: bolus,
      units: 'mg/dL',
      type: 'wizard'
    };

    it('passes through with a bolus', function() {
      simulator.wizard(val);
      expect(simulator.getEvents()).deep.equals([val]);
    });
  });

  describe('deviceEvent', function() {
    describe('alarm', function() {
      it('passes through', function() {
        var val = {
          time: '2014-09-25T01:00:00.000Z',
          deviceTime: '2014-09-25T01:00:00',
          timezoneOffset: 0,
          conversionOffset: 0,
          deviceId: 'InsOmn1234',
          type: 'deviceEvent',
          subType: 'alarm',
          alarmType: 'low_insulin'
        };

        simulator.alarm(val);
        expect(simulator.getEvents()).deep.equals([val]);
      });

      it('throws an error without a status if `stopsDelivery` in payload and `index` available', function() {
        var val = {
          time: '2014-09-25T01:00:00.000Z',
          deviceTime: '2014-09-25T01:00:00',
          timezoneOffset: 0,
          conversionOffset: 0,
          deviceId: 'InsOmn1234',
          type: 'deviceEvent',
          subType: 'alarm',
          alarmType: 'occlusion',
          payload: {
            stopsDelivery: true
          },
          index: 10
        };

        var fn = function() { simulator.alarm(val); };
        expect(fn).to.throw(Error);
      });

      it('passes through if `stopsDelivery` in payload but no `index` available', function() {
        var val = {
          time: '2014-09-25T01:00:00.000Z',
          deviceTime: '2014-09-25T01:00:00',
          timezoneOffset: 0,
          conversionOffset: 0,
          deviceId: 'InsOmn1234',
          type: 'deviceEvent',
          subType: 'alarm',
          alarmType: 'occlusion',
          payload: {
            stopsDelivery: true
          }
        };

        simulator.alarm(val);
        expect(simulator.getEvents()).deep.equals([val]);
      });

      it('passes through if `stopsDelivery` in payload and `status` exists', function() {
        var val = {
          time: '2014-09-25T01:00:00.000Z',
          deviceTime: '2014-09-25T01:00:00',
          timezoneOffset: 0,
          conversionOffset: 0,
          deviceId: 'InsOmn1234',
          type: 'deviceEvent',
          subType: 'alarm',
          alarmType: 'occlusion',
          payload: {
            stopsDelivery: true
          },
          status: {
            time: '2014-09-25T01:00:00.000Z',
            deviceTime: '2014-09-25T01:00:00',
            timezoneOffset: 0,
            deviceId: 'InsOmn1234',
            type: 'deviceEvent',
            subType: 'status',
            status: 'suspended'
          }
        };

        simulator.alarm(val);
        expect(simulator.getEvents()).deep.equals([val]);
      });
    });

    describe('changeReservoir', function() {
      var val = {
        time: '2014-09-25T01:00:00.000Z',
        deviceTime: '2014-09-25T01:00:00',
        timezoneOffset: 0,
        conversionOffset: 0,
        deviceId: 'InsOmn1234',
        type: 'deviceEvent',
        subType: 'reservoirChange'
      };

      it('passes through with a status', function() {
        var suspend = builder.makeDeviceEventSuspendResume()
          .with_time('2014-09-25T01:00:00.000Z')
          .with_deviceTime('2014-09-25T01:00:00')
          .with_timezoneOffset(0)
          .with_conversionOffset(0)
          .with_reason({suspended: 'manual'});

        var withStatus = _.assign({}, val, {status: suspend});
        simulator.changeReservoir(withStatus);
        simulator.finalBasal();
        expect(simulator.getEvents()).deep.equals([withStatus]);
      });

      it('throws an error without a status', function() {
        var fn = function() { simulator.changeReservoir(val); };
        expect(fn).to.throw(Error);
      });
    });

    describe('status', function() {
      var suspend = builder.makeDeviceEventSuspendResume()
        .with_time('2014-09-25T01:00:00.000Z')
        .with_deviceTime('2014-09-25T01:00:00')
        .with_timezoneOffset(0)
        .with_conversionOffset(0)
        .with_reason({suspended: 'automatic'});
      var resume = builder.makeDeviceEventResume()
        .with_time('2014-09-25T02:00:00.000Z')
        .with_deviceTime('2014-09-25T02:00:00')
        .with_timezoneOffset(0)
        .with_conversionOffset(0)
        .with_status('resumed')
        .with_reason({resumed: 'manual'});

      it('a suspend does not pass through', function() {
        simulator.suspend(suspend);
        expect(simulator.getEvents()).deep.equals([]);
      });

      it('a resume passes through', function() {
        simulator.resume(resume);
        resume.annotations = [{code: 'status/incomplete-tuple'}];
        expect(simulator.getEvents()).deep.equals([resume.done()]);
      });

      it('uses the timestamp of the first suspend if multiple suspends appear before a single resume', function() {
        var suspend2 = {
          time: '2014-09-25T01:05:00.000Z',
          deviceTime: '2014-09-25T01:05:00',
          timezoneOffset: 0,
          conversionOffset: 0,
          deviceId: 'InsOmn1234',
          type: 'deviceEvent',
          subType: 'status',
          status: 'suspended',
          reason: {suspended: 'automatic'}
        };
        simulator.suspend(suspend);
        simulator.suspend(suspend2);
        simulator.resume(resume);
        var expectedSuspendResume = _.clone(suspend);
        expectedSuspendResume = expectedSuspendResume.with_duration(3600000);
        expect(simulator.getEvents()).deep.equals([expectedSuspendResume.done()]);
      });
    });

    describe('timeChange', function() {
      var change = {
        time: '2014-09-25T01:05:00.000Z',
        deviceTime: '2014-09-25T01:05:00',
        timezoneOffset: 0,
        conversionOffset: 0,
        deviceId: 'InsOmn1234',
        type: 'deviceEvent',
        subType: 'timeChange',
        change: {
          from: '2014-09-25T01:05:00',
          to: '2014-09-25T01:00:00',
          agent: 'manual'
        }
      };
      it('passes through', function() {
        simulator.changeDeviceTime(change);
        expect(simulator.getEvents()).deep.equals([change]);
      });
    });
  });

  describe('settings', function() {
    var settings = {
      time: '2014-09-25T01:00:00.000Z',
      deviceTime: '2014-09-25T01:00:00',
      activeSchedule: 'billy',
      units: { 'bg': 'mg/dL' },
      basalSchedules: {
        'billy': [
          { start: 0, rate: 1.0 },
          { start: 21600000, rate: 1.1 },
          { start: 43200000, rate: 1.2 },
          { start: 64800000, rate: 1.3 }
        ],
        'bob': [
          { start: 0, rate: 0.0}
        ]
      },
      timezoneOffset: 0,
      conversionOffset: 0
    };

    it('passes through', function() {
      simulator.pumpSettings(settings);
      expect(simulator.getEvents()).deep.equals([settings]);
    });
  });

  describe('basal', function() {
    var basal1 = builder.makeScheduledBasal()
      .with_time('2014-09-25T02:00:00.000Z')
      .with_deviceTime('2014-09-25T02:00:00')
      .with_timezoneOffset(0)
      .with_conversionOffset(0)
      .with_scheduleName('Alice')
      .with_rate(0.75);
    var basal2 = builder.makeScheduledBasal()
      .with_time('2014-09-25T03:00:00.000Z')
      .with_deviceTime('2014-09-25T03:00:00')
      .with_timezoneOffset(0)
      .with_conversionOffset(0)
      .with_scheduleName('Alice')
      .with_rate(0.85);
    var basal3 = builder.makeScheduledBasal()
      .with_time('2014-09-25T03:30:00.000Z')
      .with_deviceTime('2014-09-25T03:30:00')
      .with_timezoneOffset(0)
      .with_conversionOffset(0)
      .with_scheduleName('Alice')
      .with_rate(0.90);

    it('sets duration using a following basal', function() {
      var expectedFirstBasal = _.cloneDeep(basal1);
      expectedFirstBasal = expectedFirstBasal.set('duration', 3600000).done();
      simulator.basal(basal1);
      simulator.basal(basal2);
      expect(simulator.getEvents()).deep.equals([expectedFirstBasal]);
    });

    it('fills in the suppressed.scheduleName for a temp basal by percentage', function() {
      var settings = {
        time: '2014-09-25T01:00:00.000Z',
        deviceTime: '2014-09-25T01:00:00',
        activeSchedule: 'billy',
        units: { 'bg': 'mg/dL' },
        basalSchedules: {
          'billy': [
            { start: 0, rate: 1.0 },
            { start: 21600000, rate: 1.1 },
            { start: 43200000, rate: 1.2 },
            { start: 64800000, rate: 1.3 }
          ],
          'bob': [
            { start: 0, rate: 0.0}
          ]
        },
        timezoneOffset: 0,
        conversionOffset: 0
      };
      var regBasal1 = builder.makeScheduledBasal()
        .with_time('2014-09-25T18:05:00.000Z')
        .with_deviceTime('2014-09-25T18:05:00')
        .with_timezoneOffset(0)
        .with_conversionOffset(0)
        .with_rate(1.3)
        .with_scheduleName('billy');
      var tempBasal = builder.makeTempBasal()
        .with_time('2014-09-25T18:10:00.000Z')
        .with_deviceTime('2014-09-25T18:10:00')
        .with_timezoneOffset(0)
        .with_conversionOffset(0)
        .with_rate(0.65)
        .with_percent(0.5)
        .with_duration(1800000);
      var suppressed = {
        type: 'basal',
        deliveryType: 'scheduled',
        rate: 1.3
      };
      tempBasal.set('suppressed', suppressed);
      var regBasal2 = builder.makeScheduledBasal()
        .with_time('2014-09-25T18:40:00.000Z')
        .with_deviceTime('2014-09-25T18:40:00')
        .with_timezoneOffset(0)
        .with_conversionOffset(0)
        .with_rate(1.3)
        .with_scheduleName('billy');
      var thisSim = pwdSimulator.make({settings: settings});
      var expectedFirstBasal = _.cloneDeep(regBasal1);
      expectedFirstBasal = expectedFirstBasal.set('duration', 300000).done();
      var expectedSecondBasal = _.cloneDeep(tempBasal).done();
      expectedSecondBasal.suppressed.scheduleName = 'billy';
      var expectedThirdBasal = _.cloneDeep(regBasal2);
      expectedThirdBasal = expectedThirdBasal.set('duration', 19200000).done();
      expectedThirdBasal.annotations = [{code: 'final-basal/fabricated-from-schedule'}];
      thisSim.basal(regBasal1);
      debugger;
      thisSim.basal(tempBasal);
      thisSim.basal(regBasal2);
      thisSim.finalBasal();
      expect(thisSim.getEvents()).deep.equals([
        expectedFirstBasal,
        expectedSecondBasal,
        expectedThirdBasal
      ]);
    });
  });

  describe('finalBasal', function() {
    var settings = {
      time: '2014-09-25T01:00:00.000Z',
      deviceTime: '2014-09-25T01:00:00',
      activeSchedule: 'billy',
      units: { 'bg': 'mg/dL' },
      basalSchedules: {
        'billy': [
          { start: 0, rate: 1.0 },
          { start: 21600000, rate: 1.1 },
          { start: 43200000, rate: 1.2 },
          { start: 64800000, rate: 1.3 }
        ],
        'bob': [
          { start: 0, rate: 0.0}
        ]
      },
      timezoneOffset: 0,
      conversionOffset: 0
    };
    var basal = builder.makeScheduledBasal()
      .with_time('2014-09-25T18:05:00.000Z')
      .with_deviceTime('2014-09-25T18:05:00')
      .with_timezoneOffset(0)
      .with_conversionOffset(0)
      .with_rate(1.3)
      .with_scheduleName('billy');

    it('a single basal passes through with a call to finalBasal when settings available', function() {
      var thisSim = pwdSimulator.make({settings: settings});
      thisSim.basal(basal);
      thisSim.finalBasal();
      var expectedBasal = _.cloneDeep(basal);
      expectedBasal.annotations = [{code: 'final-basal/fabricated-from-schedule'}];
      expectedBasal = expectedBasal.set('duration', 21600000-300000).done();
      expect(thisSim.getEvents()).deep.equals([expectedBasal]);
    });

    it('a single basal gets annotated with a call to finalBasal when settings available but rate doesn\'t match', function() {
      var thisSim = pwdSimulator.make({settings: settings});
      var thisBasal = builder.makeScheduledBasal()
        .with_time('2014-09-25T18:00:00.000Z')
        .with_deviceTime('2014-09-25T18:00:00')
        .with_timezoneOffset(0)
        .with_conversionOffset(0)
        .with_rate(1.0)
        .with_scheduleName('billy');
      thisSim.basal(thisBasal);
      thisSim.finalBasal();
      var expectedBasal = _.cloneDeep(thisBasal);
      expectedBasal = expectedBasal.set('duration', 0).done();
      expectedBasal.annotations = [{code: 'insulet/basal/off-schedule-rate'}, {code: 'basal/unknown-duration'}];
      expect(thisSim.getEvents()).deep.equals([expectedBasal]);
    });

    it('a single basal gets annotated with a call to finalBasal when settings available but scheduleName doesn\'t match', function() {
      var thisSim = pwdSimulator.make({settings: settings});
      var thisBasal = builder.makeScheduledBasal()
        .with_time('2014-09-25T18:00:00.000Z')
        .with_deviceTime('2014-09-25T18:00:00')
        .with_timezoneOffset(0)
        .with_conversionOffset(0)
        .with_rate(1.3)
        .with_scheduleName('bob');
      thisSim.basal(thisBasal);
      thisSim.finalBasal();
      var expectedBasal = _.cloneDeep(thisBasal);
      expectedBasal = expectedBasal.set('duration', 0).done();
      expectedBasal.annotations = [{code: 'insulet/basal/off-schedule-rate'}, {code: 'basal/unknown-duration'}];
      expect(thisSim.getEvents()).deep.equals([expectedBasal]);
    });

    it('a single basal gets null duration and annotated with a call to finalBasal when settings unavailable', function() {
      var thisBasal = builder.makeScheduledBasal()
        .with_time('2014-09-25T18:05:00.000Z')
        .with_deviceTime('2014-09-25T18:05:00')
        .with_timezoneOffset(0)
        .with_conversionOffset(0)
        .with_rate(1.3);
      simulator.basal(thisBasal);
      simulator.finalBasal();
      var expectedBasal = _.cloneDeep(thisBasal);
      expectedBasal = expectedBasal.set('duration', 0).done();
      expectedBasal.annotations = [{code: 'basal/unknown-duration'}];
      expect(simulator.getEvents()).deep.equals([expectedBasal]);
    });

    it('a temp basal is completed ', function() {
      var temp = builder.makeTempBasal()
        .with_time('2014-09-25T18:05:00.000Z')
        .with_deviceTime('2014-09-25T18:05:00')
        .with_timezoneOffset(0)
        .with_conversionOffset(0)
        .with_rate(1.3)
        .with_duration(1800000);
      var expectedBasal = _.cloneDeep(temp);
      expectedBasal = expectedBasal.done();
      simulator.basal(temp);
      simulator.finalBasal();
      expect(simulator.getEvents()).deep.equals([expectedBasal]);
    });

    it('a suspend basal is given a null duration and annotated', function() {
      var suspend = builder.makeSuspendBasal()
        .with_time('2014-09-25T18:05:00.000Z')
        .with_deviceTime('2014-09-25T18:05:00')
        .with_timezoneOffset(0)
        .with_conversionOffset(0);
      var expectedBasal = _.cloneDeep(suspend);
      expectedBasal = expectedBasal.set('duration', 0).done();
      expectedBasal.annotations = [{code: 'basal/unknown-duration'}];
      simulator.basal(suspend);
      simulator.finalBasal();
      expect(simulator.getEvents()).deep.equals([expectedBasal]);
    });
  });

  describe('event interplay', function() {
    var suspend = builder.makeDeviceEventSuspendResume()
      .with_time('2014-09-25T01:50:00.000Z')
      .with_deviceTime('2014-09-25T01:50:00')
      .with_timezoneOffset(0)
      .with_conversionOffset(0)
      .with_status('suspended')
      .with_reason({suspended: 'manual'});
    var resume = builder.makeDeviceEventResume()
      .with_time('2014-09-25T02:00:00.000Z')
      .with_deviceTime('2014-09-25T02:00:00')
      .with_timezoneOffset(0)
      .with_conversionOffset(0)
      .with_status('resumed')
      .with_reason({resumed: 'manual'});
    var basal1 = builder.makeScheduledBasal()
      .with_time('2014-09-25T02:00:00.000Z')
      .with_deviceTime('2014-09-25T02:00:00')
      .with_timezoneOffset(0)
      .with_conversionOffset(0)
      .with_scheduleName('Alice')
      .with_rate(0.75);
    var basal2 = builder.makeScheduledBasal()
      .with_time('2014-09-25T03:00:00.000Z')
      .with_deviceTime('2014-09-25T03:00:00')
      .with_timezoneOffset(0)
      .with_conversionOffset(0)
      .with_scheduleName('Alice')
      .with_rate(0.85);

    it('if a new pod is activated, a resume is fabricated before basal resumes', function() {
      simulator.podActivation(resume);
      simulator.basal(basal1);
      simulator.basal(basal2);
      simulator.finalBasal();
      var expectedResume = _.cloneDeep(resume);
      expectedResume = expectedResume.done();
      expectedResume.annotations = [{code: 'status/incomplete-tuple'}];
      var expectedFirstBasal = _.cloneDeep(basal1);
      expectedFirstBasal = expectedFirstBasal.set('duration', 3600000).done();
      var expectedSecondBasal = _.cloneDeep(basal2);
      expectedSecondBasal = expectedSecondBasal.set('duration', 0).done();
      expectedSecondBasal.annotations = [{code: 'basal/unknown-duration'}];
      expect(simulator.getEvents()).deep.equals([
        expectedResume,
        expectedFirstBasal,
        expectedSecondBasal
      ]);
    });

    it('if a new pod is activated and the pump is suspended, the status event is finalized before basal resumes', function() {
      simulator.suspend(suspend);
      simulator.podActivation(resume);
      simulator.basal(basal1);
      simulator.basal(basal2);
      simulator.finalBasal();
      var expectedSuspendResume = _.cloneDeep(suspend).done();
      expectedSuspendResume.duration = 600000;
      var expectedFirstBasal = _.cloneDeep(basal1);
      expectedFirstBasal = expectedFirstBasal.set('duration', 3600000).done();
      var expectedSecondBasal = _.cloneDeep(basal2);
      expectedSecondBasal = expectedSecondBasal.set('duration', 0).done();
      expectedSecondBasal.annotations = [{code: 'basal/unknown-duration'}];
      expect(simulator.getEvents()).deep.equals([
        expectedSuspendResume,
        expectedFirstBasal,
        expectedSecondBasal
      ]);
    });
  });
});
