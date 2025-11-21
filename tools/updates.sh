#!/system/bin/sh
# Ubuntu Chroot Update Definitions
# Each function defines an update that runs INSIDE the chroot with bash
# Function name format: update_v{versionCode}
# These functions are sourced by the updater script
# Must use "[UPDATER]" prefix for all echo statements

# Version 2000: Wireless networking packages
update_v2000() {
    echo "[UPDATER] Starting update v2000: Wireless networking packages"

    echo "[UPDATER] Updating package lists..."
    if apt-get update; then
        echo "[UPDATER] Package lists updated successfully"
    else
        echo "[UPDATER] Failed to update package lists"
        return 1
    fi

    echo "[UPDATER] Installing iw, hostapd, isc-dhcp-server..."
    if apt-get install -y iw hostapd isc-dhcp-server; then
        echo "[UPDATER] Wireless packages installed successfully"
    else
        echo "[UPDATER] Failed to install wireless packages"
        return 1
    fi

    echo "[UPDATER] Cleaning up packages..."
    apt-get autoremove -y && apt-get clean

    echo "[UPDATER] Setting up bash completion..."

    # Add bash completion to root's .bashrc
    if ! grep -q 'bash_completion' /root/.bashrc 2>/dev/null; then
        echo "[UPDATER] Adding bash completion to root's .bashrc"
        cat >> /root/.bashrc << 'EOF'
if [ -f /etc/bash_completion ]; then
    . /etc/bash_completion
fi
EOF
    fi

    # Add to default user's .bashrc if exists
    if [ -f /var/lib/.default-user ]; then
        DEFAULT_USER=$(cat /var/lib/.default-user)
        if [ -n "$DEFAULT_USER" ] && id "$DEFAULT_USER" >/dev/null 2>&1; then
            USER_BASHRC="/home/$DEFAULT_USER/.bashrc"
            if [ -f "$USER_BASHRC" ] && ! grep -q 'bash_completion' "$USER_BASHRC"; then
                echo "[UPDATER] Adding bash completion to $DEFAULT_USER's .bashrc"
                cat >> "$USER_BASHRC" << 'EOF'
if [ -f /etc/bash_completion ]; then
    . /etc/bash_completion
fi
EOF
                chown "$DEFAULT_USER:$DEFAULT_USER" "$USER_BASHRC"
            fi
        fi
    fi

    echo "[UPDATER] ✓ Update v2000 completed: Wireless networking and bash completion configured!"
}

# Version 2500: Docker and x86_64 support
update_v2500() {
    echo "[UPDATER] Starting update v2500: Docker and x86_64 support"

    echo "[UPDATER] Adding XDG environment variables..."

    cat >> /etc/environment << 'EOF'
TMPDIR=/tmp
XDG_RUNTIME_DIR=/tmp/runtime
EOF

    echo "[UPDATER] Installing Docker and QEMU..."

    if apt-get update; then
        echo "[UPDATER] Package lists updated successfully"
    else
        echo "[UPDATER] Failed to update package lists"
        return 1
    fi

    if apt-get install -y docker.io qemu binfmt-support qemu-user-static; then
        echo "[UPDATER] Docker and QEMU installed successfully"
    else
        echo "[UPDATER] Failed to install Docker and QEMU"
        return 1
    fi

    # Configure Docker
    echo "[UPDATER] Configuring Docker daemon..."
    mkdir -p /etc/docker
    cat > /etc/docker/daemon.json << 'EOF'
{
    "iptables": false,
    "bridge": "none"
}
EOF

    # Add default user to docker group if exists
    if [ -f /var/lib/.default-user ]; then
        DEFAULT_USER=$(cat /var/lib/.default-user)
        if [ -n "$DEFAULT_USER" ] && id "$DEFAULT_USER" >/dev/null 2>&1; then
            echo "[UPDATER] Adding $DEFAULT_USER to docker group..."
            usermod -aG docker "$DEFAULT_USER"
        fi
    fi

    echo "[UPDATER] Configuring x86_64 (amd64) support..."

    # Update sources.list for multiarch
    echo "[UPDATER] Updating APT sources for multiarch support..."

    rm -rf /etc/apt/sources.list && \
    rm -rf /etc/apt/sources.list.d/*

    cat > /etc/apt/sources.list << 'EOF'
# For arm64 (native architecture)
deb [arch=arm64] http://ports.ubuntu.com/ubuntu-ports/ jammy main restricted universe multiverse
deb [arch=arm64] http://ports.ubuntu.com/ubuntu-ports/ jammy-updates main restricted universe multiverse
deb [arch=arm64] http://ports.ubuntu.com/ubuntu-ports/ jammy-backports main restricted universe multiverse
deb [arch=arm64] http://ports.ubuntu.com/ubuntu-ports/ jammy-security main restricted universe multiverse

# For amd64 (foreign architecture)
deb [arch=amd64] http://archive.ubuntu.com/ubuntu/ jammy main restricted universe multiverse
deb [arch=amd64] http://archive.ubuntu.com/ubuntu/ jammy-updates main restricted universe multiverse
deb [arch=amd64] http://archive.ubuntu.com/ubuntu/ jammy-backports main restricted universe multiverse
deb [arch=amd64] http://security.ubuntu.com/ubuntu/ jammy-security main restricted universe multiverse
EOF

    echo "[UPDATER] Adding amd64 architecture..."
    if dpkg --add-architecture amd64; then
        echo "[UPDATER] amd64 architecture added successfully"
    else
        echo "[UPDATER] Failed to add amd64 architecture"
        return 1
    fi

    if apt-get update; then
        echo "[UPDATER] Sources updated successfully"
    else
        echo "[UPDATER] Failed to update sources"
        return 1
    fi

    echo "[UPDATER] Installing amd64 libraries..."
    if apt-get install -y libc6:amd64 libstdc++6:amd64 libgcc-s1:amd64; then
        echo "[UPDATER] amd64 libraries installed successfully"
    else
        echo "[UPDATER] Failed to install amd64 libraries"
        return 1
    fi

    echo "[UPDATER] Cleaning up..."
    apt-get autoremove -y && apt-get clean

    # Update post_exec.sh for binfmt-support
    if ! grep -q "binfmt-support" /data/local/ubuntu-chroot/post_exec.sh 2>/dev/null; then
        echo "[UPDATER] Updating post_exec.sh for binfmt-support..."
        cat >> /data/local/ubuntu-chroot/post_exec.sh << 'EOF'

# Start binfmt service
service binfmt-support start
EOF
    fi

    echo "[UPDATER] ✓ Update v2500 completed: Docker and x86_64 support configured!"
}

# Version 2520: USB/udev support
update_v2520() {

    log "Adding udev rules for USB access..."
    if ! run_in_chroot "apt update && apt install -y udev"; then
        error "Failed to install udev"
        return 1
    fi

    if ! run_in_chroot "printf '%s\n' 'SUBSYSTEM==\"usb\", ENV{DEVTYPE}==\"usb_device\", MODE=\"0666\", GROUP=\"plugdev\"' > /etc/udev/rules.d/99-chroot.rules"; then
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
    fi
fi
EOF
    then
        error "Failed to add user to plugdev group"
        return 1
    fi

    return 0
}

update_v3200() {

    # Create udev rule for traditional wireless interface names
    if mkdir -p /etc/udev/rules.d && echo 'SUBSYSTEM=="net", ACTION=="add", ATTR{type}=="1", NAME="wlan%n"' > /etc/udev/rules.d/70-wlan.rules; then
        echo "[UPDATER] udev rule for traditional wireless interface names created successfully"
    else
        echo "[UPDATER] Failed to create udev rule for traditional wireless interface names"
        return 1
    fi

    echo "[UPDATER] ✓ Update v3200 completed: Wireless interface names configured!"
}

update_v3400() {

    # Create a global script for custom aliases and functions
    ALIASES_FILE="/etc/profile.d/chroot-webui-aliases.sh"
    if [ ! -f "$ALIASES_FILE" ]; then
        echo "[UPDATER] Creating global aliases and functions script at $ALIASES_FILE"
        cat <<'EOF' > "$ALIASES_FILE"
#!/bin/sh
# Docker stuff
# List running containers (pretty)
alias dps="docker ps --format 'table {{.Names}} {{.Image}}  {{.Status}} {{.Ports}}'"

# List all containers
alias dpsa="docker ps -a --format 'table {{.Names}} {{.Image}}  {{.Status}} {{.Ports}}'"

# List all images
alias dim="docker images --format 'table {{.Repository}}    {{.Tag}}    {{.ID}} {{.Size}}'"

# Run an image interactively (with auto-remove)
alias drun="docker run -it --rm"

# Stop a container by name
alias dstop="docker stop"

# Remove a container by name
alias drm="docker rm"

# Remove an image by name or ID
alias drmi="docker rmi"

# Show logs of a container (follow)
alias dlog="docker logs -f"

# Quickly remove all stopped containers (human readable)
alias drmc="docker ps -a -q -f status=exited | xargs -r docker rm"

# Quickly remove all dangling images
alias drmid="docker images -f dangling=true -q | xargs -r docker rmi"

check_temps() {
    if [ ! -d /sys/class/thermal ]; then
        echo "Error: /sys/class/thermal not mounted or unavailable."
        return 1
    fi

    echo "==== Thermal Zone Temperatures ===="
    for zone in /sys/class/thermal/thermal_zone*; do
        # Get the type of the thermal zone
        type_file="$zone/type"
        if [ -f "$type_file" ]; then
            type=$(cat "$type_file")
        else
            type="unknown"
        fi

        # Get the temperature in millidegrees and convert to °C
        temp_file="$zone/temp"
        if [ -f "$temp_file" ]; then
            temp=$(cat "$temp_file")
            temp_c=$((temp / 1000))
            temp_milli=$((temp % 1000))
            printf "%-20s : %3d.%03d°C\n" "$type" "$temp_c" "$temp_milli"
        fi
    done
    echo "================================="
}

check_temp_rt() {
    # Make sure check_temps function exists
    if ! declare -f check_temps > /dev/null; then
        echo "Error: check_temps function not found!"
        return 1
    fi

    echo "Press Ctrl+C to stop the real-time temperature monitor."
    while true; do
        clear                # Clear previous output
        check_temps          # Call the original check_temps function
        sleep 1              # Wait 1 second
    done
}

# a simple file transfer function via ssh
# Usage: transfer /path/to/file_or_folder username@ip /path/to/save
transfer() {
    if [ $# -ne 3 ]; then
        echo "Usage: transfer /path/to/file_or_folder username@ip /path/to/save"
        return 1
    fi

    local SRC="$1"
    local DEST="$2"
    local REMOTE_PATH="$3"

    # Check if source exists
    if [ ! -e "$SRC" ]; then
        echo "Error: Source '$SRC' does not exist!"
        return 1
    fi

    # Perform the transfer recursively (works for files and folders)
    scp -r "$SRC" "$DEST":"$REMOTE_PATH"
    if [ $? -eq 0 ]; then
        echo "Transfer complete: $SRC -> $DEST:$REMOTE_PATH"
    else
        echo "Transfer failed!"
    fi
}
EOF
        chmod +x "$ALIASES_FILE"
        echo "[UPDATER] Global aliases and functions created successfully"
    else
        echo "[UPDATER] Global aliases and functions script already exists, skipping"
    fi

    echo "[UPDATER] ✓ Update v3400 completed: Aliases and functions configured!"
}

# Version 3600: Add firmware download script
update_v3600() {
    echo "[UPDATER] Starting update v3600: Adding firmware download script"

    echo "[UPDATER] Downloading download-firmware script from GitHub..."
    if curl -fsSL https://github.com/ravindu644/Ubuntu-Chroot/raw/refs/heads/main/Docker/scripts/download-firmware -o /usr/local/bin/download-firmware; then
        echo "[UPDATER] Script downloaded successfully"
    else
        echo "[UPDATER] Warning: Failed to download script, trying with wget..."
        if wget -q -O /usr/local/bin/download-firmware https://github.com/ravindu644/Ubuntu-Chroot/raw/refs/heads/main/Docker/scripts/download-firmware; then
            echo "[UPDATER] Script downloaded successfully with wget"
        else
            echo "[UPDATER] Error: Failed to download script with both curl and wget"
            return 1
        fi
    fi

    echo "[UPDATER] Making download-firmware script executable..."
    if chmod +x /usr/local/bin/download-firmware; then
        echo "[UPDATER] Script made executable successfully"
    else
        echo "[UPDATER] Error: Failed to make script executable"
        return 1
    fi

    echo "[UPDATER] ✓ Update v3600 completed: Firmware download script added!"
}

# Version 4100: Add global bashrc loading for all profile.d scripts
update_v4100() {
    echo "[UPDATER] Starting update v4100: Adding global bashrc loading for all profile.d scripts"

    # Check if already added to avoid duplicates
    if grep -q "/etc/profile.d/\*\.sh" /etc/bash.bashrc 2>/dev/null; then
        echo "[UPDATER] Global bashrc already configured for profile.d scripts, skipping"
        return 0
    fi

    echo "[UPDATER] Adding profile.d scripts loading to /etc/bash.bashrc..."
    cat >> /etc/bash.bashrc << 'EOF'

# Load all scripts in /etc/profile.d/ for interactive shells
if [ -d /etc/profile.d ]; then
  for i in /etc/profile.d/*.sh; do
    if [ -r "$i" ]; then
      . "$i"
    fi
  done
  unset i
fi
EOF

    if [ $? -eq 0 ]; then
        echo "[UPDATER] Global bashrc updated successfully"
    else
        echo "[UPDATER] Error: Failed to update /etc/bash.bashrc"
        return 1
    fi

    echo "[UPDATER] ✓ Update v4100 completed: Global bashrc loading for profile.d scripts configured!"
}

# Add your new updates below:
# update_v{VERSION}() {
#     echo "Your update description..."
#     # Regular bash commands here
#     # These run INSIDE the chroot, so just use normal commands
#     echo "✓ Done!"
# }
