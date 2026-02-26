package cmd

import (
	"bufio"
	"fmt"
	"os"
	"strings"

	"github.com/apex/cli/internal/db"
	"github.com/fatih/color"
	"github.com/spf13/cobra"
)

var configureCmd = &cobra.Command{
	Use:   "configure",
	Short: "Configure API keys and settings",
	Long:  "Set Anthropic and Daytona API keys. Stored in the shared Apex database.",
	RunE: func(cmd *cobra.Command, args []string) error {
		database, err := db.Open(cfg.DBPath)
		if err != nil {
			return fmt.Errorf("open database: %w", err)
		}
		defer database.Close()

		if err := database.EnsureSettingsTable(); err != nil {
			return fmt.Errorf("ensure settings table: %w", err)
		}

		reader := bufio.NewReader(os.Stdin)

		fmt.Println()
		color.New(color.FgHiWhite, color.Bold).Println("  Apex Configuration")
		color.New(color.Faint).Printf("  Database: %s\n\n", cfg.DBPath)

		anthropicKey := promptInput(reader, "Anthropic API Key", maskKey(cfg.AnthropicKey))
		if anthropicKey != "" {
			cfg.AnthropicKey = anthropicKey
			if err := database.SetSetting("ANTHROPIC_API_KEY", anthropicKey); err != nil {
				return fmt.Errorf("save Anthropic key: %w", err)
			}
		}

		daytonaKey := promptInput(reader, "Daytona API Key", maskKey(cfg.DaytonaKey))
		if daytonaKey != "" {
			cfg.DaytonaKey = daytonaKey
			if err := database.SetSetting("DAYTONA_API_KEY", daytonaKey); err != nil {
				return fmt.Errorf("save Daytona key: %w", err)
			}
		}

		daytonaURL := promptInput(reader, "Daytona API URL", cfg.DaytonaURL)
		if daytonaURL != "" {
			cfg.DaytonaURL = daytonaURL
			if err := database.SetSetting("DAYTONA_API_URL", daytonaURL); err != nil {
				return fmt.Errorf("save Daytona URL: %w", err)
			}
		}

		snapshot := promptInput(reader, "Daytona Snapshot", cfg.Snapshot)
		if snapshot != "" {
			cfg.Snapshot = snapshot
			if err := database.SetSetting("DAYTONA_SNAPSHOT", snapshot); err != nil {
				return fmt.Errorf("save snapshot: %w", err)
			}
		}

		fmt.Println()
		color.New(color.FgGreen).Printf("  Configuration saved to %s\n\n", cfg.DBPath)
		return nil
	},
}

func promptInput(reader *bufio.Reader, label, current string) string {
	if current != "" {
		fmt.Printf("  %s [%s]: ", label, current)
	} else {
		fmt.Printf("  %s: ", label)
	}
	line, _ := reader.ReadString('\n')
	return strings.TrimSpace(line)
}

func maskKey(key string) string {
	if key == "" {
		return ""
	}
	if len(key) <= 8 {
		return "****"
	}
	return key[:4] + "…" + key[len(key)-4:]
}

func init() {
	rootCmd.AddCommand(configureCmd)
}
