use axum::{
    Router,
    extract::{Request, State},
    http::{StatusCode, header},
    middleware::{self, Next},
    response::{Html, IntoResponse, Response},
    routing::get,
};
use axum_extra::{
    TypedHeader,
    headers::{Authorization, authorization::Basic},
};
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::signal::unix::{SignalKind, signal};

struct Login {
    username: String,
    password: String,
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

    let port = std::env::var("PORT").unwrap_or_else(|_| "8080".into());
    let addr = format!("0.0.0.0:{port}");

    let app = Router::new()
        .route("/", get(index))
        .layer(middleware::from_fn_with_state(login, require_login));

    let listener = TcpListener::bind(&addr).await.expect("failed to bind");
    println!("mxweb listening on http://{addr}");

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .expect("server error");
}

async fn index() -> Html<&'static str> {
    Html("<!doctype html><title>MX Simulator Server</title><h1>Hello world</h1>")
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
