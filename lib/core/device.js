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

/* global  __DEBUG__ */

var os = require('os');

var _ = require('lodash');
var async = require('async');

var serialDevice = require('../serialDevice');
var hidDevice = require('../hidDevice');
var driverManager = require('../driverManager');
var builder = require('../objectBuilder')();
var hid = require('node-hid');
var SerialPort = require('serialport');

var dexcomDriver = require('../drivers/dexcom/dexcomDriver');
var oneTouchMiniDriver = require('../drivers/onetouch/oneTouchMiniDriver');
var abbottPrecisionXtra = require('../drivers/abbott/abbottPrecisionXtra');
var tandemDriver = require('../drivers/tandem/tandemDriver');
var insuletOmniPod = require('../drivers/insulet/insuletDriver');
var oneTouchUltra2 = require('../drivers/onetouch/oneTouchUltra2');
var oneTouchVerioIQ = require('../drivers/onetouch/oneTouchVerioIQ');
var abbottFreeStyleLite = require('../drivers/abbott/abbottFreeStyleLite');
var bayerContourNext = require('../drivers/bayer/bayerContourNext');
var animasDriver = require('../drivers/animas/animasDriver');
var medtronicDriver = require('../drivers/medtronic/medtronicDriver');

var device = {
  log: require('bows')('Device')
};

var hostMap = {
  'darwin': 'mac',
  'win32' : 'win',
  'linux': 'linux',
};

device._deviceDrivers = {
  'Dexcom': dexcomDriver,
  'OneTouchMini': oneTouchMiniDriver,
  'AbbottPrecisionXtra': abbottPrecisionXtra,
  'InsuletOmniPod': insuletOmniPod,
  'Tandem': tandemDriver,
  'OneTouchUltra2': oneTouchUltra2,
  'OneTouchVerioIQ': oneTouchVerioIQ,
  'AbbottFreeStyleLite': abbottFreeStyleLite,
  'AbbottFreeStyleFreedomLite': abbottFreeStyleLite,
  'BayerContourNext': bayerContourNext,
  'BayerContourNextUsb': bayerContourNext,
  'BayerContourUsb': bayerContourNext,
  'BayerContourNextLink': bayerContourNext,
  'Animas': animasDriver,
  'Medtronic': medtronicDriver
};

device._deviceComms = {
  'Dexcom': serialDevice,
  'OneTouchMini': serialDevice,
  'AbbottPrecisionXtra': serialDevice,
  'OneTouchUltra2': serialDevice,
  'OneTouchVerioIQ': serialDevice,
  'AbbottFreeStyleLite': serialDevice,
  'AbbottFreeStyleFreedomLite': serialDevice,
  'Tandem': serialDevice,
  'BayerContourNext': hidDevice,
  'BayerContourNextUsb': hidDevice,
  'BayerContourUsb': hidDevice,
  'BayerContourNextLink': hidDevice,
  'Animas': serialDevice,
  'Medtronic': hidDevice
};

device._silentComms = {};
_.forEach(_.keys(device._deviceComms), function(driverId) {

  var comm = device._deviceComms[driverId];
  device._silentComms[driverId] = comm({silent: true});
  device._deviceComms[driverId] = comm();
});

// this is a cache for device information
// we need it so that what we learn in detect()
// can be used by process().
device._deviceInfoCache = {};

device.init = function(options, cb) {
  var self=this;
  self._defaultTimezone = options.defaultTimezone;
  self._driverManifests = self._getAllDriverManifests();
  self._api = options.api;
  self._version = options.version;
  self._groupId = options.targetId;
  self._os = hostMap[os.platform()];
  cb();
};

device._getAllDriverManifests = function() {
  var manifest = require('../../manifest.json');

  var usbDevicesPermission = _.find(manifest.permissions, function(permission) {
    return permission.usbDevices;
  });
  return _.reduce(usbDevicesPermission.usbDevices, function(acc, usbDevice) {
    acc[usbDevice.driverId] = usbDevice;
    return acc;
  }, {});
};

device.getDriverManifests = function() {
  return _.cloneDeep(this._driverManifests);
};

device.getDriverIds = function() {
  return _.keys(this._driverManifests);
};

device.getDriverManifest = function(driverId) {
  var driverManifest = this._driverManifests[driverId];
  if (!driverManifest) {
    throw new Error('Could not find driver manifest for "' + driverId + '"');
  }
  return driverManifest;
};

device.detectHelper = function(driverId, options, cb) {
  // Detect can run on a loop, so don't pollute the console with logging
  options.silent = true;
  var dm = this._createDriverManager(driverId, options);
  dm.detect(driverId, cb);
};

device._createDriverManager = function(driverId, options) {
  var drivers = {};
  drivers[driverId] = this._deviceDrivers[driverId];
  var configs = {};
  configs[driverId] = this._createDriverConfig(driverId, options);
  configs.debug = __DEBUG__ || false;

  return driverManager(drivers, configs);
};

device._createDriverConfig = function(driverId, options) {
  options = options || {};
  var timezone = options.timezone || this._defaultTimezone;
  var comms = options.silent ? this._silentComms : this._deviceComms;
  var theVersion = options.version || this._version;
  var uploadGroup = options.targetId || this._groupId;

  // handle config for block-mode devices, which includes the file name and data
  if (options.filename != null) {
    return {
      filename: options.filename,
      filedata: options.filedata,
      deviceInfo: this._deviceInfoCache[driverId],
      timezone: timezone,
      groupId: uploadGroup,
      api: this._api,
      version: options.version,
      builder: builder,
      progress: options.progress,
      silent: Boolean(options.silent)
    };
  }

  var deviceInfo = this._deviceInfoCache[driverId];

  if(options.serialNumber) {
    _.assign(deviceInfo, {serialNumber: options.serialNumber});
  }

  return {
    deviceInfo: deviceInfo,
    deviceComms: comms[driverId],
    timezone: timezone,
    groupId: uploadGroup,
    api: this._api,
    version: options.version,
    builder: builder,
    progress: options.progress,
    silent: Boolean(options.silent)
  };
};

device.detectHid = function(driverId, cb) {
  var self = this;
  var driverManifest = this.getDriverManifest(driverId);
  var results = hid.devices();
  results = _.filter(results, function(p) {
    return (p.vendorId === driverManifest.vendorId);
  });

  var devices = _.map(results, function(result) {
    var retval = {
      driverId: driverId,
      deviceId: result.deviceId,
      vendorId: result.vendorId,
      productId: result.productId
    };

    return retval;
  });

  var devdata = _.first(devices);

  if (devices.length > 1) {
    self.log('WARNING: More than one device found for "' + driverId + '"');
    device.othersConnected = devices.length - 1;
  }

  return cb(null, devdata);
};

device.detectUsb = function(driverId, cb) {
  var self = this;
  var driverManifest = this.getDriverManifest(driverId);
  var identification = {
    vendorId: driverManifest.vendorId,
    productId: driverManifest.productId
  };

  var getDevice = function(results) {
    var devices = _.map(results, function(result) {
      var retval = {
        driverId: driverId,
        vendorId: driverManifest.vendorId,
        productId: driverManifest.productId,
        usbDevice: result.device,
        path: result.comName
      };
      if (!!driverManifest.bitrate) {
        retval.bitrate = driverManifest.bitrate;
      }
      if(!!driverManifest.ctsFlowControl) {
        retval.ctsFlowControl = driverManifest.ctsFlowControl;
      }
      if(!!driverManifest.sendTimeout){
        retval.sendTimeout = driverManifest.sendTimeout;
      }
      if(!!driverManifest.receiveTimeout) {
        retval.receiveTimeout = driverManifest.receiveTimeout;
      }
      return retval;
    });

    var devdata = _.first(devices);

    if (devices.length > 1) {
      self.log('WARNING: More than one device found for "' + driverId + '"');
      device.othersConnected = devices.length - 1;
    }
    return cb(null, devdata);
  };


  SerialPort.list(function (err, results) {
    console.log('Connected device(s):', results);
    results = _.filter(results, function(p) {
      var vendorId = parseInt(p.vendorId,16);
      var productId = parseInt(p.productId,16);
      if (self._os === 'win') {
        return (vendorId === driverManifest.vendorId) &&
        (productId === driverManifest.productId);
      } else {
        return (vendorId === driverManifest.vendorId) &&
        (productId === driverManifest.productId) &&
        p.comName.match('/dev/cu.+');
      }
    });
    getDevice(results);
  });
};

device.detect = function(driverId, options, cb) {
  var self = this;
  if (_.isFunction(options)) {
    cb = options;
    options = { version: self._version };
  }
  var driverManifest = this.getDriverManifest(driverId);

  if(driverManifest.mode === 'HID'){
      this.detectHid(driverId, function(err, devdata) {

        if (err) {
          return cb(err);
        }

        if (!devdata) {
          return cb();
        }

        self._deviceInfoCache[driverId] = _.cloneDeep(devdata);
        self.detectHelper(driverId, options, function(err, ftdiDevice) {

          if (err) {
            return cb(err);
          }
          device = _.assign(devdata, ftdiDevice);
          return cb(null, devdata);
        });
      });

  }else{

    this.detectUsb(driverId, function(err, devdata) {

      if (err) {
        return cb(err);
      }

      if (!devdata) {
        return cb();
      }

      self._deviceInfoCache[driverId] = _.cloneDeep(devdata);
      self.detectHelper(driverId, options, function(err, ftdiDevice) {
        if (err) {
          return cb(err);
        }
        device = _.assign(devdata, ftdiDevice);
        return cb(null, devdata);
      });
    });
  }
};

device.detectAll = function(cb) {
  async.map(this.getDriverIds(), this.detect.bind(this), function(err, results) {
    if (err) {
      return cb(err);
    }
    // Filter out any nulls
    results = _.filter(results);
    cb(null, results);
  });
};

device.upload = function(driverId, options, cb) {
  var dm = this._createDriverManager(driverId, options);
  dm.process(driverId, function(err, result) {
    return cb(err, result);
  });
};

module.exports = device;
