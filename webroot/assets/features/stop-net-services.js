// Stop Network Services Feature Module
// Centralized module for stopping hotspot and forward-nat services
// This entire crap is AI generated, don't blame me for the mess

(function(window) {
  'use strict';

  let dependencies = {};

  function init(deps) {
    dependencies = deps;
  }

  /**
   * Stop all network services (hotspot and forward-nat)
   * Called before stopping/restarting chroot or during backup/restore/uninstall/migrate
   * @param {Object} options - Configuration options
   * @param {Object} options.progressLine - Optional progress indicator line to update
   * @param {boolean} options.silent - If true, don't log messages (default: false)
   * @returns {Promise<Object>} Object with stopped services status
   */
  async function stopNetworkServices(options = {}) {
    const {
      HOTSPOT_SCRIPT,
      FORWARD_NAT_SCRIPT,
      runCmdAsync,
      appendConsole,
      ProgressIndicator,
      checkAp0Interface,
      checkForwardNatRunning,
      hotspotActive,
      forwardingActive,
      StateManager,
      hotspotActiveRef,
      forwardingActiveRef
    } = dependencies;

    const { progressLine = null, silent = false } = options;
    const results = {
      hotspot: { wasRunning: false, stopped: false },
      forwardNat: { wasRunning: false, stopped: false }
    };

    // Stop hotspot if running
    try {
      results.hotspot.wasRunning = await checkAp0Interface();
      if(results.hotspot.wasRunning) {
        if(progressLine) {
          ProgressIndicator.update(progressLine, 'Stopping hotspot first');
        }
        if(!silent) {
          appendConsole('Stopping hotspot before operation...', 'info');
        }

        await new Promise((resolve) => {
          runCmdAsync(`sh ${HOTSPOT_SCRIPT} -k 2>&1`, (result) => {
            if(result.success) {
              results.hotspot.stopped = true;
              if(!silent) {
                appendConsole('✓ Hotspot stopped successfully', 'success');
              }
              // Update state through StateManager
              hotspotActive.value = false;
              StateManager.set('hotspot', false);
              if(hotspotActiveRef) hotspotActiveRef.value = false;
            } else {
              if(!silent) {
                appendConsole('✗ Failed to stop hotspot, continuing with operation', 'warn');
              }
            }
            resolve();
          });
        });
      }
    } catch(e) {
      if(!silent) {
        appendConsole('⚠ Could not check hotspot status, proceeding with operation', 'warn');
      }
    }

    // Stop forward-nat if running
    try {
      results.forwardNat.wasRunning = await checkForwardNatRunning();
      if(results.forwardNat.wasRunning) {
        if(progressLine) {
          ProgressIndicator.update(progressLine, 'Stopping forward NAT first');
        }
        if(!silent) {
          appendConsole('Stopping forward NAT before operation...', 'info');
        }

        await new Promise((resolve) => {
          runCmdAsync(`sh ${FORWARD_NAT_SCRIPT} -k 2>&1`, (result) => {
            if(result.success) {
              results.forwardNat.stopped = true;
              if(!silent) {
                appendConsole('✓ Forward NAT stopped successfully', 'success');
              }
              // Update state through StateManager
              forwardingActive.value = false;
              StateManager.set('forwarding', false);
              if(forwardingActiveRef) forwardingActiveRef.value = false;
            } else {
              if(!silent) {
                appendConsole('✗ Failed to stop forward NAT, continuing with operation', 'warn');
              }
            }
            resolve();
          });
        });
      }
    } catch(e) {
      if(!silent) {
        appendConsole('⚠ Could not check forward NAT status, proceeding with operation', 'warn');
      }
    }

    return results;
  }

  window.StopNetServices = {
    init,
    stopNetworkServices
  };
})(window);

