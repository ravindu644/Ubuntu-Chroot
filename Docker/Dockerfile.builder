# Dockerfile.builder
# Stage 1: Build and customize the rootfs for development
FROM --platform=linux/arm64 ubuntu:22.04 AS customizer

ENV DEBIAN_FRONTEND=noninteractive

# Upgrade existing packages first
RUN apt-get update && apt-get upgrade -y

# ==> START OF AMD64 SUPPORT MODIFICATIONS <==
# Nuke the default sources.list and create a new multi-arch one.
# This ensures arm64 packages are fetched from ports.ubuntu.com and
# amd64 packages are fetched from the main archive.ubuntu.com.
RUN rm /etc/apt/sources.list && \
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

# Add the amd64 architecture and update package lists
RUN dpkg --add-architecture amd64 && \
    apt-get update
# ==> END OF AMD64 SUPPORT MODIFICATIONS <==

# Update and install development tools, compilers, utilities, and amd64 support libs
RUN apt-get install -y --no-install-recommends \
    # AMD64 Essential Libraries
    libc6:amd64 \
    libstdc++6:amd64 \
    libgcc-s1:amd64 \
    # Core utilities
    bash \
    coreutils \
    file \
    findutils \
    grep \
    sed \
    gawk \
    curl \
    wget \
    ca-certificates \
    locales \
    gnupg \
    bash-completion \
    # Compression tools
    zip \
    unzip \
    p7zip-full \
    bzip2 \
    xz-utils \
    tar \
    gzip \
    # System tools
    htop \
    vim \
    nano \
    git \
    sudo \
    openssh-server \
    net-tools \
    iputils-ping \
    iproute2 \
    dnsutils \
    usbutils \
    pciutils \
    lsof \
    psmisc \
    procps \
    # Wireless networking tools for hotspot functionality
    iw \
    hostapd \
    isc-dhcp-server \
    # C/C++ Development
    build-essential \
    gcc \
    g++ \
    gdb \
    make \
    cmake \
    autoconf \
    automake \
    libtool \
    pkg-config \
    # Python Development
    python3 \
    python3-pip \
    python3-dev \
    python3-venv \
    # Additional dev tools
    clang \
    llvm \
    valgrind \
    strace \
    ltrace \
    heimdall-flash \
    docker.io \
    qemu \
    binfmt-support \
    qemu-user-static
    
# Install fastfetch (neofetch alternative) and clean up all apt lists
RUN apt-get install -y --no-install-recommends software-properties-common && \
    add-apt-repository ppa:zhangsongcui3371/fastfetch && \
    apt-get update && \
    apt-get install -y fastfetch && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Update locales
RUN locale-gen en_US.UTF-8 && update-locale LANG=en_US.UTF-8 && update-locale LC_ALL=en_US.UTF-8

# Set global environment variables for all users and processes
RUN echo 'TMPDIR=/tmp' >> /etc/environment && \
    echo 'XDG_RUNTIME_DIR=/tmp/runtime' >> /etc/environment

# Configure SSH
RUN mkdir -p /var/run/sshd && \
    sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin yes/' /etc/ssh/sshd_config && \
    sed -i 's/#PasswordAuthentication yes/PasswordAuthentication yes/' /etc/ssh/sshd_config

# Configure Docker daemon
RUN mkdir -p /etc/docker && \
    echo '{"iptables": false, "bridge": "none"}' > /etc/docker/daemon.json

# Create WSL-like first-run setup script
RUN cat > /usr/local/bin/first-run-setup.sh << 'EOF'
#!/bin/bash

SETUP_FLAG="/var/lib/.user-setup-done"
SETUP_USER_FILE="/var/lib/.default-user"

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
    newgrp docker    

    # Configure bash for the user (like WSL)
    cat >> /home/$username/.bashrc << 'BASHRC'
export PS1="\[\e[38;5;208m\]\u@\h\[\e[m\]:\[\e[34m\]\w\[\e[m\]\$ "
alias ll="ls -lah"
alias gs="git status"
if [ -f /etc/bash_completion ]; then
    . /etc/bash_completion
fi
BASHRC

    chown -R $username:$username /home/$username

    # Save default user and mark setup as complete
    mkdir -p /var/lib
    echo "$username" > "$SETUP_USER_FILE"
    touch "$SETUP_FLAG"

    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  Setup complete! User '$username' created."
    echo "     To log in as '$username',"
    echo "     copy the login command from the webui."
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    exit 0
fi
EOF

RUN chmod +x /usr/local/bin/first-run-setup.sh

# Set up root's bashrc - auto-run setup if not done
RUN echo '#!/bin/bash' > /root/.bashrc && \
    echo 'if [ ! -f /var/lib/.user-setup-done ]; then' >> /root/.bashrc && \
    echo '    . /usr/local/bin/first-run-setup.sh' >> /root/.bashrc && \
    echo 'fi' >> /root/.bashrc && \
    echo 'export PS1="\[\e[38;5;208m\]\u@\h\[\e[m\]:\[\e[34m\]\w\[\e[m\]# "' >> /root/.bashrc && \
    echo 'alias ll="ls -lah"' >> /root/.bashrc && \
    echo 'if [ -f /etc/bash_completion ]; then' >> /root/.bashrc && \
    echo '    . /etc/bash_completion' >> /root/.bashrc && \
    echo 'fi' >> /root/.bashrc

# Stage 2: Export to scratch for extraction
FROM scratch AS export

# Copy the entire filesystem from the customizer stage
COPY --from=customizer / /
