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

import React, { Component } from 'react';
import PropTypes from 'prop-types';

import styles from '../../styles/components/VersionCheck.module.less';

const remote = require('@electron/remote');
const i18n = remote.getGlobal( 'i18n' );

export default class UpdatePlease extends Component {
  static propTypes = {
    knowledgeBaseLink: PropTypes.string.isRequired,
    updateText: PropTypes.object.isRequired
  };

  static defaultProps = {
    updateText: {
      NEEDS_UPDATED: i18n.t('This uploader needs to be updated'),
      IMPROVEMENTS: i18n.t('because we made some improvements!')
    }
  };

  render() {
    const { knowledgeBaseLink, updateText } = this.props;
    return (
      <div className={styles.modalWrap}>
        <div className={styles.modal}>
          <div className={styles.text}>
            <p className={styles.lineOne}>{updateText.NEEDS_UPDATED}</p>
            <p className={styles.lineTwo}>{updateText.IMPROVEMENTS}</p>
            <p className={styles.mostImportant}>
             {i18n.t('Follow')} <a className={styles.link} href={knowledgeBaseLink} target="_blank">{i18n.t('these instructions')}</a> {i18n.t('to do so.')}}
            </p>
          </div>
        </div>
      </div>
    );
  }
}
