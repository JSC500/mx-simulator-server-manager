#!/bin/sh
# Rerun to change the username or password
set -e
cd "$(dirname "$0")"

while :; do
    printf "Choose a username for the web app [admin]: "
    read -r WEB_USER
    WEB_USER="${WEB_USER:-admin}"

    # Basic auth separates username and password with a colon
    if printf '%s' "$WEB_USER" | grep -q "[:'\"\\\$]"; then
        echo "Please don't use colons, quotes, backslashes or \$ in the username."
    else
        break
    fi
done

while :; do
    printf "Choose a password for the web app: "
    stty -echo; read -r PASSWORD; stty echo; echo
    printf "Type it again: "
    stty -echo; read -r PASSWORD2; stty echo; echo

    if [ -z "$PASSWORD" ]; then
        echo "The password can't be empty."
    elif [ "$PASSWORD" != "$PASSWORD2" ]; then
        echo "The passwords don't match."
    elif printf '%s' "$PASSWORD" | grep -q "['\"\\\$]"; then
        echo "Please don't use quotes, backslashes or \$ in the password."
    else
        break
    fi
done

printf "WEB_USERNAME='%s'\nWEB_PASSWORD='%s'\n" "$WEB_USER" "$PASSWORD" > .env
chmod 600 .env

docker compose up -d --build --remove-orphans

# Ask an outside service, because on clouds like AWS or Google Cloud the VPS only sees a
# private address
IP="$(curl -4 -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)"

echo
if printf '%s' "$IP" | grep -Eq '^[0-9]{1,3}(\.[0-9]{1,3}){3}$'; then
    echo "Done! Open the web app in your browser:"
    echo
    echo "    http://$IP:8080"
    echo
    echo "Log in with the username \"$WEB_USER\" and the password you just chose."
    echo "Players connect in game with: $IP:19800"
else
    echo "Done! The server's IP address could not be found automatically."
    echo "Look up your VPS's public IP address in your VPS provider's dashboard, then"
    echo "open the web app in your browser at:"
    echo
    echo "    http://<your-vps-ip>:8080"
    echo
    echo "Log in with the username \"$WEB_USER\" and the password you just chose."
    echo "Players connect in game with: <your-vps-ip>:19800"
fi
