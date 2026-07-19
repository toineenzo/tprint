#!/bin/sh
# Sends a short raw ESC/POS test print directly to a USB thermal printer
# device node. Run this BEFORE deploying the app, to confirm the printer is
# reachable at all from wherever you run it (Proxmox host, or the LXC/VM
# you passed the printer through to).
#
# Usage: ./scripts/test_printer.sh [/dev/usb/lp0]

set -eu

DEVICE="${1:-/dev/usb/lp0}"

if [ ! -e "$DEVICE" ]; then
  echo "No device found at $DEVICE" >&2
  echo "Check: lsusb (is the printer listed?), dmesg | grep -i usblp (did the kernel bind it?)" >&2
  exit 1
fi

if [ ! -w "$DEVICE" ]; then
  echo "$DEVICE exists but is not writable by $(whoami) — check permissions/passthrough." >&2
  exit 1
fi

# ESC @ (initialize) + test text + 3 line feeds + GS V (partial cut)
printf '\x1b\x40tprint test print\nIf you can read this,\nthe printer transport works.\n\n\n\x1dV\x01' > "$DEVICE"

echo "Test print sent to $DEVICE."
