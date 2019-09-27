/*
 * == BSD2 LICENSE ==
 * Copyright (c) 2016, Tidepool Project
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

/*eslint-env mocha*/

import { expect } from 'chai';

import * as actionTypes from '../../../app/constants/actionTypes';
import { steps } from '../../../app/constants/otherConstants';
import * as uploads from '../../../app/reducers/uploads';

describe('uploads', () => {
  describe('uploadProgress', () => {
    it('should return the initial state', () => {
      expect(uploads.uploadProgress(undefined, {})).to.be.null;
    });

    it('should handle DEVICE_DETECT_REQUEST', () => {
      let initialState = {
        percentage: 0,
        step: steps.start
      };
      let result = uploads.uploadProgress(initialState, {
        type: actionTypes.DEVICE_DETECT_REQUEST
      });
      expect(result).to.deep.equal({
        percentage: 0,
        step: steps.detect
      });
      // test to be sure not *mutating* state object but rather returning new!
      expect(initialState === result).to.be.false;
    });

    it('should handle UPLOAD_FAILURE', () => {
      const initialState = {
        percentage: 0,
        step: steps.detect
      };
      expect(uploads.uploadProgress(initialState, {
        type: actionTypes.UPLOAD_FAILURE
      })).to.be.null;
    });

    it('should handle UPLOAD_PROGRESS', () => {
      let initialState = {
        percentage: 0,
        step: steps.detect
      };
      let result = uploads.uploadProgress(initialState, {
        type: actionTypes.UPLOAD_PROGRESS,
        payload: {percentage: 65, step: steps.uploadData}
      });
      expect(result).to.deep.equal({
        percentage: 65,
        step: steps.uploadData
      });
      // test to be sure not *mutating* state object but rather returning new!
      expect(initialState === result).to.be.false;
    });

    it('should handle UPLOAD_REQUEST', () => {
      expect(uploads.uploadProgress(undefined, {
        type: actionTypes.UPLOAD_REQUEST
      })).to.deep.equal({
        percentage: 0,
        step: steps.start
      });
    });

    it('should handle UPLOAD_SUCCESS', () => {
      const initialState = {
        percentage: 100,
        step: steps.cleanup
      };
      expect(uploads.uploadProgress(initialState, {
        type: actionTypes.UPLOAD_SUCCESS
      })).to.be.null;
    });

    it('should handle UPLOAD_CANCELLED', () => {
      const initialState = {
        percentage: 100,
        step: steps.start
      };
      expect(uploads.uploadProgress(initialState, {
        type: actionTypes.UPLOAD_CANCELLED
      })).to.be.null;
    });
  });

  describe('uploadsByUser', () => {
    const userId = 'a1b2c3', deviceKey = 'a_cgm';
    const filename = 'data.csv';
    const time = '2016-01-01T12:05:00.123Z';
    it('should return the initial state', () => {
      expect(uploads.uploadsByUser(undefined, {})).to.deep.equal({});
    });

    it('should handle CHOOSING_FILE', () => {
      let initialState = {
        [userId]: {
          a_pump: {history: [1,2]},
          [deviceKey]: {history: []}
        }
      };
      let result = uploads.uploadsByUser(initialState, {
        type: actionTypes.CHOOSING_FILE,
        payload: { userId, deviceKey }
      });
      expect(result).to.deep.equal({
        [userId]: {
          a_pump: {disabled: true, history: [1,2]},
          [deviceKey]: {choosingFile: true, history: []}
        },
      });
      // tests to be sure not *mutating* state object but rather returning new!
      expect(initialState === result).to.be.false;
      expect(initialState.a1b2c3 === result.a1b2c3).to.be.false;
      expect(initialState.a1b2c3.a_cgm === result.a1b2c3.a_cgm).to.be.false;
    });

    it('should handle READ_FILE_ABORTED', () => {
      const err = new Error('Wrong file ext!');
      let initialState = {
        [userId]: {
          a_pump: {disabled: true, history: [1,2]},
          [deviceKey]: {choosingFile: true, history: []}
        }
      };
      let result = uploads.uploadsByUser(initialState, {
        type: actionTypes.READ_FILE_ABORTED,
        error: true,
        payload: err
      });
      expect(result).to.deep.equal({
        [userId]: {
          a_pump: {
            disabled: false,
            history: [1,2]
          },
          [deviceKey]: {
            choosingFile: false,
            completed: true,
            error: err,
            failed: true,
            history: []
          }
        }
      });
      // tests to be sure not *mutating* state object but rather returning new!
      expect(initialState === result).to.be.false;
      expect(initialState.a1b2c3 === result.a1b2c3).to.be.false;
      expect(initialState.a1b2c3.a_cgm === result.a1b2c3.a_cgm).to.be.false;
    });

    it('should handle READ_FILE_FAILURE', () => {
      const err = new Error('File read error!');
      let initialState = {
        [userId]: {[deviceKey]: {
          choosingFile: false,
          file: {name: filename},
          history: [],
          readingFile: true
        }}
      };
      let result = uploads.uploadsByUser(initialState, {
        type: actionTypes.READ_FILE_FAILURE,
        error: true,
        payload: err
      });
      expect(result).to.deep.equal({
        [userId]: {[deviceKey]: {
          choosingFile: false,
          completed: true,
          error: err,
          failed: true,
          file: {name: filename},
          history: [],
          readingFile: false
        }}
      });
      // tests to be sure not *mutating* state object but rather returning new!
      expect(initialState === result).to.be.false;
      expect(initialState.a1b2c3 === result.a1b2c3).to.be.false;
      expect(initialState.a1b2c3.a_cgm === result.a1b2c3.a_cgm).to.be.false;
    });

    it('should handle READ_FILE_REQUEST', () => {
      let initialState = {
        [userId]: {[deviceKey]: {choosingFile: true, history: []}}
      };
      let result = uploads.uploadsByUser(initialState, {
        type: actionTypes.READ_FILE_REQUEST,
        payload: { userId, deviceKey, filename }
      });
      expect(result).to.deep.equal({
        [userId]: {[deviceKey]: {
          choosingFile: false,
          file: {name: filename},
          history: [],
          readingFile: true
        }}
      });
      // tests to be sure not *mutating* state object but rather returning new!
      expect(initialState === result).to.be.false;
      expect(initialState.a1b2c3 === result.a1b2c3).to.be.false;
      expect(initialState.a1b2c3.a_cgm === result.a1b2c3.a_cgm).to.be.false;
    });

    it('should handle READ_FILE_SUCCESS', () => {
      const filedata = [1,2,3,4,5];
      let initialState = {
        [userId]: {[deviceKey]: {
          choosingFile: false,
          file: {name: filename},
          history: [],
          readingFile: true
        }}
      };
      let result = uploads.uploadsByUser(initialState, {
        type: actionTypes.READ_FILE_SUCCESS,
        payload: { userId, deviceKey, filedata }
      });
      expect(result).to.deep.equal({
        [userId]: {[deviceKey]: {
          choosingFile: false,
          file: {name: filename, data: filedata},
          history: [],
          readingFile: false
        }}
      });
      // tests to be sure not *mutating* state object but rather returning new!
      expect(initialState === result).to.be.false;
      expect(initialState.a1b2c3 === result.a1b2c3).to.be.false;
      expect(initialState.a1b2c3.a_cgm === result.a1b2c3.a_cgm).to.be.false;
      expect(initialState.a1b2c3.a_cgm.file === result.a1b2c3.a_cgm.file).to.be.false;
    });

    it('should handle RESET_UPLOAD [another upload in progress]', () => {
      let initialState = {
        [userId]: {[deviceKey]: {
          completed: true,
          error: new Error(),
          failed: true,
          history: [{start: time, finish: time, error: true}]
        },
        another_pump: {
          history: [{start: time}],
          uploading: true
        }
      }};
      let result = uploads.uploadsByUser(initialState, {
        type: actionTypes.RESET_UPLOAD,
        payload: { userId, deviceKey }
      });
      expect(result).to.deep.equal({
        [userId]: {[deviceKey]: {
          disabled: true,
          history: [{start: time, finish: time, error: true}]
        },
          another_pump: {
            history: [{start: time}],
            uploading: true
          }
        }
      });
      // tests to be sure not *mutating* state object but rather returning new!
      expect(initialState === result).to.be.false;
      expect(initialState.a1b2c3 === result.a1b2c3).to.be.false;
      expect(initialState.a1b2c3.a_cgm === result.a1b2c3.a_cgm).to.be.false;
    });

    it('should handle RESET_UPLOAD [resetting block mode w/file data]', () => {
      let initialState = {
        [userId]: {[deviceKey]: {
          choosingFile: false,
          completed: true,
          data: [2,4,6],
          file: {data: [1,2,3], name: 'foo.ibf'},
          history: [{start: time, finish: time}],
          readingFile: false,
          successful: true,
          uploading: false
        },
        another_pump: {
          history: [5,10]
        }
      }};
      let result = uploads.uploadsByUser(initialState, {
        type: actionTypes.RESET_UPLOAD,
        payload: { userId, deviceKey }
      });
      expect(result).to.deep.equal({
        [userId]: {[deviceKey]: {
          history: [{start: time, finish: time}]
        },
          another_pump: {
            history: [5,10]
          }
        }
      });
      // tests to be sure not *mutating* state object but rather returning new!
      expect(initialState === result).to.be.false;
      expect(initialState.a1b2c3 === result.a1b2c3).to.be.false;
      expect(initialState.a1b2c3.a_cgm === result.a1b2c3.a_cgm).to.be.false;
    });

    it('should handle RESET_UPLOAD [resetting another when block mode successful not reset]', () => {
      let initialState = {
        [userId]: {[deviceKey]: {
          completed: true,
          data: [8,10],
          history: [{start: time, finish: time}],
          successful: true,
          uploading: false
        },
        another_pump: {
          choosingFile: false,
          completed: true,
          data: [2,4,6],
          file: {data: [1,2,3], name: 'foo.ibf'},
          history: [{start: time, finish: time}],
          readingFile: false,
          successful: true,
          uploading: false
        }
      }};
      let result = uploads.uploadsByUser(initialState, {
        type: actionTypes.RESET_UPLOAD,
        payload: { userId, deviceKey }
      });
      expect(result).to.deep.equal({
        [userId]: {[deviceKey]: {
          history: [{start: time, finish: time}]
        },
          another_pump: {
            choosingFile: false,
            completed: true,
            data: [2,4,6],
            file: {data: [1,2,3], name: 'foo.ibf'},
            history: [{start: time, finish: time}],
            readingFile: false,
            successful: true,
            uploading: false
          }
        }
      });
      // tests to be sure not *mutating* state object but rather returning new!
      expect(initialState === result).to.be.false;
      expect(initialState.a1b2c3 === result.a1b2c3).to.be.false;
      expect(initialState.a1b2c3.a_cgm === result.a1b2c3.a_cgm).to.be.false;
    });

    it('should handle RESET_UPLOAD [upload failed]', () => {
      let initialState = {
        [userId]: {[deviceKey]: {
          completed: true,
          error: new Error(),
          failed: true,
          history: [{start: time, finish: time, error: true}]
        }}
      };
      let result = uploads.uploadsByUser(initialState, {
        type: actionTypes.RESET_UPLOAD,
        payload: { userId, deviceKey }
      });
      expect(result).to.deep.equal({
        [userId]: {[deviceKey]: {
          history: [{start: time, finish: time, error: true}]
        }}
      });
      // tests to be sure not *mutating* state object but rather returning new!
      expect(initialState === result).to.be.false;
      expect(initialState.a1b2c3 === result.a1b2c3).to.be.false;
      expect(initialState.a1b2c3.a_cgm === result.a1b2c3.a_cgm).to.be.false;
    });

    it('should handle RESET_UPLOAD [upload successful]', () => {
      let initialState = {
        [userId]: {[deviceKey]: {
          completed: true,
          history: [{start: time, finish: time}],
          successful: true
        }}
      };
      let result = uploads.uploadsByUser(initialState, {
        type: actionTypes.RESET_UPLOAD,
        payload: { userId, deviceKey }
      });
      expect(result).to.deep.equal({
        [userId]: {[deviceKey]: {
          history: [{start: time, finish: time}]
        }}
      });
      // tests to be sure not *mutating* state object but rather returning new!
      expect(initialState === result).to.be.false;
      expect(initialState.a1b2c3 === result.a1b2c3).to.be.false;
      expect(initialState.a1b2c3.a_cgm === result.a1b2c3.a_cgm).to.be.false;
    });

    it('should handle SET_UPLOADS', () => {
      let initialState = {
        a1b2c3: {a_meter: {history: [1]}, a_cgm: {completed: true, history: [1,2,3]}}
      };
      const actionPayload = {
        devicesByUser: {
          a1b2c3: ['a_pump', 'a_cgm'],
          d4e5f6: ['another_pump']
        }
      };
      let result = uploads.uploadsByUser(initialState, {
        type: actionTypes.SET_UPLOADS,
        payload: actionPayload
      });
      expect(result).to.deep.equal({
        a1b2c3: {
          a_pump: {history: []},
          a_cgm: {completed: true, history: [1,2,3]}
        },
        d4e5f6: {
          another_pump: {history: []}
        }
      });
      // tests to be sure not *mutating* state object but rather returning new!
      expect(initialState === result).to.be.false;
      expect(initialState.a1b2c3 === result.a1b2c3).to.be.false;
    });

    it('should handle TOGGLE_ERROR_DETAILS', () => {
      let initialState = {
        [userId]: {[deviceKey]: {history: []}}
      };
      let result = uploads.uploadsByUser(initialState, {
        type: actionTypes.TOGGLE_ERROR_DETAILS,
        payload: { userId, deviceKey, isVisible: true }
      });
      expect(result).to.deep.equal({
        [userId]: {[deviceKey]: {history: [], showErrorDetails: true}}
      });
      // tests to be sure not *mutating* state object but rather returning new!
      expect(initialState === result).to.be.false;
      expect(initialState.a1b2c3 === result.a1b2c3).to.be.false;
      expect(initialState.a1b2c3.a_cgm === result.a1b2c3.a_cgm).to.be.false;
      let result2 = uploads.uploadsByUser(initialState, {
        type: actionTypes.TOGGLE_ERROR_DETAILS,
        payload: { userId, deviceKey, isVisible: false }
      });
      expect(result2).to.deep.equal({
        [userId]: {[deviceKey]: {history: [], showErrorDetails: false}}
      });
      // tests to be sure not *mutating* state object but rather returning new!
      expect(initialState === result2).to.be.false;
      expect(initialState.a1b2c3 === result2.a1b2c3).to.be.false;
      expect(initialState.a1b2c3.a_cgm === result2.a1b2c3.a_cgm).to.be.false;
    });

    it('should handle UPLOAD_FAILURE', () => {
      let err = new Error('Upload Error!');
      err.utc = time;
      let initialState = {
        [userId]: {
          a_pump: {disabled: true, history: []},
          [deviceKey]: {
            history: [{start: time},1,2,3],
            uploading: true
          }
        },
        d4e5f6: {
          another_pump: {history: []}
        }
      };
      let result = uploads.uploadsByUser(initialState, {
        type: actionTypes.UPLOAD_FAILURE,
        error: true,
        payload: err
      });
      expect(result).to.deep.equal({
        [userId]: {
          a_pump: {history: []},
          [deviceKey]: {
            completed: true,
            error: err,
            failed: true,
            history: [{start: time, finish: time, error: true}, 1, 2, 3],
            uploading: false
          }
        },
        d4e5f6: {
          another_pump: {history: []}
        }
      });
      // tests to be sure not *mutating* state object but rather returning new!
      expect(initialState === result).to.be.false;
      expect(initialState.a1b2c3 === result.a1b2c3).to.be.false;
      expect(initialState.a1b2c3.a_cgm === result.a1b2c3.a_cgm).to.be.false;
      expect(initialState.a1b2c3.a_cgm.history === result.a1b2c3.a_cgm.history).to.be.false;
      expect(initialState.a1b2c3.a_cgm.history[0] === result.a1b2c3.a_cgm.history[0]).to.be.false;
    });

    it('should handle UPLOAD_REQUEST', () => {
      let initialState = {
        [userId]: {
          a_pump: {history: []},
          [deviceKey]: {history: [1,2,3]}
        }
      };
      let result = uploads.uploadsByUser(initialState, {
        type: actionTypes.UPLOAD_REQUEST,
        payload: { userId, deviceKey, utc: time }
      });
      expect(result).to.deep.equal({
        [userId]: {
          a_pump: {disabled: true, history: []},
          [deviceKey]: {
            history: [{start: time},1,2,3],
            uploading: true
          }
        }
      });
      // tests to be sure not *mutating* state object but rather returning new!
      expect(initialState === result).to.be.false;
      expect(initialState.a1b2c3 === result.a1b2c3).to.be.false;
      expect(initialState.a1b2c3.a_cgm === result.a1b2c3.a_cgm).to.be.false;
    });

    it('should handle UPLOAD_SUCCESS', () => {
      const data = [1,2,3,4,5];
      let initialState = {
        [userId]: {
          a_pump: {disabled: true, history: []},
          [deviceKey]: {
            history: [{start: time},1,2,3],
            uploading: true
          }
        },
        d4e5f6: {
          another_pump: {history: []}
        }
      };
      let result = uploads.uploadsByUser(initialState, {
        type: actionTypes.UPLOAD_SUCCESS,
        payload: { userId, deviceKey, data, utc: time}
      });
      expect(result).to.deep.equal({
        [userId]: {
          a_pump: {history: []},
          [deviceKey]: {
            completed: true,
            data: data,
            history: [{start: time, finish: time}, 1, 2, 3],
            successful: true,
            uploading: false
          }
        },
        d4e5f6: {
          another_pump: {history: []}
        }
      });
      // tests to be sure not *mutating* state object but rather returning new!
      expect(initialState === result).to.be.false;
      expect(initialState.a1b2c3 === result.a1b2c3).to.be.false;
      expect(initialState.a1b2c3.a_cgm === result.a1b2c3.a_cgm).to.be.false;
      expect(initialState.a1b2c3.a_cgm.history === result.a1b2c3.a_cgm.history).to.be.false;
      expect(initialState.a1b2c3.a_cgm.history[0] === result.a1b2c3.a_cgm.history[0]).to.be.false;
    });

    it('should handle UPLOAD_CANCELLED', () => {
      const data = [1,2,3,4,5];
      let initialState = {
        [userId]: {
          a_pump: {disabled: true, history: []},
          [deviceKey]: {
            history: [{start: time},1,2,3],
            uploading: true
          }
        },
        d4e5f6: {
          another_pump: {history: []}
        }
      };
      let result = uploads.uploadsByUser(initialState, {
        type: actionTypes.UPLOAD_CANCELLED,
        payload: { utc: time }
      });
      expect(result).to.deep.equal({
        [userId]: {
          a_pump: {history: []},
          [deviceKey]: {
            completed: true,
            failed: false,
            history: [{start: time, finish: time}, 1, 2, 3],
            uploading: false
          }
        },
        d4e5f6: {
          another_pump: {history: []}
        }
      });
      // tests to be sure not *mutating* state object but rather returning new!
      expect(initialState === result).to.be.false;
      expect(initialState.a1b2c3 === result.a1b2c3).to.be.false;
      expect(initialState.a1b2c3.a_cgm === result.a1b2c3.a_cgm).to.be.false;
      expect(initialState.a1b2c3.a_cgm.history === result.a1b2c3.a_cgm.history).to.be.false;
      expect(initialState.a1b2c3.a_cgm.history[0] === result.a1b2c3.a_cgm.history[0]).to.be.false;
    });

    it('should handle ADD_TARGET_DEVICE', () => {
      let initialState = {
        a1b2c3: {
          a_meter: {history: [1]},
          a_cgm: {completed: true, history: [1,2,3]}
        }
      };
      const actionPayload = {
        userId: 'd4e5f6',
        deviceKey: 'another_pump'
      };
      let result = uploads.uploadsByUser(initialState, {
        type: actionTypes.ADD_TARGET_DEVICE,
        payload: actionPayload
      });
      expect(result).to.deep.equal({
        a1b2c3: {
          a_meter: {history: [1]},
          a_cgm: {completed: true, history: [1,2,3]}
        },
        d4e5f6: {
          another_pump: {history: []}
        }
      });
      // tests to be sure not *mutating* state object but rather returning new!
      expect(initialState === result).to.be.false;
    });

    it('should handle REMOVE_TARGET_DEVICE', () => {
      let initialState = {
        a1b2c3: {
          a_meter: {history: [1]},
          a_cgm: {completed: true, history: [1,2,3]}
        }
      };
      const actionPayload = {
        userId: 'a1b2c3',
        deviceKey: 'a_meter'
      };
      let result = uploads.uploadsByUser(initialState, {
        type: actionTypes.REMOVE_TARGET_DEVICE,
        payload: actionPayload
      });
      expect(result).to.deep.equal({
        a1b2c3: {
          a_cgm: {completed: true, history: [1,2,3]}
        }
      });
      // tests to be sure not *mutating* state object but rather returning new!
      expect(initialState === result).to.be.false;
      expect(initialState.a1b2c3 === result.a1b2c3).to.be.false;
    });

    it('should handle LOGIN_SUCCESS', () => {
      let initialState = {};
      const actionPayload = {
        memberships: [
          {profile: {
            fullName: 'Joe',
            patient: {
              targetDevices: ['a_meter', 'a_cgm']
            }
          }, userid: 'abc123'}
        ]
      };
      let result = uploads.uploadsByUser(initialState, {
        type: actionTypes.LOGIN_SUCCESS,
        payload: actionPayload
      });
      expect(result).to.deep.equal({
        abc123: {
          a_cgm: {history:[]},
          a_meter: {history:[]}
        }
      });
      // tests to be sure not *mutating* state object but rather returning new!
      expect(initialState === result).to.be.false;
    });

    it('should handle SET_USER_INFO_FROM_TOKEN', () => {
      let initialState = {};
      const actionPayload = {
        memberships: [
          {profile: {
            fullName: 'Joe',
            patient: {
              targetDevices: ['a_meter', 'a_cgm']
            }
          }, userid: 'abc123'}
        ]
      };
      let result = uploads.uploadsByUser(initialState, {
        type: actionTypes.SET_USER_INFO_FROM_TOKEN,
        payload: actionPayload
      });
      expect(result).to.deep.equal({
        abc123: {
          a_cgm: {history:[]},
          a_meter: {history:[]}
        }
      });
      // tests to be sure not *mutating* state object but rather returning new!
      expect(initialState === result).to.be.false;
    });


  });

  describe('uploadTargetDevice', () => {
    const userId = 'a1b2c3', deviceKey = 'a_pump';
    const time = '2016-01-01T12:05:00.123Z';
    it('should return the initial state', () => {
      expect(uploads.uploadTargetDevice(undefined, {})).to.be.null;
    });

    it('should handle CHOOSING_FILE', () => {
      expect(uploads.uploadTargetDevice(undefined, {
        type: actionTypes.CHOOSING_FILE,
        payload: { deviceKey }
      })).to.equal(deviceKey);
      expect(uploads.uploadTargetDevice('a_cgm', {
        type: actionTypes.CHOOSING_FILE,
        payload: { deviceKey }
      })).to.equal(deviceKey);
    });

    it('should handle READ_FILE_ABORTED', () => {
      expect(uploads.uploadTargetDevice(deviceKey, {
        type: actionTypes.READ_FILE_ABORTED
      })).to.be.null;
    });

    it('should handle READ_FILE_FAILURE', () => {
      expect(uploads.uploadTargetDevice(deviceKey, {
        type: actionTypes.READ_FILE_FAILURE
      })).to.be.null;
    });

    it('should handle UPLOAD_FAILURE', () => {
      expect(uploads.uploadTargetDevice('a_pump', {
        type: actionTypes.UPLOAD_FAILURE
      })).to.be.null;
    });

    it('should handle UPLOAD_REQUEST', () => {
      expect(uploads.uploadTargetDevice(undefined, {
        type: actionTypes.UPLOAD_REQUEST,
        payload: { userId, deviceKey, utc: time}
      })).to.equal(deviceKey);
    });

    it('should handle UPLOAD_SUCCESS', () => {
      expect(uploads.uploadTargetDevice('a_pump', {
        type: actionTypes.UPLOAD_SUCCESS
      })).to.be.null;
    });
  });
});
