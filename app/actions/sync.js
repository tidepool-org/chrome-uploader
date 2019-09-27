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

import _ from 'lodash';

import * as actionTypes from '../constants/actionTypes';
import * as actionSources from '../constants/actionSources';
import * as metrics from '../constants/metrics';

import {
  addInfoToError,
  getAppInitErrorMessage,
  getLoginErrorMessage,
  getLogoutErrorMessage,
  getUpdateProfileErrorMessage,
  getCreateCustodialAccountErrorMessage,
  UnsupportedError
} from '../utils/errors';
import errorText from '../constants/errors';

import * as actionUtils from './utils';
import personUtils from '../../lib/core/personUtils';
import uploadDataPeriod from '../utils/uploadDataPeriod';

const uploadDataPeriodLabels = {
  [uploadDataPeriod.PERIODS.ALL]: 'all data',
  [uploadDataPeriod.PERIODS.DELTA]: 'new data',
  [uploadDataPeriod.PERIODS.FOUR_WEEKS]: '4 weeks'
};

export function addTargetDevice(userId, deviceKey) {
  return {
    type: actionTypes.ADD_TARGET_DEVICE,
    payload: { userId, deviceKey },
    meta: {source: actionSources[actionTypes.ADD_TARGET_DEVICE]}
  };
}

// NB: this action exists purely to trigger the metrics middleware
// no reducer responds to it to adjust any state!
export function clickGoToBlip() {
  return {
    type: actionTypes.CLICK_GO_TO_BLIP,
    meta: {
      source: actionSources[actionTypes.CLICK_GO_TO_BLIP],
      metric: {eventName: metrics.CLICK_GO_TO_BLIP}
    }
  };
}

export function rememberMedtronicSerialNumber(serialNumber) {
  return {
    type: actionTypes.MEDTRONIC_REMEMBER_SERIAL_NUMBER,
    meta: {
      source: actionSources[actionTypes.MEDTRONIC_REMEMBER_SERIAL_NUMBER],
      metric: { eventName: metrics.MEDTRONIC_REMEMBER_SERIAL_NUMBER }
    }
  };
}

export function clinicAddMrn(){
  return {
    type: actionTypes.CLINIC_ADD_MRN,
    meta: {
      source: actionSources[actionTypes.CLINIC_ADD_MRN],
      metric: {eventName: metrics.CLINIC_ADD_MRN}
    }
  };
}

export function clinicAddEmail(){
  return {
    type: actionTypes.CLINIC_ADD_EMAIL,
    meta: {
      source: actionSources[actionTypes.CLINIC_ADD_EMAIL],
      metric: {eventName: metrics.CLINIC_ADD_EMAIL}
    }
  };
}

export function clinicAddDevice(deviceKey){
  return {
    type: actionTypes.CLINIC_DEVICE_STORED,
    meta: {
      source: actionSources[actionTypes.CLINIC_DEVICE_STORED],
      metric: {eventName: metrics.CLINIC_DEVICE_STORED + ' - ' + deviceKey}
    }
  };
}

export function clinicInvalidDate(errors){
  if (_.get(errors, 'year', false)) {
    return {
      type: actionTypes.CLINIC_ADD_INVALID_DATE,
      meta: {
        source: actionSources[actionTypes.CLINIC_ADD_INVALID_DATE],
        metric: {eventName: metrics.CLINIC_ADD_INVALID_DATE}
      }
    };
  }
}

export function hideUnavailableDevices(os) {
  return {
    type: actionTypes.HIDE_UNAVAILABLE_DEVICES,
    payload: { os },
    meta: {source: actionSources[actionTypes.HIDE_UNAVAILABLE_DEVICES]}
  };
}

export function removeTargetDevice(userId, deviceKey) {
  return {
    type: actionTypes.REMOVE_TARGET_DEVICE,
    payload: { userId, deviceKey },
    meta: {source: actionSources[actionTypes.REMOVE_TARGET_DEVICE]}
  };
}

export function resetUpload(userId, deviceKey) {
  return {
    type: actionTypes.RESET_UPLOAD,
    payload: { userId, deviceKey },
    meta: {source: actionSources[actionTypes.RESET_UPLOAD]}
  };
}

export function setBlipViewDataUrl(url) {
  return {
    type: actionTypes.SET_BLIP_VIEW_DATA_URL,
    payload: { url },
    meta: {source: actionSources[actionTypes.SET_BLIP_VIEW_DATA_URL]}
  };
}

export function setForgotPasswordUrl(url) {
  return {
    type: actionTypes.SET_FORGOT_PASSWORD_URL,
    payload: { url },
    meta: {source: actionSources[actionTypes.SET_FORGOT_PASSWORD_URL]}
  };
}

export function setNewPatientUrl(url) {
  return {
    type: actionTypes.SET_NEW_PATIENT_URL,
    payload: { url },
    meta: {source: actionSources[actionTypes.SET_NEW_PATIENT_URL]}
  };
}

export function setSignUpUrl(url) {
  return {
    type: actionTypes.SET_SIGNUP_URL,
    payload: { url },
    meta: {source: actionSources[actionTypes.SET_SIGNUP_URL]}
  };
}

export function setTargetTimezone(userId, timezoneName, metric) {
  let meta = {source: actionSources[actionTypes.SET_TARGET_TIMEZONE]};
  if (metric) {
    _.assign(meta, metric);
  }
  return {
    type: actionTypes.SET_TARGET_TIMEZONE,
    payload: { userId, timezoneName },
    meta: meta
  };
}

export function setUploads(devicesByUser) {
  return {
    type: actionTypes.SET_UPLOADS,
    payload: { devicesByUser },
    meta: {source: actionSources[actionTypes.SET_UPLOADS]}
  };
}

export function setUploadTargetUser(userId, metric) {
  let meta = {source: actionSources[actionTypes.SET_UPLOAD_TARGET_USER]};
  if (metric) {
    _.assign(meta, {metric});
  }
  return {
    type: actionTypes.SET_UPLOAD_TARGET_USER,
    payload: { userId },
    meta
  };
}

export function toggleDropdown(previous, actionSource = actionSources[actionTypes.TOGGLE_DROPDOWN]) {
  return {
    type: actionTypes.TOGGLE_DROPDOWN,
    payload: { isVisible: !previous },
    meta: {source: actionSource}
  };
}

export function toggleErrorDetails(userId, deviceKey, previous) {
  if (_.includes([null, undefined], previous)) {
    previous = false;
  }
  return {
    type: actionTypes.TOGGLE_ERROR_DETAILS,
    payload: { isVisible: !previous, userId, deviceKey },
    meta: {source: actionSources[actionTypes.TOGGLE_ERROR_DETAILS]}
  };
}

export function dismissUpdateProfileError(){
  return {
    type: actionTypes.DISMISS_UPDATE_PROFILE_ERROR,
    meta: {source: actionSources[actionTypes.DISMISS_UPDATE_PROFILE_ERROR]}
  };
}

export function dismissCreateCustodialAccountError(){
  return {
    type: actionTypes.DISMISS_CREATE_CUSTODIAL_ACCOUNT_ERROR,
    meta: {source: actionSources[actionTypes.DISMISS_CREATE_CUSTODIAL_ACCOUNT_ERROR]}
  };
}

export function setAllUsers(user, profile, memberships){
  return {
    type: actionTypes.SET_ALL_USERS,
    payload: { memberships: memberships, user: user, profile: profile },
    meta: {source: actionSources[actionTypes.SET_ALL_USERS]}
  };
}

/*
 * relating to async action creator doAppInit
 */

export function initRequest() {
  return {
    type: actionTypes.INIT_APP_REQUEST,
    meta: {source: actionSources[actionTypes.INIT_APP_REQUEST]}
  };
}

export function initSuccess() {
  return {
    type: actionTypes.INIT_APP_SUCCESS,
    meta: {source: actionSources[actionTypes.INIT_APP_SUCCESS]}
  };
}

export function initFailure(err) {
  const error = new Error(getAppInitErrorMessage(err.status || null));
  error.originalError = err;
  return {
    type: actionTypes.INIT_APP_FAILURE,
    error: true,
    payload: error,
    meta: {source: actionSources[actionTypes.INIT_APP_FAILURE]}
  };
}

export function setUserInfoFromToken(results) {
  const { user, profile, memberships } = results;
  return {
    type: actionTypes.SET_USER_INFO_FROM_TOKEN,
    payload: { user, profile, memberships },
    meta: {source: actionSources[actionTypes.SET_USER_INFO_FROM_TOKEN]}
  };
}

/*
 * relating to async action creator doLogin
 */

export function loginRequest() {
  return {
    type: actionTypes.LOGIN_REQUEST,
    meta: {source: actionSources[actionTypes.LOGIN_REQUEST]}
  };
}

export function loginSuccess(results) {
  const { user, profile, memberships } = results;
  const isClinicAccount = personUtils.userHasRole(user, 'clinic');
  if (isClinicAccount) {
    uploadDataPeriod.setPeriodMedtronic600(uploadDataPeriod.PERIODS.FOUR_WEEKS);
  }
  return {
    type: actionTypes.LOGIN_SUCCESS,
    payload: { user, profile, memberships },
    meta: {
      source: actionSources[actionTypes.LOGIN_SUCCESS],
      metric: {eventName: isClinicAccount ? metrics.CLINIC_LOGIN_SUCCESS : metrics.LOGIN_SUCCESS}
    }
  };
}

export function loginFailure(errorCode) {
  return {
    type: actionTypes.LOGIN_FAILURE,
    error: true,
    payload: new Error(getLoginErrorMessage(errorCode)),
    meta: {source: actionSources[actionTypes.LOGIN_FAILURE]}
  };
}

/*
 * relating to async action creator doLogout
 */

export function logoutRequest() {
  return {
    type: actionTypes.LOGOUT_REQUEST,
    meta: {
      source: actionSources[actionTypes.LOGOUT_REQUEST],
      metric: {eventName: metrics.LOGOUT_REQUEST}
    }
  };
}

export function logoutSuccess() {
  return {
    type: actionTypes.LOGOUT_SUCCESS,
    meta: {source: actionSources[actionTypes.LOGOUT_SUCCESS]}
  };
}

export function logoutFailure() {
  return {
    type: actionTypes.LOGOUT_FAILURE,
    error: true,
    payload: new Error(getLogoutErrorMessage()),
    meta: {source: actionSources[actionTypes.LOGOUT_FAILURE]}
  };
}

/*
 * relating to async action creator doUpload
 */

export function uploadAborted() {
  return {
    type: actionTypes.UPLOAD_ABORTED,
    error: true,
    payload: new Error(errorText.E_UPLOAD_IN_PROGRESS),
    meta: {source: actionSources[actionTypes.UPLOAD_ABORTED]}
  };
}

export function uploadRequest(userId, device, utc) {
  utc = actionUtils.getUtc(utc);
  const properties = {
    type: _.get(device, 'source.type', undefined),
    source: `${actionUtils.getUploadTrackingId(device)}`
  };
  if (_.get(device, 'source.driverId', null) === 'Medtronic600') {
    _.extend(properties, { 'limit': uploadDataPeriodLabels[uploadDataPeriod.periodMedtronic600] });
  }
  return {
    type: actionTypes.UPLOAD_REQUEST,
    payload: { userId, deviceKey: device.key, utc },
    meta: {
      source: actionSources[actionTypes.UPLOAD_REQUEST],
      metric: {
        eventName: `${metrics.UPLOAD_REQUEST}`,
        properties
      }
    }
  };
}

export function uploadProgress(step, percentage, isFirstUpload) {
  return {
    type: actionTypes.UPLOAD_PROGRESS,
    payload: { step, percentage, isFirstUpload },
    meta: {source: actionSources[actionTypes.UPLOAD_PROGRESS]}
  };
}

export function uploadSuccess(userId, device, upload, data, utc) {
  utc = actionUtils.getUtc(utc);
  const numRecs = _.get(data, 'post_records.length', undefined);
  const properties = {
    type: _.get(device, 'source.type', undefined),
    deviceModel: _.get(data, 'deviceModel', undefined),
    source: `${actionUtils.getUploadTrackingId(device)}`,
    started: upload.history[0].start || '',
    finished: utc || '',
    processed: numRecs || 0
  };
  if (_.get(device, 'source.driverId', null) === 'Medtronic600') {
    _.extend(properties, { 'limit': uploadDataPeriodLabels[uploadDataPeriod.periodMedtronic600] });
  }
  return {
    type: actionTypes.UPLOAD_SUCCESS,
    payload: { userId, deviceKey: device.key, data, utc },
    meta: {
      source: actionSources[actionTypes.UPLOAD_SUCCESS],
      metric: {
        eventName: `${metrics.UPLOAD_SUCCESS}`,
        properties
      }
    }
  };
}

export function uploadFailure(err, errProps, device) {
  err = addInfoToError(err, errProps);
  const properties = {
    type: _.get(device, 'source.type', undefined),
    source: `${actionUtils.getUploadTrackingId(device)}`,
    error: err
  };
  if (_.get(device, 'source.driverId', null) === 'Medtronic600') {
    _.extend(properties, { 'limit': uploadDataPeriodLabels[uploadDataPeriod.periodMedtronic600] });
  }
  return {
    type: actionTypes.UPLOAD_FAILURE,
    error: true,
    payload: err,
    meta: {
      source: actionSources[actionTypes.UPLOAD_FAILURE],
      metric: {
        eventName: `${metrics.UPLOAD_FAILURE}`,
        properties
      }
    }
  };
}

export function uploadCancelled(utc) {
  return {
    type: actionTypes.UPLOAD_CANCELLED,
    payload: { utc },
    meta: {
      source: actionSources[actionTypes.UPLOAD_CANCELLED]
    }
  };
}

export function deviceDetectRequest() {
  return {
    type: actionTypes.DEVICE_DETECT_REQUEST,
    meta: {source: actionSources[actionTypes.DEVICE_DETECT_REQUEST]}
  };
}

/*
 * relating to async action creator readFile
 */

export function choosingFile(userId, deviceKey) {
  return {
    type: actionTypes.CHOOSING_FILE,
    payload: { userId, deviceKey },
    meta: {source: actionSources[actionTypes.CHOOSING_FILE]}
  };
}

export function readFileAborted(err, errProps) {
  return {
    type: actionTypes.READ_FILE_ABORTED,
    error: true,
    payload: addInfoToError(err, errProps),
    meta: {source: actionSources[actionTypes.READ_FILE_ABORTED]}
  };
}

export function readFileRequest(userId, deviceKey, filename) {
  return {
    type: actionTypes.READ_FILE_REQUEST,
    payload: { userId, deviceKey, filename },
    meta: {source: actionSources[actionTypes.READ_FILE_REQUEST]}
  };
}

export function readFileSuccess(userId, deviceKey, filedata) {
  return {
    type: actionTypes.READ_FILE_SUCCESS,
    payload: { userId, deviceKey, filedata },
    meta: {source: actionSources[actionTypes.READ_FILE_SUCCESS]}
  };
}

export function readFileFailure(err, errProps) {
  return {
    type: actionTypes.READ_FILE_FAILURE,
    error: true,
    payload: addInfoToError(err, errProps),
    meta: {source: actionSources[actionTypes.READ_FILE_FAILURE]}
  };
}

/*
 * relating to async action creator doVersionCheck
 */

export function versionCheckRequest() {
  return {
    type: actionTypes.VERSION_CHECK_REQUEST,
    meta: {source: actionSources[actionTypes.VERSION_CHECK_REQUEST]}
  };
}

export function versionCheckSuccess() {
  return {
    type: actionTypes.VERSION_CHECK_SUCCESS,
    meta: {source: actionSources[actionTypes.VERSION_CHECK_SUCCESS]}
  };
}

export function versionCheckFailure(err, currentVersion, requiredVersion) {
  if (err != null) {
    return {
      type: actionTypes.VERSION_CHECK_FAILURE,
      error: true,
      payload: err,
      meta: {
        source: actionSources[actionTypes.VERSION_CHECK_FAILURE],
        metric: {
          eventName: metrics.UNSUPPORTED_SCREEN_DISPLAYED
        }
      }
    };
  }
  else {
    return {
      type: actionTypes.VERSION_CHECK_FAILURE,
      error: true,
      payload: new UnsupportedError(currentVersion, requiredVersion),
      meta: {
        source: actionSources[actionTypes.VERSION_CHECK_FAILURE],
        metric: {
          eventName: metrics.VERSION_CHECK_FAILURE_OUTDATED,
          properties: { requiredVersion }
        }
      }
    };
  }
}

/*
 * relating to updateProfile
 */

export function updateProfileRequest() {
  return {
    type: actionTypes.UPDATE_PROFILE_REQUEST,
    meta: {source: actionSources[actionTypes.UPDATE_PROFILE_REQUEST]}
  };
}

export function updateProfileSuccess(profile, userId) {
  return {
    type: actionTypes.UPDATE_PROFILE_SUCCESS,
    payload: { profile, userId },
    meta: {source: actionSources[actionTypes.UPDATE_PROFILE_SUCCESS]}
  };
}

export function updateProfileFailure(err) {
  const error = new Error(getUpdateProfileErrorMessage(err.status || null));
  error.originalError = err;
  return {
    type: actionTypes.UPDATE_PROFILE_FAILURE,
    error: true,
    payload: error,
    meta: {source: actionSources[actionTypes.UPDATE_PROFILE_FAILURE]}
  };
}

/*
 * relating to createCustodialAccount
 */

export function createCustodialAccountRequest() {
  return {
    type: actionTypes.CREATE_CUSTODIAL_ACCOUNT_REQUEST,
    meta: {source: actionSources[actionTypes.CREATE_CUSTODIAL_ACCOUNT_REQUEST]}
  };
}

export function createCustodialAccountSuccess(account) {
  return {
    type: actionTypes.CREATE_CUSTODIAL_ACCOUNT_SUCCESS,
    payload: { account },
    meta: {
      source: actionSources[actionTypes.CREATE_CUSTODIAL_ACCOUNT_SUCCESS],
      metric: {eventName: metrics.CLINIC_ADD_NEW_PATIENT}
    }
  };
}

export function createCustodialAccountFailure(err) {
  const error = new Error(getCreateCustodialAccountErrorMessage(err.status || null));
  error.originalError = err;
  return {
    type: actionTypes.CREATE_CUSTODIAL_ACCOUNT_FAILURE,
    error: true,
    payload: error,
    meta: {source: actionSources[actionTypes.CREATE_CUSTODIAL_ACCOUNT_FAILURE]}
  };
}

/*
 * relating to side-effect-performing action creators
 * retrieveTargetsFromStorage
 */

export function retrieveUsersTargetsFromStorage() {
  return {
    type: actionTypes.RETRIEVING_USERS_TARGETS,
    meta: {source: actionSources[actionTypes.RETRIEVING_USERS_TARGETS]}
  };
}

export function setUsersTargets(targets) {
  return {
    type: actionTypes.SET_USERS_TARGETS,
    payload: { targets },
    meta: {source: actionSources[actionTypes.SET_USERS_TARGETS]}
  };
}

/*
 * relating to electron auto-updater
 */

export function autoCheckingForUpdates() {
  return {
    type: actionTypes.AUTO_UPDATE_CHECKING_FOR_UPDATES,
    meta: { source: actionSources[actionTypes.AUTO_UPDATE_CHECKING_FOR_UPDATES] }
  };
}

export function manualCheckingForUpdates() {
  return {
    type: actionTypes.MANUAL_UPDATE_CHECKING_FOR_UPDATES,
    meta: { source: actionSources[actionTypes.MANUAL_UPDATE_CHECKING_FOR_UPDATES] }
  };
}

export function updateAvailable(info) {
  return {
    type: actionTypes.UPDATE_AVAILABLE,
    payload: { info },
    meta: { source: actionSources[actionTypes.UPDATE_AVAILABLE] }
  };
}

export function updateNotAvailable(info) {
  return {
    type: actionTypes.UPDATE_NOT_AVAILABLE,
    payload: { info },
    meta: { source: actionSources[actionTypes.UPDATE_NOT_AVAILABLE] }
  };
}

export function autoUpdateError(error) {
  return {
    type: actionTypes.AUTOUPDATE_ERROR,
    payload: { error },
    meta: { source: actionSources[actionTypes.AUTOUPDATE_ERROR] }
  };
}

export function updateDownloaded(info) {
  return {
    type: actionTypes.UPDATE_DOWNLOADED,
    payload: { info },
    meta: { source: actionSources[actionTypes.UPDATE_DOWNLOADED] }
  };
}

export function dismissUpdateAvailable() {
  return {
    type: actionTypes.DISMISS_UPDATE_AVAILABLE,
    meta: { source: actionSources[actionTypes.DISMISS_UPDATE_AVAILABLE] }
  };
}

export function dismissUpdateNotAvailable() {
  return {
    type: actionTypes.DISMISS_UPDATE_NOT_AVAILABLE,
    meta: { source: actionSources[actionTypes.DISMISS_UPDATE_NOT_AVAILABLE] }
  };
}

export function quitAndInstall() {
  return {
    type: actionTypes.QUIT_AND_INSTALL,
    meta: {
      source: actionSources[actionTypes.QUIT_AND_INSTALL],
      metric: { eventName: metrics.QUIT_AND_INSTALL }
    }
  };
}

/*
 * relating to driver updates
 */

export function checkingForDriverUpdate() {
  return {
    type: actionTypes.CHECKING_FOR_DRIVER_UPDATE,
    meta: { source: actionSources[actionTypes.CHECKING_FOR_DRIVER_UPDATE] }
  };
}

export function driverUpdateAvailable(current, available) {
  return {
    type: actionTypes.DRIVER_UPDATE_AVAILABLE,
    payload: { current, available },
    meta: { source: actionSources[actionTypes.DRIVER_UPDATE_AVAILABLE] }
  };
}

export function driverUpdateNotAvailable() {
  return {
    type: actionTypes.DRIVER_UPDATE_NOT_AVAILABLE,
    meta: { source: actionSources[actionTypes.DRIVER_UPDATE_NOT_AVAILABLE] }
  };
}

export function dismissDriverUpdateAvailable() {
  return {
    type: actionTypes.DISMISS_DRIVER_UPDATE_AVAILABLE,
    meta: { source: actionSources[actionTypes.DISMISS_DRIVER_UPDATE_AVAILABLE] }
  };
}

export function driverInstall() {
  return {
    type: actionTypes.DRIVER_INSTALL,
    meta: {
      source: actionSources[actionTypes.DRIVER_INSTALL]
    }
  };
}

export function driverUpdateShellOpts(opts) {
  return {
    type: actionTypes.DRIVER_INSTALL_SHELL_OPTS,
    payload: { opts },
    meta: {source: actionSources[actionTypes.DRIVER_INSTALL_SHELL_OPTS] }
  };
}

export function deviceTimeIncorrect(callback, cfg, times) {
  return {
    type: actionTypes.DEVICE_TIME_INCORRECT,
    payload: { callback, cfg, times },
    meta: {
      source: actionSources[actionTypes.DEVICE_TIME_INCORRECT],
      metric: {
        eventName: metrics.DEVICE_TIME_INCORRECT,
        properties: { times },
      }
    },
  };
}

export function dismissedDeviceTimePrompt() {
  return {
    type: actionTypes.DISMISS_DEVICE_TIME_PROMPT,
    meta: { source: actionSources[actionTypes.DISMISS_DEVICE_TIME_PROMPT] }
  };
}

export function timezoneBlur() {
  return {
    type: actionTypes.TIMEZONE_BLUR,
    meta: { source: actionSources[actionTypes.TIMEZONE_BLUR] }
  };
}

/*
* relating to ad hoc pairing dialog
*/

export function adHocPairingRequest(callback, cfg) {
  return {
    type: actionTypes.AD_HOC_PAIRING_REQUEST,
    payload: { callback, cfg },
    meta: { source: actionSources[actionTypes.AD_HOC_PAIRING_REQUEST] }
  };
}

export function dismissedAdHocPairingDialog() {
  return {
    type: actionTypes.AD_HOC_PAIRING_DISMISSED,
    meta: { source: actionSources[actionTypes.AD_HOC_PAIRING_DISMISSED] }
  };
}
