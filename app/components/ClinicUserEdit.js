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
var sundial = require('sundial');
var personUtils = require('../../lib/core/personUtils');
import { reduxForm } from 'redux-form';

var styles = require('../../styles/components/ClinicUserEdit.module.less');

function zeroPad(value){
  return _.padLeft(value, 2, '0');
};

function validateForm(values){
  var errors = {};
  if(!values.fullName){
    errors.fullName = 'Your patient\'s full name is needed';
  }
  if(values.year && values.month && values.day){
    if(!isValidDate(values.year + '-' + values.month + '-' + zeroPad(values.day))){
      errors.year = 'Hmm, this date doesn’t look right';
    }
  } else {
    errors.year = 'Hmm, this date doesn’t look right';
  }
  return errors;
};

function isValidDate(dateString){
  // check to see if date is proper and not in the future
  return (sundial.isValidDateForMask(dateString, 'YYYY-MM-DD')) &&
    (sundial.dateDifference(new Date(), dateString, 'd') > 0);
};

var MONTHS = [
  {value: '', label: 'Month'},
  {value: '01', label: 'January'},
  {value: '02', label: 'February'},
  {value: '03', label: 'March'},
  {value: '04', label: 'April'},
  {value: '05', label: 'May'},
  {value: '06', label: 'June'},
  {value: '07', label: 'July'},
  {value: '08', label: 'August'},
  {value: '09', label: 'September'},
  {value: '10', label: 'October'},
  {value: '11', label: 'November'},
  {value: '12', label: 'December'}
];

var ClinicUserEdit = React.createClass({
  propTypes: {
    createCustodialAccountErrorMessage: React.PropTypes.string,
    createCustodialAccountErrorDismissed: React.PropTypes.bool.isRequired,
    updateProfileErrorMessage: React.PropTypes.string,
    updateProfileErrorDismissed: React.PropTypes.bool.isRequired,
    allUsers: React.PropTypes.object.isRequired,
    loggedInUser: React.PropTypes.string.isRequired,
    targetId: React.PropTypes.string,
    updateUser: React.PropTypes.func.isRequired,
    createUser: React.PropTypes.func.isRequired,
    cancelEdit: React.PropTypes.func.isRequired,
    onSubmitFail: React.PropTypes.func.isRequired
  },

  handleCancel: function(){
    this.props.cancelEdit();
  },

  handleNext: function(values) {
    var name = values.fullName;
    var dateString = values.year+'-'+values.month+'-'+zeroPad(values.day);
    var email = values.email;
    var mrn = values.mrn;
    if(sundial.isValidDateForMask(dateString, 'YYYY-MM-DD')){
      var profile = {
        fullName: name,
        patient: {
          birthday: dateString
        }
      };

      if(email){
        profile.patient.email = email;
        profile.emails = [email];
      }

      if(mrn){
        profile.patient.mrn = mrn;
      }

      if(this.props.targetId){
        this.props.updateUser(profile);
      } else {
        this.props.createUser(profile);
      }
    }
  },

  renderCreateError: function() {
    if (this.props.createCustodialAccountErrorDismissed || !this.props.createCustodialAccountErrorMessage) {
      return null;
    }
    return (
      <div className={styles.error}>
        <span>
          {this.props.createCustodialAccountErrorMessage}<i className={styles.iconClose} onClick={this.props.dismissCreateCustodialAccountError}></i>
        </span>
      </div>
    );
  },

  renderUpdateError: function() {
    if (this.props.updateProfileErrorDismissed || !this.props.updateProfileErrorMessage) {
      return null;
    }
    return (
      <div className={styles.error}>
        <span>
          {this.props.updateProfileErrorMessage}
        </span>
      </div>
    );
  },

  renderDateError: function(){
    const {fields: {month, day, year}} = this.props;
    if (!year.error) { return null; }
    // only render the error if each field has either been touched or has a value
    // and the user is not interacting with any of them
    const monthCheck = ((month.touched || month.value) && !month.active);
    const dayCheck = ((day.touched || day.value) && !day.active);
    const yearCheck = ((year.touched || year.value) && !year.active);
    return monthCheck && dayCheck && yearCheck &&
      (<div className={styles.validationError}>{year.error}</div>);
  },

  render: function() {
    var titleText = this.props.targetId ? 'Edit patient account' : 'Create a new patient account';
    const {fields: {fullName, month, day, year, mrn, email}, handleSubmit} = this.props;
    var options = _.map(MONTHS, function(item) {
      return <option key={item.value} value={item.value}>{item.label}</option>;
    });
    return (
      <div className={styles.main}>
        <div className={styles.header}>
          <div className={styles.title}>
            {titleText}
          </div>
          <div className={styles.accountName}>
            {_.get(this.props.allUsers, [this.props.loggedInUser, 'fullName'])}
          </div>
        </div>
        <form className={styles.form} onSubmit={handleSubmit(this.handleNext)}>
          <div className={styles.inputWrap}>
            <label className={styles.inputLabel} htmlFor="name">
              Patient Full Name
            </label>
            <input className={styles.input} {...fullName}/>
            {fullName.touched && fullName.error && (<div className={styles.validationError}>{fullName.error}</div>)}
          </div>
          <div className={styles.inputWrap}>
            <label className={styles.inputLabel} htmlFor="birthday">
              Patient Birthdate
            </label>
            <div className={styles.bdayWrap}>
              <select className={styles.monthInput} {...month}>
                {options}
              </select>
              <input className={styles.dateInput} placeholder="Day" {...day}/>
              <input className={styles.dateInput} placeholder="Year" {...year}/>
            </div>
            {this.renderDateError()}
          </div>
          <div className={styles.inputWrap}>
            <label className={styles.inputLabel} htmlFor="mrn">
              MRN (optional)
            </label>
            <input className={styles.input} {...mrn} />
          </div>
          <div className={styles.inputWrap}>
            <label className={styles.inputLabel} htmlFor="email">
              Patient Email (optional)
            </label>
            <input className={styles.input} {...email} />
          </div>
          <div className={styles.actions}>
            <div>
            <button type="submit" className={styles.button}>
                Save
            </button>
            </div>
            <div>
              <div className={styles.cancel} onClick={this.handleCancel}>
                Cancel
              </div>
            </div>
            {this.renderCreateError()}
            {this.renderUpdateError()}
          </div>
        </form>
      </div>
    );
  }
});

function mapStateToProps(state){
    if(!state.uploadTargetUser){
      return {};
    }
    var user = _.get(state.allUsers, state.uploadTargetUser);
    return { initialValues: {
      fullName: personUtils.patientFullName(user),
      year: _.get(user, ['patient', 'birthday'], '').substr(0,4),
      month: _.get(user, ['patient', 'birthday'], '').substr(5,2),
      day: _.get(user, ['patient', 'birthday'], '').substr(8,2),
      email: _.get(user, ['patient', 'email'], ''),
      mrn: _.get(user, ['patient', 'mrn'], '')
    }};
};

ClinicUserEdit = reduxForm({
  form: 'userEdit',
  fields: ['fullName', 'year', 'month', 'day', 'mrn', 'email'],
  validate: validateForm
},
mapStateToProps)(ClinicUserEdit);

module.exports = ClinicUserEdit;
