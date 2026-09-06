#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <winsock2.h>
#include <ws2tcpip.h>
#include <mmsystem.h>
#include <iostream>
#include <vector>
#include <atomic>
#include <thread>
#include <chrono>
#include <cmath>
#include <algorithm>
#include <mutex>

#define MINIAUDIO_IMPLEMENTATION
#include "miniaudio.h"
#include "master_dsp.h"
#include "fx_chain.h"
#include "community_state.h"

#define TSF_IMPLEMENTATION
#include "tsf.h"

#pragma comment(lib, "ws2_32.lib")
#pragma comment(lib, "winmm.lib")
#pragma comment(lib, "user32.lib")

// SoundFont Instances for Parts
// Part 1: Yamaha / GS Grand Piano
// Part 2: Yamaha SY-22 DynaPad (Warm Pad)
// Part 3: Yamaha SY-22 DXLegend (FM Tine Synth)
// Part 4: Yamaha SY-22 SuperPad (Atmospheric Wash)
// Part 5: Yamaha SY-22 VCOLead (Super Waves)
// Part 6: Yamaha SY-22 ElekRoad (FM Chorus EP)
// Part 7: Roland SC-88 Fantasia (Iconic Roland Bell)
// Part 8: Roland SC-88 Sine Wave (Pure Sine Lead)

static tsf* g_part_synths[8] = {nullptr};
static std::mutex g_synth_mutex;
static StereoChorus g_chorus;
static StudioReverb g_reverb;

// Part state parameters
static std::atomic<float> g_part_volumes[8];
static std::atomic<float> g_part_pans[8];
static std::atomic<float> g_part_reverbs[8];
static std::atomic<float> g_part_chorus[8];
static std::atomic<bool> g_part_mutes[8];

static std::atomic<float> g_master_vst_volume{1.0f};
static std::atomic<float> g_master_gain{1.0f};

// Peak metering
static std::atomic<float> g_synth_peak_meter{0.0f};
static std::atomic<float> g_track_peak_meter{0.0f};
static std::atomic<float> g_master_peak_meter_l{0.0f};
static std::atomic<float> g_master_peak_meter_r{0.0f};

// Master DSP & Spectrum
static SpectrumCapture g_master_spectrum(44100.0f);
static StageWarmth g_stage_warmth(44100.0f);
static CallbackPerformanceMonitor g_callback_monitor;
static std::atomic<bool> g_analyzer_enabled{true};
static std::atomic<bool> g_warmth_enabled{true};
static std::atomic<float> g_warmth_drive{1.2f};
static std::atomic<int> g_warmth_mode{0};
static std::atomic<float> g_warmth_meter{0.0f};
static std::atomic<float> g_dsp_load{0.0f};
static std::atomic<float> g_peak_dsp_load{0.0f};
static std::atomic<uint32_t> g_xrun_count{0};
static std::atomic<uint32_t> g_device_sample_rate{44100};
static std::atomic<uint32_t> g_device_buffer_frames{256};
static std::atomic<uint32_t> g_device_periods{2};
static std::atomic<bool> g_panic_requested{false};
static std::chrono::steady_clock::time_point g_last_callback_start;
static bool g_has_callback_time = false;
static char g_device_name[MA_MAX_DEVICE_NAME_LENGTH + 1] = "Default";
static char g_backend_name[64] = "unknown";

// Backing track ring buffer
static const int TRACK_RING_SIZE = 131072;
static float g_track_ring_l[TRACK_RING_SIZE];
static float g_track_ring_r[TRACK_RING_SIZE];
static std::atomic<int> g_track_write_idx{0};
static std::atomic<int> g_track_read_idx{0};

void enqueue_track_audio(const float* l_samples, const float* r_samples, int num_samples) {
    int w = g_track_write_idx.load(std::memory_order_relaxed);
    for (int i = 0; i < num_samples; i++) {
        g_track_ring_l[w] = l_samples[i];
        g_track_ring_r[w] = r_samples[i];
        w = (w + 1) % TRACK_RING_SIZE;
    }
    g_track_write_idx.store(w, std::memory_order_release);
}

// Master 4-Band EQ
struct BiquadBand {
    float b0 = 1.0f, b1 = 0.0f, b2 = 0.0f, a1 = 0.0f, a2 = 0.0f;
    float x1_l = 0.0f, x2_l = 0.0f, y1_l = 0.0f, y2_l = 0.0f;
    float x1_r = 0.0f, x2_r = 0.0f, y1_r = 0.0f, y2_r = 0.0f;

    void process(float inL, float inR, float& outL, float& outR) {
        float yL = b0 * inL + b1 * x1_l + b2 * x2_l - a1 * y1_l - a2 * y2_l;
        x2_l = x1_l; x1_l = inL; y2_l = y1_l; y1_l = yL;
        outL = yL;

        float yR = b0 * inR + b1 * x1_r + b2 * x2_r - a1 * y1_r - a2 * y2_r;
        x2_r = x1_r; x1_r = inR; y2_r = y1_r; y1_r = yR;
        outR = yR;
    }
};
static BiquadBand g_eq_bands[4];
static std::atomic<bool> g_eq_enabled{true};

void update_eq_band(int bandIdx, int eqType, float freq, float gainDb, float qVal) {
    if (bandIdx < 0 || bandIdx >= 4) return;
    float A = std::pow(10.0f, gainDb / 40.0f);
    float omega = 2.0f * 3.14159265f * freq / 44100.0f;
    float sn = std::sin(omega);
    float cs = std::cos(omega);
    float alpha = sn / (2.0f * (qVal > 0.05f ? qVal : 0.707f));

    float b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;
    if (eqType == 0) { // Peak
        b0 = 1.0f + alpha * A;
        b1 = -2.0f * cs;
        b2 = 1.0f - alpha * A;
        a0 = 1.0f + alpha / A;
        a1 = -2.0f * cs;
        a2 = 1.0f - alpha / A;
    } else if (eqType == 1) { // Low Shelf
        float beta = 2.0f * std::sqrt(A) * alpha;
        b0 = A * ((A + 1.0f) - (A - 1.0f) * cs + beta);
        b1 = 2.0f * A * ((A - 1.0f) - (A + 1.0f) * cs);
        b2 = A * ((A + 1.0f) - (A - 1.0f) * cs - beta);
        a0 = (A + 1.0f) + (A - 1.0f) * cs + beta;
        a1 = -2.0f * ((A - 1.0f) + (A + 1.0f) * cs);
        a2 = (A + 1.0f) - (A - 1.0f) * cs - beta;
    } else if (eqType == 2) { // High Shelf
        float beta = 2.0f * std::sqrt(A) * alpha;
        b0 = A * ((A + 1.0f) + (A - 1.0f) * cs + beta);
        b1 = -2.0f * A * ((A - 1.0f) + (A + 1.0f) * cs);
        b2 = A * ((A + 1.0f) - (A - 1.0f) * cs - beta);
        a0 = (A + 1.0f) - (A - 1.0f) * cs + beta;
        a1 = 2.0f * ((A - 1.0f) - (A + 1.0f) * cs);
        a2 = (A + 1.0f) - (A - 1.0f) * cs - beta;
    }
    g_eq_bands[bandIdx].b0 = b0 / a0;
    g_eq_bands[bandIdx].b1 = b1 / a0;
    g_eq_bands[bandIdx].b2 = b2 / a0;
    g_eq_bands[bandIdx].a1 = a1 / a0;
    g_eq_bands[bandIdx].a2 = a2 / a0;
}

#pragma pack(push, 1)
struct NativeEngineStatusPacket {
    uint32_t magic;
    float dspLoad;
    float peakDspLoad;
    uint32_t xruns;
    uint32_t sampleRate;
    uint32_t bufferFrames;
    uint32_t periods;
    float bufferLatencyMs;
    float outputLatencyMs;
    float totalLatencyMs;
    uint32_t analyzerEnabled;
    uint32_t warmthEnabled;
    float warmthDrive;
    uint32_t warmthMode;
    float warmthMeter;
    char backend[32];
    char device[96];
};
#pragma pack(pop)

// Audio callback buffers
static float g_part_buffer[512 * 2];
static float g_reverb_send_l[512];
static float g_reverb_send_r[512];
static float g_chorus_send_l[512];
static float g_chorus_send_r[512];

void audio_data_callback(ma_device* pDevice, void* pOutput, const void* pInput, ma_uint32 frameCount) {
    auto tStart = std::chrono::steady_clock::now();

    if (g_has_callback_time) {
        float expectedPeriodUs = (float)frameCount * 1000000.0f / (float)pDevice->sampleRate;
        float actualPeriodUs = (float)std::chrono::duration_cast<std::chrono::microseconds>(tStart - g_last_callback_start).count();
        if (actualPeriodUs > expectedPeriodUs * 2.2f) {
            g_xrun_count.fetch_add(1, std::memory_order_relaxed);
        }
    }
    g_last_callback_start = tStart;
    g_has_callback_time = true;

    if (g_panic_requested.exchange(false, std::memory_order_acquire)) {
        for (int p = 0; p < 8; p++) {
            if (g_part_synths[p]) tsf_note_off_all(g_part_synths[p]);
        }
    }

    float* out = (float*)pOutput;
    float sum_l[512] = {0};
    float sum_r[512] = {0};
    memset(g_reverb_send_l, 0, frameCount * sizeof(float));
    memset(g_reverb_send_r, 0, frameCount * sizeof(float));
    memset(g_chorus_send_l, 0, frameCount * sizeof(float));
    memset(g_chorus_send_r, 0, frameCount * sizeof(float));

    float masterVstVol = g_master_vst_volume.load(std::memory_order_relaxed);

    // Render each part through its dedicated SoundFont voice
    for (int p = 0; p < 8; p++) {
        if (!g_part_synths[p]) continue;
        if (g_part_mutes[p].load(std::memory_order_relaxed)) continue;

        float vol = g_part_volumes[p].load(std::memory_order_relaxed);
        if (vol <= 0.0001f) continue;

        float pan = g_part_pans[p].load(std::memory_order_relaxed);
        float panL = std::cos(pan * 1.5707963f);
        float panR = std::sin(pan * 1.5707963f);

        float revSend = g_part_reverbs[p].load(std::memory_order_relaxed);
        float choSend = g_part_chorus[p].load(std::memory_order_relaxed);

        {
            std::lock_guard<std::mutex> lock(g_synth_mutex);
            tsf_render_float(g_part_synths[p], g_part_buffer, (int)frameCount, 0);
        }

        for (ma_uint32 f = 0; f < frameCount; f++) {
            float l = g_part_buffer[f * 2 + 0] * vol * panL * masterVstVol;
            float r = g_part_buffer[f * 2 + 1] * vol * panR * masterVstVol;
            sum_l[f] += l;
            sum_r[f] += r;

            g_reverb_send_l[f] += l * revSend;
            g_reverb_send_r[f] += r * revSend;
            g_chorus_send_l[f] += l * choSend;
            g_chorus_send_r[f] += r * choSend;
        }
    }

    // Apply Stereo Chorus Send Bus
    float chorusOutL[512] = {0}, chorusOutR[512] = {0};
    g_chorus.process(g_chorus_send_l, g_chorus_send_r, chorusOutL, chorusOutR, frameCount, 1.2f, 3.5f, 0.65f);
    for (ma_uint32 f = 0; f < frameCount; f++) {
        sum_l[f] += chorusOutL[f];
        sum_r[f] += chorusOutR[f];
    }

    // Apply Studio Reverb Send Bus
    g_reverb.process(g_reverb_send_l, g_reverb_send_r, sum_l, sum_r, frameCount, 0.85f);

    // Synth Channel Peak Meter
    float synth_max = 0.0f;
    for (ma_uint32 i = 0; i < frameCount; i++) {
        float al = fabsf(sum_l[i]), ar = fabsf(sum_r[i]);
        if (al > synth_max) synth_max = al;
        if (ar > synth_max) synth_max = ar;
    }
    g_synth_peak_meter.store(synth_max, std::memory_order_relaxed);

    // Mix with Backing Track
    int r = g_track_read_idx.load(std::memory_order_relaxed);
    int w = g_track_write_idx.load(std::memory_order_acquire);
    int available = (w >= r) ? (w - r) : (TRACK_RING_SIZE - r + w);

    float track_peak = 0.0f;
    float mPeakL = 0.0f, mPeakR = 0.0f;
    float mGain = g_master_gain.load(std::memory_order_relaxed);

    for (ma_uint32 i = 0; i < frameCount; i++) {
        float track_l = 0.0f, track_r = 0.0f;
        if (available > 0) {
            track_l = g_track_ring_l[r];
            track_r = g_track_ring_r[r];
            r = (r + 1) % TRACK_RING_SIZE;
            available--;
        }
        float tl_abs = fabsf(track_l), tr_abs = fabsf(track_r);
        if (tl_abs > track_peak) track_peak = tl_abs;
        if (tr_abs > track_peak) track_peak = tr_abs;

        float final_l = sum_l[i] + track_l;
        float final_r = sum_r[i] + track_r;

        if (g_eq_enabled.load(std::memory_order_relaxed)) {
            for (int b = 0; b < 4; b++) {
                g_eq_bands[b].process(final_l, final_r, final_l, final_r);
            }
        }

        final_l *= mGain;
        final_r *= mGain;

        if (g_analyzer_enabled.load(std::memory_order_relaxed)) {
            g_master_spectrum.push((final_l + final_r) * 0.5f);
        }

        // Apply Master Stage Warmth
        g_stage_warmth.setEnabled(g_warmth_enabled.load(std::memory_order_relaxed));
        g_stage_warmth.setDrive(g_warmth_drive.load(std::memory_order_relaxed));
        g_stage_warmth.setMode(g_warmth_mode.load(std::memory_order_relaxed));
        g_stage_warmth.process(final_l, final_r);

        out[i * 2 + 0] = final_l;
        out[i * 2 + 1] = final_r;

        float fl_abs = fabsf(final_l), fr_abs = fabsf(final_r);
        if (fl_abs > mPeakL) mPeakL = fl_abs;
        if (fr_abs > mPeakR) mPeakR = fr_abs;
    }
    g_track_read_idx.store(r, std::memory_order_release);

    g_stage_warmth.endBlock();
    g_warmth_meter.store(g_stage_warmth.saturationMeter(), std::memory_order_relaxed);
    g_track_peak_meter.store(track_peak, std::memory_order_relaxed);
    g_master_peak_meter_l.store(mPeakL, std::memory_order_relaxed);
    g_master_peak_meter_r.store(mPeakR, std::memory_order_relaxed);

    auto tEnd = std::chrono::steady_clock::now();
    float procUs = (float)std::chrono::duration_cast<std::chrono::microseconds>(tEnd - tStart).count();
    float budgetUs = (float)frameCount * 1000000.0f / (float)pDevice->sampleRate;
    float load = procUs / budgetUs;
    g_dsp_load.store(load, std::memory_order_relaxed);
    if (load > g_peak_dsp_load.load(std::memory_order_relaxed)) {
        g_peak_dsp_load.store(load, std::memory_order_relaxed);
    }
}

static int g_part_bank_indices[8] = {10, 1, 1, 1, 1, 1, 2, 17};
static int g_part_preset_indices[8] = {0, 11, 1, 56, 52, 18, 88, 166};
static const char* g_session_state_file = "community_session_state.bin";

static void save_current_session_state() {
    CommunitySessionState s;
    s.magic = 0x5354494C;
    s.version = 1;
    s.masterGain = g_master_gain.load(std::memory_order_relaxed);
    s.masterVolume = g_master_vst_volume.load(std::memory_order_relaxed);
    for (int p = 0; p < 8; p++) {
        s.parts[p].bankIdx = g_part_bank_indices[p];
        s.parts[p].presetIdx = g_part_preset_indices[p];
        s.parts[p].volume = g_part_volumes[p].load(std::memory_order_relaxed);
        s.parts[p].pan = g_part_pans[p].load(std::memory_order_relaxed);
        s.parts[p].reverb = g_part_reverbs[p].load(std::memory_order_relaxed);
        s.parts[p].chorus = g_part_chorus[p].load(std::memory_order_relaxed);
        s.parts[p].mute = g_part_mutes[p].load(std::memory_order_relaxed) ? 1 : 0;
        s.parts[p].solo = 0;
    }
    save_community_session_state(g_session_state_file, s);
}

static float get_calibrated_preset_gain_db(int bank, int preset) {
    if (bank == 10) return +12.0f; // Nord Romantic Grand (was -16.7 dBFS raw)
    if (bank == 14) return 0.0f;   // Roland RD (already strong at -1.9 dBFS)
    if (bank == 6) {
        if (preset == 4) return +14.0f; // Chateau Soft Ambient Pad
        return 0.0f;                    // Chateau Grands
    }
    if (bank == 5) return +1.5f;   // Yamaha C5 Grand
    if (bank == 16) return +4.5f;  // Rhodes & EPs Plus
    if (bank == 1) {
        if (preset == 18) return +8.0f; // Dyno EP
        if (preset == 51 || preset == 52 || preset == 53) return +7.0f; // SuperWave Leads
        return +5.0f; // Atmosphere Washes & Strings
    }
    if (bank == 2) {
        if (preset == 89 || preset == 91 || preset == 92 || preset == 114) return +18.0f; // SC-88 Pads
        if (preset == 109 || preset == 81 || preset == 78) return +6.5f; // SC-88 Sine & Leads
        return +3.5f; // Fantasia bells & chimes
    }
    if (bank == 17) {
        if (preset == 166) return +7.5f; // Roland Zenology Pure Sine Lead (keeps lead volume high)
        if (preset == 149 || preset == 90 || preset == 62 || preset == 86 || preset == 132) return +6.0f; // Zenology Upbeat Synths
        return +4.5f;
    }
    return 0.0f;
}

// Route MIDI note on/off directly to parts
void trigger_note_on(int partIdx, int pitch, float vel) {
    if (partIdx >= 0 && partIdx < 8 && g_part_synths[partIdx]) {
        std::lock_guard<std::mutex> lock(g_synth_mutex);
        tsf_channel_note_on(g_part_synths[partIdx], 0, pitch, vel);
    }
}

void trigger_note_off(int partIdx, int pitch) {
    if (partIdx >= 0 && partIdx < 8 && g_part_synths[partIdx]) {
        std::lock_guard<std::mutex> lock(g_synth_mutex);
        tsf_channel_note_off(g_part_synths[partIdx], 0, pitch);
    }
}

static int g_part_sustain_state[8] = {0};

void set_part_sustain(int partIdx, int isSustainOn) {
    if (partIdx >= 0 && partIdx < 8 && g_part_synths[partIdx]) {
        std::lock_guard<std::mutex> lock(g_synth_mutex);
        if (g_part_sustain_state[partIdx] != isSustainOn) {
            g_part_sustain_state[partIdx] = isSustainOn;
            tsf_channel_set_sustain(g_part_synths[partIdx], 0, isSustainOn);
        }
    }
}

// Part 8 is reserved for the Continuous Ambient Drone Pad
// It is triggered exclusively via UDP and isolated from keyboard keys and keyboard sustain pedal
static std::atomic<bool> g_drone_isolation{true};

void CALLBACK MidiInProc(HMIDIIN hMidiIn, UINT wMsg, DWORD_PTR dwInstance, DWORD_PTR dwParam1, DWORD_PTR dwParam2) {
    if (wMsg == MIM_DATA) {
        unsigned char status = (unsigned char)(dwParam1 & 0xFF);
        unsigned char data1 = (unsigned char)((dwParam1 >> 8) & 0xFF);
        unsigned char data2 = (unsigned char)((dwParam1 >> 16) & 0xFF);
        unsigned char type = status & 0xF0;

        int maxKeyboardPart = g_drone_isolation.load(std::memory_order_relaxed) ? 7 : 8; // Parts 1-7 respond to hands; Part 8 is drone

        if (type == 0x90) {
            float vel = (float)data2 / 127.0f;
            if (data2 > 0) {
                // Trigger active/unmuted keyboard parts (isolated from Part 8 drone)
                for (int p = 0; p < maxKeyboardPart; p++) {
                    if (!g_part_mutes[p].load(std::memory_order_relaxed) && g_part_volumes[p].load(std::memory_order_relaxed) > 0.001f) {
                        trigger_note_on(p, data1, vel);
                    }
                }
            } else {
                for (int p = 0; p < maxKeyboardPart; p++) {
                    trigger_note_off(p, data1);
                }
            }
        } else if (type == 0x80) {
            for (int p = 0; p < maxKeyboardPart; p++) {
                trigger_note_off(p, data1);
            }
        } else if (type == 0xB0) {
            // Control Change (e.g. Sustain Pedal CC#64)
            if (data1 == 64) {
                int isSustain = (data2 >= 64) ? 1 : 0;
                for (int p = 0; p < maxKeyboardPart; p++) {
                    set_part_sustain(p, isSustain);
                }
            }
        }
    }
}

static tsf* bank_gu = nullptr;
static tsf* bank_sy22 = nullptr;
static tsf* bank_roland = nullptr;
static tsf* bank_yamaha_c5 = nullptr;
static tsf* bank_chateau = nullptr;
static tsf* bank_nord_grand = nullptr;
static tsf* bank_roland_rd = nullptr;
static tsf* bank_rhodes_plus = nullptr;
static tsf* bank_zenology = nullptr;

// UDP Server
static std::atomic<bool> g_udp_running{true};
static std::thread g_udp_thread;

void UdpControlServerThread() {
    WSADATA wsa;
    if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) return;
    SOCKET sock = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
    if (sock == INVALID_SOCKET) { WSACleanup(); return; }

    sockaddr_in server_addr;
    server_addr.sin_family = AF_INET;
    server_addr.sin_port = htons(9123);
    server_addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);

    if (bind(sock, (sockaddr*)&server_addr, sizeof(server_addr)) == SOCKET_ERROR) {
        closesocket(sock);
        WSACleanup();
        return;
    }

    std::cout << "[OK] UDP Control Server listening on port 9123" << std::endl;
    char buf[4096];

    while (g_udp_running.load(std::memory_order_relaxed)) {
        fd_set fds;
        FD_ZERO(&fds);
        FD_SET(sock, &fds);
        timeval tv = {0, 50000};
        int sel = select(0, &fds, NULL, NULL, &tv);
        if (sel > 0 && FD_ISSET(sock, &fds)) {
            sockaddr_in client_addr;
            int client_len = sizeof(client_addr);
            int len = recvfrom(sock, buf, sizeof(buf), 0, (sockaddr*)&client_addr, &client_len);
            if (len >= 4) {
                unsigned char cmd = (unsigned char)buf[0];

                if (cmd == 0x50) { // 'P': Peak query
                    float meterVals[4];
                    meterVals[0] = g_synth_peak_meter.load(std::memory_order_relaxed);
                    meterVals[1] = g_track_peak_meter.load(std::memory_order_relaxed);
                    meterVals[2] = g_master_peak_meter_l.load(std::memory_order_relaxed);
                    meterVals[3] = g_master_peak_meter_r.load(std::memory_order_relaxed);
                    sendto(sock, (const char*)meterVals, sizeof(meterVals), 0, (sockaddr*)&client_addr, client_len);
                    continue;
                } else if (cmd == 0x54) { // 'T': Status query
                    NativeEngineStatusPacket status = {};
                    status.magic = 0x5354574C;
                    status.dspLoad = g_dsp_load.load(std::memory_order_relaxed);
                    status.peakDspLoad = g_peak_dsp_load.load(std::memory_order_relaxed);
                    status.xruns = g_xrun_count.load(std::memory_order_relaxed);
                    status.sampleRate = g_device_sample_rate.load(std::memory_order_relaxed);
                    status.bufferFrames = g_device_buffer_frames.load(std::memory_order_relaxed);
                    status.periods = g_device_periods.load(std::memory_order_relaxed);
                    status.bufferLatencyMs = 1000.0f * status.bufferFrames / std::max(1u, status.sampleRate);
                    status.outputLatencyMs = status.bufferLatencyMs * std::max(1u, status.periods);
                    status.totalLatencyMs = status.bufferLatencyMs + status.outputLatencyMs;
                    status.analyzerEnabled = g_analyzer_enabled.load(std::memory_order_relaxed) ? 1u : 0u;
                    status.warmthEnabled = g_warmth_enabled.load(std::memory_order_relaxed) ? 1u : 0u;
                    status.warmthDrive = g_warmth_drive.load(std::memory_order_relaxed);
                    status.warmthMode = (uint32_t)g_warmth_mode.load(std::memory_order_relaxed);
                    status.warmthMeter = g_warmth_meter.load(std::memory_order_relaxed);
                    strncpy_s(status.backend, g_backend_name, _TRUNCATE);
                    strncpy_s(status.device, g_device_name, _TRUNCATE);
                    sendto(sock, (const char*)&status, sizeof(status), 0, (sockaddr*)&client_addr, client_len);
                    continue;
                } else if (cmd == 0x46) { // 'F': Spectrum
                    struct SpectrumPacket {
                        uint32_t magic;
                        uint32_t binCount;
                        float db[SpectrumCapture::OUTPUT_BINS];
                    } packet = {};
                    packet.magic = 0x54435053;
                    packet.binCount = SpectrumCapture::OUTPUT_BINS;
                    g_master_spectrum.computeLogBins(packet.db);
                    sendto(sock, (const char*)&packet, sizeof(packet), 0, (sockaddr*)&client_addr, client_len);
                    continue;
                } else if (cmd == 0x48) {
                    g_analyzer_enabled.store(buf[1] != 0, std::memory_order_relaxed);
                    continue;
                } else if (cmd == 0x77) {
                    if (len >= 8) {
                        g_warmth_enabled.store(buf[1] != 0, std::memory_order_relaxed);
                        g_warmth_mode.store((int)buf[2], std::memory_order_relaxed);
                        float d = 1.2f;
                        memcpy(&d, buf + 4, sizeof(float));
                        g_warmth_drive.store(std::max(1.0f, std::min(3.0f, d)), std::memory_order_relaxed);
                    }
                    continue;
                } else if (cmd == 0x21) {
                    g_panic_requested.store(true, std::memory_order_release);
                    continue;
                } else if (cmd == 0x41) {
                    uint16_t num_frames = ((uint16_t)(unsigned char)buf[2] << 8) | (uint16_t)(unsigned char)buf[3];
                    int expected_bytes = 4 + (num_frames * 2 * sizeof(float));
                    if (len >= expected_bytes && num_frames > 0 && num_frames <= 512) {
                        const float* interleaved = (const float*)(buf + 4);
                        float temp_l[512], temp_r[512];
                        for (int i = 0; i < num_frames; i++) {
                            temp_l[i] = interleaved[i * 2 + 0];
                            temp_r[i] = interleaved[i * 2 + 1];
                        }
                        enqueue_track_audio(temp_l, temp_r, num_frames);
                    }
                    float meterVals[4];
                    meterVals[0] = g_synth_peak_meter.load(std::memory_order_relaxed);
                    meterVals[1] = g_track_peak_meter.load(std::memory_order_relaxed);
                    meterVals[2] = g_master_peak_meter_l.load(std::memory_order_relaxed);
                    meterVals[3] = g_master_peak_meter_r.load(std::memory_order_relaxed);
                    sendto(sock, (const char*)meterVals, sizeof(meterVals), 0, (sockaddr*)&client_addr, client_len);
                    continue;
                }

                unsigned char ch = (unsigned char)buf[1];
                unsigned char d1 = (unsigned char)buf[2];
                unsigned char d2 = (unsigned char)buf[3];

                if (cmd == 0x56) { // 'V' Part Volume
                    int p = (int)ch - 1;
                    if (p >= 0 && p < 8) g_part_volumes[p].store((float)d1 / 127.0f, std::memory_order_relaxed);
                } else if (cmd == 0x52) { // 'R' Part Reverb
                    int p = (int)ch - 1;
                    if (p >= 0 && p < 8) g_part_reverbs[p].store((float)d1 / 127.0f, std::memory_order_relaxed);
                } else if (cmd == 0x55) { // 'U' Part Mute
                    int p = (int)ch - 1;
                    if (p >= 0 && p < 8) g_part_mutes[p].store(d1 != 0, std::memory_order_relaxed);
                } else if (cmd == 0x43) { // 'C' Part CC
                    int p = (int)ch - 1;
                    if (p >= 0 && p < 8) {
                        float normVal = (float)d2 / 127.0f;
                        if (d1 == 10) g_part_pans[p].store(normVal, std::memory_order_relaxed);
                        else if (d1 == 93) g_part_chorus[p].store(normVal, std::memory_order_relaxed);
                        
                        // Pass MIDI CC directly into the SoundFont voice channel (e.g. CC 74 Cutoff, CC 71 Reso, CC 73 Attack, CC 72 Release, CC 11 Expression)
                        if (g_part_synths[p]) {
                            tsf_channel_midi_control(g_part_synths[p], 0, (int)d1, (int)d2);
                        }
                    }
                } else if (cmd == 0x45) { // 'E' Master EQ
                    if (len >= 16) {
                        int bandIdx = (int)ch;
                        int eqType = (int)d1;
                        float freq = *(float*)(buf + 4);
                        float gain = *(float*)(buf + 8);
                        float qVal = *(float*)(buf + 12);
                        update_eq_band(bandIdx, eqType, freq, gain, qVal);
                    }
                } else if (cmd == 0x4D) { // 'M' Master Volume
                    g_master_vst_volume.store((float)d1 / 127.0f, std::memory_order_relaxed);
                } else if (cmd == 0x47) { // 'G' Hardware Gain
                    if (len >= 8) {
                        float gVal = *(float*)(buf + 4);
                        g_master_gain.store(gVal, std::memory_order_relaxed);
                    }
                } else if (cmd == 0x44) { // 'D': Drone Pad Isolation Toggle: [ 'D', isIsolated (0 or 1), 0, 0 ]
                    int iso = (int)ch;
                    g_drone_isolation.store(iso != 0, std::memory_order_relaxed);
                } else if (cmd == 0x4B) { // 'K': Assign Voice: [ 'K', partNum (1-8), bankIdx, presetIdx ]
 int p = (int)ch - 1;
 int bank = (int)d1;
 int preset = (int)d2;
 if (p >= 0 && p < 8) {
     tsf* targetBank = bank_gu;
     if (bank == 1) targetBank = bank_sy22;
     else if (bank == 2) targetBank = bank_roland;
     else if (bank == 5) targetBank = bank_yamaha_c5;
     else if (bank == 6) targetBank = bank_chateau;
     else if (bank == 10) targetBank = bank_nord_grand;
     else if (bank == 14) targetBank = bank_roland_rd;
     else if (bank == 16) targetBank = bank_rhodes_plus;
     else if (bank == 17) targetBank = bank_zenology;

 if (targetBank) {
     std::lock_guard<std::mutex> lock(g_synth_mutex);
     if (g_part_synths[p]) tsf_close(g_part_synths[p]);
     g_part_synths[p] = tsf_copy(targetBank);
     g_part_bank_indices[p] = bank;
     g_part_preset_indices[p] = preset;
     tsf_channel_set_presetindex(g_part_synths[p], 0, preset);
     float gainDb = get_calibrated_preset_gain_db(bank, preset);
     tsf_set_output(g_part_synths[p], TSF_STEREO_INTERLEAVED, 44100, gainDb);
     save_current_session_state();
 }
 }
 }
                else if (cmd == 0xB0) {
                    // Control Change from UDP (e.g. Sustain CC#64: [ 0xB0, channel, 64, val ])
                    if (d1 == 64) {
                        int isSustain = (d2 >= 64) ? 1 : 0;
                        for (int p = 0; p < 8; p++) {
                            set_part_sustain(p, isSustain);
                        }
                    }
                } else if (cmd == 0x90) { // Note On from Web/UDP
                    float vel = (float)d2 / 127.0f;
                    // Support both 0-indexed and 1-indexed part channels (Channel 7 or Part 8 -> index 7)
                    int p = (ch == 8) ? 7 : (int)ch;
                    if (p >= 0 && p < 8) {
                        if (vel > 0.0f) trigger_note_on(p, d1, vel);
                        else trigger_note_off(p, d1);
                    }
                } else if (cmd == 0x80) { // Note Off from Web/UDP
                    int p = (ch == 8) ? 7 : (int)ch;
                    if (p >= 0 && p < 8) {
                        trigger_note_off(p, d1);
                    }
                }
            }
        }
    }
    closesocket(sock);
    WSACleanup();
}

int main(int argc, char* argv[]) {
    std::cout << "==================================================" << std::endl;
    std::cout << "  LITWAVE STANDALONE 8-PART SOUNDFONT ENGINE" << std::endl;
    std::cout << "  Yamaha Heritage (1-6) + Roland Chimes & Lead (7-8)" << std::endl;
    std::cout << "==================================================" << std::endl;

    // Initialize Part default parameters
    for (int p = 0; p < 8; p++) {
        g_part_volumes[p].store(100.0f / 127.0f);
        g_part_pans[p].store(0.5f);
        // Default Part 1 (Main Piano) dry for tight funk/rhythm playing; parts 2-8 ambient
        g_part_reverbs[p].store(p == 0 ? 0.12f : 0.35f);
        g_part_chorus[p].store(0.0f);
        g_part_mutes[p].store(false);
    }

    std::cout << "[SoundFonts] Initializing high-definition sound banks..." << std::endl;

    // Load master banks
    bank_gu = tsf_load_filename("soundfonts/GeneralUser-GS.sf2");
    bank_sy22 = tsf_load_filename("soundfonts/Yamaha-SY22.sf2");
    bank_roland = tsf_load_filename("soundfonts/Roland_SC-88.sf2");
    bank_yamaha_c5 = tsf_load_filename("soundfonts/Yamaha_Grand_v2.1.sf2");
    bank_chateau = tsf_load_filename("soundfonts/Chateau_Grand_v2.2.sf2");
    bank_nord_grand = tsf_load_filename("soundfonts/Nord_Stage_Romantic_Grand.sf2");
    bank_roland_rd = tsf_load_filename("soundfonts/Roland_RD_PopGrand.sf2");
    bank_rhodes_plus = tsf_load_filename("soundfonts/Rhodes_EPs_Plus.sf2");
    bank_zenology = tsf_load_filename("soundfonts/Roland_Zenology_LiveHQ.sf2");

    if (!bank_gu || !bank_sy22 || !bank_roland) {
        std::cerr << "[ERROR] Could not load all SoundFont banks from /soundfonts" << std::endl;
        return 1;
    }

    // Check for saved Community session state (parity with Yamaha last_session_state.bin)
    CommunitySessionState savedState;
    bool hasSavedState = load_community_session_state(g_session_state_file, savedState);
    if (hasSavedState) {
        std::cout << "[OK] Restored saved Community Session State (" << g_session_state_file << ")" << std::endl;
        g_master_gain.store(savedState.masterGain, std::memory_order_relaxed);
        g_master_vst_volume.store(savedState.masterVolume, std::memory_order_relaxed);
        for (int p = 0; p < 8; p++) {
            g_part_bank_indices[p] = savedState.parts[p].bankIdx;
            g_part_preset_indices[p] = savedState.parts[p].presetIdx;
            g_part_volumes[p].store(savedState.parts[p].volume, std::memory_order_relaxed);
            g_part_pans[p].store(savedState.parts[p].pan, std::memory_order_relaxed);
            g_part_reverbs[p].store(savedState.parts[p].reverb, std::memory_order_relaxed);
            g_part_chorus[p].store(savedState.parts[p].chorus, std::memory_order_relaxed);
            g_part_mutes[p].store(savedState.parts[p].mute != 0, std::memory_order_relaxed);
        }
    }

    // Clone banks for independent polyphony per part
    for (int p = 0; p < 8; p++) {
        int b = g_part_bank_indices[p];
        int pr = g_part_preset_indices[p];
        tsf* targetBank = bank_gu;
        if (b == 1) targetBank = bank_sy22;
        else if (b == 2) targetBank = bank_roland;
        else if (b == 5) targetBank = bank_yamaha_c5;
        else if (b == 6) targetBank = bank_chateau;
        else if (b == 10) targetBank = bank_nord_grand;
        else if (b == 14) targetBank = bank_roland_rd;
        else if (b == 16) targetBank = bank_rhodes_plus;
        else if (b == 17) targetBank = bank_zenology;

        g_part_synths[p] = tsf_copy(targetBank ? targetBank : bank_gu);
        tsf_channel_set_presetindex(g_part_synths[p], 0, pr);
        float gainDb = get_calibrated_preset_gain_db(b, pr);
        tsf_set_output(g_part_synths[p], TSF_STEREO_INTERLEAVED, 44100, gainDb);
    }

    std::cout << "[OK] 8 Parts Assigned Successfully:" << std::endl;
    std::cout << "  Part 1: Yamaha Concert Grand (GeneralUser GS)" << std::endl;
    std::cout << "  Part 2: Yamaha Warm Pad (SY-22 DynaPad)" << std::endl;
    std::cout << "  Part 3: Yamaha DXLegend (SY-22 DX7 FM Tine)" << std::endl;
    std::cout << "  Part 4: Yamaha Atmosphere Wash (SY-22 SuperPad)" << std::endl;
    std::cout << "  Part 5: Yamaha Super Waves (SY-22 VCOLead)" << std::endl;
    std::cout << "  Part 6: Yamaha Chorus Dyno EP (SY-22 ElekRoad)" << std::endl;
    std::cout << "  Part 7: Roland Fantasia Bell (Roland SC-88 Preset 88)" << std::endl;
    std::cout << "  Part 8: Roland Pure Sine Lead (Roland SC-88 Preset 109)" << std::endl;

    // MiniAudio Playback Initialization
    ma_context context;
    ma_context_init(NULL, 0, NULL, &context);

    ma_device_info* pPlaybackInfos;
    ma_uint32 playbackCount;
    ma_context_get_devices(&context, &pPlaybackInfos, &playbackCount, NULL, NULL);

    ma_device_id* pTargetDeviceId = NULL;
    std::string chosenDeviceName = "Default";

    for (ma_uint32 i = 0; i < playbackCount; i++) {
        std::string dName = pPlaybackInfos[i].name;
        if (dName.find("HD USB") != std::string::npos || dName.find("USB Audio") != std::string::npos || dName.find("NUX") != std::string::npos) {
            pTargetDeviceId = &pPlaybackInfos[i].id;
            chosenDeviceName = dName;
            break;
        }
    }

    strncpy_s(g_device_name, chosenDeviceName.c_str(), _TRUNCATE);
    strncpy_s(g_backend_name, "wasapi", _TRUNCATE);

    ma_device_config config = ma_device_config_init(ma_device_type_playback);
    config.playback.pDeviceID = pTargetDeviceId;
    config.playback.format = ma_format_f32;
    config.playback.channels = 2;
    config.sampleRate = 44100;
    config.dataCallback = audio_data_callback;
    config.periodSizeInFrames = 256;

    ma_device device;
    if (ma_device_init(&context, &config, &device) != MA_SUCCESS) {
        std::cerr << "[ERROR] Failed to initialize soundcard audio output" << std::endl;
        return 1;
    }
    if (ma_device_start(&device) != MA_SUCCESS) {
        std::cerr << "[ERROR] Failed to start soundcard playback" << std::endl;
        return 1;
    }
    std::cout << "[OK] Audio routed to Soundcard: " << chosenDeviceName << " (44.1kHz / 256 frames)" << std::endl;

    // Connect MIDI Hardware
    HMIDIIN hMidiIn = NULL;
    UINT numDevs = midiInGetNumDevs();
    UINT targetMidi = 0;
    for (UINT i = 0; i < numDevs; i++) {
        MIDIINCAPSW caps;
        midiInGetDevCapsW(i, &caps, sizeof(caps));
        if (wcsstr(caps.szPname, L"CASIO") != NULL || wcsstr(caps.szPname, L"MIDI") != NULL) {
            targetMidi = i;
            break;
        }
    }
    if (numDevs > 0) {
        if (midiInOpen(&hMidiIn, targetMidi, (DWORD_PTR)MidiInProc, 0, CALLBACK_FUNCTION) == MMSYSERR_NOERROR) {
            midiInStart(hMidiIn);
            std::cout << "[OK] MIDI Hardware connected to synth pipeline!" << std::endl;
        }
    }

    // Start UDP Server thread
    g_udp_running.store(true);
    g_udp_thread = std::thread(UdpControlServerThread);

    std::cout << "[OK] Community 8-Part Engine ready and serving!" << std::endl;

    while (g_udp_running.load(std::memory_order_relaxed)) {
        std::this_thread::sleep_for(std::chrono::milliseconds(500));
    }

    save_current_session_state();

    if (g_udp_thread.joinable()) g_udp_thread.join();
    if (hMidiIn) { midiInStop(hMidiIn); midiInClose(hMidiIn); }
    ma_device_stop(&device);
    ma_device_uninit(&device);
    ma_context_uninit(&context);

    for (int p = 0; p < 8; p++) {
        if (g_part_synths[p]) tsf_close(g_part_synths[p]);
    }
    tsf_close(bank_gu);
    tsf_close(bank_sy22);
    tsf_close(bank_roland);
    if (bank_yamaha_c5) tsf_close(bank_yamaha_c5);
    if (bank_chateau) tsf_close(bank_chateau);
    if (bank_nord_grand) tsf_close(bank_nord_grand);
    if (bank_roland_rd) tsf_close(bank_roland_rd);
    if (bank_rhodes_plus) tsf_close(bank_rhodes_plus);
    if (bank_zenology) tsf_close(bank_zenology);

    return 0;
}
