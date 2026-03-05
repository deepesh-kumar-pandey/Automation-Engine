#include "worker/ShellTask.hpp"
#include <cstdio>
#include <iostream>
#include <memory>
#include <stdexcept>
#include <array>

// Helper function to capture the output of a Linux terminal command
std::string run_command(const char* cmd) {
    std::array<char, 128> buffer;
    std::string result;
    
    // popen opens a process and creates a pipe to read its output
    std::unique_ptr<FILE, decltype(&pclose)> pipe(popen(cmd, "r"), pclose);
    if (!pipe) {
        throw std::runtime_error("popen() failed to start the process.");
    }

    while (fgets(buffer.data(), buffer.size(), pipe.get()) != nullptr) {
        result += buffer.data();
    }
    return result;
}

namespace AutomationEngine {

std::future<TaskResult> ShellTask::execute(const nlohmann::json& params) {
    // We run this asynchronously so the rest of the engine doesn't "freeze" 
    // while waiting for a long Linux command to finish.
    return std::async(std::launch::async, [params]() {
        try {
            // Pull the "command" field from your workflow_schema.json
            std::string cmd = params.at("command").get<std::string>();
            
            std::string output = run_command(cmd.c_str());
            
            return TaskResult{true, "Output:\n" + output};
        } catch (const std::exception& e) {
            return TaskResult{false, std::string("Execution Error: ") + e.what()};
        }
    });
}

} // namespace AutomationEngine