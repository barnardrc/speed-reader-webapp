import { useCallback, useEffect, useLayoutEffect, useRef, type FC } from "react";

import { measureFontMetrics, pathRoundedRect, syncCanvasSize } from "./canvasUtils";

interface RsvpReaderProps {
  currentWord: string;
  prevWord: string;
  nextWord: string;
  flankOpacity: number;
  themeKey?: string;
  isRunning: boolean;
  isAutoPaused?: boolean;
  onToggle: () => void;
}

const MAX_FONT_SIZE = 48;
const MIN_FONT_SIZE = 14;

function readCssVar(styles: CSSStyleDeclaration, name: string, fallback: string): string {
  const value = styles.getPropertyValue(name).trim();
  return value.length > 0 ? value : fallback;
}

function splitOrp(word: string): { left: string; pivot: string; right: string } {
  if (!word) {
    return { left: "", pivot: "", right: "" };
  }

  let orp = 0;
  if (word.length <= 1) {
    orp = 0;
  } else if (word.length <= 5) {
    orp = 1;
  } else if (word.length <= 9) {
    orp = 2;
  } else if (word.length <= 13) {
    orp = 3;
  } else {
    orp = 4;
  }

  const pivot = word[orp] ?? "";
  return {
    left: word.slice(0, orp),
    pivot,
    right: word.slice(orp + 1),
  };
}

function isHeader(word: string): boolean {
  if (!word || word !== word.toUpperCase()) {
    return false;
  }
  const lettersOnly = word.replace(/[^A-Za-z]/g, "");
  if (!lettersOnly) {
    return false;
  }
  return lettersOnly !== "I" && lettersOnly !== "A";
}

export const RsvpReader: FC<RsvpReaderProps> = ({
  currentWord,
  prevWord,
  nextWord,
  flankOpacity,
  themeKey = "dark",
  isRunning,
  isAutoPaused = false,
  onToggle,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    const rootStyles = getComputedStyle(document.documentElement);
    const mainWordColor = readCssVar(rootStyles, "--rsvp-main-word", "#ffffff");
    const flankWordRgb = readCssVar(rootStyles, "--rsvp-flank-rgb", "255, 255, 255");
    const pivotWordColor = readCssVar(rootStyles, "--rsvp-pivot-word", "#ff5555");
    const guideColor = readCssVar(rootStyles, "--rsvp-guide", "#444444");

    const { width, height, ratio } = syncCanvasSize(canvas);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.textBaseline = "alphabetic";

    const fontSize = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, Math.floor(height * 0.4), Math.floor(width / 15)));
    ctx.font = `700 ${fontSize}px Consolas, Menlo, monospace`;
    const metrics = measureFontMetrics(ctx);

    const barHeight = Math.max(4, Math.floor(height * 0.05));
    const barWidth = Math.min(300, Math.floor(width * 0.8));
    const radius = Math.floor(barHeight / 2);
    const marginBottom = 10;
    const xBar = Math.floor((width - barWidth) / 2);
    const yBar = height - barHeight - marginBottom;

    const barGradient = ctx.createLinearGradient(xBar, yBar, xBar + barWidth, yBar);
    const centerColor = isAutoPaused ? "#e6a340" : isRunning ? "#4caf50" : "#e57373";
    const edgeColor = isAutoPaused ? "rgba(146,94,25,0.706)" : isRunning ? "rgba(46,125,50,0.706)" : "rgba(198,40,40,0.706)";
    barGradient.addColorStop(0, edgeColor);
    barGradient.addColorStop(0.5, centerColor);
    barGradient.addColorStop(1, edgeColor);

    ctx.fillStyle = barGradient;
    pathRoundedRect(ctx, xBar, yBar, barWidth, barHeight, radius);
    ctx.fill();

    if (isAutoPaused) {
      const pauseFontSize = Math.max(12, Math.floor(fontSize * 0.33));
      ctx.font = `600 ${pauseFontSize}px Consolas, Menlo, monospace`;
      ctx.fillStyle = "#f6cd85";
      ctx.textAlign = "center";
      ctx.fillText("Paused - gaze off target", width / 2, yBar - 8);
      ctx.font = `700 ${fontSize}px Consolas, Menlo, monospace`;
    }

    const text = currentWord || "Ready";
    if (isHeader(text)) {
      ctx.fillStyle = mainWordColor;
      ctx.textAlign = "center";
      const availableBottom = height - (barHeight + marginBottom + 5);
      const centerY = availableBottom / 2;
      const baselineY = centerY + (metrics.ascent - metrics.descent) / 2;
      ctx.fillText(text, width / 2, baselineY);
      return;
    }

    const parts = splitOrp(text);
    const leftWidth = ctx.measureText(parts.left).width;
    const pivotWidth = ctx.measureText(parts.pivot).width;
    const rightWidth = ctx.measureText(parts.right).width;

    const cx = Math.floor(width / 2);
    const cy = Math.floor((height + metrics.ascent - metrics.descent) / 2);
    const pivotDrawX = cx - Math.floor(pivotWidth / 2);

    ctx.fillStyle = pivotWordColor;
    ctx.textAlign = "left";
    ctx.fillText(parts.pivot, pivotDrawX, cy);

    ctx.fillStyle = mainWordColor;
    ctx.fillText(parts.left, pivotDrawX - leftWidth, cy);
    ctx.fillText(parts.right, pivotDrawX + pivotWidth, cy);

    ctx.strokeStyle = guideColor;
    ctx.lineWidth = Math.max(1, Math.floor(metrics.height / 20));
    const topLineY = cy - metrics.ascent - Math.floor(metrics.height / 4);
    const topLineLen = Math.floor(metrics.height / 3);
    ctx.beginPath();
    ctx.moveTo(cx, topLineY);
    ctx.lineTo(cx, topLineY - topLineLen);
    ctx.stroke();

    const bottomLineY = cy + Math.floor(metrics.height / 4);
    const bottomLineLen = Math.floor(metrics.height / 3);
    ctx.beginPath();
    ctx.moveTo(cx, bottomLineY);
    ctx.lineTo(cx, bottomLineY + bottomLineLen);
    ctx.stroke();

    const baseOffset = Math.min(250, Math.floor(width * 0.35));
    const padding = 40;
    const actualLeftReach = Math.floor(pivotWidth / 2) + leftWidth;
    const actualRightReach = Math.floor(pivotWidth / 2) + rightWidth;
    const distLeft = Math.max(baseOffset, actualLeftReach + padding);
    const distRight = Math.max(baseOffset, actualRightReach + padding);

    const leftWallX = cx - distLeft;
    const rightWallX = cx + distRight;
    const flankAlpha = Math.max(0, Math.min(255, Math.round((flankOpacity / 100) * 255)));

    if (prevWord) {
      const prevWidth = ctx.measureText(prevWord).width;
      const drawX = leftWallX - prevWidth;
      ctx.fillStyle = `rgba(${flankWordRgb},${flankAlpha / 255})`;
      ctx.fillText(prevWord, drawX, cy);
    }

    if (nextWord) {
      ctx.fillStyle = `rgba(${flankWordRgb},${flankAlpha / 255})`;
      ctx.fillText(nextWord, rightWallX, cy);
    }
  }, [currentWord, prevWord, nextWord, flankOpacity, isRunning, isAutoPaused, themeKey]);

  useLayoutEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const observer = new ResizeObserver(() => {
      draw();
    });
    observer.observe(canvas);

    return () => {
      observer.disconnect();
    };
  }, [draw]);

  return (
    <section className="rsvp" onClick={onToggle}>
      <canvas ref={canvasRef} className="rsvp-canvas" />
    </section>
  );
};
