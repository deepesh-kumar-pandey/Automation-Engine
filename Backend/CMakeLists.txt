cmake_minimum_required(VERSION 3.21)
project(AutomationBackend)

# Ensure we use a modern C++ version for async tasks
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# 1. Add the source files
add_executable(automation_backend 
    src/main.cpp 
    src/worker/ShellTask.cpp
)

# 2. Tell CMake where to find your .hpp files
target_include_directories(automation_backend PRIVATE include)

# 3. Link your dependencies from vcpkg
find_package(nlohmann_json CONFIG REQUIRED)
target_link_libraries(automation_backend PRIVATE nlohmann_json::nlohmann_json)

# Optional: If you use the 'cpr' or 'drogon' libraries later for your 
# Security Automator or Data Pipeline ideas, you'll add them here.