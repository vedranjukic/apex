use crate::config::SharedConfig;
use bytes::Bytes;
use http_body_util::{BodyExt, Full};
use hyper::body::Incoming;
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use std::convert::Infallible;
use tokio::net::TcpListener;
use tracing::{debug, error, info};

use crate::tunnel;
use crate::port_relay;

type BoxBody = http_body_util::Full<Bytes>;

fn json_response(status: StatusCode, body: &str) -> Response<BoxBody> {
    Response::builder()
        .status(status)
        .header("content-type", "application/json")
        .body(Full::new(Bytes::from(body.to_string())))
        .unwrap()
}

pub async fn start_llm_proxy(
    config: SharedConfig,
    mitm_port: u16,
) -> Result<(), Box<dyn std::error::Error>> {
    let addr = format!("0.0.0.0:{}", config.proxy_port);
    let listener = TcpListener::bind(&addr).await?;
    info!(addr = %addr, "LLM proxy + tunnel listening");

    loop {
        let (stream, _peer) = listener.accept().await?;
        let io = TokioIo::new(stream);
        let config = config.clone();

        tokio::spawn(async move {
            let svc = service_fn(move |req| {
                let config = config.clone();
                async move {
                    handle_request(req, config, mitm_port).await
                }
            });

            if let Err(e) = http1::Builder::new()
                .serve_connection(io, svc)
                .with_upgrades()
                .await
            {
                debug!(error = %e, "HTTP connection error");
            }
        });
    }
}

async fn handle_request(
    req: Request<Incoming>,
    config: SharedConfig,
    mitm_port: u16,
) -> Result<Response<BoxBody>, Infallible> {
    let path = req.uri().path().to_string();

    if path == "/health" || path == "/health/" {
        return Ok(json_response(
            StatusCode::OK,
            r#"{"status":"ok","services":{"llm_proxy":"running","mitm_proxy":"running","tunnel_bridge":"running","port_relay_bridge":"running"}}"#,
        ));
    }

    // WebSocket upgrade for /tunnel
    if path == "/tunnel" {
        return Ok(tunnel::handle_tunnel_upgrade(req, mitm_port));
    }

    // WebSocket upgrade for /port-relay/:port
    if path.starts_with("/port-relay/") {
        let port_str = &path["/port-relay/".len()..];
        let target_port: u16 = port_str.parse().unwrap_or(0);
        if target_port == 0 {
            return Ok(json_response(StatusCode::BAD_REQUEST, r#"{"error":"Invalid port"}"#));
        }
        return Ok(port_relay::handle_port_relay_upgrade(req, target_port));
    }

    // LLM proxy routes: /llm-proxy/(anthropic|openai)/*
    if let Some(rest) = path.strip_prefix("/llm-proxy/") {
        let slash_pos = rest.find('/').unwrap_or(rest.len());
        let provider = &rest[..slash_pos];
        let subpath = if slash_pos < rest.len() {
            &rest[slash_pos..]
        } else {
            "/"
        };

        return Ok(handle_llm_proxy(req, &config, provider, subpath).await);
    }

    Ok(json_response(StatusCode::NOT_FOUND, r#"{"error":"Not found"}"#))
}

#[derive(Clone, Copy)]
enum LlmProvider {
    Anthropic,
    OpenAi,
}

async fn handle_llm_proxy(
    req: Request<Incoming>,
    config: &SharedConfig,
    provider_str: &str,
    subpath: &str,
) -> Response<BoxBody> {
    let provider = match provider_str {
        "anthropic" => LlmProvider::Anthropic,
        "openai" => LlmProvider::OpenAi,
        _ => {
            return json_response(
                StatusCode::BAD_REQUEST,
                &format!(r#"{{"error":"Unknown provider: {}"}}"#, provider_str),
            );
        }
    };

    let (upstream_base, real_key) = match provider {
        LlmProvider::Anthropic => ("https://api.anthropic.com", config.anthropic_key.as_str()),
        LlmProvider::OpenAi => ("https://api.openai.com", config.openai_key.as_str()),
    };

    let token = match provider {
        LlmProvider::Anthropic => req
            .headers()
            .get("x-api-key")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string(),
        LlmProvider::OpenAi => {
            let auth = req
                .headers()
                .get("authorization")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("");
            auth.strip_prefix("Bearer ").unwrap_or("").to_string()
        }
    };

    if config.proxy_auth_token.is_empty() || token != config.proxy_auth_token {
        return json_response(StatusCode::UNAUTHORIZED, r#"{"error":"Unauthorized"}"#);
    }

    if real_key.is_empty() {
        return json_response(
            StatusCode::BAD_GATEWAY,
            &format!(r#"{{"error":"No API key configured for {}"}}"#, provider_str),
        );
    }

    let query = req.uri().query().map(|q| format!("?{}", q)).unwrap_or_default();
    let target_url = format!("{}{}{}", upstream_base, subpath, query);
    let method = req.method().clone();

    let mut fwd_headers = reqwest::header::HeaderMap::new();
    for (name, value) in req.headers() {
        if name == "host" || name == "connection" || name == "accept-encoding" {
            continue;
        }
        if let Ok(v) = reqwest::header::HeaderValue::from_bytes(value.as_bytes()) {
            if let Ok(n) = reqwest::header::HeaderName::from_bytes(name.as_ref()) {
                fwd_headers.insert(n, v);
            }
        }
    }

    match provider {
        LlmProvider::Anthropic => {
            fwd_headers.insert("x-api-key", real_key.parse().unwrap());
            fwd_headers.remove("authorization");
        }
        LlmProvider::OpenAi => {
            fwd_headers.insert(
                "authorization",
                format!("Bearer {}", real_key).parse().unwrap(),
            );
            fwd_headers.remove("x-api-key");
        }
    }

    let body_bytes = match req.collect().await {
        Ok(b) => b.to_bytes(),
        Err(e) => {
            error!(error = %e, "failed to read request body");
            return json_response(StatusCode::BAD_REQUEST, r#"{"error":"Failed to read body"}"#);
        }
    };

    let client = reqwest::Client::new();
    let mut req_builder = client
        .request(
            reqwest::Method::from_bytes(method.as_str().as_bytes()).unwrap_or(reqwest::Method::GET),
            &target_url,
        )
        .headers(fwd_headers);

    if !body_bytes.is_empty() {
        req_builder = req_builder.body(body_bytes.to_vec());
    }

    match req_builder.send().await {
        Ok(resp) => {
            let status = resp.status();
            info!(provider = provider_str, status = status.as_u16(), "LLM proxy upstream");

            let mut builder = Response::builder().status(status.as_u16());
            let skip = ["transfer-encoding", "content-encoding", "connection"];
            for (name, value) in resp.headers() {
                if !skip.contains(&name.as_str()) {
                    builder = builder.header(name.as_str(), value.as_bytes());
                }
            }
            let resp_body = resp.bytes().await.unwrap_or_default();
            builder
                .body(Full::new(resp_body))
                .unwrap_or_else(|_| json_response(StatusCode::INTERNAL_SERVER_ERROR, r#"{"error":"response build failed"}"#))
        }
        Err(e) => {
            error!(error = %e, "LLM proxy upstream error");
            json_response(
                StatusCode::BAD_GATEWAY,
                &format!(r#"{{"error":"Upstream error: {}"}}"#, e),
            )
        }
    }
}
