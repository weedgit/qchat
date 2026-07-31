; NSIS finish-page tweak for electron-builder (assisted installer).
;
; Problem: the default "Run app" path can block the Finish button until the
; Electron process exits (or until it fully starts), so the installer window
; appears stuck while Rchat is open.
;
; Fix: launch with ExecShell (no wait), then let the finish page close normally.

!macro customFinishPage
  Function LaunchAppNoWait
    ${If} ${isUpdated}
      StrCpy $1 "--updated"
    ${Else}
      StrCpy $1 ""
    ${EndIf}
    ; ExecShell returns immediately — do not use ExecWait here.
    ExecShell "open" "$appExe" "$1" SW_SHOWNORMAL
  FunctionEnd

  !ifndef HIDE_RUN_AFTER_FINISH
    !define MUI_FINISHPAGE_RUN
    !define MUI_FINISHPAGE_RUN_TEXT "Launch Rchat Desktop"
    !define MUI_FINISHPAGE_RUN_FUNCTION "LaunchAppNoWait"
  !endif
  !insertmacro MUI_PAGE_FINISH
!macroend
