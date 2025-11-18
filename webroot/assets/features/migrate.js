// Migrate to Sparse Image Feature Module
(function(window) {
  'use strict';

  let dependencies = {};

  function init(deps) {
    dependencies = deps;
  }

  async function migrateToSparseImage() {
    const {
      showSizeSelectionDialog, showConfirmDialog, closeSettingsPopup,
      ANIMATION_DELAYS, els, PATH_CHROOT_SH, CHROOT_DIR, appendConsole,
      ProgressIndicator, disableAllActions, disableSettingsPopup, activeCommandId,
      rootAccessConfirmed, refreshStatus, sparseMigrated, runCmdAsync, updateStatus, ensureChrootStopped, prepareActionExecution, executeCommandWithProgress
    } = dependencies;

    const sizeGb = await showSizeSelectionDialog();
    if(!sizeGb) return;

    const confirmed = await showConfirmDialog(
      'Migrate to Sparse Image',
      `This will convert your current rootfs to a ${sizeGb}GB sparse ext4 image.\n\n⚠️ IMPORTANT: If your chroot is currently running, it will be stopped automatically.\n\nℹ️ NOTE: Sparse images do not immediately use ${sizeGb}GB of storage. They only consume space as you write data to them, starting small and growing as needed.\n\nWARNING: This process cannot be undone. Make sure you have a backup!\n\nContinue with migration?`,
      'Start Migration',
      'Cancel'
    );

    if(!confirmed) return;

    closeSettingsPopup();
    await new Promise(resolve => setTimeout(resolve, ANIMATION_DELAYS.POPUP_CLOSE_LONG));

    disableAllActions(true);
    disableSettingsPopup(true);

    // Stop chroot if running (uses centralized flow internally)
    const isRunning = els.statusText.textContent.trim() === 'running';
    if(isRunning) {
      const stopped = await ensureChrootStopped();
      if(!stopped) {
        appendConsole('✗ Failed to stop chroot - migration aborted', 'err');
        activeCommandId.value = null;
        disableAllActions(false);
        disableSettingsPopup(false, true);
        return;
      }
    }

    // Update status first, then use centralized flow
    updateStatus('migrating');
    
    // Now use centralized flow for migration action
    const { progressLine, interval: progressInterval } = await prepareActionExecution(
      'Starting Sparse Image Migration',
      'Migrating',
      'dots'
    );
    
    appendConsole(`Target size: ${sizeGb}GB sparse ext4 image`, 'info');
    appendConsole('DO NOT CLOSE THIS WINDOW!', 'warn');
    
    proceedToMigration();

    function proceedToMigration() {
      // Execute command using helper (handles validation, execution, cleanup, scrolling)
      const cmd = `sh ${CHROOT_DIR}/sparsemgr.sh migrate ${sizeGb}`;
      
      const commandId = executeCommandWithProgress({
        cmd,
        progress: { progressLine, progressInterval },
        onSuccess: (result) => {
          appendConsole('✅ Sparse image migration completed successfully!', 'success');
          appendConsole('Your rootfs has been converted to a sparse image.', 'info');
          appendConsole('━━━ Migration Complete ━━━', 'success');
          sparseMigrated.value = true;
          disableAllActions(false);
          disableSettingsPopup(false, true);
          setTimeout(() => refreshStatus(), ANIMATION_DELAYS.STATUS_REFRESH * 2);
        },
        onError: (result) => {
          appendConsole('✗ Sparse image migration failed!', 'err');
          appendConsole('Check the logs above for details.', 'err');
          appendConsole('━━━ Migration Failed ━━━', 'err');
          disableAllActions(false);
          disableSettingsPopup(false, true);
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
  }

  window.MigrateFeature = {
    init,
    migrateToSparseImage
  };
})(window);

