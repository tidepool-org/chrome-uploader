/*
 * == BSD2 LICENSE ==
 * Copyright (c) 2021, Tidepool Project
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

export function cRC8(data) {
  const crc8Table = [
    0x00, 0x5e, 0xbc, 0xe2, 0x61, 0x3f, 0xdd, 0x83,
    0xc2, 0x9c, 0x7e, 0x20, 0xa3, 0xfd, 0x1f, 0x41,
    0x9d, 0xc3, 0x21, 0x7f, 0xfc, 0xa2, 0x40, 0x1e,
    0x5f, 0x01, 0xe3, 0xbd, 0x3e, 0x60, 0x82, 0xdc,
    0x23, 0x7d, 0x9f, 0xc1, 0x42, 0x1c, 0xfe, 0xa0,
    0xe1, 0xbf, 0x5d, 0x03, 0x80, 0xde, 0x3c, 0x62,
    0xbe, 0xe0, 0x02, 0x5c, 0xdf, 0x81, 0x63, 0x3d,
    0x7c, 0x22, 0xc0, 0x9e, 0x1d, 0x43, 0xa1, 0xff,
    0x46, 0x18, 0xfa, 0xa4, 0x27, 0x79, 0x9b, 0xc5,
    0x84, 0xda, 0x38, 0x66, 0xe5, 0xbb, 0x59, 0x07,
    0xdb, 0x85, 0x67, 0x39, 0xba, 0xe4, 0x06, 0x58,
    0x19, 0x47, 0xa5, 0xfb, 0x78, 0x26, 0xc4, 0x9a,
    0x65, 0x3b, 0xd9, 0x87, 0x04, 0x5a, 0xb8, 0xe6,
    0xa7, 0xf9, 0x1b, 0x45, 0xc6, 0x98, 0x7a, 0x24,
    0xf8, 0xa6, 0x44, 0x1a, 0x99, 0xc7, 0x25, 0x7b,
    0x3a, 0x64, 0x86, 0xd8, 0x5b, 0x05, 0xe7, 0xb9,
    0x8c, 0xd2, 0x30, 0x6e, 0xed, 0xb3, 0x51, 0x0f,
    0x4e, 0x10, 0xf2, 0xac, 0x2f, 0x71, 0x93, 0xcd,
    0x11, 0x4f, 0xad, 0xf3, 0x70, 0x2e, 0xcc, 0x92,
    0xd3, 0x8d, 0x6f, 0x31, 0xb2, 0xec, 0x0e, 0x50,
    0xaf, 0xf1, 0x13, 0x4d, 0xce, 0x90, 0x72, 0x2c,
    0x6d, 0x33, 0xd1, 0x8f, 0x0c, 0x52, 0xb0, 0xee,
    0x32, 0x6c, 0x8e, 0xd0, 0x53, 0x0d, 0xef, 0xb1,
    0xf0, 0xae, 0x4c, 0x12, 0x91, 0xcf, 0x2d, 0x73,
    0xca, 0x94, 0x76, 0x28, 0xab, 0xf5, 0x17, 0x49,
    0x08, 0x56, 0xb4, 0xea, 0x69, 0x37, 0xd5, 0x8b,
    0x57, 0x09, 0xeb, 0xb5, 0x36, 0x68, 0x8a, 0xd4,
    0x95, 0xcb, 0x29, 0x77, 0xf4, 0xaa, 0x48, 0x16,
    0xe9, 0xb7, 0x55, 0x0b, 0x88, 0xd6, 0x34, 0x6a,
    0x2b, 0x75, 0x97, 0xc9, 0x4a, 0x14, 0xf6, 0xa8,
    0x74, 0x2a, 0xc8, 0x96, 0x15, 0x4b, 0xa9, 0xf7,
    0xb6, 0xe8, 0x0a, 0x54, 0xd7, 0x89, 0x6b, 0x35,
  ];

  const bytes = new Uint8Array(data);
  let len = bytes.length;
  let checksum = 0x00;
  let i = 0;

  while (len) {
    len -= 1;
    // eslint-disable-next-line no-bitwise
    checksum = crc8Table[checksum ^ bytes[i]];
    i += 1;
  }

  return checksum;
}

export function concatArrayBuffer(buffer1, buffer2) {
  const u8Array1 = new Uint8Array(buffer1);
  const u8Array2 = new Uint8Array(buffer2);

  const length = u8Array1.length + u8Array2.length;
  const buffer = new ArrayBuffer(length);
  const u8Array = new Uint8Array(buffer);
  for (let i = 0; i < u8Array1.length; i++) {
    u8Array[i] = u8Array1[i];
  }
  for (let i = 0; i < u8Array2.length; i++) {
    u8Array[i + u8Array1.length] = u8Array2[i];
  }

  return buffer;
}

export function packFrame(buffer) {
  const u8aBuffer = new Uint8Array(buffer);

  let newBuffer = new ArrayBuffer(0);
  for (let i = 0; i < u8aBuffer.length; i++) {
    const byte = u8aBuffer[i];
    if (byte === 0x2F || byte === 0x2B) {
      newBuffer = concatArrayBuffer(newBuffer, new Uint8Array([0x2F]).buffer);
    }
    newBuffer = concatArrayBuffer(newBuffer, new Uint8Array([byte]).buffer);
  }

  newBuffer = concatArrayBuffer(new Uint8Array([0x2B, 0x2B]).buffer, newBuffer);
  newBuffer = concatArrayBuffer(newBuffer, new Uint8Array([0x2B, 0x2B]).buffer);

  return newBuffer;
}

export function unpackFrame(buffer) {
  const u8aBuffer = new Uint8Array(buffer.slice(2, buffer.byteLength - 2));

  let newBuffer = new ArrayBuffer(0);
  for (let i = 0; i < u8aBuffer.length; i++) {
    const byte = u8aBuffer[i];
    if (byte === 0x2F) {
      if (i + 1 >= u8aBuffer.length) {
        //  不符合规则,最后一个2F不能单独出现
        // does not meet the requirements, the final 0x2F cannot appear alone
        return new ArrayBuffer(0);
      }

      const nextByte = u8aBuffer[i + 1];
      if (nextByte !== 0x2F && nextByte !== 0x2B) {
        //  不符合规则
        // does not meet the requirements
        return new ArrayBuffer(0);
      }
      newBuffer = concatArrayBuffer(newBuffer, new Uint8Array([nextByte]).buffer);
      i += 1; //  NextByte已处理，直接跳过
    } else {
      newBuffer = concatArrayBuffer(newBuffer, new Uint8Array([byte]).buffer);
    }
  }

  return newBuffer;
}

export function uint8ArrayToString(fileData) {
  let dataString = '';
  for (let i = 0; i < fileData.length; i++) {
    dataString += String.fromCharCode(fileData[i]);
  }

  return dataString;
}

export function uintFromArrayBuffer(orginBuffer, littleEndian) {
  let buffer = orginBuffer;
  if (Object.prototype.toString.call(orginBuffer) === '[object Uint8Array]') {
    const tmp = new Uint8Array(orginBuffer);
    buffer = tmp.buffer;
  }

  if (buffer.byteLength > 4) {
    return 0;
  }
  const dv = new DataView(buffer);
  if (buffer.byteLength === 4) {
    return dv.getUint32(0, littleEndian);
  }
  if (buffer.byteLength === 2) {
    return dv.getUint16(0, littleEndian);
  }
  if (buffer.byteLength === 1) {
    return dv.getUint8(0);
  }
  return 0;
}

export function arrayBufferFromUint(i, byteLength, littleEndian) {
  if (byteLength > 4) {
    return new ArrayBuffer(0);
  }
  const buffer = new ArrayBuffer(byteLength);
  const dv = new DataView(buffer);

  if (byteLength === 4) {
    dv.setUint32(0, i, littleEndian);
  }
  if (byteLength === 2) {
    dv.setUint16(0, i, littleEndian);
  }
  if (byteLength === 1) {
    dv.setUint8(0, i);
  }
  return buffer;
}

export function formatString(inString) {
  const outString = inString.toString().trim();
  return outString;
}
