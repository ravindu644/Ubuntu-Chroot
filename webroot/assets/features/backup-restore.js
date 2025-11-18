// Backup and Restore Feature Module
(function(window) {
  'use strict';

  let dependencies = {};

  function init(deps) {
    dependencies = deps;
  }

  async function backupChroot() {
    const {
      activeCommandId, appendConsole, showFilePickerDialog, showConfirmDialog,
      closeSettingsPopup, ANIMATION_DELAYS, PATH_CHROOT_SH, ProgressIndicator,
      disableAllActions, disableSettingsPopup, refreshStatus, runCmdAsync,
      updateStatus, scrollConsoleToBottom, els
    } = dependencies;

    if(activeCommandId.value) {
      appendConsole('⚠ Another command is already running. Please wait...', 'warn');
      return;
    }

    const backupPath = await showFilePickerDialog(
      'Backup Chroot Environment',
      'Select where to save the backup file.\n\nThe chroot will be stopped during backup if it\'s currently running.',
      '/sdcard',
      `chroot-backup-${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.tar.gz`
    );

    if(!backupPath) return;

    const confirmed = await showConfirmDialog(
      'Backup Chroot Environment',
      `This will create a compressed backup of your chroot environment.\n\nThe chroot will be stopped during backup if it's currently running.\n\nBackup location: ${backupPath}\n\nContinue?`,
      'Backup',
      'Cancel'
    );

    if(!confirmed) return;

    closeSettingsPopup();
    await new Promise(resolve => setTimeout(resolve, ANIMATION_DELAYS.POPUP_CLOSE_LONG));

    // STEP 1: Scroll to bottom FIRST
    await scrollConsoleToBottom();

    // STEP 2: Print header
    appendConsole('━━━ Starting Chroot Backup ━━━', 'info');

    // STEP 3: Show animated progress (keep visible during execution)
    const { progressLine, interval: progressInterval } = ProgressIndicator.create('Backing up chroot', 'dots');

    // Update UI state
    const isRunning = els.statusText && els.statusText.textContent.trim() === 'running';
    if(isRunning) {
      updateStatus('stopping');
      if(window.StopNetServices) {
        await StopNetServices.stopNetworkServices();
      }
    }

    disableAllActions(true);
    disableSettingsPopup(true);
    activeCommandId.value = 'chroot-backup';

    // STEP 4: Execute command (animation stays visible)
    runCmdAsync(`sh ${PATH_CHROOT_SH} backup --webui "${backupPath}"`, (result) => {
      // STEP 5: Clear animation ONLY when command completes
      ProgressIndicator.remove(progressLine, progressInterval);

      if(result.success) {
        appendConsole('✓ Backup completed successfully', 'success');
        appendConsole(`Saved to: ${backupPath}`, 'info');
        appendConsole('━━━ Backup Complete ━━━', 'success');
      } else {
        appendConsole('✗ Backup failed', 'err');
      }

      activeCommandId.value = null;
      disableAllActions(false);
      disableSettingsPopup(false, true);
      setTimeout(() => refreshStatus(), ANIMATION_DELAYS.STATUS_REFRESH);
    });
  }

  async function restoreChroot() {
    const {
      activeCommandId, rootAccessConfirmed, appendConsole, showFilePickerDialog,
      showConfirmDialog, closeSettingsPopup, ANIMATION_DELAYS, PATH_CHROOT_SH,
      ProgressIndicator, disableAllActions, disableSettingsPopup, updateStatus,
      refreshStatus, runCmdAsync, scrollConsoleToBottom, els
    } = dependencies;

    if(activeCommandId.value) {
      appendConsole('⚠ Another command is already running. Please wait...', 'warn');
      return;
    }

    if(!rootAccessConfirmed.value) {
      appendConsole('Cannot restore chroot: root access not available', 'err');
      return;
    }

    const backupPath = await showFilePickerDialog(
      'Restore Chroot Environment',
      'Select the backup file to restore from.\n\nWARNING: This will permanently delete your current chroot environment!',
      '/sdcard',
      '',
      true
    );

    if(!backupPath) return;

    const confirmed = await showConfirmDialog(
      'Restore Chroot Environment',
      `⚠️ WARNING: This will permanently delete your current chroot environment and replace it with the backup!\n\nAll current data in the chroot will be lost.\n\nBackup file: ${backupPath}\n\nThis action cannot be undone. Continue?`,
      'Restore',
      'Cancel'
    );

    if(!confirmed) return;

    closeSettingsPopup();
    await new Promise(resolve => setTimeout(resolve, ANIMATION_DELAYS.POPUP_CLOSE_LONG));

    // STEP 1: Scroll to bottom FIRST
    await scrollConsoleToBottom();

    // STEP 2: Print header
    appendConsole('━━━ Starting Chroot Restore ━━━', 'warn');

    // STEP 3: Show animated progress (keep visible during execution)
    const { progressLine, interval: progressInterval } = ProgressIndicator.create('Restoring chroot', 'dots');

    // Update UI state
    const isRunning = els.statusText && els.statusText.textContent.trim() === 'running';
    if(isRunning) {
      updateStatus('stopping');
      if(window.StopNetServices) {
        await StopNetServices.stopNetworkServices();
      }
    }
    updateStatus('restoring');

    disableAllActions(true);
    disableSettingsPopup(true);
    activeCommandId.value = 'chroot-restore';

    // STEP 4: Execute command (animation stays visible)
    runCmdAsync(`sh ${PATH_CHROOT_SH} restore --webui "${backupPath}"`, (result) => {
      // STEP 5: Clear animation ONLY when command completes
      ProgressIndicator.remove(progressLine, progressInterval);

      if(result.success) {
        appendConsole('✓ Restore completed successfully', 'success');
        appendConsole('The chroot environment has been restored', 'info');
        appendConsole('━━━ Restore Complete ━━━', 'success');
        updateStatus('stopped');
        disableAllActions(true);
      } else {
        appendConsole('✗ Restore failed', 'err');
        disableAllActions(false);
      }

      activeCommandId.value = null;
      disableSettingsPopup(false, true);
      setTimeout(() => refreshStatus(), ANIMATION_DELAYS.STATUS_REFRESH * 2);
    });
  }

  window.BackupRestoreFeature = {
    init,
    backupChroot,
    restoreChroot
  };
})(window);

