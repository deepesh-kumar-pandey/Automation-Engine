#!/usr/bin/env python3
"""
mock_rate_limiter.py
--------------------
A lightweight Flask mock server that simulates the Rate Limiter microservice
consumed by BlockIPTask.cpp.

Endpoints
---------
POST /block
    Accepts a JSON body: {"target_ip": "<IPv4 address>"}
    Returns 200 on success, 400 for invalid input.

GET /blocked
    Returns the list of currently blocked IPs (for debugging / integration tests).

DELETE /block/<ip>
    Removes a previously blocked IP (for test teardown).

Usage
-----
    pip install flask
    python3 services/mock_rate_limiter.py

The server listens on 0.0.0.0:8081 to match the URL hard-coded in BlockIPTask.cpp:
    http://rate-limiter:8081/block
"""

import logging
import re
from flask import Flask, request, jsonify

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
HOST = "0.0.0.0"
PORT = 8081
LOG_LEVEL = logging.INFO

# Simple in-memory store: { ip: reason }
_blocked_ips: dict[str, str] = {}

# Basic IPv4 pattern (does not validate ranges, only format).
_IPV4_RE = re.compile(
    r"^(\d{1,3}\.){3}\d{1,3}$"
)

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------
app = Flask(__name__)
logging.basicConfig(
    level=LOG_LEVEL,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _is_valid_ip(ip: str) -> bool:
    """Return True if *ip* looks like a dotted-quad IPv4 address."""
    return bool(_IPV4_RE.match(ip or ""))


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.route("/block", methods=["POST"])
def block_ip():
    """
    Block a target IP address.

    Expected JSON body::

        {"target_ip": "192.168.1.100"}

    Optional field::

        {"target_ip": "192.168.1.100", "reason": "port-scan detected"}
    """
    data = request.get_json(silent=True)
    if not data or "target_ip" not in data:
        log.warning("POST /block — missing 'target_ip' in request body")
        return jsonify({"error": "Missing required field: target_ip"}), 400

    ip: str = data["target_ip"].strip()
    reason: str = data.get("reason", "No reason provided")

    if not _is_valid_ip(ip):
        log.warning("POST /block — invalid IP format: %s", ip)
        return jsonify({"error": f"Invalid IP address format: {ip}"}), 400

    already_blocked = ip in _blocked_ips
    _blocked_ips[ip] = reason

    status = "already_blocked" if already_blocked else "blocked"
    log.info("IP %s — %s (reason: %s)", ip, status, reason)

    return jsonify({
        "status": status,
        "ip": ip,
        "reason": reason,
    }), 200


@app.route("/blocked", methods=["GET"])
def list_blocked():
    """Return the current list of blocked IPs (for debugging / tests)."""
    return jsonify({
        "blocked_ips": [
            {"ip": ip, "reason": reason}
            for ip, reason in _blocked_ips.items()
        ]
    }), 200


@app.route("/block/<string:ip>", methods=["DELETE"])
def unblock_ip(ip: str):
    """Remove an IP from the block list (useful for test teardown)."""
    if ip not in _blocked_ips:
        return jsonify({"error": f"IP {ip} is not blocked"}), 404

    del _blocked_ips[ip]
    log.info("IP %s — unblocked", ip)
    return jsonify({"status": "unblocked", "ip": ip}), 200


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    log.info("Starting mock Rate Limiter on %s:%d", HOST, PORT)
    app.run(host=HOST, port=PORT, debug=False)