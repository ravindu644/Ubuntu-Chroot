#!/bin/bash
# Post-execution script - runs inside chroot after startup
# Add your custom service startup commands here

echo "[POST-EXEC] Running post-execution script..."

# Start dbus service by default
service dbus start

# Start binfmt service by default
service binfmt-support start

# Ugly hack to start the udev service
service udev restart > /dev/null 2>&1 &

# Example: Start SSH server
# service ssh start

# start docker service if your kernel is supported
# dockerd > /dev/null 2>&1 &

# Example: Start other services if installed
# service postgresql start
# service nginx start

echo "[POST-EXEC] Post-execution complete"
