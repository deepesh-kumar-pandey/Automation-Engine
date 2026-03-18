#include "worker/BlockIPTask.hpp" // Changed to match your specific header
#include "core/Logger.hpp"        // Added to use your new thread-safe logger
#include <cpr/cpr.h>
#include <nlohmann/json.hpp>
#include <string>
#include <future>

using json = nlohmann::json;
using namespace AutomationEngine;

namespace engine { // Using the 'engine' namespace to match your Logger

/**
 * @brief Executes the IP block request asynchronously.
 * Aligned with the 'oneOf' schema requiring an "ip" and "reason".
 */
std::future<TaskResult> BlockIPTask::execute(const json& input) {
    // We use std::async to keep the engine responsive while waiting for the network
    return std::async(std::launch::async, [this, input]() -> TaskResult {
        
        // 1. Extract data based on your new Schema
        std::string ip = input.value("ip", "0.0.0.0");
        std::string reason = input.value("reason", "No reason provided");

        Logger::log("Initiating block for IP: " + ip, Logger::Level::SECURITY);

        // 2. Network Handshake with Python Mock Service (Port 8081)
        // Note: Use 'localhost' if running on the same WSL instance
        auto response = cpr::Post(
            cpr::Url{"http://localhost:8081/block"},
            cpr::Body{json({
                {"target_ip", ip}, 
                {"reason", reason}
            }).dump()},
            cpr::Header{{"Content-Type", "application/json"}}
        );

        // 3. Evaluate results and log to engine.log via our new Logger
        if (response.status_code == 200) {
            Logger::log("Successfully blocked IP: " + ip, Logger::Level::SUCCESS);
            return TaskResult{true, "Block Confirmed"};
        } else {
            std::string errorMsg = "Failed to block IP. Service Status: " + std::to_string(response.status_code);
            Logger::log(errorMsg, Logger::Level::ERROR);
            return TaskResult{false, errorMsg};
        }
    });
}

// Metadata helpers for the Engine's Task Registry
std::string BlockIPTask::getName() const { return "BLOCK_IP"; }
std::string BlockIPTask::getID() const { return id_; }

} // namespace engine