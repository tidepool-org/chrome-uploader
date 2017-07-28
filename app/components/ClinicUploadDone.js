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

var styles = require('../../styles/components/ClinicUploadDone.module.less');

var ClinicUploadDone = React.createClass({
  propTypes: {
    onClicked: React.PropTypes.func.isRequired,
    uploadTargetUser: React.PropTypes.string.isRequired,
    uploadsByUser: React.PropTypes.object.isRequired
  },

  handleClick: function(){
    this.props.onClicked();
  },

  hasCompletedUpload: function(){
    return _.find(_.get(this.props.uploadsByUser, this.props.uploadTargetUser, {}), {completed: true});
  },

  render: function() {
    return (
      <div className={styles.buttonWrap}>
        <a className={styles.button}
          onClick={this.handleClick}
          disabled={!this.hasCompletedUpload()} >
          Done
        </a>
      </div>
    );
  }
});

module.exports = ClinicUploadDone;
