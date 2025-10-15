/**
 * Utility functions for deterministic hashing and signing
 */

import type { GatewayRequest } from './types';

/**
 * Generate deterministic cache key from request parameters
 */
export async function generateCacheKey(req: GatewayRequest): Promise<string> {
  const temperature = req.temperature ?? 0;
  const maxTokens = req.max_tokens ?? 150;
  const systemPrompt = req.system_prompt ?? '';

  // Create deterministic string representation
  const keyString = `${req.model}:${req.prompt}:${systemPrompt}:${temperature}:${req.seed}:${maxTokens}`;

  // Hash it with SHA-256
  const encoder = new TextEncoder();
  const data = encoder.encode(keyString);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);

  // Convert to hex string
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Generate HMAC-SHA256 signature for response verification
 */
export async function generateSignature(
  requestHash: string,
  content: string,
  secret: string
): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);

  // Import the secret key
  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  // Create signature data: requestHash + content
  const signatureData = encoder.encode(`${requestHash}:${content}`);

  // Generate HMAC
  const signature = await crypto.subtle.sign('HMAC', key, signatureData);

  // Convert to hex string
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Validate incoming request
 */
export function validateRequest(req: GatewayRequest): { valid: boolean; error?: string } {
  if (!req.model || typeof req.model !== 'string') {
    return { valid: false, error: 'Missing or invalid model' };
  }

  if (!req.prompt || typeof req.prompt !== 'string') {
    return { valid: false, error: 'Missing or invalid prompt' };
  }

  if (typeof req.seed !== 'number') {
    return { valid: false, error: 'Missing or invalid seed (must be a number)' };
  }

  const temperature = req.temperature ?? 0;
  if (temperature !== 0) {
    return { valid: false, error: 'Temperature must be 0 for deterministic results' };
  }

  return { valid: true };
}

/**
 * Extract only the content from OpenAI response for determinism
 */
export function extractContent(openaiResponse: any): string {
  if (!openaiResponse.choices || openaiResponse.choices.length === 0) {
    throw new Error('No choices in OpenAI response');
  }

  const content = openaiResponse.choices[0].message?.content;
  if (typeof content !== 'string') {
    throw new Error('Invalid content in OpenAI response');
  }

  return content;
}
