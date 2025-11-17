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
      disableSettingsPopup, updateStatus, refreshStatus, runCmdAsync, els
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

    // Check if chroot is running and update status to stopping
    const isRunning = els.statusText && els.statusText.textContent.trim() === 'running';
    if(isRunning) {
      updateStatus('stopping');
    }

    appendConsole('━━━ Starting Uninstallation ━━━', 'warn');
    
    const { progressLine, interval: progressInterval } = ProgressIndicator.create('Uninstalling chroot', 'dots');
    
    disableAllActions(true);
    disableSettingsPopup(true);
    activeCommandId.value = 'chroot-uninstall';

    setTimeout(() => {
      runCmdAsync(`sh ${PATH_CHROOT_SH} uninstall --webui`, (result) => {
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
    }, ANIMATION_DELAYS.UI_UPDATE);
  }

  window.UninstallFeature = {
    init,
    uninstallChroot
  };
})(window);

