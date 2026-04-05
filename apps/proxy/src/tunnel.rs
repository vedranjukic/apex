use bytes::Bytes;
use futures_util::{SinkExt, StreamExt};
use http_body_util::Full;
use hyper::body::Incoming;
use hyper::{Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::handshake::derive_accept_key;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::WebSocketStream;
use tracing::{debug, error, info};

type BoxBody = Full<Bytes>;

pub fn handle_tunnel_upgrade(req: Request<Incoming>, mitm_port: u16) -> Response<BoxBody> {
    let key = match req.headers().get("sec-websocket-key") {
        Some(k) => k.to_str().unwrap_or("").to_string(),
        None => {
            return Response::builder()
                .status(StatusCode::BAD_REQUEST)
                .body(Full::new(Bytes::from("Missing Sec-WebSocket-Key")))
                .unwrap();
        }
    };

    let accept = derive_accept_key(key.as_bytes());

    tokio::spawn(async move {
        match hyper::upgrade::on(req).await {
            Ok(upgraded) => {
                let io = TokioIo::new(upgraded);
                let ws = WebSocketStream::from_raw_socket(
                    io,
                    tokio_tungstenite::tungstenite::protocol::Role::Server,
                    None,
                )
                .await;
                handle_tunnel_connection(ws, mitm_port).await;
            }
            Err(e) => {
                error!(error = %e, "tunnel upgrade failed");
            }
        }
    });

    Response::builder()
        .status(StatusCode::SWITCHING_PROTOCOLS)
        .header("upgrade", "websocket")
        .header("connection", "Upgrade")
        .header("sec-websocket-accept", accept)
        .body(Full::new(Bytes::new()))
        .unwrap()
}

async fn handle_tunnel_connection<S>(ws_stream: WebSocketStream<S>, mitm_port: u16)
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
{
    info!("new tunnel connection");

    let mut tcp = match TcpStream::connect(format!("127.0.0.1:{}", mitm_port)).await {
        Ok(s) => s,
        Err(e) => {
            error!(error = %e, "failed to connect to MITM proxy");
            return;
        }
    };

    let (mut ws_sink, mut ws_stream_rx) = ws_stream.split();
    let (mut tcp_read, mut tcp_write) = tcp.split();

    let ws_to_tcp = async {
        while let Some(msg) = ws_stream_rx.next().await {
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

    tokio::select! {
        _ = ws_to_tcp => {},
        _ = tcp_to_ws => {},
    }

    debug!("tunnel connection closed");
}
