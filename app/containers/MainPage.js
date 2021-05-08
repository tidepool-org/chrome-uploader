/*
 * == BSD2 LICENSE ==
 * Copyright (c) 2014-2016, Tidepool Project
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
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { pages } from '../constants/otherConstants';
import * as actionSources from '../constants/actionSources';
import * as metrics from '../constants/metrics';
import actions from '../actions/';
import ClinicUploadDone from '../components/ClinicUploadDone';
import ClinicUserBlock from '../components/ClinicUserBlock';
import cx from 'classnames';
import React, { Component } from 'react';
import styles from '../../styles/components/App.module.less';
import TimezoneDropdown from '../components/TimezoneDropdown';
import UploadList from '../components/UploadList';
import ViewDataLink from '../components/ViewDataLink';
import UserDropdown from '../components/UserDropdown';
const remote = require('@electron/remote');

const asyncActions = actions.async;
const syncActions = actions.sync;

const i18n = remote.getGlobal('i18n');

export class MainPage extends Component {
  handleClickEditUser = () => {
    const { setPage } = this.props.async;
    setPage(pages.CLINIC_USER_EDIT, undefined, {metric: {eventName: metrics.CLINIC_EDIT_INFO}});
  };

  handleClickChangePerson = (metric = {metric: {eventName: metrics.CLINIC_SEARCH_DISPLAYED}}) => {
    const { setUploadTargetUser } = this.props.sync;
    const { setPage } = this.props.async;
    setUploadTargetUser(null);
    setPage(pages.CLINIC_USER_SELECT, undefined, metric);
  };

  handleClickChooseDevices = metric => {
    const { toggleDropdown } = this.props.sync;
    const { setPage } = this.props.async;
    // ensure dropdown closes after click
    setPage(pages.SETTINGS, true, metric);
    toggleDropdown(true, actionSources.UNDER_THE_HOOD);
  };

  renderTimezoneDropdown() {
    const { uploadTargetUser } = this.props;
    return (
      <TimezoneDropdown
        dismissUpdateProfileError={this.props.sync.dismissUpdateProfileError}
        isClinicAccount={this.props.isClinicAccount}
        isUploadInProgress={this.props.uploadIsInProgress}
        onTimezoneChange={this.props.async.setTargetTimezone}
        selectorLabel={i18n.t('Time zone')}
        targetId={uploadTargetUser || null}
        targetTimezone={this.props.selectedTimezone}
        updateProfileErrorDismissed={this.props.updateProfileErrorDismissed}
        updateProfileErrorMessage={this.props.updateProfileErrorMessage}
        userDropdownShowing={this.props.showingUserSelectionDropdown}
        onBlur={this.props.sync.timezoneBlur}
        isTimezoneFocused={this.props.isTimezoneFocused} />
    );
  }

  renderUploadListDoneButton() {
    const { isClinicAccount } = this.props;
    if (isClinicAccount && this.props.uploadTargetUser) {
      return <ClinicUploadDone
        onClicked= {this.handleClickChangePerson}
        uploadTargetUser={this.props.uploadTargetUser}
        uploadsByUser={this.props.uploadsByUser} />;
    } else {
      const viewDataLink = _.get(this.props, ['blipUrls', 'viewDataLink'], '');
      return <ViewDataLink
        href={viewDataLink}
        onViewClicked={this.props.sync.clickGoToBlip} />;
    }
  }

  renderUserDropdown() {
    const { allUsers, targetUsersForUpload, uploadTargetUser, location } = this.props;
    return (
      <UserDropdown
        allUsers={allUsers}
        isUploadInProgress={this.props.uploadIsInProgress}
        onGroupChange={this.props.async.setUploadTargetUserAndMaybeRedirect}
        locationPath={location.pathname}
        targetId={uploadTargetUser}
        targetUsersForUpload={targetUsersForUpload} />
    );
  }

  renderChangePersonLink() {
    var classes = cx({
      [styles.changePerson]: true,
      [styles.linkDisabled]: this.props.uploadIsInProgress
    });
    return (
      <div className={classes}
        onClick={this.props.uploadIsInProgress ?
          this.noopHandler :
          _.partial(this.handleClickChangePerson, {
            metric: {
              eventName: metrics.CLINIC_CHANGE_PERSON
            }
          })}>{i18n.t('Change Person')}</div>
    );
  }

  renderClinicUserBlock() {
    const { isClinicAccount } = this.props;
    if (!isClinicAccount) return null;
    let timezoneDropdown = this.renderTimezoneDropdown();
    return (
      <ClinicUserBlock
        allUsers={this.props.allUsers}
        isUploadInProgress={this.props.uploadIsInProgress}
        memberships={this.props.memberships}
        onEditUser={this.handleClickEditUser}
        targetId={this.props.uploadTargetUser}
        timezoneDropdown={timezoneDropdown} />
    );
  }

  render() {
    let changePersonLink = null;
    let clinicUserBlock = null;

    if(this.props.isClinicAccount){
      changePersonLink = this.renderChangePersonLink();
      clinicUserBlock = this.renderClinicUserBlock();
    }

    let userDropdown = this.props.showingUserSelectionDropdown ?
      this.renderUserDropdown() : null;

    let timezoneDropdown = null;
    let viewDataLinkButton = this.renderUploadListDoneButton();
    if(!this.props.isClinicAccount){
      timezoneDropdown = this.renderTimezoneDropdown();
    }
    return (
      <div className={styles.mainWrap}>
        {userDropdown}
        {timezoneDropdown}
        {changePersonLink}
        {clinicUserBlock}
        <UploadList
          rememberMedtronicSerialNumber={this.props.sync.rememberMedtronicSerialNumber}
          disabled={Boolean(this.props.unsupported) || !Boolean(this.props.selectedTimezone)}
          isClinicAccount={this.props.isClinicAccount}
          isUploadInProgress={this.props.uploadIsInProgress}
          onChooseDevices={_.partial(this.handleClickChooseDevices, {metric: {eventName: metrics.CLINIC_CHANGE_DEVICES}})}
          onReset={this.props.sync.resetUpload}
          onUpload={this.props.async.doUpload}
          readFile={this.props.async.readFile}
          targetId={this.props.uploadTargetUser}
          addDevice={this.props.sync.addTargetDevice}
          removeDevice={this.props.sync.removeTargetDevice}
          onDone={this.props.async.clickDeviceSelectionDone}
          timezoneIsSelected={Boolean(this.props.selectedTimezone)}
          toggleErrorDetails={this.props.sync.toggleErrorDetails}
          updateProfileErrorMessage={this.props.updateProfileErrorMessage}
          uploads={this.props.activeUploads}
          userDropdownShowing={this.props.showingUserSelectionDropdown} />
        {viewDataLinkButton}
      </div>
    );
  }
}

export default connect(
  (state) => {
    function getSelectedTimezone(state) {
      return _.get(
        state,
        ['targetTimezones', state.uploadTargetUser],
        // fall back to the timezone stored under 'noUserSelected', if any
        _.get(state, ['targetTimezones', 'noUserSelected'], null)
      );
    }
    function getActiveUploads(state) {
      const { devices, uploadsByUser, uploadTargetUser } = state;
      if (uploadTargetUser === null) {
        return [];
      }
      let activeUploads = [];
      const targetUsersUploads = _.get(uploadsByUser, uploadTargetUser, []);
      _.map(_.keys(targetUsersUploads), (deviceKey) => {
        const upload = uploadsByUser[uploadTargetUser][deviceKey];
        const device = _.pick(devices[deviceKey], ['instructions', 'image', 'key', 'name', 'source']);
        const progress = upload.uploading ? {progress: state.uploadProgress} :
          (upload.successful ? {progress: {percentage: 100}} : {});
        activeUploads.push(_.assign({}, device, upload, progress));
      });
      // ensure that carelink is last
      const carelink = _.remove(activeUploads, {'key': 'carelink'});
      if(!_.isEmpty(carelink)){
        activeUploads = activeUploads.concat(carelink);
      }
      return activeUploads;
    }
    function shouldShowUserSelectionDropdown(state) {
      if (!_.isEmpty(state.targetUsersForUpload) && !isClinicAccount(state)) {
        // if there's only one potential target for upload but it's *not* the loggedInUser
        if (state.targetUsersForUpload.length === 1 &&
          !_.includes(state.targetUsersForUpload, state.loggedInUser)) {
          return true;
        }
        if (state.targetUsersForUpload.length > 1) {
          return true;
        }
      }
      return false;
    }
    function isClinicAccount(state) {
      return _.indexOf(_.get(_.get(state.allUsers, state.loggedInUser, {}), 'roles', []), 'clinic') !== -1;
    }
    return {
      activeUploads: getActiveUploads(state),
      allUsers: state.allUsers,
      memberships: state.memberships,
      blipUrls: state.blipUrls,
      isClinicAccount: isClinicAccount(state),
      isTimezoneFocused: state.isTimezoneFocused,
      page: state.page,
      selectedTimezone: getSelectedTimezone(state),
      showingUserSelectionDropdown: shouldShowUserSelectionDropdown(state),
      targetUsersForUpload: state.targetUsersForUpload,
      unsupported: state.unsupported,
      updateProfileErrorMessage: state.updateProfileErrorMessage,
      uploadIsInProgress: state.working.uploading,
      uploadTargetUser: state.uploadTargetUser,
      uploadsByUser: state.uploadsByUser,
    };
  },
  (dispatch) => {
    return {
      async: bindActionCreators(asyncActions, dispatch),
      sync: bindActionCreators(syncActions, dispatch)
    };
  }
)(MainPage);
