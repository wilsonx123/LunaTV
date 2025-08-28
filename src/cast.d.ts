// src/cast.d.ts

// =========================================================
// Declarations for Google Cast SDK (minimal set)
// Detailed types for the entire SDK are very extensive.
// This provides enough for common usage with some type safety.
// =========================================================

declare global {
  interface Window {
    __onGCastApiAvailable?: (isAvailable: boolean) => void;
    cast?: cast.framework.CastContext; // More specific
    chrome?: {
      cast?: cast.framework.Cast; // More specific
      media?: cast.media.Media; // More specific
      [key: string]: any; // Keep `any` for other unknown chrome properties
    };
  }

  // If Hls.js is used directly on the video element, this is helpful
  interface HTMLVideoElement {
    hls?: import('hls.js').default; // Use Hls.js's type
  }

  // Chromecast Global Namespaces (define them if not directly accessible via window.chrome.cast)
  // These are often available as top-level globals when the SDK loads.
  namespace chrome.cast {
    namespace media {
      class MediaInfo {
        constructor(contentId: string, contentType: string);
        contentId: string;
        contentType: string;
        metadata: GenericMediaMetadata | MusicTrackMediaMetadata | MovieMediaMetadata | TvShowMediaMetadata | PhotoMediaMetadata;
        streamType: string; // e.g., 'BUFFERED', 'LIVE'
        duration?: number;
        // ... other properties you might use
      }

      class GenericMediaMetadata {
        metadataType: number;
        title?: string;
        subtitle?: string;
        images?: Image[];
        // ... more
      }

      class Image {
        url: string;
        width?: number;
        height?: number;
      }

      class LoadRequest {
        constructor(mediaInfo: MediaInfo);
        mediaInfo: MediaInfo;
        autoplay: boolean;
        currentTime: number;
        customData?: object;
        // ... other properties
      }

      const DEFAULT_MEDIA_RECEIVER_APP_ID: string;

      // Define other media metadata types if you use them
      class TvShowMediaMetadata extends GenericMediaMetadata {}
      class MovieMediaMetadata extends GenericMediaMetadata {}
      class MusicTrackMediaMetadata extends GenericMediaMetadata {}
      class PhotoMediaMetadata extends GenericMediaMetadata {}

      // Define other classes/enums as needed
    }

    namespace framework {
      class CastContext {
        static getInstance(): CastContext;
        setOptions(options: CastOptions): void;
        requestSession(): Promise<void>;
        getCurrentSession(): CastSession | null;
        addEventListener(type: CastContextEventType, listener: Function): void;
        removeEventListener(type: CastContextEventType, listener: Function): void;
      }

      enum CastContextEventType {
        CAST_STATE_CHANGED = 'caststatechanged',
        SESSION_STATE_CHANGED = 'sessionstatechanged',
        // ... other events
      }

      enum CastState {
        NO_DEVICES_AVAILABLE = 'NO_DEVICES_AVAILABLE',
        NOT_CONNECTED = 'NOT_CONNECTED',
        CONNECTING = 'CONNECTING',
        CONNECTED = 'CONNECTED',
      }

      enum AutoJoinPolicy {
        TAB_AND_ORIGIN_SCOPED = 'tab_and_origin_scoped',
        ORIGIN_SCOPED = 'origin_scoped',
        PAGE_SCOPED = 'page_scoped',
      }

      interface CastOptions {
        receiverApplicationId: string;
        autoJoinPolicy?: AutoJoinPolicy;
        language?: string;
        // ... other options
      }

      class CastSession {
        getMediaSession(): MediaSession | null;
        sendMessage(namespace: string, message: string | object): Promise<void>;
        stop(): Promise<void>;
        // ... other methods
      }

      class MediaSession {
        media: media.MediaInfo;
        playerState: string; // e.g., 'PLAYING', 'PAUSED'
        currentTime: number;
        // ... other properties
      }

      // Define any other framework enums or types you interact with
    }
  }
}
