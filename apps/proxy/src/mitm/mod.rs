pub mod auth;
pub mod cert;

use crate::config::SharedConfig;
use auth::build_auth_header;
use cert::CertAuthority;
use std::sync::Arc;
use tokio::io::{copy_bidirectional, AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio_rustls::TlsAcceptor;
use tracing::{debug, error, info};

pub async fn start_mitm_proxy(
    config: SharedConfig,
    ca: Arc<CertAuthority>,
) -> Result<(), Box<dyn std::error::Error>> {
    let addr: std::net::SocketAddr = format!("{}:{}", config.mitm_host, config.mitm_port).parse()?;
    let socket = socket2::Socket::new(socket2::Domain::IPV4, socket2::Type::STREAM, None)?;
    socket.set_reuse_address(true)?;
    socket.bind(&addr.into())?;
    socket.listen(1024)?;
    socket.set_nonblocking(true)?;
    let listener = TcpListener::from_std(std::net::TcpListener::from(socket))?;
    info!(addr = %addr, "MITM proxy listening");

    loop {
        let (stream, peer) = listener.accept().await?;
        let config = config.clone();
        let ca = ca.clone();
        tokio::spawn(async move {
            if let Err(e) = handle_connection(stream, config, ca).await {
                error!(peer = %peer, error = %e, "connection error");
            }
        });
    }
}

async fn handle_connection(
    mut stream: TcpStream,
    config: SharedConfig,
    ca: Arc<CertAuthority>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut buf = vec![0u8; 8192];
    let n = stream.read(&mut buf).await?;
    if n == 0 {
        return Ok(());
    }

    let mut headers = [httparse::EMPTY_HEADER; 32];
    let mut req = httparse::Request::new(&mut headers);
    let status = req.parse(&buf[..n])?;

    let method = req.method.unwrap_or("GET");
    let path = req.path.unwrap_or("/");

    if method.eq_ignore_ascii_case("CONNECT") {
        handle_connect(&mut stream, path, &buf[..n], status, config, ca).await
    } else if path == "/internal/reload-secrets" && method.eq_ignore_ascii_case("POST") {
        handle_reload_secrets(&mut stream, &buf[..n], config).await
    } else {
        handle_http_proxy(&mut stream, method, path, &buf[..n], config).await
    }
}

async fn handle_connect(
    client: &mut TcpStream,
    target: &str,
    raw: &[u8],
    _status: httparse::Status<usize>,
    config: SharedConfig,
    ca: Arc<CertAuthority>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let (host, port) = parse_host_port(target)?;

    // Extract context from CONNECT headers if present
    let context = RequestContext::from_headers(raw);
    
    let secret = config.resolve_secret_with_context(
        &host, 
        context.repository_id.as_deref(), 
        context.project_id.as_deref()
    );

    if let Some(ref secret) = secret {
        debug!(
            host = %host, 
            context = %context.description(),
            secret_id = %secret.id,
            auth_type = %secret.auth_type,
            "MITM CONNECT - intercepting with secret"
        );
        client
            .write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n")
            .await?;

        let tls_config = match ca.get_tls_config(&host) {
            Ok(c) => c,
            Err(e) => {
                error!(host = %host, error = %e, "TLS config generation failed");
                return Err(e);
            }
        };
        let acceptor = TlsAcceptor::from(tls_config);
        let mut tls_stream = match acceptor.accept(client).await {
            Ok(s) => s,
            Err(e) => {
                error!(host = %host, error = %e, "TLS accept failed");
                return Err(e.into());
            }
        };

        if let Err(e) = handle_mitm_request(&mut tls_stream, &host, port, secret).await {
            error!(host = %host, error = %e, "MITM request failed");
            let _ = tls_stream
                .write_all(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n")
                .await;
            let _ = tls_stream.shutdown().await;
        }
    } else {
        debug!(
            host = %host, 
            context = %context.description(),
            "transparent CONNECT - no secret configured"
        );
        let mut upstream = TcpStream::connect(format!("{}:{}", host, port)).await?;
        client
            .write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n")
            .await?;
        copy_bidirectional(client, &mut upstream).await?;
    }

    Ok(())
}

async fn handle_mitm_request(
    tls_stream: &mut tokio_rustls::server::TlsStream<&mut TcpStream>,
    host: &str,
    port: u16,
    secret: &crate::config::Secret,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut buf = vec![0u8; 65536];
    let mut total = 0;

    // Read until we have complete headers
    loop {
        let n = tls_stream.read(&mut buf[total..]).await?;
        if n == 0 {
            return Ok(());
        }
        total += n;
        if buf[..total].windows(4).any(|w| w == b"\r\n\r\n") {
            break;
        }
        if total >= buf.len() {
            break;
        }
    }

    let header_end = buf[..total]
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .ok_or("incomplete HTTP headers")?;

    // Parse headers into owned strings before borrowing buf mutably for body read
    let (method, path, headers, content_length) = {
        let header_str = std::str::from_utf8(&buf[..header_end])?;
        let mut lines = header_str.lines();
        let first_line = lines.next().unwrap_or("GET / HTTP/1.1");
        let parts: Vec<&str> = first_line.splitn(3, ' ').collect();
        let method = parts.first().copied().unwrap_or("GET").to_string();
        let path = parts.get(1).copied().unwrap_or("/").to_string();

        let mut headers = Vec::new();
        for line in lines {
            if let Some(colon) = line.find(':') {
                let name = line[..colon].trim().to_lowercase();
                let value = line[colon + 1..].trim().to_string();
                headers.push((name, value));
            }
        }

        let content_length: usize = headers
            .iter()
            .find(|(n, _)| n == "content-length")
            .and_then(|(_, v)| v.parse().ok())
            .unwrap_or(0);

        (method, path, headers, content_length)
    };

    let body_start = header_end + 4;

    let mut body = Vec::new();
    if content_length > 0 {
        body.extend_from_slice(&buf[body_start..total]);
        while body.len() < content_length {
            let n = tls_stream.read(&mut buf).await?;
            if n == 0 {
                break;
            }
            body.extend_from_slice(&buf[..n]);
        }
    }

    forward_request(tls_stream, host, port, &method, &path, &headers, &body, secret).await
}

async fn forward_request(
    client: &mut tokio_rustls::server::TlsStream<&mut TcpStream>,
    host: &str,
    port: u16,
    method: &str,
    path: &str,
    original_headers: &[(String, String)],
    body: &[u8],
    secret: &crate::config::Secret,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let auth = build_auth_header(secret);

    let url = format!("https://{}:{}{}", host, port, path);
    let http_client = reqwest::Client::builder()
        .build()?;

    let mut req_builder = http_client.request(
        reqwest::Method::from_bytes(method.as_bytes())?,
        &url,
    );

    for (name, value) in original_headers {
        match name.as_str() {
            "connection" | "proxy-connection" | "proxy-authorization" | "authorization"
            | "x-api-key" | "host" => continue,
            _ => {
                req_builder = req_builder.header(name.as_str(), value.as_str());
            }
        }
    }

    req_builder = req_builder.header("host", host);
    req_builder = req_builder.header(&auth.name, &auth.value);

    if !body.is_empty() {
        req_builder = req_builder.body(body.to_vec());
    }

    let upstream_res = req_builder.send().await?;
    let status = upstream_res.status();
    let status_text = status.canonical_reason().unwrap_or("");

    let mut response_headers = String::new();
    let skip_headers: std::collections::HashSet<&str> =
        ["transfer-encoding", "content-length", "connection"].iter().copied().collect();

    for (name, value) in upstream_res.headers() {
        if !skip_headers.contains(name.as_str()) {
            response_headers.push_str(&format!("{}: {}\r\n", name, value.to_str().unwrap_or("")));
        }
    }

    let resp_body = upstream_res.bytes().await?;

    let head = format!(
        "HTTP/1.1 {} {}\r\n{}content-length: {}\r\n\r\n",
        status.as_u16(),
        status_text,
        response_headers,
        resp_body.len(),
    );

    client.write_all(head.as_bytes()).await?;
    client.write_all(&resp_body).await?;
    client.shutdown().await?;

    Ok(())
}

async fn handle_http_proxy(
    client: &mut TcpStream,
    method: &str,
    url: &str,
    raw: &[u8],
    config: SharedConfig,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let parsed = match url::Url::parse(url) {
        Ok(u) => u,
        Err(_) => {
            client
                .write_all(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n")
                .await?;
            return Ok(());
        }
    };

    let hostname = parsed.host_str().unwrap_or("");
    
    // Extract context from HTTP headers if present
    let context = RequestContext::from_headers(raw);
    
    let secret = config.resolve_secret_with_context(
        hostname,
        context.repository_id.as_deref(),
        context.project_id.as_deref()
    );

    if secret.is_none() {
        debug!(
            hostname = %hostname,
            context = %context.description(),
            "HTTP proxy - no secret configured"
        );
        client
            .write_all(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n")
            .await?;
        return Ok(());
    }
    let secret = secret.unwrap();
    
    debug!(
        hostname = %hostname,
        context = %context.description(),
        secret_id = %secret.id,
        auth_type = %secret.auth_type,
        method = %method,
        "HTTP proxy - forwarding with secret"
    );

    let header_end = raw
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .unwrap_or(raw.len());
    let header_str = std::str::from_utf8(&raw[..header_end])?;
    let mut lines = header_str.lines();
    lines.next(); // skip request line

    let mut headers = Vec::new();
    for line in lines {
        if let Some(colon) = line.find(':') {
            let name = line[..colon].trim().to_lowercase();
            let value = line[colon + 1..].trim().to_string();
            headers.push((name, value));
        }
    }

    let content_length: usize = headers
        .iter()
        .find(|(n, _)| n == "content-length")
        .and_then(|(_, v)| v.parse().ok())
        .unwrap_or(0);

    let body_start = header_end + 4;
    let body = if body_start < raw.len() && content_length > 0 {
        raw[body_start..].to_vec()
    } else {
        Vec::new()
    };

    let auth = build_auth_header(&secret);
    let port_num = parsed.port().unwrap_or(if parsed.scheme() == "https" { 443 } else { 80 });
    let req_url = format!(
        "{}://{}:{}{}{}",
        parsed.scheme(),
        hostname,
        port_num,
        parsed.path(),
        parsed.query().map(|q| format!("?{}", q)).unwrap_or_default()
    );

    let http_client = reqwest::Client::new();
    let mut req_builder = http_client.request(
        reqwest::Method::from_bytes(method.as_bytes())?,
        &req_url,
    );

    for (name, value) in &headers {
        match name.as_str() {
            "proxy-connection" | "proxy-authorization" | "authorization" | "x-api-key" => continue,
            _ => {
                req_builder = req_builder.header(name.as_str(), value.as_str());
            }
        }
    }

    req_builder = req_builder.header("host", hostname);
    req_builder = req_builder.header(&auth.name, &auth.value);

    if !body.is_empty() {
        req_builder = req_builder.body(body);
    }

    match req_builder.send().await {
        Ok(resp) => {
            let status = resp.status();
            let mut resp_headers = String::new();
            for (name, value) in resp.headers() {
                let n = name.as_str();
                if n != "transfer-encoding" && n != "content-length" && n != "connection" {
                    resp_headers.push_str(&format!("{}: {}\r\n", name, value.to_str().unwrap_or("")));
                }
            }
            let resp_body = resp.bytes().await?;
            let head = format!(
                "HTTP/1.1 {} {}\r\n{}content-length: {}\r\n\r\n",
                status.as_u16(),
                status.canonical_reason().unwrap_or(""),
                resp_headers,
                resp_body.len(),
            );
            client.write_all(head.as_bytes()).await?;
            client.write_all(&resp_body).await?;
        }
        Err(e) => {
            error!(error = %e, "upstream error");
            client
                .write_all(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n")
                .await?;
        }
    }

    Ok(())
}

async fn handle_reload_secrets(
    client: &mut TcpStream,
    raw: &[u8],
    config: SharedConfig,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let header_end = raw
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .unwrap_or(raw.len());

    let header_str = std::str::from_utf8(&raw[..header_end])?;
    let content_length: usize = header_str
        .lines()
        .find_map(|l| {
            let lower = l.to_lowercase();
            if lower.starts_with("content-length:") {
                lower["content-length:".len()..].trim().parse().ok()
            } else {
                None
            }
        })
        .unwrap_or(0);

    let body_start = header_end + 4;
    let mut body = Vec::new();
    if body_start < raw.len() {
        body.extend_from_slice(&raw[body_start..]);
    }
    while body.len() < content_length {
        let mut buf = vec![0u8; 8192];
        let n = client.read(&mut buf).await?;
        if n == 0 {
            break;
        }
        body.extend_from_slice(&buf[..n]);
    }

    // Support both formats: plain array (legacy) and object with optional github_token and context
    #[derive(serde::Deserialize)]
    struct ReloadPayload {
        secrets: Vec<crate::config::Secret>,
        github_token: Option<String>,
        repository_id: Option<String>,
        project_id: Option<String>,
    }

    let (new_secrets, github_token, context_updated) =
        if let Ok(payload) = serde_json::from_slice::<ReloadPayload>(&body) {
            let context_updated = payload.repository_id.is_some() || payload.project_id.is_some();
            if context_updated {
                config.update_context(payload.repository_id, payload.project_id);
            }
            (payload.secrets, payload.github_token, context_updated)
        } else {
            let secrets: Vec<crate::config::Secret> = serde_json::from_slice(&body)?;
            (secrets, None, false)
        };

    let total_count = new_secrets.len();
    let secrets_count = new_secrets.iter().filter(|s| s.is_secret).count();
    let env_vars_count = new_secrets.iter().filter(|s| !s.is_secret).count();
    let token_updated = github_token.is_some();
    
    config.reload_secrets(new_secrets, github_token);
    
    info!(
        total_items = total_count,
        secrets_count = secrets_count, 
        env_vars_count = env_vars_count,
        token_updated = token_updated, 
        context_updated = context_updated,
        "secrets and environment variables reloaded"
    );

    let resp = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
        format!(r#"{{"ok":true,"total_count":{},"secrets_count":{},"env_vars_count":{}}}"#, total_count, secrets_count, env_vars_count).len(),
        format!(r#"{{"ok":true,"total_count":{},"secrets_count":{},"env_vars_count":{}}}"#, total_count, secrets_count, env_vars_count),
    );
    client.write_all(resp.as_bytes()).await?;
    Ok(())
}

fn parse_host_port(target: &str) -> Result<(String, u16), Box<dyn std::error::Error + Send + Sync>> {
    if let Some(colon) = target.rfind(':') {
        let host = target[..colon].to_string();
        let port: u16 = target[colon + 1..].parse().unwrap_or(443);
        Ok((host, port))
    } else {
        Ok((target.to_string(), 443))
    }
}

/// Context extracted from HTTP headers for repository-scoped secret resolution.
#[derive(Debug, Clone)]
pub struct RequestContext {
    pub repository_id: Option<String>,
    pub project_id: Option<String>,
}

impl RequestContext {
    pub fn from_headers(raw: &[u8]) -> Self {
        let header_str = match std::str::from_utf8(raw) {
            Ok(s) => s,
            Err(_) => return Self { repository_id: None, project_id: None },
        };
        
        let mut repository_id = None;
        let mut project_id = None;
        
        for line in header_str.lines() {
            if let Some(colon) = line.find(':') {
                let name = line[..colon].trim().to_lowercase();
                let value = line[colon + 1..].trim();
                
                match name.as_str() {
                    "x-proxy-repository-id" => {
                        if !value.is_empty() {
                            repository_id = Some(value.to_string());
                        }
                    }
                    "x-proxy-project-id" => {
                        if !value.is_empty() {
                            project_id = Some(value.to_string());
                        }
                    }
                    _ => {}
                }
            }
        }
        
        Self { repository_id, project_id }
    }
    
    pub fn is_empty(&self) -> bool {
        self.repository_id.is_none() && self.project_id.is_none()
    }
    
    pub fn description(&self) -> String {
        match (&self.repository_id, &self.project_id) {
            (Some(repo), Some(proj)) => format!("repo:{}, project:{}", repo, proj),
            (Some(repo), None) => format!("repo:{}", repo),
            (None, Some(proj)) => format!("project:{}", proj),
            (None, None) => "global".to_string(),
        }
    }
}


