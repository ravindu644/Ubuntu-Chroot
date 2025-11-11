#!/bin/bash

SETUP_FLAG="/var/lib/.user-setup-done"
SETUP_USER_FILE="/var/lib/.default-user"

# Function to apply Android network permissions to a user
apply_network_fix() {
    local user="$1"

    # Ensure Android network groups exist
    grep -q '^aid_inet:' /etc/group || echo 'aid_inet:x:3003:' >> /etc/group
    grep -q '^aid_net_raw:' /etc/group || echo 'aid_net_raw:x:3004:' >> /etc/group

    # Add user to Android network groups without changing primary group
    usermod -a -G aid_inet,aid_net_raw "$user" 2>/dev/null
}

# Allow root login anytime - but run setup if not done yet
CURRENT_USER=$(id -un)
if [ "$CURRENT_USER" = "root" ] && [ ! -f "$SETUP_FLAG" ]; then
    # Continue to setup below
    true
fi

# If setup already done and we have a default user, switch to it
if [ -f "$SETUP_FLAG" ] && [ -f "$SETUP_USER_FILE" ]; then
    DEFAULT_USER=$(cat "$SETUP_USER_FILE")
    if id "$DEFAULT_USER" &>/dev/null; then
        exec su - "$DEFAULT_USER"
    fi
fi

# If setup not done yet, run the setup
if [ ! -f "$SETUP_FLAG" ]; then
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "      Welcome to Ubuntu Chroot Environment"
    echo "            First-time setup required"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    # Get username (like WSL)
    while true; do
        echo -n "Enter username: "
        read username
        if [ -z "$username" ]; then
            echo "Username cannot be empty!"
            continue
        fi
        if id "$username" &>/dev/null; then
            echo "User already exists!"
            continue
        fi
        if [[ ! "$username" =~ ^[a-z_][a-z0-9_-]*$ ]]; then
            echo "Invalid username! Use lowercase letters, numbers, underscore, and hyphen only."
            continue
        fi
        break
    done

    # Set hostname to ubuntu (instead of android)
    hostname ubuntu 2>/dev/null || true
    if [ -w /etc/hostname ]; then
        echo "ubuntu" > /etc/hostname 2>/dev/null || true
    fi
    if [ -w /etc/hosts ]; then
        if ! grep -q "ubuntu" /etc/hosts 2>/dev/null; then
            echo "127.0.1.1 ubuntu" >> /etc/hosts 2>/dev/null || true
        fi
    fi

    # Create user with home directory (like WSL)
    useradd -m -s /bin/bash "$username"

    # Set password
    while true; do
        echo -n "Enter password for $username: "
        read -s password
        echo ""
        if [ -z "$password" ]; then
            echo "Password cannot be empty!"
            continue
        fi
        echo -n "Confirm password: "
        read -s password_confirm
        echo ""
        if [ "$password" != "$password_confirm" ]; then
            echo "Passwords don't match!"
            continue
        fi
        echo "$username:$password" | chpasswd
        if [ $? -eq 0 ]; then
            break
        fi
        echo "Password setting failed. Please try again."
    done

    # Add to sudo group with NOPASSWD
    usermod -aG sudo "$username"
    echo "$username ALL=(ALL) NOPASSWD:ALL" > "/etc/sudoers.d/$username"
    chmod 0440 "/etc/sudoers.d/$username"

    # Add to docker group for Docker access without sudo
    usermod -aG docker "$username"

    # Add to plugdev group for USB access
    usermod -aG plugdev "$username"

    # *** APPLY NETWORK FIX TO NEW USER ***
    apply_network_fix "$username"

    # Add udev rules for universal USB access (safe for adb and MTP)
    cat > /etc/udev/rules.d/99-chroot.rules << 'UDEV_EOF'
SUBSYSTEM=="usb", ENV{DEVTYPE}=="usb_device", MODE="0666", GROUP="plugdev"
UDEV_EOF

    # Configure VNC for the new user
    echo "--- Configuring VNC for user $username ---"
    
    # Create the legacy .vnc directory for the password and xstartup files
    mkdir -p /home/$username/.vnc
    
    # Set the user's VNC password
    echo "$password" | vncpasswd -f > /home/$username/.vnc/passwd
    chmod 600 /home/$username/.vnc/passwd

    # Create the MODERN .config directory for the main config file
    mkdir -p /home/$username/.config/tigervnc

    # Create the main VNC config file that tells the server how to authenticate and run.
    # This prevents all interactive prompts on startup.
    cat > /home/$username/.config/tigervnc/config << VNC_CONFIG
# Use the standard VNC password file for authentication
SecurityTypes=VncAuth
# Explicitly define the path to the password file
PasswordFile=/home/$username/.vnc/passwd
# Define session, geometry, and localhost behavior here
session=xfce4-session
geometry=1920x1080
localhost=no
alwaysshared
VNC_CONFIG

    # Replace the placeholder USER with the actual username's home directory
    sed -i "s|/home/USER|/home/$username|g" /home/$username/.config/tigervnc/config

    # Create the xstartup script
    cat > /home/$username/.vnc/xstartup << 'VNC_XSTARTUP'
#!/bin/sh
# Unset these to prevent session conflicts
unset SESSION_MANAGER
unset DBUS_SESSION_BUS_ADDRESS
# Start XFCE with proper dbus session
exec dbus-launch --exit-with-session xfce4-session
VNC_XSTARTUP
    chmod +x /home/$username/.vnc/xstartup

    echo "--- VNC configuration complete ---"

    # Configure user's bashrc
    cat >> /home/$username/.bashrc << 'BASHRC'
export PS1="\[\e[38;5;208m\]\u@\h\[\e[m\]:\[\e[34m\]\w\[\e[m\]\$ "
alias ll="ls -lah"
alias gs="git status"
if [ -f /etc/bash_completion ]; then
    . /etc/bash_completion
fi
BASHRC

    # Set correct ownership for the entire home directory
    chown -R $username:$username /home/$username

    # Create helper script for future users (if admin creates more accounts)
    cat > /usr/local/bin/fix-user-network << 'HELPER_SCRIPT'
#!/bin/bash
# Automatically fix network permissions for a user
if [ -z "$1" ]; then
    echo "Usage: fix-user-network <username>"
    exit 1
fi

# Ensure Android network groups exist
grep -q '^aid_inet:' /etc/group || echo 'aid_inet:x:3003:' >> /etc/group
grep -q '^aid_net_raw:' /etc/group || echo 'aid_net_raw:x:3004:' >> /etc/group

usermod -a -G aid_inet,aid_net_raw "$1" 2>/dev/null
echo "Network access fixed for user: $1"
HELPER_SCRIPT
    chmod +x /usr/local/bin/fix-user-network

    # Configure adduser to automatically add network groups to future users
    if [ -f /etc/adduser.conf ]; then
        # Remove existing EXTRA_GROUPS line if present
        sed -i '/^EXTRA_GROUPS=/d' /etc/adduser.conf
        sed -i '/^ADD_EXTRA_GROUPS=/d' /etc/adduser.conf

        # Add network groups to default configuration
        echo 'ADD_EXTRA_GROUPS=1' >> /etc/adduser.conf
        echo 'EXTRA_GROUPS="aid_inet aid_net_raw"' >> /etc/adduser.conf
    fi

    # Save default user and mark setup as complete
    mkdir -p /var/lib
    echo "$username" > "$SETUP_USER_FILE"
    touch "$SETUP_FLAG"

    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "     Setup complete! User '$username' created."
    echo "       Restart the Chroot to take effect."
    echo "          To log in as '$username',"
    echo "        copy the login command from the webui."
    echo "      VNC server will start on the next boot."
    echo "      You also have the ability to use XRDP..."
    echo "      To start XRDP, checkout the post_exec."
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    exit 0
fi
