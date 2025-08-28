// src/types/artplayer-plugin-chromecast.d.ts

// Since the plugin integrates with Artplayer, we need its types.
// Using a namespace import can sometimes be more robust for external libraries.
import * as Artplayer from 'artplayer';

// Global augmentation for the 'Window' interface to include 'chrome.cast' if not already done.
// This is necessary because your code accesses `window.chrome.cast.media`.
// If you have already defined this elsewhere, remove this block to avoid duplicates.
interface Window {
  chrome?: {
    cast?: {
      media?: {
        DEFAULT_MEDIA_RECEIVER_APP_ID: string;
      };
      // Allow other properties on window.chrome.cast for flexibility
      [key: string]: any;
    };
    // Allow other properties on window.chrome for flexibility
    [key: string]: any;
  };
}

// Declare the 'artplayer-plugin-chromecast' module and define its types directly.
declare module 'artplayer-plugin-chromecast' {
  // This defines the exact structure for the options object passed to the Chromecast function.
  // We name it `ChromecastConfig` to avoid conflicting with any generic `Option` type.
  export interface ChromecastConfig {
    /**
     * The ID of the Cast receiver application.
     * Default to chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID if not provided.
     * Use 'string' as the type, as 'any' might reduce type safety unnecessarily here.
     */
    receiverApplicationID?: string;

    // IMPORTANT: If you discover any other valid configuration options for the Chromecast
    // plugin, you should add them here with their correct types.
    // For now, we are being strict, as an index signature `[key: string]: any;` might
    // inadvertently allow the problematic `debug: true` property again if it's not actually supported.

    // If the plugin *does* explicitly support other arbitrary options, you can add this line:
    // [key: string]: any;
  }

  // This directly defines the signature of the default export of the module.
  // It says: "The default export is a function `Chromecast` that takes an optional
  // `ChromecastConfig` object and returns another function which is the actual plugin."
  function Chromecast(config?: ChromecastConfig): (art: Artplayer.Artplayer) => {
    // The returned object is the Artplayer plugin instance itself.
    // Artplayer plugins usually have a `name` property.
    name: string;
    // They might also have lifecycle methods like `mount` and `destroy`.
    mount?: (art: Artplayer.Artplayer) => void;
    destroy?: (art: Artplayer.Artplayer) => void;

    // Use an index signature here to allow for any other properties the
    // plugin object itself might have that we don't explicitly list.
    [key: string]: any;
  };

  // Explicitly export this as the default.
  export default Chromecast;
}
