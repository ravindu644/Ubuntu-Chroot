export ZIPFILE="$ZIPFILE"
export TMPDIR="$TMPDIR"

# source our functions
unzip -o "$ZIPFILE" 'META-INF/*' -d $TMPDIR >&2
. "$TMPDIR/META-INF/com/google/android/util_functions.sh"

SKIPMOUNT=false
PROPFILE=false
POSTFSDATA=false
LATESTARTSERVICE=true

print_modname() {

echo "  _   _ _             _        ";
echo " | | | | |__ _  _ _ _| |_ _  _ ";
echo " | |_| | '_ | || | ' |  _| || |";
echo "  \___/|_.__/\_,_|_||_\__|\_,_|";
echo "  / __| |_  _ _ ___ ___| |_    ";
echo " | (__| ' \| '_/ _ / _ |  _|   ";
echo "  \___|_||_|_| \___\___/\__|   ";
echo "                               ";
echo "       by @ravindu644          ";
echo " "
}

check_for_susfs || exit 1

on_install() {
  unzip -o "$ZIPFILE" 'webroot/*' -d $MODPATH >&2
  unzip -oj "$ZIPFILE" 'service.sh' -d $MODPATH >&2

  setup_chroot
  extract_rootfs

  rm -rf /data/system/package_cache/*
}


set_permissions() {
  set_perm_recursive $MODPATH 0 0 0755 0644
  set_perm "/data/local/ubuntu-chroot/chroot.sh" 0 0 0755
  set_perm "/data/local/ubuntu-chroot/post_exec.sh" 0 0 0755
  set_perm "$MODPATH/service.sh" 0 0 0755

}
