package thread

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

// RenderThreadHistory prints the message history for a thread.
func RenderThreadHistory(messages []types.Message) {
	skip := deduplicateToolUseBlocks(messages)
	for _, msg := range messages {
		switch msg.Role {
		case "user":
			hasText := false
			for _, block := range msg.Content {
				if block.Type == "text" && block.Text != "" {
					RenderUserPrompt(block.Text)
					hasText = true
				}
			}
			if !hasText {
				RenderToolResultBlocks(msg.Content)
			}
		case "assistant":
			renderAssistantBlocksFiltered(msg.Content, skip)
		case "system":
			if msg.Metadata != nil {
				renderMetadataSummary(msg.Metadata)
			}
		}
	}
}

func renderAssistantBlocksFiltered(blocks []types.ContentBlock, skip map[string]bool) {
	for _, block := range blocks {
		if block.Type == "tool_use" && skip[block.ID] {
			continue
		}
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

// FormatThreadHistory returns the formatted thread history as a string for TUI viewport display.
func FormatThreadHistory(messages []types.Message) string {
	skip := deduplicateToolUseBlocks(messages)
	var sb strings.Builder
	var lastTool string
	for _, msg := range messages {
		switch msg.Role {
		case "user":
			hasText := false
			for _, block := range msg.Content {
				if block.Type == "text" && block.Text != "" {
					sb.WriteString("\nYou: ")
					sb.WriteString(block.Text)
					sb.WriteString("\n")
					hasText = true
				}
			}
			if !hasText {
				for _, block := range msg.Content {
					if block.Type == "tool_result" {
						formatToolResultStr(&sb, block, lastTool)
					}
				}
			}
		case "assistant":
			for _, block := range msg.Content {
				if block.Type == "tool_use" && skip[block.ID] {
					continue
				}
				switch block.Type {
				case "text":
					if block.Text != "" {
						if mdRenderer != nil {
							rendered, err := mdRenderer.Render(block.Text)
							if err == nil {
								sb.WriteString(rendered)
							} else {
								sb.WriteString(block.Text)
								sb.WriteString("\n")
							}
						} else {
							sb.WriteString(block.Text)
							sb.WriteString("\n")
						}
					}
				case "tool_use":
					lastTool = block.Name
					formatToolUseStr(&sb, block)
				case "tool_result":
					formatToolResultStr(&sb, block, lastTool)
				}
			}
		case "system":
			if msg.Metadata != nil {
				parts := []string{}
				if v, ok := msg.Metadata["costUsd"]; ok {
					if f, ok := v.(float64); ok {
						parts = append(parts, fmt.Sprintf("Cost: $%.4f", f))
					}
				}
				if v, ok := msg.Metadata["durationMs"]; ok {
					if f, ok := v.(float64); ok {
						parts = append(parts, fmt.Sprintf("Duration: %.1fs", f/1000.0))
					}
				}
				if v, ok := msg.Metadata["numTurns"]; ok {
					if f, ok := v.(float64); ok {
						parts = append(parts, fmt.Sprintf("Turns: %.0f", f))
					}
				}
				if len(parts) > 0 {
					sb.WriteString("  ")
					sb.WriteString(strings.Join(parts, " | "))
					sb.WriteString("\n")
				}
			}
		}
	}
	return sb.String()
}

func formatToolUseStr(sb *strings.Builder, block types.ContentBlock) {
	name := block.Name
	if name == "" {
		name = "unknown_tool"
	}
	if hiddenTools[name] {
		return
	}
	input := block.Input
	if input == nil {
		input = map[string]interface{}{}
	}

	switch name {
	case "Bash":
		sb.WriteString("  ⚡ Bash\n")
		if desc := getStr(input, "description"); desc != "" {
			sb.WriteString("    ")
			sb.WriteString(desc)
			sb.WriteString("\n")
		}
		if cmd := getStr(input, "command"); cmd != "" {
			sb.WriteString("    $ ")
			sb.WriteString(cmd)
			sb.WriteString("\n")
		}
	case "Write":
		path := getStr(input, "file_path", "filePath")
		content := getStr(input, "content")
		lines := 0
		if content != "" {
			lines = len(strings.Split(content, "\n"))
		}
		if path != "" {
			sb.WriteString(fmt.Sprintf("  ⚡ Write %s (%d line", path, lines))
			if lines != 1 {
				sb.WriteString("s")
			}
			sb.WriteString(")\n")
		} else {
			formatGenericToolStr(sb, name, input)
		}
	case "Read":
		path := getStr(input, "file_path", "filePath")
		if path == "" {
			formatGenericToolStr(sb, name, input)
			return
		}
		offset, hasOffset := getInt(input, "offset")
		limit, hasLimit := getInt(input, "limit")
		rangeLabel := ""
		if hasOffset && hasLimit {
			rangeLabel = fmt.Sprintf(":%d–%d", offset, offset+limit)
		} else if hasOffset {
			rangeLabel = fmt.Sprintf(":%d", offset)
		}
		sb.WriteString(fmt.Sprintf("  ⚡ Read %s%s\n", path, rangeLabel))
	case "Edit", "StrReplace":
		path := getStr(input, "file_path", "filePath")
		oldStr := getStr(input, "old_string", "oldString")
		newStr := getStr(input, "new_string", "newString")
		if path == "" && oldStr == "" && newStr == "" {
			formatGenericToolStr(sb, "Edit", input)
			return
		}
		sb.WriteString(fmt.Sprintf("  ⚡ Edit %s\n", path))
		formatDiffPreview(sb, oldStr, "Removed", "-", 5)
		formatDiffPreview(sb, newStr, "Added", "+", 5)
	case "MultiEdit":
		path := getStr(input, "file_path", "filePath")
		edits := getArr(input, "edits")
		if path != "" && len(edits) > 0 {
			sb.WriteString(fmt.Sprintf("  ⚡ MultiEdit %s (%d edits)\n", path, len(edits)))
		} else {
			formatGenericToolStr(sb, name, input)
		}
	case "TodoWrite":
		todos := getArr(input, "todos")
		if len(todos) == 0 {
			formatGenericToolStr(sb, name, input)
			return
		}
		sb.WriteString("  ⚡ Tasks\n")
		for _, t := range todos {
			m, ok := t.(map[string]interface{})
			if !ok {
				continue
			}
			content := getStr(m, "content")
			if content == "" {
				content = "(untitled)"
			}
			status := getStr(m, "status")
			icon := "○"
			switch status {
			case "completed":
				icon = "✓"
			case "in_progress":
				icon = "◐"
			case "cancelled":
				icon = "✗"
			}
			sb.WriteString(fmt.Sprintf("    [%s] %s\n", icon, content))
		}
	case "AskUserQuestion", "mcp__terminal-server__ask_user":
		questions := getArr(input, "questions")
		if len(questions) == 0 {
			formatGenericToolStr(sb, "AskUserQuestion", input)
			return
		}
		sb.WriteString("  ⚡ Question\n")
		for _, q := range questions {
			m, ok := q.(map[string]interface{})
			if !ok {
				continue
			}
			header := getStr(m, "header", "question")
			opts := getArr(m, "options")
			labels := []string{}
			for _, o := range opts {
				om, ok := o.(map[string]interface{})
				if ok {
					lbl := getStr(om, "label")
					if lbl != "" {
						labels = append(labels, lbl)
					}
				}
			}
			if header != "" || len(labels) > 0 {
				sb.WriteString(fmt.Sprintf("    %s: %s\n", header, strings.Join(labels, ", ")))
			}
		}
	case "WebSearch":
		term := getStr(input, "search_term", "searchTerm")
		sb.WriteString(fmt.Sprintf("  ⚡ WebSearch: %q\n", term))
	case "WebFetch":
		url := getStr(input, "url")
		prompt := getStr(input, "prompt")
		sb.WriteString(fmt.Sprintf("  ⚡ WebFetch %s\n", url))
		if prompt != "" {
			sb.WriteString(fmt.Sprintf("    prompt: %s\n", prompt))
		}
	case "Glob", "Grep":
		pattern := getStr(input, "pattern", "glob_pattern")
		path := getStr(input, "path", "include")
		sb.WriteString(fmt.Sprintf("  ⚡ %s %q", name, pattern))
		if path != "" {
			sb.WriteString(fmt.Sprintf(" in %s", path))
		}
		sb.WriteString("\n")
	default:
		formatGenericToolStr(sb, name, input)
	}
}

func formatDiffPreview(sb *strings.Builder, s, label, prefix string, max int) {
	if s == "" {
		return
	}
	lines := strings.Split(s, "\n")
	sb.WriteString(fmt.Sprintf("    %s:\n", label))
	for i, line := range lines {
		if i >= max {
			sb.WriteString(fmt.Sprintf("      … (%d more lines)\n", len(lines)-max))
			break
		}
		sb.WriteString(fmt.Sprintf("      %s %s\n", prefix, line))
	}
}

func formatToolResultStr(sb *strings.Builder, block types.ContentBlock, lastTool string) {
	content := block.Content
	if content == "" {
		return
	}
	isError := strings.HasPrefix(content, "Error: ")
	lines := strings.Split(content, "\n")
	totalLines := len(lines)
	maxLines := 15

	if lastTool == "Bash" {
		if isError {
			sb.WriteString("    ✗ command failed\n")
		} else {
			sb.WriteString("    → output:\n")
		}
	}

	if totalLines > maxLines {
		lines = lines[:maxLines]
	}
	for _, line := range lines {
		sb.WriteString("    ")
		sb.WriteString(line)
		sb.WriteString("\n")
	}
	if totalLines > maxLines {
		sb.WriteString(fmt.Sprintf("    … (%d more lines)\n", totalLines-maxLines))
	}
}

func formatGenericToolStr(sb *strings.Builder, name string, input map[string]interface{}) {
	sb.WriteString(fmt.Sprintf("  ⚡ %s\n", name))
	data, err := json.MarshalIndent(input, "    ", "  ")
	if err != nil {
		sb.WriteString("    (invalid input)\n")
		return
	}
	lines := strings.Split(string(data), "\n")
	maxLines := 30
	for i, line := range lines {
		if i >= maxLines {
			sb.WriteString(fmt.Sprintf("    … (%d more lines)\n", len(lines)-maxLines))
			break
		}
		sb.WriteString("    ")
		sb.WriteString(line)
		sb.WriteString("\n")
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

var hiddenTools = map[string]bool{
	"ExitPlanMode": true, "ExitAskMode": true, "EnterPlanMode": true,
}

// dedupAliases maps MCP tool names to their canonical equivalents for deduplication.
var dedupAliases = map[string]string{
	"mcp__terminal-server__ask_user": "AskUserQuestion",
}

// dedupTools lists tool names whose blocks should be deduplicated across messages.
var dedupTools = map[string]bool{
	"TodoWrite":                      true,
	"AskUserQuestion":                true,
	"mcp__terminal-server__ask_user": true,
}

func toolDedupKey(name string) string {
	if alias, ok := dedupAliases[name]; ok {
		return alias
	}
	return name
}

// deduplicateToolUseBlocks scans messages and returns a set of block IDs that
// should be skipped during rendering (duplicate dedup-tool instances).
// For same-name tools (e.g. TodoWrite), keeps the last. For aliased tools
// (e.g. mcp__terminal-server__ask_user / AskUserQuestion), keeps the first.
func deduplicateToolUseBlocks(messages []types.Message) map[string]bool {
	type entry struct {
		blockID string
		name    string
	}
	bestByKey := map[string]entry{}

	for _, msg := range messages {
		if msg.Role != "assistant" {
			continue
		}
		for _, block := range msg.Content {
			if block.Type != "tool_use" || block.Name == "" || !dedupTools[block.Name] {
				continue
			}
			key := toolDedupKey(block.Name)
			existing, exists := bestByKey[key]
			if exists && existing.name != block.Name {
				continue // alias collision: keep first
			}
			bestByKey[key] = entry{blockID: block.ID, name: block.Name}
		}
	}

	keep := map[string]bool{}
	for _, e := range bestByKey {
		keep[e.blockID] = true
	}

	skip := map[string]bool{}
	for _, msg := range messages {
		if msg.Role != "assistant" {
			continue
		}
		for _, block := range msg.Content {
			if block.Type != "tool_use" || block.Name == "" || !dedupTools[block.Name] {
				continue
			}
			if !keep[block.ID] {
				skip[block.ID] = true
			}
		}
	}
	return skip
}

var lastToolUseName string

func getStr(m map[string]interface{}, keys ...string) string {
	if m == nil {
		return ""
	}
	for _, k := range keys {
		if v, ok := m[k]; ok && v != nil {
			if s, ok := v.(string); ok {
				return s
			}
		}
	}
	return ""
}

func getInt(m map[string]interface{}, keys ...string) (int, bool) {
	if m == nil {
		return 0, false
	}
	for _, k := range keys {
		if v, ok := m[k]; ok && v != nil {
			switch x := v.(type) {
			case float64:
				return int(x), true
			case int:
				return x, true
			}
		}
	}
	return 0, false
}

func getArr(m map[string]interface{}, key string) []interface{} {
	if m == nil {
		return nil
	}
	if v, ok := m[key]; ok && v != nil {
		if arr, ok := v.([]interface{}); ok {
			return arr
		}
	}
	return nil
}

func renderToolUse(block types.ContentBlock) {
	name := block.Name
	if name == "" {
		name = "unknown_tool"
	}
	if hiddenTools[name] {
		return
	}
	lastToolUseName = name
	input := block.Input
	if input == nil {
		input = map[string]interface{}{}
	}

	switch name {
	case "Bash":
		renderBashTool(input)
	case "Write":
		renderWriteTool(input)
	case "Read":
		renderReadTool(input)
	case "Edit", "StrReplace":
		renderEditTool(input)
	case "MultiEdit":
		renderMultiEditTool(input)
	case "TodoWrite":
		renderTodoWriteTool(input)
	case "AskUserQuestion", "mcp__terminal-server__ask_user":
		renderAskQuestionTool(input)
	case "WebSearch":
		renderWebSearchTool(input)
	case "WebFetch":
		renderWebFetchTool(input)
	case "Glob", "Grep":
		renderSearchTool(name, input)
	default:
		renderGenericTool(name, input)
	}
}

func renderBashTool(input map[string]interface{}) {
	toolStyle.Fprintln(ProgressOut, "  ⚡ Bash")
	desc := getStr(input, "description")
	if desc != "" {
		dimStyle.Fprintf(ProgressOut, "    %s\n", desc)
	}
	cmd := getStr(input, "command")
	if cmd != "" {
		dimStyle.Fprintf(ProgressOut, "    $ %s\n", cmd)
	}
}

func renderWriteTool(input map[string]interface{}) {
	path := getStr(input, "file_path", "filePath")
	content := getStr(input, "content")
	lines := 0
	if content != "" {
		lines = len(strings.Split(content, "\n"))
	}
	if path != "" {
		toolStyle.Fprintf(ProgressOut, "  ⚡ Write %s (%d line", path, lines)
		if lines != 1 {
			fmt.Fprint(ProgressOut, "s")
		}
		fmt.Fprintln(ProgressOut, ")")
	} else {
		renderGenericTool("Write", input)
	}
}

func renderReadTool(input map[string]interface{}) {
	path := getStr(input, "file_path", "filePath")
	if path == "" {
		renderGenericTool("Read", input)
		return
	}
	offset, hasOffset := getInt(input, "offset")
	limit, hasLimit := getInt(input, "limit")
	rangeLabel := ""
	if hasOffset && hasLimit {
		rangeLabel = fmt.Sprintf(":%d–%d", offset, offset+limit)
	} else if hasOffset {
		rangeLabel = fmt.Sprintf(":%d", offset)
	}
	toolStyle.Fprintf(ProgressOut, "  ⚡ Read %s%s\n", path, rangeLabel)
}

func renderEditTool(input map[string]interface{}) {
	path := getStr(input, "file_path", "filePath")
	oldStr := getStr(input, "old_string", "oldString")
	newStr := getStr(input, "new_string", "newString")
	if path == "" && oldStr == "" && newStr == "" {
		renderGenericTool("Edit", input)
		return
	}
	toolStyle.Fprintf(ProgressOut, "  ⚡ Edit %s\n", path)
	preview := func(s string, label string, max int) {
		if s == "" {
			return
		}
		lines := strings.Split(s, "\n")
		dimStyle.Fprintf(ProgressOut, "    %s:\n", label)
		for i, line := range lines {
			if i >= max {
				dimStyle.Fprintf(ProgressOut, "      … (%d more lines)\n", len(lines)-max)
				break
			}
			prefix := "-"
			if label == "Added" {
				prefix = "+"
			}
			dimStyle.Fprintf(ProgressOut, "      %s %s\n", prefix, line)
		}
	}
	preview(oldStr, "Removed", 5)
	preview(newStr, "Added", 5)
}

func renderMultiEditTool(input map[string]interface{}) {
	path := getStr(input, "file_path", "filePath")
	edits := getArr(input, "edits")
	if path != "" && len(edits) > 0 {
		toolStyle.Fprintf(ProgressOut, "  ⚡ MultiEdit %s (%d edits)\n", path, len(edits))
	} else {
		renderGenericTool("MultiEdit", input)
	}
}

func renderTodoWriteTool(input map[string]interface{}) {
	todos := getArr(input, "todos")
	if len(todos) == 0 {
		renderGenericTool("TodoWrite", input)
		return
	}
	toolStyle.Fprintln(ProgressOut, "  ⚡ Tasks")
	for _, t := range todos {
		m, ok := t.(map[string]interface{})
		if !ok {
			continue
		}
		content := getStr(m, "content")
		if content == "" {
			content = "(untitled)"
		}
		status := getStr(m, "status")
		icon := "○"
		switch status {
		case "completed":
			icon = "✓"
		case "in_progress":
			icon = "◐"
		case "cancelled":
			icon = "✗"
		}
		dimStyle.Fprintf(ProgressOut, "    [%s] %s\n", icon, content)
	}
}

func renderAskQuestionTool(input map[string]interface{}) {
	questions := getArr(input, "questions")
	if len(questions) == 0 {
		renderGenericTool("AskUserQuestion", input)
		return
	}
	toolStyle.Fprintln(ProgressOut, "  ⚡ Question")
	for _, q := range questions {
		m, ok := q.(map[string]interface{})
		if !ok {
			continue
		}
		header := getStr(m, "header", "question")
		opts := getArr(m, "options")
		labels := []string{}
		for _, o := range opts {
			om, ok := o.(map[string]interface{})
			if ok {
				lbl := getStr(om, "label")
				if lbl != "" {
					labels = append(labels, lbl)
				}
			}
		}
		if header != "" || len(labels) > 0 {
			dimStyle.Fprintf(ProgressOut, "    %s: %s\n", header, strings.Join(labels, ", "))
		}
	}
}

func renderWebSearchTool(input map[string]interface{}) {
	term := getStr(input, "search_term", "searchTerm")
	toolStyle.Fprintf(ProgressOut, "  ⚡ WebSearch: %q\n", term)
}

func renderWebFetchTool(input map[string]interface{}) {
	url := getStr(input, "url")
	prompt := getStr(input, "prompt")
	toolStyle.Fprintf(ProgressOut, "  ⚡ WebFetch %s\n", url)
	if prompt != "" {
		dimStyle.Fprintf(ProgressOut, "    prompt: %s\n", prompt)
	}
}

func renderSearchTool(name string, input map[string]interface{}) {
	pattern := getStr(input, "pattern", "glob_pattern")
	path := getStr(input, "path", "include")
	toolStyle.Fprintf(ProgressOut, "  ⚡ %s ", name)
	dimStyle.Fprintf(ProgressOut, "%q", pattern)
	if path != "" {
		dimStyle.Fprintf(ProgressOut, " in %s", path)
	}
	fmt.Fprintln(ProgressOut)
}

func renderGenericTool(name string, input map[string]interface{}) {
	toolStyle.Fprintf(ProgressOut, "  ⚡ %s\n", name)
	data, err := json.MarshalIndent(input, "    ", "  ")
	if err != nil {
		dimStyle.Fprintf(ProgressOut, "    (invalid input)\n")
		return
	}
	lines := strings.Split(string(data), "\n")
	maxLines := 30
	for i, line := range lines {
		if i >= maxLines {
			dimStyle.Fprintf(ProgressOut, "    … (%d more lines)\n", len(lines)-maxLines)
			break
		}
		dimStyle.Fprintf(ProgressOut, "    %s\n", line)
	}
}

// RenderToolResultBlocks renders tool_result content blocks from a user message.
func RenderToolResultBlocks(blocks []types.ContentBlock) {
	for _, block := range blocks {
		if block.Type == "tool_result" {
			renderToolResult(block)
		}
	}
}

func renderToolResult(block types.ContentBlock) {
	content := block.Content
	if content == "" {
		return
	}

	isError := strings.HasPrefix(content, "Error: ")
	lines := strings.Split(content, "\n")
	totalLines := len(lines)
	maxLines := 15

	if lastToolUseName == "Bash" {
		if isError {
			errorStyle.Fprintln(ProgressOut, "    ✗ command failed")
		} else {
			dimStyle.Fprintln(ProgressOut, "    → output:")
		}
	}

	if totalLines > maxLines {
		lines = lines[:maxLines]
	}

	style := dimStyle
	if isError {
		style = errorStyle
	}

	for _, line := range lines {
		style.Fprintf(ProgressOut, "    %s\n", line)
	}
	if totalLines > maxLines {
		dimStyle.Fprintf(ProgressOut, "    … (%d more lines)\n", totalLines-maxLines)
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
