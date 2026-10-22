; Заменяет стандартную проверку «приложение запущено»: тихо закрываем
; запущенные копии GG Email, чтобы установка не прерывалась диалогом.
!macro customCheckAppRunning
  DetailPrint "Закрываем запущенные копии GG Email…"
  nsExec::ExecToLog 'taskkill /F /T /IM "${APP_EXECUTABLE_FILENAME}"'
  Pop $0
  Sleep 900
!macroend
; Перед установкой закрываем запущенную копию и снимаем блокировки
; с прошлого деинсталлятора (частые причины ошибки «Невозможно открыть файл»).
!macro preInit
  nsExec::Exec 'taskkill /IM "GG Email.exe" /F'
  nsExec::Exec 'taskkill /IM "Uninstall GG Email.exe" /F'
  SetFileAttributes "$LOCALAPPDATA\Programs\GG Email\Uninstall GG Email.exe" NORMAL
  Delete "$LOCALAPPDATA\Programs\GG Email\Uninstall GG Email.exe"
!macroend
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
