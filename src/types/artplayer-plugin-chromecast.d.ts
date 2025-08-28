// src/types/artplayer-plugin-chromecast.d.ts

// It's good practice to import Artplayer if your plugin uses its types
import Artplayer from 'artplayer';

// Declare the module to augment its type information
declare module 'artplayer-plugin-chromecast' {
  // Define the options interface for the Chromecast plugin
  export interface ChromecastPluginOptions {
    /**
     * The ID of the Cast receiver application.
     * Default to chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID.
     */
    receiverApplicationID?: string;

    // If the plugin has other options you use or discover, add them here.
    // Example: If it had a volume option: volume?: number;
  }

  /**
   * Artplayer Chromecast Plugin.
   * @param option The options for the Chromecast plugin.
   * @returns An Artplayer plugin function.
   */
  function Chromecast(option?: ChromecastPluginOptions): (art: Artplayer) => any;
  export default Chromecast;
}
