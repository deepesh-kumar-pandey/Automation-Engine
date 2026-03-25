cmake_minimum_required(VERSION 3.21)
project(AutomationBackend)

# Ensure we use a modern C++ version for async tasks and modern syntax
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# 1. Find the necessary packages from vcpkg
find_package(nlohmann_json CONFIG REQUIRED)
find_package(cpr CONFIG REQUIRED)
find_package(OpenSSL REQUIRED)

# 2. Add the source files for the main backend
add_executable(automation_backend
    src/main.cpp
    src/worker/ShellTask.cpp
    src/worker/BlockIPTask.cpp
    src/utils/Threatanalyzer.cpp
)

# 3. Tell CMake where to find your .hpp files
target_include_directories(automation_backend PRIVATE include)

# 4. Link all dependencies (including OpenSSL for AES-256-GCM and HMAC)
target_link_libraries(automation_backend PRIVATE
    nlohmann_json::nlohmann_json
    cpr::cpr
    OpenSSL::Crypto
    OpenSSL::SSL
)

# 5. Standalone LogViewer utility (decrypts binary engine.log for admin auditing)
add_executable(log_viewer
    src/tools/LogViewer.cpp
)

target_include_directories(log_viewer PRIVATE include)

target_link_libraries(log_viewer PRIVATE
    OpenSSL::Crypto
)