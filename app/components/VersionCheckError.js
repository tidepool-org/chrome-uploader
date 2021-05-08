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

import cx from 'classnames';
import PropTypes from 'prop-types';
import React, { Component } from 'react';

import errorText from '../constants/errors';

import styles from '../../styles/components/VersionCheck.module.less';
import CloudOff from '@material-ui/icons/CloudOff';

const remote = require('@electron/remote');
const i18n = remote.getGlobal( 'i18n' );

export default class VersionCheckError extends Component {
  static propTypes = {
    errorMessage: PropTypes.string.isRequired,
    errorText: PropTypes.object.isRequired
  };

  static defaultProps = {
    errorText: {
      CONNECT: i18n.t('Please check your connection, quit & relaunch to try again.'),
      ERROR_DETAILS: i18n.t('Details for Tidepool\'s developers:'),
      OFFLINE: i18n.t('You\'re not connected to the Internet.'),
      SERVERS_DOWN: i18n.t('We can\'t connect to Tidepool right now.'),
      TRY_AGAIN: i18n.t('Quit & relaunch the Uploader to try again.')
    }
  };

  constructor(props) {
    super(props);
  }

  render() {
    const { errorMessage } = this.props; 
    const userErrorText = this.props.errorText;
    const offline = errorMessage === errorText.E_OFFLINE;
    const errorDetails = offline ? null : (
      <div className={styles.error}>
        <p className={styles.errorText}>{userErrorText.ERROR_DETAILS}</p>
        <p className={styles.errorText}>{errorMessage}</p>
      </div>
    );
    const firstLine = offline
      ? userErrorText.OFFLINE
      : userErrorText.SERVERS_DOWN;
    const secondLine = offline
      ? userErrorText.CONNECT
      : userErrorText.TRY_AGAIN;
    const versionCheckClass = cx({
      [styles.failed]: !offline,
      [styles.offline]: offline
    });

    return (
      <div className={styles.modalWrap}>
        <div className={styles.modal}>
          <div className={versionCheckClass}>
            <div className={styles.text}>
              <CloudOff classes={{root: styles.icon}}/>
              <p className={styles.lineOne}>{firstLine}</p>
              <p className={styles.lineTwo}>{secondLine}</p>
            </div>
            {errorDetails}
          </div>
        </div>
      </div>
    );
  }
}
