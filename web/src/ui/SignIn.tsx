import { Show } from 'solid-js';
import { session } from '../session';
import { Backdrop } from './components/Backdrop';
import { Mark } from './Splash';

export function SignIn() {
  return (
    <>
      <Backdrop />
      <section class="screen signin">
        <Mark size={110} />
        <h1>Sign in to Plex</h1>
        <p class="lead">
          On your phone or computer, go to <b>plex.tv/link</b> and enter this code:
        </p>
        <Show when={session.pin} fallback={<p class="code dim">····</p>}>
          {(pin) => <p class="code">{pin().code}</p>}
        </Show>
      </section>
    </>
  );
}
