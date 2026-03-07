package dashboard

// Config provides sandbox connection settings for the dashboard prompt panel.
type Config struct {
	AnthropicKey string
	DaytonaKey   string
	DaytonaURL   string
}

// CanConnect returns true if we have the keys needed to connect to a sandbox.
func (c *Config) CanConnect() bool {
	return c != nil && c.DaytonaKey != "" && c.AnthropicKey != ""
}
