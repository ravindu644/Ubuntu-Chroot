// Resize Sparse Image Feature Module
// This entire crap is AI generated, don't blame me for the mess

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
      refreshStatus, runCmdAsync, updateStatus, updateModuleStatus, prepareActionExecution,
      executeCommandWithProgress
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

    if(!confirmed) return;

    closeSettingsPopup();
    const sparsePopup = els.sparseSettingsPopup;
    if(sparsePopup && sparsePopup.classList.contains('active')) {
      sparsePopup.classList.remove('active');
    }

    await new Promise(resolve => setTimeout(resolve, ANIMATION_DELAYS.POPUP_CLOSE_LONG));

    disableAllActions(true);
    disableSettingsPopup(true);

    // Update status first, then use centralized flow
    updateStatus('trimming');

    // Use centralized flow for trim action
    const { progressLine, interval: progressInterval } = await prepareActionExecution(
      'Trimming Sparse Image',
      'Trimming sparse image',
      'dots'
    );

    // Execute command using helper (handles validation, execution, cleanup, scrolling)
    const cmd = `sh ${PATH_CHROOT_SH} fstrim`;

    const commandId = executeCommandWithProgress({
      cmd,
      progress: { progressLine, progressInterval },
      onSuccess: (result) => {
        appendConsole('✓ Sparse image trimmed successfully', 'success');
        appendConsole('Space may be reclaimed after a few minutes', 'info');
        appendConsole('━━━ Trim Complete ━━━', 'success');
        if(updateModuleStatus) updateModuleStatus();
        disableAllActions(false);
        disableSettingsPopup(false, true);
        updateSparseInfo();
        setTimeout(() => refreshStatus(), ANIMATION_DELAYS.STATUS_REFRESH);
      },
      onError: (result) => {
        appendConsole('✗ Sparse image trim failed', 'err');
        appendConsole('This may be expected on some Android kernels', 'warn');
        if(updateModuleStatus) updateModuleStatus();
        disableAllActions(false);
        disableSettingsPopup(false, true);
        updateSparseInfo();
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

  async function resizeSparseImage() {
    const {
      activeCommandId, rootAccessConfirmed, appendConsole, showSizeSelectionDialog,
      showConfirmDialog, closeSettingsPopup, els, ANIMATION_DELAYS, CHROOT_DIR,
      PATH_CHROOT_SH, runCmdSync, ProgressIndicator, disableAllActions,
      disableSettingsPopup, updateSparseInfo, refreshStatus, runCmdAsync, updateStatus,
      updateModuleStatus, prepareActionExecution, executeCommandWithProgress
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
      // Use same method as updateSparseInfo - get visible size (what Android sees)
      const apparentSizeCmd = `ls -lh ${CHROOT_DIR}/rootfs.img | tr -s ' ' | cut -d' ' -f5`;
      const apparentSizeStr = await runCmdSync(apparentSizeCmd);
      const apparentSize = apparentSizeStr.trim();
      // Extract numeric value and unit, remove .0 if present (e.g., "8.0G" -> "8GB", "8G" -> "8GB")
      currentAllocatedGb = apparentSize.replace(/\.0G$/, 'GB').replace(/G$/, 'GB');
    } catch(e) {
      // Keep as 'Unknown' if we can't determine
    }

    const confirmed = await showConfirmDialog(
      'Resize Sparse Image',
      `⚠️ EXTREME WARNING: This operation can CORRUPT your filesystem!\n\nYou MUST create a backup before proceeding.\n\nDO NOT close this window or interrupt the process.\n\nCurrent allocated: ${currentAllocatedGb}\nNew size: ${newSizeGb}GB\n\n${parseInt(newSizeGb) > parseInt(currentAllocatedGb) ? 'Operation: GROWING (safer)' : 'Operation: SHRINKING (VERY RISKY)'}\n\nContinue?`,
      'Resize',
      'Cancel'
    );

    if(!confirmed) return;

    closeSettingsPopup();
    const sparsePopup = els.sparseSettingsPopup;
    if(sparsePopup && sparsePopup.classList.contains('active')) {
      sparsePopup.classList.remove('active');
    }

    await new Promise(resolve => setTimeout(resolve, ANIMATION_DELAYS.POPUP_CLOSE_LONG));

    disableAllActions(true);
    disableSettingsPopup(true);

    // Update status first, then use centralized flow
    updateStatus('resizing');

    // Use centralized flow for resize action
    const { progressLine, interval: progressInterval } = await prepareActionExecution(
      `Resizing Sparse Image to ${newSizeGb}GB`,
      'Preparing resize operation',
      'dots'
    );

    // Execute command using helper (handles validation, execution, cleanup, scrolling)
    const cmd = `sh ${PATH_CHROOT_SH} resize --webui ${newSizeGb}`;

    const commandId = executeCommandWithProgress({
      cmd,
      progress: { progressLine, progressInterval },
      onSuccess: (result) => {
        appendConsole('✅ Sparse image resized successfully', 'success');
        appendConsole(`New size: ${newSizeGb}GB`, 'info');
        appendConsole('━━━ Resize Complete ━━━', 'success');
        if(updateModuleStatus) updateModuleStatus();
        disableAllActions(false);
        disableSettingsPopup(false, true);
        updateSparseInfo();
        setTimeout(() => refreshStatus(), ANIMATION_DELAYS.STATUS_REFRESH);
      },
      onError: (result) => {
        appendConsole('✗ Sparse image resize failed', 'err');
        appendConsole('Check the logs above for details', 'err');
        appendConsole('━━━ Resize Failed ━━━', 'err');
        if(updateModuleStatus) updateModuleStatus();
        disableAllActions(false);
        disableSettingsPopup(false, true);
        updateSparseInfo();
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

  window.ResizeFeature = {
    init,
    trimSparseImage,
    resizeSparseImage
  };
})(window);

