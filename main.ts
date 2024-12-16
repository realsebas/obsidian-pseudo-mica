import { Plugin } from "obsidian";
import { promisify } from "util";
import * as fs from "fs/promises";

export default class PsuedoMica extends Plugin {
  private styleEl = document.createElement("style");
  private readonly exec = promisify(require("child_process").exec);
  private lastPosition = { x: 0, y: 0, width: 0, height: 0 };
  private animationFrameId: number | null = null;
  private debounceTimeout: NodeJS.Timeout | null = null;

  private async getWallpaperPath(): Promise<string> {
    const commands = {
      win32: `powershell -command "(Get-ItemProperty -Path 'HKCU:\\Control Panel\\Desktop' -Name Wallpaper).Wallpaper"`,
      linux: {
        gnome: "gsettings get org.gnome.desktop.background picture-uri",
        kde: "kreadconfig5 --file ~/.config/plasma-org.kde.plasma.desktop-appletsrc --group Wallpaper --group org.kde.image --group General --key Image",
      },
      // darwin: `osascript -e 'tell application "System Events" to get picture of current desktop'`,
    };

    try {
      if (process.platform === "win32") {
        const { stdout } = await this.exec(commands.win32);
        return stdout.trim();
      }

      if (process.platform === "darwin") {
        const { stdout } = await this.exec(commands.darwin);
        return stdout.trim();
      }

      for (const [de, cmd] of Object.entries(commands.linux)) {
        const { stdout } = await this.exec(cmd).catch(() => ({ stdout: "" }));
        if (!stdout) continue;
        return de === "gnome" ? stdout.replace(/^'file:\/\/(.*)'$/, "$1").trim() : stdout.trim();
      }
    } catch {}
    return "";
  }

  private async setWallpaperAsBackground() {
    const wallpaperPath = await this.getWallpaperPath();
    if (!wallpaperPath) return;

    try {
      const base64Image = (await fs.readFile(wallpaperPath)).toString("base64");
      document.head.appendChild(this.styleEl);

      const updatePosition = () => {
        const {
          screenX,
          screenY,
          screen: { width, height },
        } = window;

        // Only update if position or size has changed
        if (this.lastPosition.x === screenX && this.lastPosition.y === screenY && this.lastPosition.width === width && this.lastPosition.height === height) {
          this.scheduleNextUpdate();
          return;
        }

        this.lastPosition = { x: screenX, y: screenY, width, height };
        this.styleEl.textContent = `.horizontal-main-container::before{width:${width}px;height:${height}px;top:${-screenY}px;left:${-screenX}px;background-image:url(data:image/jpeg;base64,${base64Image})}`;
        this.scheduleNextUpdate();
      };

      const debouncedResize = () => {
        if (this.debounceTimeout) {
          clearTimeout(this.debounceTimeout);
        }
        this.debounceTimeout = setTimeout(updatePosition, 100);
      };

      this.scheduleNextUpdate = () => {
        this.animationFrameId = requestAnimationFrame(updatePosition);
      };

      window.addEventListener("resize", debouncedResize);
      this.scheduleNextUpdate();

      this.register(() => {
        if (this.animationFrameId) {
          cancelAnimationFrame(this.animationFrameId);
        }
        if (this.debounceTimeout) {
          clearTimeout(this.debounceTimeout);
        }
        window.removeEventListener("resize", debouncedResize);
        this.styleEl.remove();
      });
    } catch (error) {
      console.error("Failed to set wallpaper background:", error);
    }
  }

  async onload() {
    if (process.platform !== "darwin") {
      await this.setWallpaperAsBackground();
    }

    const classes = ["hello-cupertino"];
    if (process.platform !== "darwin") {
      classes.push("is-translucent");
    } else {
      const { remote } = window.require("electron");
      const setWindowButtonPosition = () => remote.getCurrentWindow().setWindowButtonPosition({ x: 16, y: 16 });
      setWindowButtonPosition();
      window.addEventListener("resize", setWindowButtonPosition);
    }
    document.body.classList.add(...classes);
  }
}
