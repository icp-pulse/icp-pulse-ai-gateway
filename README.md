# ICP Pulse AI Gateway

A deterministic AI gateway for Internet Computer (ICP) HTTP outcalls that ensures consensus across subnet replicas.

## Overview

This Cloudflare Worker acts as a deterministic gateway between ICP canisters and OpenAI's API. It solves the consensus problem where multiple ICP replicas need to agree on AI-generated responses.

### Key Features

- **Deterministic responses**: Same input always produces identical output
- **Strong consistency**: Durable Objects ensure first-request-wins coordination
- **HMAC signing**: Cryptographic verification for ICP canisters
- **Automatic caching**: 90-day retention with automatic cleanup
- **Cost-effective**: ~92% reduction in AI API costs vs direct calls

## Architecture

```
ICP Canister (13+ replicas)
    ↓ HTTP outcall (same seed)
Cloudflare Worker
    ↓ routes to
Durable Object (by cache key)
    ↓ first request generates
OpenAI API (temperature=0, explicit seed)
    ↓ cached response
All replicas get identical bytes → Consensus ✓
```

## Prerequisites

- Node.js 18+ and npm
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) installed
- Cloudflare account
- OpenAI API key

## Installation

1. **Clone and install dependencies:**
```bash
cd icp-pulse-ai-gateway
npm install
```

2. **Login to Cloudflare:**
```bash
wrangler login
```

3. **Set secrets:**
```bash
# OpenAI API key
wrangler secret put OPENAI_API_KEY
# Enter your OpenAI API key when prompted

# HMAC signing secret (generate a strong random string)
wrangler secret put SIGNING_SECRET
# Enter a long random string (e.g., use: openssl rand -hex 32)
```

## Deployment

### Deploy to Cloudflare

```bash
npm run deploy
```

This will output your Worker URL, e.g., `https://icp-pulse-ai-gateway.your-account.workers.dev`

### Test the deployment

```bash
curl -X POST https://your-worker.workers.dev/generate \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-mini",
    "prompt": "Generate 4 poll options about dark mode",
    "seed": 12345,
    "temperature": 0,
    "max_tokens": 150,
    "system_prompt": "Return ONLY a JSON array of 4 strings"
  }'
```

Expected response:
```json
{
  "content": "[\"Enable dark mode by default\",\"Auto dark mode based on time\",\"Custom theme colors\",\"High contrast dark mode\"]",
  "model": "gpt-4o-mini",
  "seed": 12345,
  "signature": "abc123...",
  "cached": false,
  "request_hash": "def456..."
}
```

## Configure ICP Canister

### 1. Update the Motoko canister

The Motoko canister at `/Users/east/workspace/icp/motoko-icp-pulse` has been updated to use the gateway.

### 2. Deploy to IC Mainnet

```bash
cd /Users/east/workspace/icp/motoko-icp-pulse

# Deploy to IC mainnet
dfx deploy --network ic polls_surveys_backend

# Generate declarations for frontend
dfx generate --network ic polls_surveys_backend
```

### 3. Set the gateway URL (Mainnet)

```bash
# Set the gateway URL on mainnet
dfx canister call --network ic polls_surveys_backend set_gateway_url \
  '("https://icp-pulse-ai-gateway.eastmaels.workers.dev/generate")'

# Verify it was set
dfx canister call --network ic polls_surveys_backend get_gateway_url
```

### 4. Test the integration (Mainnet)

**IMPORTANT**: Always provide an explicit seed to avoid consensus failures!

```bash
# ❌ WRONG - This will cause consensus failure
dfx canister call --network ic polls_surveys_backend generate_poll_options \
  '("What features should we add?", null)'

# ✅ CORRECT - Use explicit seed
dfx canister call --network ic polls_surveys_backend generate_poll_options \
  '("What features should we add?", opt 12345)'

# For fresh results each time, generate a random seed:
SEED=$RANDOM
dfx canister call --network ic polls_surveys_backend generate_poll_options \
  "(\"What features should we add?\", opt $SEED)"
```

### 5. Local Testing (Optional)

For local development:

```bash
# Set gateway URL locally
dfx canister call polls_surveys_backend set_gateway_url \
  '("https://icp-pulse-ai-gateway.eastmaels.workers.dev/generate")'

# Deploy locally
dfx deploy polls_surveys_backend

# Test with explicit seed
dfx canister call polls_surveys_backend generate_poll_options \
  '("What features should we add?", opt 99999)'
```

## API Reference

### POST /generate

Generate AI content with deterministic caching.

**Request:**
```json
{
  "model": "gpt-4o-mini",
  "prompt": "Your prompt here",
  "seed": 12345,
  "temperature": 0,
  "max_tokens": 150,
  "system_prompt": "Optional system message"
}
```

**Response:**
```json
{
  "content": "Generated content",
  "model": "gpt-4o-mini",
  "seed": 12345,
  "signature": "HMAC-SHA256 signature",
  "cached": false,
  "request_hash": "SHA-256 of request"
}
```

### GET /health

Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "service": "icp-deterministic-ai-gateway",
  "version": "1.0.0"
}
```

## Cache Management

### How caching works

- **Cache key**: SHA-256 of (model + prompt + seed + temperature + max_tokens + system_prompt)
- **Retention**: 90 days (configurable via `CACHE_RETENTION_DAYS` in wrangler.toml)
- **Storage cost**: ~$0.40/month per 1 million cached responses
- **Cleanup**: Automatic (configure cron trigger for scheduled cleanup)

### Seed-based freshness

```motoko
// Fresh results every time (seed = timestamp)
generate_poll_options("topic", null)

// Cached/deterministic results (explicit seed)
generate_poll_options("topic", ?12345)
```

### Manual cleanup

You can manually trigger cleanup via the Cloudflare dashboard or CLI:

```bash
wrangler tail  # Monitor logs
```

## Configuration

### Environment Variables

Set in `wrangler.toml`:

```toml
[vars]
CACHE_RETENTION_DAYS = "90"  # How long to keep cached responses
```

### Secrets

Set via CLI (never commit these):

```bash
wrangler secret put OPENAI_API_KEY
wrangler secret put SIGNING_SECRET
```

### Optional: Scheduled Cleanup

Uncomment in `wrangler.toml` to enable weekly cleanup:

```toml
[triggers]
crons = ["0 0 * * 0"]  # Every Sunday at midnight UTC
```

## Cost Analysis

### Without Gateway (Current)
- 13 replicas × $0.00015 per request = **$0.00195 per generation**
- 10,000 generations = **$19.50**

### With Gateway
- 1 OpenAI call (first request only) = **$0.00015**
- Subsequent requests (same seed) = cached (free)
- Storage: ~$0.40/month per 1M responses
- 10,000 unique generations ≈ **$1.50 total**

**Savings: ~92% reduction in AI costs**

## Development

### Local development

```bash
npm run dev
```

This starts a local server at `http://localhost:8787`

### Testing locally

```bash
curl -X POST http://localhost:8787/generate \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-mini","prompt":"test","seed":123,"temperature":0}'
```

## Monitoring

### View logs

```bash
wrangler tail
```

### Cloudflare Dashboard

- Monitor request volume
- Check Durable Object storage usage
- View error rates and latency

## Troubleshooting

### "Temperature must be 0" error

Ensure `temperature: 0` in all requests. This is required for deterministic results.

### "Missing or invalid seed" error

The `seed` parameter is required and must be a number.

### Consensus failures in ICP

- Verify all replicas use the same seed
- Check that gateway URL is correctly configured
- Ensure no network issues between ICP and Cloudflare

### High storage costs

- Reduce `CACHE_RETENTION_DAYS` in wrangler.toml
- Enable scheduled cleanup cron trigger
- Monitor cache hit rates

## Security

- **Never commit secrets** - Use `wrangler secret put`
- **HMAC verification** - ICP canisters should verify signatures
- **Rate limiting** - Consider adding rate limits by canister ID
- **Access control** - Gateway endpoints are public; implement authentication if needed

## License

MIT

## Support

For issues or questions:
- Check the Cloudflare Workers [documentation](https://developers.cloudflare.com/workers/)
- Review ICP HTTP outcalls [docs](https://internetcomputer.org/docs/current/developer-docs/integrations/https-outcalls/)
