package cmd

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"strings"

	"github.com/apex/cli/internal/db"
	"github.com/apex/cli/internal/sandbox"
	"github.com/fatih/color"
	"github.com/spf13/cobra"
)

var deleteForce bool

var projectDeleteCmd = &cobra.Command{
	Use:   "delete <project-id-or-name>",
	Short: "Delete a project",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		database, err := db.Open(cfg.DBPath)
		if err != nil {
			return fmt.Errorf("open database: %w", err)
		}
		defer database.Close()

		identifier := args[0]
		project, err := resolveProject(database, identifier)
		if err != nil {
			return err
		}

		if !deleteForce {
			shortID := project.ID
			if len(shortID) > 8 {
				shortID = shortID[:8]
			}
			fmt.Printf("Delete project %q (%s)? [y/N] ", project.Name, shortID)
			reader := bufio.NewReader(os.Stdin)
			response, _ := reader.ReadString('\n')
			response = strings.TrimSpace(strings.ToLower(response))
			if response != "y" && response != "yes" {
				fmt.Println("Cancelled.")
				return nil
			}
		}

		// Delete sandbox if exists
		if project.SandboxID != nil && *project.SandboxID != "" {
			manager, mErr := sandbox.NewManager(cfg.AnthropicKey, cfg.DaytonaKey, cfg.DaytonaURL)
			if mErr == nil {
				ctx := context.Background()
				if dErr := manager.DeleteSandbox(ctx, *project.SandboxID); dErr != nil {
					color.New(color.FgYellow).Printf("Warning: failed to delete sandbox: %v\n", dErr)
				}
			}
		}

		if err := database.DeleteProject(project.ID); err != nil {
			return fmt.Errorf("failed to delete project: %w", err)
		}

		color.New(color.FgGreen).Printf("Project %q deleted.\n", project.Name)
		return nil
	},
}

func init() {
	projectDeleteCmd.Flags().BoolVarP(&deleteForce, "force", "f", false, "Skip confirmation")
}
