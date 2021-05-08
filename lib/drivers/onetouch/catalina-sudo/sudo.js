/*
 * == BSD2 LICENSE ==
 * Copyright (c) 2020, Tidepool Project
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

const { execFile } = require('child_process');
const { env } = require('process');
const path = require('path');
const { promisify } = require('util');
const remote = require('@electron/remote');
const isDev = require('electron-is-dev');

const execFileAsync = promisify(execFile);

const SUCCESSFUL_AUTH_MARKER = 'AUTHENTICATION SUCCEEDED';
const EXPECTED_SUCCESSFUL_AUTH_MARKER = `${SUCCESSFUL_AUTH_MARKER}\n`;

const appFolder = path.dirname(remote.app.getAppPath());
let driverPath = path.join(appFolder, 'driver/');

if (isDev) {
  driverPath = path.join(appFolder, 'resources/mac/');
}

exports.sudo = async (command) => {
  try {
    const { stdout, stderr } = await execFileAsync(
      'sudo',
      ['--askpass', 'sh', '-c', `echo ${SUCCESSFUL_AUTH_MARKER} && ${command}`],
      {
        encoding: 'utf8',
        env: {
          PATH: env.PATH,
          SUDO_ASKPASS: path.join(driverPath, 'sudo-askpass.osascript.js'),
        },
      },
    );

    return {
      cancelled: false,
      stdout: stdout.slice(EXPECTED_SUCCESSFUL_AUTH_MARKER.length),
      stderr,
    };
  } catch (error) {
    console.log('sudo error:', error);
    /* eslint-disable-next-line no-magic-numbers */
    if (error.code === 1) {
      /* eslint-disable-next-line lodash/prefer-lodash-method */
      if (!error.stdout.startsWith(EXPECTED_SUCCESSFUL_AUTH_MARKER)) {
        return { cancelled: true };
      }
      error.stdout = error.stdout.slice(EXPECTED_SUCCESSFUL_AUTH_MARKER.length);
    }
    throw error;
  }
};
