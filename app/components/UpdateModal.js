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
import { ipcRenderer } from 'electron';

import { sync as syncActions } from '../actions/';
import config from '../../lib/config.js';

import styles from '../../styles/components/UpdateModal.module.less';

const remote = require('@electron/remote');
const i18n = remote.getGlobal( 'i18n' );

export class UpdateModal extends Component {
  handleInstall = () => {
    const { sync } = this.props;
    sync.quitAndInstall();
    ipcRenderer.send('autoUpdater', 'quitAndInstall');
  };

  render() {
    const {
      checkingElectronUpdate,
      electronUpdateDownloaded,
      electronUpdateAvailable,
      electronUpdateManualChecked,
      electronUpdateAvailableDismissed,
      sync
    } = this.props;

    let title, text, actions;

    if(electronUpdateAvailableDismissed){
      return null;
    }

    if (electronUpdateManualChecked) {
      if (checkingElectronUpdate){
        title = i18n.t('Checking for update...');
      } else {
        if (electronUpdateAvailable) {
          title = i18n.t('Update Available!');
          if (!electronUpdateDownloaded) {
            text = i18n.t('Downloading update');
          } else { // available and downloaded
            text = i18n.t('After clicking Install, the uploader will restart to complete the installation.');
            actions = [
              <button key='dismiss' className={styles.buttonSecondary} onClick={sync.dismissUpdateAvailable}>
                {i18n.t('Dismiss')}
              </button>,
              <button key='install' className={styles.button} onClick={this.handleInstall}>
                {i18n.t('Install')}
              </button>
            ];
          }
        } else { // no update available
          title = i18n.t('Uploader is up-to-date!');
          text = i18n.t('You are running version {{text}}, the most recent one.', { text: config.version });
          actions = (
            <button className={styles.button} onClick={sync.dismissUpdateNotAvailable}>
              {i18n.t('Okay!')}
            </button>
          );
        }
      }
    }
    else { // automatic background check
      if(electronUpdateAvailable && electronUpdateDownloaded){
        title = i18n.t('Update Available!');
        text = i18n.t('After clicking Install, the uploader will restart to complete the installation.');
        actions = [
          <button key='dismiss' className={styles.buttonSecondary} onClick={sync.dismissUpdateAvailable}>
            {i18n.t('Dismiss')}
          </button>,
          <button key='install' className={styles.button} onClick={this.handleInstall}>
            {i18n.t('Install')}
          </button>
        ];
      } else {
        return null;
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
      checkingElectronUpdate: state.working.checkingElectronUpdate,
      electronUpdateAvailableDismissed: state.electronUpdateAvailableDismissed,
      electronUpdateAvailable: state.electronUpdateAvailable,
      electronUpdateDownloaded: state.electronUpdateDownloaded,
      electronUpdateManualChecked: state.electronUpdateManualChecked
    };
  },
  (dispatch) => {
    return {
      sync: bindActionCreators(syncActions, dispatch)
    };
  }
)(UpdateModal);
