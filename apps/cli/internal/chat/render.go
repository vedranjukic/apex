package chat

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/charmbracelet/glamour"
	"github.com/apex/cli/internal/types"
	"github.com/fatih/color"
)

// ProgressOut is the writer for progress/status output (spinner, tool use,
// cost summary, etc.). Defaults to stdout. Set to os.Stderr with --stream
// so that stdout contains only the assistant's text result.
var ProgressOut io.Writer = os.Stdout

var (
	dimStyle     = color.New(color.Faint)
	userStyle    = color.New(color.FgCyan, color.Bold)
	toolStyle    = color.New(color.FgYellow)
	errorStyle   = color.New(color.FgRed)
	successStyle = color.New(color.FgGreen)
	costStyle    = color.New(color.Faint, color.FgMagenta)
)

var mdRenderer *glamour.TermRenderer

func init() {
	var err error
	mdRenderer, err = glamour.NewTermRenderer(
		glamour.WithAutoStyle(),
		glamour.WithWordWrap(100),
	)
	if err != nil {
		mdRenderer = nil
	}
}

// RenderUserPrompt prints the user's prompt.
func RenderUserPrompt(prompt string) {
	fmt.Fprintln(ProgressOut)
	userStyle.Fprint(ProgressOut, "You: ")
	fmt.Fprintln(ProgressOut, prompt)
}

// RenderAssistantBlocks renders a list of content blocks from an assistant message.
func RenderAssistantBlocks(blocks []types.ContentBlock) {
	for _, block := range blocks {
		switch block.Type {
		case "text":
			renderTextBlock(block.Text)
		case "tool_use":
			renderToolUse(block)
		case "tool_result":
			renderToolResult(block)
		}
	}
}

// RenderStreamingText appends text to the current output without a newline.
// Always writes to stdout — this is result content.
func RenderStreamingText(text string) {
	fmt.Print(text)
}

func progress(format string, a ...interface{}) {
	fmt.Fprintf(ProgressOut, format, a...)
}

func progressln(a ...interface{}) {
	fmt.Fprintln(ProgressOut, a...)
}

// RenderResult prints the completion summary line.
func RenderResult(output types.ClaudeOutput) {
	fmt.Fprintln(ProgressOut)

	parts := []string{}

	if output.TotalCostUSD != nil {
		parts = append(parts, fmt.Sprintf("Cost: $%.4f", *output.TotalCostUSD))
	}
	if output.DurationMS != nil {
		secs := float64(*output.DurationMS) / 1000.0
		parts = append(parts, fmt.Sprintf("Duration: %.1fs", secs))
	}
	if output.NumTurns != nil {
		parts = append(parts, fmt.Sprintf("Turns: %d", *output.NumTurns))
	}
	if output.Usage != nil {
		parts = append(parts, fmt.Sprintf("Tokens: %d in / %d out",
			output.Usage.InputTokens, output.Usage.OutputTokens))
	}

	if len(parts) > 0 {
		costStyle.Fprintln(ProgressOut, "  "+strings.Join(parts, " | "))
	}

	if output.IsError != nil && *output.IsError {
		errorStyle.Fprintln(ProgressOut, "  Session ended with error")
	}
}

// RenderSystemInit prints the system init info.
func RenderSystemInit(output types.ClaudeOutput) {
	parts := []string{}
	if output.Model != "" {
		parts = append(parts, "Model: "+output.Model)
	}
	if output.CWD != "" {
		parts = append(parts, "CWD: "+output.CWD)
	}
	if len(parts) > 0 {
		dimStyle.Fprintln(ProgressOut, "  "+strings.Join(parts, " | "))
	}
}

// RenderError prints an error message.
func RenderError(msg string) {
	fmt.Fprintln(ProgressOut)
	errorStyle.Fprintln(ProgressOut, "Error: "+msg)
}

// RenderStatus prints a status change.
func RenderStatus(status string) {
	switch status {
	case "completed":
		successStyle.Fprintln(ProgressOut, "  Session completed")
	case "error":
		errorStyle.Fprintln(ProgressOut, "  Session error")
	}
}

// RenderChatHistory prints the message history for a chat.
func RenderChatHistory(messages []types.Message) {
	for _, msg := range messages {
		switch msg.Role {
		case "user":
			for _, block := range msg.Content {
				if block.Type == "text" && block.Text != "" {
					RenderUserPrompt(block.Text)
				}
			}
		case "assistant":
			RenderAssistantBlocks(msg.Content)
		case "system":
			if msg.Metadata != nil {
				renderMetadataSummary(msg.Metadata)
			}
		}
	}
}

func renderTextBlock(text string) {
	if text == "" {
		return
	}
	if mdRenderer != nil {
		rendered, err := mdRenderer.Render(text)
		if err == nil {
			fmt.Print(rendered)
			return
		}
	}
	fmt.Println(text)
}

func renderToolUse(block types.ContentBlock) {
	name := block.Name
	if name == "" {
		name = "unknown_tool"
	}
	toolStyle.Fprintf(ProgressOut, "  ⚡ %s", name)

	if block.Input != nil {
		inputJSON, err := json.Marshal(block.Input)
		if err == nil {
			summary := string(inputJSON)
			if len(summary) > 120 {
				summary = summary[:120] + "…"
			}
			dimStyle.Fprintf(ProgressOut, " %s", summary)
		}
	}
	fmt.Fprintln(ProgressOut)
}

func renderToolResult(block types.ContentBlock) {
	content := block.Content
	if content == "" {
		return
	}
	lines := strings.Split(content, "\n")
	maxLines := 10
	if len(lines) > maxLines {
		lines = lines[:maxLines]
		lines = append(lines, dimStyle.Sprintf("    … (%d more lines)", len(strings.Split(content, "\n"))-maxLines))
	}
	for _, line := range lines {
		dimStyle.Fprintf(ProgressOut, "    %s\n", line)
	}
}

func renderMetadataSummary(metadata map[string]interface{}) {
	parts := []string{}

	if v, ok := metadata["costUsd"]; ok {
		if f, ok := v.(float64); ok {
			parts = append(parts, fmt.Sprintf("Cost: $%.4f", f))
		}
	}
	if v, ok := metadata["durationMs"]; ok {
		if f, ok := v.(float64); ok {
			parts = append(parts, fmt.Sprintf("Duration: %.1fs", f/1000.0))
		}
	}
	if v, ok := metadata["numTurns"]; ok {
		if f, ok := v.(float64); ok {
			parts = append(parts, fmt.Sprintf("Turns: %.0f", f))
		}
	}

	if len(parts) > 0 {
		costStyle.Fprintln(ProgressOut, "  "+strings.Join(parts, " | "))
	}
}
