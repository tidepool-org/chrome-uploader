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

var _ = require('lodash');
var async = require('async');

if (!(process.env.NODE_ENV === 'test')) {
  // libusb is not available when testing on CI environments

  var usb = require('usb');
  var UsbCdcAcm = require('usb-cdc-acm');
  var PL2303 = require('pl2303');
  var CP2102 = require('cp2102');
  var FTDI = require('ftdi-js');
  // var TUSB3410 = require('tusb3410'); TODO: waiting on upstream fix: https://github.com/tessel/node-usb/issues/159
}
var debug = require('bows')('SerialDevice');

module.exports = function(config) {
  config = config || {};
  var connection = null;
  var connectionPort = null;
  var buffer = [];
  var packetBuffer = [];
  var packetHandler = null;
  var errorHandler = null;
  var bitrate = config.bitrate || 9600;
  var RETRIES = 8;
  var TIME_TO_WAIT = 2000;
  var reader = null;
  var keepReading = null;

  function init() {
    connection = null;
    connectionPort = null;
    buffer = [];
    packetBuffer = [];
    packetHandler = null;
    reader = null;
    keepReading = true;
  }

  init();

  // This is the object that is passed to the packetHandler
  // it lets us abstract away the details of the packetHandling
  var bufobj = {
    // get(x) -- returns char at x
    get : function(n) {return buffer[n]; },
    // len() -- returns length
    len : function() { return buffer.length; },
    // discard(n) -- deletes n chars at start of buffer
    discard : function(n) { discardBytes(n); },
    // bytes() -- returns entire buffer as a Uint8Array
    bytes : function() {
      return new Uint8Array(buffer);
    },
    contains : function(n) {
      return (buffer.indexOf(n) !== -1) ? true : false;
    }
  };

  function _receiveSomeBytes(bufView) {
    for (var i=0; i<bufView.byteLength; i++) {
      buffer.push(bufView[i]);
    }

    // we got some bytes, let's see if they make one or more packets
    if (packetHandler) {
      var pkt = packetHandler(bufobj);
      while (pkt) {
        packetBuffer.push(pkt);
        pkt = packetHandler(bufobj);
      }
    }
  }

  function portListener(data) {
    if (connection && data) {
      var bufView = new Uint8Array(data);
      _receiveSomeBytes(bufView);
    }
  }

  async function webSerialListener() {
    while (connection.readable && keepReading) {
      reader = connection.readable.getReader();

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }
          if (value) {
            _receiveSomeBytes(value);
          }
        }
      } catch (error) {
        console.log('Non-fatal read error:', error);
      } finally {
        if (reader) {
          reader.releaseLock();
        }
      }
    }
  }

  // if an errorHandler was specified, then we call it with every error.
  // If it returns anything, it should return either a string or an array
  // containing the bytes it wants to insert into the buffer.
  function errorListener(info) {
    if (info.error && errorHandler) {
      var bytes = errorHandler(info);
      var bufView = new Uint8Array(bytes.length);
      for (var i=0; i<bytes.length; i++) {
        if (_.isString(bytes)) {
          bufView[i] = bytes.charCodeAt(i);
        } else if (_.isArray(bytes)) {
          bufView[i] = bytes[i];
        }
      }
      _receiveSomeBytes(bufView);
    }
  }

  function connect(deviceInfo, handler, cb) {
    if (arguments.length != 3) {
      console.log('serial connect called with wrong number of arguments!');
    }

    // If the driver specifies a bitrate override, we have to use it
    if (!!deviceInfo.bitrate) {
      bitrate = deviceInfo.bitrate;
    }

    debug('in SerialDevice.connect, info ', deviceInfo);

    var connectopts = {
      baudRate: bitrate,
      autoOpen: false,
    };

    function openPort(cb) {
      let closed = null;

      if (deviceInfo.port) {
        (async () => {
          debug(`Connecting using Web Serial API using ${JSON.stringify(connectopts)}..`);
          await deviceInfo.port.open(connectopts);

          if (deviceInfo.ctsFlowControl) {
            debug('Setting flow control...');
            await deviceInfo.port.setSignals({ dataTerminalReady: false, requestToSend: true });
          }

          connection = deviceInfo.port;
          closed = webSerialListener();
        })().then(() => {
          return cb();
        }).catch(async (error) => {
          debug('Error during Serial API connect:', error);
          if (reader) {
            reader.cancel();
          }
          await closed;
          if (connection) {
            await connection.close();
          }
          return cb(error, null);
        });
      } else {
        debug('Connecting via user space driver');

        switch(deviceInfo.userSpaceDriver) {
          case 'pl2303':
            connection = new PL2303(connectopts);
            connection.on('ready', function () {
              return cb();
            });
            break;
          case 'cdc-acm':
            var device = usb.findByIds( deviceInfo.vendorId, deviceInfo.productId );
            device.open();
            connection = UsbCdcAcm.fromUsbDevice(device, connectopts);
            connection.cdcAcm = device;
            return cb();
            break;
          case 'cp2102':
            connection = new CP2102(deviceInfo.vendorId, deviceInfo.productId, connectopts);
            connection.on('ready', function () {
              return cb();
            });
            break;
            case 'ftdi':
              connection = new FTDI(deviceInfo.vendorId, deviceInfo.productId, connectopts);
              connection.on('error', function (err) {
                return cb(err);
              });
              connection.on('ready', function () {
                return cb();
              });
            break;
            /* TODO: waiting on upstream fix, see top of file for details
          case 'tusb3410':
            connection = new TUSB3410(deviceInfo.vendorId, deviceInfo.productId, connectopts);
            connection.on('ready', function () {
              return cb();
            });
            break;
            */
          default:
            debug('User-space driver not yet implemented for this device.');
            return cb(new Error('No available user-space driver.'));
        }
      }
    }

    /*
    Due to a possible race condition that can occur in node-serialport (see
    https://github.com/node-serialport/node-serialport/issues/1565), we first
    need to make sure we can open the serial port. Can take multiple attempts.
    */
    async.retry({times: RETRIES, interval: TIME_TO_WAIT}, openPort, function(err) {

      if (err || connection == null) {
        return cb(new Error('Could not connect to the device: ' + err));
      }

      if (_.isFunction(handler)) {
        setPacketHandler(handler);
      } else if (_.isObject(handler)) {
        setPacketHandler(handler.packetHandler);
        if (handler.errorHandler) {
          setErrorHandler(handler.errorHandler);
          connection.on('error', function (err) {
            errorListener(err);
          });
        }
      }

      if (deviceInfo.userSpaceDriver) {
        connection.userSpaceDriver = deviceInfo.userSpaceDriver;

        debug('connected via ' + deviceInfo.userSpaceDriver);
        // add a listener for any serial traffic
        connection.on('data', function (data) {
          portListener(data);
        });
      }

      return cb();
    });
  }

  function disconnect(cb) {
    if (connection) {
      if (connection.cdcAcm) {
        connection.destroy();
        init();
        return cb();
      }
      if (reader) {
        (async () => {
          keepReading = false;
          await reader.cancel();
          await connection.close();
          init();
          if (cb) {
            cb();
          }
        })().catch((error) => {
          debug('Error during Serial API close:', error);
          if (cb) {
            cb(error);
          }
        });
      } else {
        connection.close(function(err) {
          init();
          if (cb) {
            cb(err);
          }
        });
      }
    } else {
      if (cb) {
        cb(null);
      }
    }
  }

  function discardBytes(discardCount) {
    buffer = buffer.slice(discardCount);
  }

  function readSerial(bytes, timeout, callback) {
    var packet;
    if (buffer.length >= bytes) {
      packet = buffer.slice(0,bytes);
      buffer = buffer.slice(0 - bytes);
      callback(packet);
    } else if (timeout === 0) {
      packet = buffer;
      buffer = [];
      callback(packet);
    } else {
      setTimeout(function() {
        readSerial(bytes, 0, callback);
      }, timeout);
    }
  }

  function writeSerial(bytes, callback) {
    var bufView = new Uint8Array(bytes);

    if (bytes == null) {
      debug('just tried to send nothing!');
    } else {
      if(connection == null) {
        debug('No connection details available.');
        callback(new Error('No connection details available.'));
      } else {
        if (connection.userSpaceDriver === 'pl2303') {
          connection.send(Buffer.from(bytes));
          callback();
        } else if (connection.writable && !connection.userSpaceDriver) {
          // hey, we're using the web serial API!
          (async () => {
            const writer = connection.writable.getWriter();
            await writer.write(bufView);
            // Allow the serial port to be closed later.
            writer.releaseLock();
          })().then(() => {
            return callback();
          }).catch((error) => {
            debug('Error during Serial API write:', error);
            return callback(error, null);
          });
        } else {
          connection.write(Buffer.from(bytes), function(err) {
            if(err) {
              return callback(err);
            }
            callback();
          });
        }
      }
    }
  }

  // a handler should be a function that takes a parameter of a buffer
  // and tries to extract a packet from it; if it finds one, it should delete
  // the characters that make up the packet from the buffer, and return the
  // packet.
  function setPacketHandler(handler) {
    packetHandler = handler;
  }

  function clearPacketHandler() {
    packetHandler = null;
  }

  function setErrorHandler(handler) {
    errorHandler = handler;
  }

  function clearErrorHandler() {
    errorHandler = null;
  }

  function hasAvailablePacket() {
    return packetBuffer.length > 0;
  }

  function peekPacket() {
    if (hasAvailablePacket()) {
      return packetBuffer[0];
    } else {
      return null;
    }
  }

  function nextPacket() {
    if (hasAvailablePacket()) {
      return packetBuffer.shift();
    } else {
      return null;
    }
  }

  function flush() {
    debug('clearing buffers..');
    packetBuffer = [];
    buffer = [];
  }

  return {
    connect: connect,
    disconnect: disconnect,
    discardBytes: discardBytes,
    readSerial: readSerial,
    writeSerial: writeSerial,
    setPacketHandler: setPacketHandler,
    clearPacketHandler: clearPacketHandler,
    setErrorHandler: setErrorHandler,
    clearErrorHandler: clearErrorHandler,
    hasAvailablePacket: hasAvailablePacket,
    peekPacket: peekPacket,
    nextPacket: nextPacket,
    flush: flush,
  };

};
