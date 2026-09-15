import { GAZE_TUNING } from "./gazeTuning";

export interface IrisDetection {
  feature: number;
  horizontalFeature: number;
}

export interface IrisEngine {
  detect(video: HTMLVideoElement, timestampMs: number): IrisDetection | null;
  close(): void;
}

interface LandmarkPoint {
  x: number;
  y: number;
  z: number;
}

interface FaceLandmarkerResult {
  faceLandmarks?: LandmarkPoint[][];
}

interface FaceLandmarkerLike {
  detectForVideo(video: HTMLVideoElement, timestampMs: number): FaceLandmarkerResult;
  close(): void;
}

interface FilesetResolverLike {
  forVisionTasks(wasmRoot: string): Promise<unknown>;
}

interface FaceLandmarkerNamespaceLike {
  createFromOptions(vision: unknown, options: Record<string, unknown>): Promise<FaceLandmarkerLike>;
}

interface MediaPipeTasksVisionLike {
  FilesetResolver: FilesetResolverLike;
  FaceLandmarker: FaceLandmarkerNamespaceLike;
}

const TASKS_VISION_VERSION = "0.10.14";
const TASKS_VISION_MODULE_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/+esm`;
const TASKS_VISION_WASM_ROOT = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`;
const FACE_LANDMARKER_MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

const LEFT_IRIS_INDICES = [468, 469, 470, 471, 472];
const RIGHT_IRIS_INDICES = [473, 474, 475, 476, 477];
const LEFT_UPPER_LID = 159;
const LEFT_LOWER_LID = 145;
const RIGHT_UPPER_LID = 386;
const RIGHT_LOWER_LID = 374;
const LEFT_EYE_CORNER_A = 33;
const LEFT_EYE_CORNER_B = 133;
const RIGHT_EYE_CORNER_A = 362;
const RIGHT_EYE_CORNER_B = 263;
const MIN_VERTICAL_SPAN = GAZE_TUNING.irisEngine.minVerticalSpan;
const MIN_HORIZONTAL_SPAN = GAZE_TUNING.irisEngine.minHorizontalSpan;

async function importTasksVision(): Promise<MediaPipeTasksVisionLike> {
  const dynamicImport = new Function("moduleUrl", "return import(moduleUrl);") as (moduleUrl: string) => Promise<unknown>;
  const imported = (await dynamicImport(TASKS_VISION_MODULE_URL)) as Partial<MediaPipeTasksVisionLike>;
  if (!imported?.FilesetResolver || !imported?.FaceLandmarker) {
    throw new Error("Unable to load MediaPipe Tasks Vision module.");
  }
  return imported as MediaPipeTasksVisionLike;
}

function averageY(landmarks: LandmarkPoint[], indices: number[]): number | null {
  let total = 0;
  let count = 0;
  for (const index of indices) {
    const point = landmarks[index];
    if (!point) {
      continue;
    }
    total += point.y;
    count += 1;
  }
  if (count === 0) {
    return null;
  }
  return total / count;
}

function averageX(landmarks: LandmarkPoint[], indices: number[]): number | null {
  let total = 0;
  let count = 0;
  for (const index of indices) {
    const point = landmarks[index];
    if (!point) {
      continue;
    }
    total += point.x;
    count += 1;
  }
  if (count === 0) {
    return null;
  }
  return total / count;
}

function computeVerticalRatio(irisY: number | null, upperY: number | undefined, lowerY: number | undefined): number | null {
  if (irisY === null || upperY === undefined || lowerY === undefined) {
    return null;
  }
  const span = lowerY - upperY;
  if (!Number.isFinite(span) || Math.abs(span) < MIN_VERTICAL_SPAN) {
    return null;
  }
  return (irisY - upperY) / span;
}

function computeVerticalGazeFeature(landmarks: LandmarkPoint[]): number | null {
  const leftIrisY = averageY(landmarks, LEFT_IRIS_INDICES);
  const rightIrisY = averageY(landmarks, RIGHT_IRIS_INDICES);

  const left = computeVerticalRatio(leftIrisY, landmarks[LEFT_UPPER_LID]?.y, landmarks[LEFT_LOWER_LID]?.y);
  const right = computeVerticalRatio(rightIrisY, landmarks[RIGHT_UPPER_LID]?.y, landmarks[RIGHT_LOWER_LID]?.y);
  if (left === null && right === null) {
    return null;
  }
  if (left === null) {
    return right;
  }
  if (right === null) {
    return left;
  }
  return (left + right) / 2;
}

function computeHorizontalRatio(irisX: number | null, cornerA: number | undefined, cornerB: number | undefined): number | null {
  if (irisX === null || cornerA === undefined || cornerB === undefined) {
    return null;
  }
  const minCorner = Math.min(cornerA, cornerB);
  const maxCorner = Math.max(cornerA, cornerB);
  const span = maxCorner - minCorner;
  if (!Number.isFinite(span) || span < MIN_HORIZONTAL_SPAN) {
    return null;
  }
  return (irisX - minCorner) / span;
}

function computeHorizontalGazeFeature(landmarks: LandmarkPoint[]): number | null {
  const leftIrisX = averageX(landmarks, LEFT_IRIS_INDICES);
  const rightIrisX = averageX(landmarks, RIGHT_IRIS_INDICES);
  const left = computeHorizontalRatio(leftIrisX, landmarks[LEFT_EYE_CORNER_A]?.x, landmarks[LEFT_EYE_CORNER_B]?.x);
  const right = computeHorizontalRatio(rightIrisX, landmarks[RIGHT_EYE_CORNER_A]?.x, landmarks[RIGHT_EYE_CORNER_B]?.x);
  if (left === null && right === null) {
    return null;
  }
  if (left === null) {
    return right;
  }
  if (right === null) {
    return left;
  }
  return (left + right) / 2;
}

export async function createMediaPipeIrisEngine(): Promise<IrisEngine> {
  const tasksVision = await importTasksVision();
  const vision = await tasksVision.FilesetResolver.forVisionTasks(TASKS_VISION_WASM_ROOT);
  const faceLandmarker = await tasksVision.FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: FACE_LANDMARKER_MODEL,
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numFaces: 1,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: false,
  });

  return {
    detect(video: HTMLVideoElement, timestampMs: number): IrisDetection | null {
      const result = faceLandmarker.detectForVideo(video, timestampMs);
      const landmarks = result.faceLandmarks?.[0];
      if (!landmarks || landmarks.length < RIGHT_IRIS_INDICES[RIGHT_IRIS_INDICES.length - 1] + 1) {
        return null;
      }
      const feature = computeVerticalGazeFeature(landmarks);
      const horizontalFeature = computeHorizontalGazeFeature(landmarks);
      if (feature === null || horizontalFeature === null || !Number.isFinite(feature) || !Number.isFinite(horizontalFeature)) {
        return null;
      }
      return { feature, horizontalFeature };
    },
    close(): void {
      faceLandmarker.close();
    },
  };
}
