import { Plugin } from "obsidian";
import { promisify } from "util";
import * as fs from "fs/promises";

interface Position {
  x: number;
  y: number;
  width: number;
  height: number;
}

export default class CupertinoCompanion extends Plugin {
  private styleEl = document.createElement("style");
  private readonly exec = promisify(require("child_process").exec);
  private lastPosition: Position = { x: 0, y: 0, width: 0, height: 0 };
  private animationFrameId: number | null = null;
  private debounceTimeout: NodeJS.Timeout | null = null;

  private async getWallpaperPath(): Promise<string> {
    if (process.platform !== "win32") return "";

    try {
      const { stdout } = await this.exec(`powershell -command "(Get-ItemProperty -Path 'HKCU:\\Control Panel\\Desktop' -Name Wallpaper).Wallpaper"`);
      return stdout.trim();
    } catch {
      return "";
    }
  }

  private async setWallpaperAsBackground() {
    const wallpaperPath = await this.getWallpaperPath();
    if (!wallpaperPath) return;

    try {
      const base64Image = (await fs.readFile(wallpaperPath)).toString("base64");

      // Create and append static styles
      const staticStyles = document.createElement("style");
      staticStyles.textContent = `
        .horizontal-main-container::before {
          width: ${window.screen.width}px;
          height: ${window.screen.height}px;
          background-image: url(data:image/jpeg;base64,${base64Image});
        }
      `;
      document.head.append(this.styleEl, staticStyles);

      const updatePosition = () => {
        const { screenX, screenY } = window;

        // Skip update if position hasn't changed
        if (this.lastPosition.x === screenX && this.lastPosition.y === screenY) {
          this.scheduleNextUpdate();
          return;
        }

        this.lastPosition = {
          x: screenX,
          y: screenY,
          width: window.screen.width,
          height: window.screen.height,
        };

        this.styleEl.textContent = `
          .horizontal-main-container::before {
            transform: translate(${-screenX}px, ${-screenY}px);
          }
        `;
        this.scheduleNextUpdate();
      };

      const debouncedResize = () => {
        if (this.debounceTimeout) clearTimeout(this.debounceTimeout);
        this.debounceTimeout = setTimeout(updatePosition, 100);
      };

      this.scheduleNextUpdate = () => {
        this.animationFrameId = requestAnimationFrame(updatePosition);
      };

      window.addEventListener("resize", debouncedResize);
      this.scheduleNextUpdate();

      // Cleanup function
      this.register(() => {
        this.animationFrameId && cancelAnimationFrame(this.animationFrameId);
        this.debounceTimeout && clearTimeout(this.debounceTimeout);
        window.removeEventListener("resize", debouncedResize);
        this.styleEl.remove();
        staticStyles.remove();
      });
    } catch (error) {
      console.error("Failed to set wallpaper background:", error);
    }
  }

  async onload() {
    if (process.platform === "darwin") {
      const { remote } = window.require("electron");
      const setWindowButtonPosition = () => remote.getCurrentWindow().setWindowButtonPosition({ x: 16, y: 16 });
      setWindowButtonPosition();
      window.addEventListener("resize", setWindowButtonPosition);
      document.body.classList.add("hello-cupertino");
    } else {
      await this.setWallpaperAsBackground();
      document.body.classList.add("hello-cupertino", "is-translucent");
    }
  }
}
