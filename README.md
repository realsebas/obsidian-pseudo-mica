# Pseudo Mica for Obsidian

Add Mica-like background effect for Obsidian on Windows, using your wallpaper as the background.

IMPORTANT: This plugin is VERY resource heavy due to the implementation of the transparency effect, high CPU and battery usage are expected.

## Usage

1. **Download:** Download `main.js` and `manifest.json` from [GitHub Releases](https://github.com/aaaaalexis/obsidian-pseudo-mica/releases).
2. **Install:** Make a folder `obsidian-pseudo-mica` in your Obsidian plugins folder, then copy the downloaded files inside the new folder.
3. **Enable:** In Obsidian, go to **Settings** -> **Community plugins** and enable the "Pseudo Mica".

## For Theme Developers

The plugin performs the following actions:  
- Adds the `is-translucent` class to the `<body>`, replicating the "Translucent window" setting on macOS, which makes all panels transparent.  
- Retrieves the system desktop wallpaper and applies it as the `background-image` on `body::before`.  

Since Windows does not fully support `is-translucent`, you may need to manually adjust your theme for Pseudo Mica to function correctly.  
