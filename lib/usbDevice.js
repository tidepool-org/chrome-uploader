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

import usb from 'usb';

const isBrowser = typeof window !== 'undefined';
const debug = isBrowser ? require('bows')('usbDevice') : console.log;

export default class UsbDevice {
  constructor(deviceInfo) {
    this.device = usb.findByIds(deviceInfo.vendorId, deviceInfo.productId);
  }

  static getRequestType(direction, requestType, recipient) {
    const TYPES = {
      standard: 0x00,
      class: 0x01,
      vendor: 0x02,
      reserved: 0x03,
    };

    const RECIPIENTS = {
      device: 0x00,
      interface: 0x01,
      endpoint: 0x02,
      other: 0x03,
    };

    const DIRECTION = {
      'host-to-device': 0x00,
      'device-to-host': 0x01,
    };

    /* eslint-disable no-bitwise */
    return (DIRECTION[direction] << 7) |
           (TYPES[requestType] << 5) |
           RECIPIENTS[recipient];
  }

  controlTransfer(direction, transfer, dataOrLength) {
    return new Promise((resolve, reject) => {
      this.device.controlTransfer(
        UsbDevice.getRequestType(
          direction,
          transfer.requestType,
          transfer.recipient,
        ),
        transfer.request, transfer.value, transfer.index, dataOrLength,
        (err, data) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(data);
        },
      );
    });
  }

  controlTransferOut(transfer, data) {
    return this.controlTransfer(
      'host-to-device', transfer, data != null ? data : Buffer.alloc(0)
    );
  }

  controlTransferIn(transfer, length) {
    return this.controlTransfer('device-to-host', transfer, length);
  }

  transferIn(endpoint, length) {
    return new Promise((resolve, reject) => {
      this.iface.endpoint(endpoint | 0x80).transfer(length, (err, result) => {
        if (err) {
          debug('transferIn Error:', err);
          reject(err);
        } else {
          resolve(result);
        }
      });
    });
  }

  transferOut(endpoint, data) {
    return new Promise((resolve, reject) => {
      this.iface.endpoint(endpoint).transfer(data, (err) => {
        if (err) {
          debug('transferOut Error:', err);
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }
};
