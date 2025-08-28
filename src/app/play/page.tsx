// app/play/page.tsx
import { Suspense, useEffect, useRef } from 'react';
import Script from 'next/script'; // Import next/script
import PlayPageClient from './PlayPageClient';

// Global declarations for Chromecast
declare global {
  interface Window {
    __onGCastApiAvailable?: (isAvailable: boolean) => void;
    cast?: any;
    chrome?: {
      cast?: any;
      media?: any; // Add media for chrome.cast.media
      [key: string]: any;
    };
  }
}

export default function PlayPage() {
  const castSDKLoadedRef = useRef(false);

  // Function to initialize Google Cast Framework
  const initCastFramework = () => {
    if (castSDKLoadedRef.current) return; // Prevent double initialization
    castSDKLoadedRef.current = true;
    console.log('Google Cast SDK script loaded and __onGCastApiAvailable called.');

    if (window.cast && window.cast.framework) {
      console.log('Initializing CastContext globally...');
      const castContext = window.cast.framework.CastContext.getInstance();
      // Ensure the receiverApplicationId matches the default media receiver
      castContext.setOptions({
        receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID, // Use the default media receiver application
        autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED, // Automatically join existing sessions for the same origin
      });
      console.log('CastContext initialized.');
      // At this point, the framework is ready, and Artplayer's plugin can find `window.cast`
    } else {
      console.warn('Cast framework not available for global initialization.');
    }
  };

  useEffect(() => {
    // Define the global callback function for Cast SDK to ensure it runs precisely when the API is ready
    if (typeof window !== 'undefined') {
      window.__onGCastApiAvailable = (isAvailable: boolean) => {
        if (isAvailable) {
          initCastFramework();
        } else {
          console.error('Google Cast API is not available.');
        }
      };
    }

    return () => {
      // Clean up the global callback if the component unmounts
      if (typeof window !== 'undefined' && window.__onGCastApiAvailable === initCastFramework) {
        delete window.__onGCastApiAvailable; // Remove the global function
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
          // This onLoad might fire before __onGCastApiAvailable depending on timing.
          // Having this ensures initCastFramework is called even if __onGCastApiAvailable somehow missed.
          if (typeof window.cast === 'undefined' || !castSDKLoadedRef.current) {
            console.log('Cast SDK onLoad fired, attempting direct initCastFramework.');
            initCastFramework();
          }
        }}
        onError={(e) => console.error('Error loading Google Cast SDK:', e)}
      />
      <PlayPageClient />
    </Suspense>
  );
}
