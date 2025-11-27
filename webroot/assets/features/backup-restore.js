// Backup and Restore Feature Module
(function(window) {
  'use strict';

  let dependencies = {};

  function init(deps) {
    dependencies = deps;
  }

  async function backupChroot() {
    const {
      activeCommandId, rootAccessConfirmed, appendConsole, showFilePickerDialog, showConfirmDialog,
      closeSettingsPopup, ANIMATION_DELAYS, PATH_CHROOT_SH, ProgressIndicator,
      disableAllActions, disableSettingsPopup, refreshStatus, runCmdAsync,
      updateStatus, updateModuleStatus, ensureChrootStopped, prepareActionExecution, executeCommandWithProgress, els
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

    disableAllActions(true);
    disableSettingsPopup(true);

    // Stop chroot if running (uses centralized flow internally)
    const isRunning = els.statusText && els.statusText.textContent.trim() === 'running';
    if(isRunning) {
      const stopped = await ensureChrootStopped();
      if(!stopped) {
        appendConsole('✗ Failed to stop chroot - backup aborted', 'err');
        activeCommandId.value = null;
        disableAllActions(false);
        disableSettingsPopup(false, true);
        return;
      }
    }

    // Update status first, then use centralized flow
    updateStatus('backing up');
    
    // Now use centralized flow for backup action
    const { progressLine, interval: progressInterval } = await prepareActionExecution(
      'Starting Chroot Backup',
      'Backing up chroot',
      'dots'
    );

    // Execute command using helper (handles validation, execution, cleanup, scrolling)
    const cmd = `sh ${PATH_CHROOT_SH} backup --webui "${backupPath}"`;
    
    const commandId = executeCommandWithProgress({
      cmd,
      progress: { progressLine, progressInterval },
      onSuccess: (result) => {
        appendConsole('✓ Backup completed successfully', 'success');
        appendConsole(`Saved to: ${backupPath}`, 'info');
        appendConsole('━━━ Backup Complete ━━━', 'success');
        if(updateModuleStatus) updateModuleStatus();
        disableAllActions(false);
        disableSettingsPopup(false, true);
        setTimeout(() => refreshStatus(), ANIMATION_DELAYS.STATUS_REFRESH);
      },
      onError: (result) => {
        appendConsole('✗ Backup failed', 'err');
        if(updateModuleStatus) updateModuleStatus();
        disableAllActions(false);
        disableSettingsPopup(false, true);
        setTimeout(() => refreshStatus(), ANIMATION_DELAYS.STATUS_REFRESH);
      },
      useValue: true,
      activeCommandIdRef: activeCommandId
    });
    
    if(!commandId) {
      // Validation failed - cleanup already done by helper
      disableAllActions(false);
      disableSettingsPopup(false, true);
    }
  }

  async function restoreChroot() {
    const {
      activeCommandId, rootAccessConfirmed, appendConsole, showFilePickerDialog,
      showConfirmDialog, closeSettingsPopup, ANIMATION_DELAYS, PATH_CHROOT_SH,
      ProgressIndicator, disableAllActions, disableSettingsPopup, updateStatus, updateModuleStatus,
      refreshStatus, runCmdAsync, ensureChrootStopped, prepareActionExecution, executeCommandWithProgress, els
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

    disableAllActions(true);
    disableSettingsPopup(true);

    // Stop chroot if running (uses centralized flow internally)
    const isRunning = els.statusText && els.statusText.textContent.trim() === 'running';
    if(isRunning) {
      const stopped = await ensureChrootStopped();
      if(!stopped) {
        appendConsole('✗ Failed to stop chroot - restore aborted', 'err');
        activeCommandId.value = null;
        disableAllActions(false);
        disableSettingsPopup(false, true);
        return;
      }
    }

    // Update status first, then use centralized flow
    updateStatus('restoring');
    
    // Now use centralized flow for restore action
    const { progressLine, interval: progressInterval } = await prepareActionExecution(
      'Starting Chroot Restore',
      'Restoring chroot',
      'dots'
    );

    // Execute command using helper (handles validation, execution, cleanup, scrolling)
    const cmd = `sh ${PATH_CHROOT_SH} restore --webui "${backupPath}"`;
    
    const commandId = executeCommandWithProgress({
      cmd,
      progress: { progressLine, progressInterval },
      onSuccess: (result) => {
        appendConsole('✓ Restore completed successfully', 'success');
        appendConsole('The chroot environment has been restored', 'info');
        appendConsole('━━━ Restore Complete ━━━', 'success');
        updateStatus('stopped');
        if(updateModuleStatus) updateModuleStatus();
        disableAllActions(true);
        disableSettingsPopup(false, true);
        setTimeout(() => refreshStatus(), ANIMATION_DELAYS.STATUS_REFRESH * 2);
      },
      onError: (result) => {
        appendConsole('✗ Restore failed', 'err');
        if(updateModuleStatus) updateModuleStatus();
        disableAllActions(false);
        disableSettingsPopup(false, true);
        setTimeout(() => refreshStatus(), ANIMATION_DELAYS.STATUS_REFRESH * 2);
      },
      useValue: true,
      activeCommandIdRef: activeCommandId
    });
    
    if(!commandId) {
      // Validation failed - cleanup already done by helper
      disableAllActions(false);
      disableSettingsPopup(false, true);
    }
  }

  window.BackupRestoreFeature = {
    init,
    backupChroot,
    restoreChroot
  };
})(window);

