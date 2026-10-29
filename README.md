# Easy MX Simulator Server

Open source docker implementation to run and manage an mx simulator server. Rent a vps of your choice and follow the manual.

## Manual
Assuming you've connected to the terminal of your VPS (for example with `ssh root@your-server-ip`), run the following commands. They're written for Ubuntu or Debian, which most VPS providers offer.

**1. Set up the firewall**

In your VPS provider's web dashboard, open the firewall settings and allow these incoming ports:

| Port | Protocol | Used for |
|---|---|---|
| 22 | TCP | connecting to the VPS terminal (SSH) |
| 8080 | TCP | the web app |
| 19800 | UDP | the game server |

The game port must be **UDP**, not TCP. If your provider has no firewall in the dashboard, skip this step. Docker opens the ports on the VPS itself.

**2. Install Docker**

```sh
curl -fsSL https://get.docker.com | sh
```

**3. Download this project**

```sh
apt-get install -y git
git clone <repo-url> mx-server
cd mx-server
```

**4. Run the setup**

```sh
./setup.sh
```

It asks you to choose a username (press Enter to keep `admin`) and a password for the web app, then builds and starts everything. The first run takes a few minutes. At the end it prints the link to the web app, `http://your-server-ip:8080`. Open it in your browser and log in with your username and password.

To change the username or password later, run `./setup.sh` again.

**5. Add your tracks and change the settings**

The server comes with trackinfo files for many tracks in `data/trackinfo/`, and starts with Rabbit Hill. To add your own track, get its trackinfo file by loading the track in MX Simulator and typing `/savetrackinfo` in the chat. The web app will soon handle uploading. Until then, run this on your own computer, not on the VPS, to copy the file to the server:

```sh
scp mytrack.trackinfo root@your-server-ip:mx-server/data/trackinfo/
```

Then, on the VPS, open the settings:

```sh
nano data/serverargs.txt
```

Change the password, and list your track files at the bottom, one per line, like `trackinfo/rabbithill.trackinfo`. Save with **Ctrl-O, Enter**, then quit with **Ctrl-X**. Restart the server to apply the changes:

```sh
docker compose restart mxserver
```

**6. Connect.** In the game, go to *Multiplayer* and enter `your-server-ip:19800`.

## Requirements

- Docker with the Compose plugin (`docker compose`)
- An x86-64 host. The Linux `mxserver` is a 32-bit x86 binary, and the image adds the i386 libraries it needs. ARM hosts such as a Raspberry Pi won't run it natively.
- A public IP address, or a router where you can forward a UDP port

## Files

```
mxserver-docker/
├── setup.sh             # asks for the web app login and starts everything
├── docker-compose.yml   # runs the containers, keeps them up 24/7
├── server/
│   ├── Dockerfile       # builds the server image (Debian + i386 libs + mxserver)
│   ├── entrypoint.sh    # prepares /data and starts mxserver with your args file
│   └── serverargs.default.txt  # settings used on first start
├── web/                 # Rust web app for managing the server
└── data/                # mounted into the containers as /data
    ├── serverargs.txt   # server settings
    └── trackinfo/       # track files, starts with the ones bundled with mxserver
```

## Credits

MX Simulator and `mxserver` are by Josh Vanderhoof. This repository contains only Docker packaging; the server binary is downloaded from mxsimulator.com at build time.

## License

The code in this repository is released under the [MIT License](LICENSE). It does not cover `mxserver` or MX Simulator, which keep their own terms.
