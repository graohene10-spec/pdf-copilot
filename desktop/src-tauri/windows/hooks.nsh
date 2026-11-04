; 0.10.1 → 0.10.2 改名过渡。0.10.1 及更早的自动更新在静默安装后总是重新启动旧目录里的 开智.exe：
; 把新程序复制过去，它以旧名启动后会转交给 OpenIntelligence.exe，并静默卸载旧的中文目录（文档库与设置保留）。
!macro NSIS_HOOK_POSTINSTALL
  StrCmp "$INSTDIR" "$LOCALAPPDATA\开智" kaizhi_done
  IfFileExists "$LOCALAPPDATA\开智\uninstall.exe" 0 kaizhi_done
    CopyFiles /SILENT "$INSTDIR\${MAINBINARYNAME}.exe" "$LOCALAPPDATA\开智\开智.exe"
  kaizhi_done:
!macroend
