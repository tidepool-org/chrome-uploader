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
var PropTypes = require('prop-types');
var React = require('react');

var styles = require('../../styles/components/ViewDataLink.module.less');

const remote = require('@electron/remote');
const i18n = remote.getGlobal( 'i18n' );

class ViewDataLink extends React.Component {
  static propTypes = {
    href: PropTypes.string.isRequired,
    onViewClicked: PropTypes.func.isRequired
  };

  render() {
    return (
      <div className={styles.buttonWrap}>
        <a className={styles.button}
          disabled={_.isEmpty(this.props.href)}
          href={this.props.href}
          onClick={this.props.onViewClicked}
          target="_blank" >
          {i18n.t('See data')}
        </a>
      </div>
    );
  }
}

module.exports = ViewDataLink;
