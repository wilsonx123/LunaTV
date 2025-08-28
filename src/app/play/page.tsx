// src/app/play/page.tsx
'use client'; // <-- THIS MUST BE THE VERY FIRST LINE OF THE FILE

/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps, no-console, @next/next/no-img-element */

import Artplayer from 'artplayer';
type ArtplayerOptions = ConstructorParameters<typeof Artplayer>[0];
import Hls from 'hls.js';
import { Heart } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import Script from 'next/script';
import { Suspense, useEffect, useRef, useState, useCallback, useMemo } from 'react';


import {
  deleteFavorite,
  deletePlayRecord,
  deleteSkipConfig,
  generateStorageKey,
  getAllPlayRecords,
  getSkipConfig,
  isFavorited,
  saveFavorite,
  savePlayRecord,
  saveSkipConfig,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { SearchResult } from '@/lib/types';
import { getVideoResolutionFromM3u8, processImageUrl } from '@/lib/utils';

import EpisodeSelector from '@/components/EpisodeSelector';
import PageLayout from '@/components/PageLayout';

// Global declarations for Chromecast and HLS extension for HTMLVideoElement
// These need to be in a place TypeScript can see them. For a single page.tsx,
// placing them directly here after 'use client' and imports is a common,
// albeit less conventional for truly global types, approach for self-contained files.
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
  interface HTMLVideoElement {
    hls?: any;
  }
}

// Wake Lock API type declaration (can stay here as it's not strictly global for the whole app)
interface WakeLockSentinel {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
  removeEventListener(type: 'release', listener: () => void): void;
}

// Chromecast Artplayer Plugin Definition
class ChromecastPlugin {
  static factory(
    pluginOptions: {
      videoTitleRef: React.MutableRefObject<string>;
      detailRef: React.MutableRefObject<SearchResult | null>;
      currentEpisodeIndexRef: React.MutableRefObject<number>;
      videoCover: string;
      isCastSDKReady: boolean; // <-- ADD THIS OPTION
    }
  ) {
    // This is the actual plugin 'scheme' function that Artplayer expects
    return (art: any) => {
      const options = pluginOptions;

      // Only proceed with full Chromecast plugin initialization if the SDK is ready
      if (!options.isCastSDKReady) {
        console.log('Artplayer Chromecast Plugin: SDK not ready, returning minimal plugin.');
        return { name: 'chromecastPlugin' }; // Return minimal plugin, don't add button yet
      }

      console.log('Artplayer Chromecast Plugin: SDK is ready. Initializing full plugin features.');

      art.on('ready', () => {
        // Double check just in case, though isCastSDKReady implies it
        if (
          window.cast &&
          window.cast.framework &&
          window.chrome &&
          window.chrome.cast &&
          window.chrome.cast.media
        ) {
          const castMedia = window.chrome.cast.media;
          const castFramework = window.cast.framework;
          const castContext = castFramework.CastContext.getInstance();

          // Add Chromecast button to Artplayer controls
          art.control.add({
            name: 'chromecast',
            position: 'right',
            html: `<svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22" class="art-icon art-control-chromecast-custom">
                        <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm0 6c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zM12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z"/>
                        </svg>`,
            tooltip: '投屏到 Chromecast',
            // Default visibility: hidden until devices are found or connected
            // Or set initial state based on current cast status later
            // style: { display: 'none' } // Optional: Hide initially
            click: async function () {
              console.log('Chromecast button clicked.');
              const currentVideoUrl = art.option.url;
              if (!currentVideoUrl) {
                art.notice.show = '没有可用的视频地址进行投屏';
                return;
              }

              try {
                await castContext.requestSession();
              } catch (error: any) {
                console.error('Error requesting Cast session:', error);
                art.notice.show = `投屏失败: ${error.message || '未知错误'}`;
              }
            },
          });

          // Helper interfaces for type safety (optional, but good practice)
          interface CastStateChangeEvent { castState: typeof castFramework.CastState; }
          interface SessionStateChangeEvent {
            session: typeof castFramework.CastSession;
            sessionState: typeof castFramework.SessionState;
            errorCode?: string; // Or specific error code enum
          }

          const handleCastStateChange = (event: CastStateChangeEvent) => {
            art.emit('cast_state_changed', event.castState);
            const castControl = art.control.get('chromecast');
            if (castControl) {
                const castState = event.castState;
                if (castState === castFramework.CastState.NO_DEVICES_AVAILABLE) {
                    castControl.$parent.style.display = 'none'; // Hide if no devices
                } else {
                    castControl.$parent.style.display = 'block'; // Show if devices available or connected
                    if (castState === castFramework.CastState.CONNECTED) {
                        castControl.tooltip = '已连接到 Chromecast';
                    } else if (castState === castFramework.CastState.CONNECTING) {
                        castControl.tooltip = '连接中...';
                    } else { // NOT_CONNECTED
                        castControl.tooltip = '投屏到 Chromecast';
                    }
                }
            }
          };

          const handleSessionStateChange = (event: SessionStateChangeEvent) => {
            if (
              event.sessionState === castFramework.SessionState.SESSION_STARTED ||
              event.sessionState === castFramework.SessionState.SESSION_RESUMED
            ) {
              const currentSession = castContext.getCurrentSession();
              if (currentSession && art.option.url) {
                const mediaStatus = currentSession.getMediaSession();
                const isMediaAlreadyLoaded = mediaStatus && mediaStatus.media && mediaStatus.media.contentId === art.option.url;

                if (!isMediaAlreadyLoaded) {
                  const mediaInfo = new castMedia.MediaInfo(
                    art.option.url,
                    'application/x-mpegurl'
                  );

                  mediaInfo.metadata = new castMedia.GenericMediaMetadata();
                  mediaInfo.metadata.title = options.videoTitleRef.current;
                  mediaInfo.metadata.subtitle = `来自 LunarTV - ${options.detailRef.current?.source_name || '未知来源'} - S${options.currentEpisodeIndexRef.current + 1}`;
                  if (options.videoCover) {
                    mediaInfo.metadata.images = [{
                      url: processImageUrl(options.videoCover),
                      height: 720, width: 1280
                    }];
                  }

                  const request = new castMedia.LoadRequest(mediaInfo);
                  request.currentTime = art.currentTime || 0;
                  request.autoplay = true;

                  currentSession.loadMedia(request)
                    .then(() => {
                      console.log('Media loaded successfully on Chromecast.');
                      art.emit('cast_session_started');
                    })
                    .catch((error: any) => {
                      console.error('Error loading media to Chromecast:', error);
                      art.notice.show = `投屏加载失败: ${error.message || '未知错误'}`;
                      currentSession.stop();
                    });
                } else {
                  console.log('Media already loaded on Chromecast, resuming session.');
                  art.emit('cast_session_started');
                }
              }
            } else if (
              event.sessionState === castFramework.SessionState.SESSION_ENDED ||
              event.sessionState === castFramework.SessionState.NO_SESSION ||
              event.sessionState === castFramework.SessionState.SESSION_START_FAILED
            ) {
              console.log('Chromecast session ended, failed, or no session.');
              art.emit('cast_session_ended');
            }
          };

          // Use `as any` if src/cast.d.ts event listener types are too general
          // or properly define event listener types in cast.d.ts
          castContext.addEventListener(
            castFramework.CastContextEventType.CAST_STATE_CHANGED,
            handleCastStateChange as any // Consider refining cast.d.ts further to remove this `as any`
          );
          castContext.addEventListener(
            castFramework.CastContextEventType.SESSION_STATE_CHANGED,
            handleSessionStateChange as any // Consider refining cast.d.ts further to remove this `as any`
          );

          // Set initial visibility and tooltip for the button
          const castControl = art.control.get('chromecast');
          if (castControl) {
              const currentCastState = castContext.getCastState();
              if (currentCastState === castFramework.CastState.NO_DEVICES_AVAILABLE) {
                  castControl.$parent.style.display = 'none';
              } else {
                  castControl.$parent.style.display = 'block';
                  if (currentCastState === castFramework.CastState.CONNECTED) {
                      castControl.tooltip = '已连接到 Chromecast';
                  } else if (currentCastState === castFramework.CastState.CONNECTING) {
                      castControl.tooltip = '连接中...';
                  } else {
                      castControl.tooltip = '投屏到 Chromecast';
                  }
              }
          }

          art.on('destroy', () => {
            castContext.removeEventListener(
              castFramework.CastContextEventType.CAST_STATE_CHANGED,
              handleCastStateChange as any
            );
            castContext.removeEventListener(
              castFramework.CastContextEventType.SESSION_STATE_CHANGED,
              handleSessionStateChange as any
            );
          });
        } else {
          console.warn('Chromecast SDK objects not found within Artplayer plugin. This should not happen if isCastSDKReady is true.');
        }
      });

      return {
        name: 'chromecastPlugin',
        // Optional: initial properties or methods for the plugin itself
      };
    };
  }
}

// The main page component
export default function PlayPage() {
  // ... (your existing refs like artContainerRef, videoTitleRef, etc.) ...
  const [isCastSDKReady, setIsCastSDKReady] = useState(false);
  const castSDKLoadedRef = useRef(false); // <-- KEEP THIS ONE (the first one)

  const initCastFramework = useCallback(() => { // <-- KEEP THIS ONE (the first one)
    // Check if the framework has *already* been initialized
    if (castSDKLoadedRef.current) return;
    castSDKLoadedRef.current = true;
    console.log('initCastFramework: Attempting to initialize Cast SDK.');

    // Ensure all necessary global objects are available
    if (window.cast && window.cast.framework && window.chrome && window.chrome.cast && window.chrome.cast.media) {
      console.log('initCastFramework: Global Cast objects detected. Initializing CastContext.');
      const castFramework = window.cast.framework;
      const castContext = castFramework.CastContext.getInstance();
      const castMedia = window.chrome.cast.media;

      castContext.setOptions({
        receiverApplicationId: castMedia.DEFAULT_MEDIA_RECEIVER_APP_ID,
        autoJoinPolicy: castFramework.AutoJoinPolicy.ORIGIN_SCOPED,
      });
      console.log('CastContext initialized.');
      setIsCastSDKReady(true); // <-- SET STATE HERE WHEN SDK IS READY
    } else {
      console.warn('initCastFramework: Cast framework not fully available (missing window.cast or window.chrome.cast.media).');
      // Potentially retry or set a state to indicate failure if needed
    }
  }, []); // Empty dependency array means this function is stable

  // This useEffect sets up the global callback for the Cast SDK. (KEEP THIS ONE)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      console.log('Setting up window.__onGCastApiAvailable...');
      window.__onGCastApiAvailable = (isAvailable: boolean) => {
        if (isAvailable) {
          console.log('__onGCastApiAvailable: Google Cast API is available.');
          initCastFramework(); // Call our memoized initialization function
        } else {
          console.error('__onGCastApiAvailable: Google Cast API is NOT available.');
          setIsCastSDKReady(false); // Make sure state reflects non-availability
        }
      };
    }
  }, [initCastFramework]); // Dependency on initCastFramework which is stable thanks to useCallback

  // --- Artplayer Options ---
  // Use useMemo to prevent unnecessary re-creations of artOptions
  const artOptions: ArtplayerOptions = useMemo(() => {
    return {
      container: artContainerRef.current!, // Must be defined
      // ... (your other Artplayer options) ...
      plugins: [
        ChromecastPlugin.factory({
            videoTitleRef: videoTitleRef,
            detailRef: detailRef,
            currentEpisodeIndexRef: currentEpisodeIndexRef,
            videoCover: videoCover,
            isCastSDKReady: isCastSDKReady, // <-- PASS THE STATE HERE
        }),
        // ... (other plugins) ...
      ],
    };
  }, [
    // List all dependencies that would cause artOptions to change
    artContainerRef, paused, playBackRate, // Example existing dependencies
    videoTitleRef, detailRef, currentEpisodeIndexRef, videoCover,
    isCastSDKReady, // <-- IMPORTANT: ARTPLAYER WILL RE-RENDER/RE-CREATE WHEN THIS CHANGES
  ]);

  // Use useEffect to manage Artplayer instance lifecycle
  useEffect(() => {
    if (artContainerRef.current) {

      // Destroy any existing Artplayer instance before creating a new one
      if (artRef.current) {
        artRef.current.destroy();
        artRef.current = null;
      }

      console.log('Creating Artplayer instance with current options...');
      const art = new Artplayer(artOptions);
      artRef.current = art;

      // ... (your existing Artplayer event listeners on `art`) ...

      return () => {
        // Cleanup when component unmounts or artOptions change
        if (artRef.current) {
          console.log('Destroying Artplayer instance.');
          artRef.current.destroy();
          artRef.current = null;
        }
      };
    }
  }, [artOptions]); // <-- IMPORTANT: RE-RUN EFFECT WHEN ARTOPTIONS CHANGE

  // -----------------------------------------------------------------------------
  // State variables
  // -----------------------------------------------------------------------------
  const [loading, setLoading] = useState(true);
  const [loadingStage, setLoadingStage] = useState<
    'searching' | 'preferring' | 'fetching' | 'ready'
  >('searching');
  const [loadingMessage, setLoadingMessage] = useState('正在搜索播放源...');
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<SearchResult | null>(null);

  // Favorited state
  const [favorited, setFavorited] = useState(false);

  // Skip intro/outro configuration
  const [skipConfig, setSkipConfig] = useState<{
    enable: boolean;
    intro_time: number;
    outro_time: number;
  }>({
    enable: false,
    intro_time: 0,
    outro_time: 0,
  });
  const skipConfigRef = useRef(skipConfig);
  // This useEffect ensures the ref always holds the latest state value
  useEffect(() => {
    skipConfigRef.current = skipConfig;
  }, [
    skipConfig,
    skipConfig.enable,
    skipConfig.intro_time,
    skipConfig.outro_time,
  ]);

  // Skip check time interval control (warning can be ignored if not actively used - it's a ref)
  const lastSkipCheckRef = useRef(0);

  // Ad block setting
  const [blockAdEnabled, setBlockAdEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const v = localStorage.getItem('enable_blockad');
      if (v !== null) return v === 'true';
    }
    return true;
  });
  const blockAdEnabledRef = useRef(blockAdEnabled);
  // This useEffect ensures the ref always holds the latest state value
  useEffect(() => {
    blockAdEnabledRef.current = blockAdEnabled;
  }, [blockAdEnabled]);

  // Video basic info
  const [videoTitle, setVideoTitle] = useState(searchParams.get('title') || '');
  const [videoYear, setVideoYear] = useState(searchParams.get('year') || '');
  const [videoCover, setVideoCover] = useState('');
  const [videoDoubanId, setVideoDoubanId] = useState(0);

  // Current source and ID
  const [currentSource, setCurrentSource] = useState(
    searchParams.get('source') || ''
  );
  const [currentId, setCurrentId] = useState(searchParams.get('id') || '');

  // Search info needed (these are typically passed as search params and don't change often)
  const [searchTitle] = useState(searchParams.get('stitle') || '');
  const [searchType] = useState(searchParams.get('stype') || '');

  // Whether optimization is needed (persists with a ref)
  const [needPrefer, setNeedPrefer] = useState(
    searchParams.get('prefer') === 'true'
  );
  const needPreferRef = useRef(needPrefer);
  // Sync latest values to refs
  useEffect(() => {
    needPreferRef.current = needPrefer;
  }, [needPrefer]);

  // Episode related
  const [currentEpisodeIndex, setCurrentEpisodeIndex] = useState(0);

  // Refs for latest values of props/state (used in callbacks or plugins that need current values)
  const currentSourceRef = useRef(currentSource);
  const currentIdRef = useRef(currentId);
  const videoTitleRef = useRef(videoTitle);
  const videoYearRef = useRef(videoYear);
  const detailRef = useRef<SearchResult | null>(detail);
  const currentEpisodeIndexRef = useRef(currentEpisodeIndex);

  // Sync latest values to refs
  useEffect(() => {
    currentSourceRef.current = currentSource;
    currentIdRef.current = currentId;
    detailRef.current = detail;
    currentEpisodeIndexRef.current = currentEpisodeIndex;
    videoTitleRef.current = videoTitle;
    videoYearRef.current = videoYear;
  }, [
    currentSource,
    currentId,
    detail,
    currentEpisodeIndex,
    videoTitle,
    videoYear,
  ]);

  // Video URL (the actual URL for the player)
  const [videoUrl, setVideoUrl] = useState('');

  // Total episodes count
  const totalEpisodes = detail?.episodes?.length || 0;

  // Persistent refs for player settings (resume time, volume, playback rate)
  const resumeTimeRef = useRef<number | null>(null);
  const lastVolumeRef = useRef<number>(0.7);
  const lastPlaybackRateRef = useRef<number>(1.0);

  // State for available sources (for the EpisodeSelector dropdown)
  const [availableSources, setAvailableSources] = useState<SearchResult[]>([]);
  const [sourceSearchLoading, setSourceSearchLoading] = useState(false);
  const [sourceSearchError, setSourceSearchError] = useState<string | null>(
    null
  );

  // Optimization and speed testing toggle
  const [optimizationEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('enableOptimization');
      if (saved !== null) {
        try {
          return JSON.parse(saved);
        } catch {
          /* ignore */
        }
      }
    }
    return true;
  });

  // Map to store precomputed video info (quality, load speed, ping) for source selection UI
  const [precomputedVideoInfo, setPrecomputedVideoInfo] = useState<
    Map<string, { quality: string; loadSpeed: string; pingTime: number }>
  >(new Map());

  // UI state for the episode selector panel
  const [isEpisodeSelectorCollapsed, setIsEpisodeSelectorCollapsed] =
    useState(false);

  // Video loading state for player (e.g., when switching sources)
  const [isVideoLoading, setIsVideoLoading] = useState(true);
  const [videoLoadingStage, setVideoLoadingStage] = useState<
    'initing' | 'sourceChanging'
  >('initing');

  // Playback record saving interval management
  const saveIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastSaveTimeRef = useRef<number>(0);

  // Artplayer instance and ref to its container DOM element
  const artPlayerRef = useRef<any>(null);
  const artRef = useRef<Artplayer | null>(null);
  const artContainerRef = useRef<HTMLDivElement | null>(null);

  // Wake Lock related
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  // Chromecast casting status
  const [isCasting, setIsCasting] = useState(false);

  // -----------------------------------------------------------------------------
  // Utility and Helper Functions
  // -----------------------------------------------------------------------------

  /**
   * Prefers the best source among available sources by testing video quality, load speed, and ping.
   * @param sources - Array of SearchResult objects.
   * @returns The best SearchResult object.
   */
  const preferBestSource = async (
    sources: SearchResult[]
  ): Promise<SearchResult> => {
    if (sources.length === 1) return sources[0];

    const batchSize = Math.ceil(sources.length / 2);
    const allResults: Array<{
      source: SearchResult;
      testResult: { quality: string; loadSpeed: string; pingTime: number };
    } | null> = [];

    for (let start = 0; start < sources.length; start += batchSize) {
      const batchSources = sources.slice(start, start + batchSize);
      const batchResults = await Promise.all(
        batchSources.map(async (source) => {
          try {
            if (!source.episodes || source.episodes.length === 0) {
              console.warn(`播放源 ${source.source_name} 没有可用的播放地址`);
              return null;
            }

            const episodeUrl =
              source.episodes.length > 1
                ? source.episodes[1]
                : source.episodes[0];
            const testResult = await getVideoResolutionFromM3u8(episodeUrl);

            return {
              source,
              testResult,
            };
          } catch (error) {
            return null;
          }
        })
      );
      allResults.push(...batchResults);
    }

    const newVideoInfoMap = new Map<
      string,
      {
        quality: string;
        loadSpeed: string;
        pingTime: number;
        hasError?: boolean;
      }
    >();
    allResults.forEach((result, index) => {
      const source = sources[index];
      const sourceKey = `${source.source}-${source.id}`;

      if (result) {
        newVideoInfoMap.set(sourceKey, result.testResult);
      }
    });

    const successfulResults = allResults.filter(Boolean) as Array<{
      source: SearchResult;
      testResult: { quality: string; loadSpeed: string; pingTime: number };
    }>;

    setPrecomputedVideoInfo(newVideoInfoMap);

    if (successfulResults.length === 0) {
      console.warn('所有播放源测速都失败，使用第一个播放源');
      return sources[0];
    }

    const validSpeeds = successfulResults
      .map((result) => {
        const speedStr = result.testResult.loadSpeed;
        if (speedStr === '未知' || speedStr === '测量中...') return 0;

        const match = speedStr.match(/^([\d.]+)\s*(KB\/s|MB\/s)$/);
        if (!match) return 0;

        const value = parseFloat(match[1]);
        const unit = match[2];
        return unit === 'MB/s' ? value * 1024 : value;
      })
      .filter((speed) => speed > 0);

    const maxSpeed = validSpeeds.length > 0 ? Math.max(...validSpeeds) : 1024;

    const validPings = successfulResults
      .map((result) => result.testResult.pingTime)
      .filter((ping) => ping > 0);

    const minPing = validPings.length > 0 ? Math.min(...validPings) : 50;
    const maxPing = validPings.length > 0 ? Math.max(...validPings) : 1000;

    const resultsWithScore = successfulResults.map((result) => ({
      ...result,
      score: calculateSourceScore(
        result.testResult,
        maxSpeed,
        minPing,
        maxPing
      ),
    }));

    resultsWithScore.sort((a, b) => b.score - a.score);

    console.log('播放源评分排序结果:');
    resultsWithScore.forEach((result, index) => {
      console.log(
        `${index + 1}. ${result.source.source_name
        } - 评分: ${result.score.toFixed(2)} (${result.testResult.quality}, ${result.testResult.loadSpeed
        }, ${result.testResult.pingTime}ms)`
      );
    });

    return resultsWithScore[0].source;
  };

  /**
   * Calculates a score for a video source based on quality, load speed, and ping.
   * @param testResult - Object containing quality, loadSpeed, and pingTime.
   * @param maxSpeed - Max observed speed for normalization.
   * @param minPing - Min observed ping for normalization.
   * @param maxPing - Max observed ping for normalization.
   * @returns A numeric score for the source.
   */
  const calculateSourceScore = (
    testResult: {
      quality: string;
      loadSpeed: string;
      pingTime: number;
    },
    maxSpeed: number,
    minPing: number,
    maxPing: number
  ): number => {
    let score = 0;

    const qualityScore = (() => {
      switch (testResult.quality) {
        case '4K':
          return 100;
        case '2K':
          return 85;
        case '1080p':
          return 75;
        case '720p':
          return 60;
        case '480p':
          return 40;
        case 'SD':
          return 20;
        default:
          return 0;
      }
    })();
    score += qualityScore * 0.4;

    const speedScore = (() => {
      const speedStr = testResult.loadSpeed;
      if (speedStr === '未知' || speedStr === '测量中...') return 30;

      const match = speedStr.match(/^([\d.]+)\s*(KB\/s|MB\/s)$/);
      if (!match) return 30;

      const value = parseFloat(match[1]);
      const unit = match[2];
      const speedKBps = unit === 'MB/s' ? value * 1024 : value;

      const speedRatio = speedKBps / maxSpeed;
      return Math.min(100, Math.max(0, speedRatio * 100));
    })();
    score += speedScore * 0.4;

    const pingScore = (() => {
      const ping = testResult.pingTime;
      if (ping <= 0) return 0;

      if (maxPing === minPing) return 100;

      const pingRatio = (maxPing - ping) / (maxPing - minPing);
      return Math.min(100, Math.max(0, pingRatio * 100));
    })();
    score += pingScore * 0.2;

    return Math.round(score * 100) / 100;
  };

  /**
   * Updates the video URL based on episode selection.
   * @param detailData - The current search result detail.
   * @param episodeIndex - The index of the selected episode.
   */
  const updateVideoUrl = (
    detailData: SearchResult | null,
    episodeIndex: number
  ) => {
    if (
      !detailData ||
      !detailData.episodes ||
      episodeIndex >= detailData.episodes.length
    ) {
      setVideoUrl('');
      return;
    }
    const newUrl = detailData?.episodes[episodeIndex] || '';
    if (newUrl !== videoUrl) {
      setVideoUrl(newUrl);
    }
  };

  /**
   * Ensures the <video> element has the correct source and enables remote playback.
   * @param video - The HTMLVideoElement.
   * @param url - The video URL.
   */
  const ensureVideoSource = (video: HTMLVideoElement | null, url: string) => {
    if (!video || !url) return;
    const sources = Array.from(video.getElementsByTagName('source'));
    const existed = sources.some((s) => s.src === url);
    if (!existed) {
      sources.forEach((s) => s.remove());
      const sourceEl = document.createElement('source');
      sourceEl.src = url;
      video.appendChild(sourceEl);
    }

    video.disableRemotePlayback = false;
    if (video.hasAttribute('disableRemotePlayback')) {
      video.removeAttribute('disableRemotePlayback');
    }
  };

  /** Requests a screen wake lock to prevent the screen from dimming/locking. */
  const requestWakeLock = async () => {
    try {
      if ('wakeLock' in navigator) {
        wakeLockRef.current = await (navigator as any).wakeLock.request(
          'screen'
        );
        console.log('Wake Lock 已启用');
      }
    } catch (err) {
      console.warn('Wake Lock 请求失败:', err);
    }
  };

  /** Releases the screen wake lock. */
  const releaseWakeLock = async () => {
    try {
      if (wakeLockRef.current) {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
        console.log('Wake Lock 已释放');
      }
    } catch (err) {
      console.warn('Wake Lock 释放失败:', err);
    }
  };

  /** Cleans up the Artplayer instance and related resources. */
  const cleanupPlayer = () => {
    if (artPlayerRef.current) {
      try {
        // If there's an active Chromecast session, stop it before destroying the local player
        if (isCasting && window.cast && window.cast.framework) {
            const castContext = window.cast.framework.CastContext.getInstance();
            const currentSession = castContext.getCurrentSession();
            if (currentSession) {
                console.log('Stopping active Chromecast session due to player cleanup.');
                currentSession.stop();
            }
        }

        // Destroy HLS.js instance if it exists
        if (artPlayerRef.current.video && artPlayerRef.current.video.hls) {
          artPlayerRef.current.video.hls.destroy();
        }

        // Destroy Artplayer instance
        artPlayerRef.current.destroy();
        artPlayerRef.current = null;

        console.log('播放器资源已清理');
      } catch (err) {
        console.warn('清理播放器资源时出错:', err);
        artPlayerRef.current = null; // Ensure ref is null even on error
      }
    }
  };

  /**
   * Filters advertisements (e.g., #EXT-X-DISCONTINUITY tags) from an M3U8 playlist.
   * @param m3u8Content - The raw M3U8 string content.
   * @returns The filtered M3U8 string content.
   */
  function filterAdsFromM3U8(m3u8Content: string): string {
    if (!m3u8Content) return '';

    const lines = m3u8Content.split('\n');
    const filteredLines = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // This is a simple ad filter: remove lines related to #EXT-X-DISCONTINUITY.
      // More sophisticated filters might be needed for different ad insertions.
      if (!line.includes('#EXT-X-DISCONTINUITY')) {
        filteredLines.push(line);
      }
    }
    return filteredLines.join('\n');
  }

  /**
   * Handles changes to the skip intro/outro configuration, saving and updating UI.
   * @param newConfig - The new skip configuration object.
   */
  const handleSkipConfigChange = async (newConfig: {
    enable: boolean;
    intro_time: number;
    outro_time: number;
  }) => {
    if (!currentSourceRef.current || !currentIdRef.current) return;

    try {
      setSkipConfig(newConfig);
      // If config is reset to default (disabled, 0 times), delete it from storage
      if (!newConfig.enable && !newConfig.intro_time && !newConfig.outro_time) {
        await deleteSkipConfig(currentSourceRef.current, currentIdRef.current);
      } else {
        await saveSkipConfig(
          currentSourceRef.current,
          currentIdRef.current,
          newConfig
        );
      }

      // Update Artplayer settings menu dynamically
      if (artPlayerRef.current) {
        artPlayerRef.current.setting.update({
          name: '跳过片头片尾',
          switch: newConfig.enable,
        });
        artPlayerRef.current.setting.update({
          name: '设置片头',
          tooltip:
            newConfig.intro_time === 0
              ? '设置片头时间'
              : `${formatTime(newConfig.intro_time)}`,
        });
        artPlayerRef.current.setting.update({
          name: '设置片尾',
          tooltip:
            newConfig.outro_time >= 0 // Outro time is negative when set from end
              ? '设置片尾时间'
              : `-${formatTime(Math.abs(newConfig.outro_time))}`,
        });
      }
      console.log('跳过片头片尾配置已保存:', newConfig);
    } catch (err) {
      console.error('保存跳过片头片尾配置失败:', err);
    }
  };

  /**
   * Formats a given number of seconds into a human-readable time string (MM:SS or HH:MM:SS).
   * @param seconds - The number of seconds.
   * @returns Formatted time string.
   */
  const formatTime = (seconds: number): string => {
    if (seconds === 0) return '00:00';

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = Math.round(seconds % 60);

    if (hours === 0) {
      return `${minutes.toString().padStart(2, '0')}:${remainingSeconds
        .toString()
        .padStart(2, '0')}`;
    } else {
      return `${hours.toString().padStart(2, '0')}:${minutes
        .toString()
        .padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
  };

  /**
   * Custom HLS.js loader to filter ads from the M3U8 manifest.
   * This class extends Hls.DefaultConfig.loader to intercept and modify manifest data.
   */
  class CustomHlsJsLoader extends Hls.DefaultConfig.loader {
    constructor(config: any) {
      super(config);
      const load = this.load.bind(this); // Store original load method
      this.load = function (context: any, config: any, callbacks: any) {
        // Only intercept manifest or level playlist type responses
        if (
          (context as any).type === 'manifest' ||
          (context as any).type === 'level'
        ) {
          const onSuccess = callbacks.onSuccess; // Store original onSuccess callback
          callbacks.onSuccess = function (
            response: any,
            stats: any,
            context: any
          ) {
            // If response data is a string (M3U8 content), filter it
            if (response.data && typeof response.data === 'string') {
              response.data = filterAdsFromM3U8(response.data);
            }
            // Call original onSuccess with potentially modified data
            return onSuccess(response, stats, context, null);
          };
        }
        // Call original load method
        load(context, config, callbacks);
      };
    }
  }

  // -----------------------------------------------------------------------------
  // Effects and Lifecycle Management
  // -----------------------------------------------------------------------------

  /** Effect to update video URL when `detail` or `currentEpisodeIndex` changes. */
  useEffect(() => {
    updateVideoUrl(detail, currentEpisodeIndex);
  }, [detail, currentEpisodeIndex]);

  /** Effect for initial data fetching (search, detail, optimization). */
  useEffect(() => {
    const fetchSourceDetail = async (
      source: string,
      id: string
    ): Promise<SearchResult[]> => {
      try {
        const detailResponse = await fetch(
          `/api/detail?source=${source}&id=${id}`
        );
        if (!detailResponse.ok) {
          throw new Error('获取视频详情失败');
        }
        const detailData = (await detailResponse.json()) as SearchResult;
        setAvailableSources([detailData]);
        return [detailData];
      } catch (err) {
        console.error('获取视频详情失败:', err);
        return [];
      } finally {
        setSourceSearchLoading(false);
      }
    };

    const fetchSourcesData = async (query: string): Promise<SearchResult[]> => {
      try {
        const response = await fetch(
          `/api/search?q=${encodeURIComponent(query.trim())}`
        );
        if (!response.ok) {
          throw new Error('搜索失败');
        }
        const data = await response.json();

        const results = data.results.filter(
          (result: SearchResult) =>
            result.title.replaceAll(' ', '').toLowerCase() ===
            videoTitleRef.current.replaceAll(' ', '').toLowerCase() &&
            (videoYearRef.current
              ? result.year.toLowerCase() === videoYearRef.current.toLowerCase()
              : true) &&
            (searchType
              ? (searchType === 'tv' && result.episodes.length > 1) ||
              (searchType === 'movie' && result.episodes.length === 1)
              : true)
        );
        setAvailableSources(results);
        return results;
      } catch (err) {
        setSourceSearchError(err instanceof Error ? err.message : '搜索失败');
        setAvailableSources([]);
        return [];
      } finally {
        setSourceSearchLoading(false);
      }
    };

    const initAll = async () => {
      if (!currentSource && !currentId && !videoTitle && !searchTitle) {
        setError('缺少必要参数');
        setLoading(false);
        return;
      }
      setLoading(true);
      setLoadingStage(currentSource && currentId ? 'fetching' : 'searching');
      setLoadingMessage(
        currentSource && currentId
          ? '🎬 正在获取视频详情...'
          : '🔍 正在搜索播放源...'
      );

      let sourcesInfo = await fetchSourcesData(searchTitle || videoTitle);
      if (
        currentSource &&
        currentId &&
        !sourcesInfo.some(
          (source) => source.source === currentSource && source.id === currentId
        )
      ) {
        sourcesInfo = await fetchSourceDetail(currentSource, currentId);
      }
      if (sourcesInfo.length === 0) {
        setError('未找到匹配结果');
        setLoading(false);
        return;
      }

      let detailData: SearchResult = sourcesInfo[0];
      if (currentSource && currentId && !needPreferRef.current) {
        const target = sourcesInfo.find(
          (source) => source.source === currentSource && source.id === currentId
        );
        if (target) {
          detailData = target;
        } else {
          setError('未找到匹配结果');
          setLoading(false);
          return;
        }
      }

      if (
        (!currentSource || !currentId || needPreferRef.current) &&
        optimizationEnabled
      ) {
        setLoadingStage('preferring');
        setLoadingMessage('⚡ 正在优选最佳播放源...');

        detailData = await preferBestSource(sourcesInfo);
      }

      console.log(detailData.source, detailData.id);

      setNeedPrefer(false);
      setCurrentSource(detailData.source);
      setCurrentId(detailData.id);
      setVideoYear(detailData.year);
      setVideoTitle(detailData.title || videoTitleRef.current);
      setVideoCover(detailData.poster);
      setVideoDoubanId(detailData.douban_id || 0);
      setDetail(detailData);
      if (currentEpisodeIndex >= detailData.episodes.length) {
        setCurrentEpisodeIndex(0);
      }

      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set('source', detailData.source);
      newUrl.searchParams.set('id', detailData.id);
      newUrl.searchParams.set('year', detailData.year);
      newUrl.searchParams.set('title', detailData.title);
      newUrl.searchParams.delete('prefer');
      window.history.replaceState({}, '', newUrl.toString());

      setLoadingStage('ready');
      setLoadingMessage('✨ 准备就绪，即将开始播放...');

      setTimeout(() => {
        setLoading(false);
      }, 1000);
    };

    initAll();
  }, [searchParams, currentSource, currentId]); // Depend on searchParams for initial load, currentSource/Id for potential updates

  /** Effect to load initial play record (resume time, episode index). */
  useEffect(() => {
    const initFromHistory = async () => {
      if (!currentSource || !currentId) return;

      try {
        const allRecords = await getAllPlayRecords();
        const key = generateStorageKey(currentSource, currentId);
        const record = allRecords[key];

        if (record) {
          const targetIndex = record.index - 1; // Convert 1-based to 0-based
          const targetTime = record.play_time;

          if (targetIndex !== currentEpisodeIndex) {
            setCurrentEpisodeIndex(targetIndex);
          }

          resumeTimeRef.current = targetTime;
        }
      } catch (err) {
        console.error('读取播放记录失败:', err);
      }
    };

    initFromHistory();
  }, [currentSource, currentId]); // Reload record if source/id changes

  /** Effect to load initial skip intro/outro configuration. */
  useEffect(() => {
    const initSkipConfig = async () => {
      if (!currentSource || !currentId) return;

      try {
        const config = await getSkipConfig(currentSource, currentId);
        if (config) {
          setSkipConfig(config);
        } else {
          setSkipConfig({ enable: false, intro_time: 0, outro_time: 0 });
        }
      } catch (err) {
        console.error('读取跳过片头片尾配置失败:', err);
      }
    };

    initSkipConfig();
  }, [currentSource, currentId]); // Reload config if source/id changes

  /**
   * Handles changing to a new video source.
   * @param newSource - The source identifier.
   * @param newId - The video ID for the new source.
   * @param newTitle - The title of the video for the new source.
   */
  const handleSourceChange = async (
    newSource: string,
    newId: string,
    newTitle: string
  ) => {
    try {
      setVideoLoadingStage('sourceChanging');
      setIsVideoLoading(true);

      const currentPlayTime = artPlayerRef.current?.currentTime || 0;
      console.log('换源前当前播放时间:', currentPlayTime);

      // Clear previous play record if exists to avoid conflicts
      if (currentSourceRef.current && currentIdRef.current) {
        try {
          await deletePlayRecord(
            currentSourceRef.current,
            currentIdRef.current
          );
          console.log('已清除前一个播放记录');
        } catch (err) {
          console.error('清除播放记录失败:', err);
        }
      }
      setSkipConfig({ enable: false, intro_time: 0, outro_time: 0 }); // Reset skip config on source change

      const newDetail = availableSources.find(
        (source) => source.source === newSource && source.id === newId
      );
      if (!newDetail) {
        setError('未找到匹配结果');
        return;
      }

      let targetIndex = currentEpisodeIndex;

      // Adjust episode index if new source has fewer episodes
      if (!newDetail.episodes || targetIndex >= newDetail.episodes.length) {
        targetIndex = 0;
      }

      // Preserve resume time if switching to same episode or if it's explicitly set.
      if (targetIndex !== currentEpisodeIndex) {
        resumeTimeRef.current = 0; // Reset resume time if episode changes
      } else if (
        (!resumeTimeRef.current || resumeTimeRef.current === 0) &&
        currentPlayTime > 1 // Only consider if player had some progress
      ) {
        resumeTimeRef.current = currentPlayTime;
      }

      // Update URL parameters without navigation
      const newUrlParams = new URLSearchParams(window.location.search);
      newUrlParams.set('source', newSource);
      newUrlParams.set('id', newId);
      newUrlParams.set('year', newDetail.year);
      newUrlParams.set('title', newDetail.title);
      window.history.replaceState({}, '', `?${newUrlParams.toString()}`);

      // Update state to trigger re-render and player initialization
      setVideoTitle(newDetail.title || newTitle);
      setVideoYear(newDetail.year);
      setVideoCover(newDetail.poster);
      setVideoDoubanId(newDetail.douban_id || 0);
      setCurrentSource(newSource);
      setCurrentId(newId);
      setDetail(newDetail);
      setCurrentEpisodeIndex(targetIndex);
    } catch (err) {
      setIsVideoLoading(false);
      setError(err instanceof Error ? err.message : '换源失败');
    }
  };

  /** Effect to attach and detach keyboard shortcuts. */
  useEffect(() => {
    document.addEventListener('keydown', handleKeyboardShortcuts);
    return () => {
      document.removeEventListener('keydown', handleKeyboardShortcuts);
    };
  }, []);

  /**
   * Handles changing to a specific episode number.
   * @param episodeNumber - The 1-based episode number.
   */
  const handleEpisodeChange = (episodeNumber: number) => {
    // Convert 1-based to 0-based index
    const newIndex = episodeNumber - 1;
    if (newIndex >= 0 && newIndex < totalEpisodes) {
      if (artPlayerRef.current) {
        saveCurrentPlayProgress(); // Save progress before changing episode
      }
      resumeTimeRef.current = 0; // Reset resume time for new episode
      setCurrentEpisodeIndex(newIndex);
    }
  };

  /** Handles playing the previous episode. */
  const handlePreviousEpisode = () => {
    const d = detailRef.current;
    const idx = currentEpisodeIndexRef.current;
    if (d && d.episodes && idx > 0) {
      if (artPlayerRef.current) {
        saveCurrentPlayProgress();
      }
      resumeTimeRef.current = 0;
      setCurrentEpisodeIndex(idx - 1);
    }
  };

  /** Handles playing the next episode. */
  const handleNextEpisode = () => {
    const d = detailRef.current;
    const idx = currentEpisodeIndexRef.current;
    if (d && d.episodes && idx < d.episodes.length - 1) {
      if (artPlayerRef.current) {
        saveCurrentPlayProgress();
      }
      resumeTimeRef.current = 0;
      setCurrentEpisodeIndex(idx + 1);
    }
  };

  /** Handles keyboard shortcuts for player control and navigation. */
  const handleKeyboardShortcuts = (e: KeyboardEvent) => {
    if (isCasting) return; // Ignore keyboard shortcuts if casting

    // Ignore if typing in an input or textarea
    if (
      (e.target as HTMLElement).tagName === 'INPUT' ||
      (e.target as HTMLElement).tagName === 'TEXTAREA'
    )
      return;

    // Alt + Left = Previous Episode
    if (e.altKey && e.key === 'ArrowLeft') {
      if (detailRef.current && currentEpisodeIndexRef.current > 0) {
        handlePreviousEpisode();
        e.preventDefault();
      }
    }

    // Alt + Right = Next Episode
    if (e.altKey && e.key === 'ArrowRight') {
      const d = detailRef.current;
      const idx = currentEpisodeIndexRef.current;
      if (d && idx < d.episodes.length - 1) {
        handleNextEpisode();
        e.preventDefault();
      }
    }

    // Left = Rewind
    if (!e.altKey && e.key === 'ArrowLeft') {
      if (artPlayerRef.current && artPlayerRef.current.currentTime > 5) {
        artPlayerRef.current.currentTime -= 10;
        e.preventDefault();
      }
    }

    // Right = Fast-forward
    if (!e.altKey && e.key === 'ArrowRight') {
      if (
        artPlayerRef.current &&
        artPlayerRef.current.currentTime < artPlayerRef.current.duration - 5
      ) {
        artPlayerRef.current.currentTime += 10;
        e.preventDefault();
      }
    }

    // Up = Volume +
    if (e.key === 'ArrowUp') {
      if (artPlayerRef.current && artPlayerRef.current.volume < 1) {
        artPlayerRef.current.volume =
          Math.round((artPlayerRef.current.volume + 0.1) * 10) / 10;
        artPlayerRef.current.notice.show = `音量: ${Math.round(
          artPlayerRef.current.volume * 100
        )}`;
        e.preventDefault();
      }
    }

    // Down = Volume -
    if (e.key === 'ArrowDown') {
      if (artPlayerRef.current && artPlayerRef.current.volume > 0) {
        artPlayerRef.current.volume =
          Math.round((artPlayerRef.current.volume - 0.1) * 10) / 10;
        artPlayerRef.current.notice.show = `音量: ${Math.round(
          artPlayerRef.current.volume * 100
        )}`;
        e.preventDefault();
      }
    }

    // Space = Play/Pause
    if (e.key === ' ') {
      if (artPlayerRef.current) {
        artPlayerRef.current.toggle();
        e.preventDefault();
      }
    }

    // f = Fullscreen
    if (e.key === 'f' || e.key === 'F') {
      if (artPlayerRef.current) {
        artPlayerRef.current.fullscreen = !artPlayerRef.current.fullscreen;
        e.preventDefault();
      }
    }
  };

  /** Saves the current play progress to IndexedDB. */
  const saveCurrentPlayProgress = async () => {
    // Only save if player exists, and necessary details are available
    if (
      !artPlayerRef.current ||
      !currentSourceRef.current ||
      !currentIdRef.current ||
      !videoTitleRef.current ||
      !detailRef.current?.source_name
    ) {
      return;
    }

    const player = artPlayerRef.current;
    const currentTime = player.currentTime || 0;
    const duration = player.duration || 0;

    // Skip saving if playback is less than 1 second or very close to the end
    if (currentTime < 1 || !duration || Math.abs(currentTime - duration) < 5) {
      return;
    }

    try {
      await savePlayRecord(currentSourceRef.current, currentIdRef.current, {
        title: videoTitleRef.current,
        source_name: detailRef.current?.source_name || '',
        year: detailRef.current?.year,
        cover: detailRef.current?.poster || '',
        index: currentEpisodeIndexRef.current + 1, // Store as 1-based
        total_episodes: detailRef.current?.episodes.length || 1,
        play_time: Math.floor(currentTime),
        total_time: Math.floor(duration),
        save_time: Date.now(),
        search_title: searchTitle,
      });

      lastSaveTimeRef.current = Date.now();
      console.log('播放进度已保存:', {
        title: videoTitleRef.current,
        episode: currentEpisodeIndexRef.current + 1,
        year: detailRef.current?.year,
        progress: `${Math.floor(currentTime)}/${Math.floor(duration)}`,
      });
    } catch (err) {
      console.error('保存播放进度失败:', err);
    }
  };

  /** Effect to handle browser/tab lifecycle events (beforeunload, visibilitychange). */
  useEffect(() => {
    const handleBeforeUnload = () => {
      saveCurrentPlayProgress();
      releaseWakeLock();
      cleanupPlayer();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        saveCurrentPlayProgress();
        releaseWakeLock();
      } else if (document.visibilityState === 'visible') {
        // Request wake lock only if not paused and not casting
        if (artPlayerRef.current && !artPlayerRef.current.paused && !isCasting) {
          requestWakeLock();
        }
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [currentEpisodeIndex, detail, isCasting]); // Dependencies to ensure latest state values are used

  /** Effect to clear the save interval ref on unmount. */
  useEffect(() => {
    return () => {
      if (saveIntervalRef.current) {
        clearInterval(saveIntervalRef.current);
      }
    };
  }, []);

  /** Effect to check initial favorited status. */
  useEffect(() => {
    if (!currentSource || !currentId) return;
    (async () => {
      try {
        const fav = await isFavorited(currentSource, currentId);
        setFavorited(fav);
      } catch (err) {
        console.error('检查收藏状态失败:', err);
      }
    })();
  }, [currentSource, currentId]);

  /** Effect to subscribe to favorite updates (e.g., from other tabs). */
  useEffect(() => {
    if (!currentSource || !currentId) return;

    const unsubscribe = subscribeToDataUpdates(
      'favoritesUpdated',
      (favorites: Record<string, any>) => {
        const key = generateStorageKey(currentSource, currentId);
        const isFav = !!favorites[key];
        setFavorited(isFav);
      }
    );

    return unsubscribe;
  }, [currentSource, currentId]);

  /** Handles toggling the favorite status of the current video. */
  const handleToggleFavorite = async () => {
    if (
      !videoTitleRef.current ||
      !detailRef.current ||
      !currentSourceRef.current ||
      !currentIdRef.current
    )
      return;

    try {
      if (favorited) {
        await deleteFavorite(currentSourceRef.current, currentIdRef.current);
        setFavorited(false);
      } else {
        await saveFavorite(currentSourceRef.current, currentIdRef.current, {
          title: videoTitleRef.current,
          source_name: detailRef.current?.source_name || '',
          year: detailRef.current?.year,
          cover: detailRef.current.poster || '', // Use detailRef.current.poster directly
          total_episodes: detailRef.current?.episodes.length || 1,
          save_time: Date.now(),
          search_title: searchTitle,
        });
        setFavorited(true);
      }
    } catch (err) {
      console.error('切换收藏失败:', err);
    }
  };

  /**
   * Main useEffect for Artplayer initialization and lifecycle.
   * This effect runs when `videoUrl`, `blockAdEnabled`, `isCasting` or other player-related states change.
   */
  useEffect(() => {
    // Prevent initialization if essential dependencies are not ready or loading
    if (
      !Artplayer ||
      !Hls ||
      !videoUrl ||
      loading ||
      currentEpisodeIndex === null || // Ensure episode index is set
      !artRef.current // Ensure container is mounted
    ) {
      return;
    }

    // Detailed error checks for valid video data
    if (
      !detail ||
      !detail.episodes ||
      currentEpisodeIndex >= detail.episodes.length ||
      currentEpisodeIndex < 0
    ) {
      setError(`选集索引无效，当前共 ${totalEpisodes} 集`);
      return;
    }

    if (!videoUrl) {
      setError('视频地址无效');
      return;
    }
    console.log(`Attempting to load video URL: ${videoUrl}`);

    // Check for Webkit-based browsers (e.g., Safari on iOS/macOS)
    // Webkit often has issues with HLS.js's source switching, sometimes requiring full re-init.
    const isWebkit =
      typeof window !== 'undefined' &&
      typeof (window as any).webkitConvertPointFromNodeToPage === 'function';

    // If currently casting, pause local player (if running) and show overlay, then exit.
    if (isCasting) {
      if (artPlayerRef.current) {
          if (!artPlayerRef.current.paused) {
            artPlayerRef.current.pause();
          }
           // Ensure the casting overlay is shown if player exists
          artPlayerRef.current.layer.show(
            `<div style="position:absolute;inset:0;background-color:rgba(0,0,0,0.8);color:white;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:20px;text-align:center;pointer-events:none;">
              <svg class="animate-spin h-10 w-10 text-white mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9.75 17L9 20l-1 1h3V10M16 18V9a2 2 0 00-2-2h-3.328c-.28 0-.55-.112-.74-.312L7 2m4.009 5.009a.75.75 0 011.06 0l3.195 3.195m-4.254-3.195a.75.75 0 00-.74-.312L7 2m1.99 4.01a.75.75 0 10-1.5 0 .75.75 0 001.5 0zM12 21.75V15m0 0l-3-1m3 1l3-1"/>
              </svg>
              正在投屏到 Chromecast...
              <div style="font-size:14px;opacity:0.8;margin-top:8px;">在 Chromecast 设备上观看。</div>
            </div>`
          );
      }
      setIsVideoLoading(false); // No local video loading if casting
      return; // Exit, as casting handles playback
    } else {
      // If not casting, ensure any casting overlay is removed
      if (artPlayerRef.current && artPlayerRef.current.layer) {
        artPlayerRef.current.layer.remove();
      }
    }

    // Logic for existing player:
    // If not Webkit and player exists and new URL is different, try to gracefully switch source.
    if (!isWebkit && artPlayerRef.current) {
        // If the URL has changed, attempt to switch the video source
        if (artPlayerRef.current.option.url !== videoUrl) {
            console.log('Artplayer: Switching video source...');
            artPlayerRef.current.switch = videoUrl;
            artPlayerRef.current.title = `${videoTitle} - 第${currentEpisodeIndex + 1}集`;
            artPlayerRef.current.poster = videoCover;
            if (artPlayerRef.current?.video) {
                ensureVideoSource(
                    artPlayerRef.current.video as HTMLVideoElement,
                    videoUrl
                ); // Ensure <source> tag is updated for direct video playback
            }
            setIsVideoLoading(false); // Hide loading since a switch should be quick
            return;
        } else {
            // URL is the same, no action needed, hide loading if it was still visible
            console.log('Artplayer: Video URL is unchanged, no switch needed.');
            setIsVideoLoading(false);
            return;
        }
    }

    // Force player re-initialization for WebKit or if no player exists
    // This part runs if it's a fresh load, a Webkit browser, or a non-graceful switch is needed.
    if (artPlayerRef.current) {
        console.log('Artplayer: Destroying existing instance for re-initialization (WebKit or new load).');
        cleanupPlayer(); // Ensure old player is fully destroyed before creating a new one
    }

    try {
      console.log('Artplayer: Initializing new instance...');
      Artplayer.PLAYBACK_RATE = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
      Artplayer.USE_RAF = true; // Use requestAnimationFrame for smooth animations

      artPlayerRef.current = new Artplayer({
        container: artRef.current,
        url: videoUrl,
        poster: videoCover,
        volume: lastVolumeRef.current, // Use last remembered volume
        isLive: false,
        muted: false,
        autoplay: true,
        pip: true, // Picture-in-Picture
        autoSize: false,
        autoMini: false,
        screenshot: false,
        setting: true,
        loop: false,
        flip: false,
        playbackRate: true,
        aspectRatio: false,
        fullscreen: true,
        fullscreenWeb: true,
        subtitleOffset: false,
        miniProgressBar: false,
        mutex: true, // Prevent multiple players from playing at once
        playsInline: true,
        autoPlayback: false,
        airplay: true, // Enable AirPlay detection
        theme: '#22c55e',
        lang: 'zh-cn',
        hotkey: false, // Let our custom handler manage hotkeys
        fastForward: true,
        autoOrientation: true,
        lock: true, // Lock screen control
        moreVideoAttr: {
          crossOrigin: 'anonymous', // Necessary for capturing frames (e.g. metadata, snapshots) from HLS
        },

        plugins: [
          // If you have other plugins without options, they go here directly as functions:
          // ArtplayerPluginHls, // Example

          // Integrate Chromecast plugin using the new factory pattern
          ChromecastPlugin.factory({ // Call factory to get the function for plugins array
              videoTitleRef: videoTitleRef,
              detailRef: detailRef,
              currentEpisodeIndexRef: currentEpisodeIndexRef,
              videoCover: videoCover,
          }),
          // If you have other plugins with options, you'll need to adapt them similarly
          // if Artplayer is consistently requiring functions directly.
        ],
        customType: {
          // Custom HLS.js handling
          m3u8: function (video: HTMLVideoElement, url: string) {
            if (!Hls) {
              console.error('HLS.js 未加载');
              return;
            }

            // Destroy existing HLS.js instance before creating a new one
            if (video.hls) {
              video.hls.destroy();
            }
            const hls = new Hls({
              debug: false,
              enableWorker: true,
              lowLatencyMode: true,
              maxBufferLength: 30,
              backBufferLength: 30,
              maxBufferSize: 60 * 1000 * 1000,
              loader: blockAdEnabledRef.current // Use custom loader if ad block is enabled
                ? CustomHlsJsLoader
                : Hls.DefaultConfig.loader,
            });

            hls.loadSource(url);
            hls.attachMedia(video);
            video.hls = hls; // Attach HLS instance to video element for easy access

            ensureVideoSource(video, url); // Ensure the source tag is correct

            hls.on(Hls.Events.ERROR, function (event: any, data: any) {
              console.error('HLS Error:', event, data);
              if (data.fatal) {
                switch (data.type) {
                  case Hls.ErrorTypes.NETWORK_ERROR:
                    console.log('网络错误，尝试恢复...');
                    hls.startLoad();
                    break;
                  case Hls.ErrorTypes.MEDIA_ERROR:
                    console.log('媒体错误，尝试恢复...');
                    hls.recoverMediaError();
                    break;
                  default:
                    console.log('无法恢复的错误');
                    hls.destroy();
                    break;
                }
              }
            });
          },
        },
        icons: {
          // Custom loading icon
          loading:
            '<img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI1MCIgaGVpZ2h0PSI1MCIgdmlld0JveD0iMCAwIDUwIDUwIj48cGF0aCBkPSJNMjUuMjUxIDYuNDYxYy0xMC4zMTggMC0xOC42NjMgOC4zODUtMTguNjYzIDE4LjY2M2g0LjA2OGMwLTguMDcgNi41NDUtMTQuNjE1IDE0LjYxNS0xNC42MTVWNi40NjF6IiBmaWxsPSIjMDA5Njg4Ij48YW5pbWF0ZVRyYW5zZm9ybSBhdHRyaWJ1dGVOYW1lPSJ0cmFuc2Zvcm0iIGatdHJpYnV0ZVR5cGU9KGNhbmNlbGxJbmZpbml0ZSkicm90YXRlIiBkdXI9IjFzIiBmcm9tPSIwIDI1IDI1IiByaWNoY2F0ZUNvdW50PSJpbmRlZmluaXRlIiB0bz0iMzYwIDI1IDI1IiB0eXBlPSJyb3RhdGUiLz48L3BhdGg+PC9zdmc+">',
        },
        settings: [
          {
            html: '去广告',
            icon: '<text x="50%" y="50%" font-size="20" font-weight="bold" text-anchor="middle" dominant-baseline="middle" fill="#ffffff">AD</text>',
            tooltip: blockAdEnabled ? '已开启' : '已关闭',
            onClick() {
              const newVal = !blockAdEnabled;
              try {
                localStorage.setItem('enable_blockad', String(newVal));
                // Force player re-initialization to apply ad-block setting change
                if (artPlayerRef.current) {
                  resumeTimeRef.current = artPlayerRef.current.currentTime;
                  if (
                    artPlayerRef.current.video &&
                    artPlayerRef.current.video.hls
                  ) {
                    artPlayerRef.current.video.hls.destroy();
                  }
                  artPlayerRef.current.destroy();
                  artPlayerRef.current = null;
                }
                setBlockAdEnabled(newVal); // Trigger re-render to re-initialize player
              } catch (_) {
                /* ignore */
              }
              return newVal ? '当前开启' : '当前关闭';
            },
          },
          {
            name: '跳过片头片尾',
            html: '跳过片头片尾',
            switch: skipConfigRef.current.enable,
            onSwitch: function (item) {
              const newConfig = {
                ...skipConfigRef.current,
                enable: !item.switch,
              };
              handleSkipConfigChange(newConfig);
              return !item.switch; // Return new switch state
            },
          },
          {
            html: '删除跳过配置',
            onClick: function () {
              handleSkipConfigChange({
                enable: false,
                intro_time: 0,
                outro_time: 0,
              });
              return ''; // No new tooltip
            },
          },
          {
            name: '设置片头',
            html: '设置片头',
            icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="12" r="2" fill="#ffffff"/><path d="M9 12L17 12" stroke="#ffffff" stroke-width="2"/><path d="M17 6L17 18" stroke="#ffffff" stroke-width="2"/></svg>',
            tooltip:
              skipConfigRef.current.intro_time === 0
                ? '设置片头时间'
                : `${formatTime(skipConfigRef.current.intro_time)}`,
            onClick: function () {
              const currentTime = artPlayerRef.current?.currentTime || 0;
              if (currentTime > 0) {
                const newConfig = {
                  ...skipConfigRef.current,
                  intro_time: currentTime,
                };
                handleSkipConfigChange(newConfig);
                return `${formatTime(currentTime)}`;
              }
            },
          },
          {
            name: '设置片尾',
            html: '设置片尾',
            icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 6L7 18" stroke="#ffffff" stroke-width="2"/><path d="M7 12L15 12" stroke="#ffffff" stroke-width="2"/><circle cx="19" cy="12" r="2" fill="#ffffff"/></svg>',
            tooltip:
              skipConfigRef.current.outro_time >= 0
                ? '设置片尾时间' // Display for unset or positive (invalid for outro)
                : `-${formatTime(Math.abs(skipConfigRef.current.outro_time))}`, // For negative values
            onClick: function () {
              const outroTime =
                -(
                  artPlayerRef.current?.duration -
                  artPlayerRef.current?.currentTime
                ) || 0;
              if (outroTime < 0) { // Only set if current time is not at the end
                const newConfig = {
                  ...skipConfigRef.current,
                  outro_time: outroTime,
                };
                handleSkipConfigChange(newConfig);
                return `-${formatTime(Math.abs(outroTime))}`;
              }
            },
          },
        ],
        controls: [
          {
            position: 'left',
            index: 13, // Position to the right of default controls
            html: '<i class="art-icon flex"><svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" fill="currentColor"/></svg></i>',
            tooltip: '播放下一集',
            click: function () {
              handleNextEpisode();
            },
          },
        ],
      });

      // Player event listeners
      artPlayerRef.current.on('ready', () => {
        setError(null);
        if (artPlayerRef.current && !artPlayerRef.current.paused && !isCasting) {
          requestWakeLock();
        }
        setIsVideoLoading(false); // Hide video loading upon player readiness (if not casting)
      });

      artPlayerRef.current.on('play', () => {
        if (!isCasting) requestWakeLock(); // Request wake lock if local payback starts
      });

      artPlayerRef.current.on('pause', () => {
        if (!isCasting) releaseWakeLock(); // Release wake lock if local playback pauses
        saveCurrentPlayProgress();
      });

      artPlayerRef.current.on('video:ended', () => {
        if (!isCasting) releaseWakeLock(); // Release wake lock if local video ends
      });

      // Initial wake lock request if autoplay is successful and not casting
      if (artPlayerRef.current && !artPlayerRef.current.paused && !isCasting) {
        requestWakeLock();
      }

      // Sync volume and playback rate changes to refs for persistence
      artPlayerRef.current.on('video:volumechange', () => {
        lastVolumeRef.current = artPlayerRef.current.volume;
      });
      artPlayerRef.current.on('video:ratechange', () => {
        lastPlaybackRateRef.current = artPlayerRef.current.playbackRate;
      });

      // Chromecast session events
      artPlayerRef.current.on('cast_session_started', () => {
        console.log('ArtPlayer instance received cast_session_started, pausing local player and showing overlay.');
        setIsCasting(true); // Update casting state
        if (artPlayerRef.current && !artPlayerRef.current.paused) {
          artPlayerRef.current.pause(); // Pause local playback
          // Show a casting overlay
          artPlayerRef.current.layer.show(
            `<div style="position:absolute;inset:0;background-color:rgba(0,0,0,0.8);color:white;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:20px;text-align:center;pointer-events:none;">
              <svg class="animate-spin h-10 w-10 text-white mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9.75 17L9 20l-1 1h3V10M16 18V9a2 2 0 00-2-2h-3.328c-.28 0-.55-.112-.74-.312L7 2m4.009 5.009a.75.75 0 011.06 0l3.195 3.195m-4.254-3.195a.75.75 0 00-.74-.312L7 2m1.99 4.01a.75.75 0 10-1.5 0 .75.75 0 001.5 0zM12 21.75V15m0 0l-3-1m3 1l3-1"/>
              </svg>
              正在投屏到 Chromecast...
              <div style="font-size:14px;opacity:0.8;margin-top:8px;">在 Chromecast 设备上观看。</div>
            </div>`
          );
        }
      });

      artPlayerRef.current.on('cast_session_ended', () => {
        console.log('ArtPlayer instance received cast_session_ended, resuming local playback.');
        setIsCasting(false); // Update casting state
        if (artPlayerRef.current) {
          if (artPlayerRef.current.layer) {
              artPlayerRef.current.layer.remove(); // Remove casting overlay
          }
          // Store current time, volume, rate to resume from if player is re-initialized (often needed after cast)
          const currentTime = artPlayerRef.current.currentTime;
          const currentVolume = artPlayerRef.current.volume;
          const currentRate = artPlayerRef.current.playbackRate;

          cleanupPlayer(); // Destroy the old player instance

          resumeTimeRef.current = currentTime; // Set resume time for new player
          lastVolumeRef.current = currentVolume;
          lastPlaybackRateRef.current = currentRate;
        }
        setIsVideoLoading(false); // Assume local playback ready to resume (or already has)
      });

      artPlayerRef.current.on('video:canplay', () => {
        if (isCasting) { // If casting, ensure local player doesn't try to play
            artPlayerRef.current.pause();
            return;
        }
        // Restore playback position if available
        if (resumeTimeRef.current && resumeTimeRef.current > 0) {
          try {
            const duration = artPlayerRef.current.duration || 0;
            let target = resumeTimeRef.current;
            // Prevent seeking past near end, which can cause issues
            if (duration && target >= duration - 2) {
              target = Math.max(0, duration - 5);
            }
            artPlayerRef.current.currentTime = target;
            console.log('成功恢复播放进度到:', resumeTimeRef.current);
          } catch (err) {
            console.warn('恢复播放进度失败:', err);
          }
        }
        resumeTimeRef.current = null; // Clear resume time after use

        // Restore volume and playback rate if they changed during player init
        setTimeout(() => {
          if (
            Math.abs(artPlayerRef.current.volume - lastVolumeRef.current) > 0.01
          ) {
            artPlayerRef.current.volume = lastVolumeRef.current;
          }
          if (
            Math.abs( // Webkit sometimes resets playback rate, needs explicit setting
              artPlayerRef.current.playbackRate - lastPlaybackRateRef.current
            ) > 0.01 &&
            isWebkit
          ) {
            artPlayerRef.current.playbackRate = lastPlaybackRateRef.current;
          }
          artPlayerRef.current.notice.show = ''; // Clear loading notice
        }, 0);

        setIsVideoLoading(false); // Hide internal video loading state
      });

      artPlayerRef.current.on('error', (err: any) => {
        console.error('播放器错误:', err);
        // Only set error if player hasn't started playing, otherwise it might be a temporary hiccup
        if (artPlayerRef.current.currentTime > 0) {
          return;
        }
        setError('视频播放错误，请尝试切换播放源');
      });

      artPlayerRef.current.on('video:ended', () => {
        if (isCasting) return; // Ignore if casting

        // Automatically play next episode if current one ends
        const d = detailRef.current;
        const idx = currentEpisodeIndexRef.current;
        if (d && d.episodes && idx < d.episodes.length - 1) {
          setTimeout(() => {
            setCurrentEpisodeIndex(idx + 1);
          }, 1000);
        }
      });

      artPlayerRef.current.on('video:timeupdate', () => {
        if (isCasting) return; // Ignore if casting

        const now = Date.now();
        let interval = 5000; // Default save interval
        if (process.env.NEXT_PUBLIC_STORAGE_TYPE === 'upstash') {
          interval = 20000; // Longer interval for Upstash to conserve reads/writes
        }
        if (now - lastSaveTimeRef.current > interval) {
          saveCurrentPlayProgress();
          lastSaveTimeRef.current = now;
        }

        // Handle skip intro/outro
        const { enable, intro_time, outro_time } = skipConfigRef.current;
        if (enable && artPlayerRef.current && artPlayerRef.current.playing) {
          const currentTime = artPlayerRef.current.currentTime;
          const duration = artPlayerRef.current.duration;

          // Skip intro
          if (intro_time > 0 && currentTime < intro_time && lastSkipCheckRef.current < intro_time) {
            artPlayerRef.current.seek = intro_time;
            artPlayerRef.current.notice.show = '跳过片头';
            lastSkipCheckRef.current = currentTime; // Update check time to prevent repeated seeks
          }

          // Skip outro
          if (outro_time < 0 && duration > 0) {
            const outroStartTime = duration + outro_time; // `outro_time` is a negative offset from end
            if (currentTime >= outroStartTime && lastSkipCheckRef.current < outroStartTime) {
              artPlayerRef.current.seek = duration; // Seek to end or next episode
              artPlayerRef.current.notice.show = '跳过片尾';
              lastSkipCheckRef.current = currentTime;
            }
          }
        }
      });

      artPlayerRef.current.on('pause', () => {
        if (isCasting) return; // Ignore if casting
        saveCurrentPlayProgress(); // Save progress on pause
      });

      // Ensure HLS.js's source handling is active if needed
      if (artPlayerRef.current?.video) {
        ensureVideoSource(
          artPlayerRef.current.video as HTMLVideoElement,
          videoUrl
        );
      }
    } catch (err) {
      console.error('创建播放器失败:', err);
      setError('播放器初始化失败');
    }

    // Cleanup function for this effect
    return () => {
      console.log('Artplayer useEffect cleanup triggered');
      cleanupPlayer();
      releaseWakeLock();
    };
  }, [
    videoUrl, // Re-initialize or switch when video URL changes
    blockAdEnabled, // Re-initialize if ad block setting changes
    isCasting, // Re-initialize or adjust if casting status changes
    // Add other critical props here that would necessitate a player re-init or deep change
    // Avoid adding things that cause excessive re-runs unless strictly necessary for player behavior
    Artplayer, Hls, loading, videoTitle, videoYear, videoCover, detail, currentEpisodeIndex, // Static dependencies for player setup
  ]);

  /** Effect to define and clean up `window.__onGCastApiAvailable`. */
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.__onGCastApiAvailable = (isAvailable: boolean) => {
        if (isAvailable) {
          console.log('__onGCastApiAvailable callback: API is available.');
          // Ensure initCastFramework is called
          initCastFramework();
        } else {
          console.error('Google Cast API is not available.');
        }
      };
      // In case the Cast SDK script loads very fast, check if it's already available
      // and initialize if it hasn't been yet by __onGCastApiAvailable directly.
      if (window.cast && window.cast.framework && !castSDKLoadedRef.current) {
        console.log('Detected cast framework already available, attempting init from useEffect.');
        initCastFramework();
      }
    }

    return () => {
      // Clean up the global callback to prevent memory leaks or calling it in wrong context
      if (typeof window !== 'undefined' && window.__onGCastApiAvailable === initCastFramework) {
        delete window.__onGCastApiAvailable; // Remove the global function
      }
    };
  }, []); // Run once on mount, clean up on unmount

  // -----------------------------------------------------------------------------
  // Render Logic (JSX)
  // -----------------------------------------------------------------------------

  if (loading) {
    return (
      <PageLayout activePath='/play'>
        <div className='flex items-center justify-center min-h-screen bg-transparent'>
          <div className='text-center max-w-md mx-auto px-6'>
            <div className='relative mb-8'>
              <div className='relative mx-auto w-24 h-24 bg-gradient-to-r from-green-500 to-emerald-600 rounded-2xl shadow-2xl flex items-center justify-center transform hover:scale-105 transition-transform duration-300'>
                <div className='text-white text-4xl'>
                  {loadingStage === 'searching' && '🔍'}
                  {loadingStage === 'preferring' && '⚡'}
                  {loadingStage === 'fetching' && '🎬'}
                  {loadingStage === 'ready' && '✨'}
                </div>
                <div className='absolute -inset-2 bg-gradient-to-r from-green-500 to-emerald-600 rounded-2xl opacity-20 animate-spin'></div>
              </div>

              <div className='absolute top-0 left-0 w-full h-full pointer-events-none'>
                <div className='absolute top-2 left-2 w-2 h-2 bg-green-400 rounded-full animate-bounce'></div>
                <div
                  className='absolute top-4 right-4 w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce'
                  style={{ animationDelay: '0.5s' }}
                ></div>
                <div
                  className='absolute bottom-3 left-6 w-1 h-1 bg-lime-400 rounded-full animate-bounce'
                  style={{ animationDelay: '1s' }}
                ></div>
              </div>
            </div>

            <div className='mb-6 w-80 mx-auto'>
              <div className='flex justify-center space-x-2 mb-4'>
                <div
                  className={`w-3 h-3 rounded-full transition-all duration-500 ${loadingStage === 'searching' || loadingStage === 'fetching'
                    ? 'bg-green-500 scale-125'
                    : loadingStage === 'preferring' ||
                      loadingStage === 'ready'
                      ? 'bg-green-500'
                      : 'bg-gray-300'
                    }`}
                ></div>
                <div
                  className={`w-3 h-3 rounded-full transition-all duration-500 ${loadingStage === 'preferring'
                    ? 'bg-green-500 scale-125'
                    : loadingStage === 'ready'
                      ? 'bg-green-500'
                      : 'bg-gray-300'
                    }`}
                ></div>
                <div
                  className={`w-3 h-3 rounded-full transition-all duration-500 ${loadingStage === 'ready'
                    ? 'bg-green-500 scale-125'
                    : 'bg-gray-300'
                    }`}
                ></div>
              </div>

              <div className='w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden'>
                <div
                  className='h-full bg-gradient-to-r from-green-500 to-emerald-600 rounded-full transition-all duration-1000 ease-out'
                  style={{
                    width:
                      loadingStage === 'searching' ||
                        loadingStage === 'fetching'
                        ? '33%'
                        : loadingStage === 'preferring'
                          ? '66%'
                          : '100%',
                  }}
                ></div>
              </div>
            </div>

            <div className='space-y-2'>
              <p className='text-xl font-semibold text-gray-800 dark:text-gray-200 animate-pulse'>
                {loadingMessage}
              </p>
            </div>
          </div>
        </div>
      </PageLayout>
    );
  }

  if (error) {
    return (
      <PageLayout activePath='/play'>
        <div className='flex items-center justify-center min-h-screen bg-transparent'>
          <div className='text-center max-w-md mx-auto px-6'>
            <div className='relative mb-8'>
              <div className='relative mx-auto w-24 h-24 bg-gradient-to-r from-red-500 to-orange-500 rounded-2xl shadow-2xl flex items-center justify-center transform hover:scale-105 transition-transform duration-300'>
                <div className='text-white text-4xl'>😵</div>
                <div className='absolute -inset-2 bg-gradient-to-r from-red-500 to-orange-500 rounded-2xl opacity-20 animate-pulse'></div>
              </div>

              <div className='absolute top-0 left-0 w-full h-full pointer-events-none'>
                <div className='absolute top-2 left-2 w-2 h-2 bg-red-400 rounded-full animate-bounce'></div>
                <div
                  className='absolute top-4 right-4 w-1.5 h-1.5 bg-orange-400 rounded-full animate-bounce'
                  style={{ animationDelay: '0.5s' }}
                ></div>
                <div
                  className='absolute bottom-3 left-6 w-1 h-1 bg-yellow-400 rounded-full animate-bounce'
                  style={{ animationDelay: '1s' }}
                ></div>
              </div>
            </div>

            <div className='space-y-4 mb-8'>
              <h2 className='text-2xl font-bold text-gray-800 dark:text-gray-200'>
                哎呀，出现了一些问题
              </h2>
              <div className='bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4'>
                <p className='text-red-600 dark:text-red-400 font-medium'>
                  {error}
                </p>
              </div>
              <p className='text-sm text-gray-500 dark:text-gray-400'>
                请检查网络连接或尝试刷新页面
              </p>
            </div>

            <div className='space-y-3'>
              <button
                onClick={() =>
                  videoTitle
                    ? router.push(`/search?q=${encodeURIComponent(videoTitle)}`)
                    : router.back()
                }
                className='w-full px-6 py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-xl font-medium hover:from-green-600 hover:to-emerald-700 transform hover:scale-105 transition-all duration-200 shadow-lg hover:shadow-xl'
              >
                {videoTitle ? '🔍 返回搜索' : '← 返回上页'}
              </button>

              <button
                onClick={() => window.location.reload()}
                className='w-full px-6 py-3 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-xl font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors duration-200'
              >
                🔄 重新尝试
              </button>
            </div>
          </div>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout activePath='/play'>
      <Suspense fallback={<div>Loading Chromecast SDK...</div>}>
         {/* Load Google Cast SDK Script */}
        <Script
            src="https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1"
            strategy="beforeInteractive" // Load this script before React hydrates to make it available early
            onLoad={() => {
              // This onLoad might fire before __onGCastApiAvailable depending on timing,
              // or __onGCastApiAvailable might have already fired.
              // This ensures initCastFramework is called if not already.
              if (window.cast && window.cast.framework && !castSDKLoadedRef.current) {
                console.log('Script onLoad fired, cast framework available, attempting direct initCastFramework.');
                initCastFramework();
              }
            }}
            onError={(e) => console.error('Error loading Google Cast SDK:', e)}
        />
        {/* Main content of the play page */}
        <div className='flex flex-col gap-3 py-4 px-5 lg:px-[3rem] 2xl:px-20'>
          <div className='py-1'>
            <h1 className='text-xl font-semibold text-gray-900 dark:text-gray-100'>
              {videoTitle || '影片标题'}
              {totalEpisodes > 1 && (
                <span className='text-gray-500 dark:text-gray-400'>
                  {` > ${detail?.episodes_titles?.[currentEpisodeIndex] || `第 ${currentEpisodeIndex + 1} 集`}`}
                </span>
              )}
            </h1>
          </div>
          <div className='space-y-2'>
            <div className='hidden lg:flex justify-end'>
              <button
                onClick={() =>
                  setIsEpisodeSelectorCollapsed(!isEpisodeSelectorCollapsed)
                }
                className='group relative flex items-center space-x-1.5 px-3 py-1.5 rounded-full bg-white/80 hover:bg-white dark:bg-gray-800/80 dark:hover:bg-gray-800 backdrop-blur-sm border border-gray-200/50 dark:border-gray-700/50 shadow-sm hover:shadow-md transition-all duration-200'
                title={
                  isEpisodeSelectorCollapsed ? '显示选集面板' : '隐藏选集面板'
                }
              >
                <svg
                  className={`w-3.5 h-3.5 text-gray-500 dark:text-gray-400 transition-transform duration-200 ${isEpisodeSelectorCollapsed ? 'rotate-180' : 'rotate-0'
                    }`}
                  fill='none'
                  stroke='currentColor'
                  viewBox='0 0 24 24'
                >
                  <path
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    strokeWidth='2'
                    d='M9 5l7 7-7 7'
                  />
                </svg>
                <span className='text-xs font-medium text-gray-600 dark:text-gray-300'>
                  {isEpisodeSelectorCollapsed ? '显示' : '隐藏'}
                </span>

                <div
                  className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full transition-all duration-200 ${isEpisodeSelectorCollapsed
                    ? 'bg-orange-400 animate-pulse'
                    : 'bg-green-400'
                    }`}
                ></div>
              </button>
            </div>

            <div
              className={`grid gap-4 lg:h-[500px] xl:h-[650px] 2xl:h-[750px] transition-all duration-300 ease-in-out ${isEpisodeSelectorCollapsed
                ? 'grid-cols-1'
                : 'grid-cols-1 md:grid-cols-4'
                }`}
            >
              <div
                className={`h-full transition-all duration-300 ease-in-out rounded-xl border border-white/0 dark:border-white/30 ${isEpisodeSelectorCollapsed ? 'col-span-1' : 'md:col-span-3'
                  }`}
              >
                <div className='relative w-full h-[300px] lg:h-full'>
                  <div
                    ref={artRef}
                    className='bg-black w-full h-full rounded-xl overflow-hidden shadow-lg'
                  ></div>

                  {isVideoLoading && (
                    <div className='absolute inset-0 bg-black/85 backdrop-blur-sm rounded-xl flex items-center justify-center z-[500] transition-all duration-300'>
                      <div className='text-center max-w-md mx-auto px-6'>
                        <div className='relative mb-8'>
                          <div className='relative mx-auto w-24 h-24 bg-gradient-to-r from-green-500 to-emerald-600 rounded-2xl shadow-2xl flex items-center justify-center transform hover:scale-105 transition-transform duration-300'>
                            <div className='text-white text-4xl'>🎬</div>
                            <div className='absolute -inset-2 bg-gradient-to-r from-green-500 to-emerald-600 rounded-2xl opacity-20 animate-spin'></div>
                          </div>

                          <div className='absolute top-0 left-0 w-full h-full pointer-events-none'>
                            <div className='absolute top-2 left-2 w-2 h-2 bg-green-400 rounded-full animate-bounce'></div>
                            <div
                              className='absolute top-4 right-4 w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce'
                              style={{ animationDelay: '0.5s' }}
                            ></div>
                            <div
                              className='absolute bottom-3 left-6 w-1 h-1 bg-lime-400 rounded-full animate-bounce'
                              style={{ animationDelay: '1s' }}
                            ></div>
                          </div>
                        </div>

                        <div className='space-y-2'>
                          <p className='text-xl font-semibold text-white animate-pulse'>
                            {videoLoadingStage === 'sourceChanging'
                              ? '🔄 切换播放源...'
                              : '🔄 视频加载中...'}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div
                className={`h-[300px] lg:h-full md:overflow-hidden transition-all duration-300 ease-in-out ${isEpisodeSelectorCollapsed
                  ? 'md:col-span-1 lg:hidden lg:opacity-0 lg:scale-95'
                  : 'md:col-span-1 lg:opacity-100 lg:scale-100'
                  }`}
              >
                <EpisodeSelector
                  totalEpisodes={totalEpisodes}
                  episodes_titles={detail?.episodes_titles || []}
                  value={currentEpisodeIndex + 1}
                  onChange={handleEpisodeChange}
                  onSourceChange={handleSourceChange}
                  currentSource={currentSource}
                  currentId={currentId}
                  videoTitle={searchTitle || videoTitle}
                  availableSources={availableSources}
                  sourceSearchLoading={sourceSearchLoading}
                  sourceSearchError={sourceSearchError}
                  precomputedVideoInfo={precomputedVideoInfo}
                />
              </div>
            </div>
          </div>

          <div className='grid grid-cols-1 md:grid-cols-4 gap-4'>
            <div className='md:col-span-3'>
              <div className='p-6 flex flex-col min-h-0'>
                <h1 className='text-3xl font-bold mb-2 tracking-wide flex items-center flex-shrink-0 text-center md:text-left w-full'>
                  {videoTitle || '影片标题'}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggleFavorite();
                    }}
                    className='ml-3 flex-shrink-0 hover:opacity-80 transition-opacity'
                  >
                    <FavoriteIcon filled={favorited} />
                  </button>
                </h1>

                <div className='flex flex-wrap items-center gap-3 text-base mb-4 opacity-80 flex-shrink-0'>
                  {detail?.class && (
                    <span className='text-green-600 font-semibold'>
                      {detail.class}
                    </span>
                  )}
                  {(detail?.year || videoYear) && (
                    <span>{detail?.year || videoYear}</span>
                  )}
                  {detail?.source_name && (
                    <span className='border border-gray-500/60 px-2 py-[1px] rounded'>
                      {detail.source_name}
                    </span>
                  )}
                  {detail?.type_name && <span>{detail.type_name}</span>}
                </div>
                {detail?.desc && (
                  <div
                    className='mt-0 text-base leading-relaxed opacity-90 overflow-y-auto pr-2 flex-1 min-h-0 scrollbar-hide'
                    style={{ whiteSpace: 'pre-line' }}
                  >
                    {detail.desc}
                  </div>
                )}
              </div>
            </div>

            <div className='hidden md:block md:col-span-1 md:order-first'>
              <div className='pl-0 py-4 pr-6'>
                <div className='relative bg-gray-300 dark:bg-gray-700 aspect-[2/3] flex items-center justify-center rounded-xl overflow-hidden'>
                  {videoCover ? (
                    <>
                      <img
                        src={processImageUrl(videoCover)}
                        alt={videoTitle}
                        className='w-full h-full object-cover'
                      />

                      {videoDoubanId !== 0 && (
                        <a
                          href={`https://movie.douban.com/subject/${videoDoubanId.toString()}`}
                          target='_blank'
                          rel='noopener noreferrer'
                          className='absolute top-3 left-3'
                        >
                          <div className='bg-green-500 text-white text-xs font-bold w-8 h-8 rounded-full flex items-center justify-center shadow-md hover:bg-green-600 hover:scale-[1.1] transition-all duration-300 ease-out'>
                            <svg
                              width='16'
                              height='16'
                              viewBox='0 0 24 24'
                              fill='none'
                              stroke='currentColor'
                              strokeWidth='2'
                              strokeLinecap='round'
                              strokeLinejoin='round'
                            >
                              <path d='M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71'></path>
                              <path d='M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'></path>
                            </svg>
                          </div>
                        </a>
                      )}
                    </>
                  ) : (
                    <span className='text-gray-600 dark:text-gray-400'>
                      封面图片
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </Suspense>
    </PageLayout>
  );
}

/**
 * A simple React component for a favorite icon, changing appearance based on 'filled' prop.
 * This is kept outside the main PlayPage component to avoid re-creation on every render,
 * improving performance slightly.
 */
const FavoriteIcon = ({ filled }: { filled: boolean }) => {
  if (filled) {
    return (
      <svg
        className='h-7 w-7'
        viewBox='0 0 24 24'
        xmlns='http://www.w3.org/2000/svg'
      >
        <path
          d='M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z'
          fill='#ef4444'
          stroke='#ef4444'
          strokeWidth='2'
          strokeLinecap='round'
          strokeLinejoin='round'
        />
      </svg>
    );
  }
  return (
    <Heart className='h-7 w-7 stroke-[1] text-gray-600 dark:text-gray-300' />
  );
};
