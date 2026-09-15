export type ChapterEntry = [string, number];

export interface BookContent {
  book_id: string;
  words: string[];
  chapters: ChapterEntry[];
  page_map: Record<string, number>;
  footnotes: Record<string, string>;
}

export interface UploadResponse {
  book_id: string;
  filename: string;
}

export interface ParseResponse {
  job_id: string;
  status: string;
}

export interface JobStatusResponse {
  job_id: string;
  type: string;
  status: "queued" | "running" | "succeeded" | "failed";
  error?: string | null;
  result: Record<string, unknown>;
}

export interface ProgressPayload {
  book_title: string;
  index: number;
}

export interface ProgressResponse {
  book_title: string;
  index: number;
}

export interface ReaderSettingsPayload {
  settings: Record<string, unknown>;
}

export interface ReaderSettingsResponse {
  settings: Record<string, unknown>;
}

export interface UserProfile {
  id: string;
  email: string;
  plan_tier: string;
  billing_mode: string;
  credit_balance: number;
  is_active: boolean;
  created_at: string;
}

export interface AuthResponse {
  access_token: string;
  token_type: "bearer";
  user: UserProfile;
}

export interface DeleteAccountPayload {
  email: string;
  password: string;
  confirmation: string;
}

export type ProviderName = "openai" | "anthropic" | "gemini" | "ollama";
export type AIRequestMode = "auto" | "byok" | "managed";

export interface CredentialItem {
  id: string;
  provider: ProviderName;
  label?: string | null;
  key_last4: string;
  is_active: boolean;
  verified_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CredentialListResponse {
  items: CredentialItem[];
}

export interface CredentialUpsertPayload {
  provider: ProviderName;
  api_key: string;
  label?: string;
}

export interface AIRequestOptions {
  provider: ProviderName;
  mode: AIRequestMode;
  model?: string;
}

export interface AIChatResponse {
  content: string;
  provider: string;
  model: string;
  mode_used: string;
  usage: {
    prompt_tokens?: number | null;
    completion_tokens?: number | null;
    total_tokens?: number | null;
  };
  credits_deducted: number;
  credit_balance: number;
}
