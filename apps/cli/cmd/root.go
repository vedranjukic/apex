package cmd

import (
	"bufio"
	"fmt"
	"os"
	"strings"

	"github.com/apex/cli/internal/config"
	"github.com/apex/cli/internal/db"
	"github.com/fatih/color"
	"github.com/spf13/cobra"
)

var (
	// Set via -ldflags "-X github.com/apex/cli/cmd.Version=x.y.z"
	Version = "dev"

	cfgDBPath string
	cfg       *config.Config
)

var rootCmd = &cobra.Command{
	Use:     "apex",
	Short:   "Apex CLI — Claude Code in Daytona sandboxes",
	Long: `Apex CLI — Claude Code in Daytona sandboxes.

Quick start:
  apex configure                              Set up API keys (first time)
  apex run "fix the failing tests"            Ephemeral — run and tear down
  apex run "fix tests" -v                     With progress output
  apex run "build a REST API" --git-repo URL  Ephemeral with a git repo
  apex open my-project                        Interactive chat session
  apex open my-project -p "add auth"          Run a prompt and exit
  apex create my-project                      Create a project + open session
  apex create my-project --git-repo URL       Create from a git repo
  apex cmd my-project 8d300c0a "add tests"    Send prompt to existing chat
  apex cmd my-project 8d300c0a /status        Run a slash command
  apex project list                           List all projects`,
	Version: Version,
	PersistentPreRunE: func(cmd *cobra.Command, args []string) error {
		dbPath := config.ResolveDBPath(cfgDBPath)

		database, err := db.Open(dbPath)
		if err != nil {
			cfg = config.FromSettings(dbPath, nil)
			return nil
		}
		defer database.Close()

		if err := database.EnsureTables(); err != nil {
			cfg = config.FromSettings(dbPath, nil)
			return nil
		}

		settings, _ := database.GetAllSettings()
		cfg = config.FromSettings(dbPath, settings)

		if cmd.Name() == "configure" {
			return nil
		}

		// Only prompt on commands that actually do work (have RunE/Run set)
		if cfg.NeedsSetup() && (cmd.RunE != nil || cmd.Run != nil) {
			if !isInteractive() {
				return fmt.Errorf("API keys not configured. Run 'apex configure' to set up\n  Database: %s", cfg.DBPath)
			}
			color.New(color.Faint).Fprintf(os.Stderr, "  Database: %s\n", cfg.DBPath)
			return runFirstTimeSetup(database)
		}

		return nil
	},
}

func Execute() {
	if err := rootCmd.Execute(); err != nil {
		os.Exit(1)
	}
}

func init() {
	rootCmd.PersistentFlags().StringVar(&cfgDBPath, "db-path", "", "Path to SQLite database")

	rootCmd.AddCommand(projectCmd)
	rootCmd.AddCommand(openCmd)
}

func runFirstTimeSetup(database *db.DB) error {
	fmt.Println()
	color.New(color.FgHiWhite, color.Bold).Println("  Welcome to Apex CLI!")
	color.New(color.Faint).Println("  Let's configure your API keys to get started.")
	fmt.Println()

	reader := bufio.NewReader(os.Stdin)

	if cfg.DaytonaKey == "" {
		fmt.Print("  Daytona API Key: ")
		key, _ := reader.ReadString('\n')
		key = strings.TrimSpace(key)
		if key == "" {
			return fmt.Errorf("Daytona API key is required. Run 'apex configure' to set it up")
		}
		if err := database.SetSetting("DAYTONA_API_KEY", key); err != nil {
			return fmt.Errorf("save Daytona key: %w", err)
		}
		cfg.DaytonaKey = key
	}

	if cfg.AnthropicKey == "" {
		fmt.Print("  Anthropic API Key: ")
		key, _ := reader.ReadString('\n')
		key = strings.TrimSpace(key)
		if key == "" {
			return fmt.Errorf("Anthropic API key is required. Run 'apex configure' to set it up")
		}
		if err := database.SetSetting("ANTHROPIC_API_KEY", key); err != nil {
			return fmt.Errorf("save Anthropic key: %w", err)
		}
		cfg.AnthropicKey = key
	}

	if cfg.DaytonaURL == "" {
		defaultURL := "https://app.daytona.io/api"
		fmt.Printf("  Daytona API URL [%s]: ", defaultURL)
		url, _ := reader.ReadString('\n')
		url = strings.TrimSpace(url)
		if url == "" {
			url = defaultURL
		}
		if err := database.SetSetting("DAYTONA_API_URL", url); err != nil {
			return fmt.Errorf("save Daytona URL: %w", err)
		}
		cfg.DaytonaURL = url
	}

	fmt.Println()
	color.New(color.FgGreen).Println("  Configuration saved!")
	color.New(color.Faint).Printf("  Database: %s\n\n", cfg.DBPath)

	return nil
}

func isInteractive() bool {
	fi, err := os.Stdin.Stat()
	if err != nil {
		return false
	}
	return fi.Mode()&os.ModeCharDevice != 0
}
