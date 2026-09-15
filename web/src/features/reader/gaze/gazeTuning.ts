const roundToInt = (value: number): number => Math.round(value);

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// Centralized gaze tuning values. Keep all feature thresholds and ranges here so
// behavior can be tuned without chasing constants across the codebase.
export const GAZE_TUNING = {
  pipeline: {
    // Target inference rate for face/iris detection.
    targetFps: 24,
    // EMA alpha for vertical gaze smoothing. Lower values smooth more but add lag.
    smoothingAlpha: 0.16,
    // Minimum gap between trace points pushed to debug history.
    traceUpdateMinGapMs: 90,
    // Time without a detection before tracking status flips to "lost".
    lostStatusTimeoutMs: 500,
    // Minimum gap between live-sample UI refreshes.
    uiUpdateMinGapMs: 120,
    // Minimum gap between telemetry aggregate publishes.
    telemetryUpdateMinGapMs: 250,
  },
  automation: {
    pauseDelayMs: {
      // Lowest allowed pause dwell time in settings UI and clamping.
      min: 80,
      // Highest allowed pause dwell time in settings UI and clamping.
      max: 700,
      // Slider step for pause dwell adjustment.
      step: 10,
      // Default dwell time required in OFF zone before auto-pause.
      default: 170,
    },
    resumeDelayMs: {
      // Lowest allowed resume dwell time in settings UI and clamping.
      min: 100,
      // Highest allowed resume dwell time in settings UI and clamping.
      max: 900,
      // Slider step for resume dwell adjustment.
      step: 10,
      // Default dwell time required in ON zone before auto-resume.
      default: 260,
    },
    lostTrackingPauseMs: {
      // Lowest allowed fallback value for pause-on-lost-tracking delay.
      min: 200,
      // Highest allowed fallback value for pause-on-lost-tracking delay.
      max: 1500,
      // Slider step for lost-tracking pause delay.
      step: 10,
      // Default pause delay after tracking loss if a delayed strategy is used.
      default: 450,
    },
  },
  verticalBound: {
    // Lowest user-selectable hysteresis band.
    min: 0.002,
    // Highest user-selectable hysteresis band.
    max: 0.08,
    // Slider step for hysteresis band adjustments.
    step: 0.0005,
    // Default requested vertical hysteresis band.
    default: 0.012,
    // Hard floor for effective adaptive hysteresis.
    minEffective: 0.0025,
    // Caps adaptive hysteresis as a fraction of ON/OFF calibration separation.
    maxFractionOfSeparation: 0.35,
    // Scales calibration noise (std dev) into adaptive hysteresis.
    noiseToBandFactor: 0.55,
  },
  calibration: {
    // Minimum sample count required per target point (ON and OFF).
    minSampleCount: 10,
    // Minimum ON/OFF median separation before warning user to recalibrate.
    minSeparation: 0.025,
    // Std-dev threshold where capture quality warning is emitted.
    maxStdDevWarning: 0.07,
    // Per-target capture window length.
    captureDurationMs: 1200,
    // Initial settle period after starting capture before sampling begins.
    captureSettleMs: 350,
  },
  irisEngine: {
    // Minimum eyelid span used to normalize vertical iris ratio.
    minVerticalSpan: 0.001,
    // Minimum eye-corner span used to normalize horizontal iris ratio.
    minHorizontalSpan: 0.001,
  },
} as const;

export function clampGazePauseDelayMs(value: number): number {
  return clamp(roundToInt(value), GAZE_TUNING.automation.pauseDelayMs.min, GAZE_TUNING.automation.pauseDelayMs.max);
}

export function clampGazeResumeDelayMs(value: number): number {
  return clamp(roundToInt(value), GAZE_TUNING.automation.resumeDelayMs.min, GAZE_TUNING.automation.resumeDelayMs.max);
}

export function clampGazeLostPauseDelayMs(value: number): number {
  return clamp(roundToInt(value), GAZE_TUNING.automation.lostTrackingPauseMs.min, GAZE_TUNING.automation.lostTrackingPauseMs.max);
}

export function clampGazeHysteresisBand(value: number): number {
  return clamp(value, GAZE_TUNING.verticalBound.min, GAZE_TUNING.verticalBound.max);
}
