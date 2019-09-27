/*
 * == BSD2 LICENSE ==
 * Copyright (c) 2015, Tidepool Project
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

var pwdSimulator = require('../../../lib/drivers/tandem/tandemSimulator.js');
var builder = require('../../../lib/objectBuilder')();

describe('tandemSimulator.js', function() {
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
        deviceId: 'tandem12345',
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
        deviceId: 'tandem12345',
        normal: 1.3,
        type: 'bolus',
        subType: 'normal'
      };

      it('passes through', function(){
        simulator.bolus(val);
        expect(simulator.getEvents()).deep.equals([val]);
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
        deviceId: 'tandem12345',
        extended: 1.4,
        duration: 1800000,
        type: 'bolus',
        subType: 'square'
      };

      it('passes through', function(){
        simulator.bolus(val);
        expect(simulator.getEvents()).deep.equals([val]);
      });
    });

    describe('dual', function(){
      var val = {
        time: '2014-09-25T01:00:00.000Z',
        deviceTime: '2014-09-25T01:00:00',
        timezoneOffset: 0,
        conversionOffset: 0,
        deviceId: 'tandem12345',
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
    });
  });

  describe('wizard', function() {
    var bolus = {
      time: '2014-09-25T01:00:00.000Z',
      deviceTime: '2014-09-25T01:00:00',
      timezoneOffset: 0,
      conversionOffset: 0,
      deviceId: 'tandem12345',
      normal: 1.3,
      type: 'bolus',
      subType: 'normal'
    };

    var val = {
      time: '2014-09-25T01:00:00.000Z',
      deviceTime: '2014-09-25T01:00:00',
      timezoneOffset: 0,
      conversionOffset: 0,
      deviceId: 'tandem12345',
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

    it('does not pass through a zero-volume wizard bolus', function() {
      var zeroWizard = _.assign({}, bolus, {normal: 0.0});
      simulator.bolus(val);
      simulator.bolus(zeroWizard);
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
          deviceId: 'tandem12345',
          type: 'deviceEvent',
          subType: 'alarm',
          alarmType: 'low_insulin'
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
        deviceId: 'tandem12345',
        type: 'deviceEvent',
        subType: 'reservoirChange'
      };

      it('passes through', function() {
        simulator.cartridgeChange(val);
        expect(simulator.getEvents()).deep.equals([val]);
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
        .with_reason({resumed: 'manual'});
      var expectedSuspendResume = _.clone(suspend);
      expectedSuspendResume = expectedSuspendResume.with_duration(60000);

      it('a suspend without resume gets annotated', function() {

        var basal = builder.makeSuspendBasal()
          .with_time('2014-09-25T01:00:00.000Z')
          .with_deviceTime('2014-09-25T01:00:00')
          .with_timezoneOffset(0)
          .with_conversionOffset(0);

        simulator.suspend(suspend);
        simulator.basal(basal);
        simulator.finalBasal();

        basal.annotations = [{code: 'basal/unknown-duration'}];

        var expectedSuspend = _.clone(suspend);
        expectedSuspend.annotations = [{code: 'status/incomplete-tuple'}];
        expect(simulator.getEvents()).deep.equals([expectedSuspend.done(), basal.done()]);
      });

      it('a resume without suspend gets annotated', function() {
        var expectedResume = _.clone(resume);
        expectedResume.annotations = [{code: 'status/incomplete-tuple'}];

        simulator.resume(resume);

        expect(simulator.getEvents()).deep.equals([expectedResume.done()]);
      });

      it('a suspend and resume is combined into a single event', function() {
        simulator.suspend(suspend);
        simulator.resume(resume);
        expect(simulator.getEvents()).deep.equals([expectedSuspendResume.done()]);
      });

      it('uses the timestamp of the first suspend if multiple suspends appear before a single resume', function() {
        var suspend2 = {
          time: '2014-09-25T01:05:00.000Z',
          deviceTime: '2014-09-25T01:05:00',
          timezoneOffset: 0,
          conversionOffset: 0,
          deviceId: 'tandem12345',
          type: 'deviceEvent',
          subType: 'status',
          status: 'suspended',
          reason: {suspended: 'automatic'}
        };
        simulator.suspend(suspend);
        simulator.suspend(suspend2);
        simulator.resume(resume);
        expect(simulator.getEvents()).deep.equals([expectedSuspendResume.done()]);
      });
    });

    describe('timeChange', function() {
      var change = {
        time: '2014-09-25T01:05:00.000Z',
        deviceTime: '2014-09-25T01:05:00',
        timezoneOffset: 0,
        conversionOffset: 0,
        deviceId: 'tandem12345',
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
          { start: 21600000, rate: 1.1 }
        ],
        'bob': [
          { start: 0, rate: 0.0}
        ]
      },
      carbSchedules: {
        'billy': [
          { start: 0, amount: 1.0 },
          { start: 21600000, amount: 1.1 }
        ],
        'bob': [
          { start: 0, amount: 0.0}
        ]
      },
      sensitivitySchedules: {
        'billy': [
          { start: 0, amount: 1.0 },
          { start: 21600000, amount: 1.1 }
        ],
        'bob': [
          { start: 0, amount: 0.0}
        ]
      },
      targetSchedules: {
        'billy': [
          { start: 0, target: 100 },
          { start: 21600000, target: 110 }
        ],
        'bob': [
          { start: 0, target: 105}
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
      .with_rate(0.85)
      .set('deviceId','tandem12345');
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

    it('temp basal has percentage and payload', function() {
      var suppressed = builder.makeScheduledBasal()
        .with_time('2014-09-25T18:05:00.000Z')
        .with_deviceTime('2014-09-25T18:05:00')
        .with_timezoneOffset(0)
        .with_conversionOffset(0)
        .with_rate(1.3)
        .with_duration(2000000);
      var tempBasal = builder.makeTempBasal()
        .with_time('2014-09-25T18:10:00.000Z')
        .with_deviceTime('2014-09-25T18:10:00')
        .with_timezoneOffset(0)
        .with_conversionOffset(0)
        .with_duration(1800000);
      var tempBasalStart = {
            type: 'temp-basal',
            subType: 'start',
            percent: 0.65,
            duration: 1500000
          };
      var tempBasalStop = {
            type: 'temp-basal',
            subType: 'stop',
            time_left: 0
          };
      var basal2 = builder.makeScheduledBasal()
        .with_time('2014-09-25T18:40:00.000Z')
        .with_deviceTime('2014-09-25T18:40:00')
        .with_timezoneOffset(0)
        .with_conversionOffset(0)
        .with_rate(2)
        .with_duration(1800000);

      var expectedTempBasal = tempBasal.with_payload({duration:1500000})
                                        .set('percent',0.65)
                                        .done();

      simulator.basal(suppressed);
      simulator.tempBasal(tempBasalStart);
      simulator.basal(tempBasal);
      simulator.tempBasal(tempBasalStop);
      simulator.basal(basal2);
      expect(simulator.getEvents()).deep.equals([
        suppressed.done(),
        expectedTempBasal
      ]);
    });

    it('temp basal without basal rate change', function() {
      var suppressed = builder.makeScheduledBasal()
        .with_time('2014-09-25T01:05:00.000Z')
        .with_deviceTime('2014-09-25T01:05:00')
        .with_timezoneOffset(0)
        .with_conversionOffset(0)
        .with_rate(1.3)
        .with_duration(2000000)
        .set('deviceId','tandem12345');
      var tempBasalStart = {
            type: 'temp-basal',
            subType: 'start',
            percent: 0.65,
            duration: 1500000,
            time: '2014-09-25T01:10:00.000Z',
            deviceTime: '2014-09-25T01:10:00',
            timezoneOffset: 0,
            conversionOffset: 0,
            index: 1
          };
      var tempBasalStop = {
            type: 'temp-basal',
            subType: 'stop',
            time_left: 0
          };

      var expectedTempBasal = builder.makeTempBasal()
        .with_time('2014-09-25T01:10:00.000Z')
        .with_deviceTime('2014-09-25T01:10:00')
        .with_timezoneOffset(0)
        .with_conversionOffset(0)
        .with_duration(6600000)
        .set('suppressed',{
                    type: 'basal',
                    deliveryType: 'scheduled',
                    rate: 1.3
                  })
        .set('percent', 0.65)
        .set('rate', 0.845)
        .set('deviceId', 'tandem12345')
        .with_payload({'logIndices':1, duration: 1500000})
        .done();
      expectedTempBasal.annotations = [{code: 'tandem/basal/temp-without-rate-change'}];

      // temp_rate_end basal rate change occurs before temp basal stop
      simulator.basal(suppressed);
      simulator.tempBasal(tempBasalStart);
      simulator.tempBasal(tempBasalStop);
      simulator.basal(basal2);
      simulator.basal(basal3);

      expect(simulator.getEvents()).deep.equals([
        suppressed.done(),
        expectedTempBasal,
        basal2.done()
      ]);
    });

    it('temp basal crossing multiple segments', function() {
      var suppressed = builder.makeScheduledBasal()
        .with_time('2014-09-25T18:00:00.000Z')
        .with_deviceTime('2014-09-25T18:00:00')
        .with_timezoneOffset(0)
        .with_conversionOffset(0)
        .with_duration(180000)
        .with_rate(1.3);
      var tempBasal = builder.makeTempBasal()
        .with_time('2014-09-25T18:15:00.000Z')
        .with_deviceTime('2014-09-25T18:15:00')
        .with_timezoneOffset(0)
        .with_conversionOffset(0);
      var tempBasal2 = builder.makeTempBasal()
        .with_time('2014-09-25T18:30:00.000Z')
        .with_deviceTime('2014-09-25T18:30:00')
        .with_timezoneOffset(0)
        .with_conversionOffset(0);
      var tempBasalStart = {
            type: 'temp-basal',
            subType: 'start',
            percent: 0.65,
            duration: 1800000
          };
      var tempBasalStop = {
            type: 'temp-basal',
            subType: 'stop',
            time_left: 0
          };
      var basal3 = builder.makeScheduledBasal()
        .with_time('2014-09-25T19:00:00.000Z')
        .with_deviceTime('2014-09-25T19:00:00')
        .with_timezoneOffset(0)
        .with_conversionOffset(0)
        .with_rate(2);

      var expectedTempBasal = tempBasal.with_payload({duration:1800000})
                                        .set('percent',0.65)
                                        .with_duration(900000)
                                        .done();
      var expectedTempBasal2 = tempBasal2.with_payload({duration:1800000})
                                        .set('percent',0.65)
                                        .with_duration(900000)
                                        .done();

      simulator.basal(suppressed);
      simulator.tempBasal(tempBasalStart);
      simulator.basal(tempBasal);
      simulator.basal(tempBasal2);
      simulator.tempBasal(tempBasalStop);
      simulator.basal(basal3);
      expect(simulator.getEvents()).deep.equals([
        suppressed.done(),
        expectedTempBasal,
        expectedTempBasal2
      ]);
    });

    it('ignore duplicate suspended basals', function() {

      var basal = builder.makeScheduledBasal()
        .with_time('2014-09-25T15:00:00.000Z')
        .with_deviceTime('2014-09-25T15:00:00')
        .with_timezoneOffset(0)
        .with_conversionOffset(0)
        .with_rate(1.3);

      var suspend = builder.makeSuspendBasal()
        .with_time('2014-09-25T18:00:00.000Z')
        .with_deviceTime('2014-09-25T18:00:00')
        .with_timezoneOffset(0)
        .with_conversionOffset(0);

      var duplicateSuspend = builder.makeSuspendBasal()
        .with_time('2014-09-25T18:00:00.000Z')
        .with_deviceTime('2014-09-25T18:00:00')
        .with_timezoneOffset(0)
        .with_conversionOffset(0);

      var basal2 = builder.makeScheduledBasal()
        .with_time('2014-09-25T18:30:00.000Z')
        .with_deviceTime('2014-09-25T18:30:00')
        .with_timezoneOffset(0)
        .with_conversionOffset(0)
        .with_rate(1.3);

      simulator.basal(basal);
      simulator.basal(suspend);
      simulator.basal(duplicateSuspend);
      simulator.basal(basal2);

      var expectedSuspend = suspend.set('duration', 1800000)
        .done();

      expect(simulator.getEvents()).deep.equals([basal.done(),expectedSuspend]);
    });
  });

  describe('newDay', function() {
    it('fabricated from new day event', function () {
      var currBasal = builder.makeScheduledBasal()
        .with_time('2014-09-25T18:05:00.000Z')
        .with_deviceTime('2014-09-25T18:05:00')
        .with_timezoneOffset(0)
        .with_conversionOffset(0)
        .with_rate(1.3);

      var newDay = builder.makeScheduledBasal()
        .with_time('2014-09-26T00:00:00.000Z')
        .with_deviceTime('2014-09-26T00:00:00')
        .with_timezoneOffset(0)
        .with_conversionOffset(0)
        .with_rate(1.3);
      newDay.set('type', 'new-day');

      simulator.basal(currBasal);
      simulator.newDay(newDay);
      simulator.finalBasal();

      var events = simulator.getEvents();
      var lastEvent = events[events.length - 1];
      expect(lastEvent.type).to.equal('basal');
      expect(lastEvent.annotations[0].code).to.equal('tandem/basal/fabricated-from-new-day');

    });

    it('a new-day event during a temp basal', function() {
      var tempBasalStart = {
            type: 'temp-basal',
            subType: 'start',
            percent: 0.5,
            duration: 1800000
          };
      var tempBasalStop = {
            type: 'temp-basal',
            subType: 'stop',
            time_left: 0
          };
      var temp = builder.makeTempBasal()
        .with_time('2014-09-25T23:50:00.000Z')
        .with_deviceTime('2014-09-25T23:50:00')
        .with_timezoneOffset(0)
        .with_conversionOffset(0)
        .with_rate(0.5);
      var newDay = builder.makeScheduledBasal()
        .with_time('2014-09-26T00:00:00.000Z')
        .with_deviceTime('2014-09-26T00:00:00')
        .with_timezoneOffset(0)
        .with_conversionOffset(0)
        .with_rate(1);
      newDay.set('type', 'new-day');

      var basal2 = builder.makeScheduledBasal()
        .with_time('2014-09-26T00:20:00.000Z')
        .with_deviceTime('2014-09-26T00:20:00')
        .with_timezoneOffset(0)
        .with_conversionOffset(0)
        .with_rate(2);

      var expectedTempBasal = _.cloneDeep(temp);
      expectedTempBasal.percent = 0.5;
      expectedTempBasal.payload = {duration:1800000};
      expectedTempBasal.duration = 600000; // 10 minutes before new-day
      expectedTempBasal = expectedTempBasal.done();

      var expectedNewDay = _.cloneDeep(temp);
      expectedNewDay.percent = 0.5;
      expectedNewDay.payload = {duration:1800000};
      expectedNewDay.time = '2014-09-26T00:00:00.000Z';
      expectedNewDay.deviceTime = '2014-09-26T00:00:00';
      expectedNewDay.annotations = [{code: 'tandem/basal/fabricated-from-new-day'}];
      expectedNewDay.duration = 1200000;
      expectedNewDay = expectedNewDay.done();

      simulator.tempBasal(tempBasalStart);
      simulator.basal(temp);
      simulator.newDay(newDay);
      simulator.tempBasal(tempBasalStop);
      simulator.basal(basal2);

      expect(simulator.getEvents()).deep.equals([expectedTempBasal,expectedNewDay]);
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

    it('a temp basal was terminated early', function() {
      var tempBasalStart = {
            type: 'temp-basal',
            subType: 'start',
            percent: 0.65,
            duration: 1800000
          };
      var tempBasalStop = {
            type: 'temp-basal',
            subType: 'stop',
            time_left: 300000
          };
      var temp = builder.makeTempBasal()
        .with_time('2014-09-25T18:05:00.000Z')
        .with_deviceTime('2014-09-25T18:05:00')
        .with_timezoneOffset(0)
        .with_conversionOffset(0)
        .with_rate(1.3);

      var expectedTempBasal = _.cloneDeep(temp);
      expectedTempBasal.duration = 1500000;  //tempBasalStart.duration - tempBasalStop.time_left
      expectedTempBasal = expectedTempBasal.done();

      simulator.tempBasal(tempBasalStart);
      simulator.basal(temp);
      simulator.tempBasal(tempBasalStop);
      simulator.finalBasal();

      expect(simulator.getEvents()).deep.equals([expectedTempBasal]);
    });

    it('upload during temp basal', function() {
      var tempBasalStart = {
            type: 'temp-basal',
            subType: 'start',
            percent: 0.65,
            duration: 1800000
          };
      var temp = builder.makeTempBasal()
        .with_time('2014-09-25T18:05:00.000Z')
        .with_deviceTime('2014-09-25T18:05:00')
        .with_timezoneOffset(0)
        .with_conversionOffset(0)
        .with_rate(1.3);

      var expectedTempBasal = _.cloneDeep(temp);
      expectedTempBasal.duration = 1800000;
      expectedTempBasal = expectedTempBasal.done();

      simulator.tempBasal(tempBasalStart);
      simulator.basal(temp);
      simulator.finalBasal();

      expect(simulator.getEvents()).deep.equals([expectedTempBasal]);
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
    it('new-day event does not pass through as scheduled basal when pump is suspended', function() {

      var basal = builder.makeScheduledBasal()
        .with_time('2014-09-25T15:00:00.000Z')
        .with_deviceTime('2014-09-25T15:00:00')
        .with_timezoneOffset(0)
        .with_conversionOffset(0)
        .with_rate(1.3);

      var suspendEvent = builder.makeDeviceEventSuspend()
        .with_reason({suspended: 'manual'})
        .with_time('2014-09-25T18:05:00.000Z')
        .with_deviceTime('2014-09-25T18:05:00')
        .with_timezoneOffset(0)
        .with_conversionOffset(0)
        .done();

      var suspend = builder.makeSuspendBasal()
        .with_time('2014-09-25T18:05:00.000Z')
        .with_deviceTime('2014-09-25T18:05:00')
        .with_timezoneOffset(0)
        .with_conversionOffset(0);

      var newDay = builder.makeScheduledBasal()
        .with_time('2014-09-26T00:00:00.000Z')
        .with_deviceTime('2014-09-26T00:00:00')
        .with_timezoneOffset(0)
        .with_conversionOffset(0)
        .with_rate(1.3);
      newDay.set('type', 'new-day');

      simulator.basal(basal);
      simulator.suspend(suspendEvent);
      simulator.basal(suspend);
      simulator.newDay(newDay);

      expect(simulator.getEvents()).deep.equals([basal.done()]);
    });

    it('a new-day event during a cancelled temp basal', function() {
      var tempBasalStart = {
            type: 'temp-basal',
            subType: 'start',
            percent: 0.5,
            duration: 1800000
          };
      var tempBasalStop = {
            type: 'temp-basal',
            subType: 'stop',
            time_left: 600000
          };
      var temp = builder.makeTempBasal()
        .with_time('2014-09-25T23:50:00.000Z')
        .with_deviceTime('2014-09-25T23:50:00')
        .with_timezoneOffset(0)
        .with_conversionOffset(0)
        .with_rate(0.5);
      var newDay = builder.makeScheduledBasal()
        .with_time('2014-09-26T00:00:00.000Z')
        .with_deviceTime('2014-09-26T00:00:00')
        .with_timezoneOffset(0)
        .with_conversionOffset(0)
        .with_rate(1);
      newDay.set('type', 'new-day');

      var basal2 = builder.makeScheduledBasal()
        .with_time('2014-09-26T00:10:00.000Z')
        .with_deviceTime('2014-09-26T00:10:00')
        .with_timezoneOffset(0)
        .with_conversionOffset(0)
        .with_rate(2);

      var expectedTempBasal = _.cloneDeep(temp);
      expectedTempBasal.percent = 0.5;
      expectedTempBasal.payload = {duration:1800000};
      expectedTempBasal.duration = 600000; // 10 minutes before new-day
      expectedTempBasal = expectedTempBasal.done();

      var expectedNewDay = _.cloneDeep(temp);
      expectedNewDay.percent = 0.5;
      expectedNewDay.payload = {duration:1800000};
      expectedNewDay.time = '2014-09-26T00:00:00.000Z';
      expectedNewDay.deviceTime = '2014-09-26T00:00:00';
      expectedNewDay.annotations = [{code: 'tandem/basal/fabricated-from-new-day'}];
      expectedNewDay.duration = 600000;
      expectedNewDay = expectedNewDay.done();

      simulator.tempBasal(tempBasalStart);
      simulator.basal(temp);
      simulator.newDay(newDay);
      simulator.tempBasal(tempBasalStop);
      simulator.basal(basal2);
      expect(simulator.getEvents()).deep.equals([expectedTempBasal,expectedNewDay]);
    });
  });

});
