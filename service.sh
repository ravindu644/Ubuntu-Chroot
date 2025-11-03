#!/system/bin/sh
# Magisk Module Service Script
# Runs on boot after system is ready

MODDIR=${0%/*}
CHROOT_SH="/data/local/ubuntu-chroot/chroot.sh"
BOOT_FLAG="/data/local/ubuntu-chroot/boot-service"
LOG_FILE="/data/local/ubuntu-chroot/boot-service.log"

# Wait for boot to complete
while [ "$(getprop sys.boot_completed)" != "1" ]; do
    sleep 1
done

# Wait 25 seconds for system stability
sleep 25

# Check if run-at-boot is enabled
if [ -f "$BOOT_FLAG" ] && [ "$(cat "$BOOT_FLAG" 2>/dev/null)" = "1" ]; then
    # Clear old log
    > "$LOG_FILE"

    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Boot service started" >> "$LOG_FILE"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting chroot..." >> "$LOG_FILE"

    # Start chroot
    su -c "sh $CHROOT_SH start --no-shell" >> "$LOG_FILE" 2>&1 &

    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Chroot startup initiated" >> "$LOG_FILE"
fi
