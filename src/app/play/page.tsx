// src/app/play/page.tsx
'use client';

import { useSearchParams } from 'next/navigation';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// External Libraries
import Artplayer from 'artplayer';
import Hls from 'hls.js';
import { Heart } from 'lucide-react'; // Example icon

// Type definition for Artplayer options
type ArtplayerOptions = ConstructorParameters<typeof Artplayer>[0];

// --- In-file Mock Data, Types, and API (FOR SELF-CONTAINMENT ONLY) ---
// --- In a real app, these would be in separate files like src/lib/types.ts and src/lib/api.ts ---

// Type Definitions (normally in src/lib/types.ts)
export interface Episode {
  id: string;
  title: string;
  url: string; // The URL for the video stream
  cover: string; // The thumbnail/cover image for the episode
  index: number; // Episode index for sorting/display
  duration?: number; // Optional duration in seconds
}

export interface VideoDetail {
  id: string;
  title: string;
  description: string;
  cover: string; // Main background/poster for the series/movie
  episodes: Episode[];
  genres?: string[];
  year?: number;
  // Add other properties as needed
}

export interface WatchHistoryEntry {
  episodeId: string;
  videoId: string; // ID of the main video/series
  currentTime: number;
  duration: number; // For percentage watched calculation
  updatedAt: string; // Timestamp
}

// Mock API Functions (normally in src/lib/api.ts)
const mockVideoDetails: VideoDetail[] = [
  {
    id: 'video-123',
    title: 'Epic Adventure Series',
    description: 'A thrilling journey through ancient lands.',
    cover: '/placeholder-cover.jpg',
    genres: ['Adventure', 'Fantasy'],
    year: 2023,
    episodes: [
      { id: 'ep-1', title: 'The Beginning', url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', cover: '/ep1-cover.jpg', index: 0, duration: 1800 },
      { id: 'ep-2', title: 'Forest of Whispers', url: 'https://bitdash-a.akamaihd.net/content/sintel/hls/playlist.m3u8', cover: '/ep2-cover.jpg', index: 1, duration: 2000 },
      { id: 'ep-3', title: 'Mountain Pass', url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', cover: '/ep3-cover.jpg', index: 2, duration: 1950 },
    ],
  },
  {
    id: 'video-456',
    title: 'Cosmic Journeys',
    description: 'Explore the vastness of space.',
    cover: '/placeholder-cover2.jpg',
    episodes: [
      { id: 'ep-a', title: 'Stellar Birth', url: 'https://bitdash-a.akamaihd.net/content/sintel/hls/playlist.m3u8', cover: '/ep-a-cover.jpg', index: 0, duration: 2500 },
      { id: 'ep-b', title: 'Distant Galaxies', url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', cover: '/ep-b-cover.jpg', index: 1, duration: 2700 },
    ],
  },
];

const mockWatchHistory: { [episodeId: string]: WatchHistoryEntry } = {};

async function fetchVideoDetails(videoId: string): Promise<VideoDetail | null> {
  await new Promise(resolve => setTimeout(resolve, 500)); // Simulate network delay
  return mockVideoDetails.find(v => v.id === videoId) || null;
}

async function markWatchHistory(entry: WatchHistoryEntry): Promise<Awaited<unknown>> {
  await new Promise(resolve => setTimeout(resolve, 200)); // Simulate network delay
  mockWatchHistory[entry.episodeId] = entry;
  console.log('Watch History Updated:', entry);
  return Promise.resolve(entry);
}

async function fetchWatchHistory(episodeId: string): Promise<WatchHistoryEntry | null> {
  await new Promise(resolve => setTimeout(resolve, 200)); // Simulate network delay
  return mockWatchHistory[episodeId] || null;
}

// --- End In-file Mocks ---

// Debounce function for watch history updates
const debounce = <T extends (...args: any[]) => void>(func: T, delay: number) => {
  let timeout: NodeJS.Timeout;
  return function (this: ThisParameterType<T>, ...args: Parameters<T>) {
    const context = this;
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(context, args), delay);
  };
};

// --- Chromecast Plugin (FOR SELF-CONTAINMENT ONLY) ---
// --- In a real app, this would be in src/components/ChromecastPlugin.ts ---

// Declare chrome namespace for TypeScript
declare global {
  interface Window {
    chrome: {
      cast: typeof chrome.cast;
    };
  }
}

interface ChromecastPluginOptions {
  videoTitleRef: React.MutableRefObject<string>;
  detailRef: React.MutableRefObject<string>;
  currentEpisodeIndexRef: React.MutableRefObject<number>;
  videoCover: string;
  isCastSDKReady: boolean; // State indicating if SDK is ready
}

export class ChromecastPlugin {
  private static castPlayer: any | null = null;
  private static castSession: chrome.cast.Session | null = null;
  private static art: Artplayer; // Keep a reference to the Artplayer instance
  private static remotePlayer: cast.framework.RemotePlayer;
  private static remotePlayerController: cast.framework.RemotePlayerController;
  private static castMediaStatusInterval: NodeJS.Timeout | null = null; // To poll for media status

  private static castButton: HTMLElement | null = null; // Reference to the cast button

  private static pluginOptions: ChromecastPluginOptions;

  constructor(art: Artplayer, options: ChromecastPluginOptions) { // Changed 'Option' to 'ChromecastPluginOptions'
    ChromecastPlugin.art = art;
    ChromecastPlugin.pluginOptions = options; // Store the options

    if (ChromecastPlugin.pluginOptions.isCastSDKReady) {
        ChromecastPlugin.initializeCastButton();
    } else {
        console.warn('Chromecast SDK not ready, button will not be initialized yet.');
    }

    // React to changes in the isCastSDKReady prop
    art.on('artplayerPluginChromecast:sdkReadyChange', (isReady: boolean) => {
        console.log('ChromecastPlugin received sdkReadyChange:', isReady);
        if (isReady) {
            ChromecastPlugin.initializeCastButton();
        } else {
            console.log('Chromecast SDK became not ready or uninitialized.');
            ChromecastPlugin.cleanupCastButton();
        }
    });
  }

  // Factory function to create the plugin instance and pass props
  static factory(options: ChromecastPluginOptions) { // Use a static factory method
    return (art: Artplayer) => {
      // Pass the options to the constructor
      return new ChromecastPlugin(art, options);
    };
  }

  private static initializeCastButton() {
    if (!window.chrome || !window.chrome.cast || !cast.framework) {
        console.warn('Cast framework not fully available for button init.');
        return; // SDK not loaded
    }
    if (ChromecastPlugin.castButton && ChromecastPlugin.art.controls.right.contains(ChromecastPlugin.castButton)) {
        console.log('Chromecast button already exists, skipping re-init.');
        return; // Button already exists
    }

    try {
        const castContext = cast.framework.CastContext.getInstance();
        const controller = castContext.getCurrentSharedRemotePlayer();
        const player = new cast.framework.RemotePlayer();
        controller.setPlayer(player);

        const button = document.createElement('google-cast-launcher');
        button.style.width = '24px';
        button.style.height = '24px';
        button.style.cursor = 'pointer';
        button.title = 'Cast to a device';
        // Add some basic styling for visibility, you might want to integrate with your player's theme
        button.style.position = 'relative'; // Adjust as needed
        button.style.zIndex = '100'; // Make sure it's above other player controls
        // Add to a specific container in Artplayer, e.g., controls right
        // Artplayer will automatically hide it if no devices are found
        ChromecastPlugin.art.controls.right.appendChild(button);
        ChromecastPlugin.castButton = button; // Store reference

        console.log('Chromecast button initialized and added to Artplayer controls.');

        ChromecastPlugin.setupCastListeners();
    } catch (error) {
        console.error("Failed to initialize Chromecast button:", error);
    }
  }

  private static cleanupCastButton() {
    if (ChromecastPlugin.castButton && ChromecastPlugin.art.controls.right.contains(ChromecastPlugin.castButton)) {
      ChromecastPlugin.art.controls.right.removeChild(ChromecastPlugin.castButton);
      ChromecastPlugin.castButton = null;
      console.log('Chromecast button removed.');
    }
  }

  private static setupCastListeners() {
    const castContext = cast.framework.CastContext.getInstance();
    castContext.addEventListener(
      cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
      ChromecastPlugin.sessionStateChanged
    );
     // Initialize remote player and controller
    if (!ChromecastPlugin.remotePlayer) {
      ChromecastPlugin.remotePlayer = new cast.framework.RemotePlayer();
      ChromecastPlugin.remotePlayerController = new cast.framework.RemotePlayerController(ChromecastPlugin.remotePlayer);

      ChromecastPlugin.remotePlayerController.addEventListener(
        cast.framework.RemotePlayerEventType.IS_CONNECTED_CHANGED,
        ChromecastPlugin.onIsConnectedChanged
      );
      ChromecastPlugin.remotePlayerController.addEventListener(
        cast.framework.RemotePlayerEventType.CURRENT_TIME_CHANGED,
        ChromecastPlugin.onRemotePlayerTimeChanged
      );
      ChromecastPlugin.remotePlayerController.addEventListener(
        cast.framework.RemotePlayerEventType.IS_PAUSED_CHANGED,
        ChromecastPlugin.onRemotePlayerPausedChanged
      );
      // Add more listeners as needed for volume, ended, etc.
    }
  }

  private static sessionStateChanged = (event: cast.framework.SessionStateEvent) => {
    console.log('Cast session state changed:', event.sessionState);
    switch (event.sessionState) {
      case cast.framework.SessionState.SESSION_STARTED:
      case cast.framework.SessionState.SESSION_RESUMED:
        ChromecastPlugin.castSession = cast.framework.CastContext.getInstance().getCurrentSession();
        console.log('Cast session started/resumed:', ChromecastPlugin.castSession);
        // Inform Artplayer that casting has started
        ChromecastPlugin.art.emit('video-cast-state', true);
        ChromecastPlugin.startCasting();
        break;
      case cast.framework.SessionState.NO_SESSION:
      case cast.framework.SessionState.SESSION_ENDED:
      case cast.framework.SessionState.SESSION_START_FAILED:
        console.log('Cast session ended or failed.');
        ChromecastPlugin.castSession = null;
        // Inform Artplayer that casting has stopped
        ChromecastPlugin.art.emit('video-cast-state', false);
        ChromecastPlugin.stopCasting();
        break;
      default:
        break;
    }
  };

  private static onIsConnectedChanged = () => {
    if (ChromecastPlugin.remotePlayer.isConnected) {
      console.log('Remote player connected.');
    } else {
      console.log('Remote player disconnected.');
      ChromecastPlugin.stopCasting();
    }
  };

  private static onRemotePlayerTimeChanged = () => {
    if (ChromecastPlugin.remotePlayer.isMediaLoaded && ChromecastPlugin.remotePlayer.currentTime > 0) {
      // console.log(`Remote player time: ${ChromecastPlugin.remotePlayer.currentTime}`);
    }
  };

  private static onRemotePlayerPausedChanged = () => {
    console.log(`Remote player paused state: ${ChromecastPlugin.remotePlayer.isPaused}`);
  };

  private static startCasting() {
    if (!ChromecastPlugin.castSession || !ChromecastPlugin.art.player.url) {
      console.error('Cannot start casting: No session or no current media URL.');
      return;
    }

    const { videoTitleRef, detailRef, currentEpisodeIndexRef, videoCover } = ChromecastPlugin.pluginOptions;

    // Pause local player
    ChromecastPlugin.art.player.pause();

    const mediaInfo = new chrome.cast.media.MediaInfo(ChromecastPlugin.art.player.url, 'application/x-mpegurl'); // Or 'video/mp4' etc.
    mediaInfo.streamType = chrome.cast.media.StreamType.BUFFERED; // Assuming VOD
    mediaInfo.contentType = ChromecastPlugin.art.player.url.includes('.m3u8') ? 'application/x-mpegurl' : 'video/mp4'; // Heuristic

    mediaInfo.metadata = new chrome.cast.media.GenericMediaMetadata();
    mediaInfo.metadata.metadataType = chrome.cast.media.MetadataType.GENERIC;
    mediaInfo.metadata.title = videoTitleRef.current || 'Unknown Title';
    mediaInfo.metadata.subtitle = detailRef.current || `Episode ${currentEpisodeIndexRef.current + 1}`;
    mediaInfo.metadata.images = [{ url: videoCover }]; // Fallback needed

    const request = new chrome.cast.media.LoadRequest(mediaInfo);
    request.currentTime = ChromecastPlugin.art.player.currentTime; // Start remote playback from current local time
    request.autoplay = true;

    console.log('Loading media on cast device:', request);

    ChromecastPlugin.castSession.loadMedia(request)
      .then(() => {
        console.log('Media loaded successfully on cast device.');
        ChromecastPlugin.startPollingCastMediaStatus();
      })
      .catch((error: chrome.cast.ErrorCode) => {
        console.error('Failed to load media on cast device.', error);
        ChromecastPlugin.stopCasting(); // Stop casting state if load fails
      });
  }

  private static stopCasting() {
    if (ChromecastPlugin.castSession) {
      ChromecastPlugin.castSession.stop().then(() => {
        console.log('Cast session stopped successfully.');
      }).catch((e: chrome.cast.ErrorCode) => {
        console.error('Error stopping cast session:', e);
      });
    }
    ChromecastPlugin.clearPollingCastMediaStatus();
  }

  private static startPollingCastMediaStatus() {
    ChromecastPlugin.clearPollingCastMediaStatus();
    ChromecastPlugin.castMediaStatusInterval = setInterval(() => {
        if (ChromecastPlugin.castSession && ChromecastPlugin.castSession.media[0]) {
            const media = ChromecastPlugin.castSession.media[0];
            if (media.playerState === chrome.cast.media.PlayerState.IDLE && media.idleReason === chrome.cast.media.IdleReason.FINISHED) {
                console.log('Cast media finished playing.');
                ChromecastPlugin.stopCasting(); // Stop cast when media ends
            }
        }
    }, 1000); // Poll every second
  }

  private static clearPollingCastMediaStatus() {
    if (ChromecastPlugin.castMediaStatusInterval) {
      clearInterval(ChromecastPlugin.castMediaStatusInterval);
      ChromecastPlugin.castMediaStatusInterval = null;
    }
  }

  // Artplayer expects a destroy method for plugins
  destroy() {
    console.log('Chromecast plugin destroyed.');
    ChromecastPlugin.cleanupCastButton();
    ChromecastPlugin.clearPollingCastMediaStatus();
    // Remove all event listeners if necessary
    const castContext = cast.framework.CastContext.getInstance();
    if (castContext) {
      castContext.removeEventListener(
        cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
        ChromecastPlugin.sessionStateChanged
      );
    }
    if (ChromecastPlugin.remotePlayerController) {
      ChromecastPlugin.remotePlayerController.removeEventListener(
        cast.framework.RemotePlayerEventType.IS_CONNECTED_CHANGED,
        ChromecastPlugin.onIsConnectedChanged
      );
      ChromecastPlugin.remotePlayerController.removeEventListener(
        cast.framework.RemotePlayerEventType.CURRENT_TIME_CHANGED,
        ChromecastPlugin.onRemotePlayerTimeChanged
      );
      ChromecastPlugin.remotePlayerController.removeEventListener(
        cast.framework.RemotePlayerEventType.IS_PAUSED_CHANGED,
        ChromecastPlugin.onRemotePlayerPausedChanged
      );
    }
  }
}

// --- End Chromecast Plugin ---

// Main PlayPage component
export default function PlayPage() {
  const searchParams = useSearchParams();
  const videoId = searchParams.get('id');
  const initialEpisodeIndexParam = searchParams.get('index');

  // --- 1. State Variables & Refs (Declarations FIRST) ---
  const artRef = useRef<Artplayer | null>(null); // Ref for Artplayer instance
  const artContainerRef = useRef<HTMLDivElement | null>(null); // Ref for the player container DOM element

  // Video data state
  const [videoDetails, setVideoDetails] = useState<VideoDetail | null>(null);
  const [selectedEpisode, setSelectedEpisode] = useState<Episode | null>(null);
  const [videoUrl, setVideoUrl] = useState<string>(''); // Actual URL to be played by Artplayer
  const [videoCover, setVideoCover] = useState<string>(''); // Cover image for the current video/episode

  // Player state
  const [isHearted, setIsHearted] = useState<boolean>(false); // Example: if you have a favorite button
  const [paused, setPaused] = useState<boolean>(true);
  const [playBackRate, setPlayBackRate] = useState<number>(1);
  const lastVolumeRef = useRef<number>(1); // To maintain volume across re-renders

  // Chromecast-related states/refs
  const castSDKLoadedRef = useRef(false); // Helps prevent re-initializing cast framework
  const [isCastSDKReady, setIsCastSDKReady] = useState(false); // Indicates if window.chrome.cast is fully ready
  const [isCasting, setIsCasting] = useState<boolean>(false); // Tracks if currently casting

  // Data for Chromecast metadata (uses refs so changes don't trigger full re-renders of memoized options)
  const videoTitleRef = useRef<string>(''); // Main video/series title
  const detailRef = useRef<string>(''); // Episode subtitle/description
  const currentEpisodeIndexRef = useRef<number>(0); // Current episode index

  const playerInstanceLoadedRef = useRef(false); // To ensure Artplayer isn't initialized multiple times effectively for the same configuration

  // --- 2. Callbacks ---

  // Function to load and play a specific episode
  const playEpisode = useCallback(
    async (episode: Episode) => {
      if (!episode) return;

      console.log('Attempting to play episode:', episode);

      setVideoUrl(episode.url);
      setVideoCover(episode.cover || (videoDetails?.cover || '')); // Use episode cover, fallback to video detail cover
      setSelectedEpisode(episode);
      currentEpisodeIndexRef.current = episode.index; // Update ref for plugin

      // Update refs for Chromecast metadata
      videoTitleRef.current = videoDetails?.title || 'Unknown Title';
      detailRef.current = episode.title || `Episode ${episode.index + 1}`;

      // Try to load watch history for this episode
      const history = await fetchWatchHistory(episode.id);

      // Artplayer will automatically pick up the new URL from `artOptions`
      // We only seek AFTER the player has loaded the new media
      if (artRef.current) {
        artRef.current.once('ready', () => {
          if (artRef.current && history && history.currentTime > 0 && history.currentTime < history.duration - 5) { // Avoid seeking to very end
            artRef.current.seek = history.currentTime;
            console.log(`Resuming playback from ${history.currentTime}s`);
          } else if (artRef.current) {
             artRef.current.seek = 0; // If no history or history is invalid, start from beginning
          }
          // Ensure playback resumes if it was playing locally before changing episode
          if (!paused && !isCasting) {
             artRef.current.play();
          }
        });
      }
    },
    [videoDetails, paused, isCasting] // Dependency on videoDetails to ensure refs are updated with correct parent info
  );

  // Debounced watch history update function
  const debouncedMarkWatchHistory = useMemo(
    () =>
      debounce((episode: Episode | null, currentTime: number, duration: number) => {
        if (episode && duration > 0 && currentTime > 0 && !isCasting) { // Only record history if not casting
          const entry: WatchHistoryEntry = {
            episodeId: episode.id,
            videoId: videoId || '',
            currentTime: currentTime,
            duration: duration,
            updatedAt: new Date().toISOString(),
          };
          markWatchHistory(entry);
        }
      }, 5000), // Update every 5 seconds of playback
    [videoId, isCasting] // Recreate debounce if videoId or casting state changes
  );

  // Initial Chromecast framework initialization
  const initCastFramework = useCallback(() => {
    if (castSDKLoadedRef.current || typeof window === 'undefined' || !window.chrome?.cast) {
      if (window.chrome?.cast && !castSDKLoadedRef.current) {
         console.log('Cast SDK already loaded, running init.');
         castSDKLoadedRef.current = true;
         setIsCastSDKReady(true);
      }
      return;
    }

    if (window.chrome && window.chrome.cast) {
        console.log("Initializing Chromecast SDK...");
        const castContext = cast.framework.CastContext.getInstance();
        castContext.setOptions({
            receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
            autoJoinPolicy: chrome.cast.AutoJoinPolicy.PAGE_SCOPED,
        });

        // Listen for cast state changes
        try {
            castContext.addEventListener(
                cast.framework.CastContextEventType.CAST_STATE_CHANGED,
                (event: cast.framework.CastStateEvent) => {
                    console.log('Cast state changed:', event.castState);
                    if (event.castState !== cast.framework.CastState.NO_DEVICES_AVAILABLE) {
                        setIsCastSDKReady(true);
                    } else {
                        setIsCastSDKReady(true); // Treat as ready, just no devices currently
                    }
                }
            );
            castSDKLoadedRef.current = true; // Mark as initialized
            setIsCastSDKReady(true); // Indicate readiness immediately if SDK seems available
        } catch (error) {
            console.error("Error setting up CastContext listeners:", error);
            castSDKLoadedRef.current = false;
            setIsCastSDKReady(false);
        }

    } else {
      console.warn("window.chrome.cast not available after script load.");
    }
  }, []); // Empty dependency array means this runs once on mount

  // --- 3. Memoized Values ---

  // Artplayer Options using useMemo to prevent unnecessary re-creations
  const artOptions: ArtplayerOptions = useMemo(() => {
    // Return placeholder if container isn't ready, useEffect will re-run when it is
    if (!artContainerRef.current) {
      return { container: document.createElement('div'), url: '' } as ArtplayerOptions;
    }

    return {
      container: artContainerRef.current,
      url: videoUrl,
      autoplay: true,
      loop: false,
      playbackRate: playBackRate,
      volume: lastVolumeRef.current,

      // UI
      setting: true,
      fullscreen: true,
      pip: true, // Picture-in-picture
      miniProgressBar: true,
      autoOrientation: true,
      hotkey: true,
      muted: false,
      // more options...

      // HLS.js integration (if your URLs are HLS)
      type: 'm3u8',
      customType: {
        m3u8: (video: HTMLVideoElement, url: string) => {
          if (Hls.isSupported()) {
            const hls = new Hls({
            // HLS.js options
            // e.g., debug: true,
            });
            hls.loadSource(url);
            hls.attachMedia(video);
            if (artRef.current) {
                artRef.current.once('destroy', () => hls.destroy());
            }
          } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = url;
          } else {
            console.error('HLS is not supported in this browser.');
            artRef.current?.notice.show = 'Your browser does not support HLS.';
          }
        },
      },

      plugins: [
        ChromecastPlugin.factory({
          videoTitleRef: videoTitleRef,
          detailRef: detailRef,
          currentEpisodeIndexRef: currentEpisodeIndexRef,
          videoCover: videoCover,
          isCastSDKReady: isCastSDKReady, // Pass the readiness state to the plugin
        }),
        // ... (other plugins if you have them) ...
      ],
    };
  }, [
    artContainerRef, // Dependency for the container element
    videoUrl,
    videoTitleRef,
    detailRef,
    currentEpisodeIndexRef,
    videoCover,
    isCastSDKReady, // Crucial: Re-initializes plugin or player when SDK becomes ready
    playBackRate,
    lastVolumeRef,
  ]);

  // --- 4. Effects ---

  // Effect to handle initial video fetching and episode selection
  useEffect(() => {
    if (!videoId) {
      console.warn('No video ID provided in URL, redirecting or showing error.');
      return;
    }

    const loadVideoData = async () => {
      const details = await fetchVideoDetails(videoId);
      if (details) {
        setVideoDetails(details);
        let episodeToPlay: Episode | null = null;
        let initialIndex = parseInt(initialEpisodeIndexParam || '0', 10);

        // Ensure initialIndex is within bounds
        if (initialIndex < 0 || initialIndex >= details.episodes.length) {
          initialIndex = 0;
        }

        episodeToPlay = details.episodes[initialIndex];

        if (episodeToPlay) {
          await playEpisode(episodeToPlay);
        } else {
          console.error("No episode found to play.", details.episodes);
        }
      } else {
        console.error('Video details not found for ID:', videoId);
      }
    };

    loadVideoData();
  }, [videoId, initialEpisodeIndexParam, playEpisode]);

  // Effect for Artplayer initialization and cleanup
  useEffect(() => {
    // Only proceed if the container ref is current AND videoUrl is set
    // AND player hasn't been initialized yet for the current config
    if (artContainerRef.current && artOptions.url && !playerInstanceLoadedRef.current) {
        console.log('Condition met to initialize Artplayer.', artOptions.url);

        // Explicitly destroy existing player if it exists before creating a new one
        if (artRef.current) {
            console.log('Destroying existing Artplayer instance before re-init.');
            artRef.current.destroy();
            artRef.current = null;
            playerInstanceLoadedRef.current = false;
        }

        const art = new Artplayer(artOptions);
        artRef.current = art;
        playerInstanceLoadedRef.current = true; // Mark as loaded

        // Player Event Listeners
        art.on('ready', () => {
            console.log('Artplayer is ready!');
            // Important: Emit an event to Chromecast plugin for initial SDK readiness status
            art.emit('artplayerPluginChromecast:sdkReadyChange', isCastSDKReady);
             // If already paused locally, ensure player reflects this
            if (paused) { art.pause(); } else { art.play(); }
        });

        art.on('play', () => {
            setPaused(false);
            console.log('Video started playing.');
        });

        art.on('pause', () => {
            setPaused(true);
            console.log('Video paused.');
        });

        art.on('ended', () => {
            console.log('Video ended.');
            if (videoDetails && selectedEpisode && !isCasting) { // Only auto-advance if not casting
                const nextEpisodeIndex = selectedEpisode.index + 1;
                const nextEpisode = videoDetails.episodes.find(ep => ep.index === nextEpisodeIndex);
                if (nextEpisode) {
                    playEpisode(nextEpisode);
                } else {
                    console.log('No next episode available.');
                }
            }
        });

        art.on('timeupdate', () => {
            if (art.player.playing && selectedEpisode && !isCasting) {
                debouncedMarkWatchHistory(selectedEpisode, art.player.currentTime, art.player.duration);
            }
        });

        art.on('volume', (volume: number) => {
            lastVolumeRef.current = volume; // Update ref to persist volume without re-render
        });

        art.on('rate', (rate: number) => {
            setPlayBackRate(rate);
        });

        art.on('video-cast-state', (casting: boolean) => {
            setIsCasting(casting);
            if (casting) {
                // When casting starts, ensure local player is paused and maybe visually hidden/disabled
                if (artRef.current) {
                    artRef.current.pause(); // Pause local playback
                    // Optionally, you might hide Artplayer controls or show a casting indicator
                }
            } else {
                // When casting stops, local player can resume or be left in original state
                if (artRef.current && !paused) { // If it was playing locally before cast
                    artRef.current.play(); // Consider if it should auto-play
                }
            }
        });

        // Cleanup function for Artplayer
        return () => {
            if (artRef.current) {
                console.log('Destroying Artplayer instance during cleanup.');
                artRef.current.destroy();
                artRef.current = null;
                playerInstanceLoadedRef.current = false;
            }
        };
    } else if (artRef.current && artOptions.url !== artRef.current.player.url) {
        // If Artplayer exists and URL changes (e.g., new episode selected)
        console.log('Artplayer URL in options changed, updating existing player instance.');
        artRef.current.url = artOptions.url; // This will trigger Artplayer internal reload
        artRef.current.attr({ poster: artOptions.videoCover }); // Update poster if needed

        // If the player starts casting immediately after a URL change,
        // it might prevent the local `playEpisode` from seeking.
        // We ensure a `ready` event is there to catch seek.

        // Re-emit SDK ready state to potentially re-initialize Chromecast button if it wasn't connected
        artRef.current.emit('artplayerPluginChromecast:sdkReadyChange', isCastSDKReady);
    } else if (artRef.current && isCastSDKReady !== ((artRef.current.plugins as any).chromecast?.pluginOptions?.isCastSDKReady)) {
        // If only isCastSDKReady changes, notify the plugin
        console.log('SDK readiness changed, informing Chromecast plugin.');
        artRef.current.emit('artplayerPluginChromecast:sdkReadyChange', isCastSDKReady);
    }
  }, [
    artOptions, // artOptions changes when videoUrl, cover, SDK readiness changes
    videoDetails,
    selectedEpisode,
    playEpisode,
    debouncedMarkWatchHistory,
    isCastSDKReady, // Re-run player effect when SDK readiness changes
    paused, // To set initial paused state correctly
    isCasting, // To prevent local history updates when casting
  ]);

  // Effect to initialize Chromecast framework (runs once)
  useEffect(() => {
    // Only run if window.chrome.cast is available and not already initialized
    // The conditional check is important because window.chrome.cast might not exist immediately
    if (typeof window !== 'undefined' && window.chrome && window.chrome.cast) {
        initCastFramework();
    }
  }, [initCastFramework]);

  // --- 5. Render Logic ---
  if (!videoId) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-900 text-white">
        <p>Please provide a video ID in the URL (e.g., /play?id=video-123)</p>
      </div>
    );
  }

  if (!videoDetails) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-900 text-white">
        <p>Loading video details...</p>
      </div >
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white relative flex flex-col lg:flex-row">
      {/* Main Content Area */}
      <div className="flex-1 lg:max-w-[70vw] xl:max-w-[75vw]">
        {/* Artplayer Container */}
        <div className="w-full aspect-video bg-black" ref={artContainerRef}>
          {!videoUrl && (
            <div className="flex items-center justify-center w-full h-full text-xl text-gray-500">
              Select an episode to play.
            </div>
          )}
        </div>

        {/* Video Info Section */}
        <div className="p-4 bg-gray-800 shadow-lg">
          <h1 className="text-3xl font-bold mb-2">{videoDetails.title}</h1>
          <h2 className="text-xl text-gray-400 mb-4">
            {selectedEpisode?.title} - Episode {selectedEpisode ? selectedEpisode.index + 1 : ''}
          </h2>
          <p className="text-gray-300 mb-4">{videoDetails.description}</p>

          <div className="flex items-center space-x-4">
            <button
              onClick={() => setIsHearted(!isHearted)}
              className="p-2 rounded-full focus:outline-none focus:ring-2 focus:ring-red-500"
              aria-label="Toggle favorite"
            >
              <Heart className={isHearted ? 'fill-red-500 text-red-500' : 'text-gray-400'} size={24} />
            </button>
            <span className="text-sm text-gray-500">
                Playing at {playBackRate}x speed. {paused ? 'Paused' : 'Playing'}.
                {isCasting && <span className="ml-2 text-blue-400 font-semibold">Casting...</span>}
            </span>
          </div>
        </div>
      </div>

      {/* Sidebar for Episode List */}
      <aside className="w-full lg:w-[30vw] xl:w-[25vw] p-4 bg-gray-800 lg:overflow-y-auto lg:h-screen lg:sticky lg:top-0">
        <h3 className="text-2xl font-semibold mb-4 border-b border-gray-700 pb-2">Episodes</h3>
        <ul className="space-y-2">
          {videoDetails.episodes.map(episode => (
            <li key={episode.id}>
              <button
                onClick={() => playEpisode(episode)}
                className={`w-full text-left p-3 rounded-lg transition-colors duration-200
                  ${selectedEpisode?.id === episode.id ? 'bg-indigo-600 text-white shadow-md' : 'bg-gray-700 hover:bg-gray-600 text-gray-200'}`}
              >
                <span className="font-medium mr-2">Episode {episode.index + 1}:</span>
                <span className="block lg:inline">{episode.title}</span>
                {episode.duration && (
                  <span className="text-sm text-gray-400 ml-2">({Math.floor(episode.duration / 60)} min)</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
