#!/usr/bin/env python3
"""
relay_benchmark.py
══════════════════════════════════════════════════════════════════════════
Benchmarks the Automation Orchestrator relay (/api/ingest-log) under two
load models:

  MODE 1 — STEADY (sequential + small concurrency pools)
    Sends TOTAL_REQUESTS using a configurable worker-pool.
    Measures sustained RPS, latency percentiles, and error rate.

  MODE 2 — BURST (all-at-once)
    Fires BURST_COUNT requests in a single asyncio explosion.
    Measures peak RPS and how the relay survives sudden spikes.

Usage:
    python3 relay_benchmark.py [--mode steady|burst|both]

Requires: Python ≥ 3.9  (stdlib only — no external deps)
══════════════════════════════════════════════════════════════════════════
"""

import asyncio
import argparse
import json
import math
import os
import random
import socket
import statistics
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.request import urlopen, Request
from urllib.error   import URLError, HTTPError

# ━━━ Config ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

RELAY_URL      = "http://127.0.0.1:3001/api/ingest-log"
TOTAL_REQUESTS = 300_000          # total for steady mode
BURST_COUNT    = 300_000          # total for burst mode (split into waves)
STEADY_WORKERS = 64               # concurrent threads for steady mode
BURST_WAVE     = 10_000           # requests per asyncio wave (memory safety)
TIMEOUT        = 4                # per-request timeout seconds
REPORT_EVERY   = 10_000           # print progress every N requests
WARMUP         = 500              # warm-up requests before measuring

LEVELS   = ["INFO", "SUCCESS", "WARN", "ERROR", "CRITICAL"]
WEIGHTS  = [0.35, 0.25, 0.15, 0.10, 0.15]

IPS = (
    [f"192.168.{r}.{h}" for r in range(0,5) for h in range(1,51)] +
    [f"203.0.113.{h}"   for h in range(1,50)] +
    [f"10.0.{r}.{h}"    for r in range(0,4)  for h in range(1,51)]
)

PAYLOADS = [
    "GET /api/health HTTP/1.1",
    "POST /api/login { user: 'admin' }",
    "DROP TABLE users; --",
    "admin' OR '1'='1",
    "' UNION SELECT * FROM passwords--",
    "<script>document.location='http://evil.io/steal'</script>",
    "../../../etc/passwd",
    "WebSocket PING from client",
    "TLS handshake completed",
    "curl http://169.254.169.254/latest/meta-data/",
    "POST /admin/upload multipart; filename='../../../../shell.php'",
    "GET /static/bundle.js HTTP/1.1",
    "Rate limit approaching: 980/1000 req/min",
    "gRPC call: /proto.Service/GetStatus",
]

# ━━━ Helpers ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def make_payload() -> bytes:
    level   = random.choices(LEVELS, WEIGHTS)[0]
    ip      = random.choice(IPS)
    msg     = random.choice(PAYLOADS)
    ts      = time.strftime("%Y-%m-%d %H:%M:%S")
    line    = f"[{ts}] [{level}] {ip} — {msg}"
    body    = {
        "line":      line,
        "level":     level,
        "sourceIp":  ip,
        "payload":   msg,
        "timestamp": ts,
        "id":        f"{random.randint(0,0xFFFFFF):06X}",
    }
    return json.dumps(body).encode()

def send_one(payload_bytes: bytes) -> tuple[float, int]:
    """Return (latency_ms, status_code). status_code=-1 on error."""
    t0 = time.perf_counter()
    try:
        req = Request(
            RELAY_URL,
            data    = payload_bytes,
            method  = "POST",
            headers = {
                "Content-Type":   "application/json",
                "Content-Length": str(len(payload_bytes)),
                "Connection":     "keep-alive",
            },
        )
        with urlopen(req, timeout=TIMEOUT) as resp:
            resp.read()
            status = resp.status
    except (HTTPError, URLError, ConnectionResetError,
            socket.timeout, BrokenPipeError, OSError):
        status = -1
    latency = (time.perf_counter() - t0) * 1000
    return latency, status

# ━━━ Stats accumulator ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

class Stats:
    def __init__(self, label: str):
        self.label    = label
        self.latencies: list[float] = []
        self.errors   = 0
        self.success  = 0
        self.t_start  = 0.0
        self.t_end    = 0.0

    def record(self, lat: float, status: int):
        if status in (-1, 0) or status >= 500:
            self.errors += 1
        else:
            self.success  += 1
            self.latencies.append(lat)

    def total(self):
        return self.success + self.errors

    def rps(self):
        elapsed = self.t_end - self.t_start
        return self.total() / elapsed if elapsed > 0 else 0

    def pct(self, p):
        if not self.latencies:
            return 0.0
        s = sorted(self.latencies)
        idx = min(int(math.ceil(p / 100 * len(s))) - 1, len(s) - 1)
        return s[idx]

    def report(self):
        lat = self.latencies
        elapsed = self.t_end - self.t_start
        sep = "━" * 62

        print(f"\n{sep}")
        print(f"  📊  BENCHMARK RESULTS — {self.label}")
        print(sep)
        print(f"  Total requests  : {self.total():>10,}")
        print(f"  Successful      : {self.success:>10,}  ({100*self.success/max(self.total(),1):.1f}%)")
        print(f"  Errors          : {self.errors:>10,}  ({100*self.errors/max(self.total(),1):.1f}%)")
        print(f"  Wall time       : {elapsed:>10.2f} s")
        print(f"  Throughput      : {self.rps():>10,.0f} req/s")
        if lat:
            print(f"\n  Latency (ms):")
            print(f"    min           : {min(lat):>10.2f}")
            print(f"    avg           : {statistics.mean(lat):>10.2f}")
            print(f"    median (p50)  : {self.pct(50):>10.2f}")
            print(f"    p75           : {self.pct(75):>10.2f}")
            print(f"    p90           : {self.pct(90):>10.2f}")
            print(f"    p95           : {self.pct(95):>10.2f}")
            print(f"    p99           : {self.pct(99):>10.2f}")
            print(f"    max           : {max(lat):>10.2f}")
            if len(lat) > 1:
                print(f"    stdev         : {statistics.stdev(lat):>10.2f}")
        print(sep)

# ━━━ Mode 1: Steady ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def run_steady(n: int = TOTAL_REQUESTS, workers: int = STEADY_WORKERS) -> Stats:
    stats = Stats(f"STEADY — {n:,} requests, {workers} workers")
    print(f"\n  🔥 Steady mode: {n:,} requests  |  {workers} concurrent workers")
    print(f"  Warming up ({WARMUP} requests)…", end="", flush=True)

    # warm-up (discarded)
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = [ex.submit(send_one, make_payload()) for _ in range(WARMUP)]
        for f in as_completed(futs):
            f.result()
    print(" done\n")

    done    = 0
    t_last  = time.perf_counter()

    stats.t_start = time.perf_counter()

    with ThreadPoolExecutor(max_workers=workers) as ex:
        future_map = {ex.submit(send_one, make_payload()): None for _ in range(n)}

        for fut in as_completed(future_map):
            lat, status = fut.result()
            stats.record(lat, status)
            done += 1

            if done % REPORT_EVERY == 0:
                now      = time.perf_counter()
                interval = now - t_last
                chunk_rps = REPORT_EVERY / max(interval, 0.001)
                elapsed   = now - stats.t_start
                pct_done  = done / n * 100
                bar_len   = 30
                filled    = int(bar_len * done / n)
                bar       = "█" * filled + "░" * (bar_len - filled)
                print(
                    f"  [{bar}] {pct_done:5.1f}%  "
                    f"{done:>8,}/{n:,}  "
                    f"{chunk_rps:>7,.0f} req/s  "
                    f"err={stats.errors:,}  "
                    f"t={elapsed:.1f}s",
                    flush=True
                )
                t_last = now

    stats.t_end = time.perf_counter()
    return stats

# ━━━ Mode 2: Burst (all-at-once via asyncio) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async def _async_wave(loop, executor, payloads: list[bytes], stats: Stats):
    """Fire a wave of requests concurrently."""
    tasks = [
        loop.run_in_executor(executor, send_one, p)
        for p in payloads
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    for r in results:
        if isinstance(r, Exception):
            stats.errors += 1
        else:
            lat, status = r
            stats.record(lat, status)

async def _run_burst_async(n: int, wave: int) -> Stats:
    stats     = Stats(f"BURST — {n:,} requests, wave={wave:,} (all-at-once)")
    remaining = n
    fired     = 0

    # Use a thread-pool backing asyncio (urllib is sync)
    max_workers = min(wave, 4096)
    executor = ThreadPoolExecutor(max_workers=max_workers)
    loop     = asyncio.get_running_loop()

    print(f"\n  ⚡ Burst mode: {n:,} requests  |  wave size {wave:,}  |  {max_workers} workers")
    print(f"  Firing waves (each wave is dispatched simultaneously)…\n")

    stats.t_start = time.perf_counter()

    wave_num = 0
    while remaining > 0:
        wave_num   += 1
        batch_size  = min(wave, remaining)
        payloads    = [make_payload() for _ in range(batch_size)]

        wt0 = time.perf_counter()
        await _async_wave(loop, executor, payloads, stats)
        wt  = time.perf_counter() - wt0

        fired     += batch_size
        remaining -= batch_size
        wave_rps   = batch_size / max(wt, 0.001)
        elapsed    = time.perf_counter() - stats.t_start
        pct_done   = fired / n * 100
        bar_len    = 30
        filled     = int(bar_len * fired / n)
        bar        = "█" * filled + "░" * (bar_len - filled)
        print(
            f"  Wave {wave_num:>4d}  [{bar}] {pct_done:5.1f}%  "
            f"{fired:>8,}/{n:,}  "
            f"{wave_rps:>8,.0f} req/s  "
            f"err={stats.errors:,}  "
            f"t={elapsed:.1f}s",
            flush=True
        )

    stats.t_end = time.perf_counter()
    executor.shutdown(wait=False)
    return stats

def run_burst(n: int = BURST_COUNT, wave: int = BURST_WAVE) -> Stats:
    return asyncio.run(_run_burst_async(n, wave))

# ━━━ Preflight check ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def preflight():
    print("  Checking relay connectivity…", end="", flush=True)
    try:
        lat, status = send_one(make_payload())
        if status == -1:
            print(f"\n  ✗ Relay unreachable at {RELAY_URL}")
            print("    Start the relay:  cd services/relay && node index.js")
            sys.exit(1)
        print(f" ✓  ({lat:.0f} ms, HTTP {status})")
    except Exception as e:
        print(f"\n  ✗ Preflight failed: {e}")
        sys.exit(1)

# ━━━ Summary comparison ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def compare(steady: Stats, burst: Stats):
    sep = "═" * 62
    print(f"\n{sep}")
    print("  📈  HEAD-TO-HEAD COMPARISON")
    print(sep)
    fmt = "  {:<22s}  {:>12s}  {:>12s}"
    print(fmt.format("Metric", "STEADY", "BURST"))
    print("  " + "─" * 58)
    rows = [
        ("Total reqs",    f"{steady.total():,}",      f"{burst.total():,}"),
        ("Success rate",  f"{100*steady.success/max(steady.total(),1):.1f}%",
                          f"{100*burst.success/max(burst.total(),1):.1f}%"),
        ("Wall time (s)", f"{steady.t_end-steady.t_start:.2f}",
                          f"{burst.t_end-burst.t_start:.2f}"),
        ("Throughput",    f"{steady.rps():,.0f} r/s",  f"{burst.rps():,.0f} r/s"),
        ("Lat avg (ms)",  f"{statistics.mean(steady.latencies) if steady.latencies else 0:.2f}",
                          f"{statistics.mean(burst.latencies)  if burst.latencies  else 0:.2f}"),
        ("Lat p95 (ms)",  f"{steady.pct(95):.2f}",    f"{burst.pct(95):.2f}"),
        ("Lat p99 (ms)",  f"{steady.pct(99):.2f}",    f"{burst.pct(99):.2f}"),
        ("Errors",        f"{steady.errors:,}",        f"{burst.errors:,}"),
    ]
    for label, sv, bv in rows:
        print(fmt.format(label, sv, bv))
    print(sep)

# ━━━ Entry point ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def main():
    global RELAY_URL                   # declared FIRST, before any reference
    ap = argparse.ArgumentParser(description="Relay benchmark — steady & burst")
    ap.add_argument("--mode",    choices=["steady", "burst", "both"], default="both")
    ap.add_argument("--total",   type=int,   default=TOTAL_REQUESTS, help="requests (steady)")
    ap.add_argument("--burst",   type=int,   default=BURST_COUNT,    help="requests (burst)")
    ap.add_argument("--workers", type=int,   default=STEADY_WORKERS, help="thread-pool size (steady)")
    ap.add_argument("--wave",    type=int,   default=BURST_WAVE,     help="wave size for burst mode")
    ap.add_argument("--url",     default=RELAY_URL, help="target endpoint")
    args = ap.parse_args()

    RELAY_URL = args.url               # now safe to assign


    banner = """
╔══════════════════════════════════════════════════════════════╗
║         AUTOMATION ORCHESTRATOR — RELAY BENCHMARK           ║
║   300,000 req  ·  Steady + Burst  ·  stdlib-only Python     ║
╚══════════════════════════════════════════════════════════════╝"""
    print(banner)
    print(f"  Target  : {RELAY_URL}")
    print(f"  Mode    : {args.mode.upper()}")
    print(f"  Steady  : {args.total:,} req  @  {args.workers} workers")
    print(f"  Burst   : {args.burst:,} req  @  wave {args.wave:,}\n")

    preflight()

    steady_stats = None
    burst_stats  = None

    if args.mode in ("steady", "both"):
        steady_stats = run_steady(n=args.total, workers=args.workers)
        steady_stats.report()

    if args.mode in ("burst", "both"):
        burst_stats = run_burst(n=args.burst, wave=args.wave)
        burst_stats.report()

    if args.mode == "both" and steady_stats and burst_stats:
        compare(steady_stats, burst_stats)

    print("\n  ✓ Benchmark complete.\n")

if __name__ == "__main__":
    main()
