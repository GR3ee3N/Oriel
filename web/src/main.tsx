import { render } from 'solid-js/web';
import { App } from './ui/App';
import '@fontsource-variable/inter/wght.css';
import './ui/emoji.css';
import './ui/theme.css';
import './ui/styles.css';

// WebKit's console is captured in shell.log.
window.addEventListener('error', (e) => console.error(`error: ${e.message} at ${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => console.error(`unhandled: ${e.reason?.stack ?? e.reason}`));

render(() => <App />, document.getElementById('root')!);
