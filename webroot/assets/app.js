// Chroot Control UI - Real-time async execution with non-blocking interface
(function(){
  // Use hardcoded paths provided by install.sh
  const PATH_CHROOT_SH = '/data/local/ubuntu-chroot/chroot.sh';
  const CHROOT_PATH_UI = '/data/local/ubuntu-chroot/rootfs';
  const BOOT_FILE = '/data/local/ubuntu-chroot/boot-service';
  const CHROOT_DIR = '/data/local/ubuntu-chroot';
  const POST_EXEC_SCRIPT = '/data/local/ubuntu-chroot/post_exec.sh';
  const HOTSPOT_SCRIPT = '/data/local/ubuntu-chroot/start-hotspot';
  const OTA_UPDATER = '/data/local/ubuntu-chroot/ota/updater.sh';

  const els = {
    statusDot: document.getElementById('status-dot'),
    statusText: document.getElementById('status-text'),
    startBtn: document.getElementById('start-btn'),
    stopBtn: document.getElementById('stop-btn'),
    restartBtn: document.getElementById('restart-btn'),
    console: document.getElementById('console'),
    clearConsole: document.getElementById('clear-console'),
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
    restoreBtn: document.getElementById('restore-btn'),
    uninstallBtn: document.getElementById('uninstall-btn'),
    hotspotBtn: document.getElementById('hotspot-btn'),
    hotspotPopup: document.getElementById('hotspot-popup'),
    closeHotspotPopup: document.getElementById('close-hotspot-popup'),
    startHotspotBtn: document.getElementById('start-hotspot-btn'),
    stopHotspotBtn: document.getElementById('stop-hotspot-btn'),
    hotspotForm: document.getElementById('hotspot-form'),
    hotspotWarning: document.getElementById('hotspot-warning'),
    dismissHotspotWarning: document.getElementById('dismiss-hotspot-warning')
  };

  // Track running commands to prevent UI blocking
  let activeCommandId = null;

  // Track hotspot state - much more reliable than filesystem checks
  let hotspotActive = false;

  /**
   * Load hotspot status from localStorage on page load
   */
  function loadHotspotStatus(){
    try{
      const saved = localStorage.getItem('hotspot_active');
      hotspotActive = saved === 'true';
    }catch(e){
      hotspotActive = false;
    }
  }

  /**
   * Save hotspot status to localStorage
   */
  function saveHotspotStatus(){
    try{
      localStorage.setItem('hotspot_active', hotspotActive.toString());
    }catch(e){/* ignore storage errors */}
  }

  // Track if chroot missing message was logged
  let _chrootMissingLogged = false;

  // Start with actions disabled until we verify the chroot exists
  disableAllActions(true);

  /**
   * Save console logs to localStorage
   */
  function saveConsoleLogs(){
    try{
      const logs = els.console.innerHTML;
      localStorage.setItem('chroot_console_logs', logs);
    }catch(e){/* ignore storage errors */}
  }

  /**
   * Load console logs from localStorage
   */
  function loadConsoleLogs(){
    try{
      const logs = localStorage.getItem('chroot_console_logs');
      if(logs) els.console.innerHTML = logs;
    }catch(e){/* ignore storage errors */}
  }

  /**
   * Fetch available users from chroot /etc/passwd
   */
  async function fetchUsers(){
    if(!rootAccessConfirmed){
      return; // Don't attempt command - root check already printed error
    }
    
    try{
      // Use proper root command to read passwd file from chroot - only regular users (UID >= 1000)
      const cmd = `grep -E ":x:10[0-9][0-9]:" ${CHROOT_PATH_UI}/etc/passwd 2>/dev/null | cut -d: -f1 | head -20`;
      const out = await runCmdSync(cmd);
      const users = String(out || '').trim().split('\n').filter(u => u && u.length > 0);

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
      const savedUser = localStorage.getItem('chroot_selected_user');
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
   */
  function appendConsole(text, cls){
    const pre = els.console;
    const line = document.createElement('div');
    if(cls) line.className = cls;
    line.textContent = text;
    pre.appendChild(line);
    
    // Auto-scroll to bottom for real-time feel
    pre.scrollTop = pre.scrollHeight;
    
    // Save logs after each append
    saveConsoleLogs();
  }

  /**
   * Add button press animation
   */
  function animateButton(btn){
    btn.classList.add('btn-pressed');
    setTimeout(() => btn.classList.remove('btn-pressed'), 150);
  }

  /**
   * Run command asynchronously
   * Note: KernelSU/libsuperuser don't support true streaming
   */
  function runCmdAsync(cmd, onComplete){
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

    const commandId = cmdExec.executeAsync(cmd, true, {
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
        activeCommandId = null;
        if(onComplete) onComplete(result);
      }
    });

    activeCommandId = commandId;
    return commandId;
  }

  /**
   * Legacy sync command for simple operations
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

    try {
      const out = await cmdExec.execute(cmd, true);
      return out;
    } catch(err) {
      // Don't print duplicate error if root check already failed
      if(rootAccessConfirmed) {
        appendConsole(String(err), 'err');
      }
      throw err;
    }
  }

  function disableAllActions(disabled){
    try{
      // Main action buttons
      els.startBtn.disabled = disabled;
      els.stopBtn.disabled = disabled;
      els.restartBtn.disabled = disabled;
      els.userSelect.disabled = disabled;
      els.settingsBtn.disabled = disabled;
      els.settingsBtn.style.opacity = disabled ? '0.5' : '';
      els.hotspotBtn.disabled = disabled;
      els.hotspotBtn.style.opacity = disabled ? '0.5' : '';
      
      // Additional UI elements that should be disabled during operations
      els.clearConsole.disabled = disabled;
      els.clearConsole.style.opacity = disabled ? '0.5' : '';
      els.refreshStatus.disabled = disabled;
      els.refreshStatus.style.opacity = disabled ? '0.5' : '';
      if(els.themeToggle){
        els.themeToggle.disabled = disabled;
        els.themeToggle.style.opacity = disabled ? '0.5' : '';
      }
      
      const copyBtn = document.getElementById('copy-login');
      if(copyBtn) copyBtn.disabled = disabled;
      
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
   * Execute chroot action asynchronously (non-blocking), with hotspot handling for stop/restart
   */
  async function doAction(action, btn){
    if(activeCommandId) {
      appendConsole('⚠ Another command is already running. Please wait...', 'warn');
      return;
    }

    animateButton(btn);
    appendConsole(`━━━ Starting ${action} ━━━`, 'info');
    
    // Show progress indicator IMMEDIATELY
    const progressLine = document.createElement('div');
    progressLine.className = 'progress-indicator';
    const actionText = action.charAt(0).toUpperCase() + action.slice(1) + 'ing chroot';
    progressLine.textContent = '⏳ ' + actionText;
    els.console.appendChild(progressLine);
    els.console.scrollTop = els.console.scrollHeight;
    
    let dotCount = 0;
    const progressInterval = setInterval(() => {
      dotCount = (dotCount + 1) % 4;
      progressLine.textContent = '⏳ ' + actionText + '.'.repeat(dotCount);
    }, 400);
    
    // Disable ALL UI elements during execution
    disableAllActions(true);
    disableSettingsPopup(true);

    // Check for hotspot on stop/restart
    let hotspotWasRunning = false;
    if(action === 'stop' || action === 'restart'){
      try{
        // Use actual interface check instead of saved state for accuracy
        hotspotWasRunning = await checkAp0Interface();
        if(hotspotWasRunning){
          progressLine.textContent = '⏳ Stopping hotspot first';
          dotCount = 0; // reset dots
          
          // Stop hotspot first
          await new Promise((resolve, reject) => {
            runCmdAsync(`sh ${HOTSPOT_SCRIPT} -k 2>&1`, (result) => {
              if(result.success) {
                appendConsole('✓ Hotspot stopped successfully', 'success');
                hotspotActive = false; // Update state
                saveHotspotStatus(); // Save to localStorage
                resolve();
              } else {
                appendConsole('✗ Failed to stop hotspot, continuing with chroot action', 'warn');
                resolve(); // Continue anyway
              }
            });
          });
        }
      }catch(e){
        appendConsole('⚠ Could not check hotspot status, proceeding with chroot action', 'warn');
      }
    }

    // Use --no-shell flag to prevent blocking on interactive shell
    const cmd = `sh ${PATH_CHROOT_SH} ${action} --no-shell`;
    
    // Use setTimeout to allow UI to update before blocking command
    setTimeout(() => {
      runCmdAsync(cmd, (result) => {
        clearInterval(progressInterval);
        progressLine.remove();
        
        if(result.success) {
          appendConsole(`✓ ${action} completed successfully`, 'success');
        } else {
          appendConsole(`✗ ${action} failed`, 'err');
        }
        
        // Re-enable buttons and refresh status after completion
        setTimeout(() => refreshStatus(), 500);
      });
    }, 50);
  }


  /**
   * Refresh chroot status (non-blocking)
   */
  async function refreshStatus(){
    if(!rootAccessConfirmed){
      updateStatus('unknown');
      disableAllActions(true);
      return; // Don't attempt commands - root check already printed error
    }

    try{
      // Check if chroot directory exists
      let exists = await cmdExec.execute(`test -d ${CHROOT_PATH_UI} && echo 1 || echo 0`, true);

      if(String(exists||'').trim() !== '1'){
        if(!_chrootMissingLogged){
          appendConsole(`⚠ Chroot directory not found at ${CHROOT_PATH_UI}`, 'err');
          _chrootMissingLogged = true;
        }
        updateStatus('stopped');
        // When chroot doesn't exist: disable start/hotspot buttons but enable other main UI elements
        disableAllActions(false); // Enable clear, refresh, dark mode, settings button
        // But disable start and hotspot buttons since they can't work without chroot
        if(els.startBtn) {
          els.startBtn.disabled = true;
          els.startBtn.style.opacity = '0.5';
        }
        if(els.stopBtn) {
          els.stopBtn.disabled = true;
          els.stopBtn.style.opacity = '0.5';
        }
        if(els.restartBtn) {
          els.restartBtn.disabled = true;
          els.restartBtn.style.opacity = '0.5';
        }
        if(els.hotspotBtn) {
          els.hotspotBtn.disabled = true;
          els.hotspotBtn.style.opacity = '0.5';
        }
        disableSettingsPopup(false, false); // Enable popup but disable chroot-dependent elements
        try{ document.getElementById('copy-login').disabled = true; }catch(e){}
        return;
      } else {
        _chrootMissingLogged = false;
        // Re-enable actions when chroot exists
        disableAllActions(false);
        disableSettingsPopup(false, true); // chroot exists
      }

      // Get status without blocking UI
      const out = await runCmdSync(`sh ${PATH_CHROOT_SH} status`);
      const s = String(out || '');
      // Check for "Status: RUNNING" from the status output
      const running = /Status:\s*RUNNING/i.test(s);
      updateStatus(running ? 'running' : 'stopped');

      // Enable copy-login button when running
      try{ document.getElementById('copy-login').disabled = !running; }catch(e){}

      // Handle user select dropdown
      if(running){
        els.userSelect.disabled = false;
        if(rootAccessConfirmed){
          // Hotspot button enabled, but individual start/stop buttons depend on hotspot state
          els.hotspotBtn.disabled = false;
          els.hotspotBtn.style.opacity = '';
          
          // Check actual ap0 interface status to validate our saved state
          const ap0Exists = await checkAp0Interface();
          if(ap0Exists !== hotspotActive){
            // State mismatch - update our saved state to match reality
            hotspotActive = ap0Exists;
            saveHotspotStatus();
            appendConsole(`Hotspot state corrected: ${ap0Exists ? 'running' : 'stopped'}`, ap0Exists ? 'info' : 'warn');
          }
          
          // Disable individual hotspot buttons based on hotspot state
          els.startHotspotBtn.disabled = hotspotActive;
          els.stopHotspotBtn.disabled = !hotspotActive;
          els.startHotspotBtn.style.opacity = hotspotActive ? '0.5' : '';
          els.stopHotspotBtn.style.opacity = !hotspotActive ? '0.5' : '';
        }
        // Fetch users when chroot is running
        fetchUsers();
      } else {
        els.userSelect.disabled = true;
        els.hotspotBtn.disabled = true;
        els.hotspotBtn.style.opacity = '0.5';
        // Disable individual hotspot buttons when chroot not running
        els.startHotspotBtn.disabled = true;
        els.stopHotspotBtn.disabled = true;
        els.startHotspotBtn.style.opacity = '0.5';
        els.stopHotspotBtn.style.opacity = '0.5';
        // Reset to root when not running
        els.userSelect.innerHTML = '<option value="root">root</option>';
        // Reset hotspot state when chroot stops
        hotspotActive = false;
        saveHotspotStatus(); // Save to localStorage
      }
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
  async function readBootFile(){
    if(!rootAccessConfirmed){
      els.bootToggle.checked = false; // Default to disabled
      return; // Don't attempt command - root check already printed error
    }
    
    try{
      if(window.cmdExec && typeof cmdExec.execute === 'function'){
        const out = await cmdExec.execute(`cat ${BOOT_FILE} 2>/dev/null || echo 0`, true);
        const v = String(out||'').trim();
        els.bootToggle.checked = v === '1';
        appendConsole('Run-at-boot: '+ (v==='1' ? 'enabled' : 'disabled'));
      } else {
        appendConsole('Backend not available', 'err');
        els.bootToggle.checked = false;
      }
    }catch(e){
      console.error(e);
      appendConsole(`Failed to read boot setting: ${e.message}`, 'err');
      els.bootToggle.checked = false;
    }
  }

  // copy login command
  function copyLoginCommand(){
    const selectedUser = els.userSelect.value;
    // Save selected user
    try{ localStorage.setItem('chroot_selected_user', selectedUser); }catch(e){}

    // Generate login command for selected user
    const cmd = `su -c "sh ${PATH_CHROOT_SH} start -s ${selectedUser}"`;
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(cmd).then(()=> appendConsole(`Login command for user '${selectedUser}' copied to clipboard`))
        .catch(()=> appendConsole('Failed to copy to clipboard'));
    } else {
      // fallback
      appendConsole(cmd);
      try{ window.prompt('Copy login command (Ctrl+C):', cmd); }catch(e){}
    }
  }

  // Master root detection function - checks backend once and sets UI state
  async function checkRootAccess(){
    if(!window.cmdExec || typeof cmdExec.execute !== 'function'){
      appendConsole('No root bridge detected — running offline. Actions disabled.');
      disableAllActions(true);
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
    }catch(e){
      // If failed, show the backend error message once
      rootAccessConfirmed = false;
      appendConsole(`Failed to detect root execution method: ${e.message}`, 'err');
      // Then disable all root-dependent UI elements
      disableAllActions(true);
      disableSettingsPopup(true, true); // assume chroot exists for now
    }
  }

  // Settings popup functions
  async function openSettingsPopup(){
    // Load current post-exec script
    await loadPostExecScript();
    // Show popup with animation
    els.settingsPopup.classList.add('active');
  }

  function closeSettingsPopup(){
    els.settingsPopup.classList.remove('active');
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
      const base64Script = btoa(unescape(encodeURIComponent(script)));
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

  // Hotspot functions
  function openHotspotPopup(){
    // Show warning banner on first visit
    showHotspotWarning();
    els.hotspotPopup.classList.add('active');
  }

  function closeHotspotPopup(){
    els.hotspotPopup.classList.remove('active');
  }

  function showHotspotWarning(){
    if(!els.hotspotWarning) return;
    
    // Check if user has already dismissed the warning
    const dismissed = localStorage.getItem('hotspot_warning_dismissed') === 'true';
    if(dismissed){
      els.hotspotWarning.classList.add('hidden');
    } else {
      els.hotspotWarning.classList.remove('hidden');
    }
  }

  function dismissHotspotWarning(){
    if(!els.hotspotWarning) return;
    
    // Hide the warning and save dismissal to localStorage
    els.hotspotWarning.classList.add('hidden');
    try{ localStorage.setItem('hotspot_warning_dismissed', 'true'); }catch(e){}
  }

  async function startHotspot(){
    if(activeCommandId) {
      appendConsole('⚠ Another command is already running. Please wait...', 'warn');
      return;
    }

    if(!rootAccessConfirmed){
      appendConsole('Cannot start hotspot: root access not available', 'err');
      return;
    }

    const iface = document.getElementById('hotspot-iface').value.trim();
    const ssid = document.getElementById('hotspot-ssid').value.trim();
    const password = document.getElementById('hotspot-password').value;
    const band = document.getElementById('hotspot-band').value;
    const channel = document.getElementById('hotspot-channel').value;

    if(!iface || !ssid || !password || !channel){
      appendConsole('All fields are required', 'err');
      return;
    }

    if(password.length < 8){
      appendConsole('Password must be at least 8 characters', 'err');
      return;
    }

    saveHotspotSettings(); // Save settings before starting

    closeHotspotPopup();
    appendConsole(`━━━ Starting hotspot '${ssid}' ━━━`, 'info');
    
    // Show progress indicator IMMEDIATELY
    const progressLine = document.createElement('div');
    progressLine.className = 'progress-indicator';
    const actionText = `Starting hotspot '${ssid}'`;
    progressLine.textContent = '⏳ ' + actionText;
    els.console.appendChild(progressLine);
    els.console.scrollTop = els.console.scrollHeight;
    
    let spinIndex = 0;
    const spinner = ['|', '/', '-', '\\'];
    const progressInterval = setInterval(() => {
      spinIndex = (spinIndex + 1) % 4;
      progressLine.textContent = '⏳ ' + actionText + ' ' + spinner[spinIndex];
    }, 200);
    
    // Disable hotspot button during execution
    els.hotspotBtn.disabled = true;
    els.hotspotBtn.style.opacity = '0.5';
    
    // Mark as active to prevent other commands
    activeCommandId = 'hotspot-start';

    // Redirect stderr to stdout to capture all output
    const cmd = `sh ${HOTSPOT_SCRIPT} -o ${iface} -s ${ssid} -p ${password} -b ${band} -c ${channel} 2>&1`;
    
    // Use setTimeout to allow UI to update, then run sync command wrapped as async
    setTimeout(async () => {
      try {
        const output = await runCmdSync(cmd);
        clearInterval(progressInterval);
        progressLine.remove();
        
        // Display all output line by line
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
          hotspotActive = true; // Update state
          saveHotspotStatus(); // Save to localStorage
          // Immediately update button states
          els.startHotspotBtn.disabled = true;
          els.stopHotspotBtn.disabled = false;
          els.startHotspotBtn.style.opacity = '0.5';
          els.stopHotspotBtn.style.opacity = '';
        } else {
          appendConsole(`✗ Failed to start hotspot`, 'err');
        }
      } catch(error) {
        clearInterval(progressInterval);
        progressLine.remove();
        
        // Display error output line by line
        const errorMsg = String(error.message || error);
        const lines = errorMsg.split('\n');
        lines.forEach(line => {
          if(line.trim()) {
            appendConsole(line, 'err');
          }
        });
        
        appendConsole(`✗ Hotspot failed to start`, 'err');
      } finally {
        activeCommandId = null;
        els.hotspotBtn.disabled = false;
        els.hotspotBtn.style.opacity = '';
      }
    }, 50);
  }

  async function stopHotspot(){
    if(activeCommandId) {
      appendConsole('⚠ Another command is already running. Please wait...', 'warn');
      return;
    }

    if(!rootAccessConfirmed){
      appendConsole('Cannot stop hotspot: root access not available', 'err');
      return;
    }

    closeHotspotPopup();
    appendConsole(`━━━ Stopping hotspot ━━━`, 'info');

    // Show progress indicator IMMEDIATELY
    const progressLine = document.createElement('div');
    progressLine.className = 'progress-indicator';
    const actionText = 'Stopping hotspot';
    progressLine.textContent = '⏳ ' + actionText;
    els.console.appendChild(progressLine);
    els.console.scrollTop = els.console.scrollHeight;

    let spinIndex = 0;
    const spinner = ['|', '/', '-', '\\'];
    const progressInterval = setInterval(() => {
      spinIndex = (spinIndex + 1) % 4;
      progressLine.textContent = '⏳ ' + actionText + ' ' + spinner[spinIndex];
    }, 200);

    // Disable hotspot button during execution
    els.hotspotBtn.disabled = true;
    els.hotspotBtn.style.opacity = '0.5';

    // Redirect stderr to stdout to capture all output
    const cmd = `sh ${HOTSPOT_SCRIPT} -k 2>&1`;

    // Use setTimeout to allow UI to update before blocking command
    setTimeout(() => {
      runCmdAsync(cmd, (result) => {
        clearInterval(progressInterval);
        progressLine.remove();
        
        if(result.success) {
          appendConsole(`✓ Hotspot stopped successfully`, 'success');
          hotspotActive = false; // Update state
          saveHotspotStatus(); // Save to localStorage
          // Immediately update button states
          els.startHotspotBtn.disabled = false;
          els.stopHotspotBtn.disabled = true;
          els.startHotspotBtn.style.opacity = '';
          els.stopHotspotBtn.style.opacity = '0.5';
        } else {
          appendConsole(`✗ Failed to stop hotspot (exit code: ${result.exitCode || 'unknown'})`, 'err');
        }
        
        // Re-enable hotspot button
        els.hotspotBtn.disabled = false;
        els.hotspotBtn.style.opacity = '';
      });
    }, 50);
  }

  async function updateChroot(){
    if(activeCommandId) {
      appendConsole('⚠ Another command is already running. Please wait...', 'warn');
      return;
    }

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
    appendConsole('━━━ Starting Chroot Update ━━━', 'info');

    // Show progress indicator IMMEDIATELY
    const progressLine = document.createElement('div');
    progressLine.className = 'progress-indicator';
    progressLine.textContent = '⏳ Updating chroot';
    els.console.appendChild(progressLine);
    els.console.scrollTop = els.console.scrollHeight;

    let dotCount = 0;
    const progressInterval = setInterval(() => {
      dotCount = (dotCount + 1) % 4;
      progressLine.textContent = '⏳ Updating chroot' + '.'.repeat(dotCount);
    }, 400);

    // Disable settings button during update
    els.settingsBtn.disabled = true;
    els.settingsBtn.style.opacity = '0.5';

    // Mark as active to prevent other commands
    activeCommandId = 'chroot-update';

    const cmd = `sh ${OTA_UPDATER}`;

    // Use setTimeout to allow UI to update
    setTimeout(() => {
      runCmdAsync(cmd, (result) => {
        clearInterval(progressInterval);
        progressLine.remove();

        if(result.success) {
          appendConsole('✓ Chroot update completed successfully', 'success');
          appendConsole('━━━ Update Complete ━━━', 'success');
        } else {
          appendConsole('✗ Chroot update failed', 'err');
        }

        activeCommandId = null;
        els.settingsBtn.disabled = false;
        els.settingsBtn.style.opacity = '';

        // Refresh status after update
        setTimeout(() => refreshStatus(), 500);
      });
    }, 50);
  }

  async function backupChroot(){
    if(activeCommandId) {
      appendConsole('⚠ Another command is already running. Please wait...', 'warn');
      return;
    }

    // Get backup path
    const backupPath = await showFilePickerDialog(
      'Backup Chroot Environment',
      'Select where to save the backup file.\n\nThe chroot will be stopped during backup if it\'s currently running.',
      '/sdcard',
      `chroot-backup-${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.tar.gz`
    );

    if(!backupPath) return;

    // Confirm
    const confirmed = await showConfirmDialog(
      'Backup Chroot Environment',
      `This will create a compressed backup of your chroot environment.\n\nThe chroot will be stopped during backup if it's currently running.\n\nBackup location: ${backupPath}\n\nContinue?`,
      'Backup',
      'Cancel'
    );

    if(!confirmed) return;

    // Close popup and wait for animation
    closeSettingsPopup();
    await new Promise(resolve => setTimeout(resolve, 750));

    // Start backup
    appendConsole('━━━ Starting Chroot Backup ━━━', 'info');

    const progressLine = document.createElement('div');
    progressLine.className = 'progress-indicator';
    progressLine.textContent = '⏳ Backing up chroot';
    els.console.appendChild(progressLine);
    els.console.scrollTop = els.console.scrollHeight;

    let dotCount = 0;
    const progressInterval = setInterval(() => {
      dotCount = (dotCount + 1) % 4;
      progressLine.textContent = '⏳ Backing up chroot' + '.'.repeat(dotCount);
    }, 400);

    disableAllActions(true);
    disableSettingsPopup(true);

    // Check if chroot is running
    const isRunning = els.statusText.textContent.trim() === 'running';

    if(isRunning){
      // Stop chroot first
      progressLine.textContent = '⏳ Stopping chroot';
      dotCount = 0;

      setTimeout(() => {
        runCmdAsync(`sh ${PATH_CHROOT_SH} stop >/dev/null 2>&1`, (result) => {
          if(result.success) {
            appendConsole('✓ Chroot stopped for backup', 'success');
            // Now proceed to backup
            proceedToBackup();
          } else {
            clearInterval(progressInterval);
            progressLine.remove();
            appendConsole('✗ Failed to stop chroot', 'err');
            appendConsole('Backup aborted - please stop the chroot manually first', 'err');
            activeCommandId = null;
            disableAllActions(false);
            disableSettingsPopup(false, true);
          }
        });
      }, 50);
    } else {
      // Chroot not running, proceed directly
      proceedToBackup();
    }

    function proceedToBackup(){
      progressLine.textContent = '⏳ Creating backup';
      dotCount = 0;

      setTimeout(() => {
        runCmdAsync(`sh ${PATH_CHROOT_SH} backup --webui "${backupPath}"`, (result) => {
          clearInterval(progressInterval);
          progressLine.remove();

          if(result.success) {
            appendConsole('✓ Backup completed successfully', 'success');
            appendConsole(`Saved to: ${backupPath}`, 'info');
            appendConsole('━━━ Backup Complete ━━━', 'success');
          } else {
            appendConsole('✗ Backup failed', 'err');
          }

          activeCommandId = null;
          disableAllActions(false);
          disableSettingsPopup(false, true);

          setTimeout(() => refreshStatus(), 500);
        });
      }, 50);
    }
  }

  async function restoreChroot(){
    if(activeCommandId) {
      appendConsole('⚠ Another command is already running. Please wait...', 'warn');
      return;
    }

    if(!rootAccessConfirmed){
      appendConsole('Cannot restore chroot: root access not available', 'err');
      return;
    }

    // Get backup file
    const backupPath = await showFilePickerDialog(
      'Restore Chroot Environment',
      'Select the backup file to restore from.\n\nWARNING: This will permanently delete your current chroot environment!',
      '/sdcard',
      '',
      true // forRestore = true
    );

    if(!backupPath) return;

    // Confirm with warning
    const confirmed = await showConfirmDialog(
      'Restore Chroot Environment',
      `⚠️ WARNING: This will permanently delete your current chroot environment and replace it with the backup!\n\nAll current data in the chroot will be lost.\n\nBackup file: ${backupPath}\n\nThis action cannot be undone. Continue?`,
      'Restore',
      'Cancel'
    );

    if(!confirmed) return;

    // Close popup and wait for animation
    closeSettingsPopup();
    await new Promise(resolve => setTimeout(resolve, 750));

    // Start restore
    appendConsole('━━━ Starting Chroot Restore ━━━', 'warn');

    const progressLine = document.createElement('div');
    progressLine.className = 'progress-indicator';
    progressLine.textContent = '⏳ Restoring chroot';
    els.console.appendChild(progressLine);
    els.console.scrollTop = els.console.scrollHeight;

    let dotCount = 0;
    const progressInterval = setInterval(() => {
      dotCount = (dotCount + 1) % 4;
      progressLine.textContent = '⏳ Restoring chroot' + '.'.repeat(dotCount);
    }, 400);

    disableAllActions(true);
    disableSettingsPopup(true);

    // Check if chroot is running
    const isRunning = els.statusText.textContent.trim() === 'running';

    if(isRunning){
      // Stop chroot first
      progressLine.textContent = '⏳ Stopping chroot';
      dotCount = 0;

      setTimeout(() => {
        runCmdAsync(`sh ${PATH_CHROOT_SH} stop >/dev/null 2>&1`, (result) => {
          if(result.success) {
            appendConsole('✓ Chroot stopped for restore', 'success');
            // Now proceed to remove
            proceedToRemove();
          } else {
            clearInterval(progressInterval);
            progressLine.remove();
            appendConsole('✗ Failed to stop chroot', 'err');
            appendConsole('Restore aborted - please stop the chroot manually first', 'err');
            activeCommandId = null;
            disableAllActions(false);
            disableSettingsPopup(false, true);
          }
        });
      }, 50);
    } else {
      // Chroot not running, proceed directly to remove
      proceedToRemove();
    }

    function proceedToRemove(){
      progressLine.textContent = '⏳ Removing current chroot';
      dotCount = 0;

      setTimeout(() => {
        // First check if directory exists
        runCmdSync(`[ -d "${CHROOT_PATH_UI}" ] && echo "exists" || echo "not_exists"`).then((checkResult) => {
          const dirExists = checkResult && checkResult.trim() === 'exists';
          
          // Remove directory
          runCmdAsync(`rm -rf ${CHROOT_PATH_UI}`, (result) => {
            if(result.success) {
              if(dirExists) {
                appendConsole('✓ Existing chroot directory removed', 'success');
              }
              // Now proceed to restore
              proceedToRestore();
            } else {
              clearInterval(progressInterval);
              progressLine.remove();
              appendConsole('✗ Failed to remove existing chroot directory', 'err');
              appendConsole('Restore aborted - please remove the directory manually first', 'err');
              activeCommandId = null;
              disableAllActions(false);
              disableSettingsPopup(false, false);
            }
          });
        }).catch(() => {
          // If check fails, assume directory exists and proceed with removal
          runCmdAsync(`rm -rf ${CHROOT_PATH_UI}`, (result) => {
            if(result.success) {
              appendConsole('✓ Existing chroot directory removed', 'success');
              // Now proceed to restore
              proceedToRestore();
            } else {
              clearInterval(progressInterval);
              progressLine.remove();
              appendConsole('✗ Failed to remove existing chroot directory', 'err');
              appendConsole('Restore aborted - please remove the directory manually first', 'err');
              activeCommandId = null;
              disableAllActions(false);
              disableSettingsPopup(false, false);
            }
          });
        });
      }, 50);
    }

    function proceedToRestore(){
      progressLine.textContent = '⏳ Extracting backup';
      dotCount = 0;

      setTimeout(() => {
        runCmdAsync(`sh ${PATH_CHROOT_SH} restore --webui "${backupPath}"`, (result) => {
          clearInterval(progressInterval);
          progressLine.remove();

          if(result.success) {
            appendConsole('✓ Restore completed successfully', 'success');
            appendConsole('The chroot environment has been restored', 'info');
            appendConsole('━━━ Restore Complete ━━━', 'success');

            updateStatus('stopped');
            disableAllActions(true);
          } else {
            appendConsole('✗ Restore failed', 'err');
            disableAllActions(false);
          }

          activeCommandId = null;
          disableSettingsPopup(false, true);

          setTimeout(() => refreshStatus(), 1000);
        });
      }, 50);
    }
  }

  async function uninstallChroot(){ 
    if(activeCommandId) {
      appendConsole('⚠ Another command is already running. Please wait...', 'warn');
      return;
    }

    // Custom confirmation dialog with Yes/No buttons
    const confirmed = await showConfirmDialog(
      'Uninstall Chroot Environment',
      'Are you sure you want to uninstall the chroot environment?\n\nThis will permanently delete all data in the chroot and cannot be undone.',
      'Uninstall',
      'Cancel'
    );

    if(!confirmed){
      return;
    }

    // Small delay to ensure confirmation dialog is fully closed
    await new Promise(resolve => setTimeout(resolve, 100));

    // Close settings popup with smooth animation
    closeSettingsPopup();
    
    // Wait for settings popup animation to complete (1500ms for fade out)
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Now we're back at main UI - start uninstall process
    appendConsole('━━━ Starting Uninstallation ━━━', 'warn');
    
    // Show progress indicator IMMEDIATELY
    const progressLine = document.createElement('div');
    progressLine.className = 'progress-indicator';
    progressLine.textContent = '⏳ Uninstalling chroot';
    els.console.appendChild(progressLine);
    els.console.scrollTop = els.console.scrollHeight;
    
    let dotCount = 0;
    const progressInterval = setInterval(() => {
      dotCount = (dotCount + 1) % 4;
      progressLine.textContent = '⏳ Uninstalling chroot' + '.'.repeat(dotCount);
    }, 400);
    
    // Disable all actions during uninstall
    disableAllActions(true);
    disableSettingsPopup(true);

    // Check current status from UI state - no need for additional command
    const currentStatus = els.statusText.textContent.trim();
    const isRunning = currentStatus === 'running';
    
    if(isRunning){
      progressLine.textContent = '⏳ Stopping chroot';
      dotCount = 0; // reset dots
      
      // Stop chroot first
      setTimeout(() => {
        runCmdAsync(`sh ${PATH_CHROOT_SH} stop >/dev/null 2>&1`, (result) => {
          if(result.success) {
            // Proceed to removal after successful stop
            proceedToRemove();
          } else {
            clearInterval(progressInterval);
            progressLine.remove();
            
            appendConsole('✗ Failed to stop chroot', 'err');
            appendConsole('Uninstallation aborted - please stop the chroot manually first', 'err');
            disableAllActions(false);
            disableSettingsPopup(false, false); // chroot no longer exists after uninstall
          }
        });
      }, 50);
    } else {
      // Chroot not running - proceed directly to removal
      proceedToRemove();
    }

    // Helper function to remove chroot files
    function proceedToRemove(){
      progressLine.textContent = '⏳ Removing files';
      dotCount = 0; // reset dots
      
      // Remove chroot directory
      setTimeout(() => {
        runCmdAsync(`rm -rf ${CHROOT_PATH_UI}`, (result) => {
          clearInterval(progressInterval);
          progressLine.remove();
          
          if(result.success) {
            appendConsole('✅ Chroot uninstalled successfully!', 'success');
            appendConsole('All chroot data has been removed.', 'info');
            appendConsole('━━━ Uninstallation Complete ━━━', 'success');
            
            // Update UI to reflect removal
            updateStatus('stopped');
            disableAllActions(true);
          } else {
            appendConsole('✗ Failed to remove chroot files', 'err');
            appendConsole('You may need to manually remove the directory', 'warn');
            disableAllActions(false);
          }
          
          // Always re-enable settings popup after completion
          disableSettingsPopup(false, false); // chroot no longer exists after uninstall
          
          // Refresh status to update UI
          setTimeout(() => refreshStatus(), 1000);
        });
      }, 50);
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
      // Also disable individual popup elements with visual feedback
      if(els.postExecScript) {
        const postExecDisabled = disabled || !chrootExists; // Always disable when no chroot exists
        els.postExecScript.disabled = postExecDisabled;
        els.postExecScript.style.opacity = postExecDisabled ? '0.5' : '';
        els.postExecScript.style.cursor = postExecDisabled ? 'not-allowed' : '';
        els.postExecScript.style.pointerEvents = postExecDisabled ? 'none' : '';
      }
      if(els.saveScript) {
        const saveDisabled = disabled || !chrootExists; // Always disable when no chroot exists
        els.saveScript.disabled = saveDisabled;
        els.saveScript.style.opacity = saveDisabled ? '0.5' : '';
        els.saveScript.style.cursor = saveDisabled ? 'not-allowed' : '';
        els.saveScript.style.pointerEvents = saveDisabled ? 'none' : '';
      }
      if(els.clearScript) {
        const clearDisabled = disabled || !chrootExists; // Always disable when no chroot exists
        els.clearScript.disabled = clearDisabled;
        els.clearScript.style.opacity = clearDisabled ? '0.5' : '';
        els.clearScript.style.cursor = clearDisabled ? 'not-allowed' : '';
        els.clearScript.style.pointerEvents = clearDisabled ? 'none' : '';
      }
      if(els.updateBtn) {
        const updateDisabled = disabled || !chrootExists; // Also disable when no chroot exists
        els.updateBtn.disabled = updateDisabled;
        els.updateBtn.style.opacity = updateDisabled ? '0.5' : '';
        els.updateBtn.style.cursor = updateDisabled ? 'not-allowed' : '';
        els.updateBtn.style.pointerEvents = updateDisabled ? 'none' : '';
      }
      
      // ✅ FIXED: Backup button - disabled when chroot doesn't exist OR no root access
      if(els.backupBtn) {
        const backupDisabled = disabled || !chrootExists;
        els.backupBtn.disabled = backupDisabled;
        els.backupBtn.style.opacity = backupDisabled ? '0.5' : '';
        els.backupBtn.style.cursor = backupDisabled ? 'not-allowed' : '';
        els.backupBtn.style.pointerEvents = backupDisabled ? 'none' : '';
      }
      
      // ✅ FIXED: Restore button - only disabled when no root access (ALWAYS available with root)
      if(els.restoreBtn) {
        const restoreDisabled = disabled; // Only check the 'disabled' parameter (which reflects root access)
        els.restoreBtn.disabled = restoreDisabled;
        els.restoreBtn.style.opacity = restoreDisabled ? '0.5' : '';
        els.restoreBtn.style.cursor = restoreDisabled ? 'not-allowed' : '';
        els.restoreBtn.style.pointerEvents = restoreDisabled ? 'none' : '';
      }
      
      if(els.uninstallBtn) {
        // Uninstall should be disabled when chroot doesn't exist OR no root access
        const uninstallDisabled = disabled || !chrootExists;
        els.uninstallBtn.disabled = uninstallDisabled;
        els.uninstallBtn.style.opacity = uninstallDisabled ? '0.5' : '';
        els.uninstallBtn.style.cursor = uninstallDisabled ? 'not-allowed' : '';
        els.uninstallBtn.style.pointerEvents = uninstallDisabled ? 'none' : '';
      }
    }catch(e){}
  }

  // Custom confirmation dialog function
  function showConfirmDialog(title, message, confirmText = 'Yes', cancelText = 'No'){
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
        z-index: 2000;
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
        margin: 0 0 20px 0;
        font-size: 14px;
        color: var(--muted);
        line-height: 1.5;
        white-space: pre-line;
      `;

      // Create button container
      const buttonContainer = document.createElement('div');
      buttonContainer.style.cssText = `
        display: flex;
        gap: 12px;
        justify-content: flex-end;
      `;

      // Create cancel button
      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = cancelText;
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

      // Create confirm button
      const confirmBtn = document.createElement('button');
      confirmBtn.textContent = confirmText;
      confirmBtn.style.cssText = `
        padding: 8px 16px;
        border: 1px solid var(--danger);
        border-radius: 8px;
        background: var(--danger);
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
        setTimeout(() => {
          document.body.removeChild(overlay);
          resolve(result);
        }, 200);
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

      // Close on overlay click
      overlay.addEventListener('click', (e) => {
        if(e.target === overlay) closeDialog(false);
      });

      // Keyboard support - use a proper cleanup function
      const handleKeyDown = (e) => {
        if(e.key === 'Escape') {
          closeDialog(false);
          document.removeEventListener('keydown', handleKeyDown);
        } else if(e.key === 'Enter') {
          closeDialog(true);
          document.removeEventListener('keydown', handleKeyDown);
        }
      };
      document.addEventListener('keydown', handleKeyDown);

      // Assemble dialog
      buttonContainer.appendChild(cancelBtn);
      buttonContainer.appendChild(confirmBtn);

      dialog.appendChild(titleEl);
      dialog.appendChild(messageEl);
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
        z-index: 2000;
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
        setTimeout(() => filenameInput.focus(), 100);

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
        setTimeout(() => pathInput.focus(), 100);

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
        setTimeout(() => {
          document.body.removeChild(overlay);
          resolve(result);
        }, 200);
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


  // theme: supports either an input checkbox or a button with aria-pressed
  function initTheme(){
    const stored = localStorage.getItem('chroot_theme') || (window.matchMedia && window.matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', stored==='dark' ? 'dark' : '');

    const t = els.themeToggle;
    if(!t) return;

    // If it's an input checkbox
    if(t.tagName === 'INPUT' && t.type === 'checkbox'){
      t.checked = stored === 'dark';
      t.addEventListener('change', ()=>{
        const next = t.checked ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', next==='dark' ? 'dark' : '');
        try{ localStorage.setItem('chroot_theme', next); }catch(e){}
      });
      return;
    }

    // Otherwise assume it's a button toggle. Use aria-pressed boolean.
    const isDark = stored === 'dark';
    t.setAttribute('aria-pressed', isDark ? 'true' : 'false');
    t.addEventListener('click', ()=>{
      const pressed = t.getAttribute('aria-pressed') === 'true';
      const next = pressed ? 'light' : 'dark';
      t.setAttribute('aria-pressed', next === 'dark' ? 'true' : 'false');
      document.documentElement.setAttribute('data-theme', next==='dark' ? 'dark' : '');
      try{ localStorage.setItem('chroot_theme', next); }catch(e){}
    });
  }

  // Setup event handlers with button animations
  els.startBtn.addEventListener('click', (e) => doAction('start', e.target));
  els.stopBtn.addEventListener('click', (e) => doAction('stop', e.target));
  els.restartBtn.addEventListener('click', (e) => doAction('restart', e.target));
  document.getElementById('copy-login').addEventListener('click', copyLoginCommand);
  els.clearConsole.addEventListener('click', (e) => { 
    animateButton(e.target);
    els.console.innerHTML = ''; 
    appendConsole('Console cleared', 'info');
    // Clear saved logs
    try{ localStorage.removeItem('chroot_console_logs'); }catch(e){}
  });
  els.refreshStatus.addEventListener('click', (e) => {
    animateButton(e.target);
    appendConsole('Refreshing status...', 'info');
    refreshStatus();
  });
  els.bootToggle.addEventListener('change', () => writeBootFile(els.bootToggle.checked ? 1 : 0));

  // Settings popup event handlers
  els.settingsBtn.addEventListener('click', () => openSettingsPopup());
  els.closePopup.addEventListener('click', () => closeSettingsPopup());
  els.settingsPopup.addEventListener('click', (e) => {
    if(e.target === els.settingsPopup) closeSettingsPopup();
  });
  els.saveScript.addEventListener('click', () => savePostExecScript());
  els.clearScript.addEventListener('click', () => clearPostExecScript());
  els.updateBtn.addEventListener('click', () => updateChroot());
  els.backupBtn.addEventListener('click', () => backupChroot());
  els.restoreBtn.addEventListener('click', () => restoreChroot());
  els.uninstallBtn.addEventListener('click', () => uninstallChroot());

  // Hotspot event handlers
  els.hotspotBtn.addEventListener('click', () => openHotspotPopup());
  els.closeHotspotPopup.addEventListener('click', () => closeHotspotPopup());
  els.hotspotPopup.addEventListener('click', (e) => {
    if(e.target === els.hotspotPopup) closeHotspotPopup();
  });
  els.startHotspotBtn.addEventListener('click', () => startHotspot());
  els.stopHotspotBtn.addEventListener('click', () => stopHotspot());

  // Password toggle functionality
  const togglePasswordBtn = document.getElementById('toggle-password');
  if(togglePasswordBtn){
    togglePasswordBtn.addEventListener('click', () => {
      const passwordInput = document.getElementById('hotspot-password');
      const icon = togglePasswordBtn.querySelector('svg');
      
      if(passwordInput.type === 'password'){
        passwordInput.type = 'text';
        // Change icon to show "eye-off" (closed eye)
        icon.innerHTML = `
          <path d="M2.99902 3L20.999 21M9.8433 9.91364C9.32066 10.4536 8.99902 11.1892 8.99902 12C8.99902 13.6569 10.3422 15 12 15C12.8215 15 13.5667 14.669 14.1086 14.133M6.49902 6.64715C4.59972 7.90034 3.15305 9.78394 2.45703 12C3.73128 16.0571 7.52159 19 11.9992 19C13.9881 19 15.8414 18.4194 17.3988 17.4184M10.999 5.04939C11.328 5.01673 11.6617 5 11.9992 5C16.4769 5 20.2672 7.94291 21.5414 12C21.2607 12.894 20.8577 13.7338 20.3522 14.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        `;
      } else {
        passwordInput.type = 'password';
        // Change icon back to show "eye" (open eye)
        icon.innerHTML = `
          <path d="M1 12C1 12 5 4 12 4C19 4 23 12 23 12C23 12 19 20 12 20C5 20 1 12 1 12Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.5"/>
        `;
      }
    });
  }
  if(els.dismissHotspotWarning) {
    els.dismissHotspotWarning.addEventListener('click', () => dismissHotspotWarning());
  }

  // Band change updates channel limits
  document.getElementById('hotspot-band').addEventListener('change', updateChannelLimits);

  // Hotspot band change handler
  function updateChannelLimits(){
    const bandSelect = document.getElementById('hotspot-band');
    const channelSelect = document.getElementById('hotspot-channel');
    const band = bandSelect.value;
    
    // Clear existing options
    channelSelect.innerHTML = '';
    
    let channels = [];
    if(band === '5'){
      // 5GHz channels
      channels = [36,40,44,48,52,56,60,64,100,104,108,112,116,120,124,128,132,136,140,149,153,157,161,165];
    } else {
      // 2.4GHz channels
      channels = [1,2,3,4,5,6,7,8,9,10,11];
    }
    
    // Add options
    channels.forEach(ch => {
      const option = document.createElement('option');
      option.value = ch;
      option.textContent = ch;
      channelSelect.appendChild(option);
    });
    
    // Set default value
    channelSelect.value = band === '5' ? '36' : '6';
  }

  // Hotspot settings persistence
  function saveHotspotSettings(){
    const settings = {
      iface: document.getElementById('hotspot-iface').value,
      ssid: document.getElementById('hotspot-ssid').value,
      password: document.getElementById('hotspot-password').value,
      band: document.getElementById('hotspot-band').value,
      channel: document.getElementById('hotspot-channel').value
    };
    try{ localStorage.setItem('chroot_hotspot_settings', JSON.stringify(settings)); }catch(e){}
  }

  function loadHotspotSettings(){
    try{
      const settings = JSON.parse(localStorage.getItem('chroot_hotspot_settings'));
      if(settings){
        document.getElementById('hotspot-iface').value = settings.iface || 'wlan0';
        document.getElementById('hotspot-ssid').value = settings.ssid || '';
        document.getElementById('hotspot-password').value = settings.password || '';
        document.getElementById('hotspot-band').value = settings.band || '2';
        updateChannelLimits(); // Populate options first
        document.getElementById('hotspot-channel').value = settings.channel || '6';
      }
    }catch(e){}
  }

  // init
  initTheme();
  loadConsoleLogs(); // Restore previous console logs
  loadHotspotSettings(); // Load hotspot settings
  loadHotspotStatus(); // Load hotspot status
  updateChannelLimits(); // Initialize channel options based on default/loaded band
  
  // small delay to let command-executor attach if present
  setTimeout(async ()=>{
    await checkRootAccess(); // Master root detection
    await refreshStatus(); // Wait for status check
    await readBootFile(); // Wait for boot file read
  }, 160);

  // export some helpers for debug
  window.chrootUI = { refreshStatus, doAction, appendConsole };
})();
