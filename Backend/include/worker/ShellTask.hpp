#pragma once

#include <string>
#include <future>
#include <nlohmann/json.hpp>

/**
 * @brief Global alias for the nlohmann JSON library for cleaner task signatures.
 */
using json = nlohmann::json;

namespace AutomationEngine {

    /**
     * @brief A simple struct to wrap the output of a task.
     */
    struct TaskResult {
        bool success;
        std::string message;
    };

    /**
     * @brief Represents the lifecycle states of a single automation task.
     */
    enum class TaskStatus { Pending, Running, Completed, Failed };

    /**
     * @brief Abstract base class (Interface) for all engine workers.
     * * Any new automation capability (e.g., Security, Data, AI) must 
     * inherit from this class and implement the pure virtual methods.
     */
    class Task {
    public:
        virtual ~Task() = default;

        /**
         * @brief Executes the core logic of the task asynchronously.
         * @param input A JSON object containing task-specific parameters.
         * @return A std::future containing the final status of the execution.
         */
        virtual std::future<TaskResult> execute(const json& input) = 0;

        /**
         * @brief Returns the human-readable name of the task type.
         */
        virtual std::string getName() const = 0;

        /**
         * @brief Returns the unique instance identifier for this specific execution.
         */
        virtual std::string getID() const = 0;
    };

    /**
     * @brief A concrete worker that executes shell commands.
     */
    class ShellTask : public Task {
    private:
        std::string id_;
    public:
        ShellTask() : id_("shell_task_" + std::to_string(std::rand())) {}
        std::future<TaskResult> execute(const json& params) override;
        std::string getName() const override { return "ShellTask"; }
        std::string getID() const override { return id_; }
    };

} // namespace AutomationEngine