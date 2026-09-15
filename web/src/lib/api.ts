import type {
  AIChatResponse,
  AIRequestOptions,
  AuthResponse,
  BookContent,
  CredentialItem,
  CredentialListResponse,
  CredentialUpsertPayload,
  DeleteAccountPayload,
  JobStatusResponse,
  ParseResponse,
  ProgressPayload,
  ProgressResponse,
  ReaderSettingsPayload,
  ReaderSettingsResponse,
  UploadResponse,
  UserProfile,
} from "./types";

function resolveApiBase(): string {
  const explicit = import.meta.env.VITE_API_URL?.trim();
  if (explicit) {
    return explicit;
  }
  if (typeof window === "undefined") {
    return "http://localhost:8000";
  }
  const protocol = window.location.protocol === "https:" ? "https:" : "http:";
  const host = window.location.hostname || "localhost";
  return `${protocol}//${host}:8000`;
}

const API_BASE = resolveApiBase();
export const AUTH_TOKEN_KEY = "speed_reader_auth_token";

function extractErrorDetail(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const detail = record.detail;
  if (typeof detail === "string" && detail.trim()) {
    return detail.trim();
  }

  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => {
        if (!item || typeof item !== "object") {
          return "";
        }
        const message = (item as Record<string, unknown>).msg;
        return typeof message === "string" ? message.trim() : "";
      })
      .filter(Boolean);
    if (messages.length > 0) {
      return messages.join("; ");
    }
  }

  const message = record.message;
  if (typeof message === "string" && message.trim()) {
    return message.trim();
  }

  return null;
}

function buildHeaders(init?: RequestInit): Headers {
  const headers = new Headers(init?.headers ?? {});
  const rawToken = window.localStorage.getItem(AUTH_TOKEN_KEY);
  const token = rawToken?.trim() ?? "";
  const hasUsableToken = token.length > 0 && token !== "null" && token !== "undefined";

  if (hasUsableToken && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  return headers;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = buildHeaders(init);
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed";
    throw new Error(`Network error contacting API (${API_BASE}): ${message}`);
  }

  if (!response.ok) {
    const raw = await response.text();
    const contentType = response.headers.get("content-type") ?? "";
    const retryAfter = response.headers.get("retry-after");

    let detail = raw.trim();
    if (contentType.includes("application/json") && raw.trim()) {
      try {
        const payload = JSON.parse(raw) as unknown;
        detail = extractErrorDetail(payload) ?? detail;
      } catch {
        // Keep raw text when JSON parsing fails.
      }
    }

    let reason = detail || response.statusText || "Request failed";
    if (response.status === 429 && retryAfter) {
      const seconds = Number.parseInt(retryAfter, 10);
      if (Number.isFinite(seconds) && seconds > 0) {
        reason = `${reason} (retry after ${seconds}s)`;
      }
    }
    throw new Error(`${response.status} ${path}: ${reason}`);
  }

  if (response.status === 204 || response.status === 205) {
    return undefined as T;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return undefined as T;
  }

  const raw = await response.text();
  if (!raw.trim()) {
    return undefined as T;
  }

  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid JSON response";
    throw new Error(`Invalid JSON from ${path}: ${message}`);
  }
}

export async function signup(email: string, password: string): Promise<AuthResponse> {
  return request<AuthResponse>("/auth/signup", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  return request<AuthResponse>("/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });
}

export async function getCurrentUser(): Promise<UserProfile> {
  return request<UserProfile>("/auth/me");
}

export async function deleteAccount(payload: DeleteAccountPayload): Promise<void> {
  await request<void>("/auth/me", {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export async function listCredentials(): Promise<CredentialItem[]> {
  const response = await request<CredentialListResponse>("/credentials");
  return response.items;
}

export async function saveCredential(payload: CredentialUpsertPayload): Promise<CredentialItem> {
  return request<CredentialItem>("/credentials", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export async function deleteCredential(provider: string): Promise<void> {
  await request<void>(`/credentials/${provider}`, {
    method: "DELETE",
  });
}

export async function uploadBook(file: File): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append("file", file);

  return request<UploadResponse>("/books/upload", {
    method: "POST",
    body: formData,
  });
}

export async function startParse(bookId: string, force = false): Promise<ParseResponse> {
  return request<ParseResponse>(`/books/${bookId}/parse`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ force }),
  });
}

export async function getJob(jobId: string): Promise<JobStatusResponse> {
  return request<JobStatusResponse>(`/jobs/${jobId}`);
}

export async function getBookContent(bookId: string): Promise<BookContent> {
  return request<BookContent>(`/books/${bookId}/content`);
}

export async function saveProgress(payload: ProgressPayload): Promise<ProgressResponse> {
  return request<ProgressResponse>("/progress", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export async function getProgress(bookTitle: string): Promise<ProgressResponse> {
  const params = new URLSearchParams({ book_title: bookTitle });
  return request<ProgressResponse>(`/progress?${params.toString()}`);
}

export async function saveReaderSettings(payload: ReaderSettingsPayload): Promise<ReaderSettingsResponse> {
  return request<ReaderSettingsResponse>("/reader-settings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export async function getReaderSettings(): Promise<ReaderSettingsResponse> {
  return request<ReaderSettingsResponse>("/reader-settings");
}

export async function requestQuestion(text_chunk: string, options: AIRequestOptions): Promise<string> {
  const model = options.model?.trim() ? options.model.trim() : undefined;
  const response = await request<{ question: string }>("/ai/question", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text_chunk,
      provider: options.provider,
      mode: options.mode,
      model,
    }),
  });
  return response.question;
}

export async function requestEntities(text_chunk: string, options: AIRequestOptions): Promise<string> {
  const model = options.model?.trim() ? options.model.trim() : undefined;
  const response = await request<{ entities: string }>("/ai/entities", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text_chunk,
      provider: options.provider,
      mode: options.mode,
      model,
    }),
  });
  return response.entities;
}

export async function requestChat(
  prompt: string,
  options: AIRequestOptions,
  params?: { temperature?: number; max_tokens?: number },
): Promise<AIChatResponse> {
  const model = options.model?.trim() ? options.model.trim() : undefined;
  return request<AIChatResponse>("/ai/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt,
      provider: options.provider,
      mode: options.mode,
      model,
      temperature: params?.temperature,
      max_tokens: params?.max_tokens,
    }),
  });
}
