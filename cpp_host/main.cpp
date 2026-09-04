#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <ole2.h>
#include <iostream>
#include <cstring>

// VST3 GUIDs
static const unsigned char IComponent_IID[16] = {
    0x88, 0x82, 0x7E, 0xE7, 0x01, 0x93, 0x48, 0x7A,
    0xA3, 0x2A, 0x77, 0x5C, 0x0E, 0xB7, 0x36, 0x29
};

static const unsigned char IEditController_IID[16] = {
    0xDC, 0x48, 0x4B, 0xD4, 0x4E, 0x88, 0x47, 0x4F,
    0xBB, 0x62, 0x84, 0x51, 0x97, 0x69, 0x0F, 0xDE
};

static const unsigned char IPlugView_IID[16] = {
    0x56, 0x1A, 0x53, 0x69, 0x73, 0x63, 0x46, 0x99,
    0x8F, 0x73, 0x35, 0x3B, 0x42, 0xB2, 0x82, 0xB7
};

struct ViewRect {
    int left;
    int top;
    int right;
    int bottom;
};

class IPlugView {
public:
    virtual int queryInterface(const void* iid, void** obj) = 0;
    virtual unsigned long addRef() = 0;
    virtual unsigned long release() = 0;
    virtual int isPlatformTypeSupported(const char* type) = 0;
    virtual int attached(void* parent, const char* type) = 0;
    virtual int removed() = 0;
    virtual int onWheel(float distance) = 0;
    virtual int onKeyDown(short key, short keyCode, short modifiers) = 0;
    virtual int onKeyUp(short key, short keyCode, short modifiers) = 0;
    virtual int getSize(ViewRect* size) = 0;
    virtual int onSize(ViewRect* newSize) = 0;
    virtual int onFocus(unsigned char state) = 0;
    virtual int setFrame(void* frame) = 0;
    virtual int canResize() = 0;
    virtual int checkSizeConstraint(ViewRect* rect) = 0;
};

class IPluginBase {
public:
    virtual int queryInterface(const void* iid, void** obj) = 0;
    virtual unsigned long addRef() = 0;
    virtual unsigned long release() = 0;
    virtual int initialize(void* context) = 0;
    virtual int terminate() = 0;
};

class IEditController : public IPluginBase {
public:
    virtual int setComponentState(void* state) = 0;
    virtual int setState(void* state) = 0;
    virtual int getState(void* state) = 0;
    virtual int getParameterCount() = 0;
    virtual int getParameterInfo(int paramIndex, void* info) = 0;
    virtual int getParamStringByValue(unsigned int id, double valueNormalized, void* string) = 0;
    virtual int getParamValueByString(unsigned int id, const void* string, double* valueNormalized) = 0;
    virtual double normalizedParamToPlain(unsigned int id, double valueNormalized) = 0;
    virtual double plainParamToNormalized(unsigned int id, double plainValue) = 0;
    virtual double getParamNormalized(unsigned int id) = 0;
    virtual int setParamNormalized(unsigned int id, double value) = 0;
    virtual int setComponentHandler(void* handler) = 0;
    virtual IPlugView* createView(const char* name) = 0;
};

struct PClassInfo {
    char cid[16];
    int cardinality;
    char category[32];
    char name[64];
};

class IPluginFactory {
public:
    virtual int queryInterface(const void* iid, void** obj) = 0;
    virtual unsigned long addRef() = 0;
    virtual unsigned long release() = 0;
    virtual int getFactoryInfo(void* info) = 0;
    virtual int countClasses() = 0;
    virtual int getClassInfo(int index, PClassInfo* info) = 0;
    virtual int createInstance(const char* cid, const char* _iid, void** obj) = 0;
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
    std::cout << "Creating native Win32 Host Window for Yamaha MONTAGE M..." << std::endl;

    const wchar_t* path = L"C:\\Program Files\\Common Files\\VST3\\Yamaha\\Expanded Softsynth Plugin for MONTAGE M.vst3\\Contents\\x86_64-win\\Expanded Softsynth Plugin for MONTAGE M.vst3";
    HMODULE hMod = LoadLibraryW(path);
    if (!hMod) {
        std::cout << "Failed to load DLL" << std::endl;
        return 1;
    }

    typedef bool (*InitDllFunc)();
    typedef IPluginFactory* (*GetPluginFactoryFunc)();

    InitDllFunc initDll = (InitDllFunc)GetProcAddress(hMod, "InitDll");
    if (initDll) initDll();

    GetPluginFactoryFunc getFactory = (GetPluginFactoryFunc)GetProcAddress(hMod, "GetPluginFactory");
    IPluginFactory* factory = getFactory();

    // 01efcdab8291ebfa596d617565534d6d
    // In VST3 SDK: TUID is typedef char TUID[16];
    PClassInfo class0;
    memset(&class0, 0, sizeof(class0));
    factory->getClassInfo(0, &class0);

    PClassInfo class1;
    memset(&class1, 0, sizeof(class1));
    factory->getClassInfo(1, &class1);

    std::cout << "Attempting createInstance with exact cid from getClassInfo..." << std::endl;
    IPluginBase* comp = nullptr;
    int res = factory->createInstance(class0.cid, (const char*)IComponent_IID, (void**)&comp);
    std::cout << "Class 0 -> IComponent res: " << res << " ptr: " << comp << std::endl;

    IEditController* controller = nullptr;
    res = factory->createInstance(class1.cid, (const char*)IEditController_IID, (void**)&controller);
    std::cout << "Class 1 -> IEditController res: " << res << " ptr: " << controller << std::endl;

    if (!controller) {
        std::cout << "Could not instantiate IEditController" << std::endl;
        return 1;
    }

    controller->initialize(nullptr);
    IPlugView* view = controller->createView("editor");
    std::cout << "createView('editor') result: " << view << std::endl;

    if (!view) {
        std::cout << "createView returned null" << std::endl;
        return 1;
    }

    ViewRect vr = {0, 0, 1000, 700};
    view->getSize(&vr);
    int width = vr.right - vr.left;
    int height = vr.bottom - vr.top;
    if (width <= 0) width = 1100;
    if (height <= 0) height = 750;
    std::cout << "Plugin View Size: " << width << "x" << height << std::endl;

    // Register Win32 Class
    WNDCLASSW wc = {0};
    wc.lpfnWndProc = WndProc;
    wc.hInstance = GetModuleHandle(NULL);
    wc.lpszClassName = L"YamahaMontageMHostWnd";
    wc.hCursor = LoadCursor(NULL, IDC_ARROW);
    RegisterClassW(&wc);

    HWND hwnd = CreateWindowExW(
        0,
        L"YamahaMontageMHostWnd",
        L"YAMAHA MONTAGE M - Sound Editor",
        WS_OVERLAPPEDWINDOW | WS_VISIBLE,
        CW_USEDEFAULT, CW_USEDEFAULT,
        width + 16, height + 39,
        NULL, NULL, GetModuleHandle(NULL), NULL
    );

    // Attach View to HWND (kPlatformTypeHWND)
    int attachRes = view->attached((void*)hwnd, "HWND");
    std::cout << "view->attached(HWND) result: " << attachRes << std::endl;

    // Run Message Loop
    MSG msg;
    while (GetMessage(&msg, NULL, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }

    view->removed();
    view->release();
    controller->terminate();
    controller->release();
    return 0;
}
