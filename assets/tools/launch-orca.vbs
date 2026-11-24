' Opens Orca with the transparent-panel styling (no console window, no network port).
' Transparency values: ..\config.json  ({ "panels": 85, "center": 65 })
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
' Node.js from its usual install folders, else from PATH.
nodeExe = "node"
For Each candidate In Array("%ProgramFiles%\nodejs\node.exe", "%LOCALAPPDATA%\Programs\nodejs\node.exe")
  p = sh.ExpandEnvironmentStrings(candidate)
  If fso.FileExists(p) Then
    nodeExe = """" & p & """"
    Exit For
  End If
Next
sh.Run nodeExe & " """ & dir & "\launcher.mjs""", 0, False
