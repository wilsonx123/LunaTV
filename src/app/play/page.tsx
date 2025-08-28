// app/play/page.tsx
'use client'; // Essential for using hooks and browser APIs

import { Suspense, useEffect, useRef } from 'react';
import Script from 'next/script';
import PlayPageClient from './PlayPageClient';

// REMOVED 'declare global' block from here. It is now in src/types/cast.d.ts

export default function PlayPage() {
  const castSDKLoadedRef = useRef(false);

  const initCastFramework = () => {
    if (castSDKLoadedRef.current) return;
    castSDKLoadedRef.current = true;
    console.log('Google Cast SDK script loaded and __onGCastApiAvailable called.');

    if (window.cast && window.cast.framework) {
      console.log('Initializing CastContext globally...');
      const castContext = window.cast.framework.CastContext.getInstance();
      castContext.setOptions({
        // Use window.chrome explicitly as it's a global object
        receiverApplicationId: window.chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
        autoJoinPolicy: window.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
      });
      console.log('CastContext initialized.');
    } else {
      console.warn('Cast framework not available for global initialization.');
    }
  };

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.__onGCastApiAvailable = (isAvailable: boolean) => {
        if (isAvailable) {
          console.log('__onGCastApiAvailable callback: API is available.');
          initCastFramework();
        } else {
          console.error('Google Cast API is not available.');
        }
      };
      // Check if the script might have already loaded and called __onGCastApiAvailable
      // before this useEffect runs or if it's a fast page reload.
      if (window.cast && window.cast.framework && !castSDKLoadedRef.current) {
        console.log('Detected cast framework already available, attempting init from useEffect.');
        initCastFramework();
      }
    }

    return () => {
      // Clean up the global callback if the component unmounts
      if (typeof window !== 'undefined' && window.__onGCastApiAvailable === initCastFramework) {
        delete window.__onGCastApiAvailable;
      }
    };
  }, []); // Run once on mount

  return (
    <Suspense fallback={<div>Loading...</div>}>
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
      <PlayPageClient />
    </Suspense>
  );
}
