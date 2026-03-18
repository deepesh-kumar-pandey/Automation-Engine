#ifndef BLOCK_IP_TASK_HPP
#define BLOCK_IP_TASK_HPP

#include "worker/ShellTask.hpp"
#include <nlohmann/json.hpp>
#include <string>
#include <future>

namespace engine {

class BlockIPTask : public AutomationEngine::Task {
public:
    BlockIPTask(std::string task_id) : id_(task_id) {}
    std::future<AutomationEngine::TaskResult> execute(const nlohmann::json& input) override;
    std::string getName() const override;
    std::string getID() const override;

private:
    std::string id_;
};

} // namespace engine

#endif // BLOCK_IP_TASK_HPP
