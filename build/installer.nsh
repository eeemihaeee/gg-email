; Дополнительные шаги установщика GG Email.
; Установка всегда per-user: %LOCALAPPDATA%\Programs\GG Email, без UAC.
!macro customInstall
  ; Ярлык в меню «Пуск» уже создаётся electron-builder.
  ; Здесь можно добавить регистрацию протокола mailto: для текущего пользователя.
  WriteRegStr HKCU "Software\Classes\mailto\shell\open\command" "" '"$INSTDIR\GG Email.exe" "%1"'
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\mailto\shell\open\command"
!macroend
