# 🚀 Automation Engine

A high-performance, asynchronous task orchestration system built with **C++26** and **React**. Define complex routines (workflows) that automate manual tasks across applications, shell environments, and infrastructure — driven entirely by JSON.

---

## 🌟 Key Features

| Feature                   | Description                                                                  |
| ------------------------- | ---------------------------------------------------------------------------- |
| **Async Core**            | Non-blocking task execution via `std::async` and `std::future`               |
| **Polymorphic Workers**   | Extend via the abstract `Task` base class — any capability, any domain       |
| **Threat Analyzer**       | C++ TCP server parses incoming requests for SQL injections & blocks bad IPs  |
| **Security Integration**  | `BlockIPTask` talks directly to Rate Limiter services to block malicious IPs, secured by **HMAC-SHA256** signatures |
| **Encrypted Auditing**    | Logs are encrypted on disk with **AES-256-GCM** to detect tampering |
| **Shell Automation**      | `ShellTask` executes arbitrary shell commands as part of a routine           |
| **JSON-Driven Workflows** | Routines are defined in `shared/routine.json` for easy execution             |
| **React Dashboard**       | Frontend for managing routines and monitoring task status in real-time       |
| **CMake + vcpkg**         | Modern C++ build system with automatic dependency management                 |
| **Docker Ready**          | Fully containerised backend for easy deployment                              |

---

## 🏗️ Architecture

```
Client (React Dashboard)
        │
        ▼
  Automation Engine (C++26)
        │
   ┌────┴────┐
   │  Task   │  ← Abstract Base (AutomationEngine::Task)
   └────┬────┘
        │
   ┌────┴──────────────┐
   │                   │
ShellTask         BlockIPTask
(Shell cmds)    (Rate Limiter API)
```

Each worker:

1. Inherits from the `Task` interface
2. Implements `execute(const json& input)` — returns `std::future<TaskStatus>`
3. Is identified by `getName()` and `getID()` for logging and schema matching

**Task Lifecycle:** `Pending → Running → Completed / Failed`

---

## 📁 Project Structure

```
Automation_Engine/
├── Backend/
│   ├── build/                       # CMake build artifacts
│   ├── include/
│   │   ├── core/
│   │   │   └── Logger.hpp           # Thread-safe logging with AES-256-GCM encryption
│   │   ├── utils/
│   │   │   └── Threatanalyzer.hpp   # ThreatAnalyzer header
│   │   └── worker/
│   │       ├── ShellTask.hpp        # Base Task interface
│   │       └── BlockIPTask.hpp      # BlockIPTask header
│   ├── src/
│   │   ├── tools/
│   │   │   └── LogViewer.cpp        # Admin CLI to view encrypted engine.log
│   │   ├── utils/
│   │   │   └── Threatanalyzer.cpp   # Detects malicious strings & triggers blocks
│   │   ├── worker/
│   │   │   ├── ShellTask.cpp        # ShellTask implementation
│   │   │   └── BlockIPTask.cpp      # BlockIPTask: posts to local Rate Limiter
│   │   └── main.cpp                 # Engine entry point (reads routine.json)
│   ├── CMakeLists.txt               # Backend build configuration
│   └── vcpkg.json                   # C++ dependency manifest
├── services/
│   ├── mock_rate_limiter.py         # Mock server for testing
│   └── venv/                        # Python virtual environment
├── shared/
│   ├── workflow_schema.json         # JSON Schema for validation
│   └── routine.json                 # THE execution routine
├── test/
│   └── attack_simulator.py          # Threat simulation script (TCP client)
├── data/                            # engine.log location
└── CMakeLists.txt                   # Root build configuration
```

---

## 🔧 Building the Backend

### Prerequisites

- CMake ≥ 3.25
- C++26-compatible compiler (GCC 14+ / Clang 18+)
- [vcpkg](https://github.com/microsoft/vcpkg)

### Build Steps

```bash
# Clone and enter the project
git clone https://github.com/deepesh-kumar-pandey/Automation-Engine.git
cd Automation-Engine

# Configure and Build
mkdir -p Backend/build && cd Backend/build
cmake .. -DCMAKE_TOOLCHAIN_FILE=../vcpkg/scripts/buildsystems/vcpkg.cmake
make -j$(nproc)
```

## 🚀 How to Run

To execute the engine and verify the full automation pipeline, follow these steps:

### 1. Export the Encryption Key
The engine requires a 256-bit (64 hex character) key to encrypt logs and sign network requests. 

> [!WARNING]
> The key shown below is a **placeholder for local testing only**. Do not use it in production!
> To generate a cryptographically secure key for your deployment, run:
> `openssl rand -hex 32`

```bash
# Example test key
export ENGINE_LOG_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
```

### 2. Start the Mock Rate Limiter (Terminal 1)
The `BlockIPTask` requires a running service to communicate with.
```bash
cd services
python mock_rate_limiter.py
```

### 3. Run the Automation Backend (Terminal 2)
The backend will read `shared/routine.json` and then start a TCP Server on port `9090` listening for simulated threats.
```bash
cd Backend/build
export ENGINE_LOG_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
./automation_backend
```

### 4. Run the Attack Simulator (Terminal 3)
In a third terminal, launch the Python script to send payloads to the C++ backend on port `9090`.
```bash
cd test
python3 attack_simulator.py
```

### 5. Verify Results
- **Console**: Check the live logs for `[SECURITY]` and `[SUCCESS]` entries when malicious strings are caught.
- **Mock Server**: The Python terminal will show incoming POST requests with status 200.
- **Log File**: Open `data/engine.log`. It will appear as binary garbage because it is encrypted with AES-256-GCM.
- **Log Viewer**: To read the persistent encrypted log, use the LogViewer utility:
  ```bash
  cd Backend/build
  export ENGINE_LOG_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
  ./log_viewer
  ```


### Docker

```bash
cd Backend
docker build -t automation-engine .
docker run -p 8080:8080 automation-engine
```

---

## 🧩 Writing a Custom Worker

Inherit from `AutomationEngine::Task` and implement the three pure virtual methods:

```cpp
#include "worker/ShellTask.hpp"

class MyTask : public AutomationEngine::Task {
public:
    std::future<TaskStatus> execute(const json& input) override {
        return std::async(std::launch::async, [this, input]() {
            // your logic here
            return TaskStatus::Completed;
        });
    }

    std::string getName() const override { return "MyTask"; }
    std::string getID()   const override { return id_; }

private:
    std::string id_{"my-task-001"};
};
```

---

## 🔒 Security Worker — `BlockIPTask`

Integrates with a running Rate Limiter service to block malicious IPs:

```json
{
  "task": "BlockIPTask",
  "input": {
    "ip": "192.168.1.100"
  }
}
```

Fires an HTTP `POST` to `http://localhost:8081/block` with the target IP. Returns `Completed` on HTTP 200, `Failed` otherwise.

**Security:** The JSON payload is automatically signed using HMAC-SHA256 (via the `ENGINE_LOG_KEY`) and passed in the `X-Engine-Signature` HTTP header to prevent replay attacks and ensure authenticity.

---

## 📦 Dependencies

Managed via **vcpkg** (`Backend/vcpkg.json`):

| Library         | Purpose                                            |
| --------------- | -------------------------------------------------- |
| `nlohmann-json` | JSON parsing for workflow schemas and task input   |
| `cpr`           | High-level C++ HTTP client for service integration |
| `openssl`       | Cryptography for AES-256-GCM logging & HMAC-SHA256 |

---

## 📄 License

See [License.md](License.md).
