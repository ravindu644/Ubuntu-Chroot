// Uninstall Feature Module
(function(window) {
  'use strict';

  let dependencies = {};

  function init(deps) {
    dependencies = deps;
  }

  async function uninstallChroot() {
    const {
      activeCommandId, appendConsole, showConfirmDialog, closeSettingsPopup,
      ANIMATION_DELAYS, PATH_CHROOT_SH, ProgressIndicator, disableAllActions,
      disableSettingsPopup, updateStatus, refreshStatus, runCmdAsync, scrollConsoleToBottom, els
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
    await new Promise(resolve => setTimeout(resolve, ANIMATION_DELAYS.POPUP_CLOSE_VERY_LONG));

    // STEP 1: Scroll to bottom FIRST
    await scrollConsoleToBottom();

    // STEP 2: Print header
    appendConsole('━━━ Starting Uninstallation ━━━', 'warn');

    // STEP 3: Show animated progress (keep visible during execution)
    const { progressLine, interval: progressInterval } = ProgressIndicator.create('Uninstalling chroot', 'dots');

    // Update UI state
    const isRunning = els.statusText && els.statusText.textContent.trim() === 'running';
    if(isRunning) {
      updateStatus('stopping');
      if(window.StopNetServices) {
        await StopNetServices.stopNetworkServices();
      }
    }
    updateStatus('uninstalling');

    disableAllActions(true);
    disableSettingsPopup(true);
    activeCommandId.value = 'chroot-uninstall';

    // STEP 4: Execute command (animation stays visible)
    runCmdAsync(`sh ${PATH_CHROOT_SH} uninstall --webui`, (result) => {
      // STEP 5: Clear animation ONLY when command completes
      ProgressIndicator.remove(progressLine, progressInterval);

      if(result.success) {
        appendConsole('✅ Chroot uninstalled successfully!', 'success');
        appendConsole('All chroot data has been removed.', 'info');
        appendConsole('━━━ Uninstallation Complete ━━━', 'success');
        updateStatus('stopped');
        disableAllActions(true);
      } else {
        appendConsole('✗ Uninstallation failed', 'err');
        appendConsole('Check the logs above for details.', 'err');
        disableAllActions(false);
      }
      
      activeCommandId.value = null;
      disableSettingsPopup(false, false);
      setTimeout(() => refreshStatus(), ANIMATION_DELAYS.STATUS_REFRESH * 2);
    });
  }

  window.UninstallFeature = {
    init,
    uninstallChroot
  };
})(window);

