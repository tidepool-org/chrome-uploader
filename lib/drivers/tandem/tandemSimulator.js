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
var sundial = require('sundial');
var util = require('util');

var annotate = require('../../eventAnnotations');
var common = require('../../commonFunctions');
var debug = require('bows')('TandemDriver');

/**
 * Creates a new "simulator" for Tandem insulin pump data. The simulator has methods for events like
 *
 * cbg(), smbg(), basal(), bolus(), settingsChange(), etc.
 *
 * This simulator exists as an abstraction over the Tidepool APIs. It was written to simplify the conversion
 * of static, "retrospective" audit logs from devices into events understood by the Tidepool platform.
 *
 * On the input side, you have events extracted from a Tandem insulin pump. They should be delivered to the simulator
 * in time order.
 *
 * Once all input activities are collected, the simulator will have accumulated events that the Tidepool Platform
 * will understand into a local "events" array.  You can retrieve the events by calling `getEvents()`
 *
 * @param config
 * @returns {*}
 */
exports.make = function(config){
  if (config == null) {
    config = {};
  }
  var events = [];

  var currBasal = null;
  var currStatus = null;
  var currTimestamp = null;
  var currTempBasal = null;
  var currCBG = null;

  function setCurrBasal(basal) {
    currBasal = basal;
  }

  function setCurrStatus(status) {
    currStatus = status;
  }

  function setCurrTempBasal(tempBasal) {
    currTempBasal = tempBasal;
  }

  function setCurrCBG(cbg) {
    currCBG = cbg;
  }

  function ensureTimestamp(e){
    if (currTimestamp > e.time) {
      throw new Error(
        util.format('Timestamps must be in order.  Current timestamp was[%s], but got[%j]', currTimestamp, e)
      );
    }
    currTimestamp = e.time;
    return e;
  }

  function simpleSimulate(e) {
    ensureTimestamp(e);
    events.push(e);
  }

  return {
    alarm: function(event) {
      if (currStatus !== null && currStatus.status === 'suspended') {
        var type = event.alarmType;
        if(type === 'occlusion' || type === 'auto_off' || type === 'no_insulin' || type === 'no_power') {

          var status = currStatus;
          status.reason = {suspended: 'automatic'};
          status.with_payload({cause: type});
          setCurrStatus(status);
        }
      }
      simpleSimulate(event);
    },
    basal: function(event){
      ensureTimestamp(event);
      if (currBasal != null) {
        if(currBasal.deliveryType === 'temp') {
          if (currTempBasal != null) {
            currBasal.percent = currTempBasal.percent;
            if(currBasal.isAssigned('payload')) {
              currBasal.payload.duration =  currTempBasal.duration;
            }else{
              currBasal.payload = {duration : currTempBasal.duration};
            }
            setCurrTempBasal(null);
          }
        }

        // ignore repeated broadcasts of events at the same time
        // TODO: do a more thorough (deep equality-ish?) check for same-ness
        if (currBasal.time !== event.time) {
          if (!currBasal.isAssigned('duration')) {
            currBasal.with_duration(Date.parse(event.time) - Date.parse(currBasal.time));
          }
          currBasal = common.truncateDuration(currBasal, 'tandem');
          currBasal = currBasal.done();
          events.push(currBasal);
        }
        else {
          return;
        }

        if(currTempBasal && currTempBasal.subType === 'stop') {
          // temp basal without a basal rate change (temp_rate_start) event
          var tempBasal = _.clone(currTempBasal);
          tempBasal.type = 'basal';
          delete tempBasal.subType;
          tempBasal.deliveryType = 'temp';
          tempBasal.deviceId = currBasal.deviceId;
          annotate.annotateEvent(tempBasal, 'tandem/basal/temp-without-rate-change');
          tempBasal.payload = {
            duration : tempBasal.duration,
            logIndices: tempBasal.index //to be removed after Jaeb study
          };
          delete tempBasal.index;

          var suppressed = {
            type: 'basal',
            deliveryType: 'scheduled',
            rate: currBasal.rate
          };

          tempBasal.suppressed = suppressed;
          tempBasal.rate = (suppressed.rate * tempBasal.percent).toFixedNumber(5);
          // actual temp basal duration is based on basal rate change event (temp_rate_end)
          tempBasal.duration = Date.parse(event.time) - Date.parse(tempBasal.time);
          delete tempBasal.time_left;

          events.push(tempBasal);
          setCurrTempBasal(null);
        }
      }

      setCurrBasal(event);
    },
    finalBasal: function() {
      if (currBasal != null) {
        if (currBasal.deliveryType !== 'scheduled') {

          if (currBasal.deliveryType === 'temp') {
            if(!currBasal.isAssigned('duration')) {
              if(currTempBasal != null) {
                if (currTempBasal.time_left) {
                  // temp basal was cancelled
                  currBasal.duration = currTempBasal.duration - currTempBasal.time_left;
                }else{
                  currBasal.duration = currTempBasal.duration;
                }
              }
              else {
                currBasal.duration = 0;
                annotate.annotateEvent(currBasal, 'basal/unknown-duration');
              }
            }
            currBasal = currBasal.done();
          }
          else {
            if (currBasal.deliveryType === 'suspend' &&
              currStatus != null && currStatus.status === 'suspended') {
              annotate.annotateEvent(currStatus,'status/incomplete-tuple');
              currStatus.duration = 0;
              events.push(currStatus.done());
            }

            if (!currBasal.isAssigned('duration')) {
              currBasal.duration = 0;
              annotate.annotateEvent(currBasal, 'basal/unknown-duration');
              currBasal = currBasal.done();
            }
            else {
              currBasal = currBasal.done();
            }
          }
        }
        else if (config.settings != null) {
          currBasal.with_scheduleName(_.find(
            config.profiles,
            {idp: currBasal.payload.personalProfileIndex}
          ).name);
          currBasal = common.finalScheduledBasal(currBasal, config.settings, 'tandem');
        }
        else {
          currBasal.with_duration(0);
          annotate.annotateEvent(currBasal, 'basal/unknown-duration');
          currBasal = currBasal.done();
        }

        events.push(currBasal);
      }
    },
    tempBasal: function(event) {
      if(event.subType === 'start') {
        setCurrTempBasal(event);
      }
      else if(event.subType === 'stop') {
        // Cancelled temp basal has two 'stop's. We're interested in the first,
        // so make sure we're not overwriting the first 'stop'
        if(currTempBasal != null && currTempBasal.subType === 'start') {
          var tempBasal = _.clone(currTempBasal);
          tempBasal.subType = 'stop';
          tempBasal.time_left = event.time_left;
          setCurrTempBasal(tempBasal);
        }
      }
    },
    newDay: function(event) {
      ensureTimestamp(event);
      if (currBasal !== null) {
         if (currStatus !== null && currStatus.status === 'suspended') {
           return;
           // only insert the new day event if the basal rate is not suspended
         }

        if (currBasal.time !== event.time) {
          if (!currBasal.isAssigned('duration')) {
            currBasal.with_duration(Date.parse(event.time) - Date.parse(currBasal.time));
            currBasal = common.truncateDuration(currBasal, 'tandem');
          }

          if(currBasal.deliveryType === 'temp') {
            if (currTempBasal != null) {
              currBasal.percent = currTempBasal.percent;
              if(currBasal.isAssigned('payload')) {
                currBasal.payload.duration =  currTempBasal.duration;
              }else{
                currBasal.payload = {duration : currTempBasal.duration};
              }
            }
            var suppressed = currBasal.suppressed;
            event.deliveryType = 'temp';
            event.percent = currBasal.percent;
            event.rate = currBasal.rate;
            event.set('suppressed', suppressed);
          }
          currBasal = currBasal.done();

          event.set('type', 'basal');
          event.with_payload(currBasal.payload);
          annotate.annotateEvent(event, 'tandem/basal/fabricated-from-new-day');

          events.push(currBasal);
          setCurrBasal(event);
        }
      }
    },
    bolus: function(event) {
      simpleSimulate(event);
    },
    changeDeviceTime: function(event) {
      simpleSimulate(event);
    },
    cartridgeChange: function(event) {
      simpleSimulate(event);
    },
    pumpSettings: function(event) {
      simpleSimulate(event);
    },
    smbg: function(event) {
      simpleSimulate(event);
    },
    cbg: function(event) {
      if (currCBG && (event.value === currCBG.value)) {
        // backfill values can cause duplicates, so we remove any dupes
        // that happen between the Five Minute Reading (FMR) intervals
        var duration = Date.parse(event.time) - Date.parse(currCBG.time);
        // according to Tandem, backfill timestamps can be around 30 seconds
        // off, so we use 2 minutes to add a bit of a buffer
        if (duration < (2 * sundial.MIN_TO_MSEC)) {
          return;
        }
      }
      delete event.cgmType;
      simpleSimulate(event);
      setCurrCBG(event);
    },
    calibration: function(event) {
      simpleSimulate(event);
    },
    suspend: function(event) {
      if (currStatus != null && currStatus.status === 'suspended') {
        return;
      }
      setCurrStatus(event);
    },
    resume: function(event) {
      ensureTimestamp(event);
      if (currStatus != null && currStatus.status === 'suspended') {
        currStatus.reason.resumed = event.reason.resumed;
        currStatus.with_duration(Date.parse(event.time) - Date.parse(currStatus.time));
        if (currStatus.payload.reason != null) {
          currStatus.payload.suspended = currStatus.payload.reason;
          delete currStatus.payload.reason;
        }
        if (event.payload.reason != null) {
          currStatus.payload.resumed = event.payload.reason;
        }
        events.push(currStatus.done());
      } else {
        debug('Resume event without suspend:', event);
        var resumeBasal = _.clone(event);
        annotate.annotateEvent(resumeBasal,'status/incomplete-tuple');
        events.push(resumeBasal.done());
      }
      setCurrStatus(event);
    },
    wizard: function(event) {
      simpleSimulate(event);
    },
    getEvents: function() {
      function filterOutZeroBoluses() {
        return _.filter(events, function(event) {
          // we include the index on all objects to be able to sort accurately in
          // pump-event order despite date & time settings changes, but it's not
          // part of our data model, so we delete before uploading
          delete event.index;
          if (event.type === 'bolus') {
            if (event.normal === 0 && !event.expectedNormal) {
              return false;
            }
            else {
              return true;
            }
          }
          else if (event.type === 'wizard') {
            var bolus = event.bolus || null;
            if (bolus != null) {
              if (bolus.normal === 0 && !bolus.expectedNormal) {
                return false;
              }
              else {
                return true;
              }
            }
          }
          return true;
        });
      }
      // because we have to wait for the *next* basal to determine the duration of a current
      // basal, basal events get added to `events` out of order wrt other events
      // (although within their own type all the basals are always in order)
      // end result: we have to sort events again before we try to upload them
      var orderedEvents = _.sortBy(filterOutZeroBoluses(), function(e) { return e.time; });

      return orderedEvents;
    }
  };
};
