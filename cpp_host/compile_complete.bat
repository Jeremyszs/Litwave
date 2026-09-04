@echo off
call "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"
cd /d "C:\Users\Jeremy Rukmana\Projects\montage-practice-daw\cpp_host"
cl.exe /EHsc /W3 /O2 /I"C:\Users\Jeremy Rukmana\Projects\montage-practice-daw\vst3_sdk" native_complete_host.cpp "C:\Users\Jeremy Rukmana\Projects\montage-practice-daw\vst3_sdk\pluginterfaces\base\funknown.cpp" "C:\Users\Jeremy Rukmana\Projects\montage-practice-daw\vst3_sdk\pluginterfaces\base\coreiids.cpp" /Fe:montage_live_engine.exe user32.lib ole32.lib winmm.lib ws2_32.lib
