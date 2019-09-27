/*
 * == BSD2 LICENSE ==
 * Copyright (c) 2017, Tidepool Project
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

import { clone, assign, forEach, forEachRight, map } from 'lodash';
import async from 'async';
import sundial from 'sundial';
import crypto from 'crypto';
import common from '../../commonFunctions';

import FreeStyleLibreProtocol from './freeStyleLibreProtocol';
import FreeStyleLibreData from './freeStyleLibreData';
import {
  FSLIBRE_PRO_PRODUCT_ID,
  DB_TABLE_ID,
  CFG_TABLE_ID,
  DEVICE_MODEL_NAME,
  COMPRESSION,
  OP_CODE,
} from './freeStyleLibreConstants';

const isBrowser = typeof window !== 'undefined';
// eslint-disable-next-line no-console
const debug = isBrowser ? require('bows')('FreeStyleLibreDriver') : console.log;

export default function (config) {
  const cfg = clone(config);
  cfg.deviceTags = ['bgm', 'cgm'];
  const hidDevice = config.deviceComms;
  const protocol = new FreeStyleLibreProtocol(cfg);
  const dataParser = new FreeStyleLibreData(cfg);

  return {
    /* eslint no-param-reassign:
       [ "error", { "props": true, "ignorePropertyModificationsFor": ["data"] } ] */
    detect(deviceInfo, cb) {
      cb(null, deviceInfo);
    },

    setup(deviceInfo, progress, cb) {
      progress(100);
      cb(null, { deviceInfo });
    },

    connect(progress, data, cb) {
      hidDevice.connect(data.deviceInfo, FreeStyleLibreProtocol.probe, (err) => {
        if (err) {
          return cb(err);
        }
        return protocol.initCommunication(() => {
          // ignore results of init as it seems not to be relevant to the following communication
          data.disconnect = false;
          progress(100);
          return cb(null, data);
        });
      });
    },

    getConfigInfo(progress, data, cb) {
      progress(0);

      const getterFunctions = [
        (callback) => {
          // First, check device time
          protocol.getReaderTime((result) => {
            common.checkDeviceTime(
              sundial.formatDeviceTime(result.readerTime),
              cfg,
              callback,
            );
          });
        },
        (callback) => { protocol.getSerialNumber(callback); },
        (callback) => { protocol.getFirmwareVersion(callback); },
        (callback) => { protocol.getDBRecordNumber(callback); },
      ];
      let counter = 0;
      async.series(getterFunctions, (err, result) => {
        counter += 1;
        progress(100 * (counter / getterFunctions.length));

        if (err) {
          debug('getConfigInfo: ', err);
          return cb(err, null);
        }
        data.connect = true;
        forEach(result, (element) => {
          if (typeof element === 'object') {
            debug('getConfigInfo: result object: ', element);
            assign(data.deviceInfo, element);
          }
          return null;
        });
        debug('getConfigInfo: data: ', data);

        return cb(null, data);
      });
    },

    fetchData(progress, data, cb) {
      progress(0);

      let getterFunctions;
      if (data.deviceInfo.productId === FSLIBRE_PRO_PRODUCT_ID) {
        getterFunctions = [
          (callback) => { protocol.getDbSchema(callback); },
          (callback) => { protocol.getCfgSchema(callback); },
          (callback) => { protocol.getDateTime(callback); },
          (callback) => {
            protocol.getCfgData(CFG_TABLE_ID.METER_FACTORY_CONFIGURATION, callback);
          },
          (callback) => { protocol.getCfgData(CFG_TABLE_ID.METER_SETTINGS, callback); },
          (callback) => { protocol.getCfgData(CFG_TABLE_ID.USER_PATIENT_CONFIGURATION, callback); },
          (callback) => { protocol.getCfgData(CFG_TABLE_ID.USER_PATIENT_SETTINGS, callback); },
          (callback) => { protocol.getDatabase(DB_TABLE_ID.GLUCOSE_RESULT, callback); },
          (callback) => { protocol.getDatabase(DB_TABLE_ID.HISTORICAL_DATA, callback); },
          (callback) => { protocol.getDatabase(DB_TABLE_ID.EVENT, callback); },
        ];
      } else {
        getterFunctions = [
          (callback) => { protocol.setCompression(COMPRESSION.ENABLED, callback); },
          (callback) => { protocol.getDbSchema(callback); },
          (callback) => { protocol.getCfgSchema(callback); },
          (callback) => { protocol.getDateTime(callback); },
          (callback) => {
            protocol.getCfgData(CFG_TABLE_ID.METER_FACTORY_CONFIGURATION, callback);
          },
          (callback) => { protocol.getCfgData(CFG_TABLE_ID.METER_SETTINGS, callback); },
          (callback) => { protocol.getCfgData(CFG_TABLE_ID.USER_PATIENT_CONFIGURATION, callback); },
          (callback) => { protocol.getCfgData(CFG_TABLE_ID.USER_PATIENT_SETTINGS, callback); },
          (callback) => { protocol.getCfgData(CFG_TABLE_ID.INSULIN_SETTINGS, callback); },
          (callback) => { protocol.getCfgData(CFG_TABLE_ID.REMINDER_STRING, callback); },
          (callback) => { protocol.getCfgData(CFG_TABLE_ID.SMART_TAG_NOTES, callback); },
          (callback) => { protocol.getCfgData(CFG_TABLE_ID.STORED_SENSOR_INFORMATION, callback); },
          (callback) => { protocol.getCfgData(CFG_TABLE_ID.REMINDER_DATA, callback); },
          (callback) => { protocol.getDatabase(DB_TABLE_ID.GLUCOSE_RESULT, callback); },
          (callback) => { protocol.getDatabase(DB_TABLE_ID.RAPID_ACTING_INSULIN, callback); },
          (callback) => { protocol.getDatabase(DB_TABLE_ID.HISTORICAL_DATA, callback); },
          (callback) => { protocol.getDatabase(DB_TABLE_ID.EVENT, callback); },
        ];
      }

      let counter = 0;
      const updateProgress = (getterFunction, callback) => {
        getterFunction(callback);
        counter += 1;
        progress(100 * (counter / getterFunctions.length));
      };

      // apply updateProgress function to all getterFunctions to update progress after each one
      getterFunctions = map(getterFunctions, getterFunction =>
        (callback => updateProgress(getterFunction, callback)));

      data.aapPackets = [];
      async.series(getterFunctions, (err, results) => {
        if (err) {
          debug('fetchData: error: ', err);
          return cb(err, data);
        }
        forEach(results, (aapPackets) => {
          if (typeof aapPackets === 'object') {
            data.aapPackets = data.aapPackets.concat(aapPackets);
          }
        });
        return cb(null, data);
      });
    },

    processData(progress, data, cb) {
      debug('processData: num aapPackets:', data.aapPackets.length);
      progress(0);

      if (data.deviceInfo.productId === FSLIBRE_PRO_PRODUCT_ID) {
        // The unique ID of the sensor read with the Libre Pro handheld device cannot be read from
        // the device according to the available documentation.
        // To still be able to identify each sensor, a unique ID is generated by hashing the oldest
        // historical glucose data packet.
        // This packet contains a timestamp and the handheld device's DB record number which make it
        // unique for this device and globally unique in combination with the device ID.
        let generatedSensorId = '';
        const TABLE_ID_OFFSET = 0;
        // find oldest historical data packet
        forEachRight(data.aapPackets, (aapPacket) => {
          if (aapPacket.opCode === OP_CODE.GET_DATABASE &&
            aapPacket.data[TABLE_ID_OFFSET] === DB_TABLE_ID.HISTORICAL_DATA) {
            // generate unique ID by hashing oldest historical data packet to identify this sensor
            const hash = crypto.createHash('sha1');
            hash.update(aapPacket.data);
            generatedSensorId = hash.digest('hex');
          }
        });

        // append generatedSensorId to deviceId to be able to identify duplicate uploads of the
        // same sensor to different patient accounts
        data.deviceInfo.deviceId = `${data.deviceInfo.driverId}Pro-${data.deviceInfo.serialNumber}-${generatedSensorId}`;

        debug('processData: Libre Pro device/sensor ID:', data.deviceInfo.deviceId);
      } else {
        data.deviceInfo.deviceId = `${data.deviceInfo.driverId}-${data.deviceInfo.serialNumber}`;
      }
      cfg.builder.setDefaults({ deviceId: data.deviceInfo.deviceId });

      data.post_records =
        dataParser.processAapPackets(data.aapPackets, data.deviceInfo.dbRecordNumber);
      for (let i = 0; i < data.post_records.length; ++i) {
        delete data.post_records[i].index;
      }
      debug('processData: num post records:', data.post_records.length);

      if (data.post_records.length === 0) {
        return cb(new Error('Device has no records to upload'), null);
      }

      progress(100);
      data.processData = true;
      return cb(null, data);
    },

    uploadData(progress, data, cb) {
      progress(0);

      const sessionInfo = {
        deviceTags: cfg.deviceTags,
        deviceManufacturers: ['Abbott'],
        deviceModel: DEVICE_MODEL_NAME,
        deviceSerialNumber: data.deviceInfo.serialNumber,
        deviceId: data.deviceInfo.deviceId,
        start: sundial.utcDateString(),
        timeProcessing: cfg.tzoUtil.type,
        tzName: cfg.timezone,
        version: cfg.version,
        blobId: data.blobId,
      };

      cfg.api.upload.toPlatform(
        data.post_records, sessionInfo, progress, cfg.groupId,
        (err, result) => {
          progress(100);

          if (err) {
            debug(err);
            debug(result);
            return cb(err, data);
          }
          data.cleanup = true;
          return cb(null, data);
        },
      );
    },

    disconnect(progress, data, cb) {
      debug('disconnect');
      hidDevice.removeListeners();
      // Due to an upstream bug in HIDAPI on Windoze, we have to send a command
      // to the device to ensure that the listeners are removed before we disconnect
      // For more details, see https://github.com/node-hid/node-hid/issues/61
      hidDevice.send(FreeStyleLibreProtocol.buildHidPacket(0x00, ''), () => {
        progress(100);
        cb(null, data);
      });
    },

    cleanup(progress, data, cb) {
      debug('cleanup');
      if (!data.disconnect) {
        hidDevice.disconnect(data, () => {
          progress(100);
          data.cleanup = true;
          data.disconnect = true;
          cb(null, data);
        });
      } else {
        progress(100);
      }
    },
  };
}
