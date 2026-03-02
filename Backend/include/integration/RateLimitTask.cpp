#include "workers/Task.hpp"
#include <cpr/cpr.h> // A popular C++ wrapper for libcurl

namespace engine {

class BlockIPTask : public ITask {
public:
    BlockIPTask(std::string task_id) : id_(task_id) {}

    std::future<TaskStatus> execute(const json& input) override {
        return std::async(std::launch::async, [this, input]() {
            std::string ip = input.value("ip", "0.0.0.0");
            
            // Logic to call your Rate Limiter API
            auto response = cpr::Post(
                cpr::Url{"http://rate-limiter:8081/block"},
                cpr::Body{json({{"target_ip", ip}}).dump()},
                cpr::Header{{"Content-Type", "application/json"}}
            );

            return (response.status_code == 200) ? TaskStatus::COMPLETED : TaskStatus::FAILED;
        });
    }

    std::string get_name() const override { return "BlockIPTask"; }
    std::string get_id() const override { return id_; }

private:
    std::string id_;
};

} // namespace engine