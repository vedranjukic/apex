package config

import (
	"os"
	"path/filepath"
	"runtime"
)

const (
	appName      = "Apex"
	dbFileName   = "apex.sqlite"
	devDBRelPath = "data/apex.sqlite"
)

type Config struct {
	DBPath       string
	AnthropicKey string
	DaytonaKey   string
	DaytonaURL   string
	Snapshot     string
}

// ResolveDBPath determines the SQLite database path with priority:
// 1. CLI flag
// 2. APEX_DB_PATH environment variable
// 3. Dev workspace (walk up from CWD looking for data/apex.sqlite)
// 4. Electron-compatible userData directory
func ResolveDBPath(flagDBPath string) string {
	if flagDBPath != "" {
		return flagDBPath
	}
	if env := os.Getenv("APEX_DB_PATH"); env != "" {
		return env
	}
	if p := findDevDBPath(); p != "" {
		return p
	}
	return filepath.Join(AppDataDir(), dbFileName)
}

// AppDataDir returns the Electron-compatible userData directory.
// Matches Electron's app.getPath('userData') so both apps share the same DB.
//   - macOS:   ~/Library/Application Support/Apex
//   - Linux:   $XDG_CONFIG_HOME/Apex  (default ~/.config/Apex)
//   - Windows: %APPDATA%/Apex
func AppDataDir() string {
	switch runtime.GOOS {
	case "darwin":
		home, _ := os.UserHomeDir()
		return filepath.Join(home, "Library", "Application Support", appName)
	case "windows":
		appData := os.Getenv("APPDATA")
		if appData == "" {
			home, _ := os.UserHomeDir()
			appData = filepath.Join(home, "AppData", "Roaming")
		}
		return filepath.Join(appData, appName)
	default:
		if xdg := os.Getenv("XDG_CONFIG_HOME"); xdg != "" {
			return filepath.Join(xdg, appName)
		}
		home, _ := os.UserHomeDir()
		return filepath.Join(home, ".config", appName)
	}
}

// FromSettings builds a Config from DB settings, then applies env-var overrides.
func FromSettings(dbPath string, settings map[string]string) *Config {
	if settings == nil {
		settings = make(map[string]string)
	}
	cfg := &Config{
		DBPath:       dbPath,
		AnthropicKey: settings["ANTHROPIC_API_KEY"],
		DaytonaKey:   settings["DAYTONA_API_KEY"],
		DaytonaURL:   settings["DAYTONA_API_URL"],
		Snapshot:     settings["DAYTONA_SNAPSHOT"],
	}

	if env := os.Getenv("ANTHROPIC_API_KEY"); env != "" {
		cfg.AnthropicKey = env
	}
	if env := os.Getenv("DAYTONA_API_KEY"); env != "" {
		cfg.DaytonaKey = env
	}
	if env := os.Getenv("DAYTONA_API_URL"); env != "" {
		cfg.DaytonaURL = env
	}
	if env := os.Getenv("DAYTONA_SNAPSHOT"); env != "" {
		cfg.Snapshot = env
	}

	return cfg
}

// NeedsSetup returns true if required API keys are missing.
func (c *Config) NeedsSetup() bool {
	return c.AnthropicKey == "" || c.DaytonaKey == ""
}

func findDevDBPath() string {
	dir, err := os.Getwd()
	if err != nil {
		return ""
	}
	for {
		candidate := filepath.Join(dir, devDBRelPath)
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return ""
}
