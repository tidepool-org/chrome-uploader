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

// NB: this module is ES5 because the CLI tools run in node
// and these error constants are a dependency through lib/core/api.js

module.exports = {
  E_DEVICE_UPLOAD: 'Something went wrong during device upload',
  E_FILE_EXT: 'Please choose a file ending in ',
  E_HID_CONNECTION: 'Hmm, your device doesn\'t appear to be connected',
  E_INIT: 'Error during app initialization',
  E_MEDTRONIC_UNSUPPORTED: 'Tidepool does not support Minimed pumps 522, 722 or older, or the newer 6-series pumps. Sorry...',
  E_MEDTRONIC_UPLOAD: 'Make sure no other software (e.g. CareLink, OpenAPS, Loop) is talking to your pump. Otherwise, please see the error details below or contact Tidepool Support.',
  E_OFFLINE: 'Not connected to the Internet!',
  E_READ_FILE: 'Error reading file ',
  E_SERIAL_CONNECTION: 'Hmm, we couldn\'t detect your device',
  E_SERVER_ERR: 'Sorry, the Tidepool servers appear to be down',
  E_UPLOAD_IN_PROGRESS: 'Sorry, an upload is already in progress',
  E_UNPLUG_AND_RETRY: 'Please unplug device and try again',
  E_UNSUPPORTED: 'Sorry, we don\'t support this device yet'
};
