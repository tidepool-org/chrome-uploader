/*
 * == BSD2 LICENSE ==
 * Copyright (c) 2016, Tidepool Project
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
import update from 'immutability-helper';

import * as actionTypes from '../constants/actionTypes';
import { steps } from '../constants/otherConstants';

function isPwd(membership) {
  return !_.isEmpty(_.get(membership, ['profile', 'patient'], {}));
}

export function uploadProgress(state = null, action) {
  switch (action.type) {
    case actionTypes.DEVICE_DETECT_REQUEST:
      return {
        percentage: 0,
        step: steps.detect
      };
    case actionTypes.UPLOAD_FAILURE:
    case actionTypes.UPLOAD_SUCCESS:
    case actionTypes.UPLOAD_CANCELLED:
      return null;
    case actionTypes.UPLOAD_PROGRESS:
      return Object.assign({}, state, action.payload);
    case actionTypes.UPLOAD_REQUEST:
      return {
        percentage: 0,
        step: steps.start
      };
    default:
      return state;
  }
}

export function uploadsByUser(state = {}, action) {
  switch (action.type) {
    case actionTypes.CHOOSING_FILE: {
      const { userId, deviceKey } = action.payload;
      let newState = state;
      let devicesForCurrentUser = _.get(state, [userId], {});
      _.forOwn(devicesForCurrentUser, (upload, key) => {
        newState = update(
          newState,
          {[userId]: {[key]: {$apply: (upload) => {
            if (key === deviceKey) {
              return update(
                upload,
                {
                  choosingFile: {$set: true}
                }
              );
            }
            else {
              return update(
                upload,
                {disabled: {$set: true}}
              );
            }
          }}}}
        );
      });
      return newState;
    }
    case actionTypes.READ_FILE_ABORTED: {
      const err = action.payload;
      let uploadTargetUser, uploadTargetDevice;
      let newState = state;
      _.forOwn(state, (uploads, userId) => {
        _.forOwn(uploads, (upload, deviceKey) => {
          if (upload.choosingFile === true) {
            uploadTargetUser = userId;
            uploadTargetDevice = deviceKey;
          }
        });
      });
      if (uploadTargetUser && uploadTargetDevice) {
        let devicesForCurrentUser = _.get(state, uploadTargetUser, {});
        _.forOwn(devicesForCurrentUser, (upload, key) => {
          newState = update(
            newState,
            {[uploadTargetUser]: {[key]: {$apply: (upload) => {
              if (key === uploadTargetDevice) {
                return update(
                  upload,
                  {
                    choosingFile: {$set: false},
                    completed: {$set: true},
                    error: {$set: err},
                    failed: {$set: true}
                  }
                );
              }
              else {
                return update(
                  upload,
                  {disabled: {$set: false}}
                );
              }
            }}}}
          );
        });
      }
      return newState;
    }
    case actionTypes.READ_FILE_FAILURE: {
      const err = action.payload;
      let uploadTargetUser, uploadTargetDevice;
      _.forOwn(state, (uploads, userId) => {
        _.forOwn(uploads, (upload, deviceKey) => {
          if (upload.readingFile === true) {
            uploadTargetUser = userId;
            uploadTargetDevice = deviceKey;
          }
        });
      });
      if (uploadTargetUser && uploadTargetDevice) {
        return update(
          state,
          {[uploadTargetUser]: {[uploadTargetDevice]: {
            completed: {$set: true},
            error: {$set: err},
            failed: {$set: true},
            readingFile: {$set: false}
          }}}
        );
      }
    }
    case actionTypes.READ_FILE_REQUEST: {
      const { userId, deviceKey, filename } = action.payload;
      return update(
        state,
        {[userId]: {[deviceKey]: {
          choosingFile: {$set: false},
          file: {$set: {name: filename}},
          readingFile: {$set: true}
        }}}
      );
    }
    case actionTypes.READ_FILE_SUCCESS: {
      const { userId, deviceKey, filedata } = action.payload;
      return update(
        state,
        {[userId]: {[deviceKey]: {
          file: {data: {$set: filedata}},
          readingFile: {$set: false}
        }}}
      );
    }
    case actionTypes.RESET_UPLOAD: {
      const { userId, deviceKey } = action.payload;
      const uploadInProgress = _.some(
        _.get(state, [userId], {}),
        (upload, key) => {
          const fileDataExists = _.get(upload, ['file', 'data'], null) !== null;
          // because we don't want the existence of file.data on a block-mode device
          // to make it appear as though an upload is in progress when we're trying
          // to reset the block-mode device itself!
          if (key !== deviceKey) {
            return upload.choosingFile ||
              upload.readingFile ||
              (fileDataExists && !upload.completed) ||
              upload.uploading;
          }
          else {
            return false;
          }
        }
      );
      if (uploadInProgress) {
        return update(
          state,
          {[userId]: {[deviceKey]: {$apply: (upload) => {
            let resetUpload = _.pick(upload, 'history');
            resetUpload.disabled = true;
            return resetUpload;
          }}}}
        );
      }
      else {
        return update(
          state,
          {[userId]: {[deviceKey]: {$apply: (upload) => {
            return _.pick(upload, 'history');
          }}}}
        );
      }
    }
    case actionTypes.SET_UPLOADS:
      const { devicesByUser } = action.payload;
      let newState = state;
      _.forOwn(devicesByUser, (deviceKeys, userId) => {
        if (_.get(newState, userId, null) === null) {
          const uploadsForUser = {};
          _.each(deviceKeys, (deviceKey) => {
            uploadsForUser[deviceKey] = {history: []};
          });
          newState = update(
            newState,
            {[userId]: {$set: uploadsForUser}}
          );
        }
        else {
          _.each(deviceKeys, (deviceKey) => {
            if (_.get(newState, [userId, deviceKey], null) === null) {
              newState = update(
                newState,
                {[userId]: {[deviceKey]: {$set: {history: []}}}}
              );
            }
          });
          const devicesToDelete = _.difference(
            Object.keys(newState[userId]),
            deviceKeys
          );
          if (!_.isEmpty(devicesToDelete)) {
            newState = update(
              newState,
              {[userId]: {$apply: (uploadsForUser) => {
                _.each(devicesToDelete, (deviceKey) => {
                  uploadsForUser = _.omit(uploadsForUser, deviceKey);
                });
                return uploadsForUser;
              }}}
            );
          }
        }
      });
      return newState;
    case actionTypes.TOGGLE_ERROR_DETAILS: {
      const { userId, deviceKey, isVisible } = action.payload;
      return update(
        state,
        {[userId]: {[deviceKey]: {showErrorDetails: {$set: isVisible}}}}
      );
    }
    case actionTypes.UPLOAD_CANCELLED: {
      const { utc } = action.payload;
      let uploadTargetUser, uploadTargetDevice;
      _.forOwn(state, (uploads, userId) => {
        _.forOwn(uploads, (upload, deviceKey) => {
          if (upload.uploading === true) {
            uploadTargetUser = userId;
            uploadTargetDevice = deviceKey;
          }
        });
      });
      if (uploadTargetUser && uploadTargetDevice) {
        let newState = state;
        let devicesForCurrentUser = _.get(state, [uploadTargetUser], {});
        _.forOwn(devicesForCurrentUser, (upload, key) => {
          newState = update(
            newState,
            {[uploadTargetUser]: {[key]: {$apply: (upload) => {
              if (key === uploadTargetDevice) {
                return update(
                  upload,
                  {
                    completed: {$set: true},
                    failed: {$set: false},
                    history: {[0]: {
                      finish: {$set: utc}
                    }},
                    uploading: {$set: false}
                  }
                );
              }
              else {
                return _.omit(upload, 'disabled');
              }
            }}}}
          );
        });
        return newState;
      }
    }
    case actionTypes.UPLOAD_FAILURE: {
      const err = action.payload;
      let uploadTargetUser, uploadTargetDevice;
      _.forOwn(state, (uploads, userId) => {
        _.forOwn(uploads, (upload, deviceKey) => {
          if (upload.uploading === true) {
            uploadTargetUser = userId;
            uploadTargetDevice = deviceKey;
          }
        });
      });
      if (uploadTargetUser && uploadTargetDevice) {
        let newState = state;
        let devicesForCurrentUser = _.get(state, [uploadTargetUser], {});
        _.forOwn(devicesForCurrentUser, (upload, key) => {
          newState = update(
            newState,
            {[uploadTargetUser]: {[key]: {$apply: (upload) => {
              if (key === uploadTargetDevice) {
                return update(
                  upload,
                  {
                    completed: {$set: true},
                    error: {$set: err},
                    failed: {$set: true},
                    history: {[0]: {
                      error: {$set: true},
                      finish: {$set: err.utc}
                    }},
                    uploading: {$set: false}
                  }
                );
              }
              else {
                return _.omit(upload, 'disabled');
              }
            }}}}
          );
        });
        return newState;
      }
    }
    case actionTypes.UPLOAD_REQUEST: {
      const { userId, deviceKey, utc } = action.payload;
      let newState = state;
      let devicesForCurrentUser = _.get(state, [userId], {});
      _.forOwn(devicesForCurrentUser, (upload, key) => {
        newState = update(
          newState,
          {[userId]: {[key]: {$apply: (upload) => {
            if (key === deviceKey) {
              return update(
                upload,
                {
                  history: {$unshift: [{start: utc}]},
                  uploading: {$set: true}
                }
              );
            }
            else {
              return update(
                upload,
                {disabled: {$set: true}}
              );
            }
          }}}}
        );
      });
      return newState;
    }
    case actionTypes.UPLOAD_SUCCESS: {
      const { userId, deviceKey, data, utc } = action.payload;
      let newState = state;
      let devicesForCurrentUser = _.get(state, [userId], {});
      _.forOwn(devicesForCurrentUser, (upload, key) => {
        newState = update(
          newState,
          {[userId]: {[key]: {$apply: (upload) => {
            if (key === deviceKey) {
              return update(
                upload,
                {
                  completed: {$set: true},
                  data: {$set: data},
                  history: {[0]: {
                    finish: {$set: utc}
                  }},
                  successful: {$set: true},
                  uploading: {$set: false}
                }
              );
            }
            else {
              return _.omit(upload, 'disabled');
            }
          }}}}
        );
      });
      return newState;
    }
    case actionTypes.ADD_TARGET_DEVICE: {
      const { userId, deviceKey } = action.payload;
      let newState = state;
      if (_.get(newState, userId, null) === null) {
        const uploadsForUser = {};
        uploadsForUser[deviceKey] = {history: []};
        newState = update(
          newState,
          {[userId]: {$set: uploadsForUser}}
        );
      }
      else {
        if (_.get(newState, [userId, deviceKey], null) === null) {
          newState = update(
            newState,
            {[userId]: {[deviceKey]: {$set: {history: []}}}}
          );
        }
      }
      return newState;
    }
    case actionTypes.REMOVE_TARGET_DEVICE: {
      const { userId, deviceKey } = action.payload;
      let newState = state;
      if (_.get(newState, [userId, deviceKey], null) !== null) {
        newState = update(
          newState,
          {[userId]: {$apply: (uploadsForUser) => {
            uploadsForUser = _.omit(uploadsForUser, deviceKey);
            return uploadsForUser;
          }}}
        );
      }
      return newState;
    }
    case actionTypes.LOGIN_SUCCESS:
    case actionTypes.SET_USER_INFO_FROM_TOKEN: {
      const { memberships } = action.payload;
      let newState = state;
      _.each(memberships, (membership) => {
        if (isPwd(membership)) {
          const deviceKeys = _.get(membership, ['profile', 'patient', 'targetDevices'], null);
          if(deviceKeys !== null){
            const userId = membership.userid;
            if (_.get(newState, userId, null) === null) {
              const uploadsForUser = {};
              _.each(deviceKeys, (deviceKey) => {
                uploadsForUser[deviceKey] = {history: []};
              });
              newState = update(
                newState,
                {[userId]: {$set: uploadsForUser}}
              );
            }
            else {
              _.each(deviceKeys, (deviceKey) => {
                if (_.get(newState, [userId, deviceKey], null) === null) {
                  newState = update(
                    newState,
                    {[userId]: {[deviceKey]: {$set: {history: []}}}}
                  );
                }
              });
              const devicesToDelete = _.difference(
                Object.keys(newState[userId]),
                deviceKeys
              );
              if (!_.isEmpty(devicesToDelete)) {
                newState = update(
                  newState,
                  {[userId]: {$apply: (uploadsForUser) => {
                    _.each(devicesToDelete, (deviceKey) => {
                      uploadsForUser = _.omit(uploadsForUser, deviceKey);
                    });
                    return uploadsForUser;
                  }}}
                );
              }
            }
          }
        }
      });
      return newState;
    }
    default:
      return state;
  }
}

export function uploadTargetDevice(state = null, action) {
  switch (action.type) {
    case actionTypes.CHOOSING_FILE:
    case actionTypes.UPLOAD_REQUEST: {
      const { deviceKey } = action.payload;
      return deviceKey;
    }
    case actionTypes.READ_FILE_ABORTED:
    case actionTypes.READ_FILE_FAILURE:
    case actionTypes.UPLOAD_FAILURE:
    case actionTypes.UPLOAD_SUCCESS:
      return null;
    default:
      return state;
  }
}
