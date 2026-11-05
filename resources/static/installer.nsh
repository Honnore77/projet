; ===================================================================
; Installateur Windows (NSIS, electron-builder).
;
; Jusqu'a la 4.4.51, le programme embarquait des node_modules inutiles a
; Electron, dont les fichiers de compilation Android de Capacitor, aux
; chemins de 254 caracteres. Pour une mise a jour, l'ancien desinstalleur
; deplace chaque fichier dans son dossier temporaire : le chemin depassait
; alors 260 caracteres, le deplacement echouait, et l'installateur
; finissait sur « PDU Parc Auto ne peut pas être fermé » — il fallait
; desinstaller a la main (04/11/2026).
;
; Les node_modules ne sont plus livres (« files » de package.json). Ceux
; d'une ancienne installation sont effaces ici, avant que l'installateur
; ne lance l'ancien desinstalleur : la mise a jour passe d'elle-meme. Rien
; d'autre n'est touche, et les donnees sont ailleurs (AppData\Roaming).
; ===================================================================

!macro customInit
  ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${if} $0 != ""
  ${andIf} ${FileExists} "$0\resources\app.asar.unpacked\node_modules\*.*"
    RMDir /r "$0\resources\app.asar.unpacked\node_modules"
  ${endIf}
!macroend
