import { useCallback, useEffect, useMemo, useRef, type FC } from "react";

import type { GazeCalibrationProfile, GazeZone } from "./gazeCalibration";
import {
  formatCameraPermission,
  type CameraPermissionState,
  type GazeDebugEvent,
  type GazeDebugTelemetry,
  type GazeTracePoint,
} from "./gazeDebug";
import type { IrisTrackingStatus } from "./useIrisGaze";

interface GazeDebugPanelProps {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  trackingStatus: IrisTrackingStatus;
  trackingError: string | null;
  telemetry: GazeDebugTelemetry;
  latestRawFeature: number | null;
  latestSmoothFeature: number | null;
  zone: GazeZone;
  zoneDwellMs: number;
  secureContext: boolean;
  cameraPermission: CameraPermissionState;
  gazeEnabled: boolean;
  manualRunning: boolean;
  effectiveRunning: boolean;
  gazeAutoPaused: boolean;
  gazeAutoPausedReason: string | null;
  calibration: GazeCalibrationProfile | null;
  hysteresisBand: number;
  trace: GazeTracePoint[];
  events: GazeDebugEvent[];
  debugStream: MediaStream | null;
  onClearEvents: () => void;
  onClearTrace: () => void;
}

const TRACE_VIEW_WIDTH = 360;
const TRACE_VIEW_HEIGHT = 118;

function buildSparklinePath(values: number[], minValue: number, maxValue: number, width: number, height: number): string {
  if (values.length === 0) {
    return "";
  }
  const span = Math.max(1e-6, maxValue - minValue);
  const toY = (value: number): number => {
    const normalized = (value - minValue) / span;
    return height - normalized * height;
  };

  return values
    .map((value, idx) => {
      const x = (idx / Math.max(1, values.length - 1)) * width;
      const y = toY(value);
      return `${idx === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function thresholdY(value: number, minValue: number, maxValue: number, height: number): number {
  const span = Math.max(1e-6, maxValue - minValue);
  const normalized = (value - minValue) / span;
  return height - normalized * height;
}

function formatDwell(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    return "0 ms";
  }
  if (ms < 1000) {
    return `${Math.round(ms)} ms`;
  }
  return `${(ms / 1000).toFixed(2)} s`;
}

function formatEventTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour12: false });
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export const GazeDebugPanel: FC<GazeDebugPanelProps> = ({
  open,
  onOpenChange,
  trackingStatus,
  trackingError,
  telemetry,
  latestRawFeature,
  latestSmoothFeature,
  zone,
  zoneDwellMs,
  secureContext,
  cameraPermission,
  gazeEnabled,
  manualRunning,
  effectiveRunning,
  gazeAutoPaused,
  gazeAutoPausedReason,
  calibration,
  hysteresisBand,
  trace,
  events,
  debugStream,
  onClearEvents,
  onClearTrace,
}) => {
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = previewVideoRef.current;
    if (!video) {
      return;
    }
    if (!debugStream) {
      video.srcObject = null;
      return;
    }
    video.srcObject = debugStream;
  }, [debugStream]);

  const orderedTrace = useMemo(() => [...trace].reverse(), [trace]);
  const rawValues = orderedTrace.map((point) => point.rawFeature);
  const smoothValues = orderedTrace.map((point) => point.smoothFeature);
  const featureExtents = useMemo(() => {
    const source = [...rawValues, ...smoothValues];
    if (source.length === 0) {
      return { min: 0, max: 1 };
    }
    const min = Math.min(...source);
    const max = Math.max(...source);
    if (Math.abs(max - min) < 0.002) {
      return { min: min - 0.001, max: max + 0.001 };
    }
    return { min, max };
  }, [rawValues, smoothValues]);

  const rawPath = useMemo(
    () => buildSparklinePath(rawValues, featureExtents.min, featureExtents.max, TRACE_VIEW_WIDTH, TRACE_VIEW_HEIGHT),
    [rawValues, featureExtents.max, featureExtents.min],
  );
  const smoothPath = useMemo(
    () => buildSparklinePath(smoothValues, featureExtents.min, featureExtents.max, TRACE_VIEW_WIDTH, TRACE_VIEW_HEIGHT),
    [smoothValues, featureExtents.max, featureExtents.min],
  );

  const thresholdBaseY =
    calibration !== null ? thresholdY(calibration.threshold, featureExtents.min, featureExtents.max, TRACE_VIEW_HEIGHT) : null;
  const thresholdUpperY =
    calibration !== null
      ? thresholdY(calibration.threshold + hysteresisBand, featureExtents.min, featureExtents.max, TRACE_VIEW_HEIGHT)
      : null;
  const thresholdLowerY =
    calibration !== null
      ? thresholdY(calibration.threshold - hysteresisBand, featureExtents.min, featureExtents.max, TRACE_VIEW_HEIGHT)
      : null;

  const previewScale = useMemo(() => {
    if (calibration) {
      const low = Math.min(calibration.onValue, calibration.offValue) - hysteresisBand * 2;
      const high = Math.max(calibration.onValue, calibration.offValue) + hysteresisBand * 2;
      return {
        min: low,
        max: Math.max(low + 1e-5, high),
      };
    }
    return {
      min: featureExtents.min,
      max: Math.max(featureExtents.min + 1e-5, featureExtents.max),
    };
  }, [calibration, featureExtents.max, featureExtents.min, hysteresisBand]);

  const toPreviewYPercent = useCallback(
    (value: number): number => {
      const ratio = (value - previewScale.min) / Math.max(1e-5, previewScale.max - previewScale.min);
      return clampPercent(100 - ratio * 100);
    },
    [previewScale.max, previewScale.min],
  );

  const markerYPercent = latestSmoothFeature !== null ? toPreviewYPercent(latestSmoothFeature) : null;
  const previewThresholdPercent = calibration ? toPreviewYPercent(calibration.threshold) : null;
  const previewBandUpperPercent = calibration ? toPreviewYPercent(calibration.threshold + hysteresisBand) : null;
  const previewBandLowerPercent = calibration ? toPreviewYPercent(calibration.threshold - hysteresisBand) : null;
  const markerColor = zone === "on" ? "#7de5aa" : zone === "off" ? "#f3a2a2" : "#c9ced6";

  if (!open) {
    return null;
  }

  return (
    <aside className="gaze-debug-panel" role="region" aria-label="Eye tracking debug panel">
      <header className="gaze-debug-head">
        <strong>Eye Tracking Debug</strong>
        <div className="gaze-debug-head-actions">
          <button type="button" className="btn-ghost" onClick={onClearTrace}>
            Clear Trace
          </button>
          <button type="button" className="btn-ghost" onClick={onClearEvents}>
            Clear Events
          </button>
          <button type="button" className="btn-ghost" onClick={() => onOpenChange(false)}>
            Close
          </button>
        </div>
      </header>

      <section className="gaze-debug-grid">
        <article className="gaze-debug-block">
          <h4>Session</h4>
          <p>Status: {trackingStatus}</p>
          <p>Secure Context: {secureContext ? "yes" : "no"}</p>
          <p>Camera Permission: {formatCameraPermission(cameraPermission)}</p>
          <p>Gaze Enabled: {gazeEnabled ? "yes" : "no"}</p>
          <p>Manual Running: {manualRunning ? "yes" : "no"}</p>
          <p>Effective Running: {effectiveRunning ? "yes" : "no"}</p>
          <p>Auto Paused: {gazeAutoPaused ? "yes" : "no"}</p>
          {gazeAutoPausedReason ? <p>Pause Reason: {gazeAutoPausedReason}</p> : null}
          {trackingError ? <p className="gaze-debug-error">Error: {trackingError}</p> : null}
        </article>

        <article className="gaze-debug-block">
          <h4>Live Feature</h4>
          <p>Raw: {latestRawFeature !== null ? latestRawFeature.toFixed(4) : "--"}</p>
          <p>Smoothed: {latestSmoothFeature !== null ? latestSmoothFeature.toFixed(4) : "--"}</p>
          <p>Zone: {zone}</p>
          <p>Dwell: {formatDwell(zoneDwellMs)}</p>
          <p>Inference FPS: {telemetry.inferenceFps.toFixed(1)}</p>
          <p>Detection Rate: {telemetry.detectionRate.toFixed(1)}%</p>
          <p>Inferences: {telemetry.inferenceCount}</p>
          <p>Detections: {telemetry.detectionCount}</p>
          <p>Missed: {telemetry.missedCount}</p>
          <p>Since Last Detection: {Math.round(telemetry.elapsedSinceDetectionMs)} ms</p>
          <p>
            Video: {telemetry.videoWidth}x{telemetry.videoHeight}
          </p>
        </article>

        <article className="gaze-debug-block">
          <h4>Calibration</h4>
          {calibration ? (
            <>
              <p>Threshold: {calibration.threshold.toFixed(4)}</p>
              <p>ON Value: {calibration.onValue.toFixed(4)}</p>
              <p>OFF Value: {calibration.offValue.toFixed(4)}</p>
              <p>ON&gt;OFF: {calibration.onHigherThanOff ? "yes" : "no"}</p>
              <p>Separation: {calibration.separation.toFixed(4)}</p>
              <p>ON StdDev: {calibration.onStdDev.toFixed(4)}</p>
              <p>OFF StdDev: {calibration.offStdDev.toFixed(4)}</p>
              <p>Effective Vertical Bound: {hysteresisBand.toFixed(4)}</p>
            </>
          ) : (
            <p>No calibration profile loaded.</p>
          )}
        </article>

        <article className="gaze-debug-block camera">
          <h4>Camera Preview</h4>
          {debugStream ? (
            <div className="gaze-debug-video-wrap">
              <video ref={previewVideoRef} autoPlay muted playsInline className="gaze-debug-video" />
              <div className="gaze-debug-video-overlay" aria-hidden="true">
                {previewThresholdPercent !== null ? (
                  <div className="gaze-debug-overlay-line threshold" style={{ top: `${previewThresholdPercent}%` }} />
                ) : null}
                {previewBandUpperPercent !== null ? (
                  <div className="gaze-debug-overlay-line band" style={{ top: `${previewBandUpperPercent}%` }} />
                ) : null}
                {previewBandLowerPercent !== null ? (
                  <div className="gaze-debug-overlay-line band" style={{ top: `${previewBandLowerPercent}%` }} />
                ) : null}
                {markerYPercent !== null ? (
                  <>
                    <div className="gaze-debug-overlay-line marker" style={{ top: `${markerYPercent}%`, borderColor: markerColor }} />
                    <div className="gaze-debug-overlay-dot" style={{ top: `${markerYPercent}%`, backgroundColor: markerColor }} />
                  </>
                ) : null}
              </div>
            </div>
          ) : (
            <p>No stream active.</p>
          )}
        </article>
      </section>

      <section className="gaze-debug-trace">
        <header>
          <strong>Feature Trace</strong>
          <span>{orderedTrace.length} points</span>
        </header>
        <svg viewBox={`0 0 ${TRACE_VIEW_WIDTH} ${TRACE_VIEW_HEIGHT}`} className="gaze-debug-chart" role="img" aria-label="Feature trace">
          <rect x="0" y="0" width={TRACE_VIEW_WIDTH} height={TRACE_VIEW_HEIGHT} />
          {thresholdBaseY !== null ? <line x1="0" y1={thresholdBaseY} x2={TRACE_VIEW_WIDTH} y2={thresholdBaseY} className="threshold base" /> : null}
          {thresholdUpperY !== null ? (
            <line x1="0" y1={thresholdUpperY} x2={TRACE_VIEW_WIDTH} y2={thresholdUpperY} className="threshold band" />
          ) : null}
          {thresholdLowerY !== null ? (
            <line x1="0" y1={thresholdLowerY} x2={TRACE_VIEW_WIDTH} y2={thresholdLowerY} className="threshold band" />
          ) : null}
          {rawPath ? <path d={rawPath} className="raw-line" /> : null}
          {smoothPath ? <path d={smoothPath} className="smooth-line" /> : null}
        </svg>
      </section>

      <section className="gaze-debug-events">
        <header>
          <strong>Event Timeline</strong>
          <span>{events.length}</span>
        </header>
        <div className="gaze-debug-event-list">
          {events.length === 0 ? <p className="gaze-debug-empty">No events yet.</p> : null}
          {events.map((event) => (
            <article key={event.id} className={`gaze-debug-event ${event.level}`}>
              <div className="gaze-debug-event-head">
                <span>{event.code}</span>
                <span>{formatEventTime(event.createdAtMs)}</span>
              </div>
              <p>{event.message}</p>
            </article>
          ))}
        </div>
      </section>
    </aside>
  );
};
