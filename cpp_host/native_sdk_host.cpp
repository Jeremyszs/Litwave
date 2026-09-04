#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <ole2.h>
#include <iostream>
#include <vector>

#include "pluginterfaces/base/funknown.h"
#include "pluginterfaces/gui/iplugview.h"
#include "pluginterfaces/vst/ivstcomponent.h"
#include "pluginterfaces/vst/ivstaudioprocessor.h"
#include "pluginterfaces/vst/ivsteditcontroller.h"
#include "pluginterfaces/vst/ivstmessage.h"
#include "pluginterfaces/base/ibstream.h"

namespace Steinberg {
    namespace Vst {
        DEF_CLASS_IID (IComponent)
        DEF_CLASS_IID (IEditController)
        DEF_CLASS_IID (IConnectionPoint)
        DEF_CLASS_IID (IComponentHandler)
    }
}

using namespace Steinberg;
using namespace Steinberg::Vst;

// Dummy Component Handler
class DummyComponentHandler : public IComponentHandler {
public:
    virtual tresult PLUGIN_API beginEdit(ParamID tag) SMTG_OVERRIDE { return kResultOk; }
    virtual tresult PLUGIN_API performEdit(ParamID tag, ParamValue valueNormalized) SMTG_OVERRIDE { return kResultOk; }
    virtual tresult PLUGIN_API endEdit(ParamID tag) SMTG_OVERRIDE { return kResultOk; }
    virtual tresult PLUGIN_API restartComponent(int32 flags) SMTG_OVERRIDE { return kResultOk; }

    virtual tresult PLUGIN_API queryInterface(const TUID _iid, void** obj) SMTG_OVERRIDE {
        if (FUnknownPrivate::iidEqual(_iid, IComponentHandler::iid) || FUnknownPrivate::iidEqual(_iid, FUnknown::iid)) {
            addRef();
            *obj = this;
            return kResultOk;
        }
        *obj = nullptr;
        return kNoInterface;
    }
    virtual uint32 PLUGIN_API addRef() SMTG_OVERRIDE { return 1; }
    virtual uint32 PLUGIN_API release() SMTG_OVERRIDE { return 1; }
};

// Memory Stream for getState/setState synchronization
class SimpleMemoryStream : public IBStream {
    std::vector<char> buffer;
    int64 cursor = 0;
public:
    virtual tresult PLUGIN_API read(void* buf, int32 numBytes, int32* numBytesRead) SMTG_OVERRIDE {
        int64 available = (int64)buffer.size() - cursor;
        int32 toRead = (int32)min((int64)numBytes, available);
        if (toRead > 0) {
            memcpy(buf, buffer.data() + cursor, toRead);
            cursor += toRead;
        }
        if (numBytesRead) *numBytesRead = toRead;
        return kResultOk;
    }
    virtual tresult PLUGIN_API write(void* buf, int32 numBytes, int32* numBytesWritten) SMTG_OVERRIDE {
        if (cursor + numBytes > (int64)buffer.size()) {
            buffer.resize(cursor + numBytes);
        }
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
            addRef();
            *obj = this;
            return kResultOk;
        }
        *obj = nullptr;
        return kNoInterface;
    }
    virtual uint32 PLUGIN_API addRef() SMTG_OVERRIDE { return 1; }
    virtual uint32 PLUGIN_API release() SMTG_OVERRIDE { return 1; }
};

LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    if (msg == WM_DESTROY) {
        PostQuitMessage(0);
        return 0;
    }
    return DefWindowProc(hwnd, msg, wParam, lParam);
}

int main() {
    OleInitialize(NULL);
    std::cout << "Starting Full VST3 Connection Sequence for MONTAGE M..." << std::endl;

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

    IComponent* comp = nullptr;
    factory->createInstance(class0.cid, IComponent::iid, (void**)&comp);

    IEditController* controller = nullptr;
    factory->createInstance(class1.cid, IEditController::iid, (void**)&controller);

    comp->initialize(nullptr);
    controller->initialize(nullptr);

    // 1. Connect Host Handler
    DummyComponentHandler handler;
    controller->setComponentHandler(&handler);

    // 2. Connect Connection Points
    IConnectionPoint* cpComp = nullptr;
    IConnectionPoint* cpCtrl = nullptr;
    comp->queryInterface(IConnectionPoint::iid, (void**)&cpComp);
    controller->queryInterface(IConnectionPoint::iid, (void**)&cpCtrl);

    if (cpComp && cpCtrl) {
        cpComp->connect(cpCtrl);
        cpCtrl->connect(cpComp);
        std::cout << "Connected IConnectionPoint between Component & Controller!" << std::endl;
    }

    // 3. Synchronize State
    SimpleMemoryStream stream;
    if (comp->getState(&stream) == kResultOk) {
        stream.seek(0, IBStream::kIBSeekSet, nullptr);
        controller->setComponentState(&stream);
        std::cout << "Synchronized component state to controller!" << std::endl;
    }

    // 4. Create View
    IPlugView* view = controller->createView(ViewType::kEditor);
    std::cout << "createView result after full connection: " << view << std::endl;

    if (!view) {
        std::cout << "createView still null" << std::endl;
        return 1;
    }

    ViewRect vr = {0, 0, 1200, 800};
    view->getSize(&vr);
    int width = vr.right - vr.left;
    int height = vr.bottom - vr.top;
    if (width <= 0) width = 1200;
    if (height <= 0) height = 800;

    std::cout << "MONTAGE M Native Window Dimensions: " << width << "x" << height << std::endl;

    WNDCLASSW wc = {0};
    wc.lpfnWndProc = WndProc;
    wc.hInstance = GetModuleHandle(NULL);
    wc.lpszClassName = L"YamahaMontageMNativeHost";
    wc.hCursor = LoadCursor(NULL, IDC_ARROW);
    RegisterClassW(&wc);

    HWND hwnd = CreateWindowExW(
        0,
        L"YamahaMontageMNativeHost",
        L"Yamaha MONTAGE M - Sound Editor",
        WS_OVERLAPPEDWINDOW | WS_VISIBLE,
        CW_USEDEFAULT, CW_USEDEFAULT,
        width + 16, height + 39,
        NULL, NULL, GetModuleHandle(NULL), NULL
    );

    tresult attachRes = view->attached((void*)hwnd, kPlatformTypeHWND);
    std::cout << "view->attached(HWND) result: " << attachRes << std::endl;

    MSG msg;
    while (GetMessage(&msg, NULL, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }

    return 0;
}
