#!/bin/sh

#
# startwm.sh for chroot / non-systemd environments
# Copyright (c) 2025 ravindu644, adapted from community solutions
#

# --- 1. Clean and Prepare the Environment ---
# Unset potentially problematic variables inherited from the xrdp-sesman service.
unset DBUS_SESSION_BUS_ADDRESS
unset XDG_RUNTIME_DIR
unset SESSION_MANAGER

# Source profile scripts to get a basic user environment.
if [ -r /etc/profile ]; then
  . /etc/profile
fi
if [ -r ~/.profile ]; then
  . ~/.profile
fi

# --- 2. Manually Create XDG_RUNTIME_DIR ---
# This is the single most common point of failure. systemd-logind normally
# creates this directory. Without it, many modern applications, including
# parts of XFCE, will fail to start.
# We create it manually with the correct permissions.

XDG_RUNTIME_DIR="/run/user/$(id -u)"
if [ ! -d "$XDG_RUNTIME_DIR" ]; then
  mkdir -p "$XDG_RUNTIME_DIR"
  chown "$(id -u):$(id -g)" "$XDG_RUNTIME_DIR"
  chmod 0700 "$XDG_RUNTIME_DIR"
fi
export XDG_RUNTIME_DIR

# --- 3. Start Essential Session Services ---
# Start the system-wide D-Bus instance if it's not running.
# The --fork option is crucial for it to daemonize correctly.
if ! pgrep -x "dbus-daemon" > /dev/null; then
    dbus-daemon --system --fork
fi

# Start the PolicyKit daemon, which XFCE uses for permissions.
# Without this, the session can hang waiting for a Polkit agent.
/usr/lib/polkit-1/polkitd --no-debug &

# --- 4. Launch the Desktop Environment within its OWN D-Bus session ---
# This is the final step. We use the command that is proven to work in your
# VNC setup. The 'exec' command replaces the current script process with
# dbus-launch, ensuring a clean exit when you log out.

exec dbus-launch --exit-with-session startxfce4
