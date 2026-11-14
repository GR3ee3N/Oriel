// The icons on the player controls. Browsing screens use components/Icon.tsx.

export const PLAY = 'M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z';
export const PAUSE = 'M7 4h2.5a1.2 1.2 0 0 1 1.2 1.2v13.6a1.2 1.2 0 0 1-1.2 1.2H7a1.2 1.2 0 0 1-1.2-1.2V5.2A1.2 1.2 0 0 1 7 4zm7.5 0H17a1.2 1.2 0 0 1 1.2 1.2v13.6A1.2 1.2 0 0 1 17 20h-2.5a1.2 1.2 0 0 1-1.2-1.2V5.2A1.2 1.2 0 0 1 14.5 4z';
export const NEXT = 'M5 5.5v13a1 1 0 0 0 1.53.85L16 13.2V18a1 1 0 0 0 2 0V6a1 1 0 0 0-2 0v4.8L6.53 4.65A1 1 0 0 0 5 5.5z';
export const SKIP = 'M3 6.2v11.6a.8.8 0 0 0 1.25.66L12 13.1v4.7a.8.8 0 0 0 1.25.66l8.2-5.8a.8.8 0 0 0 0-1.32l-8.2-5.8A.8.8 0 0 0 12 6.2v4.7L4.25 5.54A.8.8 0 0 0 3 6.2z';
export const AUDIO = 'M2.5 10v4M6.5 6.5v11M10.5 3.5v17M14.5 8v8M18.5 5.5v13M22 10v4';
export const SUBTITLES = 'M4.5 5h15a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM7 15h4M14 15h3M7 11h2M12 11h5';
export const QUALITY = 'M12 14.5l4-4.5M3.4 19a10 10 0 1 1 17.2 0';
export const CHEVRON = 'M6 9.5l6 5 6-5';
export const CHEVRONS = 'm7 9 5-5 5 5M7 15l5 5 5-5';

/** Render a 24×24 icon, filled for playback actions or outlined for settings. */
export function Icon(props: { d: string; fill?: boolean; class?: string }) {
  return (
    <svg
      class={props.class}
      viewBox="0 0 24 24"
      fill={props.fill ? 'currentColor' : 'none'}
      stroke={props.fill ? 'none' : 'currentColor'}
      stroke-width="2.2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d={props.d} />
    </svg>
  );
}
