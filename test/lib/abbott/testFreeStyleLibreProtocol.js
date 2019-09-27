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

/* global beforeEach, describe, it */

import {expect} from 'salinity';

import FreeStyleLibreProtocol from '../../../lib/drivers/abbott/freeStyleLibreProtocol';

describe('freeStyleLibreProtocol.js', () => {
  const cfg = {};

  describe('non-static', () => {
    let protocol;

    beforeEach(function(){
      protocol = new FreeStyleLibreProtocol(cfg);
    });

    describe('parse text responses', () => {

      it('should parse and return valid text responses', () => {
        const inputData = [
          ['DB Record Number = 226988\r\nCKSM:00000765\r\nCMD OK\r\n', 'DB Record Number = 226988'],
          ['2.1.2\r\nCKSM:00000108\r\nCMD OK\r\n', '2.1.2']
        ];
        inputData.forEach(([data, expectedResult]) => {
            const result = protocol.parseTextResponse(data);
            expect(result).deep.equals(expectedResult);
          }
        );
      });


      it('should not accept invalid text responses', () => {
        const inputData = [
          ['DB Record Number = 226988\r\nCKSM:00000765\r\nCMD Fail!\r\n', Error],
          ['2.1.2\r\nCKSM:00000111\r\nCMD OK\r\n', Error],
          ['2.1.2\r\nCKSM:108\r\nCMD OK\r\n', Error]
        ];
        inputData.forEach(([data, expectedResult]) => {
            const result = protocol.parseTextResponse(data);
            expect(result).instanceof(expectedResult);
          }
        );
      });
    });

  });

  describe('static', () => {

    describe('validate binary protocol checksum', () => {

      it('should produce valid checksums', () => {
        // data captured using Wireshark: mapping from AAP packet string to its corresponding ATP CRC32
        const ATP_CRC_LOOKUP = {
          '\x34': 0x0032c637,
          '\x54': 0xac9700a0,
          '\x41': 0xf743b0bb,
          '\x7d': 0x167d464f,
          '\x81\x51\x01': 0x281fba26,
          '\x81\x51\x02': 0x2a764faf,
          '\x81\x51\x03': 0x2baee328,
          '\x81\x51\x04': 0x2ea5a4bd,
          '\x81\x51\x05': 0x2f7d083a,
          '\x81\x51\x06': 0x2d14fdb3,
          '\x81\x51\x07': 0x2ccc5134,
          '\x81\x51\x08': 0x27027299,
          '\x81\x51\x09': 0x26dade1e,
          '\x81\x51\x0a': 0x24b32b97,
          '\x81\x31\x00': 0x48224ccb,
          '\x81\x31\x01': 0x49fae04c,
          '\x81\x31\x06': 0x4cf1a7d9,
          '\x81\x31\x07': 0x4d290b5e,
          '\x81\x60\x01': 0xcaf4d6cf
        };
        Object.keys(ATP_CRC_LOOKUP).forEach(key => {
            const expectedChecksum = ATP_CRC_LOOKUP[key];
            const buffer = new Buffer(key, 'binary');
            const calculatedChecksum = FreeStyleLibreProtocol.calcCrc32(buffer);
            expect(calculatedChecksum).equals(expectedChecksum);
          }
        );
      });
    });

    describe('validate text protocol checksum', () => {

      it('should accept valid checksums', () => {
        const inputData = [
          ['', 0],
          ['\x01\x02\x03\x04\x05', 15]
        ];
        inputData.forEach(([data, checksum]) => {
            const result = FreeStyleLibreProtocol.validateTextChecksum(data, checksum);
            expect(result).deep.equals(true);
          }
        );
      });

      it('should decline invalid checksums', () => {
        const inputData = [
          ['', 10],
          ['\x01\x02\x03\x04\x05', 0],
          ['', null],
          ['', undefined],
          ['', ''],
        ];
        inputData.forEach(([data, checksum]) => {
            const result = FreeStyleLibreProtocol.validateTextChecksum(data, checksum);
            expect(result).deep.equals(false);
          }
        );
      });
    });

  });
});
