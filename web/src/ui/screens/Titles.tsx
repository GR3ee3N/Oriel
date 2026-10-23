import { open } from '../../actions';
import type { MediaContainer } from '../../plex/types';
import { Grid } from '../components/Grid';
import './library.css';

/** Grid of collection items or titles featuring a person within one library. */
export function Titles(props: { title: string; key: string; load: (start: number, size: number) => Promise<MediaContainer> }) {
  return (
    <div class="library">
      <div class="screen-bg" />
      <header class="library-head" style={{ top: '90px' }}>
        <h1>{props.title}</h1>
      </header>
      <Grid key={props.key} load={props.load} onSelect={open} />
    </div>
  );
}
