// Runs one mxserver process per game server and talks to it.
//
// Every server lives in /data/servers/<id>/ with its server.json, serverargs.txt, bans.txt
// and results. The trackinfo folder in there links to the shared /data/trackinfo.
// Commands go over mxserver's --xcmd-password UDP channel, which only accepts packets
// from 127.0.0.1, which is why this app and the game servers share one container.
use crate::args::{self, Ban, Settings};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::fs::{self, File};
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::net::UdpSocket;
use tokio::process::{Child, Command};
use tokio::sync::oneshot;

const BRIDGE_JS: &str = include_str!("bridge.js");

#[derive(Clone, Serialize, Deserialize)]
pub struct ServerConfig {
    pub name: String,
    pub port: u16,
    // Whether it should be running; survives restarts of the container
    pub autostart: bool,
}

pub struct App {
    pub data: PathBuf,
    pub ports: (u16, u16),
    servers: RwLock<BTreeMap<String, Arc<Server>>>,
}

impl App {
    pub fn load(data: PathBuf, ports: (u16, u16)) -> io::Result<Arc<App>> {
        fs::create_dir_all(data.join("trackinfo"))?;
        fs::create_dir_all(data.join(".mxweb"))?;
        fs::write(data.join(".mxweb/bridge.js"), BRIDGE_JS)?;
        let app = Arc::new(App { data, ports, servers: RwLock::new(BTreeMap::new()) });
        app.migrate_single_server()?;

        let mut servers = BTreeMap::new();
        for entry in fs::read_dir(app.data.join("servers"))? {
            let entry = entry?;
            let id = entry.file_name().to_string_lossy().into_owned();
            match Server::open(&id, entry.path(), app.bridge()) {
                Some(server) => {
                    servers.insert(id, Arc::new(server));
                }
                None => eprintln!("Skipping {}: no readable server.json", entry.path().display()),
            }
        }
        *app.servers.write().unwrap() = servers;

        if app.list().is_empty() {
            app.create("Main", ports.0, app.default_settings(), &[], true).map_err(io::Error::other)?;
        }
        Ok(app)
    }

    // Older versions ran one server straight from /data; move its files into servers/main
    fn migrate_single_server(&self) -> io::Result<()> {
        let servers = self.data.join("servers");
        let old_args = self.data.join("serverargs.txt");
        if servers.exists() || !old_args.exists() {
            return fs::create_dir_all(servers);
        }
        let dir = servers.join("main");
        fs::create_dir_all(&dir)?;
        for file in ["serverargs.txt", "bans.txt", "results.txt"] {
            if self.data.join(file).exists() {
                fs::rename(self.data.join(file), dir.join(file))?;
            }
        }
        let port = args::port(&fs::read_to_string(dir.join("serverargs.txt"))?).unwrap_or(self.ports.0);
        write_json(&dir.join("server.json"), &ServerConfig { name: "Main".into(), port, autostart: true })?;
        link_tracks(&dir)?;
        println!("Moved the server files from /data into {}", dir.display());
        Ok(())
    }

    fn bridge(&self) -> PathBuf {
        self.data.join(".mxweb/bridge.js")
    }

    pub fn default_settings(&self) -> Settings {
        let path = std::env::var("MX_DEFAULT_ARGS").unwrap_or_else(|_| "/opt/mxserver/serverargs.default.txt".into());
        fs::read_to_string(path).map(|text| args::parse(&text)).unwrap_or_default()
    }

    pub fn list(&self) -> Vec<Arc<Server>> {
        let mut list: Vec<_> = self.servers.read().unwrap().values().cloned().collect();
        list.sort_by_key(|s| s.config().port);
        list
    }

    pub fn get(&self, id: &str) -> Option<Arc<Server>> {
        self.servers.read().unwrap().get(id).cloned()
    }

    pub fn next_port(&self) -> Option<u16> {
        let used: Vec<u16> = self.list().iter().map(|s| s.config().port).collect();
        (self.ports.0..=self.ports.1).find(|p| !used.contains(p))
    }

    pub fn create(&self, name: &str, port: u16, settings: Settings, bans: &[Ban], autostart: bool) -> Result<Arc<Server>, String> {
        let mut servers = self.servers.write().unwrap();
        if !(self.ports.0..=self.ports.1).contains(&port) {
            return Err(format!("The port must be between {} and {}, the range Docker publishes.", self.ports.0, self.ports.1));
        }
        if let Some(other) = servers.values().find(|s| s.config().port == port) {
            return Err(format!("Port {port} is already used by {}.", other.config().name));
        }

        let base = slug(name);
        let mut id = base.clone();
        let mut n = 2;
        while servers.contains_key(&id) || self.data.join("servers").join(&id).exists() {
            id = format!("{base}-{n}");
            n += 1;
        }

        let dir = self.data.join("servers").join(&id);
        let setup = || -> io::Result<()> {
            fs::create_dir_all(&dir)?;
            link_tracks(&dir)?;
            write_json(&dir.join("server.json"), &ServerConfig { name: name.into(), port, autostart })?;
            write_atomic(&dir.join("serverargs.txt"), &args::generate(&settings, port, false))?;
            write_atomic(&dir.join("bans.txt"), &args::generate_bans(bans))
        };
        setup().map_err(|e| format!("Couldn't create the server's files: {e}"))?;

        let server = Arc::new(Server::open(&id, dir, self.bridge()).ok_or("Couldn't read the new server's files")?);
        servers.insert(id, server.clone());
        drop(servers);
        if autostart {
            server.start();
        }
        Ok(server)
    }

    pub fn start_all(&self) {
        for server in self.list() {
            if server.config().autostart {
                server.start();
            }
        }
    }

    // On shutdown; keeps autostart so the servers come back with the container
    pub async fn stop_all(&self) {
        let list = self.list();
        for server in &list {
            server.request_stop();
        }
        for server in &list {
            server.wait_stopped().await;
        }
    }
}

struct Runtime {
    desired: bool,
    running: bool,
    // Tells an old watcher task apart from the current one after a restart
    generation: u64,
    password: String,
    stop: Option<oneshot::Sender<()>>,
    last_exit: Option<String>,
}

pub struct Server {
    pub id: String,
    pub dir: PathBuf,
    bridge: PathBuf,
    config: Mutex<ServerConfig>,
    runtime: Mutex<Runtime>,
    last_live: Mutex<Option<Value>>,
}

impl Server {
    fn open(id: &str, dir: PathBuf, bridge: PathBuf) -> Option<Server> {
        let config = serde_json::from_str(&fs::read_to_string(dir.join("server.json")).ok()?).ok()?;
        Some(Server {
            id: id.into(),
            dir,
            bridge,
            config: Mutex::new(config),
            runtime: Mutex::new(Runtime {
                desired: false,
                running: false,
                generation: 0,
                password: String::new(),
                stop: None,
                last_exit: None,
            }),
            last_live: Mutex::new(None),
        })
    }

    pub fn config(&self) -> ServerConfig {
        self.config.lock().unwrap().clone()
    }

    fn update_config(&self, change: impl FnOnce(&mut ServerConfig)) -> io::Result<()> {
        let mut config = self.config.lock().unwrap();
        change(&mut config);
        write_json(&self.dir.join("server.json"), &*config)
    }

    pub fn set_name(&self, name: &str) -> io::Result<()> {
        self.update_config(|c| c.name = name.into())
    }

    pub fn settings(&self) -> Settings {
        args::parse(&fs::read_to_string(self.dir.join("serverargs.txt")).unwrap_or_default())
    }

    pub fn save_settings(&self, settings: &Settings) -> io::Result<()> {
        write_atomic(&self.dir.join("serverargs.txt"), &args::generate(settings, self.config().port, false))
    }

    pub fn update_settings(&self, change: impl FnOnce(&mut Settings)) -> io::Result<()> {
        let mut settings = self.settings();
        change(&mut settings);
        self.save_settings(&settings)
    }

    pub fn bans(&self) -> Vec<Ban> {
        args::parse_bans(&fs::read_to_string(self.dir.join("bans.txt")).unwrap_or_default())
    }

    pub fn save_bans(&self, bans: &[Ban]) -> io::Result<()> {
        write_atomic(&self.dir.join("bans.txt"), &args::generate_bans(bans))
    }

    // "running", "starting", "crashed" or "stopped", plus why it last exited
    pub fn status(&self) -> (&'static str, Option<String>) {
        let rt = self.runtime.lock().unwrap();
        let status = match (rt.running, rt.desired) {
            (true, _) => "running",
            (false, true) if rt.last_exit.is_some() => "crashed",
            (false, true) => "starting",
            (false, false) => "stopped",
        };
        (status, rt.last_exit.clone())
    }

    pub fn start(self: &Arc<Self>) {
        let mut rt = self.runtime.lock().unwrap();
        rt.desired = true;
        rt.last_exit = None;
        if !rt.running {
            self.spawn(&mut rt);
        }
        drop(rt);
        if let Err(e) = self.update_config(|c| c.autostart = true) {
            eprintln!("[{}] couldn't save server.json: {e}", self.id);
        }
    }

    pub async fn stop(&self) {
        self.request_stop();
        self.wait_stopped().await;
        if let Err(e) = self.update_config(|c| c.autostart = false) {
            eprintln!("[{}] couldn't save server.json: {e}", self.id);
        }
    }

    pub async fn restart(self: &Arc<Self>) {
        self.stop().await;
        self.start();
    }

    fn request_stop(&self) {
        let mut rt = self.runtime.lock().unwrap();
        rt.desired = false;
        rt.last_exit = None;
        if let Some(stop) = rt.stop.take() {
            let _ = stop.send(());
        }
    }

    async fn wait_stopped(&self) {
        for _ in 0..100 {
            if !self.runtime.lock().unwrap().running {
                return;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }

    fn spawn(self: &Arc<Self>, rt: &mut Runtime) {
        rt.generation += 1;
        let generation = rt.generation;
        let password = random_hex();

        let state = self.dir.join(".mxweb");
        let prepare = || -> io::Result<File> {
            fs::create_dir_all(&state)?;
            fs::create_dir_all(self.dir.join("results"))?;
            link_tracks(&self.dir)?;
            for file in ["status.json", "demo.mxdemo"] {
                let _ = fs::remove_file(state.join(file));
            }
            for file in ["bans.txt", "results.txt"] {
                fs::OpenOptions::new().create(true).append(true).open(self.dir.join(file))?;
            }
            File::create(state.join("console.log"))
        };
        let child = prepare().and_then(|log| {
            Command::new(std::env::var("MXSERVER_BIN").unwrap_or_else(|_| "/opt/mxserver/mxserver".into()))
                .current_dir(&self.dir)
                .arg("--xcmd-password")
                .arg(&password)
                .arg("--javascript")
                .arg(&self.bridge)
                .arg("--args-file")
                .arg("serverargs.txt")
                .stdin(Stdio::null())
                .stdout(log.try_clone()?)
                .stderr(log)
                .kill_on_drop(true)
                .spawn()
        });

        match child {
            Ok(child) => {
                let (stop, stopped) = oneshot::channel();
                rt.running = true;
                rt.password = password;
                rt.stop = Some(stop);
                println!("[{}] started mxserver on port {}", self.id, self.config().port);
                tokio::spawn(self.clone().watch(child, stopped, generation));
            }
            Err(e) => {
                rt.running = false;
                rt.last_exit = Some(format!("Couldn't start mxserver: {e}"));
                eprintln!("[{}] couldn't start mxserver: {e}", self.id);
            }
        }
    }

    async fn watch(self: Arc<Self>, mut child: Child, stop: oneshot::Receiver<()>, generation: u64) {
        let started = Instant::now();
        let exit = tokio::select! {
            status = child.wait() => Some(match status {
                Ok(status) => format!("mxserver stopped by itself ({status})."),
                Err(e) => format!("Lost track of mxserver: {e}"),
            }),
            _ = stop => {
                let _ = self.command("shutdown").await;
                if tokio::time::timeout(Duration::from_secs(3), child.wait()).await.is_err() {
                    let _ = child.kill().await;
                }
                None
            }
        };

        let retry = {
            let mut rt = self.runtime.lock().unwrap();
            if rt.generation != generation {
                return;
            }
            rt.running = false;
            rt.stop = None;
            if let Some(msg) = &exit {
                eprintln!("[{}] {msg}", self.id);
                rt.last_exit = Some(msg.clone());
            }
            exit.is_some() && rt.desired
        };
        if !retry {
            return;
        }

        // Back off when it dies right away, e.g. from a setting it doesn't accept
        let delay = if started.elapsed() < Duration::from_secs(10) { 30 } else { 5 };
        tokio::time::sleep(Duration::from_secs(delay)).await;
        let mut rt = self.runtime.lock().unwrap();
        if rt.desired && !rt.running && rt.generation == generation {
            self.spawn(&mut rt);
        }
    }

    pub async fn command(&self, line: &str) -> Result<(), String> {
        let port = self.config().port;
        let password = {
            let rt = self.runtime.lock().unwrap();
            if !rt.running {
                return Err("The server isn't running.".into());
            }
            rt.password.clone()
        };
        let packet = format!("x{password}{line}");
        let send = async {
            let socket = UdpSocket::bind("127.0.0.1:0").await?;
            socket.send_to(packet.as_bytes(), ("127.0.0.1", port)).await
        };
        send.await.map(|_| ()).map_err(|e| format!("Couldn't reach the server: {e}"))
    }

    // What the bridge script last wrote, if the server is up and it's recent
    pub fn live(&self) -> Option<Value> {
        if !self.runtime.lock().unwrap().running {
            return None;
        }
        let mut last = self.last_live.lock().unwrap();
        // The bridge rewrites the file in place, so a read can catch it half written
        if let Some(v) = fs::read_to_string(self.dir.join(".mxweb/status.json"))
            .ok()
            .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        {
            *last = Some(v);
        }
        let v = last.as_ref()?;
        let age = now_ms().saturating_sub(v["t"].as_f64().unwrap_or(0.0) as u64);
        (age < 5000).then(|| v.clone())
    }

    pub fn console_tail(&self, lines: usize) -> Vec<String> {
        let text = fs::read_to_string(self.dir.join(".mxweb/console.log")).unwrap_or_default();
        let all: Vec<&str> = text.lines().collect();
        all[all.len().saturating_sub(lines)..].iter().map(|l| l.to_string()).collect()
    }
}

// Rotation entries say "trackinfo/x.trackinfo", relative to the server's folder
fn link_tracks(dir: &Path) -> io::Result<()> {
    let link = dir.join("trackinfo");
    if link.symlink_metadata().is_err() {
        std::os::unix::fs::symlink("../../trackinfo", link)?;
    }
    Ok(())
}

fn slug(name: &str) -> String {
    let mut slug = String::new();
    for c in name.to_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            slug.push(c);
        } else if !slug.ends_with('-') && !slug.is_empty() {
            slug.push('-');
        }
    }
    let slug = slug.trim_end_matches('-');
    if slug.is_empty() { "server".into() } else { slug.chars().take(40).collect() }
}

fn random_hex() -> String {
    let mut bytes = [0u8; 16];
    File::open("/dev/urandom").and_then(|mut f| f.read_exact(&mut bytes)).expect("can't read /dev/urandom");
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

// Write next to the target, then rename, so a crash never leaves half a file
pub fn write_atomic(path: &Path, content: impl AsRef<[u8]>) -> io::Result<()> {
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, content)?;
    fs::rename(tmp, path)
}

fn write_json(path: &Path, value: &impl Serialize) -> io::Result<()> {
    write_atomic(path, serde_json::to_string_pretty(value).map_err(io::Error::other)?)
}
