package cmd

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/briandowns/spinner"
	"github.com/apex/cli/internal/chat"
	"github.com/apex/cli/internal/db"
	"github.com/apex/cli/internal/sandbox"
	"github.com/apex/cli/internal/types"
	"github.com/fatih/color"
	"github.com/spf13/cobra"
)

var (
	openPrompt  string
	openGitRepo string
	openStream  bool
)

var openCmd = &cobra.Command{
	Use:   "open <project-id-or-name>",
	Short: "Open a project — interactive or one-shot (-p)",
	Long: `Open an existing project or create a new one on the fly.

If the project doesn't exist and --prompt is provided, a new project
with a sandbox is provisioned automatically.

For throwaway one-shot tasks, use "apex run" instead.`,
	Args: cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		database, err := db.Open(cfg.DBPath)
		if err != nil {
			return fmt.Errorf("open database: %w", err)
		}
		defer database.Close()

		identifier := args[0]

		var projectRow *db.ProjectRow
		var manager *sandbox.Manager
		var created bool

		projectRow, err = resolveProject(database, identifier)
		if err != nil {
			if openPrompt == "" {
				return err
			}
			projectRow, manager, err = createProjectWithSandbox(database, identifier, openGitRepo)
			if err != nil {
				return err
			}
			created = true
		}

		if !created {
			if err := waitForSandbox(database, &projectRow); err != nil {
				return err
			}

			if projectRow.Status == "error" {
				errMsg := "unknown"
				if projectRow.StatusError != nil {
					errMsg = *projectRow.StatusError
				}
				return fmt.Errorf("project sandbox is in error state: %s", errMsg)
			}

			if projectRow.SandboxID == nil || *projectRow.SandboxID == "" {
				return fmt.Errorf("project has no sandbox (status: %s)", projectRow.Status)
			}

			if projectRow.Status == "stopped" {
				color.New(color.FgYellow).Println("Warning: Sandbox is stopped. Attempting to reconnect...")
			}

			manager, err = sandbox.NewManager(cfg.AnthropicKey, cfg.DaytonaKey, cfg.DaytonaURL)
			if err != nil {
				return fmt.Errorf("sandbox manager init: %w", err)
			}

			ctx := context.Background()
			if err := manager.Connect(ctx, *projectRow.SandboxID); err != nil {
				return fmt.Errorf("connect to sandbox: %w", err)
			}
		}

		defer manager.Close()

		if openStream {
			chat.ProgressOut = os.Stderr
		}

		project := rowToProject(projectRow)
		repl := chat.NewREPL(database, manager, project.ID, project)

		if openPrompt != "" {
			return repl.RunSinglePrompt(openPrompt)
		}
		return repl.Run()
	},
}

func init() {
	openCmd.Flags().StringVarP(&openPrompt, "prompt", "p", "", "Send a prompt, run the agent, and exit")
	openCmd.Flags().BoolVarP(&openStream, "stream", "s", false, "Stream task progress to stderr; keeps stdout clean for result output")
	openCmd.Flags().StringVar(&openGitRepo, "git-repo", "", "Git repository URL to clone (used when creating a new project)")
}

// createProjectWithSandbox creates a new project record, provisions a sandbox,
// and returns the project row and a connected manager.
func createProjectWithSandbox(database *db.DB, name, gitRepoURL string) (*db.ProjectRow, *sandbox.Manager, error) {
	userID, err := database.EnsureDefaultUser()
	if err != nil {
		return nil, nil, fmt.Errorf("ensure user: %w", err)
	}

	var gitRepo *string
	if gitRepoURL != "" {
		gitRepo = &gitRepoURL
	}

	projectRow, err := database.CreateProject(userID, name, "", "claude_code", cfg.Snapshot, gitRepo)
	if err != nil {
		return nil, nil, fmt.Errorf("create project: %w", err)
	}

	s := spinner.New(spinner.CharSets[14], 100*time.Millisecond)
	s.Suffix = " Provisioning sandbox..."
	s.Writer = os.Stderr
	s.Start()

	manager, mErr := sandbox.NewManager(cfg.AnthropicKey, cfg.DaytonaKey, cfg.DaytonaURL)
	if mErr != nil {
		s.Stop()
		errMsg := mErr.Error()
		database.UpdateProjectStatus(projectRow.ID, "error", nil, &errMsg)
		return nil, nil, fmt.Errorf("sandbox manager init: %w", mErr)
	}

	ctx := context.Background()
	sandboxID, sErr := manager.CreateSandbox(ctx, projectRow.SandboxSnapshot, name, gitRepoURL)
	if sErr != nil {
		s.Stop()
		errMsg := sErr.Error()
		database.UpdateProjectStatus(projectRow.ID, "error", nil, &errMsg)
		return nil, nil, fmt.Errorf("sandbox provisioning failed: %w", sErr)
	}

	s.Stop()
	database.UpdateProjectStatus(projectRow.ID, "running", &sandboxID, nil)
	color.New(color.FgGreen).Fprintln(chat.ProgressOut, "Sandbox is ready!")

	projectRow, _ = database.GetProject(projectRow.ID)
	return projectRow, manager, nil
}

// waitForSandbox polls the DB until the sandbox reaches a terminal state.
func waitForSandbox(database *db.DB, row **db.ProjectRow) error {
	if (*row).Status != "creating" && (*row).Status != "starting" {
		return nil
	}

	s := spinner.New(spinner.CharSets[14], 100*time.Millisecond)
	s.Suffix = " Waiting for sandbox..."
	s.Writer = os.Stderr
	s.Start()

	for {
		time.Sleep(3 * time.Second)
		updated, err := database.GetProject((*row).ID)
		if err != nil {
			s.Stop()
			return fmt.Errorf("failed to check project status: %w", err)
		}
		if updated.Status == "running" {
			s.Stop()
			*row = updated
			return nil
		}
		if updated.Status == "error" {
			s.Stop()
			errMsg := "unknown error"
			if updated.StatusError != nil {
				errMsg = *updated.StatusError
			}
			return fmt.Errorf("sandbox failed: %s", errMsg)
		}
	}
}

// cleanupEphemeral tears down the sandbox and removes the project record.
func cleanupEphemeral(database *db.DB, manager *sandbox.Manager, row *db.ProjectRow) {
	fmt.Fprintln(chat.ProgressOut)
	s := spinner.New(spinner.CharSets[14], 100*time.Millisecond)
	s.Suffix = " Destroying ephemeral sandbox..."
	s.Writer = os.Stderr
	s.Start()

	if row.SandboxID != nil && *row.SandboxID != "" {
		ctx := context.Background()
		if err := manager.DeleteSandbox(ctx, *row.SandboxID); err != nil {
			s.Stop()
			color.New(color.FgYellow).Fprintf(chat.ProgressOut, "Warning: failed to delete sandbox: %v\n", err)
		}
	}

	database.DeleteProject(row.ID)
	s.Stop()
	color.New(color.FgGreen).Fprintln(chat.ProgressOut, "Ephemeral sandbox destroyed.")
}

// resolveProject finds a project by exact ID or by name prefix match.
func resolveProject(database *db.DB, identifier string) (*db.ProjectRow, error) {
	project, err := database.GetProject(identifier)
	if err == nil {
		return project, nil
	}

	project, err = database.GetProjectByName(identifier)
	if err == nil && project != nil {
		return project, nil
	}

	projects, listErr := database.ListProjects(db.DefaultUserID)
	if listErr != nil {
		return nil, fmt.Errorf("failed to list projects: %w", listErr)
	}

	var matches []db.ProjectRow
	lower := strings.ToLower(identifier)
	for _, p := range projects {
		if strings.HasPrefix(strings.ToLower(p.Name), lower) ||
			strings.HasPrefix(p.ID, identifier) {
			matches = append(matches, p)
		}
	}

	if len(matches) == 1 {
		return &matches[0], nil
	}
	if len(matches) > 1 {
		names := make([]string, len(matches))
		for i, m := range matches {
			shortID := m.ID
			if len(shortID) > 8 {
				shortID = shortID[:8]
			}
			names[i] = fmt.Sprintf("  %s (%s)", m.Name, shortID)
		}
		return nil, fmt.Errorf("ambiguous project name %q, matches:\n%s", identifier, strings.Join(names, "\n"))
	}

	return nil, fmt.Errorf("project not found: %s", identifier)
}

func rowToProject(row *db.ProjectRow) *types.Project {
	return &types.Project{
		ID:          row.ID,
		UserID:      row.UserID,
		Name:        row.Name,
		Description: row.Description,
		SandboxID:   row.SandboxID,
		Status:      row.Status,
		StatusError: row.StatusError,
		AgentType:   row.AgentType,
		GitRepo:     row.GitRepo,
		CreatedAt:   row.CreatedAt,
		UpdatedAt:   row.UpdatedAt,
	}
}
