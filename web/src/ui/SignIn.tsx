import { Show } from 'solid-js';
import { t } from '../i18n';
import { session } from '../session';
import { Backdrop } from './components/Backdrop';
import { Mark } from './Splash';

export function SignIn() {
  return (
    <>
      <Backdrop />
      <section class="screen signin">
        <Mark size={110} />
        <h1>{t('start.signIn')}</h1>
        <p class="lead">{t('start.signInHint', { site: 'plex.tv/link' })}</p>
        <Show when={session.pin} fallback={<p class="code dim">····</p>}>
          {(pin) => <p class="code">{pin().code}</p>}
        </Show>
      </section>
    </>
  );
}
