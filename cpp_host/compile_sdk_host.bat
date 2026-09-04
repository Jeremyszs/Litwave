@echo off
call "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"
cd "C:\Users\Jeremy Rukmana\Projects\montage-practice-daw\cpp_host"
cl.exe /EHsc /W3 /O2 /I"C:\Users\Jeremy Rukmana\Projects\montage-practice-daw\vst3_sdk" native_sdk_host.cpp "C:\Users\Jeremy Rukmana\Projects\montage-practice-daw\vst3_sdk\pluginterfaces\base\funknown.cpp" "C:\Users\Jeremy Rukmana\Projects\montage-practice-daw\vst3_sdk\pluginterfaces\base\coreiids.cpp" /Fe:montage_native_standalone.exe user32.lib ole32.lib
