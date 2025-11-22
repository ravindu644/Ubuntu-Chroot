# Dockerfile.builder
# Stage 1: Build and customize the rootfs for development
FROM --platform=linux/arm64 ubuntu:24.04 AS customizer

ENV DEBIAN_FRONTEND=noninteractive

# Update base system and set up multi-architecture support in a single layer.
# This part changes less frequently and will be cached effectively.
RUN apt-get update && apt-get upgrade -y && \
    # Add amd64 architecture
    dpkg --add-architecture amd64 && \
    # Nuke the default sources.list and create a new multi-arch one.
    rm /etc/apt/sources.list && \
    rm -rf /etc/apt/sources.list.d/* && \
    cat > /etc/apt/sources.list << EOF
# For arm64 (native architecture)
deb [arch=arm64] http://ports.ubuntu.com/ubuntu-ports/ noble main restricted universe multiverse
deb [arch=arm64] http://ports.ubuntu.com/ubuntu-ports/ noble-updates main restricted universe multiverse
deb [arch=arm64] http://ports.ubuntu.com/ubuntu-ports/ noble-backports main restricted universe multiverse
deb [arch=arm64] http://ports.ubuntu.com/ubuntu-ports/ noble-security main restricted universe multiverse

# For amd64 (the foreign architecture) - ONLY include the 'main' component
deb [arch=amd64] http://archive.ubuntu.com/ubuntu/ noble main
deb [arch=amd64] http://archive.ubuntu.com/ubuntu/ noble-updates main
deb [arch=amd64] http://security.ubuntu.com/ubuntu/ noble-backports main
deb [arch=amd64] http://security.ubuntu.com/ubuntu/ noble-security main
EOF

RUN cat > /etc/apt/preferences.d/99-multiarch-pinning << EOF
Package: *
Pin: origin "ports.ubuntu.com"
Pin-Priority: 1001

Package: *
Pin: origin "archive.ubuntu.com"
Pin-Priority: 500
EOF

# Copy custom scripts first
COPY scripts/systemctl3.py /usr/local/bin/systemctl
COPY scripts/first-run-setup.sh /usr/local/bin/
COPY scripts/download-firmware /usr/local/bin/

# Copy our bashrc script to the rootfs
COPY scripts/bashrc.sh /etc/profile.d/chroot-webui-aliases.sh

# Make scripts executable
RUN chmod +x /usr/local/bin/systemctl /usr/local/bin/first-run-setup.sh /usr/local/bin/download-firmware /etc/profile.d/chroot-webui-aliases.sh

# Add loading of all profile.d scripts to global bash.bashrc for all users
RUN cat >> /etc/bash.bashrc << 'EOF'

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

# This is the main installation layer. All package installations, PPA additions,
# and setup are done here to minimize layers and maximize build speed.
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    # Essentials for adding PPAs
    software-properties-common \
    gnupg \
    # Add PPAs for fastfetch and Firefox ESR
    && add-apt-repository ppa:zhangsongcui3371/fastfetch -y && \
    # Update package lists again after adding PPAs
    apt-get update && \
    # Install all packages in a single command
    apt-get install -y --no-install-recommends \
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
    bash-completion \
    udev \
    dbus \
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
    fastfetch \
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
    # File system tools
    dosfstools \
    exfatprogs \
    btrfs-progs \
    ntfs-3g \
    xfsprogs \
    jfsutils \
    hfsprogs \
    reiserfsprogs \
    cryptsetup \
    nilfs-tools \
    udftools \
    f2fs-tools \
    # Python Development
    python3 \
    python3-pip \
    python3-dev \
    python3-venv \
    python-is-python3 \
    # Additional dev tools
    clang \
    llvm \
    valgrind \
    strace \
    ltrace \
    heimdall-flash \
    docker.io \
    && apt-get purge -y gdm3 gnome-session gnome-shell whoopsie && \
    apt-get autoremove -y

# Configure locales, environment, SSH, Docker, and user setup in a single layer
RUN locale-gen en_US.UTF-8 && \
    update-locale LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 && \
    # Set global environment variables
    echo 'TMPDIR=/tmp' >> /etc/environment && \
    echo 'XDG_RUNTIME_DIR=/tmp/runtime' >> /etc/environment && \
    # Configure SSH
    mkdir -p /var/run/sshd && \
    sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin yes/' /etc/ssh/sshd_config && \
    sed -i 's/#PasswordAuthentication yes/PasswordAuthentication yes/' /etc/ssh/sshd_config && \
    # Configure Docker daemon
    mkdir -p /etc/docker && \
    echo '{"iptables": false, "bridge": "none"}' > /etc/docker/daemon.json && \
    # Create udev rules for traditional wireless interface names and USB authorization
    mkdir -p /etc/udev/rules.d && \
    echo 'SUBSYSTEM=="net", ACTION=="add", ATTR{type}=="1", NAME="wlan%n"' > /etc/udev/rules.d/70-wlan.rules && \
    echo 'ACTION=="add", SUBSYSTEM=="usb", ATTR{authorized}=="0", ATTR{authorized}="1"' > /etc/udev/rules.d/70-usb-authorize.rules && \
    # Remove default ubuntu user if it exists
    deluser --remove-home ubuntu || true

# Set up root's bashrc with first-run logic
RUN echo '#!/bin/bash' > /root/.bashrc && \
    echo 'if [ ! -f /var/lib/.user-setup-done ]; then' >> /root/.bashrc && \
    echo '    . /usr/local/bin/first-run-setup.sh' >> /root/.bashrc && \
    echo 'fi' >> /root/.bashrc && \
    echo 'export PS1="\[\e[38;5;208m\]\u@\h\[\e[m\]:\[\e[34m\]\w\[\e[m\]# "' >> /root/.bashrc && \
    echo 'alias ll="ls -lah"' >> /root/.bashrc && \
    echo 'if [ -f /etc/bash_completion ]; then' >> /root/.bashrc && \
    echo '    . /etc/bash_completion' >> /root/.bashrc && \
    echo 'fi' >> /root/.bashrc

# Purge and reinstall qemu and binfmt in the exact order specified
RUN apt-get purge -y qemu-* binfmt-support && \
    apt-get autoremove -y && \
    apt-get autoclean && \
    # Remove any leftover config files
    rm -rf /var/lib/binfmts/* && \
    rm -rf /etc/binfmt.d/* && \
    rm -rf /usr/lib/binfmt.d/qemu-* && \
    # Update package lists
    apt-get update && \
    # Install ONLY these packages (in this specific order)
    apt-get install -y qemu-user-static && \
    apt-get install -y binfmt-support

# Final cleanup of APT cache
RUN apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Stage 2: Export to scratch for extraction
FROM scratch AS export

# Copy the entire filesystem from the customizer stage
COPY --from=customizer / /
