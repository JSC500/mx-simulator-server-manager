// JSON API used by the pages in static/
use crate::args::{self, Ban, Settings};
use crate::servers::{App, Server, write_atomic};
use axum::{
    Json, Router,
    body::Bytes,
    extract::{Path, Query, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::fs;
use std::sync::Arc;

type AppState = Arc<App>;
type ApiResult<T = Json<Value>> = Result<T, ApiError>;

pub struct ApiError(StatusCode, String);

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({ "error": self.1 }))).into_response()
    }
}

fn bad(msg: impl Into<String>) -> ApiError {
    ApiError(StatusCode::BAD_REQUEST, msg.into())
}

fn internal(e: impl std::fmt::Display) -> ApiError {
    ApiError(StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
}

fn not_found(what: &str) -> ApiError {
    ApiError(StatusCode::NOT_FOUND, format!("{what} not found."))
}

pub fn router(app: AppState) -> Router {
    Router::new()
        .route("/api/servers", get(list_servers).post(create_server))
        .route("/api/servers/{id}/live", get(live))
        .route("/api/servers/{id}/start", post(start))
        .route("/api/servers/{id}/stop", post(stop))
        .route("/api/servers/{id}/restart", post(restart))
        .route("/api/servers/{id}/command", post(command))
        .route("/api/servers/{id}/settings", get(get_settings).put(put_settings))
        .route("/api/servers/{id}/preview", post(preview))
        .route("/api/tracks", get(list_tracks))
        .route("/api/tracks/{file}", get(download_track).put(upload_track).delete(delete_track))
        .route("/api/results", get(list_results))
        .route("/api/results/{server}/{race}", get(result))
        .route("/api/results/{server}/{race}/demo", get(result_demo))
        .with_state(app)
}

fn server(app: &App, id: &str) -> ApiResult<Arc<Server>> {
    app.get(id).ok_or_else(|| not_found("Server"))
}

fn summary(s: &Server) -> Value {
    let config = s.config();
    let (status, last_exit) = s.status();
    let race = s.live().map(|l| {
        json!({
            "players": l["players"].as_array().map_or(0, |p| p.len()),
            "raceTime": l["raceTime"],
            "finishLaps": l["finishLaps"],
            "finishTime": l["finishTime"],
            "leaderLaps": l["leaderLaps"],
        })
    });
    json!({
        "id": s.id,
        "name": config.name,
        "port": config.port,
        "status": status,
        "lastExit": last_exit,
        // mxserver's default when the args don't say
        "maxClients": s.settings().max_clients.unwrap_or(10),
        "race": race,
    })
}

async fn list_servers(State(app): State<AppState>) -> Json<Value> {
    let servers: Vec<Value> = app.list().iter().map(|s| summary(s)).collect();
    Json(json!({ "servers": servers, "nextPort": app.next_port(), "ports": [app.ports.0, app.ports.1] }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NewServer {
    name: String,
    port: u16,
    max_clients: Option<u32>,
    copy_from: Option<String>,
    password: Option<String>,
    start: bool,
}

async fn create_server(State(app): State<AppState>, Json(body): Json<NewServer>) -> ApiResult {
    let name = args::clean_text(&body.name);
    if name.is_empty() {
        return Err(bad("Give the server a name."));
    }
    let (mut settings, bans) = match &body.copy_from {
        Some(id) => {
            let source = server(&app, id)?;
            (source.settings(), source.bans())
        }
        None => (app.default_settings(), Vec::new()),
    };
    if body.max_clients.is_some() {
        settings.max_clients = body.max_clients;
    }
    if let Some(password) = body.password.as_deref().map(args::clean_text).filter(|p| !p.is_empty()) {
        settings.password = password;
    }
    let s = app.create(&name, body.port, settings, &bans, body.start).map_err(bad)?;
    Ok(Json(summary(&s)))
}

// Name and default race rules of every rotation entry, read from its trackinfo file
fn rotation(s: &Server, settings: &Settings) -> Vec<Value> {
    settings
        .rotation
        .iter()
        .map(|t| {
            let info = read_trackinfo(&s.dir.join(args::track_path(&t.file)));
            json!({
                "file": t.file,
                "name": info.name.unwrap_or_else(|| t.file.trim_end_matches(".trackinfo").to_string()),
                "dir": info.dir,
                "laps": t.laps.unwrap_or(settings.laps),
                "minutes": t.minutes.unwrap_or(settings.minutes),
            })
        })
        .collect()
}

async fn live(State(app): State<AppState>, Path(id): Path<String>) -> ApiResult {
    let s = server(&app, &id)?;
    let settings = s.settings();
    let (status, _) = s.status();
    Ok(Json(json!({
        "server": summary(&s),
        "live": s.live(),
        "rotation": rotation(&s, &settings),
        "reserve": settings.reserve,
        // Shows why a server won't start
        "console": if status == "running" { Vec::new() } else { s.console_tail(15) },
    })))
}

async fn start(State(app): State<AppState>, Path(id): Path<String>) -> ApiResult {
    let s = server(&app, &id)?;
    s.start();
    Ok(Json(summary(&s)))
}

async fn stop(State(app): State<AppState>, Path(id): Path<String>) -> ApiResult {
    let s = server(&app, &id)?;
    s.stop().await;
    Ok(Json(summary(&s)))
}

async fn restart(State(app): State<AppState>, Path(id): Path<String>) -> ApiResult {
    let s = server(&app, &id)?;
    s.restart().await;
    Ok(Json(summary(&s)))
}

#[derive(Deserialize)]
struct Cmd {
    action: String,
    slot: Option<u32>,
    uid: Option<u64>,
    track: Option<u32>,
    text: Option<String>,
    color: Option<String>,
}

const COLORS: &[&str] = &["white", "yellow", "green", "cyan", "magenta", "red"];

async fn command(State(app): State<AppState>, Path(id): Path<String>, Json(cmd): Json<Cmd>) -> ApiResult {
    let s = server(&app, &id)?;
    let slot = || cmd.slot.ok_or_else(|| bad("Missing slot."));
    // UID 0 means the player's key isn't verified
    let uid = || cmd.uid.filter(|u| *u > 0).ok_or_else(|| bad("This player has no verified UID."));

    let line = match cmd.action.as_str() {
        "kick" => format!("kick {}", slot()?),
        "ban" => format!("ban {}", uid()?),
        "mute" => format!("mute {}", uid()?),
        "marshal" => format!("addmarshal {}", uid()?),
        "unmarshal" => format!("removemarshal {}", uid()?),
        "reserve" => format!("reserve {}", uid()?),
        "unreserve" => format!("unreserve {}", uid()?),
        "nexttrack" => "nexttrack".into(),
        "restart" => "restart".into(),
        "settrack" => format!("settrack {}", cmd.track.ok_or_else(|| bad("Missing track."))?),
        "say" => {
            let text: String = args::clean_text(cmd.text.as_deref().unwrap_or("")).chars().take(200).collect();
            if text.is_empty() {
                return Err(bad("Type a message first."));
            }
            let color = cmd.color.as_deref().filter(|c| COLORS.contains(c)).unwrap_or("white");
            match cmd.slot {
                Some(to) => format!("mxwebsayto {to} {color} {text}"),
                None => format!("mxwebsay {color} {text}"),
            }
        }
        _ => return Err(bad("Unknown action.")),
    };
    s.command(&line).await.map_err(bad)?;

    // Live commands are forgotten on restart; keep the lasting ones in the server's files
    let saved = match cmd.action.as_str() {
        "ban" => {
            let uid = uid()?;
            let mut bans = s.bans();
            if !bans.iter().any(|b| b.uid == uid && b.until == 0) {
                bans.retain(|b| b.uid != uid);
                bans.push(Ban { uid, until: 0 });
            }
            s.save_bans(&bans)
        }
        "marshal" => s.update_settings(|st| add_uid(&mut st.marshals, cmd.uid)),
        "unmarshal" => s.update_settings(|st| st.marshals.retain(|u| Some(*u) != cmd.uid)),
        "reserve" => s.update_settings(|st| add_uid(&mut st.reserve, cmd.uid)),
        "unreserve" => s.update_settings(|st| st.reserve.retain(|u| Some(*u) != cmd.uid)),
        _ => Ok(()),
    };
    saved.map_err(|e| internal(format!("Sent, but couldn't save it for the next start: {e}")))?;

    Ok(Json(json!({ "sent": format!("server,{line}") })))
}

fn add_uid(list: &mut Vec<u64>, uid: Option<u64>) {
    if let Some(uid) = uid.filter(|u| !list.contains(u)) {
        list.push(uid);
    }
}

async fn get_settings(State(app): State<AppState>, Path(id): Path<String>) -> ApiResult {
    let s = server(&app, &id)?;
    let config = s.config();
    Ok(Json(json!({
        "id": s.id,
        "name": config.name,
        "port": config.port,
        "status": s.status().0,
        "settings": s.settings(),
        "bans": s.bans(),
    })))
}

#[derive(Deserialize)]
struct SaveSettings {
    name: String,
    settings: Settings,
    bans: Vec<Ban>,
}

async fn put_settings(State(app): State<AppState>, Path(id): Path<String>, Json(body): Json<SaveSettings>) -> ApiResult {
    let s = server(&app, &id)?;
    let name = args::clean_text(&body.name);
    if name.is_empty() {
        return Err(bad("Give the server a name."));
    }
    let mut settings = body.settings;
    args::sanitize(&mut settings).map_err(bad)?;
    s.set_name(&name).map_err(internal)?;
    s.save_settings(&settings).map_err(internal)?;
    s.save_bans(&body.bans).map_err(internal)?;
    Ok(Json(json!({ "ok": true })))
}

async fn preview(State(app): State<AppState>, Path(id): Path<String>, Json(mut settings): Json<Settings>) -> ApiResult {
    let s = server(&app, &id)?;
    // Show what saving would write; problems like an empty rotation are reported on save
    let _ = args::sanitize(&mut settings);
    Ok(Json(json!({ "text": args::generate(&settings, s.config().port, true) })))
}

#[derive(Default)]
struct TrackInfo {
    dir: Option<String>,
    name: Option<String>,
}

fn read_trackinfo(path: &std::path::Path) -> TrackInfo {
    let mut info = TrackInfo::default();
    for line in fs::read_to_string(path).unwrap_or_default().lines() {
        match line.split_once('=') {
            Some(("dir", v)) => info.dir = Some(v.trim().to_string()),
            Some(("longname", v)) => info.name = Some(v.trim().to_string()),
            _ => {}
        }
    }
    info
}

fn track_file(file: &str) -> ApiResult<String> {
    if args::valid_track_path(file) && !file.contains('/') && file.len() <= 128 {
        Ok(file.to_string())
    } else {
        Err(bad("Track files must be named like mytrack.trackinfo (letters, digits, . _ -)."))
    }
}

// Names of the servers whose rotation includes the file
fn used_by(app: &App, file: &str) -> Vec<String> {
    app.list()
        .iter()
        .filter(|s| s.settings().rotation.iter().any(|t| t.file == file))
        .map(|s| s.config().name)
        .collect()
}

async fn list_tracks(State(app): State<AppState>) -> ApiResult {
    let mut tracks = Vec::new();
    for entry in fs::read_dir(app.data.join("trackinfo")).map_err(internal)?.flatten() {
        let file = entry.file_name().to_string_lossy().into_owned();
        if !file.ends_with(".trackinfo") {
            continue;
        }
        let info = read_trackinfo(&entry.path());
        let name = info.name.unwrap_or_else(|| file.trim_end_matches(".trackinfo").to_string());
        tracks.push(json!({ "file": file, "name": name, "usedBy": used_by(&app, &file) }));
    }
    tracks.sort_by_key(|t| t["name"].as_str().unwrap_or("").to_lowercase());
    Ok(Json(json!(tracks)))
}

async fn download_track(State(app): State<AppState>, Path(file): Path<String>) -> ApiResult<Response> {
    let file = track_file(&file)?;
    let body = fs::read(app.data.join("trackinfo").join(&file)).map_err(|_| not_found("Track"))?;
    Ok(attachment(&file, "text/plain; charset=utf-8", body))
}

async fn upload_track(State(app): State<AppState>, Path(file): Path<String>, body: Bytes) -> ApiResult {
    let file = track_file(&file)?;
    let text = std::str::from_utf8(&body).map_err(|_| bad(format!("{file} isn't a trackinfo file.")))?;
    if !text.lines().any(|l| l.starts_with("dir=")) {
        return Err(bad(format!("{file} isn't a trackinfo file: it has no dir= line.")));
    }
    write_atomic(&app.data.join("trackinfo").join(&file), text).map_err(internal)?;
    Ok(Json(json!({ "file": file })))
}

async fn delete_track(State(app): State<AppState>, Path(file): Path<String>) -> ApiResult {
    let file = track_file(&file)?;
    let users = used_by(&app, &file);
    if !users.is_empty() {
        return Err(ApiError(StatusCode::CONFLICT, format!("Remove it from the tracks of {} first.", users.join(", "))));
    }
    fs::remove_file(app.data.join("trackinfo").join(&file)).map_err(|_| not_found("Track"))?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
struct ResultsQuery {
    server: Option<String>,
}

fn race_id(race: &str) -> ApiResult<&str> {
    if !race.is_empty() && race.len() <= 20 && race.bytes().all(|b| b.is_ascii_digit()) {
        Ok(race)
    } else {
        Err(not_found("Race"))
    }
}

async fn list_results(State(app): State<AppState>, Query(q): Query<ResultsQuery>) -> Json<Value> {
    let mut races = Vec::new();
    for s in app.list() {
        if q.server.as_deref().is_some_and(|id| id != s.id) {
            continue;
        }
        let name = s.config().name;
        let Ok(entries) = fs::read_dir(s.dir.join("results")) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().is_none_or(|e| e != "json") {
                continue;
            }
            let Some(race) = fs::read_to_string(&path).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()) else {
                continue;
            };
            let riders = race["riders"].as_array().cloned().unwrap_or_default();
            races.push(json!({
                "server": s.id,
                "serverName": name,
                "id": race["id"],
                "end": race["end"],
                "track": race["track"],
                "riders": riders.len(),
                "winner": riders.first().map(|r| r["name"].clone()),
                "names": riders.iter().map(|r| r["name"].clone()).collect::<Vec<_>>(),
            }));
        }
    }
    races.sort_by(|a, b| b["end"].as_f64().partial_cmp(&a["end"].as_f64()).unwrap_or(std::cmp::Ordering::Equal));
    Json(json!(races))
}

async fn result(State(app): State<AppState>, Path((id, race)): Path<(String, String)>) -> ApiResult {
    let s = server(&app, &id)?;
    let race = race_id(&race)?;
    let path = s.dir.join("results").join(format!("{race}.json"));
    let text = fs::read_to_string(&path).map_err(|_| not_found("Race"))?;
    let mut value: Value = serde_json::from_str(&text).map_err(internal)?;
    value["server"] = json!(s.id);
    value["serverName"] = json!(s.config().name);
    value["hasDemo"] = json!(path.with_extension("mxdemo").exists());
    Ok(Json(value))
}

async fn result_demo(State(app): State<AppState>, Path((id, race)): Path<(String, String)>) -> ApiResult<Response> {
    let s = server(&app, &id)?;
    let race = race_id(&race)?;
    let body = fs::read(s.dir.join("results").join(format!("{race}.mxdemo"))).map_err(|_| not_found("Demo"))?;
    Ok(attachment(&format!("{}-{race}.mxdemo", s.id), "application/octet-stream", body))
}

fn attachment(name: &str, content_type: &'static str, body: Vec<u8>) -> Response {
    (
        [
            (header::CONTENT_TYPE, content_type.to_string()),
            (header::CONTENT_DISPOSITION, format!("attachment; filename=\"{name}\"")),
        ],
        body,
    )
        .into_response()
}
