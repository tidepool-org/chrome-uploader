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
import sinon from 'sinon';
import { expect } from 'chai';

import configureStore from 'redux-mock-store';

import errorText from '../../../app/constants/errors';
import * as utils from '../../../app/actions/utils';
import { addInfoToError } from '../../../app/utils/errors';

describe('utils', () => {
  describe('makeUploadCb', () => {
    const dispatch = sinon.spy();
    afterEach(() => {
      dispatch.resetHistory();
    });
    const errCode = 'E_DEVICE_UPLOAD';
    const utc = new Date().toISOString();
    const mockStore = configureStore([])({
      // just providing the minimum initial state to avoid errors on these tests
      devices: {
        foo: {
          source: {
            type: 'device',
            driverId: 'bar'
          }
        }
      },
      uploadTargetDevice: 'foo',
      version: '0.100.0'
    });
    const { getState } = mockStore;
    const fn = utils.makeUploadCb(dispatch, getState, errCode, utc);
    it('should return a function', () => {
      expect(typeof fn).to.equal('function');
    });

    it('the returned function should use the configured errCode on error if error does not have a code', () => {
      const err = new Error('Uh oh...');
      const displayErr = new Error(errorText[errCode]);

      expect(dispatch.callCount).to.equal(0);
      fn(err);
      expect(dispatch.callCount).to.equal(1);
      const expectedAction = {
        type: 'UPLOAD_FAILURE',
        error: true,
        payload: addInfoToError(displayErr, {
          details: err.message,
          utc: utc,
          name: err.name,
          step: null,
          datasetId: null,
          requestTrace: null,
          code: errCode,
          version: '0.100.0'
        }),
        meta: {
          source: 'USER_VISIBLE',
          metric: {
            eventName: 'Upload Failed',
            properties: {
              type: 'device',
              source: 'bar',
              error: displayErr,
            }
          }
        }
      };
      const result = dispatch.firstCall.args[0];
      expect(result.payload).to.deep.include({
        message: errorText[errCode],
        details: err.message,
        utc: utc,
        name: err.name,
        code: errCode,
        version: '0.100.0'
      });
      expectedAction.payload = result.payload;
      expectedAction.meta.metric.properties.error = result.payload;
      expect(result).to.deep.equal(expectedAction);
    });

    it('the returned function should use the argument error\'s code when present', () => {
      const err = new Error('Uh oh...');
      const specificErrCode = 'E_MEDTRONIC_UPLOAD';
      err.code = specificErrCode;
      const displayErr = new Error(errorText[specificErrCode]);

      expect(dispatch.callCount).to.equal(0);
      fn(err);
      expect(dispatch.callCount).to.equal(1);
      const expectedAction = {
        type: 'UPLOAD_FAILURE',
        error: true,
        payload: addInfoToError(displayErr, {
          details: err.message,
          utc: utc,
          name: err.name,
          step: null,
          datasetId: null,
          requestTrace: null,
          code: specificErrCode,
          version: '0.100.0'
        }),
        meta: {
          source: 'USER_VISIBLE',
          metric: {
            eventName: 'Upload Failed',
            properties: {
              type: 'device',
              source: 'bar',
              error: displayErr,
            }
          }
        }
      };
      const result = dispatch.firstCall.args[0];
      expect(result.payload).to.deep.include({
        message: errorText[specificErrCode],
        details: err.message,
        utc: utc,
        name: err.name,
        code: specificErrCode,
        version: '0.100.0'
      });
      expectedAction.payload = result.payload;
      expectedAction.meta.metric.properties.error = result.payload;
      expect(result).to.deep.equal(expectedAction);
    });
  });

  describe('mergeProfileUpdates', () => {
    const profile = {
      emails: ['joe@example.com'],
      emailVerified: true,
      fullName: 'Joe',
      patient: {
        birthday: '1980-02-05',
        diagnosisDate: '1990-02-06',
        targetDevices: ['medtronic', 'omnipod'],
        targetTimezone: 'US/Central'
      },
      termsAccepted: '2016-05-09T14:33:59-04:00',
      username: 'joe@example.com'
    };

    it('should merge profile updates', () => {
      var update = {fullName: 'New Joe'};
      expect(utils.mergeProfileUpdates(_.cloneDeep(profile), update)).to.deep.equal({
        emails: ['joe@example.com'],
        emailVerified: true,
        fullName: 'New Joe',
        patient: {
          birthday: '1980-02-05',
          diagnosisDate: '1990-02-06',
          targetDevices: ['medtronic', 'omnipod'],
          targetTimezone: 'US/Central'
        },
        termsAccepted: '2016-05-09T14:33:59-04:00',
        username: 'joe@example.com'
      });
    });

    it('should merge patient updates', () => {
      var update = {patient: {birthday: '1981-02-05'}};
      expect(utils.mergeProfileUpdates(_.cloneDeep(profile), update)).to.deep.equal({
        emails: ['joe@example.com'],
        emailVerified: true,
        fullName: 'Joe',
        patient: {
          birthday: '1981-02-05',
          diagnosisDate: '1990-02-06',
          targetDevices: ['medtronic', 'omnipod'],
          targetTimezone: 'US/Central'
        },
        termsAccepted: '2016-05-09T14:33:59-04:00',
        username: 'joe@example.com'
      });
    });

    it('should replace emails array on update', () => {
      var update = {emails:['joe2@example.com']};
      expect(utils.mergeProfileUpdates(_.cloneDeep(profile), update)).to.deep.equal({
        emails: ['joe2@example.com'],
        emailVerified: true,
        fullName: 'Joe',
        patient: {
          birthday: '1980-02-05',
          diagnosisDate: '1990-02-06',
          targetDevices: ['medtronic', 'omnipod'],
          targetTimezone: 'US/Central'
        },
        termsAccepted: '2016-05-09T14:33:59-04:00',
        username: 'joe@example.com'
      });
    });

    it('should replace targetDevices array on update', () => {
      var update = {patient: {targetDevices: ['tandem']}};
      expect(utils.mergeProfileUpdates(_.cloneDeep(profile), update)).to.deep.equal({
        emails: ['joe@example.com'],
        emailVerified: true,
        fullName: 'Joe',
        patient: {
          birthday: '1980-02-05',
          diagnosisDate: '1990-02-06',
          targetDevices: ['tandem'],
          targetTimezone: 'US/Central'
        },
        termsAccepted: '2016-05-09T14:33:59-04:00',
        username: 'joe@example.com'
      });
    });
  });
});
