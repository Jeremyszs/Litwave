; Inno Setup Script for Litwave Practice Workstation
; Generates a professional Windows Setup .exe with Desktop Shortcut and Clean Uninstaller

#define MyAppName "Litwave"
#define MyAppVersion "0.1.0"
#define MyAppPublisher "Jeremy Rukmana"
#define MyAppURL "https://github.com/Jeremyszs/Litwave"
#define MyAppExeName "Litwave.bat"
#define MyDistDir "C:\Users\Jeremy Rukmana\projects\montage-practice-daw\dist\Litwave"
#define MyIconFile "C:\Users\Jeremy Rukmana\projects\montage-practice-daw\assets\app.ico"
#define MyOutputDir "C:\Users\Jeremy Rukmana\projects\montage-practice-daw\dist"

[Setup]
AppId={{D37F7E1B-9478-43B6-BA5F-4E381A5D8A31}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
AllowNoIcons=yes
OutputDir={#MyOutputDir}
OutputBaseFilename=Litwave-Setup-v0.1.0-x64
SetupIconFile={#MyIconFile}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\assets\app.ico
UninstallDisplayName={#MyAppName} Practice Workstation

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "{#MyDistDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#MyIconFile}"; DestDir: "{app}\assets"; Flags: ignoreversion

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\assets\app.ico"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\assets\app.ico"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: shellexec postinstall nowait skipifsilent
