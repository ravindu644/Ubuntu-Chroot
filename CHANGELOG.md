# Changelog

## v3.3 (2025-11-11)

- CRITICAL: chrootmgr: Final fix for the internet issue in legacy Android devices
- fixed apt does not have internet access in legacy devices, only when using the `run_in_chroot` function
- module: don't override the post_exec script everytime the user installs a new update
- CRITICAL: chrootmgr: fixed internet in old legacy devices !
- webui: give users to make a sparse image up to 512GB
- CRITICAL: chrootmgr: don't restore SELinux to Enforcing after stopping the chroot
- Update metadata for v3.2
