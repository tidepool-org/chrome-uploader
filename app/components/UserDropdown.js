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
import Select from 'react-select';

var _ = require('lodash');
var React = require('react');
var PropTypes = require('prop-types');
var personUtils = require('../../lib/core/personUtils');
var pagesMap = require('../constants/otherConstants').pagesMap;

var styles = require('../../styles/components/UserDropdown.module.less');

const remote = require('@electron/remote');
const i18n = remote.getGlobal( 'i18n' );

class UserDropdown extends React.Component {
  static propTypes = {
    allUsers: PropTypes.object.isRequired,
    isUploadInProgress: PropTypes.bool,
    onGroupChange: PropTypes.func.isRequired,
    locationPath: PropTypes.string.isRequired,
    targetId: PropTypes.string,
    targetUsersForUpload: PropTypes.array.isRequired
  };

  groupSelector = () => {
    var allUsers = this.props.allUsers;
    var targets = this.props.targetUsersForUpload;

    // and now return them sorted them by name
    var sorted = _.sortBy(targets, function(targetId) {
      return personUtils.patientFullName(allUsers[targetId]);
    });

    var selectorOpts = _.map(sorted, function(targetId) {
      return {
        value: targetId,
        label: personUtils.patientFullName(allUsers[targetId])
      };
    });

    var disable = this.props.isUploadInProgress ? true : false;

    return (
      <Select
        clearable={false}
        disabled={disable}
        name={'uploadTargetSelect'}
        onChange={this.props.onGroupChange}
        options={selectorOpts}
        matchProp={'label'} //NOTE: we only want to match on the label!
        simpleValue={true}
        value={this.props.targetId}
      />
    );
  };

  render() {
    // we're already doing a check to see if we want to render in App.js
    // but this is an extra measure of protection against trying to render
    // when we don't have the potential target users to do so
    if (_.isEmpty(this.props.targetUsersForUpload)) {
      return null;
    }

    var text = this.props.locationPath === pagesMap.MAIN ?
      i18n.t('Upload data for') : i18n.t('Choose devices for');
    var styleClass = this.props.locationPath.substring(1);

    return (
      <div>
        <div className={styles.uploadGroup}>
          <div className={styles.label}>{text}</div>
          <div className={styles[styleClass]}>
            {this.groupSelector()}
          </div>
        </div>
      </div>
    );
  }
}

module.exports = UserDropdown;
