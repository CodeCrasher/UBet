import { render } from 'preact';
import { App } from './app.jsx';
import { init } from './lib/store.js';
import './styles.css';

init();
render(<App />, document.getElementById('app'));
