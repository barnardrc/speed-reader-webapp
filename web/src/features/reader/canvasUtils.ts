export interface CanvasFontMetrics {
  ascent: number;
  descent: number;
  height: number;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function parseFontSizePx(font: string, fallback: number): number {
  const match = /(\d+(?:\.\d+)?)px/.exec(font);
  if (!match) {
    return fallback;
  }
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function measureFontMetrics(ctx: CanvasRenderingContext2D, fallbackSize = 24): CanvasFontMetrics {
  const sample = ctx.measureText("Mg");
  const fontSize = parseFontSizePx(ctx.font, fallbackSize);
  const ascent = sample.actualBoundingBoxAscent || fontSize * 0.8;
  const descent = sample.actualBoundingBoxDescent || fontSize * 0.2;
  return {
    ascent,
    descent,
    height: ascent + descent,
  };
}

export function syncCanvasSize(canvas: HTMLCanvasElement): { width: number; height: number; ratio: number } {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const ratio = window.devicePixelRatio || 1;

  const pixelWidth = Math.max(1, Math.round(width * ratio));
  const pixelHeight = Math.max(1, Math.round(height * ratio));
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }

  return { width, height, ratio };
}

export function pathRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

