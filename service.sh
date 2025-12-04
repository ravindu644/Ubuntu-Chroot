#!/system/bin/sh
# Magisk Module Service Script
# Runs on boot after system is ready

MODDIR=${0%/*}
CHROOT_SH="/data/local/ubuntu-chroot/chroot.sh"
BOOT_FLAG="/data/local/ubuntu-chroot/boot-service"
LOG_FILE="/data/local/ubuntu-chroot/boot-service.log"
UPDATE_STATUS_SCRIPT="/data/local/ubuntu-chroot/update-status.sh"

# Function to update module status
update_module_status() {
    if [ -f "$UPDATE_STATUS_SCRIPT" ]; then
        su -c "sh $UPDATE_STATUS_SCRIPT" >> "$LOG_FILE" 2>&1 &
    fi
}

# Wait for boot to complete
while [ "$(getprop sys.boot_completed)" != "1" ]; do
    sleep 1
done

# Wait 25 seconds for system stability
sleep 25

# Update module status (always check, regardless of boot setting)
update_module_status

# Check if run-at-boot is enabled
if [ -f "$BOOT_FLAG" ] && [ "$(cat "$BOOT_FLAG" 2>/dev/null)" = "1" ]; then
    # Clear old log
    > "$LOG_FILE"

    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Boot service started" >> "$LOG_FILE"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting chroot..." >> "$LOG_FILE"

    # Start chroot (run synchronously to check if it succeeded)
    if su -c "sh $CHROOT_SH start --no-shell" >> "$LOG_FILE" 2>&1; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Chroot started successfully" >> "$LOG_FILE"

        # Update module status after successful start
        update_module_status

        # Show notification that chroot started successfully
        su -lp 2000 -c "cmd notification post -S bigtext -t 'Chroot Started' 'chroot' 'Chroot started successfully..!'" 2>/dev/null
    else
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Chroot startup failed" >> "$LOG_FILE"

        # Show notification that chroot startup failed
        su -lp 2000 -c "cmd notification post -S bigtext -t 'Chroot Failed' 'chroot' 'Chroot startup failed. Check logs for details.'" 2>/dev/null
    fi
fi
