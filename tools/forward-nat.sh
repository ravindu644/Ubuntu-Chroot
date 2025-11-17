#!/system/bin/sh
# Android Localhost Router - Routes localhost services to network interface
# Usage: sh localhost_router.sh [-i interface] [-k] [list-iface]

# --- Logging and Utility Functions ---
log() { echo "[INFO] $1"; }
warn() { echo "[WARN] $1"; }
error() { echo "[ERROR] $1"; }

# --- Check Prerequisites ---
if ! command -v ip >/dev/null 2>&1; then
    error "'ip' command not found"
    exit 1
fi

if ! command -v iptables >/dev/null 2>&1; then
    error "'iptables' command not found"
    exit 1
fi

# --- Variables ---
TARGET_IFACE=""
STATE_FILE="/data/local/tmp/localhost_router.state"
GATEWAY_IP=""
SUBNET_CIDR=""
NETWORK_ADDR=""

# --- Functions ---
list_interfaces() {
    # Get all physical/virtual network interfaces (exclude loopback and virtual tunnels)
    interfaces=$(ip link show | grep -E '^[0-9]+:' | awk -F': ' '{print $2}' | sed 's/@.*//' | grep -vE '^(lo|tunl|gre|erspan|ip_vti|ip6|sit|ifb|dummy|rmnet|epdg|p2p)' | tr '\n' ',' | sed 's/,$//')
    [ -z "$interfaces" ] && error "No usable interfaces found" && exit 1
    echo "$interfaces"
}

check_interface() {
    ip link show "$TARGET_IFACE" >/dev/null 2>&1 || { error "Interface '$TARGET_IFACE' not found"; exit 1; }
}

detect_ip_config() {
    log "Detecting IP configuration for $TARGET_IFACE..."
    
    # Wait for interface
    local retry=0
    while [ $retry -lt 5 ]; do
        ip link show "$TARGET_IFACE" 2>/dev/null | grep -q "state UP" && break
        log "Waiting for interface to come up... ($retry/5)"
        sleep 1
        retry=$((retry + 1))
    done
    
    # Get IP info
    local ip_info
    ip_info=$(ip addr show "$TARGET_IFACE" 2>/dev/null | grep 'inet ' | head -n1 | awk '{print $2}')
    [ -z "$ip_info" ] && error "No IP on $TARGET_IFACE. Enable USB tethering first." && exit 1
    
    GATEWAY_IP=$(echo "$ip_info" | cut -d'/' -f1)
    SUBNET_CIDR=$(echo "$ip_info" | cut -d'/' -f2)
    
    if [ "$SUBNET_CIDR" = "24" ]; then
        NETWORK_ADDR=$(echo "$GATEWAY_IP" | cut -d'.' -f1-3).0
    else
        NETWORK_ADDR=$(echo "$GATEWAY_IP" | cut -d'.' -f1-3).0
    fi
    
    log "Detected: $GATEWAY_IP/$SUBNET_CIDR (Network: $NETWORK_ADDR/$SUBNET_CIDR)"
}

save_state() {
    cat << EOF > "$STATE_FILE"
TARGET_IFACE=$TARGET_IFACE
GATEWAY_IP=$GATEWAY_IP
SUBNET_CIDR=$SUBNET_CIDR
NETWORK_ADDR=$NETWORK_ADDR
EOF
}

load_state() {
    [ -f "$STATE_FILE" ] && . "$STATE_FILE" && return 0
    return 1
}

setup_routing() {
    log "Setting up routing on $TARGET_IFACE..."
    
    check_interface
    
    # Bring up if needed
    ip link show "$TARGET_IFACE" 2>/dev/null | grep -q "state UP" || {
        ip link set "$TARGET_IFACE" up
        sleep 2
    }
    
    detect_ip_config
    
    log "Detected: $GATEWAY_IP/$SUBNET_CIDR"
    
    # Enable forwarding
    echo 1 > /proc/sys/net/ipv4/ip_forward 2>/dev/null
    
    # Firewall rules
    iptables -C INPUT -i "$TARGET_IFACE" -j ACCEPT 2>/dev/null || \
        iptables -I INPUT -i "$TARGET_IFACE" -j ACCEPT 2>/dev/null
    
    iptables -C OUTPUT -o "$TARGET_IFACE" -j ACCEPT 2>/dev/null || \
        iptables -I OUTPUT -o "$TARGET_IFACE" -j ACCEPT 2>/dev/null
    
    iptables -C FORWARD -i "$TARGET_IFACE" -j ACCEPT 2>/dev/null || \
        iptables -I FORWARD -i "$TARGET_IFACE" -j ACCEPT 2>/dev/null
    
    iptables -C FORWARD -o "$TARGET_IFACE" -j ACCEPT 2>/dev/null || \
        iptables -I FORWARD -o "$TARGET_IFACE" -j ACCEPT 2>/dev/null
    
    save_state
    
    echo ""
    log "Localhost routing active!"
    log "Interface: $TARGET_IFACE"
    log "Gateway: $GATEWAY_IP"
    echo ""
    log "Connect from PC:"
    log "  VNC:  $GATEWAY_IP:5901"
    log "  XRDP: $GATEWAY_IP:3389"
    log "  SSH:  $GATEWAY_IP"
}

cleanup_routing() {
    log "Cleaning up routing..."
    
    if [ -z "$TARGET_IFACE" ]; then
        if ! load_state; then
            error "No config found. Use: -i <interface> -k"
            exit 1
        fi
    fi
    
    log "Removing rules from $TARGET_IFACE..."
    
    iptables -D FORWARD -o "$TARGET_IFACE" -j ACCEPT 2>/dev/null
    iptables -D FORWARD -i "$TARGET_IFACE" -j ACCEPT 2>/dev/null
    iptables -D OUTPUT -o "$TARGET_IFACE" -j ACCEPT 2>/dev/null
    iptables -D INPUT -i "$TARGET_IFACE" -j ACCEPT 2>/dev/null
    
    rm -f "$STATE_FILE"
    log "Cleanup done"
}

print_usage() {
    cat << 'EOF'
Android Localhost Router

Usage:
  sh localhost_router.sh list-iface          List interfaces
  sh localhost_router.sh -i <interface>      Setup routing
  sh localhost_router.sh -k                  Cleanup
  sh localhost_router.sh -h                  Help

Examples:
  sh localhost_router.sh list-iface
  sh localhost_router.sh -i rndis0
  sh localhost_router.sh -k
EOF
}

# --- Main ---
if [ "$(id -u)" -ne 0 ]; then
    error "Run as root"
    exit 1
fi

case "$1" in
    list-iface)
        list_interfaces
        exit 0
        ;;
    -h|--help|"")
        print_usage
        exit 0
        ;;
esac

KILL_MODE=0
while [ $# -gt 0 ]; do
    case "$1" in
        -i) shift; TARGET_IFACE="$1"; shift ;;
        -k) KILL_MODE=1; shift ;;
        -h|--help) print_usage; exit 0 ;;
        *) error "Unknown option: $1"; print_usage; exit 1 ;;
    esac
done

if [ $KILL_MODE -eq 1 ]; then
    cleanup_routing
else
    if [ -z "$TARGET_IFACE" ]; then
        error "Specify interface with -i"
        print_usage
        exit 1
    fi
    setup_routing
fi
