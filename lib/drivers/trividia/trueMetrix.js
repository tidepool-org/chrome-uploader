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

import _ from 'lodash';
import sundial from 'sundial';

import annotate from '../../eventAnnotations';
import common from '../../commonFunctions';
import TZOUtil from '../../TimezoneOffsetUtil';
import structJs from '../../struct';

const struct = structJs();
const isBrowser = typeof window !== 'undefined';
// eslint-disable-next-line no-console
const debug = isBrowser ? require('bows')('TrueMetrixDriver') : console.log;

const HEADER = 0xA0;
const READ_TIMEOUT = 2000; // in milliseconds

const COMMANDS = {
  WAKEUP: '(^)AF',
  IDENTIFY: '(I)9A',
  GET_SERIAL: '(Z1)DC',
  ACK: '(*)7B',
  GET_RESULTS: '(G)98',
  POWER_OFF: '(_)B0',
  GET_FIRMWARE_VERSION: '(V)A7',
  GET_METER_TIME: '(T)A5',
};

const TYPES = {
  MODEL: 'i',
  SERIAL: 'z1',
  GLUCOSE: 'g5',
  TIME: 't',
  CHECKSUM: 'x',
};

const MODELS = {
  MR2: 'TRUE METRIX',
  RC2: 'TRUE METRIX GO',
  BLU: 'TRUE METRIX AIR',
};

const CHECKSUM_TYPE = {
  FRAME: 1,
  DOWNLOAD: 2,
};

class TrueMetrix {
  constructor(cfg) {
    this.cfg = cfg;
    this.hidDevice = this.cfg.deviceComms;
  }

  static extractPacketIntoMessages(bytes) {
    const re = /\(([^)]*)\)(\w{2})/g;
    const str = String.fromCharCode.apply(null, bytes);
    let results;
    const messages = [];

    // eslint-disable-next-line no-cond-assign
    while ((results = re.exec(str)) !== null) {
      if (results != null) {
        if (TrueMetrix.verifyChecksum(results[1], results[2], CHECKSUM_TYPE.FRAME)) {
          messages.push(results[1]);
        }
      }
    }
    return messages;
  }

  static buildPacket(command, cmdlength) {
    const datalen = cmdlength + 2; /* we use 2 bytes because we add 1 byte for
                                    the header and 1 byte for the length of
                                    the payload */
    const buf = new ArrayBuffer(datalen);
    const bytes = new Uint8Array(buf);
    if (cmdlength) {
      struct.pack(bytes, 0, 'bb6z', HEADER, cmdlength, command);
      debug('Sending:', String.fromCharCode.apply(null, bytes));
    }
    return buf;
  }

  static verifyChecksum(frame, expected, type) {
    let checksum = 0;
    for (let i = 0; i < frame.length; ++i) {
      checksum += frame.charCodeAt(i);
    }

    let checkStr;
    if (type === CHECKSUM_TYPE.DOWNLOAD) {
      checkStr = _.padStart(_.toUpper(checksum.toString(16)).slice(-4), 4, '0');
    } else {
      checksum += 0x29 + 0x28; // add frame start and end characters back in
      checkStr = _.toUpper(checksum.toString(16)).slice(-2);
    }

    if (checkStr === _.toUpper(expected)) {
      return true;
    }
    debug('Checksum is', checkStr, ', expected', expected);
    return false;
  }

  async commandResponse(cmd) {
    let message = '';

    const bytesWritten =
      await this.hidDevice.sendPromisified(TrueMetrix.buildPacket(cmd, cmd.length));
    debug('Sent', bytesWritten, 'bytes.');

    let raw = [];
    let result;
    do {
      result = [];
      // eslint-disable-next-line no-await-in-loop, requests to devices are sequential
      result = await this.hidDevice.receiveTimeout(READ_TIMEOUT);
      const length = result[0];

      debug('Incoming bytes:', common.bytes2hex(result));

      if (result.length > 0 && length < 64) {
        raw = raw.concat(result.slice(1, length + 1));
      }
    } while (result.length > 0);

    // Only process if we get data
    if (raw.length > 0) {
      debug('Packet:', String.fromCharCode.apply(null, raw));
      message = TrueMetrix.extractPacketIntoMessages(raw);
    }
    debug('Message(s):', message);
    return message;
  }

  static filterByType(results, type) {
    const filtered = _.filter(results, (result, index, self) =>
      result != null &&
      _.startsWith(result, type) && // check type
      self.indexOf(result) === index); // remove duplicates
    return _.map(filtered, element => element.slice(type.length));
  }

  async getDeviceId() {
    let results = await this.commandResponse(COMMANDS.IDENTIFY);
    if (!_.isArray(results)) {
      results = [];
    }
    results = results.concat(await this.commandResponse(COMMANDS.GET_SERIAL));

    const model = TrueMetrix.filterByType(results, TYPES.MODEL);
    const modelName = MODELS[model];
    const [serial] = TrueMetrix.filterByType(results, TYPES.SERIAL);

    if (model == null || serial == null) {
      if (TrueMetrix.filterByType(results, TYPES.MODEL).length > 0) {
        throw Error('Sorry, but we do not support this meter yet.');
      } else {
        throw Error('Failed to connect to device. Is it in the cradle?');
      }
    } else {
      return {
        modelName,
        serial,
        deviceId: `Trividia-${model}-${serial}`,
      };
    }
  }
}

module.exports = (config) => {
  const cfg = _.clone(config);
  cfg.deviceTags = ['bgm'];
  const driver = new TrueMetrix(cfg);

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
      // eslint-disable-next-line consistent-return
      cfg.deviceComms.connect(data.deviceInfo, _.noop(), (err) => {
        if (err) {
          data.disconnect = true;
          debug('Error:', err);
          return cb(err, null);
        }

        (async () => {
          // On Windows, the driver only connects on the second attempt
          // if we don't power off first and then wake up later
          await driver.commandResponse(COMMANDS.POWER_OFF);
        })().then(() => {
          data.disconnect = false;
          progress(100);
          return cb(null, data);
        }).catch((error) => {
          debug('Error in connect: ', error);
          return cb(error, null);
        });
      });
    },

    getConfigInfo(progress, data, cb) {
      debug('in getConfigInfo', data);
      progress(0);

      (async () => {
        await driver.hidDevice.receiveTimeout(READ_TIMEOUT); // flush any data in the buffer
        progress(20);
        await driver.commandResponse(COMMANDS.WAKEUP);
        _.assign(cfg.deviceInfo, await driver.getDeviceId());
        progress(40);
        [cfg.deviceInfo.firmwareVersion] =
          await driver.commandResponse(COMMANDS.GET_FIRMWARE_VERSION);
        progress(60);

        const [rawTime] = await driver.commandResponse(COMMANDS.GET_METER_TIME);
        cfg.deviceInfo.meterTime = sundial.parseFromFormat(rawTime, 'ssmmHHDDMMYY');

        debug('DeviceInfo:', JSON.stringify(cfg.deviceInfo, null, 4));

        common.checkDeviceTime(
          sundial.formatDeviceTime(cfg.deviceInfo.meterTime), cfg,
          (timeErr) => {
            if (timeErr) {
              cfg.deviceComms.removeListeners();
              return driver.hidDevice.send(TrueMetrix.buildPacket(
                COMMANDS.POWER_OFF,
                COMMANDS.POWER_OFF.length,
              ), (err) => {
                if (err) {
                  cb(err, null);
                } else {
                  progress(100);
                  cb(timeErr, data);
                }
              });
            }
            progress(100);
            data.connect = true;
            return cb(null, data);
          },
        );
      })().catch((error) => {
        debug('Error in getConfigInfo: ', error);
        cb(error, null);
      });
    },

    async fetchData(progress, data, cb) {
      debug('in fetchData', data);
      try {
        const results = await driver.commandResponse(COMMANDS.GET_RESULTS);
        data.glucose = TrueMetrix.filterByType(results, TYPES.GLUCOSE);
        [data.checksum] = TrueMetrix.filterByType(results, TYPES.CHECKSUM);
        cb(null, data);
      } catch (error) {
        debug('Error in fetchData: ', error);
        cb(error, null);
      }
    },

    processData(progress, data, cb) {
      progress(0);
      cfg.builder.setDefaults({ deviceId: data.deviceInfo.deviceId });
      data.postRecords = [];
      let payloads = '';

      _.forEach(data.glucose, (nibbles, index) => {
        // each ASCII hex byte is a nibble
        payloads = payloads.concat(nibbles);
        const dayYear = parseInt(nibbles.slice(1, 4), 16).toString();
        const timestamp = parseInt(nibbles.slice(4, 7), 16).toString();

        const time = {
          year: _.toInteger(dayYear.slice(-2)) + 2000,
          month: parseInt(nibbles[0], 16),
          day: _.toInteger(dayYear.slice(0, -2)),
          hours: _.toInteger(timestamp.slice(0, -2)),
          minutes: _.toInteger(timestamp.slice(-2)),
          seconds: 0,
        };
        const jsDate = sundial.buildTimestamp(time);

        /* eslint-disable no-bitwise */
        // maximum glucose value is 0x7FF = 2047 mg/dL
        const threeBits = nibbles[7] & 0x07; // lower three bits of nibble
        let value = (threeBits << 8) + parseInt(nibbles.slice(8, 10), 16);
        /* eslint-enable no-bitwise */

        // According to user manual, HI > 600 and LO < 20
        let annotation = null;
        if (value > 600) {
          value = 601;
          annotation = {
            code: 'bg/out-of-range',
            value: 'high',
            threshold: 600,
          };
        } else if (value < 20) {
          value = 19;
          annotation = {
            code: 'bg/out-of-range',
            value: 'low',
            threshold: 20,
          };
        }

        const controlSolution = _.toInteger(nibbles[11]);

        if (controlSolution === 0) {
          const recordBuilder = cfg.builder.makeSMBG()
            .with_value(value)
            .with_units('mg/dL') // values are always in 'mg/dL'
            .with_deviceTime(sundial.formatDeviceTime(jsDate))
            .set('index', index);

          cfg.tzoUtil.fillInUTCInfo(recordBuilder, jsDate);

          if (annotation) {
            annotate.annotateEvent(recordBuilder, annotation);
          }

          const postRecord = recordBuilder.done();
          delete postRecord.index;
          data.postRecords.push(postRecord);
        }
      });

      // Also verify checksum of all the payloads
      if (!TrueMetrix.verifyChecksum(payloads, data.checksum.slice(1), CHECKSUM_TYPE.DOWNLOAD)) {
        return cb(new Error('Possible data corruption, checksums not matching.'), null);
      }

      debug('POST records:', data.postRecords);

      if (data.postRecords.length === 0) {
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
        deviceManufacturers: ['Trividia Health'],
        deviceModel: cfg.deviceInfo.modelName,
        deviceSerialNumber: cfg.deviceInfo.serial,
        deviceId: cfg.deviceInfo.deviceId,
        start: sundial.utcDateString(),
        timeProcessing: cfg.tzoUtil.type,
        tzName: cfg.timezone,
        version: cfg.version,
      };

      cfg.api.upload.toPlatform(
        data.postRecords, sessionInfo, progress, cfg.groupId,
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
      debug('in disconnect');
      cfg.deviceComms.removeListeners();
      // Due to an upstream bug in HIDAPI on Windoze, we have to send a command
      // to the device to ensure that the listeners are removed before we disconnect
      // For more details, see https://github.com/node-hid/node-hid/issues/61
      driver.hidDevice.send(TrueMetrix.buildPacket(
        COMMANDS.POWER_OFF,
        COMMANDS.POWER_OFF.length,
      ), (err) => {
        progress(100);
        cb(err, data);
      });
    },

    cleanup(progress, data, cb) {
      debug('in cleanup');
      if (!data.disconnect) {
        cfg.deviceComms.disconnect(data, () => {
          progress(100);
          data.cleanup = true;
          data.disconnect = true;
          cb(null, data);
        });
      } else {
        progress(100);
        cb();
      }
    },
  };
};
