import type { FC } from "react";

import type { PauseKey, PauseMultipliers } from "../../lib/pause";
import { PAUSE_ORDER } from "../../lib/pause";
import type { AIRequestMode, ProviderName } from "../../lib/types";
import { GAZE_TUNING } from "./gaze/gazeTuning";

export type ReaderTheme = "dark" | "light" | "teal-dawn";

const PROVIDER_MODEL_HINT: Record<ProviderName, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-haiku-latest",
  gemini: "gemini-2.0-flash",
  ollama: "llama3.1",
};
const QUESTION_INTERVAL_OPTIONS = [500, 750, 1000, 2000, 3000] as const;
const THEME_OPTIONS: Array<{ value: ReaderTheme; label: string }> = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
];
const THEME_LABELS: Record<ReaderTheme, string> = {
  dark: "Dark",
  light: "Light",
  "teal-dawn": "Teal Dawn",
};
const PAUSE_VISUALS: Record<PauseKey, { label: string; chips: string[] }> = {
  period: { label: "Sentence End", chips: [".", "?", "!"] },
  comma: { label: "Comma Group", chips: [",", ":", ";"] },
  hyphen: { label: "Short Hyphen", chips: ["-"] },
  longHyphen: { label: "Long Hyphen", chips: ["\u2014"] },
  parens: { label: "Parentheses", chips: ["(", ")"] },
  header: { label: "Header Text", chips: ["ALL CAPS"] },
  ellipsis: { label: "Ellipsis", chips: ["..."] },
};
type SettingsSectionIconName = "reader" | "appearance" | "pauses" | "gaze" | "ai";

const SettingsSectionIcon: FC<{ name: SettingsSectionIconName }> = ({ name }) => {
  if (name === "reader") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 6a2 2 0 0 1 2-2h5a3 3 0 0 1 3 3v13H6a2 2 0 0 0-2 2z" />
        <path d="M14 7a3 3 0 0 1 3-3h3v15h-6" />
      </svg>
    );
  }
  if (name === "appearance") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="3.2" />
        <path d="M12 3v2.3M12 18.7V21M3 12h2.3M18.7 12H21M5.6 5.6l1.7 1.7M16.7 16.7l1.7 1.7M18.4 5.6l-1.7 1.7M7.3 16.7l-1.7 1.7" />
      </svg>
    );
  }
  if (name === "pauses") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="4" y="4" width="16" height="16" rx="3" />
        <path d="M10 8v8M14 8v8" />
      </svg>
    );
  }
  if (name === "gaze") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M2.5 12s3.3-5 9.5-5 9.5 5 9.5 5-3.3 5-9.5 5-9.5-5-9.5-5z" />
        <circle cx="12" cy="12" r="2.4" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="7" y="7" width="10" height="10" rx="2" />
      <path d="M10 10h4M10 14h4M3 9h4M3 15h4M17 9h4M17 15h4M9 3v4M15 3v4M9 17v4M15 17v4" />
    </svg>
  );
};

interface ReaderControlsProps {
  contextRange: number;
  contextOpacity: number;
  flankOpacity: number;
  theme: ReaderTheme;
  gazeEnabled: boolean;
  gazeCalibrated: boolean;
  gazeStatusLabel: string;
  gazePauseDelayMs: number;
  gazeResumeDelayMs: number;
  gazeHysteresisBand: number;
  gazeDebugOpen: boolean;
  aiProvider: ProviderName;
  aiMode: AIRequestMode;
  aiModel: string;
  aiAvailable: boolean;
  aiQuestionEnabled: boolean;
  aiQuestionInterval: number;
  aiEntityEnabled: boolean;
  onThemeChange: (value: ReaderTheme) => void;
  onRangeChange: (value: number) => void;
  onContextOpacityChange: (value: number) => void;
  onFlankOpacityChange: (value: number) => void;
  onGazeEnabledChange: (value: boolean) => void;
  onGazePauseDelayChange: (value: number) => void;
  onGazeResumeDelayChange: (value: number) => void;
  onGazeHysteresisBandChange: (value: number) => void;
  onOpenGazeCalibration: () => void;
  onGazeDebugOpenChange: (value: boolean) => void;
  onAiProviderChange: (value: ProviderName) => void;
  onAiModeChange: (value: AIRequestMode) => void;
  onAiModelChange: (value: string) => void;
  onAiQuestionEnabledChange: (value: boolean) => void;
  onAiQuestionIntervalChange: (value: number) => void;
  onAiEntityEnabledChange: (value: boolean) => void;
  onPauseMultiplierChange: (key: PauseKey, value: number) => void;
  pauseMultipliers: PauseMultipliers;
}

export const ReaderControls: FC<ReaderControlsProps> = ({
  contextRange,
  contextOpacity,
  flankOpacity,
  theme,
  gazeEnabled,
  gazeCalibrated,
  gazeStatusLabel,
  gazePauseDelayMs,
  gazeResumeDelayMs,
  gazeHysteresisBand,
  gazeDebugOpen,
  aiProvider,
  aiMode,
  aiModel,
  aiAvailable,
  aiQuestionEnabled,
  aiQuestionInterval,
  aiEntityEnabled,
  onThemeChange,
  onRangeChange,
  onContextOpacityChange,
  onFlankOpacityChange,
  onGazeEnabledChange,
  onGazePauseDelayChange,
  onGazeResumeDelayChange,
  onGazeHysteresisBandChange,
  onOpenGazeCalibration,
  onGazeDebugOpenChange,
  onAiProviderChange,
  onAiModeChange,
  onAiModelChange,
  onAiQuestionEnabledChange,
  onAiQuestionIntervalChange,
  onAiEntityEnabledChange,
  onPauseMultiplierChange,
  pauseMultipliers,
}) => {
  return (
    <section className="controls">
      <div className="settings-menu">
        <details className="settings-section">
          <summary className="settings-section-summary">
            <span className="settings-section-title">
              <span className="settings-section-icon settings-section-icon-reader">
                <SettingsSectionIcon name="reader" />
              </span>
              <span>Reader</span>
            </span>
          </summary>
          <div className="settings-section-body">
            <label className="settings-slider-wrap">
              <span className="settings-slider-header">
                <span>Context Range</span>
                <strong className="settings-slider-value">{contextRange}</strong>
              </span>
              <input
                className="settings-range"
                type="range"
                min={5}
                max={100}
                value={contextRange}
                onChange={(event) => onRangeChange(Number(event.target.value))}
              />
            </label>

            <label className="settings-slider-wrap">
              <span className="settings-slider-header">
                <span>Context Opacity</span>
                <strong className="settings-slider-value">{contextOpacity}</strong>
              </span>
              <input
                className="settings-range"
                type="range"
                min={0}
                max={100}
                value={contextOpacity}
                onChange={(event) => onContextOpacityChange(Number(event.target.value))}
              />
            </label>

            <label className="settings-slider-wrap">
              <span className="settings-slider-header">
                <span>Flank Opacity</span>
                <strong className="settings-slider-value">{flankOpacity}</strong>
              </span>
              <input
                className="settings-range"
                type="range"
                min={0}
                max={100}
                value={flankOpacity}
                onChange={(event) => onFlankOpacityChange(Number(event.target.value))}
              />
            </label>
          </div>
        </details>

        <details className="settings-section">
          <summary className="settings-section-summary">
            <span className="settings-section-title">
              <span className="settings-section-icon settings-section-icon-appearance">
                <SettingsSectionIcon name="appearance" />
              </span>
              <span>Appearance</span>
            </span>
          </summary>
          <div className="settings-section-body">
            <div className="interval-picker">
              <div className="interval-picker-head">
                <span>Theme</span>
                <strong>{THEME_LABELS[theme]}</strong>
              </div>
              <div className="interval-picker-options">
                {THEME_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`interval-option${theme === option.value ? " active" : ""}`}
                    onClick={() => onThemeChange(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <p className="settings-note">Theme applies instantly.</p>
          </div>
        </details>

        <details className="settings-section">
          <summary className="settings-section-summary">
            <span className="settings-section-title">
              <span className="settings-section-icon settings-section-icon-pauses">
                <SettingsSectionIcon name="pauses" />
              </span>
              <span>Pauses</span>
            </span>
          </summary>
          <div className="settings-section-body pause-panel">
            {PAUSE_ORDER.map((key) => {
              const value = pauseMultipliers[key];
              const visual = PAUSE_VISUALS[key];
              return (
                <label className="settings-slider-wrap" key={key}>
                  <span className="settings-slider-header">
                    <span className="pause-slider-label">
                      <span className="pause-slider-title">{visual.label}</span>
                      <span className="pause-chip-row">
                        {visual.chips.map((chip) => (
                          <span key={`${key}-${chip}`} className={`pause-chip pause-chip-${key}`}>
                            {chip}
                          </span>
                        ))}
                      </span>
                    </span>
                    <strong className="settings-slider-value">{value.toFixed(1)}x</strong>
                  </span>
                  <input
                    className="settings-range"
                    type="range"
                    min={0.5}
                    max={4}
                    step={0.1}
                    value={value}
                    onChange={(event) => onPauseMultiplierChange(key, Number(event.target.value))}
                  />
                </label>
              );
            })}
          </div>
        </details>

        <details className="settings-section">
          <summary className="settings-section-summary">
            <span className="settings-section-title">
              <span className="settings-section-icon settings-section-icon-gaze">
                <SettingsSectionIcon name="gaze" />
              </span>
              <span>Eye Tracking</span>
            </span>
          </summary>
          <div className="settings-section-body pause-panel">
            <label className="settings-switch-row">
              <span>Enable Eye Pause</span>
              <input type="checkbox" checked={gazeEnabled} onChange={(event) => onGazeEnabledChange(event.target.checked)} />
            </label>

            <p className="settings-note">
              Status: {gazeStatusLabel} | Calibration: {gazeCalibrated ? "Ready" : "Required"}
            </p>

            <label className="settings-slider-wrap">
              <span className="settings-slider-header">
                <span>Pause Delay</span>
                <strong className="settings-slider-value">{gazePauseDelayMs} ms</strong>
              </span>
              <input
                className="settings-range"
                type="range"
                min={GAZE_TUNING.automation.pauseDelayMs.min}
                max={GAZE_TUNING.automation.pauseDelayMs.max}
                step={GAZE_TUNING.automation.pauseDelayMs.step}
                value={gazePauseDelayMs}
                onChange={(event) => onGazePauseDelayChange(Number(event.target.value))}
                disabled={!gazeEnabled}
              />
            </label>

            <label className="settings-slider-wrap">
              <span className="settings-slider-header">
                <span>Resume Delay</span>
                <strong className="settings-slider-value">{gazeResumeDelayMs} ms</strong>
              </span>
              <input
                className="settings-range"
                type="range"
                min={GAZE_TUNING.automation.resumeDelayMs.min}
                max={GAZE_TUNING.automation.resumeDelayMs.max}
                step={GAZE_TUNING.automation.resumeDelayMs.step}
                value={gazeResumeDelayMs}
                onChange={(event) => onGazeResumeDelayChange(Number(event.target.value))}
                disabled={!gazeEnabled}
              />
            </label>

            <label className="settings-slider-wrap">
              <span className="settings-slider-header">
                <span>Vertical Bound</span>
                <strong className="settings-slider-value">{gazeHysteresisBand.toFixed(3)}</strong>
              </span>
              <input
                className="settings-range"
                type="range"
                min={GAZE_TUNING.verticalBound.min}
                max={GAZE_TUNING.verticalBound.max}
                step={GAZE_TUNING.verticalBound.step}
                value={gazeHysteresisBand}
                onChange={(event) => onGazeHysteresisBandChange(Number(event.target.value))}
                disabled={!gazeEnabled}
              />
            </label>

            <button type="button" className="btn-ghost" onClick={onOpenGazeCalibration}>
              Calibrate Eye Targets
            </button>

            <label className="settings-switch-row">
              <span>Debug Panel</span>
              <input type="checkbox" checked={gazeDebugOpen} onChange={(event) => onGazeDebugOpenChange(event.target.checked)} />
            </label>
          </div>
        </details>

        <details className="settings-section">
          <summary className="settings-section-summary">
            <span className="settings-section-title">
              <span className="settings-section-icon settings-section-icon-ai">
                <SettingsSectionIcon name="ai" />
              </span>
              <span>AI Automation</span>
            </span>
          </summary>
          <div className="settings-section-body pause-panel">
            <label className="settings-field">
              <span>Provider</span>
              <select value={aiProvider} onChange={(event) => onAiProviderChange(event.target.value as ProviderName)} disabled={!aiAvailable}>
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="gemini">Gemini</option>
                <option value="ollama">Ollama</option>
              </select>
            </label>

            <label className="settings-field">
              <span>Mode</span>
              <select value={aiMode} onChange={(event) => onAiModeChange(event.target.value as AIRequestMode)} disabled={!aiAvailable}>
                <option value="byok">BYOK</option>
                <option value="auto">Auto</option>
                <option value="managed">Managed</option>
              </select>
            </label>

            <label className="settings-field">
              <span>Model (optional)</span>
              <input
                type="text"
                value={aiModel}
                onChange={(event) => onAiModelChange(event.target.value)}
                placeholder={`e.g. ${PROVIDER_MODEL_HINT[aiProvider]}`}
                disabled={!aiAvailable}
              />
            </label>

            <p className="settings-note">Leave blank to use backend provider defaults.</p>

            {!aiAvailable ? <p className="settings-note">Log in to enable BYOK AI requests.</p> : null}

            <label className="settings-switch-row">
              <span>Comprehension Questions</span>
              <input
                type="checkbox"
                checked={aiQuestionEnabled}
                onChange={(event) => onAiQuestionEnabledChange(event.target.checked)}
                disabled={!aiAvailable}
              />
            </label>

            <div className="interval-picker">
              <div className="interval-picker-head">
                <span>Question Interval</span>
                <strong>{aiQuestionInterval} words</strong>
              </div>
              <div className="interval-picker-options">
                {QUESTION_INTERVAL_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={`interval-option${aiQuestionInterval === option ? " active" : ""}`}
                    disabled={!aiAvailable || !aiQuestionEnabled}
                    onClick={() => onAiQuestionIntervalChange(option)}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>

            <label className="settings-switch-row">
              <span>Context Monitor (Dates/Characters)</span>
              <input
                type="checkbox"
                checked={aiEntityEnabled}
                onChange={(event) => onAiEntityEnabledChange(event.target.checked)}
                disabled={!aiAvailable}
              />
            </label>

            <p className="settings-note">Context monitor interval is fixed at 500 words.</p>
            <p className="settings-note">Auto AI sends a 500-word context window with 50-word overlap.</p>
          </div>
        </details>
      </div>
    </section>
  );
};
