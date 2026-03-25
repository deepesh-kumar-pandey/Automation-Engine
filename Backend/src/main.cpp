#include <iostream>
#include <fstream>
#include <memory>
#include <vector>
#include <nlohmann/json.hpp>
#include <sys/socket.h>
#include <netinet/in.h>
#include <unistd.h>
#include <arpa/inet.h>
#include <string.h>

// Include tasks
#include "worker/ShellTask.hpp"
#include "worker/BlockIPTask.hpp"
#include "core/Logger.hpp"
#include "utils/Threatanalyzer.hpp"

using json = nlohmann::json;

void runTcpServer() {
    int server_fd, new_socket;
    struct sockaddr_in address;
    int opt = 1;
    int addrlen = sizeof(address);
    char buffer[4096] = {0};
    
    if ((server_fd = socket(AF_INET, SOCK_STREAM, 0)) == 0) {
        engine::Logger::log("Socket creation failed", engine::Logger::Level::ERROR);
        return;
    }
    
    if (setsockopt(server_fd, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt))) {
        engine::Logger::log("setsockopt failed", engine::Logger::Level::ERROR);
        return;
    }
    
    address.sin_family = AF_INET;
    address.sin_addr.s_addr = INADDR_ANY;
    address.sin_port = htons(9090);
    
    if (bind(server_fd, (struct sockaddr *)&address, sizeof(address)) < 0) {
        engine::Logger::log("Bind failed", engine::Logger::Level::ERROR);
        return;
    }
    
    if (listen(server_fd, 5) < 0) {
        engine::Logger::log("Listen failed", engine::Logger::Level::ERROR);
        return;
    }
    
    engine::Logger::log("Listening for threats on port 9090...", engine::Logger::Level::INFO);
    
    while (true) {
        if ((new_socket = accept(server_fd, (struct sockaddr *)&address, (socklen_t*)&addrlen)) < 0) {
            engine::Logger::log("Accept failed", engine::Logger::Level::ERROR);
            continue;
        }
        
        memset(buffer, 0, sizeof(buffer));
        int valread = read(new_socket, buffer, sizeof(buffer) - 1);
        if(valread > 0) {
            std::string req(buffer);
            try {
                json j = json::parse(req);
                std::string ip = j.value("ip", "unknown");
                std::string payload = j.value("payload", "");
                
                if (engine::ThreatAnalyzer::isMalicious(payload)) {
                    engine::Logger::log("CRITICAL: SQL INJECTION BLOCKED from " + ip, engine::Logger::Level::SECURITY);
                    auto task = std::make_unique<engine::BlockIPTask>("threat_block");
                    json block_input = {{"ip", ip}, {"reason", "Malicious payload detected"}};
                    auto fut = task->execute(block_input);
                    fut.get();
                } else {
                    engine::Logger::log("Payload from " + ip + " is safe.", engine::Logger::Level::INFO);
                }
            } catch (const std::exception& e) {
                 engine::Logger::log("Invalid JSON from socket", engine::Logger::Level::WARN);
            }
        }
        close(new_socket);
    }
}

int main(int argc, char** argv) {
    engine::Logger::log("Automation Backend starting...", engine::Logger::Level::INFO);
    
    // Read routine.json (optional run for existing tasks)
    std::ifstream file("../../shared/routine.json");
    if (file.is_open()) {
        json routine;
        try {
            file >> routine;
            if (routine.contains("routine") && routine["routine"].is_array()) {
                for (const auto& step : routine["routine"]) {
                    std::string task_type = step.value("task", "UNKNOWN");
                    std::unique_ptr<AutomationEngine::Task> pTask;
                    if (task_type == "SHELL") {
                        pTask = std::make_unique<AutomationEngine::ShellTask>();
                    } else if (task_type == "BLOCK_IP") {
                        pTask = std::make_unique<engine::BlockIPTask>("block_task_1");
                    }
                    if (pTask) {
                        auto fut = pTask->execute(step);
                        fut.get();
                    }
                }
            }
        } catch (...) {}
    }

    runTcpServer();
    return 0;
}
