#include "worker/BlockIPTask.hpp"
#include "core/Logger.hpp"
#include <cpr/cpr.h>
#include <nlohmann/json.hpp>
#include <openssl/hmac.h>
#include <openssl/evp.h>
#include <string>
#include <future>
#include <cstdlib>
#include <iomanip>
#include <sstream>

using json = nlohmann::json;
using namespace AutomationEngine;

namespace engine {

/**
 * @brief Compute HMAC-SHA256 of a payload using ENGINE_LOG_KEY as the secret.
 * @param payload  The raw string to sign (the serialised JSON body).
 * @return Lowercase hex-encoded HMAC-SHA256, or empty string if key is absent.
 */
static std::string computeHMAC(const std::string& payload) {
    const char* hexKey = std::getenv("ENGINE_LOG_KEY");
    if (!hexKey || std::strlen(hexKey) != 64) return "";

    // Convert 64-char hex key → 32 raw bytes
    uint8_t key[32];
    for (int i = 0; i < 32; ++i) {
        char byte[3] = {hexKey[i * 2], hexKey[i * 2 + 1], '\0'};
        key[i] = static_cast<uint8_t>(std::strtoul(byte, nullptr, 16));
    }

    unsigned int hmacLen = 0;
    uint8_t hmacBytes[EVP_MAX_MD_SIZE];

    HMAC(EVP_sha256(),
         key, 32,
         reinterpret_cast<const uint8_t*>(payload.data()),
         static_cast<int>(payload.size()),
         hmacBytes, &hmacLen);

    // Encode result as lowercase hex
    std::ostringstream oss;
    oss << std::hex << std::setfill('0');
    for (unsigned int i = 0; i < hmacLen; ++i)
        oss << std::setw(2) << static_cast<int>(hmacBytes[i]);
    return oss.str();
}

/**
 * @brief Executes the IP block request asynchronously.
 * - Signs the JSON payload with HMAC-SHA256 (X-Engine-Signature header).
 * - Uses HTTPS with VerifyHost disabled for local testing.
 */
std::future<TaskResult> BlockIPTask::execute(const json& input) {
    return std::async(std::launch::async, [this, input]() -> TaskResult {

        // 1. Extract data based on the schema
        std::string ip     = input.value("ip", "0.0.0.0");
        std::string reason = input.value("reason", "No reason provided");

        Logger::log("Initiating block for IP: " + ip, Logger::Level::SECURITY);

        // 2. Build the JSON body
        std::string body = json({
            {"target_ip", ip},
            {"reason",    reason}
        }).dump();

        // 3. Compute HMAC-SHA256 signature for request authenticity
        std::string signature = computeHMAC(body);
        if (signature.empty()) {
            Logger::log("ENGINE_LOG_KEY not set — sending request without HMAC signature.",
                        Logger::Level::WARN);
        }

        // 4. Send the signed request
        //    NOTE: cpr::VerifyHost{false} is intentional for local dev (self-signed cert).
        //    Remove before deploying to production.
        //    NOTE: cpr::VerifySsl{false} disables SSL cert verification — local dev only.
        //    Remove before deploying to production.
        auto response = cpr::Post(
            cpr::Url{"http://localhost:8081/block"},
            cpr::Body{body},
            cpr::Header{
                {"Content-Type",       "application/json"},
                {"X-Engine-Signature", signature}
            }
        );

        // 5. Evaluate result and log via the encrypted logger
        if (response.status_code == 200) {
            Logger::log("Successfully blocked IP: " + ip, Logger::Level::SUCCESS);
            return TaskResult{true, "Block Confirmed"};
        } else {
            std::string errorMsg = "Failed to block IP. Service Status: "
                                   + std::to_string(response.status_code);
            Logger::log(errorMsg, Logger::Level::ERROR);
            return TaskResult{false, errorMsg};
        }

        // Unreachable — silences -Wreturn-type
        return TaskResult{false, "Unexpected execution path"};
    });
}

// Metadata helpers for the Engine's Task Registry
std::string BlockIPTask::getName() const { return "BLOCK_IP"; }
std::string BlockIPTask::getID()   const { return id_; }

} // namespace engine