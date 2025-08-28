// src/types/artplayer-plugin-chromecast.d.ts

// Since the plugin integrates with Artplayer, we need its types.
// Using a namespace import is often more robust when dealing with external modules.
import * as Artplayer from 'artplayer';

// Global augmentation for the 'Window' interface.
// This ensures `window.chrome.cast.media` is typed correctly,
// which is used to derive the `receiverApplicationID`.
interface Window {
  chrome?: {
    cast?: {
      media?: {
        // Explicitly define the type for DEFAULT_MEDIA_RECEIVER_APP_ID
        DEFAULT_MEDIA_RECEIVER_APP_ID: string;
      };
      // Allow other properties on window.chrome.cast for forward compatibility
      [key: string]: unknown; // Using 'unknown' is safer than 'any'
    };
    // Allow other properties on window.chrome
    [key: string]: unknown;
  };
}

// ======================================================================
// MAIN MODULE DECLARATION FOR artplayer-plugin-chromecast
// ======================================================================

declare module 'artplayer-plugin-chromecast' {
  // Define the exact structure for the options object passed to the Chromecast function.
  // We use a unique name `ChromecastPluginConfig` to prevent collision with generic 'Option' types.
  export interface ChromecastPluginConfig {
    /**
     * The ID of the Cast receiver application.
     * Default to chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID if not provided.
     */
    receiverApplicationID?: string;

    // IMPORTANT: Only list properties you know are supported by the plugin with their correct types.
    // Avoid `[key: string]: any;` here unless you are certain the plugin accepts arbitrary properties.
    // The previous `debug: true` error showed that not all properties are accepted,
    // so we keep this interface strict to match confirmed options.
  }

  /**
   * Defines the factory function for the Artplayer Chromecast plugin.
   * This function takes configuration options and returns the actual Artplayer plugin object.
   *
   * @param config Optional configuration object for the Chromecast plugin.
   * @returns A function that Artplayer will call with its instance `art` to initialize the plugin.
   *          This returned function itself produces the plugin object that Artplayer uses.
   */
  function Chromecast(config?: ChromecastPluginConfig): (art: Artplayer.Artplayer) => {
    // Standard Artplayer plugin properties
    name: string; // Required property for Artplayer plugins
    // Add other known lifecycle methods or properties of the plugin here if they exist.
    // E.g., mount?: (art: Artplayer.Artplayer) => void;
    //       destroy?: (art: Artplayer.Artplayer) => void;

    // Use an index signature (with 'unknown' or 'any') to allow for any other properties
    // the *actual plugin object* itself might expose, that we don't explicitly list.
    [key: string]: unknown; // Safer than 'any'
  };

  // Explicitly export this function as the default export of the module.
  export default Chromecast;
}
