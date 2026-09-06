// Litwave Community SoundFont Session State Format
// Parity with Yamaha MONTAGE M last_session_state.bin
#pragma once
#include <cstdint>
#include <fstream>
#include <iostream>

#pragma pack(push, 1)
struct CommunitySessionPartState {
    int32_t bankIdx;
    int32_t presetIdx;
    float volume;
    float pan;
    float reverb;
    float chorus;
    uint8_t mute;
    uint8_t solo;
    uint8_t reserved[2];
};

struct CommunitySessionState {
    uint32_t magic; // 'L' 'I' 'T' 'S' (0x5354494C)
    uint32_t version; // 1
    float masterGain;
    float masterVolume;
    CommunitySessionPartState parts[8];
};
#pragma pack(pop)

inline bool load_community_session_state(const char* filepath, CommunitySessionState& state) {
    std::ifstream in(filepath, std::ios::binary);
    if (!in.is_open()) return false;
    in.read(reinterpret_cast<char*>(&state), sizeof(CommunitySessionState));
    if (in.gcount() != sizeof(CommunitySessionState)) return false;
    if (state.magic != 0x5354494C || state.version != 1) return false;
    return true;
}

inline bool save_community_session_state(const char* filepath, const CommunitySessionState& state) {
    std::ofstream out(filepath, std::ios::binary);
    if (!out.is_open()) return false;
    out.write(reinterpret_cast<const char*>(&state), sizeof(CommunitySessionState));
    return out.good();
}
