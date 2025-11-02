// Chroot Control UI - Real-time async execution with non-blocking interface
(function(){
  // Use hardcoded paths provided by install.sh
  const PATH_CHROOT_SH = '/data/local/ubuntu-chroot/chroot.sh';
  const CHROOT_PATH_UI = '/data/local/ubuntu-chroot/rootfs';
  const BOOT_FILE = '/data/local/ubuntu-chroot/boot-service';
  const CHROOT_DIR = '/data/local/ubuntu-chroot';
  const POST_EXEC_SCRIPT = '/data/local/ubuntu-chroot/post_exec.sh';

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
    uninstallBtn: document.getElementById('uninstall-btn')
  };

  // Track running commands to prevent UI blocking
  let activeCommandId = null;

  // Root access flag - set by master check
  let rootAccessConfirmed = false;

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
      els.startBtn.disabled = disabled;
      els.stopBtn.disabled = disabled;
      els.restartBtn.disabled = disabled;
      els.userSelect.disabled = disabled;
      els.settingsBtn.disabled = disabled;
      els.settingsBtn.style.opacity = disabled ? '0.5' : '';
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
    const actionText = action.charAt(0).toUpperCase() + action.slice(1) + 'ing chroot';
    progressLine.textContent = '⏳ ' + actionText;
    els.console.appendChild(progressLine);
    els.console.scrollTop = els.console.scrollHeight;
    
    let dotCount = 0;
    const progressInterval = setInterval(() => {
      dotCount = (dotCount + 1) % 4;
      progressLine.textContent = '⏳ ' + actionText + '.'.repeat(dotCount);
    }, 400);
    
    // Disable buttons during execution
    setButtonsForAction(action, true);

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
        disableAllActions(true);
        disableSettingsPopup(true);
        try{ document.getElementById('copy-login').disabled = true; }catch(e){}
        return;
      } else {
        _chrootMissingLogged = false;
        // Re-enable actions when chroot exists
        disableAllActions(false);
        disableSettingsPopup(false);
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
        // Fetch users when chroot is running
        fetchUsers();
      } else {
        els.userSelect.disabled = true;
        // Reset to root when not running
        els.userSelect.innerHTML = '<option value="root">root</option>';
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
      disableSettingsPopup(true);
      return;
    }

    try{
      // Test root access with a simple command that requires root
      await cmdExec.execute('echo "test"', true);
      // If successful, root is available
      rootAccessConfirmed = true;
      disableAllActions(false);
      disableSettingsPopup(false);
    }catch(e){
      // If failed, show the backend error message once
      rootAccessConfirmed = false;
      appendConsole(`Failed to detect root execution method: ${e.message}`, 'err');
      // Then disable all root-dependent UI elements
      disableAllActions(true);
      disableSettingsPopup(true);
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

    // Close settings popup with smooth animation
    closeSettingsPopup();
    
    // Wait for settings popup animation to complete (300ms for fade out)
    await new Promise(resolve => setTimeout(resolve, 350));
    
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
            disableSettingsPopup(false);
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
        runCmdAsync(`rm -rf ${CHROOT_DIR}`, (result) => {
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
          disableSettingsPopup(false);
          
          // Refresh status to update UI
          setTimeout(() => refreshStatus(), 1000);
        });
      }, 50);
    }
  }

  // Disable settings popup when no root available
  function disableSettingsPopup(disabled){
    try{
      if(els.settingsPopup){
        // Keep popup clickable for closing, but dim it
        els.settingsPopup.style.opacity = disabled ? '0.5' : '';
        // Only disable pointer events if we're not allowing close button interaction
        els.settingsPopup.style.pointerEvents = disabled ? 'auto' : '';
      }
      // Close button should remain functional
      if(els.closePopup) {
        // Close button stays enabled and visible
      }
      // Also disable individual popup elements with visual feedback
      if(els.postExecScript) {
        els.postExecScript.disabled = disabled;
        els.postExecScript.style.opacity = disabled ? '0.5' : '';
        els.postExecScript.style.cursor = disabled ? 'not-allowed' : '';
        els.postExecScript.style.pointerEvents = disabled ? 'none' : '';
      }
      if(els.saveScript) {
        els.saveScript.disabled = disabled;
        els.saveScript.style.opacity = disabled ? '0.5' : '';
        els.saveScript.style.cursor = disabled ? 'not-allowed' : '';
        els.saveScript.style.pointerEvents = disabled ? 'none' : '';
      }
      if(els.clearScript) {
        els.clearScript.disabled = disabled;
        els.clearScript.style.opacity = disabled ? '0.5' : '';
        els.clearScript.style.cursor = disabled ? 'not-allowed' : '';
        els.clearScript.style.pointerEvents = disabled ? 'none' : '';
      }
      if(els.uninstallBtn) {
        els.uninstallBtn.disabled = disabled;
        els.uninstallBtn.style.opacity = disabled ? '0.5' : '';
        els.uninstallBtn.style.cursor = disabled ? 'not-allowed' : '';
        els.uninstallBtn.style.pointerEvents = disabled ? 'none' : '';
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
  els.uninstallBtn.addEventListener('click', () => uninstallChroot());

  // init
  initTheme();
  loadConsoleLogs(); // Restore previous console logs
  
  // small delay to let command-executor attach if present
  setTimeout(async ()=>{
    await checkRootAccess(); // Master root detection
    await refreshStatus(); // Wait for status check
    await readBootFile(); // Wait for boot file read
  }, 160);

  // export some helpers for debug
  window.chrootUI = { refreshStatus, doAction, appendConsole };
})();
