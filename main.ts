import { Plugin, Platform, PluginSettingTab, App, Setting } from "obsidian";
import { promisify } from "util";
import * as fs from "fs/promises";

interface Position {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Define settings interface
interface PseudoMicaSettings {
  blurSize: number;
}

// Define default settings
const DEFAULT_SETTINGS: PseudoMicaSettings = {
  blurSize: 240,
};

type EdgeParams = [number, number, number, number, number, number, number, number];

// Modify function to accept blurSize
async function processWallpaperImage(imagePath: string, targetWidth: number, targetHeight: number, blurSize: number): Promise<string> {
  const BLUR_SIZE = blurSize;
  const BLUR_PASSES = 3;

  // Create all canvases upfront
  const workCanvas = document.createElement("canvas");
  const workCtx = workCanvas.getContext("2d", { alpha: false })!;

  // Load and process image
  const imageData = await fs.readFile(imagePath);
  const img = await new Promise<HTMLImageElement>((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.src = URL.createObjectURL(new Blob([imageData]));
  });

  // Set dimensions once
  workCanvas.width = img.width + BLUR_SIZE * 2;
  workCanvas.height = img.height + BLUR_SIZE * 2;

  // Optimize rendering
  workCtx.imageSmoothingQuality = "high";

  // Draw and extend image in one pass
  workCtx.drawImage(img, BLUR_SIZE, BLUR_SIZE);

  // Extend edges more efficiently
  const edges: EdgeParams[] = [
    [BLUR_SIZE, BLUR_SIZE, img.width, 1, BLUR_SIZE, 0, img.width, BLUR_SIZE],
    [BLUR_SIZE, img.height + BLUR_SIZE - 1, img.width, 1, BLUR_SIZE, img.height + BLUR_SIZE, img.width, BLUR_SIZE],
    [BLUR_SIZE, BLUR_SIZE, 1, img.height, 0, BLUR_SIZE, BLUR_SIZE, img.height],
    [img.width + BLUR_SIZE - 1, BLUR_SIZE, 1, img.height, img.width + BLUR_SIZE, BLUR_SIZE, BLUR_SIZE, img.height],
  ];

  edges.forEach((params) => workCtx.drawImage(workCanvas, ...params));

  // Corners in one pass
  const corner = workCtx.getImageData(BLUR_SIZE, BLUR_SIZE, 1, 1);
  const cornerPositions = [
    [0, 0],
    [img.width + BLUR_SIZE, 0],
    [0, img.height + BLUR_SIZE],
    [img.width + BLUR_SIZE, img.height + BLUR_SIZE],
  ];

  cornerPositions.forEach(([x, y]) => workCtx.putImageData(corner, x, y));

  // Optimized blur
  const blurSizeAdjusted = BLUR_SIZE / Math.sqrt(3);
  workCtx.filter = `blur(${blurSizeAdjusted}px)`;
  for (let i = 0; i < BLUR_PASSES; i++) {
    workCtx.drawImage(workCanvas, 0, 0);
  }

  // Final scaling in one step
  const finalCanvas = document.createElement("canvas");
  finalCanvas.width = targetWidth;
  finalCanvas.height = targetHeight;
  const finalCtx = finalCanvas.getContext("2d", { alpha: false })!;
  finalCtx.drawImage(workCanvas, BLUR_SIZE, BLUR_SIZE, img.width, img.height, 0, 0, targetWidth, targetHeight);

  URL.revokeObjectURL(img.src);
  return finalCanvas.toDataURL("image/jpeg", 0.9).split(",")[1];
}

export default class PseudoMica extends Plugin {
  settings: PseudoMicaSettings;
  private styleEl = document.createElement("style");
  private readonly exec = promisify(require("child_process").exec);
  private lastPosition = { x: 0, y: 0, width: 0, height: 0 };
  private frameRequest: number | null = null;
  private resizeTimer: NodeJS.Timeout | null = null;
  private isInitialized = false;

  async onload() {
    await this.loadSettings();

    this.addSettingTab(new PseudoMicaSettingTab(this.app, this));

    this.app.workspace.onLayoutReady(async () => {
      if (this.isInitialized || !Platform.isWin) return;

      this.isInitialized = true;
      await this.initializeWallpaper();
      document.body.classList.add("is-translucent");
    });
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    if (this.isInitialized) {
      this.styleEl.remove();
      document.body.classList.remove("is-translucent");
      this.isInitialized = false;
      this.app.workspace.onLayoutReady(async () => {
        if (this.isInitialized || !Platform.isWin) return;
        this.isInitialized = true;
        await this.initializeWallpaper();
        document.body.classList.add("is-translucent");
      });
    }
  }

  private async initializeWallpaper() {
    const wallpaperPath = await this.getWallpaperPath();
    if (!wallpaperPath) return;

    window.requestIdleCallback(async () => {
      try {
        const base64Image = await processWallpaperImage(wallpaperPath, window.screen.width, window.screen.height, this.settings.blurSize);

        const styles = `
                  body::before {
                      width: ${window.screen.width}px;
                      height: ${window.screen.height}px;
                      background-image: url(data:image/jpeg;base64,${base64Image});
                      position: fixed;
                      transform-origin: top left;
                      z-index: -1;
                      background-position: center;
                      background-size: cover;
                      content: "";
                  }`;

        document.head.appendChild(this.styleEl);
        this.styleEl.textContent = styles;

        this.setupPositionTracking(styles);
      } catch (error) {
        console.error("Failed to set wallpaper background:", error);
      }
    });
  }

  private setupPositionTracking(styles: string) {
    const updatePosition = () => {
      const { screenX, screenY } = window;
      if (this.lastPosition.x !== screenX || this.lastPosition.y !== screenY) {
        Object.assign(this.lastPosition, { x: screenX, y: screenY });
        this.styleEl.textContent = `${styles}
                  body::before {
                      transform: translate(${-screenX}px, ${-screenY}px);
                  }`;
      }
      this.frameRequest = requestAnimationFrame(updatePosition);
    };

    const handleResize = () => {
      this.resizeTimer && clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(updatePosition, 100);
    };

    window.addEventListener("resize", handleResize);
    this.frameRequest = requestAnimationFrame(updatePosition);

    this.register(() => {
      this.frameRequest && cancelAnimationFrame(this.frameRequest);
      this.resizeTimer && clearTimeout(this.resizeTimer);
      window.removeEventListener("resize", handleResize);
      this.styleEl.remove();
    });
  }

  private async getWallpaperPath(): Promise<string> {
    if (!Platform.isWin) return "";
    try {
      const { stdout } = await this.exec(`powershell -command "(Get-ItemProperty -Path 'HKCU:\\Control Panel\\Desktop' -Name Wallpaper).Wallpaper"`);
      return stdout.trim();
    } catch {
      return "";
    }
  }
}

class PseudoMicaSettingTab extends PluginSettingTab {
  plugin: PseudoMica;

  constructor(app: App, plugin: PseudoMica) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();
    if (Platform.isWin) {
      new Setting(containerEl).setHeading().setName("Pseudo Mica");
    } else {
      new Setting(containerEl).setHeading().setName("Pseudo Mica is disabled on this device").setDesc("Effect only available on Windows.");
    }

    new Setting(containerEl)
      .setName("Blur Intensity")
      .setDesc("Amount of blur applied to the wallpaper background. Value does not impact performance.")
      .addSlider((slider) =>
        slider
          .setLimits(10, 500, 10)
          .setValue(this.plugin.settings.blurSize)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.blurSize = value;
            await this.plugin.saveSettings();
          })
      )
      .addExtraButton((button) => {
        button.setIcon("reset").onClick(async () => {
          this.plugin.settings.blurSize = DEFAULT_SETTINGS.blurSize;
          await this.plugin.saveSettings();
          this.display();
        });
      });
  }
}
