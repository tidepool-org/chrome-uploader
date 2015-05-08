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
 /* global chrome */

var _ = require('lodash');
var async = require('async');
var sundial = require('sundial');
var localStore = require('../core/localStore');
var api = require('../core/api');
var device = require('../core/device');
var UploaderError = require('../core/uploaderError');
var carelink = require('../core/carelink');
var appState = require('./appState');

var config = require('../config.js');

var appActions = {};

appActions.trackedState = {
  LOGIN_SUCCESS : 'Login Successful',
  LOGOUT_CLICKED : 'Clicked Log Out',
  UPLOAD_FAILED : 'Upload Failed',
  UPLOAD_SUCCESS : 'Upload Successful',
  UPLOAD_STARTED : 'Upload Attempted',
  CARELINK_FETCH_FAILED : 'CareLink Fetch Failed',
  CARELINK_FETCH_SUCCESS : 'CareLink Fetch Successful',
  CARELINK_LOAD_FAILED : 'CareLink Upload Failed',
  CARELINK_LOAD_SUCCESS : 'CareLink Upload Successful',
  SEE_IN_BLIP : 'Clicked See Data in Blip'
};

appActions.errorText = {
  E_READING_FILE : 'Error reading file: ',
  E_WRONG_FILE_EXT : 'Please choose a file ending in: ',
  E_UPLOAD_IN_PROGRESS : 'Cannot start upload while an upload is in progress',
  E_UNSUPPORTED_TYPE : 'Unsupported upload source type: ',
  E_INVALID_UPLOAD_INDEX : 'Invalid upload index: ',
  E_DEVICE_NOT_CONNECTED : 'The device doesn\'t appear to be connected'
};

appActions.errorStage = {
  STAGE_SETUP : { Code: 'E_SETUP' , Message: 'Error during setup', Step: '' },
  STAGE_LOGIN : { Code: 'E_LOGIN' , Message: 'Error during login', Step: '' },
  STAGE_LOGOUT : { Code: 'E_LOGOUT' , Message: 'Error during logout', Step: '' },
  STAGE_DETECT_DEVICES : { Code: 'E_DETECTING_DEVICES' , Message: 'Error detecting devices', Step: '' },
  STAGE_READ_FILE : { Code: 'E_READING_FILE' , Message: 'Error trying to read file' , Step: '' },
  STAGE_UPLOAD : { Code: 'E_UPLOADING' , Message: 'Error uploading data' , Step: ''},
  STAGE_DEVICE_UPLOAD : { Code: 'E_DEVICE_UPLOAD' , Message: 'Error uploading device data', Step: '' },
  STAGE_DEVICE_DETECT : { Code: 'E_DEVICE_DETECT' , Message: 'Error trying to detect a device' , Step: '' },
  STAGE_CARELINK_UPLOAD : { Code: 'E_CARELINK_UPLOAD' , Message: 'Error uploading CareLink data' , Step: ''},
  STAGE_CARELINK_FETCH : { Code: 'E_CARELINK_FETCH' , Message: 'Error fetching CareLink data' , Step: '' }
};


//returns given error wrapped as an UploaderError
appActions.wrapError = function(error, stage, friendlyMsg){
  return new UploaderError(friendlyMsg, { version: config.namedVersion ,stage:stage}, error);
};

appActions.bindApp = function(app) {
  this.app = app;
  return this;
};

appActions.changeGroup = function(e) {
  var userid = e.target.value;

  //reset upload state when changing group
  for(var i in this.app.state.uploads) {
    appActions.reset(i);
  }

  var devicesById = localStore.getItem('devices') || {};
  var targetDevices = devicesById[userid] || [];
  if (_.isEmpty(targetDevices)) {
    this.app.setState({
      targetId: userid,
      targetDevices: targetDevices,
      page: 'settings'
    });
  }
  this.app.setState({
    targetId: userid,
    targetDevices: targetDevices
  });
};

appActions.load = function(cb) {
  var self = this;
  var loadLocalStore = function(cb) {
    localStore.init(localStore.getInitialState(), function() {
      cb();
    });
  };

  function setHostsWithCallback(cb) {
    api.setHosts(_.pick(config, ['API_URL', 'UPLOAD_URL', 'BLIP_URL']));
    return cb(null);
  }

  async.series([
    loadLocalStore,
    device.init.bind(device, {
      api: api,
      defaultTimezone: config.DEFAULT_TIMEZONE,
      version: config.namedVersion
    }),
    carelink.init.bind(carelink, {
      api: api,
      defaultTimezone: config.DEFAULT_TIMEZONE
    }),
    api.init.bind(api, {
      // these are for initialization only -- they get overwritten
      // if someone changes the URL
      apiUrl: config.API_URL,
      uploadUrl: config.UPLOAD_URL
    }),
    setHostsWithCallback,
  ], function(err, results) {
    if (err) {
      return cb(appActions.wrapError(err, appActions.errorStage.STAGE_SETUP));
    }

    var session = results[3];
    if (!session) {
      self.app.setState({
        page: 'login'
      });
      return cb();
    }

    async.series([
      api.user.account.bind(null),
      api.user.profile.bind(null),
      api.user.getUploadGroups.bind(null)
    ], function(err, results) {
      var account = results[0];
      var profile = results[1];
      var uploadGroups = results[2];

      var user = _.assign({}, account, {profile: profile, uploadGroups: uploadGroups});

      // once we've logged in, we don't want the right-click menus around, so
      // delete them.
      // because our test env isn't chrome, we have to test for it
      if (typeof chrome !== 'undefined') {
        chrome.contextMenus.removeAll();
      }

      appActions._afterLoginPage(user, cb);
    });
  });
};

appActions.login = function(credentials, options, cb) {
  var self = this;
  async.series([
    api.user.login.bind(null, credentials, options),
    api.user.profile,
    api.user.getUploadGroups.bind(null)
  ], function(err, results) {
    if (err) {
      return cb(appActions.wrapError(err, appActions.errorStage.STAGE_LOGIN));
    }
    self._logMetric(self.trackedState.LOGIN_SUCCESS);
    // once we've logged in, we don't want the right-click menus around, so
    // delete them.
    // because our test env isn't chrome, we have to test for it
    if (typeof chrome !== 'undefined') {
      chrome.contextMenus.removeAll();
    }

    var account = results[0] && results[0].user;
    var profile = results[1];
    var uploadGroups = results[2];

    var user = _.assign({}, account, {profile: profile, uploadGroups: uploadGroups});

    appActions._afterLoginPage(user, cb);
  });
};

appActions._afterLoginPage = function(user, cb) {
  var self = this;

  var devices = localStore.getItem('devices') || {};
  var targetDevices = devices[user.userid];

  if (!_.isEmpty(targetDevices)) {
    self.app.setState({
      user: user,
      targetId: user.userid,
      targetDevices: targetDevices,
      page: 'main'
    });

    return cb(null, user);
  }

  self.app.setState({
    user: user,
    targetId: user.userid,
    targetDevices: [],
    page: 'settings'
  });

  return cb(null, user);
};

appActions.logout = function(cb) {
  var self = this;
  self._logMetric(this.trackedState.LOGOUT_CLICKED);
  api.user.logout(function(err) {
    if (err) {
      return cb(appActions.wrapError(err, appActions.errorStage.STAGE_LOGOUT));
    }

    self.app.setState(_.assign(appState.getInitial(), {
      page: 'login'
    }));

    return cb();
  });
};

appActions.viewData = function() {
  this._logMetric(this.trackedState.SEE_IN_BLIP);
  return;
};

appActions.detectDevices = function(cb) {
  var self = this;
  device.detectAll(function(err, devices) {
    if (err) {
      return cb(appActions.wrapError(err, appActions.errorStage.STAGE_DETECT_DEVICES));
    }

    var uploads = self._mergeDevicesWithUploads(
      devices, self.app.state.uploads
    );
    self.app.setState({
      uploads: uploads
    });

    return cb(null, devices);
  });
};

appActions.chooseDevices = function() {
  this.app.setState({
    page: 'settings',
    dropMenu: false
  });
};

appActions.addOrRemoveTargetDevice = function(e) {
  var targetDevices = this.app.state.targetDevices;
  if (e.target.checked) {
    targetDevices.push(e.target.value);
  }
  else {
    targetDevices = _.reject(targetDevices, function(device) {
      return device === e.target.value;
    });
  }

  this.app.setState({
    targetDevices: targetDevices
  });
};

appActions.storeTargetDevices = function(targetId) {
  var devicesById = localStore.getItem('devices') || {};
  devicesById[targetId] = this.app.state.targetDevices;
  localStore.setItem('devices', devicesById);
  this.app.setState({
    page: 'main'
  });
};

appActions.hideDropMenu = function() {
  this.app.setState({
    dropMenu: false
  });
};

appActions.toggleDropMenu = function(e) {
  if (e) {
    e.stopPropagation();
  }
  var dropMenu = this.app.state.dropMenu;
  this.app.setState({
    dropMenu: !dropMenu
  });
};

appActions._logMetric = function(eventName, properties) {
  api.metrics.track(eventName, properties);
};

appActions._logError = function(error, message, properties) {
  api.errors.log(error, message, properties);
};

appActions._mergeDevicesWithUploads = function(devices, uploads) {
  var self = this;

  // Map connected devices to upload ids
  var connectedDeviceMap = _.reduce(devices, function(acc, d) {
    var upload = self._newUploadFromDevice(d);
    acc[self._getUploadId(upload)] = d;
    return acc;
  }, {});

  // Work only on device uploads
  var deviceUploads = _.filter(uploads, function(upload) {
    return upload.source.type === 'device';
  });

  // Mark device uploads that are disconnected
  // and add any newly connected devices at the end of the list
  var newDeviceMap = _.clone(connectedDeviceMap);
  _.forEach(deviceUploads, function(upload) {
    var uploadId = self._getUploadId(upload);
    var connectedDevice = connectedDeviceMap[uploadId];
    if (!connectedDevice) {
      upload.source.connected = false;
      delete upload.progress;
    }
    else {
      upload.source = _.assign(
        upload.source, {connected: true}, connectedDevice
      );
      delete newDeviceMap[uploadId];
    }
  });
  _.forEach(_.values(newDeviceMap), function(d) {
    deviceUploads.push(self._newUploadFromDevice(d));
  });

  // Add back carelink upload at beginning of list
  var carelinkUpload = _.find(uploads, function(upload) {
    return upload.source.type === 'carelink';
  });
  var newUploads = deviceUploads;
  if (carelinkUpload) {
    newUploads.unshift(carelinkUpload);
  }

  return newUploads;
};

appActions._getUploadId = function(upload) {
  var source = upload.source;
  if (source.type === 'device' || source.type === 'block') {
    return source.driverId;
  }
  if (source.type === 'carelink') {
    return source.type;
  }
  return null;
};

appActions._newUploadFromDevice = function(d) {
  return {
    source: _.assign({type: 'device'}, d, {connected: true})
  };
};

appActions.readFile = function(uploadIndex, targetId, file, extension) {
  var self = this;

  if (!file) {
    return;
  }

  function inputError(error) {
    self._updateUpload(uploadIndex, function(upload) {
      var now = self._now();
      var instance = {
        targetId: targetId,
        start: now,
        step: 'start',
        percentage: 0,
        finish: now,
        error: error
      };
      upload.progress = instance;
      upload = self._addToUploadHistory(upload, instance);
      return upload;
    });
  }

  if (file.name.slice(-extension.length) === extension) {
    var reader = new FileReader();

    reader.onerror = function() {
      var error = new UploaderError(self.errorText.E_READING_FILE + file.name, { version: config.namedVersion ,stage: appActions.errorStage.STAGE_READ_FILE });
      inputError(error);
      // the return is just for ease of testing
      return error;
    };

    reader.onloadend = (function(theFile) {
      return function(e) {
        self._updateUpload(uploadIndex, function(upload) {
          upload.file = {
            name: theFile.name,
            data: e.srcElement.result
          };
          return upload;
        });
      };
    })(file);

    reader.readAsArrayBuffer(file);

    return true;
  }
  else {
    var error = new UploaderError(self.errorText.E_WRONG_FILE_EXT + extension, { version: config.namedVersion ,stage: appActions.errorStage.STAGE_READ_FILE});
    inputError(error);
    // the return is just for ease of testing
    return error;
  }
};

appActions.upload = function(uploadIndex, options, cb) {
  var self = this;
  cb = cb || _.noop;

  this._assertValidUploadIndex(uploadIndex);

  if (appState.hasUploadInProgress()) {
    throw new UploaderError(self.errorText.E_UPLOAD_IN_PROGRESS, { version: config.namedVersion , stage: appActions.errorStage.STAGE_UPLOAD});
  }

  var upload = this.app.state.uploads[uploadIndex];

  options = _.assign(options, {
    targetId: this.app.state.targetId,
    progress: this._setUploadPercentage.bind(this, uploadIndex),
    version: config.namedVersion //e.g. Tidepool Uploader v0.1.0
  });
  var onUploadFinish = function(err, records) {
    if (err) {
      err = appActions.wrapError(err, appActions.errorStage.STAGE_UPLOAD);
      self._handleUploadError(uploadIndex, err);
      return cb(err);
    }
    self._handleUploadSuccess(uploadIndex, records);
    return cb(null, records);
  };

  this._setUploadStart(uploadIndex, options);

  self._logMetric(
    self.trackedState.UPLOAD_STARTED+' '+self._getUploadId(upload),
    { type: upload.source.type, source:upload.source.driverId }
  );

  if (upload.source.type === 'device' || upload.source.type === 'block') {
    var driverId = this.app.state.uploads[uploadIndex].source.driverId;
    return this._uploadDevice(driverId, options, onUploadFinish);
  }
  else if (upload.source.type === 'carelink') {
    var credentials = {
      username: options.username,
      password: options.password
    };
    return this._uploadCarelink(credentials, options, onUploadFinish);
  }
  else {
    throw new UploaderError(self.errorText.E_UNSUPPORTED_TYPE + upload.source.type, { version: config.namedVersion ,stage: appActions.errorStage.STAGE_UPLOAD});
  }
};

appActions._assertValidUploadIndex = function(uploadIndex) {
  if (uploadIndex > this.app.state.uploads.length - 1) {
    throw new UploaderError(this.errorText.E_INVALID_UPLOAD_INDEX + uploadIndex, { version: config.namedVersion , stage: appActions.errorStage.STAGE_UPLOAD});
  }
};

appActions._setUploadStart = function(uploadIndex, options) {
  var self = this;
  this._updateUpload(uploadIndex, function(upload) {
    var progress = {
      targetId: options.targetId,
      start: self._now(),
      step: 'start',
      percentage: 0
    };

    // Remember carelink username we're uploading from
    if (options.username) {
      progress.username = options.username;
    }

    upload.progress = progress;
    return upload;
  });
};

appActions._setUploadPercentage = function(uploadIndex, step, percentage) {
  this._updateUpload(uploadIndex, function(upload) {
    upload.progress = _.assign(upload.progress, {
      step: step,
      percentage: percentage
    });
    return upload;
  });
};

appActions._handleUploadSuccess = function(uploadIndex, records) {
  var self = this;
  this._updateUpload(uploadIndex, function(upload) {
    //log metric details
    self._logMetric(
      self.trackedState.UPLOAD_SUCCESS+' '+self._getUploadId(upload),
      { type: upload.source.type,
        source: upload.source.driverId,
        started: upload.progress.start,
        finished: upload.progress.finish,
        processed: upload.progress.count
      }
    );

    var instance = _.assign(upload.progress, {
      finish: self._now(),
      success: true,
      count: records.length
    });
    upload.progress = instance;
    upload = self._addToUploadHistory(upload, instance);
    if (upload.file != null) {
      delete upload.file;
    }
    return upload;
  });
};

appActions._handleUploadError = function(uploadIndex, error) {
  var self = this;
  this._updateUpload(uploadIndex, function(upload) {

    //log the errors
    self._logMetric(
      self.trackedState.UPLOAD_FAILED +' '+self._getUploadId(upload),
      {type: upload.source.type ,source:upload.source.driverId, error: error }
    );

    self._logError(
      error,
      self.trackedState.UPLOAD_FAILED +' '+self._getUploadId(upload),
      {type: upload.source.type ,source:upload.source.driverId}
    );

    var instance = _.assign(upload.progress, {
      finish: self._now(),
      error: error
    });
    upload.progress = instance;
    upload = self._addToUploadHistory(upload, instance);
    if (upload.file != null) {
      delete upload.file;
    }
    return upload;
  });
};

appActions._addToUploadHistory = function(upload, instance) {
  var history = upload.history || [];
  history.unshift(instance);
  upload.history = history;
  return upload;
};

appActions._updateUpload = function(uploadIndex, updateFn) {
  var uploads = this.app.state.uploads;
  uploads[uploadIndex] = updateFn(uploads[uploadIndex]);
  this.app.setState({
    uploads: uploads
  });
};

appActions._uploadDevice = function(driverId, options, cb) {

  var self = this;

  device.detect(driverId, options, function(err, d) {
    if (err) {
      return cb(appActions.wrapError(err, appActions.errorStage.STAGE_DEVICE_DETECT));
    }

    if (!d && options.filename == null) {
      var noDevice = new UploaderError( self.errorText.E_DEVICE_NOT_CONNECTED, { version: config.namedVersion ,stage: appActions.errorStage.STAGE_DEVICE_DETECT} );
      return cb(noDevice);
    }

    device.upload(driverId, options, function(err, records) {
      if (err) {
        return cb(appActions.wrapError(err, appActions.errorStage.STAGE_DEVICE_UPLOAD));
      }

      records = records || [];
      return cb(null, records);
    });
  });
};

appActions._now = function() {
  return sundial.utcDateString();
};

appActions._uploadCarelink = function(credentials, options, cb) {
  var self = this;

  var payload = {
    carelinkUsername: credentials.username,
    carelinkPassword: credentials.password,
    daysAgo: config.DEFAULT_CARELINK_DAYS
  };

  api.upload.fetchCarelinkData(payload, function(err, data) {

    if (err) {
      var msg = self.trackedState.CARELINK_FETCH_FAILED;
      console.log('## Carelink ## ',err);
      if (err.error && err.error.message){
        //add detail if we have it
        msg = err.error.message;
      }

      err = appActions.wrapError(err, appActions.errorStage.STAGE_CARELINK_FETCH, msg);

      self._logMetric(self.trackedState.CARELINK_FETCH_FAILED);
      self._logError(err, self.trackedState.CARELINK_FETCH_FAILED);
      return cb(err);
    }

    self._logMetric(self.trackedState.CARELINK_FETCH_SUCCESS);

    carelink.upload(data, options, function(err, records) {
      if (err) {
        return cb(appActions.wrapError(err, appActions.errorStage.STAGE_CARELINK_UPLOAD));
      }

      records = records || [];
      return cb(null, records);
    });
  });
};

appActions.reset = function(uploadIndex) {
  this._assertValidUploadIndex(uploadIndex);
  this._updateUpload(uploadIndex, function(upload) {
    return _.omit(upload, 'progress');
  });
};

module.exports = appActions;
