package chat

import (
	"encoding/json"

	"github.com/apex/cli/internal/db"
	"github.com/apex/cli/internal/sandbox"
	"github.com/apex/cli/internal/types"
)

// OnContentUpdated is called whenever an assistant message is written to the DB.
// Used by the TUI to refresh the content panel in real time.
type OnContentUpdated func(chatID string)

// ProcessBridgeToDB processes bridge messages until claude_exit, updating only
// the database (no stdout output). Used by the dashboard TUI.
// If onContentUpdated is non-nil, it is called whenever an assistant message is written.
func ProcessBridgeToDB(database *db.DB, manager *sandbox.Manager, chatID string, onContentUpdated OnContentUpdated) {
	messages := manager.Messages()
	done := manager.Done()
	var sessionID string

	for {
		select {
		case msg, ok := <-messages:
			if !ok {
				return
			}
			if msg.ChatID != "" && msg.ChatID != chatID {
				continue
			}
			switch msg.Type {
			case "claude_message":
				handleClaudeMessageToDB(database, chatID, &sessionID, msg.Data, onContentUpdated)
			case "claude_exit":
				status := "completed"
				if msg.Code != nil && *msg.Code != 0 {
					status = "error"
				}
				database.UpdateChatStatus(chatID, status)
				return
			case "claude_error":
				database.UpdateChatStatus(chatID, "error")
				return
			case "claude_stderr":
				// skip
			}
		case <-done:
			return
		}
	}
}

func handleClaudeMessageToDB(database *db.DB, chatID string, sessionID *string, raw json.RawMessage, onContentUpdated OnContentUpdated) {
	output, err := types.ParseClaudeOutput(raw)
	if err != nil {
		return
	}
	switch output.Type {
	case "system":
		if output.Subtype == "init" && output.SessionID != "" {
			*sessionID = output.SessionID
			database.UpdateChatSessionID(chatID, output.SessionID)
		}
	case "assistant":
		if output.Message != nil {
			contentJSON := db.MarshalJSON(output.Message.Content)
			metaJSON := db.MarshalJSONPtr(map[string]interface{}{
				"model":      output.Message.Model,
				"stopReason": output.Message.StopReason,
				"usage":      output.Message.Usage,
			})
			database.AddMessage(chatID, "assistant", contentJSON, metaJSON)
			if onContentUpdated != nil {
				onContentUpdated(chatID)
			}
		}
	case "result":
		if output.SessionID != "" && *sessionID == "" {
			*sessionID = output.SessionID
			database.UpdateChatSessionID(chatID, output.SessionID)
		}
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
		database.AddMessage(chatID, "system", "[]", metaJSON)
		if output.IsError != nil && *output.IsError {
			database.UpdateChatStatus(chatID, "error")
		} else {
			database.UpdateChatStatus(chatID, "completed")
		}
	}
}
