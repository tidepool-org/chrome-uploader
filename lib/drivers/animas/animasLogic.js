/*
 * == BSD2 LICENSE ==
 * Copyright (c) 2016, Tidepool Project
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

 var common = require('../../commonFunctions');

 var roundAndNotNegative = function(number) {
   if(number < 0) {
     return 0;
   }
   // calculated total units are rounded to the nearest .05 units
   return (Math.ceil(number*20 - 0.5)/20).toFixedNumber(2);
 };

var withinTarget = function(wizDetails) {
  return (Math.abs(wizDetails.bg - wizDetails.target_bg) < wizDetails.bg_delta) ? true : false;
};

var calculateCarbRecommendation = function(wizDetails) {
  // intermediate values in a calculation are truncated to two decimal places
  return (wizDetails.carb_amount/wizDetails.carb_ratio).toFixedNumber(2, true);
};

var calculateCorrectionRecommendation = function(wizDetails) {
  if(!withinTarget(wizDetails)) {
    // Intermediate values in a calucation are truncated to two decimal places.
    // As we're performing two operations here (subtract and then divide), we use
    // Math.fround() to emulate 32-bit float so that we don't get different floating
    // point rounding errors than what is happening on the pump
    // For more info, see http://stackoverflow.com/a/28046896/682179
    return (Math.fround(wizDetails.bg - wizDetails.target_bg) / wizDetails.isf).toFixedNumber(2, true);
  }
  else {
    return 0;
  }
};

var calculateNetRecommendation = function(wizDetails, bgOrCarbTriggered) {

  if (bgOrCarbTriggered === 'bg')  {
    // ezBG only
    var correction = calculateCorrectionRecommendation(wizDetails);
    if (wizDetails.configuration.iobEnabled) {
      // IOB enabled
      if (withinTarget(wizDetails)) {
        // within target, only use correction bolus
        return roundAndNotNegative(correction);
      }
      else {
        if ((wizDetails.bg - wizDetails.target_bg) > 0) {
          // above target, subtract IOB from correction bolus
          return roundAndNotNegative(correction - wizDetails.iob);
        }
        else {
          // below target, IOB not subtracted as it's ezBG only
          return roundAndNotNegative(correction);
        }
      }
    }
    else {
      // IOB disabled
      return roundAndNotNegative(correction);
    }
  }

  if (wizDetails.configuration.correctionAdded === false) {
    // ezCarb only
    return roundAndNotNegative(calculateCarbRecommendation(wizDetails));
  }

  // ezCarb with correction bolus
  if (wizDetails.configuration.iobEnabled) {
    //IOB enabled
    if (withinTarget(wizDetails)) {
      //IOB not subtracted; just add food bolus and correction bolus
      return roundAndNotNegative(calculateCarbRecommendation(wizDetails) + calculateCorrectionRecommendation(wizDetails));
    }
    else {
      if ((wizDetails.bg - wizDetails.target_bg) > 0) {
        // above target, subtract IOB from correction bolus
        var correctionMinIOB =  calculateCorrectionRecommendation(wizDetails) - wizDetails.iob;
        return roundAndNotNegative(calculateCarbRecommendation(wizDetails) + Math.max(0,correctionMinIOB));
      }
      else {
        // below target, subtract IOB from food bolus
        var foodBolusMinIOB = calculateCarbRecommendation(wizDetails) - wizDetails.iob;
        return roundAndNotNegative(calculateCorrectionRecommendation(wizDetails) + Math.max(0,foodBolusMinIOB));
      }
    }
  }
  else {
    // IOB disabled
    return roundAndNotNegative(calculateCarbRecommendation(wizDetails) + calculateCorrectionRecommendation(wizDetails));
  }
};

exports.calculateCarbRecommendation = calculateCarbRecommendation;
exports.calculateCorrectionRecommendation = calculateCorrectionRecommendation;
exports.calculateNetRecommendation = calculateNetRecommendation;
exports.toFixedNumber =  Number.prototype.toFixedNumber;
