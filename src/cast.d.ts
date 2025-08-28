// Global type declarations for Chromecast, ensures TypeScript knows about window.cast
declare global {
  interface Window {
    __onGCastApiAvailable?: (isAvailable: boolean) => void;
    cast?: any;
    chrome?: {
      cast?: any;
      media?: any;
      [key: string]: any;
    };
  }
}

// Extend HTMLVideoElement type to support hls property
// This was previously in PlayPageClient.tsx, moved here for global access
declare global {
  interface HTMLVideoElement {
    hls?: any;
  }
}
