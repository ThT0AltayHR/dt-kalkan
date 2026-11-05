; DT Kalkan installer — © 2026 Development Turkey. All rights reserved.
Unicode true
!ifndef APPDIR
  !error "APPDIR not defined"
!endif
!define PRODUCT_NAME "DT Kalkan"
!define PRODUCT_EXE "DT Kalkan.exe"
!define UI_EXE "DT Kalkan UI.exe"
!define COMPANY "Development Turkey"
!define VERSION "1.0.0"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\DTKalkan"
!define TASK "DT Kalkan Autostart"

Name "${PRODUCT_NAME}"
OutFile "${OUTFILE}"
InstallDir "$PROGRAMFILES64\${PRODUCT_NAME}"
InstallDirRegKey HKLM "Software\${COMPANY}\${PRODUCT_NAME}" "InstallDir"
RequestExecutionLevel admin
SetCompressor /SOLID lzma
SetCompressorDictSize 64
BrandingText "${COMPANY}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=1055 "ProductName" "${PRODUCT_NAME}"
VIAddVersionKey /LANG=1055 "CompanyName" "${COMPANY}"
VIAddVersionKey /LANG=1055 "LegalCopyright" "© 2026 ${COMPANY}. Tüm hakları saklıdır."
VIAddVersionKey /LANG=1055 "FileDescription" "${PRODUCT_NAME} Kurulum"
VIAddVersionKey /LANG=1055 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=1055 "ProductVersion" "${VERSION}"

!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"

!define MUI_ICON "..\build\icon.ico"
!define MUI_UNICON "..\build\icon.ico"
!define MUI_WELCOMEFINISHPAGE_BITMAP "welcome.bmp"
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "welcome.bmp"
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_RIGHT
!define MUI_HEADERIMAGE_BITMAP "header.bmp"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\${PRODUCT_EXE}"

Var StartupBox
Var DesktopBox
Var OptStartup
Var OptDesktop

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE $(EulaFile)
!insertmacro MUI_PAGE_DIRECTORY
Page custom OptionsPage OptionsLeave
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "Turkish"
!insertmacro MUI_LANGUAGE "English"
LicenseLangString EulaFile 1055 "eula_tr.txt"
LicenseLangString EulaFile 1033 "eula_en.txt"
LangString OptTitle 1055 "Ek seçenekler"
LangString OptTitle 1033 "Additional options"
LangString OptSub 1055 "${PRODUCT_NAME} nasıl çalışsın?"
LangString OptSub 1033 "How should ${PRODUCT_NAME} run?"
LangString OptStartupTxt 1055 "Windows açıldığında korumayı otomatik başlat (önerilir)"
LangString OptStartupTxt 1033 "Start protection automatically when Windows starts (recommended)"
LangString OptDesktopTxt 1055 "Masaüstü kısayolu oluştur"
LangString OptDesktopTxt 1033 "Create a desktop shortcut"
LangString OptNote 1055 "${PRODUCT_NAME} yönetici yetkisiyle çalışır ve sistem tepsisinde sizi korumaya devam eder."
LangString OptNote 1033 "${PRODUCT_NAME} runs with administrator rights and keeps protecting you from the system tray."
LangString Need64 1055 "${PRODUCT_NAME} 64 bit Windows 10 veya üzeri gerektirir."
LangString Need64 1033 "${PRODUCT_NAME} requires 64-bit Windows 10 or later."

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP $(Need64)
    Abort
  ${EndIf}
  SetRegView 64
  StrCpy $OptStartup ${BST_CHECKED}
  StrCpy $OptDesktop ${BST_CHECKED}
  !insertmacro MUI_LANGDLL_DISPLAY
FunctionEnd

Function OptionsPage
  !insertmacro MUI_HEADER_TEXT $(OptTitle) $(OptSub)
  nsDialogs::Create 1018
  Pop $0
  ${NSD_CreateCheckbox} 0 10u 100% 12u $(OptStartupTxt)
  Pop $StartupBox
  ${NSD_SetState} $StartupBox $OptStartup
  ${NSD_CreateCheckbox} 0 30u 100% 12u $(OptDesktopTxt)
  Pop $DesktopBox
  ${NSD_SetState} $DesktopBox $OptDesktop
  ${NSD_CreateLabel} 0 60u 100% 24u $(OptNote)
  Pop $0
  nsDialogs::Show
FunctionEnd
Function OptionsLeave
  ${NSD_GetState} $StartupBox $OptStartup
  ${NSD_GetState} $DesktopBox $OptDesktop
FunctionEnd

!macro KillApp
  nsExec::Exec 'taskkill /F /T /IM "${UI_EXE}"'
  nsExec::Exec 'taskkill /F /T /IM "${PRODUCT_EXE}"'
  Sleep 800
!macroend

Section "Install"
  SetShellVarContext all
  !insertmacro KillApp
  SetOutPath "$INSTDIR"
  File /r "${APPDIR}\*.*"
  ; installer options for the app's first launch
  System::Call 'kernel32::GetTickCount()i.r1'
  ${If} $OptStartup == ${BST_CHECKED}
    FileOpen $0 "$INSTDIR\resources\install.json" w
    FileWrite $0 '{"startup":true,"stamp":"$1"}'
    FileClose $0
    nsExec::Exec 'schtasks /Create /TN "${TASK}" /TR "\"$INSTDIR\${PRODUCT_EXE}\" --hidden" /SC ONLOGON /RL HIGHEST /F'
  ${Else}
    FileOpen $0 "$INSTDIR\resources\install.json" w
    FileWrite $0 '{"startup":false,"stamp":"$1"}'
    FileClose $0
  ${EndIf}
  CreateDirectory "$SMPROGRAMS\${PRODUCT_NAME}"
  CreateShortcut "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk" "$INSTDIR\${PRODUCT_EXE}" "" "$INSTDIR\${PRODUCT_EXE}" 0
  CreateShortcut "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME} Kaldır.lnk" "$INSTDIR\Uninstall.exe"
  ${If} $OptDesktop == ${BST_CHECKED}
    CreateShortcut "$DESKTOP\${PRODUCT_NAME}.lnk" "$INSTDIR\${PRODUCT_EXE}" "" "$INSTDIR\${PRODUCT_EXE}" 0
  ${EndIf}
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKLM "Software\${COMPANY}\${PRODUCT_NAME}" "InstallDir" "$INSTDIR"
  WriteRegStr HKLM "${UNINST_KEY}" "DisplayName" "${PRODUCT_NAME}"
  WriteRegStr HKLM "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKLM "${UNINST_KEY}" "Publisher" "${COMPANY}"
  WriteRegStr HKLM "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\${PRODUCT_EXE}"
  WriteRegStr HKLM "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKLM "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKLM "${UNINST_KEY}" "NoRepair" 1
SectionEnd

Function un.onInit
  SetRegView 64
FunctionEnd

Section "Uninstall"
  SetShellVarContext all
  !insertmacro KillApp
  nsExec::Exec 'schtasks /Delete /TN "${TASK}" /F'
  Delete "$DESKTOP\${PRODUCT_NAME}.lnk"
  RMDir /r "$SMPROGRAMS\${PRODUCT_NAME}"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKLM "${UNINST_KEY}"
  DeleteRegKey HKLM "Software\${COMPANY}\${PRODUCT_NAME}"
SectionEnd
