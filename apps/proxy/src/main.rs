mod config;
mod llm;
mod mitm;
mod port_relay;
mod tunnel;
mod tunnel_client;

use config::Config;
use mitm::cert::CertAuthority;
use std::env;
use std::sync::Arc;
use tracing::{error, info, warn};

#[tokio::main]
async fn main() {
    rustls::crypto::ring::default_provider()
        .install_default()
        .expect("failed to install rustls crypto provider");

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "apex_proxy=info".parse().unwrap()),
        )
        .init();

    // Tunnel client mode: if TUNNEL_ENDPOINT_URL is set, run as a tunnel
    // client only (used inside regular Daytona sandboxes alongside the bridge).
    let tunnel_url = env::var("TUNNEL_ENDPOINT_URL").unwrap_or_default();
    if !tunnel_url.is_empty() {
        run_tunnel_client_mode(&tunnel_url).await;
        return;
    }

    // Normal proxy mode
    run_proxy_mode().await;
}

async fn run_tunnel_client_mode(tunnel_url: &str) {
    let tunnel_port: u16 = env::var("TUNNEL_CLIENT_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(9339);

    info!(
        tunnel_port = tunnel_port,
        endpoint = %tunnel_url,
        "starting apex-proxy in tunnel client mode"
    );

    let addr = format!("127.0.0.1:{}", tunnel_port);
    if let Err(e) = tunnel_client::start_tunnel_client(&addr, tunnel_url).await {
        error!(error = %e, "tunnel client failed");
        std::process::exit(1);
    }
}

async fn run_proxy_mode() {
    let config = Arc::new(Config::from_env());

    info!(
        mitm_port = config.mitm_port,
        proxy_port = config.proxy_port,
        port_relay_port = config.port_relay_port,
        secrets_count = config.secrets_count(),
        env_vars_count = config.env_vars_count(),
        total_items = config.total_items_count(),
        "starting apex-proxy"
    );

    let ca = if !config.ca_cert_pem.is_empty() && !config.ca_key_pem.is_empty() {
        match CertAuthority::new(&config.ca_cert_pem, &config.ca_key_pem) {
            Ok(ca) => Some(Arc::new(ca)),
            Err(e) => {
                error!(error = %e, "failed to load CA certificate");
                None
            }
        }
    } else {
        warn!("no CA certificate configured, MITM interception disabled");
        None
    };

    let mut handles = Vec::new();

    if config.mitm_port > 0 {
        if let Some(ref ca) = ca {
            let cfg = config.clone();
            let ca = ca.clone();
            handles.push(tokio::spawn(async move {
                if let Err(e) = mitm::start_mitm_proxy(cfg, ca).await {
                    error!(error = %e, "MITM proxy failed");
                }
            }));
        } else {
            warn!("MITM proxy port configured but no CA — skipping");
        }
    }

    if config.proxy_port > 0 {
        let cfg = config.clone();
        let mitm_port = config.mitm_port;
        handles.push(tokio::spawn(async move {
            if let Err(e) = llm::start_llm_proxy(cfg, mitm_port).await {
                error!(error = %e, "LLM proxy failed");
            }
        }));
    }

    if handles.is_empty() {
        error!("no services enabled — all ports are 0");
        std::process::exit(1);
    }

    for h in handles {
        if let Err(e) = h.await {
            error!(error = %e, "service task panicked");
        }
    }
}
