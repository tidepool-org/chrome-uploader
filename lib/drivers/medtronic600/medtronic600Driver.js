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

// I *like* for..in
/* eslint no-restricted-syntax: [0, "ForInStatement"] */
const _ = require('lodash');
const sundial = require('sundial');
const crypto = require('crypto');
const iconv = require('iconv-lite');
const { promisify } = require('util');
const ExtendableError = require('es6-error');
const uploadDataPeriod = require('../../../app/utils/uploadDataPeriod');
const crcCalculator = require('../../crc.js');
const lzo = require('lzo-decompress');
const common = require('../../commonFunctions');
const NGPUtil = require('./NGPUtil');
const NGPHistoryParser = require('./NGPHistoryParser');
const Medtronic600Simulator = require('./medtronic600Simulator');

const isBrowser = typeof window !== 'undefined';
// eslint-disable-next-line no-console
const debug = isBrowser ? require('bows')('Medtronic600Driver') : console.log;

class TimeoutError extends ExtendableError {}

class InvalidMessageError extends ExtendableError {}

class InvalidStateError extends ExtendableError {}

class ChecksumError extends ExtendableError {
  constructor(expectedChecksum, calculatedChecksum, message = 'Message checksums do not match') {
    super(`${message}: Expected ${expectedChecksum}, but calculated ${calculatedChecksum}`);
  }
}

class RetryError extends ExtendableError {}

class Timer {
  static wait(delay) {
    return new Promise(resolve => setTimeout(resolve, delay));
  }

  static timeout(delay) {
    return new Promise((resolve, reject) => setTimeout(reject, delay, new TimeoutError('Timer timeout.')));
  }
}

class BCNLMessage {
  constructor(bytes, responseType) {
    if (new.target === BCNLMessage) {
      throw new TypeError(`Cannot construct ${new.target.name} instances directly`);
    }

    this.payload = Buffer.from(bytes);
    this.responseType = responseType;
  }

  static get USB_BLOCKSIZE() {
    return 64;
  }
  static get HEADER_SIZE() {
    return 4;
  }
  static get MAGIC_HEADER() {
    return 'ABC';
  }
  // TODO: should this be in BCNLCommand? Would require quite a large refactor to change
  static get READ_TIMEOUT_MS() {
    return 4000;
  }

  static get ASCII_CONTROL() {
    return {
      ACK: 0x06,
      CR: 0x0D,
      ENQ: 0x05,
      EOT: 0x04,
      ETB: 0x17,
      ETX: 0x03,
      LF: 0x0A,
      NAK: 0x15,
      STX: 0x02,
    };
  }

  // eslint-disable-next-line class-methods-use-this
  async readMessage(hidDevice, readTimeout = BCNLMessage.READ_TIMEOUT_MS) {
    let message = Buffer.alloc(0);
    let size = 0;
    let packet;

    do {
      try {
        // eslint-disable-next-line no-await-in-loop, requests to devices are sequential
        const rawData = await hidDevice.receiveTimeout(readTimeout);
        packet = Buffer.from(new Uint8Array(rawData));
      } catch (err) {
        if (err instanceof TimeoutError) {
          packet = Buffer.alloc(0);
        } else {
          throw err;
        }
      }

      // Only process if we get data
      if (packet.length > 0) {
        const header = packet.slice(0, 3).toString('ascii');
        // eslint-disable-next-line prefer-destructuring
        size = packet[3];

        if (header !== BCNLMessage.MAGIC_HEADER) {
          debug('Invalid packet from Contour device');
          throw new InvalidMessageError('Unexpected USB packet header.');
        }

        message = Buffer.concat(
          [message, packet.slice(BCNLMessage.HEADER_SIZE)],
          message.length + size,
        );
      }
      // USB_BLOCKSIZE - HEADER_SIZE, because we don't include the MAGIC_HEADER or the size byte
    } while (size === (BCNLMessage.USB_BLOCKSIZE - BCNLMessage.HEADER_SIZE) && packet.length !== 0);

    // Expected to get message data, but got nothing.
    if (message.length === 0) {
      throw new TimeoutError('Timed out waiting for message.');
    }

    debug('### READ USB DATA', message.toString('hex'));
    return message;
  }

  async sendMessage(hidDevice) {
    let pos = 0;
    const message = this.payload;

    while (pos < message.length) {
      const bytes = Buffer.alloc(BCNLMessage.USB_BLOCKSIZE);
      const sendLength = (pos + 60 > message.length) ? message.length - pos : 60;
      bytes.write(BCNLMessage.MAGIC_HEADER, 0);
      bytes.writeUInt8(sendLength, 3);
      bytes.write(message.slice(pos, pos + sendLength).toString('binary'), 4, 'binary');
      debug('### SENDING USB DATA', bytes.toString('hex'));

      const hidSend = promisify(hidDevice.send);
      // eslint-disable-next-line no-await-in-loop, requests to devices are sequential
      await hidSend(bytes.buffer.slice());
      pos += sendLength;
    }
  }

  async send(hidDevice, readTimeout = BCNLMessage.READ_TIMEOUT_MS) {
    const ResponseClass = this.responseType;
    // Timeout might be zero, but the callback will fire anyway
    await this.sendMessage(hidDevice);
    const response = await this.readMessage(hidDevice, readTimeout);
    return new ResponseClass(response);
  }
}

class BCNLCommandResponse extends BCNLMessage {
  checkAsciiControl(expect = BCNLMessage.ASCII_CONTROL.ACK) {
    if (this.payload[0] !== expect) {
      throw new Error(`Unexpected ASCII control message. Expected ${expect}. Got ${this.payload[0]}`);
    }
  }
}

class BCNLCommand extends BCNLMessage {
  constructor(command) {
    if (typeof command === 'number') {
      // For the ASCII control messages
      super(Buffer.from([command]), BCNLCommandResponse);
    } else {
      // For regular strings
      super(Buffer.from(command, 'ascii'), BCNLCommandResponse);
    }
  }
}

class DeviceInfoRequestResponse extends BCNLMessage {
  getModelAndSerial() {
    const serialMatch = /\d{4}-\d{7}/.exec(this.payload);
    return serialMatch.length === 1 ? serialMatch[0] : undefined;
  }

  getSerialNumber() {
    const serialMatch = /\^(\w{2}\d{7}\w)\|/.exec(this.payload);
    return serialMatch.length === 2 ? serialMatch[1] : undefined;
  }
}

class DeviceInfoRequestCommand extends BCNLCommand {
  constructor() {
    super('X');
  }

  // Override send(), because we do a 'double read' after sending the request
  async send(hidDevice, readTimeout = BCNLMessage.READ_TIMEOUT_MS) {
    // Timeout might be zero, but the callback will fire anyway
    // We use sendMessage instead of super.send() because we want to pull raw
    // data only, and we can't determine response types until after we've checked
    // them. The CNL can send the messages in different orders.
    await this.sendMessage(hidDevice);
    const response1 = await this.readMessage(hidDevice, readTimeout);
    const response2 = await this.readMessage(hidDevice, readTimeout);

    let astmInfo = '';

    if (response1[0] === BCNLMessage.ASCII_CONTROL.EOT) {
      astmInfo = Buffer.from(response1).toString('ascii');
      new BCNLCommandResponse(response2).checkAsciiControl(BCNLMessage.ASCII_CONTROL.ENQ);
    } else {
      astmInfo = Buffer.from(response2).toString('ascii');
      new BCNLCommandResponse(response1).checkAsciiControl(BCNLMessage.ASCII_CONTROL.ENQ);
    }
    return new DeviceInfoRequestResponse(astmInfo);
  }
}

class MinimedPumpSession {
  constructor(cnlInfo) {
    this.envelopeSequenceNumber = 0;
    this.ngpSequenceNumber = 0;
    this.comDSequenceNumber = 0;
    this.bcnlModelAndSerial = cnlInfo.getModelAndSerial();
    this.bcnlFullSerial = cnlInfo.getSerialNumber();
    this.radioChannel = null;
    this.linkMAC = null;
    this.pumpMAC = null;
    this.isAssociated = null;
    this.key = null;
    this.pumpModel = null;
    this.pumpSerial = null;
  }

  get bcnlSerialNumber() {
    return _.replace(this.bcnlModelAndSerial, /\d+-/, '');
  }

  get iv() {
    const iv = Buffer.from(this.key);
    iv[0] = this.radioChannel;

    return iv;
  }

  get packedLinkMAC() {
    return Buffer.from(this.linkMAC, 'hex').swap64().toString('binary');
  }

  get packedPumpMAC() {
    return Buffer.from(this.pumpMAC, 'hex').swap64().toString('binary');
  }

  getHMAC() {
    const paddingKey = 'A4BD6CED9A42602564F413123';
    const digest = crypto.createHash('sha256')
      .update(`${this.bcnlSerialNumber}${paddingKey}`)
      .digest()
      .reverse();
    return digest;
  }

  // TODO: (for a refactor), should the sequence incrementing
  // be done as an event listener on an EventEmitter in a send() command?
  incEnvelopeSequenceNumber() {
    this.envelopeSequenceNumber += 1;
    if (this.envelopeSequenceNumber >= 255) {
      this.envelopeSequenceNumber = 1;
    }

    return this.envelopeSequenceNumber;
  }

  incNgpSequenceNumber() {
    this.ngpSequenceNumber += 1;
    if (this.ngpSequenceNumber >= 127) {
      this.ngpSequenceNumber = 1;
    }

    return this.ngpSequenceNumber;
  }

  incComDSequenceNumber() {
    this.comDSequenceNumber += 1;
    if (this.comDSequenceNumber >= 127) {
      this.comDSequenceNumber = 1;
    }

    return this.comDSequenceNumber;
  }
}

class MinimedMessage extends BCNLMessage {
  static get COMMAND_TYPE() {
    return {
      OPEN_CONNECTION: 0x10,
      CLOSE_CONNECTION: 0x11,
      SEND_MESSAGE: 0x12,
      READ_INFO: 0x14,
      REQUEST_LINK_KEY: 0x16,
      SEND_LINK_KEY: 0x17,
      RECEIVE_MESSAGE: 0x80,
      SEND_MESSAGE_RESPONSE: 0x81,
      REQUEST_LINK_KEY_RESPONSE: 0x86,
    };
  }

  static get ENVELOPE_SIZE() {
    return 33;
  }

  static get MINIMED_HEADER() {
    return 0x5103; // Q\x03
  }

  static oneByteChecksum(buffer) {
    // eslint-disable-next-line no-bitwise
    return _.reduce(buffer, (a, b) => a + b, 0) & 0xff;
  }

  get commandType() {
    return this.payload[0x12];
  }
}

class MinimedResponse extends MinimedMessage {
  constructor(payload) {
    super(payload);

    if (this.payload.length < MinimedMessage.ENVELOPE_SIZE) {
      debug(`Invalid MiniMed message: ${this.payload.toString('hex')}`);
      throw new InvalidMessageError('Invalid MiniMed message. Expected more data.');
    }

    if (this.payload.readUInt16BE(0x00) !== MinimedMessage.MINIMED_HEADER) {
      throw new InvalidMessageError('Unexpected MiniMed packet header.');
    }

    const minimedPayloadSize = this.payload.readUInt16LE(0x1C);
    const expectedPayloadSize = MinimedMessage.ENVELOPE_SIZE + minimedPayloadSize;
    if (this.payload.length !== expectedPayloadSize) {
      throw new InvalidMessageError(`Invalid message size. Expected ${expectedPayloadSize}, got ${this.payload.length}`);
    }

    // Check the payload's checksums
    const expectedChecksum = this.payload[0x20];
    const calculatedChecksum =
      // eslint-disable-next-line no-bitwise
      (MinimedMessage.oneByteChecksum(this.payload) - expectedChecksum) & 0xFF;

    if (expectedChecksum !== calculatedChecksum) {
      throw new ChecksumError(expectedChecksum, calculatedChecksum);
    }
  }
}

class MinimedRequest extends MinimedMessage {
  constructor(commandType, pumpSession, payload, responseType = MinimedResponse) {
    if (new.target === MinimedRequest) {
      throw new TypeError(`Cannot construct ${new.target.name} instances directly`);
    }

    super(MinimedRequest.buildPayload(commandType, pumpSession, payload), responseType);
    this.pumpSession = pumpSession;
  }

  static buildPayload(commandType, pumpSession, payload) {
    const payloadLength = (payload === null) ? 0 : payload.length;
    const payloadBuffer = Buffer.alloc(MinimedMessage.ENVELOPE_SIZE + payloadLength);

    /* eslint-disable lodash/prefer-lodash-method */
    payloadBuffer.writeUInt16BE(MinimedMessage.MINIMED_HEADER, 0); // Q\x03
    payloadBuffer.write('000000', 2); // Pump serial. '000000' for 600-series
    payloadBuffer.fill(0, 8, 18); // Unknown bytes (hardcoded)
    payloadBuffer.writeUInt8(commandType, 18);
    payloadBuffer.writeUInt32LE(pumpSession.incEnvelopeSequenceNumber(), 19);
    payloadBuffer.fill(0, 23, 28); // Unknown bytes (hardcoded)
    payloadBuffer.writeUInt16LE(payloadLength, 28);
    payloadBuffer.fill(0, 30, 32); // Unknown bytes (hardcoded)
    payloadBuffer.writeUInt8(0, 32); // Placeholder for the single byte checksum
    /* eslint-enable lodash/prefer-lodash-method */
    if (payloadLength > 0) {
      payloadBuffer.write(Buffer.from(payload).toString('binary'), 33, 'binary');
    }

    // Now that we have written the message, calculate the CRC
    const checksum = MinimedMessage.oneByteChecksum(payloadBuffer);
    payloadBuffer.writeUInt8(checksum, 32);
    return payloadBuffer;
  }
}

class NGPMessage extends MinimedMessage {
  static get COMMAND_TYPE() {
    return {
      INITIALIZE: 0x01,
      SCAN_NETWORK: 0x02,
      JOIN_NETWORK: 0x03,
      LEAVE_NETWORK: 0x04,
      TRANSMIT_PACKET: 0x05,
      READ_DATA: 0x06,
      READ_STATUS: 0x07,
      READ_NETWORK_STATUS: 0x08,
      SET_SECURITY_MODE: 0x0c,
      READ_STATISTICS: 0x0d,
      SET_RF_MODE: 0x0e,
      CLEAR_STATUS: 0x10,
      SET_LINK_KEY: 0x14,
      COMMAND_RESPONSE: 0x55, // 'U'
    };
  }

  static get ENVELOPE_SIZE() {
    return 2;
  }

  static get CHECKSUM_SIZE() {
    return 2;
  }

  static ccittChecksum(buffer, length) {
    return crcCalculator.calcCRC_A(buffer, length);
  }
}

class NGPResponse extends MinimedResponse {
  constructor(payload, pumpSession) {
    super(payload);
    this.pumpSession = pumpSession;

    if (this.payload[MinimedMessage.ENVELOPE_SIZE] !==
      NGPMessage.COMMAND_TYPE.COMMAND_RESPONSE) {
      throw new InvalidMessageError('Unexpected NGP packet header.');
    }

    const ngpPayloadSize = this.payload[0x22];
    // Check the payload's checksums
    const ngpPayload =
      Buffer.from(this.payload.slice(MinimedMessage.ENVELOPE_SIZE, MinimedMessage.ENVELOPE_SIZE +
        ngpPayloadSize + NGPMessage.CHECKSUM_SIZE));
    const expectedChecksum = ngpPayload.readUInt16LE(ngpPayload.length - 2);
    const calculatedChecksum =
      NGPMessage.ccittChecksum(ngpPayload, ngpPayload.length - 2);

    if (expectedChecksum !== calculatedChecksum) {
      throw new ChecksumError(expectedChecksum, calculatedChecksum);
    }
  }
}

class NGPRequest extends NGPMessage {
  constructor(commandType, pumpSession, payload, responseType = NGPResponse) {
    if (new.target === NGPRequest) {
      throw new TypeError(`Cannot construct ${new.target.name} instances directly`);
    }

    super(NGPRequest.buildPayload(commandType, pumpSession, payload), responseType);
    this.pumpSession = pumpSession;
    this.ngpRetries = 0;
    this.maxRetries = NGPRequest.DEFAULT_MAX_RETRIES;
  }

  setMaxRetries(maxRetries) {
    this.maxRetries = maxRetries;
    return this;
  }

  static get READ_TIMEOUT_MS() {
    return 2000; // Timeout for a NGPMessage is different than for Bayer
  }

  static get DEFAULT_MAX_RETRIES() {
    return 5;
  }

  static buildPayload(commandType, pumpSession, payload) {
    const payloadLength = (payload === null) ? 0 : payload.length;
    // eslint-disable-next-line function-paren-newline
    const payloadBuffer = Buffer.alloc(
      NGPMessage.ENVELOPE_SIZE + payloadLength + NGPMessage.CHECKSUM_SIZE);

    payloadBuffer.writeUInt8(commandType, 0);
    payloadBuffer.writeUInt8(NGPMessage.ENVELOPE_SIZE + payloadLength, 1);
    if (payloadLength > 0) {
      payloadBuffer.write(Buffer.from(payload).toString('binary'), 2, 'binary');
    }

    // Now that we have written the message, calculate the CRC
    const messageSize = payloadBuffer.length - 2;
    const checksum = NGPMessage.ccittChecksum(payloadBuffer, messageSize);
    payloadBuffer.writeUInt16LE(checksum, messageSize);

    return MinimedRequest.buildPayload(
      MinimedRequest.COMMAND_TYPE.SEND_MESSAGE,
      pumpSession, payloadBuffer,
    );
  }

  // Override send(), because we do an 'optional double read' after sending the request
  async send(hidDevice, readTimeout = NGPRequest.READ_TIMEOUT_MS, get80response = true) {
    await this.sendMessage(hidDevice);

    const ResponseClass = this.responseType;
    let receiveMessageResponse = null;

    do {
      // eslint-disable-next-line no-await-in-loop, these requests need to be sequential
      receiveMessageResponse = await this.readMessage(hidDevice, readTimeout);
    } while (get80response &&
      receiveMessageResponse[0x12] !== MinimedMessage.COMMAND_TYPE.RECEIVE_MESSAGE);

    let responseMessage = null;

    // TODO: should ResponseClass be determined by a factory that reads the commandType?
    // If so, we can get rid of this `if`
    if (receiveMessageResponse[0x12] === MinimedMessage.COMMAND_TYPE.RECEIVE_MESSAGE) {
      responseMessage = new ResponseClass(receiveMessageResponse, this.pumpSession);
    }

    return responseMessage;
  }
}

// TODO: See if we have already joined a network, so that we don't need to JOIN_NETWORK again.
class OpenConnectionResponse extends MinimedResponse {}

class OpenConnectionRequest extends MinimedRequest {
  constructor(pumpSession) {
    super(
      MinimedMessage.COMMAND_TYPE.OPEN_CONNECTION, pumpSession, pumpSession.getHMAC(),
      OpenConnectionResponse,
    );
  }
}

class CloseConnectionResponse extends MinimedResponse {}

class CloseConnectionRequest extends MinimedRequest {
  constructor(pumpSession) {
    super(
      MinimedMessage.COMMAND_TYPE.CLOSE_CONNECTION, pumpSession, pumpSession.getHMAC(),
      CloseConnectionResponse,
    );
  }
}

class ReadInfoResponse extends MinimedResponse {
  // Link MAC and Pump MAC are packed as a 64-bit integers, but JavaScript doesn't support those,
  // so we'll store them as a hex strings.
  get linkMAC() {
    const offset = MinimedMessage.ENVELOPE_SIZE + 0x00;
    return this.payload.slice(offset, offset + 8).toString('hex');
  }

  get pumpMAC() {
    const offset = MinimedMessage.ENVELOPE_SIZE + 0x08;
    return this.payload.slice(offset, offset + 8).toString('hex');
  }

  // The number of times this link/pump combination has been paired
  get linkCounter() {
    return this.payload.readUInt16LE(MinimedMessage.ENVELOPE_SIZE + 0x10);
  }

  get encryptionMode() {
    // eslint-disable-next-line no-bitwise
    return this.payload[MinimedMessage.ENVELOPE_SIZE + 0x12] & 1;
  }

  get isAssociated() {
    return this.pumpMAC !== '0000000000000000';
  }
}

class ReadInfoRequest extends MinimedRequest {
  constructor(pumpSession) {
    super(MinimedMessage.COMMAND_TYPE.READ_INFO, pumpSession, null, ReadInfoResponse);
  }
}

class RequestLinkKeyResponse extends MinimedResponse {
  get packedLinkKey() {
    return this.payload.slice(MinimedMessage.ENVELOPE_SIZE, MinimedMessage.ENVELOPE_SIZE + 55);
  }

  linkKey(cnlModelAndSerial) {
    return NGPUtil.NGPLinkCipher.unpackLinkKey(this.packedLinkKey, cnlModelAndSerial);
  }
}

class RequestLinkKeyRequest extends MinimedRequest {
  constructor(pumpSession) {
    super(MinimedMessage.COMMAND_TYPE.REQUEST_LINK_KEY, pumpSession, null, RequestLinkKeyResponse);
  }
}

class SendLinkKeyResponse extends MinimedResponse {}

class SendLinkKeyRequest extends MinimedRequest {
  constructor(pumpSession, linkKey) {
    super(
      MinimedMessage.COMMAND_TYPE.SEND_LINK_KEY, pumpSession, linkKey,
      SendLinkKeyResponse,
    );
  }
}
class JoinNetworkResponse extends NGPResponse {
  static get INVALID_CHANNEL() {
    return 0x20;
  }

  static get VALID_CHANNEL_COORDINATOR_ACTIVE() {
    return 0x82;
  }
  static get VALID_CHANNEL_ENDNODE_ACTIVE() {
    return 0x42;
  }

  get radioChannel() {
    if (this.payload.length > 46 &&
      this.payload[0x33] === JoinNetworkResponse.VALID_CHANNEL_COORDINATOR_ACTIVE &&
      this.payload[0x44] === JoinNetworkResponse.VALID_CHANNEL_ENDNODE_ACTIVE) {
      return this.payload[0x4c];
    }

    return 0;
  }

  get joinedNetwork() {
    return this.radioChannel !== 0;
  }
}

class JoinNetworkRequest extends NGPRequest {
  static get READ_TIMEOUT_MS() {
    return 10000;
  }

  constructor(pumpSession) {
    const payloadBuffer = Buffer.alloc(26);

    /* eslint-disable lodash/prefer-lodash-method */
    // The ngpSequenceNumber stays 1 for this message...
    payloadBuffer.writeUInt8(1, 0x00);
    // ... but we increment it for future messages.
    pumpSession.incNgpSequenceNumber();
    payloadBuffer.writeUInt8(pumpSession.radioChannel, 0x01);
    payloadBuffer.fill(0x00, 0x02, 0x05); // Unknown bytes (hardcoded)
    payloadBuffer.fill(0x07, 0x05, 0x07); // Unknown bytes (hardcoded)
    payloadBuffer.fill(0x00, 0x07, 0x09); // Unknown bytes (hardcoded)
    payloadBuffer.writeUInt8(0x02, 0x09); // Unknown bytes (hardcoded)
    payloadBuffer.write(pumpSession.packedLinkMAC, 0xA, 8, 'binary');
    payloadBuffer.write(pumpSession.packedPumpMAC, 0x12, 8, 'binary');
    /* eslint-enable lodash/prefer-lodash-method */

    super(NGPMessage.COMMAND_TYPE.JOIN_NETWORK, pumpSession, payloadBuffer, JoinNetworkResponse);
  }

  // Override send(), longer read timeout required
  send(hidDevice, readTimeout = JoinNetworkRequest.READ_TIMEOUT_MS, get80response = true) {
    return super.send(hidDevice, readTimeout, get80response);
  }
}

class LeaveNetworkRequest extends NGPRequest {
  constructor(pumpSession) {
    const payloadBuffer = Buffer.alloc(1);

    payloadBuffer.writeUInt8(0, 0x00);

    super(NGPMessage.COMMAND_TYPE.LEAVE_NETWORK, pumpSession, payloadBuffer);
  }
}

class SetRfMode extends NGPRequest {
  // eslint-disable-next-line no-use-before-define
  constructor(pumpSession, highSpeedMode = HighSpeedModeCommand.HIGH_SPEED_MODE.DISABLE) {
    const payloadBuffer = Buffer.alloc(9);
    payloadBuffer.writeUInt8(highSpeedMode, 0x00);

    super(NGPMessage.COMMAND_TYPE.SET_RF_MODE, pumpSession, payloadBuffer);
  }
}

class TransmitPacketResponse extends NGPResponse {
  constructor(payload, pumpSession) {
    super(payload, pumpSession);

    // Decrypt response and write it to another member
    // TODO: These aren't necessarily bad messages. It looks like some of them
    // could just be pings when the pump is busy processing data.
    const payloadLength =
      MinimedMessage.ENVELOPE_SIZE + this.payload[0x22] + NGPMessage.CHECKSUM_SIZE;
    if (payloadLength < 57) {
      debug('*** BAD ComD Message', this.payload.toString('hex'));
      throw new InvalidMessageError('Received invalid ComD message.');
    }

    const encryptedPayloadSize = this.payload[0x38];
    const encryptedPayload = Buffer.from(this.payload.slice(0x39, 0x39 + encryptedPayloadSize));
    const decryptedPayload =
      NGPUtil.NGPLinkCipher.decrypt(pumpSession.key, pumpSession.iv, encryptedPayload);
    debug('### DECRYPTED PAYLOAD', decryptedPayload.toString('hex'));

    // Check the decrypted payload's checksums
    const expectedChecksum = decryptedPayload.readUInt16BE(decryptedPayload.length - 2);
    const calculatedChecksum =
      NGPMessage.ccittChecksum(decryptedPayload, decryptedPayload.length - 2);

    if (expectedChecksum !== calculatedChecksum) {
      throw new ChecksumError(expectedChecksum, calculatedChecksum);
    }

    // The CCITT checksum does not form part of the comDPayload
    this.comDPayload = decryptedPayload.slice(0, -2);
  }

  get comDCommand() {
    return this.comDPayload.readUInt16BE(0x01);
  }

  get sequenceNumber() {
    return this.comDPayload[0x00];
  }
}

class MultipacketSession {
  constructor(payload) {
    // eslint-disable-next-line prefer-destructuring
    this.comDSequenceNumber = payload[0x00];
    this.sessionSize = payload.readUInt32BE(0x03);
    this.packetSize = payload.readUInt16BE(0x07);
    this.lastPacketSize = payload.readUInt16BE(0x09);
    this.packetsToFetch = payload.readUInt16BE(0x0B);
    debug(`*** Starting a new Multipacket Session. Expecting ${this.sessionSize} bytes of data from ${this.packetsToFetch} packets`);
    // Prepopulate the segments array with empty objects so we can check for missing segments later.
    this.segments = _.fill(Array(this.packetsToFetch), undefined);
  }

  get lastPacketNumber() {
    return this.packetsToFetch - 1;
  }

  // The number of segments we've actually fetched.
  get segmentsFilled() {
    return _.filter(this.segments, value => value !== undefined).length;
  }

  // Returns an array of tuples, with the first element of the tuple being the starting packet,
  // and the second element of the tuple being the number of packets from the starting packet.
  get missingSegments() {
    let missingIndex = -1;
    let processingMissingSegment = false;

    return _.reduce(this.segments, (result, item, index) => {
      if (item === undefined) {
        if (processingMissingSegment === false) {
          result.push({ index, count: 1 });
          processingMissingSegment = true;
          missingIndex += 1;
        } else {
          result[missingIndex].count += 1;
        }
      } else {
        processingMissingSegment = false;
      }
      return result;
    }, []);
  }

  get sessionPayload() {
    const sequenceBuffer = Buffer.from([this.comDSequenceNumber]);
    return Buffer.concat([sequenceBuffer, Buffer.concat(this.segments, this.SessionSize)]);
  }

  addSegment(segment) {
    debug(`*** Got a Multipacket Segment: ${segment.packetNumber + 1} of ${this.packetsToFetch}, count: ${this.segmentsFilled + 1}`);
    if (this.packetsToFetch === this.segmentsFilled) {
      debug('Segments already filled. Should not be getting duplicates.');
    }

    if (segment.segmentPayload != null) {
      // multiByteSegments don't always come back in a consecutive order.
      this.segments[segment.packetNumber] = segment.segmentPayload;

      if (segment.packetNumber === this.lastPacketNumber &&
        segment.segmentPayload.length !== this.lastPacketSize) {
        throw new InvalidMessageError('Multipacket Transfer last packet size mismatch');
      } else if (segment.packetNumber !== this.lastPacketNumber &&
        segment.segmentPayload.length !== this.packetSize) {
        throw new InvalidMessageError('Multipacket Transfer packet size mismatch');
      }
    }

    if (this.payloadComplete()) {
      // sessionPayload includes a 1 byte header of the sequence number
      if (this.sessionPayload.length !== this.sessionSize + 1) {
        throw new InvalidMessageError('Total segment size mismatch');
      }
    }
  }

  payloadComplete() {
    return this.segmentsFilled === this.packetsToFetch;
  }

  retransmitNeeded() {
    return this.segmentsFilled > 0 && !this.payloadComplete();
  }
}

class TransmitPacketRequest extends NGPRequest {
  static get ENVELOPE_SIZE() {
    return 11;
  }

  static get COMDCOMMAND_SIZE() {
    return 5;
  }

  static get SEND_DELAY_MS() {
    // Determined from CareLink Personal packet captures
    return 300;
  }

  static get RETRIES() {
    return 10;
  }


  // TODO: Maybe we should make a response message factory, and check we have the correct
  // response in the Response constructors. We'll need to use lodash to find keys for values:
  // https://lodash.com/docs/4.17.4#findKey
  static get COM_D_COMMAND() {
    return {
      READ_PUMP_STATUS_REQUEST: 0x0112,
      READ_PRESET_BOLUSES_REQUEST: 0x0114,
      READ_PRESET_TEMP_BASALS_REQUEST: 0x0115,
      READ_BASAL_PATTERN_REQUEST: 0x0116,
      READ_PRESET_BOLUSES_RESPONSE: 0x0121,
      READ_PRESET_TEMP_BASALS_RESPONSE: 0x0122,
      READ_BASAL_PATTERN_RESPONSE: 0x0123,
      READ_BOLUS_WIZARD_CARB_RATIOS_REQUEST: 0x012B,
      READ_BOLUS_WIZARD_CARB_RATIOS_RESPONSE: 0x012C,
      READ_BOLUS_WIZARD_SENSITIVITY_FACTORS_REQUEST: 0x012E,
      READ_BOLUS_WIZARD_SENSITIVITY_FACTORS_RESPONSE: 0x012F,
      READ_BOLUS_WIZARD_BG_TARGETS_REQUEST: 0x0131,
      READ_BOLUS_WIZARD_BG_TARGETS_RESPONSE: 0x0132,
      READ_TIMED_NOTIFICATIONS_REQUEST: 0x0134,
      READ_TIMED_NOTIFICATIONS_RESPONSE: 0x0135,
      READ_BASIC_NGP_PARAMETERS_REQUEST: 0x0138,
      READ_BASIC_NGP_PARAMETERS_RESPONSE: 0x0139,
      DEVICE_STRING_REQUEST: 0x013A,
      DEVICE_STRING_RESPONSE: 0x013B,
      READ_PUMP_STATUS_RESPONSE: 0x013C,
      DEVICE_CHARACTERISTICS_REQUEST: 0x0200,
      DEVICE_CHARACTERISTICS_RESPONSE: 0x0201,
      READ_GLUCOSE_SENSOR_SETTINGS_REQUEST: 0x020B,
      READ_GLUCOSE_SENSOR_SETTINGS_RESPONSE: 0x020C,
      READ_LOW_GLUCOSE_SENSOR_SETTINGS_REQUEST: 0x0211,
      READ_LOW_GLUCOSE_SENSOR_SETTINGS_RESPONSE: 0x0212,
      READ_HIGH_GLUCOSE_SENSOR_SETTINGS_REQUEST: 0x0215,
      READ_HIGH_GLUCOSE_SENSOR_SETTINGS_RESPONSE: 0x0216,
      READ_HISTORY_REQUEST: 0x0304,
      READ_HISTORY_RESPONSE: 0x0305,
      END_HISTORY_TRANSMISSION: 0x030A,
      READ_HISTORY_INFO_REQUEST: 0x030C,
      READ_HISTORY_INFO_RESPONSE: 0x030D,
      UNMERGED_HISTORY_RESPONSE: 0x030E,
      TIME_REQUEST: 0x0403,
      FORCE_TIME_CHANGE_REQUEST: 0x0404,
      TIME_SYNC_DONE_RESPONSE: 0x0405,
      TIME_RESPONSE: 0x0407,
      AD_HOC_PAIRING_FAILED_RESPONSE: 0x040A,
      END_NODE_DEVICE_INITIALIZATION_RESPONSE: 0x040D,
      DEVICE_COMPATIBILITY_RESPONSE: 0x0411,
      HIGH_SPEED_MODE: 0x0412,
      END_COORDINATOR_DEVICE_INITIALIZATION: 0x0415,
      END_NODE_ASSOCIATION_CONFIRM_RESPONSE: 0x422,
      SET_LINK_KEY: 0x0425,
      INITIATE_MULTIPACKET_TRANSFER: 0xFF00,
      MULTIPACKET_SEGMENT_TRANSMISSION: 0xFF01,
      MULTIPACKET_RESEND_PACKETS: 0xFF02,
      ACK: 0x00FE,
      NAK: 0x00FF,
    };
  }

  static get NAK_CODE() {
    return {
      NO_ERROR: 0x00,
      PAUSE_IS_REQUESTED: 0x02,
      SELF_TEST_HAS_FAILED: 0x03,
      MESSAGE_WAS_REFUSED: 0x04,
      TIMEOUT_ERROR: 0x05,
      ELEMENT_VERSION_IS_NOT_CORRECT: 0x06,
      DEVICE_HAS_ERROR: 0x07,
      MESSAGE_IS_NOT_SUPPORTED: 0x08, // CLP says 0x0B :\
      DATA_IS_OUT_OF_RANGE: 0x09,
      DATA_IS_NOT_CONSISTENT: 0x0A,
      FEATURE_IS_DISABLED: 0x0B, // CLP says 0x0B here, too
      DEVICE_IS_BUSY: 0x0C,
      DATA_DOES_NOT_EXIST: 0x0D,
      HARDWARE_FAILURE: 0x0E,
      DEVICE_IS_IN_WRONG_STATE: 0x0F,
      DATA_IS_LOCKED_BY_ANOTHER: 0x10,
      DATA_IS_NOT_LOCKED: 0x11,
      CANNULA_FILL_CANNOT_BE_PERFORMED: 0x12,
      DEVICE_IS_DISCONNECTED: 0x13,
      EASY_BOLUS_IS_ACTIVE: 0x14,
      PARAMETERS_ARE_NOT_AVAILABLE: 0x15,
      MESSAGE_IS_OUT_OF_SEQUENCE: 0x16,
      TEMP_BASAL_RATE_OUT_OF_RANGE: 0x17,
    };
  }

  // TODO: (for a refactor) - optional config should be via fluent functions, and then we
  // build. So, somthing like this:
  // new TransmitPacketRequest(pumpSession, comDCommand).setHighSpeed(false).buildPacket(parameters)
  constructor(
    pumpSession, comDCommand, parameters, responseType = TransmitPacketResponse,
    highSpeedMode = true,
  ) {
    const comDCommandLength = TransmitPacketRequest.COMDCOMMAND_SIZE + parameters.length;
    const envelopeBuffer = Buffer.alloc(TransmitPacketRequest.ENVELOPE_SIZE);

    envelopeBuffer.write(pumpSession.packedPumpMAC, 0x00, 8, 'binary');
    envelopeBuffer.writeUInt8(pumpSession.incNgpSequenceNumber(), 0x08);
    let modeFlags = 0x01; // Always encrypted
    let resetComDSequence = false;

    if (comDCommand === TransmitPacketRequest.COM_D_COMMAND.HIGH_SPEED_MODE) {
      // A HIGH_SPEED_MODE send resets the ComD sequence number
      pumpSession.comDSequenceNumber = 0;
      resetComDSequence = true;
    } else {
      pumpSession.incComDSequenceNumber();
    }

    if (highSpeedMode) {
      modeFlags += 0x10;
    }

    envelopeBuffer.writeUInt8(modeFlags, 0x09);
    envelopeBuffer.writeUInt8(comDCommandLength, 0x0A);

    const transmitBuffer = Buffer.alloc(comDCommandLength);

    // eslint-disable-next-line no-bitwise
    transmitBuffer.writeUInt8(pumpSession.comDSequenceNumber | (0x80 * resetComDSequence), 0x00);
    transmitBuffer.writeUInt16BE(comDCommand, 0x01);
    if (comDCommandLength > TransmitPacketRequest.COMDCOMMAND_SIZE) {
      transmitBuffer.write(Buffer.from(parameters).toString('binary'), 0x03, 'binary');
    }

    // The ComDMessage also has its own CCITT (so many checksums!)
    const messageSize = transmitBuffer.length - 2;
    const checksum = NGPMessage.ccittChecksum(transmitBuffer, messageSize);
    transmitBuffer.writeUInt16BE(checksum, messageSize);

    debug('### UNENCRYPTED PAYLOAD', transmitBuffer.toString('hex'));

    // Encrypt the ComD message
    const encryptedBuffer =
      NGPUtil.NGPLinkCipher.encrypt(pumpSession.key, pumpSession.iv, transmitBuffer);

    const payloadBuffer = Buffer.concat(
      [envelopeBuffer, encryptedBuffer],
      envelopeBuffer.length + encryptedBuffer.length,
    );

    super(NGPMessage.COMMAND_TYPE.TRANSMIT_PACKET, pumpSession, payloadBuffer, responseType);
    this.setMaxRetries(TransmitPacketRequest.RETRIES);
    this.multipacketSession = null;
  }

  async read80Message(hidDevice, readTimeout, isPairing = false) {
    const ResponseClass = this.responseType;
    let fetchMoreData = true;
    let response = null;
    let resendMessage = null;
    this.ngpRetries = 0;

    /* eslint-disable no-await-in-loop, requests to devices are sequential */
    /* eslint-disable no-use-before-define */
    while (fetchMoreData) {
      try {
        const responseMessage = await super.readMessage(hidDevice, readTimeout);

        // Not strictly true if it's a multipacket session, but we only use the properties
        // of TransmitPacketResponse until we return. If we don't do it this way, we end up
        // double-initialising (since we need to decrypt the payload to get the comDCommand),
        // so this is better on memory.
        response = new ResponseClass(responseMessage, this.pumpSession);

        // If we got here, we successfully read a message. Reset retries and resendMessage.
        this.ngpRetries = 0;
        resendMessage = null;

        switch (response.comDCommand) {
          // While we're pairing, let HIGH_SPEED_MODE and FORCE_TIME_CHANGE_REQUEST
          // messages drop through, otherwise ignore them and keep reading.
          case TransmitPacketRequest.COM_D_COMMAND.FORCE_TIME_CHANGE_REQUEST:
          case TransmitPacketRequest.COM_D_COMMAND.HIGH_SPEED_MODE:
          {
            fetchMoreData = !isPairing;
            break;
          }
          case TransmitPacketRequest.COM_D_COMMAND.INITIATE_MULTIPACKET_TRANSFER:
          {
            fetchMoreData = true;
            this.multipacketSession = new MultipacketSession(response.comDPayload);
            // Acknowledge that we're ready to start receiving data.
            await Timer.wait(TransmitPacketRequest.SEND_DELAY_MS);
            resendMessage = new AckCommand(this.pumpSession, response.comDCommand);
            await resendMessage.send(hidDevice);
            break;
          }
          case TransmitPacketRequest.COM_D_COMMAND.MULTIPACKET_SEGMENT_TRANSMISSION:
          {
            const segment = new MultipacketSegmentResponse(responseMessage, this.pumpSession);
            this.multipacketSession.addSegment(segment);

            if (this.multipacketSession.payloadComplete()) {
              debug('*** Multisession Complete');
              fetchMoreData = false;
              response.comDPayload = this.multipacketSession.sessionPayload;
              await Timer.wait(TransmitPacketRequest.SEND_DELAY_MS);
              resendMessage = new AckCommand(
                this.pumpSession,
                TransmitPacketRequest.COM_D_COMMAND.MULTIPACKET_SEGMENT_TRANSMISSION,
              );
              await resendMessage.send(hidDevice);
            } else {
              fetchMoreData = true;
            }
            break;
          }
          default:
          {
            fetchMoreData = false;
            break;
          }
        }
      } catch (err) {
        if (!(err instanceof InvalidMessageError)) {
          this.ngpRetries += 1;
        }
        debug(`Retry: ${this.ngpRetries}`);
        if (err instanceof TimeoutError) {
          debug('Got timeout waiting for message.');
        } else if (err instanceof InvalidMessageError) {
          debug(`Invalid Message:\n${err}`);
        } else {
          debug(`Unknown error occurred while reading Multipacket message:\n${err}`);
          throw new InvalidStateError('Software Error. Contact support@tidepool.org.');
        }

        if (this.ngpRetries > this.maxRetries) {
          throw new RetryError('Exceeded retries for TransmitPacketRequest');
        } else if (this.ngpRetries > NGPRequest.DEFAULT_MAX_RETRIES) {
          if (resendMessage) {
            debug('*** Resending previous request');
            await resendMessage.send(hidDevice);
          } else if (this.multipacketSession && this.multipacketSession.retransmitNeeded()) {
            debug('*** Multisession missing segments');
            const nextMissingSegment = this.multipacketSession.missingSegments[0];
            if (nextMissingSegment !== undefined) {
              fetchMoreData = true;
              debug('Requesting missing packets');
              this.ngpRetries = 0;
              await Timer.wait(TransmitPacketRequest.SEND_DELAY_MS);
              await new MultipacketResendPacketsCommand(
                this.pumpSession,
                nextMissingSegment.index, nextMissingSegment.count,
              ).sendMessage(hidDevice);
            } else {
              fetchMoreData = false;
              throw new InvalidStateError('Software Error. Contact support@tidepool.org.');
            }
          }
        }
      }
    }
    /* eslint-enable no-use-before-define */
    /* eslint-enable no-await-in-loop */

    return response;
  }

  // Override send(), because we need to be able to handle Multipacket Transfers
  async send(hidDevice, readTimeout = NGPRequest.READ_TIMEOUT_MS, get80response = true) {
    let response = null;

    // Send the message, and fetch the 0x81 message (which we don't need to handle)
    await super.send(hidDevice, readTimeout, false);

    if (get80response) {
      response = await this.read80Message(hidDevice, readTimeout);
    }

    return response;
  }
}

class AckCommand extends TransmitPacketRequest {
  constructor(pumpSession, comDCommand) {
    const params = Buffer.alloc(2);
    params.writeUInt16BE(comDCommand, 0x00);

    super(pumpSession, TransmitPacketRequest.COM_D_COMMAND.ACK, params);
  }

  // Override send(), because we don't request an 0x80 response
  send(hidDevice, readTimeout = NGPRequest.READ_TIMEOUT_MS, get80response = false) {
    return super.send(hidDevice, readTimeout, get80response);
  }
}

class NakResponse extends TransmitPacketResponse {
  get comDCommand() {
    return this.comDPayload.readUInt16BE(0x03);
  }

  get nakCode() {
    return this.comDPayload[0x04];
  }
}

class MultipacketResendPacketsCommand extends TransmitPacketRequest {
  constructor(pumpSession, startPacket, packetCount) {
    const params = Buffer.alloc(4);
    params.writeUInt16BE(startPacket, 0x00);
    params.writeUInt16BE(packetCount, 0x02);

    super(pumpSession, TransmitPacketRequest.COM_D_COMMAND.MULTIPACKET_RESEND_PACKETS, params);
  }

  // Override send(), because we don't request an 0x80 response
  send(hidDevice, readTimeout = NGPRequest.READ_TIMEOUT_MS, get80response = false) {
    return super.send(hidDevice, readTimeout, get80response);
  }
}

class MultipacketSegmentResponse extends TransmitPacketResponse {
  get packetNumber() {
    return this.comDPayload.readUInt16BE(0x03);
  }

  get segmentPayload() {
    return this.comDPayload.slice(0x05);
  }
}

class HighSpeedModeCommand extends TransmitPacketRequest {
  static get HIGH_SPEED_MODE() {
    return {
      ENABLE: 0x00,
      DISABLE: 0x01,
    };
  }

  constructor(pumpSession, highSpeedMode) {
    super(
      pumpSession, TransmitPacketRequest.COM_D_COMMAND.HIGH_SPEED_MODE,
      Buffer.from([highSpeedMode]), TransmitPacketResponse, false,
    );
  }

  // Override send(), because we don't request an 0x80 response
  send(hidDevice, readTimeout = NGPRequest.READ_TIMEOUT_MS, get80response = false) {
    return super.send(hidDevice, readTimeout, get80response);
  }
}

class PumpTimeResponse extends TransmitPacketResponse {
  get time() {
    if (!this.comDPayload[0x03]) {
      throw new Error('Device clock not set');
    }

    return NGPUtil.NGPTimestamp.fromBuffer(this.comDPayload.slice(0x04, 0x0C));
  }
}

class PumpTimeCommand extends TransmitPacketRequest {
  constructor(pumpSession) {
    super(
      pumpSession, TransmitPacketRequest.COM_D_COMMAND.TIME_REQUEST, Buffer.from([]),
      PumpTimeResponse,
    );
  }
}

class TimeSyncDoneCommand extends TransmitPacketRequest {
  constructor(pumpSession, pumpTimeResponse) {
    const params = Buffer.alloc(9);
    params.write(pumpTimeResponse.comDPayload.slice(0x03, 0x0C).toString('hex'), 0x00, 9, 'hex');
    super(pumpSession, TransmitPacketRequest.COM_D_COMMAND.TIME_SYNC_DONE_RESPONSE, params);
  }
}

class EndNodeDeviceInitializationResponse extends TransmitPacketRequest {
  constructor(pumpSession) {
    super(
      pumpSession, TransmitPacketRequest.COM_D_COMMAND.END_NODE_DEVICE_INITIALIZATION_RESPONSE,
      Buffer.from([]),
    );
  }
}

class PumpStatusResponse extends TransmitPacketResponse {
  get pumpState() {
    return this.comDPayload[0x03];
  }

  get activeBasalPattern() {
    return this.comDPayload[0x1A];
  }

  get isPumpActive() {
    // eslint-disable-next-line no-bitwise
    return (this.pumpState & NGPUtil.NGPConstants.PUMP_STATE_FLAGS.ACTIVE) !== 0;
  }
}

class PumpStatusCommand extends TransmitPacketRequest {
  constructor(pumpSession) {
    super(
      pumpSession, TransmitPacketRequest.COM_D_COMMAND.READ_PUMP_STATUS_REQUEST,
      Buffer.from([]), PumpStatusResponse,
    );
  }
}

class BolusWizardBGTargetsResponse extends TransmitPacketResponse {
  get targets() {
    const targets = [];
    // Bytes 0x03 and 0x04 are a CCITT checksum of the target bytes.
    const numItems = this.comDPayload[0x05];

    for (let i = 0; i < numItems; i++) {
      const high = this.comDPayload.readUInt16BE(0x06 + (i * 9)); // in mg/dL
      // this.comDPayload.readUInt16BE(0x08 + (i * 9)) / 10.0; // in mmol/L
      const low = this.comDPayload.readUInt16BE(0x0A + (i * 9)); // in mg/dL
      // this.comDPayload.readUInt16BE(0x0C + (i * 9)) / 10.0; // in mmol/L

      targets.push({
        start: this.comDPayload[0x0E + (i * 9)] * 30 * sundial.MIN_TO_MSEC,
        high,
        low,
      });
    }

    return targets;
  }
}

class BolusWizardBGTargetsCommand extends TransmitPacketRequest {
  constructor(pumpSession) {
    super(
      pumpSession, TransmitPacketRequest.COM_D_COMMAND.READ_BOLUS_WIZARD_BG_TARGETS_REQUEST,
      Buffer.from([]), BolusWizardBGTargetsResponse,
    );
  }
}

class BasicNgpParametersResponse extends TransmitPacketResponse {
  get isExtendedBolusEnabled() {
    return this.comDPayload[0x6] !== 0;
  }

  get maxBolusAmount() {
    return this.comDPayload.readUInt32BE(0x14) / 10000.0;
  }

  get maxBasalAmount() {
    return this.comDPayload.readUInt32BE(0x18) / 10000.0;
  }

  get durationOfInsulinAction() {
    return this.comDPayload.readUInt16BE(0x24);
  }

  // See NGPUtil.NGPConstants.TEMP_BASAL_TYPE
  get tempBasalType() {
    return this.comDPayload[0x30] !== 0 ?
      NGPUtil.NGPConstants.TEMP_BASAL_TYPE.PERCENTAGE :
      NGPUtil.NGPConstants.TEMP_BASAL_TYPE.INSULIN_UNITS;
  }

  get isBolusWizardEnabled() {
    return this.comDPayload[0x37] !== 0;
  }
}

class BasicNgpParametersCommand extends TransmitPacketRequest {
  constructor(pumpSession) {
    super(
      pumpSession, TransmitPacketRequest.COM_D_COMMAND.READ_BASIC_NGP_PARAMETERS_REQUEST,
      Buffer.from([]), BasicNgpParametersResponse,
    );
  }
}

class BolusWizardCarbRatiosResponse extends TransmitPacketResponse {
  get ratios() {
    const ratios = [];
    // Bytes 0x03 and 0x04 are a CCITT checksum of the ratios bytes.
    const numItems = this.comDPayload[0x05];

    for (let i = 0; i < numItems; i++) {
      const amount = (this.comDPayload.readUInt32BE(0x06 + (i * 9))) / 10;
      // There is another UInt32BE after the amount, which is always 0

      ratios.push({
        start: this.comDPayload[0x0E + (i * 9)] * 30 * sundial.MIN_TO_MSEC,
        amount,
      });
    }

    return ratios;
  }
}

class BolusWizardCarbRatiosCommand extends TransmitPacketRequest {
  constructor(pumpSession) {
    super(
      pumpSession, TransmitPacketRequest.COM_D_COMMAND.READ_BOLUS_WIZARD_CARB_RATIOS_REQUEST,
      Buffer.from([]), BolusWizardCarbRatiosResponse,
    );
  }
}

class BolusWizardSensitivityFactorsResponse extends TransmitPacketResponse {
  get factors() {
    const factors = [];
    // Bytes 0x03 and 0x04 are a CCITT checksum of the sentivities' bytes.
    const numItems = this.comDPayload[0x05];

    for (let i = 0; i < numItems; i++) {
      const amount = this.comDPayload.readUInt16BE(0x06 + (i * 5)); // in mg/dL
      // this.comDPayload.readUInt16BE(0x08 + (i * 5)) / 10.0; // in mmol/L

      factors.push({
        start: this.comDPayload[0x0A + (i * 5)] * 30 * sundial.MIN_TO_MSEC,
        amount,
      });
    }

    return factors;
  }
}

class BolusWizardSensitivityFactorsCommand extends TransmitPacketRequest {
  constructor(pumpSession) {
    super(
      pumpSession,
      TransmitPacketRequest.COM_D_COMMAND.READ_BOLUS_WIZARD_SENSITIVITY_FACTORS_REQUEST,
      Buffer.from([]), BolusWizardSensitivityFactorsResponse,
    );
  }
}

class DeviceCompatibilityResponse extends TransmitPacketResponse {
  static buildForCnl(pumpSession) {
    const payload = Buffer.alloc(17);
    payload.writeUInt8(1, 0x00); // Hardcoded - from CNL to pump?
    payload.write(pumpSession.linkMAC, 0x01, 8, 'hex');
    payload.write(pumpSession.pumpMAC, 0x09, 8, 'hex');

    const responsePacket = new TransmitPacketRequest(
      pumpSession,
      TransmitPacketRequest.COM_D_COMMAND.DEVICE_COMPATIBILITY_RESPONSE, payload,
      TransmitPacketResponse, false,
    );
    return responsePacket;
  }
}

/**
 * This message also contains pump and software firmware versions.
 */
class DeviceCharacteristicsResponse extends TransmitPacketResponse {
  constructor(payload, pumpSession) {
    super(payload, pumpSession);

    if (this.comDPayload.length < 13) {
      throw new InvalidMessageError('Received invalid DeviceCharacteristicsResponse message.');
    }
  }

  // This function exists becuase we can both send and recieve a DeviceCharacteristicsResponse.
  // TODO: A future refactor should decouple message building and send/receive.
  static buildForCnl(pumpSession) {
    const payload = Buffer.alloc(40);
    payload.write(pumpSession.bcnlFullSerial, 0x00, 10, 'ascii');
    payload.write(pumpSession.linkMAC, 0x0A, 8, 'hex');
    payload.write('010101000000660001000A00020000FFFF070100', 0x12, 20, 'hex');

    const responsePacket = new TransmitPacketRequest(
      pumpSession,
      TransmitPacketRequest.COM_D_COMMAND.DEVICE_CHARACTERISTICS_RESPONSE, payload,
      TransmitPacketResponse, false,
    );
    return responsePacket;
  }

  get serial() {
    return this.comDPayload.slice(0x03, 0x0D).toString();
  }

  get MAC() {
    return this.comDPayload.slice(0x0D, 0x15).toString('binary');
  }

  get comDVersion() {
    const majorNumber = this.comDPayload.readUInt8(0x15);
    const minorNumber = this.comDPayload.readUInt8(0x16);
    const alpha = String.fromCharCode(65 + this.comDPayload.readUInt8(0x17));
    return `${majorNumber}.${minorNumber}${alpha}`;
  }

  get telDVersion() {
    /* eslint-disable no-bitwise */
    const majorNumber = this.comDPayload.readUInt8(0x18) >> 3;
    const minorNumber = (this.comDPayload.readUInt8(0x19) >> 5) |
      ((this.comDPayload.readUInt8(0x18) << 29) >> 26);
    const alpha = String.fromCharCode(64 + ((this.comDPayload.readUInt8(0x19) << 3) >> 3));
    /* eslint-enable no-bitwise */
    return `${majorNumber}.${minorNumber}${alpha}`;
  }

  get model() {
    const modelMajorNumber = this.comDPayload.readUInt16BE(0x1A);
    const modelMinorNumber = this.comDPayload.readUInt16BE(0x1C);
    return `${modelMajorNumber}.${modelMinorNumber}`;
  }

  get pingInterval() {
    return this.comDPayload.readUInt16BE(0x1E);
  }

  get syncInterval() {
    return this.comDPayload.readUInt16BE(0x20);
  }

  get maxMessageSize() {
    return this.comDPayload.readUInt32BE(0x22);
  }

  get deviceClassEnum() {
    return this.comDPayload.readUInt8(0x26);
  }

  get deviceClassVersionEnum() {
    return this.comDPayload.readUInt8(0x27);
  }

  get firmwareVersion() {
    const majorNumber = this.comDPayload.readUInt8(0x29);
    const minorNumber = this.comDPayload.readUInt8(0x2A);
    const alpha = String.fromCharCode(this.comDPayload.readUInt8(0x2B));
    return `${majorNumber}.${minorNumber}${alpha}`;
  }

  get motorAppVersion() {
    const majorNumber = this.comDPayload.readUInt8(0x2C);
    const minorNumber = this.comDPayload.readUInt8(0x2D);
    const alpha = String.fromCharCode(this.comDPayload.readUInt8(0x2E));
    return `${majorNumber}.${minorNumber}${alpha}`;
  }

  get displayUnits() {
    // See NGPUtil.NGPConstants.BG_UNITS
    return this.comDPayload.readUInt8(0x35);
  }
}

class DeviceCharacteristicsCommand extends TransmitPacketRequest {
  // DeviceCharacteristicsCommand can be used both in highSpeedMode (normal comms)
  // and during ad hoc pairing (low speed)
  constructor(pumpSession, responseType = DeviceCharacteristicsResponse, highSpeedMode = true) {
    const params = Buffer.alloc(9);
    params[0] = 0x02;
    const pumpMAC = Buffer.from(pumpSession.pumpMAC, 'hex').toString('binary');
    params.write(pumpMAC, 0x01, 8, 'binary');
    super(
      pumpSession, TransmitPacketRequest.COM_D_COMMAND.DEVICE_CHARACTERISTICS_REQUEST,
      params, responseType, highSpeedMode,
    );
  }
}

class DeviceStringResponse extends TransmitPacketResponse {
  constructor(payload, pumpSession) {
    super(payload, pumpSession);

    if (this.comDPayload.length < 94) {
      throw new InvalidMessageError('Received invalid DeviceStringResponse message.');
    }
  }

  static buildForCnl(pumpSession) {
    const payload = Buffer.alloc(91);
    payload.write(pumpSession.packedLinkMAC, 0x00, 8, 'binary');
    payload.writeUInt16BE(0x04, 0x08); // Response String Type
    payload.writeUInt8(0x00, 0x0A); // Language

    const responsePacket = new TransmitPacketRequest(
      pumpSession,
      TransmitPacketRequest.COM_D_COMMAND.DEVICE_STRING_RESPONSE, payload,
      TransmitPacketResponse, true,
    );
    return responsePacket;
  }

  get MAC() {
    return this.comDPayload.slice(0x03, 0x0B).toString('binary');
  }

  get stringType() {
    return this.comDPayload.readUInt16BE(0x0B);
  }

  get language() {
    return this.comDPayload.readUInt8(0x0D);
  }

  get string() {
    const deviceStringUtf16 = this.comDPayload.slice(0x0E, 0x5E);
    // We have to strip the nulls ourselves, because the payload doesn't give us string size.
    return _.replace(iconv.decode(deviceStringUtf16, 'utf16-be'), /\0/g, '');
  }
}

class DeviceStringCommand extends TransmitPacketRequest {
  // Default string type (0x04) is Get Model String
  constructor(pumpSession, stringType = 0x04) {
    const params = Buffer.alloc(12);
    params[0x00] = 0x01;
    params[0x0A] = stringType;
    super(
      pumpSession, TransmitPacketRequest.COM_D_COMMAND.DEVICE_STRING_REQUEST,
      params, DeviceStringResponse,
    );
  }
}

class ReadBasalPatternResponse extends TransmitPacketResponse {
  get schedule() {
    const schedule = [];
    // Byte 0x03 is the Basal Pattern number
    const numItems = this.comDPayload[0x04];

    for (let i = 0; i < numItems; i++) {
      schedule.push({
        start: this.comDPayload[0x09 + (i * 5)] * 30 * sundial.MIN_TO_MSEC,
        rate: (this.comDPayload.readUInt32BE(0x05 + (i * 5)) / 10000),
      });
    }

    return schedule;
  }
}

class ReadBasalPatternCommand extends TransmitPacketRequest {
  constructor(pumpSession, basalPattern) {
    super(
      pumpSession, TransmitPacketRequest.COM_D_COMMAND.READ_BASAL_PATTERN_REQUEST,
      Buffer.from([basalPattern]), ReadBasalPatternResponse,
    );
  }
}

class ReadHistoryInfoResponse extends TransmitPacketResponse {
  get historySize() {
    return this.comDPayload.readUInt32BE(0x04);
  }

  get dataStart() {
    return NGPUtil.NGPTimestamp.fromBuffer(this.comDPayload.slice(0x08, 0x10));
  }

  get dataEnd() {
    return NGPUtil.NGPTimestamp.fromBuffer(this.comDPayload.slice(0x10, 0x18));
  }
}

class ReadHistoryInfoCommand extends TransmitPacketRequest {
  constructor(pumpSession, historyDataType, historyRangeType, fromRtc = 0x00, toRtc = 0x00) {
    const params = Buffer.alloc(12);
    params[0x00] = historyDataType;
    params[0x01] = historyRangeType;
    params.writeUInt32BE(fromRtc, 0x02);
    params.writeUInt32BE(toRtc, 0x06);
    params.writeUInt16BE(0x00, 0x0A); // Hard coded
    super(
      pumpSession, TransmitPacketRequest.COM_D_COMMAND.READ_HISTORY_INFO_REQUEST,
      params, ReadHistoryInfoResponse,
    );
  }
}

// We don't need to inherit from any other message type, because all of the checksums and size
// checks are done in the MultipacketSession.
class ReadHistoryResponse {
  constructor(dataBlocks) {
    this.blocks = dataBlocks;
  }

  get pages() {
    return _.map(this.blocks, value => value.toString('hex'));
  }
}

class ReadHistoryCommand extends TransmitPacketRequest {
  constructor(
    pumpSession, historyDataType, historyRangeType, fromRtc = 0x00, toRtc = 0x00,
    expectedSize, progressCb = () => {},
  ) {
    const params = Buffer.alloc(12);
    params[0x00] = historyDataType;
    params[0x01] = historyRangeType;
    params.writeUInt32BE(fromRtc, 0x02);
    params.writeUInt32BE(toRtc, 0x06);
    params.writeUInt16BE(0x00, 0x0A); // Hard coded

    // Request a regular TransmitPacketResponse to process this Multipacket Segment, and return
    // the actual responseType in send()
    super(
      pumpSession, TransmitPacketRequest.COM_D_COMMAND.READ_HISTORY_REQUEST, params,
      TransmitPacketResponse,
    );

    this.historyDataType = historyDataType;
    this.fromRtc = fromRtc;
    this.toRtc = toRtc;
    this.expectedSize = expectedSize;
    this.bytesFetched = 0;
    this.blocks = [];
    this.progressCb = progressCb;
  }

  static get BLOCK_SIZE() {
    return 2048;
  }

  static get READ_TIMEOUT_MS() {
    return 350;
  }

  addHistoryBlock(payload) {
    // Decompress the block
    const HEADER_SIZE = 13;
    // It's an UnmergedHistoryUpdateCompressed response. We need to decompress it
    const dataType = payload[0x03]; // Returns a HISTORY_DATA_TYPE
    const historySizeCompressed = payload.readUInt32BE(0x04);
    const historySizeUncompressed = payload.readUInt32BE(0x08);
    const historyCompressed = payload[0x0C];

    if (dataType !== this.historyDataType) {
      throw new InvalidMessageError('Unexpected history type in response');
    }

    // Check that we have the correct number of bytes in this message
    if (payload.length - HEADER_SIZE !== historySizeCompressed) {
      throw new InvalidMessageError(`Unexpected message size: expected ${historySizeCompressed} bytes, got ${payload.length}`);
    }

    let blockPayload = null;
    if (historyCompressed) {
      blockPayload = lzo.decompress(
        payload.slice(HEADER_SIZE),
        historySizeUncompressed,
      );
    } else {
      blockPayload = payload.slice(HEADER_SIZE);
    }

    if (blockPayload.length % ReadHistoryCommand.BLOCK_SIZE) {
      throw new InvalidMessageError('Block payload size is not a multiple of 2048');
    }

    for (let i = 0; i < blockPayload.length / ReadHistoryCommand.BLOCK_SIZE; i++) {
      const blockSize = blockPayload
        .readUInt16BE(((i + 1) * ReadHistoryCommand.BLOCK_SIZE) - 4);
      const blockChecksum = blockPayload
        .readUInt16BE(((i + 1) * ReadHistoryCommand.BLOCK_SIZE) - 2);

      const blockStart = i * ReadHistoryCommand.BLOCK_SIZE;
      const blockData = blockPayload.slice(blockStart, blockStart + blockSize);
      const calculatedChecksum = NGPMessage.ccittChecksum(blockData, blockSize);

      if (blockChecksum !== calculatedChecksum) {
        throw new ChecksumError(blockChecksum, calculatedChecksum, `Unexpected checksum in block ${i}`);
      } else {
        this.blocks.push(blockData);
      }
    }

    this.bytesFetched += blockPayload.length;
    this.progressCb(this.bytesFetched);
  }

  // Override send(), because we process multiple UNMERGED_HISTORY_RESPONSE blocks
  async send(hidDevice, readTimeout = ReadHistoryCommand.READ_TIMEOUT_MS) {
    let receivedEndHistoryCommand = false;
    let response = null;
    await super.send(hidDevice, readTimeout, false);

    /* eslint-disable no-await-in-loop, requests to devices are sequential */
    while (receivedEndHistoryCommand !== true) {
      response = await this.read80Message(hidDevice, readTimeout);

      switch (response.comDCommand) {
        case TransmitPacketRequest.COM_D_COMMAND.END_HISTORY_TRANSMISSION:
        {
          receivedEndHistoryCommand = true;

          // Check that we received as much data as we were expecting.
          if (this.bytesFetched < this.expectedSize) {
            throw new InvalidMessageError('Got less data than expected');
          } else {
            // Discard remaining messages until we get a HIGH_SPEED_MODE,
            // otherwise the CNL gets frozen.
            let gotEndHighSpeedMode = false;
            do {
              const discardableResponse = await this.readMessage(hidDevice, readTimeout);
              const discardableMessage =
                new TransmitPacketResponse(discardableResponse, this.pumpSession);
              gotEndHighSpeedMode = (discardableMessage.comDCommand ===
                  TransmitPacketRequest.COM_D_COMMAND.HIGH_SPEED_MODE);
            } while (!gotEndHighSpeedMode);
          }
          break;
        }
        case TransmitPacketRequest.COM_D_COMMAND.UNMERGED_HISTORY_RESPONSE:
        {
          this.addHistoryBlock(response.comDPayload);
          break;
        }
        case TransmitPacketRequest.COM_D_COMMAND.NAK:
        {
          const nakResponse = new NakResponse(response.comDPayload);
          throw new InvalidMessageError(`Got NAK from pump for command ${nakResponse.comDCommand}: ${nakResponse.nakCode}`);
        }
        default:
          throw new InvalidMessageError(`Unexpected message response: ${response.comDCommand}`);
      }
    }
    /* eslint-enable no-await-in-loop */

    return new ReadHistoryResponse(this.blocks);
  }
}

class AdHocPairingResponse {
  constructor(linkKey) {
    this.linkKey = linkKey;
  }

  get linked() {
    return !_.isUndefined(this.linkKey);
  }
}

class AdHocPairingCommand extends TransmitPacketRequest {
  constructor(pumpSession) {
    // Set a fake COM_D_COMMAND of 0x00, since we override send() anyway.
    // This is not really a Command as much as it is a sequence...
    super(pumpSession, 0x00, Buffer.from([]));
    // Because we "fake" added a message, reset the sequence counter
    this.pumpSession.comDSequenceNumber = 0;
  }

  static get AD_HOC_PAIRING_RETRIES() {
    return 15;
  }

  // Override send(), because the linking process sends various unrelated responses to the requests.
  async send(hidDevice, readTimeout = NGPRequest.READ_TIMEOUT_MS) {
    let receivedEndPairingCommand = false;
    let endNodeDeviceInitialization = false;
    let response = null;
    let sequenceNumberCheck = 1;
    this.setMaxRetries(AdHocPairingCommand.AD_HOC_PAIRING_RETRIES);
    // Don't need to send. Just keep reading after the initial CONNECT

    /* eslint-disable no-await-in-loop, requests to devices are sequential */
    while (receivedEndPairingCommand !== true) {
      response = await this.read80Message(hidDevice, readTimeout, true);
      // Check that we have a valid sequence number. If we don't, then
      // something has gone wrong with the key exchange sequence, and we're
      // not decrypting the messages properly.
      if (response.sequenceNumber !== sequenceNumberCheck) {
        debug(`Unexpected sequence number. Expected ${sequenceNumberCheck}, got ${response.sequenceNumber}`);
        throw new Error('Unexpected sequence number. Encryption key exchange failed');
      } else {
        sequenceNumberCheck += 1;
      }

      switch (response.comDCommand) {
        case TransmitPacketRequest.COM_D_COMMAND.AD_HOC_PAIRING_FAILED_RESPONSE:
        {
          // TODO: Make a AdHocPairingFailedResponse message.
          // Reason code in the byte after comDCommand:
          // 0x00 = User denied pairing request
          // 0x02 = Sequence error
          throw new Error('Ad hoc pairing failed');
        }
        case TransmitPacketRequest.COM_D_COMMAND.HIGH_SPEED_MODE:
        {
          if (endNodeDeviceInitialization) {
            await Timer.wait(TransmitPacketRequest.SEND_DELAY_MS);
            await new SetRfMode(this.pumpSession)
              .send(hidDevice, NGPRequest.READ_TIMEOUT_MS, false);
          }
          break;
        }
        case TransmitPacketRequest.COM_D_COMMAND.DEVICE_CHARACTERISTICS_REQUEST:
        {
          await Timer.wait(TransmitPacketRequest.SEND_DELAY_MS);
          await DeviceCharacteristicsResponse.buildForCnl(this.pumpSession)
            .send(hidDevice, NGPRequest.READ_TIMEOUT_MS, false);
          break;
        }
        case TransmitPacketRequest.COM_D_COMMAND.DEVICE_COMPATIBILITY_RESPONSE:
        {
          await Timer.wait(TransmitPacketRequest.SEND_DELAY_MS);
          await
          new DeviceCharacteristicsCommand(this.pumpSession, DeviceCharacteristicsResponse, false)
            .send(hidDevice, NGPRequest.READ_TIMEOUT_MS, false);
          break;
        }
        case TransmitPacketRequest.COM_D_COMMAND.DEVICE_CHARACTERISTICS_RESPONSE:
        {
          await Timer.wait(TransmitPacketRequest.SEND_DELAY_MS);
          await DeviceCompatibilityResponse.buildForCnl(this.pumpSession)
            .send(hidDevice, NGPRequest.READ_TIMEOUT_MS, false);
          break;
        }
        case TransmitPacketRequest.COM_D_COMMAND.SET_LINK_KEY:
        {
          const tempLinkKey = response.comDPayload.slice(0x3, 0x13).reverse();
          const tempPackedLinkKey = NGPUtil.NGPLinkCipher
            .packLinkKey(tempLinkKey, this.pumpSession.bcnlSerialNumber, 55);
          await Timer.wait(TransmitPacketRequest.SEND_DELAY_MS);
          await new SendLinkKeyRequest(this.pumpSession, tempPackedLinkKey).send(hidDevice);
          await new AckCommand(this.pumpSession, response.comDCommand).send(hidDevice);
          this.pumpSession.key = tempLinkKey;
          break;
        }
        case TransmitPacketRequest.COM_D_COMMAND.FORCE_TIME_CHANGE_REQUEST:
        {
          await Timer.wait(TransmitPacketRequest.SEND_DELAY_MS);
          const timeResponse = await new PumpTimeCommand(this.pumpSession).send(hidDevice);
          await new TimeSyncDoneCommand(this.pumpSession, timeResponse).send(hidDevice);
          sequenceNumberCheck += 2;
          break;
        }
        case TransmitPacketRequest.COM_D_COMMAND.DEVICE_STRING_REQUEST:
        {
          await Timer.wait(TransmitPacketRequest.SEND_DELAY_MS);
          await DeviceStringResponse.buildForCnl(this.pumpSession)
            .send(hidDevice, NGPRequest.READ_TIMEOUT_MS, false);
          break;
        }
        case 0x0409:
        {
          await Timer.wait(TransmitPacketRequest.SEND_DELAY_MS);
          await new DeviceStringCommand(this.pumpSession, 0x01).send(hidDevice);
          await Timer.wait(TransmitPacketRequest.SEND_DELAY_MS);
          await new EndNodeDeviceInitializationResponse(this.pumpSession)
            .send(hidDevice, NGPRequest.READ_TIMEOUT_MS, false);
          endNodeDeviceInitialization = true;
          sequenceNumberCheck += 1;
          break;
        }
        case TransmitPacketRequest.COM_D_COMMAND.END_NODE_ASSOCIATION_CONFIRM_RESPONSE:
        {
          receivedEndPairingCommand = true;
          await Timer.wait(TransmitPacketRequest.SEND_DELAY_MS);
          break;
        }
        default:
        {
          // The CLP code does not throw when it comes across a message it doesn't know.
          // It just keeps reading
          debug(`Unknown message response during ad hoc pairing: 0x${response.comDCommand.toString(16)}`);
        }
      }
    }
    /* eslint-enable no-await-in-loop */

    return new AdHocPairingResponse(undefined);
  }
}

class BCNLDriver {
  constructor(hidDevice) {
    this.hidDevice = hidDevice;
    this.USB_BLOCKSIZE = 64;
    this.MAGIC_HEADER = 'ABC';

    this.pumpSession = null;
  }

  static get PASSTHROUGH_MODE() {
    return {
      ENABLE: '1',
      DISABLE: '0',
    };
  }

  async connect(deviceInfo) {
    // No probe required.
    const connect = promisify(this.hidDevice.connect);
    return connect(deviceInfo, _.noop());
  }

  async disconnect() {
    const disconnect = promisify(this.hidDevice.disconnect);
    return disconnect(null);
  }
}

class MM600SeriesDriver extends BCNLDriver {
  static get CHANNELS() {
    // CHANNELS In the order that the CareLink applet requests them
    return [0x14, 0x11, 0x0e, 0x17, 0x1a];
  }

  static get COMMS_RESET_DELAY_MS() {
    return 4000;
  }

  static get HISTORY_DATA_TYPE() {
    return {
      PUMP_DATA: 0x02,
      SENSOR_DATA: 0x03,
    };
  }

  static get HISTORY_RANGE_TYPE() {
    return {
      FULL_HISTORY: 0x03,
      PARTIAL_HISTORY: 0x04,
    };
  }

  isLinked() {
    if (this.pumpSession && this.pumpSession.isAssociated) {
      return true;
    }
    return false;
  }

  static convertSerialToMacID(pumpSerial) {
    let str = _.toUpper(pumpSerial);

    // first, move alphabetical character on the right over to the left
    str = str.substr(0, 2) + str[9] + str.substr(2, 7);

    /* eslint-disable no-bitwise, no-mixed-operators */
    let numberComponent = 1000000 * (Number.isFinite(Number(str.charAt(3))) ?
      parseInt(str.charAt(3), 10) :
      (str.charCodeAt(3) - 65 + 10));
    numberComponent += parseInt(str.substr(4, 10), 10);

    const alphaComponent = (str.charCodeAt(0) - 65) * 26 * 26 +
            (str.charCodeAt(1) - 65) * 26 +
            (str.charCodeAt(2) - 65) << 1 |
            (numberComponent > 16581375);

    const numArray = Buffer.alloc(8);
    numArray.write('0023f7', 0x00, 3, 'hex'); // Private Vendor OUI
    numArray.writeUInt16BE(alphaComponent, 0x03);
    // Write the high byte of the 24-byte numberComponent
    numArray.writeUInt8((numberComponent & 0xFFFFFF) >> 16, 0x05);
    // Write the middle and low bytes of the 24-byte numberComponent
    numArray.writeUInt16BE((numberComponent & 0x00FFFF), 0x06);
    /* eslint-enable no-bitwise, no-mixed-operators */

    return numArray.toString('hex');
  }

  setPumpMACFromSerial(serialNumber) {
    this.pumpSession.pumpMAC = MM600SeriesDriver.convertSerialToMacID(serialNumber);

    // build the temp link key from packedLinkMAC and packedPumpMAC
    this.pumpSession.key = Buffer.from(this.pumpSession.packedLinkMAC +
      this.pumpSession.packedPumpMAC, 'binary');
  }

  async enterRemoteCommandMode() {
    const infoResponse = await new DeviceInfoRequestCommand().send(this.hidDevice);
    this.pumpSession = new MinimedPumpSession(infoResponse);
    const nakResponse = await new BCNLCommand(BCNLMessage.ASCII_CONTROL.NAK).send(this.hidDevice);
    await nakResponse.checkAsciiControl(BCNLMessage.ASCII_CONTROL.EOT);
    const enqResponse = await new BCNLCommand(BCNLMessage.ASCII_CONTROL.ENQ).send(this.hidDevice);
    await enqResponse.checkAsciiControl(BCNLMessage.ASCII_CONTROL.ACK);
  }

  async exitRemoteCommandMode() {
    const response = await new BCNLCommand(BCNLMessage.ASCII_CONTROL.EOT)
      .send(this.hidDevice, BCNLMessage.READ_TIMEOUT_MS, MM600SeriesDriver.COMMS_RESET_DELAY_MS);
    await response.checkAsciiControl(BCNLMessage.ASCII_CONTROL.ENQ);
  }

  async togglePassthroughMode(mode) {
    const writeResponse = await new BCNLCommand('W|').send(this.hidDevice);
    writeResponse.checkAsciiControl(BCNLMessage.ASCII_CONTROL.ACK);
    const queryResponse = await new BCNLCommand('Q|').send(this.hidDevice);
    queryResponse.checkAsciiControl(BCNLMessage.ASCII_CONTROL.ACK);
    const modeResponse = await new BCNLCommand(`${mode}|`).send(this.hidDevice);
    modeResponse.checkAsciiControl(BCNLMessage.ASCII_CONTROL.ACK);
  }

  async openConnection() {
    await new OpenConnectionRequest(this.pumpSession).send(this.hidDevice);
  }

  async closeConnection() {
    await new CloseConnectionRequest(this.pumpSession).send(this.hidDevice);
  }

  async readPumpInfo() {
    const response = await new ReadInfoRequest(this.pumpSession).send(this.hidDevice);
    this.pumpSession.linkMAC = response.linkMAC;
    this.pumpSession.pumpMAC = response.pumpMAC;
    this.pumpSession.isAssociated = response.isAssociated;
  }

  async getLinkKey() {
    const response = await new RequestLinkKeyRequest(this.pumpSession).send(this.hidDevice);
    this.pumpSession.key = response.linkKey(this.pumpSession.bcnlModelAndSerial);
  }

  async negotiateRadioChannel() {
    for (const channel of MM600SeriesDriver.CHANNELS) {
      this.pumpSession.radioChannel = channel;
      // eslint-disable-next-line no-await-in-loop, requests to devices are sequential
      const response = await new JoinNetworkRequest(this.pumpSession).send(this.hidDevice);
      if (response.joinedNetwork) {
        return;
      }
    }

    this.pumpSession.radioChannel = 0;
    throw new Error('Could not find pump on any channel');
  }

  async leaveNetwork() {
    await new LeaveNetworkRequest(this.pumpSession).send(this.hidDevice);
    this.pumpSession.radioChannel = 0;
  }

  async toggleHighSpeedMode(mode) {
    await new HighSpeedModeCommand(this.pumpSession, mode).send(this.hidDevice);
  }

  async getPumpTime() {
    return new PumpTimeCommand(this.pumpSession).send(this.hidDevice);
  }

  async getPumpStatus() {
    return new PumpStatusCommand(this.pumpSession).send(this.hidDevice);
  }

  async getBolusWizardSettings() {
    const settings = {};
    let response = await new BolusWizardBGTargetsCommand(this.pumpSession).send(this.hidDevice);
    settings.bgTarget = response.targets;

    response = await new BolusWizardCarbRatiosCommand(this.pumpSession).send(this.hidDevice);
    settings.carbRatio = response.ratios;

    response = await new BolusWizardSensitivityFactorsCommand(this.pumpSession)
      .send(this.hidDevice);
    settings.insulinSensitivity = response.factors;

    response = await new BasicNgpParametersCommand(this.pumpSession).send(this.hidDevice);
    settings.isBolusWizardEnabled = response.isBolusWizardEnabled;
    settings.durationOfInsulinAction = response.durationOfInsulinAction;
    settings.isExtendedBolusEnabled = response.isExtendedBolusEnabled;
    settings.maxBolusAmount = response.maxBolusAmount;
    settings.maxBasalAmount = response.maxBasalAmount;

    return settings;
  }

  async getDeviceCharacteristics() {
    return new DeviceCharacteristicsCommand(this.pumpSession).send(this.hidDevice);
  }

  async temporaryLinkToPump(cfg) {
    const { displayAdHocModal } = cfg;

    return new Promise((resolve) => {
      displayAdHocModal(() => {
        resolve(new AdHocPairingCommand(this.pumpSession, cfg).send(this.hidDevice));
      });
    });
  }

  async getDeviceString() {
    return new DeviceStringCommand(this.pumpSession).send(this.hidDevice);
  }

  async readBasalPatterns() {
    const basalSchedules = {};

    for (let i = 0; i < 8; i++) {
      // eslint-disable-next-line no-await-in-loop, requests to devices are sequential
      const response = await new ReadBasalPatternCommand(this.pumpSession, i + 1)
        .send(this.hidDevice);
      // Only include patterns with schedules in them
      if (response.schedule.length > 0) {
        basalSchedules[NGPUtil.NGPConstants.BASAL_PATTERN_NAME[i]] = response.schedule;
      }
    }

    return basalSchedules;
  }

  async readHistory(fromRtc, toRtc, progressCb, progressStart, progressEnd, isFirstUpload = false) {
    // TODO: make this method less copy/pasty
    const history = {};
    const percentPerDataType = (progressEnd - progressStart) / 2;

    let response = await new ReadHistoryInfoCommand(
      this.pumpSession,
      MM600SeriesDriver.HISTORY_DATA_TYPE.PUMP_DATA,
      MM600SeriesDriver.HISTORY_RANGE_TYPE.PARTIAL_HISTORY, fromRtc, toRtc,
    )
      .send(this.hidDevice);
    debug(`*** EXPECT PUMP HISTORY FROM ${response.dataStart.toDate()} TO ${response.dataEnd.toDate()}`);
    const expectedPumpHistorySize = response.historySize;
    history.dataEnd = response.dataEnd.toDate();

    response = await new ReadHistoryInfoCommand(
      this.pumpSession,
      MM600SeriesDriver.HISTORY_DATA_TYPE.SENSOR_DATA,
      MM600SeriesDriver.HISTORY_RANGE_TYPE.PARTIAL_HISTORY, fromRtc, toRtc,
    )
      .send(this.hidDevice);
    debug(`*** EXPECT CGM HISTORY FROM ${response.dataStart.toDate()} TO ${response.dataEnd.toDate()}`);
    const expectedCgmHistorySize = response.historySize;
    // If there is less CGM data then pump data, set the history marker to the end of the CGM data.
    if (response.dataEnd.toDate() < history.dataEnd) {
      history.dataEnd = response.dataEnd.toDate();
    }

    debug('*** GETTING PUMP HISTORY');
    response = await new ReadHistoryCommand(
      this.pumpSession,
      MM600SeriesDriver.HISTORY_DATA_TYPE.PUMP_DATA,
      MM600SeriesDriver.HISTORY_RANGE_TYPE.PARTIAL_HISTORY, fromRtc, toRtc, expectedPumpHistorySize,
      (fetchedSize) => {
        const percentFetched = fetchedSize / expectedPumpHistorySize;
        progressCb(progressStart + (percentPerDataType * percentFetched), isFirstUpload);
      },
    )
      .send(this.hidDevice);
    history.pages = response.pages;

    debug('*** GETTING CGM HISTORY');
    response = await new ReadHistoryCommand(
      this.pumpSession,
      MM600SeriesDriver.HISTORY_DATA_TYPE.SENSOR_DATA,
      MM600SeriesDriver.HISTORY_RANGE_TYPE.PARTIAL_HISTORY, fromRtc, toRtc, expectedCgmHistorySize,
      (fetchedSize) => {
        const percentFetched = fetchedSize / expectedCgmHistorySize;
        progressCb(progressStart + percentPerDataType +
            (percentPerDataType * percentFetched), isFirstUpload);
      },
    )
      .send(this.hidDevice);
    history.cbg_pages = response.pages;

    return history;
  }
}

module.exports = (config) => {
  const cfg = _.clone(config);
  const driver = new MM600SeriesDriver(cfg.deviceComms);

  cfg.deviceTags = ['insulin-pump', 'cgm'];

  // REVIEW - discuss http://eslint.org/docs/rules/no-param-reassign...
  /* eslint no-param-reassign: [2, { props: false }] */
  /* eslint-disable no-unused-vars */
  return {
    detect(deviceInfo, cb) {
      debug('no detect function needed');
      cb(null, deviceInfo);
    },

    setup(deviceInfo, progress, cb) {
      debug('in setup!');

      if (isBrowser) {
        progress(100);
        cb(null, {
          deviceInfo,
        });
      } else {
        // pages are coming from CLI
        progress(100);
        const data = cfg.fileData;
        data.deviceInfo = deviceInfo;
        cb(null, data);
      }
    },

    connect(progress, data, cb) {
      if (!isBrowser) {
        data.disconnect = false;
        cb(null, data);
        return;
      }
      debug('in connect!');

      (async () => {
        await driver.connect(data.deviceInfo);
        data.disconnect = false;
        progress(100);
        cb(null, data);
      })().catch((error) => {
        cb(error);
      });
    },

    getConfigInfo(progress, data, cb) {
      if (!isBrowser) {
        data.connect = true;
        cb(null, data);
        return;
      }
      debug('in getConfigInfo', data);

      data.cnlConnection = false;
      data.adHocConnectionActive = false;
      data.pumpHighSpeedMode = false;

      const settings = {
        units: {
          bg: 'mg/dL', // Even though the pump can be in mmol/L, we read the mg/dL settings values
          carb: 'grams',
        },
      };

      // Wrap in async, because this function is not async, and we're dealing with other
      // async functions
      (async () => {
        // The enter/exit/enter paradigm is what CareLink does, according to packet captures.
        try {
          await driver.enterRemoteCommandMode();
        } catch (error) {
          // Reset the USB connection
          await driver.disconnect();
          await driver.connect(data.deviceInfo);
        }
        await driver.exitRemoteCommandMode();
        await driver.enterRemoteCommandMode();
        data.connect = true;

        await driver.togglePassthroughMode(BCNLDriver.PASSTHROUGH_MODE.ENABLE);
        await driver.openConnection();
        await progress(20);
        data.cnlConnection = true;

        await driver.readPumpInfo();
        let adHocMode = false;
        if (driver.isLinked()) {
          debug('Pump is linked with CNL');
          if (!_.isEmpty(cfg.deviceInfo.serialNumber) &&
            MM600SeriesDriver.convertSerialToMacID(cfg.deviceInfo.serialNumber) !==
              driver.pumpSession.pumpMAC) {
            // TODO: Improved UX flow. Don't make serial number entry available if meter
            // is already linked.
            throw new Error('Meter linked to a different pump. Either unlink this meter, or use a different unlinked meter to read from this pump.');
          }
          await driver.getLinkKey();
        } else {
          debug('Pump is NOT linked with CNL. Start ad hoc pairing');
          adHocMode = true;
          if (_.isEmpty(cfg.deviceInfo.serialNumber)) {
            // TODO: Improved UX flow. Automatically show serial number box?
            throw new Error('Meter and pump are not linked, and pump serial number was not entered.');
          }
          driver.setPumpMACFromSerial(cfg.deviceInfo.serialNumber);
        }
        try {
          await driver.negotiateRadioChannel();
        } catch (findPumpError) {
          let errorString = 'Please make sure that the pump is in range';
          if (adHocMode) {
            errorString += ' and that you entered the correct serial number for your pump.';
          } else {
            errorString += ' and that the pump is linked with this Contour Next Link 2.4.';
          }
          throw new Error(errorString);
        }
        if (adHocMode) {
          data.adHocConnectionActive = true;
        }
        progress(40);
        if (!driver.isLinked()) {
          await driver.temporaryLinkToPump(cfg);
          debug('Linked!');
        }

        debug('Toggle High Speed Mode');
        await driver.toggleHighSpeedMode(HighSpeedModeCommand.HIGH_SPEED_MODE.ENABLE);
        data.pumpHighSpeedMode = true;

        debug('Get pump date/time');
        // If we catch a ChecksumError on the first message that is decrypted,
        // then we probably have a decryption error.
        let pumpTime = null;
        try {
          pumpTime = await driver.getPumpTime();
          // The sequence number for the first message after the HIGH_SPEED_MODE.ENABLE should
          // be 1. If it's not, then we have a decryption error, and something is wrong with the
          // pump link (either paired, or ad hoc)
          if (pumpTime.sequenceNumber !== 1) {
            throw new Error('Could not decrypt message from the pump. Please (re-)link your pump and meter.');
          }
        } catch (firstDecryptedMessageError) {
          throw new Error('Could not decrypt message from the pump. Please (re-)link your pump and meter.');
        }
        // We store the NGPTimestamp, because we need it for later messages.
        settings.currentNgpTimestamp = pumpTime.time;
        settings.currentDeviceTime = pumpTime.time.toDate(cfg.timezone);

        debug('Get pump status');
        const status = await driver.getPumpStatus();
        if (!status.isPumpActive) {
          throw new InvalidStateError('Pump is not active. Please load and prime a reservoir before trying again.');
        }

        settings.activeSchedule =
          NGPUtil.NGPConstants.BASAL_PATTERN_NAME[status.activeBasalPattern - 1];

        debug('Get bolus wizard settings');
        const bwzSettings = await driver.getBolusWizardSettings();
        _.assign(settings, bwzSettings);

        debug('Get Device Characteristics');
        const deviceCharacteristics = await driver.getDeviceCharacteristics();
        settings.pumpSerial = deviceCharacteristics.serial;
        settings.displayBgUnits = deviceCharacteristics.displayUnits;

        debug('Get device string');
        const deviceString = await driver.getDeviceString();
        settings.deviceManufacturers = ['Medtronic'];
        settings.pumpModel = deviceString.string;
        progress(60);

        debug('Read basal patterns');
        const schedules = await driver.readBasalPatterns();
        settings.basalSchedules = schedules;
        progress(80);

        data.settings = _.clone(settings);
        data.deviceModel = data.settings.pumpModel; // for metrics
        cfg.deviceInfo.deviceId = `${data.settings.pumpModel}:${data.settings.pumpSerial}`;
        const getMostRecentUpload = promisify(cfg.api.getMostRecentUploadRecord);
        cfg.lastUpload = await getMostRecentUpload(cfg.groupId, cfg.deviceInfo.deviceId);

        common.checkDeviceTime(pumpTime.time.toDate(), cfg, (err) => {
          progress(100);
          cb(err, data);
        });
      })().catch((error) => {
        debug('Error in getConfigInfo: ', error);
        cb(error, data);
      });
    },

    fetchData(progress, data, cb) {
      if (!isBrowser) {
        data.fetchData = true;
        cb(null, data);
        return;
      }
      debug('in fetchData', data);

      debug('Read pump history');
      let lastPosition = null;
      if (uploadDataPeriod.periodMedtronic600 === uploadDataPeriod.PERIODS.DELTA && _.has(cfg, 'lastUpload.client.private.delta')) {
        debug('--- Only changes since last upload');
        // Retrieve last position from most recent upload record
        lastPosition = sundial.parseFromFormat(cfg.lastUpload.client.private.delta.dataEnd);

        // Always get at least a day back from today, in case we need to amend any
        // temp basals that were in progress.
        const yesterday = new Date(data.settings.currentDeviceTime.valueOf() - 864e5);
        if (lastPosition > yesterday) {
          lastPosition = yesterday;
        }
        cfg.isFirstUpload = false;
      } else if (uploadDataPeriod.periodMedtronic600 === uploadDataPeriod.PERIODS.FOUR_WEEKS) {
        debug('--- Last 4 weeks');
        lastPosition = new Date(new Date().valueOf() - 2419e6); // Four weeks ago
        cfg.isFirstUpload = false;
      } else {
        debug('--- Everything');
        lastPosition = new Date(NGPUtil.NGPTimestamp.pumpBaseTimeMS); // Get full history
        cfg.isFirstUpload = true;
      }

      // Wrap in async, because this function is not async, and we're dealing with other
      // async functions
      (async () => {
        // TODO: do we need to catch this so that we *always* disable High Speed Mode?
        const history = await driver.readHistory(
          data.settings.currentNgpTimestamp.rtcFromDate(lastPosition),
          NGPUtil.NGPTimestamp.maxRTC, progress, 0, 90, cfg.isFirstUpload,
        );
        _.assign(data, history);

        _.merge(cfg, { delta: { dataEnd: history.dataEnd } }); // Will form part of upload record

        if (data.pumpHighSpeedMode) {
          await driver.toggleHighSpeedMode(HighSpeedModeCommand.HIGH_SPEED_MODE.DISABLE);
          data.pumpHighSpeedMode = false;
        }

        progress(100);
        cb(null, data);
      })().catch((error) => {
        debug('Error reading pump history: ', error);
        cb(error, null);
      });
    },

    processData(progress, data, cb) {
      debug('in processData');
      cfg.builder.setDefaults({
        deviceId: cfg.deviceInfo.deviceId,
      });

      let events = [];
      data.post_records = [];

      try {
        const historyParser = new NGPHistoryParser(
          cfg, data.settings,
          data.pages.concat(data.cbg_pages),
        );

        const timeChanges = historyParser.buildTimeChangeRecords();
        _.assign(events, timeChanges.postRecords);
        cfg.tzoUtil = timeChanges.tzoUtil;

        historyParser
          .buildSettingsRecords(events)
          .buildBasalRecords(events)
          .buildTempBasalRecords(events)
          .buildSuspendResumeRecords(events)
          .buildNormalBolusRecords(events)
          .buildSquareBolusRecords(events)
          .buildDualBolusRecords(events)
          .buildWizardWithoutBolusRecords(events)
          .buildRewindRecords(events)
          .buildPrimeRecords(events)
          .buildCGMRecords(events)
          .buildBGRecords(events)
          .buildCalibrationRecords(events);

        events = _.sortBy(events, datum => datum.time);

        // Update delta load information when using the blob_loader.
        if (!isBrowser && _.isUndefined(cfg.delta)) {
          _.merge(
            cfg,
            { delta: { dataEnd: sundial.parseFromFormat(events[events.length - 1].deviceTime) } },
          ); // Will form part of upload record
        }

        const simulator = new Medtronic600Simulator({
          settings: data.settings,
          tzoUtil: cfg.tzoUtil,
          builder: cfg.builder,
        });

        for (const datum of events) {
          simulator.addDatum(datum);
        }

        simulator.finalBasal();
        _.assign(data.post_records, simulator.getEvents());
        progress(100);
        cb(null, data);
      } catch (err) {
        debug('Error while processing data: ', err);
        cb(err, data);
      }
    },

    uploadData(progress, data, cb) {
      progress(0);

      const sessionInfo = {
        delta: cfg.delta,
        deviceTags: cfg.deviceTags,
        deviceManufacturers: data.settings.deviceManufacturers,
        deviceModel: _.replace(data.settings.pumpModel, 'MMT-', ''),
        deviceSerialNumber: data.settings.pumpSerial,
        deviceId: cfg.deviceInfo.deviceId,
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
            cb(err, data);
          } else {
            data.cleanup = true;
            cb(null, data);
          }
        },
      );
    },

    disconnect(progress, data, cb) {
      debug('in disconnect');
      progress(100);
      cb(null, data);
    },

    cleanup(progress, data, cb) {
      debug('in cleanup');

      if (isBrowser) {
        // Wrap in async, because this function is not async, and we're dealing with
        // other async functions
        (async () => {
          if (data.adHocConnectionActive) {
            debug('Closing ad hoc connection to pump');
            await driver.leaveNetwork();
            data.adHocConnectionActive = false;
          }

          if (data.cnlConnection) {
            debug('Closing connection to CNL');
            await driver.closeConnection();
            data.cnlConnection = false;
          }

          try {
            await driver.exitRemoteCommandMode();
          } catch (error) {
            // We don't need to do anything. We're just catching unexpected closing comms.
            debug('Comms close out error', error);
          }

          if (!data.disconnect) {
            await driver.disconnect();
            data.cleanup = true;
            data.disconnect = true;
          }
          progress(100);
          cb(null, data);
        })().catch((error) => {
          debug('Error while cleaning up: ', error);
          cb(error, null);
        });
      } else {
        progress(100);
        cb(null, data);
      }
    },
    /* eslint-enable no-unused-vars */
  };
};
