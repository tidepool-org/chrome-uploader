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

var _ = require('lodash');
var async = require('async');
var format = require('util').format;
var crypto = require('crypto');
var semver = require('semver');
var sundial = require('sundial');
var uuidv4 = require('uuid/v4');
var isElectron = require('is-electron');
var os = require('os');

var bows = require('bows');
var errorText = require('../../app/constants/errors');
var log = isElectron() ? bows('Api') : console.log;
var builder = require('../objectBuilder')();
var localStore = require('./localStore');
var rollbar = require('../../app/utils/rollbar');

// for cli tools running in node
if (typeof localStore === 'function') {
  localStore = localStore({});
}

// Wrapper around the Tidepool client library
var createTidepoolClient = require('tidepool-platform-client');
var tidepool;

var api = {
  log: log
};

// ----- Api Setup -----

// synchronous!
api.create = function(options) {
  var tidepoolLog = isElectron() ? bows('Tidepool') : console.log;
  tidepool = createTidepoolClient({
    host: options.apiUrl,
    uploadApi: options.uploadUrl,
    dataHost: options.dataUrl,
    log: {
      warn: tidepoolLog,
      info: tidepoolLog,
      debug: tidepoolLog
    },
    localStore: localStore,
    metricsSource: 'uploader',
    metricsVersion: options.version,
    sessionTrace: uuidv4()
  });

  api.tidepool = tidepool;
};

// asynchronous!
api.init = function(cb) {
  api.tidepool.initialize(cb);
};

// ----- Config -----
api.setHosts = function(hosts) {
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

  if (rollbar) {
    rollbar.configure && rollbar.configure({
      payload: {
        environment: hosts.environment
      }
    });
  }
};

api.makeBlipUrl = function(tail) {
  return tidepool.makeBlipUrl(tail);
};

// ----- User -----

api.user = {};

api.user.initializationInfo = function(cb){
  async.series([
    api.user.account,
    api.user.loggedInProfile,
    api.user.getUploadGroups
  ], cb);
};

api.user.login = function(user, options, cb) {
  api.log('POST /auth/login');

  tidepool.login(user, options, function(err, data) {
    if (err) {
      return cb(err);
    }
    if (rollbar) {
      rollbar.configure && rollbar.configure({
        payload: {
          person: {
            id: data.userid,
            email: user.username,
            username: user.username,
          }
        }
      });
    }
    return cb(null, data);
  });
};

api.user.loginExtended = function(user, options, cb){
  async.series([
    api.user.login.bind(null, user, options),
    api.user.loggedInProfile,
    api.user.getUploadGroups
  ], cb);
};

api.user.account = function(cb) {
  api.log('GET /auth/user');
  tidepool.getCurrentUser(function(err, user) {
    // the rewire plugin messes with default export in tests
    if (rollbar) {
      rollbar.configure && rollbar.configure({
        payload: {
          person: {
            id: user.userid,
            email: user.username,
            username: user.username,
          }
        }
      });
    }
    cb(err, user);
  });
};

api.user.loggedInProfile = function(cb) {
  api.log('GET /metadata/' + tidepool.getUserId() + '/profile');
  tidepool.findProfile(tidepool.getUserId(), function(err, profile) {
      if (err) {
        return cb(err);
      }
      return cb(null, profile);
  });
};

api.user.profile = function(userId, cb) {
  api.log('GET /metadata/' + userId + '/profile');
  tidepool.findProfile(userId, function(err, profile) {
    if (err) {
      return cb(err);
    }
    return cb(null, profile);
  });
};

api.user.addProfile = function(userId, profile, cb){
  api.log('PUT /metadata/' + userId + '/profile');
  tidepool.addOrUpdateProfile(userId, profile, function(err, response){
    if(err){
      return cb(err);
    }
    return cb(null, response);
  });
};

api.user.updateProfile = function(userId, updates, cb){
  api.user.profile(userId, function(err, profile){
    if(err){
      return cb(err);
    }
    var currentEmail = _.get(profile, 'emails[0]');
    // Note: we can't use var newProfile = actionUtils.mergeProfileUpdates here,
    // as that would introduce an ES6 dependency causing problems for our CLIs
    var newProfile = _.mergeWith(profile, updates, function(original, update){
      if (_.isArray(original)) {
        return update;
      }
    });
    var emails = _.get(updates, 'emails');
    // check to see if we have a single email address that also needs to be updated
    if (_.isArray(emails) && emails.length === 1 && emails[0] !== currentEmail){
      return async.series([
        function(callback){
          return tidepool.updateCustodialUser({username: emails[0], emails: emails}, userId, callback);
        },
        function(callback){
          return tidepool.addOrUpdateProfile(userId, newProfile, callback);
        },
        function(callback){
          return tidepool.signupStart(userId, callback);
        }
      ], function(err, results){
        if (err) {
          return cb(err);
        }
        return cb(null, results[1]);
      });
    }
    return tidepool.addOrUpdateProfile(userId, newProfile, cb);
  });
};

api.user.logout = function(cb) {
  api.log('POST /auth/logout');
  if (!tidepool.isLoggedIn()) {
    api.log('Not authenticated, but still destroying session for just in cases...');
    tidepool.destroySession();
    return;
  }
  tidepool.logout(function(err) {
    if (err) {
      api.log('Error while logging out but still destroying session...');
      tidepool.destroySession();
      return cb(err);
    }
    cb(null);
  });
};

api.user.getUploadGroups = function(cb) {
  var userId = tidepool.getUserId();

  api.log('GET /metadata/users/' + userId);

  async.parallel([
    (callback) => tidepool.getAssociatedUsersDetails(userId, callback),
    (callback) => tidepool.findProfile(userId, callback),
  ], function(err, results){
    if(err){
      cb(err);
    }
    var [ users, profile ] = results;
    
    var uploadUsers = _.filter(users, function(user) {
      return _.has(user.trustorPermissions, 'upload');
    });

    uploadUsers = _.map(uploadUsers, function(user) {
      user.permissions = user.trustorPermissions;
      delete user.trustorPermissions;
      return user;
    });

    // getAssociatedUsersDetails doesn't include the current user
    uploadUsers.push({
      userid: userId,
      profile: profile,
      permissions: {root: {}},
    });

    var sortedUsers = _.sortBy(uploadUsers, function(group) { return group.userid === userId; });
    return cb(null, sortedUsers);
  });
};

api.user.createCustodialAccount = function(profile, cb) {
  var userId = tidepool.getUserId();

  api.log('POST /auth/user/' + userId + '/user');
  tidepool.createCustodialAccount(profile, function(err, account){
    return cb(err, account);
  });
};

// ----- Upload -----

api.upload = {};

api.upload.getVersions = function(cb) {
  api.log('GET /info');
  tidepool.checkUploadVersions(function(err, resp) {
    if (err) {
      if (!navigator.onLine) {
        var error = new Error(errorText.E_OFFLINE);
        error.originalError = err;
        return cb(error);
      }
      return cb(err);
    }
    var uploaderVersion = _.get(resp, ['versions', 'uploaderMinimum'], null);
    if (uploaderVersion !== null) {
      return cb(null, resp.versions);
    }
    else {
      return cb(new Error(format('Info response does not contain versions.uploaderMinimum.')));
    }
  });
};

api.upload.accounts = function(happyCb, sadCb) {
  api.log('GET /access/groups/'+tidepool.getUserId());
  tidepool.getViewableUsers(tidepool.getUserId(),function(err, data) {
    if(err){
      return sadCb(err,err);
    }
    return happyCb(data, 'upload accounts found');
  });
};

function buildError(error, datasetId) {
  var err = new Error('Uploading data to platform failed.');
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

  var happy = function(dataset) {
    callback(null, dataset);
  };

  var sad = function (err) {
    api.log('platform create dataset failed:', err);
    var error = buildError(err);
    callback(error);
  };

  var getDeduplicator = function () {
    if(_.indexOf(info.deviceManufacturers, 'Animas') > -1) {
      return 'org.tidepool.deduplicator.device.truncate.dataset';
    } else {
      return 'org.tidepool.deduplicator.device.deactivate.hash';
    }
  };

  api.log('createDataset for user id ', userId, info);

  info.deduplicator = {
    name: getDeduplicator()
  };

  tidepool.createDatasetForUser(userId, info, function(err, dataset) {
    if (err) {
      return sad(err);
    }
    return happy(dataset);
  });
}

function finalizeDataset(datasetId, callback) {

  var happy = function() {
    callback();
  };

  var sad = function (err, dataset) {
    api.log('platform finalize dataset failed:', err);
    var error = buildError(err, datasetId);
    callback(error);
  };

  api.log('finalize dataset for dataset id ', datasetId);

  tidepool.finalizeDataset(datasetId, function(err, result) {
    if (err) {
      return sad(err, result);
    }
    return happy();
  });
}

function addDataToDataset(data, datasetId, blockIndex, uploadType, callback) {

  var recCount = data.length;
  var happy = function () {
    callback(null, recCount);
  };

  var sad = function (error) {
    api.log('addDataToDataset: checking failure details');
    if (error.status == 413 && data.length > 1) { // request entity too big
      // but we can split the request and try again
      var l = Math.floor(data.length / 2);
      var d1 = data.slice(0, l);
      var d2 = data.slice(l);
      async.mapSeries([d1, d2], addDataToDataset, function (err, result) {
        if (err) {
          return callback(err, 0);
        }
        return callback(null, result[0] + result[1]);
      });
      return;
    }
    if (error.responseJSON && error.responseJSON.errorCode && error.responseJSON.errorCode == 'duplicate') {
      api.log(error.responseJSON);
      callback('duplicate', error.responseJSON.index);
    } else {
      api.log('platform add data to dataset failed.');
      var err = buildError(error, datasetId);

      if(error.errors && error.errors.length > 0) {
        for (var i in error.errors) {
          var hpattern = /\/(\d+)\//;
          var toMatch = hpattern.exec(error.errors[i].source.pointer);
          if (toMatch[1]) {
            api.log('Offending record for error', i, ':', JSON.stringify(data[parseInt(toMatch[1])], null, '\t'));
          }
        }
      }

      callback(err);
    }
  };

  api.log('addDataToDataset #' + blockIndex + ': using id ', datasetId);

  tidepool.addDataToDataset(datasetId, data, function(err, result) {
    if (err) {
      return sad(err);
    }
    return happy(result);
  });
}

/*
 * process the data sending it to the platform in blocks and feed back progress to the calling function
 * uploadType is the final argument (instead of the callback) so that existing calls to
 * api.upload.toPlatform don't have to be modified in every driver, and will default to
 * the jellyfish api
 */
api.upload.toPlatform = function(data, sessionInfo, progress, groupId, cb, uploadType) {

  api.log('attempting to upload', data.length, 'device data records');
  var grouped = _.groupBy(data, 'type');
  for (var type in grouped) {
    api.log(grouped[type].length, 'records of type', type);
  }

  var blocks = [];
  var BLOCKSIZE = 1000;
  var nblocks = 0;
  var datasetId;

  var post_and_progress = function (data, callback) {
    progress(nblocks++ * 100.0 / blocks.length);
    //off to the platfrom we go
    if(uploadType === 'jellyfish') {
      return addDataToDataset(data, groupId, nblocks, uploadType, callback);
    }
    return addDataToDataset(data, datasetId, nblocks, uploadType, callback);
  };

  var post_dataset_create = function (uploadMeta, callback) {
    return createDatasetForUser(groupId, uploadMeta, callback);
  };

  var post_dataset_finalize = function (callback) {
    return finalizeDataset(datasetId, callback);
  };

  var decorate = function (data, uploadItem) {
    if(uploadType === 'jellyfish') {
      var deviceRecords = _.map(data, function(item) {
        return _.extend({}, item, {
          uploadId: uploadItem.uploadId,
          guid: uuidv4()
        });
      });
      return deviceRecords;
    }
    else{
      return data;
    }
  };

  async.waterfall([
    function(callback) {
      //generate and post the upload metadata
      var now = new Date();

      if (rollbar) {
        var nowHammerTime = now.getTime();
        var events = _.filter(data, function(event) {
          var year = parseInt(event.time.substring(0,4));
          var timestamp = sundial.parseFromFormat(event.time).getTime();

          return year < 2006 || timestamp > (nowHammerTime + (24 * 60 * sundial.MIN_TO_MSEC));
        });

        if(events.length > 0) {
          rollbar.info('Upload contains event(s) prior to 2006 or more than a day in the future', events);
        }
      }

      var uploadItem = builder.makeUpload()
        // yes, I'm intentionally breaking up the new Date() I made and parsing
        // it again with another new Date()...it's a moment limitation...
        .with_computerTime(sundial.formatDeviceTime(new Date(Date.UTC(
          now.getFullYear(), now.getMonth(), now.getDate(),
          now.getHours(), now.getMinutes(), now.getSeconds()
        ))))
        .with_time(sessionInfo.start)
        .with_timezone(sessionInfo.tzName)
        .with_timezoneOffset(-new Date().getTimezoneOffset())
        .with_conversionOffset(0)
        .with_timeProcessing(sessionInfo.timeProcessing)
        .with_version(sessionInfo.version)
        .with_deviceTags(sessionInfo.deviceTags)
        .with_deviceManufacturers(sessionInfo.deviceManufacturers)
        .with_deviceModel(sessionInfo.deviceModel)
        .with_deviceSerialNumber(sessionInfo.deviceSerialNumber)
        .with_deviceId(sessionInfo.deviceId)
        .with_payload(sessionInfo.payload)
        .with_client({
          name: 'org.tidepool.uploader',
          version: sessionInfo.version
        });

      if(sessionInfo.delta != null) {
        _.set(uploadItem, 'client.private.delta', sessionInfo.delta);
      }

      if(sessionInfo.blobId != null) {
        _.set(uploadItem, 'client.private.blobId', sessionInfo.blobId);
      }

      _.set(uploadItem, 'client.private.os', os.platform() + '-' + os.arch() + '-' + os.release());

      if(uploadType === 'jellyfish') {
        uploadItem.with_uploadId('upid_' +
          crypto.createHash('md5')
                .update(sessionInfo.deviceId + '_' + sessionInfo.start)
                .digest('hex')
                .slice(0, 12));
        uploadItem.with_guid(uuidv4());
        uploadItem.with_byUser(tidepool.getUserId());
      }
      uploadItem = uploadItem.done();

      api.log('create dataset');

      post_dataset_create(uploadItem, function(err, dataset){
        if(_.isEmpty(err)){
          api.log('created dataset');
          datasetId = _.get(dataset, 'data.uploadId');
          if(_.isEmpty(datasetId)){
            api.log('created dataset does not include uploadId');
            return callback(new Error(format('Dataset response does not contain uploadId.')));
          }
          return callback(null, uploadItem);
        }
        api.log('error creating dataset ', err);
        return callback(err);
      });
    },
    function(uploadItem, callback) {
      // decorate our data with the successfully posted upload metadata
      // as well as a GUID and then save to the platform
      data = decorate(data, uploadItem);

      for (var i = 0; i < data.length; i += BLOCKSIZE) {
        blocks.push(data.slice(i, i + BLOCKSIZE));
      }
      api.log('start uploading the rest of the data');
      //process then finalise, or if you want you can finalize :)
      async.mapSeries(blocks, post_and_progress, callback);
    },
    function(result, callback) {
      if(uploadType === 'jellyfish') {
        return callback(null, result);
      }
      api.log('finalize dataset');
      post_dataset_finalize(function(err){
        if(_.isEmpty(err)){
          api.log('finalized dataset');
          return callback(null, result);
        }
        api.log('error finalizing dataset', err);
        return callback(err);
      });
    }
  ], function (err, result) {
    if(err == null){
      api.log('upload.toPlatform: all good');
      return cb(null, result);
    }
    api.log('upload.toPlatform: failed ',err);
    return cb(err);
  });
};

api.getMostRecentUploadRecord = function(userId, deviceId, cb) {
  api.log('GET /data_sets?deviceId=' + deviceId + '&size=1');
  tidepool.getUploadRecordsForDevice(userId, deviceId, 1, function(err, resp) {
    if (err) {
      if (!navigator.onLine) {
        var error = new Error(errorText.E_OFFLINE);
        error.originalError = err;
        return cb(error);
      }
      return cb(err);
    }
    api.log('Upload record response:', resp);
    if (resp && resp.length > 0) {
      return cb(null, resp[0]);
    } else {
      // could not retrieve an upload record, so return null
      return cb(null, null);
    }
  });
};

api.getLatestRecord = function(userId, deviceId, type, subType) {
  const options = {
    type: type,
    latest: 1,
    deviceId: deviceId,
    subType: subType,
  };

  api.log('GET /data/' + userId + '&options=' + JSON.stringify(options));
  return new Promise((resolve, reject) => {

    tidepool.getDeviceDataForUser(userId, options, function(err, resp) {
      if (err) {
        if (!navigator.onLine) {
          const error = new Error(errorText.E_OFFLINE);
          error.originalError = err;
          reject(error);
        }
        reject(err);
      }
      api.log('Latest record response:', resp);
      if (resp && resp.length > 0) {
        resolve(resp[0]);
      } else {
        // could not retrieve an upload record, so return null
        resolve(null);
      }
    });
  });
};

api.upload.blob = function(blob, contentType, cb) {
  api.log('POST /blobs');

  var digest = crypto.createHash('md5').update(blob).digest('base64');
  var blobObject = new Blob([blob], {type: contentType});

  tidepool.uploadBlobForUser(tidepool.getUserId(), blobObject, contentType, 'MD5=' + digest, function(err, result) {
    if (err) {
      return cb(err, null);
    }
    return cb(null, result);
  });
};

// ----- Metrics -----

api.metrics = {};

api.metrics.track = function(eventName, properties) {
  api.log('GET /metrics/' + window.encodeURIComponent(eventName));
  return tidepool.trackMetric(eventName, properties);
};

// ----- Server time -----
api.getTime = function(cb) {
  api.log('GET /time');
  tidepool.getTime(function(err, resp) {
    if (err) {
      if (!navigator.onLine) {
        var error = new Error(errorText.E_OFFLINE);
        error.originalError = err;
        return cb(error);
      }
      return cb(err);
    }
    if (resp.data && resp.data.time) {
      return cb(null, resp.data.time);
    } else {
      // the response is not in the right format,
      // so we send nothing back
      return cb(null, null);
    }
  });
};

// ----- Errors -----

api.errors = {};

api.errors.log = function(error, message, properties) {
  api.log('GET /errors');

  if (rollbar) {
    var extra = {};
    if (_.get(error, 'data.blobId', false)) {
      _.assign(extra, { blobId: error.data.blobId });
    }
    if (_.isError(error.originalError)) {
      _.assign(extra, { displayError: _.omit(error, ['originalError']) });
      error = error.originalError;
    }
    rollbar.error(error, extra);
  }
  return tidepool.logAppError(error.debug, message, properties);
};

module.exports = api;
