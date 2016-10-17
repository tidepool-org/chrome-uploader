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

var sundial = require('sundial');

var annotate = require('./eventAnnotations');

/**
 * Computes the number of milliseconds after midnight on the date specified.
 *
 * @param dateTime DateTime object to figure out millis from
 * @returns {number} number of millis in current day
 */
exports.computeMillisInCurrentDay = function(e){
  var msFromMidnight = sundial.getMsFromMidnight(e.time, e.timezoneOffset);
  var fifteenMinsInMs = 15*60*1000;
  // adjustments for clock drift screw up our logic to see if a basal
  // matches a schedule, so we round to the nearest fifteen mins
  // to increase the chance of matching up with a schedule
  if (e.conversionOffset && e.conversionOffset !== 0) {
    var result = Math.round(msFromMidnight/fifteenMinsInMs)*fifteenMinsInMs;
    return result === 864e5 ? 0 : result;
  }
  return msFromMidnight;
};


/* truncate long-running flat-rate basal durations to 5 days */
exports.truncateDuration = function(basal, source) {
  var fiveDays = (5 * 1440 * sundial.MIN_TO_MSEC);
  if(basal.isAssigned('duration')) {
    if(basal.duration > fiveDays) {
      //flat-rate basal
      basal.duration = fiveDays;
      annotate.annotateEvent(basal, source + '/basal/flat-rate');
    }
  } else {
    basal.with_duration(0);
    annotate.annotateEvent(basal, 'basal/unknown-duration');
  }
  return basal;
};

exports.bytes2hex = function(bytes, noGaps) {
  var message = '';
  for(var i in bytes) {
    message += bytes[i].toString(16).toUpperCase();
    if(!noGaps) {
      message += ' ';
    }
  }
  return message;
};

exports.getName = function (list, idx) {
  for (var i in list) {
    if (list[i].value === idx) {
      return list[i].name;
    }
  }
  return 'unknown';
};

exports.finalScheduledBasal = function(currBasal, settings, source) {
  var millisInDay = sundial.getMsFromMidnight(currBasal.time, currBasal.timezoneOffset);
  var basalSched = settings.basalSchedules[currBasal.scheduleName];
  if (basalSched == null || basalSched.length === 0) {
    if (!currBasal.isAssigned('duration')) {
      currBasal.duration = 0;
      annotate.annotateEvent(currBasal, 'basal/unknown-duration');
      currBasal = currBasal.done();
    }
  }
  else {
    for (var i = basalSched.length - 1; i >= 0; --i) {
      if (basalSched[i].start <= millisInDay) {
        break;
      }
    }
    if (basalSched[i].rate === currBasal.rate) {
      annotate.annotateEvent(currBasal, 'final-basal/fabricated-from-schedule');
      currBasal.duration = (i + 1 === basalSched.length ? 864e5 - millisInDay : basalSched[i + 1].start - millisInDay);
      currBasal = currBasal.done();
    }
    else {
      if (!currBasal.isAssigned('duration')) {
        currBasal.duration = 0;
        annotate.annotateEvent(currBasal, source + '/basal/off-schedule-rate');
        annotate.annotateEvent(currBasal, 'basal/unknown-duration');
        currBasal = currBasal.done();
      }
    }
  }
  return currBasal;
};
