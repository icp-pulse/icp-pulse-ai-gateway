# Frontend Integration Guide

This document explains how the frontend integrates with the deterministic AI gateway.

## Architecture Overview

```
User Action (Frontend)
    ↓
Next.js API Route (generates seed)
    ↓
ICP Canister (with explicit seed)
    ↓ HTTP outcall (13+ replicas, same seed)
Cloudflare Worker Gateway
    ↓
Durable Object (first-request-wins)
    ↓
OpenAI API (temperature=0, explicit seed)
    ↓
All replicas get identical response → Consensus ✓
```

## Key Principle: Seed Generation

**The seed MUST be generated BEFORE calling the ICP canister.**

- ❌ **WRONG**: Let the canister generate the seed using `Time.now()` → Each replica gets different timestamp → Consensus fails
- ✅ **CORRECT**: Generate seed in frontend/API route → Pass to canister → All replicas use same seed → Consensus succeeds

## Frontend Integration Points

### 1. AI Generate Options (step-poll-options.tsx)

**API Route**: `/app/api/generate-poll-options/route.ts`

**How it works:**
1. User clicks "AI Generate Options" button
2. Frontend calls `/api/generate-poll-options` with poll title
3. API route generates random seed: `Math.floor(Math.random() * 1000000000)`
4. API route calls ICP canister: `backend.generate_poll_options(title, [BigInt(seed)])`
5. Canister makes HTTP outcall to gateway with this seed
6. All replicas use same seed → Same response → Consensus ✓

**Code:**
```typescript
// In /app/api/generate-poll-options/route.ts
const seed = Math.floor(Math.random() * 1000000000)
const result = await backend.generate_poll_options(title, [BigInt(seed)])
```

### 2. AI Chatbox (ai-chatbox.tsx)

**API Route**: `/app/api/chat/route.ts`

**Function**: `generatePollOptionsInBackend(topic: string)`

**How it works:**
1. User asks chatbot to generate poll options
2. Frontend calls `/api/chat` with user message
3. API route detects poll option generation request
4. API route generates random seed
5. API route calls ICP canister with seed
6. Returns generated options to chatbot

**Code:**
```typescript
// In /app/api/chat/route.ts - generatePollOptionsInBackend()
const seed = Math.floor(Math.random() * 1000000000)
const result = await backend.generate_poll_options(topic, [BigInt(seed)])
```

## Important Notes

### Seed Range
- Using `Math.floor(Math.random() * 1000000000)` generates seeds from 0 to 999,999,999
- Large enough range to avoid collisions
- Each unique seed creates a new cache entry in the gateway

### Freshness Strategy
- **Every API call generates a new random seed** → Always fresh results
- Gateway caches each unique seed for 90 days
- If same topic is generated with different seed → Different results
- If same seed is reused → Cached result returned

### Error Handling
Both API routes provide fallback options if the canister fails:
```typescript
// Fallback options
[
  `${topic} - Option 1`,
  `${topic} - Option 2`,
  `${topic} - Option 3`,
  `${topic} - Option 4`
]
```

## Testing the Integration

### 1. Test from Frontend

**Step-by-step:**
1. Go to `/polls/new` page
2. Enter a poll title
3. Click "AI Generate Options"
4. Should see 4 generated options within 2-3 seconds

### 2. Monitor API Routes

Check Next.js logs for:
```
Calling ICP canister to generate options for: "Your Topic" with seed: 123456789
Successfully generated 4 options from ICP canister
```

### 3. Verify Consensus

Check ICP canister logs:
```bash
dfx canister logs --network ic polls_surveys_backend | grep "SENDING REQUEST TO AI GATEWAY"
```

Should show:
- Same seed across all replica calls
- Gateway URL being called
- Successful responses

## Troubleshooting

### Issue: "No consensus could be reached"

**Cause**: Seed is being generated inside the canister (different per replica)

**Fix**: Verify seed is generated in API route BEFORE canister call:
```typescript
// ✅ CORRECT - Seed generated in API route
const seed = Math.floor(Math.random() * 1000000000)
const result = await backend.generate_poll_options(title, [BigInt(seed)])

// ❌ WRONG - Passing null, letting canister generate seed
const result = await backend.generate_poll_options(title, [])
```

### Issue: Options not generating

**Possible causes:**
1. Gateway URL not set in canister
   ```bash
   dfx canister call --network ic polls_surveys_backend get_gateway_url
   ```

2. Gateway secrets not configured
   ```bash
   wrangler secret list
   # Should show: OPENAI_API_KEY, SIGNING_SECRET
   ```

3. Canister out of cycles
   ```bash
   dfx canister status --network ic polls_surveys_backend
   ```

### Issue: Slow response times

**Expected times:**
- First request (cache miss): 2-4 seconds
- Cached request (cache hit): < 1 second

If consistently slow, check:
- Gateway logs: `wrangler tail`
- OpenAI API status
- Network connectivity

## Deployment Checklist

- [ ] Gateway deployed to Cloudflare: `npm run deploy`
- [ ] Gateway secrets configured: `OPENAI_API_KEY`, `SIGNING_SECRET`
- [ ] Gateway URL set in canister: `set_gateway_url()`
- [ ] Canister deployed to mainnet: `dfx deploy --network ic`
- [ ] Declarations generated: `dfx generate --network ic`
- [ ] Frontend rebuilt with new declarations: `npm run build`
- [ ] Test end-to-end: Generate options from frontend
- [ ] Verify consensus: Check canister logs

## Configuration

### Environment Variables (Frontend)

```bash
# .env or .env.local
NEXT_PUBLIC_POLLS_SURVEYS_BACKEND_CANISTER_ID=<canister-id>
NEXT_PUBLIC_DFX_NETWORK=ic  # or 'local' for development
```

### Gateway Configuration (Canister)

```bash
# On mainnet
dfx canister call --network ic polls_surveys_backend set_gateway_url \
  '("https://icp-pulse-ai-gateway.eastmaels.workers.dev/generate")'
```

## Benefits of This Architecture

1. **Deterministic**: Same seed always produces identical results
2. **Consensus-safe**: All replicas use the same seed
3. **Cost-effective**: Gateway caches responses, reducing AI API costs by ~92%
4. **Fresh by default**: New seed per request = fresh results
5. **Scalable**: Gateway handles concurrent replica requests efficiently
6. **Resilient**: Fallback options if gateway fails
