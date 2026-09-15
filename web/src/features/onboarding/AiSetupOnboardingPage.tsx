import { useEffect, useMemo, useState, type FC, type FormEvent } from "react";

import { deleteCredential, listCredentials, saveCredential } from "../../lib/api";
import type { CredentialItem, ProviderName, UserProfile } from "../../lib/types";

interface AiSetupOnboardingPageProps {
  user: UserProfile;
  onSkip: () => void;
  onOpenAccountSetup: () => void;
}

interface ProviderGuide {
  label: string;
  recommended?: boolean;
  overview: string;
  apiKeyHint: string;
  steps: string[];
  helpText: string;
}

const PROVIDER_ORDER: ProviderName[] = ["ollama", "openai", "anthropic", "gemini"];
const PROVIDER_LABELS: Record<ProviderName, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Gemini",
  ollama: "Ollama",
};

interface CredentialErrorState {
  title: string;
  detail: string;
}

function toHumanErrorDetail(message: string): string {
  const normalized = message.trim();
  const firstColon = normalized.indexOf(":");
  if (firstColon === -1) {
    return normalized;
  }
  const detail = normalized.slice(firstColon + 1).trim();
  return detail.length > 0 ? detail : normalized;
}

function buildCredentialErrorState(rawMessage: string, provider: ProviderName): CredentialErrorState {
  const detail = toHumanErrorDetail(rawMessage);
  const lower = detail.toLowerCase();
  const providerLabel = PROVIDER_LABELS[provider];

  if (lower.includes("network error")) {
    return {
      title: "Connection Failed",
      detail: "Could not reach the API service while saving this key. Check your connection and try again.",
    };
  }

  if (lower.includes("401") || lower.includes("403") || lower.includes("unauthorized") || lower.includes("invalid")) {
    return {
      title: `${providerLabel} Key Rejected`,
      detail: "The key appears invalid or missing required permissions for this provider.",
    };
  }

  if (lower.includes("429") || lower.includes("rate")) {
    return {
      title: "Rate Limited",
      detail: "Credential validation is temporarily rate limited. Wait a moment, then try again.",
    };
  }

  return {
    title: "Unable To Save Key",
    detail,
  };
}

const PROVIDER_GUIDES: Record<ProviderName, ProviderGuide> = {
  ollama: {
    label: "Ollama",
    recommended: true,
    overview: "Recommended for Ollama cloud models using account API keys.",
    apiKeyHint: "ollama-api-key",
    steps: [
      "Sign in to your Ollama account on the Ollama website.",
      "Open your account settings and go to API Keys.",
      "Create a new API key and copy it immediately.",
      "Paste the key into this setup screen to save it to your encrypted vault.",
    ],
    helpText: "This setup uses Ollama cloud models through your Ollama account API key.",
  },
  openai: {
    label: "OpenAI",
    overview: "Cloud-hosted GPT models with managed reliability.",
    apiKeyHint: "sk-...",
    steps: [
      "Sign in at platform.openai.com.",
      "Open API Keys and select Create new secret key.",
      "Copy the key immediately and store it securely.",
      "Paste it into Account -> Provider Keys in Speed Reader.",
    ],
    helpText: "OpenAI keys start with `sk-`.",
  },
  anthropic: {
    label: "Anthropic",
    overview: "Claude models with strong reasoning performance.",
    apiKeyHint: "sk-ant-...",
    steps: [
      "Sign in at console.anthropic.com.",
      "Open API Keys and create a new key.",
      "Copy the key and keep it private.",
      "Paste it into Account -> Provider Keys in Speed Reader.",
    ],
    helpText: "Anthropic keys start with `sk-ant-`.",
  },
  gemini: {
    label: "Gemini",
    overview: "Google Gemini models via AI Studio keys.",
    apiKeyHint: "AIza...",
    steps: [
      "Sign in to Google AI Studio at aistudio.google.com.",
      "Open Get API key / API keys and create a new key.",
      "Copy the generated key.",
      "Paste it into Account -> Provider Keys in Speed Reader.",
    ],
    helpText: "Gemini keys usually start with `AIza`.",
  },
};

export const AiSetupOnboardingPage: FC<AiSetupOnboardingPageProps> = ({ user, onSkip, onOpenAccountSetup }) => {
  const [provider, setProvider] = useState<ProviderName>("ollama");
  const [credentials, setCredentials] = useState<CredentialItem[]>([]);
  const [loadingCredentials, setLoadingCredentials] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [credentialError, setCredentialError] = useState<CredentialErrorState | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  const guide = useMemo(() => PROVIDER_GUIDES[provider], [provider]);

  useEffect(() => {
    void refreshCredentials();
  }, []);

  async function refreshCredentials(): Promise<void> {
    setLoadingCredentials(true);
    setListError(null);
    try {
      const items = await listCredentials();
      setCredentials(items);
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "Unable to load credentials.";
      setListError(toHumanErrorDetail(message));
    } finally {
      setLoadingCredentials(false);
    }
  }

  async function onSaveCredential(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!apiKey.trim()) {
      setCredentialError({
        title: "API Key Required",
        detail: "Paste a key for the selected provider before saving.",
      });
      setSaveSuccess(null);
      return;
    }

    setSaving(true);
    setCredentialError(null);
    setSaveSuccess(null);
    try {
      const saved = await saveCredential({
        provider,
        api_key: apiKey.trim(),
        label: label.trim() || undefined,
      });
      setApiKey("");
      setLabel("");
      setCredentials((current) => {
        const filtered = current.filter((item) => item.provider !== saved.provider);
        return [...filtered, saved].sort((a, b) => a.provider.localeCompare(b.provider));
      });
      setSaveSuccess(`${PROVIDER_LABELS[provider]} key saved to your encrypted vault.`);
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "Failed to save credential.";
      setCredentialError(buildCredentialErrorState(message, provider));
    } finally {
      setSaving(false);
    }
  }

  async function onRemoveCredential(providerName: ProviderName): Promise<void> {
    setListError(null);
    try {
      await deleteCredential(providerName);
      setCredentials((current) => current.filter((item) => item.provider !== providerName));
      if (providerName === provider) {
        setSaveSuccess(null);
      }
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "Failed to remove credential.";
      setListError(toHumanErrorDetail(message));
    }
  }

  return (
    <main className="ai-setup-page">
      <section className="ai-setup-card">
        <header className="ai-setup-head">
          <div>
            <p className="auth-eyebrow">Welcome, {user.email}</p>
            <h1>Set Up AI Integration</h1>
            <p>
              Pick a provider to see setup steps for getting an API key. You can skip this now and complete it later from your account settings.
            </p>
          </div>
          <button type="button" className="btn-ghost" onClick={onSkip}>
            Skip For Now
          </button>
        </header>

        <div className="ai-setup-provider-grid" role="tablist" aria-label="AI provider setup guides">
          {PROVIDER_ORDER.map((item) => {
            const itemGuide = PROVIDER_GUIDES[item];
            const active = item === provider;
            return (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={active}
                className={`ai-setup-provider-btn${active ? " active" : ""}${itemGuide.recommended ? " recommended" : ""}`}
                onClick={() => setProvider(item)}
              >
                <span className="ai-setup-provider-top">
                  <strong>{itemGuide.label}</strong>
                  {itemGuide.recommended ? <span className="ai-setup-recommended">Recommended</span> : null}
                </span>
                <span>{itemGuide.overview}</span>
              </button>
            );
          })}
        </div>

        <section className="ai-setup-guide" role="tabpanel" aria-label={`${guide.label} setup guide`}>
          <div className="ai-setup-guide-head">
            <h2>{guide.label} API Key Setup</h2>
            <span className="ai-setup-key-hint">Key format: {guide.apiKeyHint}</span>
          </div>
          <ol className="ai-setup-steps">
            {guide.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <p className="ai-setup-help">{guide.helpText}</p>
        </section>

        <section className="account-block ai-setup-key-panel">
          <h2>Save {guide.label} Key In App</h2>
          <p>
            Complete provider setup here so AI features are ready immediately. You can still edit these keys later in the account pane or account
            page.
          </p>
          <form className="account-form ai-setup-key-form" onSubmit={(event) => void onSaveCredential(event)}>
            <label>
              Label (optional)
              <input
                type="text"
                value={label}
                onChange={(event) => {
                  setLabel(event.target.value);
                  setCredentialError(null);
                }}
                placeholder={`${guide.label} key`}
              />
            </label>
            <label>
              <span className="account-key-label">{guide.label} API Key</span>
              <input
                type="password"
                value={apiKey}
                onChange={(event) => {
                  setApiKey(event.target.value);
                  setCredentialError(null);
                }}
                autoComplete="off"
                placeholder={`Paste key (${guide.apiKeyHint})`}
              />
            </label>
            <button type="submit" disabled={saving}>
              {saving ? "Saving..." : `Save ${guide.label} Key`}
            </button>
          </form>

          {saveSuccess ? <p className="ai-setup-save-success">{saveSuccess}</p> : null}
          {credentialError ? (
            <div className="account-error account-error-key" role="alert" aria-live="polite">
              <span className="account-error-icon" aria-hidden="true">
                !
              </span>
              <div>
                <strong>{credentialError.title}</strong>
                <p>{credentialError.detail}</p>
              </div>
            </div>
          ) : null}

          <div className="account-list-head ai-setup-saved-head">
            <h4>Saved Keys</h4>
            <button type="button" className="btn-secondary" onClick={() => void refreshCredentials()}>
              Refresh
            </button>
          </div>
          {loadingCredentials ? <p>Loading saved keys...</p> : null}
          {listError ? <p className="account-error account-error-inline">{listError}</p> : null}
          {!loadingCredentials && credentials.length === 0 ? <p>No saved provider keys yet.</p> : null}
          {!loadingCredentials && credentials.length > 0 ? (
            <ul className="account-credential-list">
              {credentials.map((item) => (
                <li key={item.id}>
                  <div>
                    <strong>{PROVIDER_LABELS[item.provider]}</strong>
                    <div className="account-credential-meta">
                      <span className="account-credential-chip">{item.label || "No label"}</span>
                      <span className="account-credential-chip">****{item.key_last4}</span>
                    </div>
                  </div>
                  <button type="button" className="btn-ghost" onClick={() => void onRemoveCredential(item.provider)}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <footer className="ai-setup-actions">
          <button type="button" onClick={onOpenAccountSetup}>
            Open Account Setup
          </button>
          <button type="button" className="btn-secondary" onClick={onSkip}>
            Continue To Reader
          </button>
        </footer>
      </section>
    </main>
  );
};
