package cmd

import (
	"fmt"

	"github.com/apex/cli/internal/db"
	"github.com/fatih/color"
	"github.com/spf13/cobra"
)

var projectListCmd = &cobra.Command{
	Use:     "list",
	Short:   "List all projects",
	Aliases: []string{"ls"},
	RunE: func(cmd *cobra.Command, args []string) error {
		database, err := db.Open(cfg.DBPath)
		if err != nil {
			return fmt.Errorf("open database: %w", err)
		}
		defer database.Close()

		projects, err := database.ListProjects(db.DefaultUserID)
		if err != nil {
			return fmt.Errorf("failed to list projects: %w", err)
		}

		if len(projects) == 0 {
			color.New(color.Faint).Println("No projects yet. Create one with: apex project create --name <name>")
			return nil
		}

		header := color.New(color.Faint)
		header.Printf("  %-10s %-24s %-12s %s\n", "ID", "NAME", "STATUS", "CREATED")

		for _, p := range projects {
			shortID := p.ID
			if len(shortID) > 8 {
				shortID = shortID[:8]
			}
			fmt.Printf("  %-10s %-24s %-12s %s\n", shortID, p.Name, p.Status, formatTime(p.CreatedAt))
		}
		return nil
	},
}

func formatTime(iso string) string {
	if len(iso) >= 10 {
		return iso[:10]
	}
	return iso
}
