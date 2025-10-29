#!/bin/bash
# Post-execution script - runs inside chroot after startup
# Add your custom service startup commands here

echo "[POST-EXEC] Running post-execution script..."

# Example: Start SSH server
# if command -v sshd >/dev/null 2>&1; then
#     echo "[POST-EXEC] Starting SSH server..."
#     service ssh start || /usr/sbin/sshd
# fi

# Example: Start other services
# service postgresql start
# service nginx start

echo "[POST-EXEC] Post-execution complete"
