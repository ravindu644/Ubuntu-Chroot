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
      refreshStatus, sparseMigrated, runCmdAsync, updateStatus, scrollConsoleToBottom
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

    // STEP 1: Scroll to bottom FIRST
    await scrollConsoleToBottom();

    // STEP 2: Print header
    appendConsole('━━━ Starting Sparse Image Migration ━━━', 'warn');
    appendConsole(`Target size: ${sizeGb}GB sparse ext4 image`, 'info');
    appendConsole('DO NOT CLOSE THIS WINDOW!', 'warn');

    // STEP 3: Show animated progress (keep visible during execution)
    const { progressLine, interval: progressInterval } = ProgressIndicator.create('Migrating', 'dots');

    disableAllActions(true);
    disableSettingsPopup(true);
    activeCommandId.value = 'chroot-migration';

    const isRunning = els.statusText.textContent.trim() === 'running';

    if(isRunning) {
      // Stop chroot first if running
      updateStatus('stopping');
      if(window.StopNetServices) {
        await StopNetServices.stopNetworkServices({ progressLine });
      }
      
      ProgressIndicator.update(progressLine, 'Stopping chroot');

      runCmdAsync(`sh ${PATH_CHROOT_SH} stop >/dev/null 2>&1`, (stopResult) => {
        if(stopResult.success) {
          appendConsole('✓ Chroot stopped for migration', 'success');
          updateStatus('migrating');
          ProgressIndicator.update(progressLine, 'Migrating');
          proceedToMigration();
        } else {
          ProgressIndicator.remove(progressLine, progressInterval);
          appendConsole('✗ Failed to stop chroot', 'err');
          appendConsole('Migration aborted - please stop the chroot manually first', 'err');
          activeCommandId.value = null;
          disableAllActions(false);
          disableSettingsPopup(false, true);
        }
      });
    } else {
      // Chroot not running, proceed directly to migration
      updateStatus('migrating');
      proceedToMigration();
    }

    function proceedToMigration() {
      // STEP 4: Execute migration command (animation stays visible)
      runCmdAsync(`sh ${CHROOT_DIR}/sparsemgr.sh migrate ${sizeGb}`, (result) => {
        // STEP 5: Clear animation ONLY when command completes
        ProgressIndicator.remove(progressLine, progressInterval);

        if(result.success) {
          appendConsole('✅ Sparse image migration completed successfully!', 'success');
          appendConsole('Your rootfs has been converted to a sparse image.', 'info');
          appendConsole('━━━ Migration Complete ━━━', 'success');
          sparseMigrated.value = true;
          setTimeout(() => refreshStatus(), ANIMATION_DELAYS.STATUS_REFRESH * 2);
        } else {
          appendConsole('✗ Sparse image migration failed!', 'err');
          appendConsole('Check the logs above for details.', 'err');
          appendConsole('━━━ Migration Failed ━━━', 'err');
        }

        activeCommandId.value = null;
        disableAllActions(false);
        disableSettingsPopup(false, true);
      });
    }
  }

  window.MigrateFeature = {
    init,
    migrateToSparseImage
  };
})(window);

