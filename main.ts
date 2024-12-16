import { Plugin } from "obsidian";
import { promisify } from "util";
import * as fs from "fs/promises";

interface Position {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function processWallpaperImage(imagePath: string, targetWidth: number, targetHeight: number): Promise<string> {
  const BLUR_SIZE = 240;

  // Load image
  const img = new Image();
  const imageData = await fs.readFile(imagePath);
  img.src = URL.createObjectURL(new Blob([imageData]));
  await new Promise((resolve) => (img.onload = resolve));

  // Create working canvas
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;

  // Step 1: Extend image
  canvas.width = img.width + BLUR_SIZE * 2;
  canvas.height = img.height + BLUR_SIZE * 2;

  // Draw original image
  ctx.drawImage(img, BLUR_SIZE, BLUR_SIZE);

  // Stretch edges
  // Top
  ctx.drawImage(canvas, BLUR_SIZE, BLUR_SIZE, img.width, 1, BLUR_SIZE, 0, img.width, BLUR_SIZE);
  // Bottom
  ctx.drawImage(canvas, BLUR_SIZE, img.height + BLUR_SIZE - 1, img.width, 1, BLUR_SIZE, img.height + BLUR_SIZE, img.width, BLUR_SIZE);
  // Left
  ctx.drawImage(canvas, BLUR_SIZE, BLUR_SIZE, 1, img.height, 0, BLUR_SIZE, BLUR_SIZE, img.height);
  // Right
  ctx.drawImage(canvas, img.width + BLUR_SIZE - 1, BLUR_SIZE, 1, img.height, img.width + BLUR_SIZE, BLUR_SIZE, BLUR_SIZE, img.height);

  // Corners
  ctx.drawImage(canvas, BLUR_SIZE, BLUR_SIZE, 1, 1, 0, 0, BLUR_SIZE, BLUR_SIZE); // Top-left
  ctx.drawImage(canvas, img.width + BLUR_SIZE - 1, BLUR_SIZE, 1, 1, img.width + BLUR_SIZE, 0, BLUR_SIZE, BLUR_SIZE); // Top-right
  ctx.drawImage(canvas, BLUR_SIZE, img.height + BLUR_SIZE - 1, 1, 1, 0, img.height + BLUR_SIZE, BLUR_SIZE, BLUR_SIZE); // Bottom-left
  ctx.drawImage(canvas, img.width + BLUR_SIZE - 1, img.height + BLUR_SIZE - 1, 1, 1, img.width + BLUR_SIZE, img.height + BLUR_SIZE, BLUR_SIZE, BLUR_SIZE); // Bottom-right

  // Step 2: Apply gaussian blur
  for (let i = 0; i < 3; i++) {
    // Multiple passes for better blur
    ctx.filter = `blur(${BLUR_SIZE / 3}px)`;
    ctx.drawImage(canvas, 0, 0);
  }

  // Flatten image
  ctx.filter = "none";
  const flattenedCanvas = document.createElement("canvas");
  flattenedCanvas.width = canvas.width;
  flattenedCanvas.height = canvas.height;
  flattenedCanvas.getContext("2d")!.drawImage(canvas, 0, 0);

  // Step 3: Crop
  const finalCanvas = document.createElement("canvas");
  finalCanvas.width = img.width;
  finalCanvas.height = img.height;
  finalCanvas.getContext("2d")!.drawImage(flattenedCanvas, BLUR_SIZE, BLUR_SIZE, img.width, img.height, 0, 0, img.width, img.height);

  // Step 4: Scale
  const scaledCanvas = document.createElement("canvas");
  scaledCanvas.width = targetWidth;
  scaledCanvas.height = targetHeight;
  scaledCanvas.getContext("2d")!.drawImage(finalCanvas, 0, 0, targetWidth, targetHeight);

  // Convert to base64
  return scaledCanvas.toDataURL("image/jpeg", 0.9).split(",")[1];
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
      const base64Image = await processWallpaperImage(wallpaperPath, window.screen.width, window.screen.height);

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
