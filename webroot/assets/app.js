// Chroot Control UI - Real-time async execution with non-blocking interface
(function(){
  // Use hardcoded paths provided by install.sh
  const PATH_CHROOT_SH = '/data/local/ubuntu-chroot/chroot.sh';
  let CHROOT_PATH_UI = '/data/local/ubuntu-chroot/rootfs';
  let BOOT_FILE = '/data/local/ubuntu-chroot/boot-service';

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
    namespaceWarning: document.getElementById('namespace-warning'),
    dismissWarning: document.getElementById('dismiss-warning'),
    userSelect: document.getElementById('user-select')
  };

  // Track running commands to prevent UI blocking
  let activeCommandId = null;

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
    if(!window.cmdExec || typeof cmdExec.executeAsync !== 'function'){
      const msg = 'Backend not available (cmdExec missing in page).';
      appendConsole(msg, 'err');
      if(onComplete) onComplete(false);
      return null;
    }

    const commandId = cmdExec.executeAsync(cmd, true, {
      onOutput: (output) => {
        // Display output
        if(output) {
          const lines = output.split('\n');
          lines.forEach(line => {
            if(line.trim()) appendConsole(line);
          });
        }
      },
      onError: (error) => {
        appendConsole(String(error), 'err');
      },
      onComplete: (result) => {
        activeCommandId = null;
        if(onComplete) onComplete(result.success);
      }
    });

    activeCommandId = commandId;
    return commandId;
  }

  /**
   * Legacy sync command for simple operations
   */
  async function runCmdSync(cmd){
    if(!window.cmdExec || typeof cmdExec.execute !== 'function'){
      const msg = 'Backend not available (cmdExec missing in page).';
      appendConsole(msg, 'err');
      throw new Error(msg);
    }

    try {
      const out = await cmdExec.execute(cmd, true);
      return out;
    } catch(err) {
      appendConsole(String(err), 'err');
      throw err;
    }
  }

  function disableAllActions(disabled){
    try{
      els.startBtn.disabled = disabled;
      els.stopBtn.disabled = disabled;
      els.restartBtn.disabled = disabled;
      els.userSelect.disabled = disabled;
      const copyBtn = document.getElementById('copy-login'); 
      if(copyBtn) copyBtn.disabled = disabled;
    }catch(e){}
  }

  /**
   * Execute chroot action asynchronously (non-blocking)
   */
  function doAction(action, btn){
    if(activeCommandId) {
      appendConsole('⚠ Another command is already running. Please wait...', 'warn');
      return;
    }

    animateButton(btn);
    appendConsole(`━━━ Starting ${action} ━━━`, 'info');
    
    // Show progress indicator IMMEDIATELY
    const progressLine = document.createElement('div');
    progressLine.className = 'progress-indicator';
    progressLine.textContent = '⏳ Executing command';
    els.console.appendChild(progressLine);
    els.console.scrollTop = els.console.scrollHeight;
    
    let dotCount = 0;
    const progressInterval = setInterval(() => {
      dotCount = (dotCount + 1) % 4;
      progressLine.textContent = '⏳ Executing command' + '.'.repeat(dotCount);
    }, 400);
    
    // Disable buttons during execution
    setButtonsForAction(action, true);

    // Use --no-shell flag to prevent blocking on interactive shell
    const cmd = `sh ${PATH_CHROOT_SH} ${action} --no-shell`;
    
    // Use setTimeout to allow UI to update before blocking command
    setTimeout(() => {
      runCmdAsync(cmd, (success) => {
        clearInterval(progressInterval);
        progressLine.remove();
        
        if(success) {
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
   * Set button states based on action being performed
   */
  function setButtonsForAction(action, running){
    if(running){
      // Disable all action buttons while command runs
      els.startBtn.disabled = true;
      els.stopBtn.disabled = true;
      els.restartBtn.disabled = true;
    }
    // Status refresh will re-enable appropriate buttons
  }

  // Track whether we've already logged a missing-chroot message
  let _chrootMissingLogged = false;

  /**
   * Refresh chroot status (non-blocking)
   */
  async function refreshStatus(){
    try{
      // Check if chroot directory exists
      if(window.cmdExec && typeof cmdExec.execute === 'function'){
        try{
          let exists = await cmdExec.execute(`test -d ${CHROOT_PATH_UI} && echo 1 || echo 0`, true);

          if(String(exists||'').trim() !== '1'){
            if(!_chrootMissingLogged){ 
              appendConsole(`⚠ Chroot directory not found at ${CHROOT_PATH_UI}`, 'err'); 
              _chrootMissingLogged = true; 
            }
            updateStatus('stopped');
            disableAllActions(true);
            try{ document.getElementById('copy-login').disabled = true; }catch(e){}
            return;
          } else {
            _chrootMissingLogged = false;
          }
        }catch(e){ /* ignore and proceed */ }
      }

      // Get status without blocking UI
      const out = await runCmdSync(`sh ${PATH_CHROOT_SH} status`);
      const s = String(out || '');
      // Check for "Status: RUNNING" from the new detection method
      const running = /Status:\s*RUNNING/i.test(s);
      updateStatus(running ? 'running' : 'stopped');
      
      // Enable copy-login button when running
      try{ document.getElementById('copy-login').disabled = !running; }catch(e){}

      // Handle user select dropdown
      if(running){
        els.userSelect.disabled = false;
        // Fetch users when chroot is running
        fetchUsers();
      } else {
        els.userSelect.disabled = true;
        // Reset to root when not running
        els.userSelect.innerHTML = '<option value="root">root</option>';
      }
    }catch(e){
      updateStatus('unknown');
      if(!(window.cmdExec && typeof cmdExec.execute === 'function')){
        disableAllActions(true);
      } else {
        disableAllActions(true);
      }
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
      } else if(state === 'stopped'){
        els.stopBtn.disabled = true;
        els.restartBtn.disabled = true;
        els.startBtn.disabled = false;
        els.userSelect.disabled = true;
      } else {
        // unknown
        els.stopBtn.disabled = true;
        els.restartBtn.disabled = true;
        els.startBtn.disabled = false;
        els.userSelect.disabled = true;
      }
    }catch(e){ /* ignore if elements missing */ }
  }

  // boot toggle handlers
  async function writeBootFile(val){
    try{
      if(!window.cmdExec || typeof cmdExec.execute !== 'function'){
        appendConsole('Backend not available', 'err');
        return;
      }
      // Ensure directory exists and write file
      const cmd = `mkdir -p /data/local/ubuntu-chroot && echo ${val} > /data/local/ubuntu-chroot/boot-service`;
      await cmdExec.execute(cmd, true);
      appendConsole(`Run-at-boot ${val === 1 ? 'enabled' : 'disabled'}`, 'success');
    }catch(e){ 
      console.error(e);
      appendConsole(`✗ Failed to set run-at-boot: ${e}`, 'err');
    }
  }
  async function readBootFile(){
    try{
      if(window.cmdExec && typeof cmdExec.execute === 'function'){
        const out = await cmdExec.execute(`cat /data/local/ubuntu-chroot/boot-service 2>/dev/null || echo 0`, true);
        const v = String(out||'').trim();
        els.bootToggle.checked = v === '1';
        appendConsole('Run-at-boot: '+ (v==='1' ? 'enabled' : 'disabled'));
      } else {
        appendConsole('Backend not available', 'err');
        els.bootToggle.checked = false;
      }
    }catch(e){ 
      els.bootToggle.checked = false; 
    }
  }

  // copy login command
  function copyLoginCommand(){
    const selectedUser = els.userSelect.value;
    // Save selected user
    try{ localStorage.setItem('chroot_selected_user', selectedUser); }catch(e){}

    // Use -M flag to run in global mount namespace (KernelSU)
    // This ensures the script can see existing mounts and detect if chroot is already running
    const cmd = `su -M -c "sh ${PATH_CHROOT_SH} start ${selectedUser}"`;
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(cmd).then(()=> appendConsole(`Login command for user '${selectedUser}' copied to clipboard`))
        .catch(()=> appendConsole('Failed to copy to clipboard'));
    } else {
      // fallback
      appendConsole(cmd);
      try{ window.prompt('Copy login command (Ctrl+C):', cmd); }catch(e){}
    }
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

  // Show namespace warning on first visit
  function checkNamespaceWarning(){
    const dismissed = localStorage.getItem('namespace_warning_dismissed');
    if(!dismissed){
      els.namespaceWarning.style.display = 'flex';
    }
  }

  // Dismiss warning handler
  els.dismissWarning.addEventListener('click', () => {
    const dontShowAgain = document.getElementById('dont-show-warning').checked;
    els.namespaceWarning.style.display = 'none';
    if(dontShowAgain){
      try{ localStorage.setItem('namespace_warning_dismissed', '1'); }catch(e){}
    }
  });

  // init
  initTheme();
  loadConsoleLogs(); // Restore previous console logs
  checkNamespaceWarning(); // Show warning if first visit
  
  // If there's no root bridge, disable actions; otherwise we'll use the hardcoded path.
  if(window.cmdExec && typeof cmdExec.execute === 'function'){
    // root bridge present — no verbose message to keep the console clean
  } else {
    appendConsole('No root bridge detected — running offline. Actions disabled.');
    disableAllActions(true);
  }

  // small delay to let command-executor attach if present
  setTimeout(()=>{
    refreshStatus();
    readBootFile();
  }, 160);

  // export some helpers for debug
  window.chrootUI = { refreshStatus, doAction, appendConsole };
})();
