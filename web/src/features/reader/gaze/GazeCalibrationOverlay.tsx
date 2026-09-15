import { useCallback, useEffect, useMemo, useRef, useState, type FC } from "react";

import { buildTwoPointCalibration, type GazeCalibrationProfile } from "./gazeCalibration";
import { GAZE_TUNING } from "./gazeTuning";
import type { IrisTrackingStatus } from "./useIrisGaze";

interface GazeCalibrationOverlayProps {
  open: boolean;
  sampleTick: { id: number; feature: number; timestampMs: number } | null;
  trackingStatus: IrisTrackingStatus;
  onCancel: () => void;
  onComplete: (profile: GazeCalibrationProfile) => void;
}

type CalibrationTarget = "on" | "off";

interface CaptureSession {
  target: CalibrationTarget;
  startedAtMs: number;
  settleUntilMs: number;
  deadlineMs: number;
  samples: number[];
}

const CAPTURE_DURATION_MS = GAZE_TUNING.calibration.captureDurationMs;
const CAPTURE_SETTLE_MS = GAZE_TUNING.calibration.captureSettleMs;
const CAPTURE_MIN_SAMPLES = GAZE_TUNING.calibration.minSampleCount;

export const GazeCalibrationOverlay: FC<GazeCalibrationOverlayProps> = ({
  open,
  sampleTick,
  trackingStatus,
  onCancel,
  onComplete,
}) => {
  const [activeTarget, setActiveTarget] = useState<CalibrationTarget>("on");
  const [onSamples, setOnSamples] = useState<number[]>([]);
  const [offSamples, setOffSamples] = useState<number[]>([]);
  const [captureProgress, setCaptureProgress] = useState(0);
  const [statusText, setStatusText] = useState("Capture ON point: look at RSVP text.");
  const [warnings, setWarnings] = useState<string[]>([]);

  const captureRef = useRef<CaptureSession | null>(null);

  const onCount = onSamples.length;
  const offCount = offSamples.length;
  const canStartCapture = trackingStatus === "tracking" && captureRef.current === null;
  const hasAnyCapture = onCount > 0 || offCount > 0;
  const readyForReview = onCount >= CAPTURE_MIN_SAMPLES && offCount >= CAPTURE_MIN_SAMPLES;

  const reset = useCallback((): void => {
    captureRef.current = null;
    setActiveTarget("on");
    setOnSamples([]);
    setOffSamples([]);
    setCaptureProgress(0);
    setWarnings([]);
    setStatusText("Capture ON point: look at RSVP text.");
  }, []);

  useEffect(() => {
    if (!open) {
      reset();
    }
  }, [open, reset]);

  const finalizeCapture = useCallback((session: CaptureSession): void => {
    const safeSamples = session.samples.filter((value) => Number.isFinite(value));
    if (safeSamples.length < CAPTURE_MIN_SAMPLES) {
      setStatusText(`Not enough stable samples for ${session.target.toUpperCase()} point. Try again.`);
      setCaptureProgress(0);
      captureRef.current = null;
      return;
    }

    if (session.target === "on") {
      setOnSamples(safeSamples);
      setActiveTarget("off");
      setStatusText("ON point captured. Now capture OFF point: look at context text.");
    } else {
      setOffSamples(safeSamples);
      setStatusText("OFF point captured. Review and save calibration.");
    }
    setCaptureProgress(0);
    captureRef.current = null;
  }, []);

  useEffect(() => {
    const session = captureRef.current;
    if (!session || !sampleTick || trackingStatus !== "tracking") {
      return;
    }

    const now = sampleTick.timestampMs;
    if (now < session.settleUntilMs) {
      return;
    }

    session.samples.push(sampleTick.feature);
    const progress = Math.max(0, Math.min(1, (now - session.startedAtMs) / CAPTURE_DURATION_MS));
    setCaptureProgress(progress);

    if (now >= session.deadlineMs) {
      finalizeCapture(session);
    }
  }, [finalizeCapture, sampleTick, trackingStatus]);

  const startCapture = useCallback((): void => {
    if (!canStartCapture) {
      return;
    }
    const now = performance.now();
    captureRef.current = {
      target: activeTarget,
      startedAtMs: now,
      settleUntilMs: now + CAPTURE_SETTLE_MS,
      deadlineMs: now + CAPTURE_DURATION_MS,
      samples: [],
    };
    setCaptureProgress(0);
    setWarnings([]);
    const label = activeTarget === "on" ? "ON" : "OFF";
    setStatusText(`Capturing ${label} point... keep your head steady.`);
  }, [activeTarget, canStartCapture]);

  const markerClass = useMemo(() => {
    if (captureRef.current) {
      return `gaze-calibration-target ${captureRef.current.target}`;
    }
    return `gaze-calibration-target ${activeTarget}`;
  }, [activeTarget, sampleTick]);

  const saveCalibration = useCallback((): void => {
    const result = buildTwoPointCalibration(onSamples, offSamples);
    if (!result.profile) {
      setWarnings(result.warnings);
      setStatusText("Calibration quality too low. Retry capture.");
      return;
    }
    setWarnings(result.warnings);
    onComplete(result.profile);
    reset();
  }, [offSamples, onComplete, onSamples, reset]);

  if (!open) {
    return null;
  }

  return (
    <div className="gaze-calibration-overlay" role="dialog" aria-modal="true" aria-label="Eye tracking calibration">
      <div className={markerClass} />
      <section className="gaze-calibration-card">
        <h3>Eye Calibration</h3>
        <p className="gaze-calibration-text">{statusText}</p>
        <p className="gaze-calibration-text">
          Tracking: <strong>{trackingStatus}</strong>
        </p>
        <p className="gaze-calibration-text">
          ON samples: <strong>{onCount}</strong> | OFF samples: <strong>{offCount}</strong>
        </p>

        {captureRef.current ? (
          <div className="gaze-calibration-progress" aria-label="Capture progress">
            <span style={{ width: `${Math.round(captureProgress * 100)}%` }} />
          </div>
        ) : null}

        {warnings.length > 0 ? (
          <div className="gaze-calibration-warnings">
            {warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </div>
        ) : null}

        <div className="gaze-calibration-actions">
          <button type="button" className="btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn-ghost" onClick={reset} disabled={!hasAnyCapture}>
            Reset
          </button>
          <button type="button" onClick={startCapture} disabled={!canStartCapture}>
            Capture {activeTarget.toUpperCase()}
          </button>
          <button type="button" onClick={saveCalibration} disabled={!readyForReview || captureRef.current !== null}>
            Save
          </button>
        </div>
      </section>
    </div>
  );
};
