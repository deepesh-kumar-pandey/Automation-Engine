#include "utils/Threatanalyzer.hpp"
#include <algorithm>

namespace engine {

bool ThreatAnalyzer::isMalicious(const std::string& input) {
    std::string payload = input;
    std::transform(payload.begin(), payload.end(), payload.begin(), ::toupper);
    
    if (payload.find("DROP TABLE") != std::string::npos ||
        payload.find("OR 1=1") != std::string::npos ||
        payload.find("SQL INJECTION") != std::string::npos ||
        payload.find("<SCRIPT>") != std::string::npos) {
        return true;
    }
    return false;
}

} // namespace engine
