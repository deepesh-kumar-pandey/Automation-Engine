#ifndef LOGGER_HPP
#define LOGGER_HPP

#include <iostream>
#include <fstream>
#include <string>
#include <vector>
#include <mutex>
#include <chrono>
#include <iomanip>
#include <sstream>
#include <cstdint>
#include <cstring>
#include <cstdlib>

#include <openssl/evp.h>
#include <openssl/rand.h>

namespace engine {

/**
 * @brief Manages AES-256-GCM encryption/decryption using OpenSSL's EVP interface.
 *
 * Binary log entry format (per log line):
 *   [4-byte LE uint32 total_len] [12-byte IV] [ciphertext] [16-byte GCM tag]
 *
 * Key source: ENGINE_LOG_KEY environment variable (64 hex chars = 32 bytes).
 */
class EncryptionManager {
public:
    static constexpr int IV_LEN  = 12;  ///< 96-bit IV for GCM
    static constexpr int TAG_LEN = 16;  ///< 128-bit authentication tag
    static constexpr int KEY_LEN = 32;  ///< 256-bit AES key

    /**
     * @brief Load the AES key from the ENGINE_LOG_KEY environment variable.
     * @param[out] key  Buffer of KEY_LEN bytes to fill.
     * @return true on success, false if the variable is missing or malformed.
     */
    static bool loadKey(uint8_t key[KEY_LEN]) {
        const char* hexKey = std::getenv("ENGINE_LOG_KEY");
        if (!hexKey) return false;
        size_t hexLen = std::strlen(hexKey);
        if (hexLen != static_cast<size_t>(KEY_LEN * 2)) return false;

        for (int i = 0; i < KEY_LEN; ++i) {
            char byte[3] = {hexKey[i * 2], hexKey[i * 2 + 1], '\0'};
            char* end = nullptr;
            key[i] = static_cast<uint8_t>(std::strtoul(byte, &end, 16));
            if (end != byte + 2) return false;
        }
        return true;
    }

    /**
     * @brief Encrypt plaintext with AES-256-GCM.
     * @return Blob: [12-byte IV][ciphertext][16-byte tag], or empty on failure.
     */
    static std::vector<uint8_t> encrypt(const std::string& plaintext, const uint8_t key[KEY_LEN]) {
        uint8_t iv[IV_LEN];
        if (RAND_bytes(iv, IV_LEN) != 1) return {};

        std::vector<uint8_t> ciphertext(plaintext.size());
        uint8_t tag[TAG_LEN];

        EVP_CIPHER_CTX* ctx = EVP_CIPHER_CTX_new();
        if (!ctx) return {};

        bool ok = false;
        int outLen = 0;
        do {
            if (EVP_EncryptInit_ex(ctx, EVP_aes_256_gcm(), nullptr, nullptr, nullptr) != 1) break;
            if (EVP_EncryptInit_ex(ctx, nullptr, nullptr, key, iv) != 1) break;
            if (EVP_EncryptUpdate(ctx,
                    ciphertext.data(), &outLen,
                    reinterpret_cast<const uint8_t*>(plaintext.data()),
                    static_cast<int>(plaintext.size())) != 1) break;
            int finalLen = 0;
            if (EVP_EncryptFinal_ex(ctx, ciphertext.data() + outLen, &finalLen) != 1) break;
            if (EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_GCM_GET_TAG, TAG_LEN, tag) != 1) break;
            ok = true;
        } while (false);

        EVP_CIPHER_CTX_free(ctx);
        if (!ok) return {};

        // Build: [IV | ciphertext | tag]
        std::vector<uint8_t> blob;
        blob.reserve(IV_LEN + ciphertext.size() + TAG_LEN);
        blob.insert(blob.end(), iv, iv + IV_LEN);
        blob.insert(blob.end(), ciphertext.begin(), ciphertext.end());
        blob.insert(blob.end(), tag, tag + TAG_LEN);
        return blob;
    }

    /**
     * @brief Decrypt a blob produced by encrypt().
     * @return Plaintext string, or empty on failure / tag mismatch (tampering).
     */
    static std::string decrypt(const std::vector<uint8_t>& blob, const uint8_t key[KEY_LEN]) {
        if (blob.size() < static_cast<size_t>(IV_LEN + TAG_LEN)) return {};

        const uint8_t* iv         = blob.data();
        const uint8_t* ciphertext = blob.data() + IV_LEN;
        size_t         ctLen      = blob.size() - IV_LEN - TAG_LEN;
        const uint8_t* tag        = blob.data() + IV_LEN + ctLen;

        std::vector<uint8_t> plain(ctLen);
        EVP_CIPHER_CTX* ctx = EVP_CIPHER_CTX_new();
        if (!ctx) return {};

        bool ok = false;
        int outLen = 0;
        do {
            if (EVP_DecryptInit_ex(ctx, EVP_aes_256_gcm(), nullptr, nullptr, nullptr) != 1) break;
            if (EVP_DecryptInit_ex(ctx, nullptr, nullptr, key, iv) != 1) break;
            if (EVP_DecryptUpdate(ctx, plain.data(), &outLen, ciphertext, static_cast<int>(ctLen)) != 1) break;
            // Set expected tag before finalising
            if (EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_GCM_SET_TAG, TAG_LEN,
                    const_cast<uint8_t*>(tag)) != 1) break;
            int finalLen = 0;
            // Returns 1 on success, 0 on tag mismatch (tampering detected)
            if (EVP_DecryptFinal_ex(ctx, plain.data() + outLen, &finalLen) != 1) break;
            ok = true;
        } while (false);

        EVP_CIPHER_CTX_free(ctx);
        if (!ok) return {};

        return std::string(reinterpret_cast<char*>(plain.data()), ctLen);
    }
};

// ---------------------------------------------------------------------------

/**
 * @brief Enhanced Thread-safe Logger with AES-256-GCM encrypted file output.
 *
 * Console output remains plaintext for real-time visibility.
 * File output (data/engine.log) is binary-encrypted using the key from
 * the ENGINE_LOG_KEY environment variable.
 */
class Logger {
public:
    enum class Level { INFO, WARN, ERROR, SECURITY, SUCCESS };

    /**
     * @brief Core logging function.
     * @param message The content to log.
     * @param level   The category of the log.
     */
    static void log(const std::string& message, Level level = Level::INFO) {
        static std::mutex logMutex;
        std::lock_guard<std::mutex> lock(logMutex);

        std::string levelStr  = toString(level);
        std::string timestamp = getTimestamp();
        std::string logEntry  = "[" + timestamp + "] [" + levelStr + "] " + message;

        // 1. Console output (always plaintext)
        std::cout << logEntry << std::endl;

        // 2. Encrypted binary file output
        uint8_t key[EncryptionManager::KEY_LEN];
        bool hasKey = EncryptionManager::loadKey(key);

        static std::ofstream logFile("../../data/engine.log",
                                     std::ios::app | std::ios::binary);
        if (!logFile.is_open()) return;

        if (hasKey) {
            auto blob = EncryptionManager::encrypt(logEntry, key);
            if (blob.empty()) return; // encryption failed

            // Write 4-byte LE length prefix then the encrypted blob
            uint32_t blobLen = static_cast<uint32_t>(blob.size());
            logFile.write(reinterpret_cast<const char*>(&blobLen), sizeof(blobLen));
            logFile.write(reinterpret_cast<const char*>(blob.data()), blobLen);
        } else {
            // Fallback: write plaintext with a size prefix so LogViewer can
            // still frame entries (marked with a sentinel 0xFFFFFFFF length
            // so LogViewer knows decryption was not applied).
            const uint32_t PLAINTEXT_SENTINEL = 0xFFFFFFFFu;
            uint32_t len = static_cast<uint32_t>(logEntry.size());
            logFile.write(reinterpret_cast<const char*>(&PLAINTEXT_SENTINEL), sizeof(PLAINTEXT_SENTINEL));
            logFile.write(reinterpret_cast<const char*>(&len), sizeof(len));
            logFile.write(logEntry.data(), len);
        }
        logFile.flush();
    }

private:
    static std::string getTimestamp() {
        auto now = std::chrono::system_clock::to_time_t(std::chrono::system_clock::now());
        struct tm buf;
        localtime_r(&now, &buf);
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