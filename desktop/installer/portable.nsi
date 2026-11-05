; DT Kalkan portable launcher — © 2026 Development Turkey. All rights reserved.
Unicode true
!define PRODUCT_NAME "DT Kalkan"
!define PRODUCT_EXE "DT Kalkan.exe"
!define VERSION "1.0.0"
Name "${PRODUCT_NAME} Portable"
OutFile "${OUTFILE}"
Icon "..\build\icon.ico"
RequestExecutionLevel admin
SetCompressor /SOLID lzma
SetCompressorDictSize 64
BrandingText "Development Turkey"
AutoCloseWindow true
ShowInstDetails nevershow
Caption "${PRODUCT_NAME}"
SubCaption 3 " "
InstallDir "$LOCALAPPDATA\${PRODUCT_NAME}\Portable-${VERSION}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${PRODUCT_NAME} Portable"
VIAddVersionKey "CompanyName" "Development Turkey"
VIAddVersionKey "LegalCopyright" "© 2026 Development Turkey. Tüm hakları saklıdır."
VIAddVersionKey "FileDescription" "${PRODUCT_NAME}"
VIAddVersionKey "FileVersion" "${VERSION}"
Page instfiles
!include "LogicLib.nsh"
Section
  ; pass the launcher path so "run at startup" points at this portable exe
  System::Call 'Kernel32::SetEnvironmentVariable(t "DT_PORTABLE_EXE", t "$EXEPATH")'
  ${IfNot} ${FileExists} "$INSTDIR\.ready"
    DetailPrint "${PRODUCT_NAME} hazırlanıyor…"
    SetOutPath "$INSTDIR"
    File /r "${APPDIR}\*.*"
    FileOpen $0 "$INSTDIR\.ready" w
    FileClose $0
  ${EndIf}
  Exec '"$INSTDIR\${PRODUCT_EXE}"'
SectionEnd
