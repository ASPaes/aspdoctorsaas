/**
 * Draws the project favicon with a red dot overlay when there are unread notifications.
 * Falls back gracefully if the original favicon cannot be loaded (CORS, etc.).
 */
const ORIGINAL_FAVICON = "/favicon.png";
let baseImage: HTMLImageElement | null = null;
let baseLoaded = false;
let lastState: boolean | null = null;

function ensureLink(): HTMLLinkElement {
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  return link;
}

function loadBase(): Promise<HTMLImageElement | null> {
  if (baseLoaded) return Promise.resolve(baseImage);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      baseImage = img;
      baseLoaded = true;
      resolve(img);
    };
    img.onerror = () => {
      baseLoaded = true;
      baseImage = null;
      resolve(null);
    };
    img.src = ORIGINAL_FAVICON;
  });
}

export async function updateFaviconBadge(hasUnread: boolean) {
  if (lastState === hasUnread) return;
  lastState = hasUnread;

  const link = ensureLink();

  if (!hasUnread) {
    link.href = `${ORIGINAL_FAVICON}?v=${Date.now()}`;
    return;
  }

  const img = await loadBase();
  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  if (img) {
    try {
      ctx.drawImage(img, 0, 0, size, size);
    } catch {
      // tainted canvas; ignore base
    }
  } else {
    // No base image: use a neutral background so the dot is visible
    ctx.fillStyle = "rgba(0,0,0,0)";
    ctx.fillRect(0, 0, size, size);
  }

  // Red badge dot, top-right
  const r = 7;
  const cx = size - r - 1;
  const cy = r + 1;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = "#ef4444";
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();

  try {
    link.href = canvas.toDataURL("image/png");
  } catch {
    // tainted; revert
    link.href = ORIGINAL_FAVICON;
  }
}
