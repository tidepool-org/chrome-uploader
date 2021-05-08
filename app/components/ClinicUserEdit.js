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

import { reduxForm, Field, Fields } from 'redux-form';
import { connect } from 'react-redux';

var React = require('react');
var PropTypes = require('prop-types');
var _ = require('lodash');
var sundial = require('sundial');
var personUtils = require('../../lib/core/personUtils');
var styles = require('../../styles/components/ClinicUserEdit.module.less');

const remote = require('@electron/remote');
const i18n = remote.getGlobal( 'i18n' );

function zeroPad(value){
  return _.padStart(value, 2, '0');
}

function validateForm(values){
  var errors = {};
  if(!values.fullName){
    errors.fullName = i18n.t('Your patient\'s full name is needed');
  }
  if(values.year && values.month && values.day){
    if(!isValidDate(values.year + '-' + values.month + '-' + zeroPad(values.day))){
      errors.year = i18n.t('Hmm, this date doesn’t look right');
    }
  } else {
    errors.year = i18n.t('Hmm, this date doesn’t look right');
  }
  return errors;
}

function isValidDate(dateString){
  // check to see if date is proper and not in the future
  return (sundial.isValidDateForMask(dateString, 'YYYY-MM-DD')) &&
    (sundial.dateDifference(new Date(), dateString, 'd') > 0);
}

var MONTHS = [
  {value: '', label: i18n.t('Month')},
  {value: '01', label: i18n.t('January')},
  {value: '02', label: i18n.t('February')},
  {value: '03', label: i18n.t('March')},
  {value: '04', label: i18n.t('April')},
  {value: '05', label: i18n.t('May')},
  {value: '06', label: i18n.t('June')},
  {value: '07', label: i18n.t('July')},
  {value: '08', label: i18n.t('August')},
  {value: '09', label: i18n.t('September')},
  {value: '10', label: i18n.t('October')},
  {value: '11', label: i18n.t('November')},
  {value: '12', label: i18n.t('December')}
];

var options = _.map(MONTHS, function(item) {
  return <option key={item.value} value={item.value}>{item.label}</option>;
});

function renderInput(field){
  return (
    <div>
      <input className={styles.input} {...field.input} type={field.type} disabled={field.disabled} />
      {field.meta.touched &&
       field.meta.error &&
       <div className={styles.validationError}>{field.meta.error}</div>}
    </div>
  );
};

class ClinicUserEdit extends React.Component {
  static propTypes = {
    createCustodialAccountErrorMessage: PropTypes.string,
    createCustodialAccountErrorDismissed: PropTypes.bool.isRequired,
    dismissCreateCustodialAccountError: PropTypes.func.isRequired,
    updateProfileErrorMessage: PropTypes.string,
    updateProfileErrorDismissed: PropTypes.bool.isRequired,
    dismissUpdateProfileError: PropTypes.func.isRequired,
    allUsers: PropTypes.object.isRequired,
    loggedInUser: PropTypes.string.isRequired,
    targetId: PropTypes.string,
    updateUser: PropTypes.func.isRequired,
    createUser: PropTypes.func.isRequired,
    cancelEdit: PropTypes.func.isRequired,
    onSubmitFail: PropTypes.func.isRequired
  };

  handleCancel = () => {
    this.props.cancelEdit();
  };

  handleNext = (values) => {
    var name = values.fullName;
    var dateString = values.year+'-'+values.month+'-'+zeroPad(values.day);
    var { email, mrn } = values;
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
  };

  renderCreateError = () => {
    if (this.props.createCustodialAccountErrorDismissed || !this.props.createCustodialAccountErrorMessage) {
      return null;
    }
    return (
      <div className={styles.error}>
        <span>
          {i18n.t(this.props.createCustodialAccountErrorMessage)}<i className={styles.iconClose} onClick={this.props.dismissCreateCustodialAccountError}></i>
        </span>
      </div>
    );
  };

  renderUpdateError = () => {
    if (this.props.updateProfileErrorDismissed || !this.props.updateProfileErrorMessage) {
      return null;
    }
    return (
      <div className={styles.error}>
        <span>
          {i18n.t(this.props.updateProfileErrorMessage)}<i className={styles.iconClose} onClick={this.props.dismissUpdateProfileError}></i>
        </span>
      </div>
    );
  };

  renderDateInputs = (fields) => (
    <div>
      <div className={styles.bdayWrap}>
        <select className={styles.monthInput} {...fields.month.input} disabled={fields.disabled}>
          {options}
        </select>
        <input className={styles.dateInput} placeholder={i18n.t('Day')} {...fields.day.input} type="text" disabled={fields.disabled}/>
        <input className={styles.dateInput} placeholder={i18n.t('Year')} {...fields.year.input} type="text" disabled={fields.disabled}/>
      </div>
      {this.renderDateError(fields)}
    </div>
  );

  renderDateError = (fields) => {
    const {month, day, year} = fields;
    if (!year || !year.meta.error) { return null; }
    // only render the error if each field has either been touched or has a value
    // and the user is not interacting with any of them
    const monthCheck = ((month.meta.touched || month.input.value) && !month.meta.active);
    const dayCheck = ((day.meta.touched || day.input.value) && !day.meta.active);
    const yearCheck = ((year.meta.touched || year.input.value) && !year.meta.active);
    return monthCheck && dayCheck && yearCheck &&
      (<div className={styles.validationError}>{year.meta.error}</div>);
  };

  render() {
    const { handleSubmit, targetId, memberships } = this.props;
    const isCustodialAccount = _.has(_.get(memberships, [targetId, 'permissions']), 'custodian');
    const titleText = targetId ? i18n.t('Edit patient account') : i18n.t('Create a new patient account');
    const editable = targetId ? isCustodialAccount : true;

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
              {i18n.t('Patient Full Name')}
            </label>
            <Field name="fullName" component={renderInput} props={{ disabled: !editable }} />
          </div>
          <div className={styles.inputWrap}>
            <label className={styles.inputLabel} htmlFor="birthday">
              {i18n.t('Patient Birthdate')}
            </label>
            <Fields names={['month', 'day', 'year']} component={this.renderDateInputs} props={{ disabled: !editable }} />
          </div>
          <div className={styles.inputWrap}>
            <label className={styles.inputLabel} htmlFor="mrn">
              {i18n.t('MRN (optional)')}
            </label>
            <Field name="mrn" component={renderInput} props={{ disabled: !editable }} />
          </div>
          <div className={styles.inputWrap}>
            <label className={styles.inputLabel} htmlFor="email">
              {i18n.t('Patient Email (optional)')}
            </label>
            <Field name="email" component={renderInput} props={{ disabled: !editable }} />
          </div>
          <div className={styles.actions}>
            <div>
              <button type="submit" className={styles.button} disabled={!editable}>
                {i18n.t('Save')}
              </button>
            </div>
            <div>
              <div className={styles.cancel} onClick={this.handleCancel}>
                {i18n.t('Cancel')}
              </div>
            </div>
            {this.renderCreateError()}
            {this.renderUpdateError()}
          </div>
        </form>
      </div>
    );
  }
}

const ClinicUserEditWrapped = reduxForm({
  form: 'userEdit',
  validate: validateForm
})(ClinicUserEdit);

function mapStateToProps(state){
    let initialValues = {};

    if(state.uploadTargetUser){
      var user = _.get(state.allUsers, state.uploadTargetUser);
      initialValues = {
        initialValues: {
          fullName: personUtils.patientFullName(user),
          year: _.get(user, ['patient', 'birthday'], '').substr(0,4),
          month: _.get(user, ['patient', 'birthday'], '').substr(5,2),
          day: _.get(user, ['patient', 'birthday'], '').substr(8,2),
          email: _.get(user, ['patient', 'email'], ''),
          mrn: _.get(user, ['patient', 'mrn'], '')
        }
      };
    };

    return initialValues;
}

export default connect(mapStateToProps)(ClinicUserEditWrapped);
