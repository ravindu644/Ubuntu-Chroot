class CommandExecutor {
    constructor() {
        const scriptTag = document.querySelector('script[src*="command-executor.js"]');
        this.assetsPath = scriptTag ? scriptTag.src.replace(/\/command-executor\.js$/, '') : './assets';
        this.execMethod = this.detectExecutionMethod();
        this.runningCommands = new Map();
    }

    detectExecutionMethod() {
        if (typeof ksu !== 'undefined' && ksu.exec) {
            return 'ksu';
        } else if (window.SULib) {
            return 'sulib';
        }
        return 'none';
    }

    /**
     * Execute a command with real-time output streaming
     * @param {string} command - Command to execute
     * @param {boolean} asRoot - Run as root
     * @param {Object} callbacks - { onOutput, onError, onComplete }
     * @returns {string} commandId - Unique ID for this command
     */
    executeAsync(command, asRoot = true, callbacks = {}) {
        const commandId = `cmd_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const fullCommand = asRoot ? `su -c "${command}"` : command;
        
        const { onOutput, onError, onComplete } = callbacks;

        this.runningCommands.set(commandId, { command: fullCommand, startTime: Date.now() });

        if (this.execMethod === 'ksu') {
            const callback = `ksu_callback_${commandId}`;
            window[callback] = (exitCode, stdout, stderr) => {
                delete window[callback];
                this.runningCommands.delete(commandId);
                
                if (exitCode === 0) {
                    if (stdout && onOutput) onOutput(stdout);
                    if (onComplete) onComplete({ success: true, exitCode, output: stdout });
                } else {
                    if (stderr && onError) onError(stderr);
                    if (onComplete) onComplete({ success: false, exitCode, error: stderr || `exit:${exitCode}` });
                }
            };
            
            try {
                ksu.exec(fullCommand, '{}', callback);
                if (onOutput) onOutput(`[Executing: ${command}]\n`);
            } catch (e) {
                delete window[callback];
                this.runningCommands.delete(commandId);
                if (onError) onError(String(e));
                if (onComplete) onComplete({ success: false, error: String(e) });
            }
        } else if (this.execMethod === 'sulib') {
            try {
                if (onOutput) onOutput(`[Executing: ${command}]\n`);
                
                window.SULib.exec(fullCommand, (result) => {
                    this.runningCommands.delete(commandId);
                    
                    if (result.success) {
                        if (result.output && onOutput) onOutput(result.output);
                        if (onComplete) onComplete({ success: true, output: result.output });
                    } else {
                        if (result.error && onError) onError(result.error);
                        if (onComplete) onComplete({ success: false, error: result.error });
                    }
                });
            } catch (e) {
                this.runningCommands.delete(commandId);
                if (onError) onError(String(e));
                if (onComplete) onComplete({ success: false, error: String(e) });
            }
        } else {
            this.runningCommands.delete(commandId);
            const errorMsg = 'No root execution method available (KernelSU or libsuperuser not detected).';
            if (onError) onError(errorMsg);
            if (onComplete) onComplete({ success: false, error: errorMsg });
        }

        return commandId;
    }

    /**
     * Legacy execute method for backward compatibility
     */
    async execute(command, asRoot = true) {
        return new Promise((resolve, reject) => {
            this.executeAsync(command, asRoot, {
                onComplete: (result) => {
                    if (result.success) {
                        resolve(result.output || '');
                    } else {
                        reject(new Error(result.error || 'Command failed'));
                    }
                }
            });
        });
    }

    isCommandRunning(commandId) {
        return this.runningCommands.has(commandId);
    }

    getRunningCommands() {
        return Array.from(this.runningCommands.entries()).map(([id, info]) => ({
            id,
            ...info,
            duration: Date.now() - info.startTime
        }));
    }
}

// Expose a tolerant global instance
window.cmdExec = new CommandExecutor();
