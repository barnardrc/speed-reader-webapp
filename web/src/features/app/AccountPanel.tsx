import { useEffect, useState, type FC, type FormEvent } from "react";

import { deleteCredential, listCredentials, saveCredential } from "../../lib/api";
import type { CredentialItem, ProviderName, UserProfile } from "../../lib/types";

interface AccountPanelProps {
  user: UserProfile;
  onClose: () => void;
  onOpenAccountPage: () => void;
  onLogout: () => void;
}

const PROVIDERS: ProviderName[] = ["openai", "anthropic", "gemini", "ollama"];
const PROVIDER_LABELS: Record<ProviderName, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Gemini",
  ollama: "Ollama",
};
const PROVIDER_KEY_HINTS: Record<ProviderName, string> = {
  openai: "sk-...",
  anthropic: "sk-ant-...",
  gemini: "AIza...",
  ollama: "ollama-api-key",
};
const PROVIDER_HELP: Record<ProviderName, string> = {
  openai: "Use a secret key from your OpenAI dashboard with model access enabled.",
  anthropic: "Use a valid Anthropic API key with Claude model permissions.",
  gemini: "Use a Google AI Studio Gemini key for your selected Gemini models.",
  ollama: "Use an Ollama account API key for cloud model access from your Ollama account settings.",
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

export const AccountPanel: FC<AccountPanelProps> = ({ user, onClose, onOpenAccountPage, onLogout }) => {
  const [credentials, setCredentials] = useState<CredentialItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [provider, setProvider] = useState<ProviderName>("openai");
  const [apiKey, setApiKey] = useState("");
  const [label, setLabel] = useState("");
  const [credentialError, setCredentialError] = useState<CredentialErrorState | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const providerLabel = PROVIDER_LABELS[provider];
  const providerHint = PROVIDER_KEY_HINTS[provider];
  const providerHelp = PROVIDER_HELP[provider];

  useEffect(() => {
    void refreshCredentials();
  }, []);

  async function refreshCredentials(): Promise<void> {
    setLoading(true);
    setListError(null);
    try {
      const items = await listCredentials();
      setCredentials(items);
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "Unable to load credentials.";
      setListError(toHumanErrorDetail(message));
    } finally {
      setLoading(false);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!apiKey.trim()) {
      setCredentialError({
        title: "API Key Required",
        detail: "Paste a key for the selected provider before saving.",
      });
      return;
    }
    setSaving(true);
    setCredentialError(null);
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
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "Failed to save credential.";
      setCredentialError(buildCredentialErrorState(message, provider));
    } finally {
      setSaving(false);
    }
  }

  async function remove(providerName: ProviderName): Promise<void> {
    setListError(null);
    try {
      await deleteCredential(providerName);
      setCredentials((current) => current.filter((item) => item.provider !== providerName));
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "Failed to remove credential.";
      setListError(toHumanErrorDetail(message));
    }
  }

  return (
    <aside className="account-panel" role="dialog" aria-modal="true" aria-label="Account settings">
      <header className="account-panel-head">
        <div>
          <p className="account-eyebrow">Signed In</p>
          <h3>{user.email}</h3>
        </div>
        <button type="button" className="btn-ghost" onClick={onClose}>
          Close
        </button>
      </header>

      <div className="account-status-grid">
        <div>
          <span>Tier</span>
          <strong>{user.plan_tier}</strong>
        </div>
        <div>
          <span>Billing</span>
          <strong>{user.billing_mode}</strong>
        </div>
        <div>
          <span>Credits</span>
          <strong>{user.credit_balance.toLocaleString()}</strong>
        </div>
      </div>

      <section className="account-block account-provider-block">
        <div className="account-provider-head">
          <span className={`account-provider-pill account-provider-pill-${provider}`}>{providerLabel}</span>
          <span className="account-provider-vault">Encrypted Vault</span>
        </div>
        <h4>Provider Keys (BYOK)</h4>
        <p className="account-provider-help">{providerHelp}</p>
        <form className="account-form account-provider-form" onSubmit={(event) => void onSubmit(event)}>
          <div className="account-provider-grid">
            <label>
              Provider
              <select
                value={provider}
                onChange={(event) => {
                  setProvider(event.target.value as ProviderName);
                  setCredentialError(null);
                }}
              >
                {PROVIDERS.map((item) => (
                  <option key={item} value={item}>
                    {PROVIDER_LABELS[item]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Label (optional)
              <input type="text" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Personal provider key" />
            </label>
          </div>
          <label>
            <span className="account-key-label">API Key</span>
            <input
              type="password"
              value={apiKey}
              onChange={(event) => {
                setApiKey(event.target.value);
                setCredentialError(null);
              }}
              autoComplete="off"
              placeholder={`Paste ${providerLabel} key (${providerHint})`}
            />
          </label>
          <button type="submit" disabled={saving}>
            {saving ? "Saving..." : "Save Credential"}
          </button>
        </form>
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
      </section>

      <section className="account-block">
        <div className="account-list-head">
          <h4>Saved Credentials</h4>
          <button type="button" className="btn-secondary" onClick={() => void refreshCredentials()}>
            Refresh
          </button>
        </div>
        {loading ? <p>Loading credentials...</p> : null}
        {listError ? <p className="account-error account-error-inline">{listError}</p> : null}
        {!loading && credentials.length === 0 ? <p>No saved provider keys yet.</p> : null}
        {!loading && credentials.length > 0 ? (
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
                <button type="button" className="btn-ghost" onClick={() => void remove(item.provider)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <footer className="account-panel-foot">
        <button
          type="button"
          className="btn-ghost"
          onClick={() => {
            onClose();
            onOpenAccountPage();
          }}
        >
          Open Full Account Page
        </button>
        <button type="button" className="btn-secondary" onClick={onLogout}>
          Log Out
        </button>
      </footer>
    </aside>
  );
};
