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

import { sync as syncActions } from '../actions/';

import styles from '../../styles/components/AdHocModal.module.less';
import step1_img from '../../images/adhoc_s1.png';
import step2_img from '../../images/adhoc_s2.png';

const remote = require('@electron/remote');
const i18n = remote.getGlobal( 'i18n' );

export class AdHocModal extends Component {
  handleContinue = () => {
    const { showingAdHocPairingDialog, sync } = this.props;
    showingAdHocPairingDialog.callback('adHocModalClose');
    sync.dismissedAdHocPairingDialog();
  }

  render() {
    const { showingAdHocPairingDialog } = this.props;

    if(!showingAdHocPairingDialog){
      return null;
    }

    return (
      <div className={styles.modalWrap}>
        <div className={styles.modal}>
          <div className={styles.title}>
            <div>{i18n.t('Allow the connection on the pump:')}</div>
          </div>
          <hr className={styles.hr} />
          <div className={styles.text}>
            <div className={styles.body}>
              <div className={styles.step}>
                <div><span className={styles.numeral}>1.</span> {i18n.t('Scroll down')}</div>
                <div><img className={styles.image} src={step1_img} /></div>
              </div>
              <div className={styles.step}>
                <div><span className={styles.numeral}>2.</span> {i18n.t('Select \"Yes\"')}</div>
                <div><img className={styles.image} src={step2_img} /></div>
              </div>
            </div>
          </div>
          <hr className={styles.hr} />
          <div className={styles.actions}>
            <button className={styles.buttonSecondary} onClick={this.handleContinue}>
              {i18n.t('Continue')}
            </button>
          </div>
        </div>
      </div>
    );
  }
};

export default connect(
  (state, ownProps) => {
    return {
      showingAdHocPairingDialog: state.showingAdHocPairingDialog
    };
  },
  (dispatch) => {
    return {
      sync: bindActionCreators(syncActions, dispatch)
    };
  }
)(AdHocModal);
