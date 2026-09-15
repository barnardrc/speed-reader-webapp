import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";

import {
  getBookContent,
  getJob,
  getProgress,
  listCredentials,
  getReaderSettings,
  requestChat,
  requestEntities,
  requestQuestion,
  saveProgress,
  saveReaderSettings,
  startParse,
  uploadBook,
} from "../../lib/api";
import type { AIRequestMode, AIRequestOptions, ProviderName, UserProfile } from "../../lib/types";
import { DEFAULT_PAUSE_MULTIPLIERS, getPauseMultiplier, type PauseKey, type PauseMultipliers } from "../../lib/pause";
import { useAuthStore } from "../../state/authStore";
import { useReaderStore } from "../../state/readerStore";
import { ChapterSidebar } from "./ChapterSidebar";
import { ContextPane } from "./ContextPane";
import { ReaderControls, type ReaderTheme } from "./ReaderControls";
import { RsvpReader } from "./RsvpReader";
import { GazeCalibrationOverlay } from "./gaze/GazeCalibrationOverlay";
import { GazeDebugPanel } from "./gaze/GazeDebugPanel";
import {
  classifyGazeZone,
  parseCalibrationProfile,
  resolvePauseTransition,
  resolveEffectiveHysteresisBand,
  type GazeCalibrationProfile,
  type GazeZone,
} from "./gaze/gazeCalibration";
import {
  appendCapped,
  buildGazeEvent,
  type CameraPermissionState,
  type GazeDebugEvent,
  type GazeTracePoint,
} from "./gaze/gazeDebug";
import {
  GAZE_TUNING,
  clampGazeHysteresisBand,
  clampGazeLostPauseDelayMs,
  clampGazePauseDelayMs,
  clampGazeResumeDelayMs,
} from "./gaze/gazeTuning";
import { useIrisGaze } from "./gaze/useIrisGaze";

const JOB_POLL_INTERVAL_MS = 1000;
const PROGRESS_SAVE_DEBOUNCE_MS = 500;
const SETTINGS_SAVE_DEBOUNCE_MS = 500;

const AI_MAX_CONTEXT_WORDS = 500;
const AI_QUESTION_OVERLAP = 50;
const AI_ENTITY_OVERLAP = 50;
const MAX_AI_PENDING_TASKS = 8;
const MAX_AI_HISTORY_ITEMS = 40;
const AUTO_AI_FAILURE_THRESHOLD = 3;
const AI_REQUEST_MIN_GAP_MS = 2000;
const AI_RATE_LIMIT_COOLDOWN_MS = 60000;
const AI_RESULT_LIMIT = 8;
const AI_ENTITY_BLACKLIST = ["chapter", "section", "part", "page", "title"] as const;
const AI_QUESTION_INTERVAL_OPTIONS = [500, 750, 1000, 2000, 3000] as const;
const FIXED_CONTEXT_MONITOR_INTERVAL = 500;
const PANE_MIN_WIDTH = 280;
const PANE_MAX_WIDTH = 640;
const PANE_MIN_HEIGHT = 220;
const PANE_MAX_HEIGHT = 700;
const GAZE_CALIBRATION_STORAGE_KEY = "speed_reader_gaze_calibration_v1";
const THEME_STORAGE_KEY = "speed_reader_theme_v1";
const MAX_GAZE_TRACE_POINTS = 240;
const MAX_GAZE_EVENTS = 120;

const SAVED_PAUSE_SETTING_KEYS: Record<PauseKey, string> = {
  period: "period_delay",
  comma: "comma_delay",
  hyphen: "hyphen_delay",
  longHyphen: "long_hyphen_delay",
  parens: "parens_delay",
  header: "header_delay",
  ellipsis: "ellipsis_delay",
};

const SAVED_READER_SETTING_KEYS = {
  wpm: "wpm",
  contextRange: "context_range",
  contextOpacity: "context_opacity",
  flankOpacity: "flank_opacity",
  theme: "theme",
} as const;

const SAVED_AI_SETTING_KEYS = {
  questionEnabled: "ai_enabled",
  questionInterval: "ai_frequency",
  entityEnabled: "entity_enabled",
  provider: "ai_provider",
  mode: "ai_mode",
  model: "ai_model",
} as const;

const SAVED_GAZE_SETTING_KEYS = {
  enabled: "gaze_enabled",
  pauseDelayMs: "gaze_pause_delay_ms",
  resumeDelayMs: "gaze_resume_delay_ms",
  hysteresisBand: "gaze_hysteresis_band",
  lostTrackingPauseMs: "gaze_lost_pause_delay_ms",
  calibrationProfile: "gaze_calibration_profile",
} as const;

interface ReaderShellProps {
  settingsOpen: boolean;
  onSettingsOpenChange: (open: boolean) => void;
  user: UserProfile | null;
  onLogIn: () => void;
  onSignUp: () => void;
  onOpenAccount: () => void;
}

interface AIAutomationSettings {
  provider: ProviderName;
  mode: AIRequestMode;
  model: string;
  questionEnabled: boolean;
  questionInterval: number;
  entityEnabled: boolean;
  entityInterval: number;
}

interface GazeAutomationSettings {
  enabled: boolean;
  pauseDelayMs: number;
  resumeDelayMs: number;
  hysteresisBand: number;
  lostTrackingPauseMs: number;
}

interface AITask {
  id: string;
  type: "question" | "entities";
  source: "Auto" | "Manual";
  triggerWordCount: number;
  contextWordCount: number;
  queuedAt: number;
  context: string;
  contextPreview: string;
}

interface AIResultItem {
  id: string;
  source: "Auto" | "Manual";
  createdAt: number;
  contextText: string;
  contextWordCount: number;
  content: string;
  entityKey?: string;
  error?: string;
}

interface QuestionFeedbackState {
  answer: string;
  feedback: string;
  loading: boolean;
  error: string | null;
}

interface PaneSize {
  width: number;
  height: number;
}

type PaneKey = "context" | "question";

interface PaneResizeState {
  pane: PaneKey;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
}

type AIQueueStatus = "pending" | "running" | "succeeded" | "failed" | "dropped";

interface AIQueueEntry {
  id: string;
  type: "question" | "entities";
  source: "Auto" | "Manual";
  status: AIQueueStatus;
  triggerWordCount: number;
  contextWordCount: number;
  contextPreview: string;
  queuedAt: number;
  startedAt?: number;
  finishedAt?: number;
  detail?: string;
}

const DEFAULT_AI_SETTINGS: AIAutomationSettings = {
  provider: "openai",
  mode: "byok",
  model: "",
  questionEnabled: true,
  questionInterval: AI_QUESTION_INTERVAL_OPTIONS[0],
  entityEnabled: true,
  entityInterval: FIXED_CONTEXT_MONITOR_INTERVAL,
};

const DEFAULT_GAZE_SETTINGS: GazeAutomationSettings = {
  enabled: false,
  pauseDelayMs: GAZE_TUNING.automation.pauseDelayMs.default,
  resumeDelayMs: GAZE_TUNING.automation.resumeDelayMs.default,
  hysteresisBand: GAZE_TUNING.verticalBound.default,
  lostTrackingPauseMs: GAZE_TUNING.automation.lostTrackingPauseMs.default,
};

const DEFAULT_CONTEXT_PANE_SIZE: PaneSize = {
  width: 460,
  height: 320,
};

const DEFAULT_QUESTION_PANE_SIZE: PaneSize = {
  width: 540,
  height: 420,
};

function createTaskId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatTime(ts: number | undefined): string {
  if (!ts) {
    return "--:--:--";
  }
  return new Date(ts).toLocaleTimeString([], { hour12: false });
}

function parseRetryAfterSeconds(message: string): number | null {
  const match = /retry after\s+(\d+)s/i.exec(message);
  if (!match) {
    return null;
  }
  const seconds = Number.parseInt(match[1] ?? "", 10);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  return seconds;
}

function buildContextPreview(chunk: string): string {
  if (!chunk) {
    return "";
  }
  const tokens = chunk.split(/\s+/).filter(Boolean);
  const short = tokens.slice(0, 16).join(" ");
  return tokens.length > 16 ? `${short} ...` : short;
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function parseEntityLine(rawLine: string): { label: string; key: string } | null {
  const cleaned = rawLine
    .trim()
    .replace(/^(\d+[\).:-]\s*)?[-*•\u2022]?\s*/, "")
    .replace(/\*\*/g, "")
    .trim();
  if (!cleaned || cleaned.toLowerCase().startsWith("none")) {
    return null;
  }

  const separators = [" - ", " — ", " – ", ": "];
  let separatorIndex = -1;
  separators.forEach((separator) => {
    const idx = cleaned.indexOf(separator);
    if (idx > 0 && (separatorIndex < 0 || idx < separatorIndex)) {
      separatorIndex = idx;
    }
  });
  if (separatorIndex <= 0) {
    return null;
  }

  const namePart = cleaned.slice(0, separatorIndex).trim();
  const key = namePart.toLowerCase();
  if (
    !namePart ||
    key === "people" ||
    key === "dates" ||
    key === "characters" ||
    key === "entities" ||
    key === "important people" ||
    key === "important dates" ||
    AI_ENTITY_BLACKLIST.some((term) => key.includes(term))
  ) {
    return null;
  }
  return { label: cleaned, key };
}

function parseEntityEntries(rawText: string): Array<{ label: string; key: string }> {
  const entries: Array<{ label: string; key: string }> = [];
  const seen = new Set<string>();
  const lines = rawText.split(/\r?\n/);
  lines.forEach((line) => {
    const parsed = parseEntityLine(line);
    if (!parsed || seen.has(parsed.key)) {
      return;
    }
    seen.add(parsed.key);
    entries.push(parsed);
  });

  if (entries.length === 0 && rawText.includes(";")) {
    rawText.split(";").forEach((segment) => {
      const parsed = parseEntityLine(segment);
      if (!parsed || seen.has(parsed.key)) {
        return;
      }
      seen.add(parsed.key);
      entries.push(parsed);
    });
  }

  return entries;
}

function isEntityNoneResponse(rawText: string): boolean {
  const normalized = rawText.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  if (normalized === "none" || normalized === "none.") {
    return true;
  }
  if (normalized.startsWith("no entities") || normalized.startsWith("no dates") || normalized.startsWith("no people")) {
    return true;
  }
  return false;
}

function collectExistingEntityKeys(items: AIResultItem[]): Set<string> {
  const keys = new Set<string>();
  items.forEach((item) => {
    if (item.entityKey) {
      keys.add(item.entityKey);
      return;
    }
    const parsed = parseEntityLine(item.content);
    if (parsed) {
      keys.add(parsed.key);
    }
  });
  return keys;
}

function sanitizeAiOutput(raw: string): string {
  const stripped = raw
    .replace(/^```[a-z]*\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  if (!stripped) {
    return "";
  }

  const lines = stripped.split(/\r?\n/);
  let startIndex = 0;
  while (startIndex < lines.length) {
    const value = lines[startIndex]?.trim().toLowerCase() ?? "";
    if (!value) {
      startIndex += 1;
      continue;
    }
    if (value.startsWith("context:") || value.startsWith("text chunk:")) {
      startIndex += 1;
      continue;
    }
    break;
  }

  const filtered = lines.slice(startIndex).join("\n").trim();
  return filtered || stripped;
}

function renderMarkdownWithBold(text: string): ReactNode {
  const lines = text.split(/\r?\n/);
  return lines.map((line, lineIdx) => {
    const tokens = line.split(/(\*\*[^*]+\*\*)/g).filter((value) => value.length > 0);
    return (
      <span key={`line-${lineIdx}`}>
        {tokens.map((token, tokenIdx) => {
          if (token.startsWith("**") && token.endsWith("**") && token.length > 4) {
            return <strong key={`token-${lineIdx}-${tokenIdx}`}>{token.slice(2, -2)}</strong>;
          }
          return <span key={`token-${lineIdx}-${tokenIdx}`}>{token}</span>;
        })}
        {lineIdx < lines.length - 1 ? <br /> : null}
      </span>
    );
  });
}

function buildComprehensionFeedbackPrompt(contextText: string, questionText: string, userAnswer: string): string {
  return [
    `Context: "${contextText}"`,
    `Question: "${questionText}"`,
    `User Answer: "${userAnswer}"`,
    "",
    "Task: Give full comprehension feedback in 4-8 sentences.",
    "Include: 1) Verdict (Correct/Incorrect), 2) Missing key facts, 3) Specific corrections, 4) Closure.",
    "Format: Use **bold** for key terms.",
  ].join("\n");
}

function clampPaneSize(size: PaneSize): PaneSize {
  const viewportWidth = typeof window === "undefined" ? PANE_MAX_WIDTH : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? PANE_MAX_HEIGHT : window.innerHeight;
  const maxWidth = Math.min(PANE_MAX_WIDTH, Math.max(PANE_MIN_WIDTH, Math.floor(viewportWidth * 0.75)));
  const maxHeight = Math.min(PANE_MAX_HEIGHT, Math.max(PANE_MIN_HEIGHT, Math.floor(viewportHeight * 0.82)));
  return {
    width: Math.min(maxWidth, Math.max(PANE_MIN_WIDTH, Math.round(size.width))),
    height: Math.min(maxHeight, Math.max(PANE_MIN_HEIGHT, Math.round(size.height))),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function isEditableEventTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  const tag = target.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") {
    return true;
  }
  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

function readFiniteNumber(source: Record<string, unknown>, key: string): number | undefined {
  const raw = source[key];
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }
  return undefined;
}

function readBoolean(source: Record<string, unknown>, key: string): boolean | undefined {
  const raw = source[key];
  if (typeof raw === "boolean") {
    return raw;
  }
  if (typeof raw === "number") {
    return raw !== 0;
  }
  if (typeof raw === "string") {
    const normalized = raw.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes") {
      return true;
    }
    if (normalized === "false" || normalized === "0" || normalized === "no") {
      return false;
    }
  }
  return undefined;
}

function readString(source: Record<string, unknown>, key: string): string | undefined {
  const raw = source[key];
  if (typeof raw !== "string") {
    return undefined;
  }
  const normalized = raw.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function readRecord(source: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const raw = source[key];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  return raw as Record<string, unknown>;
}

function normalizeProvider(value: string | undefined): ProviderName | undefined {
  if (!value) {
    return undefined;
  }
  if (value === "openai" || value === "anthropic" || value === "gemini" || value === "ollama") {
    return value;
  }
  return undefined;
}

function normalizeMode(value: string | undefined): AIRequestMode | undefined {
  if (!value) {
    return undefined;
  }
  if (value === "auto" || value === "byok" || value === "managed") {
    return value;
  }
  return undefined;
}

function normalizeTheme(value: string | undefined): ReaderTheme | undefined {
  if (!value) {
    return undefined;
  }
  if (value === "default" || value === "dark") {
    return "dark";
  }
  if (value === "light" || value === "teal-dawn") {
    return value;
  }
  return undefined;
}

function readStoredTheme(): ReaderTheme | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  try {
    const rawTheme = window.localStorage.getItem(THEME_STORAGE_KEY) ?? undefined;
    return normalizeTheme(rawTheme);
  } catch {
    return undefined;
  }
}

function normalizeQuestionInterval(value: number): number {
  const rounded = Math.round(value);
  let nearest: number = AI_QUESTION_INTERVAL_OPTIONS[0];
  let distance = Math.abs(rounded - nearest);
  for (const option of AI_QUESTION_INTERVAL_OPTIONS.slice(1)) {
    const optionDistance = Math.abs(rounded - option);
    if (optionDistance < distance) {
      nearest = option;
      distance = optionDistance;
    }
  }
  return nearest;
}

function dedupeProviders(providers: ProviderName[]): ProviderName[] {
  return providers.filter((provider, index) => providers.indexOf(provider) === index);
}

function resolveAutoAiProvider(savedProvider: ProviderName | undefined, credentialProviders: ProviderName[]): ProviderName | undefined {
  if (credentialProviders.length === 0) {
    return undefined;
  }

  if (savedProvider && credentialProviders.includes(savedProvider)) {
    return savedProvider;
  }

  if (credentialProviders.length === 1) {
    return credentialProviders[0];
  }

  if (credentialProviders.includes("ollama")) {
    return "ollama";
  }

  return credentialProviders[0];
}

function buildSettingsPayload(
  settings: { wpm: number; contextRange: number; contextOpacity: number; flankOpacity: number },
  pauseMultipliers: PauseMultipliers,
  aiSettings: AIAutomationSettings,
  gazeSettings: GazeAutomationSettings,
  theme: ReaderTheme,
  gazeCalibrationProfile: GazeCalibrationProfile | null,
): Record<string, unknown> {
  return {
    wpm: settings.wpm,
    context_range: settings.contextRange,
    flank_opacity: settings.flankOpacity,
    context_opacity: settings.contextOpacity,
    theme,
    period_delay: pauseMultipliers.period,
    comma_delay: pauseMultipliers.comma,
    hyphen_delay: pauseMultipliers.hyphen,
    long_hyphen_delay: pauseMultipliers.longHyphen,
    parens_delay: pauseMultipliers.parens,
    header_delay: pauseMultipliers.header,
    ellipsis_delay: pauseMultipliers.ellipsis,
    ai_enabled: aiSettings.questionEnabled,
    ai_frequency: aiSettings.questionInterval,
    entity_enabled: aiSettings.entityEnabled,
    entity_frequency: aiSettings.entityInterval,
    ai_provider: aiSettings.provider,
    ai_mode: aiSettings.mode,
    ai_model: aiSettings.model,
    gaze_enabled: gazeSettings.enabled,
    gaze_pause_delay_ms: gazeSettings.pauseDelayMs,
    gaze_resume_delay_ms: gazeSettings.resumeDelayMs,
    gaze_hysteresis_band: gazeSettings.hysteresisBand,
    gaze_lost_pause_delay_ms: gazeSettings.lostTrackingPauseMs,
    gaze_calibration_profile: gazeCalibrationProfile,
  };
}

async function waitForParseJob(jobId: string, onProgress: (value: number) => void): Promise<void> {
  while (true) {
    const status = await getJob(jobId);
    const progressValue = Number(status.result.progress ?? 0);
    onProgress(progressValue);

    if (status.status === "failed") {
      throw new Error(status.error ?? "Parse job failed");
    }
    if (status.status === "succeeded") {
      return;
    }

    await sleep(JOB_POLL_INTERVAL_MS);
  }
}

export function ReaderShell({
  settingsOpen,
  onSettingsOpenChange,
  user,
  onLogIn,
  onSignUp,
  onOpenAccount,
}: ReaderShellProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [chaptersOpen, setChaptersOpen] = useState(false);
  const [pauseMultipliers, setPauseMultipliers] = useState<PauseMultipliers>(DEFAULT_PAUSE_MULTIPLIERS);
  const [statusText, setStatusText] = useState("No book loaded.");
  const [readerTheme, setReaderTheme] = useState<ReaderTheme>(() => readStoredTheme() ?? "dark");
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [progressReadyTitle, setProgressReadyTitle] = useState<string | null>(null);
  const [aiSettings, setAiSettings] = useState<AIAutomationSettings>(DEFAULT_AI_SETTINGS);
  const [gazeSettings, setGazeSettings] = useState<GazeAutomationSettings>(DEFAULT_GAZE_SETTINGS);
  const [gazeCalibration, setGazeCalibration] = useState<GazeCalibrationProfile | null>(null);
  const [gazeCalibrationOpen, setGazeCalibrationOpen] = useState(false);
  const [gazeDebugOpen, setGazeDebugOpen] = useState(false);
  const [gazeAutoPaused, setGazeAutoPaused] = useState(false);
  const [gazeAutoPausedReason, setGazeAutoPausedReason] = useState<string | null>(null);
  const [gazeCalibrationSampleTick, setGazeCalibrationSampleTick] = useState<{
    id: number;
    feature: number;
    timestampMs: number;
  } | null>(null);
  const [cameraPermissionState, setCameraPermissionState] = useState<CameraPermissionState>("unknown");
  const [gazeDebugEvents, setGazeDebugEvents] = useState<GazeDebugEvent[]>([]);
  const [gazeTrace, setGazeTrace] = useState<GazeTracePoint[]>([]);
  const [gazeZone, setGazeZone] = useState<GazeZone>("unknown");
  const [gazeZoneSinceMs, setGazeZoneSinceMs] = useState(0);
  const [aiPending, setAiPending] = useState<AITask[]>([]);
  const [aiActive, setAiActive] = useState<AITask | null>(null);
  const [aiQueueOpen, setAiQueueOpen] = useState(false);
  const [aiHistory, setAiHistory] = useState<AIQueueEntry[]>([]);
  const [aiAutoPaused, setAiAutoPaused] = useState(false);
  const [aiAutoPausedReason, setAiAutoPausedReason] = useState<string | null>(null);
  const [aiCooldownUntil, setAiCooldownUntil] = useState<number | null>(null);
  const [contextInsights, setContextInsights] = useState<AIResultItem[]>([]);
  const [questionInsights, setQuestionInsights] = useState<AIResultItem[]>([]);
  const [questionFeedbackById, setQuestionFeedbackById] = useState<Record<string, QuestionFeedbackState>>({});
  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(null);
  const [contextPaneOpen, setContextPaneOpen] = useState(false);
  const [questionPaneOpen, setQuestionPaneOpen] = useState(false);
  const [contextSeenCount, setContextSeenCount] = useState(0);
  const [questionSeenCount, setQuestionSeenCount] = useState(0);
  const [paneSizes, setPaneSizes] = useState<{ context: PaneSize; question: PaneSize }>({
    context: clampPaneSize(DEFAULT_CONTEXT_PANE_SIZE),
    question: clampPaneSize(DEFAULT_QUESTION_PANE_SIZE),
  });

  const questionBufferRef = useRef<string[]>([]);
  const entityBufferRef = useRef<string[]>([]);
  const lastProcessedIndexRef = useRef<number>(-1);
  const autoFailureCountRef = useRef(0);
  const lastAiRequestAtRef = useRef(0);
  const queueDispatchInProgressRef = useRef(false);
  const paneResizeRef = useRef<PaneResizeState | null>(null);
  const gazeSettingsRef = useRef<GazeAutomationSettings>(DEFAULT_GAZE_SETTINGS);
  const gazeCalibrationRef = useRef<GazeCalibrationProfile | null>(null);
  const gazeAutoPausedRef = useRef(false);
  const manualRunningRef = useRef(false);
  const gazeZoneRef = useRef<GazeZone>("unknown");
  const gazeZoneSinceRef = useRef(0);
  const gazeLostSinceRef = useRef<number | null>(null);
  const gazeCalibrationOpenRef = useRef(false);
  const lastTraceUpdateAtRef = useRef(0);
  const prevGazeTrackingStatusRef = useRef<string>("disabled");
  const prevGazeTrackingErrorRef = useRef<string | null>(null);
  const prevGazeEnabledRef = useRef(DEFAULT_GAZE_SETTINGS.enabled);
  const prevEffectiveHysteresisRef = useRef<number | null>(null);

  const isAuthenticated = useAuthStore((state) => Boolean(state.token && state.user));

  const {
    bookId,
    filename,
    words,
    chapters,
    index,
    isRunning,
    settings,
    setBook,
    setIndex,
    jumpBy,
    jumpToChapter,
    nextWord: advanceWord,
    toggleRunning,
    setWpm,
    setContextRange,
    setContextOpacity,
    setFlankOpacity,
  } = useReaderStore();

  const currentWord = words[index] ?? "Ready";
  const prevWord = index > 0 ? words[index - 1] : "";
  const nextWordText = index + 1 < words.length ? words[index + 1] : "";
  const selectedFileLabel = selectedFile?.name ?? "Choose Book";
  const currentBookTitle = filename ?? "";

  const progress = useMemo(() => {
    if (words.length === 0) {
      return 0;
    }
    return Math.round((index / words.length) * 100);
  }, [index, words.length]);

  const toolbarTitle = filename ?? statusText;
  const aiFailedCount = useMemo(() => aiHistory.filter((item) => item.status === "failed").length, [aiHistory]);
  const aiSucceededCount = useMemo(() => aiHistory.filter((item) => item.status === "succeeded").length, [aiHistory]);
  const aiDroppedCount = useMemo(() => aiHistory.filter((item) => item.status === "dropped").length, [aiHistory]);
  const aiRequestOptions = useMemo<AIRequestOptions>(
    () => ({
      provider: aiSettings.provider,
      mode: aiSettings.mode,
      model: aiSettings.model.trim() || undefined,
    }),
    [aiSettings.model, aiSettings.mode, aiSettings.provider],
  );
  const activeQuestionItem = useMemo(
    () => questionInsights.find((item) => item.id === activeQuestionId) ?? questionInsights[0] ?? null,
    [activeQuestionId, questionInsights],
  );
  const activeQuestionFeedback = useMemo<QuestionFeedbackState>(
    () =>
      activeQuestionItem
        ? (questionFeedbackById[activeQuestionItem.id] ?? {
            answer: "",
            feedback: "",
            loading: false,
            error: null,
          })
        : {
            answer: "",
            feedback: "",
            loading: false,
            error: null,
          },
    [activeQuestionItem, questionFeedbackById],
  );
  const activeQuestionHasFeedback =
    activeQuestionFeedback.feedback.trim().length > 0 && !activeQuestionFeedback.error;
  const activeQuestionActionDisabled =
    activeQuestionFeedback.loading ||
    (!activeQuestionHasFeedback && activeQuestionFeedback.answer.trim().length === 0);
  const contextHasNew = contextInsights.length > contextSeenCount;
  const questionHasNew = questionInsights.length > questionSeenCount;
  const pushGazeEvent = useCallback((level: "info" | "warn" | "error", code: string, message: string): void => {
    setGazeDebugEvents((current) => appendCapped(current, buildGazeEvent(level, code, message), MAX_GAZE_EVENTS));
  }, []);
  const clearGazeEvents = useCallback((): void => {
    setGazeDebugEvents([]);
  }, []);
  const clearGazeTrace = useCallback((): void => {
    setGazeTrace([]);
  }, []);
  const onGazeSample = useCallback((sample: { feature: number; rawFeature: number; timestampMs: number }): void => {
    const currentSettings = gazeSettingsRef.current;
    const currentCalibration = gazeCalibrationRef.current;
    const previousZone = gazeZoneRef.current;
    if (gazeZoneSinceRef.current <= 0) {
      gazeZoneSinceRef.current = sample.timestampMs;
      setGazeZoneSinceMs(sample.timestampMs);
    }
    const nextZone = currentCalibration
      ? classifyGazeZone(sample.feature, currentCalibration, currentSettings.hysteresisBand, previousZone)
      : "unknown";

    if (nextZone !== previousZone) {
      gazeZoneRef.current = nextZone;
      gazeZoneSinceRef.current = sample.timestampMs;
      setGazeZone(nextZone);
      setGazeZoneSinceMs(sample.timestampMs);
      pushGazeEvent("info", "ZONE_CHANGE", `Zone changed: ${previousZone} -> ${nextZone}`);
    }

    if (sample.timestampMs - lastTraceUpdateAtRef.current >= GAZE_TUNING.pipeline.traceUpdateMinGapMs) {
      lastTraceUpdateAtRef.current = sample.timestampMs;
      setGazeTrace((current) =>
        appendCapped(
          current,
          {
            timestampMs: sample.timestampMs,
            rawFeature: sample.rawFeature,
            smoothFeature: sample.feature,
            zone: nextZone,
            trackingStatus: "tracking",
          },
          MAX_GAZE_TRACE_POINTS,
        ),
      );
    }

    if (gazeCalibrationOpenRef.current) {
      setGazeCalibrationSampleTick((current) => ({
        id: (current?.id ?? 0) + 1,
        feature: sample.feature,
        timestampMs: sample.timestampMs,
      }));
    }

    if (!currentSettings.enabled || !manualRunningRef.current || !currentCalibration) {
      return;
    }
    gazeLostSinceRef.current = null;

    const transition = resolvePauseTransition(
      nextZone,
      gazeZoneSinceRef.current,
      sample.timestampMs,
      gazeAutoPausedRef.current,
      {
        pauseDelayMs: currentSettings.pauseDelayMs,
        resumeDelayMs: currentSettings.resumeDelayMs,
      },
    );

    if (transition === "pause" && !gazeAutoPausedRef.current) {
      setGazeAutoPaused(true);
      setGazeAutoPausedReason("Eyes moved to context.");
      pushGazeEvent("warn", "AUTO_PAUSE", "Auto pause triggered: gaze moved OFF target.");
      return;
    }
    if (transition === "resume" && gazeAutoPausedRef.current) {
      setGazeAutoPaused(false);
      setGazeAutoPausedReason(null);
      pushGazeEvent("info", "AUTO_RESUME", "Auto resume triggered: gaze returned ON target.");
    }
  }, [pushGazeEvent]);
  const {
    status: gazeTrackingStatus,
    error: gazeTrackingError,
    latestSample: gazeLatestSample,
    telemetry: gazeTelemetry,
    debugStream: gazeDebugStream,
  } = useIrisGaze({
    enabled: gazeSettings.enabled,
    targetFps: GAZE_TUNING.pipeline.targetFps,
    smoothingFactor: GAZE_TUNING.pipeline.smoothingAlpha,
    enableDebugStream: gazeDebugOpen,
    onSample: onGazeSample,
  });
  const effectiveHysteresisBand = useMemo(() => {
    if (!gazeCalibration) {
      return gazeSettings.hysteresisBand;
    }
    return resolveEffectiveHysteresisBand(gazeCalibration, gazeSettings.hysteresisBand);
  }, [gazeCalibration, gazeSettings.hysteresisBand]);
  const zoneDwellMs = gazeLatestSample ? Math.max(0, gazeLatestSample.timestampMs - gazeZoneSinceMs) : 0;
  const effectiveRunning = isRunning && !gazeAutoPaused;
  const gazeStatusLabel = useMemo(() => {
    if (!gazeSettings.enabled) {
      return "Off";
    }
    if (!gazeCalibration) {
      return "Needs calibration";
    }
    if (gazeTrackingStatus === "tracking") {
      return gazeAutoPaused ? "Paused by gaze" : "Tracking";
    }
    if (gazeTrackingStatus === "lost") {
      return "Tracking lost";
    }
    if (gazeTrackingStatus === "loading") {
      return "Starting camera";
    }
    if (gazeTrackingStatus === "error") {
      return "Camera error";
    }
    return "Idle";
  }, [gazeAutoPaused, gazeCalibration, gazeSettings.enabled, gazeTrackingStatus]);

  const handlePaneResizeMove = useCallback((event: PointerEvent): void => {
    const resizeState = paneResizeRef.current;
    if (!resizeState) {
      return;
    }
    const deltaX = event.clientX - resizeState.startX;
    const deltaY = event.clientY - resizeState.startY;

    const widthDelta = resizeState.pane === "context" ? deltaX : -deltaX;
    const nextSize = clampPaneSize({
      width: resizeState.startWidth + widthDelta,
      height: resizeState.startHeight - deltaY,
    });
    setPaneSizes((current) => {
      if (
        current[resizeState.pane].width === nextSize.width &&
        current[resizeState.pane].height === nextSize.height
      ) {
        return current;
      }
      return { ...current, [resizeState.pane]: nextSize };
    });
  }, []);

  const stopPaneResize = useCallback((): void => {
    paneResizeRef.current = null;
    document.body.classList.remove("is-resizing-pane");
    window.removeEventListener("pointermove", handlePaneResizeMove);
    window.removeEventListener("pointerup", stopPaneResize);
  }, [handlePaneResizeMove]);

  const startPaneResize = useCallback(
    (pane: PaneKey) =>
      (event: ReactPointerEvent<HTMLButtonElement>): void => {
        event.preventDefault();
        event.stopPropagation();

        const size = paneSizes[pane];
        paneResizeRef.current = {
          pane,
          startX: event.clientX,
          startY: event.clientY,
          startWidth: size.width,
          startHeight: size.height,
        };
        document.body.classList.add("is-resizing-pane");
        window.addEventListener("pointermove", handlePaneResizeMove);
        window.addEventListener("pointerup", stopPaneResize, { once: true });
      },
    [handlePaneResizeMove, paneSizes, stopPaneResize],
  );

  useEffect(() => {
    function clampPanesToViewport(): void {
      setPaneSizes((current) => {
        const context = clampPaneSize(current.context);
        const question = clampPaneSize(current.question);
        if (
          context.width === current.context.width &&
          context.height === current.context.height &&
          question.width === current.question.width &&
          question.height === current.question.height
        ) {
          return current;
        }
        return { context, question };
      });
    }

    window.addEventListener("resize", clampPanesToViewport);
    return () => {
      window.removeEventListener("resize", clampPanesToViewport);
      stopPaneResize();
    };
  }, [stopPaneResize]);

  useEffect(() => {
    gazeSettingsRef.current = gazeSettings;
  }, [gazeSettings]);

  useEffect(() => {
    gazeCalibrationRef.current = gazeCalibration;
  }, [gazeCalibration]);

  useEffect(() => {
    gazeAutoPausedRef.current = gazeAutoPaused;
  }, [gazeAutoPaused]);

  useEffect(() => {
    manualRunningRef.current = isRunning;
  }, [isRunning]);

  useEffect(() => {
    gazeCalibrationOpenRef.current = gazeCalibrationOpen;
    if (!gazeCalibrationOpen) {
      setGazeCalibrationSampleTick(null);
    }
  }, [gazeCalibrationOpen]);

  useEffect(() => {
    if (!navigator?.permissions?.query) {
      setCameraPermissionState("unsupported");
      return;
    }

    let active = true;
    let statusRef: PermissionStatus | null = null;
    navigator.permissions
      .query({ name: "camera" as PermissionName })
      .then((status) => {
        if (!active) {
          return;
        }
        statusRef = status;
        setCameraPermissionState(status.state);
        status.onchange = () => {
          setCameraPermissionState(status.state);
        };
      })
      .catch(() => {
        if (active) {
          setCameraPermissionState("unknown");
        }
      });

    return () => {
      active = false;
      if (statusRef) {
        statusRef.onchange = null;
      }
    };
  }, []);

  useEffect(() => {
    if (prevGazeTrackingStatusRef.current === gazeTrackingStatus) {
      return;
    }
    const previous = prevGazeTrackingStatusRef.current;
    prevGazeTrackingStatusRef.current = gazeTrackingStatus;
    pushGazeEvent("info", "TRACKING_STATUS", `Tracking status: ${previous} -> ${gazeTrackingStatus}`);
  }, [gazeTrackingStatus, pushGazeEvent]);

  useEffect(() => {
    if (prevGazeTrackingErrorRef.current === gazeTrackingError) {
      return;
    }
    prevGazeTrackingErrorRef.current = gazeTrackingError;
    if (gazeTrackingError) {
      pushGazeEvent("error", "TRACKING_ERROR", gazeTrackingError);
    }
  }, [gazeTrackingError, pushGazeEvent]);

  useEffect(() => {
    if (prevGazeEnabledRef.current === gazeSettings.enabled) {
      return;
    }
    prevGazeEnabledRef.current = gazeSettings.enabled;
    pushGazeEvent("info", "GAZE_TOGGLE", gazeSettings.enabled ? "Eye pause enabled." : "Eye pause disabled.");
  }, [gazeSettings.enabled, pushGazeEvent]);

  useEffect(() => {
    const previous = prevEffectiveHysteresisRef.current;
    prevEffectiveHysteresisRef.current = effectiveHysteresisBand;
    if (!gazeSettings.enabled || !gazeCalibration) {
      return;
    }
    if (previous !== null && Math.abs(previous - effectiveHysteresisBand) < 0.0005) {
      return;
    }
    const requested = gazeSettings.hysteresisBand;
    if (Math.abs(requested - effectiveHysteresisBand) >= 0.001) {
      pushGazeEvent(
        "info",
        "ADAPTIVE_BAND",
        `Adaptive band active: requested ${requested.toFixed(4)}, effective ${effectiveHysteresisBand.toFixed(4)}.`,
      );
    }
  }, [effectiveHysteresisBand, gazeCalibration, gazeSettings.enabled, gazeSettings.hysteresisBand, pushGazeEvent]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(GAZE_CALIBRATION_STORAGE_KEY);
      if (!raw) {
        return;
      }
      const parsed = parseCalibrationProfile(JSON.parse(raw));
      if (parsed) {
        setGazeCalibration(parsed);
      }
    } catch {
      // Ignore invalid local calibration state.
    }
  }, []);

  useEffect(() => {
    try {
      if (!gazeCalibration) {
        window.localStorage.removeItem(GAZE_CALIBRATION_STORAGE_KEY);
        return;
      }
      window.localStorage.setItem(GAZE_CALIBRATION_STORAGE_KEY, JSON.stringify(gazeCalibration));
    } catch {
      // Best-effort local persistence.
    }
  }, [gazeCalibration]);

  useEffect(() => {
    if (gazeSettings.enabled && !gazeCalibration) {
      setGazeCalibrationOpen(true);
    }
  }, [gazeCalibration, gazeSettings.enabled]);

  useEffect(() => {
    if (!gazeSettings.enabled || !isRunning || !gazeCalibration) {
      setGazeAutoPaused(false);
      setGazeAutoPausedReason(null);
      gazeZoneRef.current = "unknown";
      gazeZoneSinceRef.current = 0;
      gazeLostSinceRef.current = null;
      setGazeZone("unknown");
      setGazeZoneSinceMs(0);
    }
  }, [gazeCalibration, gazeSettings.enabled, isRunning]);

  useEffect(() => {
    if (!gazeSettings.enabled || !isRunning || !gazeCalibration) {
      return;
    }
    if (gazeTrackingStatus === "tracking") {
      gazeLostSinceRef.current = null;
      return;
    }
    if (gazeLostSinceRef.current !== null) {
      return;
    }

    gazeLostSinceRef.current = performance.now();
    gazeZoneRef.current = "unknown";
    gazeZoneSinceRef.current = 0;
    setGazeZone("unknown");
    setGazeZoneSinceMs(0);
    if (!gazeAutoPausedRef.current) {
      setGazeAutoPaused(true);
      setGazeAutoPausedReason("No gaze detected.");
    }
    pushGazeEvent("warn", "NO_GAZE_PAUSE", "Auto pause triggered because gaze detection was lost.");
  }, [gazeCalibration, gazeSettings.enabled, gazeTrackingStatus, isRunning, pushGazeEvent]);

  const pushAiAuthRequired = useCallback((type: "question" | "entities"): void => {
    const now = Date.now();
    const id = createTaskId();
    const resultItem: AIResultItem = {
      id,
      source: "Manual",
      createdAt: now,
      contextText: "",
      contextWordCount: 0,
      content: "",
      error: "Log in and save a provider key to use BYOK AI widgets.",
    };
    const historyEntry: AIQueueEntry = {
      id,
      type,
      source: "Manual",
      status: "failed",
      triggerWordCount: 0,
      contextWordCount: 0,
      contextPreview: "Authentication required",
      queuedAt: now,
      finishedAt: now,
      detail: "Log in and save a provider key to use BYOK AI widgets.",
    };
    setAiHistory((current) => [historyEntry, ...current].slice(0, MAX_AI_HISTORY_ITEMS));
    if (type === "question") {
      setQuestionInsights((current) => [resultItem, ...current].slice(0, AI_RESULT_LIMIT));
      return;
    }
    setContextInsights((current) => [resultItem, ...current].slice(0, AI_RESULT_LIMIT));
  }, []);

  const updateHistoryEntry = useCallback((id: string, patch: Partial<AIQueueEntry>): void => {
    setAiHistory((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  const dropPendingAutoTasks = useCallback(
    (reason: string): void => {
      setAiPending((current) => {
        const kept = current.filter((item) => item.source !== "Auto");
        current
          .filter((item) => item.source === "Auto")
          .forEach((item) => {
            updateHistoryEntry(item.id, {
              status: "dropped",
              finishedAt: Date.now(),
              detail: reason,
            });
          });
        return kept;
      });
    },
    [updateHistoryEntry],
  );

  const enqueueAiTask = useCallback(
    (type: "question" | "entities", context: string, source: "Auto" | "Manual", triggerWordCount = 0) => {
      const normalizedContext = context.trim();
      if (!normalizedContext) {
        return;
      }
      if (source === "Auto" && aiAutoPaused) {
        return;
      }

      const contextPreview = buildContextPreview(normalizedContext);
      const contextWordCount = countWords(normalizedContext);
      const queuedAt = Date.now();
      const task: AITask = {
        id: createTaskId(),
        type,
        source,
        triggerWordCount,
        contextWordCount,
        queuedAt,
        context: normalizedContext,
        contextPreview,
      };
      const historyEntry: AIQueueEntry = {
        id: task.id,
        type: task.type,
        source: task.source,
        status: "pending",
        triggerWordCount: task.triggerWordCount,
        contextWordCount: task.contextWordCount,
        contextPreview: task.contextPreview,
        queuedAt: task.queuedAt,
        detail: `Queued ${task.contextWordCount}w context window.`,
      };
      setAiHistory((current) => [historyEntry, ...current].slice(0, MAX_AI_HISTORY_ITEMS));
      setAiPending((current) => {
        if (current.length >= MAX_AI_PENDING_TASKS) {
          const [dropped, ...remaining] = current;
          updateHistoryEntry(dropped.id, {
            status: "dropped",
            finishedAt: Date.now(),
            detail: `Dropped because queue limit is ${MAX_AI_PENDING_TASKS}.`,
          });
          return [...remaining, task];
        }
        return [...current, task];
      });
    },
    [aiAutoPaused, updateHistoryEntry],
  );

  useEffect(() => {
    if (!effectiveRunning || words.length === 0) {
      return;
    }

    const currentWordText = words[index] ?? "";
    const baseMs = Math.round(60000 / settings.wpm);
    const multiplier = getPauseMultiplier(currentWordText, pauseMultipliers);
    const delay = Math.max(10, Math.round(baseMs * multiplier));
    const timer = window.setTimeout(() => {
      advanceWord();
    }, delay);

    return () => {
      window.clearTimeout(timer);
    };
  }, [effectiveRunning, index, words, settings.wpm, pauseMultipliers, advanceWord]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (isEditableEventTarget(event.target)) {
        return;
      }

      if (event.key === " ") {
        event.preventDefault();
        toggleRunning();
        return;
      }

      if (event.key === "ArrowLeft") {
        jumpBy(-10);
      } else if (event.key === "ArrowRight") {
        jumpBy(10);
      } else if (event.key === "ArrowUp") {
        setWpm(Math.min(1000, settings.wpm + 25));
      } else if (event.key === "ArrowDown") {
        setWpm(Math.max(60, settings.wpm - 25));
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [jumpBy, settings.wpm, setWpm, toggleRunning]);

  useEffect(() => {
    document.documentElement.dataset.theme = readerTheme;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, readerTheme);
    } catch {
      // Ignore storage failures (private mode / quota).
    }
  }, [readerTheme]);

  const persistedSettingsPayload = useMemo(
    () => buildSettingsPayload(settings, pauseMultipliers, aiSettings, gazeSettings, readerTheme, gazeCalibration),
    [settings, pauseMultipliers, aiSettings, gazeSettings, readerTheme, gazeCalibration],
  );

  const applySavedPauseSettings = useCallback((savedSettings: Record<string, unknown>): void => {
    const patch: Partial<PauseMultipliers> = {};
    (Object.keys(SAVED_PAUSE_SETTING_KEYS) as PauseKey[]).forEach((key) => {
      const value = readFiniteNumber(savedSettings, SAVED_PAUSE_SETTING_KEYS[key]);
      if (value !== undefined) {
        patch[key] = value;
      }
    });

    if (Object.keys(patch).length > 0) {
      setPauseMultipliers((current) => ({ ...current, ...patch }));
    }
  }, []);

  const applySavedReaderSettings = useCallback(
    (savedSettings: Record<string, unknown>): void => {
      const settingSetters: Array<[string, (value: number) => void]> = [
        [SAVED_READER_SETTING_KEYS.wpm, setWpm],
        [SAVED_READER_SETTING_KEYS.contextRange, setContextRange],
        [SAVED_READER_SETTING_KEYS.contextOpacity, setContextOpacity],
        [SAVED_READER_SETTING_KEYS.flankOpacity, setFlankOpacity],
      ];

      settingSetters.forEach(([key, setter]) => {
        const value = readFiniteNumber(savedSettings, key);
        if (value !== undefined) {
          setter(value);
        }
      });

      const savedTheme = normalizeTheme(readString(savedSettings, SAVED_READER_SETTING_KEYS.theme));
      if (savedTheme) {
        setReaderTheme(savedTheme);
      }
    },
    [setContextOpacity, setContextRange, setFlankOpacity, setWpm],
  );

  const applySavedAiSettings = useCallback((savedSettings: Record<string, unknown>): void => {
    setAiSettings((current) => {
      const next: AIAutomationSettings = { ...current };
      const questionEnabled = readBoolean(savedSettings, SAVED_AI_SETTING_KEYS.questionEnabled);
      const questionInterval = readFiniteNumber(savedSettings, SAVED_AI_SETTING_KEYS.questionInterval);
      const entityEnabled = readBoolean(savedSettings, SAVED_AI_SETTING_KEYS.entityEnabled);
      const provider = normalizeProvider(readString(savedSettings, SAVED_AI_SETTING_KEYS.provider));
      const mode = normalizeMode(readString(savedSettings, SAVED_AI_SETTING_KEYS.mode));
      const model = readString(savedSettings, SAVED_AI_SETTING_KEYS.model);

      if (questionEnabled !== undefined) {
        next.questionEnabled = questionEnabled;
      }
      if (questionInterval !== undefined) {
        next.questionInterval = normalizeQuestionInterval(questionInterval);
      }
      if (entityEnabled !== undefined) {
        next.entityEnabled = entityEnabled;
      }
      if (provider) {
        next.provider = provider;
      }
      if (mode) {
        next.mode = mode;
      }
      if (model !== undefined) {
        next.model = model;
      }
      next.entityInterval = FIXED_CONTEXT_MONITOR_INTERVAL;

      return next;
    });
  }, []);

  const applySavedGazeSettings = useCallback((savedSettings: Record<string, unknown>): void => {
    const calibrationRecord = readRecord(savedSettings, SAVED_GAZE_SETTING_KEYS.calibrationProfile);
    const parsedProfile = parseCalibrationProfile(calibrationRecord);
    if (parsedProfile) {
      setGazeCalibration(parsedProfile);
    }

    setGazeSettings((current) => {
      const next: GazeAutomationSettings = { ...current };
      const enabled = readBoolean(savedSettings, SAVED_GAZE_SETTING_KEYS.enabled);
      const pauseDelayMs = readFiniteNumber(savedSettings, SAVED_GAZE_SETTING_KEYS.pauseDelayMs);
      const resumeDelayMs = readFiniteNumber(savedSettings, SAVED_GAZE_SETTING_KEYS.resumeDelayMs);
      const hysteresisBand = readFiniteNumber(savedSettings, SAVED_GAZE_SETTING_KEYS.hysteresisBand);
      const lostTrackingPauseMs = readFiniteNumber(savedSettings, SAVED_GAZE_SETTING_KEYS.lostTrackingPauseMs);

      if (enabled !== undefined) {
        next.enabled = enabled;
      }
      if (pauseDelayMs !== undefined) {
        next.pauseDelayMs = clampGazePauseDelayMs(pauseDelayMs);
      }
      if (resumeDelayMs !== undefined) {
        next.resumeDelayMs = clampGazeResumeDelayMs(resumeDelayMs);
      }
      if (hysteresisBand !== undefined) {
        next.hysteresisBand = clampGazeHysteresisBand(hysteresisBand);
      }
      if (lostTrackingPauseMs !== undefined) {
        next.lostTrackingPauseMs = clampGazeLostPauseDelayMs(lostTrackingPauseMs);
      }

      return next;
    });
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      setSettingsLoaded(true);
      return;
    }

    let cancelled = false;
    setSettingsLoaded(false);

    void Promise.allSettled([getReaderSettings(), listCredentials()])
      .then(([settingsResult, credentialsResult]) => {
        if (cancelled) {
          return;
        }

        let savedSettings: Record<string, unknown> = {};
        if (settingsResult.status === "fulfilled") {
          savedSettings = (settingsResult.value.settings ?? {}) as Record<string, unknown>;
          applySavedReaderSettings(savedSettings);
          applySavedPauseSettings(savedSettings);
          applySavedAiSettings(savedSettings);
          applySavedGazeSettings(savedSettings);
        }

        if (credentialsResult.status === "fulfilled") {
          const credentialProviders = dedupeProviders(credentialsResult.value.map((item) => item.provider));
          const savedProvider = normalizeProvider(readString(savedSettings, SAVED_AI_SETTING_KEYS.provider));
          const autoProvider = resolveAutoAiProvider(savedProvider, credentialProviders);
          if (autoProvider) {
            setAiSettings((current) => {
              if (current.provider === autoProvider) {
                return current;
              }
              return { ...current, provider: autoProvider };
            });
          }
        }
      })
      .finally(() => {
        if (!cancelled) {
          setSettingsLoaded(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [applySavedAiSettings, applySavedGazeSettings, applySavedPauseSettings, applySavedReaderSettings, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || !settingsLoaded) {
      return;
    }

    const timer = window.setTimeout(() => {
      void saveReaderSettings({
        settings: persistedSettingsPayload,
      }).catch(() => {
        // Settings writes are best-effort.
      });
    }, SETTINGS_SAVE_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [isAuthenticated, persistedSettingsPayload, settingsLoaded]);

  useEffect(() => {
    if (!isAuthenticated || !bookId || !currentBookTitle || words.length === 0) {
      return;
    }
    if (progressReadyTitle !== currentBookTitle) {
      return;
    }

    const timer = window.setTimeout(() => {
      void saveProgress({
        book_title: currentBookTitle,
        index,
      }).catch(() => {
        // Progress writes are best-effort.
      });
    }, PROGRESS_SAVE_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [bookId, currentBookTitle, index, isAuthenticated, progressReadyTitle, words.length]);

  useEffect(() => {
    questionBufferRef.current = [];
    entityBufferRef.current = [];
    lastProcessedIndexRef.current = -1;
    autoFailureCountRef.current = 0;
    setAiAutoPaused(false);
    setAiAutoPausedReason(null);
    setAiCooldownUntil(null);
    lastAiRequestAtRef.current = 0;
    queueDispatchInProgressRef.current = false;
    setAiPending([]);
    setAiActive(null);
    setAiHistory([]);
    setActiveQuestionId(null);
    setContextInsights([]);
    setQuestionInsights([]);
    setQuestionFeedbackById({});
    setContextSeenCount(0);
    setQuestionSeenCount(0);
    setGazeAutoPaused(false);
    setGazeAutoPausedReason(null);
    gazeZoneRef.current = "unknown";
    gazeZoneSinceRef.current = 0;
    gazeLostSinceRef.current = null;
    setGazeZone("unknown");
    setGazeZoneSinceMs(0);
    setGazeTrace([]);
    setGazeDebugEvents([]);
  }, [bookId]);

  useEffect(() => {
    if (isAuthenticated) {
      return;
    }
    autoFailureCountRef.current = 0;
    setAiCooldownUntil(null);
    lastAiRequestAtRef.current = 0;
    queueDispatchInProgressRef.current = false;
    setAiPending([]);
    setAiActive(null);
    setAiHistory([]);
    setActiveQuestionId(null);
    setQuestionFeedbackById({});
    setContextSeenCount(0);
    setQuestionSeenCount(0);
  }, [isAuthenticated]);

  useEffect(() => {
    if (questionInsights.length === 0) {
      if (activeQuestionId !== null) {
        setActiveQuestionId(null);
      }
      return;
    }

    if (!activeQuestionId || !questionInsights.some((item) => item.id === activeQuestionId)) {
      setActiveQuestionId(questionInsights[0]?.id ?? null);
    }
  }, [activeQuestionId, questionInsights]);

  useEffect(() => {
    const validIds = new Set(questionInsights.map((item) => item.id));
    setQuestionFeedbackById((current) => {
      const next: Record<string, QuestionFeedbackState> = {};
      Object.entries(current).forEach(([id, state]) => {
        if (validIds.has(id)) {
          next[id] = state;
        }
      });
      const unchanged =
        Object.keys(current).length === Object.keys(next).length &&
        Object.keys(current).every((id) => Object.prototype.hasOwnProperty.call(next, id));
      return unchanged ? current : next;
    });
  }, [questionInsights]);

  useEffect(() => {
    if (contextPaneOpen) {
      setContextSeenCount(contextInsights.length);
    }
  }, [contextInsights.length, contextPaneOpen]);

  useEffect(() => {
    if (questionPaneOpen) {
      setQuestionSeenCount(questionInsights.length);
    }
  }, [questionInsights.length, questionPaneOpen]);

  useEffect(() => {
    if (!aiCooldownUntil) {
      return;
    }
    const remainingMs = aiCooldownUntil - Date.now();
    if (remainingMs <= 0) {
      setAiCooldownUntil(null);
      return;
    }
    const timer = window.setTimeout(() => {
      setAiCooldownUntil(null);
    }, remainingMs + 50);
    return () => {
      window.clearTimeout(timer);
    };
  }, [aiCooldownUntil]);

  useEffect(() => {
    if (!isAuthenticated || !bookId || words.length === 0) {
      return;
    }

    const previous = lastProcessedIndexRef.current;
    if (previous < 0) {
      lastProcessedIndexRef.current = index;
      return;
    }
    if (index < previous) {
      questionBufferRef.current = [];
      entityBufferRef.current = [];
      lastProcessedIndexRef.current = index;
      return;
    }
    if (index === previous) {
      return;
    }
    if (!isRunning) {
      questionBufferRef.current = [];
      entityBufferRef.current = [];
      lastProcessedIndexRef.current = index;
      return;
    }
    if (aiAutoPaused) {
      lastProcessedIndexRef.current = index;
      return;
    }

    for (let cursor = previous + 1; cursor <= index && cursor < words.length; cursor += 1) {
      const word = (words[cursor] ?? "").trim();
      if (!word) {
        continue;
      }

      if (aiSettings.questionEnabled) {
        questionBufferRef.current.push(word);
        if (questionBufferRef.current.length >= aiSettings.questionInterval) {
          const context = questionBufferRef.current.slice(-AI_MAX_CONTEXT_WORDS).join(" ").trim();
          enqueueAiTask("question", context, "Auto", questionBufferRef.current.length);
          questionBufferRef.current = questionBufferRef.current.slice(-AI_QUESTION_OVERLAP);
        }
      }

      if (aiSettings.entityEnabled) {
        entityBufferRef.current.push(word);
        if (entityBufferRef.current.length >= aiSettings.entityInterval) {
          const context = entityBufferRef.current.slice(-AI_MAX_CONTEXT_WORDS).join(" ").trim();
          enqueueAiTask("entities", context, "Auto", entityBufferRef.current.length);
          entityBufferRef.current = entityBufferRef.current.slice(-AI_ENTITY_OVERLAP);
        }
      }
    }

    lastProcessedIndexRef.current = index;
  }, [aiAutoPaused, aiSettings, bookId, enqueueAiTask, index, isAuthenticated, isRunning, words]);

  useEffect(() => {
    if (!isAuthenticated || aiActive || aiPending.length === 0) {
      return;
    }
    if (aiCooldownUntil && Date.now() < aiCooldownUntil) {
      return;
    }
    if (queueDispatchInProgressRef.current) {
      return;
    }
    queueDispatchInProgressRef.current = true;

    const nextTask = aiPending[0];
    if (!nextTask) {
      queueDispatchInProgressRef.current = false;
      return;
    }
    setAiPending((current) => {
      if (current.length === 0) {
        return current;
      }
      if (current[0]?.id === nextTask.id) {
        return current.slice(1);
      }
      const index = current.findIndex((item) => item.id === nextTask.id);
      if (index < 0) {
        return current;
      }
      return [...current.slice(0, index), ...current.slice(index + 1)];
    });
    setAiActive(nextTask);
    updateHistoryEntry(nextTask.id, {
      status: "running",
      startedAt: Date.now(),
      detail: "Running",
    });

    async function runTask(): Promise<void> {
      try {
        const now = Date.now();
        const gapMs = now - lastAiRequestAtRef.current;
        const waitMs = Math.max(0, AI_REQUEST_MIN_GAP_MS - gapMs);
        if (waitMs > 0) {
          await sleep(waitMs);
        }
        lastAiRequestAtRef.current = Date.now();

        const rawContent =
          nextTask.type === "question"
            ? await requestQuestion(nextTask.context, aiRequestOptions)
            : await requestEntities(nextTask.context, aiRequestOptions);
        const content = sanitizeAiOutput(rawContent);

        const resultItem: AIResultItem = {
          id: nextTask.id,
          source: nextTask.source,
          createdAt: Date.now(),
          contextText: nextTask.context,
          contextWordCount: nextTask.contextWordCount,
          content,
        };
        if (nextTask.type === "question") {
          setQuestionInsights((current) => [resultItem, ...current].slice(0, AI_RESULT_LIMIT));
          setQuestionFeedbackById((current) => {
            if (current[nextTask.id]) {
              return current;
            }
            return {
              ...current,
              [nextTask.id]: {
                answer: "",
                feedback: "",
                loading: false,
                error: null,
              },
            };
          });
        } else {
          const parsedEntities = parseEntityEntries(content);
          if (parsedEntities.length > 0) {
            const createdAt = Date.now();
            setContextInsights((current) => {
              const existingKeys = collectExistingEntityKeys(current);
              const additions: AIResultItem[] = [];
              parsedEntities.forEach((entity, idx) => {
                if (existingKeys.has(entity.key)) {
                  return;
                }
                existingKeys.add(entity.key);
                additions.push({
                  id: `${nextTask.id}-entity-${idx}`,
                  source: nextTask.source,
                  createdAt,
                  contextText: nextTask.context,
                  contextWordCount: nextTask.contextWordCount,
                  content: entity.label,
                  entityKey: entity.key,
                });
              });
              if (additions.length === 0) {
                return current;
              }
              return [...additions, ...current].slice(0, AI_RESULT_LIMIT);
            });
          } else if (!isEntityNoneResponse(content)) {
            setContextInsights((current) => [resultItem, ...current].slice(0, AI_RESULT_LIMIT));
          }
        }
        updateHistoryEntry(nextTask.id, {
          status: "succeeded",
          finishedAt: Date.now(),
          detail: content,
        });
        autoFailureCountRef.current = 0;
      } catch (error) {
        const message = error instanceof Error ? error.message : "AI task failed.";
        const resultItem: AIResultItem = {
          id: nextTask.id,
          source: nextTask.source,
          createdAt: Date.now(),
          contextText: nextTask.context,
          contextWordCount: nextTask.contextWordCount,
          content: "",
          error: message,
        };
        if (nextTask.type === "question") {
          setQuestionInsights((current) => [resultItem, ...current].slice(0, AI_RESULT_LIMIT));
          setQuestionFeedbackById((current) => {
            if (current[nextTask.id]) {
              return current;
            }
            return {
              ...current,
              [nextTask.id]: {
                answer: "",
                feedback: "",
                loading: false,
                error: null,
              },
            };
          });
        } else {
          setContextInsights((current) => [resultItem, ...current].slice(0, AI_RESULT_LIMIT));
        }
        updateHistoryEntry(nextTask.id, {
          status: "failed",
          finishedAt: Date.now(),
          detail: message,
        });
        const isRateLimited = /^429\b/.test(message) || message.includes(" 429 ");
        if (isRateLimited) {
          const retrySeconds = parseRetryAfterSeconds(message) ?? Math.ceil(AI_RATE_LIMIT_COOLDOWN_MS / 1000);
          const until = Date.now() + retrySeconds * 1000;
          setAiCooldownUntil(until);
          setAiAutoPaused(true);
          setAiAutoPausedReason(`Rate limited by API. Auto AI paused until ${formatTime(until)}.`);
          dropPendingAutoTasks("Dropped due to API rate limit cooldown.");
        }
        if (nextTask.source === "Auto") {
          autoFailureCountRef.current += 1;
          if (autoFailureCountRef.current >= AUTO_AI_FAILURE_THRESHOLD) {
            setAiAutoPaused(true);
            setAiAutoPausedReason(`Auto AI paused after ${AUTO_AI_FAILURE_THRESHOLD} failures: ${message}`);
            dropPendingAutoTasks("Dropped after auto-pause due to repeated failures.");
          }
        }
      } finally {
        queueDispatchInProgressRef.current = false;
        setAiActive((current) => (current?.id === nextTask.id ? null : current));
      }
    }

    void runTask();
  }, [aiActive, aiCooldownUntil, aiPending, aiRequestOptions, dropPendingAutoTasks, isAuthenticated, updateHistoryEntry]);

  function onPauseMultiplierChange(key: PauseKey, value: number): void {
    setPauseMultipliers((current) => ({ ...current, [key]: value }));
  }

  function clearAiHistory(): void {
    setAiHistory([]);
  }

  function resumeAiAutomation(): void {
    autoFailureCountRef.current = 0;
    questionBufferRef.current = [];
    entityBufferRef.current = [];
    setAiAutoPaused(false);
    setAiAutoPausedReason(null);
    setAiCooldownUntil(null);
    lastAiRequestAtRef.current = 0;
    queueDispatchInProgressRef.current = false;
    lastProcessedIndexRef.current = index;
  }

  function removeContextInsight(id: string): void {
    setContextInsights((current) => current.filter((item) => item.id !== id));
  }

  function removeQuestionInsight(id: string): void {
    setQuestionInsights((current) => current.filter((item) => item.id !== id));
    setQuestionFeedbackById((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  function clearContextInsights(): void {
    setContextInsights([]);
  }

  function clearQuestionInsights(): void {
    setQuestionInsights([]);
    setActiveQuestionId(null);
    setQuestionFeedbackById({});
  }

  function onGazeCalibrationComplete(profile: GazeCalibrationProfile): void {
    setGazeCalibration(profile);
    setGazeCalibrationOpen(false);
    setGazeAutoPaused(false);
    setGazeAutoPausedReason(null);
    gazeZoneRef.current = "unknown";
    gazeZoneSinceRef.current = 0;
    gazeLostSinceRef.current = null;
    setGazeZone("unknown");
    setGazeZoneSinceMs(0);
    pushGazeEvent("info", "CALIBRATION_SAVED", "Calibration profile saved.");
  }

  function onQuestionAnswerChange(id: string, answer: string): void {
    setQuestionFeedbackById((current) => ({
      ...current,
      [id]: {
        answer,
        feedback: current[id]?.feedback ?? "",
        loading: false,
        error: null,
      },
    }));
  }

  async function submitQuestionAnswer(item: AIResultItem): Promise<void> {
    const answer = questionFeedbackById[item.id]?.answer?.trim() ?? "";
    if (!answer) {
      setQuestionFeedbackById((current) => ({
        ...current,
        [item.id]: {
          answer: current[item.id]?.answer ?? "",
          feedback: current[item.id]?.feedback ?? "",
          loading: false,
          error: "Enter an answer before requesting feedback.",
        },
      }));
      return;
    }
    if (!isAuthenticated) {
      pushAiAuthRequired("question");
      return;
    }

    setQuestionFeedbackById((current) => ({
      ...current,
      [item.id]: {
        answer: current[item.id]?.answer ?? "",
        feedback: current[item.id]?.feedback ?? "",
        loading: true,
        error: null,
      },
    }));

    try {
      const prompt = buildComprehensionFeedbackPrompt(item.contextText, item.content, answer);
      const response = await requestChat(prompt, aiRequestOptions, {
        temperature: 0.2,
        max_tokens: 800,
      });
      const cleaned = sanitizeAiOutput(response.content);
      setQuestionFeedbackById((current) => ({
        ...current,
        [item.id]: {
          answer: current[item.id]?.answer ?? "",
          feedback: cleaned,
          loading: false,
          error: null,
        },
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to generate answer feedback.";
      setQuestionFeedbackById((current) => ({
        ...current,
        [item.id]: {
          answer: current[item.id]?.answer ?? "",
          feedback: current[item.id]?.feedback ?? "",
          loading: false,
          error: message,
        },
      }));
    }
  }

  async function handleUpload(): Promise<void> {
    if (!selectedFile) {
      return;
    }

    setLoading(true);
    setStatusText("Uploading...");

    try {
      const uploaded = await uploadBook(selectedFile);
      setStatusText("Parsing...");

      const parse = await startParse(uploaded.book_id, false);
      await waitForParseJob(parse.job_id, (progressValue) => {
        setStatusText(`Parsing ${progressValue}%`);
      });

      const content = await getBookContent(uploaded.book_id);
      setProgressReadyTitle(null);
      setBook({
        bookId: uploaded.book_id,
        filename: uploaded.filename,
        content,
      });

      if (isAuthenticated) {
        try {
          const saved = await getProgress(uploaded.filename);
          setIndex(saved.index);
        } catch {
          // No saved progress for this book.
        } finally {
          setProgressReadyTitle(uploaded.filename);
        }
      } else {
        setProgressReadyTitle(uploaded.filename);
      }

      setStatusText(uploaded.filename);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Upload failed";
      setStatusText(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="reader-shell">
      <section className={`reader-hub${chaptersOpen ? " chapters-open" : ""}${settingsOpen ? " settings-open" : ""}`}>
        <header className="hub-head hub-head-thin">
          <div className="hub-toolbar hub-toolbar-single-row">
            <button type="button" className={chaptersOpen ? "active" : ""} onClick={() => setChaptersOpen((value) => !value)}>
              Chapters
            </button>

            <label className="file-pill">
              <input
                type="file"
                accept=".pdf,.epub"
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  setSelectedFile(file);
                }}
              />
              <span>{selectedFileLabel}</span>
            </label>

            <button type="button" disabled={loading || !selectedFile} onClick={() => void handleUpload()}>
              {loading ? "Working..." : "Upload"}
            </button>

            <span className="hub-title-chip" title={toolbarTitle}>
              {toolbarTitle}
            </span>

            <span className="hub-metric-chip">{index + 1}/{words.length || 0}</span>
            <span className="hub-metric-chip">{progress}%</span>
            <span className={`hub-metric-chip gaze-status-chip ${gazeTrackingStatus}`}>
              {gazeStatusLabel}
            </span>
            <div className={`ai-toolbar-queue ${aiQueueOpen ? "open" : "closed"}`}>
              <button type="button" className="ai-toolbar-queue-trigger" onClick={() => setAiQueueOpen((value) => !value)}>
                <span>AI Queue</span>
                <span className={`pane-toggle-pill ${aiQueueOpen ? "expanded" : "collapsed"}`}>{aiQueueOpen ? "Hide" : "Show"}</span>
              </button>
              <section className="ai-toolbar-queue-panel">
                <div className="ai-queue-body">
                  <div className="ai-queue-metrics">
                    <article className="ai-queue-metric-card">
                      <span className="ai-queue-metric-label">Pending</span>
                      <strong className="ai-queue-metric-value">{aiPending.length}</strong>
                    </article>
                    <article className="ai-queue-metric-card">
                      <span className="ai-queue-metric-label">Running</span>
                      <strong className="ai-queue-metric-value">{aiActive ? 1 : 0}</strong>
                    </article>
                    <article className="ai-queue-metric-card">
                      <span className="ai-queue-metric-label">Done</span>
                      <strong className="ai-queue-metric-value">{aiSucceededCount}</strong>
                    </article>
                    <article className="ai-queue-metric-card">
                      <span className="ai-queue-metric-label">Failed</span>
                      <strong className="ai-queue-metric-value">{aiFailedCount}</strong>
                    </article>
                    <article className="ai-queue-metric-card">
                      <span className="ai-queue-metric-label">Dropped</span>
                      <strong className="ai-queue-metric-value">{aiDroppedCount}</strong>
                    </article>
                  </div>
                  {aiAutoPausedReason ? <p className="ai-queue-warning">{aiAutoPausedReason}</p> : null}
                  <div className="ai-monitor-body ai-queue-history">
                    {aiHistory.length === 0 ? <p className="ai-monitor-empty">No queue activity yet.</p> : null}
                    {aiHistory.map((entry) => (
                      <article key={entry.id} className={`ai-monitor-item ai-queue-item queue ${entry.status}`}>
                        <div className="ai-monitor-item-head">
                          <div className="ai-queue-item-head-stack">
                            <div className="ai-queue-item-topline">
                              <span className={`ai-queue-item-type ${entry.type}`}>{entry.type === "question" ? "Question" : "Context Monitor"}</span>
                              <span className="ai-queue-item-source">{entry.source}</span>
                            </div>
                            <div className="ai-queue-item-stats">
                              <span>
                                Trigger <strong>{entry.triggerWordCount}w</strong>
                              </span>
                              <span>
                                Window <strong>{entry.contextWordCount}w</strong>
                              </span>
                            </div>
                          </div>
                          <span className={`queue-status ${entry.status}`}>{entry.status}</span>
                        </div>
                        <pre className="ai-queue-item-detail">{entry.detail ?? "No details available."}</pre>
                        <div className="ai-queue-item-timeline">
                          <span>
                            <small>Queued</small>
                            <strong>{formatTime(entry.queuedAt)}</strong>
                          </span>
                          <span>
                            <small>Start</small>
                            <strong>{formatTime(entry.startedAt)}</strong>
                          </span>
                          <span>
                            <small>End</small>
                            <strong>{formatTime(entry.finishedAt)}</strong>
                          </span>
                        </div>
                      </article>
                    ))}
                  </div>
                  <div className="ai-corner-actions ai-queue-corner-actions">
                    {aiAutoPaused ? (
                      <button type="button" className="btn-ghost ai-corner-action-btn" onClick={resumeAiAutomation}>
                        Resume Auto
                      </button>
                    ) : null}
                    <button type="button" className="btn-ghost ai-corner-action-btn" onClick={clearAiHistory}>
                      Clear
                    </button>
                  </div>
                </div>
              </section>
            </div>

            <button type="button" className={settingsOpen ? "active" : ""} onClick={() => onSettingsOpenChange(!settingsOpen)}>
              Settings
            </button>

            {user ? (
              <button type="button" className="btn-secondary" onClick={onOpenAccount}>
                Account
              </button>
            ) : (
              <>
                <button type="button" onClick={onLogIn}>
                  Log In
                </button>
                <button type="button" className="btn-secondary" onClick={onSignUp}>
                  Sign Up
                </button>
              </>
            )}
          </div>
        </header>

        <section className="hub-main">
          <aside className={`chapter-drawer ${chaptersOpen ? "open" : "closed"}`}>
            <ChapterSidebar
              chapters={chapters}
              currentIndex={index}
              onJump={jumpToChapter}
              onClose={() => setChaptersOpen(false)}
            />
          </aside>

          <aside className={`settings-drawer ${settingsOpen ? "open" : "closed"}`}>
            <div className="settings-drawer-head">
              <strong>Reader Settings</strong>
              <button type="button" className="btn-ghost" onClick={() => onSettingsOpenChange(false)}>
                Close
              </button>
            </div>
            <ReaderControls
              contextRange={settings.contextRange}
              contextOpacity={settings.contextOpacity}
              flankOpacity={settings.flankOpacity}
              theme={readerTheme}
              gazeEnabled={gazeSettings.enabled}
              gazeCalibrated={Boolean(gazeCalibration)}
              gazeStatusLabel={gazeStatusLabel}
              gazePauseDelayMs={gazeSettings.pauseDelayMs}
              gazeResumeDelayMs={gazeSettings.resumeDelayMs}
              gazeHysteresisBand={gazeSettings.hysteresisBand}
              gazeDebugOpen={gazeDebugOpen}
              aiProvider={aiSettings.provider}
              aiMode={aiSettings.mode}
              aiModel={aiSettings.model}
              aiAvailable={isAuthenticated}
              aiQuestionEnabled={aiSettings.questionEnabled}
              aiQuestionInterval={aiSettings.questionInterval}
              aiEntityEnabled={aiSettings.entityEnabled}
              onThemeChange={setReaderTheme}
              onRangeChange={setContextRange}
              onContextOpacityChange={setContextOpacity}
              onFlankOpacityChange={setFlankOpacity}
              onGazeEnabledChange={(value) => {
                setGazeSettings((current) => ({ ...current, enabled: value }));
                if (!value) {
                  setGazeAutoPaused(false);
                  setGazeAutoPausedReason(null);
                }
              }}
              onGazePauseDelayChange={(value) =>
                setGazeSettings((current) => ({ ...current, pauseDelayMs: clampGazePauseDelayMs(value) }))
              }
              onGazeResumeDelayChange={(value) =>
                setGazeSettings((current) => ({ ...current, resumeDelayMs: clampGazeResumeDelayMs(value) }))
              }
              onGazeHysteresisBandChange={(value) =>
                setGazeSettings((current) => ({ ...current, hysteresisBand: clampGazeHysteresisBand(value) }))
              }
              onOpenGazeCalibration={() => setGazeCalibrationOpen(true)}
              onGazeDebugOpenChange={setGazeDebugOpen}
              onAiProviderChange={(value) => setAiSettings((current) => ({ ...current, provider: value }))}
              onAiModeChange={(value) => setAiSettings((current) => ({ ...current, mode: value }))}
              onAiModelChange={(value) => setAiSettings((current) => ({ ...current, model: value }))}
              onAiQuestionEnabledChange={(value) => setAiSettings((current) => ({ ...current, questionEnabled: value }))}
              onAiQuestionIntervalChange={(value) => {
                const nextInterval = normalizeQuestionInterval(value);
                questionBufferRef.current = [];
                setAiSettings((current) => {
                  if (current.questionInterval === nextInterval) {
                    return current;
                  }
                  return { ...current, questionInterval: nextInterval };
                });
              }}
              onAiEntityEnabledChange={(value) => setAiSettings((current) => ({ ...current, entityEnabled: value }))}
              onPauseMultiplierChange={onPauseMultiplierChange}
              pauseMultipliers={pauseMultipliers}
            />
            {gazeTrackingError ? <p className="settings-note gaze-settings-error">Eye tracking error: {gazeTrackingError}</p> : null}
            {gazeAutoPausedReason ? <p className="settings-note gaze-settings-note">Eye pause: {gazeAutoPausedReason}</p> : null}
          </aside>

          <div className="wpm-float">
            <div className="settings-slider-wrap wpm-slider-wrap">
              <span className="settings-slider-header">
                <span className="wpm-slider-label">WPM</span>
                <strong className="settings-slider-value">{settings.wpm}</strong>
              </span>
              <input
                className="settings-range"
                type="range"
                min={60}
                max={1000}
                value={settings.wpm}
                onChange={(event) => setWpm(Number(event.target.value))}
                aria-label="Words per minute"
              />
            </div>
          </div>

          <section className="reader-stage">
            <ContextPane
              words={words}
              index={index}
              range={settings.contextRange}
              opacity={settings.contextOpacity}
              themeKey={readerTheme}
              onScrollStep={jumpBy}
            />

            <RsvpReader
              currentWord={currentWord}
              prevWord={prevWord}
              nextWord={nextWordText}
              flankOpacity={settings.flankOpacity}
              themeKey={readerTheme}
              isRunning={effectiveRunning}
              isAutoPaused={gazeAutoPaused}
              onToggle={toggleRunning}
            />

            <div className="ai-edge-layer">
              <section
                className={`ai-edge-pane context context-monitor-pane ${contextPaneOpen ? "open" : "closed"}${contextHasNew && !contextPaneOpen ? " has-new" : ""}`}
                style={contextPaneOpen ? { width: `${paneSizes.context.width}px`, height: `${paneSizes.context.height}px` } : undefined}
              >
                <div className="ai-edge-header">
                  <button
                    type="button"
                    className="ai-edge-header-toggle"
                    onClick={() => setContextPaneOpen((value) => !value)}
                  >
                    <strong>Context Monitor</strong>
                  </button>
                  <div className="ai-edge-header-tools">
                    <span className={`pane-toggle-pill ${contextPaneOpen ? "expanded" : "collapsed"}`}>
                      {contextPaneOpen ? "Open" : "Closed"}
                    </span>
                    <span>{contextInsights.length}</span>
                    {contextPaneOpen ? (
                      <button
                        type="button"
                        className="ai-pane-resize-handle"
                        onPointerDown={startPaneResize("context")}
                        aria-label="Drag to resize context monitor panel"
                        title="Drag left/right and up/down to resize"
                      >
                        Drag Resize
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="ai-edge-body context-monitor-body">
                  <div className="ai-monitor-body context-monitor-list">
                    {contextInsights.length === 0 ? <p className="ai-monitor-empty">No dates/characters yet.</p> : null}
                    {contextInsights.map((item) => (
                      <article key={item.id} className={`ai-monitor-item context-monitor-item${item.error ? " error" : ""}`}>
                        <div className="ai-monitor-item-head context-monitor-item-head">
                          <span className="context-monitor-meta">
                            {item.source} | {item.contextWordCount}w | {formatTime(item.createdAt)}
                          </span>
                          <button type="button" className="btn-ghost context-monitor-remove" onClick={() => removeContextInsight(item.id)}>
                            Remove
                          </button>
                        </div>
                        <pre className="context-monitor-content">{item.error ?? item.content}</pre>
                      </article>
                    ))}
                  </div>
                  <div className="ai-corner-actions">
                    <button type="button" className="btn-ghost ai-corner-action-btn" onClick={clearContextInsights} disabled={contextInsights.length === 0}>
                      Clear
                    </button>
                  </div>
                </div>
              </section>

              <section
                className={`ai-edge-pane question comprehension-pane ${questionPaneOpen ? "open" : "closed"}${questionHasNew && !questionPaneOpen ? " has-new" : ""}`}
                style={questionPaneOpen ? { width: `${paneSizes.question.width}px`, height: `${paneSizes.question.height}px` } : undefined}
              >
                <div className="ai-edge-header">
                  <button
                    type="button"
                    className="ai-edge-header-toggle"
                    onClick={() => setQuestionPaneOpen((value) => !value)}
                  >
                    <strong>Comprehension Check</strong>
                  </button>
                  <div className="ai-edge-header-tools">
                    <span className={`pane-toggle-pill ${questionPaneOpen ? "expanded" : "collapsed"}`}>
                      {questionPaneOpen ? "Open" : "Closed"}
                    </span>
                    <span>{questionInsights.length}</span>
                    {questionPaneOpen ? (
                      <button
                        type="button"
                        className="ai-pane-resize-handle"
                        onPointerDown={startPaneResize("question")}
                        aria-label="Drag to resize comprehension panel"
                        title="Drag left/right and up/down to resize"
                      >
                        Drag Resize
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="ai-edge-body comprehension-body">
                  <div className="ai-monitor-body question-monitor-body">
                    {questionInsights.length === 0 ? <p className="ai-monitor-empty">No comprehension questions yet.</p> : null}
                    {questionInsights.length > 0 ? (
                      <div className="question-stack question-stack-layout">
                        <nav className="question-stack-nav question-stack-nav-panel" aria-label="Comprehension tabs">
                          {questionInsights.map((item, idx) => (
                            <button
                              key={item.id}
                              type="button"
                              className={`question-stack-tab question-stack-tab-btn${activeQuestionId === item.id ? " active" : ""}${item.error ? " error" : ""}`}
                              onClick={() => setActiveQuestionId(item.id)}
                            >
                              Q{questionInsights.length - idx}
                            </button>
                          ))}
                        </nav>
                        {activeQuestionItem ? (
                          <article className={`question-stack-panel question-stack-panel-shell${activeQuestionItem.error ? " error" : ""}`}>
                            <div className="ai-monitor-item-head question-stack-head">
                              <span>
                                {activeQuestionItem.source} | {activeQuestionItem.contextWordCount}w | {formatTime(activeQuestionItem.createdAt)}
                              </span>
                              <button
                                type="button"
                                className="btn-ghost question-remove-btn"
                                onClick={() => removeQuestionInsight(activeQuestionItem.id)}
                              >
                                Remove
                              </button>
                            </div>
                            {activeQuestionItem.error ? (
                              <pre>{activeQuestionItem.error}</pre>
                            ) : (
                              <div className="question-workspace question-workspace-panels">
                                <section className="question-display-box question-card">
                                  <p className="question-box-label">Question</p>
                                  <pre className="question-display-text">{activeQuestionItem.content}</pre>
                                </section>
                                <section className="question-response-box question-card">
                                  <p className="question-box-label">Your Response</p>
                                  <textarea
                                    value={activeQuestionFeedback.answer}
                                    onChange={(event) => onQuestionAnswerChange(activeQuestionItem.id, event.target.value)}
                                    onKeyDown={(event) => {
                                      if (event.key !== "Enter" || event.shiftKey) {
                                        return;
                                      }
                                      event.preventDefault();
                                      if (activeQuestionFeedback.loading) {
                                        return;
                                      }
                                      if (activeQuestionHasFeedback) {
                                        removeQuestionInsight(activeQuestionItem.id);
                                        return;
                                      }
                                      if (activeQuestionFeedback.answer.trim().length > 0) {
                                        void submitQuestionAnswer(activeQuestionItem);
                                      }
                                    }}
                                    placeholder="Type your answer..."
                                    rows={4}
                                    readOnly={activeQuestionFeedback.loading || activeQuestionHasFeedback}
                                  />
                                  <div className="ai-edge-actions">
                                    <button
                                      type="button"
                                      className="btn-ghost"
                                      onClick={() => {
                                        if (activeQuestionHasFeedback) {
                                          removeQuestionInsight(activeQuestionItem.id);
                                          return;
                                        }
                                        void submitQuestionAnswer(activeQuestionItem);
                                      }}
                                      disabled={activeQuestionActionDisabled}
                                    >
                                      {activeQuestionFeedback.loading ? "Analyzing..." : activeQuestionHasFeedback ? "Done" : "Submit Answer"}
                                    </button>
                                  </div>
                                </section>
                                {activeQuestionFeedback.error ? <p className="question-feedback-error">{activeQuestionFeedback.error}</p> : null}
                                {activeQuestionFeedback.feedback ? (
                                  <section className="question-feedback-box question-card">
                                    <p className="question-box-label">Feedback</p>
                                    <div className="question-feedback-output">{renderMarkdownWithBold(activeQuestionFeedback.feedback)}</div>
                                  </section>
                                ) : null}
                              </div>
                            )}
                          </article>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <div className="ai-corner-actions">
                    <button type="button" className="btn-ghost ai-corner-action-btn" onClick={clearQuestionInsights} disabled={questionInsights.length === 0}>
                      Clear
                    </button>
                  </div>
                </div>
              </section>
            </div>
            <GazeCalibrationOverlay
              open={gazeCalibrationOpen}
              sampleTick={gazeCalibrationSampleTick}
              trackingStatus={gazeTrackingStatus}
              onCancel={() => setGazeCalibrationOpen(false)}
              onComplete={onGazeCalibrationComplete}
            />
            <GazeDebugPanel
              open={gazeDebugOpen}
              onOpenChange={setGazeDebugOpen}
              trackingStatus={gazeTrackingStatus}
              trackingError={gazeTrackingError}
              telemetry={gazeTelemetry}
              latestRawFeature={gazeLatestSample?.rawFeature ?? null}
              latestSmoothFeature={gazeLatestSample?.feature ?? null}
              zone={gazeZone}
              zoneDwellMs={zoneDwellMs}
              secureContext={typeof window !== "undefined" ? window.isSecureContext : false}
              cameraPermission={cameraPermissionState}
              gazeEnabled={gazeSettings.enabled}
              manualRunning={isRunning}
              effectiveRunning={effectiveRunning}
              gazeAutoPaused={gazeAutoPaused}
              gazeAutoPausedReason={gazeAutoPausedReason}
              calibration={gazeCalibration}
              hysteresisBand={effectiveHysteresisBand}
              trace={gazeTrace}
              events={gazeDebugEvents}
              debugStream={gazeDebugStream}
              onClearEvents={clearGazeEvents}
              onClearTrace={clearGazeTrace}
            />
          </section>
        </section>
      </section>
    </main>
  );
}

