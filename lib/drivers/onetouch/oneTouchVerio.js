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

import fs from 'fs';
import { assign, clone, invert, trimEnd } from 'lodash';
import drivelist from 'drivelist';
import directIO from '@ronomon/direct-io';
import sundial from 'sundial';
import TZOUtil from '../../TimezoneOffsetUtil';
import annotate from '../../eventAnnotations';
import crc from '../../crc';
import common from '../../commonFunctions';

// load usb module only on Linux (OSX and Windows use block device access)
// eslint-disable-next-line import/no-extraneous-dependencies
const usb = (process.platform === 'linux') ? require('usb') : null;

const isBrowser = typeof window !== 'undefined';
// eslint-disable-next-line no-console
const debug = isBrowser ? require('bows')('OneTouchVerio') : console.log;

const VENDOR_IDENTIFICATION = Buffer.from('LifeScan\x00');
const USB_SIGNATURE = {
  RECEIVE: Buffer.from('USBS'),
  SEND: Buffer.from('USBC'),
};
const USB_BULK_BLOCKSIZE = 512;
const USB_INQUIRY_BLOCKSIZE = 96;
const USB_FLAGS_READ = 0x80;
const USB_FLAGS_WRITE = 0x00;
const LINK_LAYER_HEADER_LENGTH = 3;
const LINK_LAYER_CRC_LENGTH = 2;
const STX = 0x02;
const ETX = 0x03;
const RESPONSE_OK = 0x06;
const APPLICATION_LAYER_HEADER_LENGTH = 2;
const WSTRING_ZERO_TERMINATOR_LENGTH = 2;
const CBD_OP_CODE = {
  INQUIRY: 0x12,
  WRITE_10: 0x2a,
  READ_10: 0x28,
};
const CBD_TRANSFER_LENGTH = 1;
const LBA_NUMBER = {
  GENERAL: 3,
  PARAMETER: 4,
};
const BLOCKDEVICE_BLOCKSIZE = 512;
const BLOCKDEVICE_SIGNATURE = 'LIFESCAN   FAT16';
const SERVICE_ID = 0x04;
const QUERY_TYPE = {
  serialNumber: 0x00,
  deviceModel: 0x01,
  softwareVersion: 0x02,
  unknown: 0x03,
  dateFormat: 0x04,
  timeFormat: 0x05,
  vendorUrl: 0x07,
  languages: 0x09,
};
const QUERY_NAME = invert(QUERY_TYPE);
const PARAMETER_TYPE = {
  timeFormat: 0x00,
  dateFormat: 0x02,
  displayUnit: 0x04,
};
const PARAMETER_NAME = invert(PARAMETER_TYPE);
const UNIT_OF_MEASURE = [
  'mg/dL',
  'mmol/L',
];
const TIMESTAMP_EPOCH = 946684800; // 2000-01-01T00:00:00+00:00

const GLUCOSE_LO = 20;
const GLUCOSE_HI = 600;


class USBScsiDevice {
  constructor() {
    this.usbDataBuffer = Buffer.alloc(0);
    this.usbMassStorageTag = 0;
    this.device = null;
    this.kernelDriverWasAttached = false;
  }

  openDevice(deviceInfo, callback) {
    this.device = usb.findByIds(deviceInfo.vendorId, deviceInfo.productId);
    if (!this.device) {
      return callback(new Error(`Failed to open connection to ${deviceInfo.driverId}`));
    }
    this.device.open();

    if (this.device.interfaces.length < 1) {
      return callback(new Error('No USB interface found!'));
    }
    const deviceInterface = this.device.interfaces[0];

    if (deviceInterface.isKernelDriverActive()) {
      debug('openDevice: detachKernelDriver');
      this.kernelDriverWasAttached = true;
      deviceInterface.detachKernelDriver();
    }

    deviceInterface.claim();

    if (deviceInterface.endpoints.length < 2) {
      return callback(new Error('USB interface does not have enough endpoints!'));
    }

    deviceInterface.endpoints[0].transferType = usb.LIBUSB_TRANSFER_TYPE_BULK;
    deviceInterface.endpoints[1].transferType = usb.LIBUSB_TRANSFER_TYPE_BULK;

    [this.inEndpoint, this.outEndpoint] = deviceInterface.endpoints;

    this.inEndpoint.addListener('error', (error) => {
      debug(`${deviceInfo.driverId} inEndpoint.error: ${error}`);
    });

    this.inEndpoint.startPoll(1, USB_BULK_BLOCKSIZE);

    return callback(null);
  }

  closeDevice(callback) {
    if (this.device) {
      const deviceInterface = this.device.interfaces[0];
      deviceInterface.release(true, (err) => {
        if (err) {
          debug('closeDevice: error releasing USB device interface:', err);
        }
        if (this.kernelDriverWasAttached) {
          debug('closeDevice: attachKernelDriver');
          deviceInterface.attachKernelDriver();
          this.kernelDriverWasAttached = false;
        }
        this.device.close();
        this.device = null;
        callback();
      });
    }
  }

  parseUsbLayer(data, callback) {
    if (data && data.length > USB_SIGNATURE.RECEIVE.length) {
      if (data.slice(0, USB_SIGNATURE.RECEIVE.length).equals(USB_SIGNATURE.RECEIVE)) {
        // end of transmission found

        // check status byte
        if (data[data.length - 1] !== 0) {
          debug('parseUsbLayer: Error code:', data[data.length - 1]);
        } else if (callback) {
          // copy reference to pass on
          const receivedData = this.usbDataBuffer;
          // start new buffer
          this.usbDataBuffer = Buffer.alloc(0);
          // pass reference to buffer
          callback(receivedData);
        }
      } else {
        // payload packet found, append to buffer
        this.usbDataBuffer = Buffer.concat([this.usbDataBuffer, data]);
      }
    }
  }

  sendPacket(data) {
    this.outEndpoint.transfer(data, (err) => {
      if (err !== undefined) {
        debug('sendPacket: outEndpoint.error:', err);
        process.exit();
      }
    });
  }

  requestResponse(usbPackets, callback) {
    this.inEndpoint.removeAllListeners('data');
    this.inEndpoint.addListener('data', data => this.parseUsbLayer(data, callback));
    usbPackets.forEach(usbPacketData => this.sendPacket(usbPacketData));
  }

  buildUsbPacket(dataTransferLength, flags, cbd) {
    const usbRequestData = Buffer.alloc(31);
    USB_SIGNATURE.SEND.copy(usbRequestData);
    this.usbMassStorageTag += 1;
    usbRequestData.writeUInt32LE(this.usbMassStorageTag, 4);
    usbRequestData.writeUInt32LE(dataTransferLength, 8);
    usbRequestData.writeUInt8(flags, 12);
    usbRequestData.writeUInt8(cbd.length, 14);
    cbd.copy(usbRequestData, 15);
    return usbRequestData;
  }

  static buildScsiCbd10(opCode, lbaNumber) {
    // event though USB data is little endian, the SCSI CBD uses big endian
    const cbd = Buffer.alloc(10);
    cbd.writeUInt8(opCode, 0);
    cbd.writeUInt32BE(lbaNumber, 2);
    cbd.writeUInt16BE(CBD_TRANSFER_LENGTH, 7);
    return cbd;
  }

  sendScsiWrite10(lbaNumber, usbRequestData, callback) {
    const cbd = this.constructor.buildScsiCbd10(CBD_OP_CODE.WRITE_10, lbaNumber);
    const writeCommand = this.buildUsbPacket(USB_BULK_BLOCKSIZE, USB_FLAGS_WRITE, cbd);
    this.requestResponse([writeCommand, usbRequestData], callback);
  }

  sendScsiRead10(lbaNumber, callback) {
    const cbd = this.constructor.buildScsiCbd10(CBD_OP_CODE.READ_10, lbaNumber);
    this.requestResponse(
      [this.buildUsbPacket(USB_BULK_BLOCKSIZE, USB_FLAGS_READ, cbd)],
      (queryResponseData) => {
        callback(queryResponseData);
      },
    );
  }

  static validateScsiVendorId(data) {
    const VENDOR_ID_OFFSET = 8;
    if (data.length === 36 &&
      data.slice(VENDOR_ID_OFFSET, VENDOR_ID_OFFSET + VENDOR_IDENTIFICATION.length)
        .equals(VENDOR_IDENTIFICATION)) {
      debug('validateScsiVendorId: Found vendor identification');
      return true;
    }
    debug('validateScsiVendorId: Vendor identification not found!');
    return false;
  }

  static buildScsiCbdInquiry(opCode) {
    // event though USB data is little endian, the SCSI CBD uses big endian
    const cbd = Buffer.alloc(10);
    cbd.writeUInt8(opCode, 0);
    cbd.writeUInt16BE(USB_INQUIRY_BLOCKSIZE, 7);
    return cbd;
  }

  checkDevice(callback) {
    const cbd = this.constructor.buildScsiCbdInquiry(CBD_OP_CODE.INQUIRY);
    this.requestResponse(
      [this.buildUsbPacket(USB_INQUIRY_BLOCKSIZE, USB_FLAGS_READ, cbd)],
      (inquiryResponseData) => {
        let error = null;
        if (!this.constructor.validateScsiVendorId(inquiryResponseData)) {
          error = new Error('Vendor identification not found');
        }
        callback(error);
      },
    );
  }

  retrieveData(lbaNumber, usbRequestData, callback) {
    this.sendScsiWrite10(lbaNumber, usbRequestData, () => {
      this.sendScsiRead10(lbaNumber, callback);
    });
  }
}


class BlockDevice {
  constructor() {
    this.fileHandle = null;
  }

  openDevice(deviceInfo, callback) {
    // find correct device path
    drivelist.list((err, drives) => {
      if (err) {
        callback(err);
        return;
      }
      this.devicePath = null;
      debug('Drives:', JSON.stringify(drives, null, 4));
      drives.forEach((drive) => {
        if (drive.description && drive.description.includes('LifeScan') && !drive.system) {
          if ((process.platform === 'win32') && drive.mountpoints.length > 0) {
            this.devicePath = '\\\\.\\'.concat(trimEnd(drive.mountpoints[0].path, '\\'));
          } else {
            this.devicePath = drive.raw;
          }
        }
      });
      if (this.devicePath) {
        debug('devicePath:', this.devicePath);

        // open device for synchronous read and write operation
        fs.open(this.devicePath, 'rs+', (err2, fd) => {
          if (err2) {
            callback(err2);
          } else if (process.platform === 'win32') {
            directIO.setFSCTL_LOCK_VOLUME(fd, 1, (err3) => {
              if (err3) {
                return callback(err3);
              }
              this.fileHandle = fd;
              return callback(null);
            });
          } else {
            this.fileHandle = fd;
            callback(null);
          }
        });
      } else {
        callback(new Error(`Could not find device "${deviceInfo.driverId}".`));
      }
    });
  }

  closeDevice(callback) {
    if (this.fileHandle) {
      fs.closeSync(this.fileHandle);
      this.fileHandle = null;
    }
    if (callback) {
      return callback();
    }
    return null;
  }

  checkDevice(callback) {
    const readBuffer = directIO.getAlignedBuffer(3 * BLOCKDEVICE_BLOCKSIZE, 4096);
    // read first 3 sectors to check if this is the correct device
    fs.read(this.fileHandle, readBuffer, 0, readBuffer.length, 0, (err, numRead) => {
      if (err) {
        this.closeDevice();
        return callback(new Error(`Error reading from device '${this.devicePath}':`, err));
      }
      if (numRead < readBuffer.length) {
        this.closeDevice();
        return callback(new Error(`Error reading enough data from device '${this.devicePath}'.`));
      }
      // make very sure this is the device we are looking for
      if (!readBuffer.slice(0x2b, 0x3b).equals(Buffer.from(BLOCKDEVICE_SIGNATURE))) {
        debug(`Device signature: '${readBuffer.slice(0x2b, 0x3b).toString()}' !== '${BLOCKDEVICE_SIGNATURE}'`);
        this.closeDevice();
        return callback(new Error(`Did not find device signature on '${this.devicePath}'.`));
      }
      if (!readBuffer.slice(BLOCKDEVICE_BLOCKSIZE)
        .equals(Buffer.alloc(2 * BLOCKDEVICE_BLOCKSIZE))) {
        debug('Device data:', readBuffer.slice(BLOCKDEVICE_BLOCKSIZE).toString('hex'));
        this.closeDevice();
        return callback(new Error(`Found unexpected non-zero data on '${this.devicePath}'.`));
      }
      return callback(null);
    });
  }

  retrieveData(lbaNumber, requestData, callback) {
    const seekOffset = lbaNumber * BLOCKDEVICE_BLOCKSIZE;
    fs.write(
      this.fileHandle, requestData, 0, BLOCKDEVICE_BLOCKSIZE, seekOffset,
      (err) => {
        if (err) {
          debug(`retrieveData: Error writing to device '${this.devicePath}':`, err);
          return;
        }
        const readBuffer = directIO.getAlignedBuffer(BLOCKDEVICE_BLOCKSIZE, 4096);
        fs.read(
          this.fileHandle, readBuffer, 0, BLOCKDEVICE_BLOCKSIZE, seekOffset,
          (err2) => {
            if (err2) {
              debug(`retrieveData: Error reading from device '${this.devicePath}':`, err2);
              return;
            }
            callback(readBuffer);
          },
        );
      },
    );
  }
}


class OneTouchVerio {
  constructor(cfg) {
    this.cfg = cfg;
    if (process.platform === 'linux') {
      this.communication = new USBScsiDevice();
    } else {
      this.communication = new BlockDevice();
    }
  }

  openDevice(deviceInfo, callback) {
    return this.communication.openDevice(deviceInfo, callback);
  }

  closeDevice(callback) {
    return this.communication.closeDevice(callback);
  }

  checkDevice(callback) {
    return this.communication.checkDevice(callback);
  }

  static parseApplicationLayer(data, callback) {
    const responseCode = data[1];
    if (responseCode !== RESPONSE_OK) {
      debug('parseApplicationLayer: Invalid response code:', responseCode);
      return;
    }
    const commandData = data.slice(APPLICATION_LAYER_HEADER_LENGTH);
    if (callback) {
      callback(commandData);
    }
  }

  static parseLinkLayer(data, callback) {
    if (data.length !== USB_BULK_BLOCKSIZE) {
      debug('parseLinkLayer: Invalid data blocksize:', data.length);
      return;
    }
    if (data[0] !== STX) {
      debug('parseLinkLayer: Invalid start byte:', data[0]);
      return;
    }
    const length = data.readUInt16LE(1);
    if (data[length - 1 - LINK_LAYER_CRC_LENGTH] !== ETX) {
      debug('parseLinkLayer: Invalid end byte:', data[length - 1 - LINK_LAYER_CRC_LENGTH]);
      return;
    }
    const crc16 = data.readUInt16LE(length - LINK_LAYER_CRC_LENGTH);
    const calculatedCrc16 =
      crc.calcCRC_A(data.slice(0, length - LINK_LAYER_CRC_LENGTH), length - LINK_LAYER_CRC_LENGTH);
    if (crc16 !== calculatedCrc16) {
      debug('parseLinkLayer: CRC error:', crc16, '!=', calculatedCrc16);
      return;
    }
    const applicationData =
      data.slice(LINK_LAYER_HEADER_LENGTH, length - 1 - LINK_LAYER_CRC_LENGTH);
    callback(applicationData);
  }

  retrieveData(lbaNumber, linkLayerRequestData, callback) {
    this.communication.retrieveData(lbaNumber, linkLayerRequestData, (linkResponseData) => {
      this.constructor.parseLinkLayer(linkResponseData, (applicationResponseData) => {
        this.constructor.parseApplicationLayer(applicationResponseData, (commandData) => {
          callback(commandData);
        });
      });
    });
  }

  static buildLinkLayerFrame(applicationData) {
    const length = LINK_LAYER_HEADER_LENGTH + applicationData.length + 1 + LINK_LAYER_CRC_LENGTH;
    const data = Buffer.alloc(length);
    data[0] = STX;
    data.writeUInt16LE(length, 1);
    applicationData.copy(data, LINK_LAYER_HEADER_LENGTH);
    data[length - 1 - LINK_LAYER_CRC_LENGTH] = ETX;
    const calculatedCrc16 =
      crc.calcCRC_A(data.slice(0, length - LINK_LAYER_CRC_LENGTH), length - LINK_LAYER_CRC_LENGTH);
    data.writeUInt16LE(calculatedCrc16, length - LINK_LAYER_CRC_LENGTH);
    return data;
  }

  retrieveQueryData(queryType, callback) {
    const linkRequestData = directIO.getAlignedBuffer(USB_BULK_BLOCKSIZE, 4096);
    const applicationData = Buffer.from([SERVICE_ID, 0xe6, 0x02, queryType]);
    this.constructor.buildLinkLayerFrame(applicationData).copy(linkRequestData);
    this.retrieveData(LBA_NUMBER.GENERAL, linkRequestData, (commandData) => {
      const responseString = commandData
        .slice(0, commandData.length - WSTRING_ZERO_TERMINATOR_LENGTH).toString('utf16le');
      debug('parseQueryResponse:', QUERY_NAME[queryType], ':', responseString);
      const data = {};
      data[QUERY_NAME[queryType]] = responseString;
      callback(null, data);
    });
  }

  retrieveParameterData(parameterType, callback) {
    const linkRequestData = Buffer.alloc(USB_BULK_BLOCKSIZE);
    const applicationData = Buffer.from([SERVICE_ID, parameterType, 0x00]);
    this.constructor.buildLinkLayerFrame(applicationData).copy(linkRequestData);
    this.retrieveData(LBA_NUMBER.PARAMETER, linkRequestData, (commandData) => {
      let responseString;
      if (parameterType === PARAMETER_TYPE.displayUnit) {
        responseString = UNIT_OF_MEASURE[commandData.readUInt32LE()];
      } else {
        responseString = commandData
          .slice(0, commandData.length - WSTRING_ZERO_TERMINATOR_LENGTH).toString('utf16le');
      }
      debug('parseParameterResponse:', PARAMETER_NAME[parameterType], ':', responseString);
      const data = {};
      data[PARAMETER_NAME[parameterType]] = responseString;
      callback(null, data);
    });
  }

  retrieveRTCData(callback) {
    const linkRequestData = Buffer.alloc(USB_BULK_BLOCKSIZE);
    const applicationData = Buffer.from([SERVICE_ID, 0x20, 0x02]);
    this.constructor.buildLinkLayerFrame(applicationData).copy(linkRequestData);
    this.retrieveData(LBA_NUMBER.GENERAL, linkRequestData, (commandData) => {
      const timestamp = commandData.readUInt32LE(0);
      debug('parseRTCResponse:', timestamp);
      if (timestamp) {
        callback(this.constructor.getDate(timestamp));
      } else {
        callback(null);
      }
    });
  }

  retrieveRecordCount(callback) {
    const linkRequestData = Buffer.alloc(USB_BULK_BLOCKSIZE);
    const applicationData = Buffer.from([SERVICE_ID, 0x27, 0x00]);
    this.constructor.buildLinkLayerFrame(applicationData).copy(linkRequestData);
    this.retrieveData(LBA_NUMBER.GENERAL, linkRequestData, (commandData) => {
      const recordCount = commandData.readUInt16LE();
      debug('retrieveRecordCount:', recordCount);
      const data = {};
      data.recordCount = recordCount;
      callback(null, data);
    });
  }

  static getDate(timestamp) {
    return new Date((TIMESTAMP_EPOCH + timestamp) * 1000);
  }

  retrieveRecord(recordIndex, callback) {
    const linkRequestData = Buffer.alloc(USB_BULK_BLOCKSIZE);
    const applicationData = Buffer.from([SERVICE_ID, 0x31, 0x02, 0x00, 0x00, 0x00]);
    applicationData.writeUInt16LE(recordIndex, 3);
    this.constructor.buildLinkLayerFrame(applicationData).copy(linkRequestData);
    this.retrieveData(LBA_NUMBER.GENERAL, linkRequestData, (commandData) => {
      const data = {};
      debug('Raw result:', commandData.toString('hex'));
      data.globalRecordIndex = commandData.readUInt16LE(3);
      data.timestamp = this.constructor.getDate(commandData.readUInt32LE(5));
      data.glucoseValueMgdl = commandData.readUInt16LE(9);
      // eslint-disable-next-line no-bitwise
      data.controlSolution = !!(0x01 & commandData.readUInt8(2));
      debug('retrieveRecord:', data);
      callback(null, data);
    });
  }

  retrieveRecords(recordCount, callback) {
    const records = [];
    const cb = (error, data) => {
      records.push(data);
      if (records.length < recordCount) {
        this.retrieveRecord(records.length, cb);
      } else {
        callback(null, records);
      }
    };
    this.retrieveRecord(records.length, cb);
  }

  static addOutOfRangeAnnotation(recordBuilder, low, high, step, type) {
    if (low !== null && recordBuilder.value < low + step) {
      recordBuilder.with_value(low);
      annotate.annotateEvent(recordBuilder, {
        code: `${type}/out-of-range`,
        value: 'low',
        threshold: low + step,
      });
    } else if (high !== null && recordBuilder.value > high - step) {
      recordBuilder.with_value(high);
      annotate.annotateEvent(recordBuilder, {
        code: `${type}/out-of-range`,
        value: 'high',
        threshold: high - step,
      });
    }
  }

  processData(data) {
    const postRecords = [];
    data.records.forEach((record) => {
      if (!record.controlSolution) {
        // values are always in 'mg/dL', independent of the unitOfMeasure setting
        const recordBuilder = this.cfg.builder.makeSMBG()
          .with_value(record.glucoseValueMgdl)
          .with_units('mg/dL')
          .with_deviceTime(sundial.formatDeviceTime(record.timestamp))
          .set('index', record.globalRecordIndex);

        this.cfg.tzoUtil.fillInUTCInfo(recordBuilder, record.timestamp);

        this.constructor.addOutOfRangeAnnotation(recordBuilder, GLUCOSE_LO, GLUCOSE_HI, 1, 'bg');

        const postRecord = recordBuilder.done();
        delete postRecord.index;
        postRecords.push(postRecord);
      }
    });
    return postRecords;
  }
}

export default function (config) {
  const cfg = clone(config);
  const driver = new OneTouchVerio(cfg);

  // With no date & time settings changes available,
  // timezone is applied across-the-board
  cfg.tzoUtil = new TZOUtil(cfg.timezone, new Date().toISOString(), []);
  cfg.deviceTags = ['bgm'];

  return {
    /* eslint no-param-reassign:
       [ "error", { "props": true, "ignorePropertyModificationsFor": ["data"] } ] */

    /* we let the default detect method handle this
    detect(deviceInfo, cb) {
      cb(null, deviceInfo);
    },
    */

    setup(deviceInfo, progress, cb) {
      progress(100);
      cb(null, { deviceInfo });
    },

    connect(progress, data, cb) {
      progress(0);
      driver.openDevice(data.deviceInfo, (err) => {
        if (err) {
          debug('Cannot open device:', err);
          cb(err, null);
          return;
        }
        progress(20);
        driver.checkDevice((err2) => {
          if (err2) {
            cb(err2, null);
            return;
          }
          data.disconnect = false;
          progress(100);
          cb(null, data);
        });
      });
    },

    getConfigInfo(progress, data, cb) {
      progress(0);
      const querySerial = QUERY_TYPE.serialNumber;
      driver.retrieveQueryData(querySerial, (err, serialNumber) => {
        if (err) {
          cb(err, null);
          return;
        }
        assign(data.deviceInfo, serialNumber);

        const queryModel = QUERY_TYPE.deviceModel;
        driver.retrieveQueryData(queryModel, (err2, deviceModel) => {
          if (err2) {
            cb(err2, null);
            return;
          }
          assign(data.deviceInfo, deviceModel);
          progress(100);

          driver.retrieveRTCData((rtcTime) => {
            common.checkDeviceTime(sundial.formatDeviceTime(rtcTime), cfg, (timeErr) => {
              if (timeErr) {
                driver.closeDevice(() => {
                  cb(timeErr, data);
                });
              } else {
                cb(null, data);
              }
            });
          });
        });
      });
    },

    fetchData(progress, data, cb) {
      progress(0);
      driver.retrieveRecordCount((err1, resultData1) => {
        if (err1) {
          cb(err1, null);
          return;
        }
        debug('fetchData: recordCount: ', resultData1.recordCount);
        if (resultData1.recordCount === 0) {
          data.records = [];
          debug('fetchData: no records found on device!');
          cb(null, data);
        }

        driver.retrieveRecords(resultData1.recordCount, (err2, records) => {
          if (err2) {
            cb(err2, null);
            return;
          }
          data.records = records;
          cb(null, data);
        });
      });
    },

    processData(progress, data, cb) {
      debug('processData: num records:', data.records.length);
      progress(0);

      data.deviceInfo.deviceId =
        `${data.deviceInfo.deviceModel.replace(/\s+/g, '')}-${data.deviceInfo.serialNumber}`;
      cfg.builder.setDefaults({ deviceId: data.deviceInfo.deviceId });

      data.postRecords = driver.processData(data);
      data.processData = true;

      progress(100);
      cb(null, data);
    },

    uploadData(progress, data, cb) {
      debug('uploadData: num post records:', data.postRecords.length);
      progress(0);

      const sessionInfo = {
        deviceTags: cfg.deviceTags,
        deviceManufacturers: ['LifeScan'],
        deviceModel: data.deviceInfo.deviceModel,
        deviceSerialNumber: data.deviceInfo.serialNumber,
        deviceId: data.deviceInfo.deviceId,
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
      progress(0);
      driver.closeDevice(() => {
        progress(100);
        cb(null, data);
      });
    },

    cleanup(progress, data, cb) {
      progress(100);
      cb(null, data);
    },
  };
}
