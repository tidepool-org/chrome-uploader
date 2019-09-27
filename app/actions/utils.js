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
import stacktrace from 'stack-trace';

import sundial from 'sundial';

import errorText from '../constants/errors';
import * as syncActions from './sync';

const isBrowser = typeof window !== 'undefined';
// eslint-disable-next-line no-console
const debug = isBrowser ? require('bows')('utils') : console.log;

export function getDeviceTargetsByUser(targetsByUser) {
  return _.mapValues(targetsByUser, (targets) => {
    return _.map(targets, 'key');
  });
}

export function getUploadTrackingId(device) {
  const source = device.source;
  if (source.type === 'device' || source.type === 'block') {
    return source.driverId;
  }
  return null;
}

export function getUtc(utc) {
  return _.isEmpty(utc) ? sundial.utcDateString() : utc;
}

export function makeProgressFn(dispatch) {
  return (step, percentage, isFirstUpload) => {
    dispatch(syncActions.uploadProgress(step, percentage, isFirstUpload));
  };
}

export function makeDisplayTimeModal(dispatch) {
  return (cb, cfg, times) => {
    dispatch(syncActions.deviceTimeIncorrect(cb, cfg, times));
  };
}

export function makeDisplayAdhocModal(dispatch) {
  return (cb, cfg) => {
    dispatch(syncActions.adHocPairingRequest(cb, cfg));
  };
}

export function makeUploadCb(dispatch, getState, errCode, utc) {
  return (err, recs) => {
    const { devices, uploadsByUser, uploadTargetDevice, uploadTargetUser, version } = getState();
    const targetDevice = devices[uploadTargetDevice];

    if (err) {
      if(err === 'deviceTimePromptClose'){
        return dispatch(syncActions.uploadCancelled(getUtc(utc)));
      }
      // the drivers sometimes just pass a string arg as err, instead of an actual error :/
      if (typeof err === 'string') {
        err = new Error(err);
      }
      const serverErr = 'Origin is not allowed by Access-Control-Allow-Origin';
      let displayErr = new Error(err.message === serverErr ?
        errorText.E_SERVER_ERR : errorText[err.code || errCode]);
      let uploadErrProps = {
        details: err.message,
        utc: getUtc(utc),
        name: err.name || 'Uncaught or API POST error',
        step: err.step || null,
        datasetId: err.datasetId || null,
        requestTrace: err.requestTrace || null,
        sessionTrace: err.sessionTrace || null,
        sessionToken: err.sessionToken || null,
        code: err.code || errCode,
        version: version,
        data: recs
      };
      displayErr.originalError = err;

      if (!(process.env.NODE_ENV === 'test')) {
        uploadErrProps.stringifiedStack = _.map(
          _.filter(
            stacktrace.parse(err),
            (cs) => { return cs.functionName !== null; }
          ),
          'functionName'
        ).join(', ');
      }
      return dispatch(syncActions.uploadFailure(displayErr, uploadErrProps, targetDevice));
    }
    const currentUpload = _.get(uploadsByUser, [uploadTargetUser, targetDevice.key], {});
    dispatch(syncActions.uploadSuccess(uploadTargetUser, targetDevice, currentUpload, recs, utc));
  };
}

export function viewDataPathForUser(uploadTargetUser) {
  return `/patients/${uploadTargetUser}/data`;
}

export function mergeProfileUpdates(profile, updates){
  // merge property values except arrays, which get replaced entirely
  return _.mergeWith(profile, updates, (original, update) => {
    if (_.isArray(original)) {
      return update;
    }
  });
}
