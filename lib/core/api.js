/**
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
 */

import _ from 'lodash';
import async from 'async';
import { format } from 'util';
import crypto from 'crypto';
import sundial from 'sundial';
import { v4 as uuidv4 } from 'uuid';
import isElectron from 'is-electron';
import os from 'os';
import bows from 'bows';
// Wrapper around the Tidepool client library
import createTidepoolClient from 'tidepool-platform-client';

import errorText from '../../app/constants/errors';
import builder from '../objectBuilder';
import localStore from './localStore';
import rollbar from '../../app/utils/rollbar';

// eslint-disable-next-line no-console
const log = isElectron() ? bows('Api') : console.log;

// for cli tools running in node
if (typeof localStore === 'function') {
  localStore = localStore({});
}

let tidepool;

const api = {
  log,
};

// ----- Api Setup -----

// synchronous!
api.create = (options) => {
  // eslint-disable-next-line no-console
  const tidepoolLog = isElectron() ? bows('Tidepool') : console.log;
  tidepool = createTidepoolClient({
    host: options.apiUrl,
    uploadApi: options.uploadUrl,
    dataHost: options.dataUrl,
    log: {
      warn: tidepoolLog,
      info: tidepoolLog,
      debug: tidepoolLog,
    },
    localStore,
    metricsSource: 'uploader',
    metricsVersion: options.version,
    sessionTrace: uuidv4(),
  });

  api.tidepool = tidepool;
};

// asynchronous!
api.init = (cb) => {
  api.tidepool.initialize(cb);
};

// ----- Config -----
api.setHosts = (hosts) => {
  if (hosts.API_URL) {
    tidepool.setApiHost(hosts.API_URL);
  }
  if (hosts.UPLOAD_URL) {
    tidepool.setUploadHost(hosts.UPLOAD_URL);
  }
  if (hosts.DATA_URL) {
    tidepool.setDataHost(hosts.DATA_URL);
  }
  if (hosts.BLIP_URL) {
    tidepool.setBlipHost(hosts.BLIP_URL);
  }

  if (rollbar && rollbar.configure) {
    rollbar.configure({
      payload: {
        environment: hosts.environment,
      },
    });
  }
};

api.makeBlipUrl = (tail) => tidepool.makeBlipUrl(tail);

// ----- User -----

api.user = {};

api.user.initializationInfo = (cb) => {
  async.series([
    api.user.account,
    api.user.loggedInProfile,
    api.user.getUploadGroups,
  ], cb);
};

api.user.login = (user, options, cb) => {
  api.log('POST /auth/login');

  tidepool.login(user, options, (err, data) => {
    if (err) {
      return cb(err);
    }
    if (rollbar && rollbar.configure) {
      rollbar.configure({
        payload: {
          person: {
            id: data.userid,
            email: user.username,
            username: user.username,
          },
        },
      });
    }
    return cb(null, data);
  });
};

api.user.loginExtended = (user, options, cb) => {
  async.series([
    api.user.login.bind(null, user, options),
    api.user.loggedInProfile,
    api.user.getUploadGroups,
  ], cb);
};

api.user.account = (cb) => {
  api.log('GET /auth/user');
  tidepool.getCurrentUser((err, user) => {
    // the rewire plugin messes with default export in tests
    if (rollbar && rollbar.configure) {
      rollbar.configure({
        payload: {
          person: {
            id: user.userid,
            email: user.username,
            username: user.username,
          },
        },
      });
    }
    cb(err, user);
  });
};

api.user.loggedInProfile = (cb) => {
  api.log(`GET /metadata/${tidepool.getUserId()}/profile`);
  tidepool.findProfile(tidepool.getUserId(), (err, profile) => {
    if (err) {
      return cb(err);
    }
    return cb(null, profile);
  });
};

api.user.profile = (userId, cb) => {
  api.log(`GET /metadata/${userId}/profile`);
  tidepool.findProfile(userId, (err, profile) => {
    if (err) {
      return cb(err);
    }
    return cb(null, profile);
  });
};

api.user.addProfile = (userId, profile, cb) => {
  api.log(`PUT /metadata/${userId}/profile`);
  tidepool.addOrUpdateProfile(userId, profile, (err, response) => {
    if (err) {
      return cb(err);
    }
    return cb(null, response);
  });
};

api.user.updateProfile = (userId, updates, cb) => {
  api.user.profile(userId, (err, profile) => {
    if (err) {
      return cb(err);
    }
    const currentEmail = _.get(profile, 'emails[0]');
    // We can't use `const newProfile = actionUtils.mergeProfileUpdates` here,
    // as we want to keep `app/` and `lib/` loosely coupled
    // eslint-disable-next-line consistent-return
    const newProfile = _.mergeWith(profile, updates, (original, update) => {
      if (_.isArray(original)) {
        return update;
      }
    });
    const emails = _.get(updates, 'emails');
    // check to see if we have a single email address that also needs to be updated
    if (_.isArray(emails) && emails.length === 1 && emails[0] !== currentEmail) {
      return async.series([
        (callback) => tidepool.updateCustodialUser({
          username: emails[0],
          emails,
        }, userId, callback),
        (callback) => tidepool.addOrUpdateProfile(userId, newProfile, callback),
        (callback) => tidepool.signupStart(userId, callback),
      ], (error, results) => {
        if (error) {
          return cb(error);
        }
        return cb(null, results[1]);
      });
    }
    return tidepool.addOrUpdateProfile(userId, newProfile, cb);
  });
};

api.user.logout = (cb) => {
  api.log('POST /auth/logout');
  if (!tidepool.isLoggedIn()) {
    api.log('Not authenticated, but still destroying session for just in cases...');
    tidepool.destroySession();
    return;
  }
  tidepool.logout((err) => {
    if (err) {
      api.log('Error while logging out but still destroying session...');
      tidepool.destroySession();
      return cb(err);
    }
    return cb(null);
  });
};

api.user.getUploadGroups = (cb) => {
  const userId = tidepool.getUserId();

  api.log(`GET /metadata/users/${userId}`);

  async.parallel([
    (callback) => tidepool.getAssociatedUsersDetails(userId, callback),
    (callback) => tidepool.findProfile(userId, callback),
  ], (err, results) => {
    if (err) {
      cb(err);
    }
    const [users, profile] = results;

    let uploadUsers = _.filter(users, (user) => _.has(user.trustorPermissions, 'upload'));

    uploadUsers = _.map(uploadUsers, (user) => {
      // eslint-disable-next-line no-param-reassign
      user.permissions = user.trustorPermissions;
      // eslint-disable-next-line no-param-reassign
      delete user.trustorPermissions;
      return user;
    });

    // getAssociatedUsersDetails doesn't include the current user
    uploadUsers.push({
      userid: userId,
      profile,
      permissions: { root: {} },
    });

    const sortedUsers = _.sortBy(uploadUsers, (group) => group.userid === userId);
    return cb(null, sortedUsers);
  });
};

api.user.createCustodialAccount = (profile, cb) => {
  const userId = tidepool.getUserId();

  api.log(`POST /auth/user/${userId}/user`);
  tidepool.createCustodialAccount(profile, (err, account) => cb(err, account));
};

// ----- Upload -----

api.upload = {};

api.upload.getVersions = (cb) => {
  api.log('GET /info');
  tidepool.checkUploadVersions((err, resp) => {
    if (err) {
      if (!navigator.onLine) {
        const error = new Error(errorText.E_OFFLINE);
        error.originalError = err;
        return cb(error);
      }
      return cb(err);
    }
    const uploaderVersion = _.get(resp, ['versions', 'uploaderMinimum'], null);
    if (uploaderVersion !== null) {
      return cb(null, resp.versions);
    }
    return cb(new Error(format('Info response does not contain versions.uploaderMinimum.')));
  });
};

api.upload.accounts = (happyCb, sadCb) => {
  api.log(`GET /access/groups/${tidepool.getUserId()}`);
  tidepool.getViewableUsers(tidepool.getUserId(), (err, data) => {
    if (err) {
      return sadCb(err, err);
    }
    return happyCb(data, 'upload accounts found');
  });
};

function getUploadFunction(uploadType) {
  if (uploadType === 'dataservices') {
    return tidepool.addDataToDataset;
  }

  if (uploadType === 'jellyfish') {
    return tidepool.uploadDeviceDataForUser;
  }
  return null;
}

function buildError(error, datasetId) {
  const err = new Error('Uploading data to platform failed.');
  err.name = 'API Error';
  err.status = error.status;
  err.datasetId = datasetId;
  if (error.sessionToken) {
    err.sessionToken = crypto.createHash('md5').update(error.sessionToken).digest('hex');
  }
  if (error.meta && error.meta.trace) {
    err.requestTrace = error.meta.trace.request;
    err.sessionTrace = error.meta.trace.session;
  }

  api.log(JSON.stringify(error, null, '\t'));

  return err;
}

function createDatasetForUser(userId, info, callback) {
  const happy = (dataset) => callback(null, dataset);

  const sad = (err) => {
    api.log('platform create dataset failed:', err);
    const error = buildError(err);
    callback(error);
  };

  const getDeduplicator = () => {
    if (_.indexOf(info.deviceManufacturers, 'Animas') > -1) {
      return 'org.tidepool.deduplicator.device.truncate.dataset';
    }
    return 'org.tidepool.deduplicator.device.deactivate.hash';
  };

  api.log('createDataset for user id ', userId, info);

  // eslint-disable-next-line no-param-reassign
  info.deduplicator = {
    name: getDeduplicator(),
  };

  tidepool.createDatasetForUser(userId, info, (err, dataset) => {
    if (err) {
      return sad(err);
    }
    return happy(dataset);
  });
}

function finalizeDataset(datasetId, callback) {
  const happy = () => callback();

  const sad = (err) => {
    api.log('platform finalize dataset failed:', err);
    const error = buildError(err, datasetId);
    callback(error);
  };

  api.log('finalize dataset for dataset id ', datasetId);

  tidepool.finalizeDataset(datasetId, (err, result) => {
    if (err) {
      return sad(err, result);
    }
    return happy();
  });
}

function addDataToDataset(data, datasetId, blockIndex, uploadType, callback) {
  const recCount = data.length;
  const happy = () => callback(null, recCount);

  const sad = (error) => {
    api.log('addDataToDataset: checking failure details');
    if (error.status === 413 && data.length > 1) { // request entity too big
      // but we can split the request and try again
      const l = Math.floor(data.length / 2);
      const d1 = data.slice(0, l);
      const d2 = data.slice(l);
      async.mapSeries([d1, d2], addDataToDataset, (err, result) => {
        if (err) {
          return callback(err, 0);
        }
        return callback(null, result[0] + result[1]);
      });
      return;
    }
    if (error.responseJSON && error.responseJSON.errorCode && error.responseJSON.errorCode === 'duplicate') {
      api.log(error.responseJSON);
      callback('duplicate', error.responseJSON.index);
    } else {
      api.log('platform add data to dataset failed.');
      const err = buildError(error, datasetId);

      if (error.errors && error.errors.length > 0) {
        // eslint-disable-next-line no-restricted-syntax
        for (const i in error.errors) {
          if (error.errors[i].source) {
            const hpattern = /\/(\d+)\//;
            const toMatch = hpattern.exec(error.errors[i].source.pointer);
            if (toMatch[1]) {
              api.log('Offending record for error', i, ':', JSON.stringify(data[parseInt(toMatch[1], 10)], null, '\t'));
            }
          }
        }
      }

      callback(err);
    }
  };

  api.log(`addDataToDataset #${blockIndex}: using id ${datasetId}`);

  const uploadForUser = getUploadFunction(uploadType);
  uploadForUser(datasetId, data, (err, result) => {
    if (err) {
      return sad(err);
    }
    return happy(result);
  });
}

/*
 * process the data sending it to the platform in blocks and feed back
 * progress to the calling function
 * uploadType is the final argument (instead of the callback) so that existing calls to
 * api.upload.toPlatform don't have to be modified in every driver, and will default to
 * the jellyfish api
 */
api.upload.toPlatform = (data, sessionInfo, progress, groupId, cb, uploadType = 'jellyfish') => {
  // uploadType can either be 'jellyfish' or 'dataservices'

  api.log(`attempting to upload ${data.length} device data records to ${uploadType} api`);
  const grouped = _.groupBy(data, 'type');
  // eslint-disable-next-line no-restricted-syntax
  for (const type in grouped) {
    if ({}.hasOwnProperty.call(grouped, type)) {
      api.log(grouped[type].length, 'records of type', type);
    }
  }

  const blocks = [];
  const BLOCKSIZE = 1000;
  let nblocks = 0;
  let datasetId;
  /* eslint-disable camelcase */
  /* eslint-disable no-shadow */
  const post_and_progress = (data, callback) => {
    progress(((nblocks += 1) / blocks.length) * 100.0);
    // off to the platfrom we go
    if (uploadType === 'jellyfish') {
      return addDataToDataset(data, groupId, nblocks, uploadType, callback);
    }
    return addDataToDataset(data, datasetId, nblocks, uploadType, callback);
  };

  const post_dataset_create = (uploadMeta, callback) => createDatasetForUser(
    groupId, uploadMeta, callback,
  );

  const post_dataset_finalize = (callback) => finalizeDataset(datasetId, callback);

  const decorate = (data, uploadItem) => {
    if (uploadType === 'jellyfish') {
      const deviceRecords = _.map(data, (item) => _.extend({}, item, {
        uploadId: uploadItem.uploadId,
        guid: uuidv4(),
      }));
      return deviceRecords;
    } else {
      return data;
    }
  };

  async.waterfall([
    (callback) => {
      // generate and post the upload metadata
      const now = new Date();

      if (rollbar) {
        const nowHammerTime = now.getTime();
        const events = _.filter(data, (event) => {
          const year = parseInt(event.time.substring(0, 4), 10);
          const timestamp = sundial.parseFromFormat(event.time).getTime();

          return year < 2006 || timestamp > (nowHammerTime + (24 * 60 * sundial.MIN_TO_MSEC));
        });

        if (events.length > 0) {
          rollbar.info('Upload contains event(s) prior to 2006 or more than a day in the future', events);
        }
      }

      let uploadItem = builder().makeUpload()
        // yes, I'm intentionally breaking up the new Date() I made and parsing
        // it again with another new Date()...it's a moment limitation...
        .with_computerTime(sundial.formatDeviceTime(new Date(Date.UTC(
          now.getFullYear(), now.getMonth(), now.getDate(),
          now.getHours(), now.getMinutes(), now.getSeconds(),
        ))))
        .with_time(sessionInfo.start)
        .with_timezone(sessionInfo.tzName)
        .with_timezoneOffset(-new Date().getTimezoneOffset())
        .with_conversionOffset(0)
        .with_timeProcessing(sessionInfo.timeProcessing)
        .with_version(sessionInfo.version)
        .with_source(sessionInfo.source)
        .with_deviceTags(sessionInfo.deviceTags)
        .with_deviceTime(sessionInfo.deviceTime)
        .with_deviceManufacturers(sessionInfo.deviceManufacturers)
        .with_deviceModel(sessionInfo.deviceModel)
        .with_deviceSerialNumber(sessionInfo.deviceSerialNumber)
        .with_deviceId(sessionInfo.deviceId)
        .with_payload(sessionInfo.payload)
        .with_client({
          name: 'org.tidepool.uploader',
          version: sessionInfo.version,
        });

      if (sessionInfo.delta != null) {
        _.set(uploadItem, 'client.private.delta', sessionInfo.delta);
      }

      if (sessionInfo.blobId != null) {
        _.set(uploadItem, 'client.private.blobId', sessionInfo.blobId);
      }

      if (sessionInfo.annotations != null) {
        _.set(uploadItem, 'annotations', sessionInfo.annotations);
      }

      _.set(uploadItem, 'client.private.os', `${os.platform()}-${os.arch()}-${os.release()}`);

      if (uploadType === 'jellyfish') {
        uploadItem.with_uploadId(`upid_${
          crypto.createHash('md5')
            .update(`${sessionInfo.deviceId}_${sessionInfo.start}`)
            .digest('hex')
            .slice(0, 12)}`);
        uploadItem.with_guid(uuidv4());
        uploadItem.with_byUser(tidepool.getUserId());
      }
      uploadItem = uploadItem.done();

      api.log('create dataset');

      if (uploadType === 'dataservices') {
        post_dataset_create(uploadItem, (err, dataset) => {
          if (_.isEmpty(err)) {
            api.log('created dataset');
            datasetId = _.get(dataset, 'data.uploadId');
            if (_.isEmpty(datasetId)) {
              api.log('created dataset does not include uploadId');
              return callback(new Error(format('Dataset response does not contain uploadId.')));
            }
            return callback(null, uploadItem);
          }
          api.log('error creating dataset ', err);
          return callback(err);
        });
      } else {
        // upload metadata uploaded as usual through jellyfish
        addDataToDataset(uploadItem, groupId, 0, uploadType, (err) => {
          if (_.isEmpty(err)) {
            api.log('saved upload metadata');
            return callback(null, uploadItem);
          }
          api.log('error saving upload metadata ', err);
          return callback(err);
        });
      }
    },
    (uploadItem, callback) => {
      // decorate our data with the successfully posted upload metadata
      // as well as a GUID and then save to the platform
      // eslint-disable-next-line no-param-reassign
      data = decorate(data, uploadItem);

      for (let i = 0; i < data.length; i += BLOCKSIZE) {
        blocks.push(data.slice(i, i + BLOCKSIZE));
      }
      api.log('start uploading the rest of the data');
      // process then finalise, or if you want you can finalize :)
      async.mapSeries(blocks, post_and_progress, callback);
    },
    (result, callback) => {
      if (uploadType === 'jellyfish') {
        callback(null, result);
      } else {
        api.log('finalize dataset');
        post_dataset_finalize((err) => {
          if (_.isEmpty(err)) {
            api.log('finalized dataset');
            return callback(null, result);
          }
          api.log('error finalizing dataset', err);
          return callback(err);
        });
      }
    },
  ], (err, result) => {
    if (err == null) {
      api.log('upload.toPlatform: all good');
      return cb(null, result);
    }
    api.log('upload.toPlatform: failed ', err);
    return cb(err);
  });
};

// `payload` contains:
// `carelinkUsername`, `careLinkPassword`, `daysAgo`
api.upload.fetchCarelinkData = (payload, cb) => {
  api.log('POST /carelink');
  tidepool.uploadCarelinkDataForUser(payload, (err, syncTask) => {
    if (err) {
      return cb(err);
    }
    return tidepool.getCarelinkData(syncTask.id, cb);
  });
};

api.getMostRecentUploadRecord = (userId, deviceId, cb) => {
  api.log(`GET /data_sets?deviceId=${deviceId}&size=1`);
  tidepool.getUploadRecordsForDevice(userId, deviceId, 1, (err, resp) => {
    if (err) {
      if (!navigator.onLine) {
        const error = new Error(errorText.E_OFFLINE);
        error.originalError = err;
        return cb(error);
      }
      return cb(err);
    }
    api.log('Upload record response:', resp);
    if (resp && resp.length > 0) {
      return cb(null, resp[0]);
    }

    // could not retrieve an upload record, so return null
    return cb(null, null);
  });
};

api.upload.blob = (blob, contentType, cb) => {
  api.log('POST /blobs');

  const digest = crypto.createHash('md5').update(blob).digest('base64');
  const blobObject = new Blob([blob], { type: contentType });

  tidepool.uploadBlobForUser(tidepool.getUserId(), blobObject, contentType, `MD5=${digest}`, (err, result) => {
    if (err) {
      return cb(err, null);
    }
    return cb(null, result);
  });
};

// ----- Metrics -----

api.metrics = {};

api.metrics.track = (eventName, properties) => {
  api.log(`GET /metrics/${window.encodeURIComponent(eventName)}`);
  return tidepool.trackMetric(eventName, properties);
};

// ----- Server time -----
api.getTime = (cb) => {
  api.log('GET /time');
  tidepool.getTime((err, resp) => {
    if (err) {
      if (!navigator.onLine) {
        const error = new Error(errorText.E_OFFLINE);
        error.originalError = err;
        return cb(error);
      }
      return cb(err);
    }
    if (resp.data && resp.data.time) {
      return cb(null, resp.data.time);
    }
    // the response is not in the right format,
    // so we send nothing back
    return cb(null, null);
  });
};

// ----- Errors -----

api.errors = {};

api.errors.log = (error, message, properties) => {
  api.log('GET /errors');

  if (rollbar) {
    const extra = {};
    if (_.get(error, 'data.blobId', false)) {
      _.assign(extra, { blobId: error.data.blobId });
    }
    if (_.isError(error.originalError)) {
      _.assign(extra, { displayError: _.omit(error, ['originalError']) });
      // eslint-disable-next-line no-param-reassign
      error = error.originalError;
    }
    rollbar.error(error, extra);
  }
  return tidepool.logAppError(error.debug, message, properties);
};

module.exports = api;
