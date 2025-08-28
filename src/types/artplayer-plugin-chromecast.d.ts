// src/types/artplayer-plugin-chromecast.d.ts

// Since the plugin integrates with Artplayer, we often need its types.
import Artplayer from 'artplayer';

// Declare the module to redefine its type information.
// We are effectively telling TypeScript: "This is what 'artplayer-plugin-chromecast' looks like."
declare module 'artplayer-plugin-chromecast' {
  // Define the interface for the options object that the Chromecast plugin accepts.
  // We use a specific name `ChromecastConfig` to avoid collision with any generic 'Option' type,
  // even though the error message mentions 'Option'. Our goal is to ensure *this* type is used.
  export interface ChromecastConfig {
    /**
     * The ID of the Cast receiver application.
     * Default to chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID if not provided.
     */
    receiverApplicationID?: string;

    // IMPORTANT: If you discover any other valid configuration options for the Chromecast
    // plugin (e.g., `debug: boolean`), you should add them here with their correct types.
    // As per previous discussions, the `debug` option for this plugin led to a type error,
    // so we're not including it here until confirmation it's a valid config.
    [key: string]: any; // Allows other unknown properties for flexibility, but less type-safe.
  }

  /**
   * Artplayer Chromecast Plugin factory function.
   * This function takes configuration options and returns the actual Artplayer plugin object.
   *
   * @param config Optional configuration object for the Chromecast plugin.
   * @returns An Artplayer plugin object, which Artplayer will initialize.
   *          ArtPlayer expects plugins to be structured as an object or a function that returns an object,
   *          but the `artplayer-plugin-chromecast`'s usage pattern suggests it's a function
   *          that directly returns the plugin instance.
   */
  function Chromecast(config?: ChromecastConfig): (art: Artplayer) => {
    name: string; // All Artplayer plugins usually have a 'name'
    // Add other properties that the plugin exposes if they are part of its public API,
    // otherwise, the `[key: string]: any` below handles untyped properties within the plugin object.
    [key: string]: any; // Flexible for any other properties the plugin object might have
  };

  // Re-export this function as the default export of the module.
  export default Chromecast;
}
