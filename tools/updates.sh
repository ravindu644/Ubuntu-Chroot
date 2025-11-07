#!/bin/bash
# Ubuntu Chroot Update Definitions
# This file contains incremental update functions
# Each function name follows the pattern: update_v{versionCode}
# Where versionCode matches the versionCode in module.prop

# --- Update Functions ---

# Version 2000: Add wireless networking packages and set up bash completion
update_v2000() {
    log "Installing wireless networking packages..."

    # Update package lists
    if ! run_in_chroot "apt-get update -qq"; then
        error "Failed to update package lists"
        return 1
    fi

    # Install the packages
    if ! run_in_chroot "apt-get install -y -qq iw hostapd isc-dhcp-server"; then
        error "Failed to install wireless networking packages"
        return 1
    fi

    # Clean up
    run_in_chroot "apt-get autoremove -y -qq && apt-get clean -qq"

    log "Wireless networking packages installed successfully"

    log "Setting up bash completion for better shell experience"

    # Add bash completion to root's .bashrc
    run_in_chroot "if ! grep -q 'bash_completion' /root/.bashrc; then echo 'if [ -f /etc/bash_completion ]; then' >> /root/.bashrc; echo '    . /etc/bash_completion' >> /root/.bashrc; echo 'fi' >> /root/.bashrc; fi"

    # Add to user's .bashrc if user exists
    if ! run_in_chroot /bin/bash << 'EOF'
SETUP_USER_FILE="/var/lib/.default-user"
if [ -f "$SETUP_USER_FILE" ]; then
    DEFAULT_USER=$(cat "$SETUP_USER_FILE" 2>/dev/null || echo '')
    if [ -n "$DEFAULT_USER" ] && id "$DEFAULT_USER" >/dev/null 2>&1; then
        USER_BASHRC="/home/$DEFAULT_USER/.bashrc"
        if [ -f "$USER_BASHRC" ] && ! grep -q 'bash_completion' "$USER_BASHRC"; then
            echo 'if [ -f /etc/bash_completion ]; then' >> "$USER_BASHRC"
            echo '    . /etc/bash_completion' >> "$USER_BASHRC"
            echo 'fi' >> "$USER_BASHRC"
            chown "$DEFAULT_USER:$DEFAULT_USER" "$USER_BASHRC"
        fi
    fi
fi
EOF
    then
        error "Failed to set up bash completion for user"
        return 1
    fi

    log "Bash completion setup completed successfully"
    return 0
}

update_v2500() {
    log "Adding XDG environment variables for better GUI application support"
    run_in_chroot "echo 'TMPDIR=/tmp' >> /etc/environment"
    run_in_chroot "echo 'XDG_RUNTIME_DIR=/tmp/runtime' >> /etc/environment"
    
    log "Adding Docker support to existing chroot installation..."
    
    # Update package lists
    if ! run_in_chroot "apt-get update"; then
        error "Failed to update package lists"
        return 1
    fi
    
    # Install Docker and QEMU
    if ! run_in_chroot "apt-get install -y docker.io qemu binfmt-support qemu-user-static"; then
        error "Failed to install Docker and QEMU"
        return 1
    fi
    
    # Configure Docker daemon
    run_in_chroot "mkdir -p /etc/docker"
    run_in_chroot "echo '{\"iptables\": false, \"bridge\": \"none\"}' > /etc/docker/daemon.json"

    # Add existing user to docker group if user exists
    # Use a heredoc to pass the script to run_in_chroot
    if ! run_in_chroot /bin/bash << 'EOF'
#!/bin/bash
SETUP_USER_FILE="/var/lib/.default-user"
if [ -f "$SETUP_USER_FILE" ]; then
    DEFAULT_USER=$(cat "$SETUP_USER_FILE" 2>/dev/null || echo '')
    if [ -n "$DEFAULT_USER" ] && id "$DEFAULT_USER" >/dev/null 2>&1; then
        echo "Adding user '$DEFAULT_USER' to docker group..."
        if usermod -aG docker "$DEFAULT_USER"; then
            echo "User '$DEFAULT_USER' added to docker group successfully"
        else
            echo "ERROR: Failed to add user '$DEFAULT_USER' to docker group"
            exit 1
        fi
    else
        echo "No valid user found in $SETUP_USER_FILE or user does not exist"
    fi
else
    echo "Setup user file $SETUP_USER_FILE not found - user not created yet"
fi
EOF
    then
        error "Failed to execute user setup script"
        return 1
    fi
    
    # Clean up
    run_in_chroot "apt-get autoremove -y && apt-get clean"
    
    log "Docker support and environment variables added successfully"
    
    log "Adding support for running x86_64 applications..."
    if ! run_in_chroot "rm /etc/apt/sources.list && \
    cat > /etc/apt/sources.list << EOF
# For arm64 (native architecture)
deb [arch=arm64] http://ports.ubuntu.com/ubuntu-ports/ jammy main restricted universe multiverse
deb [arch=arm64] http://ports.ubuntu.com/ubuntu-ports/ jammy-updates main restricted universe multiverse
deb [arch=arm64] http://ports.ubuntu.com/ubuntu-ports/ jammy-backports main restricted universe multiverse
deb [arch=arm64] http://ports.ubuntu.com/ubuntu-ports/ jammy-security main restricted universe multiverse

# For amd64 (the foreign architecture)
deb [arch=amd64] http://archive.ubuntu.com/ubuntu/ jammy main restricted universe multiverse
deb [arch=amd64] http://archive.ubuntu.com/ubuntu/ jammy-updates main restricted universe multiverse
deb [arch=amd64] http://archive.ubuntu.com/ubuntu/ jammy-backports main restricted universe multiverse
deb [arch=amd64] http://security.ubuntu.com/ubuntu/ jammy-security main restricted universe multiverse
EOF
"; then
        error "Failed to update apt sources for multiarch support"
        return 1
    fi

    if ! run_in_chroot "dpkg --add-architecture amd64 && \
    apt-get update"; then
        error "Failed to add amd64 architecture and update package lists"
        return 1
    fi

    if ! run_in_chroot "apt-get install -y libc6:amd64 \
    libstdc++6:amd64 \
    libgcc-s1:amd64 \
"; then
        error "Failed to install x86_64 libraries"
        return 1
    fi

    run_in_chroot "apt-get autoremove -y && apt-get clean"

    if ! grep -q "binfmt-support" /data/local/ubuntu-chroot/post_exec.sh; then
        if ! echo -e '# Start binfmt service by default\nservice binfmt-support start' >> /data/local/ubuntu-chroot/post_exec.sh; then
            error "Failed to update post_exec.sh for binfmt-support"
            return 1
        fi
    fi

    log "x86_64 support added successfully"
    return 0
}

update_v2520() {

    log "Adding udev rules for USB access..."
    if ! run_in_chroot "apt update && apt install -y udev"; then
        error "Failed to install udev"
        return 1
    fi

    if ! run_in_chroot "cat > /etc/udev/rules.d/99-chroot.rules << 'EOF'\nSUBSYSTEM==\"usb\", ENV{DEVTYPE}==\"usb_device\", MODE=\"0666\", GROUP=\"plugdev\"\nEOF"; then
        error "Failed to add udev rules for USB access"
        return 1
    fi

    if ! grep -q "udev" /data/local/ubuntu-chroot/post_exec.sh; then
        if ! echo -e '# Ugly hack to start the udev service\nservice udev restart > /dev/null 2>&1 &' >> /data/local/ubuntu-chroot/post_exec.sh; then
            error "Failed to update post_exec.sh for udev"
            return 1
        fi
    fi

   if ! run_in_chroot /bin/bash << 'EOF'
#!/bin/bash
SETUP_USER_FILE="/var/lib/.default-user"
if [ -f "$SETUP_USER_FILE" ]; then
    DEFAULT_USER=$(cat "$SETUP_USER_FILE" 2>/dev/null || echo '')
    if [ -n "$DEFAULT_USER" ] && id "$DEFAULT_USER" >/dev/null 2>&1; then
        echo "Adding user '$DEFAULT_USER' to plugdev group..."
        if usermod -aG plugdev "$DEFAULT_USER"; then
            echo "User '$DEFAULT_USER' added to plugdev group successfully"
        else
            echo "ERROR: Failed to add user '$DEFAULT_USER' to plugdev group"
            exit 1
        fi
    else
        echo "No valid user found in $SETUP_USER_FILE or user does not exist"
    fi
else
    echo "Setup user file $SETUP_USER_FILE not found - user not created yet"
fi
EOF
    then
        error "Failed to execute user setup script"
        return 1
    fi

    log "udev rules added successfully"
    return 0
}

# Add new updates below following the pattern:
# update_v{VERSION_CODE}() {
#     log "Description of what this update does..."
#     # Your update commands here
#     return 0
# }
