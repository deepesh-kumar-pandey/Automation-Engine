#include <iostream>
#include <fstream>
#include <memory>
#include <vector>
#include <nlohmann/json.hpp>

// Include tasks
#include "worker/ShellTask.hpp"
#include "worker/BlockIPTask.hpp"
#include "core/Logger.hpp"

using json = nlohmann::json;

int main(int argc, char** argv) {
    engine::Logger::log("Automation Backend starting...", engine::Logger::Level::INFO);

    // Read routine.json
    std::ifstream file("../../shared/routine.json");
    if (!file.is_open()) {
        engine::Logger::log("Failed to open routine.json", engine::Logger::Level::ERROR);
        std::cin.ignore(10000, '\n');
        std::cout << "Press Enter to exit..." << std::endl;
        std::cin.get();
        return 1;
    }

    json routine;
    try {
        file >> routine;
    } catch (const json::parse_error& e) {
        engine::Logger::log(std::string("JSON Parse error: ") + e.what(), engine::Logger::Level::ERROR);
        std::cin.ignore(10000, '\n');
        std::cout << "Press Enter to exit..." << std::endl;
        std::cin.get();
        return 1;
    }

    // Process steps
    if (routine.contains("routine") && routine["routine"].is_array()) {
        for (const auto& step : routine["routine"]) {
            std::string task_type = step.value("task", "UNKNOWN");
            engine::Logger::log("Processing task: " + task_type, engine::Logger::Level::INFO);

            std::unique_ptr<AutomationEngine::Task> pTask;

            if (task_type == "SHELL") {
                pTask = std::make_unique<AutomationEngine::ShellTask>();
            } else if (task_type == "BLOCK_IP") {
                pTask = std::make_unique<engine::BlockIPTask>("block_task_1");
            } else {
                engine::Logger::log("Unknown task type: " + task_type, engine::Logger::Level::WARN);
                continue;
            }

            auto future_result = pTask->execute(step);
            auto result = future_result.get(); // Wait for it to finish

            if (result.success) {
                engine::Logger::log("Task " + task_type + " succeeded: " + result.message, engine::Logger::Level::SUCCESS);
            } else {
                engine::Logger::log("Task " + task_type + " failed: " + result.message, engine::Logger::Level::ERROR);
            }
        }
    } else {
        engine::Logger::log("Invalid routine.json format", engine::Logger::Level::ERROR);
    }

    engine::Logger::log("All tasks completed.", engine::Logger::Level::SUCCESS);
    std::cout << "Press Enter to exit..." << std::endl;
    // Clearing input buffer just in case
    if (std::cin.peek() == '\n') std::cin.ignore();
    std::cin.get();
    return 0;
}
