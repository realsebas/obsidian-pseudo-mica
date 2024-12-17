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
  const edges = [
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
  const blurSize = BLUR_SIZE / Math.sqrt(3); // Changed from BLUR_SIZE / BLUR_PASSES
  workCtx.filter = `blur(${blurSize}px)`;
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

export default class CupertinoCompanion extends Plugin {
  private styleEl = document.createElement("style");
  private readonly exec = promisify(require("child_process").exec);
  private lastPosition = { x: 0, y: 0, width: 0, height: 0 };
  private frameRequest: number | null = null;
  private resizeTimer: NodeJS.Timeout | null = null;

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

      const styles = `
        body::before {
          width: ${window.screen.width}px;
          height: ${window.screen.height}px;
          background-image: url(data:image/jpeg;base64,${base64Image});
        }
      `;

      document.head.appendChild(this.styleEl);
      this.styleEl.textContent = styles;

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
    } catch (error) {
      console.error("Failed to set wallpaper background:", error);
    }
  }

  async onload() {
    if (process.platform === "darwin") {
      const { remote } = window.require("electron");
      const setButtonPos = () => remote.getCurrentWindow().setWindowButtonPosition({ x: 16, y: 16 });
      setButtonPos();
      window.addEventListener("resize", setButtonPos);
      document.body.classList.add("hello-cupertino");
    } else if (document.body.classList.contains("mica-off")) {
      document.body.classList.add("hello-cupertino");
    } else {
      await this.setWallpaperAsBackground();
      document.body.classList.add("hello-cupertino", "is-translucent");
    }
  }
}
