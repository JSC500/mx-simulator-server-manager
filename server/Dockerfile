FROM debian:bookworm-slim

ARG MXSERVER_URL=https://mxsimulator.com/snapshots/mxserver-2021-01-21-1548.zip
ARG MXSERVER_SHA256=ab0e85b19cbfa89f77885bcd7ef4e5b5630b0732a83264ec805e2cb9398fb282

RUN dpkg --add-architecture i386 \
 && apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl unzip file \
      libc6:i386 libstdc++6:i386 libgcc-s1:i386 zlib1g:i386 \
 && rm -rf /var/lib/apt/lists/*

RUN set -eux; \
    mkdir -p /tmp/x /opt/mxserver; \
    curl -fL "$MXSERVER_URL" -o /tmp/mxserver.zip; \
    echo "$MXSERVER_SHA256  /tmp/mxserver.zip" | sha256sum -c -; \
    unzip -q /tmp/mxserver.zip -d /tmp/x; \
    BIN="$(find /tmp/x -type f -name mxserver | head -n1)"; \
    test -n "$BIN" || { echo "mxserver binary not found in zip"; exit 1; }; \
    cp -a "$(dirname "$BIN")"/. /opt/mxserver/; \
    chmod +x /opt/mxserver/mxserver; \
    file /opt/mxserver/mxserver; \
    rm -rf /tmp/x /tmp/mxserver.zip

RUN useradd --system --uid 1000 --home /data mx \
 && mkdir -p /data && chown mx:mx /data

COPY serverargs.default.txt /opt/mxserver/serverargs.default.txt
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# The entrypoint starts as root to prepare /data, then drops to the mx user
WORKDIR /data
VOLUME ["/data"]
EXPOSE 19800/udp

ENTRYPOINT ["/entrypoint.sh"]
