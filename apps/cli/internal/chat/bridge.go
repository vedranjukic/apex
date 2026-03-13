package chat

import (
	"encoding/json"

	"github.com/apex/cli/internal/db"
	"github.com/apex/cli/internal/sandbox"
	"github.com/apex/cli/internal/types"
)

// isSyntheticAskUserMessage detects bridge-generated AskUserQuestion messages
// (from /internal/ask-user) that have a single tool_use block with no model.
// These duplicate the question already rendered from the preceding MCP call.
func isSyntheticAskUserMessage(content []types.ContentBlock) bool {
	if len(content) != 1 {
		return false
	}
	return content[0].Type == "tool_use" && content[0].Name == "AskUserQuestion"
}

// OnContentUpdated is called whenever an assistant message is written to the DB.
// Used by the TUI to refresh the content panel in real time.
type OnContentUpdated func(chatID string)

// OnAskUser is called when the agent asks a question via ask_user.
// questionID is the tool_use ID needed to send the answer back.
type OnAskUser func(chatID, questionID string)

// BridgeCallbacks groups optional callbacks for ProcessBridgeToDB.
type BridgeCallbacks struct {
	OnContentUpdated OnContentUpdated
	OnAskUser        OnAskUser
}

// ProcessBridgeToDB processes bridge messages until claude_exit, updating only
// the database (no stdout output). Used by the dashboard TUI.
func ProcessBridgeToDB(database *db.DB, manager *sandbox.Manager, chatID string, onContentUpdated OnContentUpdated) {
	ProcessBridgeToDBWithCallbacks(database, manager, chatID, BridgeCallbacks{
		OnContentUpdated: onContentUpdated,
	})
}

// ProcessBridgeToDBWithCallbacks processes bridge messages with full callback support.
func ProcessBridgeToDBWithCallbacks(database *db.DB, manager *sandbox.Manager, chatID string, cb BridgeCallbacks) {
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
				handleClaudeMessageToDB(database, chatID, &sessionID, msg.Data, cb.OnContentUpdated)
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
			case "ask_user_pending":
				database.UpdateChatStatus(chatID, "waiting_for_input")
				if cb.OnAskUser != nil {
					cb.OnAskUser(chatID, msg.QuestionID)
				}
			case "ask_user_resolved":
				database.UpdateChatStatus(chatID, "running")
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
			// Skip synthetic AskUserQuestion messages from the bridge's
			// /internal/ask-user handler -- the real question is already
			// in the preceding assistant message from Claude.
			if isSyntheticAskUserMessage(output.Message.Content) {
				if onContentUpdated != nil {
					onContentUpdated(chatID)
				}
				return
			}
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
