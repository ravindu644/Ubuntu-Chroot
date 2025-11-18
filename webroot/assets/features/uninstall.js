// Uninstall Feature Module
(function(window) {
  'use strict';

  let dependencies = {};

  function init(deps) {
    dependencies = deps;
  }

  async function uninstallChroot() {
    const {
      activeCommandId, rootAccessConfirmed, appendConsole, showConfirmDialog, closeSettingsPopup,
      ANIMATION_DELAYS, PATH_CHROOT_SH, ProgressIndicator, disableAllActions,
      disableSettingsPopup, updateStatus, refreshStatus, runCmdAsync, ensureChrootStopped, prepareActionExecution, executeCommandWithProgress, els
    } = dependencies;

    if(activeCommandId.value) {
      appendConsole('⚠ Another command is already running. Please wait...', 'warn');
      return;
    }

    const confirmed = await showConfirmDialog(
      'Uninstall Chroot Environment',
      'Are you sure you want to uninstall the chroot environment?\n\nThis will permanently delete all data in the chroot and cannot be undone.',
      'Uninstall',
      'Cancel'
    );

    if(!confirmed) {
      return;
    }

    await new Promise(resolve => setTimeout(resolve, ANIMATION_DELAYS.INPUT_FOCUS));

    closeSettingsPopup();
    // Update status immediately after closing popup for instant feedback
    updateStatus('uninstalling');
    await new Promise(resolve => setTimeout(resolve, ANIMATION_DELAYS.POPUP_CLOSE_VERY_LONG));

    disableAllActions(true);
    disableSettingsPopup(true);

    // Stop chroot if running (uses centralized flow internally)
    const isRunning = els.statusText && els.statusText.textContent.trim() === 'running';
    if(isRunning) {
      const stopped = await ensureChrootStopped();
      if(!stopped) {
        appendConsole('✗ Failed to stop chroot - uninstall aborted', 'err');
        activeCommandId.value = null;
        disableAllActions(false);
        disableSettingsPopup(false, true);
        return;
      }
    }
    
    // Now use centralized flow for uninstall action
    const { progressLine, interval: progressInterval } = await prepareActionExecution(
      'Starting Uninstallation',
      'Uninstalling chroot',
      'dots'
    );

    // Execute command using helper (handles validation, execution, cleanup, scrolling)
    const cmd = `sh ${PATH_CHROOT_SH} uninstall --webui`;
    
    const commandId = executeCommandWithProgress({
      cmd,
      progress: { progressLine, progressInterval },
      onSuccess: (result) => {
        appendConsole('✅ Chroot uninstalled successfully!', 'success');
        appendConsole('All chroot data has been removed.', 'info');
        appendConsole('━━━ Uninstallation Complete ━━━', 'success');
        updateStatus('stopped');
        disableAllActions(true);
        disableSettingsPopup(false, false);
        setTimeout(() => refreshStatus(), ANIMATION_DELAYS.STATUS_REFRESH * 2);
      },
      onError: (result) => {
        appendConsole('✗ Uninstallation failed', 'err');
        appendConsole('Check the logs above for details.', 'err');
        disableAllActions(false);
        disableSettingsPopup(false, false);
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

  window.UninstallFeature = {
    init,
    uninstallChroot
  };
})(window);

