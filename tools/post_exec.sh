#!/bin/bash
# Post-execution script - runs inside chroot after startup
# Add your custom service startup commands here

# Function to start VNC server
# DO NOT REMOVE
func_start_vnc(){
    SETUP_USER_FILE="/var/lib/.default-user"
    if [ -f "$SETUP_USER_FILE" ]; then
        DEFAULT_USER=$(cat "$SETUP_USER_FILE")
        if id "$DEFAULT_USER" &>/dev/null; then
            echo "[POST-EXEC] Starting VNC server for user '$DEFAULT_USER'..."
            su - $DEFAULT_USER -c "vncserver -geometry 1920x1080 -localhost no :1"
            
            # Allow root user access to the VNC display
            echo "[POST-EXEC] Granting display access to root user..."
            su - $DEFAULT_USER -c "DISPLAY=:1 xhost +si:localuser:root"
        fi
    else
        echo "[POST-EXEC] No default user found, skipping VNC startup."
    fi
}

echo "[POST-EXEC] Running post-execution script..."

# Start dbus service by default
service dbus start
func_start_vnc

# Start binfmt service by default (for running x86_64 binaries)
service binfmt-support start

# Example: Start SSH server
# service ssh start

# start docker service if your kernel is supported
# dockerd > /dev/null 2>&1 &

echo "[POST-EXEC] Post-execution complete"
