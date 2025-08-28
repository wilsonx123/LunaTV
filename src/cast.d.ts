// src/cast.d.ts

// =========================================================
// Declarations for Google Cast SDK (minimal set)
// Refined to address ESLint and TypeScript errors/warnings.
// =========================================================

declare global {
  interface Window {
    __onGCastApiAvailable?: (isAvailable: boolean) => void;
    // Making 'cast' and 'chrome' properties optional, as they might not be present until SDK fully loads.
    // They are checked at runtime in page.tsx, so TypeScript should allow this at declaration.
    cast?: cast.framework.CastContext;
    chrome?: {
      cast?: cast.framework.Cast; // This 'cast' is the main cast namespace, not the context itself
      media?: cast.media.Media;
      // line 16 (approx): Using eslint-disable to allow 'any' for other unknown chrome properties
      // This is often necessary for global objects that other browser extensions might attach to.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      [key: string]: any;
    };
  }

  // If Hls.js is used directly on the video element, this is helpful
  interface HTMLVideoElement {
    hls?: import('hls.js').default;
  }

  // Chromecast Global Namespaces
  // These are usually available globally once the SDK loads.
  namespace chrome {
    namespace cast {
      namespace media {
        // Minimum required definitions for MediaInfo based on your usage
        class MediaInfo {
          constructor(contentId: string, contentType: string);
          contentId: string;
          contentType: string;
          metadata: GenericMediaMetadata | MusicTrackMediaMetadata | MovieMediaMetadata | TvShowMediaMetadata | PhotoMediaMetadata;
          streamType?: string; // e.g., 'BUFFERED', 'LIVE'
          duration?: number;
          // Add other properties you use from MediaInfo if needed, e.g., customData, textTracks
        }

        class GenericMediaMetadata {
          metadataType: number; // For GenericMediaMetadata, this is usually 0
          title?: string;
          subtitle?: string;
          images?: Image[];
          // Add other properties you use from GenericMediaMetadata
        }

        class Image {
          url: string;
          width?: number;
          height?: number;
          // Add other properties you use from Image
        }

        class LoadRequest {
          constructor(mediaInfo: MediaInfo);
          mediaInfo: MediaInfo;
          autoplay: boolean;
          currentTime: number;
          // Add other properties you use from LoadRequest, e.g., customData
        }

        const DEFAULT_MEDIA_RECEIVER_APP_ID: string;

        // More specific metadata types if you use them, inheriting from GenericMediaMetadata
        class TvShowMediaMetadata extends GenericMediaMetadata {}
        class MovieMediaMetadata extends GenericMediaMetadata {}
        class MusicTrackMediaMetadata extends GenericMediaMetadata {}
        class PhotoMediaMetadata extends GenericMediaMetadata {}

        // The top-level 'Cast' namespace might represent the overall Cast object
        // This is often implicitly typed by the window.cast?: cast.framework.CastContext line
        // but explicit declaration helps if you reference chrome.cast directly for e.g. AutoJoinPolicy
        interface Cast {
          AutoJoinPolicy: typeof framework.AutoJoinPolicy; // Reference the enum from framework namespace
          [key: string]: any; // Allow other properties if extensions exist
        }
      }

      namespace framework {
        class CastContext {
          static getInstance(): CastContext;
          setOptions(options: CastOptions): void;
          requestSession(): Promise<void>;
          getCurrentSession(): CastSession | null;
          // FIX: Use a more specific function type instead of 'Function'
          // The actual event object contains properties like 'castState' or 'sessionState'
          addEventListener(type: CastContextEventType, listener: (event: { [key: string]: any; }) => void): void;
          removeEventListener(type: CastContextEventType, listener: (event: { [key: string]: any; }) => void): void;
        }

        enum CastContextEventType {
          CAST_STATE_CHANGED = 'caststatechanged',
          SESSION_STATE_CHANGED = 'sessionstatechanged',
          // Add other event types if you use them
        }

        enum CastState {
          NO_DEVICES_AVAILABLE = 'NO_DEVICES_AVAILABLE',
          NOT_CONNECTED = 'NOT_CONNECTED',
          CONNECTING = 'CONNECTING',
          CONNECTED = 'CONNECTED',
        }

        // FIX: Define SessionState enum
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
          // Add other options you use
        }

        class CastSession {
          getMediaSession(): MediaSession | null;
          sendMessage(namespace: string, message: string | object): Promise<void>;
          stop(): Promise<void>;
          // Add other methods you use from CastSession
        }

        class MediaSession {
          media: media.MediaInfo;
          playerState: string; // e.g., 'PLAYING', 'PAUSED' - could be more specific with MediaStatus.PlayerState
          currentTime: number;
          // Add other properties you use from MediaSession
        }

        // The top-level 'Cast' interface in the framework namespace
        // This is where you'd reference enums like CastState, SessionState, AutoJoinPolicy
        interface Cast {
          CastContextEventType: typeof CastContextEventType;
          CastState: typeof CastState;
          SessionState: typeof SessionState;
          AutoJoinPolicy: typeof AutoJoinPolicy;
          // Add other global Cast framework properties/classes if needed
        }
      }
    }
  }
}
