#ifndef LOGGER_HPP
#define LOGGER_HPP

#include <iostream>
#include <fstream>
#include <string>
#include <mutex>
#include <chrono>
#include <iomanip>
#include <sstream>

namespace engine {

/**
 * @brief Enhanced Thread-safe Logger.
 * Supports console output, file persistence, and categorized log levels.
 */
class Logger {
public:
    enum class Level { INFO, WARN, ERROR, SECURITY, SUCCESS };

    /**
     * @brief Core logging function.
     * @param message The content to log.
     * @param level The category of the log.
     */
    static void log(const std::string& message, Level level = Level::INFO) {
        static std::mutex logMutex;
        std::lock_guard<std::mutex> lock(logMutex);

        std::string levelStr = toString(level);
        std::string timestamp = getTimestamp();
        std::string logEntry = "[" + timestamp + "] [" + levelStr + "] " + message;

        // 1. Output to Console
        std::cout << logEntry << std::endl;

        // 2. Output to File (Persistence for audit logs)
        static std::ofstream logFile("../../data/engine.log", std::ios::app);
        if (logFile.is_open()) {
            logFile << logEntry << std::endl;
        }
    }

private:
    static std::string getTimestamp() {
        auto now = std::chrono::system_clock::to_time_t(std::chrono::system_clock::now());
        struct tm buf;
        localtime_r(&now, &buf); // Thread-safe version of localtime
        std::ostringstream oss;
        oss << std::put_time(&buf, "%Y-%m-%d %H:%M:%S");
        return oss.str();
    }

    static std::string toString(Level level) {
        switch (level) {
            case Level::INFO:     return "INFO";
            case Level::WARN:     return "WARN";
            case Level::ERROR:    return "ERROR";
            case Level::SECURITY: return "SECURITY";
            case Level::SUCCESS:  return "SUCCESS";
            default:              return "UNKNOWN";
        }
    }
};

} // namespace engine

#endif // LOGGER_HPP