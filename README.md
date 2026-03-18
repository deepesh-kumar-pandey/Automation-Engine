# 🚀 Automation Engine

A high-performance, asynchronous task orchestration system built with **C++26** and **React**. Define complex routines (workflows) that automate manual tasks across applications, shell environments, and infrastructure — driven entirely by JSON.

---

## 🌟 Key Features

| Feature                   | Description                                                                  |
| ------------------------- | ---------------------------------------------------------------------------- |
| **Async Core**            | Non-blocking task execution via `std::async` and `std::future`               |
| **Polymorphic Workers**   | Extend via the abstract `Task` base class — any capability, any domain       |
| **Security Integration**  | `BlockIPTask` talks directly to Rate Limiter services to block malicious IPs |
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
│   │   │   └── Logger.hpp           # Thread-safe logging with file persistence
│   │   └── worker/
│   │       ├── ShellTask.hpp        # Base Task interface
│   │       └── BlockIPTask.hpp      # BlockIPTask header
│   ├── src/
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

### 1. Start the Mock Rate Limiter (Terminal 1)
The `BlockIPTask` requires a running service to communicate with.
```bash
cd services
source venv/bin/activate
python mock_rate_limiter.py
```

### 2. Run the Automation Backend (Terminal 2)
The backend will read `shared/routine.json` and execute the tasks inside.
```bash
cd Backend/build
./automation_backend
```

### 3. Verify Results
- **Console**: Check the live logs for `[SECURITY]` and `[SUCCESS]` entries.
- **Log File**: Open `data/engine.log` to see the persistent record.
- **Mock Server**: The Python terminal will show incoming POST requests with status 200.


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

Fires an HTTP `POST` to `http://rate-limiter:8081/block` with the target IP. Returns `Completed` on HTTP 200, `Failed` otherwise.

---

## 📦 Dependencies

Managed via **vcpkg** (`Backend/vcpkg.json`):

| Library         | Purpose                                            |
| --------------- | -------------------------------------------------- |
| `nlohmann-json` | JSON parsing for workflow schemas and task input   |
| `cpr`           | High-level C++ HTTP client for service integration |

---

## 📄 License

See [License.md](License.md).
