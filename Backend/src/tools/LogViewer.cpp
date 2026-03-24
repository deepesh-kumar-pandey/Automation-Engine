/**
 * LogViewer.cpp — Admin utility for decrypting and reading engine.log
 *
 * Usage:
 *   export ENGINE_LOG_KEY=<64-hex-char key>
 *   ./log_viewer [path/to/engine.log]
 *
 * Reads the binary log written by Logger.hpp and prints each entry in
 * plaintext.  Detects tampering via AES-256-GCM authentication tags.
 *
 * Binary log format (per entry):
 *   [4-byte LE uint32  total_blob_len]
 *   [12-byte IV]
 *   [ciphertext  (blob_len - 28 bytes)]
 *   [16-byte GCM tag]
 *
 * Plaintext fallback sentinel (when ENGINE_LOG_KEY was absent at write time):
 *   [4-byte LE uint32  0xFFFFFFFF]
 *   [4-byte LE uint32  entry_len]
 *   [entry_len bytes of raw text]
 */

#include "core/Logger.hpp"   // EncryptionManager lives here

#include <iostream>
#include <fstream>
#include <vector>
#include <cstdint>
#include <cstring>
#include <string>

using namespace engine;

static const uint32_t PLAINTEXT_SENTINEL = 0xFFFFFFFFu;

int main(int argc, char** argv) {
    // -----------------------------------------------------------------------
    // 1. Load decryption key
    // -----------------------------------------------------------------------
    uint8_t key[EncryptionManager::KEY_LEN];
    bool hasKey = EncryptionManager::loadKey(key);

    if (!hasKey) {
        std::cerr << "[LogViewer] WARNING: ENGINE_LOG_KEY is not set or malformed.\n"
                  << "            Encrypted entries cannot be decrypted. "
                     "Plaintext entries will still be shown.\n\n";
    }

    // -----------------------------------------------------------------------
    // 2. Open log file
    // -----------------------------------------------------------------------
    std::string logPath = "../../data/engine.log";
    if (argc >= 2) logPath = argv[1];

    std::ifstream logFile(logPath, std::ios::binary);
    if (!logFile.is_open()) {
        std::cerr << "[LogViewer] ERROR: Cannot open log file: " << logPath << "\n";
        return 1;
    }

    std::cout << "========================================\n";
    std::cout << "  Automation Engine — Decrypted Log\n";
    std::cout << "  Source: " << logPath << "\n";
    std::cout << "========================================\n\n";

    // -----------------------------------------------------------------------
    // 3. Read and decode entries
    // -----------------------------------------------------------------------
    size_t entryIndex  = 0;
    int    errorCount  = 0;

    while (logFile.peek() != EOF) {
        ++entryIndex;

        // --- Read 4-byte length prefix ---
        uint32_t lenField = 0;
        if (!logFile.read(reinterpret_cast<char*>(&lenField), sizeof(lenField))) {
            if (logFile.eof()) break;   // clean end of file
            std::cerr << "[LogViewer] ERROR: Unexpected read failure at entry "
                      << entryIndex << ".\n";
            ++errorCount;
            break;
        }

        // --- Check for plaintext sentinel ---
        if (lenField == PLAINTEXT_SENTINEL) {
            uint32_t textLen = 0;
            if (!logFile.read(reinterpret_cast<char*>(&textLen), sizeof(textLen))) {
                std::cerr << "[LogViewer] ERROR: Truncated plaintext entry "
                          << entryIndex << ".\n";
                ++errorCount;
                break;
            }
            std::string text(textLen, '\0');
            if (!logFile.read(text.data(), textLen)) {
                std::cerr << "[LogViewer] ERROR: Truncated plaintext data at entry "
                          << entryIndex << ".\n";
                ++errorCount;
                break;
            }
            std::cout << "[ENTRY " << entryIndex << "] (unencrypted) " << text << "\n";
            continue;
        }

        // --- Normal encrypted entry ---
        uint32_t blobLen = lenField;
        if (blobLen < static_cast<uint32_t>(EncryptionManager::IV_LEN + EncryptionManager::TAG_LEN)) {
            std::cerr << "[LogViewer] ERROR: Blob at entry " << entryIndex
                      << " is too small (" << blobLen << " bytes). File may be corrupt.\n";
            ++errorCount;
            break;
        }

        std::vector<uint8_t> blob(blobLen);
        if (!logFile.read(reinterpret_cast<char*>(blob.data()), blobLen)) {
            std::cerr << "[LogViewer] ERROR: Truncated blob at entry " << entryIndex << ".\n";
            ++errorCount;
            break;
        }

        if (!hasKey) {
            std::cout << "[ENTRY " << entryIndex
                      << "] (encrypted — set ENGINE_LOG_KEY to decrypt)\n";
            continue;
        }

        std::string plaintext = EncryptionManager::decrypt(blob, key);
        if (plaintext.empty()) {
            std::cerr << "[LogViewer] TAMPER ALERT: Entry " << entryIndex
                      << " failed GCM tag verification! Data may have been modified.\n";
            ++errorCount;
        } else {
            std::cout << "[ENTRY " << entryIndex << "] " << plaintext << "\n";
        }
    }

    std::cout << "\n========================================\n";
    std::cout << "  Total entries read : " << entryIndex << "\n";
    std::cout << "  Decryption errors  : " << errorCount << "\n";
    std::cout << "========================================\n";

    return (errorCount > 0) ? 1 : 0;
}
