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

import PropTypes from 'prop-types';
import React, { Component } from 'react';
import styles from '../../styles/components/Login.module.less';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import actions from '../actions/';
const asyncActions = actions.async;

const remote = require('@electron/remote');
const i18n = remote.getGlobal( 'i18n' );

export class Login extends Component {
  renderForgotPasswordLink() {
    return (
      <a className={styles.forgotLink} href={this.props.forgotPasswordUrl} target="_blank">
        {i18n.t('Forgot password?')}
      </a>
    );
  }

  renderButton() {
    var text = i18n.t('Log in');

    if (this.props.isFetching) {
      text = i18n.t('Logging in...');
    }

    return (
      <button type="submit"
        className={styles.button}
        onClick={this.handleLogin.bind(this)}
        disabled={this.props.isFetching || this.props.disabled}>
        {text}
      </button>
    );
  }

  handleLogin(e) {
    e.preventDefault();
    var username = this.username.value;
    var password = this.password.value;
    var remember = this.remember.checked;

    this.props.onLogin(
      {username: username, password: password},
      {remember: remember}
    );
  }

  renderError() {
    if (!this.props.errorMessage) {
      return null;
    }

    return <span>{i18n.t(this.props.errorMessage)}</span>;
  }

  render() {
    return (
      <div className={styles.loginPage}>
        <form className={styles.form}>
          <div className={styles.inputWrap}>
            <input className={styles.input} ref={(input) => { this.username = input; }} placeholder={i18n.t('Email')}/>
          </div>
          <div className={styles.inputWrap}>
            <input className={styles.input} ref={(input) => { this.password = input; }} placeholder={i18n.t('Password')} type="password"/>
          </div>
          <div className={styles.actions}>
            <div>
              <div className={styles.remember}>
                <input type="checkbox" ref={(input) => { this.remember = input; }} id="remember"/>
                <label htmlFor="remember">{i18n.t('Remember me')}</label>
              </div>
              <div className={styles.forgot}>{this.renderForgotPasswordLink()}</div>
            </div>
            <div>
              {this.renderButton()}
            </div>
          </div>
          <div className={styles.error}>{this.renderError()}</div>
        </form>
      </div>
    );
  }
}

Login.propTypes = {
  disabled: PropTypes.bool.isRequired,
  errorMessage: PropTypes.string,
  forgotPasswordUrl: PropTypes.string.isRequired,
  isFetching: PropTypes.bool.isRequired,
  onLogin: PropTypes.func.isRequired
};

export default connect(
  (state) => {
    return {
      disabled: Boolean(state.unsupported),
      errorMessage: state.loginErrorMessage,
      forgotPasswordUrl: state.blipUrls.forgotPassword,
      isFetching: state.working.fetchingUserInfo,
    };
  },
  (dispatch) => {
    return {
      onLogin: bindActionCreators(asyncActions.doLogin, dispatch)
    };
  }
)(Login);
