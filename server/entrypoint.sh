#!/bin/sh
set -e
cd /data

# The download comes with trackinfo files for many tracks; copy them once so they can be edited
if [ ! -d trackinfo ]; then
    echo "No /data/trackinfo found, copying the bundled tracks"
    cp -r /opt/mxserver/trackinfo trackinfo
fi

# Docker creates a missing data folder as root; hand it to the server user
chown -R mx:mx /data

# The web app creates the first server from serverargs.default.txt and starts every server
exec setpriv --reuid=mx --regid=mx --init-groups /usr/local/bin/mxweb
