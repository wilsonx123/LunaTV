// src/cast.d.ts

// =========================================================
// Declarations for Google Cast SDK (minimal set)
// Refined to address ESLint and TypeScript errors/warnings.
// =========================================================

declare global {
  interface Window {
    __onGCastApiAvailable?: (isAvailable: boolean) => void;
    cast?: chrome.cast.framework.CastContext; // Made CastContext global
    chrome?: {
      cast?: chrome.cast.Cast; // This 'cast' is the main cast namespace, not the context itself
      media?: chrome.cast.media.Media; // 'media' namespace
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      [key: string]: any; // Allows other dynamic properties on 'chrome'
    };
  }

  interface HTMLVideoElement {
    hls?: import('hls.js').default;
  }

  // Chromecast Global Namespaces
  namespace chrome {
    namespace cast {
      namespace media {
        // Minimum required definitions for MediaInfo based on your usage
        class MediaInfo {
          constructor(contentId: string, contentType: string);
          contentId: string;
          contentType: string;
          metadata: GenericMediaMetadata | MusicTrackMediaMetadata | MovieMediaMetadata | TvShowMediaMetadata | PhotoMediaMetadata;
          streamType?: string;
          duration?: number;
        }

        class GenericMediaMetadata {
          metadataType: number;
          title?: string;
          subtitle?: string;
          images?: Image[];
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
        }

        const DEFAULT_MEDIA_RECEIVER_APP_ID: string;

        class TvShowMediaMetadata extends GenericMediaMetadata {}
        class MovieMediaMetadata extends GenericMediaMetadata {}
        class MusicTrackMediaMetadata extends GenericMediaMetadata {}
        class PhotoMediaMetadata extends GenericMediaMetadata {}

        // The top-level 'Cast' namespace, used for AutoJoinPolicy directly on chrome.cast
        interface Cast {
          AutoJoinPolicy: typeof framework.AutoJoinPolicy;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          [key: string]: any; // Allows other dynamic properties on 'chrome.cast'
        }
      }

      namespace framework {
        class CastContext {
          static getInstance(): CastContext;
          setOptions(options: CastOptions): void;
          requestSession(): Promise<void>;
          getCurrentSession(): CastSession | null;
          // FIX: Add eslint-disable for 'any' in event listener types
          // line 81 (approx):
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          addEventListener(type: CastContextEventType | SessionState, listener: (event: { [key: string]: any; }) => void): void;
          // line 93 (approx):
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          removeEventListener(type: CastContextEventType | SessionState, listener: (event: { [key: string]: any; }) => void): void;
        }

        enum CastContextEventType {
          CAST_STATE_CHANGED = 'caststatechanged',
          SESSION_STATE_CHANGED = 'sessionstatechanged',
        }

        enum CastState {
          NO_DEVICES_AVAILABLE = 'NO_DEVICES_AVAILABLE',
          NOT_CONNECTED = 'NOT_CONNECTED',
          CONNECTING = 'CONNECTING',
          CONNECTED = 'CONNECTED',
        }

        enum SessionState {
          NO_SESSION = 'NO_SESSION',
          SESSION_STARTING = 'SESSION_STARTING',
          SESSION_STARTED = 'SESSION_STARTED',
          SESSION_START_FAILED = 'SESSION_START_FAILED',
          SESSION_ENDING = 'SESSION_ENDING',
          SESSION_ENDED = 'SESSION_ENDED',
          SESSION_RESUMED = 'SESSION_RESUMED',
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
        }

        class CastSession {
          getMediaSession(): MediaSession | null;
          sendMessage(namespace: string, message: string | object): Promise<void>;
          stop(): Promise<void>;
        }

        class MediaSession {
          media: media.MediaInfo;
          playerState: string;
          currentTime: number;
        }

        // The top-level 'Cast' interface in the framework namespace
        interface Cast {
          CastContextEventType: typeof CastContextEventType;
          CastState: typeof CastState;
          SessionState: typeof SessionState;
          AutoJoinPolicy: typeof AutoJoinPolicy;
        }
      }
    }
  }
}
