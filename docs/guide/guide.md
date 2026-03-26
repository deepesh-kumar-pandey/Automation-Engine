# User Guide

Welcome to the Automation Engine! This guide will help you set up and run the system.

## ⚙️ Setup

### Prerequisites
- Docker & Docker Compose
- Python 3 (for testing scripts)
- Node.js (for local relay development)

### Environment Variables
The system requires an encryption key for logging. Use a 64-character hex string:
```bash
export ENGINE_LOG_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
```

## 🚀 Running the System

### 1. Unified Launcher (Docker Compose)
If the project includes a `docker-compose.yml`, simply run:
```bash
docker-compose up --build
```

### 2. Manual Startup
1. **Relay**: `cd services/relay && npm start`
2. **Backend**: `cd Backend && docker build -t backend . && docker run -p 8080:8080 backend`
3. **Frontend**: `cd Frontend && docker build -t frontend . && docker run -p 80:80 frontend`

## 🛡️ Simulating an Attack
To test the `ThreatAnalyzer`:
1. Ensure the engine is running and listening on port `9090`.
2. Run the simulator:
   ```bash
   cd test
   python3 attack_simulator.py
   ```
3. Watch the dashboard for neon-red alerts!

## 📜 Viewing Logs
Since logs are encrypted, use the `log_viewer`:
```bash
./log_viewer /path/to/engine.log
```
