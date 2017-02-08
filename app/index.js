import _ from 'lodash';
import React from 'react';
import { render } from 'react-dom';
import { Provider } from 'react-redux';
import { Router, hashHistory } from 'react-router';
import { syncHistoryWithStore } from 'react-router-redux';
import config from '../lib/config';
window.DEBUG = config.DEBUG;
import Root from './containers/Root';
import routes from './routes';
import configureStore from './store/configureStore';
import './app.global.css';
import '../styles/main.less';

const store = configureStore();
const history = syncHistoryWithStore(hashHistory, store);

render(
  <Provider store={store}>
    <Router history={history} routes={routes} />
  </Provider>,
  document.getElementById('app')
);
