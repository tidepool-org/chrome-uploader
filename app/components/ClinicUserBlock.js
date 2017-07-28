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

var _ = require('lodash');
var React = require('react');
var sundial = require('sundial');
var personUtils = require('../../lib/core/personUtils');
var cx = require('classnames');

var styles = require('../../styles/components/ClinicUserBlock.module.less');

var ClinicUserBlock = React.createClass({
  propTypes: {
    allUsers: React.PropTypes.object.isRequired,
    targetId: React.PropTypes.string,
    timezoneDropdown: React.PropTypes.element,
    onEditUser: React.PropTypes.func.isRequired,
    isUploadInProgress: React.PropTypes.bool.isRequired
  },

  formatBirthday: function(birthday) {
    return sundial.translateMask(birthday, 'YYYY-MM-DD', 'M/D/YYYY');
  },

  noopHandler: function(e){
    e.preventDefault();
  },

  render: function() {
    var editClasses = cx({
      [styles.edit]: true,
      [styles.disabled]: this.props.isUploadInProgress
    });
    return (
      <div className={styles.main}>
        <div className={styles.nameWrap}>
          <div className={styles.name}>
            {personUtils.patientFullName(_.get(this.props.allUsers, this.props.targetId))}
          </div>
          <div className={styles.birthday}>
            {this.formatBirthday(_.get(this.props.allUsers, [this.props.targetId, 'patient', 'birthday']))}
          </div>
          <div className={editClasses} onClick={this.props.isUploadInProgress ? this.noopHandler : this.props.onEditUser}>
            Edit Info
          </div>
        </div>
        {this.props.timezoneDropdown}
      </div>
    );
  }
});

module.exports = ClinicUserBlock;
