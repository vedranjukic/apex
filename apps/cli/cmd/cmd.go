package cmd

import (
	"context"
	"fmt"
	"io"
	"os"

	"github.com/apex/cli/internal/chat"
	"github.com/apex/cli/internal/db"
	"github.com/apex/cli/internal/sandbox"
	"github.com/fatih/color"
	"github.com/spf13/cobra"
)

var cmdVerbose bool

var cmdCmd = &cobra.Command{
	Use:   `cmd <project> <chat-id> <command-or-prompt>`,
	Short: "Run a command or prompt against an existing project and chat",
	Long: `Execute a slash command (like /status, /diff, /cost) or send a prompt
to an existing chat in a project.

The chat-id can be a prefix (e.g. first 8 chars). Use "new" to start a fresh chat.

Examples:
  apex cmd my-app 8d300c0a /status
  apex cmd my-app 8d300c0a /diff
  apex cmd my-app 8d300c0a "implement todo item types"
  apex cmd my-app new "start a new feature"`,
	Args: cobra.ExactArgs(3),
	RunE: func(cmd *cobra.Command, args []string) error {
		projectName := args[0]
		chatID := args[1]
		input := args[2]

		database, err := db.Open(cfg.DBPath)
		if err != nil {
			return fmt.Errorf("open database: %w", err)
		}
		defer database.Close()

		projectRow, err := resolveProject(database, projectName)
		if err != nil {
			return err
		}

		if projectRow.SandboxID == nil || *projectRow.SandboxID == "" {
			return fmt.Errorf("project has no sandbox (status: %s)", projectRow.Status)
		}

		if projectRow.Status == "stopped" {
			color.New(color.FgYellow).Fprintln(os.Stderr, "Warning: Sandbox is stopped. Attempting to reconnect...")
		}

		manager, err := sandbox.NewManager(cfg.AnthropicKey, cfg.DaytonaKey, cfg.DaytonaURL)
		if err != nil {
			return fmt.Errorf("sandbox manager init: %w", err)
		}
		defer manager.Close()

		ctx := context.Background()
		if err := manager.Connect(ctx, *projectRow.SandboxID); err != nil {
			return fmt.Errorf("connect to sandbox: %w", err)
		}

		if cmdVerbose {
			chat.ProgressOut = os.Stderr
		} else {
			chat.ProgressOut = io.Discard
		}

		project := rowToProject(projectRow)
		repl := chat.NewREPL(database, manager, project.ID, project)

		if chatID == "new" {
			chatID = ""
		}

		return repl.RunCommand(chatID, input)
	},
}

func init() {
	cmdCmd.Flags().BoolVarP(&cmdVerbose, "verbose", "v", false, "Show progress (tool calls, cost) on stderr")

	rootCmd.AddCommand(cmdCmd)
}
