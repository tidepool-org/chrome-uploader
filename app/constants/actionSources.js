/*
 * == BSD2 LICENSE ==
 * Copyright (c) 2015, Tidepool Project
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

export const USER = 'USER';
export const USER_VISIBLE = 'USER_VISIBLE';
export const UNDER_THE_HOOD = 'UNDER_THE_HOOD';

/**
 * Syncronous action types
 */
export const ADD_TARGET_DEVICE = USER;
export const CLICK_GO_TO_BLIP = USER;
export const CLINIC_ADD_MRN = USER;
export const CLINIC_ADD_EMAIL = USER;
export const CLINIC_DEVICE_STORED = USER;
export const CLINIC_ADD_INVALID_DATE = USER;
export const HIDE_UNAVAILABLE_DEVICES = USER_VISIBLE;
export const REMOVE_TARGET_DEVICE = USER;
export const RESET_UPLOAD = USER;
export const RETRIEVING_USERS_TARGETS = UNDER_THE_HOOD;
export const SET_BLIP_VIEW_DATA_URL = USER_VISIBLE;
export const SET_DEFAULT_TARGET_ID = USER_VISIBLE;
export const SET_FORGOT_PASSWORD_URL = USER_VISIBLE;
export const SET_NEW_PATIENT_URL = USER_VISIBLE;
export const SET_OS = UNDER_THE_HOOD;
export const SET_PAGE = USER_VISIBLE;
export const SET_SIGNUP_URL = USER_VISIBLE;
export const SET_TARGET_TIMEZONE = USER;
export const SET_UPLOADS = UNDER_THE_HOOD;
export const SET_UPLOAD_TARGET_USER = USER;
export const SET_USER_INFO_FROM_TOKEN = USER_VISIBLE;
export const SET_USERS_TARGETS = USER_VISIBLE;
export const SET_VERSION = USER_VISIBLE;
export const STORING_USERS_TARGETS = UNDER_THE_HOOD;
export const TOGGLE_DROPDOWN = USER;
export const TOGGLE_ERROR_DETAILS = USER;
export const DISMISS_UPDATE_PROFILE_ERROR = USER;
export const DISMISS_CREATE_CUSTODIAL_ACCOUNT_ERROR = USER;
export const SET_ALL_USERS = UNDER_THE_HOOD;
export const TIMEZONE_BLUR = UNDER_THE_HOOD;

/*
 * Asyncronous action types
 */

export const INIT_APP_REQUEST = UNDER_THE_HOOD;
export const INIT_APP_SUCCESS = UNDER_THE_HOOD;
export const INIT_APP_FAILURE = USER_VISIBLE;

// user.login
export const LOGIN_REQUEST = USER;
export const LOGIN_SUCCESS = USER_VISIBLE;
export const LOGIN_FAILURE = USER_VISIBLE;

// user.logout
export const LOGOUT_REQUEST = USER;
export const LOGOUT_SUCCESS = USER_VISIBLE;
// because we don't surface logout errors in the UI
export const LOGOUT_FAILURE = UNDER_THE_HOOD;

// uploading devices
export const UPLOAD_REQUEST = USER;
export const UPLOAD_PROGRESS = USER_VISIBLE;
export const UPLOAD_SUCCESS = USER_VISIBLE;
export const UPLOAD_FAILURE = USER_VISIBLE;
export const UPLOAD_ABORTED = USER_VISIBLE;
export const UPLOAD_CANCELLED = USER_VISIBLE;

export const DEVICE_DETECT_REQUEST = UNDER_THE_HOOD;
export const DEVICE_DETECT_FAILURE = USER_VISIBLE;
export const DEVICE_DETECT_SUCCESS = UNDER_THE_HOOD;

export const DEVICE_TIME_INCORRECT = USER_VISIBLE;
export const DISMISS_DEVICE_TIME_PROMPT = USER_VISIBLE;

export const READ_FILE_REQUEST = USER;
export const READ_FILE_SUCCESS = USER_VISIBLE;
export const READ_FILE_FAILURE = USER_VISIBLE;
export const READ_FILE_ABORTED = USER_VISIBLE;
export const CHOOSING_FILE = USER;

// version check
export const VERSION_CHECK_REQUEST = UNDER_THE_HOOD;
export const VERSION_CHECK_SUCCESS = UNDER_THE_HOOD;
export const VERSION_CHECK_FAILURE = USER_VISIBLE;

// update profile
export const UPDATE_PROFILE_REQUEST = UNDER_THE_HOOD;
export const UPDATE_PROFILE_SUCCESS = UNDER_THE_HOOD;
export const UPDATE_PROFILE_FAILURE = USER_VISIBLE;

// create custodial account
export const CREATE_CUSTODIAL_ACCOUNT_REQUEST = UNDER_THE_HOOD;
export const CREATE_CUSTODIAL_ACCOUNT_SUCCESS = UNDER_THE_HOOD;
export const CREATE_CUSTODIAL_ACCOUNT_FAILURE = USER_VISIBLE;

// application update
export const QUIT_AND_INSTALL = UNDER_THE_HOOD;

// ad hoc pairing
export const AD_HOC_PAIRING_REQUEST = USER_VISIBLE;
export const AD_HOC_PAIRING_DISMISSED = USER;
