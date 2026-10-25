import { t } from '../../i18n';
import { chooseServer, serverOptions, session } from '../../session';
import { Panel } from './Panel';

/** Server choice for error states; the rail's profile menu offers the same list. */
export function ServerPicker(props: { onClose: () => void }) {
  return (
    <Panel
      title={t('settings.server')}
      options={serverOptions().map((o) => ({ ...o, icon: 'server' as const }))}
      selected={session.serverId}
      onChoose={(id) => {
        props.onClose();
        void chooseServer(id);
      }}
      onClose={props.onClose}
    />
  );
}
