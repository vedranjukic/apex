package types

import "encoding/json"

// Project mirrors the DB projects table.
type Project struct {
	ID          string  `json:"id"`
	UserID      string  `json:"userId"`
	Name        string  `json:"name"`
	Description string  `json:"description"`
	SandboxID   *string `json:"sandboxId"`
	Status      string  `json:"status"`
	StatusError *string `json:"statusError"`
	AgentType   string  `json:"agentType"`
	GitRepo     *string `json:"gitRepo"`
	CreatedAt   string  `json:"createdAt"`
	UpdatedAt   string  `json:"updatedAt"`
}

// Chat mirrors the DB tasks table.
type Chat struct {
	ID              string  `json:"id"`
	ProjectID       string  `json:"projectId"`
	Title           string  `json:"title"`
	Status          string  `json:"status"`
	ClaudeSessionID *string `json:"claudeSessionId,omitempty"`
	CreatedAt       string  `json:"createdAt"`
	UpdatedAt       string  `json:"updatedAt"`
}

// Message mirrors the DB messages table.
type Message struct {
	ID        string                 `json:"id"`
	TaskID    string                 `json:"taskId"`
	Role      string                 `json:"role"`
	Content   []ContentBlock         `json:"content"`
	Metadata  map[string]interface{} `json:"metadata"`
	CreatedAt string                 `json:"createdAt"`
}

// ContentBlock represents a single block of content in a message.
type ContentBlock struct {
	Type      string                 `json:"type"`
	Text      string                 `json:"text,omitempty"`
	ID        string                 `json:"id,omitempty"`
	Name      string                 `json:"name,omitempty"`
	Input     map[string]interface{} `json:"input,omitempty"`
	ToolUseID string                 `json:"tool_use_id,omitempty"`
	Content   string                 `json:"content,omitempty"`
}

// ClaudeOutput represents a parsed message from Claude's stream-json output.
type ClaudeOutput struct {
	Type    string     `json:"type"`
	Subtype string     `json:"subtype,omitempty"`
	Message *ClaudeMsg `json:"message,omitempty"`

	SessionID         string `json:"session_id,omitempty"`
	Model             string `json:"model,omitempty"`
	CWD               string `json:"cwd,omitempty"`
	ClaudeCodeVersion string `json:"claude_code_version,omitempty"`

	IsError      *bool    `json:"is_error,omitempty"`
	TotalCostUSD *float64 `json:"total_cost_usd,omitempty"`
	DurationMS   *int64   `json:"duration_ms,omitempty"`
	NumTurns     *int     `json:"num_turns,omitempty"`
	Result       string   `json:"result,omitempty"`
	Usage        *Usage   `json:"usage,omitempty"`

	UUID string `json:"uuid,omitempty"`
}

// ParseClaudeOutput parses a json.RawMessage into a ClaudeOutput.
func ParseClaudeOutput(raw json.RawMessage) (*ClaudeOutput, error) {
	var out ClaudeOutput
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ClaudeMsg contains the message content from an assistant response.
type ClaudeMsg struct {
	Content    []ContentBlock `json:"content"`
	Model      string         `json:"model,omitempty"`
	StopReason *string        `json:"stop_reason,omitempty"`
	Usage      *Usage         `json:"usage,omitempty"`
}

// Usage tracks token counts.
type Usage struct {
	InputTokens              int `json:"input_tokens"`
	OutputTokens             int `json:"output_tokens"`
	CacheCreationInputTokens int `json:"cache_creation_input_tokens,omitempty"`
	CacheReadInputTokens     int `json:"cache_read_input_tokens,omitempty"`
}
