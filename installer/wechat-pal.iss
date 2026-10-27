#define AppName "微信聊天伴侣"
#define AppVersion "3.3.1"
#define AppPublisher "wechat-pal"
#define AppURL "https://github.com/Gaiding1997/wechat-pal"

[Setup]
AppId={{8E4C3F2A-6B7D-4E19-9C2A-5D6F1B8E3A71}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
AppSupportURL={#AppURL}/issues
AppUpdatesURL={#AppURL}/releases
DefaultDirName={localappdata}\Programs\wechat-pal
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\dist
OutputBaseFilename=wechat-pal-setup-{#AppVersion}
SetupIconFile=..\dist\wechat-pal.ico
UninstallDisplayIcon={app}\wechat-pal.ico
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
MinVersion=10.0

[Languages]
Name: "chinesesimplified"; MessagesFile: "ChineseSimplified.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加任务："; Flags: checkablealone

[Files]
Source: "..\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: "dist,data,.git,tests,scripts,config.json,*.log,安装.bat,installer,wechatauto_logs,wechatauto_db"
Source: "..\data\stickers\whale-*.png"; DestDir: "{app}\data\stickers"; Flags: ignoreversion
Source: "..\dist\wechat-pal.ico"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\启动微信聊天伴侣.bat"; WorkingDir: "{app}"; IconFilename: "{app}\wechat-pal.ico"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\启动微信聊天伴侣.bat"; WorkingDir: "{app}"; IconFilename: "{app}\wechat-pal.ico"; Tasks: desktopicon

[Run]
Filename: "{app}\启动微信聊天伴侣.bat"; WorkingDir: "{app}"; Description: "立即启动{#AppName}"; Flags: nowait postinstall skipifsilent

