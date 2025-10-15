/**
 * Type definitions for the ICP Deterministic AI Gateway
 */

// Request from ICP canister
export interface GatewayRequest {
  model: string;           // e.g., "gpt-4o-mini"
  prompt: string;          // The actual prompt/question
  seed: number;            // Required for determinism
  temperature?: number;    // Must be 0 for determinism (default: 0)
  max_tokens?: number;     // Optional token limit (default: 150)
  system_prompt?: string;  // Optional system message
}

// Response to ICP canister (deterministic format)
export interface GatewayResponse {
  content: string;         // The AI-generated content
  model: string;           // Model used
  seed: number;            // Seed used
  signature: string;       // HMAC-SHA256 signature for verification
  cached: boolean;         // Whether this was a cache hit
  request_hash: string;    // Hash of the request for debugging
}

// Error response
export interface GatewayError {
  error: string;
  code: string;
  details?: string;
}

// OpenAI API types (simplified)
export interface OpenAIRequest {
  model: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  temperature: number;
  seed: number;
  max_tokens?: number;
}

export interface OpenAIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  system_fingerprint?: string;
}

// Cached response entry
export interface CachedEntry {
  content: string;
  model: string;
  seed: number;
  request_hash: string;
  cached_at: number;       // Timestamp when cached
  last_accessed: number;   // Last access timestamp
  hit_count: number;       // Number of cache hits
}

// Cloudflare Worker environment bindings
export interface Env {
  OPENAI_API_KEY: string;              // OpenAI API key (secret)
  SIGNING_SECRET: string;              // HMAC signing secret (secret)
  AI_CACHE: DurableObjectNamespace;    // Durable Object namespace
  CACHE_RETENTION_DAYS?: string;       // Optional: cache retention period (default: 90)
}

// Durable Object stub
export interface AICacheDurableObject extends DurableObject {
  fetch(request: Request): Promise<Response>;
}
