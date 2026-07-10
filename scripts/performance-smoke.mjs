const iterations = Number(process.env.PERF_ITERATIONS ?? 20);
const timeoutMs = Number(process.env.PERF_TIMEOUT_MS ?? 5000);

const targets = [
  {
    name: "api-live",
    url: process.env.PERF_API_LIVE_URL ?? "http://127.0.0.1:4000/health/live",
    p95BudgetMs: Number(process.env.PERF_API_P95_MS ?? 250)
  },
  {
    name: "api-ready",
    url:
      process.env.PERF_API_READY_URL ??
      "http://127.0.0.1:4000/health/ready",
    p95BudgetMs: Number(process.env.PERF_API_P95_MS ?? 250)
  },
  {
    name: "web-login",
    url: process.env.PERF_WEB_URL ?? "http://127.0.0.1:3000/login",
    p95BudgetMs: Number(process.env.PERF_WEB_P95_MS ?? 750)
  }
];

function percentile(values, ratio) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

async function measure(target) {
  const samples = [];
  for (let index = 0; index < iterations + 2; index += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = performance.now();
    let response;
    try {
      response = await fetch(target.url, {
        cache: "no-store",
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }
    const elapsed = performance.now() - startedAt;
    if (response.status >= 500) {
      throw new Error(`${target.name} returned HTTP ${response.status}`);
    }
    if (index >= 2) samples.push(elapsed);
  }
  const p95 = percentile(samples, 0.95);
  const average =
    samples.reduce((total, value) => total + value, 0) / samples.length;
  return {
    name: target.name,
    url: target.url,
    requests: samples.length,
    averageMs: Number(average.toFixed(1)),
    p95Ms: Number(p95.toFixed(1)),
    budgetMs: target.p95BudgetMs,
    passed: p95 <= target.p95BudgetMs
  };
}

const results = [];
for (const target of targets) {
  results.push(await measure(target));
}

console.log(JSON.stringify({ iterations, results }, null, 2));

if (results.some((result) => !result.passed)) {
  process.exitCode = 1;
}
