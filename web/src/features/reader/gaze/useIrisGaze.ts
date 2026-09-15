import { useEffect, useRef, useState } from "react";

import { createMediaPipeIrisEngine } from "./irisEngine";
import { clampTelemetry, type GazeDebugTelemetry } from "./gazeDebug";
import { GAZE_TUNING } from "./gazeTuning";

export type IrisTrackingStatus = "disabled" | "loading" | "tracking" | "lost" | "error";

export interface IrisGazeSample {
  feature: number;
  rawFeature: number;
  timestampMs: number;
}

export interface IrisGazeOptions {
  enabled: boolean;
  targetFps?: number;
  smoothingFactor?: number;
  enableDebugStream?: boolean;
  onSample?: (sample: IrisGazeSample) => void;
}

export interface IrisGazeState {
  status: IrisTrackingStatus;
  error: string | null;
  latestSample: IrisGazeSample | null;
  telemetry: GazeDebugTelemetry;
  debugStream: MediaStream | null;
}

const DEFAULT_TARGET_FPS = GAZE_TUNING.pipeline.targetFps;
const DEFAULT_SMOOTHING_FACTOR = GAZE_TUNING.pipeline.smoothingAlpha;
const LOST_TIMEOUT_MS = GAZE_TUNING.pipeline.lostStatusTimeoutMs;
const UI_UPDATE_MIN_GAP_MS = GAZE_TUNING.pipeline.uiUpdateMinGapMs;
const TELEMETRY_UPDATE_MIN_GAP_MS = GAZE_TUNING.pipeline.telemetryUpdateMinGapMs;

export function useIrisGaze(options: IrisGazeOptions): IrisGazeState {
  const {
    enabled,
    targetFps = DEFAULT_TARGET_FPS,
    smoothingFactor = DEFAULT_SMOOTHING_FACTOR,
    enableDebugStream = false,
    onSample,
  } = options;

  const [status, setStatus] = useState<IrisTrackingStatus>(enabled ? "loading" : "disabled");
  const [error, setError] = useState<string | null>(null);
  const [latestSample, setLatestSample] = useState<IrisGazeSample | null>(null);
  const [telemetry, setTelemetry] = useState<GazeDebugTelemetry>(() => clampTelemetry(undefined));
  const [debugStream, setDebugStream] = useState<MediaStream | null>(null);

  const onSampleRef = useRef<IrisGazeOptions["onSample"]>(onSample);
  const enableDebugStreamRef = useRef(enableDebugStream);
  const activeStreamRef = useRef<MediaStream | null>(null);
  const statusRef = useRef<IrisTrackingStatus>(enabled ? "loading" : "disabled");
  const lastSmoothedFeatureRef = useRef<number | null>(null);
  const lastDetectionAtRef = useRef<number>(0);
  const lastInferAtRef = useRef<number>(0);
  const lastUiUpdateAtRef = useRef<number>(0);
  const inferCountRef = useRef(0);
  const detectionCountRef = useRef(0);
  const missedCountRef = useRef(0);
  const telemetryWindowStartRef = useRef(0);
  const telemetryWindowInferCountRef = useRef(0);
  const telemetryWindowDetectCountRef = useRef(0);
  const telemetryLastPublishedAtRef = useRef(0);
  const videoWidthRef = useRef(0);
  const videoHeightRef = useRef(0);

  useEffect(() => {
    onSampleRef.current = onSample;
  }, [onSample]);

  useEffect(() => {
    enableDebugStreamRef.current = enableDebugStream;
    if (enableDebugStream) {
      if (activeStreamRef.current) {
        setDebugStream(activeStreamRef.current);
      }
      return;
    }
    setDebugStream(null);
  }, [enableDebugStream]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    if (!enabled) {
      setStatus("disabled");
      setError(null);
      setLatestSample(null);
      setTelemetry(clampTelemetry(undefined));
      setDebugStream(null);
      activeStreamRef.current = null;
      lastSmoothedFeatureRef.current = null;
      lastDetectionAtRef.current = 0;
      lastInferAtRef.current = 0;
      lastUiUpdateAtRef.current = 0;
      inferCountRef.current = 0;
      detectionCountRef.current = 0;
      missedCountRef.current = 0;
      telemetryWindowStartRef.current = 0;
      telemetryWindowInferCountRef.current = 0;
      telemetryWindowDetectCountRef.current = 0;
      telemetryLastPublishedAtRef.current = 0;
      videoWidthRef.current = 0;
      videoHeightRef.current = 0;
      return;
    }

    let active = true;
    let rafId = 0;
    let stream: MediaStream | null = null;
    let video: HTMLVideoElement | null = null;
    let pendingInit: Promise<void> | null = null;
    let engine: Awaited<ReturnType<typeof createMediaPipeIrisEngine>> | null = null;

    const frameIntervalMs = 1000 / Math.max(1, targetFps);
    const alpha = Math.min(1, Math.max(0.01, smoothingFactor));

    const cleanup = (): void => {
      if (rafId) {
        window.cancelAnimationFrame(rafId);
        rafId = 0;
      }
      if (engine) {
        engine.close();
        engine = null;
      }
      if (video) {
        video.pause();
        video.srcObject = null;
        video.remove();
        video = null;
      }
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
        stream = null;
      }
      activeStreamRef.current = null;
      setDebugStream(null);
    };

    const publishTelemetry = (timestampMs: number): void => {
      if (telemetryWindowStartRef.current <= 0) {
        telemetryWindowStartRef.current = timestampMs;
      }
      const elapsedWindow = Math.max(1, timestampMs - telemetryWindowStartRef.current);
      const inferenceFps = (telemetryWindowInferCountRef.current * 1000) / elapsedWindow;
      const detectionRate =
        telemetryWindowInferCountRef.current > 0
          ? (telemetryWindowDetectCountRef.current / telemetryWindowInferCountRef.current) * 100
          : 0;

      setTelemetry(
        clampTelemetry({
          inferenceFps,
          detectionRate,
          inferenceCount: inferCountRef.current,
          detectionCount: detectionCountRef.current,
          missedCount: missedCountRef.current,
          elapsedSinceDetectionMs: lastDetectionAtRef.current > 0 ? timestampMs - lastDetectionAtRef.current : 0,
          videoWidth: videoWidthRef.current,
          videoHeight: videoHeightRef.current,
        }),
      );

      telemetryWindowStartRef.current = timestampMs;
      telemetryWindowInferCountRef.current = 0;
      telemetryWindowDetectCountRef.current = 0;
      telemetryLastPublishedAtRef.current = timestampMs;
    };

    const tick = (timestampMs: number): void => {
      if (!active || !engine || !video) {
        return;
      }

      if (timestampMs - lastInferAtRef.current < frameIntervalMs) {
        rafId = window.requestAnimationFrame(tick);
        return;
      }
      lastInferAtRef.current = timestampMs;
      inferCountRef.current += 1;
      telemetryWindowInferCountRef.current += 1;

      const detection = engine.detect(video, timestampMs);
      if (!active) {
        return;
      }

      if (detection) {
        lastDetectionAtRef.current = timestampMs;
        detectionCountRef.current += 1;
        telemetryWindowDetectCountRef.current += 1;
        const previous = lastSmoothedFeatureRef.current;
        const smoothedFeature = previous === null ? detection.feature : previous + (detection.feature - previous) * alpha;
        lastSmoothedFeatureRef.current = smoothedFeature;

        const sample: IrisGazeSample = {
          feature: smoothedFeature,
          rawFeature: detection.feature,
          timestampMs,
        };
        if (statusRef.current !== "tracking") {
          setStatus("tracking");
        }
        onSampleRef.current?.(sample);

        if (timestampMs - lastUiUpdateAtRef.current >= UI_UPDATE_MIN_GAP_MS) {
          lastUiUpdateAtRef.current = timestampMs;
          setLatestSample(sample);
        }
      } else {
        missedCountRef.current += 1;
        const lostForMs = timestampMs - lastDetectionAtRef.current;
        if (lostForMs >= LOST_TIMEOUT_MS && statusRef.current !== "lost") {
          setStatus("lost");
        }
      }

      if (timestampMs - telemetryLastPublishedAtRef.current >= TELEMETRY_UPDATE_MIN_GAP_MS) {
        publishTelemetry(timestampMs);
      }

      rafId = window.requestAnimationFrame(tick);
    };

    const start = async (): Promise<void> => {
      setStatus("loading");
      setError(null);
      setLatestSample(null);
      setTelemetry(clampTelemetry(undefined));
      setDebugStream(null);
      lastSmoothedFeatureRef.current = null;
      lastDetectionAtRef.current = 0;
      lastInferAtRef.current = 0;
      lastUiUpdateAtRef.current = 0;
      inferCountRef.current = 0;
      detectionCountRef.current = 0;
      missedCountRef.current = 0;
      telemetryWindowStartRef.current = 0;
      telemetryWindowInferCountRef.current = 0;
      telemetryWindowDetectCountRef.current = 0;
      telemetryLastPublishedAtRef.current = 0;
      videoWidthRef.current = 0;
      videoHeightRef.current = 0;

      if (!navigator?.mediaDevices?.getUserMedia) {
        throw new Error("This browser does not support camera access.");
      }

      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
        audio: false,
      });
      activeStreamRef.current = stream;
      if (enableDebugStreamRef.current) {
        setDebugStream(stream);
      }

      video = document.createElement("video");
      video.autoplay = true;
      video.playsInline = true;
      video.muted = true;
      video.srcObject = stream;
      video.style.position = "fixed";
      video.style.opacity = "0";
      video.style.pointerEvents = "none";
      video.style.width = "1px";
      video.style.height = "1px";
      video.style.left = "-100px";
      video.style.top = "-100px";
      document.body.appendChild(video);

      await video.play();
      videoWidthRef.current = video.videoWidth || 0;
      videoHeightRef.current = video.videoHeight || 0;
      engine = await createMediaPipeIrisEngine();
      lastDetectionAtRef.current = performance.now();
      rafId = window.requestAnimationFrame(tick);
    };

    pendingInit = start().catch((caughtError) => {
      if (!active) {
        return;
      }
      const message = caughtError instanceof Error ? caughtError.message : "Failed to initialize eye tracking.";
      setStatus("error");
      setError(message);
      cleanup();
    });

    return () => {
      active = false;
      void pendingInit;
      cleanup();
    };
  }, [enabled, smoothingFactor, targetFps]);

  return {
    status,
    error,
    latestSample,
    telemetry,
    debugStream,
  };
}
