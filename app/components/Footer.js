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

import PropTypes from 'prop-types';

import React, { Component } from 'react';
import os from 'os';
import osName from 'os-name';

import styles from '../../styles/components/Footer.module.less';
import logo from '../../images/JDRF_Reverse_Logo x2.png';
import debugMode from '../utils/debugMode';

const remote = require('@electron/remote');
const i18n = remote.getGlobal( 'i18n' );

export default class Footer extends Component {
  static propTypes = {
    version: PropTypes.string.isRequired,
  };

  render() {
    const version = this.props.version;
    let osArch = '';
    let environment = '';

    if (debugMode.isDebug) {
      osArch = `  (${osName()} - ${os.arch()})`;
      environment = `  - ${this.props.environment}`;
    }

    return (
      <div className={styles.footer}>
        <div className={styles.footerRow}>
          <div>
            <a className={styles.footerLink} href="http://support.tidepool.org/" target="_blank">{i18n.t('Get Support')}</a>
          </div>
          <div>
            <a className={styles.footerLink} href="http://tidepool.org/legal/" target="_blank">{i18n.t('Privacy and Terms of Use')}</a>
          </div>
          <div className={styles.jdrfContainer}>
            <span className={styles.jdrfText}>{i18n.t('Made possible by')}</span><img className={styles.jdrfImage} src={logo}/>
          </div>
        </div>
        <div className={styles.footerRow}>
          <div className={styles.version}>{`v${version}${osArch}${environment}`}</div>
        </div>
      </div>
    );
  }
}
