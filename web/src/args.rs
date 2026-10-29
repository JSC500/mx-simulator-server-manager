// Reads and writes mxserver's serverargs.txt and bans.txt (see README.TXT in the mxserver download)
use serde::{Deserialize, Serialize};
use std::fmt::Display;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub greeting: String,
    pub password: String,
    pub inactivity_timeout: Option<u32>,
    pub max_clients: Option<u32>,
    pub max_players: Option<u32>,
    // Race defaults; each rotation entry can override them
    pub laps: u32,
    pub minutes: u32,
    pub track_interval: i32,
    pub erode: Option<f64>,
    pub no_arcade: bool,
    pub admin: Option<u64>,
    pub marshals: Vec<u64>,
    pub reserved_clients: Option<u32>,
    pub reserve: Vec<u64>,
    pub max_cuts: Option<u32>,
    pub off_course_bias: Option<f64>,
    pub off_course_scale: Option<f64>,
    pub rate: Option<u64>,
    pub min_version: Option<u32>,
    pub demos: bool,
    pub rotation: Vec<Track>,
    // Options this app has no field for, kept as written, one per line
    pub extra: Vec<String>,
}

impl Default for Settings {
    // mxserver's own defaults
    fn default() -> Self {
        Settings {
            greeting: String::new(),
            password: String::new(),
            inactivity_timeout: None,
            max_clients: None,
            max_players: None,
            laps: 5,
            minutes: 0,
            track_interval: 60,
            erode: None,
            no_arcade: false,
            admin: None,
            marshals: Vec::new(),
            reserved_clients: None,
            reserve: Vec::new(),
            max_cuts: None,
            off_course_bias: None,
            off_course_scale: None,
            rate: None,
            min_version: None,
            demos: false,
            rotation: Vec::new(),
            extra: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Track {
    // Relative to the trackinfo folder, e.g. "rabbithill.trackinfo"
    pub file: String,
    pub laps: Option<u32>,
    pub minutes: Option<u32>,
    pub interval: Option<i32>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Ban {
    pub uid: u64,
    // Unix time the ban ends, 0 for permanent
    pub until: u64,
}

pub const DEMO_FILE: &str = ".mxweb/demo.mxdemo";

// Options that always take a value. Unknown ones only take the next token if it isn't another option.
const WITH_VALUE: &[&str] = &[
    "address", "admin", "args-file", "ban-file", "demo-file", "erode", "extension", "greeting",
    "inactivity-timeout", "javascript", "laps", "lineup-file", "marshal", "max-clients", "max-cuts",
    "max-players", "min-version", "minutes", "next-track", "off-course-bias", "off-course-scale",
    "password", "port", "rate", "reserve", "reserved-clients", "results-cmd", "results-file",
    "sendfile-prefix", "track", "track-interval", "xcmd-password",
];

// Splits like mxserver does: on whitespace, with double quotes grouping
fn tokenize(text: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let (mut quoted, mut started) = (false, false);
    for c in text.chars() {
        match c {
            '"' => {
                quoted = !quoted;
                started = true;
            }
            c if c.is_whitespace() && !quoted => {
                if started {
                    tokens.push(std::mem::take(&mut current));
                    started = false;
                }
            }
            c => {
                current.push(c);
                started = true;
            }
        }
    }
    if started {
        tokens.push(current);
    }
    tokens
}

pub fn port(text: &str) -> Option<u16> {
    let tokens = tokenize(text);
    let i = tokens.iter().position(|t| t == "--port")?;
    tokens.get(i + 1)?.parse().ok()
}

pub fn parse(text: &str) -> Settings {
    let mut s = Settings::default();
    let (mut laps, mut minutes, mut interval) = (s.laps, s.minutes, s.track_interval);
    let mut defaults = None;
    let mut tracks = Vec::new();
    let mut tokens = tokenize(text).into_iter().peekable();

    while let Some(token) = tokens.next() {
        let Some(name) = token.strip_prefix("--") else {
            defaults.get_or_insert((laps, minutes, interval));
            tracks.push((token, laps, minutes, interval));
            continue;
        };
        let name = name.to_string();
        if name == "no-arcade" {
            s.no_arcade = true;
            continue;
        }
        let takes_value = WITH_VALUE.contains(&name.as_str())
            || tokens.peek().is_some_and(|next| !next.starts_with("--"));
        let value = if takes_value { tokens.next() } else { None };
        let v = value.clone().unwrap_or_default();
        match name.as_str() {
            "laps" => laps = v.parse().unwrap_or(laps),
            "minutes" => minutes = v.parse().unwrap_or(minutes),
            "track-interval" => interval = v.parse().unwrap_or(interval),
            "track" => {
                defaults.get_or_insert((laps, minutes, interval));
                tracks.push((v, laps, minutes, interval));
            }
            "greeting" => s.greeting = v,
            "password" => s.password = v,
            "inactivity-timeout" => s.inactivity_timeout = v.parse().ok(),
            "max-clients" => s.max_clients = v.parse().ok(),
            "max-players" => s.max_players = v.parse().ok(),
            "reserved-clients" => s.reserved_clients = v.parse().ok(),
            "erode" => s.erode = v.parse().ok(),
            "admin" => s.admin = v.parse().ok(),
            "marshal" => s.marshals.extend(v.parse::<u64>().ok()),
            "reserve" => s.reserve.extend(v.parse::<u64>().ok()),
            "max-cuts" => s.max_cuts = v.parse().ok(),
            "off-course-bias" => s.off_course_bias = v.parse().ok(),
            "off-course-scale" => s.off_course_scale = v.parse().ok(),
            "rate" => s.rate = v.parse().ok(),
            "min-version" => s.min_version = v.parse().ok(),
            "demo-file" => s.demos = true,
            // Set by the web app itself
            "port" | "args-file" | "xcmd-password" | "ban-file" | "results-file" => {}
            _ => s.extra.push(match value {
                Some(v) => format!("--{name} {}", quote(&v)),
                None => format!("--{name}"),
            }),
        }
    }

    let (laps, minutes, interval) = defaults.unwrap_or((laps, minutes, interval));
    s.laps = laps;
    s.minutes = minutes;
    s.track_interval = interval;
    s.rotation = tracks
        .into_iter()
        .map(|(path, l, m, i)| Track {
            file: path.strip_prefix("trackinfo/").unwrap_or(&path).to_string(),
            laps: (l != laps).then_some(l),
            minutes: (m != minutes).then_some(m),
            interval: (i != interval).then_some(i),
        })
        .collect();
    s
}

fn opt(out: &mut Vec<String>, name: &str, value: Option<impl Display>) {
    if let Some(v) = value {
        out.push(format!("--{name} {v}"));
    }
}

pub fn generate(s: &Settings, port: u16, mask_password: bool) -> String {
    let mut out = vec![format!("--port {port}")];
    opt(&mut out, "max-clients", s.max_clients);
    opt(&mut out, "max-players", s.max_players);
    opt(&mut out, "reserved-clients", s.reserved_clients);
    if !s.password.is_empty() {
        let password = if mask_password { "••••••••" } else { &s.password };
        out.push(format!("--password {}", quote(password)));
    }
    if !s.greeting.is_empty() {
        out.push(format!("--greeting {}", quote(&s.greeting)));
    }
    opt(&mut out, "inactivity-timeout", s.inactivity_timeout);
    opt(&mut out, "admin", s.admin);
    for uid in &s.marshals {
        out.push(format!("--marshal {uid}"));
    }
    for uid in &s.reserve {
        out.push(format!("--reserve {uid}"));
    }
    opt(&mut out, "erode", s.erode);
    if s.no_arcade {
        out.push("--no-arcade".into());
    }
    opt(&mut out, "max-cuts", s.max_cuts);
    opt(&mut out, "off-course-bias", s.off_course_bias);
    opt(&mut out, "off-course-scale", s.off_course_scale);
    opt(&mut out, "rate", s.rate);
    opt(&mut out, "min-version", s.min_version);
    if s.demos {
        out.push(format!("--demo-file {DEMO_FILE}"));
    }
    out.extend(s.extra.iter().cloned());
    out.push("--ban-file bans.txt".into());
    out.push("--results-file results.txt".into());

    // --laps, --minutes and --track-interval apply to every track after them
    let (mut laps, mut minutes, mut interval) = (s.laps, s.minutes, s.track_interval);
    out.push(format!("--track-interval {interval}"));
    out.push(format!("--laps {laps}"));
    if minutes != 0 {
        out.push(format!("--minutes {minutes}"));
    }
    for t in &s.rotation {
        let i = t.interval.unwrap_or(s.track_interval);
        if i != interval {
            out.push(format!("--track-interval {i}"));
            interval = i;
        }
        let m = t.minutes.unwrap_or(s.minutes);
        if m != minutes {
            out.push(format!("--minutes {m}"));
            minutes = m;
        }
        let l = t.laps.unwrap_or(s.laps);
        if l != laps {
            out.push(format!("--laps {l}"));
            laps = l;
        }
        out.push(track_path(&t.file));
    }
    out.join("\n") + "\n"
}

// Where a rotation entry's file is, relative to the server's folder
pub fn track_path(file: &str) -> String {
    if file.contains('/') { file.to_string() } else { format!("trackinfo/{file}") }
}

fn quote(v: &str) -> String {
    if v.is_empty() || v.contains(char::is_whitespace) { format!("\"{v}\"") } else { v.to_string() }
}

// The args file has no way to escape quotes or line breaks
pub fn clean_text(v: &str) -> String {
    v.chars().filter(|c| !c.is_control() && *c != '"').collect::<String>().trim().to_string()
}

pub fn valid_track_path(f: &str) -> bool {
    f.ends_with(".trackinfo")
        && !f.starts_with(['/', '.'])
        && !f.contains("..")
        && f.chars().all(|c| c.is_ascii_alphanumeric() || "._-/".contains(c))
}

pub fn sanitize(s: &mut Settings) -> Result<(), String> {
    s.greeting = clean_text(&s.greeting);
    s.password = clean_text(&s.password);
    if s.rotation.is_empty() {
        return Err("Add at least one track in Settings → Tracks.".into());
    }
    if let Some(t) = s.rotation.iter().find(|t| !valid_track_path(&t.file)) {
        return Err(format!("\"{}\" isn't a valid trackinfo file name.", t.file));
    }
    if s.erode.is_some_and(|e| !(0.0..=100.0).contains(&e)) {
        return Err("Erode must be between 0 and 100.".into());
    }
    if s.extra.iter().any(|l| l.contains(['\n', '\r'])) {
        return Err("Other options can't contain line breaks.".into());
    }
    s.marshals.sort_unstable();
    s.marshals.dedup();
    s.reserve.sort_unstable();
    s.reserve.dedup();
    Ok(())
}

pub fn parse_bans(text: &str) -> Vec<Ban> {
    text.lines()
        .filter_map(|line| {
            let mut parts = line.split_whitespace();
            let until = parts.next()?.parse().ok()?;
            let uid = parts.next()?.parse().ok()?;
            Some(Ban { uid, until })
        })
        .collect()
}

pub fn generate_bans(bans: &[Ban]) -> String {
    bans.iter().map(|b| format!("{} {}\n", b.until, b.uid)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const FILE: &str = r#"--port 19800
--max-clients 20
--password changeme
--greeting "Welcome to my server"
--erode 0.75
--ban-file bans.txt
--results-file results.txt
--javascript js/help.js
--track-interval 15
--laps 5
trackinfo/rabbithill.trackinfo
trackinfo/buddscreek.trackinfo
--laps 6
trackinfo/redbud.trackinfo
--minutes 10
trackinfo/glenside.trackinfo
--minutes 0
--laps 5
trackinfo/locust.trackinfo
"#;

    #[test]
    fn parses_defaults_and_overrides() {
        let s = parse(FILE);
        assert_eq!(port(FILE), Some(19800));
        assert_eq!(s.greeting, "Welcome to my server");
        assert_eq!(s.erode, Some(0.75));
        assert_eq!((s.laps, s.minutes, s.track_interval), (5, 0, 15));
        assert_eq!(s.extra, vec!["--javascript js/help.js"]);
        let files: Vec<_> = s.rotation.iter().map(|t| t.file.as_str()).collect();
        assert_eq!(files, ["rabbithill.trackinfo", "buddscreek.trackinfo", "redbud.trackinfo", "glenside.trackinfo", "locust.trackinfo"]);
        assert_eq!(s.rotation[2].laps, Some(6));
        assert_eq!((s.rotation[3].laps, s.rotation[3].minutes), (Some(6), Some(10)));
        assert_eq!(s.rotation[4], Track { file: "locust.trackinfo".into(), ..Default::default() });
    }

    #[test]
    fn round_trips() {
        let s = parse(FILE);
        let text = generate(&s, 19800, false);
        assert_eq!(parse(&text), s);
        assert!(text.contains("--laps 6\ntrackinfo/redbud.trackinfo"));
        assert!(text.contains("--erode 0.75\n"));
        assert!(generate(&s, 19800, true).contains("--password ••••••••"));
    }

    #[test]
    fn bans() {
        let bans = parse_bans("0 41250\n1793900000 59904\ngarbage\n");
        assert_eq!(bans, vec![Ban { uid: 41250, until: 0 }, Ban { uid: 59904, until: 1793900000 }]);
        assert_eq!(generate_bans(&bans), "0 41250\n1793900000 59904\n");
    }
}
