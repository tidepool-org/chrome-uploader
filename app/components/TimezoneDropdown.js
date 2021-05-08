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
var sundial = require('sundial');
var cx = require('classnames');

var styles = require('../../styles/components/TimezoneDropdown.module.less');

const remote = require('@electron/remote');
const i18n = remote.getGlobal( 'i18n' );

class TimezoneDropdown extends React.Component {
  constructor(props) {
    super(props);

    this.timezoneSelect = null;

    this.setTimezoneSelect = element => {
      this.timezoneSelect = element;
    };
  }

  static propTypes = {
    onTimezoneChange: PropTypes.func.isRequired,
    selectorLabel: PropTypes.string.isRequired,
    // targetId can be null when logged in user is not a data storage account
    // for example a clinic worker
    targetId: PropTypes.string,
    targetTimezone: PropTypes.string,
    updateProfileErrorMessage: PropTypes.string,
    updateProfileErrorDismissed: PropTypes.bool,
    dismissUpdateProfileError: PropTypes.func.isRequired,
    isClinicAccount: PropTypes.bool,
    userDropdownShowing: PropTypes.bool,
    isUploadInProgress: PropTypes.bool.isRequired,
    onBlur: PropTypes.func.isRequired,
    isTimezoneFocused: PropTypes.bool.isRequired
  };

  UNSAFE_componentWillReceiveProps(nextProps) {
    if (!this.props.targetId && nextProps.targetId !== null) {
      if (this.props.targetTimezone !== null) {
        this.props.onTimezoneChange(
          nextProps.targetId,
          this.props.targetTimezone
        );
      }
    }
  }

  componentDidMount() {
    var self = this;
    self.updateSuggestedInterval = setInterval(
      function(){
        self.setState({time: new Date()});
      }, 1000 * 60
    );
  }

  componentWillUnmount() {
    clearInterval(this.updateSuggestedInterval);
  }

  componentDidUpdate() {
    if (this.timezoneSelect && this.props.isTimezoneFocused) {
      this.timezoneSelect.focus();
    }
  }

  buildTzSelector = () => {
    function sortByOffset(timezones) {
      return _.sortBy(timezones, function(tz) {
        return tz.offset;
      });
    }
    var timezones = sundial.getTimezones();
    var opts = sortByOffset(timezones.bigFour)
      .concat(sortByOffset(timezones.unitedStates))
      .concat(sortByOffset(timezones.hoisted))
      .concat(sortByOffset(timezones.theRest));
    var targetUser = this.props.targetId || 'noUserSelected';

    return (
      <Select clearable={false}
        name={'timezoneSelect'}
        onBlur={this.props.onBlur}
        onChange={this.props.onTimezoneChange.bind(null, targetUser)}
        options={opts}
        simpleValue={true}
        placeholder={i18n.t('Type to search...')}
        value={this.props.targetTimezone}
        disabled={this.props.isUploadInProgress}
        ref={this.setTimezoneSelect} />
    );
  };

  renderSuggestedTime = () => {
    if(this.props.targetTimezone){
      let textClinic = i18n.t('The device times should be approximately');
      let textPatient = i18n.t('Your device times should be approximately');
      let text = this.props.isClinicAccount ? textClinic : textPatient;
      let timez = this.props.targetTimezone;
      return (
        <div className={styles.timeDetail}>
          {text} {sundial.formatInTimezone(new Date(), timez, 'h:mm a')}
        </div>
      );
    } else {
      return (
        <div className={styles.timeDetail}>
          {i18n.t('Please select a time zone.')}
        </div>
      );
    }
  };

  renderError = () => {
    if(this.props.updateProfileErrorMessage && !this.props.updateProfileErrorDismissed){
      return (
        <div className={styles.error}>
          {this.props.updateProfileErrorMessage}
          <i className={styles.iconClose} onClick={this.props.dismissUpdateProfileError}></i>
        </div>
      );
    }
  };

  render() {
    var timezoneClasses = cx({
      [styles.clinic]: this.props.isClinicAccount,
      [styles.userDropdownShowing]: this.props.userDropdownShowing,
      [styles.timezoneDropdown]: true
    });

    var listClasses = cx({
      [styles.list]: true,
      [styles.listNoValue]: !this.props.targetTimezone
    });

    return (
      <div className={timezoneClasses}>
      {this.renderError()}
        <div className={styles.timezone}>
          <div className={styles.label}>{this.props.selectorLabel}</div>
          <div className={listClasses}>
            {this.buildTzSelector()}
          </div>
          {this.renderSuggestedTime()}
        </div>
      </div>
    );
  }
}

module.exports = TimezoneDropdown;
