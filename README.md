# MX Simulator Server Manager

Easy setup and management of MX Simulator servers. Rent a VPS or grab an old laptop and follow the manual.

## Manual
Assuming you've connected to the terminal of your linux VPS or old laptop, run the following commands.

**1. Set up the firewall**

In your VPS provider's web dashboard or router settings, open the firewall settings and allow these incoming ports:

| Port | Protocol | Used for |
|---|---|---|
| 8080 | TCP | the web app |
| 19800-19809 | UDP | the game servers, one port per server. If you only plan on opening 1 server, only 19800 will do too. |

The game ports must be **UDP**, not TCP.

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

**5. Set up your server in the web app**

The first server, "Main", starts right away on port 19800 with Rabbit Hill. In the web app:

## Credits

MX Simulator and `mxserver` are by Josh Vanderhoof. This repository contains only Docker packaging; the server binary is downloaded from mxsimulator.com at build time.

## License

The code in this repository is released under the [MIT License](LICENSE). It does not cover `mxserver` or MX Simulator, which keep their own terms.
