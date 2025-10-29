SKIPMOUNT=false

# Set to true if you need to load system.prop
PROPFILE=false

# Set to true if you need post-fs-data script
POSTFSDATA=false

# Set to true if you need late_start service script
LATESTARTSERVICE=true

setup_chroot(){
  mkdir -p /data/local/ubuntu-chroot
  unzip -oj "$ZIPFILE" 'tools/chroot.sh' -d /data/local/ubuntu-chroot >&2
  unzip -oj "$ZIPFILE" 'tools/post_exec.sh' -d /data/local/ubuntu-chroot >&2
}

print_modname() {
  echo "Installing Chroot WebUI..."
  setup_chroot
}

on_install() {
  unzip -o "$ZIPFILE" 'webroot/*' -d $MODPATH >&2
  unzip -oj "$ZIPFILE" 'service.sh' -d $MODPATH >&2
  rm -rf /data/system/package_cache/*
}

# Only some special files require specific permissions
# This function will be called after on_install is done
# The default permissions should be good enough for most cases

set_permissions() {
  # The following is the default rule, DO NOT remove
  set_perm_recursive $MODPATH 0 0 0755 0644
  set_perm "/data/local/ubuntu-chroot/chroot.sh" 0 0 0755
  set_perm "/data/local/ubuntu-chroot/post_exec.sh" 0 0 0755
  set_perm "$MODPATH/service.sh" 0 0 0755

  # Here are some examples:
  # set_perm_recursive  $MODPATH/system/lib       0     0       0755      0644
  # set_perm  $MODPATH/system/bin/app_process32   0     2000    0755      u:object_r:zygote_exec:s0
  # set_perm  $MODPATH/system/bin/dex2oat         0     2000    0755      u:object_r:dex2oat_exec:s0
  # set_perm  $MODPATH/system/lib/libart.so       0     0       0644
}

# You can add more functions to assist your custom script code
