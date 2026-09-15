import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type FC,
} from "react";

import { clamp, measureFontMetrics, pathRoundedRect, syncCanvasSize } from "./canvasUtils";

interface ContextPaneProps {
  words: string[];
  index: number;
  range: number;
  opacity: number;
  themeKey?: string;
  onScrollStep?: (step: number) => void;
}

interface SentenceBounds {
  start: number;
  end: number;
}

const MAX_FONT_SIZE = 24;
const MIN_FONT_SIZE = 12;
const SENTENCE_SCAN_LIMIT = 100;
const BORDER_PADDING = 20;
const LEFT_RIGHT_MARGIN = 40;
const ACTIVE_LINE_VERTICAL_RATIO = 0.62;
const BACKWARD_CONTEXT_SHARE = 0.65;

function readCssVar(styles: CSSStyleDeclaration, name: string, fallback: string): string {
  const value = styles.getPropertyValue(name).trim();
  return value.length > 0 ? value : fallback;
}

function findSentenceBounds(words: string[], index: number): SentenceBounds {
  if (words.length === 0) {
    return { start: 0, end: 0 };
  }

  const clampedIndex = clamp(index, 0, words.length - 1);
  let start = clampedIndex;
  let scan = 0;
  let i = clampedIndex - 1;
  while (i >= 0 && scan < SENTENCE_SCAN_LIMIT) {
    const word = words[i] ?? "";
    if (word.length > 0 && [".", "?", "!"].includes(word[word.length - 1])) {
      start = i + 1;
      break;
    }
    if (i === 0) {
      start = 0;
    }
    i -= 1;
    scan += 1;
  }

  let end = clampedIndex;
  scan = 0;
  i = clampedIndex;
  while (i < words.length && scan < SENTENCE_SCAN_LIMIT) {
    const word = words[i] ?? "";
    if (word.length > 0 && [".", "?", "!"].includes(word[word.length - 1])) {
      end = i;
      break;
    }
    i += 1;
    scan += 1;
  }

  return { start, end };
}

export const ContextPane: FC<ContextPaneProps> = ({ words, index, range, opacity, themeKey = "dark", onScrollStep }) => {
  const containerRef = useRef<HTMLElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sentenceBounds = useMemo(() => findSentenceBounds(words, index), [words, index]);

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
    const activeWordColor = readCssVar(rootStyles, "--context-active-word", "#ffd700");
    const flowTextRgb = readCssVar(rootStyles, "--context-flow-rgb", "255, 255, 255");
    const sentenceHighlightRgb = readCssVar(rootStyles, "--context-sentence-highlight-rgb", "255, 255, 255");

    const { width, height, ratio } = syncCanvasSize(canvas);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.textBaseline = "alphabetic";

    const targetFontSize = Math.floor(height * 0.05);
    const fontSize = clamp(targetFontSize, MIN_FONT_SIZE, MAX_FONT_SIZE);
    const regularFont = `${fontSize}px Georgia`;
    const boldFont = `bold ${fontSize}px Georgia`;

    ctx.font = regularFont;
    const regularMetrics = measureFontMetrics(ctx, fontSize);
    const lineHeight = regularMetrics.height + 5;

    const borderRectX = BORDER_PADDING;
    const borderRectY = 10;
    const borderRectWidth = Math.max(0, width - BORDER_PADDING * 2);
    const borderRectHeight = Math.max(0, height - 20);

    const borderGradient = ctx.createLinearGradient(0, 0, 0, height);
    borderGradient.addColorStop(0, "rgba(150,150,150,0)");
    borderGradient.addColorStop(0.2, "rgba(150,150,150,0)");
    borderGradient.addColorStop(0.5, "rgba(150,150,150,0.392)");
    borderGradient.addColorStop(0.8, "rgba(150,150,150,0)");
    borderGradient.addColorStop(1, "rgba(150,150,150,0)");
    ctx.strokeStyle = borderGradient;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    pathRoundedRect(ctx, borderRectX, borderRectY, borderRectWidth, borderRectHeight, 15);
    ctx.stroke();

    const activeLineCenterY = clamp(
      height * ACTIVE_LINE_VERTICAL_RATIO,
      BORDER_PADDING + lineHeight / 2,
      height - BORDER_PADDING - lineHeight / 2,
    );
    const separatorY = Math.min(height - BORDER_PADDING, activeLineCenterY + lineHeight * 3.5 + 5);
    const separatorGradient = ctx.createLinearGradient(0, 0, width, 0);
    separatorGradient.addColorStop(0, "rgba(150,150,150,0)");
    separatorGradient.addColorStop(0.3, "rgba(150,150,150,0)");
    separatorGradient.addColorStop(0.5, "rgba(150,150,150,0.314)");
    separatorGradient.addColorStop(0.7, "rgba(150,150,150,0)");
    separatorGradient.addColorStop(1, "rgba(150,150,150,0)");

    ctx.strokeStyle = separatorGradient;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(BORDER_PADDING + 10, separatorY);
    ctx.lineTo(width - BORDER_PADDING - 10, separatorY);
    ctx.stroke();

    if (words.length === 0) {
      return;
    }

    const clampedIndex = clamp(index, 0, words.length - 1);
    const activeWord = words[clampedIndex] ?? "";
    const baseAlpha = Math.round(255 * (clamp(opacity, 0, 100) / 100));
    const safeRange = Math.max(0, Math.floor(range));
    const totalContextWords = safeRange * 2;
    const backwardRange = Math.max(0, Math.round(totalContextWords * BACKWARD_CONTEXT_SHARE));
    const forwardRange = Math.max(0, totalContextWords - backwardRange);
    const centerX = width / 2;
    const screenFadeZone = height * 0.15;
    const leftBound = LEFT_RIGHT_MARGIN;
    const rightBound = width - LEFT_RIGHT_MARGIN;
    const spaceWidth = Math.max(1, ctx.measureText(" ").width);

    const getCombinedAlpha = (rectCenterY: number, currentStep: number, maxSteps: number): number => {
      let screenFactor = 1;
      if (rectCenterY < screenFadeZone) {
        screenFactor = Math.max(0, rectCenterY / screenFadeZone);
      } else if (rectCenterY > height - screenFadeZone) {
        const dist = height - rectCenterY;
        screenFactor = Math.max(0, dist / screenFadeZone);
      }
      screenFactor *= screenFactor;

      let indexFactor = 1;
      const fadeStartStep = maxSteps * 0.7;
      if (maxSteps > 0 && currentStep > fadeStartStep) {
        const denominator = maxSteps - fadeStartStep;
        if (denominator > 0) {
          const progress = (currentStep - fadeStartStep) / denominator;
          indexFactor = Math.max(0, 1 - progress);
        }
      }

      return Math.round(baseAlpha * Math.min(screenFactor, indexFactor));
    };

    ctx.font = boldFont;
    const activeMetrics = measureFontMetrics(ctx, fontSize);
    const activeWordWidth = ctx.measureText(activeWord).width;
    const activeRectX = centerX - activeWordWidth / 2;
    const activeRectY = activeLineCenterY - lineHeight / 2;

    if (sentenceBounds.start <= clampedIndex && clampedIndex <= sentenceBounds.end) {
      ctx.fillStyle = `rgba(${sentenceHighlightRgb},0.118)`;
      ctx.fillRect(activeRectX, activeRectY, activeWordWidth, lineHeight);
    }

    ctx.fillStyle = activeWordColor;
    ctx.textAlign = "left";
    const activeTextY = activeRectY + (lineHeight - activeMetrics.height) / 2 + activeMetrics.ascent;
    ctx.fillText(activeWord, activeRectX, activeTextY);

    ctx.font = regularFont;
    const drawFlowWord = (word: string, rectX: number, rectY: number, wordWidth: number, alpha: number, idx: number): void => {
      ctx.fillStyle = `rgba(${flowTextRgb},${alpha / 255})`;
      ctx.textAlign = "center";
      const textY = rectY + (lineHeight - regularMetrics.height) / 2 + regularMetrics.ascent;
      ctx.fillText(word, rectX + wordWidth / 2, textY);

      if (sentenceBounds.start <= idx && idx <= sentenceBounds.end) {
        const bgAlpha = Math.round(30 * (alpha / 255));
        if (bgAlpha > 0) {
          ctx.fillStyle = `rgba(${sentenceHighlightRgb},${bgAlpha / 255})`;
          ctx.fillRect(rectX, rectY, wordWidth, lineHeight);
        }
      }
    };

    let cursorX = activeRectX + activeWordWidth + spaceWidth;
    let cursorY = activeRectY;
    const rightEnd = Math.min(words.length, clampedIndex + 1 + forwardRange);
    const rightStepsTotal = rightEnd - (clampedIndex + 1);

    for (let step = 0, i = clampedIndex + 1; i < rightEnd; i += 1, step += 1) {
      const word = words[i] ?? "";
      const wordWidth = ctx.measureText(word).width;
      if (cursorX + wordWidth > rightBound) {
        cursorX = leftBound;
        cursorY += lineHeight;
      }
      if (cursorY > height) {
        break;
      }

      const alpha = getCombinedAlpha(cursorY + lineHeight / 2, step, rightStepsTotal);
      if (alpha > 5) {
        drawFlowWord(word, cursorX, cursorY, wordWidth, alpha, i);
      }
      cursorX += wordWidth + spaceWidth;
    }

    cursorX = activeRectX - spaceWidth;
    cursorY = activeRectY;
    const leftEndInclusive = Math.max(0, clampedIndex - backwardRange);
    const leftStepsTotal = clampedIndex - leftEndInclusive;

    for (let step = 0, i = clampedIndex - 1; i >= leftEndInclusive; i -= 1, step += 1) {
      const word = words[i] ?? "";
      const wordWidth = ctx.measureText(word).width;
      if (cursorX - wordWidth < leftBound) {
        cursorX = rightBound;
        cursorY -= lineHeight;
      }
      if (cursorY + lineHeight < 0) {
        break;
      }

      const rectX = cursorX - wordWidth;
      const alpha = getCombinedAlpha(cursorY + lineHeight / 2, step, leftStepsTotal);
      if (alpha > 5) {
        drawFlowWord(word, rectX, cursorY, wordWidth, alpha, i);
      }
      cursorX -= wordWidth + spaceWidth;
    }
  }, [words, index, range, opacity, sentenceBounds, themeKey]);

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

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !onScrollStep) {
      return;
    }

    const handleWheel = (event: WheelEvent): void => {
      if (!onScrollStep) {
        return;
      }
      if (event.deltaY === 0) {
        return;
      }
      event.preventDefault();
      onScrollStep(event.deltaY < 0 ? -1 : 1);
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      container.removeEventListener("wheel", handleWheel);
    };
  }, [onScrollStep]);

  return (
    <section ref={containerRef} className={`context-pane${words.length === 0 ? " empty" : ""}`}>
      <canvas ref={canvasRef} className="context-canvas" />
      {words.length === 0 ? <div className="context-empty-text">Load a book to see context.</div> : null}
    </section>
  );
};
