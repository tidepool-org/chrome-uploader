/*
 * == BSD2 LICENSE ==
 * Copyright (c) 2018, Tidepool Project
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
const isElectron = require('is-electron');
const { ipcRenderer, ipcMain } = require('electron');
let isRenderer = (process && process.type === 'renderer');

const PERIODS = {
  ALL: 1,
  DELTA: 2,
  FOUR_WEEKS: 3,
};

if (isRenderer) {
  const remote = require('@electron/remote');
  const uploadDataPeriod = module.exports = {
    get periodGlobal() {
      return remote.getGlobal('period');
    },
    get periodMedtronic600() {
      return remote.getGlobal('periodMedtronic600');
    },
    PERIODS,
    setPeriodMedtronic600: function(toPeriod) {
      ipcRenderer.send('setUploadDataPeriodMedtronic600', toPeriod);
      localStorage.setItem('uploadDataPeriodMedtronic600', toPeriod);
      return remote.getGlobal('periodMedtronic600');
    },
    setPeriodGlobal: function(toPeriod) {
      ipcRenderer.send('setUploadDataPeriodGlobal', toPeriod);
      localStorage.setItem('uploadDataPeriodGlobal', toPeriod);
      return remote.getGlobal('period');
    }
  };

  // localStorage is not available in Electron main process, so we have to read
  // and set it in the renderer process
  ipcRenderer.send('setUploadDataPeriodMedtronic600',
    JSON.parse(localStorage.getItem('uploadDataPeriodMedtronic600')) ||
    PERIODS.DELTA
  );
  ipcRenderer.send('setUploadDataPeriodGlobal',
    JSON.parse(localStorage.getItem('uploadDataPeriodGlobal')) ||
    PERIODS.DELTA
  );

  ipcRenderer.on('savePeriodGlobal', (event, arg) => {
    localStorage.setItem('uploadDataPeriodGlobal', arg);
  });

  ipcRenderer.on('savePeriodMedtronic600', (event, arg) => {
    localStorage.setItem('uploadDataPeriodMedtronic600', arg);
  });

} else {
  // main process

  if (isElectron()) {
    global.periodMedtronic600 = PERIODS.DELTA;
    global.period = PERIODS.DELTA;

    ipcMain.on('setUploadDataPeriodMedtronic600', (event, arg) => {
      global.periodMedtronic600 = arg;
    });
    ipcMain.on('setUploadDataPeriodGlobal', (event, arg) => {
      global.period = arg;
    });

    const uploadDataPeriod = module.exports = {
      get periodGlobal() {
        return global.period;
      },
      get periodMedtronic600() {
        return global.periodMedtronic600;
      },
      PERIODS,
      // since the main process does not have access to localStorage,
      // we have to send the values back to the renderer process to save it
      setPeriodMedtronic600: function(toPeriod, window) {
        global.periodMedtronic600 = toPeriod;
        window.webContents.send('savePeriodMedtronic600', toPeriod);
        return global.periodMedtronic600;
      },
      setPeriodGlobal: function(toPeriod, window) {
        global.period = toPeriod;
        window.webContents.send('savePeriodGlobal', toPeriod);
        return global.period;
      }
    };
  } else {
    // we're running as a Node process (e.g. running as a script),
    // so just default to delta
    const uploadDataPeriod = module.exports = {
      periodMedtronic600: PERIODS.DELTA,
      periodGlobal: PERIODS.DELTA,
      PERIODS,
    };
  }
}
