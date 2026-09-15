import type { GazeCalibrationProfile, GazeZone } from "./gazeCalibration";
import type { IrisTrackingStatus } from "./useIrisGaze";

export type CameraPermissionState = PermissionState | "unsupported" | "unknown";
export type GazeDebugEventLevel = "info" | "warn" | "error";

export interface GazeDebugEvent {
  id: string;
  createdAtMs: number;
  level: GazeDebugEventLevel;
  code: string;
  message: string;
}

export interface GazeTracePoint {
  timestampMs: number;
  rawFeature: number;
  smoothFeature: number;
  zone: GazeZone;
  trackingStatus: IrisTrackingStatus;
}

export interface GazeDebugTelemetry {
  inferenceFps: number;
  detectionRate: number;
  inferenceCount: number;
  detectionCount: number;
  missedCount: number;
  elapsedSinceDetectionMs: number;
  videoWidth: number;
  videoHeight: number;
}

export interface GazeDebugSnapshot {
  trackingStatus: IrisTrackingStatus;
  trackingError: string | null;
  secureContext: boolean;
  cameraPermission: CameraPermissionState;
  gazeEnabled: boolean;
  gazeAutoPaused: boolean;
  gazeAutoPausedReason: string | null;
  manualRunning: boolean;
  effectiveRunning: boolean;
  zone: GazeZone;
  zoneDwellMs: number;
  latestRawFeature: number | null;
  latestSmoothFeature: number | null;
  calibration: GazeCalibrationProfile | null;
}

export function appendCapped<T>(items: T[], item: T, maxItems: number): T[] {
  if (maxItems <= 0) {
    return [];
  }
  const next = [item, ...items];
  if (next.length <= maxItems) {
    return next;
  }
  return next.slice(0, maxItems);
}

export function buildGazeEvent(level: GazeDebugEventLevel, code: string, message: string): GazeDebugEvent {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAtMs: Date.now(),
    level,
    code,
    message,
  };
}

export function clampTelemetry(value: Partial<GazeDebugTelemetry> | undefined): GazeDebugTelemetry {
  return {
    inferenceFps: Math.max(0, value?.inferenceFps ?? 0),
    detectionRate: Math.max(0, Math.min(100, value?.detectionRate ?? 0)),
    inferenceCount: Math.max(0, Math.floor(value?.inferenceCount ?? 0)),
    detectionCount: Math.max(0, Math.floor(value?.detectionCount ?? 0)),
    missedCount: Math.max(0, Math.floor(value?.missedCount ?? 0)),
    elapsedSinceDetectionMs: Math.max(0, Math.floor(value?.elapsedSinceDetectionMs ?? 0)),
    videoWidth: Math.max(0, Math.floor(value?.videoWidth ?? 0)),
    videoHeight: Math.max(0, Math.floor(value?.videoHeight ?? 0)),
  };
}

export function formatCameraPermission(value: CameraPermissionState): string {
  if (value === "unsupported") {
    return "unsupported";
  }
  if (value === "unknown") {
    return "unknown";
  }
  return value;
}
