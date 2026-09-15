import { GAZE_TUNING } from "./gazeTuning";

export type GazeZone = "on" | "off" | "unknown";

export interface GazeCalibrationProfile {
  version: 1;
  createdAt: number;
  onValue: number;
  offValue: number;
  threshold: number;
  onHigherThanOff: boolean;
  separation: number;
  onStdDev: number;
  offStdDev: number;
}

export interface GazeCalibrationResult {
  profile: GazeCalibrationProfile | null;
  warnings: string[];
}

export interface GazeTimingSettings {
  pauseDelayMs: number;
  resumeDelayMs: number;
}

const MIN_SAMPLE_COUNT = GAZE_TUNING.calibration.minSampleCount;
const MIN_SEPARATION = GAZE_TUNING.calibration.minSeparation;
const MAX_STDDEV_WARNING = GAZE_TUNING.calibration.maxStdDevWarning;
const MIN_EFFECTIVE_BAND = GAZE_TUNING.verticalBound.minEffective;
const MAX_BAND_FRACTION_OF_SEPARATION = GAZE_TUNING.verticalBound.maxFractionOfSeparation;
const NOISE_TO_BAND_FACTOR = GAZE_TUNING.verticalBound.noiseToBandFactor;

function toFiniteNumbers(values: number[]): number[] {
  return values.filter((value) => Number.isFinite(value));
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
}

function standardDeviation(values: number[], mean: number): number {
  if (values.length === 0) {
    return 0;
  }
  const variance =
    values.reduce((sum, value) => {
      const delta = value - mean;
      return sum + delta * delta;
    }, 0) / values.length;
  return Math.sqrt(variance);
}

export function buildTwoPointCalibration(onSamples: number[], offSamples: number[]): GazeCalibrationResult {
  const on = toFiniteNumbers(onSamples);
  const off = toFiniteNumbers(offSamples);
  const warnings: string[] = [];

  if (on.length < MIN_SAMPLE_COUNT || off.length < MIN_SAMPLE_COUNT) {
    return {
      profile: null,
      warnings: [`Not enough stable samples. Need at least ${MIN_SAMPLE_COUNT} for ON and OFF points.`],
    };
  }

  const onValue = median(on);
  const offValue = median(off);
  const separation = Math.abs(onValue - offValue);
  const onStdDev = standardDeviation(on, onValue);
  const offStdDev = standardDeviation(off, offValue);

  if (separation < MIN_SEPARATION) {
    warnings.push("ON/OFF points are too close. Recalibrate with a clearer eye shift.");
  }
  if (onStdDev > MAX_STDDEV_WARNING || offStdDev > MAX_STDDEV_WARNING) {
    warnings.push("Eye samples were noisy. Keep your head steadier during capture.");
  }

  return {
    profile: {
      version: 1,
      createdAt: Date.now(),
      onValue,
      offValue,
      threshold: (onValue + offValue) / 2,
      onHigherThanOff: onValue > offValue,
      separation,
      onStdDev,
      offStdDev,
    },
    warnings,
  };
}

export function classifyGazeZone(
  value: number,
  profile: GazeCalibrationProfile,
  hysteresisBand: number,
  previousZone: GazeZone,
): GazeZone {
  if (!Number.isFinite(value)) {
    return "unknown";
  }
  const safeBand = resolveEffectiveHysteresisBand(profile, hysteresisBand);
  const onThreshold = profile.threshold + safeBand;
  const offThreshold = profile.threshold - safeBand;

  if (profile.onHigherThanOff) {
    if (value >= onThreshold) {
      return "on";
    }
    if (value <= offThreshold) {
      return "off";
    }
  } else {
    if (value <= offThreshold) {
      return "on";
    }
    if (value >= onThreshold) {
      return "off";
    }
  }
  return previousZone;
}

export function resolveEffectiveHysteresisBand(profile: GazeCalibrationProfile, requestedBand: number): number {
  const safeRequested = Math.max(0, requestedBand);
  const maxBand = Math.max(MIN_EFFECTIVE_BAND, profile.separation * MAX_BAND_FRACTION_OF_SEPARATION);
  const noiseBand = Math.max(profile.onStdDev, profile.offStdDev) * NOISE_TO_BAND_FACTOR;
  const candidate = Math.max(MIN_EFFECTIVE_BAND, safeRequested, noiseBand);
  return Math.min(maxBand, candidate);
}

export function resolvePauseTransition(
  zone: GazeZone,
  zoneSinceMs: number,
  nowMs: number,
  currentlyPaused: boolean,
  settings: GazeTimingSettings,
): "pause" | "resume" | "none" {
  const dwellMs = Math.max(0, nowMs - zoneSinceMs);
  if (!currentlyPaused && zone === "off" && dwellMs >= settings.pauseDelayMs) {
    return "pause";
  }
  if (currentlyPaused && zone === "on" && dwellMs >= settings.resumeDelayMs) {
    return "resume";
  }
  return "none";
}

export function parseCalibrationProfile(value: unknown): GazeCalibrationProfile | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const source = value as Record<string, unknown>;
  const maybeNumber = (key: keyof GazeCalibrationProfile): number | null => {
    const raw = source[key];
    return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
  };
  const version = maybeNumber("version");
  const createdAt = maybeNumber("createdAt");
  const onValue = maybeNumber("onValue");
  const offValue = maybeNumber("offValue");
  const threshold = maybeNumber("threshold");
  const separation = maybeNumber("separation");
  const onStdDev = maybeNumber("onStdDev");
  const offStdDev = maybeNumber("offStdDev");
  const onHigherThanOff = source.onHigherThanOff;

  if (
    version !== 1 ||
    createdAt === null ||
    onValue === null ||
    offValue === null ||
    threshold === null ||
    separation === null ||
    onStdDev === null ||
    offStdDev === null ||
    typeof onHigherThanOff !== "boolean"
  ) {
    return null;
  }

  return {
    version: 1,
    createdAt,
    onValue,
    offValue,
    threshold,
    onHigherThanOff,
    separation,
    onStdDev,
    offStdDev,
  };
}
