#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <winsock2.h>
#include <ws2tcpip.h>
#include <mmsystem.h>
#include <ole2.h>
#include <iostream>
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

static const int MAX_MIDI_EVENTS = 512;
static MidiNoteEvent g_midi_queue[MAX_MIDI_EVENTS];
static std::atomic<int> g_midi_head{0};
static std::atomic<int> g_midi_tail{0};
static std::atomic<int> g_transpose_semitones{0};

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
    std::vector<char> buffer;
    int64 cursor = 0;
public:
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

        int trans = g_transpose_semitones.load(std::memory_order_relaxed);
        int transposed_pitch = max(0, min(127, (int)data1 + trans));

        if (type == 0x90) {
            float vel = (float)data2 / 127.0f;
            if (data2 > 0) enqueue_midi_note(Event::kNoteOnEvent, channel, (int16)transposed_pitch, vel);
            else enqueue_midi_note(Event::kNoteOffEvent, channel, (int16)transposed_pitch, 0.0f);
        } else if (type == 0x80) {
            enqueue_midi_note(Event::kNoteOffEvent, channel, (int16)transposed_pitch, 0.0f);
        } else if (type == 0xB0) {
            enqueue_midi_note((int16)Event::kLegacyMIDICCOutEvent, channel, data1, (float)data2 / 127.0f);
        }
    }
}

static float g_synth_out_l[1024];
static float g_synth_out_r[1024];

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

    for (ma_uint32 i = 0; i < frameCount; i++) {
        pOut[i * 2 + 0] = g_synth_out_l[i];
        pOut[i * 2 + 1] = g_synth_out_r[i];
    }
}

LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    if (msg == WM_DESTROY) { PostQuitMessage(0); return 0; }
    return DefWindowProc(hwnd, msg, wParam, lParam);
}

// Background UDP listener for Phone / Backend MIDI Control (e.g. Part Volume CC#7)
static std::atomic<bool> g_udp_running{true};
static std::thread g_udp_thread;

// Table of exact Parameter IDs for Parts 1 to 8 Volume in MONTAGE M
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
static const ParamID kCommonPerformanceVolumeID = 2003600142; // C Performance Volume

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

    std::cout << "[OK] UDP Control Server listening on port 9123 (for phone / backend CC control)" << std::endl;

    // Buffer for packet: [cmd: 1 byte, channel: 1 byte, param: 1 byte, value: 1 byte]
    char buf[64];
    while (g_udp_running.load(std::memory_order_relaxed)) {
        fd_set fds;
        FD_ZERO(&fds);
        FD_SET(sock, &fds);
        timeval tv = {0, 100000}; // 100ms timeout check
        int sel = select(0, &fds, NULL, NULL, &tv);
        if (sel > 0 && FD_ISSET(sock, &fds)) {
            sockaddr_in client_addr;
            int client_len = sizeof(client_addr);
            int len = recvfrom(sock, buf, sizeof(buf) - 1, 0, (sockaddr*)&client_addr, &client_len);
            if (len >= 3) {
                unsigned char cmd = (unsigned char)buf[0];
                unsigned char ch = (unsigned char)buf[1];
                unsigned char d1 = (unsigned char)buf[2];
                unsigned char d2 = (len >= 4) ? (unsigned char)buf[3] : 0;

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
                        // 1. Update GUI EditController
                        if (g_controller) {
                            g_controller->setParamNormalized(pid, normVal);
                        }
                        // 2. Queue into DSP ProcessData inputParameterChanges for real-time audio computation
                        enqueue_param_change(pid, normVal);
                    }
                } else if (cmd == 0x4D) { // 'M' Master / Common Performance VST Volume Command: [ 'M', 0, value (0-127) ]
                    int val = (int)d1;
                    float normVal = (float)val / 127.0f;
                    if (g_controller) {
                        g_controller->setParamNormalized(kCommonPerformanceVolumeID, normVal);
                    }
                    enqueue_param_change(kCommonPerformanceVolumeID, normVal);
                } else if (cmd == 0x90) { // Note On
                    float vel = (float)d2 / 127.0f;
                    enqueue_midi_note(Event::kNoteOnEvent, ch, (int16)d1, vel);
                } else if (cmd == 0x80) { // Note Off
                    enqueue_midi_note(Event::kNoteOffEvent, ch, (int16)d1, 0.0f);
                } else if (cmd == 0xF0) { // System Exclusive Packet
                    enqueue_sysex((const uint8*)buf, (uint32)len);
                } else if (cmd == 0x54) { // 'T': Transpose command: [ 'T', semitones (signed char) ]
                    int8_t semi = (int8_t)buf[1];
                    g_transpose_semitones.store((int)semi);
                }
            }
        }
    }

    closesocket(sock);
    WSACleanup();
}

int main(int argc, char* argv[]) {
    OleInitialize(NULL);

    if (argc > 1) {
        g_transpose_semitones.store(atoi(argv[1]));
    }
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
    if (g_comp->getState(&stream) == kResultOk) {
        stream.seek(0, IBStream::kIBSeekSet, nullptr);
        g_controller->setComponentState(&stream);
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
    g_processor->setProcessing(false);
    g_comp->setActive(false);
    g_controller->terminate();
    g_comp->terminate();
    return 0;
}
