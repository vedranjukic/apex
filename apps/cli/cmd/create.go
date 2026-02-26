package cmd

import (
	"bufio"
	"fmt"
	"os"
	"strings"

	"github.com/apex/cli/internal/chat"
	"github.com/apex/cli/internal/db"
	"github.com/fatih/color"
	"github.com/spf13/cobra"
)

var (
	createCmdDesc           string
	createCmdGitRepo        string
	createCmdNonInteractive bool
)

var createCmd = &cobra.Command{
	Use:   "create [project-name]",
	Short: "Create a new project with a sandbox and start a chat session",
	Long: `Create a named project, provision a Daytona sandbox, and open an
interactive chat session.

When run without arguments, prompts for project details first.
Use --non-interactive to create the project and exit without opening a session.`,
	Args: cobra.MaximumNArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		var name, description, gitRepo string

		if len(args) > 0 {
			name = args[0]
			description = createCmdDesc
			gitRepo = createCmdGitRepo
		} else {
			reader := bufio.NewReader(os.Stdin)

			fmt.Println()
			color.New(color.FgHiWhite, color.Bold).Println("  Create a new project")
			fmt.Println()

			fmt.Print("  Project name: ")
			input, _ := reader.ReadString('\n')
			name = strings.TrimSpace(input)
			if name == "" {
				return fmt.Errorf("project name is required")
			}

			fmt.Print("  Description (optional): ")
			input, _ = reader.ReadString('\n')
			description = strings.TrimSpace(input)

			fmt.Print("  Git repo URL (optional): ")
			input, _ = reader.ReadString('\n')
			gitRepo = strings.TrimSpace(input)

			fmt.Println()
		}

		database, err := db.Open(cfg.DBPath)
		if err != nil {
			return fmt.Errorf("open database: %w", err)
		}
		defer database.Close()

		projectRow, manager, err := createProjectWithSandbox(database, name, gitRepo)
		if err != nil {
			return err
		}
		defer manager.Close()

		if description != "" {
			database.UpdateProjectDescription(projectRow.ID, description)
		}

		if createCmdNonInteractive {
			fmt.Println()
			fmt.Printf("  ID:      %s\n", projectRow.ID)
			fmt.Printf("  Name:    %s\n", projectRow.Name)
			fmt.Printf("  Status:  %s\n", projectRow.Status)
			fmt.Printf("  Created: %s\n", projectRow.CreatedAt)
			fmt.Println()
			color.New(color.Faint).Fprintf(chat.ProgressOut, "  Open with: apex open %s\n\n", name)
			return nil
		}

		project := rowToProject(projectRow)
		repl := chat.NewREPL(database, manager, project.ID, project)
		return repl.Run()
	},
}

func init() {
	createCmd.Flags().StringVar(&createCmdDesc, "description", "", "Project description")
	createCmd.Flags().StringVar(&createCmdGitRepo, "git-repo", "", "Git repository URL to clone into the sandbox")
	createCmd.Flags().BoolVar(&createCmdNonInteractive, "non-interactive", false, "Create the project and exit without opening a session")

	rootCmd.AddCommand(createCmd)
}
