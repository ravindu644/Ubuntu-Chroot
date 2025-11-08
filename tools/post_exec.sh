#!/bin/bash
# Post-execution script - runs inside chroot after startup
# Add your custom service startup commands here

echo "[POST-EXEC] Running post-execution script..."

# Start dbus service by default
service dbus start

# Start VNC server by default
start_vnc

# Start XRDP if you want to use it
# start_xrdp

# Start binfmt service by default (for running x86_64 binaries)
systemctl restart systemd-binfmt.service &

# Ugly hack to start the udev service
# Start systemd-udevd directly
/usr/lib/systemd/systemd-udevd --daemon > /dev/null 2>&1 &

# Example: Start SSH server
# service ssh start

# start docker service if your kernel is supported
# dockerd > /dev/null 2>&1 &

echo "[POST-EXEC] Post-execution complete"
