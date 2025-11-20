// Chroot Control UI - Real-time async execution with non-blocking interface
(function(){
  // Use hardcoded paths provided by install.sh
  const CHROOT_DIR = '/data/local/ubuntu-chroot';
  const PATH_CHROOT_SH = `${CHROOT_DIR}/chroot.sh`;
  const CHROOT_PATH_UI = `${CHROOT_DIR}/rootfs`;
  const BOOT_FILE = `${CHROOT_DIR}/boot-service`;
  const POST_EXEC_SCRIPT = `${CHROOT_DIR}/post_exec.sh`;
  const HOTSPOT_SCRIPT = `${CHROOT_DIR}/start-hotspot`;
  const FORWARD_NAT_SCRIPT = `${CHROOT_DIR}/forward-nat.sh`;
  const OTA_UPDATER = `${CHROOT_DIR}/ota/updater.sh`;
  const LOG_DIR = `${CHROOT_DIR}/logs`;

  const els = {
    statusDot: document.getElementById('status-dot'),
    statusText: document.getElementById('status-text'),
    startBtn: document.getElementById('start-btn'),
    stopBtn: document.getElementById('stop-btn'),
    restartBtn: document.getElementById('restart-btn'),
    console: document.getElementById('console'),
    clearConsole: document.getElementById('clear-console'),
    copyConsole: document.getElementById('copy-console'),
    refreshStatus: document.getElementById('refresh-status'),
    bootToggle: document.getElementById('boot-toggle'),
    themeToggle: document.getElementById('theme-toggle'),
    userSelect: document.getElementById('user-select'),
    settingsBtn: document.getElementById('settings-btn'),
    settingsPopup: document.getElementById('settings-popup'),
    closePopup: document.getElementById('close-popup'),
    postExecScript: document.getElementById('post-exec-script'),
    saveScript: document.getElementById('save-script'),
    clearScript: document.getElementById('clear-script'),
    updateBtn: document.getElementById('update-btn'),
    backupBtn: document.getElementById('backup-btn'),
    debugToggle: document.getElementById('debug-toggle'),
    startHotspotBtn: document.getElementById('start-hotspot-btn'),
    stopHotspotBtn: document.getElementById('stop-hotspot-btn'),
    hotspotForm: document.getElementById('hotspot-form'),
    hotspotWarning: document.getElementById('hotspot-warning'),
    dismissHotspotWarning: document.getElementById('dismiss-hotspot-warning'),
    sparseSettingsBtn: document.getElementById('sparse-settings-btn'),
    sparseSettingsPopup: document.getElementById('sparse-settings-popup'),
    closeSparsePopup: document.getElementById('close-sparse-popup'),
    trimSparseBtn: document.getElementById('trim-sparse-btn'),
    resizeSparseBtn: document.getElementById('resize-sparse-btn'),
    sparseInfo: document.getElementById('sparse-info'),
    restoreBtn: document.getElementById('restore-btn'),
    uninstallBtn: document.getElementById('uninstall-btn'),
    hotspotBtn: document.getElementById('hotspot-btn'),
    hotspotPopup: document.getElementById('hotspot-popup'),
    closeHotspotPopup: document.getElementById('close-hotspot-popup'),
    forwardNatBtn: document.getElementById('forward-nat-btn'),
    forwardNatPopup: document.getElementById('forward-nat-popup'),
    closeForwardNatPopup: document.getElementById('close-forward-nat-popup'),
    forwardNatIface: document.getElementById('forward-nat-iface'),
    startForwardingBtn: document.getElementById('start-forwarding-btn'),
    stopForwardingBtn: document.getElementById('stop-forwarding-btn')
  };

  // Track running commands to prevent UI blocking
  let activeCommandId = null;

  // Track hotspot state - much more reliable than filesystem checks
  let hotspotActive = false;

  // Track forward-nat state
  let forwardingActive = false;

  // Feature module state refs (will be set by initFeatureModules)
  let activeCommandIdRef = null;
  let rootAccessConfirmedRef = null;
  let hotspotActiveRef = null;
  let forwardingActiveRef = null;
  let sparseMigratedRef = null;

  // Track debug mode state
  let debugModeActive = false;

  // Track sparse image migration status
  let sparseMigrated = false;

  // Hotspot status loading/saving is now handled by HotspotFeature module
  // These functions are kept for backward compatibility during initialization
  function loadHotspotStatus(){
    hotspotActive = StateManager.get('hotspot');
  }

  /**
   * Load debug mode status from localStorage on page load
   */
  function loadDebugMode(){
    debugModeActive = StateManager.get('debug');
    updateDebugIndicator();
  }

  /**
   * Save debug mode status to localStorage
   */
  function saveDebugMode(){
    StateManager.set('debug', debugModeActive);
  }

  /**
   * Update the debug indicator visibility in the header
   */
  function updateDebugIndicator(){
    const indicator = document.getElementById('debug-indicator');
    if(indicator){
      // Use class instead of inline style
      if(debugModeActive) {
        indicator.classList.remove('debug-indicator-hidden');
      } else {
        indicator.classList.add('debug-indicator-hidden');
      }
    }
  }

  // Track if chroot missing message was logged
  let _chrootMissingLogged = false;

  // Start with actions disabled until we verify the chroot exists
  disableAllActions(true);

  /**
   * Save console logs to localStorage
   * Limits to max lines to prevent localStorage overflow
   */
  function saveConsoleLogs(){
    const lines = els.console.querySelectorAll('div');
    const maxLines = APP_CONSTANTS.CONSOLE.MAX_LINES;
    if(lines.length > maxLines) {
      // Remove oldest lines
      const toRemove = lines.length - maxLines;
      Array.from(lines).slice(0, toRemove).forEach(line => line.remove());
    }
    // Save current state
    const logs = els.console.innerHTML;
    Storage.set('chroot_console_logs', logs);
  }

  /**
   * Load console logs from localStorage
   * Enforces max line limit when loading
   * Always scrolls to bottom instantly on page load (no animation)
   * Completely rewritten from scratch - aggressive scroll-to-bottom approach
   */
  function loadConsoleLogs(){
    const logs = Storage.get('chroot_console_logs');
    if(!logs || !els.console) return;
    
    const pre = els.console;
    
    // CRITICAL: Disable smooth scrolling BEFORE any operations
    // Use setProperty to ensure it overrides CSS
    pre.style.setProperty('scroll-behavior', 'auto', 'important');
    
    // Set content
    pre.innerHTML = logs;
    
    // Enforce max line limit
    const lines = pre.querySelectorAll('div');
    const maxLines = APP_CONSTANTS.CONSOLE.MAX_LINES;
    if(lines.length > maxLines) {
      const toRemove = lines.length - maxLines;
      Array.from(lines).slice(0, toRemove).forEach(line => line.remove());
      saveConsoleLogs();
    }
    
    // Apply fade-in animation if console has < 15 lines and no scrollbar
    const finalLines = pre.querySelectorAll('div');
    const hasScrollbar = pre.scrollHeight > pre.clientHeight;
    const shouldAnimate = finalLines.length < 15 && !hasScrollbar;
    
    if(shouldAnimate) {
      // Use requestAnimationFrame for smoother initial render
      requestAnimationFrame(() => {
        finalLines.forEach((line, index) => {
          // Skip progress indicators - they appear immediately
          if(!line.classList.contains('progress-indicator')) {
            line.classList.add('log-fade-in');
            line.style.animationDelay = `${index * 45}ms`; // 45ms stagger per line (slightly faster)
          } else {
            line.classList.add('log-immediate');
          }
        });
      });
    }
    
    // Aggressive scroll-to-bottom: try multiple times to ensure it sticks
    // The browser might reset scroll position, so we force it multiple times
    function forceScrollToBottom() {
      // Force layout recalculation
      void pre.offsetHeight;
      // Set scroll position directly
      pre.scrollTop = pre.scrollHeight;
    }
    
    // Try immediately
    forceScrollToBottom();
    
    // Try after one frame (browser has calculated layout)
    requestAnimationFrame(() => {
      forceScrollToBottom();
      // Try one more time after a microtask (ensures all rendering is done)
      Promise.resolve().then(() => {
        forceScrollToBottom();
        // Restore smooth scrolling for future interactions
        pre.style.removeProperty('scroll-behavior');
      });
    });
  }

  /**
   * Fetch available users from chroot using list-users command
   */
  async function fetchUsers(){
    if(!rootAccessConfirmed){
      return; // Don't attempt command - root check already printed error
    }
    
    try{
      // Use the new list-users command that runs inside the chroot
      const cmd = `sh ${PATH_CHROOT_SH} list-users`;
      const out = await runCmdSync(cmd);
      const users = String(out || '').trim().split(',').filter(u => u && u.length > 0);

      // Clear existing options except root
      const select = els.userSelect;
      select.innerHTML = '<option value="root">root</option>';

      // Add user options
      users.forEach(user => {
        if(user.length > 0){
          const option = document.createElement('option');
          option.value = user;
          option.textContent = user;
          select.appendChild(option);
        }
      });

      // Try to restore previously selected user
      const savedUser = Storage.get('chroot_selected_user');
      if(savedUser && select.querySelector(`option[value="${savedUser}"]`)){
        select.value = savedUser;
      }

      appendConsole(`Found ${users.length} regular user(s) in chroot`, 'info');
    }catch(e){
      appendConsole(`Could not fetch users from chroot: ${e.message}`, 'warn');
      // Keep only root option
      els.userSelect.innerHTML = '<option value="root">root</option>';
    }
  }

  /**
   * Append text to console with optional styling
   * Enforces max line limit to prevent memory issues
   * Excludes progress indicators from line count to prevent removing them
   * Adds smooth fade-in animation when console has < 15 lines
   */
  function appendConsole(text, cls){
    const pre = els.console;
    const maxLines = APP_CONSTANTS.CONSOLE.MAX_LINES;
    // Exclude progress indicators from line count
    const lines = Array.from(pre.querySelectorAll('div')).filter(
      line => !line.classList.contains('progress-indicator')
    );
    
    // Remove oldest lines if we exceed the limit (excluding progress indicators)
    if(lines.length >= maxLines) {
      const toRemove = lines.length - maxLines + 1;
      Array.from(lines).slice(0, toRemove).forEach(line => line.remove());
    }
    
    const line = document.createElement('div');
    if(cls) line.className = cls;
    line.textContent = text + '\n';
    
    // Check if we should animate (when console has < 15 lines and no scrollbar)
    const isProgressIndicator = cls === 'progress-indicator' || text.includes('⏳');
    const totalLines = pre.querySelectorAll('div').length;
    const hasScrollbar = pre.scrollHeight > pre.clientHeight;
    const shouldAnimate = totalLines < 15 && !hasScrollbar && !isProgressIndicator;
    
    if(shouldAnimate) {
      // Apply fade-in animation with staggered delay (smooth cascade effect)
      line.classList.add('log-fade-in');
      // Use requestAnimationFrame for smoother timing
      requestAnimationFrame(() => {
        const delay = (totalLines * 45); // 45ms delay per line (slightly faster for snappier feel)
        line.style.animationDelay = `${delay}ms`;
        // Cleanup will-change after animation completes (performance optimization)
        setTimeout(() => {
          if(line.classList.contains('log-fade-in')) {
            line.style.willChange = 'auto';
          }
        }, delay + 350); // animation duration + delay
      });
    } else if(isProgressIndicator) {
      // Progress indicators appear immediately
      line.classList.add('log-immediate');
    }
    
    pre.appendChild(line);
    
    // Auto-scroll to bottom smoothly, but only if user is already near bottom
    // This prevents jarring scroll jumps when user is reading logs at the top
    const maxScroll = Math.max(0, pre.scrollHeight - pre.clientHeight);
    const currentScrollTop = pre.scrollTop;
    const distanceFromBottom = maxScroll - currentScrollTop;
    const isNearBottom = distanceFromBottom <= 100; // Within 100px of bottom
    
    if(isNearBottom || maxScroll === 0) {
      // User is near bottom or console is empty - scroll to keep them at bottom
      pre.scrollTo({
        top: pre.scrollHeight,
        behavior: 'smooth'
      });
    }
    // If user is reading logs at the top, don't scroll - let them read in peace
    
    // Save logs after each append
    saveConsoleLogs();
  }

  /**
   * Add button press animation
   */
  function animateButton(btn, actionText = null){
    if(!btn || btn.disabled) return Promise.resolve();
    
    // Remove any existing pressed state first
    btn.classList.remove('btn-pressed', 'btn-released');
    // Clear any inline styles that might interfere
    btn.style.transform = '';
    btn.style.boxShadow = '';
    // Force a reflow to ensure the class and style are reset
    void btn.offsetWidth;
    
    // Add pressed state (this will apply scale(0.96) and shadow from CSS)
    btn.classList.add('btn-pressed');
    
    // Return a promise that resolves after animation completes
    return new Promise((resolve) => {
      // Show action message in console during animation
      if(actionText) {
        appendConsole(actionText, 'info');
      }
      // Remove after animation delay
      setTimeout(() => {
        btn.classList.remove('btn-pressed');
        btn.classList.add('btn-released');
        // Force reflow
        void btn.offsetWidth;
        // After transition, remove released class and reset
        setTimeout(() => {
          btn.classList.remove('btn-released');
          btn.style.transform = '';
          btn.style.boxShadow = '';
          // Blur to remove :active state (fixes stuck buttons on touch devices)
          btn.blur();
          resolve();
        }, ANIMATION_DELAYS.BUTTON_RELEASE);
      }, ANIMATION_DELAYS.BUTTON_ANIMATION);
    });
  }

  // ============================================================================
  // STORAGE UTILITY - Centralized localStorage operations
  // ============================================================================
  const Storage = {
    get(key, defaultValue = null) {
      try {
        const value = localStorage.getItem(key);
        return value !== null ? value : defaultValue;
      } catch(e) {
        return defaultValue;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, String(value));
      } catch(e) {
        // Silently fail - storage may be disabled
      }
    },
    remove(key) {
      try {
        localStorage.removeItem(key);
      } catch(e) {
        // Silently fail
      }
    },
    getBoolean(key, defaultValue = false) {
      const value = this.get(key);
      return value !== null ? value === 'true' : defaultValue;
    },
    getJSON(key, defaultValue = null) {
      try {
        const value = this.get(key);
        return value ? JSON.parse(value) : defaultValue;
      } catch(e) {
        return defaultValue;
      }
    },
    setJSON(key, value) {
      try {
        this.set(key, JSON.stringify(value));
      } catch(e) {
        // Silently fail
      }
    }
  };

  // ============================================================================
  // ANIMATION DELAYS - Centralized timing constants
  // ============================================================================
  const ANIMATION_DELAYS = {
    POPUP_CLOSE: 450,
    POPUP_CLOSE_LONG: 750,
    POPUP_CLOSE_VERY_LONG: 850,
    UI_UPDATE: 50,
    STATUS_REFRESH: 500,
    BUTTON_ANIMATION: 120, // Reduced for snappier feel
    BUTTON_RELEASE: 120, // Delay for button release animation
    INPUT_FOCUS: 100, // Delay for focusing inputs after DOM manipulation
    INIT_DELAY: 160, // Initial page load delay
    PRE_FETCH_DELAY: 500, // Delay before pre-fetching interfaces
    SETTINGS_LOAD: 100, // Delay for loading settings after popup opens
    CHANNEL_VERIFY: 100, // Delay for verifying channel value after load
    CHANNEL_UPDATE_DELAY: 50, // Delay after updating channel options before setting value
    DIALOG_CLOSE: 200, // Delay for dialog close animation
    PROGRESS_SPINNER: 200, // Interval for spinner animation
    PROGRESS_DOTS: 400 // Interval for dots animation
  };

  // ============================================================================
  // APPLICATION CONSTANTS
  // ============================================================================
  const APP_CONSTANTS = {
    HOTSPOT: {
      PASSWORD_MIN_LENGTH: 8,
      DEFAULT_BAND: '2',
      DEFAULT_CHANNEL_2_4GHZ: '6',
      DEFAULT_CHANNEL_5GHZ: '36',
      CHANNELS_2_4GHZ: [1,2,3,4,5,6,7,8,9,10,11],
      CHANNELS_5GHZ: [36,40,44,48,52,56,60,64,100,104,108,112,116,120,124,128,132,136,140,149,153,157,161,165]
    },
    CONSOLE: {
      MAX_LINES: 250 // Maximum number of console lines to keep
    },
    SPARSE_IMAGE: {
      SIZE_BASE: 1000, // Use base 1000 (GB) not 1024 (GiB)
      DEFAULT_SIZE_GB: 8,
      AVAILABLE_SIZES: [4, 8, 16, 32, 64, 128, 256, 512]
    },
    UI: {
      Z_INDEX_OVERLAY: 2000, // Z-index for overlay dialogs
      BYTES_BASE: 1000 // Base for byte calculations (KB, MB, GB)
    }
  };

  // ============================================================================
  // STATE MANAGER - Unified state management with persistence
  // ============================================================================
  const StateManager = {
    states: {
      hotspot: { key: 'hotspot_active', default: false },
      forwarding: { key: 'forwarding_active', default: false },
      debug: { key: 'debug_mode_active', default: false },
      sparse: { key: 'sparse_migrated', default: false }
    },
    get(name) {
      const state = this.states[name];
      if(!state) return null;
      return Storage.getBoolean(state.key, state.default);
    },
    set(name, value) {
      const state = this.states[name];
      if(!state) return;
      Storage.set(state.key, value);
    },
    loadAll() {
      hotspotActive = this.get('hotspot');
      forwardingActive = this.get('forwarding');
      debugModeActive = this.get('debug');
      sparseMigrated = this.get('sparse');
    },
    saveAll() {
      this.set('hotspot', hotspotActive);
      this.set('forwarding', forwardingActive);
      this.set('debug', debugModeActive);
      this.set('sparse', sparseMigrated);
    }
  };

  // ============================================================================
  // COMMAND GUARD - Prevents concurrent command execution
  // ============================================================================
  async function withCommandGuard(commandId, fn) {
    if(activeCommandId) {
      appendConsole('⚠ Another command is already running. Please wait...', 'warn');
      return;
    }
    if(!rootAccessConfirmed) {
      appendConsole('Cannot execute: root access not available', 'err');
      return;
    }
    try {
      activeCommandId = commandId;
      await fn();
    } finally {
      activeCommandId = null;
    }
  }

  // ============================================================================
  // DIALOG MANAGER - Centralized dialog creation
  // ============================================================================
  const DialogManager = {
    // Common dialog styles
    styles: {
      overlay: `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 2000; /* APP_CONSTANTS.UI.Z_INDEX_OVERLAY */
        opacity: 0;
        transition: opacity 0.2s ease;
      `,
      dialog: `
        background: var(--card);
        border-radius: var(--surface-radius);
        box-shadow: 0 6px 20px rgba(6,8,14,0.06);
        border: 1px solid rgba(0,0,0,0.08);
        max-width: 450px;
        width: 90%;
        padding: 24px;
        transform: scale(0.9);
        transition: transform 0.2s ease;
      `,
      title: `
        margin: 0 0 12px 0;
        font-size: 18px;
        font-weight: 600;
        color: var(--text);
      `,
      message: `
        margin: 0 0 20px 0;
        font-size: 14px;
        color: var(--muted);
        line-height: 1.5;
        white-space: pre-line;
      `,
      buttonContainer: `
        display: flex;
        gap: 12px;
        justify-content: flex-end;
      `,
      button: `
        padding: 8px 16px;
        border-radius: 8px;
        cursor: pointer;
        font-size: 14px;
        transition: all 0.2s ease;
        -webkit-tap-highlight-color: transparent;
      `,
      buttonPrimary: `
        border: 1px solid var(--accent);
        background: var(--accent);
        color: white;
      `,
      buttonSecondary: `
        border: 1px solid rgba(0,0,0,0.08);
        background: transparent;
        color: var(--text);
      `,
      buttonDanger: `
        border: 1px solid var(--danger);
        background: var(--danger);
        color: white;
      `,
      input: `
        width: 100%;
        padding: 8px 12px;
        border: 1px solid rgba(0,0,0,0.08);
        border-radius: 8px;
        background: var(--card);
        color: var(--text);
        font-size: 14px;
        box-sizing: border-box;
      `
    },

    createOverlay() {
      const overlay = document.createElement('div');
      overlay.style.cssText = this.styles.overlay;
      return overlay;
    },

    createDialog() {
      const dialog = document.createElement('div');
      dialog.style.cssText = this.styles.dialog;
      return dialog;
    },

    createTitle(text) {
      const title = document.createElement('h3');
      title.textContent = text;
      title.style.cssText = this.styles.title;
      return title;
    },

    createMessage(text) {
      const message = document.createElement('p');
      message.textContent = text;
      message.style.cssText = this.styles.message;
      return message;
    },

    createButton(text, type = 'secondary') {
      const btn = document.createElement('button');
      btn.textContent = text;
      const baseStyle = this.styles.button;
      const typeStyle = type === 'primary' ? this.styles.buttonPrimary :
                       type === 'danger' ? this.styles.buttonDanger :
                       this.styles.buttonSecondary;
      btn.style.cssText = baseStyle + typeStyle;
      return btn;
    },

    createInput(placeholder = '', value = '') {
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = placeholder;
      input.value = value;
      input.style.cssText = this.styles.input;
      return input;
    },

    createSelect(options = []) {
      const select = document.createElement('select');
      select.style.cssText = this.styles.input;
      options.forEach(opt => {
        const option = document.createElement('option');
        option.value = opt.value;
        option.textContent = opt.text;
        select.appendChild(option);
      });
      return select;
    },

    show(overlay, dialog) {
      document.body.appendChild(overlay);
      setTimeout(() => {
        overlay.style.opacity = '1';
        dialog.style.transform = 'scale(1)';
      }, 10);
    },

    close(overlay, delay = ANIMATION_DELAYS.DIALOG_CLOSE) {
      overlay.style.opacity = '0';
      const dialog = overlay.querySelector('div');
      if(dialog) dialog.style.transform = 'scale(0.9)';
      // Clean up keyboard handler
      this.cleanupKeyboard(overlay);
      setTimeout(() => {
        if(overlay.parentNode) {
          overlay.parentNode.removeChild(overlay);
        }
      }, delay);
    },

    setupKeyboard(overlay, onEnter, onEscape) {
      const handleKeyDown = (e) => {
        if(e.key === 'Escape') {
          if(onEscape) onEscape();
          document.removeEventListener('keydown', handleKeyDown);
        } else if(e.key === 'Enter') {
          if(onEnter) onEnter();
          document.removeEventListener('keydown', handleKeyDown);
        }
      };
      document.addEventListener('keydown', handleKeyDown);
      // Store handler on overlay for cleanup
      overlay._keyboardHandler = handleKeyDown;
      return handleKeyDown;
    },
    
    cleanupKeyboard(overlay) {
      if(overlay && overlay._keyboardHandler) {
        document.removeEventListener('keydown', overlay._keyboardHandler);
        delete overlay._keyboardHandler;
      }
    }
  };

  /**
   * Progress Indicator Manager - Centralizes progress indicator creation/management
   */
  const ProgressIndicator = {
    create(text, type = 'spinner') {
      const progressLine = document.createElement('div');
      progressLine.className = 'progress-indicator log-immediate';
      const baseText = '⏳ ' + text;
      progressLine.textContent = baseText;
      els.console.appendChild(progressLine);
      // Scroll smoothly when adding progress indicator
      els.console.scrollTo({
        top: els.console.scrollHeight,
        behavior: 'smooth'
      });
      
      let interval = null;
      if(type === 'spinner') {
        let spinIndex = 0;
        const spinner = ['|', '/', '-', '\\'];
        interval = setInterval(() => {
          if(progressLine.parentNode) { // Check if still in DOM
            spinIndex = (spinIndex + 1) % 4;
            progressLine.textContent = baseText + ' ' + spinner[spinIndex];
          }
        }, ANIMATION_DELAYS.PROGRESS_SPINNER);
      } else if(type === 'dots') {
        // Use blinking animation instead of dots to prevent getting stuck
        let isVisible = true;
        interval = setInterval(() => {
          if(progressLine.parentNode) { // Check if still in DOM
            progressLine.textContent = isVisible ? baseText : '';
            isVisible = !isVisible;
          }
        }, ANIMATION_DELAYS.PROGRESS_SPINNER);
      }
      
      return { progressLine, interval };
    },
    
    remove(progressLine, interval) {
      if(interval) clearInterval(interval);
      if(progressLine && progressLine.parentNode) {
        progressLine.remove();
      }
    },
    
    update(progressLine, text) {
      if(progressLine && progressLine.parentNode) {
        progressLine.textContent = '⏳ ' + text;
      }
    }
  };

  /**
   * Button State Manager - Centralizes all button state updates
   */
  const ButtonState = {
    setButton(btn, enabled, visible = true, opacity = null) {
      if(!btn) return;
      btn.disabled = !enabled;
      if(opacity !== null) {
        btn.style.opacity = enabled ? '' : opacity;
      } else {
        btn.style.opacity = enabled ? '' : '0.5';
      }
      if(visible !== null) {
        btn.style.display = visible ? '' : 'none';
      }
      // Clear button states when disabled
      if(!enabled) {
        btn.classList.remove('btn-pressed', 'btn-released');
        btn.style.transform = '';
        btn.style.boxShadow = '';
      }
    },
    
    setButtonPair(startBtn, stopBtn, isActive) {
      this.setButton(startBtn, !isActive, true, '0.5');
      this.setButton(stopBtn, isActive, true, '0.5');
    },
    
    setButtons(buttons) {
      // buttons: [{ btn, enabled, visible, opacity }, ...]
      buttons.forEach(({ btn, enabled, visible, opacity }) => {
        this.setButton(btn, enabled, visible, opacity);
      });
    }
  };

  /**
   * Command Execution Wrapper - Standardizes async command execution pattern
   */
  async function executeCommand(config) {
    const {
      id,
      checkActive = true,
      checkRoot = true,
      validate = null,
      beforeExecute = null,
      command,
      progressText,
      progressType = 'spinner',
      closePopup = null,
      onSuccess = null,
      onError = null,
      onComplete = null,
      refreshAfter = true
    } = config;

    // Check if another command is running
    if(checkActive && activeCommandId) {
      appendConsole('⚠ Another command is already running. Please wait...', 'warn');
      return;
    }

    // Check root access
    if(checkRoot && !rootAccessConfirmed) {
      appendConsole(`Cannot execute: root access not available`, 'err');
      return;
    }

    // Validate inputs
    if(validate && !validate()) {
      return;
    }

    // Close popup if needed
    if(closePopup) {
      closePopup();
      await new Promise(resolve => setTimeout(resolve, ANIMATION_DELAYS.POPUP_CLOSE));
    }

    // Before execute hook
    if(beforeExecute) {
      await beforeExecute();
    }

    // Disable UI
    disableAllActions(true);
    disableSettingsPopup(true);

    // Use centralized flow for action execution
    const { progressLine, interval } = await prepareActionExecution(
      progressText,
      progressText,
      progressType
    );

    activeCommandId = id;

    // Execute command
    return new Promise((resolve) => {
      setTimeout(async () => {
        try {
          let output;
          if(typeof command === 'function') {
            output = await command();
          } else {
            output = await runCmdSync(command);
          }

          ProgressIndicator.remove(progressLine, interval);

          // Display output line by line
          if(output) {
            const lines = String(output).split('\n');
            lines.forEach(line => {
              if(line.trim()) {
                appendConsole(line);
              }
            });
          }

          // Handle success
          if(onSuccess) {
            onSuccess(output);
          }

          // Force scroll to bottom after output
          forceScrollAfterDOMUpdate();

          // Cleanup
          activeCommandId = null;
          disableAllActions(false);
          disableSettingsPopup(false, true);
          if(onComplete) onComplete(true);
          if(refreshAfter) setTimeout(() => refreshStatus(), ANIMATION_DELAYS.STATUS_REFRESH);
          resolve({ success: true, output });
        } catch(error) {
          ProgressIndicator.remove(progressLine, interval);

          // Display error line by line
          const errorMsg = String(error.message || error);
          const lines = errorMsg.split('\n');
          lines.forEach(line => {
            if(line.trim()) {
              appendConsole(line, 'err');
            }
          });

          // Handle error
          if(onError) {
            onError(error);
          }

          // Force scroll to bottom after error output
          forceScrollAfterDOMUpdate();

          // Cleanup
          activeCommandId = null;
          disableAllActions(false);
          disableSettingsPopup(false, true);
          if(onComplete) onComplete(false);
          if(refreshAfter) setTimeout(() => refreshStatus(), ANIMATION_DELAYS.STATUS_REFRESH);
          resolve({ success: false, error });
        }
      }, 50);
    });
  }

  /**
   * Popup Manager - Centralizes popup open/close logic
   */
  const PopupManager = {
    open(popup, onOpen = null) {
      if(popup) {
        popup.classList.add('active');
        if(onOpen) onOpen();
      }
    },
    
    close(popup, onClose = null) {
      if(popup) {
        popup.classList.remove('active');
        if(onClose) onClose();
      }
    },
    
    setupClickOutside(popup, closeFn) {
      if(popup && closeFn) {
        popup.addEventListener('click', (e) => {
          if(e.target === popup) closeFn();
        });
      }
    }
  };

  /**
   * Force scroll console to absolute bottom (instant, no smooth scroll)
   * Used after command completion to ensure we stay at bottom
   */
  function forceScrollToBottom() {
    if(!els.console) return;
    const pre = els.console;
    // Force layout recalculation
    void pre.offsetHeight;
    // Set scroll position to absolute bottom
    pre.scrollTop = pre.scrollHeight;
    // Force another layout recalculation to sync scrollbar
    void pre.offsetHeight;
  }

  /**
   * Helper: Force scroll after DOM updates complete (double RAF pattern)
   * Replaces repeated requestAnimationFrame(() => requestAnimationFrame(() => forceScrollToBottom()))
   */
  function forceScrollAfterDOMUpdate() {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        forceScrollToBottom();
      });
    });
  }

  /**
   * Helper: Validate root access and backend availability before command execution
   * Returns { valid: boolean, error?: string } - if !valid, caller should cleanup and return
   * @param {Object} progress - { progressLine, progressInterval } to cleanup on error
   * @param {boolean} useValue - Whether to check rootAccessConfirmed.value (for feature modules)
   */
  function validateCommandExecution(progress = null, useValue = false) {
    // When useValue is true, we're called from feature modules where rootAccessConfirmed is a ref object
    // When useValue is false, we're called from app.js where rootAccessConfirmed is a boolean
    let rootAccess;
    if(useValue) {
      // For feature modules: rootAccessConfirmed is passed as rootAccessConfirmedRef which has .value
      // But we need to check the global rootAccessConfirmedRef if it exists, or fall back to rootAccessConfirmed
      rootAccess = rootAccessConfirmedRef ? rootAccessConfirmedRef.value : rootAccessConfirmed;
    } else {
      // For app.js: rootAccessConfirmed is a direct boolean
      rootAccess = rootAccessConfirmed;
    }
    
    if(!rootAccess) {
      if(progress) ProgressIndicator.remove(progress.progressLine, progress.progressInterval);
      appendConsole('No root execution method available', 'err');
      return { valid: false, error: 'No root execution method available' };
    }
    
    if(!window.cmdExec || typeof cmdExec.executeAsync !== 'function') {
      if(progress) ProgressIndicator.remove(progress.progressLine, progress.progressInterval);
      appendConsole('Backend not available', 'err');
      return { valid: false, error: 'Backend not available' };
    }
    
    return { valid: true };
  }

  /**
   * Helper: Execute command with full lifecycle management
   * Handles validation, execution, cleanup, and scrolling automatically
   * @param {Object} options - Command execution options
   * @param {string} options.cmd - Command to execute
   * @param {Object} options.progress - { progressLine, progressInterval } from prepareActionExecution
   * @param {Function} options.onSuccess - Called on success with result
   * @param {Function} options.onError - Called on error with result
   * @param {Function} options.onComplete - Called after success/error (optional)
   * @param {boolean} options.useValue - Whether to use .value for rootAccessConfirmed (feature modules)
   * @param {Object} options.activeCommandIdRef - Reference object like {value: string} for feature modules, or null for app.js
   * @returns {string|null} Command ID or null if validation failed
   */
  function executeCommandWithProgress({
    cmd,
    progress,
    onSuccess = null,
    onError = null,
    onComplete = null,
    useValue = false,
    activeCommandIdRef = null
  }) {
    // Validate before execution
    const validation = validateCommandExecution(progress, useValue);
    if(!validation.valid) {
      if(activeCommandIdRef && activeCommandIdRef.value !== undefined) {
        activeCommandIdRef.value = null;
      } else if(!useValue) {
        activeCommandId = null;
      }
      return null;
    }

    let localCommandId = null;
    const commandId = runCmdAsync(cmd, (result) => {
      // Cleanup progress indicator
      if(progress) ProgressIndicator.remove(progress.progressLine, progress.progressInterval);
      
      // Clear active command ID
      if(activeCommandIdRef && activeCommandIdRef.value !== undefined) {
        if(activeCommandIdRef.value === localCommandId) {
          activeCommandIdRef.value = null;
        }
      } else if(!useValue && activeCommandId === localCommandId) {
        activeCommandId = null;
      }
      
      // Handle result (callbacks may add console messages)
      if(result.success && onSuccess) {
        onSuccess(result);
      } else if(!result.success && onError) {
        onError(result);
      }
      
      // Optional completion callback (may also add console messages)
      if(onComplete) onComplete(result);
      
      // Force scroll after ALL DOM updates (callbacks may have added messages)
      // Use setTimeout to ensure all synchronous console appends are complete
      setTimeout(() => {
        forceScrollAfterDOMUpdate();
      }, 50);
    });
    
    localCommandId = commandId;
    
    // Set active command ID
    if(activeCommandIdRef && activeCommandIdRef.value !== undefined) {
      activeCommandIdRef.value = commandId;
    } else if(!useValue) {
      activeCommandId = commandId;
    }
    
    return commandId;
  }

  /**
   * Centralized function to prepare action execution
   * Handles: scroll to bottom, print header, show animation, ensure DOM updates
   * This is the core logic for handling console log flow
   * 
   * @param {string} headerText - The header text to display (e.g., "Starting Chroot Backup")
   * @param {string} progressText - The progress indicator text (e.g., "Backing up chroot")
   * @param {string} progressType - Type of progress indicator ('spinner' or 'dots', default: 'dots')
   * @returns {Object} Object with { progressLine, progressInterval } for cleanup
   */
  async function prepareActionExecution(headerText, progressText, progressType = 'dots') {
    // STEP 1: Scroll to bottom - must complete before anything else
    await scrollConsoleToBottom();
    
    // STEP 2: Print header message
    appendConsole(`━━━ ${headerText} ━━━`, 'info');
    
    // STEP 3: Show animated progress indicator (keep visible during execution)
    const { progressLine, interval: progressInterval } = ProgressIndicator.create(progressText, progressType);
    
    // Ensure DOM updates are painted before command execution starts
    // This prevents UI freeze and ensures header/animation are visible
    await new Promise(resolve => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
    });
    
    return { progressLine, progressInterval };
  }

  /**
   * Scroll console to bottom smoothly and wait for completion
   * Simplified version - removes redundant checks while maintaining reliability
   */
  async function scrollConsoleToBottom() {
    if(!els.console) return;
    
    const pre = els.console;
    void pre.offsetHeight; // Force layout recalculation
    
    const maxScroll = Math.max(0, pre.scrollHeight - pre.clientHeight);
    const isAtBottom = Math.abs(pre.scrollTop - maxScroll) <= 1;
    
    if(isAtBottom) {
      // Already at bottom, just ensure sync
      pre.scrollTop = pre.scrollHeight;
      void pre.offsetHeight;
      return;
    }
    
    // Smooth scroll to bottom
    pre.scrollTo({ top: pre.scrollHeight, behavior: 'smooth' });
    
    // Wait for scroll completion with timeout
    return new Promise((resolve) => {
      const startTime = Date.now();
      const maxWaitTime = 1500;
      
      function checkScroll() {
        void pre.offsetHeight; // Force layout recalculation
        
        const currentMaxScroll = Math.max(0, pre.scrollHeight - pre.clientHeight);
        const isAtBottom = Math.abs(pre.scrollTop - currentMaxScroll) <= 1;
        
        if(isAtBottom || Date.now() - startTime > maxWaitTime) {
          // Final sync to exact bottom
          pre.scrollTop = pre.scrollHeight;
          void pre.offsetHeight;
          resolve();
        } else {
          requestAnimationFrame(checkScroll);
        }
      }
      
      requestAnimationFrame(() => requestAnimationFrame(checkScroll));
    });
  }

  /**
   * Run command asynchronously
   * Note: KernelSU/libsuperuser don't support true streaming
   * Does NOT scroll - caller must handle scrolling before calling this
   */
  async function runCmdAsync(cmd, onComplete){
    if(!rootAccessConfirmed){
      const errorMsg = 'No root execution method available (KernelSU or libsuperuser not detected).';
      appendConsole(errorMsg, 'err');
      if(onComplete) onComplete({ success: false, error: errorMsg });
      return null;
    }
    
    if(!window.cmdExec || typeof cmdExec.executeAsync !== 'function'){
      const msg = 'Backend not available (cmdExec missing in page).';
      appendConsole(msg, 'err');
      if(onComplete) onComplete({ success: false, error: msg });
      return null;
    }

    // Prepend LOGGING_ENABLED=1 if debug mode is active
    const finalCmd = debugModeActive ? `LOGGING_ENABLED=1 ${cmd}` : cmd;

    // Store local reference for callback to use (captured in closure)
    let localCommandId = null;
    
    const commandId = cmdExec.executeAsync(finalCmd, true, {
      onOutput: (output) => {
        // Display output, but filter out executing messages
        if(output) {
          const lines = output.split('\n');
          lines.forEach(line => {
            if(line.trim() && !line.trim().startsWith('[Executing:')) {
              appendConsole(line);
            }
          });
        }
      },
      onError: (error) => {
        appendConsole(String(error), 'err');
      },
      onComplete: (result) => {
        // Only clear if this is still the active command (prevents race conditions)
        if(activeCommandId === localCommandId) {
          activeCommandId = null;
        }
        if(onComplete) onComplete(result);
      }
    });

    // Set activeCommandId immediately after getting commandId
    localCommandId = commandId;
    activeCommandId = commandId;
    
    return commandId;
  }

  /**
   * Legacy sync command for simple operations
   * Does NOT scroll - caller must handle scrolling before calling this
   */
  async function runCmdSync(cmd){
    if(!rootAccessConfirmed){
      throw new Error('No root execution method available (KernelSU or libsuperuser not detected).');
    }
    
    if(!window.cmdExec || typeof cmdExec.execute !== 'function'){
      const msg = 'Backend not available (cmdExec missing in page).';
      appendConsole(msg, 'err');
      throw new Error(msg);
    }

    // Prepend LOGGING_ENABLED=1 if debug mode is active
    const finalCmd = debugModeActive ? `LOGGING_ENABLED=1 ${cmd}` : cmd;

    try {
      const out = await cmdExec.execute(finalCmd, true);
      return out;
    } catch(err) {
      // Don't print duplicate error if root check already failed
      if(rootAccessConfirmed) {
        appendConsole(String(err), 'err');
      }
      throw err;
    }
  }

  function disableAllActions(disabled, isErrorCondition = false){
    try{
      // Main action buttons - using centralized ButtonState
      ButtonState.setButton(els.startBtn, !disabled);
      ButtonState.setButton(els.stopBtn, !disabled);
      ButtonState.setButton(els.restartBtn, !disabled);
      ButtonState.setButton(els.settingsBtn, !disabled, true);
      ButtonState.setButton(els.forwardNatBtn, !disabled, true);
      ButtonState.setButton(els.hotspotBtn, !disabled, true);
      
      els.userSelect.disabled = disabled;
      
      // Additional UI elements that should be disabled during operations
      // But kept enabled during error conditions (root access failed, chroot not found)
      const shouldDisableAlwaysAvailable = disabled && !isErrorCondition;
      ButtonState.setButton(els.clearConsole, !shouldDisableAlwaysAvailable);
      ButtonState.setButton(els.copyConsole, !shouldDisableAlwaysAvailable);
      ButtonState.setButton(els.refreshStatus, !shouldDisableAlwaysAvailable);
      if(els.themeToggle){
        ButtonState.setButton(els.themeToggle, !shouldDisableAlwaysAvailable);
      }
      
      const copyBtn = document.getElementById('copy-login');
      if(copyBtn) ButtonState.setButton(copyBtn, !disabled);
      
      // Disable boot toggle when root not available
      if(els.bootToggle) {
        els.bootToggle.disabled = disabled;
        const toggleContainer = els.bootToggle.closest('.toggle-inline');
        if(toggleContainer) {
          toggleContainer.style.opacity = disabled ? '0.5' : '';
          toggleContainer.style.pointerEvents = disabled ? 'none' : '';
        }
      }
    }catch(e){}
  }

  /**
   * Check if ap0 interface exists (indicates hotspot is running)
   */
  async function checkAp0Interface(){
    if(!rootAccessConfirmed){
      return false;
    }
    try{
      const out = await runCmdSync(`ip link show ap0 2>/dev/null | grep -q ap0 && echo "exists" || echo "not_exists"`);
      return String(out||'').trim() === 'exists';
    }catch(e){
      return false;
    }
  }

  /**
   * Check if forward-nat is running (universal method - checks iptables rules)
   */
  async function checkForwardNatRunning(){
    if(!rootAccessConfirmed){
      return false;
    }
    try{
      // Use the new check-status command that checks actual iptables rules
      const out = await runCmdSync(`sh ${FORWARD_NAT_SCRIPT} check-status 2>&1`);
      const status = String(out||'').trim();
      return status === 'active';
    }catch(e){
      // Fallback to state file check if command fails
      try{
        const out = await runCmdSync(`test -f /data/local/tmp/localhost_router.state && echo "exists" || echo "not_exists"`);
        return String(out||'').trim() === 'exists';
      }catch(e2){
        return false;
      }
    }
  }
  /**
   * Execute chroot action (start/stop/restart)
   * Clean implementation following the exact flow specified
   */
  async function doAction(action, btn){
    await withCommandGuard(`chroot-${action}`, async () => {
      // Disable buttons immediately (grey them out first)
      btn.disabled = true;
      btn.style.opacity = '0.5';
      btn.classList.remove('btn-pressed', 'btn-released');
      btn.style.transform = '';
      btn.style.boxShadow = '';
      disableAllActions(true);
      disableSettingsPopup(true);
      
      // Update UI state IMMEDIATELY (before scrolling/preparation)
      const statusState = action === 'start' ? 'starting' : action === 'stop' ? 'stopping' : 'restarting';
      updateStatus(statusState);
      
      // Stop network services on stop/restart BEFORE creating progress indicator
      // This way the chroot action animation shows properly
      if(action === 'stop' || action === 'restart'){
        if(window.StopNetServices) {
          // Stop network services silently (no progress indicator interference)
          await StopNetServices.stopNetworkServices({ silent: false });
        }
      }

      // Use centralized flow: scroll, header, animation (after network services stopped)
      // Fix typo: "stop" -> "stopping" (not "stoping")
      const actionText = action === 'stop' ? 'Stopping chroot' : 
                        action === 'start' ? 'Starting chroot' : 
                        'Restarting chroot';
      const { progressLine, interval: progressInterval } = await prepareActionExecution(
        actionText,
        actionText,
        'dots'
      );

      // STEP 4: Execute command (animation stays visible during execution)
      const cmd = `sh ${PATH_CHROOT_SH} ${action} --no-shell`;
      
      if(!rootAccessConfirmed){
        ProgressIndicator.remove(progressLine, progressInterval);
        appendConsole('No root execution method available', 'err');
        disableAllActions(false);
        disableSettingsPopup(false, true);
        return;
      }
      
      if(!window.cmdExec || typeof cmdExec.executeAsync !== 'function'){
        ProgressIndicator.remove(progressLine, progressInterval);
        appendConsole('Backend not available', 'err');
        disableAllActions(false);
        disableSettingsPopup(false, true);
        return;
      }

      const finalCmd = debugModeActive ? `LOGGING_ENABLED=1 ${cmd}` : cmd;
      let localCommandId = null;
      
      const commandId = runCmdAsync(finalCmd, (result) => {
        // STEP 5: Clear animation ONLY when command completes (success or failure)
        ProgressIndicator.remove(progressLine, progressInterval);
        
        if(activeCommandId === localCommandId) {
          activeCommandId = null;
        }

        // Print result
        if(result.success) {
          appendConsole(`✓ ${action} completed successfully`, 'success');
          setTimeout(() => refreshStatus(), ANIMATION_DELAYS.STATUS_REFRESH);
        } else {
          appendConsole(`✗ ${action} failed`, 'err');
          setTimeout(() => refreshStatus(), ANIMATION_DELAYS.STATUS_REFRESH);
        }
        
        // Force scroll to bottom after completion messages are added
        forceScrollAfterDOMUpdate();
        
        // Cleanup UI
        activeCommandId = null;
        disableAllActions(false);
        disableSettingsPopup(false, true);
        if(els.closePopup) els.closePopup.style.display = '';
        
        [els.startBtn, els.stopBtn, els.restartBtn].forEach(btn => {
          if(btn) {
            btn.classList.remove('btn-pressed', 'btn-released');
            btn.style.transform = '';
            btn.style.boxShadow = '';
          }
        });
      });
      
      localCommandId = commandId;
      activeCommandId = commandId;
    });
  }


  /**
   * Stop chroot properly (like the Stop button does)
   * Shows stopping status, stops network services, then executes stop command
   * Uses centralized prepareActionExecution flow
   * Returns true if chroot is now stopped, false otherwise
   */
  async function ensureChrootStopped() {
    if(!rootAccessConfirmed) {
      return false;
    }
    
    // Check current status
    try {
      const out = await runCmdSync(`sh ${PATH_CHROOT_SH} status`);
      const s = String(out || '');
      const isRunning = /Status:\s*RUNNING/i.test(s);
      
      if(!isRunning) {
        return true; // Already stopped
      }
    } catch(e) {
      // Status check failed, try to stop anyway
    }
    
    // Stop network services first BEFORE creating progress indicator
    // This way the chroot action animation shows properly
    updateStatus('stopping');
    
    if(window.StopNetServices) {
      await StopNetServices.stopNetworkServices({ silent: false });
    }
    
    // Chroot is running, stop it properly using centralized flow (after network services stopped)
    const { progressLine, progressInterval } = await prepareActionExecution(
      'Stopping Chroot',
      'Stopping chroot',
      'dots'
    );
    
    return new Promise((resolve) => {
      const stopCmd = `sh ${PATH_CHROOT_SH} stop --no-shell`;
      let localStopCommandId = null;
      
      const stopCommandId = runCmdAsync(stopCmd, (stopResult) => {
        // Clear progress indicator
        ProgressIndicator.remove(progressLine, progressInterval);
        
        if(activeCommandId === localStopCommandId) {
          activeCommandId = null;
        }
        
        if(stopResult.success) {
          // Update status immediately after stop completes (before verification)
          updateStatus('stopped');
          
          // Wait a bit and verify it's actually stopped
          setTimeout(async () => {
            try {
              const verifyOut = await runCmdSync(`sh ${PATH_CHROOT_SH} status`);
              const verifyStatus = String(verifyOut || '');
              const isRunning = /Status:\s*RUNNING/i.test(verifyStatus);
              if(!isRunning) {
                appendConsole('✓ Chroot stopped successfully', 'success');
                // Force scroll to bottom after completion message
                forceScrollAfterDOMUpdate();
                resolve(true);
              } else {
                appendConsole('⚠ Chroot stop completed but status check failed', 'warn');
                resolve(false);
              }
            } catch(e) {
              appendConsole('⚠ Chroot stop completed but status verification failed', 'warn');
              resolve(false);
            }
          }, 500);
        } else {
          appendConsole('✗ Failed to stop chroot', 'err');
          resolve(false);
        }
      });
      
      localStopCommandId = stopCommandId;
      activeCommandId = stopCommandId;
    });
  }

  /**
   * Ensure chroot is started and wait for it to be running
   * Uses centralized prepareActionExecution flow
   * Returns true if chroot is now running, false otherwise
   */
  async function ensureChrootStarted() {
    if(!rootAccessConfirmed) {
      return false;
    }
    
    // Check current status
    try {
      const out = await runCmdSync(`sh ${PATH_CHROOT_SH} status`);
      const s = String(out || '');
      const isRunning = /Status:\s*RUNNING/i.test(s);
      
      if(isRunning) {
        return true; // Already running
      }
    } catch(e) {
      // Status check failed, try to start anyway
    }
    
    // Chroot is not running, start it using centralized flow
    const { progressLine, progressInterval } = await prepareActionExecution(
      'Starting Chroot',
      'Starting chroot',
      'dots'
    );
    
    updateStatus('starting');
    
    return new Promise((resolve) => {
      const startCmd = `sh ${PATH_CHROOT_SH} start --no-shell`;
      let localStartCommandId = null;
      
      const startCommandId = runCmdAsync(startCmd, (startResult) => {
        // Clear progress indicator
        ProgressIndicator.remove(progressLine, progressInterval);
        
        if(activeCommandId === localStartCommandId) {
          activeCommandId = null;
        }
        
        if(startResult.success) {
          // Update status immediately after start completes (before verification)
          updateStatus('running');
          
          // Wait a bit and verify it's actually running
          setTimeout(async () => {
            try {
              const verifyOut = await runCmdSync(`sh ${PATH_CHROOT_SH} status`);
              const verifyStatus = String(verifyOut || '');
              const isRunning = /Status:\s*RUNNING/i.test(verifyStatus);
              if(isRunning) {
                appendConsole('✓ Chroot started successfully', 'success');
                // Force scroll to bottom after completion message
                forceScrollAfterDOMUpdate();
                resolve(true);
              } else {
                appendConsole('⚠ Chroot start completed but status check failed', 'warn');
                resolve(false);
              }
            } catch(e) {
              appendConsole('⚠ Chroot start completed but status verification failed', 'warn');
              resolve(false);
            }
          }, 1000);
        } else {
          appendConsole('✗ Failed to start chroot', 'err');
          resolve(false);
        }
      });
      
      localStartCommandId = startCommandId;
      activeCommandId = startCommandId;
    });
  }

  /**
   * Refresh chroot status (non-blocking)
   */
  async function refreshStatus(){
    if(!rootAccessConfirmed){
      updateStatus('unknown');
      disableAllActions(true, true);
      return; // Don't attempt commands - root check already printed error
    }

    // DISABLE ALL UI ELEMENTS FIRST to prevent flicker
    disableAllActions(true);

    try{
      // Check if chroot directory exists
      let exists = await cmdExec.execute(`test -d ${CHROOT_PATH_UI} && echo 1 || echo 0`, true);
      const chrootExists = String(exists||'').trim() === '1';
      let running = false;

      // COLLECT ALL STATUS INFO WITHOUT TOUCHING UI

      if(chrootExists){
        _chrootMissingLogged = false;

        // Check if sparse image exists FIRST
        const sparseCheck = await runCmdSync(`[ -f "${CHROOT_DIR}/rootfs.img" ] && echo "sparse" || echo "directory"`);
        sparseMigrated = sparseCheck && sparseCheck.trim() === 'sparse';

        // Get status without blocking UI
        const out = await runCmdSync(`sh ${PATH_CHROOT_SH} status`);
        const s = String(out || '');
        // Check for "Status: RUNNING" from the status output
        running = /Status:\s*RUNNING/i.test(s);

        // Fetch users if running (do this before UI updates to avoid flicker)
        if(running){
          await fetchUsers();
        }

        // Check hotspot state if running - sync with actual system state
        let currentHotspotActive = false;
        if(running && rootAccessConfirmed){
          currentHotspotActive = await checkAp0Interface();
          if(currentHotspotActive !== hotspotActive){
            // State mismatch - update our saved state to match reality
            hotspotActive = currentHotspotActive;
            StateManager.set('hotspot', currentHotspotActive);
            if(hotspotActiveRef) hotspotActiveRef.value = currentHotspotActive;
            // Don't log during refresh - keep it quiet
          }
        }

        // Check forward-nat state - sync with actual system state (check even if chroot stopped)
        let currentForwardingActive = false;
        if(rootAccessConfirmed){
          currentForwardingActive = await checkForwardNatRunning();
          if(currentForwardingActive !== forwardingActive){
            // State mismatch - update our saved state to match reality
            forwardingActive = currentForwardingActive;
            StateManager.set('forwarding', currentForwardingActive);
            if(forwardingActiveRef) forwardingActiveRef.value = currentForwardingActive;
            // Don't log during refresh - keep it quiet
          }
        }
      }

      // NOW APPLY ALL UI CHANGES AT ONCE - NO MORE CHANGES AFTER THIS

      // Status update - but don't overwrite custom statuses during active operations
      // Only preserve custom statuses if there's an active command running
      const currentStatus = els.statusText ? els.statusText.textContent.trim() : '';
      const customStatuses = ['backing up', 'restoring', 'migrating', 'uninstalling', 'updating', 'trimming', 'resizing'];
      const isCustomStatus = customStatuses.includes(currentStatus);
      
      // Only preserve custom status if there's an active command AND it's a long-running operation status
      // Allow normal status updates for starting/stopping/restarting (these are quick transitions)
      if(isCustomStatus && activeCommandId) {
        // Don't overwrite restoring/migrating/uninstalling during active operations
        // These will be updated by the operation itself when complete
      } else {
        // Normal status update - check actual chroot state
        const status = chrootExists ? (running ? 'running' : 'stopped') : 'not_found';
        updateStatus(status);
      }

      // Main action buttons - using centralized ButtonState
      const canControl = rootAccessConfirmed && chrootExists;
      ButtonState.setButton(els.startBtn, canControl && !running);
      ButtonState.setButton(els.stopBtn, canControl && running);
      ButtonState.setButton(els.restartBtn, canControl && running);

      // User select
      if(chrootExists && running){
        els.userSelect.disabled = false;
      } else {
        els.userSelect.disabled = true;
        if(!chrootExists){
          els.userSelect.innerHTML = '<option value="root">root</option>';
        }
      }

      // Copy login button
      const copyLoginBtn = document.getElementById('copy-login');
      if(copyLoginBtn) {
        ButtonState.setButton(copyLoginBtn, chrootExists && running);
      }

      // Forward NAT button - visible but disabled when chroot is not running
      const forwardNatEnabled = chrootExists && running && rootAccessConfirmed;
      ButtonState.setButton(els.forwardNatBtn, forwardNatEnabled, true);
      ButtonState.setButtonPair(els.startForwardingBtn, els.stopForwardingBtn, forwardingActive && forwardNatEnabled);

      // Hotspot button
      const hotspotEnabled = chrootExists && running && rootAccessConfirmed;
      ButtonState.setButton(els.hotspotBtn, hotspotEnabled, true);
      ButtonState.setButtonPair(els.startHotspotBtn, els.stopHotspotBtn, hotspotActive && hotspotEnabled);

      // Boot toggle
      if(els.bootToggle) {
        const toggleContainer = els.bootToggle.closest('.toggle-inline');
        if(chrootExists && rootAccessConfirmed){
          els.bootToggle.disabled = false;
          if(toggleContainer) {
            toggleContainer.style.opacity = '';
            toggleContainer.style.pointerEvents = '';
            toggleContainer.style.display = '';
          }
        } else {
          els.bootToggle.disabled = true;
          if(toggleContainer) {
            toggleContainer.style.opacity = '0.5';
            toggleContainer.style.pointerEvents = 'none';
            toggleContainer.style.display = '';
          }
        }
      }

      // Settings popup
      if(chrootExists){
        disableSettingsPopup(false, true);
      } else {
        disableSettingsPopup(false, false);
      }

      // Re-enable basic UI elements
      els.clearConsole.disabled = false;
      els.clearConsole.style.opacity = '';
      els.copyConsole.disabled = false;
      els.copyConsole.style.opacity = '';
      els.refreshStatus.disabled = false;
      els.refreshStatus.style.opacity = '';
      if(els.themeToggle){
        els.themeToggle.disabled = false;
        els.themeToggle.style.opacity = '';
      }
      els.settingsBtn.disabled = false;
      els.settingsBtn.style.opacity = '';

    }catch(e){
      updateStatus('unknown');
      disableAllActions(true);
    }
  }

  function updateStatus(state){
    const dot = els.statusDot; const text = els.statusText;
    if(state === 'running'){
      dot.className = 'dot dot-on';
      text.textContent = 'running';
    } else if(state === 'stopped'){
      dot.className = 'dot dot-off';
      text.textContent = 'stopped';
    } else if(state === 'starting'){
      dot.className = 'dot dot-on';
      text.textContent = 'starting';
    } else if(state === 'stopping'){
      dot.className = 'dot dot-off';
      text.textContent = 'stopping';
    } else if(state === 'restarting'){
      dot.className = 'dot dot-warn';
      text.textContent = 'restarting';
    } else if(state === 'backing up'){
      dot.className = 'dot dot-warn';
      text.textContent = 'backing up';
    } else if(state === 'restoring'){
      dot.className = 'dot dot-warn';
      text.textContent = 'restoring';
    } else if(state === 'migrating'){
      dot.className = 'dot dot-warn';
      text.textContent = 'migrating';
    } else if(state === 'uninstalling'){
      dot.className = 'dot dot-warn';
      text.textContent = 'uninstalling';
    } else if(state === 'updating'){
      dot.className = 'dot dot-warn';
      text.textContent = 'updating';
    } else if(state === 'trimming'){
      dot.className = 'dot dot-warn';
      text.textContent = 'trimming';
    } else if(state === 'resizing'){
      dot.className = 'dot dot-warn';
      text.textContent = 'resizing';
    } else if(state === 'not_found'){
      dot.className = 'dot dot-off';
      text.textContent = 'chroot not found';
    } else {
      dot.className = 'dot dot-unknown';
      text.textContent = 'unknown';
    }

    // enable/disable buttons depending on state
    try{
      if(state === 'running'){
        els.stopBtn.disabled = false;
        els.restartBtn.disabled = false;
        els.startBtn.disabled = true;
        els.userSelect.disabled = false;
        // Visual feedback
        els.stopBtn.style.opacity = '';
        els.restartBtn.style.opacity = '';
        els.startBtn.style.opacity = '0.5';
      } else if(state === 'stopped'){
        els.stopBtn.disabled = true;
        els.restartBtn.disabled = true;
        els.startBtn.disabled = false;
        els.userSelect.disabled = true;
        // Visual feedback
        els.stopBtn.style.opacity = '0.5';
        els.restartBtn.style.opacity = '0.5';
        els.startBtn.style.opacity = '';
      } else if(state === 'starting' || state === 'stopping' || state === 'restarting'){
        // Operation in progress - disable all action buttons
        els.stopBtn.disabled = true;
        els.restartBtn.disabled = true;
        els.startBtn.disabled = true;
        els.userSelect.disabled = true;
        // Visual feedback - all buttons appear pressed/disabled
        els.stopBtn.style.opacity = '0.5';
        els.restartBtn.style.opacity = '0.5';
        els.startBtn.style.opacity = '0.5';
      } else if(state === 'not_found'){
        // Similar to stopped, but start button also disabled since no chroot to start
        els.stopBtn.disabled = true;
        els.restartBtn.disabled = true;
        els.startBtn.disabled = true;
        els.userSelect.disabled = true;
        // Visual feedback
        els.stopBtn.style.opacity = '0.5';
        els.restartBtn.style.opacity = '0.5';
        els.startBtn.style.opacity = '0.5';
      } else {
        // unknown
        els.stopBtn.disabled = true;
        els.restartBtn.disabled = true;
        els.startBtn.disabled = false;
        els.userSelect.disabled = true;
        // Visual feedback
        els.stopBtn.style.opacity = '0.5';
        els.restartBtn.style.opacity = '0.5';
        els.startBtn.style.opacity = '';
      }
    }catch(e){ /* ignore if elements missing */ }
  }

  // boot toggle handlers
  async function writeBootFile(val){
    if(!rootAccessConfirmed){
      return; // Silently fail - root check already printed error
    }
    
    try{
      // Ensure directory exists and write file
      const cmd = `mkdir -p ${CHROOT_DIR} && echo ${val} > ${BOOT_FILE}`;
      await cmdExec.execute(cmd, true);
      appendConsole(`Run-at-boot ${val === 1 ? 'enabled' : 'disabled'}`, 'success');
    }catch(e){
      console.error(e);
      appendConsole(`✗ Failed to set run-at-boot: ${e.message}`, 'err');
      // Reset toggle on error
      await readBootFile();
    }
  }
  async function readBootFile(silent = false){
    if(!rootAccessConfirmed){
      els.bootToggle.checked = false; // Default to disabled
      return; // Don't attempt command - root check already printed error
    }
    
    try{
      if(window.cmdExec && typeof cmdExec.execute === 'function'){
        const out = await cmdExec.execute(`cat ${BOOT_FILE} 2>/dev/null || echo 0`, true);
        const v = String(out||'').trim();
        els.bootToggle.checked = v === '1';
        if(!silent) {
          appendConsole('Run-at-boot: '+ (v==='1' ? 'enabled' : 'disabled'));
        }
      } else {
        if(!silent) {
          appendConsole('Backend not available', 'err');
        }
        els.bootToggle.checked = false;
      }
    }catch(e){
      console.error(e);
      if(!silent) {
        appendConsole(`Failed to read boot setting: ${e.message}`, 'err');
      }
      els.bootToggle.checked = false;
    }
  }

  // copy login command
  function copyLoginCommand(){
    const selectedUser = els.userSelect.value;
    // Save selected user
    Storage.set('chroot_selected_user', selectedUser);

    // Use short command - symlink should exist when module is installed
    const loginCommand = `su -c "ubuntu-chroot start ${selectedUser} -s"`;

    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(loginCommand).then(()=> appendConsole(`Login command for user '${selectedUser}' copied to clipboard`))
        .catch(()=> appendConsole('Failed to copy to clipboard'));
    } else {
      // fallback
      appendConsole(loginCommand);
      try{ window.prompt('Copy login command (Ctrl+C):', loginCommand); }catch(e){}
    }
  }

  // copy console logs
  function copyConsoleLogs(){
    const consoleText = els.console.textContent || '';

    // If console is empty, show a message
    if(!consoleText.trim()){
      appendConsole('Console is empty - nothing to copy', 'warn');
      return;
    }

    // Try modern clipboard API first
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(consoleText).then(() => {
        appendConsole('Console logs copied to clipboard');
      }).catch((err) => {
        console.warn('Clipboard API failed:', err);
        // Fall back to older methods
        fallbackCopy(consoleText);
      });
    } else {
      // No clipboard API available, use fallback
      fallbackCopy(consoleText);
    }

    function fallbackCopy(text){
      try {
        // Try to create a temporary textarea for selection
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();

        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);

        if(successful){
          appendConsole('Console logs copied to clipboard');
        } else {
          appendConsole('Failed to copy console logs - please copy manually:', 'warn');
          appendConsole(text);
        }
      } catch(err) {
        console.warn('Fallback copy failed:', err);
        appendConsole('Failed to copy console logs - please copy manually:', 'warn');
        appendConsole(text);
      }
    }
  }

  // Master root detection function - checks backend once and sets UI state
  async function checkRootAccess(silent = false){
    if(!window.cmdExec || typeof cmdExec.execute !== 'function'){
      if(!silent) {
        appendConsole('No root bridge detected — running offline. Actions disabled.');
      }
      disableAllActions(true, true);
      disableSettingsPopup(true, true); // assume chroot exists for now
      return;
    }

    try{
      // Test root access with a simple command that requires root
      await cmdExec.execute('echo "test"', true);
      // If successful, root is available
      rootAccessConfirmed = true;
      disableAllActions(false);
      disableSettingsPopup(false, true); // assume chroot exists for now
      
      // Pre-fetch interfaces in background when root access is confirmed
      // This ensures cache is ready when user opens popups
      setTimeout(() => {
        if(window.HotspotFeature && HotspotFeature.fetchInterfaces) {
          HotspotFeature.fetchInterfaces(false, true).catch(() => {
            // Silently fail - will fetch when popup opens
          });
        }
        if(window.ForwardNatFeature && ForwardNatFeature.fetchInterfaces) {
          ForwardNatFeature.fetchInterfaces(false, true).catch(() => {
            // Silently fail - will fetch when popup opens
          });
        }
      }, ANIMATION_DELAYS.PRE_FETCH_DELAY); // Delay to not interfere with initial page load
    }catch(e){
      // If failed, show the backend error message once
      rootAccessConfirmed = false;
      appendConsole(`Failed to detect root execution method: ${e.message}`, 'err');
      // Then disable all root-dependent UI elements
      disableAllActions(true, true);
      // Also disable boot toggle when no root access
      if(els.bootToggle) {
        els.bootToggle.disabled = true;
        const toggleContainer = els.bootToggle.closest('.toggle-inline');
        if(toggleContainer) {
          toggleContainer.style.opacity = '0.5';
          toggleContainer.style.pointerEvents = 'none';
        }
      }
      disableSettingsPopup(true, true); // assume chroot exists for now
    }
  }

  // Settings popup functions
  async function openSettingsPopup(){
    // Start scroll in parallel (don't await - let it happen in background)
    scrollConsoleToBottom();
    
    // Open popup immediately (don't wait for scroll or script loading)
    PopupManager.open(els.settingsPopup);
    
    // Load script in background (will update textarea after popup is already open)
    loadPostExecScript().catch(() => {
      // Silently fail - script loading shouldn't block popup
    });
    
    // Set debug toggle state immediately
    if(els.debugToggle) {
      els.debugToggle.checked = debugModeActive;
    }
  }

  function closeSettingsPopup(){
    PopupManager.close(els.settingsPopup);
  }

  async function loadPostExecScript(){
    if(!rootAccessConfirmed){
      els.postExecScript.value = '';
      return;
    }
    try{
      const script = await runCmdSync(`cat ${POST_EXEC_SCRIPT} 2>/dev/null || echo ''`);
      els.postExecScript.value = String(script || '').trim();
    }catch(e){
      appendConsole(`Failed to load post-exec script: ${e.message}`, 'err');
      els.postExecScript.value = '';
    }
  }

  async function savePostExecScript(){
    if(!rootAccessConfirmed){
      appendConsole('Cannot save post-exec script: root access not available', 'err');
      return;
    }
    try{
      const script = els.postExecScript.value.trim();
      // Use base64 encoding to safely transfer complex scripts with special characters
      // This avoids all shell escaping issues
      // Properly encode UTF-8 to base64 (handle large scripts by chunking)
      const utf8Bytes = new TextEncoder().encode(script);
      let binaryString = '';
      const chunkSize = 8192;
      for(let i = 0; i < utf8Bytes.length; i += chunkSize) {
        const chunk = utf8Bytes.slice(i, i + chunkSize);
        binaryString += String.fromCharCode.apply(null, chunk);
      }
      const base64Script = btoa(binaryString);
      await runCmdSync(`echo '${base64Script}' | base64 -d > ${POST_EXEC_SCRIPT}`);
      await runCmdSync(`chmod 755 ${POST_EXEC_SCRIPT}`);
      appendConsole('Post-exec script saved successfully', 'success');
    }catch(e){
      appendConsole(`Failed to save post-exec script: ${e.message}`, 'err');
    }
  }

  async function clearPostExecScript(){
    els.postExecScript.value = '';
    if(!rootAccessConfirmed){
      appendConsole('Cannot clear post-exec script: root access not available', 'err');
      return;
    }
    try{
      await runCmdSync(`echo '' > ${POST_EXEC_SCRIPT}`);
      appendConsole('Post-exec script cleared successfully', 'info');
    }catch(e){
      appendConsole(`Failed to clear post-exec script: ${e.message}`, 'err');
    }
  }

  // Hotspot functions - delegated to HotspotFeature module
  async function openHotspotPopup() {
    // Start scroll in parallel (don't await - let it happen in background)
    scrollConsoleToBottom();
    
    if(window.HotspotFeature) {
      await HotspotFeature.openHotspotPopup();
    }
  }

  function closeHotspotPopup() {
    if(window.HotspotFeature) {
      HotspotFeature.closeHotspotPopup();
    }
  }

  function showHotspotWarning() {
    if(window.HotspotFeature) {
      HotspotFeature.showHotspotWarning();
    }
  }

  function dismissHotspotWarning() {
    if(window.HotspotFeature) {
      HotspotFeature.dismissHotspotWarning();
    }
  }

  async function startHotspot() {
    if(window.HotspotFeature) {
      await HotspotFeature.startHotspot();
    }
  }

  async function stopHotspot() {
    if(window.HotspotFeature) {
      await HotspotFeature.stopHotspot();
    }
  }

  // Forward NAT status loading/saving is now handled by ForwardNatFeature module
  // These functions are kept for backward compatibility during initialization
  function loadForwardingStatus() {
    forwardingActive = StateManager.get('forwarding');
  }

  function openForwardNatPopup() {
    // Start scroll in parallel (don't await - let it happen in background)
    scrollConsoleToBottom();
    
    if(window.ForwardNatFeature) {
      ForwardNatFeature.openForwardNatPopup();
    }
  }

  function closeForwardNatPopup() {
    if(window.ForwardNatFeature) {
      ForwardNatFeature.closeForwardNatPopup();
    }
  }

  async function startForwarding() {
    if(window.ForwardNatFeature) {
      await ForwardNatFeature.startForwarding();
    }
  }

  async function stopForwarding() {
    if(window.ForwardNatFeature) {
      await ForwardNatFeature.stopForwarding();
    }
  }

  // Sparse image settings functions
  function openSparseSettingsPopup(){
    updateSparseInfo();
    PopupManager.open(els.sparseSettingsPopup);
  }

  function closeSparseSettingsPopup(){
    PopupManager.close(els.sparseSettingsPopup);
  }

  // Helper function to format bytes to human readable format (base 1000, GB)
  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = APP_CONSTANTS.UI.BYTES_BASE; // Use base 1000 for GB instead of GiB
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  async function updateSparseInfo(){
    if(!rootAccessConfirmed || !sparseMigrated){
      if(els.sparseInfo) els.sparseInfo.textContent = 'Sparse image not detected';
      return;
    }

    try{
      // Get apparent size (visible to Android - the intended size)
      const apparentSizeCmd = `ls -lh ${CHROOT_DIR}/rootfs.img | tr -s ' ' | cut -d' ' -f5`;
      const apparentSizeStr = await runCmdSync(apparentSizeCmd);
      const apparentSize = apparentSizeStr.trim().replace(/G$/, ' GB');

      // Get actual usage (allocated space from du -h, then add proper unit)
      const usageCmd = `du -h ${CHROOT_DIR}/rootfs.img | cut -f1`;
      const actualUsageRaw = await runCmdSync(usageCmd);
      const actualUsage = actualUsageRaw.trim().replace(/G$/, ' GB');

      const info = `
        <table class="storage-info-table">
          <tbody>
            <tr>
              <td class="storage-label">Visible size to Android</td>
              <td class="storage-value">${apparentSize}</td>
            </tr>
            <tr>
              <td class="storage-label">Actual size of the image</td>
              <td class="storage-value">${String(actualUsage||'').trim()}</td>
            </tr>
          </tbody>
        </table>
      `;
      if(els.sparseInfo) els.sparseInfo.innerHTML = info; // Keep innerHTML for HTML table content
    }catch(e){
      if(els.sparseInfo) els.sparseInfo.textContent = 'Unable to read sparse image information';
    }
  }

  // Resize functions - delegated to ResizeFeature module
  async function trimSparseImage() {
    if(window.ResizeFeature) {
      await ResizeFeature.trimSparseImage();
    }
  }

  async function resizeSparseImage() {
    if(window.ResizeFeature) {
      await ResizeFeature.resizeSparseImage();
    }
  }

  async function updateChroot(){
    await withCommandGuard('chroot-update', async () => {
      if(!rootAccessConfirmed){
        appendConsole('Cannot update chroot: root access not available', 'err');
        return;
      }

      // Custom confirmation dialog
      const confirmed = await showConfirmDialog(
        'Update Chroot Environment',
        'This will apply any available updates to the chroot environment.\n\nThe chroot will be started if it\'s not running. Continue?',
        'Update',
        'Cancel'
      );

      if(!confirmed){
        return;
      }

      closeSettingsPopup();
      if(els.closePopup) els.closePopup.style.display = 'none';
      // Update status immediately after closing popup for instant feedback
      updateStatus('updating');
      await new Promise(resolve => setTimeout(resolve, ANIMATION_DELAYS.POPUP_CLOSE));

      disableAllActions(true);
      disableSettingsPopup(true);

      // Check if chroot is running, start if not (uses centralized flow internally)
      const isRunning = els.statusText && els.statusText.textContent.trim() === 'running';
      if(!isRunning) {
        // Update status to 'starting' IMMEDIATELY so it's visible
        updateStatus('starting');
        // Start chroot first (this uses prepareActionExecution internally)
        const started = await ensureChrootStarted();
        if(!started) {
          appendConsole('✗ Failed to start chroot - update aborted', 'err');
          activeCommandId = null;
          disableAllActions(false);
          disableSettingsPopup(false, true);
          if(els.closePopup) els.closePopup.style.display = '';
          return;
        }
        // Restore updating status after starting
        updateStatus('updating');
      }
      
      // Scroll to bottom BEFORE update header appears to ensure all previous logs are visible
      // This prevents the update header from appearing halfway up the console
      await scrollConsoleToBottom();
      // Small delay to ensure scroll completes and DOM settles
      await new Promise(resolve => setTimeout(resolve, 350));
      
      // Now use centralized flow for update action
      const { progressLine, interval: progressInterval } = await prepareActionExecution(
        'Starting Chroot Update',
        'Updating chroot',
        'dots'
      );

      // STEP 4: Execute update command (animation stays visible)
      const cmd = `sh ${OTA_UPDATER}`;
      
      if(!window.cmdExec || typeof cmdExec.executeAsync !== 'function'){
        ProgressIndicator.remove(progressLine, progressInterval);
        appendConsole('Backend not available', 'err');
        activeCommandId = null;
        disableAllActions(false);
        disableSettingsPopup(false, true);
        if(els.closePopup) els.closePopup.style.display = '';
        return;
      }

      const finalCmd = debugModeActive ? `LOGGING_ENABLED=1 ${cmd}` : cmd;
      let localCommandId = null;
      
      const commandId = runCmdAsync(finalCmd, (result) => {
        // STEP 5: Clear animation ONLY when command completes
        ProgressIndicator.remove(progressLine, progressInterval);
        
        if(activeCommandId === localCommandId) {
          activeCommandId = null;
        }

        if(result.success) {
          appendConsole('✓ Chroot update completed successfully', 'success');
          
          // Force scroll to bottom after update completion message
          forceScrollAfterDOMUpdate();
          
          // Restart chroot after update (uses centralized flow)
          setTimeout(async () => {
            if(window.StopNetServices) {
              await StopNetServices.stopNetworkServices();
            }
            
            // Update status first, then use centralized flow
            updateStatus('restarting');
            
            // Use centralized flow for restart action
            const { progressLine: restartLine, interval: restartInterval } = await prepareActionExecution(
              'Restarting Chroot',
              'Restarting chroot',
              'dots'
            );

            let localRestartCommandId = null;
            const restartCommandId = runCmdAsync(`sh ${PATH_CHROOT_SH} restart --no-shell`, (restartResult) => {
              ProgressIndicator.remove(restartLine, restartInterval);
              
              if(activeCommandId === localRestartCommandId) {
                activeCommandId = null;
              }
              
              if(restartResult.success) {
                appendConsole('✓ Chroot restarted successfully', 'success');
              } else {
                appendConsole('⚠ Chroot restart failed, but update was successful', 'warn');
              }
              
              appendConsole('━━━ Update Complete ━━━', 'success');
              
              // Force scroll to bottom after restart completion messages
              forceScrollAfterDOMUpdate();
              
              activeCommandId = null;
              disableAllActions(false);
              disableSettingsPopup(false, true);
              if(els.closePopup) els.closePopup.style.display = '';
              setTimeout(() => refreshStatus(), ANIMATION_DELAYS.STATUS_REFRESH);
            });
            
            localRestartCommandId = restartCommandId;
            activeCommandId = restartCommandId;
          }, ANIMATION_DELAYS.POPUP_CLOSE_LONG);
        } else {
          appendConsole('✗ Chroot update failed', 'err');
          
          // Force scroll to bottom after failure message
          forceScrollAfterDOMUpdate();
          
          activeCommandId = null;
          disableAllActions(false);
          disableSettingsPopup(false, true);
          if(els.closePopup) els.closePopup.style.display = '';
          setTimeout(() => refreshStatus(), ANIMATION_DELAYS.STATUS_REFRESH);
        }
      });
      
      localCommandId = commandId;
      activeCommandId = commandId;
    });
  }

  // Backup/Restore functions - delegated to BackupRestoreFeature module
  async function backupChroot() {
    if(window.BackupRestoreFeature) {
      await BackupRestoreFeature.backupChroot();
    }
  }

  async function restoreChroot() {
    if(window.BackupRestoreFeature) {
      await BackupRestoreFeature.restoreChroot();
    }
  }

  // Uninstall function - delegated to UninstallFeature module
  async function uninstallChroot() {
    if(window.UninstallFeature) {
      await UninstallFeature.uninstallChroot();
    }
  }

  // Disable settings popup when no root available
  function disableSettingsPopup(disabled, chrootExists = true){
    try{
      if(els.settingsPopup){
        // Don't dim the entire popup when chroot doesn't exist - only dim individual elements
        // Only dim when disabled due to no root access
        if(disabled) {
          els.settingsPopup.style.opacity = '0.5';
          // When disabled, allow closing but dim the content
          els.settingsPopup.style.pointerEvents = 'auto';
        } else {
          els.settingsPopup.style.opacity = '';
          // When not disabled, allow full interaction
          els.settingsPopup.style.pointerEvents = 'auto';
        }
      }
      // Close button should remain functional
      if(els.closePopup) {
        // Close button stays enabled and visible
      }
      // Disable individual popup elements using centralized ButtonState
      const buttonsToDisable = [
        { btn: els.postExecScript, disabled: disabled || !chrootExists },
        { btn: els.saveScript, disabled: disabled || !chrootExists },
        { btn: els.clearScript, disabled: disabled || !chrootExists },
        { btn: els.updateBtn, disabled: disabled || !chrootExists },
        { btn: els.backupBtn, disabled: disabled || !chrootExists },
        { btn: els.restoreBtn, disabled: disabled },
        { btn: els.uninstallBtn, disabled: disabled || !chrootExists },
        { btn: els.trimSparseBtn, disabled: disabled || !chrootExists || !sparseMigrated },
        { btn: els.resizeSparseBtn, disabled: disabled || !chrootExists || !sparseMigrated }
      ];
      
      buttonsToDisable.forEach(({ btn, disabled: btnDisabled }) => {
        if(btn) {
          btn.disabled = btnDisabled;
          btn.style.opacity = btnDisabled ? '0.5' : '';
          btn.style.cursor = btnDisabled ? 'not-allowed' : '';
          btn.style.pointerEvents = btnDisabled ? 'none' : '';
      }
      });
      
      // Experimental features - migrate sparse button
      const migrateSparseBtn = document.getElementById('migrate-sparse-btn');
      if(migrateSparseBtn) {
        const migrateDisabled = disabled || !chrootExists || sparseMigrated;
        migrateSparseBtn.disabled = migrateDisabled;
        migrateSparseBtn.style.opacity = migrateDisabled ? '0.5' : '';
        migrateSparseBtn.style.cursor = migrateDisabled ? 'not-allowed' : '';
        migrateSparseBtn.style.pointerEvents = migrateDisabled ? 'none' : '';
        // Only show "Already Migrated" if chroot exists AND is migrated
        // If chroot doesn't exist, always show "Migrate to Sparse Image" (disabled)
        migrateSparseBtn.textContent = (chrootExists && sparseMigrated) ? 'Already Migrated' : 'Migrate to Sparse Image';
      }

      // Sparse settings button visibility
      if(els.sparseSettingsBtn) {
        els.sparseSettingsBtn.style.display = (!disabled && chrootExists && sparseMigrated) ? 'inline-block' : 'none';
      }
    }catch(e){}
  }

  // Show experimental section if enabled
  function initExperimentalFeatures(){
    const experimentalSection = document.querySelector('.experimental-section');
    if(experimentalSection){
      // For now, always show experimental features (can be made conditional later)
      experimentalSection.style.display = 'block';
    }

    const optionalSection = document.querySelector('.optional-section');
    if(optionalSection){
      // Always show optional section
      optionalSection.style.display = 'block';
    }
  }

  // Migrate function - delegated to MigrateFeature module
  async function migrateToSparseImage() {
    if(window.MigrateFeature) {
      await MigrateFeature.migrateToSparseImage();
    }
  }

  // Size selection dialog for sparse image migration
  function showSizeSelectionDialog(){
    return new Promise((resolve) => {
      // Create overlay
      const overlay = document.createElement('div');
      overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 2000; /* APP_CONSTANTS.UI.Z_INDEX_OVERLAY */
        opacity: 0;
        transition: opacity 0.2s ease;
      `;

      // Create dialog
      const dialog = document.createElement('div');
      dialog.style.cssText = `
        background: var(--card);
        border-radius: var(--surface-radius);
        box-shadow: 0 6px 20px rgba(6,8,14,0.06);
        border: 1px solid rgba(0,0,0,0.08);
        max-width: 400px;
        width: 90%;
        padding: 24px;
        transform: scale(0.9);
        transition: transform 0.2s ease;
      `;

      // Create title
      const titleEl = document.createElement('h3');
      titleEl.textContent = 'Select Sparse Image Size';
      titleEl.style.cssText = `
        margin: 0 0 12px 0;
        font-size: 18px;
        font-weight: 600;
        color: var(--text);
      `;

      // Create description
      const descEl = document.createElement('p');
      descEl.textContent = 'Choose the maximum size for your sparse ext4 image. The actual disk usage will grow as you add data.';
      descEl.style.cssText = `
        margin: 0 0 20px 0;
        font-size: 14px;
        color: var(--muted);
        line-height: 1.5;
      `;

      // Create form
      const formContainer = document.createElement('div');
      formContainer.style.cssText = `
        margin-bottom: 20px;
      `;

      const sizeSelect = document.createElement('select');
      sizeSelect.style.cssText = `
        width: 100%;
        padding: 12px 16px;
        border: 1px solid rgba(0,0,0,0.08);
        border-radius: 8px;
        background: var(--card);
        color: var(--text);
        font-size: 16px;
        margin-bottom: 8px;
      `;

      // Add size options from constants
      const sizes = APP_CONSTANTS.SPARSE_IMAGE.AVAILABLE_SIZES;
      const defaultSize = APP_CONSTANTS.SPARSE_IMAGE.DEFAULT_SIZE_GB;
      sizes.forEach(size => {
        const option = document.createElement('option');
        option.value = size;
        option.textContent = `${size}GB`;
        if(size === defaultSize) option.selected = true;
        sizeSelect.appendChild(option);
      });

      const sizeNote = document.createElement('p');
      sizeNote.textContent = 'Note: This sets the maximum size. Actual usage starts small and grows as needed.';
      sizeNote.style.cssText = `
        margin: 8px 0 0 0;
        font-size: 12px;
        color: var(--muted);
        font-style: italic;
      `;

      formContainer.appendChild(sizeSelect);
      formContainer.appendChild(sizeNote);

      // Create button container
      const buttonContainer = document.createElement('div');
      buttonContainer.style.cssText = `
        display: flex;
        gap: 12px;
        justify-content: flex-end;
      `;

      // Create cancel button
      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = 'Cancel';
      cancelBtn.style.cssText = `
        padding: 8px 16px;
        border: 1px solid rgba(0,0,0,0.08);
        border-radius: 8px;
        background: transparent;
        color: var(--text);
        cursor: pointer;
        font-size: 14px;
        transition: all 0.2s ease;
        -webkit-tap-highlight-color: transparent;
      `;

      // Create select button
      const selectBtn = document.createElement('button');
      selectBtn.textContent = 'Continue';
      selectBtn.style.cssText = `
        padding: 8px 16px;
        border: 1px solid var(--accent);
        border-radius: 8px;
        background: var(--accent);
        color: white;
        cursor: pointer;
        font-size: 14px;
        transition: all 0.2s ease;
        -webkit-tap-highlight-color: transparent;
      `;

      // Dark mode adjustments
      if(document.documentElement.getAttribute('data-theme') === 'dark'){
        dialog.style.borderColor = 'rgba(255,255,255,0.08)';
        cancelBtn.style.borderColor = 'rgba(255,255,255,0.08)';
        sizeSelect.style.borderColor = 'rgba(255,255,255,0.08)';
        cancelBtn.addEventListener('mouseenter', () => {
          cancelBtn.style.background = 'rgba(255,255,255,0.05)';
        });
        cancelBtn.addEventListener('mouseleave', () => {
          cancelBtn.style.background = 'transparent';
        });
      }

      // Event listeners
      const closeDialog = (result) => {
        overlay.style.opacity = '0';
        dialog.style.transform = 'scale(0.9)';
        // Clean up keyboard handler
        if(overlay._keyboardHandler) {
          document.removeEventListener('keydown', overlay._keyboardHandler);
          delete overlay._keyboardHandler;
        }
        setTimeout(() => {
          if(overlay.parentNode) {
            document.body.removeChild(overlay);
          }
          resolve(result);
        }, ANIMATION_DELAYS.DIALOG_CLOSE);
      };

      cancelBtn.addEventListener('click', () => closeDialog(null));

      selectBtn.addEventListener('click', () => {
        const selectedSize = sizeSelect.value;
        closeDialog(selectedSize);
      });

      selectBtn.addEventListener('mouseenter', () => {
        selectBtn.style.transform = 'translateY(-1px)';
        selectBtn.style.boxShadow = '0 4px 12px rgba(59, 130, 246, 0.3)';
      });

      selectBtn.addEventListener('mouseleave', () => {
        selectBtn.style.transform = 'translateY(0)';
        selectBtn.style.boxShadow = 'none';
      });

      // Close on overlay click
      overlay.addEventListener('click', (e) => {
        if(e.target === overlay) closeDialog(null);
      });

      // Keyboard support - store handler for cleanup
      const handleKeyDown = (e) => {
        if(e.key === 'Escape') {
          closeDialog(null);
          document.removeEventListener('keydown', handleKeyDown);
        } else if(e.key === 'Enter') {
          selectBtn.click();
          document.removeEventListener('keydown', handleKeyDown);
        }
      };
      document.addEventListener('keydown', handleKeyDown);
      overlay._keyboardHandler = handleKeyDown; // Store for cleanup

      // Assemble dialog
      buttonContainer.appendChild(cancelBtn);
      buttonContainer.appendChild(selectBtn);

      dialog.appendChild(titleEl);
      dialog.appendChild(descEl);
      dialog.appendChild(formContainer);
      dialog.appendChild(buttonContainer);

      overlay.appendChild(dialog);
      document.body.appendChild(overlay);

      // Animate in
      setTimeout(() => {
        overlay.style.opacity = '1';
        dialog.style.transform = 'scale(1)';
      }, 10);
    });
  }
  function showConfirmDialog(title, message, confirmText = 'Yes', cancelText = 'No'){
    return new Promise((resolve) => {
      const overlay = DialogManager.createOverlay();
      const dialog = DialogManager.createDialog();
      const titleEl = DialogManager.createTitle(title);
      const messageEl = DialogManager.createMessage(message);
      const buttonContainer = document.createElement('div');
      buttonContainer.style.cssText = DialogManager.styles.buttonContainer;

      const cancelBtn = DialogManager.createButton(cancelText, 'secondary');
      const confirmBtn = DialogManager.createButton(confirmText, 'danger');

      // Dark mode adjustments
      if(document.documentElement.getAttribute('data-theme') === 'dark'){
        dialog.style.borderColor = 'rgba(255,255,255,0.08)';
        cancelBtn.style.borderColor = 'rgba(255,255,255,0.08)';
        cancelBtn.addEventListener('mouseenter', () => {
          cancelBtn.style.background = 'rgba(255,255,255,0.05)';
        });
        cancelBtn.addEventListener('mouseleave', () => {
          cancelBtn.style.background = 'transparent';
        });
      }

      const closeDialog = (result) => {
        DialogManager.close(overlay, ANIMATION_DELAYS.DIALOG_CLOSE);
          resolve(result);
      };

      cancelBtn.addEventListener('click', () => closeDialog(false));
      confirmBtn.addEventListener('click', () => closeDialog(true));

      confirmBtn.addEventListener('mouseenter', () => {
        confirmBtn.style.transform = 'translateY(-1px)';
        confirmBtn.style.boxShadow = '0 4px 12px rgba(220, 38, 38, 0.3)';
      });
      confirmBtn.addEventListener('mouseleave', () => {
        confirmBtn.style.transform = 'translateY(0)';
        confirmBtn.style.boxShadow = 'none';
      });

      overlay.addEventListener('click', (e) => {
        if(e.target === overlay) closeDialog(false);
      });

      DialogManager.setupKeyboard(overlay, () => closeDialog(true), () => closeDialog(false));

      buttonContainer.appendChild(cancelBtn);
      buttonContainer.appendChild(confirmBtn);
      dialog.appendChild(titleEl);
      dialog.appendChild(messageEl);
      dialog.appendChild(buttonContainer);
      overlay.appendChild(dialog);
      DialogManager.show(overlay, dialog);
    });
  }

  // File picker dialog for backup/restore operations
  function showFilePickerDialog(title, message, defaultPath, defaultFilename, forRestore = false){
    return new Promise((resolve) => {
      // Create overlay
      const overlay = document.createElement('div');
      overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 2000; /* APP_CONSTANTS.UI.Z_INDEX_OVERLAY */
        opacity: 0;
        transition: opacity 0.2s ease;
      `;

      // Create dialog
      const dialog = document.createElement('div');
      dialog.style.cssText = `
        background: var(--card);
        border-radius: var(--surface-radius);
        box-shadow: 0 6px 20px rgba(6,8,14,0.06);
        border: 1px solid rgba(0,0,0,0.08);
        max-width: 450px;
        width: 90%;
        padding: 24px;
        transform: scale(0.9);
        transition: transform 0.2s ease;
      `;

      // Create title
      const titleEl = document.createElement('h3');
      titleEl.textContent = title;
      titleEl.style.cssText = `
        margin: 0 0 12px 0;
        font-size: 18px;
        font-weight: 600;
        color: var(--text);
      `;

      // Create message
      const messageEl = document.createElement('p');
      messageEl.textContent = message;
      messageEl.style.cssText = `
        margin: 0 0 16px 0;
        font-size: 14px;
        color: var(--muted);
        line-height: 1.5;
      `;

      // Create form container
      const formContainer = document.createElement('div');
      formContainer.style.cssText = `
        margin-bottom: 20px;
      `;

      let pathInput; // Declare here for scope

      if(!forRestore){
        // For backup: path input + filename input
        const pathLabel = document.createElement('label');
        pathLabel.textContent = 'Directory:';
        pathLabel.style.cssText = `
          display: block;
          margin-bottom: 6px;
          font-weight: 500;
          color: var(--text);
          font-size: 14px;
        `;

        pathInput = document.createElement('input');
        pathInput.type = 'text';
        pathInput.value = defaultPath;
        pathInput.placeholder = '/sdcard/backup';
        pathInput.style.cssText = `
          width: 100%;
          padding: 8px 12px;
          border: 1px solid rgba(0,0,0,0.08);
          border-radius: 8px;
          background: var(--card);
          color: var(--text);
          font-size: 14px;
          margin-bottom: 12px;
          box-sizing: border-box;
        `;

        const filenameLabel = document.createElement('label');
        filenameLabel.textContent = 'Filename:';
        filenameLabel.style.cssText = `
          display: block;
          margin-bottom: 6px;
          font-weight: 500;
          color: var(--text);
          font-size: 14px;
        `;

        const filenameInput = document.createElement('input');
        filenameInput.type = 'text';
        filenameInput.value = defaultFilename;
        filenameInput.placeholder = 'chroot-backup.tar.gz';
        filenameInput.style.cssText = `
          width: 100%;
          padding: 8px 12px;
          border: 1px solid rgba(0,0,0,0.08);
          border-radius: 8px;
          background: var(--card);
          color: var(--text);
          font-size: 14px;
          box-sizing: border-box;
        `;

        // Auto-append .tar.gz if not present
        filenameInput.addEventListener('input', () => {
          if(!filenameInput.value.includes('.tar.gz') && filenameInput.value.length > 0){
            filenameInput.value = filenameInput.value.replace(/\.tar\.gz$/, '') + '.tar.gz';
          }
        });

        // Focus on filename input
        setTimeout(() => filenameInput.focus(), ANIMATION_DELAYS.INPUT_FOCUS);

        formContainer.appendChild(pathLabel);
        formContainer.appendChild(pathInput);
        formContainer.appendChild(filenameLabel);
        formContainer.appendChild(filenameInput);
      } else {
        // For restore: single file path input
        const pathLabel = document.createElement('label');
        pathLabel.textContent = 'Backup File Path:';
        pathLabel.style.cssText = `
          display: block;
          margin-bottom: 6px;
          font-weight: 500;
          color: var(--text);
          font-size: 14px;
        `;

        pathInput = document.createElement('input');
        pathInput.type = 'text';
        pathInput.value = defaultPath;
        pathInput.placeholder = '/sdcard/chroot-backup.tar.gz';
        pathInput.style.cssText = `
          width: 100%;
          padding: 8px 12px;
          border: 1px solid rgba(0,0,0,0.08);
          border-radius: 8px;
          background: var(--card);
          color: var(--text);
          font-size: 14px;
          box-sizing: border-box;
        `;

        // Focus on path input
        setTimeout(() => pathInput.focus(), ANIMATION_DELAYS.INPUT_FOCUS);

        formContainer.appendChild(pathLabel);
        formContainer.appendChild(pathInput);
      }

      // Create button container
      const buttonContainer = document.createElement('div');
      buttonContainer.style.cssText = `
        display: flex;
        gap: 12px;
        justify-content: flex-end;
      `;

      // Create cancel button
      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = 'Cancel';
      cancelBtn.style.cssText = `
        padding: 8px 16px;
        border: 1px solid rgba(0,0,0,0.08);
        border-radius: 8px;
        background: transparent;
        color: var(--text);
        cursor: pointer;
        font-size: 14px;
        transition: all 0.2s ease;
        -webkit-tap-highlight-color: transparent;
      `;

      // Create select button
      const selectBtn = document.createElement('button');
      selectBtn.textContent = forRestore ? 'Select File' : 'Select Location';
      selectBtn.style.cssText = `
        padding: 8px 16px;
        border: 1px solid var(--accent);
        border-radius: 8px;
        background: var(--accent);
        color: white;
        cursor: pointer;
        font-size: 14px;
        transition: all 0.2s ease;
        -webkit-tap-highlight-color: transparent;
      `;

      // Dark mode adjustments
      if(document.documentElement.getAttribute('data-theme') === 'dark'){
        dialog.style.borderColor = 'rgba(255,255,255,0.08)';
        cancelBtn.style.borderColor = 'rgba(255,255,255,0.08)';
        if(!forRestore){
          formContainer.querySelectorAll('input').forEach(input => {
            input.style.borderColor = 'rgba(255,255,255,0.08)';
          });
        } else {
          pathInput.style.borderColor = 'rgba(255,255,255,0.08)';
        }
        cancelBtn.addEventListener('mouseenter', () => {
          cancelBtn.style.background = 'rgba(255,255,255,0.05)';
        });
        cancelBtn.addEventListener('mouseleave', () => {
          cancelBtn.style.background = 'transparent';
        });
      }

      // Event listeners
      const closeDialog = (result) => {
        overlay.style.opacity = '0';
        dialog.style.transform = 'scale(0.9)';
        // Clean up keyboard handler
        if(overlay._keyboardHandler) {
          document.removeEventListener('keydown', overlay._keyboardHandler);
          delete overlay._keyboardHandler;
        }
        setTimeout(() => {
          if(overlay.parentNode) {
            document.body.removeChild(overlay);
          }
          resolve(result);
        }, ANIMATION_DELAYS.DIALOG_CLOSE);
      };

      cancelBtn.addEventListener('click', () => closeDialog(null));

      selectBtn.addEventListener('click', () => {
        let selectedPath = '';
        if(!forRestore){
          const pathInput = formContainer.querySelector('input:nth-child(2)');
          const filenameInput = formContainer.querySelector('input:nth-child(4)');
          const path = pathInput.value.trim();
          const filename = filenameInput.value.trim();
          if(path && filename){
            selectedPath = path + (path.endsWith('/') ? '' : '/') + filename;
          }
        } else {
          const pathInput = formContainer.querySelector('input');
          selectedPath = pathInput.value.trim();
        }

        if(selectedPath){
          // Basic validation
          if(forRestore && !selectedPath.endsWith('.tar.gz')){
            alert('Please select a valid .tar.gz backup file');
            return;
          }
          closeDialog(selectedPath);
        } else {
          alert('Please enter a valid path');
        }
      });

      selectBtn.addEventListener('mouseenter', () => {
        selectBtn.style.transform = 'translateY(-1px)';
        selectBtn.style.boxShadow = '0 4px 12px rgba(59, 130, 246, 0.3)';
      });

      selectBtn.addEventListener('mouseleave', () => {
        selectBtn.style.transform = 'translateY(0)';
        selectBtn.style.boxShadow = 'none';
      });

      // Close on overlay click
      overlay.addEventListener('click', (e) => {
        if(e.target === overlay) closeDialog(null);
      });

      // Keyboard support
      const handleKeyDown = (e) => {
        if(e.key === 'Escape') {
          closeDialog(null);
          document.removeEventListener('keydown', handleKeyDown);
        } else if(e.key === 'Enter') {
          selectBtn.click();
          document.removeEventListener('keydown', handleKeyDown);
        }
      };
      document.addEventListener('keydown', handleKeyDown);

      // Assemble dialog
      buttonContainer.appendChild(cancelBtn);
      buttonContainer.appendChild(selectBtn);

      dialog.appendChild(titleEl);
      dialog.appendChild(messageEl);
      dialog.appendChild(formContainer);
      dialog.appendChild(buttonContainer);

      overlay.appendChild(dialog);
      document.body.appendChild(overlay);

      // Animate in
      setTimeout(() => {
        overlay.style.opacity = '1';
        dialog.style.transform = 'scale(1)';
      }, 10);
    });
  }


  // Theme toggle - button with aria-pressed (checkbox code removed as HTML only has button)
  function initTheme(){
    const stored = Storage.get('chroot_theme') || (window.matchMedia && window.matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', stored==='dark' ? 'dark' : '');

    const t = els.themeToggle;
    if(!t) return;

    // Button toggle with aria-pressed
    const isDark = stored === 'dark';
    t.setAttribute('aria-pressed', isDark ? 'true' : 'false');
    t.addEventListener('click', ()=>{
      const pressed = t.getAttribute('aria-pressed') === 'true';
      const next = pressed ? 'light' : 'dark';
      t.setAttribute('aria-pressed', next === 'dark' ? 'true' : 'false');
      document.documentElement.setAttribute('data-theme', next==='dark' ? 'dark' : '');
      Storage.set('chroot_theme', next);
    });
  }

  // Setup event handlers with button animations
  els.startBtn.addEventListener('click', (e) => doAction('start', e.target));
  els.stopBtn.addEventListener('click', (e) => doAction('stop', e.target));
  els.restartBtn.addEventListener('click', (e) => doAction('restart', e.target));
  const copyLoginBtn = document.getElementById('copy-login');
  if(copyLoginBtn) {
    copyLoginBtn.addEventListener('click', (e) => {
      // Start animation (don't await - let it run in background)
      animateButton(e.target);
      // Copy immediately (don't wait for animation)
      copyLoginCommand();
    });
  }
  els.clearConsole.addEventListener('click', (e) => { 
    // Start animation (don't await - let it run in background)
    animateButton(e.target);
    // Clear console immediately (don't wait for animation)
    els.console.textContent = ''; // Use textContent for clearing (safer than innerHTML) 
    // Clear saved logs
    Storage.remove('chroot_console_logs');
    
    // If debug mode is enabled, also clear the logs folder
    if(debugModeActive){
      appendConsole('Console and logs are cleared', 'info');
      setTimeout(() => {
        runCmdAsync(`rm -rf ${LOG_DIR}`, () => {});
      }, ANIMATION_DELAYS.INPUT_FOCUS);
    } else {
      appendConsole('Console cleared', 'info');
    }
  });
  els.copyConsole.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    // Start animation (don't await - let it run in background)
    animateButton(e.currentTarget);
    // Copy immediately (don't wait for animation)
    copyConsoleLogs();
  });
  els.refreshStatus.addEventListener('click', async (e) => {
    // Disable button during refresh to prevent double-clicks
    const btn = e.target;
    btn.disabled = true;
    btn.style.opacity = '0.5';
    
    try {
      // Do a comprehensive refresh: re-check root access, then refresh status
      // No console messages, no scrolling - just quiet refresh
      await checkRootAccess(true); // Silent mode - no console output
      await refreshStatus();
      await readBootFile(true); // Also refresh boot toggle status (silent mode)
      
      // Pre-fetch interfaces in background (non-blocking) to update cache
      // This prevents lag when opening popups later
      // Use setTimeout to ensure it's truly non-blocking
      if(rootAccessConfirmed) {
        setTimeout(() => {
          // Fetch hotspot interfaces in background (force refresh + background only)
          if(window.HotspotFeature && HotspotFeature.fetchInterfaces) {
            HotspotFeature.fetchInterfaces(true, true).catch(() => {
              // Silently fail - cache will be used if fetch fails
            });
          }
          // Fetch forward-nat interfaces in background (force refresh + background only)
          if(window.ForwardNatFeature && ForwardNatFeature.fetchInterfaces) {
            ForwardNatFeature.fetchInterfaces(true, true).catch(() => {
              // Silently fail - cache will be used if fetch fails
            });
          }
        }, ANIMATION_DELAYS.INPUT_FOCUS); // Small delay to ensure UI updates first
      }
    } catch(error) {
      // Silently handle errors - refresh should never fail loudly
      console.error('Refresh error:', error);
    } finally {
      // Re-enable button
      btn.disabled = false;
      btn.style.opacity = '';
    }
  });
  els.bootToggle.addEventListener('change', () => writeBootFile(els.bootToggle.checked ? 1 : 0));
  els.debugToggle.addEventListener('change', () => {
    debugModeActive = els.debugToggle.checked;
    saveDebugMode();
    updateDebugIndicator();
    if(debugModeActive){
      appendConsole('Debug mode enabled. All scripts will now log to /data/logs/ubuntu-chroot/logs', 'warn');
    } else {
      appendConsole('Debug mode disabled', 'info');
    }
  });

  // Settings popup event handlers
  els.settingsBtn.addEventListener('click', () => openSettingsPopup());
  els.closePopup.addEventListener('click', () => closeSettingsPopup());
  PopupManager.setupClickOutside(els.settingsPopup, closeSettingsPopup);
  els.saveScript.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await animateButton(e.currentTarget);
    savePostExecScript();
  });
  els.clearScript.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await animateButton(e.currentTarget);
    clearPostExecScript();
  });
  els.updateBtn.addEventListener('click', () => updateChroot());
  els.backupBtn.addEventListener('click', () => {
    if(window.BackupRestoreFeature) BackupRestoreFeature.backupChroot();
  });
  els.restoreBtn.addEventListener('click', () => {
    if(window.BackupRestoreFeature) BackupRestoreFeature.restoreChroot();
  });
  els.uninstallBtn.addEventListener('click', () => {
    if(window.UninstallFeature) UninstallFeature.uninstallChroot();
  });

  // Experimental features event handlers
  const migrateSparseBtn = document.getElementById('migrate-sparse-btn');
  if(migrateSparseBtn){
    migrateSparseBtn.addEventListener('click', () => {
      if(window.MigrateFeature) MigrateFeature.migrateToSparseImage();
    });
  }

  // Sparse settings event handlers
  if(els.sparseSettingsBtn){
    els.sparseSettingsBtn.addEventListener('click', () => openSparseSettingsPopup());
  }
  if(els.closeSparsePopup){
    els.closeSparsePopup.addEventListener('click', () => closeSparseSettingsPopup());
  }
  PopupManager.setupClickOutside(els.sparseSettingsPopup, closeSparseSettingsPopup);
  if(els.trimSparseBtn){
    els.trimSparseBtn.addEventListener('click', () => {
      if(window.ResizeFeature) ResizeFeature.trimSparseImage();
    });
  }
  if(els.resizeSparseBtn){
    els.resizeSparseBtn.addEventListener('click', () => {
      if(window.ResizeFeature) ResizeFeature.resizeSparseImage();
    });
  }

  // Hotspot event handlers
  if(els.hotspotBtn) {
  els.hotspotBtn.addEventListener('click', () => openHotspotPopup());
  }
  if(els.closeHotspotPopup) {
  els.closeHotspotPopup.addEventListener('click', () => closeHotspotPopup());
  }
  if(els.hotspotPopup) {
    PopupManager.setupClickOutside(els.hotspotPopup, closeHotspotPopup);
  }
  if(els.startHotspotBtn) {
  els.startHotspotBtn.addEventListener('click', () => startHotspot());
  }
  if(els.stopHotspotBtn) {
  els.stopHotspotBtn.addEventListener('click', () => stopHotspot());
  }
  if(els.dismissHotspotWarning) {
    els.dismissHotspotWarning.addEventListener('click', () => dismissHotspotWarning());
  }

  // Forward NAT event handlers
  if(els.forwardNatBtn) {
    els.forwardNatBtn.addEventListener('click', () => openForwardNatPopup());
  }
  if(els.closeForwardNatPopup) {
    els.closeForwardNatPopup.addEventListener('click', () => closeForwardNatPopup());
  }
  if(els.forwardNatPopup) {
    PopupManager.setupClickOutside(els.forwardNatPopup, closeForwardNatPopup);
  }
  if(els.startForwardingBtn) {
    els.startForwardingBtn.addEventListener('click', () => startForwarding());
  }
  if(els.stopForwardingBtn) {
    els.stopForwardingBtn.addEventListener('click', () => stopForwarding());
  }

  // Password toggle functionality - use data attribute instead of innerHTML replacement
  const togglePasswordBtn = document.getElementById('toggle-password');
  if(togglePasswordBtn){
    const passwordInput = document.getElementById('hotspot-password');
    const iconEye = togglePasswordBtn.querySelector('svg');
    
    // Store original SVG content
    const eyeOpenSvg = `<path d="M1 12C1 12 5 4 12 4C19 4 23 12 23 12C23 12 19 20 12 20C5 20 1 12 1 12Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.5"/>`;
    const eyeClosedSvg = `<path d="M2.99902 3L20.999 21M9.8433 9.91364C9.32066 10.4536 8.99902 11.1892 8.99902 12C8.99902 13.6569 10.3422 15 12 15C12.8215 15 13.5667 14.669 14.1086 14.133M6.49902 6.64715C4.59972 7.90034 3.15305 9.78394 2.45703 12C3.73128 16.0571 7.52159 19 11.9992 19C13.9881 19 15.8414 18.4194 17.3988 17.4184M10.999 5.04939C11.328 5.01673 11.6617 5 11.9992 5C16.4769 5 20.2672 7.94291 21.5414 12C21.2607 12.894 20.8577 13.7338 20.3522 14.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`;
    
    togglePasswordBtn.addEventListener('click', () => {
      if(passwordInput.type === 'password'){
        passwordInput.type = 'text';
        iconEye.innerHTML = eyeClosedSvg;
      } else {
        passwordInput.type = 'password';
        iconEye.innerHTML = eyeOpenSvg;
      }
    });
  }
  if(els.dismissHotspotWarning) {
    els.dismissHotspotWarning.addEventListener('click', () => dismissHotspotWarning());
  }

  // Band change updates channel limits and saves settings
  const hotspotBandEl = document.getElementById('hotspot-band');
  if(hotspotBandEl) {
    hotspotBandEl.addEventListener('change', function() {
      const channelSelect = document.getElementById('hotspot-channel');
      const newBand = this.value;
      
      // Update channel options based on new band (wait for completion)
      updateChannelLimits(newBand).then(() => {
        // Save settings when band changes (after channel options are updated)
        if(window.HotspotFeature && window.HotspotFeature.saveHotspotSettings) {
          window.HotspotFeature.saveHotspotSettings();
        }
      });
    });
  }

  // Save settings when channel changes
  const hotspotChannelEl = document.getElementById('hotspot-channel');
  if(hotspotChannelEl) {
    hotspotChannelEl.addEventListener('change', function() {
      if(window.HotspotFeature && window.HotspotFeature.saveHotspotSettings) {
        window.HotspotFeature.saveHotspotSettings();
      }
    });
  }

  // Auto-save settings when SSID, password, or interface changes
  const hotspotSsidEl = document.getElementById('hotspot-ssid');
  const hotspotPasswordEl = document.getElementById('hotspot-password');
  const hotspotIfaceEl = document.getElementById('hotspot-iface');
  
  if(hotspotSsidEl) {
    hotspotSsidEl.addEventListener('input', function() {
      if(window.HotspotFeature && window.HotspotFeature.saveHotspotSettings) {
        window.HotspotFeature.saveHotspotSettings();
      }
    });
  }
  
  if(hotspotPasswordEl) {
    hotspotPasswordEl.addEventListener('input', function() {
      if(window.HotspotFeature && window.HotspotFeature.saveHotspotSettings) {
        window.HotspotFeature.saveHotspotSettings();
      }
    });
  }
  
  if(hotspotIfaceEl) {
    hotspotIfaceEl.addEventListener('change', function() {
      if(window.HotspotFeature && window.HotspotFeature.saveHotspotSettings) {
        window.HotspotFeature.saveHotspotSettings();
      }
    });
  }

  // Hotspot band change handler
  // Update channel options based on band value (can be passed as parameter or read from dropdown)
  // Returns a promise that resolves when options are populated (for race condition prevention)
  function updateChannelLimits(bandValue = null){
    return new Promise((resolve) => {
      const bandSelect = document.getElementById('hotspot-band');
      const channelSelect = document.getElementById('hotspot-channel');
      
      if(!bandSelect || !channelSelect) {
        resolve();
        return;
      }
      
      // Use provided band value, or read from dropdown
      const band = bandValue !== null ? bandValue : bandSelect.value;
      
      // Clear existing options
      channelSelect.innerHTML = '';
      
      // Get channels from constants
      const channels = band === '5' 
        ? APP_CONSTANTS.HOTSPOT.CHANNELS_5GHZ 
        : APP_CONSTANTS.HOTSPOT.CHANNELS_2_4GHZ;
      
      // Add options
      channels.forEach(ch => {
        const option = document.createElement('option');
        option.value = String(ch);
        option.textContent = String(ch);
        channelSelect.appendChild(option);
      });
      
      // Set default value (will be overridden if saved channel exists)
      const defaultChannel = band === '5' 
        ? APP_CONSTANTS.HOTSPOT.DEFAULT_CHANNEL_5GHZ 
        : APP_CONSTANTS.HOTSPOT.DEFAULT_CHANNEL_2_4GHZ;
      channelSelect.value = defaultChannel;
      
      // Use requestAnimationFrame to ensure DOM is updated before resolving
      requestAnimationFrame(() => {
        setTimeout(resolve, ANIMATION_DELAYS.CHANNEL_UPDATE_DELAY);
      });
    });
  }

  // Hotspot settings persistence - DELEGATED TO HotspotFeature MODULE
  // Functions removed - use window.HotspotFeature.saveHotspotSettings() and loadHotspotSettings() instead

  // ============================================================================
  // INITIALIZE FEATURE MODULES
  // ============================================================================
  function initFeatureModules() {
    // Create dependency objects for mutable values (using refs to sync)
    activeCommandIdRef = { 
      get value() { return activeCommandId; },
      set value(v) { activeCommandId = v; }
    };
    rootAccessConfirmedRef = { 
      get value() { return rootAccessConfirmed; },
      set value(v) { rootAccessConfirmed = v; }
    };
    hotspotActiveRef = { 
      get value() { return hotspotActive; },
      set value(v) { hotspotActive = v; }
    };
    forwardingActiveRef = { 
      get value() { return forwardingActive; },
      set value(v) { forwardingActive = v; }
    };
    sparseMigratedRef = { 
      get value() { return sparseMigrated; },
      set value(v) { sparseMigrated = v; }
    };

    // Common dependencies for all features
    const commonDeps = {
      // Mutable state (passed as refs)
      activeCommandId: activeCommandIdRef,
      rootAccessConfirmed: rootAccessConfirmedRef,
      hotspotActive: hotspotActiveRef,
      forwardingActive: forwardingActiveRef,
      sparseMigrated: sparseMigratedRef,
      
      // Constants
      CHROOT_DIR,
      PATH_CHROOT_SH,
      HOTSPOT_SCRIPT,
      FORWARD_NAT_SCRIPT,
      OTA_UPDATER,
      
      // Utilities
      Storage,
      StateManager,
      ButtonState,
      ProgressIndicator,
      PopupManager,
      DialogManager,
      ANIMATION_DELAYS,
      
      // Functions
      appendConsole,
      runCmdSync,
      runCmdAsync,
      withCommandGuard,
      disableAllActions,
      disableSettingsPopup,
      refreshStatus,
      updateStatus,
      checkForwardNatRunning,
      scrollConsoleToBottom,
      ensureChrootStarted,
      ensureChrootStopped,
      prepareActionExecution,
      forceScrollToBottom,
      forceScrollAfterDOMUpdate,
      validateCommandExecution,
      executeCommandWithProgress,
      els
    };

    // Initialize Forward NAT feature
    if(window.ForwardNatFeature) {
      ForwardNatFeature.init({
        ...commonDeps,
        forwardingActive: forwardingActiveRef,
        loadForwardingStatus: () => { forwardingActiveRef.value = StateManager.get('forwarding'); },
        saveForwardingStatus: () => { StateManager.set('forwarding', forwardingActiveRef.value); }
      });
    }

    // Initialize Hotspot feature
    if(window.HotspotFeature) {
      HotspotFeature.init({
        ...commonDeps,
        hotspotActive: hotspotActiveRef,
        loadHotspotStatus: () => { hotspotActiveRef.value = StateManager.get('hotspot'); },
        saveHotspotStatus: () => { StateManager.set('hotspot', hotspotActiveRef.value); },
        FORWARD_NAT_SCRIPT
      });
    }

    // Initialize Backup/Restore feature
    if(window.BackupRestoreFeature) {
      BackupRestoreFeature.init({
        ...commonDeps,
        showFilePickerDialog,
        showConfirmDialog,
        closeSettingsPopup
      });
    }

    // Initialize Uninstall feature
    if(window.UninstallFeature) {
      UninstallFeature.init({
        ...commonDeps,
        showConfirmDialog,
        closeSettingsPopup
      });
    }

    // Initialize Migrate feature
    if(window.MigrateFeature) {
      MigrateFeature.init({
        ...commonDeps,
        showSizeSelectionDialog,
        showConfirmDialog,
        closeSettingsPopup,
        updateStatus
      });
    }

    // Initialize Stop Network Services feature
    if(window.StopNetServices) {
      StopNetServices.init({
        ...commonDeps,
        checkAp0Interface,
        checkForwardNatRunning
      });
    }

    // Initialize Resize feature
    if(window.ResizeFeature) {
      ResizeFeature.init({
        ...commonDeps,
        sparseMigrated: sparseMigratedRef,
        showSizeSelectionDialog,
        showConfirmDialog,
        closeSettingsPopup,
        updateSparseInfo
      });
    }

  }

  // init
  initTheme();
  loadConsoleLogs(); // Restore previous console logs
  // Don't load hotspot settings here - will be loaded when popup opens (after interfaces are populated)
  loadHotspotStatus(); // Load hotspot status (will be synced with actual state in refreshStatus)
  loadForwardingStatus(); // Load forwarding status (will be synced with actual state in refreshStatus)
  loadDebugMode(); // Load debug mode status
  
  // Initialize channel options on page load based on saved settings
  function initializeChannelOptions() {
    const bandSelect = document.getElementById('hotspot-band');
    const channelSelect = document.getElementById('hotspot-channel');
    
    if(!bandSelect || !channelSelect) return;
    
    // Get saved settings to determine which band to use
    const savedSettings = Storage.getJSON('chroot_hotspot_settings');
    const defaultBand = APP_CONSTANTS.HOTSPOT.DEFAULT_BAND;
    const defaultChannel2_4 = APP_CONSTANTS.HOTSPOT.DEFAULT_CHANNEL_2_4GHZ;
    const defaultChannel5 = APP_CONSTANTS.HOTSPOT.DEFAULT_CHANNEL_5GHZ;
    const band = savedSettings && savedSettings.band ? savedSettings.band : defaultBand;
    
    // Set band value first
    bandSelect.value = band;
    
    // Populate channel options based on saved band (use promise to prevent race condition)
    updateChannelLimits(band).then(() => {
      // Set channel value if saved (after options are populated)
      if(savedSettings && savedSettings.channel && channelSelect) {
        const savedChannel = String(savedSettings.channel);
        const channelExists = Array.from(channelSelect.options).some(opt => opt.value === savedChannel);
        if(channelExists) {
          channelSelect.value = savedChannel;
        } else {
          // Channel doesn't exist for this band, use default
          channelSelect.value = band === '5' ? defaultChannel5 : defaultChannel2_4;
        }
      } else if(channelSelect) {
        // No saved channel, use default
        channelSelect.value = band === '5' ? defaultChannel5 : defaultChannel2_4;
      }
    });
  }
  
  // Initialize channel options on page load
  initializeChannelOptions();
  
  // Simple fix for stuck buttons on touch devices: blur on touchend
  // Store handler reference for cleanup to prevent memory leaks
  const touchEndHandler = (e) => {
    if(e.target && e.target.classList && e.target.classList.contains('btn-pressed')) {
      e.target.blur();
      e.target.classList.remove('btn-pressed', 'btn-released');
    }
  };
  document.addEventListener('touchend', touchEndHandler, { passive: true });
  
  // Store cleanup function for potential future use (e.g., page unload)
  window._chrootUICleanup = () => {
    document.removeEventListener('touchend', touchEndHandler);
  };

  initExperimentalFeatures(); // Initialize experimental features
  initFeatureModules(); // Initialize feature modules
  
  // small delay to let command-executor attach if present
  setTimeout(async ()=>{
    try {
    await checkRootAccess(); // Master root detection
    await refreshStatus(); // Wait for status check
    await readBootFile(); // Wait for boot file read
    } catch(e) {
      appendConsole(`Initialization error: ${e.message}`, 'err');
    }
  }, ANIMATION_DELAYS.INIT_DELAY);

  // Export some helpers for debug and expose constants to feature modules
  window.chrootUI = { refreshStatus, doAction, appendConsole };
  window.APP_CONSTANTS = APP_CONSTANTS; // Expose constants for feature modules
  window.updateChannelLimits = updateChannelLimits; // Expose for hotspot feature
})();
