#!/bin/bash
# Post-execution script - runs inside chroot after startup
# Add your custom service startup commands here

echo "[POST-EXEC] Running post-execution script..."


# start dbus service by default
service dbus start

# Example: Start SSH server
# service ssh start

# Example: Start other services if installed
# service postgresql start
# service nginx start

echo "[POST-EXEC] Post-execution complete"
