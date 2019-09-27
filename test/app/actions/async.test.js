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

import _ from 'lodash';
import { isFSA } from 'flux-standard-action';
import configureStore from 'redux-mock-store';
import thunk from 'redux-thunk';
import { expect } from 'chai';

import * as actionSources from '../../../app/constants/actionSources';
import * as actionTypes from '../../../app/constants/actionTypes';
import * as metrics from '../../../app/constants/metrics';
import { pages, steps, urls } from '../../../app/constants/otherConstants';
import { UnsupportedError } from '../../../app/utils/errors';
import errorText from '../../../app/constants/errors';

import * as asyncActions from '../../../app/actions/async';
import { __Rewire__, __ResetDependency__ } from '../../../app/actions/async';
import { getLoginErrorMessage, getLogoutErrorMessage, getUpdateProfileErrorMessage, getCreateCustodialAccountErrorMessage } from '../../../app/utils/errors';

let pwd = require('../../lib/fixtures/pwd.json');
let nonpwd = require('../../lib/fixtures/nonpwd.json');

const middlewares = [thunk];
const mockStore = configureStore(middlewares);

describe('Asynchronous Actions', () => {
  afterEach(function() {
    // very important to do this in an afterEach than in each test when __Rewire__ is used
    // if you try to reset within each test you'll make it impossible for tests to fail!
    __ResetDependency__('services');
  });

  describe('doAppInit [hot reload, app already initialized]', () => {
    it('should dispatch no actions!', () => {
      const expectedActions = [];
      const store = mockStore({working: {initializingApp: false}});
      store.dispatch(asyncActions.doAppInit({}, {}));
      const actions = store.getActions();
      expect(actions).to.deep.equal(expectedActions);
    });
  });

  describe('doAppInit [no session token in local storage]', () => {
    it('should dispatch SET_VERSION, INIT_APP_REQUEST, SET_OS, HIDE_UNAVAILABLE_DEVICES, SET_FORGOT_PASSWORD_URL, SET_SIGNUP_URL, SET_NEW_PATIENT_URL, SET_PAGE, INIT_APP_SUCCESS, VERSION_CHECK_REQUEST, VERSION_CHECK_SUCCESS actions', () => {
      const config = {
        os: 'test',
        version: '0.100.0',
        API_URL: 'http://www.acme.com'
      };
      const servicesToInit = {
        api: {
          init: (cb) => { cb(); },
          makeBlipUrl: (path) => {
            return 'http://www.acme.com' + path;
          },
          setHosts: _.noop,
          upload: {
            getVersions: (cb) => { cb(null, {uploaderMinimum: config.version}); }
          }
        },
        device: {
          init: (opts, cb) => { cb(); }
        },
        localStore: {
          init: (opts, cb) => { cb(); },
          getInitialState: _.noop
        },
        log: _.noop
      };
      const expectedActions = [
        {
          type: actionTypes.INIT_APP_REQUEST,
          meta: {source: actionSources[actionTypes.INIT_APP_REQUEST]}
        },
        {
          type: actionTypes.HIDE_UNAVAILABLE_DEVICES,
          payload: {os: 'test'},
          meta: {source: actionSources[actionTypes.HIDE_UNAVAILABLE_DEVICES]}
        },
        {
          type: actionTypes.SET_FORGOT_PASSWORD_URL,
          payload: {url: 'http://www.acme.com/request-password-from-uploader'},
          meta: {source: actionSources[actionTypes.SET_FORGOT_PASSWORD_URL]}
        },
        {
          type: actionTypes.SET_SIGNUP_URL,
          payload: {url: 'http://www.acme.com/signup'},
          meta: {source: actionSources[actionTypes.SET_SIGNUP_URL]}
        },
        {
          type: actionTypes.SET_NEW_PATIENT_URL,
          payload: {url: 'http://www.acme.com/patients/new'},
          meta: {source: actionSources[actionTypes.SET_NEW_PATIENT_URL]}
        },
        {
          type: '@@router/CALL_HISTORY_METHOD',
          payload: {
            args: [ {
              pathname: '/login',
              state: {
                meta: {source: actionSources[actionTypes.SET_PAGE]}
              }
            } ],
            method: 'push'
          }
        },
        {
          type: actionTypes.INIT_APP_SUCCESS,
          meta: {source: actionSources[actionTypes.INIT_APP_SUCCESS]}
        },
        {
          type: actionTypes.VERSION_CHECK_REQUEST,
          meta: {source: actionSources[actionTypes.VERSION_CHECK_REQUEST]}
        },
        {
          type: actionTypes.VERSION_CHECK_SUCCESS,
          meta: {source: actionSources[actionTypes.VERSION_CHECK_SUCCESS]}
        }
      ];
      __Rewire__('versionInfo', {
        semver: config.version
      });
      const store = mockStore({working: {initializingApp: true}});
      store.dispatch(asyncActions.doAppInit(config, servicesToInit));
      const actions = store.getActions();
      expect(actions).to.deep.equal(expectedActions);
    });
  });

  describe('doAppInit [with session token in local storage]', () => {
    it('should dispatch SET_VERSION, INIT_APP_REQUEST, SET_OS, HIDE_UNAVAILABLE_DEVICES, SET_FORGOT_PASSWORD_URL, SET_SIGNUP_URL, SET_NEW_PATIENT_URL, INIT_APP_SUCCESS, VERSION_CHECK_REQUEST, VERSION_CHECK_SUCCESS, SET_USER_INFO_FROM_TOKEN, SET_BLIP_VIEW_DATA_URL, RETRIEVING_USERS_TARGETS, SET_PAGE actions', () => {
      const config = {
        os: 'test',
        version: '0.100.0',
        API_URL: 'http://www.acme.com'
      };
      const servicesToInit = {
        api: {
          init: (cb) => { cb(null, {token: 'iAmAToken'}); },
          makeBlipUrl: (path) => {
            return 'http://www.acme.com' + path;
          },
          setHosts: _.noop,
          upload: {
            getVersions: (cb) => { cb(null, {uploaderMinimum: config.version}); }
          },
          user: {
            initializationInfo: (cb) => { cb(null, [pwd.user, pwd.profile, pwd.memberships] ); }
          }
        },
        device: {
          init: (opts, cb) => { cb(); }
        },
        localStore: {
          init: (opts, cb) => { cb(); },
          getInitialState: _.noop,
          getItem: () => null
        },
        log: _.noop
      };
      const expectedActions = [
        {
          type: actionTypes.INIT_APP_REQUEST,
          meta: {source: actionSources[actionTypes.INIT_APP_REQUEST]}
        },
        {
          type: actionTypes.HIDE_UNAVAILABLE_DEVICES,
          payload: {os: 'test'},
          meta: {source: actionSources[actionTypes.HIDE_UNAVAILABLE_DEVICES]}
        },
        {
          type: actionTypes.SET_FORGOT_PASSWORD_URL,
          payload: {url: 'http://www.acme.com/request-password-from-uploader'},
          meta: {source: actionSources[actionTypes.SET_FORGOT_PASSWORD_URL]}
        },
        {
          type: actionTypes.SET_SIGNUP_URL,
          payload: {url: 'http://www.acme.com/signup'},
          meta: {source: actionSources[actionTypes.SET_SIGNUP_URL]}
        },
        {
          type: actionTypes.SET_NEW_PATIENT_URL,
          payload: {url: 'http://www.acme.com/patients/new'},
          meta: {source: actionSources[actionTypes.SET_NEW_PATIENT_URL]}
        },
        {
          type: actionTypes.INIT_APP_SUCCESS,
          meta: {source: actionSources[actionTypes.INIT_APP_SUCCESS]}
        },
        {
          type: actionTypes.VERSION_CHECK_REQUEST,
          meta: {source: actionSources[actionTypes.VERSION_CHECK_REQUEST]}
        },
        {
          type: actionTypes.VERSION_CHECK_SUCCESS,
          meta: {source: actionSources[actionTypes.VERSION_CHECK_SUCCESS]}
        },
        {
          type: actionTypes.SET_USER_INFO_FROM_TOKEN,
          payload: {user: pwd.user, profile: pwd.profile, memberships: pwd.memberships},
          meta: {source: actionSources[actionTypes.SET_USER_INFO_FROM_TOKEN]}
        },
        {
          type: actionTypes.SET_BLIP_VIEW_DATA_URL,
          payload: {url: `http://www.acme.com/patients/${pwd.user.userid}/data`},
          meta: {source: actionSources[actionTypes.SET_BLIP_VIEW_DATA_URL]}
        },
        {
          type: actionTypes.RETRIEVING_USERS_TARGETS,
          meta: {source: actionSources[actionTypes.RETRIEVING_USERS_TARGETS]}
        },
        {
          type: '@@router/CALL_HISTORY_METHOD',
          payload: {
            args: [ {
              pathname: '/settings',
              state: {
                meta: {source: actionSources[actionTypes.SET_PAGE]}
              }
            } ],
            method: 'push'
          }
        }
      ];
      __Rewire__('versionInfo', {
        semver: config.version
      });
      const state = {
        allUsers: {[pwd.user.userid]: pwd.user},
        uploadTargetUser: pwd.user.userid,
        working: {initializingApp: true}
      };
      const store = mockStore(state);
      store.dispatch(asyncActions.doAppInit(config, servicesToInit));
      const actions = store.getActions();
      expect(actions).to.deep.equal(expectedActions);
    });
  });

  describe('doAppInit [with error in api init]', () => {
    it('should dispatch SET_VERSION, INIT_APP_REQUEST, SET_OS, HIDE_UNAVAILABLE_DEVICES, INIT_APP_FAILURE actions', () => {
      const config = {
        os: 'test',
        version: '0.100.0',
        API_URL: 'http://www.acme.com/'
      };
      const servicesToInit = {
        api: {
          init: (cb) => { cb('Error!'); },
          makeBlipUrl: (path) => {
            return 'http://www.acme.com/' + path;
          },
          setHosts: _.noop
        },
        device: {
          init: (opts, cb) => { cb(); }
        },
        localStore: {
          init: (opts, cb) => { cb(); },
          getInitialState: _.noop
        },
        log: _.noop
      };
      const expectedActions = [
        {
          type: actionTypes.INIT_APP_REQUEST,
          meta: {source: actionSources[actionTypes.INIT_APP_REQUEST]}
        },
        {
          type: actionTypes.HIDE_UNAVAILABLE_DEVICES,
          payload: {os: 'test'},
          meta: {source: actionSources[actionTypes.HIDE_UNAVAILABLE_DEVICES]}
        },
        {
          type: actionTypes.INIT_APP_FAILURE,
          error: true,
          payload: new Error(errorText.E_INIT),
          meta: {source: actionSources[actionTypes.INIT_APP_FAILURE]}
        }
      ];
      __Rewire__('versionInfo', {
        semver: config.version
      });
      const store = mockStore({working: {initializingApp: true}});
      store.dispatch(asyncActions.doAppInit(config, servicesToInit));
      const actions = store.getActions();
      expect(actions[2].payload).to.deep.include({message:errorText.E_INIT});
      expectedActions[2].payload = actions[2].payload;
      expect(actions).to.deep.equal(expectedActions);
    });
  });

  describe('doLogin [no error]', () => {
    it('should dispatch LOGIN_REQUEST, LOGIN_SUCCESS, SET_BLIP_VIEW_DATA_URL, RETRIEVING_USERS_TARGETS, SET_PAGE (SETTINGS) actions', () => {
      // NB: this is not what these objects actually look like
      // actual shape is irrelevant to testing action creators
      const userObj = {user: {userid: 'abc123'}};
      const profile = {fullName: 'Jane Doe'};
      const memberships = [{userid: 'def456'}, {userid: 'ghi789'}];
      const expectedActions = [
        {
          type: actionTypes.LOGIN_REQUEST,
          meta: {source: actionSources[actionTypes.LOGIN_REQUEST]}
        },
        {
          type: actionTypes.LOGIN_SUCCESS,
          payload: {
            user: userObj.user,
            profile, memberships
          },
          meta: {
            source: actionSources[actionTypes.LOGIN_SUCCESS],
            metric: {eventName: metrics.LOGIN_SUCCESS}
          }
        },
        {
          type: actionTypes.SET_BLIP_VIEW_DATA_URL,
          payload: {url: `http://www.acme.com/patients/${userObj.user.userid}/data`},
          meta: {source: actionSources[actionTypes.SET_BLIP_VIEW_DATA_URL]}
        },
        {
          type: actionTypes.RETRIEVING_USERS_TARGETS,
          meta: {source: actionSources[actionTypes.RETRIEVING_USERS_TARGETS]}
        },
        {
          type: '@@router/CALL_HISTORY_METHOD',
          payload: {
            args: [ {
              pathname: '/settings',
              state: {
                meta: {source: actionSources[actionTypes.SET_PAGE]}
              }
            } ],
            method: 'push'
          }
        }
      ];
      __Rewire__('services', {
        api: {
          user: {
            loginExtended: (creds, opts, cb) => cb(null, [userObj, profile, memberships])
          },
          makeBlipUrl: (path) => {
            return 'http://www.acme.com' + path;
          }
        },
        log: _.noop,
        localStore: {
          getItem: () => null,
          setItem: () => null
        }
      });
      const store = mockStore({
        allUsers: {[userObj.user.userid]:userObj.user},
        uploadTargetUser: userObj.user.userid,
        targetUsersForUpload: ['def456', 'ghi789'],
      });
      store.dispatch(asyncActions.doLogin(
        {username: 'jane.doe@me.com', password: 'password'},
        {remember: false}
      ));
      const actions = store.getActions();
      expect(actions).to.deep.equal(expectedActions);
    });
  });

  describe('doLogin [with error]', () => {
    it('should dispatch LOGIN_REQUEST, LOGIN_FAILURE actions', () => {
      const expectedActions = [
        {
          type: actionTypes.LOGIN_REQUEST,
          meta: {source: actionSources[actionTypes.LOGIN_REQUEST]}
        },
        {
          type: actionTypes.LOGIN_FAILURE,
          error: true,
          payload: new Error(getLoginErrorMessage()),
          meta: {source: actionSources[actionTypes.LOGIN_FAILURE]}
        }
      ];
      __Rewire__('services', {
        api: {
          user: {
            loginExtended: (creds, opts, cb) => cb(getLoginErrorMessage())
          }
        },
        localStore: {
          getItem: () => null,
          setItem: () => null
        }
      });
      const store = mockStore({});
      store.dispatch(asyncActions.doLogin(
        {username: 'jane.doe@me.com', password: 'password'},
        {remember: false}
      ));
      const actions = store.getActions();
      expect(actions[1].payload).to.deep.include({message:getLoginErrorMessage()});
      expectedActions[1].payload = actions[1].payload;
      expect(actions).to.deep.equal(expectedActions);
    });
  });

  describe('doLogin [with no DSA error]', () => {
    it('should dispatch LOGIN_REQUEST, LOGIN_SUCCESS, SET_BLIP_VIEW_DATA_URL, RETRIEVING_USERS_TARGETS, SET_PAGE (DataStorageCheck) actions', () => {
      // NB: this is not what these objects actually look like
      // actual shape is irrelevant to testing action creators
      const userObj = {user: {userid: 'abc123'}};
      const profile = {fullName: 'Jane Doe'};
      const memberships = [];
      const expectedActions = [
        {
          type: actionTypes.LOGIN_REQUEST,
          meta: {source: actionSources[actionTypes.LOGIN_REQUEST]}
        },
        {
          type: actionTypes.LOGIN_SUCCESS,
          payload: {
            user: userObj.user,
            profile, memberships
          },
          meta: {
            source: actionSources[actionTypes.LOGIN_SUCCESS],
            metric: {eventName: metrics.LOGIN_SUCCESS}
          }
        },
        {
          type: '@@router/CALL_HISTORY_METHOD',
          payload: {
            args: [ {
              pathname: '/no_upload_targets',
              state: {
                meta: {source: actionSources[actionTypes.SET_PAGE]}
              }
            } ],
            method: 'push'
          }
        }
      ];
      __Rewire__('services', {
        api: {
          user: {
            loginExtended: (creds, opts, cb) => cb(null, [userObj, profile, memberships])
          },
          makeBlipUrl: (path) => {
            return 'http://www.acme.com' + path;
          }
        },
        log: _.noop,
        localStore: {
          getItem: () => null,
          setItem: () => null
        }
      });
      const store = mockStore({
        allUsers: {[userObj.user.userid]:userObj.user},
        uploadTargetUser: userObj.user.userid,
        targetUsersForUpload: [],
      });
      store.dispatch(asyncActions.doLogin(
        {username: 'jane.doe@me.com', password: 'password'},
        {remember: false}
      ));
      const actions = store.getActions();
      expect(actions).to.deep.equal(expectedActions);
    });
  });

  describe('doLogin [verified clinic account]', () => {
    it('should dispatch LOGIN_REQUEST, LOGIN_SUCCESS and SET_PAGE (CLINIC_USER_SELECT) actions', () => {
      // NB: this is not what these objects actually look like
      // actual shape is irrelevant to testing action creators
      const userObj = {user: {userid: 'abc123', roles: ['clinic']}};
      const profile = {fullName: 'Jane Doe'};
      const memberships = [{userid: 'def456'}, {userid: 'ghi789'}];
      const expectedActions = [
        {
          type: actionTypes.LOGIN_REQUEST,
          meta: {source: actionSources[actionTypes.LOGIN_REQUEST]}
        },
        {
          type: actionTypes.LOGIN_SUCCESS,
          payload: {
            user: userObj.user,
            profile, memberships
          },
          meta: {
            source: actionSources[actionTypes.LOGIN_SUCCESS],
            metric: {eventName: metrics.CLINIC_LOGIN_SUCCESS}
          }
        },
        {
          type: '@@router/CALL_HISTORY_METHOD',
          payload: {
            args: [ {
              pathname: '/clinic_user_select',
              state: {
                meta: {
                  metric: {eventName: metrics.CLINIC_SEARCH_DISPLAYED},
                  source: actionSources.USER
                }
              }
            } ],
            method: 'push'
          }
        }
      ];
      __Rewire__('services', {
        api: {
          user: {
            loginExtended: (creds, opts, cb) => cb(null, [userObj, profile, memberships])
          }
        },
        log: _.noop
      });
      const store = mockStore({
        targetUsersForUpload: ['def456', 'ghi789'],
      });
      store.dispatch(asyncActions.doLogin(
        {username: 'jane.doe@me.com', password: 'password'},
        {remember: false}
      ));
      const actions = store.getActions();
      expect(actions).to.deep.equal(expectedActions);
    });
  });

  describe('doLogout [no error]', () => {
    it('should dispatch LOGOUT_REQUEST, LOGOUT_SUCCESS, SET_PAGE actions', () => {
      const expectedActions = [
        {
          type: actionTypes.LOGOUT_REQUEST,
          meta: {
            source: actionSources[actionTypes.LOGOUT_REQUEST],
            metric: {eventName: metrics.LOGOUT_REQUEST}
          }
        },
        {
          type: actionTypes.LOGOUT_SUCCESS,
          meta: {source: actionSources[actionTypes.LOGOUT_SUCCESS]}
        },
        {
          type: '@@router/CALL_HISTORY_METHOD',
          payload: {
            args: [ {
              pathname: '/login',
              state: {
                meta: {source: actionSources.USER}
              }
            } ],
            method: 'push'
          }
        }
      ];
      __Rewire__('services', {
        api: {
          user: {
            logout: (cb) => cb(null)
          }
        }
      });
      const store = mockStore({});
      store.dispatch(asyncActions.doLogout());
      const actions = store.getActions();
      expect(actions).to.deep.equal(expectedActions);
    });
  });

  describe('doLogout [with error]', () => {
    it('should dispatch LOGOUT_REQUEST, LOGOUT_FAILURE, SET_PAGE actions', () => {
      const expectedActions = [
        {
          type: actionTypes.LOGOUT_REQUEST,
          meta: {
            source: actionSources[actionTypes.LOGOUT_REQUEST],
            metric: {eventName: metrics.LOGOUT_REQUEST}
          }
        },
        {
          type: actionTypes.LOGOUT_FAILURE,
          error: true,
          payload: new Error(getLogoutErrorMessage()),
          meta: {source: actionSources[actionTypes.LOGOUT_SUCCESS]}
        },
        {
          type: '@@router/CALL_HISTORY_METHOD',
          payload: {
            args: [ {
              pathname: '/login',
              state: {
                meta: {source: actionSources.USER}
              }
            } ],
            method: 'push'
          }
        }
      ];
      __Rewire__('services', {
        api: {
          user: {
            logout: (cb) => cb('Error :(')
          }
        }
      });
      const store = mockStore({});
      store.dispatch(asyncActions.doLogout());
      const actions = store.getActions();
      expect(actions[1].payload).to.deep.include({message:getLogoutErrorMessage()});
      expectedActions[1].payload = actions[1].payload;
      expect(actions).to.deep.equal(expectedActions);
    });
  });

  describe('doUpload [upload aborted b/c version check failed]', () => {
    it('should dispatch VERSION_CHECK_REQUEST, VERSION_CHECK_FAILURE, UPLOAD_ABORTED', () => {
      const requiredVersion = '0.99.0';
      const currentVersion = '0.50.0';
      __Rewire__('services', {
        api: {
          upload: {
            getVersions: (cb) => cb(null, {uploaderMinimum: requiredVersion})
          }
        }
      });
      const expectedActions = [
        {
          type: actionTypes.VERSION_CHECK_REQUEST,
          meta: {source: actionSources[actionTypes.VERSION_CHECK_REQUEST]}
        },
        {
          type: actionTypes.VERSION_CHECK_FAILURE,
          error: true,
          payload: new UnsupportedError(currentVersion, requiredVersion),
          meta: {
            source: actionSources[actionTypes.VERSION_CHECK_FAILURE],
            metric: {
              eventName: metrics.VERSION_CHECK_FAILURE_OUTDATED,
              properties: { requiredVersion }
            }
          }
        },
        {
          type: actionTypes.UPLOAD_ABORTED,
          error: true,
          payload: new Error(errorText.E_UPLOAD_IN_PROGRESS),
          meta: {source: actionSources[actionTypes.UPLOAD_ABORTED]}
        }
      ];
      __Rewire__('versionInfo', {
        semver: currentVersion
      });
      const store = mockStore({});
      store.dispatch(asyncActions.doUpload());
      const actions = store.getActions();
      expect(actions[1].payload).to.deep.include({message:(new UnsupportedError(currentVersion, requiredVersion)).message});
      expectedActions[1].payload = actions[1].payload;
      expect(actions[2].payload).to.deep.include({message:errorText.E_UPLOAD_IN_PROGRESS});
      expectedActions[2].payload = actions[2].payload;
      expect(actions).to.deep.equal(expectedActions);
    });
  });

  describe('doUpload [upload aborted b/c another upload already in progress]', () => {
    it('should dispatch VERSION_CHECK_REQUEST, VERSION_CHECK_SUCCESS, UPLOAD_ABORTED', () => {
      const initialState = {
        working: {uploading: true}
      };
      __Rewire__('services', {
        api: {
          upload: {
            getVersions: (cb) => cb(null, {uploaderMinimum: '0.99.0'})
          }
        }
      });
      const expectedActions = [
        {
          type: actionTypes.VERSION_CHECK_REQUEST,
          meta: {source: actionSources[actionTypes.VERSION_CHECK_REQUEST]}
        },
        {
          type: actionTypes.VERSION_CHECK_SUCCESS,
          meta: {source: actionSources[actionTypes.VERSION_CHECK_SUCCESS]}
        },
        {
          type: actionTypes.UPLOAD_ABORTED,
          error: true,
          payload: new Error(errorText.E_UPLOAD_IN_PROGRESS),
          meta: {source: actionSources[actionTypes.UPLOAD_ABORTED]}
        }
      ];
      __Rewire__('versionInfo', {
        semver: '0.100.0'
      });
      const store = mockStore(initialState);
      store.dispatch(asyncActions.doUpload());
      const actions = store.getActions();
      expect(actions[2].payload).to.deep.include({message:errorText.E_UPLOAD_IN_PROGRESS});
      expectedActions[2].payload = actions[2].payload;
      expect(actions).to.deep.equal(expectedActions);
    });
  });

  describe('doUpload [device, device detection error (serial)]', () => {
    it('should dispatch VERSION_CHECK_REQUEST, VERSION_CHECK_SUCCESS, UPLOAD_REQUEST, DEVICE_DETECT_REQUEST, UPLOAD_FAILURE actions', () => {
      const userId = 'a1b2c3', deviceKey = 'a_pump';
      const time = '2016-01-01T12:05:00.123Z';
      const targetDevice = {
        key: deviceKey,
        name: 'Acme Insulin Pump',
        source: {type: 'device', driverId: 'AcmePump'}
      };
      const initialState = {
        devices: {
          a_pump: targetDevice
        },
        os: 'mac',
        uploadsByUser: {
          [userId]: {
            a_cgm: {},
            a_pump: {history: [{start: time}]}
          }
        },
        targetDevices: {
          [userId]: ['a_cgm', 'a_pump']
        },
        targetTimezones: {
          [userId]: 'US/Mountain'
        },
        uploadTargetDevice: deviceKey,
        uploadTargetUser: userId,
        version: '0.100.0',
        working: {uploading: false}
      };
      const errProps = {
        utc: time,
        version: initialState.version,
        code: 'E_SERIAL_CONNECTION'
      };
      let err = new Error(errorText.E_SERIAL_CONNECTION);
      err.code = errProps.code;
      err.utc = errProps.utc;
      err.version = errProps.version;
      err.debug = `UTC Time: ${time} | Code: ${errProps.code} | Version: ${errProps.version}`;
      __Rewire__('services', {
        api: {
          upload: {
            getVersions: (cb) => cb(null, {uploaderMinimum: '0.99.0'})
          }
        },
        device: {
          detect: (foo, bar, cb) => cb('Error :(')
        }
      });
      const expectedActions = [
        {
          type: actionTypes.VERSION_CHECK_REQUEST,
          meta: {source: actionSources[actionTypes.VERSION_CHECK_REQUEST]}
        },
        {
          type: actionTypes.VERSION_CHECK_SUCCESS,
          meta: {source: actionSources[actionTypes.VERSION_CHECK_SUCCESS]}
        },
        {
          type: actionTypes.UPLOAD_REQUEST,
          payload: { userId, deviceKey, utc: time },
          meta: {
            source: actionSources[actionTypes.UPLOAD_REQUEST],
            metric: {
              eventName: 'Upload Attempted',
              properties: {type: targetDevice.source.type, source: targetDevice.source.driverId}
            }
          }
        },
        {
          type: actionTypes.DEVICE_DETECT_REQUEST,
          meta: {source: actionSources[actionTypes.DEVICE_DETECT_REQUEST]}
        },
        {
          type: actionTypes.UPLOAD_FAILURE,
          error: true,
          payload: err,
          meta: {
            source: actionSources[actionTypes.UPLOAD_FAILURE],
            metric: {
              eventName: 'Upload Failed',
              properties: {
                type: targetDevice.source.type,
                source: targetDevice.source.driverId,
                error: err
              }
            }
          }
        }
      ];
      const store = mockStore(initialState);
      store.dispatch(asyncActions.doUpload(deviceKey, {}, time));
      const actions = store.getActions();
      expect(actions[4].payload).to.deep.include({
        message: errorText.E_SERIAL_CONNECTION,
        code: err.code,
        utc: err.utc,
        version: err.version,
        debug: err.debug
      });
      expectedActions[4].payload = actions[4].payload;
      expectedActions[4].meta.metric.properties.error = actions[4].payload;
      expect(actions).to.deep.equal(expectedActions);
    });
  });

  describe('doUpload [device, device detection error (hid)]', () => {
    it('should dispatch VERSION_CHECK_REQUEST, VERSION_CHECK_SUCCESS, UPLOAD_REQUEST, DEVICE_DETECT_REQUEST, UPLOAD_FAILURE actions', () => {
      const userId = 'a1b2c3', deviceKey = 'a_pump';
      const time = '2016-01-01T12:05:00.123Z';
      const targetDevice = {
        key: deviceKey,
        name: 'Acme Insulin Pump',
        source: {type: 'device', driverId: 'AcmePump'}
      };
      const initialState = {
        devices: {
          a_pump: targetDevice
        },
        os: 'mac',
        uploadsByUser: {
          [userId]: {
            a_cgm: {},
            a_pump: {history: [{start: time}]}
          }
        },
        targetDevices: {
          [userId]: ['a_cgm', 'a_pump']
        },
        targetTimezones: {
          [userId]: 'US/Mountain'
        },
        uploadTargetDevice: deviceKey,
        uploadTargetUser: userId,
        version: '0.100.0',
        working: {uploading: false}
      };
      const errProps = {
        utc: time,
        version: initialState.version,
        code: 'E_HID_CONNECTION'
      };
      let err = new Error(errorText.E_HID_CONNECTION);
      err.code = errProps.code;
      err.utc = errProps.utc;
      err.version = errProps.version;
      err.debug = `UTC Time: ${time} | Code: ${errProps.code} | Version: ${errProps.version}`;
      __Rewire__('services', {
        api: {
          upload: {
            getVersions: (cb) => cb(null, {uploaderMinimum: '0.99.0'})
          }
        },
        device: {
          detect: (foo, bar, cb) => cb(null, null)
        }
      });
      const expectedActions = [
        {
          type: actionTypes.VERSION_CHECK_REQUEST,
          meta: {source: actionSources[actionTypes.VERSION_CHECK_REQUEST]}
        },
        {
          type: actionTypes.VERSION_CHECK_SUCCESS,
          meta: {source: actionSources[actionTypes.VERSION_CHECK_SUCCESS]}
        },
        {
          type: actionTypes.UPLOAD_REQUEST,
          payload: { userId, deviceKey, utc: time },
          meta: {
            source: actionSources[actionTypes.UPLOAD_REQUEST],
            metric: {
              eventName: 'Upload Attempted',
              properties: {type: targetDevice.source.type, source: targetDevice.source.driverId}
            }
          }
        },
        {
          type: actionTypes.DEVICE_DETECT_REQUEST,
          meta: {source: actionSources[actionTypes.DEVICE_DETECT_REQUEST]}
        },
        {
          type: actionTypes.UPLOAD_FAILURE,
          error: true,
          payload: err,
          meta: {
            source: actionSources[actionTypes.UPLOAD_FAILURE],
            metric: {
              eventName: 'Upload Failed',
              properties: {
                type: targetDevice.source.type,
                source: targetDevice.source.driverId,
                error: err
              }
            }
          }
        }
      ];
      const store = mockStore(initialState);
      store.dispatch(asyncActions.doUpload(deviceKey, {}, time));
      const actions = store.getActions();
      expect(actions[4].payload).to.deep.include({
        message: errorText.E_HID_CONNECTION,
        code: err.code,
        utc: err.utc,
        version: err.version,
        debug: err.debug
      });
      expectedActions[4].payload = actions[4].payload;
      expectedActions[4].meta.metric.properties.error = actions[4].payload;
      expect(actions).to.deep.equal(expectedActions);
    });
  });

  describe('doUpload [device, error during upload]', () => {
    it('should dispatch VERSION_CHECK_REQUEST, VERSION_CHECK_SUCCESS, UPLOAD_REQUEST, DEVICE_DETECT_REQUEST, UPLOAD_FAILURE actions', () => {
      const userId = 'a1b2c3', deviceKey = 'a_pump';
      const time = '2016-01-01T12:05:00.123Z';
      const targetDevice = {
        key: deviceKey,
        name: 'Acme Insulin Pump',
        source: {type: 'device', driverId: 'AcmePump'}
      };
      const initialState = {
        devices: {
          a_pump: targetDevice
        },
        os: 'mac',
        uploadsByUser: {
          [userId]: {
            a_cgm: {},
            a_pump: {history: [{start: time}]}
          }
        },
        targetDevices: {
          [userId]: ['a_cgm', 'a_pump']
        },
        targetTimezones: {
          [userId]: 'US/Mountain'
        },
        uploadTargetDevice: deviceKey,
        uploadTargetUser: userId,
        version: '0.100.0',
        working: {uploading: false}
      };
      const errProps = {
        utc: time,
        version: initialState.version,
        code: 'E_DEVICE_UPLOAD'
      };
      const basalErr = 'Problem processing basal!';
      let err = new Error(errorText.E_DEVICE_UPLOAD);
      err.details = basalErr;
      err.utc = errProps.utc;
      err.name = 'Error';
      err.code = errProps.code;
      err.version = errProps.version;
      err.debug = `Details: ${basalErr} | UTC Time: ${time} | Name: Error | Code: ${errProps.code} | Version: ${errProps.version}`;
      __Rewire__('services', {
        api: {
          upload: {
            getVersions: (cb) => cb(null, {uploaderMinimum: '0.99.0'})
          }
        },
        device: {
          detect: (foo, bar, cb) => cb(null, {}),
          upload: (foo, bar, cb) => cb(basalErr)
        }
      });
      const expectedActions = [
        {
          type: actionTypes.VERSION_CHECK_REQUEST,
          meta: {source: actionSources[actionTypes.VERSION_CHECK_REQUEST]}
        },
        {
          type: actionTypes.VERSION_CHECK_SUCCESS,
          meta: {source: actionSources[actionTypes.VERSION_CHECK_SUCCESS]}
        },
        {
          type: actionTypes.UPLOAD_REQUEST,
          payload: { userId, deviceKey, utc: time },
          meta: {
            source: actionSources[actionTypes.UPLOAD_REQUEST],
            metric: {
              eventName: 'Upload Attempted',
              properties: {type: targetDevice.source.type, source: targetDevice.source.driverId}
            }
          }
        },
        {
          type: actionTypes.DEVICE_DETECT_REQUEST,
          meta: {source: actionSources[actionTypes.DEVICE_DETECT_REQUEST]}
        },
        {
          type: actionTypes.UPLOAD_FAILURE,
          error: true,
          payload: err,
          meta: {
            source: actionSources[actionTypes.UPLOAD_FAILURE],
            metric: {
              eventName: 'Upload Failed',
              properties: {
                type: targetDevice.source.type,
                source: targetDevice.source.driverId,
                error: err
              }
            }
          }
        }
      ];
      const store = mockStore(initialState);
      store.dispatch(asyncActions.doUpload(deviceKey, {}, time));
      const actions = store.getActions();
      expect(actions[4].payload).to.deep.include({
        message: errorText.E_DEVICE_UPLOAD,
        code: err.code,
        details: err.details,
        name: err.name,
        utc: err.utc,
        version: err.version,
        debug: err.debug
      });
      expectedActions[4].payload = actions[4].payload;
      expectedActions[4].meta.metric.properties.error = actions[4].payload;
      expect(actions).to.deep.equal(expectedActions);
    });
  });

  describe('doUpload [device, time check error and dialog dismissed]', () => {
    it('should dispatch VERSION_CHECK_REQUEST, VERSION_CHECK_SUCCESS, UPLOAD_REQUEST, DEVICE_DETECT_REQUEST, UPLOAD_FAILURE actions', () => {
      const userId = 'a1b2c3', deviceKey = 'a_pump';
      const time = '2016-01-01T12:05:00.123Z';
      const targetDevice = {
        key: deviceKey,
        name: 'Acme Insulin Pump',
        source: {type: 'device', driverId: 'AcmePump'}
      };
      const initialState = {
        devices: {
          a_pump: targetDevice
        },
        os: 'mac',
        uploadsByUser: {
          [userId]: {
            a_cgm: {},
            a_pump: {history: [{start: time}]}
          }
        },
        targetDevices: {
          [userId]: ['a_cgm', 'a_pump']
        },
        targetTimezones: {
          [userId]: 'US/Mountain'
        },
        uploadTargetDevice: deviceKey,
        uploadTargetUser: userId,
        version: '0.100.0',
        working: {uploading: false}
      };
      let err = 'deviceTimePromptClose';
      __Rewire__('services', {
        api: {
          upload: {
            getVersions: (cb) => cb(null, {uploaderMinimum: '0.99.0'})
          }
        },
        device: {
          detect: (foo, bar, cb) => cb(null, {}),
          upload: (foo, bar, cb) => cb(err)
        }
      });
      const expectedActions = [
        {
          type: actionTypes.VERSION_CHECK_REQUEST,
          meta: {source: actionSources[actionTypes.VERSION_CHECK_REQUEST]}
        },
        {
          type: actionTypes.VERSION_CHECK_SUCCESS,
          meta: {source: actionSources[actionTypes.VERSION_CHECK_SUCCESS]}
        },
        {
          type: actionTypes.UPLOAD_REQUEST,
          payload: { userId, deviceKey, utc: time },
          meta: {
            source: actionSources[actionTypes.UPLOAD_REQUEST],
            metric: {
              eventName: 'Upload Attempted',
              properties: {type: targetDevice.source.type, source: targetDevice.source.driverId}
            }
          }
        },
        {
          type: actionTypes.DEVICE_DETECT_REQUEST,
          meta: {source: actionSources[actionTypes.DEVICE_DETECT_REQUEST]}
        },
        {
          type: actionTypes.UPLOAD_CANCELLED,
          payload: { utc: time },
          meta: {
            source: actionSources[actionTypes.UPLOAD_CANCELLED]
          }
        }
      ];
      const store = mockStore(initialState);
      store.dispatch(asyncActions.doUpload(deviceKey, {}, time));
      const actions = store.getActions();
      expect(actions).to.deep.equal(expectedActions);
    });
  });

  describe('doUpload [no error]', () => {
    it('should dispatch VERSION_CHECK_REQUEST, VERSION_CHECK_SUCCESS, UPLOAD_REQUEST, DEVICE_DETECT_REQUEST, UPLOAD_SUCCESS actions', () => {
      const userId = 'a1b2c3', deviceKey = 'a_pump';
      const time = '2016-01-01T12:05:00.123Z';
      const targetDevice = {
        key: deviceKey,
        name: 'Acme Insulin Pump',
        source: {type: 'device', driverId: 'AcmePump'}
      };
      const initialState = {
        devices: {
          a_pump: targetDevice
        },
        os: 'mac',
        uploadsByUser: {
          [userId]: {
            a_cgm: {},
            a_pump: {history: [{start: time}]}
          }
        },
        targetDevices: {
          [userId]: ['a_cgm', 'a_pump']
        },
        targetTimezones: {
          [userId]: 'US/Mountain'
        },
        uploadTargetDevice: deviceKey,
        uploadTargetUser: userId,
        version: '0.100.0',
        working: {uploading: false}
      };
      __Rewire__('services', {
        api: {
          upload: {
            getVersions: (cb) => cb(null, {uploaderMinimum: '0.99.0'})
          }
        },
        device: {
          detect: (foo, bar, cb) => cb(null, {}),
          upload: (foo, bar, cb) => cb(null, { post_records: [1,2,3,4,5], deviceModel: 'acme' })
        }
      });
      const expectedActions = [
        {
          type: actionTypes.VERSION_CHECK_REQUEST,
          meta: {source: actionSources[actionTypes.VERSION_CHECK_REQUEST]}
        },
        {
          type: actionTypes.VERSION_CHECK_SUCCESS,
          meta: {source: actionSources[actionTypes.VERSION_CHECK_SUCCESS]}
        },
        {
          type: actionTypes.UPLOAD_REQUEST,
          payload: { userId, deviceKey, utc: time },
          meta: {
            source: actionSources[actionTypes.UPLOAD_REQUEST],
            metric: {
              eventName: 'Upload Attempted',
              properties: {type: targetDevice.source.type, source: targetDevice.source.driverId}
            }
          }
        },
        {
          type: actionTypes.DEVICE_DETECT_REQUEST,
          meta: {source: actionSources[actionTypes.DEVICE_DETECT_REQUEST]}
        },
        {
          type: actionTypes.UPLOAD_SUCCESS,
          payload: { userId, deviceKey, utc: time, data: { deviceModel: 'acme', post_records: [1,2,3,4,5] } },
          meta: {
            source: actionSources[actionTypes.UPLOAD_SUCCESS],
            metric: {
              eventName: 'Upload Successful',
              properties: {
                type: targetDevice.source.type,
                deviceModel: 'acme',
                source: targetDevice.source.driverId,
                started: time,
                finished: time,
                processed: 5
              }
            }
          }
        }
      ];
      const store = mockStore(initialState);
      store.dispatch(asyncActions.doUpload(deviceKey, {}, time));
      const actions = store.getActions();
      expect(actions).to.deep.equal(expectedActions);
    });
  });

  describe('readFile', () => {
    describe('wrong file extension chosen', () => {
      it('should dispatch CHOOSING_FILE, READ_FILE_ABORTED actions', () => {
        const userId = 'abc123', deviceKey = 'a_pump', ext = '.abc', version = '0.100.0';
        let err = new Error(errorText.E_FILE_EXT + ext);
        err.code = 'E_FILE_EXT';
        err.version = version;
        err.debug = `Code: ${err.code} | Version: ${version}`;
        const expectedActions = [
          {
            type: actionTypes.CHOOSING_FILE,
            payload: { userId, deviceKey },
            meta: {source: actionSources[actionTypes.CHOOSING_FILE]}
          },
          {
            type: actionTypes.READ_FILE_ABORTED,
            error: true,
            payload: err,
            meta: {source: actionSources[actionTypes.READ_FILE_ABORTED]}
          }
        ];
        const state = {
          version: version
        };
        const store = mockStore(state);
        store.dispatch(asyncActions.readFile(userId, deviceKey, {name: 'data.csv'}, ext));
        const actions = store.getActions();
        expect(actions[1].payload).to.deep.include({
          message: errorText.E_FILE_EXT + ext,
          code: err.code,
          version: err.version,
          debug: err.debug
        });
        expectedActions[1].payload = actions[1].payload;
        expect(actions).to.deep.equal(expectedActions);
      });
    });
  });

  describe('doVersionCheck', () => {
    describe('API error when attempting to get versions info from jellyfish', () => {
      it('should dispatch VERSION_CHECK_REQUEST and VERSION_CHECK_FAILURE', () => {
        const err = new Error('API error!');
        const expectedActions = [
          {
            type: actionTypes.VERSION_CHECK_REQUEST,
            meta: {source: actionSources[actionTypes.VERSION_CHECK_REQUEST]}
          },
          {
            type: actionTypes.VERSION_CHECK_FAILURE,
            error: true,
            payload: err,
            meta: {
              source: actionSources[actionTypes.VERSION_CHECK_FAILURE],
              metric: {
                eventName: metrics.UNSUPPORTED_SCREEN_DISPLAYED
              }
            }
          }
        ];
        __Rewire__('services', {
          api: {
            upload: {
              getVersions: (cb) => { cb(err); }
            }
          }
        });
        const store = mockStore({});
        store.dispatch(asyncActions.doVersionCheck());
        const actions = store.getActions();
        expect(actions[1].payload).to.deep.include({message:'API error!'});
        expectedActions[1].payload = actions[1].payload;
        expect(actions).to.deep.equal(expectedActions);
      });
    });

    describe('missing or invalid semver in response from jellyfish', () => {
      it('should dispatch VERSION_CHECK_REQUEST and VERSION_CHECK_FAILURE', () => {
        const err = new Error('Invalid semver [foo.bar]');
        const expectedActions = [
          {
            type: actionTypes.VERSION_CHECK_REQUEST,
            meta: {source: actionSources[actionTypes.VERSION_CHECK_REQUEST]}
          },
          {
            type: actionTypes.VERSION_CHECK_FAILURE,
            error: true,
            payload: err,
            meta: {
              source: actionSources[actionTypes.VERSION_CHECK_FAILURE],
              metric: {
                eventName: metrics.UNSUPPORTED_SCREEN_DISPLAYED
              }
            }
          }
        ];
        __Rewire__('services', {
          api: {
            upload: {
              getVersions: (cb) => { cb(err); }
            }
          }
        });
        const store = mockStore({});
        store.dispatch(asyncActions.doVersionCheck());
        const actions = store.getActions();
        expect(actions[1].payload).to.deep.include({message:'Invalid semver [foo.bar]'});
        expectedActions[1].payload = actions[1].payload;
        expect(actions).to.deep.equal(expectedActions);
      });
    });

    describe('uploader\'s version is below the required minimum', () => {
      it('should dispatch VERSION_CHECK_REQUEST and VERSION_CHECK_FAILURE', () => {
        const currentVersion = '0.99.0', requiredVersion = '0.100.0';
        const err = new UnsupportedError(currentVersion, requiredVersion);
        const expectedActions = [
          {
            type: actionTypes.VERSION_CHECK_REQUEST,
            meta: {source: actionSources[actionTypes.VERSION_CHECK_REQUEST]}
          },
          {
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
          }
        ];
        __Rewire__('services', {
          api: {
            upload: {
              getVersions: (cb) => { cb(null, {uploaderMinimum: requiredVersion}); }
            }
          }
        });
        __Rewire__('versionInfo', {
          semver: currentVersion
        });
        const store = mockStore({});
        store.dispatch(asyncActions.doVersionCheck());
        const actions = store.getActions();
        expect(actions[1].payload).to.deep.include({message:err.message});
        expectedActions[1].payload = actions[1].payload;
        expect(actions).to.deep.equal(expectedActions);
      });
    });

    describe('uploader\'s version meets the minimum', () => {
      it('should dispatch VERSION_CHECK_REQUEST and VERSION_CHECK_SUCCESS', () => {
        const currentVersion = '0.100.0', requiredVersion = '0.100.0';
        const expectedActions = [
          {
            type: actionTypes.VERSION_CHECK_REQUEST,
            meta: {source: actionSources[actionTypes.VERSION_CHECK_REQUEST]}
          },
          {
            type: actionTypes.VERSION_CHECK_SUCCESS,
            meta: {source: actionSources[actionTypes.VERSION_CHECK_SUCCESS]}
          }
        ];
        __Rewire__('services', {
          api: {
            upload: {
              getVersions: (cb) => { cb(null, {uploaderMinimum: requiredVersion}); }
            }
          }
        });
        __Rewire__('versionInfo', {
          semver: currentVersion
        });
        const store = mockStore({});
        store.dispatch(asyncActions.doVersionCheck());
        const actions = store.getActions();
        expect(actions).to.deep.equal(expectedActions);
      });
    });
  });

  describe('clickDeviceSelectionDone', () => {
    describe('no targets in local storage', () => {
      it('should dispatch UPDATE_PROFILE_REQUEST, UPDATE_PROFILE_SUCCESS, SET_PAGE (redirect to main page)', () => {
        const profile = {
          fullName: 'John',
          patient: {
            birthday: '1990-08-08'
          }
        };
        const expectedActions = [
          {
            type: actionTypes.UPDATE_PROFILE_REQUEST,
            meta: {source: actionSources[actionTypes.UPDATE_PROFILE_REQUEST]}
          },
          {
            type: actionTypes.UPDATE_PROFILE_SUCCESS,
            payload: {userId: 'abc123', profile: profile},
            meta: {source: actionSources[actionTypes.UPDATE_PROFILE_SUCCESS]}
          },
          {
            type: '@@router/CALL_HISTORY_METHOD',
            payload: {
              args: [ {
                pathname: '/main',
                state: {
                  meta: {source: actionSources[actionTypes.SET_PAGE]}
                }
              } ],
              method: 'push'
            }
          }
        ];
        __Rewire__('services', {
          api: {
            user: {
              profile: (cb) => {
                cb(null);
              },
              updateProfile: (user, update, cb) => {
                cb(null, profile);
              }
            }
          },
          localStore: {
            getItem: () => null,
            setItem: () => null
          }
        });
        const state = {
          targetDevices: {
            abc123: ['a_pump', 'a_bg_meter']
          },
          targetTimezones: {
            abc123: 'Europe/Budapest'
          },
          uploadTargetUser: 'abc123',
          allUsers: {
            abc123: profile
          }
        };
        const store = mockStore(state);
        store.dispatch(asyncActions.clickDeviceSelectionDone());
        const actions = store.getActions();
        expect(actions).to.deep.equal(expectedActions);
      });
    });

    describe('existing targets in local storage', () => {
      it('should dispatch UPDATE_PROFILE_REQUEST, UPDATE_PROFILE_SUCCESS, SET_PAGE (redirect to main page)', () => {
        const profile = {
          fullName: 'John',
          patient: {
            birthday: '1990-08-08'
          }
        };
        const expectedActions = [
          {
            type: actionTypes.UPDATE_PROFILE_REQUEST,
            meta: {source: actionSources[actionTypes.UPDATE_PROFILE_REQUEST]}
          },
          {
            type: actionTypes.UPDATE_PROFILE_SUCCESS,
            payload: {userId: 'abc123', profile: profile},
            meta: {source: actionSources[actionTypes.UPDATE_PROFILE_SUCCESS]}
          },
          {
            type: '@@router/CALL_HISTORY_METHOD',
            payload: {
              args: [ {
                pathname: '/main',
                state: {
                  meta: {source: actionSources[actionTypes.SET_PAGE]}
                }
              } ],
              method: 'push'
            }
          }
        ];
        __Rewire__('services', {
          api: {
            user: {
              profile: (cb) => {
                cb(null);
              },
              updateProfile: (user, update, cb) => {
                cb(null, profile);
              }
            }
          },
          localStore: {
            getItem: () => null,
            setItem: () => { return {
              abc123: [
                {key: 'a_pump', timezone: 'US/Central'}
              ],
              def456: [
                {key: 'a_pump', timezone: 'US/Eastern'},
                {key: 'a_cgm', timezone: 'US/Eastern'}
              ]
            }; },
            removeItem: (item) => null
          }
        });
        const state = {
          targetDevices: {
            abc123: ['a_pump', 'a_bg_meter']
          },
          targetTimezones: {
            abc123: 'Europe/Budapest'
          },
          uploadTargetUser: 'abc123',
          allUsers: {
            abc123: profile
          }
        };
        const store = mockStore(state);
        store.dispatch(asyncActions.clickDeviceSelectionDone());
        const actions = store.getActions();
        expect(actions).to.deep.equal(expectedActions);
      });
    });

    describe('profile API endpoint failure', () => {
      it('should dispatch UPDATE_PROFILE_REQUEST, UPDATE_PROFILE_FAILURE, SET_PAGE (redirect to main page)', () => {
        const err = new Error(getUpdateProfileErrorMessage());
        const expectedActions = [
          {
            type: actionTypes.UPDATE_PROFILE_REQUEST,
            meta: {source: actionSources[actionTypes.UPDATE_PROFILE_REQUEST]}
          },
          {
            type: actionTypes.UPDATE_PROFILE_FAILURE,
            meta: {source: actionSources[actionTypes.UPDATE_PROFILE_FAILURE]},
            payload: err,
            error: true
          },
          {
            type: '@@router/CALL_HISTORY_METHOD',
            payload: {
              args: [ {
                pathname: '/main',
                 state: {
                  meta: {source: actionSources[actionTypes.SET_PAGE]}
                }
              } ],
              method: 'push'
            }
          }
        ];
        __Rewire__('services', {
          api: {
            user: {
              profile: (cb) => {
                cb(null);
              },
              updateProfile: (user, update, cb) => {
                cb(err);
              }
            }
          },
          localStore: {
            getItem: () => null,
            setItem: () => null
          }
        });
        const state = {
          allUsers: {
            abc123: {}
          },
          targetDevices: {
            abc123: ['a_pump', 'a_bg_meter']
          },
          targetTimezones: {
            abc123: 'Europe/Budapest'
          },
          uploadTargetUser: 'abc123'
        };
        const store = mockStore(state);
        store.dispatch(asyncActions.clickDeviceSelectionDone());
        const actions = store.getActions();
        expect(actions[1].payload).to.deep.include({message:getUpdateProfileErrorMessage()});
        expectedActions[1].payload = actions[1].payload;
        expect(actions).to.deep.equal(expectedActions);
      });
    });

    describe('profile API endpoint failure (unauthorized)', () => {
      it('should dispatch UPDATE_PROFILE_REQUEST, UPDATE_PROFILE_SUCCESS, SET_PAGE (redirect to main page)', () => {
        const profile = {
          fullName: 'John',
          patient: {
            birthday: '1990-08-08'
          }
        };
        const expectedActions = [
          {
            type: actionTypes.UPDATE_PROFILE_REQUEST,
            meta: {source: actionSources[actionTypes.UPDATE_PROFILE_REQUEST]}
          },
          {
            type: actionTypes.UPDATE_PROFILE_SUCCESS,
            payload: {userId: 'abc123', profile: profile},
            meta: {source: actionSources[actionTypes.UPDATE_PROFILE_SUCCESS]}
          },
          {
            type: '@@router/CALL_HISTORY_METHOD',
            payload: {
              args: [ {
                pathname: '/main',
                state: {
                  meta: {source: actionSources[actionTypes.SET_PAGE]}
                }
              } ],
              method: 'push'
            }
          }
        ];
        __Rewire__('services', {
          api: {
            user: {
              profile: (cb) => {
                cb(null);
              },
              updateProfile: (user, update, cb) => {
                cb({status:401, body:null});
              }
            }
          },
          localStore: {
            getItem: () => null,
            setItem: () => null
          }
        });
        const state = {
          targetDevices: {
            abc123: ['a_pump', 'a_bg_meter']
          },
          targetTimezones: {
            abc123: 'Europe/Budapest'
          },
          uploadTargetUser: 'abc123',
          allUsers: {
            abc123: profile
          }
        };
        const store = mockStore(state);
        store.dispatch(asyncActions.clickDeviceSelectionDone());
        const actions = store.getActions();
        expect(actions).to.deep.equal(expectedActions);
      });
    });
  });

  describe('clickEditUserNext', () => {
    describe('update profile success, user has devices selected', () => {
      it('should dispatch UPDATE_PROFILE_REQUEST, UPDATE_PROFILE_SUCCESS, SET_PAGE (main)', () => {
        const userObj = {user: {userid: 'abc123', roles: ['clinic']}};
        const profile = {fullName: 'Jane Doe'};
        const memberships = [{userid: 'def456'}, {userid: 'ghi789'}];
        const expectedActions = [
          {
            type: actionTypes.UPDATE_PROFILE_REQUEST,
            meta: {source: actionSources[actionTypes.UPDATE_PROFILE_REQUEST]}
          },
          {
            type: actionTypes.UPDATE_PROFILE_SUCCESS,
            payload: {userId: 'def456', profile: {}},
            meta: {source: actionSources[actionTypes.UPDATE_PROFILE_SUCCESS]}
          },
          {
            type: '@@router/CALL_HISTORY_METHOD',
            payload: {
              args: [ {
                pathname: '/main',
                state: {
                  meta: {source: actionSources[actionTypes.SET_PAGE]}
                }
              } ],
              method: 'push'
            }
          }
        ];
        __Rewire__('services', {
          api: {
            user: {
              account: (cb) => cb(null, userObj.user),
              loggedInProfile: (cb) => cb(null, profile),
              getUploadGroups: (cb) => cb(null, memberships),
              updateProfile: (user, update, cb) => cb(null, {})
            }
          }
        });
        const state = {
          allUsers: {
            ghi789: {},
            abc123: {roles: ['clinic']},
            def456: {},
          },
          devices: {
            dexcom: {},
            omnipod: {}
          },
          targetDevices: {
            def456: ['dexcom']
          },
          users: {
            abc123: {
              targets: {}
            },
            def456: {
              targets: {
                devices: ['dexcom'],
                timezone: 'Europe/London'
              }
            }
          },
          loggedInUser: 'abc123',
          uploadTargetUser: 'def456'
        };
        const store = mockStore(state);
        store.dispatch(asyncActions.clickEditUserNext(profile));
        const actions = store.getActions();
        expect(actions).to.deep.equal(expectedActions);
      });
    });
    describe('update profile success, user doesn\'t have devices selected', () => {
      it('should dispatch UPDATE_PROFILE_REQUEST, UPDATE_PROFILE_SUCCESS, SET_PAGE (settings)', () => {
        const userObj = {user: {userid: 'abc123', roles: ['clinic']}};
        const profile = {fullName: 'Jane Doe'};
        const memberships = [{userid: 'def456'}, {userid: 'ghi789'}];
        const expectedActions = [
          {
            type: actionTypes.UPDATE_PROFILE_REQUEST,
            meta: {source: actionSources[actionTypes.UPDATE_PROFILE_REQUEST]}
          },
          {
            type: actionTypes.UPDATE_PROFILE_SUCCESS,
            payload: {userId: 'def456', profile: {}},
            meta: {source: actionSources[actionTypes.UPDATE_PROFILE_SUCCESS]}
          },
          {
            type: '@@router/CALL_HISTORY_METHOD',
            payload: {
              args: [ {
                pathname: '/settings',
                state: {
                  meta: {source: actionSources[actionTypes.SET_PAGE]}
                }
              } ],
              method: 'push'
            }
          }
        ];
        __Rewire__('services', {
          api: {
            user: {
              account: (cb) => cb(null, userObj.user),
              loggedInProfile: (cb) => cb(null, profile),
              getUploadGroups: (cb) => cb(null, memberships),
              updateProfile: (user, update, cb) => cb(null, {})
            }
          },
          log: _.noop
        });
        const state = {
          allUsers: {
            ghi789: {},
            abc123: {},
            def456: {},
          },
          devices: {
            dexcom: {},
            omnipod: {}
          },
          users: {
            abc123: {
              targets: {}
            },
            def456: {
              targets: {
                timezone: 'Europe/London'
              }
            }
          },
          uploadTargetUser: 'def456'
        };
        const store = mockStore(state);
        store.dispatch(asyncActions.clickEditUserNext(profile));
        const actions = store.getActions();
        expect(actions).to.deep.equal(expectedActions);
      });
    });
    describe('update profile failure', () => {
      it('should dispatch UPDATE_PROFILE_REQUEST, UPDATE_PROFILE_FAILURE ', () => {
        const profile = {fullName: 'Jane Doe'};
        const expectedActions = [
          {
            type: actionTypes.UPDATE_PROFILE_REQUEST,
            meta: {source: actionSources[actionTypes.UPDATE_PROFILE_REQUEST]}
          },
          {
            type: actionTypes.UPDATE_PROFILE_FAILURE,
            payload: new Error(getUpdateProfileErrorMessage()),
            error: true,
            meta: {source: actionSources[actionTypes.UPDATE_PROFILE_FAILURE]}
          }
        ];
        __Rewire__('services', {
          api: {
            user: {
              updateProfile: (user, update, cb) => cb('error')
            }
          },
          log: _.noop
        });
        const store = mockStore({});
        store.dispatch(asyncActions.clickEditUserNext(profile));
        const actions = store.getActions();
        expect(actions[1].payload).to.deep.include({message:getUpdateProfileErrorMessage()});
        expectedActions[1].payload = actions[1].payload;
        expect(actions).to.deep.equal(expectedActions);
      });
    });
    describe('update profile failure, unauthorized', () => {
      it('should dispatch UPDATE_PROFILE_REQUEST, UPDATE_PROFILE_SUCCESS, SET_PAGE (settings) ', () => {
        const profile = {fullName: 'Jane Doe'};
        const expectedActions = [
          {
            type: actionTypes.UPDATE_PROFILE_REQUEST,
            meta: {source: actionSources[actionTypes.UPDATE_PROFILE_REQUEST]}
          },
          {
            type: actionTypes.UPDATE_PROFILE_SUCCESS,
            payload: {userId: 'def456', profile},
            meta: {source: actionSources[actionTypes.UPDATE_PROFILE_SUCCESS]}
          },
          {
            type: '@@router/CALL_HISTORY_METHOD',
            payload: {
              args: [ {
                pathname: '/settings',
                state: {
                  meta: {source: actionSources[actionTypes.SET_PAGE]}
                }
              } ],
              method: 'push'
            }
          }
        ];
        __Rewire__('services', {
          api: {
            user: {
              updateProfile: (user, update, cb) => cb({status:401})
            }
          },
          log: _.noop
        });
        const store = mockStore({
          allUsers: {
            def456: {}
          },
          devices: {
            dexcom: {},
            omnipod: {}
          },
          uploadTargetUser:'def456'
        });
        store.dispatch(asyncActions.clickEditUserNext(profile));
        const actions = store.getActions();
        expect(actions).to.deep.equal(expectedActions);
      });
    });
  });

  describe('setTargetTimezone', () => {
    describe('update profile success', () => {
      it('should dispatch UPDATE_PROFILE_REQUEST, UPDATE_PROFILE_SUCCESS, SET_TARGET_TIMEZONE', () => {
        const profile = {
          fullName: 'John',
          patient: {
            birthday: '1990-08-08'
          }
        };
        const expectedActions = [
          {
            type: actionTypes.UPDATE_PROFILE_REQUEST,
            meta: {source: actionSources[actionTypes.UPDATE_PROFILE_REQUEST]}
          },
          {
            type: actionTypes.UPDATE_PROFILE_SUCCESS,
            payload: {userId: 'abc123', profile: profile},
            meta: {source: actionSources[actionTypes.UPDATE_PROFILE_SUCCESS]}
          },
          {
            type: actionTypes.SET_TARGET_TIMEZONE,
            payload: {userId:'abc123',timezoneName:'US/Central'},
            meta: {source: actionSources[actionTypes.SET_TARGET_TIMEZONE]}
          }
        ];
        __Rewire__('services', {
          api: {
            user: {
              profile: (cb) => {
                cb(null);
              },
              updateProfile: (user, update, cb) => {
                cb(null, profile);
              }
            }
          }
        });
        const state = {
          targetDevices: {
            abc123: ['a_pump', 'a_bg_meter']
          },
          targetTimezones: {
            abc123: 'Europe/Budapest'
          },
          uploadTargetUser: 'abc123',
          allUsers: {
            abc123: profile
          }
        };
        const store = mockStore(state);
        store.dispatch(asyncActions.setTargetTimezone('abc123', 'US/Central'));
        const actions = store.getActions();
        expect(actions).to.deep.equal(expectedActions);
      });
    });

    describe('update profile failure', () => {
      it('should dispatch UPDATE_PROFILE_REQUEST, UPDATE_PROFILE_FAILURE, SET_TARGET_TIMEZONE', () => {
        const expectedActions = [
          {
            type: actionTypes.UPDATE_PROFILE_REQUEST,
            meta: {source: actionSources[actionTypes.UPDATE_PROFILE_REQUEST]}
          },
          {
            type: actionTypes.UPDATE_PROFILE_FAILURE,
            meta: {source: actionSources[actionTypes.UPDATE_PROFILE_FAILURE]},
            payload: new Error(getUpdateProfileErrorMessage()),
            error: true
          },
          {
            type: actionTypes.SET_TARGET_TIMEZONE,
            payload: {userId:'abc123',timezoneName:'US/Central'},
            meta: {source: actionSources[actionTypes.SET_TARGET_TIMEZONE]}
          }
        ];
        __Rewire__('services', {
          api: {
            user: {
              profile: (cb) => {
                cb(null);
              },
              updateProfile: (user, update, cb) => {
                cb(getUpdateProfileErrorMessage());
              }
            }
          }
        });
        const state = {
          allUsers: {
            abc123: {}
          },
          targetDevices: {
            abc123: ['a_pump', 'a_bg_meter']
          },
          targetTimezones: {
            abc123: 'Europe/Budapest'
          },
          uploadTargetUser: 'abc123'
        };
        const store = mockStore(state);
        store.dispatch(asyncActions.setTargetTimezone('abc123', 'US/Central'));
        const actions = store.getActions();
        expect(actions[1].payload).to.deep.include({message:getUpdateProfileErrorMessage()});
        expectedActions[1].payload = actions[1].payload;
        expect(actions).to.deep.equal(expectedActions);
      });
    });

    describe('update profile failure (unauthorized)', () => {
      it('should dispatch UPDATE_PROFILE_REQUEST, UPDATE_PROFILE_SUCCESS, SET_TARGET_TIMEZONE', () => {
        const profile = {
          fullName: 'John',
          patient: {
            birthday: '1990-08-08'
          }
        };
        const expectedActions = [
          {
            type: actionTypes.UPDATE_PROFILE_REQUEST,
            meta: {source: actionSources[actionTypes.UPDATE_PROFILE_REQUEST]}
          },
          {
            type: actionTypes.UPDATE_PROFILE_SUCCESS,
            payload: {userId: 'abc123', profile: profile},
            meta: {source: actionSources[actionTypes.UPDATE_PROFILE_SUCCESS]},
          },
          {
            type: actionTypes.SET_TARGET_TIMEZONE,
            payload: {userId:'abc123',timezoneName:'US/Central'},
            meta: {source: actionSources[actionTypes.SET_TARGET_TIMEZONE]}
          }
        ];
        __Rewire__('services', {
          api: {
            user: {
              profile: (cb) => {
                cb(null);
              },
              updateProfile: (user, update, cb) => {
                cb({status:401, body:null});
              }
            }
          }
        });
        const state = {
          targetDevices: {
            abc123: ['a_pump', 'a_bg_meter']
          },
          targetTimezones: {
            abc123: 'Europe/Budapest'
          },
          uploadTargetUser: 'abc123',
          allUsers: {
            abc123: profile
          }
        };
        const store = mockStore(state);
        store.dispatch(asyncActions.setTargetTimezone('abc123', 'US/Central'));
        const actions = store.getActions();
        expect(actions).to.deep.equal(expectedActions);
      });
    });
  });

  describe('retrieveTargetsFromStorage', () => {
    const url = 'http://acme-blip.com/patients/abc123/data';
    const blipUrlMaker = (path) => { return 'http://acme-blip.com' + path; };
    const profile = {
      fullName: 'John',
      patient: {
        birthday: '1990-08-08'
      }
    };
    describe('no targets retrieved from local storage, no targets exist in state', () => {
      it('should dispatch RETRIEVING_USERS_TARGETS, SET_PAGE (redirect to settings page)', () => {
        const expectedActions = [
          {
            type: actionTypes.RETRIEVING_USERS_TARGETS,
            meta: {source: actionSources[actionTypes.RETRIEVING_USERS_TARGETS]}
          },
          {
            type: '@@router/CALL_HISTORY_METHOD',
            payload: {
              args: [ {
                pathname: '/settings',
                state: {
                  meta: {source: actionSources[actionTypes.SET_PAGE]}
                }
              } ],
              method: 'push'
            }
          }
        ];
        __Rewire__('services', {
          localStore: {
            getItem: () => null,
            removeItem: (item) => null
          }
        });
        const store = mockStore({allUsers: {'abc123':{}}});
        store.dispatch(asyncActions.retrieveTargetsFromStorage());
        const actions = store.getActions();
        expect(actions).to.deep.equal(expectedActions);
      });
    });

    describe('no targets retrieved from local storage, targets exist in state but no user targeted for upload by default', () => {
      it('should dispatch RETRIEVING_USERS_TARGETS, SET_PAGE (redirect to settings page for user selection)', () => {
        const expectedActions = [
          {
            type: actionTypes.RETRIEVING_USERS_TARGETS,
            meta: {source: actionSources[actionTypes.RETRIEVING_USERS_TARGETS]}
          },
          {
            type: '@@router/CALL_HISTORY_METHOD',
            payload: {
              args: [ {
                pathname: '/settings',
                state: {
                  meta: {source: actionSources[actionTypes.SET_PAGE]}
                }
              } ],
              method: 'push'
            }
          }
        ];
        __Rewire__('services', {
          localStore: {
            getItem: () => null,
            removeItem: (item) => null
          }
        });
        const state = {
          allUsers: {
            ghi789: {},
            abc123: {},
            def456: {},
          },
          loggedInUser: 'ghi789',
          targetsForUpload: ['abc123', 'def456'],
          uploadTargetUser: null,
          targetDevices: {
            abc123: ['medtronic']
          }
        };
        const store = mockStore(state);
        store.dispatch(asyncActions.retrieveTargetsFromStorage());
        const actions = store.getActions();
        expect(actions).to.deep.equal(expectedActions);
      });
    });

    describe('no targets retrieved from local storage, targets exist in state but user targeted has no supported devices', () => {
      it('should dispatch RETRIEVING_USERS_TARGETS, SET_UPLOADS, SET_PAGE (redirect to settings page for device selection)', () => {
        const devicesByUser = {
          abc123: ['medtronic'],
          def456: ['dexcom', 'omnipod']
        };
        const expectedActions = [
          {
            type: actionTypes.RETRIEVING_USERS_TARGETS,
            meta: {source: actionSources[actionTypes.RETRIEVING_USERS_TARGETS]}
          },
          {
            type: actionTypes.SET_UPLOADS,
            payload: { devicesByUser },
            meta: {source: actionSources[actionTypes.SET_UPLOADS]}
          },
          {
            type: '@@router/CALL_HISTORY_METHOD',
            payload: {
              args: [ {
                pathname: '/settings',
                state: {
                  meta: {source: actionSources[actionTypes.SET_PAGE]}
                }
              } ],
              method: 'push'
            }
          }
        ];
        __Rewire__('services', {
          api: {
            makeBlipUrl: blipUrlMaker
          },
          localStore: {
            getItem: () => null,
            removeItem: (item) => null
          }
        });
        const store = mockStore({
          allUsers: {
            ghi789: {},
            abc123: {},
            def456: {},
          },
          devices: {
            dexcom: {},
            omnipod: {}
          },
          loggedInUser: 'ghi789',
          targetsForUpload: ['abc123', 'def456'],
          uploadTargetUser: 'abc123',
          targetDevices: devicesByUser
        });
        store.dispatch(asyncActions.retrieveTargetsFromStorage());
        const actions = store.getActions();
        expect(actions).to.deep.equal(expectedActions);
      });
    });

    describe('no targets retrieved from local storage, targets exist in state and user targeted for upload is all set to upload', () => {
      it('should dispatch RETRIEVING_USERS_TARGETS, SET_UPLOADS, then SET_PAGE (redirect to main page)', () => {
        const devicesByUser = {
          abc123: ['medtronic'],
          def456: ['dexcom', 'omnipod']
        };
        const expectedActions = [
          {
            type: actionTypes.RETRIEVING_USERS_TARGETS,
            meta: {source: actionSources[actionTypes.RETRIEVING_USERS_TARGETS]}
          },
          {
            type: actionTypes.SET_UPLOADS,
            payload: { devicesByUser },
            meta: {source: actionSources[actionTypes.SET_UPLOADS]}
          },
          {
            type: '@@router/CALL_HISTORY_METHOD',
            payload: {
              args: [ {
                pathname: '/main',
                state: {
                  meta: {source: actionSources[actionTypes.SET_PAGE]}
                }
              } ],
              method: 'push'
            }
          }
        ];
        __Rewire__('services', {
          api: {
            makeBlipUrl: blipUrlMaker
          },
          localStore: {
            getItem: () => null,
            removeItem: (item) => null
          }
        });
        const store = mockStore({
          allUsers: {
            ghi789: {},
            abc123: {},
            def456: {},
          },
          devices: {
            medtronic: {},
            dexcom: {},
            omnipod: {}
          },
          loggedInUser: 'ghi789',
          uploadTargetUser: 'abc123',
          targetDevices: devicesByUser
        });
        store.dispatch(asyncActions.retrieveTargetsFromStorage());
        const actions = store.getActions();
        expect(actions).to.deep.equal(expectedActions);
      });
    });

    describe('targets retrieved, but no user targeted for upload by default', () => {
      it('should dispatch RETRIEVING_USERS_TARGETS, SET_USERS_TARGETS, SET_UPLOADS, then SET_PAGE (redirect to settings page for user selection)', () => {
        const targets = {
          abc123: [{key: 'medtronic', timezone: 'US/Eastern'}],
          def456: [
            {key: 'dexcom', timezone: 'US/Mountain'},
            {key: 'omnipod', timezone: 'US/Mountain'}
          ]
        };
        const devicesByUser = {
          abc123: ['medtronic'],
          def456: ['dexcom', 'omnipod']
        };
        const expectedActions = [
          {
            type: actionTypes.RETRIEVING_USERS_TARGETS,
            meta: {source: actionSources[actionTypes.RETRIEVING_USERS_TARGETS]}
          },
          {
            type: actionTypes.SET_UPLOADS,
            payload: { devicesByUser },
            meta: {source: actionSources[actionTypes.SET_UPLOADS]}
          },
          {
            type: actionTypes.SET_USERS_TARGETS,
            payload: { targets },
            meta: {source: actionSources[actionTypes.SET_USERS_TARGETS]}
          },
          {
            type: '@@router/CALL_HISTORY_METHOD',
            payload: {
              args: [ {
                pathname: '/settings',
                state: {
                  meta: {source: actionSources[actionTypes.SET_PAGE]}
                }
              } ],
              method: 'push'
            }
          }
        ];
        __Rewire__('services', {
          localStore: {
            getItem: () => targets,
            removeItem: (item) => null
          }
        });
        const store = mockStore({
          allUsers: {
            ghi789: {},
            abc123: {},
            def456: {},
          },
          loggedInUser: 'ghi789',
          targetsForUpload: ['abc123', 'def456'],
          uploadTargetUser: null
        });
        store.dispatch(asyncActions.retrieveTargetsFromStorage());
        const actions = store.getActions();
        expect(actions).to.deep.equal(expectedActions);
      });
    });

    describe('targets retrieved, user targeted for upload is missing timezone', () => {
      it('should dispatch RETRIEVING_USERS_TARGETS, SET_UPLOADS, SET_USERS_TARGETS, UPDATE_PROFILE_REQUEST, UPDATE_PROFILE_SUCCESS, then SET_PAGE (redirect to main page for timezone selection)', () => {
        const targets = {
          abc123: [{key: 'medtronic'}],
          def456: [
            {key: 'dexcom', timezone: 'US/Mountain'},
            {key: 'omnipod', timezone: 'US/Mountain'}
          ]
        };
        const devicesByUser = {
          abc123: ['medtronic'],
          def456: ['dexcom', 'omnipod']
        };
        const expectedActions = [
          {
            type: actionTypes.RETRIEVING_USERS_TARGETS,
            meta: {source: actionSources[actionTypes.RETRIEVING_USERS_TARGETS]}
          },
          {
            type: actionTypes.SET_UPLOADS,
            payload: { devicesByUser },
            meta: {source: actionSources[actionTypes.SET_UPLOADS]}
          },
          {
            type: actionTypes.SET_USERS_TARGETS,
            payload: { targets },
            meta: {source: actionSources[actionTypes.SET_USERS_TARGETS]}
          },
          {
            type: actionTypes.UPDATE_PROFILE_REQUEST,
            meta: {source: actionSources[actionTypes.UPDATE_PROFILE_REQUEST]}
          },
          {
            type: actionTypes.UPDATE_PROFILE_SUCCESS,
            payload: {userId: 'abc123', profile: profile},
            meta: {source: actionSources[actionTypes.UPDATE_PROFILE_SUCCESS]},
          },
          {
            type: '@@router/CALL_HISTORY_METHOD',
            payload: {
              args: [ {
                pathname: '/main',
                state: {
                  meta: {source: actionSources[actionTypes.SET_PAGE]}
                }
              } ],
              method: 'push'
            }
          }
        ];
        __Rewire__('services', {
          api: {
            user: {
              profile: (cb) => {
                cb(null);
              },
              updateProfile: (user, update, cb) => {
                cb(null, profile);
              }
            },
            makeBlipUrl: blipUrlMaker
          },
          localStore: {
            getItem: () => targets,
            removeItem: (item) => null
          }
        });
        const store = mockStore({
          allUsers: {
            ghi789: {},
            abc123: profile,
            def456: {},
          },
          devices: {
            medtronic: {},
            dexcom: {},
            omnipod: {}
          },
          loggedInUser: 'ghi789',
          targetsForUpload: ['abc123', 'def456'],
          uploadTargetUser: 'abc123',
          targetDevices: {
            abc123: ['medtronic']
          },
          targetTimezones: {
            abc123: 'US/Mountain'
          }
        });
        store.dispatch(asyncActions.retrieveTargetsFromStorage());
        const actions = store.getActions();
        expect(actions).to.deep.equal(expectedActions);
      });
    });

    describe('targets retrieved, user targeted for upload is missing timezone, update profile unauthorized error', () => {
      it('should dispatch RETRIEVING_USERS_TARGETS, SET_UPLOADS, SET_USERS_TARGETS, UPDATE_PROFILE_REQUEST, UPDATE_PROFILE_SUCCESS, then SET_PAGE (redirect to main page for timezone selection)', () => {
        const targets = {
          abc123: [{key: 'medtronic'}],
          def456: [
            {key: 'dexcom', timezone: 'US/Mountain'},
            {key: 'omnipod', timezone: 'US/Mountain'}
          ]
        };
        const devicesByUser = {
          abc123: ['medtronic'],
          def456: ['dexcom', 'omnipod']
        };
        const expectedActions = [
          {
            type: actionTypes.RETRIEVING_USERS_TARGETS,
            meta: {source: actionSources[actionTypes.RETRIEVING_USERS_TARGETS]}
          },
          {
            type: actionTypes.SET_UPLOADS,
            payload: { devicesByUser },
            meta: {source: actionSources[actionTypes.SET_UPLOADS]}
          },
          {
            type: actionTypes.SET_USERS_TARGETS,
            payload: { targets },
            meta: {source: actionSources[actionTypes.SET_USERS_TARGETS]}
          },
          {
            type: actionTypes.UPDATE_PROFILE_REQUEST,
            meta: {source: actionSources[actionTypes.UPDATE_PROFILE_REQUEST]}
          },
          {
            type: actionTypes.UPDATE_PROFILE_SUCCESS,
            payload: {userId: 'abc123', profile: profile},
            meta: {source: actionSources[actionTypes.UPDATE_PROFILE_SUCCESS]}
          },
          {
            type: '@@router/CALL_HISTORY_METHOD',
            payload: {
              args: [ {
                pathname: '/main',
                state: {
                  meta: {source: actionSources[actionTypes.SET_PAGE]}
                }
              } ],
              method: 'push'
            }
          }
        ];
        __Rewire__('services', {
          api: {
            user: {
              profile: (cb) => {
                cb(null);
              },
              updateProfile: (user, update, cb) => {
                cb({status:401, body:null});
              }
            },
            makeBlipUrl: blipUrlMaker
          },
          localStore: {
            getItem: () => targets,
            removeItem: (item) => null
          }
        });
        const store = mockStore({
          allUsers: {
            ghi789: {},
            abc123: profile,
            def456: {},
          },
          devices: {
            medtronic: {},
            dexcom: {},
            omnipod: {}
          },
          loggedInUser: 'ghi789',
          targetsForUpload: ['abc123', 'def456'],
          uploadTargetUser: 'abc123',
          targetDevices: {
            abc123: ['medtronic']
          },
          targetTimezones: {
            abc123: 'US/Mountain'
          }
        });
        store.dispatch(asyncActions.retrieveTargetsFromStorage());
        const actions = store.getActions();
        expect(actions).to.deep.equal(expectedActions);
      });
    });

    describe('targets retrieved, user targeted for upload has no supported devices', () => {
      it('should dispatch RETRIEVING_USERS_TARGETS, SET_UPLOADS, SET_USERS_TARGETS, then SET_PAGE (redirect to settings page for device selection)', () => {
        const targets = {
          abc123: [{key: 'medtronic', timezone: 'US/Eastern'}],
          def456: [
            {key: 'dexcom', timezone: 'US/Mountain'},
            {key: 'omnipod', timezone: 'US/Mountain'}
          ]
        };
        const devicesByUser = {
          abc123: ['medtronic'],
          def456: ['dexcom', 'omnipod']
        };
        const expectedActions = [
          {
            type: actionTypes.RETRIEVING_USERS_TARGETS,
            meta: {source: actionSources[actionTypes.RETRIEVING_USERS_TARGETS]}
          },
          {
            type: actionTypes.SET_UPLOADS,
            payload: { devicesByUser },
            meta: {source: actionSources[actionTypes.SET_UPLOADS]}
          },
          {
            type: actionTypes.SET_USERS_TARGETS,
            payload: { targets },
            meta: {source: actionSources[actionTypes.SET_USERS_TARGETS]}
          },
          {
            type: '@@router/CALL_HISTORY_METHOD',
            payload: {
              args: [ {
                pathname: '/settings',
                state: {
                  meta: {source: actionSources[actionTypes.SET_PAGE]}
                }
              } ],
              method: 'push'
            }
          }
        ];
        __Rewire__('services', {
          api: {
            makeBlipUrl: blipUrlMaker
          },
          localStore: {
            getItem: () => targets,
            removeItem: (item) => null
          }
        });
        const store = mockStore({
          allUsers: {
            ghi789: {},
            abc123: {},
            def456: {},
          },
          devices: {
            dexcom: {},
            omnipod: {}
          },
          loggedInUser: 'ghi789',
          targetsForUpload: ['abc123', 'def456'],
          uploadTargetUser: 'abc123'
        });
        store.dispatch(asyncActions.retrieveTargetsFromStorage());
        const actions = store.getActions();
        expect(actions).to.deep.equal(expectedActions);
      });
    });

    describe('targets retrieved, user targeted for upload is all set to upload', () => {
      it('should dispatch RETRIEVING_USERS_TARGETS, SET_UPLOADS, SET_USERS_TARGETS, UPDATE_PROFILE_REQUEST, UPDATE_PROFILE_SUCCESS, then SET_PAGE (redirect to main page)', () => {
        const targets = {
          abc123: [{key: 'medtronic', timezone: 'US/Eastern'}],
          def456: [
            {key: 'dexcom', timezone: 'US/Mountain'},
            {key: 'omnipod', timezone: 'US/Mountain'}
          ]
        };
        const devicesByUser = {
          abc123: ['medtronic'],
          def456: ['dexcom', 'omnipod']
        };
        const expectedActions = [
          {
            type: actionTypes.RETRIEVING_USERS_TARGETS,
            meta: {source: actionSources[actionTypes.RETRIEVING_USERS_TARGETS]}
          },
          {
            type: actionTypes.SET_UPLOADS,
            payload: { devicesByUser },
            meta: {source: actionSources[actionTypes.SET_UPLOADS]}
          },
          {
            type: actionTypes.SET_USERS_TARGETS,
            payload: { targets },
            meta: {source: actionSources[actionTypes.SET_USERS_TARGETS]}
          },
          {
            type: actionTypes.UPDATE_PROFILE_REQUEST,
            meta: {source: actionSources[actionTypes.UPDATE_PROFILE_REQUEST]}
          },
          {
            type: actionTypes.UPDATE_PROFILE_SUCCESS,
            payload: {userId: 'abc123', profile: profile},
            meta: {source: actionSources[actionTypes.UPDATE_PROFILE_SUCCESS]}
          },
          {
            type: '@@router/CALL_HISTORY_METHOD',
            payload: {
              args: [ {
                pathname: '/main',
                state: {
                  meta: {source: actionSources[actionTypes.SET_PAGE]}
                }
              } ],
              method: 'push'
            }
          }
        ];
        __Rewire__('services', {
          api: {
            user: {
              profile: (cb) => {
                cb(null);
              },
              updateProfile: (user, update, cb) => {
                cb(null, profile);
              }
            },
            makeBlipUrl: blipUrlMaker
          },
          localStore: {
            getItem: () => targets,
            removeItem: (item) => null
          }
        });
        const store = mockStore({
          allUsers: {
            ghi789: {},
            abc123: profile,
            def456: {},
          },
          devices: {
            medtronic: {},
            dexcom: {},
            omnipod: {}
          },
          loggedInUser: 'ghi789',
          uploadTargetUser: 'abc123',
          targetDevices: devicesByUser,
          targetTimezones: {
            abc123: 'US/Mountain'
          }
        });
        store.dispatch(asyncActions.retrieveTargetsFromStorage());
        const actions = store.getActions();
        expect(actions).to.deep.equal(expectedActions);
      });
    });

    describe('targets retrieved, user targeted for upload is all set to upload, update profile unauthorized error', () => {
      it('should dispatch RETRIEVING_USERS_TARGETS, SET_UPLOADS, SET_USERS_TARGETS, UPDATE_PROFILE_REQUEST, UPDATE_PROFILE_SUCCESS, then SET_PAGE (redirect to main page)', () => {
        const targets = {
          abc123: [{key: 'medtronic', timezone: 'US/Eastern'}],
          def456: [
            {key: 'dexcom', timezone: 'US/Mountain'},
            {key: 'omnipod', timezone: 'US/Mountain'}
          ]
        };
        const devicesByUser = {
          abc123: ['medtronic'],
          def456: ['dexcom', 'omnipod']
        };
        const expectedActions = [
          {
            type: actionTypes.RETRIEVING_USERS_TARGETS,
            meta: {source: actionSources[actionTypes.RETRIEVING_USERS_TARGETS]}
          },
          {
            type: actionTypes.SET_UPLOADS,
            payload: { devicesByUser },
            meta: {source: actionSources[actionTypes.SET_UPLOADS]}
          },
          {
            type: actionTypes.SET_USERS_TARGETS,
            payload: { targets },
            meta: {source: actionSources[actionTypes.SET_USERS_TARGETS]}
          },
          {
            type: actionTypes.UPDATE_PROFILE_REQUEST,
            meta: {source: actionSources[actionTypes.UPDATE_PROFILE_REQUEST]}
          },
          {
            type: actionTypes.UPDATE_PROFILE_SUCCESS,
            payload: {userId: 'abc123', profile: profile},
            meta: {source: actionSources[actionTypes.UPDATE_PROFILE_SUCCESS]}
          },
          {
            type: '@@router/CALL_HISTORY_METHOD',
            payload: {
              args: [ {
                pathname: '/main',
                state: {
                  meta: {source: actionSources[actionTypes.SET_PAGE]}
                }
              } ],
              method: 'push'
            }
          }
        ];
        __Rewire__('services', {
          api: {
            user: {
              profile: (cb) => {
                cb(null);
              },
              updateProfile: (user, update, cb) => {
                cb({status:401, body:null});
              }
            },
            makeBlipUrl: blipUrlMaker
          },
          localStore: {
            getItem: () => targets,
            removeItem: (item) => null
          }
        });
        const store = mockStore({
          allUsers: {
            ghi789: {},
            abc123: profile,
            def456: {},
          },
          devices: {
            medtronic: {},
            dexcom: {},
            omnipod: {}
          },
          loggedInUser: 'ghi789',
          uploadTargetUser: 'abc123',
          targetDevices: devicesByUser,
          targetTimezones: {
            abc123: 'US/Mountain'
          }
        });
        store.dispatch(asyncActions.retrieveTargetsFromStorage());
        const actions = store.getActions();
        expect(actions).to.deep.equal(expectedActions);
      });
    });
  });

  describe('createCustodialAccount', () => {
    describe('create account success', () => {
      it('should dispatch CREATE_CUSTODIAL_ACCOUNT_REQUEST, CREATE_CUSTODIAL_ACCOUNT_SUCCESS, SET_UPLOAD_TARGET_USER, SET_PAGE (settings)', () => {
        const userObj = {user: {userid: 'abc123', roles: ['clinic']}};
        const profile = {fullName: 'Jane Doe', patient: { birthday: '2010-01-01' }};
        const memberships = [{userid: 'def456'}, {userid: 'ghi789'}];
        const newUser = { userid: 'jkl012', profile: profile };
        const expectedActions = [
          {
            type: actionTypes.CREATE_CUSTODIAL_ACCOUNT_REQUEST,
            meta: {source: actionSources[actionTypes.CREATE_CUSTODIAL_ACCOUNT_REQUEST]}
          },
          {
            type: actionTypes.CREATE_CUSTODIAL_ACCOUNT_SUCCESS,
            payload: {
              account: newUser
            },
            meta: {
              source: actionSources[actionTypes.CREATE_CUSTODIAL_ACCOUNT_SUCCESS],
              metric: {eventName: metrics.CLINIC_ADD_NEW_PATIENT}
            }
          },
          {
            type: actionTypes.SET_UPLOAD_TARGET_USER,
            payload: { userId: newUser.userid },
            meta: {source: actionSources[actionTypes.SET_UPLOAD_TARGET_USER]}
          },
          {
            type: '@@router/CALL_HISTORY_METHOD',
            payload: {
              args: [ {
                pathname: '/settings',
                state: {
                  meta: {source: actionSources[actionTypes.SET_PAGE]}
                }
              } ],
              method: 'push'
            }
          }
        ];
        __Rewire__('services', {
          api: {
            user: {
              account: (cb) => cb(null, userObj.user),
              loggedInProfile: (cb) => cb(null, profile),
              getUploadGroups: (cb) => cb(null, memberships),
              createCustodialAccount: (profile, cb) => cb(null, newUser)
            }
          }
        });
        const store = mockStore({});
        store.dispatch(asyncActions.createCustodialAccount(profile));
        const actions = store.getActions();
        expect(actions).to.deep.equal(expectedActions);
      });
    });
    describe('create account failure', () => {
      it('should dispatch CREATE_CUSTODIAL_ACCOUNT_REQUEST, CREATE_CUSTODIAL_ACCOUNT_FAILURE ', () => {
        const profile = {fullName: 'Jane Doe'};
        const expectedActions = [
          {
            type: actionTypes.CREATE_CUSTODIAL_ACCOUNT_REQUEST,
            meta: {source: actionSources[actionTypes.CREATE_CUSTODIAL_ACCOUNT_REQUEST]}
          },
          {
            type: actionTypes.CREATE_CUSTODIAL_ACCOUNT_FAILURE,
            payload: new Error(getCreateCustodialAccountErrorMessage()),
            error: true,
            meta: {source: actionSources[actionTypes.CREATE_CUSTODIAL_ACCOUNT_FAILURE]}
          }
        ];
        __Rewire__('services', {
          api: {
            user: {
              createCustodialAccount: (profile, cb) => cb('error')
            }
          },
          log: _.noop
        });
        const store = mockStore({});
        store.dispatch(asyncActions.createCustodialAccount(profile));
        const actions = store.getActions();
        expect(actions[1].payload).to.deep.include({message:getCreateCustodialAccountErrorMessage()});
        expectedActions[1].payload = actions[1].payload;
        expect(actions).to.deep.equal(expectedActions);
      });
    });
  });

  describe('setUploadTargetUserAndMaybeRedirect', () => {
    const userId = 'abc123', url = 'http://acme-blip.com/patients/abc123/data';
    const apiRewire = {
      api: {
        makeBlipUrl: (path) => { return 'http://acme-blip.com' + path; }
      }
    };
    describe('new target user has selected devices and timezone', () => {
      it('should dispatch just SET_UPLOAD_TARGET_USER and SET_BLIP_VIEW_DATA_URL', () => {
        const expectedActions = [
          {
            type: actionTypes.SET_UPLOAD_TARGET_USER,
            payload: { userId },
            meta: {source: actionSources[actionTypes.SET_UPLOAD_TARGET_USER]}
          },
          {
            type: actionTypes.SET_BLIP_VIEW_DATA_URL,
            payload: { url },
            meta: {source: actionSources[actionTypes.SET_BLIP_VIEW_DATA_URL]}
          }
        ];
        __Rewire__('services', apiRewire);
        const store = mockStore({
          devices: {
            a_pump: {}
          },
          targetDevices: {
            abc123: ['a_pump']
          },
          users: {
            abc123: {
              targets: {
                devices: ['a_pump'],
                timezone: 'Europe/London'
              }
            }
          }
        });
        store.dispatch(asyncActions.setUploadTargetUserAndMaybeRedirect(userId));
        const actions = store.getActions();
        expect(actions).to.deep.equal(expectedActions);
      });
    });

    describe('new target user has not selected devices', () => {
      it('should dispatch SET_UPLOAD_TARGET_USER, SET_BLIP_VIEW_DATA_URL, and SET_PAGE (redirect to settings)', () => {
        const expectedActions = [
          {
            type: actionTypes.SET_UPLOAD_TARGET_USER,
            payload: { userId },
            meta: {source: actionSources[actionTypes.SET_UPLOAD_TARGET_USER]}
          },
          {
            type: actionTypes.SET_BLIP_VIEW_DATA_URL,
            payload: { url },
            meta: {source: actionSources[actionTypes.SET_BLIP_VIEW_DATA_URL]}
          },
          {
            type: '@@router/CALL_HISTORY_METHOD',
            payload: {
              args: [ {
                pathname: '/settings',
                state: {
                  meta: {source: actionSources[actionTypes.SET_PAGE]}
                }
              } ],
              method: 'push'
            }
          }
        ];
        __Rewire__('services', apiRewire);
        const store = mockStore({
          devices: {
            medtronic: {},
            dexcom: {},
            omnipod: {}
          },
          users: {
            abc123: {
              targets: {
                timezone: 'Europe/London'
              }
            }
          }
        });
        store.dispatch(asyncActions.setUploadTargetUserAndMaybeRedirect(userId));
        const actions = store.getActions();
        expect(actions).to.deep.equal(expectedActions);
      });
    });

    describe('new target user has not selected timezone', () => {
      it('should dispatch SET_UPLOAD_TARGET_USER, SET_BLIP_VIEW_DATA_URL', () => {
        const expectedActions = [
          {
            type: actionTypes.SET_UPLOAD_TARGET_USER,
            payload: { userId },
            meta: {source: actionSources[actionTypes.SET_UPLOAD_TARGET_USER]}
          },
          {
            type: actionTypes.SET_BLIP_VIEW_DATA_URL,
            payload: { url },
            meta: {source: actionSources[actionTypes.SET_BLIP_VIEW_DATA_URL]}
          }
        ];
        __Rewire__('services', apiRewire);
        const store = mockStore({
          devices: {
            medtronic: {},
            dexcom: {},
            omnipod: {}
          },
          targetDevices: {
            abc123: ['medtronic']
          },
          users: {
            abc123: {
              targets: {
                devices: ['medtronic']
              }
            }
          }
        });
        store.dispatch(asyncActions.setUploadTargetUserAndMaybeRedirect(userId));
        const actions = store.getActions();
        expect(actions).to.deep.equal(expectedActions);
      });
    });
  });

  describe('checkUploadTargetUserAndMaybeRedirect', () => {
    const userId = 'abc123';
    describe('target user has selected devices', () => {
      it('should dispatch SET_PAGE (main)', () => {
        const expectedActions = [
          {
            type: '@@router/CALL_HISTORY_METHOD',
            payload: {
              args: [ {
                pathname: '/main',
                state: {
                  meta: {
                    source: actionSources[actionTypes.SET_PAGE],
                    metric: {eventName: metrics.CLINIC_NEXT}
                  }
                }
              } ],
              method: 'push'
            }
          }
        ];
        const store = mockStore({
          loggedInUser: 'def456',
          allUsers: {
            ghi789: {},
            abc123: {},
            def456: {roles: ['clinic']},
          },
          targetDevices: {
            abc123: ['a_pump']
          },
          devices: {
            a_pump: true
          },
          users: {
            def456: {},
            abc123: {
              targets: {
                devices: ['a_pump'],
                timezone: 'Europe/London'
              }
            }
          },
          uploadTargetUser: 'abc123'
        });
        store.dispatch(asyncActions.checkUploadTargetUserAndMaybeRedirect());
        const actions = store.getActions();
        expect(actions).to.deep.equal(expectedActions);
      });
    });
    describe('target user has not selected devices', () => {
      it('should dispatch SET_PAGE (settings)', () => {
        const expectedActions = [
          {
            type: '@@router/CALL_HISTORY_METHOD',
            payload: {
              args: [ {
                pathname: '/settings',
                state: {
                  meta: {
                    source: actionSources[actionTypes.SET_PAGE],
                    metric: {eventName: metrics.CLINIC_NEXT}
                  }
                }
              } ],
              method: 'push'
            }
          }
        ];
        const store = mockStore({
          loggedInUser: 'def456',
          allUsers: {
            ghi789: {},
            abc123: {},
            def456: {roles: ['clinic']},
          },
          targetDevices: {
            abc123: []
          },
          devices: {
            a_pump: true
          },
          users: {
            def456: {},
            abc123: {
              targets: {
                devices: ['a_pump'],
                timezone: 'Europe/London'
              }
            }
          },
          uploadTargetUser: 'abc123'
        });
        store.dispatch(asyncActions.checkUploadTargetUserAndMaybeRedirect());
        const actions = store.getActions();
        expect(actions).to.deep.equal(expectedActions);
      });
    });
    describe('no target user selected', () => {
      it('should dispatch no actions', () => {
        const expectedActions = [];
        const store = mockStore({
          loggedInUser: 'def456',
          allUsers: {
            ghi789: {},
            abc123: {},
            def456: {roles: ['clinic']},
          },
          targetDevices: {
            abc123: []
          },
          devices: {
            a_pump: true
          },
          users: {
            def456: {},
            abc123: {
              targets: {
                devices: ['a_pump'],
                timezone: 'Europe/London'
              }
            }
          }
        });
        store.dispatch(asyncActions.checkUploadTargetUserAndMaybeRedirect());
        const actions = store.getActions();
        expect(actions).to.deep.equal(expectedActions);
      });
    });
  });

  describe('clickAddNewUser', () => {
    describe('link clicked', () => {
      it('should dispatch SET_UPLOAD_TARGET_USER and SET_PAGE (CLINIC_USER_EDIT)', () => {
        const expectedActions = [
          {
            type: actionTypes.SET_UPLOAD_TARGET_USER,
            payload: { userId: null },
            meta: {source: actionSources[actionTypes.SET_UPLOAD_TARGET_USER]}
          },
          {
            type: '@@router/CALL_HISTORY_METHOD',
            payload: {
              args: [  {
                'pathname': '/clinic_user_edit',
                'state': {
                  'meta': {
                    'metric': {
                      'eventName': metrics.CLINIC_ADD
                    },
                    'source': actionSources[actionTypes.SET_PAGE]
                  }
                }
              } ],
              method: 'push'
            }
          }
        ];
        const store = mockStore({});
        store.dispatch(asyncActions.clickAddNewUser());
        const actions = store.getActions();
        expect(actions).to.deep.equal(expectedActions);
      });
    });
  });

  describe('setPage', () => {
    const PAGE = pages.MAIN;

    it('should create an action to set the page', () => {
      const expectedActions = [{
        type: '@@router/CALL_HISTORY_METHOD',
        payload: {
          args: [ {
            pathname: '/main',
            state: {
              meta: {source: actionSources[actionTypes.SET_PAGE]}
            }
          } ],
          method: 'push'
        }
      }];
      const store = mockStore({});
      store.dispatch(asyncActions.setPage(PAGE));
      const actions = store.getActions();
      expect(actions).to.deep.equal(expectedActions);
    });

    it('should accept a second parameter to override the default action source', () => {
      const expectedActions = [{
        type: '@@router/CALL_HISTORY_METHOD',
        payload: {
          args: [ {
            pathname: '/main',
            state: {
              meta: {source: actionSources.USER}
            }
          } ],
          method: 'push'
        }
      }];
      const store = mockStore({});
      store.dispatch(asyncActions.setPage(PAGE, actionSources.USER));
      const actions = store.getActions();
      expect(actions).to.deep.equal(expectedActions);
    });
  });
});
