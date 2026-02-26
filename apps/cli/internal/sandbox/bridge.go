package sandbox

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// BridgeMessage represents a message from the bridge running inside the sandbox.
type BridgeMessage struct {
	Type   string          `json:"type"`
	ChatID string          `json:"chatId,omitempty"`
	Data   json.RawMessage `json:"data,omitempty"`
	Code   *int            `json:"code,omitempty"`
	Error  string          `json:"error,omitempty"`
	Port   int             `json:"port,omitempty"`
}

// bridgeConn manages the WebSocket connection to the bridge.
type bridgeConn struct {
	conn     *websocket.Conn
	mu       sync.Mutex
	messages chan BridgeMessage
	done     chan struct{}
}

func newBridgeConn() *bridgeConn {
	return &bridgeConn{
		messages: make(chan BridgeMessage, 256),
		done:     make(chan struct{}),
	}
}

// connect establishes a WebSocket connection to the bridge.
func (b *bridgeConn) connect(wsURL, previewToken string) error {
	header := http.Header{
		"X-Daytona-Skip-Preview-Warning": []string{"true"},
	}
	if previewToken != "" {
		header.Set("x-daytona-preview-token", previewToken)
	}

	dialer := websocket.Dialer{
		HandshakeTimeout: 15 * time.Second,
	}

	conn, resp, err := dialer.Dial(wsURL, header)
	if err != nil {
		detail := ""
		if resp != nil {
			detail = fmt.Sprintf(" (HTTP %d)", resp.StatusCode)
		}
		return fmt.Errorf("bridge dial %s%s: %w", wsURL, detail, err)
	}

	b.conn = conn
	go b.readLoop()
	go b.pingLoop()

	return nil
}

// waitForReady waits for the bridge_ready message with a timeout.
func (b *bridgeConn) waitForReady(timeout time.Duration) error {
	timer := time.NewTimer(timeout)
	defer timer.Stop()

	for {
		select {
		case msg := <-b.messages:
			if msg.Type == "bridge_ready" {
				return nil
			}
			// put non-ready messages back
			b.messages <- msg
		case <-timer.C:
			return fmt.Errorf("timeout waiting for bridge_ready (%s)", timeout)
		case <-b.done:
			return fmt.Errorf("connection closed while waiting for bridge_ready")
		}
	}
}

// send sends a JSON message to the bridge.
func (b *bridgeConn) send(v interface{}) error {
	b.mu.Lock()
	defer b.mu.Unlock()

	if b.conn == nil {
		return fmt.Errorf("not connected to bridge")
	}

	return b.conn.WriteJSON(v)
}

// sendPrompt sends a start_claude message to the bridge.
func (b *bridgeConn) sendPrompt(chatID, prompt, sessionID string) error {
	msg := map[string]interface{}{
		"type":   "start_claude",
		"prompt": prompt,
		"chatId": chatID,
	}
	if sessionID != "" {
		msg["sessionId"] = sessionID
	}
	return b.send(msg)
}

// sendUserAnswer sends a claude_user_answer message to the bridge.
func (b *bridgeConn) sendUserAnswer(chatID, toolUseID, answer string) error {
	return b.send(map[string]interface{}{
		"type":      "claude_user_answer",
		"chatId":    chatID,
		"toolUseId": toolUseID,
		"answer":    answer,
	})
}

// close closes the bridge connection.
func (b *bridgeConn) close() {
	select {
	case <-b.done:
	default:
		close(b.done)
	}

	b.mu.Lock()
	defer b.mu.Unlock()

	if b.conn != nil {
		b.conn.WriteMessage(
			websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""),
		)
		b.conn.Close()
		b.conn = nil
	}
}

func (b *bridgeConn) readLoop() {
	defer func() {
		select {
		case <-b.done:
		default:
			close(b.done)
		}
	}()

	for {
		_, data, err := b.conn.ReadMessage()
		if err != nil {
			select {
			case <-b.done:
			default:
			}
			return
		}

		var msg BridgeMessage
		if err := json.Unmarshal(data, &msg); err != nil {
			continue
		}

		select {
		case b.messages <- msg:
		default:
			// channel full, drop oldest
			<-b.messages
			b.messages <- msg
		}
	}
}

func (b *bridgeConn) pingLoop() {
	ticker := time.NewTicker(25 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-b.done:
			return
		case <-ticker.C:
			b.send(map[string]string{"type": "ping"})
		}
	}
}

// httpToWS converts an HTTP(S) URL to a WS(S) URL.
func httpToWS(rawURL string) string {
	s := strings.Replace(rawURL, "https://", "wss://", 1)
	s = strings.Replace(s, "http://", "ws://", 1)
	return s
}
