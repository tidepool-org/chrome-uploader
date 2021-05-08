/*
 * == BSD2 LICENSE ==
 * Copyright (c) 2019, Tidepool Project
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
import sundial from 'sundial';

import TZOUtil from '../../TimezoneOffsetUtil';
import annotate from '../../eventAnnotations';
import remote from '@electron/remote';

const isBrowser = typeof window !== 'undefined';
// eslint-disable-next-line no-console
const debug = isBrowser ? require('bows')('BluetoothLEDriver') : console.log;

const KETONE_VALUE_FACTOR = 10;
const KETONE_HI = 8.0;

module.exports = (config) => {
  const cfg = _.clone(config);
  cfg.deviceTags = ['bgm'];

  // With no date & time settings changes available,
  // timezone is applied across-the-board
  cfg.tzoUtil = new TZOUtil(cfg.timezone, new Date().toISOString(), []);

  return {
   /* eslint no-param-reassign:
      [ "error", { "props": true, "ignorePropertyModificationsFor": ["data"] } ] */

   detect(deviceInfo, cb) {
     debug('no detect function needed', deviceInfo);
     cb(null, deviceInfo);
   },

   setup(deviceInfo, progress, cb) {
     debug('in setup!');
     progress(100);
     cb(null, { deviceInfo });
   },

   connect(progress, data, cb) {
     debug('in connect!');

     (async () => {
       await cfg.deviceComms.ble.connectTimeout();
     })().then(() => {
       return cb(null, data);
     }).catch((error) => {
       debug('Error in connect: ', error);
       return cb(error, null);
     });
   },

   getConfigInfo(progress, data, cb) {
     debug('in getConfigInfo', data);
     progress(0);

     (async () => {
       _.assign(cfg.deviceInfo , await cfg.deviceComms.ble.getDeviceInfo());
     })().then(() => {
       if (!cfg.deviceInfo.name.startsWith('CareSens') && !cfg.deviceInfo.name.startsWith('ReliOn 2395')) {
         return cb (new Error('We don\'t currently support this meter.'));
       }

       cfg.deviceTags = ['bgm'];
       cfg.deviceInfo.deviceId = `${[cfg.deviceInfo.manufacturers]}-${cfg.deviceInfo.model}-${remote.getGlobal('bluetoothDeviceId')}`;
       data.deviceModel = cfg.deviceInfo.model; // for metrics
       cfg.builder.setDefaults({ deviceId: cfg.deviceInfo.deviceId });
       return cb(null, data);
     }).catch((error) => {
       debug('Error in getConfigInfo: ', error);
       return cb(error, null);
     });
   },

   fetchData(progress, data, cb) {
     debug('in fetchData', data);

     cfg.deviceComms.ble.once('data', (result) => {
       debug('Records:', result);
       _.assign(data, result);
       return cb(null, data);
     });

     (async () => {
       await cfg.deviceComms.ble.getAllRecords();
     })().catch((error) => {
       return cb(error, null);
     });
   },

   processData(progress, data, cb) {
     progress(0);
     data.post_records = [];

     _.forEach(data.records, (result) => {
       const record = result;
       let annotation = null;
       let isKetone = false;

       if (record.hasContext) {
         const context = _.find(
           data.contextRecords,
           { 'seqNum' : record.seqNum }
         );

         if (context) {
           if (context.meal && context.meal === 6) {
             isKetone = true;
           }
         } else {
           throw new Error ('Could not find context of measurement');
         }
       }

       if (isKetone) {
         // According to spec, HI > 8 mmol/L
         // there is no LO as values are between 0 and 8 mmol/L
         if (record.value > (KETONE_HI * KETONE_VALUE_FACTOR) ) {
           record.value = KETONE_HI + (1 / KETONE_VALUE_FACTOR);
           annotation = {
             code: 'ketone/out-of-range',
             threshold: KETONE_HI,
             value: 'high',
           };
         } else {
           record.value /= KETONE_VALUE_FACTOR;
         }
       } else {
         if (record.value > 600) {
           record.value = 601;
           annotation = {
             code: 'bg/out-of-range',
             threshold: 600,
             value: 'high',
           };
         } else if (record.value < 20) {
           record.value = 19;
           annotation = {
             code: 'bg/out-of-range',
             threshold: 20,
             value: 'low',
           };
         }
       }

       if (record.type !== 10) { //check that it's not control solution
         let postRecord = null;

         if (isKetone) {
           postRecord = cfg.builder.makeBloodKetone()
             .with_value(record.value)
             .with_units('mmol/L'); // ketones are hard-coded in mmol/L
         } else {
           postRecord = cfg.builder.makeSMBG()
             .with_value(record.value)
             .with_units(record.units);
         }

         postRecord
            .with_deviceTime(sundial.formatDeviceTime(record.timestamp))
            .set('index', record.seqNum);

         if (annotation) {
           annotate.annotateEvent(postRecord, annotation);
         }

         cfg.tzoUtil.fillInUTCInfo(postRecord, record.timestamp);
         delete postRecord.index;

         data.post_records.push(postRecord.done());
       }
     });

     debug('POST records:', data.post_records);

     if (data.post_records.length === 0) {
       debug('Device has no records to upload');
       return cb(new Error('Device has no records to upload'), null);
     }

     progress(100);
     return cb(null, data);
   },

   uploadData(progress, data, cb) {
     progress(0);

     const sessionInfo = {
       deviceTags: cfg.deviceTags,
       deviceManufacturers: cfg.deviceInfo.manufacturers,
       deviceModel: cfg.deviceInfo.model,
       deviceId: cfg.deviceInfo.deviceId,
       deviceSerialNumber: cfg.deviceInfo.serial,
       start: sundial.utcDateString(),
       timeProcessing: cfg.tzoUtil.type,
       tzName: cfg.timezone,
       version: cfg.version,
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
       'dataservices',
     );
   },

   disconnect(progress, data, cb) {
     // performing disconnect in cleanup
     data.disconnect = true;
     cb(null, data);
   },

   cleanup(progress, data, cb) {
     debug('in cleanup');

     (async () => {
       await cfg.deviceComms.ble.disconnect();
     })().then(() => {
       progress(100);
       data.cleanup = true;
       return cb();
     }).catch((error) => {
       debug('Error during disconnect: ', error);
       return cb();
    });
   },
  };
};
