/**
 * Durable Object for coordinating AI requests and caching responses
 * Ensures that multiple ICP replicas calling simultaneously get the same response
 */

import type { Env, CachedEntry, GatewayRequest, OpenAIRequest, OpenAIResponse } from './types';
import { generateCacheKey, extractContent } from './utils';

export class AICacheDurableObject implements DurableObject {
  private state: DurableObjectState;
  private env: Env;
  private pendingRequests: Map<string, Promise<CachedEntry>>;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.pendingRequests = new Map();
  }

  /**
   * Handle incoming requests
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Health check
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok' }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Handle cache requests
    if (url.pathname === '/generate' && request.method === 'POST') {
      try {
        const gatewayReq: GatewayRequest = await request.json();
        const result = await this.getOrGenerateResponse(gatewayReq);
        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (error: any) {
        console.error('Error in Durable Object:', error);
        return new Response(
          JSON.stringify({
            error: error.message || 'Internal server error',
            code: 'DURABLE_OBJECT_ERROR'
          }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    // Cleanup endpoint (can be called periodically)
    if (url.pathname === '/cleanup' && request.method === 'POST') {
      try {
        const deleted = await this.cleanupExpiredEntries();
        return new Response(
          JSON.stringify({ deleted, status: 'ok' }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      } catch (error: any) {
        return new Response(
          JSON.stringify({ error: error.message, code: 'CLEANUP_ERROR' }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    return new Response('Not found', { status: 404 });
  }

  /**
   * Get cached response or generate new one (with coordination)
   * This ensures that multiple concurrent requests get the same response
   */
  private async getOrGenerateResponse(req: GatewayRequest): Promise<CachedEntry & { cached: boolean }> {
    const cacheKey = await generateCacheKey(req);

    // Check if we have a cached response
    const cached = await this.state.storage.get<CachedEntry>(cacheKey);

    if (cached) {
      // Update access statistics
      cached.last_accessed = Date.now();
      cached.hit_count = (cached.hit_count || 0) + 1;
      await this.state.storage.put(cacheKey, cached);

      console.log(`Cache HIT for key: ${cacheKey}`);
      return { ...cached, cached: true };
    }

    // Check if a request is already in flight for this cache key
    const pending = this.pendingRequests.get(cacheKey);
    if (pending) {
      console.log(`Request already in flight for key: ${cacheKey}, waiting for result...`);
      const result = await pending;
      // Mark as cached since we're reusing an in-flight request
      return { ...result, cached: true };
    }

    // No cache and no pending request - we need to generate a new response
    console.log(`Cache MISS for key: ${cacheKey}. Generating new response...`);

    // Create a promise for this generation and store it
    const generationPromise = this.generateAndCache(cacheKey, req);
    this.pendingRequests.set(cacheKey, generationPromise);

    try {
      const result = await generationPromise;
      return { ...result, cached: false };
    } finally {
      // Clean up the pending request tracker
      this.pendingRequests.delete(cacheKey);
    }
  }

  /**
   * Generate new response and cache it
   * Separated from getOrGenerateResponse for proper request coordination
   */
  private async generateAndCache(cacheKey: string, req: GatewayRequest): Promise<CachedEntry> {
    // Call OpenAI API
    const content = await this.callOpenAI(req);

    // Create cache entry
    const entry: CachedEntry = {
      content,
      model: req.model,
      seed: req.seed,
      request_hash: cacheKey,
      cached_at: Date.now(),
      last_accessed: Date.now(),
      hit_count: 0
    };

    // Store in Durable Object storage
    await this.state.storage.put(cacheKey, entry);

    console.log(`Cached new response for key: ${cacheKey}`);
    return entry;
  }

  /**
   * Call OpenAI API with deterministic parameters
   */
  private async callOpenAI(req: GatewayRequest): Promise<string> {
    const systemPrompt = req.system_prompt || 'You are a helpful assistant.';
    const maxTokens = req.max_tokens || 150;

    const openaiRequest: OpenAIRequest = {
      model: req.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: req.prompt }
      ],
      temperature: 0, // Must be 0 for determinism
      seed: req.seed,
      max_tokens: maxTokens
    };

    console.log('Calling OpenAI API:', JSON.stringify(openaiRequest));

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify(openaiRequest)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenAI API error:', response.status, errorText);
      throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
    }

    const openaiResponse: OpenAIResponse = await response.json();
    const content = extractContent(openaiResponse);

    console.log('OpenAI response received, content length:', content.length);
    return content;
  }

  /**
   * Clean up expired cache entries
   * Called periodically to manage storage costs
   */
  private async cleanupExpiredEntries(): Promise<number> {
    const retentionDays = parseInt(this.env.CACHE_RETENTION_DAYS || '90', 10);
    const cutoffTime = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);

    console.log(`Starting cleanup: deleting entries older than ${retentionDays} days`);

    let deleted = 0;
    const entries = await this.state.storage.list<CachedEntry>();

    for (const [key, entry] of entries) {
      if (entry.cached_at < cutoffTime) {
        await this.state.storage.delete(key);
        deleted++;
      }
    }

    console.log(`Cleanup complete: deleted ${deleted} entries`);
    return deleted;
  }
}
