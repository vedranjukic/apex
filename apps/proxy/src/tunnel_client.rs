use bytes::Bytes;
use futures_util::{SinkExt, StreamExt};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::tungstenite::Message;
use tracing::{debug, error, info};

/// Run a TCP-to-WebSocket tunnel client.
/// Listens on `listen_addr` for TCP connections, and for each one opens a
/// WebSocket to `ws_endpoint_url` and bridges bytes bidirectionally.
pub async fn start_tunnel_client(
    listen_addr: &str,
    ws_endpoint_url: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let listener = TcpListener::bind(listen_addr).await?;
    // Convert https:// to wss:// and http:// to ws:// for WebSocket
    let ws_url = ws_endpoint_url
        .replacen("https://", "wss://", 1)
        .replacen("http://", "ws://", 1);
    info!(addr = %listen_addr, endpoint = %ws_url, "tunnel client listening");

    loop {
        let (tcp_stream, peer) = listener.accept().await?;
        let url = ws_url.clone();
        tokio::spawn(async move {
            if let Err(e) = handle_tunnel_connection(tcp_stream, &url).await {
                debug!(peer = %peer, error = %e, "tunnel client connection error");
            }
        });
    }
}

async fn handle_tunnel_connection(
    mut tcp_stream: TcpStream,
    ws_url: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let (ws_stream, response) = match tokio_tungstenite::connect_async(ws_url).await {
        Ok(r) => r,
        Err(e) => {
            error!(url = %ws_url, error = %e, "WebSocket connect failed");
            return Err(e.into());
        }
    };
    debug!(status = %response.status(), "tunnel WebSocket connected");

    let (mut ws_sink, mut ws_rx) = ws_stream.split();
    let (mut tcp_read, mut tcp_write) = tcp_stream.split();

    let tcp_to_ws = async {
        let mut buf = vec![0u8; 65536];
        loop {
            match tcp_read.read(&mut buf).await {
                Ok(0) => break,
                Ok(n) => {
                    if ws_sink
                        .send(Message::Binary(Bytes::copy_from_slice(&buf[..n])))
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    };

    let ws_to_tcp = async {
        while let Some(msg) = ws_rx.next().await {
            match msg {
                Ok(Message::Binary(data)) => {
                    if tcp_write.write_all(&data).await.is_err() {
                        break;
                    }
                }
                Ok(Message::Close(_)) | Err(_) => break,
                _ => {}
            }
        }
    };

    tokio::select! {
        _ = tcp_to_ws => {},
        _ = ws_to_tcp => {},
    }

    debug!("tunnel client connection closed");
    Ok(())
}

/// Run a port relay client for a specific port.
/// Listens on a local port and forwards each connection to a WebSocket
/// endpoint at `{base_url}/port-relay/{target_port}`.
#[allow(dead_code)]
pub async fn start_port_relay_client(
    listen_port: u16,
    target_port: u16,
    ws_base_url: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let addr = format!("127.0.0.1:{}", listen_port);
    let listener = TcpListener::bind(&addr).await?;
    let ws_url = format!(
        "{}/port-relay/{}",
        ws_base_url.trim_end_matches('/'),
        target_port
    );
    info!(
        listen = %addr,
        target = target_port,
        endpoint = %ws_url,
        "port relay client listening"
    );

    loop {
        let (tcp_stream, peer) = listener.accept().await?;
        let url = ws_url.clone();
        tokio::spawn(async move {
            if let Err(e) = handle_tunnel_connection(tcp_stream, &url).await {
                debug!(peer = %peer, error = %e, "port relay client connection error");
            }
        });
    }
}
