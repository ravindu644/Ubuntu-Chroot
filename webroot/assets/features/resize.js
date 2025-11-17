// Resize Sparse Image Feature Module
(function(window) {
  'use strict';

  let dependencies = {};

  function init(deps) {
    dependencies = deps;
  }

  async function trimSparseImage() {
    const {
      activeCommandId, rootAccessConfirmed, sparseMigrated, appendConsole,
      showConfirmDialog, closeSettingsPopup, els, ANIMATION_DELAYS, PATH_CHROOT_SH,
      ProgressIndicator, disableAllActions, disableSettingsPopup, updateSparseInfo,
      refreshStatus, runCmdAsync
    } = dependencies;

    if(activeCommandId.value) {
      appendConsole('⚠ Another command is already running. Please wait...', 'warn');
      return;
    }

    if(!rootAccessConfirmed.value) {
      appendConsole('Cannot trim sparse image: root access not available', 'err');
      return;
    }

    if(!sparseMigrated.value) {
      appendConsole('Sparse image not detected - cannot trim', 'err');
      return;
    }

    const confirmed = await showConfirmDialog(
      'Trim Sparse Image',
      'This will run fstrim to reclaim unused space in the sparse image.\n\nThe operation may take a few seconds and space reclamation happens gradually. Continue?',
      'Trim',
      'Cancel'
    );

    if(!confirmed) {
      return;
    }

    closeSettingsPopup();
    const sparsePopup = els.sparseSettingsPopup;
    if(sparsePopup && sparsePopup.classList.contains('active')) {
      sparsePopup.classList.remove('active');
    }

    await new Promise(resolve => setTimeout(resolve, ANIMATION_DELAYS.POPUP_CLOSE_LONG));

    appendConsole('━━━ Trimming Sparse Image ━━━', 'info');

    const { progressLine, interval: progressInterval } = ProgressIndicator.create('Trimming sparse image', 'dots');

    disableAllActions(true);
    disableSettingsPopup(true);
    activeCommandId.value = 'sparse-trim';

    const cmd = `sh ${PATH_CHROOT_SH} fstrim`;

    setTimeout(() => {
      runCmdAsync(cmd, (result) => {
        ProgressIndicator.remove(progressLine, progressInterval);

        if(result.success) {
          appendConsole('✓ Sparse image trimmed successfully', 'success');
          appendConsole('Space may be reclaimed after a few minutes', 'info');
          appendConsole('━━━ Trim Complete ━━━', 'success');
        } else {
          appendConsole('✗ Sparse image trim failed', 'err');
          appendConsole('This may be expected on some Android kernels', 'warn');
        }

        activeCommandId.value = null;
        disableAllActions(false);
        disableSettingsPopup(false, true);
        updateSparseInfo();
        refreshStatus();
      });
    }, ANIMATION_DELAYS.UI_UPDATE);
  }

  async function resizeSparseImage() {
    const {
      activeCommandId, rootAccessConfirmed, appendConsole, showSizeSelectionDialog,
      showConfirmDialog, closeSettingsPopup, els, ANIMATION_DELAYS, CHROOT_DIR,
      PATH_CHROOT_SH, runCmdSync, ProgressIndicator, disableAllActions,
      disableSettingsPopup, updateSparseInfo, refreshStatus, runCmdAsync
    } = dependencies;

    if(activeCommandId.value) {
      appendConsole('⚠ Another command is already running. Please wait...', 'warn');
      return;
    }

    if(!rootAccessConfirmed.value) {
      appendConsole('Cannot resize sparse image: root access not available', 'err');
      return;
    }

    const newSizeGb = await showSizeSelectionDialog();
    if(!newSizeGb) return;

    let currentAllocatedGb = 'Unknown';
    try {
      const usageBytesCmd = `du -b ${CHROOT_DIR}/rootfs.img | cut -f1`;
      const actualUsageBytes = await runCmdSync(usageBytesCmd);
      currentAllocatedGb = Math.ceil(parseInt(actualUsageBytes.trim()) / 1024 / 1024 / 1024) + 'GB';
    } catch(e) {
      // Keep as 'Unknown' if we can't determine
    }

    const confirmed = await showConfirmDialog(
      'Resize Sparse Image',
      `⚠️ EXTREME WARNING: This operation can CORRUPT your filesystem!\n\nYou MUST create a backup before proceeding.\n\nDO NOT close this window or interrupt the process.\n\nCurrent allocated: ${currentAllocatedGb}\nNew size: ${newSizeGb}GB\n\n${parseInt(newSizeGb) > parseInt(currentAllocatedGb) ? 'Operation: GROWING (safer)' : 'Operation: SHRINKING (VERY RISKY)'}\n\nContinue?`,
      'Resize',
      'Cancel'
    );

    if(!confirmed) {
      return;
    }

    closeSettingsPopup();
    const sparsePopup = els.sparseSettingsPopup;
    if(sparsePopup && sparsePopup.classList.contains('active')) {
      sparsePopup.classList.remove('active');
    }

    await new Promise(resolve => setTimeout(resolve, ANIMATION_DELAYS.POPUP_CLOSE_LONG));

    appendConsole(`━━━ Resizing Sparse Image to ${newSizeGb}GB ━━━`, 'warn');

    const { progressLine, interval: progressInterval } = ProgressIndicator.create('Preparing resize operation', 'dots');

    disableAllActions(true);
    disableSettingsPopup(true);
    activeCommandId.value = 'sparse-resize';

    const cmd = `sh ${PATH_CHROOT_SH} resize --webui ${newSizeGb}`;

    setTimeout(() => {
      runCmdAsync(cmd, (result) => {
        ProgressIndicator.remove(progressLine, progressInterval);

        if(result.success) {
          appendConsole('✅ Sparse image resized successfully', 'success');
          appendConsole(`New size: ${newSizeGb}GB`, 'info');
          appendConsole('━━━ Resize Complete ━━━', 'success');
        } else {
          appendConsole('✗ Sparse image resize failed', 'err');
          appendConsole('Check the logs above for details', 'err');
          appendConsole('━━━ Resize Failed ━━━', 'err');
        }

        activeCommandId.value = null;
        disableAllActions(false);
        disableSettingsPopup(false, true);
        updateSparseInfo();
        refreshStatus();
      });
    }, ANIMATION_DELAYS.UI_UPDATE);
  }

  window.ResizeFeature = {
    init,
    trimSparseImage,
    resizeSparseImage
  };
})(window);

