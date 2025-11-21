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
    # Excludes mobile data interfaces (rmnet*) - for forward NAT use
    interfaces=$(ip link show | grep -E '^[0-9]+:' | awk -F': ' '{print $2}' | sed 's/@.*//' | grep -vE '^(lo|tunl|gre|erspan|ip_vti|ip6|sit|ifb|dummy|rmnet|epdg|p2p)' | tr '\n' ',' | sed 's/,$//')
    [ -z "$interfaces" ] && error "No usable interfaces found" && exit 1
    echo "$interfaces"
}

list_all_interfaces() {
    # Get all network interfaces including mobile data (rmnet*)
    # Only includes interfaces that are UP and have an IP address assigned
    # This matches what ifconfig shows - only active interfaces with IPs
    # Excludes only loopback and non-routable virtual interfaces
    # This is useful for hotspot upstream interface selection
    
    local all_ifaces
    all_ifaces=$(ip link show | grep -E '^[0-9]+:' | awk -F': ' '{print $2}' | sed 's/@.*//' | grep -vE '^(lo|tunl|gre|erspan|ip_vti|ip6|sit|ifb|dummy|epdg|p2p)')
    
    local active_ifaces=""
    for iface in $all_ifaces; do
        # Check if interface exists and is UP (state UP or UNKNOWN with IP)
        local link_state
        link_state=$(ip link show "$iface" 2>/dev/null | grep -oE "state (UP|UNKNOWN|DOWN)" | awk '{print $2}')
        
        if [ "$link_state" = "UP" ] || [ "$link_state" = "UNKNOWN" ]; then
            # Check if interface has an IP address (IPv4 or IPv6)
            # Use ip addr show output directly - it's more reliable
            local addr_output
            addr_output=$(ip addr show "$iface" 2>/dev/null)
            
            local has_ipv4 has_ipv6
            has_ipv4=$(echo "$addr_output" | grep -E "inet [0-9]" | head -n1)
            # Check for IPv6 Global scope (case-insensitive, flexible pattern)
            has_ipv6=$(echo "$addr_output" | grep -iE "inet6.*scope.*global" | head -n1)
            
            # For rmnet* interfaces, require IPv4 address (filter out IPv6-only rmnet)
            if echo "$iface" | grep -qE "^rmnet"; then
                if [ -z "$has_ipv4" ]; then
                    continue  # Skip rmnet interfaces without IPv4
                fi
            fi
            
            if [ -n "$has_ipv4" ] || [ -n "$has_ipv6" ]; then
                # Get IP address for display (prefer IPv4, fallback to IPv6)
                local ip_addr
                if [ -n "$has_ipv4" ]; then
                    # Extract IPv4: format is "inet 10.245.232.78/24" or "inet addr:10.245.232.78"
                    ip_addr=$(echo "$has_ipv4" | sed -E 's/.*inet[[:space:]]+(addr:)?([0-9.]+).*/\2/' | cut -d'/' -f1)
                elif [ -n "$has_ipv6" ]; then
                    # Extract IPv6: format is "inet6 2402:4000:1492:8312:1:0:8546:438a/64"
                    # Need to extract the full IPv6 address before the /64
                    # Use a more robust pattern that handles various formats
                    ip_addr=$(echo "$has_ipv6" | awk '{for(i=1;i<=NF;i++){if($i ~ /^[0-9a-fA-F:]+$/ || $i ~ /^[0-9a-fA-F:]+\/[0-9]+$/){gsub(/\/.*/,"",$i);print $i;exit}}}')
                fi

                if [ -n "$ip_addr" ]; then
                    if [ -z "$active_ifaces" ]; then
                        active_ifaces="${iface}:${ip_addr}"
                    else
                        active_ifaces="${active_ifaces},${iface}:${ip_addr}"
                    fi
                else
                    # Interface is UP with IP but extraction failed - include it anyway
                    if [ -z "$active_ifaces" ]; then
                        active_ifaces="$iface"
                    else
                        active_ifaces="${active_ifaces},$iface"
                    fi
                fi
            fi
        fi
    done
    
    [ -z "$active_ifaces" ] && error "No active interfaces found" && exit 1
    echo "$active_ifaces"
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

check_routing_active() {
    # Check if forwarding is active by examining iptables rules (universal method)
    # Must have ALL 4 rules to be considered active
    local iface=""
    [ -f "$STATE_FILE" ] && . "$STATE_FILE" 2>/dev/null && iface="$TARGET_IFACE"
    
    # Check state file interface first - require ALL rules
    [ -n "$iface" ] && {
        iptables -C INPUT -i "$iface" -j ACCEPT 2>/dev/null && \
        iptables -C OUTPUT -o "$iface" -j ACCEPT 2>/dev/null && \
        iptables -C FORWARD -i "$iface" -j ACCEPT 2>/dev/null && \
        iptables -C FORWARD -o "$iface" -j ACCEPT 2>/dev/null && {
            echo "active"
            return 0
        }
    }
    
    # Fallback: check all interfaces - require ALL rules
    for check_iface in $(ip link show | grep -E '^[0-9]+:' | awk -F': ' '{print $2}' | sed 's/@.*//' | grep -vE '^(lo|tunl|gre|erspan|ip_vti|ip6|sit|ifb|dummy|epdg|p2p)'); do
        iptables -C INPUT -i "$check_iface" -j ACCEPT 2>/dev/null && \
        iptables -C OUTPUT -o "$check_iface" -j ACCEPT 2>/dev/null && \
        iptables -C FORWARD -i "$check_iface" -j ACCEPT 2>/dev/null && \
        iptables -C FORWARD -o "$check_iface" -j ACCEPT 2>/dev/null && {
            echo "active"
            return 0
        }
    done
    
    echo "inactive"
    return 1
}

cleanup_routing() {
    log "Cleaning up routing..."

    # Try to get interface from state file
    [ -z "$TARGET_IFACE" ] && load_state 2>/dev/null

    # Remove rules if interface found
    if [ -n "$TARGET_IFACE" ]; then
    log "Removing rules from $TARGET_IFACE..."
    iptables -D FORWARD -o "$TARGET_IFACE" -j ACCEPT 2>/dev/null
    iptables -D FORWARD -i "$TARGET_IFACE" -j ACCEPT 2>/dev/null
    iptables -D OUTPUT -o "$TARGET_IFACE" -j ACCEPT 2>/dev/null
    iptables -D INPUT -i "$TARGET_IFACE" -j ACCEPT 2>/dev/null
    else
        # No state file - search and remove from any interface
        warn "No state file found, searching for active forwarding rules..."
        for check_iface in $(ip link show | grep -E '^[0-9]+:' | awk -F': ' '{print $2}' | sed 's/@.*//' | grep -vE '^(lo|tunl|gre|erspan|ip_vti|ip6|sit|ifb|dummy|epdg|p2p)'); do
            iptables -D FORWARD -o "$check_iface" -j ACCEPT 2>/dev/null
            iptables -D FORWARD -i "$check_iface" -j ACCEPT 2>/dev/null
            iptables -D OUTPUT -o "$check_iface" -j ACCEPT 2>/dev/null
            iptables -D INPUT -i "$check_iface" -j ACCEPT 2>/dev/null
        done
    fi

    # Always clear state file
    rm -f "$STATE_FILE" 2>/dev/null
    log "Cleanup completed"
    return 0
}

print_usage() {
    cat << 'EOF'
Android Localhost Router

Usage:
  sh localhost_router.sh list-iface          List interfaces (excludes mobile data)
  sh localhost_router.sh list-all-iface      List all interfaces (includes mobile data)
  sh localhost_router.sh check-status        Check if forwarding is active
  sh localhost_router.sh -i <interface>      Setup routing
  sh localhost_router.sh -k                  Cleanup
  sh localhost_router.sh -h                  Help

Examples:
  sh localhost_router.sh list-iface
  sh localhost_router.sh list-all-iface
  sh localhost_router.sh check-status
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
    list-all-iface)
        list_all_interfaces
        exit 0
        ;;
    check-status)
        check_routing_active
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
