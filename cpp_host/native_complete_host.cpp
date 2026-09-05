#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <winsock2.h>
#include <ws2tcpip.h>
#include <mmsystem.h>
#include <ole2.h>
#include <iostream>
#include <fstream>
#include <vector>
#include <atomic>
#include <thread>

#define MINIAUDIO_IMPLEMENTATION
#include "miniaudio.h"

#include "pluginterfaces/base/funknown.h"
#include "pluginterfaces/gui/iplugview.h"
#include "pluginterfaces/vst/ivstcomponent.h"
#include "pluginterfaces/vst/ivstaudioprocessor.h"
#include "pluginterfaces/vst/ivsteditcontroller.h"
#include "pluginterfaces/vst/ivstmessage.h"
#include "pluginterfaces/vst/ivstevents.h"
#include "pluginterfaces/vst/ivstparameterchanges.h"
#include "pluginterfaces/base/ibstream.h"

#pragma comment(lib, "ws2_32.lib")
#pragma comment(lib, "winmm.lib")
#pragma comment(lib, "user32.lib")
#pragma comment(lib, "ole32.lib")

namespace Steinberg {
    namespace Vst {
        DEF_CLASS_IID (IComponent)
        DEF_CLASS_IID (IAudioProcessor)
        DEF_CLASS_IID (IEditController)
        DEF_CLASS_IID (IConnectionPoint)
        DEF_CLASS_IID (IComponentHandler)
        DEF_CLASS_IID (IEventList)
        DEF_CLASS_IID (IParamValueQueue)
        DEF_CLASS_IID (IParameterChanges)
    }
}

using namespace Steinberg;
using namespace Steinberg::Vst;

struct MidiNoteEvent {
    int16 type;
    int16 channel;
    int16 pitch;
    float velocity;
    uint32 data_size;
    uint8 sysex_data[32];
};

static const int MAX_MIDI_EVENTS = 256;
static MidiNoteEvent g_midi_queue[MAX_MIDI_EVENTS];
static std::atomic<int> g_midi_head{0};
static std::atomic<int> g_midi_tail{0};

void enqueue_midi_note(int16 type, int16 channel, int16 pitch, float velocity) {
    int next = (g_midi_head.load(std::memory_order_relaxed) + 1) % MAX_MIDI_EVENTS;
    if (next != g_midi_tail.load(std::memory_order_acquire)) {
        int idx = g_midi_head.load(std::memory_order_relaxed);
        g_midi_queue[idx].type = type;
        g_midi_queue[idx].channel = channel;
        g_midi_queue[idx].pitch = pitch;
        g_midi_queue[idx].velocity = velocity;
        g_midi_queue[idx].data_size = 0;
        g_midi_head.store(next, std::memory_order_release);
    }
}

void enqueue_sysex(const uint8* data, uint32 size) {
    if (size > 32) return;
    int next = (g_midi_head.load(std::memory_order_relaxed) + 1) % MAX_MIDI_EVENTS;
    if (next != g_midi_tail.load(std::memory_order_acquire)) {
        int idx = g_midi_head.load(std::memory_order_relaxed);
        g_midi_queue[idx].type = Event::kDataEvent;
        g_midi_queue[idx].channel = 0;
        g_midi_queue[idx].pitch = 0;
        g_midi_queue[idx].velocity = 0.0f;
        g_midi_queue[idx].data_size = size;
        memcpy(g_midi_queue[idx].sysex_data, data, size);
        g_midi_head.store(next, std::memory_order_release);
    }
}

class EventList : public IEventList {
    std::vector<Event> events;
public:
    virtual int32 PLUGIN_API getEventCount() SMTG_OVERRIDE { return (int32)events.size(); }
    virtual tresult PLUGIN_API getEvent(int32 index, Event& e) SMTG_OVERRIDE {
        if (index >= 0 && index < (int32)events.size()) { e = events[index]; return kResultOk; }
        return kResultFalse;
    }
    virtual tresult PLUGIN_API addEvent(Event& e) SMTG_OVERRIDE { events.push_back(e); return kResultOk; }
    void clear() { events.clear(); }
    virtual tresult PLUGIN_API queryInterface(const TUID _iid, void** obj) SMTG_OVERRIDE {
        if (FUnknownPrivate::iidEqual(_iid, IEventList::iid) || FUnknownPrivate::iidEqual(_iid, FUnknown::iid)) {
            addRef(); *obj = this; return kResultOk;
        }
        *obj = nullptr; return kNoInterface;
    }
    virtual uint32 PLUGIN_API addRef() SMTG_OVERRIDE { return 1; }
    virtual uint32 PLUGIN_API release() SMTG_OVERRIDE { return 1; }
};

class ParamValueQueue : public IParamValueQueue {
    ParamID id;
    int32 sampleOffset = 0;
    ParamValue value = 0.0;
    bool hasPoint = false;
public:
    ParamValueQueue() : id(0) {}
    void init(ParamID _id, ParamValue _val) {
        id = _id;
        value = _val;
        sampleOffset = 0;
        hasPoint = true;
    }
    virtual ParamID PLUGIN_API getParameterId() SMTG_OVERRIDE { return id; }
    virtual int32 PLUGIN_API getPointCount() SMTG_OVERRIDE { return hasPoint ? 1 : 0; }
    virtual tresult PLUGIN_API getPoint(int32 index, int32& _sampleOffset, ParamValue& _value) SMTG_OVERRIDE {
        if (index == 0 && hasPoint) {
            _sampleOffset = sampleOffset;
            _value = value;
            return kResultOk;
        }
        return kResultFalse;
    }
    virtual tresult PLUGIN_API addPoint(int32 _sampleOffset, ParamValue _value, int32& index) SMTG_OVERRIDE {
        sampleOffset = _sampleOffset;
        value = _value;
        hasPoint = true;
        index = 0;
        return kResultOk;
    }
    virtual tresult PLUGIN_API queryInterface(const TUID _iid, void** obj) SMTG_OVERRIDE {
        if (FUnknownPrivate::iidEqual(_iid, IParamValueQueue::iid) || FUnknownPrivate::iidEqual(_iid, FUnknown::iid)) {
            addRef(); *obj = this; return kResultOk;
        }
        *obj = nullptr; return kNoInterface;
    }
    virtual uint32 PLUGIN_API addRef() SMTG_OVERRIDE { return 1; }
    virtual uint32 PLUGIN_API release() SMTG_OVERRIDE { return 1; }
};

class ParameterChanges : public IParameterChanges {
    std::vector<ParamValueQueue> queues;
public:
    virtual int32 PLUGIN_API getParameterCount() SMTG_OVERRIDE { return (int32)queues.size(); }
    virtual IParamValueQueue* PLUGIN_API getParameterData(int32 index) SMTG_OVERRIDE {
        if (index >= 0 && index < (int32)queues.size()) return &queues[index];
        return nullptr;
    }
    virtual IParamValueQueue* PLUGIN_API addParameterData(const ParamID& id, int32& index) SMTG_OVERRIDE {
        for (size_t i = 0; i < queues.size(); i++) {
            if (queues[i].getParameterId() == id) {
                index = (int32)i;
                return &queues[i];
            }
        }
        ParamValueQueue q;
        q.init(id, 0.0);
        queues.push_back(q);
        index = (int32)(queues.size() - 1);
        return &queues.back();
    }
    void addChange(ParamID id, ParamValue val) {
        int32 idx = 0;
        IParamValueQueue* q = addParameterData(id, idx);
        int32 ptIdx = 0;
        if (q) q->addPoint(0, val, ptIdx);
    }
    void clear() { queues.clear(); }
    virtual tresult PLUGIN_API queryInterface(const TUID _iid, void** obj) SMTG_OVERRIDE {
        if (FUnknownPrivate::iidEqual(_iid, IParameterChanges::iid) || FUnknownPrivate::iidEqual(_iid, FUnknown::iid)) {
            addRef(); *obj = this; return kResultOk;
        }
        *obj = nullptr; return kNoInterface;
    }
    virtual uint32 PLUGIN_API addRef() SMTG_OVERRIDE { return 1; }
    virtual uint32 PLUGIN_API release() SMTG_OVERRIDE { return 1; }
};

struct PendingParamChange {
    ParamID id;
    float value;
};
static const int MAX_PARAM_QUEUE = 64;
static PendingParamChange g_param_queue[MAX_PARAM_QUEUE];
static std::atomic<int> g_param_head{0};
static std::atomic<int> g_param_tail{0};

void enqueue_param_change(ParamID id, float value) {
    int next = (g_param_head.load(std::memory_order_relaxed) + 1) % MAX_PARAM_QUEUE;
    if (next != g_param_tail.load(std::memory_order_acquire)) {
        int idx = g_param_head.load(std::memory_order_relaxed);
        g_param_queue[idx].id = id;
        g_param_queue[idx].value = value;
        g_param_head.store(next, std::memory_order_release);
    }
}

static ParameterChanges g_paramChanges;
static IComponent* g_comp = nullptr;
static IAudioProcessor* g_processor = nullptr;
static IEditController* g_controller = nullptr;
static EventList g_eventList;

class DummyComponentHandler : public IComponentHandler {
public:
    virtual tresult PLUGIN_API beginEdit(ParamID tag) SMTG_OVERRIDE { return kResultOk; }
    virtual tresult PLUGIN_API performEdit(ParamID tag, ParamValue valueNormalized) SMTG_OVERRIDE { 
        std::cout << "[MONTAGE GUI EDIT] Tag: " << tag << " -> Val: " << valueNormalized << std::endl;
        return kResultOk; 
    }
    virtual tresult PLUGIN_API endEdit(ParamID tag) SMTG_OVERRIDE { return kResultOk; }
    virtual tresult PLUGIN_API restartComponent(int32 flags) SMTG_OVERRIDE { return kResultOk; }
    virtual tresult PLUGIN_API queryInterface(const TUID _iid, void** obj) SMTG_OVERRIDE {
        if (FUnknownPrivate::iidEqual(_iid, IComponentHandler::iid) || FUnknownPrivate::iidEqual(_iid, FUnknown::iid)) {
            addRef(); *obj = this; return kResultOk;
        }
        *obj = nullptr; return kNoInterface;
    }
    virtual uint32 PLUGIN_API addRef() SMTG_OVERRIDE { return 1; }
    virtual uint32 PLUGIN_API release() SMTG_OVERRIDE { return 1; }
};

class SimpleMemoryStream : public IBStream {
public:
    std::vector<char> buffer;
    int64 cursor = 0;
    virtual tresult PLUGIN_API read(void* buf, int32 numBytes, int32* numBytesRead) SMTG_OVERRIDE {
        int64 available = (int64)buffer.size() - cursor;
        int32 toRead = (int32)min((int64)numBytes, available);
        if (toRead > 0) { memcpy(buf, buffer.data() + cursor, toRead); cursor += toRead; }
        if (numBytesRead) *numBytesRead = toRead;
        return kResultOk;
    }
    virtual tresult PLUGIN_API write(void* buf, int32 numBytes, int32* numBytesWritten) SMTG_OVERRIDE {
        if (cursor + numBytes > (int64)buffer.size()) buffer.resize(cursor + numBytes);
        memcpy(buffer.data() + cursor, buf, numBytes);
        cursor += numBytes;
        if (numBytesWritten) *numBytesWritten = numBytes;
        return kResultOk;
    }
    virtual tresult PLUGIN_API seek(int64 pos, int32 mode, int64* result) SMTG_OVERRIDE {
        if (mode == kIBSeekSet) cursor = pos;
        else if (mode == kIBSeekCur) cursor += pos;
        else if (mode == kIBSeekEnd) cursor = buffer.size() + pos;
        if (result) *result = cursor;
        return kResultOk;
    }
    virtual tresult PLUGIN_API tell(int64* result) SMTG_OVERRIDE {
        if (result) *result = cursor;
        return kResultOk;
    }
    virtual tresult PLUGIN_API queryInterface(const TUID _iid, void** obj) SMTG_OVERRIDE {
        if (FUnknownPrivate::iidEqual(_iid, IBStream::iid) || FUnknownPrivate::iidEqual(_iid, FUnknown::iid)) {
            addRef(); *obj = this; return kResultOk;
        }
        *obj = nullptr; return kNoInterface;
    }
    virtual uint32 PLUGIN_API addRef() SMTG_OVERRIDE { return 1; }
    virtual uint32 PLUGIN_API release() SMTG_OVERRIDE { return 1; }
};

void CALLBACK MidiInProc(HMIDIIN hMidiIn, UINT wMsg, DWORD_PTR dwInstance, DWORD_PTR dwParam1, DWORD_PTR dwParam2) {
    if (wMsg == MIM_DATA) {
        unsigned char status = (unsigned char)(dwParam1 & 0xFF);
        unsigned char data1 = (unsigned char)((dwParam1 >> 8) & 0xFF);
        unsigned char data2 = (unsigned char)((dwParam1 >> 16) & 0xFF);
        unsigned char type = status & 0xF0;
        unsigned char channel = status & 0x0F;

        if (type == 0x90) {
            float vel = (float)data2 / 127.0f;
            if (data2 > 0) enqueue_midi_note(Event::kNoteOnEvent, channel, (int16)data1, vel);
            else enqueue_midi_note(Event::kNoteOffEvent, channel, (int16)data1, 0.0f);
        } else if (type == 0x80) {
            enqueue_midi_note(Event::kNoteOffEvent, channel, (int16)data1, 0.0f);
        } else if (type == 0xB0) {
            enqueue_midi_note((int16)Event::kLegacyMIDICCOutEvent, channel, data1, (float)data2 / 127.0f);
        }
    }
}

static float g_synth_out_l[1024];
static float g_synth_out_r[1024];
static std::atomic<float> g_synth_peak_meter{0.0f};
static std::atomic<float> g_track_peak_meter{0.0f};
static std::atomic<float> g_master_peak_meter_l{0.0f};
static std::atomic<float> g_master_peak_meter_r{0.0f};

// Lock-free Ring Buffer for Incoming Backing Track PCM Stream (from Python)
static const int TRACK_RING_SIZE = 131072; // ~1.5s at 44.1kHz stereo
static float g_track_ring_l[TRACK_RING_SIZE];
static float g_track_ring_r[TRACK_RING_SIZE];
static std::atomic<int> g_track_write_idx{0};
static std::atomic<int> g_track_read_idx{0};
static std::atomic<float> g_master_gain{1.0f};

void enqueue_track_audio(const float* l_samples, const float* r_samples, int num_samples) {
    int w = g_track_write_idx.load(std::memory_order_relaxed);
    for (int i = 0; i < num_samples; i++) {
        g_track_ring_l[w] = l_samples[i];
        g_track_ring_r[w] = r_samples[i];
        w = (w + 1) % TRACK_RING_SIZE;
    }
    g_track_write_idx.store(w, std::memory_order_release);
}

// --- Real-time 4-Band Master Parametric Equalizer (Biquad Filter Cascade) ---
struct BiquadFilter {
    float b0, b1, b2, a1, a2;
    float z1_l, z2_l;
    float z1_r, z2_r;

    BiquadFilter() : b0(1.0f), b1(0.0f), b2(0.0f), a1(0.0f), a2(0.0f),
                     z1_l(0.0f), z2_l(0.0f), z1_r(0.0f), z2_r(0.0f) {}

    void setCoeffs(float _b0, float _b1, float _b2, float _a1, float _a2) {
        b0 = _b0; b1 = _b1; b2 = _b2; a1 = _a1; a2 = _a2;
    }

    inline void process(float in_l, float in_r, float& out_l, float& out_r) {
        // Direct Form II Transposed
        out_l = in_l * b0 + z1_l;
        z1_l = in_l * b1 - out_l * a1 + z2_l;
        z2_l = in_l * b2 - out_l * a2;

        out_r = in_r * b0 + z1_r;
        z1_r = in_r * b1 - out_r * a1 + z2_r;
        z2_r = in_r * b2 - out_r * a2;
    }
};

static BiquadFilter g_eq_bands[4];
static std::atomic<bool> g_eq_enabled{true};

void update_eq_band(int band_idx, int type, float f0, float gain_db, float Q, float Fs = 44100.0f) {
    if (band_idx < 0 || band_idx >= 4) return;
    if (fabs(gain_db) < 0.05f) {
        g_eq_bands[band_idx].setCoeffs(1.0f, 0.0f, 0.0f, 0.0f, 0.0f);
        return;
    }

    float A = powf(10.0f, gain_db / 40.0f);
    float w0 = 2.0f * 3.14159265f * f0 / Fs;
    float cos_w0 = cosf(w0);
    float sin_w0 = sinf(w0);
    float alpha = sin_w0 / (2.0f * Q);

    float b0, b1, b2, a0, a1, a2;

    if (type == 0) { // Low Shelf
        float two_sqrtA_alpha = 2.0f * sqrtf(A) * alpha;
        b0 = A * ((A + 1.0f) - (A - 1.0f) * cos_w0 + two_sqrtA_alpha);
        b1 = 2.0f * A * ((A - 1.0f) - (A + 1.0f) * cos_w0);
        b2 = A * ((A + 1.0f) - (A - 1.0f) * cos_w0 - two_sqrtA_alpha);
        a0 = (A + 1.0f) + (A - 1.0f) * cos_w0 + two_sqrtA_alpha;
        a1 = -2.0f * ((A - 1.0f) + (A + 1.0f) * cos_w0);
        a2 = (A + 1.0f) + (A - 1.0f) * cos_w0 - two_sqrtA_alpha;
    } else if (type == 1) { // Peaking Bell
        b0 = 1.0f + alpha * A;
        b1 = -2.0f * cos_w0;
        b2 = 1.0f - alpha * A;
        a0 = 1.0f + alpha / A;
        a1 = -2.0f * cos_w0;
        a2 = 1.0f - alpha / A;
    } else { // High Shelf
        float two_sqrtA_alpha = 2.0f * sqrtf(A) * alpha;
        b0 = A * ((A + 1.0f) + (A - 1.0f) * cos_w0 + two_sqrtA_alpha);
        b1 = -2.0f * A * ((A - 1.0f) + (A + 1.0f) * cos_w0);
        b2 = A * ((A + 1.0f) + (A - 1.0f) * cos_w0 - two_sqrtA_alpha);
        a0 = (A + 1.0f) - (A - 1.0f) * cos_w0 + two_sqrtA_alpha;
        a1 = 2.0f * ((A - 1.0f) - (A + 1.0f) * cos_w0);
        a2 = (A + 1.0f) - (A - 1.0f) * cos_w0 - two_sqrtA_alpha;
    }

    g_eq_bands[band_idx].setCoeffs(b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0);
}

void audio_data_callback(ma_device* pDevice, void* pOutput, const void* pInput, ma_uint32 frameCount) {
    float* pOut = (float*)pOutput;
    memset(pOut, 0, frameCount * 2 * sizeof(float));
    if (!g_processor) return;

    g_eventList.clear();
    while (g_midi_tail.load(std::memory_order_relaxed) != g_midi_head.load(std::memory_order_acquire)) {
        int tail = g_midi_tail.load(std::memory_order_relaxed);
        MidiNoteEvent m = g_midi_queue[tail];
        g_midi_tail.store((tail + 1) % MAX_MIDI_EVENTS, std::memory_order_release);

        Event e;
        memset(&e, 0, sizeof(Event));
        e.busIndex = 0;
        e.sampleOffset = 0;
        e.type = m.type;

        if (m.type == Event::kNoteOnEvent) {
            e.noteOn.channel = m.channel;
            e.noteOn.pitch = m.pitch;
            e.noteOn.velocity = m.velocity;
            e.noteOn.noteId = -1;
        } else if (m.type == Event::kNoteOffEvent) {
            e.noteOff.channel = m.channel;
            e.noteOff.pitch = m.pitch;
            e.noteOff.velocity = 0.0f;
            e.noteOff.noteId = -1;
        } else if (m.type == (int16)Event::kLegacyMIDICCOutEvent) {
            e.type = Event::kLegacyMIDICCOutEvent;
            e.midiCCOut.channel = (uint8)m.channel;
            e.midiCCOut.controlNumber = (uint8)m.pitch;
            e.midiCCOut.value = (int8)(m.velocity * 127.0f);
            e.midiCCOut.value2 = 0;
        } else if (m.type == Event::kDataEvent) {
            e.type = Event::kDataEvent;
            e.data.type = DataEvent::kMidiSysEx;
            e.data.size = m.data_size;
            e.data.bytes = (const uint8*)m.sysex_data;
        }
        g_eventList.addEvent(e);
    }

    g_paramChanges.clear();
    while (g_param_tail.load(std::memory_order_relaxed) != g_param_head.load(std::memory_order_acquire)) {
        int tail = g_param_tail.load(std::memory_order_relaxed);
        PendingParamChange pc = g_param_queue[tail];
        g_param_tail.store((tail + 1) % MAX_PARAM_QUEUE, std::memory_order_release);
        g_paramChanges.addChange(pc.id, (ParamValue)pc.value);
    }

    ProcessData data;
    memset(&data, 0, sizeof(ProcessData));
    data.processMode = kRealtime;
    data.symbolicSampleSize = kSample32;
    data.numSamples = frameCount;
    data.inputEvents = &g_eventList;
    data.inputParameterChanges = &g_paramChanges;

    AudioBusBuffers outBus;
    float* channelBuffers[2] = { g_synth_out_l, g_synth_out_r };
    memset(g_synth_out_l, 0, frameCount * sizeof(float));
    memset(g_synth_out_r, 0, frameCount * sizeof(float));
    outBus.numChannels = 2;
    outBus.channelBuffers32 = channelBuffers;
    outBus.silenceFlags = 0;

    data.numOutputs = 1;
    data.outputs = &outBus;

    g_processor->process(data);

    // Compute real peak for VST Synth channel
    float synth_max = 0.0f;
    for (ma_uint32 i = 0; i < frameCount; i++) {
        float al = fabsf(g_synth_out_l[i]);
        float ar = fabsf(g_synth_out_r[i]);
        if (al > synth_max) synth_max = al;
        if (ar > synth_max) synth_max = ar;
    }
    g_synth_peak_meter.store(synth_max, std::memory_order_relaxed);

    // Mix VST output with incoming backing track PCM frames
    int r = g_track_read_idx.load(std::memory_order_relaxed);
    int w = g_track_write_idx.load(std::memory_order_acquire);
    int available = (w >= r) ? (w - r) : (TRACK_RING_SIZE - r + w);

    float track_peak_acc = 0.0f;
    float master_peak_l = 0.0f;
    float master_peak_r = 0.0f;

    for (ma_uint32 i = 0; i < frameCount; i++) {
        float track_l = 0.0f;
        float track_r = 0.0f;
        if (available > 0) {
            track_l = g_track_ring_l[r];
            track_r = g_track_ring_r[r];
            r = (r + 1) % TRACK_RING_SIZE;
            available--;
        }
        float tl_abs = fabsf(track_l);
        float tr_abs = fabsf(track_r);
        if (tl_abs > track_peak_acc) track_peak_acc = tl_abs;
        if (tr_abs > track_peak_acc) track_peak_acc = tr_abs;

        // Sum VST synth and backing track into unified stereo output
        float sum_l = g_synth_out_l[i] + track_l;
        float sum_r = g_synth_out_r[i] + track_r;

        // Apply Master 4-Band Parametric Equalizer across entire master mix (VST + Backing track)
        if (g_eq_enabled.load(std::memory_order_relaxed)) {
            for (int b = 0; b < 4; b++) {
                g_eq_bands[b].process(sum_l, sum_r, sum_l, sum_r);
            }
        }

        // Apply Master Gain across entire mix (VST + Backing track)
        float mGain = g_master_gain.load(std::memory_order_relaxed);
        sum_l *= mGain;
        sum_r *= mGain;

        float sl_abs = fabsf(sum_l);
        float sr_abs = fabsf(sum_r);
        if (sl_abs > master_peak_l) master_peak_l = sl_abs;
        if (sr_abs > master_peak_r) master_peak_r = sr_abs;

        pOut[i * 2 + 0] = sum_l;
        pOut[i * 2 + 1] = sum_r;
    }
    g_track_read_idx.store(r, std::memory_order_release);
    g_track_peak_meter.store(track_peak_acc, std::memory_order_relaxed);
    g_master_peak_meter_l.store(master_peak_l, std::memory_order_relaxed);
    g_master_peak_meter_r.store(master_peak_r, std::memory_order_relaxed);
}

#define WM_HOST_WINDOW_CMD (WM_USER + 101)

LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    if (msg == WM_HOST_WINDOW_CMD) {
        int action = (int)wParam;
        if (action == 0) {
            ShowWindow(hwnd, SW_HIDE);
        } else if (action == 1) {
            ShowWindow(hwnd, SW_SHOW);
            ShowWindow(hwnd, SW_RESTORE);
            SetForegroundWindow(hwnd);
        } else if (action == 2) {
            ShowWindow(hwnd, SW_MINIMIZE);
        } else if (action == 3) {
            // Kill / Exit process
            DestroyWindow(hwnd);
        }
        return 0;
    }
    if (msg == WM_DESTROY) { PostQuitMessage(0); return 0; }
    return DefWindowProc(hwnd, msg, wParam, lParam);
}

// Background UDP listener for Phone / Backend MIDI Control (e.g. Part Volume CC#7)
static std::atomic<bool> g_udp_running{true};
static std::thread g_udp_thread;

// Table of exact Parameter IDs for Parts 1 to 8 Volume, Reverb Send, and Mute in MONTAGE M
static const ParamID kPartVolumeParamIDs[8] = {
    568872064,  // Part 1 Volume
    1456375745, // Part 2 Volume
    196395778,  // Part 3 Volume
    1083899459, // Part 4 Volume
    1971403140, // Part 5 Volume
    711423173,  // Part 6 Volume
    1598926854, // Part 7 Volume
    338946887   // Part 8 Volume
};

static const ParamID kPartReverbParamIDs[8] = {
    568872068,  // Part 1 Reverb Send
    1456375749, // Part 2 Reverb Send
    196395782,  // Part 3 Reverb Send
    1083899463, // Part 4 Reverb Send
    1971403144, // Part 5 Reverb Send
    711423177,  // Part 6 Reverb Send
    1598926858, // Part 7 Reverb Send
    338946891   // Part 8 Reverb Send
};

static const ParamID kPartVariationParamIDs[8] = {
    568872070,  // Part 1 Variation Send (Chorus / Modulation)
    1456375751, // Part 2 Variation Send
    196395784,  // Part 3 Variation Send
    1083899465, // Part 4 Variation Send
    1971403146, // Part 5 Variation Send
    711423179,  // Part 6 Variation Send
    1598926860, // Part 7 Variation Send
    338946893   // Part 8 Variation Send
};

static const ParamID kPartPanParamIDs[8] = {
    568872066,  // Part 1 Pan
    1456375747, // Part 2 Pan
    196395780,  // Part 3 Pan
    1083899461, // Part 4 Pan
    1971403142, // Part 5 Pan
    711423175,  // Part 6 Pan
    1598926856, // Part 7 Pan
    338946889   // Part 8 Pan
};

static const ParamID kPartMuteParamIDs[8] = {
    568871075,  // Part 1 Mute Switch
    1456374756, // Part 2 Mute Switch
    196394789,  // Part 3 Mute Switch
    1083898470, // Part 4 Mute Switch
    1971402151, // Part 5 Mute Switch
    711422184,  // Part 6 Mute Switch
    1598925865, // Part 7 Mute Switch
    338945898   // Part 8 Mute Switch
};

static const ParamID kCommonPerformanceVolumeID = 2003600142; // C Performance Volume
static HWND g_hwnd = NULL;

void UdpControlServerThread() {
    WSADATA wsa;
    if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) return;

    SOCKET sock = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
    if (sock == INVALID_SOCKET) { WSACleanup(); return; }

    sockaddr_in server_addr;
    server_addr.sin_family = AF_INET;
    server_addr.sin_port = htons(9123);
    server_addr.sin_addr.s_addr = htonl(INADDR_ANY);

    if (bind(sock, (sockaddr*)&server_addr, sizeof(server_addr)) == SOCKET_ERROR) {
        closesocket(sock);
        WSACleanup();
        return;
    }

    std::cout << "[OK] UDP Control Server listening on port 9123 (for phone / backend CC & audio stream)" << std::endl;

    // Buffer for packet: control or audio frames [header: 4 bytes, data: N bytes]
    char buf[4096];
    while (g_udp_running.load(std::memory_order_relaxed)) {
        fd_set fds;
        FD_ZERO(&fds);
        FD_SET(sock, &fds);
        timeval tv = {0, 50000}; // 50ms check
        int sel = select(0, &fds, NULL, NULL, &tv);
        if (sel > 0 && FD_ISSET(sock, &fds)) {
            sockaddr_in client_addr;
            int client_len = sizeof(client_addr);
            int len = recvfrom(sock, buf, sizeof(buf), 0, (sockaddr*)&client_addr, &client_len);
            if (len >= 4) {
                unsigned char cmd = (unsigned char)buf[0];

                if (cmd == 0x41) { // 'A': Raw Audio Stream chunk: [ 'A', 0, frames_high, frames_low, float_stereo_interleaved_samples... ]
                    uint16_t num_frames = ((uint16_t)(unsigned char)buf[2] << 8) | (uint16_t)(unsigned char)buf[3];
                    int expected_bytes = 4 + (num_frames * 2 * sizeof(float));
                    if (len >= expected_bytes && num_frames > 0 && num_frames <= 512) {
                        const float* interleaved = (const float*)(buf + 4);
                        float temp_l[512];
                        float temp_r[512];
                        for (int i = 0; i < num_frames; i++) {
                            temp_l[i] = interleaved[i * 2 + 0];
                            temp_r[i] = interleaved[i * 2 + 1];
                        }
                        enqueue_track_audio(temp_l, temp_r, num_frames);
                    }
                    // Echo back real Synth, Track, and Master peak meters to Python
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

                if (cmd == 0xB0) { // Control Change
                    // If CC#7 (Channel Volume)
                    if (d1 == 7) {
                        float normVal = (float)d2 / 127.0f;
                        if (ch >= 0 && ch < 8 && g_controller) {
                            ParamID pid = kPartVolumeParamIDs[ch];
                            g_controller->setParamNormalized(pid, normVal);
                        }
                    }
                    enqueue_midi_note((int16)Event::kLegacyMIDICCOutEvent, ch, d1, (float)d2 / 127.0f);
                } else if (cmd == 0x56) { // 'V' Direct Part Volume Command: [ 'V', partNum (1-8), value (0-127) ]
                    int part = (int)ch;
                    int val = (int)d1;
                    if (part >= 1 && part <= 8) {
                        float normVal = (float)val / 127.0f;
                        ParamID pid = kPartVolumeParamIDs[part - 1];
                        if (g_controller) {
                            g_controller->setParamNormalized(pid, normVal);
                        }
                        enqueue_param_change(pid, normVal);
                    }
                } else if (cmd == 0x52) { // 'R' Direct Part Reverb Send Command: [ 'R', partNum (1-8), value (0-127) ]
                    int part = (int)ch;
                    int val = (int)d1;
                    if (part >= 1 && part <= 8) {
                        float normVal = (float)val / 127.0f;
                        ParamID pid = kPartReverbParamIDs[part - 1];
                        if (g_controller) {
                            g_controller->setParamNormalized(pid, normVal);
                        }
                        enqueue_param_change(pid, normVal);
                    }
                } else if (cmd == 0x55) { // 'U' Direct Part Mute Switch Command: [ 'U', partNum (1-8), isMuted (0 or 1) ]
                    int part = (int)ch;
                    int isMuted = (int)d1;
                    if (part >= 1 && part <= 8) {
                        float normVal = isMuted ? 1.0f : 0.0f;
                        ParamID pid = kPartMuteParamIDs[part - 1];
                        if (g_controller) {
                            g_controller->setParamNormalized(pid, normVal);
                        }
                        enqueue_param_change(pid, normVal);
                    }
                } else if (cmd == 0x43) { // 'C' Part MIDI CC Control: [ 'C', partNum (1-8), ccNum (0-127), value (0-127) ]
                    int part = (int)ch;
                    int ccNum = (int)d1;
                    int ccVal = (int)d2;
                    if (part >= 1 && part <= 8 && ccNum >= 0 && ccNum <= 127) {
                        uint8 channel = (uint8)(part - 1);
                        float normVal = (float)ccVal / 127.0f;
                        // Directly update VST3 Parameter if it's Pan (CC#10) or Chorus/Variation Send (CC#93)
                        if (ccNum == 10) {
                            ParamID pid = kPartPanParamIDs[part - 1];
                            if (g_controller) g_controller->setParamNormalized(pid, normVal);
                            enqueue_param_change(pid, normVal);
                        } else if (ccNum == 93) {
                            ParamID pid = kPartVariationParamIDs[part - 1];
                            if (g_controller) g_controller->setParamNormalized(pid, normVal);
                            enqueue_param_change(pid, normVal);
                        }
                        enqueue_midi_note((int16)Event::kLegacyMIDICCOutEvent, channel, (int16)ccNum, normVal);
                    }
                } else if (cmd == 0x45) { // 'E' Master Parametric Equalizer Band Update: [ 'E', bandIdx (0-3), type, pad, freq (float), gain (float), q (float) ]
                    if (len >= 16) {
                        int bandIdx = (int)ch;
                        int eqType = (int)d1;
                        float freq = *(float*)(buf + 4);
                        float gain = *(float*)(buf + 8);
                        float qVal = *(float*)(buf + 12);
                        update_eq_band(bandIdx, eqType, freq, gain, qVal);
                    }
                } else if (cmd == 0x4D) { // 'M' Master / Common Performance VST Volume Command: [ 'M', 0, value (0-127) ]
                    int val = (int)d1;
                    float normVal = (float)val / 127.0f;
                    if (g_controller) {
                        g_controller->setParamNormalized(kCommonPerformanceVolumeID, normVal);
                    }
                    enqueue_param_change(kCommonPerformanceVolumeID, normVal);
                } else if (cmd == 0x47) { // 'G' Master Hardware Output Gain (Combined VST + Backing Track): [ 'G', 0, 0, 0, gainFloat (float32) ]
                    if (len >= 8) {
                        float gVal = *(float*)(buf + 4);
                        g_master_gain.store(gVal, std::memory_order_relaxed);
                    }
                } else if (cmd == 0x57) { // 'W' Window Visibility Toggle: [ 'W', showCmd (0=Hide, 1=Show, 2=Minimize, 3=Kill), 0, 0 ]
                    int action = (int)ch;
                    if (g_hwnd) {
                        PostMessage(g_hwnd, WM_HOST_WINDOW_CMD, (WPARAM)action, 0);
                    }
                } else if (cmd == 0x53) { // 'S' Scene Select Command: [ 'S', sceneNumber (1-8), 0, 0 ]
                    int sceneNum = (int)ch; // 1 to 8
                    if (sceneNum >= 1 && sceneNum <= 8) {
                        // MIDI CC#92 (Scene Select): Scene 1 = 0..15 (use 0), Scene 2 = 16..31 (use 16), ..., Scene 8 = 112..127 (use 112)
                        uint8 ccVal = (uint8)((sceneNum - 1) * 16);
                        enqueue_midi_note((int16)Event::kLegacyMIDICCOutEvent, 0, 92, (float)ccVal / 127.0f);
                    }
                } else if (cmd == 0x90) { // Note On
                    float vel = (float)d2 / 127.0f;
                    enqueue_midi_note(Event::kNoteOnEvent, ch, (int16)d1, vel);
                } else if (cmd == 0x80) { // Note Off
                    enqueue_midi_note(Event::kNoteOffEvent, ch, (int16)d1, 0.0f);
                } else if (cmd == 0xF0) { // System Exclusive Packet
                    enqueue_sysex((const uint8*)buf, (uint32)len);
                }
            }
        }
    }

    closesocket(sock);
    WSACleanup();
}

int main() {
    OleInitialize(NULL);

    std::cout << "==================================================" << std::endl;
    std::cout << "  YAMAHA MONTAGE M - COMPLETE ENGINE & AUDIO CHAIN" << std::endl;
    std::cout << "==================================================" << std::endl;

    const wchar_t* path = L"C:\\Program Files\\Common Files\\VST3\\Yamaha\\Expanded Softsynth Plugin for MONTAGE M.vst3\\Contents\\x86_64-win\\Expanded Softsynth Plugin for MONTAGE M.vst3";
    HMODULE hMod = LoadLibraryW(path);
    if (!hMod) return 1;

    typedef bool (PLUGIN_API *InitDllFunc)();
    typedef IPluginFactory* (PLUGIN_API *GetPluginFactoryFunc)();
    InitDllFunc initDll = (InitDllFunc)GetProcAddress(hMod, "InitDll");
    if (initDll) initDll();
    GetPluginFactoryFunc getFactory = (GetPluginFactoryFunc)GetProcAddress(hMod, "GetPluginFactory");
    IPluginFactory* factory = getFactory();

    PClassInfo class0, class1;
    factory->getClassInfo(0, &class0);
    factory->getClassInfo(1, &class1);

    factory->createInstance(class0.cid, IComponent::iid, (void**)&g_comp);
    g_comp->queryInterface(IAudioProcessor::iid, (void**)&g_processor);
    factory->createInstance(class1.cid, IEditController::iid, (void**)&g_controller);

    g_comp->initialize(nullptr);
    g_controller->initialize(nullptr);

    DummyComponentHandler handler;
    g_controller->setComponentHandler(&handler);

    IConnectionPoint* cpComp = nullptr;
    IConnectionPoint* cpCtrl = nullptr;
    g_comp->queryInterface(IConnectionPoint::iid, (void**)&cpComp);
    g_controller->queryInterface(IConnectionPoint::iid, (void**)&cpCtrl);
    if (cpComp && cpCtrl) {
        cpComp->connect(cpCtrl);
        cpCtrl->connect(cpComp);
    }

    SimpleMemoryStream stream;
    // Check if there is a saved state from last practice session
    const char* stateFilePath = "last_session_state.bin";
    std::ifstream stateIn(stateFilePath, std::ios::binary);
    if (stateIn.is_open()) {
        stateIn.seekg(0, std::ios::end);
        size_t size = stateIn.tellg();
        stateIn.seekg(0, std::ios::beg);
        if (size > 0) {
            stream.buffer.resize(size);
            stateIn.read(stream.buffer.data(), size);
            stream.seek(0, IBStream::kIBSeekSet, nullptr);
            if (g_comp->setState(&stream) == kResultOk) {
                stream.seek(0, IBStream::kIBSeekSet, nullptr);
                g_controller->setComponentState(&stream);
                std::cout << "[OK] Restored last MONTAGE M sound preset state (" << size << " bytes)" << std::endl;
            }
        }
        stateIn.close();
    } else {
        if (g_comp->getState(&stream) == kResultOk) {
            stream.seek(0, IBStream::kIBSeekSet, nullptr);
            g_controller->setComponentState(&stream);
        }
    }

    // Explicitly activate Audio & MIDI buses
    g_comp->activateBus(kAudio, kOutput, 0, true);
    g_comp->activateBus(kEvent, kInput, 0, true);

    ProcessSetup setup;
    setup.processMode = kRealtime;
    setup.sampleRate = 44100.0;
    setup.maxSamplesPerBlock = 512;
    setup.symbolicSampleSize = kSample32;
    g_processor->setupProcessing(setup);

    g_comp->setActive(true);
    g_processor->setProcessing(true);
    std::cout << "[OK] Yamaha MONTAGE M Audio & DSP Engine Activated (44.1kHz/256)" << std::endl;

    // --- STEP 2: OPEN SOUNDCARD AUDIO OUTPUT (Target Soundcard specifically) ---
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

    ma_device_config config = ma_device_config_init(ma_device_type_playback);
    config.playback.pDeviceID = pTargetDeviceId;
    config.playback.format = ma_format_f32;
    config.playback.channels = 2;
    config.sampleRate = 44100;
    config.dataCallback = audio_data_callback;
    config.periodSizeInFrames = 256;

    ma_device device;
    if (ma_device_init(&context, &config, &device) != MA_SUCCESS) {
        std::cout << "[ERROR] Failed to initialize soundcard audio output" << std::endl;
        return 1;
    }
    ma_device_start(&device);
    std::cout << "[OK] Audio routed directly to Soundcard: " << chosenDeviceName << std::endl;

    // --- STEP 3: CONNECT HARDWARE MIDI INPUT ---
    HMIDIIN hMidiIn = NULL;
    UINT numDevs = midiInGetNumDevs();
    UINT targetMidi = 0;
    for (UINT i = 0; i < numDevs; i++) {
        MIDIINCAPSW caps;
        midiInGetDevCapsW(i, &caps, sizeof(caps));
        if (wcsstr(caps.szPname, L"CASIO") != NULL || wcsstr(caps.szPname, L"MIDI") != NULL) {
            targetMidi = i;
        }
    }

    if (numDevs > 0) {
        MMRESULT midiRes = midiInOpen(&hMidiIn, targetMidi, (DWORD_PTR)MidiInProc, 0, CALLBACK_FUNCTION);
        if (midiRes == MMSYSERR_NOERROR) {
            midiInStart(hMidiIn);
            std::cout << "[OK] MIDI Hardware (CASIO USB-MIDI) connected to synth pipeline!" << std::endl;
        }
    }

    // --- STEP 4: CREATE & ATTACH NATIVE GUI ---
    IPlugView* view = g_controller->createView(ViewType::kEditor);
    ViewRect vr = {0, 0, 1440, 870};
    if (view) view->getSize(&vr);
    int width = vr.right - vr.left;
    int height = vr.bottom - vr.top;
    if (width <= 0) width = 1440;
    if (height <= 0) height = 870;

    WNDCLASSW wc = {0};
    wc.lpfnWndProc = WndProc;
    wc.hInstance = GetModuleHandle(NULL);
    wc.lpszClassName = L"YamahaMontageMLiveHost";
    wc.hCursor = LoadCursor(NULL, IDC_ARROW);
    RegisterClassW(&wc);

    HWND hwnd = CreateWindowExW(
        0,
        L"YamahaMontageMLiveHost",
        L"YAMAHA MONTAGE M (Native VST3 Studio Host)",
        WS_OVERLAPPEDWINDOW | WS_VISIBLE,
        CW_USEDEFAULT, CW_USEDEFAULT,
        width + 16, height + 39,
        NULL, NULL, GetModuleHandle(NULL), NULL
    );
    g_hwnd = hwnd;

    if (view) view->attached((void*)hwnd, kPlatformTypeHWND);
    std::cout << "[OK] Native GUI attached and displayed." << std::endl;

    // Start UDP server thread
    g_udp_running.store(true);
    g_udp_thread = std::thread(UdpControlServerThread);

    MSG msg;
    while (GetMessage(&msg, NULL, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }

    g_udp_running.store(false);
    if (g_udp_thread.joinable()) {
        g_udp_thread.join();
    }

    if (hMidiIn) {
        midiInStop(hMidiIn);
        midiInClose(hMidiIn);
    }
    ma_device_stop(&device);
    ma_device_uninit(&device);
    ma_context_uninit(&context);
    if (view) { view->removed(); view->release(); }
    // Save complete sound preset state before shutdown
    SimpleMemoryStream saveStream;
    if (g_comp->getState(&saveStream) == kResultOk && saveStream.buffer.size() > 0) {
        std::ofstream stateOut(stateFilePath, std::ios::binary);
        if (stateOut.is_open()) {
            stateOut.write(saveStream.buffer.data(), saveStream.buffer.size());
            stateOut.close();
            std::cout << "[OK] Auto-saved sound preset state (" << saveStream.buffer.size() << " bytes) for next launch" << std::endl;
        }
    }

    g_processor->setProcessing(false);
    g_comp->setActive(false);
    g_controller->terminate();
    g_comp->terminate();
    return 0;
}
