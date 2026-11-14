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
        <h1>{session.code?.title}</h1>
        <p class="lead">{session.code?.hint}</p>
        <Show when={session.code} fallback={<p class="code dim">····</p>}>
          {(code) => <p class="code">{code().code}</p>}
        </Show>
      </section>
    </>
  );
}
