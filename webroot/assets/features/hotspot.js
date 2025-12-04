// Hotspot Feature Module
// This entire crap is AI generated, don't blame me for the mess

(function(window) {
  'use strict';

  let dependencies = {};

  function init(deps) {
    dependencies = deps;
  }

  function populateInterfaces(interfacesRaw, forceRefresh = false) {
    const { Storage } = dependencies;
    const select = document.getElementById('hotspot-iface');
    if(!select) return;

    select.innerHTML = '';

    // Filter out ap0 interface - it should never be shown
    const filteredInterfaces = interfacesRaw.filter(ifaceRaw => {
      const trimmed = ifaceRaw.trim();
      if(trimmed.includes(':')) {
        const [iface] = trimmed.split(':');
        return iface.trim() !== 'ap0';
      }
      return trimmed !== 'ap0';
    });

    if(filteredInterfaces.length === 0) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No interfaces found';
      select.appendChild(option);
      select.disabled = true;
      return;
    }

    filteredInterfaces.forEach(ifaceRaw => {
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

    // Try to restore previously selected interface or use saved hotspot settings
    const savedHotspotIface = Storage.get('chroot_hotspot_iface') || Storage.get('chroot_selected_interface');
    if(savedHotspotIface) {
      const exactMatch = Array.from(select.options).find(opt => opt.value === savedHotspotIface);
      if(exactMatch) {
        select.value = savedHotspotIface;
      } else if(interfacesRaw.length > 0) {
        const firstIface = interfacesRaw[0].trim();
        select.value = firstIface.includes(':') ? firstIface.split(':')[0].trim() : firstIface;
      }
    } else if(interfacesRaw.length > 0) {
      // Default to first interface or 'wlan0' if available
      const wlan0Option = Array.from(select.options).find(opt => opt.value === 'wlan0');
      if(wlan0Option) {
        select.value = 'wlan0';
      } else {
        const firstIface = interfacesRaw[0].trim();
        select.value = firstIface.includes(':') ? firstIface.split(':')[0].trim() : firstIface;
      }
    }
  }

  async function fetchInterfaces(forceRefresh = false, backgroundOnly = false) {
    const { rootAccessConfirmed, runCmdSync, FORWARD_NAT_SCRIPT, appendConsole, Storage } = dependencies;

    if(!rootAccessConfirmed.value) {
      return;
    }

    const cached = Storage.getJSON('chroot_hotspot_interfaces_cache');
    const select = document.getElementById('hotspot-iface');

    // Strategy: Show cached data immediately if available, only fetch if cache is empty or forced
    // When opening popup: show cache only, NO background refresh (that causes lag!)
    // Background refresh only happens on refresh button or pre-fetch

    // If we have cache and not forcing refresh, show it immediately and return
    // NO background refresh when opening popup - that's what causes the lag!
    if(cached && Array.isArray(cached) && cached.length > 0 && !forceRefresh) {
      if(!backgroundOnly && select) {
        // Filter out ap0 from cached data (in case old cache contains it)
        const filteredCached = cached.filter(ifaceRaw => {
          const trimmed = ifaceRaw.trim();
          if(trimmed.includes(':')) {
            const [iface] = trimmed.split(':');
            return iface.trim() !== 'ap0';
          }
          return trimmed !== 'ap0';
        });
        populateInterfaces(filteredCached);
      }
      // Return immediately - don't fetch in background when opening popup
      return;
    }

    // No cache or force refresh - fetch now (only if cache is empty or forced)
    // This should only happen if cache is empty, or when refresh button is clicked
    try {
      const cmd = `sh ${FORWARD_NAT_SCRIPT} list-all-iface`;
      const out = await runCmdSync(cmd);
      const interfacesRaw = String(out || '').trim().split(',').filter(i => i && i.length > 0);

      // Filter out ap0 before caching
      const filteredForCache = interfacesRaw.filter(ifaceRaw => {
        const trimmed = ifaceRaw.trim();
        if(trimmed.includes(':')) {
          const [iface] = trimmed.split(':');
          return iface.trim() !== 'ap0';
        }
        return trimmed !== 'ap0';
      });

      // Always update cache (without ap0)
      Storage.setJSON('chroot_hotspot_interfaces_cache', filteredForCache);

      // Only populate UI if not background-only mode
      if(!backgroundOnly && select) {
        populateInterfaces(filteredForCache);
      }
    } catch(e) {
      if(!backgroundOnly) {
        appendConsole(`Could not fetch interfaces: ${e.message}`, 'warn');
        if(select) {
          // Clear and add error option
          select.innerHTML = ''; // Clear first
          const errorOption = document.createElement('option');
          errorOption.value = '';
          errorOption.textContent = 'Failed to load interfaces';
          select.appendChild(errorOption);
          select.disabled = true;
        }
      }
    }
  }

  async function openHotspotPopup() {
    showHotspotWarning();

    // Load settings BEFORE opening popup to prevent visible flicker
    // First ensure interfaces are populated (use cache, no fetch)
    await fetchInterfaces(false, false);

    // Load settings and wait for completion before popup becomes visible
    // This ensures all values (especially channel) are set correctly before user sees the popup
    await loadHotspotSettings();

    // Now open the popup - all values should already be correct, no flicker
    dependencies.PopupManager.open(dependencies.els.hotspotPopup);
  }

  function closeHotspotPopup() {
    dependencies.PopupManager.close(dependencies.els.hotspotPopup);
  }

  function showHotspotWarning() {
    const { els, Storage } = dependencies;
    if(!els.hotspotWarning) return;

    const dismissed = Storage.getBoolean('hotspot_warning_dismissed');
    if(dismissed) {
      els.hotspotWarning.classList.add('hidden');
    } else {
      els.hotspotWarning.classList.remove('hidden');
    }
  }

  function dismissHotspotWarning() {
    const { els, Storage } = dependencies;
    if(!els.hotspotWarning) return;

    els.hotspotWarning.classList.add('hidden');
    Storage.set('hotspot_warning_dismissed', true);
  }

  function saveHotspotSettings() {
    const { Storage } = dependencies;
    const ifaceEl = document.getElementById('hotspot-iface');
    const ssidEl = document.getElementById('hotspot-ssid');
    const passwordEl = document.getElementById('hotspot-password');
    const bandEl = document.getElementById('hotspot-band');
    const channelEl = document.getElementById('hotspot-channel');

    if(!ifaceEl || !ssidEl || !passwordEl || !bandEl || !channelEl) {
      return; // Elements not ready yet
    }

    const iface = ifaceEl.value;
    const settings = {
      iface: iface || '',
      ssid: ssidEl.value || '',
      password: passwordEl.value || '',
      band: bandEl.value || '2',
      channel: channelEl.value || '6'
    };

    Storage.setJSON('chroot_hotspot_settings', settings);
    // Also save interface separately for easier access
    if(iface) Storage.set('chroot_hotspot_iface', iface);
  }

  async function loadHotspotSettings() {
    const { Storage } = dependencies;
    const settings = Storage.getJSON('chroot_hotspot_settings');

    const ifaceSelect = document.getElementById('hotspot-iface');
    const ssidEl = document.getElementById('hotspot-ssid');
    const passwordEl = document.getElementById('hotspot-password');
    const bandEl = document.getElementById('hotspot-band');
    const channelEl = document.getElementById('hotspot-channel');

    if(!ifaceSelect || !ssidEl || !passwordEl || !bandEl || !channelEl) {
      return; // Elements not ready yet
    }

    // Temporarily disable auto-save during load to prevent conflicts
    const originalSave = window.HotspotFeature?.saveHotspotSettings;
    let isLoading = true;
    if(window.HotspotFeature && originalSave) {
      window.HotspotFeature.saveHotspotSettings = function() {
        if(!isLoading) {
          originalSave.call(this);
        }
      };
    }

    if(settings) {
      // Load SSID
      if(settings.ssid) {
        ssidEl.value = settings.ssid;
      }

      // Load password
      if(settings.password) {
        passwordEl.value = settings.password;
      }

      // Load band and channel - Use promise-based update to prevent race condition
      const constants = window.APP_CONSTANTS?.HOTSPOT || {};
      const defaultBand = constants.DEFAULT_BAND || '2';
      const defaultChannel2_4 = constants.DEFAULT_CHANNEL_2_4GHZ || '6';
      const defaultChannel5 = constants.DEFAULT_CHANNEL_5GHZ || '36';

      const band = settings.band || defaultBand;
      const savedChannel = settings.channel ? String(settings.channel) : null;

      // Step 1: Set band value (don't trigger change event)
      bandEl.value = band;

      // Step 2: Update channel options and wait for completion (AWAIT to ensure it's done)
      if(window.updateChannelLimits) {
        await window.updateChannelLimits(band);
        // Step 3: Set channel value AFTER options are populated (promise ensures this)
        // Only update if the value is different to prevent visible flicker
        if(savedChannel && channelEl) {
          const channelExists = Array.from(channelEl.options).some(opt => opt.value === savedChannel);
          if(channelExists) {
            // Only update if different to prevent flicker
            if(channelEl.value !== savedChannel) {
              channelEl.value = savedChannel;
            }
          } else {
            // Channel doesn't exist for this band, use default
            const defaultChannel = band === '5' ? defaultChannel5 : defaultChannel2_4;
            if(channelEl.value !== defaultChannel) {
              channelEl.value = defaultChannel;
            }
          }
        } else if(channelEl) {
          // No saved channel, use default - only update if different
          const defaultChannel = band === '5' ? defaultChannel5 : defaultChannel2_4;
          if(channelEl.value !== defaultChannel) {
            channelEl.value = defaultChannel;
          }
        }
      } else {
        // Fallback if updateChannelLimits not available
        if(channelEl) {
          const targetChannel = savedChannel || (band === '5' ? defaultChannel5 : defaultChannel2_4);
          if(channelEl.value !== targetChannel) {
            channelEl.value = targetChannel;
          }
        }
      }

      // Load interface (must be done after interfaces are populated)
      if(settings.iface && ifaceSelect.options.length > 1) {
        const savedOption = Array.from(ifaceSelect.options).find(opt => opt.value === settings.iface);
        if(savedOption) {
          ifaceSelect.value = settings.iface;
        }
      }
    } else {
      // No saved settings - initialize with defaults
      const constants = window.APP_CONSTANTS?.HOTSPOT || {};
      const defaultBand = constants.DEFAULT_BAND || '2';
      const defaultChannel2_4 = constants.DEFAULT_CHANNEL_2_4GHZ || '6';
      const defaultChannel5 = constants.DEFAULT_CHANNEL_5GHZ || '36';

      const currentBand = bandEl.value || defaultBand;
      if(window.updateChannelLimits) {
        await window.updateChannelLimits(currentBand);
        if(channelEl) {
          const defaultChannel = currentBand === '5' ? defaultChannel5 : defaultChannel2_4;
          // Only update if different to prevent flicker
          if(channelEl.value !== defaultChannel) {
            channelEl.value = defaultChannel;
          }
        }
      } else if(channelEl) {
        const defaultChannel = currentBand === '5' ? defaultChannel5 : defaultChannel2_4;
        if(channelEl.value !== defaultChannel) {
          channelEl.value = defaultChannel;
        }
      }
    }

    // Re-enable save function
    isLoading = false;
    if(window.HotspotFeature && originalSave) {
      window.HotspotFeature.saveHotspotSettings = originalSave;
    }
  }

  async function startHotspot() {
    const {
      withCommandGuard, ANIMATION_DELAYS, HOTSPOT_SCRIPT,
      runCmdSync, ProgressIndicator, appendConsole, disableAllActions,
      disableSettingsPopup, activeCommandId, refreshStatus, hotspotActive,
      saveHotspotStatus, ButtonState, prepareActionExecution, forceScrollAfterDOMUpdate, els
    } = dependencies;

    await withCommandGuard('hotspot-start', async () => {
      const iface = document.getElementById('hotspot-iface').value.trim();
      const ssid = document.getElementById('hotspot-ssid').value.trim();
      const password = document.getElementById('hotspot-password').value;
      const band = document.getElementById('hotspot-band').value;
      const channel = document.getElementById('hotspot-channel').value;

      if(!iface || !ssid || !password || !channel) {
        appendConsole('All fields are required', 'err');
        return;
      }

      const minPasswordLength = window.APP_CONSTANTS?.HOTSPOT?.PASSWORD_MIN_LENGTH || 8;
      if(password.length < minPasswordLength) {
        appendConsole(`Password must be at least ${minPasswordLength} characters`, 'err');
        return;
      }

      saveHotspotSettings();

      closeHotspotPopup();
      await new Promise(resolve => setTimeout(resolve, ANIMATION_DELAYS.POPUP_CLOSE));

      disableAllActions(true);
      disableSettingsPopup(true);

      const actionText = `Starting hotspot '${ssid}'`;
      const { progressLine, interval: progressInterval } = await prepareActionExecution(
        actionText,
        actionText,
        'spinner'
      );

      activeCommandId.value = 'hotspot-start';

      const cmd = `sh ${HOTSPOT_SCRIPT} -o "${iface}" -s "${ssid}" -p "${password}" -b "${band}" -c "${channel}" 2>&1`;

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

          if(output && output.includes('AP-ENABLED')) {
            appendConsole(`✓ Hotspot started successfully`, 'success');
            hotspotActive.value = true;
            saveHotspotStatus();
            ButtonState.setButtonPair(els.startHotspotBtn, els.stopHotspotBtn, true);
          } else {
            appendConsole(`✗ Failed to start hotspot`, 'err');
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

          appendConsole(`✗ Hotspot failed to start`, 'err');

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

  async function stopHotspot() {
    const {
      withCommandGuard, ANIMATION_DELAYS, HOTSPOT_SCRIPT,
      runCmdAsync, ProgressIndicator, appendConsole, disableAllActions,
      disableSettingsPopup, activeCommandId, refreshStatus, hotspotActive,
      saveHotspotStatus, ButtonState, prepareActionExecution, forceScrollAfterDOMUpdate, els
    } = dependencies;

    await withCommandGuard('hotspot-stop', async () => {
      closeHotspotPopup();
      await new Promise(resolve => setTimeout(resolve, ANIMATION_DELAYS.POPUP_CLOSE));

      disableAllActions(true);
      disableSettingsPopup(true);

      const actionText = 'Stopping hotspot';
      const { progressLine, interval: progressInterval } = await prepareActionExecution(
        actionText,
        actionText,
        'spinner'
      );

      activeCommandId.value = 'hotspot-stop';

      const cmd = `sh ${HOTSPOT_SCRIPT} -k 2>&1`;

      setTimeout(() => {
        runCmdAsync(cmd, (result) => {
          ProgressIndicator.remove(progressLine, progressInterval);

          if(result.success) {
            appendConsole(`✓ Hotspot stopped successfully`, 'success');
            hotspotActive.value = false;
            saveHotspotStatus();
            ButtonState.setButtonPair(els.startHotspotBtn, els.stopHotspotBtn, false);
          } else {
            appendConsole(`✗ Failed to stop hotspot (exit code: ${result.exitCode || 'unknown'})`, 'err');
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

  function refreshInterfaces() {
    fetchInterfaces(true); // Force refresh
  }

  window.HotspotFeature = {
    init,
    openHotspotPopup,
    closeHotspotPopup,
    showHotspotWarning,
    dismissHotspotWarning,
    saveHotspotSettings,
    loadHotspotSettings,
    startHotspot,
    stopHotspot,
    fetchInterfaces,
    refreshInterfaces
  };
})(window);

