# Technical Code Overview

This document provides a detailed breakdown of the internal logic and code structure of the Automation Engine.

## Backend (C++)

The backend is built as a modular task orchestration server.

### Core Components

#### 1. `AutomationEngine::Task` (Abstract Base)
- Located in `Backend/include/worker/ShellTask.hpp` (Base class).
- Defines the `execute()` interface which returns a `std::future<TaskStatus>`.
- All custom workers (e.g., `BlockIPTask`, `ShellTask`) inherit from this.

#### 2. `ThreatAnalyzer`
- Located in `Backend/src/utils/Threatanalyzer.cpp`.
- Implements a TCP listener that parses incoming string payloads.
- Uses regex-based detection for SQL injection patterns and other malicious indicators.
- Triggers `BlockIPTask` immediately upon detection.

#### 3. Log Encryption (`Logger.hpp`)
- Implements AES-256-GCM authenticated encryption for all persistent logs.
- Requires `ENGINE_LOG_KEY` environment variable.

### Workflow Execution
1. The engine reads `shared/routine.json`.
2. It instantiates the corresponding tasks using a factory-like pattern in `main.cpp`.
3. Tasks are executed asynchronously, and their statuses are tracked in real-time.

---

## Frontend (React + Vite)

The dashboard provides a visual interface for monitoring the engine.

### Key Features
- **Real-time Monitoring**: Connects to the Relay service via WebSockets to stream engine logs.
- **Workflow Management**: Allows users to view and trigger predefined routines.
- **Security Alerts**: Displays neon-red alerts when the `ThreatAnalyzer` blocks an IP.

### Build System
- **Vite**: Used for fast development and optimized production builds.
- **Tailwind CSS**: Used for the "JetBrains Mono" styled, glassmorphism UI.

---

## Relay Service (Node.js)

The relay service acts as a bridge between the C++ backend and the React frontend.
- **Log Tailer**: Watches `data/engine.log` (decrypted or raw) to broadcast updates.
- **Message Orchestration**: Manages WebSocket connections for the dashboard.
