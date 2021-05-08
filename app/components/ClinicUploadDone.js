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

var React = require('react');
var _ = require('lodash');
var PropTypes = require('prop-types');

var styles = require('../../styles/components/ClinicUploadDone.module.less');

const remote = require('@electron/remote');
const i18n = remote.getGlobal( 'i18n' );

class ClinicUploadDone extends React.Component {
  static propTypes = {
    onClicked: PropTypes.func.isRequired,
    uploadTargetUser: PropTypes.string.isRequired,
    uploadsByUser: PropTypes.object.isRequired
  };

  handleClick = () => {
    this.props.onClicked();
  };

  hasCompletedUpload = () => {
    return _.find(_.get(this.props.uploadsByUser, this.props.uploadTargetUser, {}), {completed: true});
  };

  render() {
    return (
      <div className={styles.buttonWrap}>
        <a className={styles.button}
          onClick={this.handleClick}
          disabled={!this.hasCompletedUpload()} >
          {i18n.t('Done')}
        </a>
      </div>
    );
  }
}

module.exports = ClinicUploadDone;
