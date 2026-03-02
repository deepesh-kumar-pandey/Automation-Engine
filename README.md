🚀 Automation Engine
A high-performance, asynchronous task orchestration system built with C++26 and React. This engine allows users to define complex routines (workflows) that automate manual tasks across different applications and infrastructure.

🌟 Key Features
Asynchronous Core: Built on a non-blocking C++ architecture using std::future for maximum efficiency.

Security Automator: Includes built-in workers like BlockIPTask to integrate directly with Rate Limiters and firewalls.

Antigravity Frontend: A sleek dashboard for managing routines and monitoring task status in real-time.

JSON-Driven Workflows: Define your "Routines" in a structured workflow_schema.json for easy portability.

📂 Project Structure
automation-engine/
├── backend/ # C++ Core Engine (vcpkg, CMake, Drogon)
├── frontend/ # React Dashboard
├── shared/ # JSON Schemas and shared configurations
├── postgres/ # Persistent storage for task history
└── docker-compose.yml # Full stack orchestration

🛠️ Tech Stack
Backend: C++26, nlohmann-json, cpr (HTTP), Drogon (Web Framework).

Frontend: React.

Database: PostgreSQL.

Package Management: vcpkg for C++ dependencies.

🚀 Getting Started
Prerequisites
Docker & Docker Compose

C++ Compiler (GCC 13+ or Clang 16+)

CMake (3.21+)
