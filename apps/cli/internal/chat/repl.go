package chat

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/briandowns/spinner"
	"github.com/chzyer/readline"
	"github.com/apex/cli/internal/db"
	"github.com/apex/cli/internal/sandbox"
	"github.com/apex/cli/internal/types"
	"github.com/fatih/color"
)

// REPL manages the interactive chat session.
type REPL struct {
	database  *db.DB
	manager   *sandbox.Manager
	projectID string
	project   *types.Project

	activeChatID    string
	activeSessionID string
	activeModel     string
	isNewChat       bool

	lastCost *types.ClaudeOutput

	mu        sync.Mutex
	streaming bool
	spin      *spinner.Spinner
	rl        *readline.Instance
}

// NewREPL creates a new REPL instance.
func NewREPL(database *db.DB, manager *sandbox.Manager, projectID string, project *types.Project) *REPL {
	return &REPL{
		database:  database,
		manager:   manager,
		projectID: projectID,
		project:   project,
		isNewChat: true,
	}
}

// Run starts the interactive REPL loop.
func (r *REPL) Run() error {
	r.spin = spinner.New(spinner.CharSets[14], 100*time.Millisecond)
	r.spin.Suffix = " Thinking..."
	r.spin.Writer = os.Stderr

	rl, err := readline.NewEx(&readline.Config{
		Prompt:          r.prompt(),
		HistoryFile:     historyFile(),
		InterruptPrompt: "^C",
		EOFPrompt:       "exit",
	})
	if err != nil {
		return fmt.Errorf("readline init failed: %w", err)
	}
	r.rl = rl
	defer rl.Close()

	r.printWelcome()

	for {
		line, err := rl.Readline()
		if err != nil {
			return nil
		}

		input := strings.TrimSpace(line)
		if input == "" {
			continue
		}

		if strings.HasPrefix(input, ":") {
			if quit := r.handleCLICommand(input); quit {
				return nil
			}
			continue
		}

		if strings.HasPrefix(input, "/") {
			if quit := r.handleSlashCommand(input); quit {
				return nil
			}
			continue
		}

		r.handleUserInput(input)
	}
}

// RunSinglePrompt creates a new session, sends the prompt, waits for
// completion, and exits. Used for non-interactive `-p` invocations.
func (r *REPL) RunSinglePrompt(prompt string) error {
	r.spin = spinner.New(spinner.CharSets[14], 100*time.Millisecond)
	r.spin.Suffix = " Thinking..."
	r.spin.Writer = ProgressOut

	fmt.Fprintln(ProgressOut)
	color.New(color.FgHiWhite, color.Bold).Fprintf(ProgressOut, "  Apex — %s\n", r.project.Name)
	fmt.Fprintln(ProgressOut)

	r.handleUserInput(prompt)
	return nil
}

// RunCommand executes a single slash command or prompt against an existing
// chat, then exits. Used for non-interactive `cmd` invocations.
func (r *REPL) RunCommand(chatID, input string) error {
	r.spin = spinner.New(spinner.CharSets[14], 100*time.Millisecond)
	r.spin.Suffix = " Thinking..."
	r.spin.Writer = ProgressOut

	if chatID != "" {
		r.openChatByPrefix(chatID)
		if r.activeChatID == "" {
			return fmt.Errorf("chat not found: %s", chatID)
		}
	}

	if strings.HasPrefix(input, "/") {
		r.handleSlashCommand(input)
		return nil
	}

	r.handleUserInput(input)
	return nil
}

// openChatByPrefix resolves a chat ID prefix and sets it as active.
func (r *REPL) openChatByPrefix(idPrefix string) {
	chats, err := r.database.ListChats(r.projectID)
	if err != nil {
		return
	}
	for _, c := range chats {
		if strings.HasPrefix(c.ID, idPrefix) {
			r.activeChatID = c.ID
			r.isNewChat = false
			if c.ClaudeSessionID != nil {
				r.activeSessionID = *c.ClaudeSessionID
			}
			return
		}
	}
}

func (r *REPL) prompt() string {
	return color.New(color.FgCyan, color.Bold).Sprint("> ")
}

func (r *REPL) printWelcome() {
	title := color.New(color.FgHiWhite, color.Bold)
	fmt.Fprintln(ProgressOut)
	title.Fprintf(ProgressOut, "  Apex — %s", r.project.Name)
	fmt.Fprintln(ProgressOut)
	if r.project.Status != "running" {
		color.New(color.FgYellow).Fprintf(ProgressOut, "  Sandbox status: %s\n", r.project.Status)
	}
	dimStyle.Fprintln(ProgressOut, "  Type your prompt, /help or :help for commands")
	fmt.Fprintln(ProgressOut)
}

// ── CLI commands (: prefix) ─────────────────────────────

func (r *REPL) handleCLICommand(input string) (quit bool) {
	parts := strings.Fields(input)
	cmd := strings.ToLower(parts[0])

	switch cmd {
	case ":quit", ":q", ":exit":
		fmt.Println("Goodbye!")
		return true

	case ":new", ":n":
		r.activeChatID = ""
		r.activeSessionID = ""
		r.isNewChat = true
		successStyle.Println("  Starting new chat")

	case ":chats", ":c":
		r.listChats()

	case ":open", ":o":
		if len(parts) < 2 {
			errorStyle.Println("  Usage: :open <chat-id>")
			return false
		}
		r.openChat(parts[1])

	case ":help":
		r.printCLIHelp()

	default:
		errorStyle.Printf("  Unknown command: %s (type :help)\n", cmd)
	}
	return false
}

func (r *REPL) printCLIHelp() {
	fmt.Println()
	dimStyle.Println("  Session commands (: prefix)")
	fmt.Println("    :new, :n          Start a new chat")
	fmt.Println("    :chats, :c        List chats for this project")
	fmt.Println("    :open, :o <id>    Switch to an existing chat")
	fmt.Println("    :quit, :q         Exit")
	fmt.Println("    :help             Show this help")
	fmt.Println()
}

// ── Claude-equivalent commands (/ prefix) ───────────────

func (r *REPL) handleSlashCommand(input string) (quit bool) {
	parts := strings.Fields(input)
	cmd := strings.ToLower(parts[0])

	switch cmd {
	case "/help":
		r.printSlashHelp()

	case "/exit", "/quit":
		fmt.Println("Goodbye!")
		return true

	case "/clear":
		r.activeSessionID = ""
		successStyle.Println("  Context cleared — next prompt starts a fresh session")

	case "/compact":
		r.activeSessionID = ""
		successStyle.Println("  Session compacted — next prompt starts a fresh session")

	case "/status":
		r.showStatus()

	case "/cost":
		r.showCost()

	case "/model":
		r.showModel()

	case "/history":
		r.showHistory()

	case "/diff":
		r.execSandboxCommand("cd " + r.projectDir() + " && git diff")

	case "/undo":
		r.execSandboxCommand("cd " + r.projectDir() + " && git checkout -- .")
		successStyle.Println("  Reverted uncommitted changes")

	case "/commit":
		r.handleUserInput("Create a git commit with an appropriate message for the recent changes. Use a concise commit message.")

	case "/config":
		r.printConfig()

	case "/mcp":
		r.showMCP()

	case "/add":
		if len(parts) < 2 {
			errorStyle.Println("  Usage: /add <file-path>")
			return false
		}
		r.addFileToPrompt(parts[1])

	case "/drop", "/files":
		dimStyle.Println("  Not available — each prompt is a standalone request in pipe mode")

	case "/plan":
		dimStyle.Println("  Tip: start your prompt with \"Plan:\" or \"Think step by step about...\" to get planning behavior")

	case "/checkpoint", "/rollback":
		dimStyle.Println("  Tip: use /diff to see changes and /undo to revert")

	case "/resume":
		dimStyle.Println("  Sessions are resumed automatically within a chat. Use :open <id> to switch chats.")

	default:
		errorStyle.Printf("  Unknown command: %s (type /help)\n", cmd)
	}
	return false
}

func (r *REPL) printSlashHelp() {
	fmt.Println()
	dimStyle.Println("  Claude-style commands (/ prefix)")
	fmt.Println("    /help             Show this help")
	fmt.Println("    /clear            Clear conversation context (fresh session)")
	fmt.Println("    /compact          Same as /clear — resets session")
	fmt.Println("    /status           Show session status")
	fmt.Println("    /cost             Show last response cost & tokens")
	fmt.Println("    /model            Show current model")
	fmt.Println("    /history          Show conversation messages")
	fmt.Println("    /diff             Show uncommitted changes (git diff)")
	fmt.Println("    /undo             Revert uncommitted changes (git checkout)")
	fmt.Println("    /commit           Ask Claude to create a git commit")
	fmt.Println("    /add <file>       Read a file and include in next prompt")
	fmt.Println("    /config           Show current configuration")
	fmt.Println("    /mcp              Show configured MCP servers")
	fmt.Println("    /exit             Exit")
	fmt.Println()
	dimStyle.Println("  See also: :help for session management commands")
	fmt.Println()
}

func (r *REPL) showStatus() {
	fmt.Println()
	fmt.Printf("  Project:   %s\n", r.project.Name)
	fmt.Printf("  Status:    %s\n", r.project.Status)
	if r.activeModel != "" {
		fmt.Printf("  Model:     %s\n", r.activeModel)
	}
	chatLabel := "(new)"
	if r.activeChatID != "" {
		chatLabel = r.activeChatID[:8]
	}
	fmt.Printf("  Chat:      %s\n", chatLabel)
	sessionLabel := "(none)"
	if r.activeSessionID != "" {
		sessionLabel = r.activeSessionID[:min(len(r.activeSessionID), 12)] + "…"
	}
	fmt.Printf("  Session:   %s\n", sessionLabel)
	fmt.Println()
}

func (r *REPL) showCost() {
	if r.lastCost == nil {
		dimStyle.Println("  No cost data yet — send a prompt first")
		return
	}
	RenderResult(*r.lastCost)
}

func (r *REPL) showModel() {
	if r.activeModel == "" {
		dimStyle.Println("  Model not yet known — send a prompt first")
		return
	}
	fmt.Printf("  Model: %s\n", r.activeModel)
}

func (r *REPL) showMCP() {
	if r.project.SandboxID == nil || *r.project.SandboxID == "" {
		errorStyle.Println("  No sandbox available")
		return
	}

	ctx := context.Background()
	output, err := r.manager.ExecCommand(ctx, *r.project.SandboxID, "cat /home/daytona/.claude.json 2>/dev/null || echo '{}'")
	if err != nil {
		errorStyle.Printf("  Failed to read MCP config: %v\n", err)
		return
	}

	var mcpConfig struct {
		Servers map[string]struct {
			Type    string   `json:"type"`
			Command string   `json:"command"`
			Args    []string `json:"args"`
		} `json:"mcpServers"`
	}
	if err := json.Unmarshal([]byte(strings.TrimSpace(output)), &mcpConfig); err != nil {
		errorStyle.Printf("  Failed to parse MCP config: %v\n", err)
		return
	}

	if len(mcpConfig.Servers) == 0 {
		dimStyle.Println("  No MCP servers configured")
		return
	}

	fmt.Println()
	dimStyle.Println("  MCP Servers:")
	for name, srv := range mcpConfig.Servers {
		fmt.Printf("    %s\n", color.New(color.FgCyan).Sprint(name))
		fmt.Printf("      command: %s %s\n", srv.Command, strings.Join(srv.Args, " "))
	}
	fmt.Println()
}

func (r *REPL) printConfig() {
	fmt.Println()
	fmt.Printf("  DB path:     %s\n", r.database.Path())
	fmt.Printf("  Project ID:  %s\n", r.projectID)
	if r.project.SandboxID != nil {
		fmt.Printf("  Sandbox ID:  %s\n", *r.project.SandboxID)
	}
	fmt.Println()
}

func (r *REPL) execSandboxCommand(command string) {
	if r.project.SandboxID == nil || *r.project.SandboxID == "" {
		errorStyle.Println("  No sandbox available")
		return
	}

	ctx := context.Background()
	output, err := r.manager.ExecCommand(ctx, *r.project.SandboxID, command)
	if err != nil {
		errorStyle.Printf("  Command failed: %v\n", err)
		return
	}

	output = strings.TrimSpace(output)
	if output == "" {
		dimStyle.Println("  (no output)")
	} else {
		fmt.Println(output)
	}
}

func (r *REPL) addFileToPrompt(filePath string) {
	if r.project.SandboxID == nil || *r.project.SandboxID == "" {
		errorStyle.Println("  No sandbox available")
		return
	}

	absPath := filePath
	if !strings.HasPrefix(filePath, "/") {
		absPath = r.projectDir() + "/" + filePath
	}

	ctx := context.Background()
	content, err := r.manager.ExecCommand(ctx, *r.project.SandboxID, fmt.Sprintf("cat %q 2>&1", absPath))
	if err != nil {
		errorStyle.Printf("  Failed to read file: %v\n", err)
		return
	}

	prompt := fmt.Sprintf("Here is the content of %s:\n\n```\n%s\n```\n\nI've added this file to our conversation context. What would you like to do with it?", filePath, strings.TrimSpace(content))
	r.handleUserInput(prompt)
}

func (r *REPL) projectDir() string {
	if r.project.Name != "" {
		slug := strings.ToLower(r.project.Name)
		slug = strings.Map(func(c rune) rune {
			if (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') {
				return c
			}
			return '-'
		}, slug)
		slug = strings.Trim(slug, "-")
		if slug != "" {
			return "/home/daytona/" + slug
		}
	}
	return "/home/daytona"
}

// ── Chat operations ─────────────────────────────────────

func (r *REPL) listChats() {
	chats, err := r.database.ListChats(r.projectID)
	if err != nil {
		errorStyle.Printf("  Failed to list chats: %v\n", err)
		return
	}
	if len(chats) == 0 {
		dimStyle.Println("  No chats yet")
		return
	}

	fmt.Println()
	for _, c := range chats {
		marker := " "
		if c.ID == r.activeChatID {
			marker = "*"
		}
		status := statusIndicator(c.Status)
		dimID := dimStyle.Sprintf("%.8s", c.ID)
		fmt.Printf("  %s %s %s  %s\n", marker, status, dimID, c.Title)
	}
	fmt.Println()
}

func (r *REPL) openChat(idPrefix string) {
	chats, err := r.database.ListChats(r.projectID)
	if err != nil {
		errorStyle.Printf("  Failed to list chats: %v\n", err)
		return
	}

	var match *db.ChatRow
	for _, c := range chats {
		if strings.HasPrefix(c.ID, idPrefix) {
			chatCopy := c
			match = &chatCopy
			break
		}
	}

	if match == nil {
		errorStyle.Printf("  No chat found matching: %s\n", idPrefix)
		return
	}

	r.activeChatID = match.ID
	r.isNewChat = false
	if match.ClaudeSessionID != nil {
		r.activeSessionID = *match.ClaudeSessionID
	} else {
		r.activeSessionID = ""
	}
	successStyle.Printf("  Opened chat: %s\n", match.Title)

	r.showHistory()
}

func (r *REPL) showHistory() {
	if r.activeChatID == "" {
		dimStyle.Println("  No active chat")
		return
	}

	rows, err := r.database.GetMessages(r.activeChatID)
	if err != nil {
		errorStyle.Printf("  Failed to load messages: %v\n", err)
		return
	}

	if len(rows) == 0 {
		dimStyle.Println("  No messages")
		return
	}

	msgs := rowsToMessages(rows)
	RenderChatHistory(msgs)
}

// ── Prompt handling ─────────────────────────────────────

func (r *REPL) handleUserInput(input string) {
	r.mu.Lock()
	r.streaming = true
	r.mu.Unlock()

	chatID := r.activeChatID
	sessionID := r.activeSessionID

	if r.isNewChat || chatID == "" {
		chatRow, err := r.database.CreateChat(r.projectID, input)
		if err != nil {
			errorStyle.Fprintf(ProgressOut, "  Failed to create chat: %v\n", err)
			r.mu.Lock()
			r.streaming = false
			r.mu.Unlock()
			return
		}
		chatID = chatRow.ID
		r.activeChatID = chatID
		r.isNewChat = false
		sessionID = ""

		contentJSON := db.MarshalJSON([]types.ContentBlock{{Type: "text", Text: input}})
		if err := r.database.AddMessage(chatID, "user", contentJSON, nil); err != nil {
			errorStyle.Fprintf(ProgressOut, "  Failed to save message: %v\n", err)
		}
	} else {
		contentJSON := db.MarshalJSON([]types.ContentBlock{{Type: "text", Text: input}})
		if err := r.database.AddMessage(chatID, "user", contentJSON, nil); err != nil {
			errorStyle.Fprintf(ProgressOut, "  Failed to save message: %v\n", err)
		}
	}

	r.database.UpdateChatStatus(chatID, "running")

	r.spin.Start()

	if err := r.manager.SendPrompt(chatID, input, sessionID); err != nil {
		r.spin.Stop()
		errorStyle.Fprintf(ProgressOut, "  Failed to send prompt: %v\n", err)
		r.mu.Lock()
		r.streaming = false
		r.mu.Unlock()
		return
	}

	r.processBridgeMessages(chatID)
}

func (r *REPL) processBridgeMessages(chatID string) {
	messages := r.manager.Messages()
	done := r.manager.Done()

	for {
		select {
		case msg, ok := <-messages:
			if !ok {
				r.spin.Stop()
				r.mu.Lock()
				r.streaming = false
				r.mu.Unlock()
				errorStyle.Fprintln(ProgressOut, "\n  Connection closed")
				return
			}

			if msg.ChatID != "" && msg.ChatID != chatID {
				continue
			}

			switch msg.Type {
			case "claude_message":
				r.handleClaudeMessage(chatID, msg.Data)

			case "claude_exit":
				r.spin.Stop()
				status := "completed"
				if msg.Code != nil && *msg.Code != 0 {
					status = "error"
				}
				r.database.UpdateChatStatus(chatID, status)
				r.mu.Lock()
				r.streaming = false
				r.mu.Unlock()
				return

			case "claude_error":
				r.spin.Stop()
				r.database.UpdateChatStatus(chatID, "error")
				RenderError(msg.Error)
				r.mu.Lock()
				r.streaming = false
				r.mu.Unlock()
				return

			case "claude_stderr":
				continue
			}

		case <-done:
			r.spin.Stop()
			r.mu.Lock()
			r.streaming = false
			r.mu.Unlock()
			errorStyle.Fprintln(ProgressOut, "\n  Connection lost")
			return
		}
	}
}

func (r *REPL) handleClaudeMessage(chatID string, raw json.RawMessage) {
	output, err := types.ParseClaudeOutput(raw)
	if err != nil {
		return
	}

	switch output.Type {
	case "system":
		r.spin.Stop()
		if output.Subtype == "init" && output.SessionID != "" {
			r.activeSessionID = output.SessionID
			r.database.UpdateChatSessionID(chatID, output.SessionID)
			if output.Model != "" {
				r.activeModel = output.Model
			}
			RenderSystemInit(*output)
		}

	case "assistant":
		r.spin.Stop()
		if output.Message != nil {
			if output.Message.Model != "" {
				r.activeModel = output.Message.Model
			}
			contentJSON := db.MarshalJSON(output.Message.Content)
			metaJSON := db.MarshalJSONPtr(map[string]interface{}{
				"model":      output.Message.Model,
				"stopReason": output.Message.StopReason,
				"usage":      output.Message.Usage,
			})
			r.database.AddMessage(chatID, "assistant", contentJSON, metaJSON)

			fmt.Fprintln(ProgressOut)
			RenderAssistantBlocks(output.Message.Content)
		}

	case "result":
		r.spin.Stop()

		if output.SessionID != "" && r.activeSessionID == "" {
			r.activeSessionID = output.SessionID
			r.database.UpdateChatSessionID(chatID, output.SessionID)
		}

		r.lastCost = output

		metaJSON := db.MarshalJSONPtr(map[string]interface{}{
			"costUsd":      output.TotalCostUSD,
			"durationMs":   output.DurationMS,
			"numTurns":     output.NumTurns,
			"inputTokens":  nil,
			"outputTokens": nil,
		})
		if output.Usage != nil {
			metaJSON = db.MarshalJSONPtr(map[string]interface{}{
				"costUsd":      output.TotalCostUSD,
				"durationMs":   output.DurationMS,
				"numTurns":     output.NumTurns,
				"inputTokens":  output.Usage.InputTokens,
				"outputTokens": output.Usage.OutputTokens,
			})
		}
		r.database.AddMessage(chatID, "system", "[]", metaJSON)

		isErr := output.IsError != nil && *output.IsError
		if isErr {
			r.database.UpdateChatStatus(chatID, "error")
		} else {
			r.database.UpdateChatStatus(chatID, "completed")
		}

		RenderResult(*output)
		r.mu.Lock()
		r.streaming = false
		r.mu.Unlock()
	}
}

// ── Helpers ─────────────────────────────────────────────

func statusIndicator(status string) string {
	switch status {
	case "running":
		return color.New(color.FgYellow).Sprint("●")
	case "completed":
		return color.New(color.FgGreen).Sprint("●")
	case "error":
		return color.New(color.FgRed).Sprint("●")
	default:
		return color.New(color.Faint).Sprint("●")
	}
}

func historyFile() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	dir := home + "/.apex"
	os.MkdirAll(dir, 0755)
	return dir + "/history"
}

func rowsToMessages(rows []db.MessageRow) []types.Message {
	msgs := make([]types.Message, 0, len(rows))
	for _, row := range rows {
		var content []types.ContentBlock
		json.Unmarshal([]byte(row.Content), &content)

		var metadata map[string]interface{}
		if row.Metadata != nil {
			json.Unmarshal([]byte(*row.Metadata), &metadata)
		}

		msgs = append(msgs, types.Message{
			ID:        row.ID,
			TaskID:    row.TaskID,
			Role:      row.Role,
			Content:   content,
			Metadata:  metadata,
			CreatedAt: row.CreatedAt,
		})
	}
	return msgs
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
