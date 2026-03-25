#pragma once
#include <string>

namespace engine {

class ThreatAnalyzer {
public:
    static bool isMalicious(const std::string& payload);
};

} // namespace engine
