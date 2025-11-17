// Hotspot Feature Module
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
        populateInterfaces(cached);
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

      // Always update cache
      Storage.setJSON('chroot_hotspot_interfaces_cache', interfacesRaw);

      // Only populate UI if not background-only mode
      if(!backgroundOnly && select) {
        populateInterfaces(interfacesRaw);
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

  function openHotspotPopup() {
    showHotspotWarning();
    dependencies.PopupManager.open(dependencies.els.hotspotPopup);
    // Only show cached interfaces - NO fetching (that causes lag!)
    // Fetch only happens if cache is empty
    fetchInterfaces(false, false);
    // Load saved settings AFTER interfaces are populated
    // Use setTimeout to ensure interfaces are loaded first
    // Increased delay to ensure channel options are fully populated
    const { ANIMATION_DELAYS } = dependencies;
    setTimeout(() => {
      loadHotspotSettings();
      // Double-check channel value after a brief delay to catch any race conditions
      setTimeout(() => {
        const settings = dependencies.Storage.getJSON('chroot_hotspot_settings');
        if(settings && settings.channel) {
          const channelEl = document.getElementById('hotspot-channel');
          if(channelEl && channelEl.value !== settings.channel) {
            // Channel was reset, restore it
            const channelExists = Array.from(channelEl.options).some(opt => opt.value === settings.channel);
            if(channelExists) {
              channelEl.value = settings.channel;
            }
          }
        }
      }, ANIMATION_DELAYS.CHANNEL_VERIFY);
    }, ANIMATION_DELAYS.SETTINGS_LOAD);
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

  function loadHotspotSettings() {
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
    
    if(settings) {
      // Load SSID
      if(settings.ssid) {
        ssidEl.value = settings.ssid;
      }
      
      // Load password
      if(settings.password) {
        passwordEl.value = settings.password;
      }
      
      // Load band FIRST, then update channel options, then restore saved channel
      const band = settings.band || '2';
      const savedChannel = settings.channel;
      
      // Temporarily disable auto-save during load
      const originalSave = window.HotspotFeature?.saveHotspotSettings;
      let isLoading = true;
      if(window.HotspotFeature) {
        window.HotspotFeature.saveHotspotSettings = function() {
          if(!isLoading) {
            originalSave.call(this);
          }
        };
      }
      
      // Set band value - only trigger change if it's different
      const currentBand = bandEl.value;
      if(currentBand !== band) {
        bandEl.value = band;
        // Manually trigger updateChannelLimits if band changed
        if(window.updateChannelLimits) {
          window.updateChannelLimits();
        }
      } else {
        // Band is same, but still need to ensure channel options are populated
        if(window.updateChannelLimits) {
          window.updateChannelLimits();
        }
      }
      
      // Restore saved channel AFTER options are populated
      if(savedChannel && channelEl) {
        // Wait a tiny bit to ensure DOM is updated
        requestAnimationFrame(() => {
          // Force set the channel value multiple times to ensure it sticks
          const setChannel = () => {
            const channelExists = Array.from(channelEl.options).some(opt => opt.value === savedChannel);
            if(channelExists) {
              channelEl.value = savedChannel;
              // Double-check
              if(channelEl.value !== savedChannel) {
                channelEl.value = savedChannel; // Try again
              }
            } else {
              // Channel doesn't exist for this band, use default
              channelEl.value = band === '5' ? '36' : '6';
            }
          };
          
          setChannel();
          // Verify after a brief delay
          const { ANIMATION_DELAYS } = dependencies;
          setTimeout(() => {
            if(channelEl.value !== savedChannel) {
              const channelExists = Array.from(channelEl.options).some(opt => opt.value === savedChannel);
              if(channelExists) {
                channelEl.value = savedChannel;
              }
            }
          }, ANIMATION_DELAYS.UI_UPDATE || 50); // Use UI_UPDATE delay for consistency
        });
      } else if(channelEl) {
        channelEl.value = band === '5' ? '36' : '6';
      }
      
      // Re-enable save function after a brief delay
      setTimeout(() => {
        isLoading = false;
        if(window.HotspotFeature && originalSave) {
          window.HotspotFeature.saveHotspotSettings = originalSave;
        }
      }, 200);
      
      // Load interface (must be done after interfaces are populated)
      if(settings.iface && ifaceSelect.options.length > 1) {
        const savedOption = Array.from(ifaceSelect.options).find(opt => opt.value === settings.iface);
        if(savedOption) {
          ifaceSelect.value = settings.iface;
        }
      }
    } else {
      // No saved settings - initialize with defaults
      if(window.updateChannelLimits) {
        window.updateChannelLimits();
      }
    }
  }

  async function startHotspot() {
    const {
      withCommandGuard, ANIMATION_DELAYS, HOTSPOT_SCRIPT,
      runCmdSync, ProgressIndicator, appendConsole, disableAllActions,
      disableSettingsPopup, activeCommandId, refreshStatus, hotspotActive,
      saveHotspotStatus, ButtonState, els
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

      if(password.length < 8) {
        appendConsole('Password must be at least 8 characters', 'err');
        return;
      }

      saveHotspotSettings();

      closeHotspotPopup();
      await new Promise(resolve => setTimeout(resolve, ANIMATION_DELAYS.POPUP_CLOSE));

      const actionText = `Starting hotspot '${ssid}'`;
      appendConsole(`━━━ ${actionText} ━━━`, 'info');
      
      const { progressLine, interval: progressInterval } = ProgressIndicator.create(actionText, 'spinner');
      
      disableAllActions(true);
      disableSettingsPopup(true);
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
      saveHotspotStatus, ButtonState, els
    } = dependencies;

    await withCommandGuard('hotspot-stop', async () => {
      closeHotspotPopup();
      await new Promise(resolve => setTimeout(resolve, ANIMATION_DELAYS.POPUP_CLOSE));

      const actionText = 'Stopping hotspot';
      appendConsole(`━━━ ${actionText} ━━━`, 'info');

      const { progressLine, interval: progressInterval } = ProgressIndicator.create(actionText, 'spinner');

      disableAllActions(true);
      disableSettingsPopup(true);
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

