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

import _ from 'lodash';
import PropTypes from 'prop-types';
import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import actions from '../actions/';

const asyncActions = actions.async;
const syncActions = actions.sync;

import LoggedInAs from '../components/LoggedInAs';

import * as actionSources from '../constants/actionSources';
import { pages, pagesMap } from '../constants/otherConstants';

import styles from '../../styles/components/Header.module.less';
import logo from '../../images/Tidepool_Logo_Light x2.png';

const remote = require('@electron/remote');
const i18n = remote.getGlobal( 'i18n' );

export class Header extends Component {
  static propTypes = {
    location: PropTypes.object.isRequired,
    blipUrls: PropTypes.object.isRequired,
    dropdown: PropTypes.bool.isRequired,
    uploadIsInProgress: PropTypes.bool.isRequired,
    user: PropTypes.object,
    isClinicAccount: PropTypes.bool,
    targetUsersForUpload: PropTypes.array
  };

  handleClickChooseDevices = metric => {
    const { toggleDropdown } = this.props.sync;
    const { setPage } = this.props.async;
    // ensure dropdown closes after click
    setPage(pages.SETTINGS, true, metric);
    toggleDropdown(true, actionSources.UNDER_THE_HOOD);
  };

  handleCheckForUpdates = () => {
    const { toggleDropdown } = this.props.sync;
    toggleDropdown(true, actionSources.UNDER_THE_HOOD);
  };

  render() {
    const { allUsers, dropdown, location } = this.props;
    if (location.pathname === pagesMap.LOADING) {
      return null;
    }

    if (location.pathname === pagesMap.LOGIN) {
      return (
        <div className={styles.header}>
          <div className={styles.signup}>
            <a className={styles.signupLink} href={this.props.blipUrls.signUp} target="_blank">
              <i className={styles.signupIcon}> {i18n.t('Sign up')}</i></a>
          </div>
          <div className={styles.logoWrapper}>
            <img className={styles.logo} src={logo} />
          </div>
          <div className={styles.heroText}>
            {i18n.t('Uploader')}
          </div>
        </div>
      );
    }

    return (
      <div className={styles.header}>
        <div className={styles.headerRow}>
          <div className={styles.smallLogoWrapper}>
            <img className={styles.smallLogo} src={logo} />
          </div>
          <LoggedInAs
            dropMenu={dropdown}
            isUploadInProgress={this.props.uploadIsInProgress}
            onCheckForUpdates={this.handleCheckForUpdates}
            onChooseDevices={this.handleClickChooseDevices}
            onClicked={this.props.sync.toggleDropdown.bind(this, this.props.dropdown)}
            onLogout={this.props.async.doLogout}
            user={allUsers[this.props.loggedInUser]}
            isClinicAccount={this.props.isClinicAccount}
            targetUsersForUpload={this.props.targetUsersForUpload} />
        </div>
      </div>
    );
  }
}

export default connect(
  (state, ownProps) => {
    function isClinicAccount(state) {
      return _.indexOf(_.get(_.get(state.allUsers, state.loggedInUser, {}), 'roles', []), 'clinic') !== -1;
    }
    return {
      // plain state
      allUsers: state.allUsers,
      blipUrls: state.blipUrls,
      dropdown: state.dropdown,
      loggedInUser: state.loggedInUser,
      targetUsersForUpload: state.targetUsersForUpload,
      uploadIsInProgress: state.working.uploading,
      // derived state
      isClinicAccount: isClinicAccount(state)
    };
  },
  (dispatch) => {
    return {
      async: bindActionCreators(asyncActions, dispatch),
      sync: bindActionCreators(syncActions, dispatch)
    };
  }
)(Header);
