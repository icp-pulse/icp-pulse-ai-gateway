# Testing Guide

Comprehensive testing guide for the ICP Pulse AI Gateway.

## Local Development Testing

### 1. Start local development server

```bash
npm run dev
```

Server runs at `http://localhost:8787`

### 2. Test health endpoint

```bash
curl http://localhost:8787/health
```

Expected:
```json
{
  "status": "ok",
  "service": "icp-deterministic-ai-gateway",
  "version": "1.0.0"
}
```

### 3. Test generate endpoint

```bash
curl -X POST http://localhost:8787/generate \
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

## Production Testing

### Test determinism (same seed = same response)

```bash
# First request
curl -X POST https://your-worker.workers.dev/generate \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-mini",
    "prompt": "Generate poll options",
    "seed": 77777,
    "temperature": 0
  }' | jq .

# Second request (should be cached)
curl -X POST https://your-worker.workers.dev/generate \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-mini",
    "prompt": "Generate poll options",
    "seed": 77777,
    "temperature": 0
  }' | jq .
```

Both responses should have:
- Identical `content`
- Identical `signature`
- First request: `"cached": false`
- Second request: `"cached": true`

### Test freshness (different seed = different response)

```bash
# Request 1 with seed 11111
curl -X POST https://your-worker.workers.dev/generate \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-mini",
    "prompt": "Generate poll options",
    "seed": 11111,
    "temperature": 0
  }' | jq .content

# Request 2 with seed 22222
curl -X POST https://your-worker.workers.dev/generate \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-mini",
    "prompt": "Generate poll options",
    "seed": 22222,
    "temperature": 0
  }' | jq .content
```

The `content` should be different.

## ICP Canister Testing

### Test from dfx

```bash
cd /Users/east/workspace/icp/motoko-icp-pulse

# Test with null seed (fresh results)
dfx canister call polls_surveys_backend generate_poll_options \
  '("What productivity features should we add?", null)'

# Test with explicit seed (deterministic)
dfx canister call polls_surveys_backend generate_poll_options \
  '("What productivity features should we add?", opt 54321)'

# Call again with same seed (should get cached result)
dfx canister call polls_surveys_backend generate_poll_options \
  '("What productivity features should we add?", opt 54321)'
```

### Verify gateway configuration

```bash
# Check current gateway URL
dfx canister call polls_surveys_backend get_gateway_url

# Should return: "https://your-worker.workers.dev/generate"
```

## Error Testing

### Test invalid requests

```bash
# Missing seed
curl -X POST https://your-worker.workers.dev/generate \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-mini",
    "prompt": "test",
    "temperature": 0
  }'
# Expected: 400 error "Missing or invalid seed"

# Wrong temperature
curl -X POST https://your-worker.workers.dev/generate \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-mini",
    "prompt": "test",
    "seed": 123,
    "temperature": 0.7
  }'
# Expected: 400 error "Temperature must be 0"

# Missing prompt
curl -X POST https://your-worker.workers.dev/generate \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-mini",
    "seed": 123,
    "temperature": 0
  }'
# Expected: 400 error "Missing or invalid prompt"
```

## Performance Testing

### Measure cache hit performance

```bash
# Warm up cache
curl -X POST https://your-worker.workers.dev/generate \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-mini",
    "prompt": "test prompt",
    "seed": 99999,
    "temperature": 0
  }' -w "\nTime: %{time_total}s\n"

# Measure cache hit (should be much faster)
curl -X POST https://your-worker.workers.dev/generate \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-mini",
    "prompt": "test prompt",
    "seed": 99999,
    "temperature": 0
  }' -w "\nTime: %{time_total}s\n"
```

Expected:
- First request: 1-3 seconds (OpenAI API call)
- Cache hit: < 100ms

### Load testing

```bash
# Install Apache Bench
# brew install httpd (macOS)

# Test 100 requests, 10 concurrent
ab -n 100 -c 10 -T 'application/json' \
  -p test-payload.json \
  https://your-worker.workers.dev/generate
```

Create `test-payload.json`:
```json
{
  "model": "gpt-4o-mini",
  "prompt": "test",
  "seed": 88888,
  "temperature": 0
}
```

## Consensus Testing (ICP-specific)

### Simulate multiple replica calls

This script simulates what happens when ICP replicas call the gateway:

```bash
#!/bin/bash
# simulate-replicas.sh

GATEWAY_URL="https://your-worker.workers.dev/generate"
SEED=12345
PROMPT="Generate poll options"

echo "Simulating 13 replica calls with seed $SEED..."

for i in {1..13}; do
  curl -s -X POST "$GATEWAY_URL" \
    -H "Content-Type: application/json" \
    -d "{
      \"model\": \"gpt-4o-mini\",
      \"prompt\": \"$PROMPT\",
      \"seed\": $SEED,
      \"temperature\": 0
    }" | jq -r '.content' > "replica_$i.txt" &
done

wait

echo "All replicas finished. Checking consensus..."

# Check if all responses are identical
if [ $(sort replica_*.txt | uniq | wc -l) -eq 1 ]; then
  echo "✓ CONSENSUS ACHIEVED - All replicas got identical responses"
else
  echo "✗ CONSENSUS FAILED - Replicas got different responses"
  echo "Unique responses:"
  sort replica_*.txt | uniq
fi

# Cleanup
rm replica_*.txt
```

Run:
```bash
chmod +x simulate-replicas.sh
./simulate-replicas.sh
```

Expected output:
```
Simulating 13 replica calls with seed 12345...
All replicas finished. Checking consensus...
✓ CONSENSUS ACHIEVED - All replicas got identical responses
```

## Monitoring & Debugging

### Watch real-time logs

```bash
wrangler tail
```

You'll see:
- Incoming requests
- Cache hits/misses
- OpenAI API calls
- Errors and stack traces

### Check Durable Object storage

```bash
# List all Durable Object instances
wrangler dev

# In another terminal, check storage
curl http://localhost:8787/generate -X POST -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-mini","prompt":"test","seed":123,"temperature":0}'
```

### Debug transform function (ICP canister)

Add debug prints in Motoko:

```motoko
Debug.print("=== GATEWAY RESPONSE ===");
Debug.print("Status: " # Nat.toText(response.status));
Debug.print("Body: " # responseText);
```

View logs:
```bash
dfx canister logs polls_surveys_backend
```

## Regression Testing

Create a test suite:

```bash
# test-suite.sh
#!/bin/bash

echo "Running gateway test suite..."

# Test 1: Health check
echo -n "Test 1: Health check... "
HEALTH=$(curl -s https://your-worker.workers.dev/health | jq -r .status)
if [ "$HEALTH" == "ok" ]; then
  echo "✓ PASSED"
else
  echo "✗ FAILED"
  exit 1
fi

# Test 2: Generate with seed
echo -n "Test 2: Generate with seed... "
RESPONSE=$(curl -s -X POST https://your-worker.workers.dev/generate \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-mini","prompt":"test","seed":123,"temperature":0}')
if echo "$RESPONSE" | jq -e '.content' > /dev/null; then
  echo "✓ PASSED"
else
  echo "✗ FAILED"
  echo "$RESPONSE"
  exit 1
fi

# Test 3: Cache hit
echo -n "Test 3: Cache hit... "
CACHED=$(curl -s -X POST https://your-worker.workers.dev/generate \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-mini","prompt":"test","seed":123,"temperature":0}' \
  | jq -r .cached)
if [ "$CACHED" == "true" ]; then
  echo "✓ PASSED"
else
  echo "✗ FAILED (expected cached=true, got $CACHED)"
  exit 1
fi

# Test 4: Invalid request
echo -n "Test 4: Invalid request handling... "
ERROR=$(curl -s -X POST https://your-worker.workers.dev/generate \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-mini","prompt":"test","temperature":0}' \
  | jq -r .error)
if [ -n "$ERROR" ]; then
  echo "✓ PASSED"
else
  echo "✗ FAILED (expected error response)"
  exit 1
fi

echo ""
echo "All tests passed! ✓"
```

Run:
```bash
chmod +x test-suite.sh
./test-suite.sh
```

## Troubleshooting Common Issues

### Issue: "cached" is always false

**Cause**: Seed or prompt is changing between requests.

**Debug**:
```bash
# Check request_hash in responses
curl -X POST ... | jq .request_hash
```

If hashes differ, inputs are different.

### Issue: Different responses with same seed

**Cause**: Temperature not 0, or model version changed.

**Fix**:
- Ensure `"temperature": 0`
- Pin specific model version

### Issue: ICP consensus fails

**Debug**:
```bash
# Check canister logs
dfx canister logs polls_surveys_backend

# Look for:
# - Different seeds being used
# - Network errors
# - Transform function errors
```

### Issue: High latency

**Cause**: Cache misses or slow OpenAI API.

**Check**:
```bash
wrangler tail | grep "Cache HIT"
wrangler tail | grep "Cache MISS"
```

If mostly misses, users aren't reusing seeds.

## Useful Commands

```bash
# Deploy
npm run deploy

# Watch logs
wrangler tail

# List secrets
wrangler secret list

# Delete a secret
wrangler secret delete SECRET_NAME

# View deployments
wrangler deployments list

# Rollback
wrangler rollback

# Test health
curl https://your-worker.workers.dev/health | jq .

# Test generate
curl -X POST https://your-worker.workers.dev/generate \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-mini","prompt":"test","seed":123,"temperature":0}' | jq .
```
