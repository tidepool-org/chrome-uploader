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

/*eslint-env mocha*/

import { isFSA } from 'flux-standard-action';
import { expect } from 'chai';

import * as actionSources from '../../../app/constants/actionSources';
import * as actionTypes from '../../../app/constants/actionTypes';
import * as metrics from '../../../app/constants/metrics';

import * as syncActions from '../../../app/actions/sync';
import { __Rewire__, __ResetDependency__ } from '../../../app/actions/sync';
import { UnsupportedError } from '../../../app/utils/errors';
import errorText from '../../../app/constants/errors';

describe('Synchronous Actions', () => {
  describe('addTargetDevice', () => {
    const DEVICE = 'a_pump', ID = 'a1b2c3';
    it('should be an FSA', () => {
      let action = syncActions.addTargetDevice(ID, DEVICE);

      expect(isFSA(action)).to.be.true;
    });

    it('should create an action to add a device to a user\'s target devices', () => {
      const expectedAction = {
        type: actionTypes.ADD_TARGET_DEVICE,
        payload: {userId: ID, deviceKey: DEVICE},
        meta: {source: actionSources[actionTypes.ADD_TARGET_DEVICE]}
      };
      expect(syncActions.addTargetDevice(ID, DEVICE)).to.deep.equal(expectedAction);
    });
  });

  describe('clickGoToBlip', () => {
    it('should be an FSA', () => {
      let action = syncActions.clickGoToBlip();

      expect(isFSA(action)).to.be.true;
    });

    it('should create an action to report a user\'s clicking of the \'Go to Blip\' button', () => {
      const expectedAction = {
        type: actionTypes.CLICK_GO_TO_BLIP,
        meta: {
          source: actionSources[actionTypes.CLICK_GO_TO_BLIP],
          metric: {eventName: metrics.CLICK_GO_TO_BLIP}
        }
      };

      expect(syncActions.clickGoToBlip()).to.deep.equal(expectedAction);
    });
  });

  describe('clinicAddMrn', () => {
    it('should be an FSA', () => {
      let action = syncActions.clinicAddMrn();

      expect(isFSA(action)).to.be.true;
    });

    it('should create an action to report a clinic adding an MRN to a patient', () => {
      const expectedAction = {
        type: actionTypes.CLINIC_ADD_MRN,
        meta: {
          source: actionSources[actionTypes.CLINIC_ADD_MRN],
          metric: {eventName: metrics.CLINIC_ADD_MRN}
        }
      };

      expect(syncActions.clinicAddMrn()).to.deep.equal(expectedAction);
    });
  });

  describe('clinicAddEmail', () => {
    it('should be an FSA', () => {
      let action = syncActions.clinicAddEmail();

      expect(isFSA(action)).to.be.true;
    });

    it('should create an action to report a clinic adding an email to a patient', () => {
      const expectedAction = {
        type: actionTypes.CLINIC_ADD_EMAIL,
        meta: {
          source: actionSources[actionTypes.CLINIC_ADD_EMAIL],
          metric: {eventName: metrics.CLINIC_ADD_EMAIL}
        }
      };

      expect(syncActions.clinicAddEmail()).to.deep.equal(expectedAction);
    });
  });

  describe('clinicAddDevice', () => {
    it('should be an FSA', () => {
      let action = syncActions.clinicAddDevice();

      expect(isFSA(action)).to.be.true;
    });

    it('should create an action to report a clinic adding a device', () => {
      const expectedAction = {
        type: actionTypes.CLINIC_DEVICE_STORED,
        meta: {
          source: actionSources[actionTypes.CLINIC_DEVICE_STORED],
          metric: {eventName: metrics.CLINIC_DEVICE_STORED + ' - ' + 'device'}
        }
      };

      expect(syncActions.clinicAddDevice('device')).to.deep.equal(expectedAction);
    });
  });

  describe('clinicInvalidDate', () => {
    it('should be an FSA', () => {
      let action = syncActions.clinicInvalidDate({year:'error'});

      expect(isFSA(action)).to.be.true;
    });

    it('should create an action to report a clinic setting an invalid date', () => {
      const expectedAction = {
        type: actionTypes.CLINIC_ADD_INVALID_DATE,
        meta: {
          source: actionSources[actionTypes.CLINIC_ADD_INVALID_DATE],
          metric: {eventName: metrics.CLINIC_ADD_INVALID_DATE}
        }
      };

      expect(syncActions.clinicInvalidDate({year:'error'})).to.deep.equal(expectedAction);
    });

    it('should not creat an action to report no error', () => {
      expect(syncActions.clinicInvalidDate()).to.be.undefined;
    });
  });

  describe('hideUnavailableDevices', () => {
    const OS = 'test';
    it('should be an FSA', () => {
      let action = syncActions.hideUnavailableDevices(OS);

      expect(isFSA(action)).to.be.true;
    });

    it('should create an action to hide devices unavailable on given operating system', () => {
      const expectedAction = {
        type: actionTypes.HIDE_UNAVAILABLE_DEVICES,
        payload: {os: OS},
        meta: {source: actionSources[actionTypes.HIDE_UNAVAILABLE_DEVICES]}
      };
      expect(syncActions.hideUnavailableDevices(OS)).to.deep.equal(expectedAction);
    });
  });

  describe('removeTargetDevice', () => {
    const DEVICE = 'a_pump', ID = 'a1b2c3';
    it('should be an FSA', () => {
      let action = syncActions.removeTargetDevice(ID, DEVICE);

      expect(isFSA(action)).to.be.true;
    });

    it('should create an action to remove a device from a user\'s target devices', () => {
      const expectedAction = {
        type: actionTypes.REMOVE_TARGET_DEVICE,
        payload: {userId: ID, deviceKey: DEVICE},
        meta: {source: actionSources[actionTypes.REMOVE_TARGET_DEVICE]}
      };
      expect(syncActions.removeTargetDevice(ID, DEVICE)).to.deep.equal(expectedAction);
    });
  });

  describe('resetUpload', () => {
    const userId = 'a1b2c3', deviceKey = 'a_pump';
    it('should be an FSA', () => {
      let action = syncActions.resetUpload(userId, deviceKey);

      expect(isFSA(action)).to.be.true;
    });

    it('should create an action to reset an upload after failure or success', () => {
      const expectedAction = {
        type: actionTypes.RESET_UPLOAD,
        payload: { userId, deviceKey },
        meta: {source: actionSources[actionTypes.RESET_UPLOAD]}
      };
      expect(syncActions.resetUpload(userId, deviceKey)).to.deep.equal(expectedAction);
    });
  });

  describe('setBlipViewDataUrl', () => {
    const url = 'http://acme-blip.com/patients/a1b2c3/data';
    it('should be an FSA', () => {
      let action = syncActions.setBlipViewDataUrl(url);

      expect(isFSA(action)).to.be.true;
    });

    it('should create an action set the url for viewing data in blip (wrt current uploadTargetUser)', () => {
      const expectedAction = {
        type: actionTypes.SET_BLIP_VIEW_DATA_URL,
        payload: { url },
        meta: {source: actionSources[actionTypes.SET_BLIP_VIEW_DATA_URL]}
      };

      expect(syncActions.setBlipViewDataUrl(url)).to.deep.equal(expectedAction);
    });
  });

  describe('setForgotPasswordUrl', () => {
    const URL = 'http://www.acme.com/forgot-password';
    it('should be an FSA', () => {
      let action = syncActions.setForgotPasswordUrl(URL);

      expect(isFSA(action)).to.be.true;
    });

    it('should create an action to set the forgot password url', () => {
      const expectedAction = {
        type: actionTypes.SET_FORGOT_PASSWORD_URL,
        payload: {url: URL},
        meta: {source: actionSources[actionTypes.SET_FORGOT_PASSWORD_URL]}
      };
      expect(syncActions.setForgotPasswordUrl(URL)).to.deep.equal(expectedAction);
    });
  });

  describe('setSignUpUrl', () => {
    const URL = 'http://www.acme.com/sign-up';
    it('should be an FSA', () => {
      let action = syncActions.setSignUpUrl(URL);

      expect(isFSA(action)).to.be.true;
    });

    it('should create an action to set the sign-up url', () => {
      const expectedAction = {
        type: actionTypes.SET_SIGNUP_URL,
        payload: {url: URL},
        meta: {source: actionSources[actionTypes.SET_SIGNUP_URL]}
      };
      expect(syncActions.setSignUpUrl(URL)).to.deep.equal(expectedAction);
    });
  });

  describe('setNewPatientUrl', () => {
    const URL = 'http://www.acme.com/patients/new';
    it('should be an FSA', () => {
      let action = syncActions.setNewPatientUrl(URL);

      expect(isFSA(action)).to.be.true;
    });

    it('should create an action to set the new patient url', () => {
      const expectedAction = {
        type: actionTypes.SET_NEW_PATIENT_URL,
        payload: {url: URL},
        meta: {source: actionSources[actionTypes.SET_NEW_PATIENT_URL]}
      };
      expect(syncActions.setNewPatientUrl(URL)).to.deep.equal(expectedAction);
    });
  });

  describe('setTargetTimezone', () => {
    const TIMEZONE = 'Europe/Budapest', ID = 'a1b2c3';
    it('should be an FSA', () => {
      let action = syncActions.setTargetTimezone(ID, TIMEZONE);

      expect(isFSA(action)).to.be.true;
    });

    it('should create an action to set the target timezone for a user', () => {
      const expectedAction = {
        type: actionTypes.SET_TARGET_TIMEZONE,
        payload: {userId: ID, timezoneName: TIMEZONE},
        meta: {source: actionSources[actionTypes.SET_TARGET_TIMEZONE]}
      };
      expect(syncActions.setTargetTimezone(ID, TIMEZONE)).to.deep.equal(expectedAction);
    });
  });

  describe('setUploads', () => {
    const devicesByUser = {
      a1b2c3: {a_pump: {}, a_cgm: {}},
      d4e5f6: {another_pump: {}}
    };
    it('should be an FSA', () => {
      let action = syncActions.setUploads(devicesByUser);

      expect(isFSA(action)).to.be.true;
    });

    it('should create an action to set up the potential uploads for each user reflecting target devices selected', () => {
      const expectedAction = {
        type: actionTypes.SET_UPLOADS,
        payload: { devicesByUser },
        meta: {source: actionSources[actionTypes.SET_UPLOADS]}
      };
      expect(syncActions.setUploads(devicesByUser)).to.deep.equal(expectedAction);
    });
  });

  describe('setUploadTargetUser', () => {
    const ID = 'a1b2c3';
    it('should be an FSA', () => {
      let action = syncActions.setUploadTargetUser(ID);

      expect(isFSA(action)).to.be.true;
    });

    it('should create an action to set the target user for data upload', () => {
      const expectedAction = {
        type: actionTypes.SET_UPLOAD_TARGET_USER,
        payload: {userId: ID},
        meta: {source: actionSources[actionTypes.SET_UPLOAD_TARGET_USER]}
      };
      expect(syncActions.setUploadTargetUser(ID)).to.deep.equal(expectedAction);
    });
  });

  describe('toggleDropdown', () => {
    const DROPDOWN_PREVIOUS_STATE = true;
    it('should be an FSA', () => {
      let action = syncActions.toggleDropdown(DROPDOWN_PREVIOUS_STATE);

      expect(isFSA(action)).to.be.true;
    });

    it('should create an action to toggle the dropdown menu', () => {
      const expectedAction = {
        type: actionTypes.TOGGLE_DROPDOWN,
        payload: {isVisible: false},
        meta: {source: actionSources[actionTypes.TOGGLE_DROPDOWN]}
      };
      expect(syncActions.toggleDropdown(DROPDOWN_PREVIOUS_STATE)).to.deep.equal(expectedAction);
    });

    it('should accept a second parameter to override the default action source', () => {
      const expectedAction = {
        type: actionTypes.TOGGLE_DROPDOWN,
        payload: {isVisible: false},
        meta: {source: actionSources.UNDER_THE_HOOD}
      };
      expect(syncActions.toggleDropdown(DROPDOWN_PREVIOUS_STATE, actionSources.UNDER_THE_HOOD)).to.deep.equal(expectedAction);
    });
  });

  describe('toggleErrorDetails', () => {
    const DETAILS_PREVIOUS_STATE = true;
    const userId = 'a1b2c3', deviceKey = 'a_cgm';
    it('should be an FSA', () => {
      let action = syncActions.toggleErrorDetails(userId, deviceKey, DETAILS_PREVIOUS_STATE);

      expect(isFSA(action)).to.be.true;
    });

    it('should create an action to toggle error details for an upload', () => {
      const expectedAction = {
        type: actionTypes.TOGGLE_ERROR_DETAILS,
        payload: {isVisible: false, userId, deviceKey },
        meta: {source: actionSources[actionTypes.TOGGLE_ERROR_DETAILS]}
      };
      expect(syncActions.toggleErrorDetails(userId, deviceKey, DETAILS_PREVIOUS_STATE)).to.deep.equal(expectedAction);
    });

    it('should toggle on error details if previous state is undefined', () => {
      const expectedAction = {
        type: actionTypes.TOGGLE_ERROR_DETAILS,
        payload: {isVisible: true, userId, deviceKey },
        meta: {source: actionSources[actionTypes.TOGGLE_ERROR_DETAILS]}
      };
      expect(syncActions.toggleErrorDetails(userId, deviceKey, undefined)).to.deep.equal(expectedAction);
    });
  });

  describe('for doAppInit', () => {
    describe('initRequest', () => {
      it('should be an FSA', () => {
        let action = syncActions.initRequest();

        expect(isFSA(action)).to.be.true;
      });

      it('should create an action to record the start of app initialization', () => {
        const expectedAction = {
          type: actionTypes.INIT_APP_REQUEST,
          meta: {source: actionSources[actionTypes.INIT_APP_REQUEST]}
        };
        expect(syncActions.initRequest()).to.deep.equal(expectedAction);
      });
    });

    describe('initSuccess', () => {
      it('should be an FSA', () => {
        let action = syncActions.initSuccess();

        expect(isFSA(action)).to.be.true;
      });

      it('should create an action to record the successful completion of app initialization', () => {
        const expectedAction = {
          type: actionTypes.INIT_APP_SUCCESS,
          meta: {source: actionSources[actionTypes.INIT_APP_SUCCESS]}
        };
        expect(syncActions.initSuccess()).to.deep.equal(expectedAction);
      });
    });

    describe('initFailure', () => {
      const err = new Error();
      it('should be an FSA', () => {
        let action = syncActions.initFailure(err);

        expect(isFSA(action)).to.be.true;
      });

      it('should create an action to record early exit from app initialization due to error', () => {
        const expectedAction = {
          type: actionTypes.INIT_APP_FAILURE,
          error: true,
          payload: new Error(errorText.E_INIT),
          meta: {source: actionSources[actionTypes.INIT_APP_FAILURE]}
        };
        const action = syncActions.initFailure(err);
        expect(action.payload).to.deep.include({message:errorText.E_INIT});
        expectedAction.payload = action.payload;
        expect(action).to.deep.equal(expectedAction);
      });
    });

    describe('setUserInfoFromToken', () => {
      // NB: this is not what these objects actually look like
      // actual shape is irrelevant to testing action creators
      const user = {userid: 'abc123'};
      const profile = {fullName: 'Jane Doe'};
      const memberships = [{userid: 'def456'}, {userid: 'ghi789'}];
      it('should be an FSA', () => {
        let action = syncActions.setUserInfoFromToken({ user, profile, memberships });
        expect(isFSA(action)).to.be.true;
      });

      it('should create an action to set the logged-in user (plus user\'s profile, careteam memberships)', () => {
        const expectedAction = {
          type: actionTypes.SET_USER_INFO_FROM_TOKEN,
          payload: { user, profile, memberships },
          meta: {source: actionSources[actionTypes.SET_USER_INFO_FROM_TOKEN]}
        };
        expect(syncActions.setUserInfoFromToken({ user, profile, memberships })).to.deep.equal(expectedAction);
      });
    });
  });

  describe('for doLogin', () => {
    describe('loginRequest', () => {
      it('should be an FSA', () => {
        let action = syncActions.loginRequest();

        expect(isFSA(action)).to.be.true;
      });

      it('should create an action to record the start of user login', () => {
        const expectedAction = {
          type: actionTypes.LOGIN_REQUEST,
          meta: {source: actionSources[actionTypes.LOGIN_REQUEST]}
        };
        expect(syncActions.loginRequest()).to.deep.equal(expectedAction);
      });
    });

    describe('loginSuccess', () => {
      // NB: this is not what these objects actually look like
      // actual shape is irrelevant to testing action creators
      const user = {userid: 'abc123'};
      const profile = {fullName: 'Jane Doe'};
      const memberships = [{userid: 'def456'}, {userid: 'ghi789'}];
      it('should be an FSA', () => {
        expect(isFSA(syncActions.loginSuccess({ user, profile, memberships }))).to.be.true;
      });

      it('should create an action to set the logged-in user (plus user\'s profile, careteam memberships)', () => {
        const expectedAction = {
          type: actionTypes.LOGIN_SUCCESS,
          payload: { user, profile, memberships },
          meta: {
            source: actionSources[actionTypes.LOGIN_SUCCESS],
            metric: {eventName: metrics.LOGIN_SUCCESS}
          }
        };
        expect(syncActions.loginSuccess({ user, profile, memberships })).to.deep.equal(expectedAction);
      });
    });

    describe('loginFailure', () => {
      const err = 'Login error!';
      it('should be an FSA', () => {
        let action = syncActions.loginFailure(err);

        expect(isFSA(action)).to.be.true;
      });

      it('should create an action to report a login error', () => {
        __Rewire__('getLoginErrorMessage', () => err);
        const expectedAction = {
          type: actionTypes.LOGIN_FAILURE,
          error: true,
          payload: new Error(err),
          meta: {source: actionSources[actionTypes.LOGIN_FAILURE]}
        };
        const action = syncActions.loginFailure(err);
        expect(action.payload).to.deep.include({message:err});
        expectedAction.payload = action.payload;
        expect(action).to.deep.equal(expectedAction);
        __ResetDependency__('getLoginErrorMessage');
      });
    });
  });

  describe('for doLogout', () => {
    describe('logoutRequest', () => {
      it('should be an FSA', () => {
        let action = syncActions.logoutRequest();

        expect(isFSA(action)).to.be.true;
      });

      it('should create an action to request logout and clear logged-in user related state', () => {
        const expectedAction = {
          type: actionTypes.LOGOUT_REQUEST,
          meta: {
            source: actionSources[actionTypes.LOGOUT_REQUEST],
            metric: {eventName: metrics.LOGOUT_REQUEST}
          }
        };
        expect(syncActions.logoutRequest()).to.deep.equal(expectedAction);
      });
    });

    describe('logoutSuccess', () => {
      it('should be an FSA', () => {
        let action = syncActions.logoutSuccess();

        expect(isFSA(action)).to.be.true;
      });

      it('should create an action to announce the success of logout', () => {
        const expectedAction = {
          type: actionTypes.LOGOUT_SUCCESS,
          meta: {source: actionSources[actionTypes.LOGOUT_SUCCESS]}
        };
        expect(syncActions.logoutSuccess()).to.deep.equal(expectedAction);
      });
    });

    describe('logoutFailure', () => {
      const err = 'Logout error!';
      it('should be an FSA', () => {
        let action = syncActions.logoutFailure(err);

        expect(isFSA(action)).to.be.true;
      });

      it('should create an action to report a logout error', () => {
        __Rewire__('getLogoutErrorMessage', () => err);
        const expectedAction = {
          type: actionTypes.LOGOUT_FAILURE,
          error: true,
          payload: new Error(err),
          meta: {source: actionSources[actionTypes.LOGOUT_FAILURE]}
        };
        const action = syncActions.logoutFailure(err);
        expect(action.payload).to.deep.include({message:err});
        expectedAction.payload = action.payload;
        expect(action).to.deep.equal(expectedAction);
        __ResetDependency__('getLoginErrorMessage');
      });
    });
  });

  describe('for doUpload', () => {
    describe('uploadAborted', () => {
      it('should be an FSA', () => {
        let action = syncActions.uploadAborted();

        expect(isFSA(action)).to.be.true;
      });

      it('should create an action reporting an aborted upload (b/c another upload in progress)', () => {
        const expectedAction = {
          type: actionTypes.UPLOAD_ABORTED,
          error: true,
          payload: new Error(errorText.E_UPLOAD_IN_PROGRESS),
          meta: {source: actionSources[actionTypes.UPLOAD_ABORTED]}
        };
        const action = syncActions.uploadAborted();
        expect(action.payload).to.deep.include({message:errorText.E_UPLOAD_IN_PROGRESS});
        expectedAction.payload = action.payload;
        expect(action).to.deep.equal(expectedAction);
      });
    });

    describe('uploadRequest', () => {
      const userId = 'a1b2c3';
      const device = {
        key: 'a_pump',
        name: 'Acme Pump',
        source: {type: 'device', driverId: 'AcmePump'},
        enabled: {mac: true, win: true}
      };
      it('should be an FSA', () => {
        let action = syncActions.uploadRequest(userId, device);

        expect(isFSA(action)).to.be.true;
      });

      it('should create an action to record the start of an upload', () => {
        const time = '2016-01-01T12:05:00.123Z';
        const expectedAction = {
          type: actionTypes.UPLOAD_REQUEST,
          payload: { userId, deviceKey: device.key, utc: time},
          meta: {
            source: actionSources[actionTypes.UPLOAD_REQUEST],
            metric: {
              eventName: 'Upload Attempted',
              properties: {type: device.source.type, source: device.source.driverId}
            }
          }
        };

        expect(syncActions.uploadRequest(userId, device, time)).to.deep.equal(expectedAction);
      });

      it('should create appropriate metric properties for 600 series upload limits', () => {
        const time = '2016-01-01T12:05:00.123Z';
        __Rewire__('uploadDataPeriod', { periodMedtronic600: 1 });
        device.source.driverId = 'Medtronic600';
        const expectedAction = {
          type: actionTypes.UPLOAD_REQUEST,
          payload: { userId, deviceKey: device.key, utc: time },
          meta: {
            source: actionSources[actionTypes.UPLOAD_REQUEST],
            metric: {
              eventName: 'Upload Attempted',
              properties: {
                type: device.source.type,
                source: device.source.driverId,
                limit: 'all data'
              }
            }
          }
        };

        expect(syncActions.uploadRequest(userId, device, time)).to.deep.equal(expectedAction);
        __ResetDependency__('uploadDataPeriod');
      });
    });

    describe('uploadProgress', () => {
      const step = 'READ', percentage = 50, isFirstUpload = true;
      it('should be an FSA', () => {
        let action = syncActions.uploadProgress(step, percentage);

        expect(isFSA(action)).to.be.true;
      });

      it('should create an action to update the step and percentage complete for the upload in progress', () => {
        const expectedAction = {
          type: actionTypes.UPLOAD_PROGRESS,
          payload: { step, percentage, isFirstUpload },
          meta: {source: actionSources[actionTypes.UPLOAD_PROGRESS]}
        };

        expect(syncActions.uploadProgress(step, percentage, isFirstUpload)).to.deep.equal(expectedAction);
      });
    });

    describe('uploadSuccess', () => {
      const time = '2016-01-01T12:05:00.123Z';
      const userId = 'a1b2c3', deviceKey = 'a_pump';
      const device = {
        key: deviceKey,
        source: {type: 'device', driverId: 'AcmePump'}
      };
      const upload = {
        history: [{start: time}]
      };
      const data = {
        post_records: [1,2,3,4,5],
        deviceModel: 'acme'
      };
      it('should be an FSA', () => {
        let action = syncActions.uploadSuccess(userId, device, upload, data);

        expect(isFSA(action)).to.be.true;
      });

      it('should create an action to record a successful upload', () => {
        const expectedAction = {
          type: actionTypes.UPLOAD_SUCCESS,
          payload: { userId, deviceKey: device.key, data, utc: time},
          meta: {
            source: actionSources[actionTypes.UPLOAD_SUCCESS],
            metric: {
              eventName: `${metrics.UPLOAD_SUCCESS}`,
              properties: {
                type: device.source.type,
                deviceModel: 'acme',
                source: device.source.driverId,
                started: time,
                finished: time,
                processed: data.post_records.length
              }
            }
          }
        };
        expect(syncActions.uploadSuccess(userId, device, upload, data, time)).to.deep.equal(expectedAction);
      });

      it('should create an action to record a successful 600 series upload w/ limit', () => {
        const time = '2016-01-01T12:05:00.123Z';
        __Rewire__('uploadDataPeriod', { periodMedtronic600: 2 });
        device.source.driverId = 'Medtronic600';
        const expectedAction = {
          type: actionTypes.UPLOAD_SUCCESS,
          payload: { userId, deviceKey: device.key, data, utc: time},
          meta: {
            source: actionSources[actionTypes.UPLOAD_SUCCESS],
            metric: {
              eventName: `${metrics.UPLOAD_SUCCESS}`,
              properties: {
                type: device.source.type,
                deviceModel: 'acme',
                source: device.source.driverId,
                started: time,
                finished: time,
                processed: data.post_records.length,
                limit: 'new data'
              }
            }
          }
        };

        expect(syncActions.uploadSuccess(userId, device, upload, data, time)).to.deep.equal(expectedAction);
        __ResetDependency__('uploadDataPeriod');
      });
    });

    describe('uploadFailure', () => {
      const origError = new Error('I\'m an upload error!');
      const errProps = {
        utc: '2016-01-01T12:05:00.123Z',
        code: 'RED'
      };
      let resError = new Error('I\'m an upload error!');
      resError.code = errProps.code;
      resError.utc = errProps.utc;
      resError.debug = `UTC Time: ${errProps.utc} | Code: ${errProps.code}`;
      const device = {
        source: {type: 'device', driverId: 'AcmePump'}
      };
      it('should be an FSA', () => {
        let action = syncActions.uploadFailure(origError, errProps, device);

        expect(isFSA(action)).to.be.true;
      });

      it('should create an action to report an upload failure', () => {
        const expectedAction = {
          type: actionTypes.UPLOAD_FAILURE,
          error: true,
          payload: resError,
          meta: {
            source: actionSources[actionTypes.UPLOAD_FAILURE],
            metric: {
              eventName: `${metrics.UPLOAD_FAILURE}`,
              properties: {
                type: device.source.type,
                source: device.source.driverId,
                error: resError
              }
            }
          }
        };
        const action = syncActions.uploadFailure(origError, errProps, device);
        expect(action.payload).to.deep.include({
          message: resError.message,
          code: resError.code,
          utc: resError.utc,
          debug: resError.debug
        });
        expectedAction.payload = action.payload;
        expectedAction.meta.metric.properties.error = action.payload;
        expect(action).to.deep.equal(expectedAction);
        expect(syncActions.uploadFailure(origError, errProps, device)).to.deep.equal(expectedAction);
      });

      it('should create an action to report an upload failure with limit for 600 series', () => {
        __Rewire__('uploadDataPeriod', { periodMedtronic600: 3 });
        device.source.driverId = 'Medtronic600';
        const expectedAction = {
          type: actionTypes.UPLOAD_FAILURE,
          error: true,
          payload: resError,
          meta: {
            source: actionSources[actionTypes.UPLOAD_FAILURE],
            metric: {
              eventName: `${metrics.UPLOAD_FAILURE}`,
              properties: {
                type: device.source.type,
                source: device.source.driverId,
                error: resError,
                limit: '4 weeks'
              }
            }
          }
        };
        const action = syncActions.uploadFailure(origError, errProps, device);
        expect(action.payload).to.deep.include({
          message: resError.message,
          code: resError.code,
          utc: resError.utc,
          debug: resError.debug
        });
        expectedAction.payload = action.payload;
        expectedAction.meta.metric.properties.error = action.payload;
        expect(action).to.deep.equal(expectedAction);
        expect(syncActions.uploadFailure(origError, errProps, device)).to.deep.equal(expectedAction);
        __ResetDependency__('uploadDataPeriod');
      });
    });

    describe('uploadCancelled', () => {
      const errProps = {
        utc: '2016-01-01T12:05:00.123Z',
      };
      const device = {
        source: {type: 'device', driverId: 'AcmePump'}
      };
      it('should be an FSA', () => {
        let action = syncActions.uploadCancelled();

        expect(isFSA(action)).to.be.true;
      });

      it('should create an action to report an upload cancellation', () => {
        const expectedAction = {
          type: actionTypes.UPLOAD_CANCELLED,
          payload: { utc: errProps.utc },
          meta: {
            source: actionSources[actionTypes.UPLOAD_CANCELLED]
          }
        };
        const action = syncActions.uploadCancelled(errProps.utc);
        expect(action).to.deep.equal(expectedAction);
      });
    });

    describe('deviceDetectRequest', () => {
      it('should be an FSA', () => {
        let action = syncActions.deviceDetectRequest();

        expect(isFSA(action)).to.be.true;
      });

      it('should create an action record an attempt to detect a device', () => {
        const expectedAction = {
          type: actionTypes.DEVICE_DETECT_REQUEST,
          meta: {source: actionSources[actionTypes.DEVICE_DETECT_REQUEST]}
        };

        expect(syncActions.deviceDetectRequest()).to.deep.equal(expectedAction);
      });
    });
  });

  describe('for readFile', () => {
    describe('choosingFile', () => {
      const userId = 'abc123', deviceKey = 'a_pump';
      it('should be an FSA', () => {
        let action = syncActions.choosingFile(userId, deviceKey);

        expect(isFSA(action)).to.be.true;
      });

      it('should create an action to record file selection for a block-mode device', () => {
        const expectedAction = {
          type: actionTypes.CHOOSING_FILE,
          payload: { userId, deviceKey },
          meta: {source: actionSources[actionTypes.CHOOSING_FILE]}
        };

        expect(syncActions.choosingFile(userId, deviceKey)).to.deep.equal(expectedAction);
      });
    });

    describe('readFileAborted', () => {
      let err = new Error('Wrong file extension!');
      it('should be an FSA', () => {
        let action = syncActions.readFileAborted(err);

        expect(isFSA(action)).to.be.true;
      });

      it('should create an action to report user error in choosing a file with the wrong extension', () => {
        const expectedAction = {
          type: actionTypes.READ_FILE_ABORTED,
          error: true,
          payload: err,
          meta: {source: actionSources[actionTypes.READ_FILE_ABORTED]}
        };
        const action = syncActions.readFileAborted(err);
        expect(action.payload).to.deep.include({message:err.message});
        expectedAction.payload = action.payload;
        expect(action).to.deep.equal(expectedAction);
      });
    });

    describe('readFileRequest', () => {
      const userId = 'abc123', deviceKey = 'a_pump';
      const filename = 'my-data.ext';
      it('should be an FSA', () => {
        let action = syncActions.readFileRequest(userId, deviceKey, filename);

        expect(isFSA(action)).to.be.true;
      });

      it('should create an action to record request to read a chosen file', () => {
        const expectedAction = {
          type: actionTypes.READ_FILE_REQUEST,
          payload: { userId, deviceKey, filename },
          meta: {source: actionSources[actionTypes.READ_FILE_REQUEST]}
        };

        expect(syncActions.readFileRequest(userId, deviceKey, filename)).to.deep.equal(expectedAction);
      });
    });

    describe('readFileSuccess', () => {
      const userId = 'abc123', deviceKey = 'a_pump';
      const filedata = [1,2,3,4,5];
      it('should be an FSA', () => {
        let action = syncActions.readFileSuccess(userId, deviceKey, filedata);

        expect(isFSA(action)).to.be.true;
      });

      it('should create an action to record data of successfully read file', () => {
        const expectedAction = {
          type: actionTypes.READ_FILE_SUCCESS,
          payload: { userId, deviceKey, filedata },
          meta: {source: actionSources[actionTypes.READ_FILE_SUCCESS]}
        };

        expect(syncActions.readFileSuccess(userId, deviceKey, filedata)).to.deep.equal(expectedAction);
      });
    });

    describe('readFileFailure', () => {
      let err = new Error('Error reading file!');
      it('should be an FSA', () => {
        let action = syncActions.readFileFailure(err);

        expect(isFSA(action)).to.be.true;
      });

      it('should create an action to report error reading chosen file', () => {
        const expectedAction = {
          type: actionTypes.READ_FILE_FAILURE,
          error: true,
          payload: err,
          meta: {source: actionSources[actionTypes.READ_FILE_FAILURE]}
        };
        const action = syncActions.readFileFailure(err);
        expect(action.payload).to.deep.include({message:err.message});
        expectedAction.payload = action.payload;
        expect(action).to.deep.equal(expectedAction);
      });
    });
  });

  describe('for doVersionCheck', () => {
    describe('versionCheckRequest', () => {
      it('should be an FSA', () => {
        let action = syncActions.versionCheckRequest();

        expect(isFSA(action)).to.be.true;
      });

      it('should create an action to record the start of the uploader supported version check', () => {
        const expectedAction = {
          type: actionTypes.VERSION_CHECK_REQUEST,
          meta: {source: actionSources[actionTypes.VERSION_CHECK_REQUEST]}
        };

        expect(syncActions.versionCheckRequest()).to.deep.equal(expectedAction);
      });
    });

    describe('versionCheckSuccess', () => {
      it('should be an FSA', () => {
        let action = syncActions.versionCheckSuccess();

        expect(isFSA(action)).to.be.true;
      });

      it('should create an action to mark the current uploader\'s version as supported', () => {
        const expectedAction = {
          type: actionTypes.VERSION_CHECK_SUCCESS,
          meta: {source: actionSources[actionTypes.VERSION_CHECK_SUCCESS]}
        };

        expect(syncActions.versionCheckSuccess()).to.deep.equal(expectedAction);
      });
    });

    describe('versionCheckFailure', () => {
      const currentVersion = '0.99.0', requiredVersion = '0.100.0';
      it('should be an FSA [API response err]', () => {
        let action = syncActions.versionCheckFailure(new Error('API error!'));

        expect(isFSA(action)).to.be.true;
      });

      it('should be an FSA [out-of-date version]', () => {
        let action = syncActions.versionCheckFailure(null, currentVersion, requiredVersion);

        expect(isFSA(action)).to.be.true;
      });

      it('should create an action to record an unsuccessful attempt to check the uploader\'s version', () => {
        const err = new Error('API error');
        const expectedAction = {
          type: actionTypes.VERSION_CHECK_FAILURE,
          error: true,
          payload: err,
          meta: {
            source: actionSources[actionTypes.VERSION_CHECK_FAILURE],
            metric: {
              eventName: metrics.UNSUPPORTED_SCREEN_DISPLAYED
            }
          }
        };
        const action = syncActions.versionCheckFailure(err);
        expect(action.payload).to.deep.include({message:err.message});
        expectedAction.payload = action.payload;
        expect(action).to.deep.equal(expectedAction);
      });

      it('should create an action to mark the current uploader\'s version as unsupported', () => {
        const err = new UnsupportedError(currentVersion, requiredVersion);
        const expectedAction = {
          type: actionTypes.VERSION_CHECK_FAILURE,
          error: true,
          payload: err,
          meta: {
            source: actionSources[actionTypes.VERSION_CHECK_FAILURE],
            metric: {
              eventName: metrics.VERSION_CHECK_FAILURE_OUTDATED,
              properties: { requiredVersion }
            }
          }
        };
        const action = syncActions.versionCheckFailure(null, currentVersion, requiredVersion);
        expect(action.payload).to.deep.include({message:err.message});
        expectedAction.payload = action.payload;
        expect(action).to.deep.equal(expectedAction);
      });
    });
  });

  describe('for retrieveTargetsFromStorage', () => {

    describe('retrieveUsersTargetsFromStorage', () => {
      it('should be an FSA', () => {
        let action = syncActions.retrieveUsersTargetsFromStorage();

        expect(isFSA(action)).to.be.true;
      });

      it('should create an action to announce the side effet of storing users\' targets locally', () => {
        const expectedAction = {
          type: actionTypes.RETRIEVING_USERS_TARGETS,
          meta: {source: actionSources[actionTypes.RETRIEVING_USERS_TARGETS]}
        };
        expect(syncActions.retrieveUsersTargetsFromStorage()).to.deep.equal(expectedAction);
      });
    });

    describe('setUsersTargets', () => {
      // NB: this is not what this object actually looks like
      // actual shape is irrelevant to testing action creators
      const targets = {
        a1b2c3: ['foo', 'bar'],
        d4e5f6: ['baz']
      };
      it('should be an FSA', () => {
        let action = syncActions.setUsersTargets();

        expect(isFSA(action)).to.be.true;
      });

      it('should create an action to set the users\' target devices', () => {
        const expectedAction = {
          type: actionTypes.SET_USERS_TARGETS,
          payload: { targets },
          meta: {source: actionSources[actionTypes.SET_USERS_TARGETS]}
        };
        expect(syncActions.setUsersTargets(targets)).to.deep.equal(expectedAction);
      });
    });
  });

  describe('autoCheckingForUpdates', () => {
    it('should be an FSA', () => {
      let action = syncActions.autoCheckingForUpdates();
      expect(isFSA(action)).to.be.true;
    });

    it('should create an action to indicate an automatic update check', () => {
      const expectedAction = {
        type: actionTypes.AUTO_UPDATE_CHECKING_FOR_UPDATES,
        meta: {source: actionSources[actionTypes.AUTO_UPDATE_CHECKING_FOR_UPDATES]}
      };
      expect(syncActions.autoCheckingForUpdates()).to.deep.equal(expectedAction);
    });
  });

  describe('manualCheckingForUpdates', () => {
    it('should be an FSA', () => {
      let action = syncActions.manualCheckingForUpdates();
      expect(isFSA(action)).to.be.true;
    });

    it('should create an action to indicate a manual update check', () => {
      const expectedAction = {
        type: actionTypes.MANUAL_UPDATE_CHECKING_FOR_UPDATES,
        meta: {source: actionSources[actionTypes.MANUAL_UPDATE_CHECKING_FOR_UPDATES]}
      };
      expect(syncActions.manualCheckingForUpdates()).to.deep.equal(expectedAction);
    });
  });

  describe('updateAvailable', () => {
    const updateInfo = {'url':'http://example.com'};
    it('should be an FSA', () => {
      let action = syncActions.updateAvailable(updateInfo);
      expect(isFSA(action)).to.be.true;
    });

    it('should create an action to indicate an update being available', () => {
      const expectedAction = {
        type: actionTypes.UPDATE_AVAILABLE,
        payload: { info: updateInfo },
        meta: {source: actionSources[actionTypes.UPDATE_AVAILABLE]}
      };
      expect(syncActions.updateAvailable(updateInfo)).to.deep.equal(expectedAction);
    });
  });

  describe('updateNotAvailable', () => {
    const updateInfo = {'url':'http://example.com'};
    it('should be an FSA', () => {
      let action = syncActions.updateNotAvailable(updateInfo);
      expect(isFSA(action)).to.be.true;
    });

    it('should create an action to indicate no update available', () => {
      const expectedAction = {
        type: actionTypes.UPDATE_NOT_AVAILABLE,
        payload: { info: updateInfo },
        meta: {source: actionSources[actionTypes.UPDATE_NOT_AVAILABLE]}
      };
      expect(syncActions.updateNotAvailable(updateInfo)).to.deep.equal(expectedAction);
    });
  });

  describe('autoUpdateError', () => {
    const updateInfo = {'url':'http://example.com'};
    it('should be an FSA', () => {
      let action = syncActions.autoUpdateError(updateInfo);
      expect(isFSA(action)).to.be.true;
    });

    it('should create an action to indicate an error checking for update', () => {
      const expectedAction = {
        type: actionTypes.AUTOUPDATE_ERROR,
        payload: { error: updateInfo },
        meta: {source: actionSources[actionTypes.AUTOUPDATE_ERROR]}
      };
      expect(syncActions.autoUpdateError(updateInfo)).to.deep.equal(expectedAction);
    });
  });

  describe('updateDownloaded', () => {
    const updateInfo = {'url':'http://example.com'};
    it('should be an FSA', () => {
      let action = syncActions.updateDownloaded(updateInfo);
      expect(isFSA(action)).to.be.true;
    });

    it('should create an action to indicate an update finished downloading', () => {
      const expectedAction = {
        type: actionTypes.UPDATE_DOWNLOADED,
        payload: { info: updateInfo },
        meta: {source: actionSources[actionTypes.UPDATE_DOWNLOADED]}
      };
      expect(syncActions.updateDownloaded(updateInfo)).to.deep.equal(expectedAction);
    });
  });

  describe('dismissUpdateAvailable', () => {
    it('should be an FSA', () => {
      let action = syncActions.dismissUpdateAvailable();
      expect(isFSA(action)).to.be.true;
    });

    it('should create an action to indicate user dismissing update available modal', () => {
      const expectedAction = {
        type: actionTypes.DISMISS_UPDATE_AVAILABLE,
        meta: {source: actionSources[actionTypes.DISMISS_UPDATE_AVAILABLE]}
      };
      expect(syncActions.dismissUpdateAvailable()).to.deep.equal(expectedAction);
    });
  });

  describe('dismissUpdateNotAvailable', () => {
    it('should be an FSA', () => {
      let action = syncActions.dismissUpdateNotAvailable();
      expect(isFSA(action)).to.be.true;
    });

    it('should create an action to indicate user dismissing update unavailable modal', () => {
      const expectedAction = {
        type: actionTypes.DISMISS_UPDATE_NOT_AVAILABLE,
        meta: {source: actionSources[actionTypes.DISMISS_UPDATE_NOT_AVAILABLE]}
      };
      expect(syncActions.dismissUpdateNotAvailable()).to.deep.equal(expectedAction);
    });
  });

  describe('checkingForDriverUpdate', () => {
    it('should be an FSA', () => {
      let action = syncActions.checkingForDriverUpdate();
      expect(isFSA(action)).to.be.true;
    });

    it('should create an action to indicate a driver update check', () => {
      const expectedAction = {
        type: actionTypes.CHECKING_FOR_DRIVER_UPDATE,
        meta: {source: actionSources[actionTypes.CHECKING_FOR_DRIVER_UPDATE]}
      };
      expect(syncActions.checkingForDriverUpdate()).to.deep.equal(expectedAction);
    });
  });

  describe('driverUpdateAvailable', () => {
    const current = '1';
    const available = '2';
    it('should be an FSA', () => {
      let action = syncActions.driverUpdateAvailable(current, available);
      expect(isFSA(action)).to.be.true;
    });

    it('should create an action to indicate a driver update being available', () => {
      const expectedAction = {
        type: actionTypes.DRIVER_UPDATE_AVAILABLE,
        payload: { current, available },
        meta: {source: actionSources[actionTypes.DRIVER_UPDATE_AVAILABLE]}
      };
      expect(syncActions.driverUpdateAvailable(current, available)).to.deep.equal(expectedAction);
    });
  });

  describe('driverUpdateNotAvailable', () => {
    const updateInfo = {'url':'http://example.com'};
    it('should be an FSA', () => {
      let action = syncActions.driverUpdateNotAvailable(updateInfo);
      expect(isFSA(action)).to.be.true;
    });

    it('should create an action to indicate no driver update available', () => {
      const expectedAction = {
        type: actionTypes.DRIVER_UPDATE_NOT_AVAILABLE,
        meta: {source: actionSources[actionTypes.DRIVER_UPDATE_NOT_AVAILABLE]}
      };
      expect(syncActions.driverUpdateNotAvailable(updateInfo)).to.deep.equal(expectedAction);
    });
  });

  describe('dismissDriverUpdateAvailable', () => {
    it('should be an FSA', () => {
      let action = syncActions.dismissDriverUpdateAvailable();
      expect(isFSA(action)).to.be.true;
    });

    it('should create an action to indicate user dismissing driver update available modal', () => {
      const expectedAction = {
        type: actionTypes.DISMISS_DRIVER_UPDATE_AVAILABLE,
        meta: {source: actionSources[actionTypes.DISMISS_DRIVER_UPDATE_AVAILABLE]}
      };
      expect(syncActions.dismissDriverUpdateAvailable()).to.deep.equal(expectedAction);
    });
  });

  describe('driverInstall', () => {
    const updateInfo = {'url':'http://example.com'};
    it('should be an FSA', () => {
      let action = syncActions.driverInstall(updateInfo);
      expect(isFSA(action)).to.be.true;
    });

    it('should create an action to indicate a driver update install', () => {
      const expectedAction = {
        type: actionTypes.DRIVER_INSTALL,
        meta: {source: actionSources[actionTypes.DRIVER_INSTALL]}
      };
      expect(syncActions.driverInstall(updateInfo)).to.deep.equal(expectedAction);
    });
  });

  describe('driverUpdateShellOpts', () => {
    const opts = {'url':'http://example.com'};
    it('should be an FSA', () => {
      let action = syncActions.driverUpdateShellOpts(opts);
      expect(isFSA(action)).to.be.true;
    });

    it('should create an action to set update script opts', () => {
      const expectedAction = {
        type: actionTypes.DRIVER_INSTALL_SHELL_OPTS,
        payload: { opts },
        meta: {source: actionSources[actionTypes.DRIVER_INSTALL_SHELL_OPTS]}
      };
      expect(syncActions.driverUpdateShellOpts(opts)).to.deep.equal(expectedAction);
    });
  });

  describe('deviceTimeIncorrect', () => {
    const callback = () => {},
      cfg = { config: 'value'},
      times = { time1: 'time' };
    it('should be an FSA', () => {
      let action = syncActions.deviceTimeIncorrect(callback, cfg, times);
      expect(isFSA(action)).to.be.true;
    });

    it('should create an action to indicate user dismissing device time mismatch modal', () => {
      const expectedAction = {
        type: actionTypes.DEVICE_TIME_INCORRECT,
        payload: { callback, cfg, times },
        meta: {
          source: actionSources[actionTypes.DEVICE_TIME_INCORRECT],
          metric: {
            eventName: metrics.DEVICE_TIME_INCORRECT,
            properties: { times },
          },
        },
      };
      expect(syncActions.deviceTimeIncorrect(callback, cfg, times)).to.deep.equal(expectedAction);
    });
  });

  describe('dismissedDeviceTimePrompt', () => {
    it('should be an FSA', () => {
      let action = syncActions.dismissedDeviceTimePrompt();
      expect(isFSA(action)).to.be.true;
    });

    it('should create an action to indicate user dismissing device time mismatch modal', () => {
      const expectedAction = {
        type: actionTypes.DISMISS_DEVICE_TIME_PROMPT,
        meta: {source: actionSources[actionTypes.DISMISS_DEVICE_TIME_PROMPT]}
      };
      expect(syncActions.dismissedDeviceTimePrompt()).to.deep.equal(expectedAction);
    });
  });

  describe('timezoneBlur', () => {
    it('should be an FSA', () => {
      let action = syncActions.timezoneBlur();
      expect(isFSA(action)).to.be.true;
    });

    it('should create an action to indicate blur of timezone selector', () => {
      const expectedAction = {
        type: actionTypes.TIMEZONE_BLUR,
        meta: {source: actionSources[actionTypes.TIMEZONE_BLUR]}
      };
      expect(syncActions.timezoneBlur()).to.deep.equal(expectedAction);
    });
  });

  describe('adHocPairingRequest', () => {
    it('should be an FSA', () => {
      let action = syncActions.adHocPairingRequest();
      expect(isFSA(action)).to.be.true;
    });

    it('should create an action to indicate start of a 600 series ad hoc pairing', () => {
      const callback = () => {};
      const cfg = {conf: 'obj'};
      const expectedAction = {
        payload: { callback, cfg },
        type: actionTypes.AD_HOC_PAIRING_REQUEST,
        meta: {source: actionSources[actionTypes.AD_HOC_PAIRING_REQUEST]}
      };
      expect(syncActions.adHocPairingRequest(callback, cfg)).to.deep.equal(expectedAction);
    });
  });

  describe('adHocPairingDismissed', () => {
    it('should be an FSA', () => {
      let action = syncActions.dismissedAdHocPairingDialog();
      expect(isFSA(action)).to.be.true;
    });

    it('should create an action to indicate dismissing a 600 series ad hoc pairing', () => {
      const expectedAction = {
        type: actionTypes.AD_HOC_PAIRING_DISMISSED,
        meta: {source: actionSources[actionTypes.AD_HOC_PAIRING_DISMISSED]}
      };
      expect(syncActions.dismissedAdHocPairingDialog()).to.deep.equal(expectedAction);
    });
  });

});
