package cmd

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/briandowns/spinner"
	"github.com/apex/cli/internal/db"
	"github.com/apex/cli/internal/sandbox"
	"github.com/fatih/color"
	"github.com/spf13/cobra"
)

var (
	createName        string
	createDescription string
	createGitRepo     string
)

var projectCreateCmd = &cobra.Command{
	Use:   "create",
	Short: "Create a new project",
	RunE: func(cmd *cobra.Command, args []string) error {
		if createName == "" {
			return fmt.Errorf("--name is required")
		}

		database, err := db.Open(cfg.DBPath)
		if err != nil {
			return fmt.Errorf("open database: %w", err)
		}
		defer database.Close()

		userID, err := database.EnsureDefaultUser()
		if err != nil {
			return fmt.Errorf("ensure user: %w", err)
		}

		var gitRepo *string
		if createGitRepo != "" {
			gitRepo = &createGitRepo
		}

		fmt.Printf("Creating project %q...\n", createName)
		project, err := database.CreateProject(userID, createName, createDescription, "claude_code", "", gitRepo)
		if err != nil {
			return fmt.Errorf("failed to create project: %w", err)
		}

		fmt.Printf("Project created: %s\n", project.ID)

		// Provision sandbox
		if cfg.AnthropicKey == "" {
			color.New(color.FgYellow).Println("Warning: ANTHROPIC_API_KEY not set. Skipping sandbox provisioning.")
			database.UpdateProjectStatus(project.ID, "stopped", nil, nil)
		} else {
			s := spinner.New(spinner.CharSets[14], 100*time.Millisecond)
			s.Suffix = " Provisioning sandbox..."
			s.Writer = os.Stderr
			s.Start()

			manager, mErr := sandbox.NewManager(cfg.AnthropicKey, cfg.DaytonaKey, cfg.DaytonaURL)
			if mErr != nil {
				s.Stop()
				errMsg := mErr.Error()
				database.UpdateProjectStatus(project.ID, "error", nil, &errMsg)
				return fmt.Errorf("sandbox manager init: %w", mErr)
			}
			defer manager.Close()

			ctx := context.Background()
			sandboxID, sErr := manager.CreateSandbox(ctx, project.SandboxSnapshot, createName, createGitRepo)
			if sErr != nil {
				s.Stop()
				errMsg := sErr.Error()
				database.UpdateProjectStatus(project.ID, "error", nil, &errMsg)
				return fmt.Errorf("sandbox provisioning failed: %w", sErr)
			}

			s.Stop()
			database.UpdateProjectStatus(project.ID, "running", &sandboxID, nil)
			color.New(color.FgGreen).Println("Sandbox is ready!")
		}

		project, _ = database.GetProject(project.ID)
		printProjectInfo(project.ID, project.Name, project.Status, project.CreatedAt)
		return nil
	},
}

func printProjectInfo(id, name, status, created string) {
	fmt.Println()
	fmt.Printf("  ID:      %s\n", id)
	fmt.Printf("  Name:    %s\n", name)
	fmt.Printf("  Status:  %s\n", status)
	fmt.Printf("  Created: %s\n", created)
	fmt.Println()
	color.New(color.Faint).Printf("  Open with: apex open %s\n\n", name)
}

func init() {
	projectCreateCmd.Flags().StringVar(&createName, "name", "", "Project name (required)")
	projectCreateCmd.Flags().StringVar(&createDescription, "description", "", "Project description")
	projectCreateCmd.Flags().StringVar(&createGitRepo, "git-repo", "", "Git repository URL to clone")
	projectCreateCmd.MarkFlagRequired("name")
}
