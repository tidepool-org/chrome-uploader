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


var expect = require('salinity').expect;

var serialDevice = require('../../lib/serialDevice.js');

/*
connect: connect,
disconnect: disconnect,
discardBytes: discardBytes,
readSerial: readSerial,
writeSerial: writeSerial,
setPacketHandler: setPacketHandler,
clearPacketHandler: clearPacketHandler,
hasAvailablePacket: hasAvailablePacket,
peekPacket: peekPacket,
nextPacket: nextPacket,
flush: flush,
*/


describe('serialDevice.js', () => {

  var device;
  var config = {};

  beforeEach(() => {
    device = serialDevice(config);
  });

  describe('connect', () => {
    test('exists', () => {
      expect(device).itself.to.respondTo('connect');
    });
  });
  describe('discardBytes', () => {
    test('exists', () => {
      expect(device).itself.to.respondTo('discardBytes');
    });
  });
  describe('readSerial', () => {
    test('exists', () => {
      expect(device).itself.to.respondTo('readSerial');
    });
  });
  describe('writeSerial', () => {
    test('exists', () => {
      expect(device).itself.to.respondTo('writeSerial');
    });
  });
  describe('setPacketHandler', () => {
    test('exists', () => {
      expect(device).itself.to.respondTo('setPacketHandler');
    });
  });
  describe('clearPacketHandler', () => {
    test('exists', () => {
      expect(device).itself.to.respondTo('clearPacketHandler');
    });
  });
  describe('hasAvailablePacket', () => {
    test('exists', () => {
      expect(device).itself.to.respondTo('hasAvailablePacket');
    });
  });
  describe('peekPacket', () => {
    test('exists', () => {
      expect(device).itself.to.respondTo('peekPacket');
    });
  });
  describe('nextPacket', () => {
    test('exists', () => {
      expect(device).itself.to.respondTo('nextPacket');
    });
  });
  describe('flush', () => {
    test('exists', () => {
      expect(device).itself.to.respondTo('flush');
    });
  });
});
