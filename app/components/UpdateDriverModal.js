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
import sudo from 'sudo-prompt';

import { sync as syncActions } from '../actions/';

import styles from '../../styles/components/UpdateDriverModal.module.less';

const remote = require('@electron/remote');
const i18n = remote.getGlobal( 'i18n' );

export class UpdateDriverModal extends Component {
  handleInstall = () => {
    const { sync, driverUpdateShellOpts } = this.props;
    const { execString, options } = driverUpdateShellOpts.opts;
    sudo.exec(execString, options,
      (error, stdout, stderr) => {
        console.log('sudo result: ' + stdout);
        if (error) {
          console.log(error);
        }
        sync.driverInstall();
      }
    );
  };

  render() {
    const {
      checkingDriverUpdate,
      driverUpdateAvailable,
      driverUpdateAvailableDismissed,
      driverUpdateComplete,
      sync
    } = this.props;

    let title, text, actions;

    if(driverUpdateAvailableDismissed || driverUpdateComplete || !driverUpdateAvailable){
      return null;
    }

    if (checkingDriverUpdate){
      title = i18n.t('Checking for driver update...');
    } else {
      if (driverUpdateAvailable) {
        title = i18n.t('Driver Update Available!');
        text = i18n.t('After clicking Install, the uploader will ask for your password to complete the installation. This window will close when completed.');
        actions = [
          <button key='dismiss' className={styles.buttonSecondary} onClick={sync.dismissDriverUpdateAvailable}>
            {i18n.t('Dismiss')}
          </button>,
          <button key='install' className={styles.button} onClick={this.handleInstall}>
            {i18n.t('Install')}
          </button>
        ];
      }
    }

    return (
      <div className={styles.modalWrap}>
        <div className={styles.modal}>
          <div className={styles.title}>
            {title}
          </div>
          <div className={styles.text}>
            {text}
          </div>
          <div className={styles.actions}>
            {actions}
          </div>
        </div>
      </div>
    );
  }
};

export default connect(
  (state, ownProps) => {
    return {
      // plain state
      checkingDriverUpdate: state.working.checkingDriverUpdate,
      driverUpdateAvailableDismissed: state.driverUpdateAvailableDismissed,
      driverUpdateAvailable: state.driverUpdateAvailable,
      driverUpdateShellOpts: state.driverUpdateShellOpts,
      driverUpdateComplete: state.driverUpdateComplete
    };
  },
  (dispatch) => {
    return {
      sync: bindActionCreators(syncActions, dispatch)
    };
  }
)(UpdateDriverModal);
