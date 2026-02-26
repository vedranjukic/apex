package cmd

import (
	"fmt"
	"io"
	"os"

	"github.com/apex/cli/internal/chat"
	"github.com/apex/cli/internal/db"
	"github.com/spf13/cobra"
)

var (
	runGitRepo string
	runVerbose bool
)

var runCmd = &cobra.Command{
	Use:   `run "<prompt>"`,
	Short: "Run a prompt in an ephemeral sandbox (created and destroyed automatically)",
	Long: `Spin up a throwaway sandbox, execute the prompt, and tear everything down.

No project name needed — a temporary project is created behind the scenes
and deleted along with its sandbox once the task completes.

By default only the assistant's text result is printed (stdout).
Use --verbose to also see progress (spinner, tool calls, cost) on stderr.`,
	Args: cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		prompt := args[0]

		database, err := db.Open(cfg.DBPath)
		if err != nil {
			return fmt.Errorf("open database: %w", err)
		}
		defer database.Close()

		if runVerbose {
			chat.ProgressOut = os.Stderr
		} else {
			chat.ProgressOut = io.Discard
		}

		projectRow, manager, err := createProjectWithSandbox(database, "ephemeral", runGitRepo)
		if err != nil {
			return err
		}
		defer manager.Close()

		project := rowToProject(projectRow)
		repl := chat.NewREPL(database, manager, project.ID, project)

		runErr := repl.RunSinglePrompt(prompt)

		cleanupEphemeral(database, manager, projectRow)

		return runErr
	},
}

func init() {
	runCmd.Flags().BoolVarP(&runVerbose, "verbose", "v", false, "Show progress (tool calls, cost) on stderr")
	runCmd.Flags().StringVar(&runGitRepo, "git-repo", "", "Git repository URL to clone into the sandbox")

	rootCmd.AddCommand(runCmd)
}
