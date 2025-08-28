// src/artplayer.d.ts
import { Option } from 'artplayer';

declare module 'artplayer' {
  interface Option {
    chromecast?: boolean;
  }
}
