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
import { expect } from 'chai';

import personUtils from '../../../lib/core/personUtils';

describe('personUtils', () => {
  describe('patientFullName', () => {
    it('(normal account) should return the fullName for the person', () => {
      const person = { fullName: 'Joe Smith' };
      expect(personUtils.patientFullName(person)).to.equal('Joe Smith');
    });

    it('(fake child account) should return the patient profile fullName', () => {
      const person = {
        fullName: 'Jane Smith',
        patient: {
          isOtherPerson: true,
          fullName: 'Child Smith'
        }
      };
      expect(personUtils.patientFullName(person)).to.equal('Child Smith');
    });
  });

  describe('userHasRole', () => {
    it('should return true if role is present on user', () => {
      const user = {
        roles: ['clinic']
      };
      const role = 'clinic';
      expect(personUtils.userHasRole(user, role)).to.be.true;
    });

    it('should return false if user has no roles', () => {
      const user = {
        fullName: 'Joe Smith'
      };
      const role = 'clinic';
      expect(personUtils.userHasRole(user, role)).to.be.false;
    });

    it('should return false if user lacks role', () => {
      const user = {
        roles: ['awesome']
      };
      const role = 'clinic';
      expect(personUtils.userHasRole(user, role)).to.be.false;
    });
  });
});
