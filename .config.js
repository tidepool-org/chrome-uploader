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

function stringToBoolean(str, defaultValue) {
  if (str === 'true') {
    return true;
  }
  if (str === 'false') {
    return false;
  }
  return defaultValue || false;
}

function stringToArray(str, defaultValue) {
  if (!(str && str.length)) {
    return defaultValue;
  }
  return str.split(',');
}

module.exports = {
  // this is to always have the Bows logger turned on!
  // NB: it is distinct from our own "debug mode"
  DEBUG: stringToBoolean(process.env.DEBUG, true),
  // the defaults for these need to be pointing to prod
  API_URL: process.env.API_URL || 'https://api.tidepool.org',
  UPLOAD_URL: process.env.UPLOAD_URL || 'https://uploads.tidepool.org',
  DATA_URL: process.env.DATA_URL || 'https://api.tidepool.org/dataservices',
  BLIP_URL: process.env.BLIP_URL || 'https://app.tidepool.org',
  DEFAULT_TIMEZONE: process.env.DEFAULT_TIMEZONE || 'America/Los_Angeles',
};
