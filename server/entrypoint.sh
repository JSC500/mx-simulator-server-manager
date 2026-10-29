#!/bin/sh
set -e

ARGS_FILE="${MX_ARGS_FILE:-serverargs.txt}"
cd /data

# Start with default settings the first time, so a fresh install runs without manual steps
if [ ! -f "$ARGS_FILE" ]; then
    echo "No /data/$ARGS_FILE found, creating it from the defaults"
    cp /opt/mxserver/serverargs.default.txt "$ARGS_FILE"
fi

# The download comes with trackinfo files for many tracks; copy them once so they can be edited
if [ ! -d trackinfo ]; then
    echo "No /data/trackinfo found, copying the bundled tracks"
    cp -r /opt/mxserver/trackinfo trackinfo
fi

# Create files the args may reference so the server doesn't complain
touch bans.txt results.txt

# Docker creates a missing data folder as root; hand it to the server user
chown -R mx:mx /data

RUN_AS="setpriv --reuid=mx --regid=mx --init-groups"

# Any arguments passed to the container are handed straight to mxserver
if [ "$#" -gt 0 ]; then
    exec $RUN_AS /opt/mxserver/mxserver "$@"
fi

echo "Starting mxserver with /data/$ARGS_FILE"
exec $RUN_AS /opt/mxserver/mxserver --args-file "$ARGS_FILE"
