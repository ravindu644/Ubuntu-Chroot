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
COPY scripts/start_vnc /usr/local/bin/
COPY scripts/start_xrdp /usr/local/bin/

# Make scripts executable
RUN chmod +x /usr/local/bin/systemctl /usr/local/bin/first-run-setup.sh /usr/local/bin/start_vnc /usr/local/bin/start_xrdp

# This is the main installation layer. All package installations, PPA additions,
# and setup are done here to minimize layers and maximize build speed.
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    # Essentials for adding PPAs
    software-properties-common \
    gnupg \
    # Add PPAs for fastfetch and Firefox ESR
    && add-apt-repository ppa:zhangsongcui3371/fastfetch -y && \
    add-apt-repository ppa:mozillateam/ppa -y && \
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
    kea-dhcp4-server \
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
    gparted \
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
    # XFCE Desktop Environment and essential tools
    xfce4 \
    desktop-base \
    xfce4-terminal \
    xfce4-session \
    xscreensaver \
    xfce4-goodies \
    xubuntu-wallpapers \
    xfce4-taskmanager \
    mousepad \
    galculator \
    nemo-fileroller \
    ristretto \
    xfce4-screenshooter \
    catfish \
    mugshot \
    xcursor-themes \
    dmz-cursor-theme \
    xfce4-clipman-plugin \
    tigervnc-standalone-server \
    tigervnc-tools \
    xrdp \
    dbus-x11 \
    dbus \
    at-spi2-core \
    tumbler \
    fonts-lklug-sinhala \
    # Icon themes
    adwaita-icon-theme-full \
    hicolor-icon-theme \
    gnome-icon-theme \
    tango-icon-theme \
    # GTK theme engines and popular themes
    gtk2-engines-murrine \
    gtk2-engines-pixbuf \
    arc-theme \
    numix-gtk-theme \
    materia-gtk-theme \
    papirus-icon-theme \
    greybird-gtk-theme \
    # Essential fonts for GUI rendering
    fonts-dejavu-core \
    fonts-liberation \
    fonts-liberation2 \
    fonts-noto-core \
    fonts-noto-ui-core \
    fonts-ubuntu \
    # File manager and GUI utilities
    thunar \
    thunar-volman \
    thunar-archive-plugin \
    thunar-media-tags-plugin \
    gvfs \
    gvfs-backends \
    gvfs-fuse \
    x11-xserver-utils \
    x11-utils \
    xclip \
    xsel \
    xfwm4 \
    xfconf \
    zenity \
    notification-daemon \
    # User directory management
    xdg-user-dirs \
    # Packages from PPAs
    fastfetch \
    firefox-esr \
    # PolicyKit for permissions
    policykit-1 \
    && apt-get purge -y gdm3 gnome-session gnome-shell whoopsie && \
    apt-get autoremove -y

# Copy and configure XFCE settings in a single layer
COPY xfce4-config.tar /tmp/
RUN mkdir -p /etc/skel/.config && \
    tar -xf /tmp/xfce4-config.tar -C /etc/skel/.config/ && \
    rm /tmp/xfce4-config.tar

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
    # Configure xrdp to use XFCE and set color depth
    echo "xfce4-session" > /etc/skel/.xsession && \
    chmod +x /etc/skel/.xsession && \
    sed -i 's/max_bpp=32/max_bpp=24/g' /etc/xrdp/xrdp.ini || true && \
    # Create default user directories
    xdg-user-dirs-update && \
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

# Set up PolicyKit passwordless rule for sudo group
RUN mkdir -p /etc/polkit-1/rules.d && \
    cat > /etc/polkit-1/rules.d/49-nopasswd.rules << 'EOF'
polkit.addRule(function(action, subject) {
    if (subject.isInGroup("sudo")) {
        return polkit.Result.YES;
    }
});
EOF

# Update icon and font caches in a final setup layer
RUN gtk-update-icon-cache -f /usr/share/icons/hicolor 2>/dev/null || true && \
    gtk-update-icon-cache -f /usr/share/icons/Adwaita 2>/dev/null || true && \
    gtk-update-icon-cache -f /usr/share/icons/Papirus 2>/dev/null || true && \
    gtk-update-icon-cache -f /usr/share/icons/Tango 2>/dev/null || true && \
    fc-cache -fv

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
