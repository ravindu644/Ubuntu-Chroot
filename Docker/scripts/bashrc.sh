# Docker stuff
# List running containers (pretty)
alias dps="docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'"

# List all containers
alias dpsa="docker ps -a --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'"

# List all images
alias dim="docker images --format 'table {{.Repository}}\t{{.Tag}}\t{{.ID}}\t{{.Size}}'"

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

docker() {
    if [ "$1" = "run" ]; then
        shift
        command docker run --net=host "$@"
    else
        command docker "$@"
    fi
}
