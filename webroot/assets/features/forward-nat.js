// Forward NAT Feature Module
(function(window) {
  'use strict';

  // This module will be initialized with dependencies from app.js
  let dependencies = {};

  function init(deps) {
    dependencies = deps;
  }

  function loadForwardingStatus() {
    const { StateManager, forwardingActive } = dependencies;
    forwardingActive.value = StateManager.get('forwarding');
  }

  function saveForwardingStatus() {
    const { StateManager, forwardingActive } = dependencies;
    StateManager.set('forwarding', forwardingActive.value);
  }

  function populateInterfaces(interfacesRaw) {
    const { els, Storage } = dependencies;
    const select = els.forwardNatIface;
    select.innerHTML = '';

    if(interfacesRaw.length === 0) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No interfaces found';
      select.appendChild(option);
      select.disabled = true;
      return;
    }

    interfacesRaw.forEach(ifaceRaw => {
      const trimmed = ifaceRaw.trim();
      if(trimmed.length > 0) {
        const option = document.createElement('option');

        if(trimmed.includes(':')) {
          const [iface, ip] = trimmed.split(':');
          option.value = iface.trim();
          option.textContent = `${iface.trim()} (${ip.trim()})`;
        } else {
          option.value = trimmed;
          option.textContent = trimmed;
        }

        select.appendChild(option);
      }
    });

    select.disabled = false;

    const savedIface = Storage.get('chroot_selected_interface');
    if(savedIface) {
      const exactMatch = Array.from(select.options).find(opt => opt.value === savedIface);
      if(exactMatch) {
        select.value = savedIface;
      } else if(interfacesRaw.length > 0) {
        const firstIface = interfacesRaw[0].trim();
        select.value = firstIface.includes(':') ? firstIface.split(':')[0].trim() : firstIface;
      }
    } else if(interfacesRaw.length > 0) {
      const firstIface = interfacesRaw[0].trim();
      select.value = firstIface.includes(':') ? firstIface.split(':')[0].trim() : firstIface;
    }
  }

  async function fetchInterfaces(forceRefresh = false, backgroundOnly = false) {
    const { rootAccessConfirmed, runCmdSync, FORWARD_NAT_SCRIPT, Storage, appendConsole, els } = dependencies;

    if(!rootAccessConfirmed.value) {
      return;
    }

    const cached = Storage.getJSON('chroot_forward_nat_interfaces_cache');

    // Strategy: Show cached data immediately if available, only fetch if cache is empty or forced
    // When opening popup: show cache only, NO background refresh (that causes lag!)
    // Background refresh only happens on refresh button or pre-fetch

    // If we have cache and not forcing refresh, show it immediately and return
    // NO background refresh when opening popup - that's what causes the lag!
    if(cached && Array.isArray(cached) && cached.length > 0 && !forceRefresh) {
      if(!backgroundOnly) {
        populateInterfaces(cached);
      }
      // Return immediately - don't fetch in background when opening popup
      return;
    }

    // No cache or force refresh - fetch now (only if cache is empty or forced)
    // This should only happen if cache is empty, or when refresh button is clicked
    try {
      const cmd = `sh ${FORWARD_NAT_SCRIPT} list-iface`;
      const out = await runCmdSync(cmd);
      const interfacesRaw = String(out || '').trim().split(',').filter(i => i && i.length > 0);

      // Always update cache
      Storage.setJSON('chroot_forward_nat_interfaces_cache', interfacesRaw);

      // Only populate UI if not background-only mode
      if(!backgroundOnly) {
        populateInterfaces(interfacesRaw);
      }
    } catch(e) {
      if(!backgroundOnly) {
        appendConsole(`Could not fetch interfaces: ${e.message}`, 'warn');
        // Clear and add error option
        els.forwardNatIface.innerHTML = ''; // Clear first
        const errorOption = document.createElement('option');
        errorOption.value = '';
        errorOption.textContent = 'Failed to load interfaces';
        els.forwardNatIface.appendChild(errorOption);
        els.forwardNatIface.disabled = true;
      }
    }
  }

  function openForwardNatPopup() {
    dependencies.PopupManager.open(dependencies.els.forwardNatPopup);
    // Only show cached interfaces - NO fetching (that causes lag!)
    // Fetch only happens if cache is empty
    fetchInterfaces(false, false);
  }

  function refreshInterfaces() {
    fetchInterfaces(true); // Force refresh
  }

  function closeForwardNatPopup() {
    dependencies.PopupManager.close(dependencies.els.forwardNatPopup);
  }

  async function startForwarding() {
    const {
      withCommandGuard, els, Storage, ANIMATION_DELAYS,
      FORWARD_NAT_SCRIPT, runCmdSync, ProgressIndicator, appendConsole,
      disableAllActions, disableSettingsPopup, activeCommandId, refreshStatus,
      forwardingActive, saveForwardingStatus, ButtonState, prepareActionExecution, forceScrollAfterDOMUpdate
    } = dependencies;

    await withCommandGuard('forwarding-start', async () => {
      const iface = els.forwardNatIface.value.trim();
      if(!iface) {
        appendConsole('Please select a network interface', 'err');
        return;
      }

      Storage.set('chroot_selected_interface', iface);
      closeForwardNatPopup();
      await new Promise(resolve => setTimeout(resolve, ANIMATION_DELAYS.POPUP_CLOSE));

      disableAllActions(true);
      disableSettingsPopup(true);

      const actionText = `Starting forwarding on ${iface}`;
      const { progressLine, interval: progressInterval } = await prepareActionExecution(
        actionText,
        actionText,
        'spinner'
      );

      activeCommandId.value = 'forwarding-start';

      const cmd = `sh ${FORWARD_NAT_SCRIPT} -i "${iface}" 2>&1`;

      setTimeout(async () => {
        try {
          const output = await runCmdSync(cmd);
          ProgressIndicator.remove(progressLine, progressInterval);

          if(output) {
            const lines = String(output).split('\n');
            lines.forEach(line => {
              if(line.trim()) {
                appendConsole(line);
              }
            });
          }

          if(output && (output.includes('Localhost routing active') || output.includes('Gateway:'))) {
            appendConsole(`✓ Forwarding started successfully on ${iface}`, 'success');
            forwardingActive.value = true;
            saveForwardingStatus();
            ButtonState.setButtonPair(els.startForwardingBtn, els.stopForwardingBtn, true);
          } else {
            appendConsole(`✗ Failed to start forwarding`, 'err');
          }

          // Force scroll to bottom after completion messages
          forceScrollAfterDOMUpdate();
        } catch(error) {
          ProgressIndicator.remove(progressLine, progressInterval);

          const errorMsg = String(error.message || error);
          const lines = errorMsg.split('\n');
          lines.forEach(line => {
            if(line.trim()) {
              appendConsole(line, 'err');
            }
          });

          appendConsole(`✗ Forwarding failed to start`, 'err');

          // Force scroll to bottom after error messages
          forceScrollAfterDOMUpdate();
        } finally {
          activeCommandId.value = null;
          disableAllActions(false);
          disableSettingsPopup(false, true);
          setTimeout(() => refreshStatus(), ANIMATION_DELAYS.STATUS_REFRESH);
        }
      }, ANIMATION_DELAYS.UI_UPDATE);
    });
  }

  async function stopForwarding() {
    const {
      withCommandGuard, ANIMATION_DELAYS, FORWARD_NAT_SCRIPT,
      runCmdAsync, ProgressIndicator, appendConsole, disableAllActions,
      disableSettingsPopup, activeCommandId, refreshStatus, forwardingActive,
      saveForwardingStatus, ButtonState, prepareActionExecution, forceScrollAfterDOMUpdate, els
    } = dependencies;

    await withCommandGuard('forwarding-stop', async () => {
      closeForwardNatPopup();
      await new Promise(resolve => setTimeout(resolve, ANIMATION_DELAYS.POPUP_CLOSE));

      disableAllActions(true);
      disableSettingsPopup(true);

      const actionText = 'Stopping forwarding';
      const { progressLine, interval: progressInterval } = await prepareActionExecution(
        actionText,
        actionText,
        'spinner'
      );

      activeCommandId.value = 'forwarding-stop';

      const cmd = `sh ${FORWARD_NAT_SCRIPT} -k 2>&1`;

      setTimeout(() => {
        runCmdAsync(cmd, (result) => {
          ProgressIndicator.remove(progressLine, progressInterval);

          // Always clear the state marker, even if there were errors
          forwardingActive.value = false;
          saveForwardingStatus();
          ButtonState.setButtonPair(els.startForwardingBtn, els.stopForwardingBtn, false);

          if(result.success) {
            appendConsole(`✓ Forwarding stopped successfully`, 'success');
          } else {
            // Check output for warnings - script now warns instead of exiting
            const output = result.output || '';
            if(output.includes('warn') || output.includes('WARN') || output.includes('warning')) {
              appendConsole(`⚠ Forwarding cleanup completed with warnings`, 'warn');
              if(output.trim()) {
                const lines = output.split('\n');
                lines.forEach(line => {
                  if(line.trim() && !line.trim().startsWith('[Executing:')) {
                    appendConsole(line.trim(), 'warn');
                  }
                });
              }
            } else {
              appendConsole(`⚠ Forwarding stop completed (some rules may not have existed)`, 'warn');
              if(output.trim()) {
                const lines = output.split('\n');
                lines.forEach(line => {
                  if(line.trim() && !line.trim().startsWith('[Executing:')) {
                    appendConsole(line.trim());
                  }
                });
              }
            }
          }

          // Force scroll to bottom after completion messages
          forceScrollAfterDOMUpdate();

          activeCommandId.value = null;
          disableAllActions(false);
          disableSettingsPopup(false, true);

          setTimeout(() => refreshStatus(), ANIMATION_DELAYS.STATUS_REFRESH);
        });
      }, ANIMATION_DELAYS.UI_UPDATE);
    });
  }

  // Export public API
  window.ForwardNatFeature = {
    init,
    loadForwardingStatus,
    saveForwardingStatus,
    fetchInterfaces,
    openForwardNatPopup,
    closeForwardNatPopup,
    startForwarding,
    stopForwarding,
    refreshInterfaces
  };
})(window);
