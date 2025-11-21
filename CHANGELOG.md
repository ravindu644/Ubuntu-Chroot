# Changelog

## v4.0 (2025-11-21)

- module: show a notice to users if they are using the in-built module updater in root managers
- workflow: auto update the release description with the changelog
- webui: added ubuntu loading dots to the webui loading screen
- webui: fixed initial load takes too much time
- webui: fixed typo related to stopping the chroot
- webui: show stopping animations related to network utilities when stopping/restarting the chroot
- webui: use a smooth animation when displaying console logs
- webui: fix forward nat status checking issues
- chrootmgr: disable phantom process killing to prevent chroot from killing in newer versions of Android
- webui: auto-adjust the console box height based on screen height
- Remove `version`, `updateJson` and `versionCode` from module.prop
- Use `printf` instead of `sed`
- rootfs: added a script to download and decompress the linux-firmware
- readme: added notes about to-do
- readme: refined requirements
- readme: added the new NAT share feature, added new screenshots
- Update metadata for v3.5
