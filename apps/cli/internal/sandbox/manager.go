package sandbox

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/daytonaio/daytona/libs/sdk-go/pkg/daytona"
	"github.com/daytonaio/daytona/libs/sdk-go/pkg/types"
)

const (
	homeDir    = "/home/daytona"
	bridgeDir  = "/home/daytona/bridge"
	vsCodePort = 9090
)

// previewLink holds both URL and token from the Daytona preview API.
type previewLink struct {
	URL   string
	Token string
}

// Manager manages Daytona sandboxes and bridge connections.
type Manager struct {
	client       *daytona.Client
	anthropicKey string
	daytonaKey   string
	daytonaURL   string
	bridge       *bridgeConn
}

// NewManager creates a new sandbox manager using the Daytona Go SDK.
func NewManager(anthropicKey, daytonaKey, daytonaURL string) (*Manager, error) {
	if daytonaKey != "" {
		os.Setenv("DAYTONA_API_KEY", daytonaKey)
	}
	if daytonaURL != "" {
		os.Setenv("DAYTONA_API_URL", daytonaURL)
	}

	resolvedKey := daytonaKey
	if resolvedKey == "" {
		resolvedKey = os.Getenv("DAYTONA_API_KEY")
	}
	resolvedURL := daytonaURL
	if resolvedURL == "" {
		resolvedURL = os.Getenv("DAYTONA_API_URL")
	}
	if resolvedURL == "" {
		resolvedURL = "https://app.daytona.io/api"
	}

	client, err := daytona.NewClient()
	if err != nil {
		return nil, fmt.Errorf("daytona client init: %w", err)
	}

	return &Manager{
		client:       client,
		anthropicKey: anthropicKey,
		daytonaKey:   resolvedKey,
		daytonaURL:   resolvedURL,
		bridge:       nil,
	}, nil
}

// CreateSandbox provisions a new Daytona sandbox with bridge installed.
func (m *Manager) CreateSandbox(ctx context.Context, snapshot, projectName, gitRepo string) (string, error) {
	if snapshot == "" {
		snapshot = os.Getenv("DAYTONA_SNAPSHOT")
	}

	sandbox, err := m.client.Create(ctx, types.SnapshotParams{
		Snapshot: snapshot,
	})
	if err != nil {
		return "", fmt.Errorf("create sandbox: %w", err)
	}

	projectDir := homeDir
	if projectName != "" {
		slug := slugify(projectName)
		projectDir = homeDir + "/" + slug
	}

	if err := m.installBridge(ctx, sandbox, projectDir, gitRepo); err != nil {
		sandbox.Delete(ctx)
		return "", fmt.Errorf("install bridge: %w", err)
	}

	return sandbox.ID, nil
}

// DeleteSandbox deletes a sandbox by ID.
func (m *Manager) DeleteSandbox(ctx context.Context, sandboxID string) error {
	m.Close()

	sandbox, err := m.client.Get(ctx, sandboxID)
	if err != nil {
		return fmt.Errorf("get sandbox %s: %w", sandboxID, err)
	}

	if err := sandbox.Delete(ctx); err != nil {
		return fmt.Errorf("delete sandbox %s: %w", sandboxID, err)
	}

	return nil
}

// Connect connects to the bridge running in an existing sandbox.
func (m *Manager) Connect(ctx context.Context, sandboxID string) error {
	m.Close()

	preview, err := m.getPreviewLink(sandboxID, bridgePort)
	if err != nil {
		return fmt.Errorf("get preview link: %w", err)
	}

	wsURL := httpToWS(preview.URL)

	if err := m.connectWithRetry(wsURL, preview.Token, 6); err != nil {
		return fmt.Errorf("connect to bridge: %w", err)
	}

	return nil
}

// SendPrompt sends a prompt to the Claude process in the sandbox.
func (m *Manager) SendPrompt(chatID, prompt, sessionID string) error {
	if m.bridge == nil {
		return fmt.Errorf("not connected to bridge")
	}
	return m.bridge.sendPrompt(chatID, prompt, sessionID)
}

// Messages returns the channel of incoming bridge messages.
func (m *Manager) Messages() <-chan BridgeMessage {
	if m.bridge == nil {
		ch := make(chan BridgeMessage)
		close(ch)
		return ch
	}
	return m.bridge.messages
}

// Done returns a channel that closes when the bridge connection ends.
func (m *Manager) Done() <-chan struct{} {
	if m.bridge == nil {
		ch := make(chan struct{})
		close(ch)
		return ch
	}
	return m.bridge.done
}

// ExecCommand runs a command in the sandbox and returns stdout.
func (m *Manager) ExecCommand(ctx context.Context, sandboxID, command string) (string, error) {
	sbx, err := m.client.Get(ctx, sandboxID)
	if err != nil {
		return "", fmt.Errorf("get sandbox: %w", err)
	}
	resp, err := sbx.Process.ExecuteCommand(ctx, command)
	if err != nil {
		return "", fmt.Errorf("exec command: %w", err)
	}
	return resp.Result, nil
}

// Close closes the bridge connection.
func (m *Manager) Close() {
	if m.bridge != nil {
		m.bridge.close()
		m.bridge = nil
	}
}

// installBridge uploads scripts and starts the bridge in the sandbox.
func (m *Manager) installBridge(ctx context.Context, sandbox *daytona.Sandbox, projectDir, gitRepo string) error {
	exec(ctx, sandbox, fmt.Sprintf("mkdir -p %s", bridgeDir))
	if projectDir != homeDir {
		exec(ctx, sandbox, fmt.Sprintf("mkdir -p %s", projectDir))
	}

	if gitRepo != "" {
		exec(ctx, sandbox, fmt.Sprintf("cd %s && git clone %s . 2>&1 || true", projectDir, gitRepo))
	} else {
		exec(ctx, sandbox, fmt.Sprintf("cd %s && git init 2>&1 || true", projectDir))
	}

	bridgeJS := GenerateBridgeScript(bridgePort, projectDir)
	if err := sandbox.FileSystem.UploadFile(ctx, []byte(bridgeJS), bridgeDir+"/bridge.js"); err != nil {
		return fmt.Errorf("upload bridge.js: %w", err)
	}

	mcpJS := GenerateMCPTerminalScript(bridgePort)
	if err := sandbox.FileSystem.UploadFile(ctx, []byte(mcpJS), bridgeDir+"/mcp-terminal-server.js"); err != nil {
		return fmt.Errorf("upload mcp-terminal-server.js: %w", err)
	}

	mcpConfig, _ := json.Marshal(map[string]interface{}{
		"mcpServers": map[string]interface{}{
			"terminal-server": map[string]interface{}{
				"type":    "stdio",
				"command": "node",
				"args":    []string{bridgeDir + "/mcp-terminal-server.js"},
				"env":     map[string]interface{}{},
			},
		},
	})
	exec(ctx, sandbox, "mkdir -p /home/daytona/.claude")
	// Claude Code reads MCP config from ~/.claude.json (root-level file, NOT ~/.claude/mcp.json)
	if err := sandbox.FileSystem.UploadFile(ctx, mcpConfig, homeDir+"/.claude.json"); err != nil {
		return fmt.Errorf("upload .claude.json: %w", err)
	}

	claudeMd := fmt.Sprintf(`# Sandbox Environment

Your working directory is %s. This IS the project root.
All project files (source code, configs, package.json, etc.) MUST be created
directly in this directory — do NOT create a new subfolder for the app.
When asked to build or create an app, initialize it here in the current directory.

You are running inside a Daytona cloud sandbox. The user CANNOT access localhost URLs.
localhost/127.0.0.1 links will NOT work for the user.

## IMPORTANT: Preview URLs

Whenever you start any HTTP server, dev server, web app, or API on any port,
you MUST use the `+"`get_preview_url`"+` MCP tool to get a publicly accessible URL.

This tool is available in your MCP tools list as `+"`mcp__terminal-server__get_preview_url`"+`.
It is NOT a CLI command — use it through your normal tool-calling interface.

Call it with the port number, e.g.: get_preview_url({ port: 3000 })

NEVER share localhost or 127.0.0.1 URLs with the user. ALWAYS call get_preview_url
and share the returned public URL instead.
`, projectDir)
	if err := sandbox.FileSystem.UploadFile(ctx, []byte(claudeMd), "/home/daytona/.claude/CLAUDE.md"); err != nil {
		return fmt.Errorf("upload CLAUDE.md: %w", err)
	}

	// Only install deps if not already present (snapshot may include them)
	exec(ctx, sandbox, fmt.Sprintf(
		"test -d %s/node_modules/ws || (cd %s && npm init -y 2>&1 && npm install ws node-pty 2>&1)",
		bridgeDir, bridgeDir))

	// Fire-and-forget: the nohup command starts the bridge in the background.
	// The Daytona API blocks until its proxy times out (~30s), so we don't wait.
	bridgeCmd := fmt.Sprintf(
		"cd %s && ANTHROPIC_API_KEY=%q DAYTONA_API_KEY=%q DAYTONA_API_URL=%q DAYTONA_SANDBOX_ID=%q nohup node bridge.js > /tmp/bridge.log 2>&1 &",
		bridgeDir, m.anthropicKey, m.daytonaKey, m.daytonaURL, sandbox.ID,
	)
	go exec(ctx, sandbox, bridgeCmd)

	time.Sleep(3 * time.Second)

	if err := m.connectWithRetryFreshToken(sandbox.ID, bridgePort, 8); err != nil {
		return fmt.Errorf("connect to bridge: %w", err)
	}

	return nil
}

// getPreviewLink calls the Daytona API directly to get both URL and token.
// The Go SDK's GetPreviewLink discards the token, so we call the REST API.
func (m *Manager) getPreviewLink(sandboxID string, port int) (*previewLink, error) {
	url := fmt.Sprintf("%s/sandbox/%s/ports/%d/preview-url", strings.TrimRight(m.daytonaURL, "/"), sandboxID, port)

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+m.daytonaKey)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("API error (HTTP %d): %s", resp.StatusCode, string(body))
	}

	var result struct {
		URL   string `json:"url"`
		Token string `json:"token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}

	return &previewLink{URL: result.URL, Token: result.Token}, nil
}

func (m *Manager) connectWithRetryFreshToken(sandboxID string, port, maxAttempts int) error {
	var lastErr error
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		preview, err := m.getPreviewLink(sandboxID, port)
		if err != nil {
			lastErr = err
		} else {
			wsURL := httpToWS(preview.URL)
			b := newBridgeConn()
			if err := b.connect(wsURL, preview.Token); err == nil {
				if err := b.waitForReady(15 * time.Second); err == nil {
					m.bridge = b
					return nil
				} else {
					b.close()
					lastErr = err
				}
			} else {
				lastErr = err
			}
		}
		if attempt < maxAttempts {
			delay := time.Duration(math.Min(float64(1000*math.Pow(2, float64(attempt-1))), 15000)) * time.Millisecond
			time.Sleep(delay)
		}
	}
	return fmt.Errorf("failed after %d attempts: %w", maxAttempts, lastErr)
}

func (m *Manager) connectWithRetry(wsURL, previewToken string, maxAttempts int) error {
	var lastErr error

	for attempt := 1; attempt <= maxAttempts; attempt++ {
		b := newBridgeConn()
		err := b.connect(wsURL, previewToken)
		if err == nil {
			if err := b.waitForReady(15 * time.Second); err == nil {
				m.bridge = b
				return nil
			} else {
				b.close()
				lastErr = err
			}
		} else {
			lastErr = err
		}

		if attempt < maxAttempts {
			delay := time.Duration(math.Min(float64(1000*math.Pow(2, float64(attempt-1))), 15000)) * time.Millisecond
			time.Sleep(delay)
		}
	}

	return fmt.Errorf("failed after %d attempts: %w", maxAttempts, lastErr)
}

func exec(ctx context.Context, sandbox *daytona.Sandbox, command string) {
	wrapped := "bash -c " + shellQuote(command)
	_, _ = sandbox.Process.ExecuteCommand(ctx, wrapped)
}

func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "'\"'\"'") + "'"
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

var slugRe = regexp.MustCompile(`[^a-z0-9]+`)

func slugify(name string) string {
	s := strings.ToLower(name)
	s = slugRe.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	if s == "" {
		s = "project"
	}
	return s
}
