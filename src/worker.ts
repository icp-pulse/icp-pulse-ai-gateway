/**
 * Cloudflare Worker - Main entry point for ICP Deterministic AI Gateway
 * Routes requests to Durable Objects for coordination and caching
 */

import type { Env, GatewayRequest, GatewayResponse, GatewayError } from './types';
import { validateRequest, generateCacheKey, generateSignature } from './utils';
import { AICacheDurableObject } from './durable-object';

// Export Durable Object class
export { AICacheDurableObject };

/**
 * Main worker fetch handler
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // CORS headers for ICP HTTP outcalls
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Handle preflight OPTIONS request
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    // Health check endpoint
    if (url.pathname === '/health' && request.method === 'GET') {
      return new Response(
        JSON.stringify({
          status: 'ok',
          service: 'icp-deterministic-ai-gateway',
          version: '1.0.0'
        }),
        {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        }
      );
    }

    // Main generate endpoint
    if (url.pathname === '/generate' && request.method === 'POST') {
      try {
        // Parse request
        const gatewayReq: GatewayRequest = await request.json();

        // Validate request
        const validation = validateRequest(gatewayReq);
        if (!validation.valid) {
          const error: GatewayError = {
            error: validation.error || 'Invalid request',
            code: 'VALIDATION_ERROR'
          };
          return new Response(JSON.stringify(error), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        // Get cache key for routing to consistent Durable Object
        const cacheKey = await generateCacheKey(gatewayReq);

        // Get Durable Object instance (same cache key always routes to same DO)
        const id = env.AI_CACHE.idFromName(cacheKey);
        const stub = env.AI_CACHE.get(id);

        // Forward request to Durable Object
        const doResponse = await stub.fetch(request.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(gatewayReq)
        });

        if (!doResponse.ok) {
          const errorText = await doResponse.text();
          return new Response(errorText, {
            status: doResponse.status,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        const cachedEntry = await doResponse.json();

        // Generate HMAC signature for ICP verification
        const signature = await generateSignature(
          cachedEntry.request_hash,
          cachedEntry.content,
          env.SIGNING_SECRET
        );

        // Build deterministic response
        const response: GatewayResponse = {
          content: cachedEntry.content,
          model: cachedEntry.model,
          seed: cachedEntry.seed,
          signature,
          cached: cachedEntry.cached,
          request_hash: cachedEntry.request_hash
        };

        return new Response(JSON.stringify(response), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      } catch (error: any) {
        console.error('Worker error:', error);
        const errorResponse: GatewayError = {
          error: error.message || 'Internal server error',
          code: 'WORKER_ERROR',
          details: error.stack
        };
        return new Response(JSON.stringify(errorResponse), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // Cleanup endpoint (can be called via cron or manually)
    if (url.pathname === '/cleanup' && request.method === 'POST') {
      try {
        // This could be restricted to authorized callers only
        // For now, we'll run cleanup on a sample of Durable Objects

        // Note: In production, you'd iterate through known cache keys
        // or use a scheduled cron trigger to call this periodically
        return new Response(
          JSON.stringify({
            status: 'ok',
            message: 'Cleanup endpoint - implement cron trigger for automatic cleanup'
          }),
          {
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          }
        );
      } catch (error: any) {
        const errorResponse: GatewayError = {
          error: error.message,
          code: 'CLEANUP_ERROR'
        };
        return new Response(JSON.stringify(errorResponse), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // 404 for unknown endpoints
    return new Response('Not found', {
      status: 404,
      headers: corsHeaders
    });
  },

  /**
   * Scheduled handler for automatic cache cleanup
   * Configure in wrangler.toml with: triggers = { crons = ["0 0 * * 0"] } // Weekly
   */
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log('Running scheduled cleanup...');
    // Note: In a real implementation, you'd need to track active cache keys
    // and iterate through them to run cleanup on each Durable Object
    console.log('Cleanup scheduled task - implement DO iteration');
  }
};
