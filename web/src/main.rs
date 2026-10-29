mod api;
mod args;
mod servers;

use axum::{
    Router,
    extract::{Request, State},
    http::{StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::get,
};
use axum_extra::{
    TypedHeader,
    headers::{Authorization, authorization::Basic},
};
use std::borrow::Cow;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::signal::unix::{SignalKind, signal};

struct Login {
    username: String,
    password: String,
}

// The pages are compiled into the binary; theme.css holds every color and font
macro_rules! asset {
    ($file:literal, $type:literal) => {
        get(|| async {
            (
                [(header::CONTENT_TYPE, $type), (header::CACHE_CONTROL, "no-cache")],
                static_file($file, include_str!(concat!("../static/", $file))),
            )
        })
    };
}

// With MX_STATIC_DIR set (docker-compose.dev.yml), the pages are read from disk on every
// request, so edits show on reload without rebuilding
fn static_file(file: &str, built_in: &'static str) -> Cow<'static, str> {
    let Ok(dir) = std::env::var("MX_STATIC_DIR") else {
        return Cow::Borrowed(built_in);
    };
    match std::fs::read_to_string(Path::new(&dir).join(file)) {
        Ok(text) => Cow::Owned(text),
        Err(e) => {
            eprintln!("Couldn't read {dir}/{file}, serving the built-in copy: {e}");
            Cow::Borrowed(built_in)
        }
    }
}

#[tokio::main]
async fn main() {
    let username = std::env::var("WEB_USERNAME")
        .ok()
        .filter(|u| !u.is_empty())
        .unwrap_or_else(|| "admin".into());
    let password = std::env::var("WEB_PASSWORD").unwrap_or_default();
    if password.is_empty() {
        eprintln!("ERROR: WEB_PASSWORD is not set. Run ./setup.sh to choose a password.");
        std::process::exit(1);
    }
    let login = Arc::new(Login { username, password });

    let data = PathBuf::from(std::env::var("MX_DATA").unwrap_or_else(|_| "/data".into()));
    let ports = std::env::var("MX_PORTS").unwrap_or_else(|_| "19800-19809".into());
    let Some(ports) = ports.split_once('-').and_then(|(a, b)| Some((a.trim().parse().ok()?, b.trim().parse().ok()?))) else {
        eprintln!("ERROR: MX_PORTS must look like 19800-19809, got {ports:?}");
        std::process::exit(1);
    };
    let servers = match servers::App::load(data, ports) {
        Ok(app) => app,
        Err(e) => {
            eprintln!("ERROR: couldn't set up the data folder: {e}");
            std::process::exit(1);
        }
    };
    servers.start_all();

    let port = std::env::var("PORT").unwrap_or_else(|_| "8080".into());
    let addr = format!("0.0.0.0:{port}");

    let app = Router::new()
        .route("/", asset!("index.html", "text/html; charset=utf-8"))
        .route("/settings", asset!("settings.html", "text/html; charset=utf-8"))
        .route("/add", asset!("add.html", "text/html; charset=utf-8"))
        .route("/results", asset!("results.html", "text/html; charset=utf-8"))
        .route("/tracks", asset!("tracks.html", "text/html; charset=utf-8"))
        .route("/theme.css", asset!("theme.css", "text/css; charset=utf-8"))
        .route("/app.css", asset!("app.css", "text/css; charset=utf-8"))
        .route("/common.js", asset!("common.js", "text/javascript; charset=utf-8"))
        .route("/dashboard.js", asset!("dashboard.js", "text/javascript; charset=utf-8"))
        .route("/settings.js", asset!("settings.js", "text/javascript; charset=utf-8"))
        .route("/add.js", asset!("add.js", "text/javascript; charset=utf-8"))
        .route("/results.js", asset!("results.js", "text/javascript; charset=utf-8"))
        .route("/tracks.js", asset!("tracks.js", "text/javascript; charset=utf-8"))
        .merge(api::router(servers.clone()))
        .layer(middleware::from_fn_with_state(login, require_login));

    let listener = TcpListener::bind(&addr).await.expect("failed to bind");
    println!("mxweb listening on http://{addr}");
    if let Ok(dir) = std::env::var("MX_STATIC_DIR") {
        println!("Development mode: serving the pages from {dir}");
    }

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .expect("server error");

    servers.stop_all().await;
}

// The browser shows its own login prompt (HTTP Basic auth)
async fn require_login(
    State(login): State<Arc<Login>>,
    auth: Option<TypedHeader<Authorization<Basic>>>,
    request: Request,
    next: Next,
) -> Response {
    match auth {
        // `&` instead of `&&` so both comparisons always run
        Some(TypedHeader(auth))
            if constant_time_eq(auth.username(), &login.username)
                & constant_time_eq(auth.password(), &login.password) =>
        {
            next.run(request).await
        }
        _ => (
            StatusCode::UNAUTHORIZED,
            [(header::WWW_AUTHENTICATE, r#"Basic realm="MX Simulator Server""#)],
            "Login required",
        )
            .into_response(),
    }
}

// Compares every byte so the response time doesn't reveal how much of a guess was right
fn constant_time_eq(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0, |acc, (x, y)| acc | (x ^ y)) == 0
}

// Docker stops containers with SIGTERM; without this, `docker compose down` waits 10s
async fn shutdown_signal() {
    let mut term = signal(SignalKind::terminate()).expect("failed to install SIGTERM handler");
    tokio::select! {
        _ = term.recv() => {},
        _ = tokio::signal::ctrl_c() => {},
    }
}
