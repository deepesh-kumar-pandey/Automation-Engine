/**
 * @file BlockIPTask.cpp
 * @brief Worker implementation for blocking malicious IPs via a Rate Limiter API.
 */

#include "worker/ShellTask.hpp" // Contains the 'Task' interface
#include <cpr/cpr.h> // High-level C++ HTTP library for cross-service communication
#include <string>
#include <future>

namespace AutomationEngine {

/**
 * @class BlockIPTask
 * @brief Handles security-based automation tasks defined in the workflow schema.
 */
class BlockIPTask : public Task {
public:
    /**
     * @brief Constructor for the IP blocking task instance.
     * @param task_id Unique identifier for tracking this specific execution in logs.
     */
    BlockIPTask(std::string task_id) : id_(task_id) {}

    /**
     * @brief Executes the IP block request asynchronously.
     * @param input JSON data containing task parameters (expects an "ip" field).
     * @return A std::future containing the final status of the task.
     */
    std::future<TaskResult> execute(const json& input) override {
        // We use std::async with std::launch::async to prevent blocking the main 
        // engine thread while waiting for the network response.
        return std::async(std::launch::async, [this, input]() -> TaskResult {
            // Retrieve the IP from the input JSON. Default to "0.0.0.0" for safety.
            std::string ip = input.value("ip", "0.0.0.0");
            
            // Logic to call your specific Rate Limiter API service.
            // We pass the target IP in a JSON body via an HTTP POST request.
            auto response = cpr::Post(
                cpr::Url{"http://rate-limiter:8081/block"},
                cpr::Body{json({{"target_ip", ip}}).dump()},
                cpr::Header{{"Content-Type", "application/json"}}
            );

            // 200 OK indicates the IP was successfully blocked.
            if (response.status_code == 200) {
                return TaskResult{true, "Successfully blocked IP"};
            } else {
                return TaskResult{false, "Failed to block IP"};
            }
        });
    }

    /** @brief Returns the human-readable type name for logging and schema matching. */
    std::string getName() const override { return "BlockIPTask"; }
    
    /** @brief Returns the specific instance ID for this task execution. */
    std::string getID() const override { return id_; }

private:
    std::string id_; ///< Internal storage for the unique task ID.
};

} // namespace AutomationEngine