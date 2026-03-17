package cmd

import (
	"fmt"

	"github.com/apex/cli/internal/config"
	"github.com/apex/cli/internal/dashboard"
	"github.com/apex/cli/internal/db"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/spf13/cobra"
)

var dashboardCmd = &cobra.Command{
	Use:   "dashboard",
	Short: "Interactive overview of projects and threads",
	Long:  `Open an interactive TUI to browse projects, threads, and thread content.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		dbPath := config.ResolveDBPath(cfgDBPath)
		database, err := db.Open(dbPath)
		if err != nil {
			return fmt.Errorf("open database: %w", err)
		}
		defer database.Close()

		if err := database.EnsureTables(); err != nil {
			return fmt.Errorf("ensure tables: %w", err)
		}

		dcfg := &dashboard.Config{
			AnthropicKey: cfg.AnthropicKey,
			DaytonaKey:   cfg.DaytonaKey,
			DaytonaURL:   cfg.DaytonaURL,
		}
		m, err := dashboard.NewModel(database, dcfg)
		if err != nil {
			return fmt.Errorf("init dashboard: %w", err)
		}

		p := tea.NewProgram(m, tea.WithAltScreen())
		if _, err := p.Run(); err != nil {
			return fmt.Errorf("run dashboard: %w", err)
		}
		return nil
	},
}

func init() {
	rootCmd.AddCommand(dashboardCmd)
}
