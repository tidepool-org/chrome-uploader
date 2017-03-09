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

/* global chrome */

import _ from 'lodash';
import async from 'async';
import semver from 'semver';

import sundial from 'sundial';

import * as actionTypes from '../constants/actionTypes';
import * as actionSources from '../constants/actionSources';
import { pages, paths, steps, urls } from '../constants/otherConstants';
import errorText from '../constants/errors';
import * as metrics from '../constants/metrics';

import * as syncActions from './sync';
import * as actionUtils from './utils';
import personUtils from '../../core/personUtils';

let services = {};
let versionInfo = {};
let daysForCareLink = null;

/*
 * ASYNCHRONOUS ACTION CREATORS
 */

export function doAppInit(opts, servicesToInit) {
  return (dispatch, getState) => {

    services = servicesToInit;
    versionInfo.semver = opts.version;
    versionInfo.name = opts.namedVersion;
    daysForCareLink = opts.DEFAULT_CARELINK_DAYS;
    const { api, carelink, device, localStore, log } = services;

    // when we are developing with hot reload, we get into trouble if we try to initialize the app
    // when it's already been initialized, so we check the working.initializingApp flag first
    if (getState().working.initializingApp !== false) {
      dispatch(syncActions.initRequest());
      dispatch(syncActions.hideUnavailableDevices(opts.os));
    }

    log('Initializing local store.');
    localStore.init(localStore.getInitialState(), function(localStoreResult){
      log('Initializing device');
      device.init({
        api,
        version: opts.namedVersion
      }, function(deviceError, deviceResult){
        if (deviceError) {
          return dispatch(syncActions.initFailure(deviceError));
        }
        log('Initializing CareLink');
        carelink.init({ api }, function(carelinkError, carelinkResult){
          if (carelinkError) {
            return dispatch(syncActions.initFailure(carelinkError));
          }
          log(`Initializing api`);
          api.init(function(apiError, apiResult){
            if (apiError) {
              return dispatch(syncActions.initFailure(apiError));
            }
            log('Setting all api hosts');
            api.setHosts(_.pick(opts, ['API_URL', 'UPLOAD_URL', 'BLIP_URL']));
            dispatch(syncActions.setForgotPasswordUrl(api.makeBlipUrl(paths.FORGOT_PASSWORD)));
            dispatch(syncActions.setSignUpUrl(api.makeBlipUrl(paths.SIGNUP)));
            dispatch(syncActions.setNewPatientUrl(api.makeBlipUrl(paths.NEW_PATIENT)));
            let session = apiResult;
            if (session === undefined) {
              dispatch(syncActions.setPage(pages.LOGIN));
              dispatch(syncActions.initSuccess());
              return dispatch(doVersionCheck());
            }

            api.user.initializationInfo((err, results) => {
              if (err) {
                return dispatch(syncActions.initFailure(err));
              }
              // remove env-switching context menu after login
              if (typeof chrome !== 'undefined') {
                services.log('Removing Chrome context menu');
                chrome.contextMenus.removeAll();
              }
              dispatch(syncActions.initSuccess());
              dispatch(doVersionCheck());
              dispatch(syncActions.setUserInfoFromToken({
                user: results[0],
                profile: results[1],
                memberships: results[2]
              }));
              const { uploadTargetUser } = getState();
              if (uploadTargetUser !== null) {
                dispatch(syncActions.setBlipViewDataUrl(
                  api.makeBlipUrl(actionUtils.viewDataPathForUser(uploadTargetUser))
                ));
              }
              dispatch(retrieveTargetsFromStorage());
            });
          });
        });
      });
    });
  };
}

export function doLogin(creds, opts) {
  return (dispatch, getState) => {
    const { api } = services;
    dispatch(syncActions.loginRequest());

    api.user.loginExtended(creds, opts, (err, results) => {
      if (err) {
        return dispatch(syncActions.loginFailure(err.status));
      }
      // remove env-switching context menu after login
      if (typeof chrome !== 'undefined') {
        services.log('Removing Chrome context menu');
        chrome.contextMenus.removeAll();
      }
      dispatch(syncActions.loginSuccess({
        user: results[0].user,
        profile: results[1],
        memberships: results[2]
      }));

      // detect if a VCA here and redirect to clinic user select screen
      if(personUtils.userHasRole(results[0].user, 'clinic')){
        return dispatch(syncActions.setPage(pages.CLINIC_USER_SELECT, actionSources.USER, {metric: {eventName: metrics.CLINIC_SEARCH_DISPLAYED}}));
      }

      // detect if a DSA here and redirect to data storage screen
      const { targetUsersForUpload } = getState();
      if (_.isEmpty(targetUsersForUpload)) {
        return dispatch(syncActions.setPage(pages.NO_UPLOAD_TARGETS));
      }

      const { uploadTargetUser } = getState();
      if (uploadTargetUser !== null) {
        dispatch(syncActions.setBlipViewDataUrl(
          api.makeBlipUrl(actionUtils.viewDataPathForUser(uploadTargetUser))
        ));
      }
      dispatch(retrieveTargetsFromStorage());
    });
  };
}

export function doLogout() {
  return (dispatch) => {
    const { api } = services;
    dispatch(syncActions.logoutRequest());
    api.user.logout((err) => {
      if (err) {
        dispatch(syncActions.logoutFailure());
        dispatch(syncActions.setPage(pages.LOGIN, actionSources.USER));
      }
      else {
        dispatch(syncActions.logoutSuccess());
        dispatch(syncActions.setPage(pages.LOGIN, actionSources.USER));
      }
    });
  };
}

export function doCareLinkUpload(deviceKey, creds, utc) {
  return (dispatch, getState) => {
    const { api, carelink } = services;
    const version = versionInfo.semver;
    const { devices, targetTimezones, uploadTargetUser } = getState();

    const targetDevice = devices[deviceKey];

    dispatch(syncActions.fetchCareLinkRequest(uploadTargetUser, deviceKey));

    api.upload.fetchCarelinkData({
      carelinkUsername: creds.username,
      carelinkPassword: creds.password,
      daysAgo: daysForCareLink,
      targetUserId: uploadTargetUser
    }, (err, data) => {
      if (err) {
        let fetchErr = new Error(errorText.E_FETCH_CARELINK);
        let fetchErrProps = {
          details: err.message,
          utc: actionUtils.getUtc(utc),
          code: 'E_FETCH_CARELINK',
          version: version
        };
        dispatch(syncActions.fetchCareLinkFailure(errorText.E_FETCH_CARELINK));
        return dispatch(syncActions.uploadFailure(fetchErr, fetchErrProps, targetDevice));
      }
      if (data.search(/302 Moved Temporarily/) !== -1) {
        let credsErr = new Error(errorText.E_CARELINK_CREDS);
        let credsErrProps = {
          utc: actionUtils.getUtc(utc),
          code: 'E_CARELINK_CREDS',
          version: version
        };
        dispatch(syncActions.fetchCareLinkFailure(errorText.E_CARELINK_CREDS));
        return dispatch(syncActions.uploadFailure(credsErr, credsErrProps, targetDevice));
      }
      dispatch(syncActions.fetchCareLinkSuccess(uploadTargetUser, deviceKey));

      const opts = {
        targetId: uploadTargetUser,
        timezone: targetTimezones[uploadTargetUser],
        progress: actionUtils.makeProgressFn(dispatch),
        version: version
      };
      carelink.upload(data, opts, actionUtils.makeUploadCb(dispatch, getState, 'E_CARELINK_UPLOAD', utc));
    });
  };
}

export function doDeviceUpload(driverId, utc) {
  return (dispatch, getState) => {
    const { device } = services;
    const version = versionInfo.semver;
    const { devices, os, targetTimezones, uploadTargetUser } = getState();
    const targetDevice = _.findWhere(devices, {source: {driverId: driverId}});
    dispatch(syncActions.deviceDetectRequest());
    const opts = {
      targetId: uploadTargetUser,
      timezone: targetTimezones[uploadTargetUser],
      progress: actionUtils.makeProgressFn(dispatch),
      version: version
    };
    const { uploadsByUser } = getState();
    const currentUpload = _.get(
      uploadsByUser,
      [uploadTargetUser, targetDevice.key],
      {}
    );
    if (currentUpload.file) {
      opts.filedata = currentUpload.file.data;
      opts.filename = currentUpload.file.name;
    }

    device.detect(driverId, opts, (err, dev) => {
      if (err) {
        if ((os === 'mac' && _.get(targetDevice, ['showDriverLink', os], false) === true) ||
          (os === 'win' && _.get(targetDevice, ['showDriverLink', os], false) === true)) {
          let displayErr = new Error();
          let driverLinkErrProps = {
            details: err.message,
            utc: actionUtils.getUtc(utc),
            code: 'E_DRIVER',
            version: version
          };
          displayErr.driverLink = urls.DRIVER_DOWNLOAD;
          return dispatch(syncActions.uploadFailure(displayErr, driverLinkErrProps, targetDevice));
        }
        else {
          let displayErr = new Error(errorText.E_SERIAL_CONNECTION);
          let deviceDetectErrProps = {
            details: err.message,
            utc: actionUtils.getUtc(utc),
            code: 'E_SERIAL_CONNECTION',
            version: version
          };
          return dispatch(syncActions.uploadFailure(displayErr, deviceDetectErrProps, targetDevice));
        }
      }

      if (!dev && opts.filename == null) {
        let displayErr = new Error(errorText.E_HID_CONNECTION);
        let disconnectedErrProps = {
          utc: actionUtils.getUtc(utc),
          code: 'E_HID_CONNECTION',
          version: version
        };
        return dispatch(syncActions.uploadFailure(displayErr, disconnectedErrProps, targetDevice));
      }

      device.upload(driverId, opts, actionUtils.makeUploadCb(dispatch, getState, 'E_DEVICE_UPLOAD', utc));
    });
  };
}

export function doUpload(deviceKey, opts, utc) {
  return (dispatch, getState) => {
    dispatch(syncActions.versionCheckRequest());
    const { api } = services;
    const version = versionInfo.semver;
    api.upload.getVersions((err, versions) => {
      if (err) {
        dispatch(syncActions.versionCheckFailure(err));
        return dispatch(syncActions.uploadAborted());
      }
      const { uploaderMinimum } = versions;
      // if either the version from the jellyfish response
      // or the local uploader version is somehow an invalid semver
      // we will catch the error and dispatch versionCheckFailure
      try {
        const upToDate = semver.gte(version, uploaderMinimum);
        if (!upToDate) {
          dispatch(syncActions.versionCheckFailure(null, version, uploaderMinimum));
          return dispatch(syncActions.uploadAborted());
        }
        else {
          dispatch(syncActions.versionCheckSuccess());
          const { devices, uploadTargetUser, working } = getState();
          if (working.uploading === true) {
            return dispatch(syncActions.uploadAborted());
          }

          dispatch(syncActions.uploadRequest(uploadTargetUser, devices[deviceKey], utc));

          const targetDevice = devices[deviceKey];
          const deviceType = targetDevice.source.type;

          if (_.includes(['device', 'block'], deviceType)) {
            dispatch(doDeviceUpload(targetDevice.source.driverId, utc));
          }
          else if (deviceType === 'carelink') {
            dispatch(doCareLinkUpload(deviceKey, opts, utc));
          }
        }
      }
      catch(err) {
        dispatch(syncActions.versionCheckFailure(err));
        return dispatch(syncActions.uploadAborted());
      }
    });
  };
}

export function readFile(userId, deviceKey, file, extension) {
  return (dispatch, getState) => {
    if (!file) {
      return;
    }
    dispatch(syncActions.choosingFile(userId, deviceKey));
    const version = versionInfo.semver;

    if (file.name.slice(-extension.length) !== extension) {
      let err = new Error(errorText.E_FILE_EXT + extension);
      let errProps = {
        code: 'E_FILE_EXT',
        version: version
      };
      return dispatch(syncActions.readFileAborted(err, errProps));
    }
    else {
      let reader = new FileReader();
      reader.onloadstart = () => {
        dispatch(syncActions.readFileRequest(userId, deviceKey, file.name));
      };

      reader.onerror = () => {
        let err = new Error(errorText.E_READ_FILE + file.name);
        let errProps = {
          code: 'E_READ_FILE',
          version: version
        };
        return dispatch(syncActions.readFileFailure(err, errProps));
      };

      reader.onloadend = ((theFile) => {
        return (e) => {
          dispatch(syncActions.readFileSuccess(userId, deviceKey, e.srcElement.result));
          dispatch(doUpload(deviceKey));
        };
      })(file);

      reader.readAsArrayBuffer(file);
    }
  };
}

export function doVersionCheck() {
  return (dispatch, getState) => {
    dispatch(syncActions.versionCheckRequest());
    const { api } = services;
    const version = versionInfo.semver;
    api.upload.getVersions((err, versions) => {
      if (err) {
        return dispatch(syncActions.versionCheckFailure(err));
      }
      const { uploaderMinimum } = versions;
      // if either the version from the jellyfish response
      // or the local uploader version is somehow an invalid semver
      // we will catch the error and dispatch versionCheckFailure
      try {
        const upToDate = semver.gte(version, uploaderMinimum);
        if (!upToDate) {
          return dispatch(syncActions.versionCheckFailure(null, version, uploaderMinimum));
        }
        else {
          return dispatch(syncActions.versionCheckSuccess());
        }
      }
      catch(err) {
        return dispatch(syncActions.versionCheckFailure(err));
      }
    });
  };
}

export function setTargetTimezone(userId, timezoneName) {
  return (dispatch, getState) => {
    const { allUsers, loggedInUser } = getState();
    const isClinicAccount = personUtils.userHasRole(allUsers[loggedInUser], 'clinic');
    const { api } = services;
    dispatch(syncActions.updateProfileRequest());
    let updates = {
      patient: {
        targetTimezone: timezoneName
      }
    };
    api.user.updateProfile(userId, updates, (err, profile) => {
      // suppress unauthorized error until custodial vs normal permissions are ironed out
      // TODO: remove conditional when perms are finalized or accounts are converted
      if (err){
        if (_.get(err,'status') !== 401) {
          dispatch(syncActions.updateProfileFailure(err));
        } else {
          let newProfile = actionUtils.mergeProfileUpdates(allUsers[userId], updates);
          dispatch(syncActions.updateProfileSuccess(newProfile, userId));
        }
      } else {
        dispatch(syncActions.updateProfileSuccess(profile, userId));
      }
      if (isClinicAccount) {
        return dispatch(syncActions.setTargetTimezone(userId, timezoneName, {metric: {eventName: metrics.CLINIC_TIMEZONE_SELECT}}));
      }
      return dispatch(syncActions.setTargetTimezone(userId, timezoneName));
    });
  };
}

export function clickDeviceSelectionDone() {
  return (dispatch, getState) => {
    const { targetDevices, uploadTargetUser, allUsers, loggedInUser } = getState();
    const isClinicAccount = personUtils.userHasRole(allUsers[loggedInUser], 'clinic');
    const { api } = services;
    dispatch(syncActions.updateProfileRequest());
    if (!_.isEmpty(targetDevices[uploadTargetUser])) {
      let updates = {
        patient: {
          targetDevices: targetDevices[uploadTargetUser]
        }
      };
      api.user.updateProfile(uploadTargetUser, updates, (err, profile) => {
        // suppress unauthorized error until custodial vs normal permissions are ironed out
        // TODO: remove conditional when perms are finalized or accounts are converted
        if (err) {
          if (_.get(err,'status') !== 401) {
            dispatch(syncActions.updateProfileFailure(err));
          } else {
            let newProfile = actionUtils.mergeProfileUpdates(allUsers[uploadTargetUser], updates);
            dispatch(syncActions.updateProfileSuccess(newProfile, uploadTargetUser));
            if (isClinicAccount) {
              _.forEach(targetDevices[uploadTargetUser], function(device){
                dispatch(syncActions.clinicAddDevice(device));
              });
            }
          }
        } else {
          dispatch(syncActions.updateProfileSuccess(profile, uploadTargetUser));
          if (isClinicAccount) {
            _.forEach(targetDevices[uploadTargetUser], function(device){
              dispatch(syncActions.clinicAddDevice(device));
            });
          }
        }
        if (isClinicAccount) {
          return dispatch(syncActions.setPage(pages.MAIN, undefined, {metric: {eventName: metrics.CLINIC_DEVICES_DONE}}));
        }
        return dispatch(syncActions.setPage(pages.MAIN));
      });
    }
  };
}

export function clickEditUserNext(profile) {
  return (dispatch, getState) => {
    const { uploadTargetUser, allUsers } = getState();
    const { api } = services;
    const updates = profile;
    if (!_.isEmpty(profile)){
      dispatch(syncActions.updateProfileRequest());
      api.user.updateProfile(uploadTargetUser, profile, (err, profile) => {
        // suppress unauthorized error until custodial vs normal permissions are ironed out
        // TODO: remove conditional when perms are finalized or accounts are converted
        if (err) {
          if(_.get(err,'status') !== 401) {
            return dispatch(syncActions.updateProfileFailure(err));
          } else {
            const { allUsers } = getState();
            let newProfile = actionUtils.mergeProfileUpdates(allUsers[uploadTargetUser], updates);
            dispatch(syncActions.updateProfileSuccess(newProfile, uploadTargetUser));
          }
        } else {
          dispatch(syncActions.updateProfileSuccess(profile, uploadTargetUser));
        }
        const { targetDevices, devices, allUsers, loggedInUser } = getState();
        const targetedDevices = _.get(targetDevices, uploadTargetUser, []);
        const supportedDeviceKeys = Object.keys(devices);
        const atLeastOneDeviceSupportedOnSystem = _.some(targetedDevices, (key) => {
          return _.includes(supportedDeviceKeys, key);
        });
        if (_.isEmpty(targetedDevices) || !atLeastOneDeviceSupportedOnSystem) {
          return dispatch(syncActions.setPage(pages.SETTINGS));
        } else {
          return dispatch(syncActions.setPage(pages.MAIN));
        }
      });
    }
  };
}

export function retrieveTargetsFromStorage() {
  return (dispatch, getState) => {
    const { devices, uploadTargetUser } = getState();
    const { api, localStore } = services;
    let fromLocalStore = false;

    dispatch(syncActions.retrieveUsersTargetsFromStorage());
    let targets = localStore.getItem('devices');
    if (targets !== null) {
      fromLocalStore = true;
      // wipe out the deprecated 'devices' localStore key
      localStore.removeItem('devices');
      const uploadsByUser = actionUtils.getDeviceTargetsByUser(targets);
      dispatch(syncActions.setUploads(uploadsByUser));
      dispatch(syncActions.setUsersTargets(targets));
    }

    const { targetDevices, targetTimezones, allUsers, loggedInUser } = getState();
    const isClinicAccount = personUtils.userHasRole(allUsers[loggedInUser], 'clinic');

    if (isClinicAccount) {
      return dispatch(syncActions.setPage(pages.CLINIC_USER_SELECT, null, /*{metric: {eventName: metrics.CLINIC_SEARCH_DISPLAYED}}*/));
    }
    // redirect based on having a supported device if not clinic account
    if (!_.isEmpty(_.get(targetDevices, uploadTargetUser))) {
      let usersWithTargets = {};
      _.forOwn(targetDevices, (devicesArray, userId) => {
        usersWithTargets[userId] = _.map(devicesArray, (deviceKey) => {
          return {key: deviceKey};
        });
      });
      _.forOwn(targetTimezones, (timezoneName, userId) => {
        usersWithTargets[userId] = _.map(usersWithTargets[userId], (target) => {
          if (timezoneName != null) {
            target.timezone = timezoneName;
          }
          return target;
        });
      });
      const targetDeviceKeys = targetDevices[uploadTargetUser];
      const supportedDeviceKeys = Object.keys(devices);
      const atLeastOneDeviceSupportedOnSystem = _.some(targetDeviceKeys, (key) => {
        return _.includes(supportedDeviceKeys, key);
      });

      if(!fromLocalStore){
        const uploadsByUser = actionUtils.getDeviceTargetsByUser(usersWithTargets);
        dispatch(syncActions.setUploads(uploadsByUser));
      } else {
        if (!_.isEmpty(targetDevices[uploadTargetUser]) && !_.isEmpty(targetTimezones[uploadTargetUser])) {
          dispatch(syncActions.updateProfileRequest());
          const updates = {
            patient: {
              targetDevices: targetDevices[uploadTargetUser],
              targetTimezone: targetTimezones[uploadTargetUser]
            }
          };
          api.user.updateProfile(uploadTargetUser, updates, (err, profile) => {
            // suppress unauthorized error until custodial vs normal permissions are ironed out
            // TODO: remove conditional when perms are finalized or accounts are converted
            if(err){
              if (_.get(err,'status') !== 401) {
                dispatch(syncActions.updateProfileFailure(err));
              } else {
                let newProfile = actionUtils.mergeProfileUpdates(allUsers[uploadTargetUser], updates);
                dispatch(syncActions.updateProfileSuccess(newProfile, uploadTargetUser));
              }
            } else {
              dispatch(syncActions.updateProfileSuccess(profile, uploadTargetUser));
            }
          });
        }
      }

      if (atLeastOneDeviceSupportedOnSystem) {
        return dispatch(syncActions.setPage(pages.MAIN));
      } else {
        return dispatch(syncActions.setPage(pages.SETTINGS));
      }
    } else {
      return dispatch(syncActions.setPage(pages.SETTINGS));
    }
  };
}

export function createCustodialAccount(profile) {
  return (dispatch, getState) => {
    const { api } = services;
    dispatch(syncActions.createCustodialAccountRequest());
    api.user.createCustodialAccount(profile, (err, account) => {
      if (err) {
        dispatch(syncActions.createCustodialAccountFailure(err));
      }
      else {
        dispatch(syncActions.createCustodialAccountSuccess(account));
        if (_.get(account, 'profile.patient.mrn', false)) {
          dispatch(syncActions.clinicAddMrn());
        }
        if (_.get(account, 'profile.patient.email', false)) {
          dispatch(syncActions.clinicAddEmail());
        }
        dispatch(syncActions.setUploadTargetUser(account.userid));
        dispatch(syncActions.setPage(pages.SETTINGS));
      }
    });
  };
}

/*
 * COMPLEX ACTION CREATORS
 */

export function setUploadTargetUserAndMaybeRedirect(targetId) {
  return (dispatch, getState) => {
    const { devices, targetDevices, allUsers, loggedInUser} = getState();
    dispatch(syncActions.setUploadTargetUser(targetId));
    const { api } = services;
    dispatch(syncActions.setBlipViewDataUrl(
      api.makeBlipUrl(actionUtils.viewDataPathForUser(targetId))
    ));
    const targetedDevices = _.get(targetDevices, targetId, []);
    const supportedDeviceKeys = Object.keys(devices);
    const atLeastOneDeviceSupportedOnSystem = _.some(targetedDevices, (key) => {
      return _.includes(supportedDeviceKeys, key);
    });
    if (_.isEmpty(targetedDevices) || !atLeastOneDeviceSupportedOnSystem) {
      return dispatch(syncActions.setPage(pages.SETTINGS));
    }
  };
}

export function checkUploadTargetUserAndMaybeRedirect() {
  return (dispatch, getState) => {
    const { devices, targetDevices, allUsers, loggedInUser, uploadTargetUser } = getState();
    if (!uploadTargetUser) {
      return;
    }
    const targetedDevices = _.get(targetDevices, uploadTargetUser, []);
    const supportedDeviceKeys = Object.keys(devices);
    const atLeastOneDeviceSupportedOnSystem = _.some(targetedDevices, (key) => {
      return _.includes(supportedDeviceKeys, key);
    });
    if (_.isEmpty(targetedDevices) || !atLeastOneDeviceSupportedOnSystem) {
      return dispatch(syncActions.setPage(pages.SETTINGS, undefined, {metric: {eventName: metrics.CLINIC_NEXT}}));
    } else {
      return dispatch(syncActions.setPage(pages.MAIN, undefined, {metric: {eventName: metrics.CLINIC_NEXT}}));
    }
  };
}

export function clickAddNewUser(){
  return (dispatch, getState) =>{
    dispatch(syncActions.setUploadTargetUser(null));
    dispatch(syncActions.setPage(pages.CLINIC_USER_EDIT, undefined, {metric: {eventName: metrics.CLINIC_ADD}}));
  };
}
