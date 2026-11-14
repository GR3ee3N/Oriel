import { open } from '../../actions';
import { t } from '../../i18n';
import { provider } from '../../media/servers';
import { Message } from '../components/Controls';
import { Grid } from '../components/Grid';
import { Rail } from '../components/Rail';
import { Status } from '../components/Status';
import './library.css';

/** The profile's video playlists. The rail lists this page only when there are some. */
export function Playlists() {
  return (
    <div class="library">
      <div class="screen-bg" />
      <Rail />
      <Status />
      <header class="page-head">
        <h1>{t('nav.playlists')}</h1>
      </header>
      <Grid
        key="playlists"
        load={(start, size) => provider().playlists({ start, size })}
        onSelect={open}
        class="playlists-grid"
        empty={<Message icon="playlist" title={t('playlists.empty')} body={t('playlists.emptyHint')} />}
      />
    </div>
  );
}
