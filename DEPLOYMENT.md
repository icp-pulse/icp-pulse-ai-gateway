# Deployment Guide

Step-by-step guide to deploy the ICP Pulse AI Gateway.

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Login to Cloudflare
wrangler login

# 3. Set secrets
wrangler secret put OPENAI_API_KEY
wrangler secret put SIGNING_SECRET

# 4. Deploy
npm run deploy

# 5. Test
curl -X POST https://your-worker.workers.dev/health
```

## Detailed Steps

### 1. Prerequisites

Install Wrangler globally:
```bash
npm install -g wrangler
```

Verify installation:
```bash
wrangler --version
```

### 2. Cloudflare Setup

Login to your Cloudflare account:
```bash
wrangler login
```

This will open a browser window for authentication.

### 3. Configure Secrets

#### Generate a signing secret

Use OpenSSL to generate a secure random string:
```bash
openssl rand -hex 32
```

#### Set the secrets

```bash
# Set OpenAI API key
wrangler secret put OPENAI_API_KEY
# Paste your OpenAI API key when prompted

# Set signing secret
wrangler secret put SIGNING_SECRET
# Paste the generated random string when prompted
```

**Important**: These secrets are encrypted and stored securely by Cloudflare. Never commit them to git.

### 4. Deploy to Cloudflare

```bash
npm run deploy
```

You should see output like:
```
✨ Built successfully!
✨ Uploaded icp-pulse-ai-gateway (X.XX sec)
✨ Published icp-pulse-ai-gateway (X.XX sec)
  https://icp-pulse-ai-gateway.your-account.workers.dev
```

**Save this URL** - you'll need it for the ICP canister configuration.

### 5. Verify Deployment

Test the health endpoint:
```bash
curl https://your-worker.workers.dev/health
```

Expected response:
```json
{
  "status": "ok",
  "service": "icp-deterministic-ai-gateway",
  "version": "1.0.0"
}
```

Test the generate endpoint:
```bash
curl -X POST https://your-worker.workers.dev/generate \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-mini",
    "prompt": "Generate 4 poll options about productivity",
    "seed": 99999,
    "temperature": 0,
    "max_tokens": 150,
    "system_prompt": "Return ONLY a JSON array of strings"
  }'
```

If successful, you'll get a response with generated content and a signature.

### 6. Configure ICP Canister

Navigate to your ICP project:
```bash
cd /Users/east/workspace/icp/motoko-icp-pulse
```

Set the gateway URL in your canister:
```bash
dfx canister call polls_surveys_backend set_gateway_url \
  '("https://your-worker.workers.dev/generate")'
```

Verify it was set:
```bash
dfx canister call polls_surveys_backend get_gateway_url
```

### 7. Deploy Updated Canister

```bash
dfx deploy polls_surveys_backend
```

### 8. Test End-to-End

Generate poll options through your canister:
```bash
# Fresh results (no seed)
dfx canister call polls_surveys_backend generate_poll_options \
  '("What features would you like?", null)'

# Cached results (with seed)
dfx canister call polls_surveys_backend generate_poll_options \
  '("What features would you like?", opt 12345)'
```

## Production Checklist

- [ ] Deploy gateway to Cloudflare
- [ ] Verify health endpoint responds
- [ ] Test generate endpoint with sample request
- [ ] Configure ICP canister with gateway URL
- [ ] Deploy updated ICP canister
- [ ] Test end-to-end flow from canister to gateway
- [ ] Monitor initial requests in Wrangler logs (`wrangler tail`)
- [ ] Verify consensus works across ICP replicas
- [ ] Set up Cloudflare dashboard monitoring
- [ ] Document gateway URL for team
- [ ] (Optional) Configure custom domain in Cloudflare
- [ ] (Optional) Enable scheduled cleanup cron trigger

## Monitoring

### Real-time logs

```bash
wrangler tail
```

This will show live logs from your worker, including:
- Incoming requests
- Cache hits/misses
- OpenAI API calls
- Errors

### Cloudflare Dashboard

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Navigate to Workers & Pages
3. Click on `icp-pulse-ai-gateway`
4. View metrics:
   - Request volume
   - Error rate
   - Response times
   - Durable Object storage

## Updating

To deploy updates:

```bash
# Make code changes
# Then deploy
npm run deploy
```

Wrangler will automatically handle versioning and deployment.

## Rolling Back

If something goes wrong:

```bash
# View deployment history
wrangler deployments list

# Rollback to previous version
wrangler rollback --message "Rolling back due to issue"
```

## Custom Domain (Optional)

To use a custom domain instead of `*.workers.dev`:

1. Go to Cloudflare Dashboard
2. Navigate to Workers & Pages → your worker
3. Click "Triggers" tab
4. Click "Add Custom Domain"
5. Enter your domain (e.g., `ai-gateway.yourdomain.com`)
6. Follow the DNS setup instructions

Update your ICP canister to use the new URL:
```bash
dfx canister call polls_surveys_backend set_gateway_url \
  '("https://ai-gateway.yourdomain.com/generate")'
```

## Troubleshooting

### "Error: No account_id found"

Run `wrangler login` again.

### "Error: No such secret"

Make sure you've set both secrets:
```bash
wrangler secret list
```

Should show:
- OPENAI_API_KEY
- SIGNING_SECRET

### "Error: worker exceeded CPU limit"

This is rare but can happen with very long prompts. Increase `max_tokens` limit or optimize prompts.

### ICP canister can't reach gateway

Check:
1. Gateway URL is correct (use `get_gateway_url`)
2. Gateway is responding to health checks
3. No firewall/network issues
4. ICP has sufficient cycles for HTTP outcalls

## Cost Estimates

### Cloudflare Workers Costs

- First 100,000 requests/day: **Free**
- After that: $0.50 per million requests

### Durable Objects Costs

- First 1M reads/month: **Free**
- First 1M writes/month: **Free**
- Storage: $0.20 per GB/month

### Typical Monthly Costs

**Low volume** (10K requests/month):
- Workers: Free
- Durable Objects: Free
- Storage (1 GB): $0.20
- **Total: ~$0.20/month**

**Medium volume** (100K requests/month):
- Workers: Free
- Durable Objects: Free
- Storage (10 GB): $2.00
- **Total: ~$2.00/month**

**High volume** (1M requests/month):
- Workers: Free (within daily limit)
- Durable Objects: Free
- Storage (100 GB): $20.00
- **Total: ~$20.00/month**

Plus OpenAI API costs (only for unique requests, not cache hits).

## Support

- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Wrangler CLI Docs](https://developers.cloudflare.com/workers/wrangler/)
- [ICP HTTP Outcalls](https://internetcomputer.org/docs/current/developer-docs/integrations/https-outcalls/)
