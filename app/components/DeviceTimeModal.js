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
import React, { Component } from 'react';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import sundial from 'sundial';

import { sync as syncActions } from '../actions/';

import styles from '../../styles/components/DeviceTimeModal.module.less';

import { remote } from 'electron';
const i18n = remote.getGlobal( 'i18n' );

export class DeviceTimeModal extends Component {
  determineDeviceType = () => {
    const { showingDeviceTimePrompt } = this.props;
    const { tags } = showingDeviceTimePrompt.cfg.deviceInfo;
    if(_.indexOf(tags, 'insulin-pump') !== -1){
      return { value: 'insulin-pump', text: i18n.t('pump') };
    }
    if(_.indexOf(tags, 'cgm') !== -1){
      return { value: 'cgm', text: i18n.t('CGM') };
    }
    if(_.indexOf(tags, 'bgm') !== -1){
      return { value: 'bgm', text: i18n.t('meter') };
    }
    return 'unknown';
  }

  isDevice = (name) => {
    const { showingDeviceTimePrompt } = this.props;
    const {deviceInfo} = showingDeviceTimePrompt.cfg;
    return deviceInfo && deviceInfo.driverId && deviceInfo.driverId === name;
  }

  handleContinue = () => {
    const { sync, showingDeviceTimePrompt } = this.props;
    showingDeviceTimePrompt.callback('updateTime');
    sync.dismissedDeviceTimePrompt();
  }

  handleCancel = () => {
    const { sync, showingDeviceTimePrompt } = this.props;
    showingDeviceTimePrompt.callback('deviceTimePromptClose');
    sync.dismissedDeviceTimePrompt();
  }

  getActions = () => {
    const { showingDeviceTimePrompt: { cfg: { timezone }, times: { serverTime, deviceTime } } } = this.props;
    const type = this.determineDeviceType();
    const reminder = this.getReminder();
    const buttons = [];
    const footnote = type.value === 'bgm' ? '*' : '';
    if ( !this.isDevice('Animas') &&
         !this.isDevice('InsuletOmniPod') &&
         !this.isDevice('Medtronic') &&     // these two lines should be removed
         !this.isDevice('Medtronic600') &&  // when we can update time on Medtronic pumps
         !this.isDevice('Tandem') &&
         !this.isDevice('TrueMetrix') &&
         !this.isDevice('Weitai')
      ) {
      buttons.push(
        <div className={styles.buttonGroup} key='continue' >
        {i18n.t('Is the time on your {{text}} incorrect?', { text: type.text })}<br/>&nbsp;
        <button className={styles.button} onClick={this.handleContinue}>
          {i18n.t('Automatically update time to')}<br/>
          {sundial.formatInTimezone(serverTime, timezone, 'LT')}{footnote}, {i18n.t('and upload')}
        </button>
        </div>
      );
    }
    buttons.push(
      <div className={styles.buttonGroup} key='cancel'>
      {i18n.t('Are you in {{timezone}}? Double-check',{ timezone: timezone })}<br/>
      {i18n.t('selected time zone and current device time.')}
      {reminder}
      <button className={styles.button} onClick={this.handleCancel}>
        {i18n.t('Cancel this upload')}
      </button>
      </div>
    );

    return buttons;
  }

  getMessage = () => {
    const type = this.determineDeviceType();
    const { showingDeviceTimePrompt: { cfg: { timezone } } } = this.props;
    let message;
    if (type.value === 'bgm') {
        message = (
          <div className={styles.text}>
            <div className={styles.body}>
            {i18n.t('* Changing your device time will not change any previous records.')}<br/>
            {i18n.t('All future readings will be in {{timezone}}.', { timezone: timezone })}
            <a href='https://support.tidepool.org/hc/en-us/articles/360034136632' target='_blank'>{i18n.t('Click to learn more about meters and device time.')}</a>
            </div>
          </div>
        );
    }
    return message;
  }

  getReminder = () => {
    const { showingDeviceTimePrompt: { cfg: { deviceInfo } } } = this.props;
    let reminder;
    if (deviceInfo.model === 'Dash') {
      reminder = (
        <div className={styles.text}>
          <div className={styles.body}>
          {i18n.t('Remember to tap "Export" on the PDM before clicking "Upload".')}
          </div>
        </div>
      );
    }
    return reminder;
  };

  render() {
    const { showingDeviceTimePrompt } = this.props;

    if(!showingDeviceTimePrompt){
      return null;
    }

    const { showingDeviceTimePrompt: { cfg: { timezone }, times: { serverTime, deviceTime } } } = this.props;

    const type = this.determineDeviceType();
    const actions = this.getActions();
    const message = this.getMessage();

    return (
      <div className={styles.modalWrap}>
        <div className={styles.modal}>
          <div className={styles.title}>
            <div>{i18n.t('Your {{text}} doesn\'t appear to be in',{ text: type.text })}</div>
            <div className={styles.highlight}>{`${timezone}:`}</div>
          </div>
          <hr className={styles.hr} />
          <div className={styles.text}>
            <div className={styles.timeCompare}>
              <div>{timezone}:</div>
              <div className={styles.highlight}>{sundial.formatInTimezone(serverTime, timezone, 'LT, LL')}</div>
            </div>
            <div className={styles.timeCompare}>
              <div>{i18n.t('Device time:')}</div>
              <div className={styles.highlight}>{sundial.formatInTimezone(deviceTime, timezone, 'LT, LL')}</div>
            </div>
          </div>
          <hr className={styles.hr} />
          <div className={styles.actions}>
            {actions}
          </div>
          {message}
        </div>
      </div>
    );
  }
};

export default connect(
  (state, ownProps) => {
    return {
      showingDeviceTimePrompt: state.showingDeviceTimePrompt
    };
  },
  (dispatch) => {
    return {
      sync: bindActionCreators(syncActions, dispatch)
    };
  }
)(DeviceTimeModal);
