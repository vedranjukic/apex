package db

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
	_ "modernc.org/sqlite"
)

const DefaultUserID = "00000000-0000-0000-0000-000000000001"

// DB wraps the SQLite database connection.
type DB struct {
	db   *sqlx.DB
	path string
}

// Path returns the database file path.
func (d *DB) Path() string { return d.path }

// Open opens a connection to the SQLite database at the given path.
// Creates the parent directory if it doesn't exist.
func Open(dbPath string) (*DB, error) {
	if dir := filepath.Dir(dbPath); dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return nil, fmt.Errorf("create db directory: %w", err)
		}
	}

	db, err := sqlx.Open("sqlite", dbPath+"?_pragma=journal_mode(wal)&_pragma=foreign_keys(on)")
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}
	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("ping database: %w", err)
	}
	return &DB{db: db, path: dbPath}, nil
}

// Close closes the database connection.
func (d *DB) Close() error {
	return d.db.Close()
}

// ── Row types matching TypeORM schema ────────────────────

type ProjectRow struct {
	ID              string  `db:"id"`
	UserID          string  `db:"userId"`
	Name            string  `db:"name"`
	Description     string  `db:"description"`
	SandboxID       *string `db:"sandboxId"`
	SandboxSnapshot string  `db:"sandboxSnapshot"`
	Status          string  `db:"status"`
	StatusError     *string `db:"statusError"`
	AgentType       string  `db:"agentType"`
	GitRepo         *string `db:"gitRepo"`
	AgentConfig     *string `db:"agentConfig"`
	ForkedFromID    *string `db:"forkedFromId"`
	BranchName      *string `db:"branchName"`
	CreatedAt       string  `db:"createdAt"`
	UpdatedAt       string  `db:"updatedAt"`
	DeletedAt       *string `db:"deletedAt"`
}

type ChatRow struct {
	ID              string  `db:"id"`
	ProjectID       string  `db:"projectId"`
	Title           string  `db:"title"`
	Status          string  `db:"status"`
	ClaudeSessionID *string `db:"claudeSessionId"`
	Mode            *string `db:"mode"`
	CreatedAt       string  `db:"createdAt"`
	UpdatedAt       string  `db:"updatedAt"`
}

type MessageRow struct {
	ID        string  `db:"id"`
	TaskID    string  `db:"taskId"`
	Role      string  `db:"role"`
	Content   string  `db:"content"`
	Metadata  *string `db:"metadata"`
	CreatedAt string  `db:"createdAt"`
}

// ── Users ────────────────────────────────────────────────

// EnsureDefaultUser creates the default dev user if it doesn't exist, returns the user ID.
func (d *DB) EnsureDefaultUser() (string, error) {
	var count int
	err := d.db.Get(&count, `SELECT COUNT(*) FROM users WHERE id = ?`, DefaultUserID)
	if err != nil {
		return "", fmt.Errorf("check user: %w", err)
	}
	if count == 0 {
		now := nowISO()
		_, err = d.db.Exec(
			`INSERT INTO users (id, email, name, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)`,
			DefaultUserID, "dev@apex.local", "Developer", now, now,
		)
		if err != nil {
			return "", fmt.Errorf("create default user: %w", err)
		}
	}
	return DefaultUserID, nil
}

// ── Projects ─────────────────────────────────────────────

func (d *DB) ListProjects(userID string) ([]ProjectRow, error) {
	var rows []ProjectRow
	err := d.db.Select(&rows, `SELECT * FROM projects WHERE userId = ? ORDER BY createdAt DESC`, userID)
	return rows, err
}

func (d *DB) GetProject(id string) (*ProjectRow, error) {
	var row ProjectRow
	err := d.db.Get(&row, `SELECT * FROM projects WHERE id = ?`, id)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("project not found: %s", id)
	}
	return &row, err
}

func (d *DB) GetProjectByName(name string) (*ProjectRow, error) {
	var row ProjectRow
	err := d.db.Get(&row, `SELECT * FROM projects WHERE name = ? COLLATE NOCASE`, name)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return &row, err
}

func (d *DB) CreateProject(userID, name, description, agentType, snapshot string, gitRepo *string) (*ProjectRow, error) {
	id := uuid.New().String()
	now := nowISO()
	if agentType == "" {
		agentType = "claude_code"
	}
	if snapshot == "" {
		snapshot = os.Getenv("DAYTONA_SNAPSHOT")
	}

	_, err := d.db.Exec(
		`INSERT INTO projects (id, userId, name, description, sandboxSnapshot, status, agentType, gitRepo, createdAt, updatedAt)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, userID, name, description, snapshot, "creating", agentType, gitRepo, now, now,
	)
	if err != nil {
		return nil, fmt.Errorf("create project: %w", err)
	}
	return d.GetProject(id)
}

func (d *DB) UpdateProjectStatus(id, status string, sandboxID *string, statusErr *string) error {
	now := nowISO()
	_, err := d.db.Exec(
		`UPDATE projects SET status = ?, sandboxId = COALESCE(?, sandboxId), statusError = ?, updatedAt = ? WHERE id = ?`,
		status, sandboxID, statusErr, now, id,
	)
	return err
}

func (d *DB) UpdateProjectDescription(id, description string) error {
	now := nowISO()
	_, err := d.db.Exec(`UPDATE projects SET description = ?, updatedAt = ? WHERE id = ?`, description, now, id)
	return err
}

func (d *DB) DeleteProject(id string) error {
	_, err := d.db.Exec(`DELETE FROM projects WHERE id = ?`, id)
	return err
}

// ── Chats ────────────────────────────────────────────────

func (d *DB) ListChats(projectID string) ([]ChatRow, error) {
	var rows []ChatRow
	err := d.db.Select(&rows, `SELECT * FROM tasks WHERE projectId = ? ORDER BY createdAt DESC`, projectID)
	return rows, err
}

func (d *DB) GetChat(id string) (*ChatRow, error) {
	var row ChatRow
	err := d.db.Get(&row, `SELECT * FROM tasks WHERE id = ?`, id)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("chat not found: %s", id)
	}
	return &row, err
}

func (d *DB) CreateChat(projectID, title string) (*ChatRow, error) {
	id := uuid.New().String()
	now := nowISO()
	if len(title) > 100 {
		title = title[:100] + "…"
	}

	_, err := d.db.Exec(
		`INSERT INTO tasks (id, projectId, title, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)`,
		id, projectID, title, "idle", now, now,
	)
	if err != nil {
		return nil, fmt.Errorf("create chat: %w", err)
	}
	return d.GetChat(id)
}

func (d *DB) UpdateChatStatus(id, status string) error {
	now := nowISO()
	_, err := d.db.Exec(`UPDATE tasks SET status = ?, updatedAt = ? WHERE id = ?`, status, now, id)
	return err
}

func (d *DB) UpdateChatSessionID(id, sessionID string) error {
	now := nowISO()
	_, err := d.db.Exec(`UPDATE tasks SET claudeSessionId = ?, updatedAt = ? WHERE id = ?`, sessionID, now, id)
	return err
}

func (d *DB) DeleteChat(id string) error {
	_, err := d.db.Exec(`DELETE FROM tasks WHERE id = ?`, id)
	return err
}

// ── Messages ─────────────────────────────────────────────

func (d *DB) GetMessages(chatID string) ([]MessageRow, error) {
	var rows []MessageRow
	err := d.db.Select(&rows, `SELECT * FROM messages WHERE taskId = ? ORDER BY createdAt ASC`, chatID)
	return rows, err
}

// AddMessage inserts a new message. content and metadata should be JSON strings.
func (d *DB) AddMessage(chatID, role, contentJSON string, metadataJSON *string) error {
	id := uuid.New().String()
	now := nowISO()
	_, err := d.db.Exec(
		`INSERT INTO messages (id, taskId, role, content, metadata, createdAt) VALUES (?, ?, ?, ?, ?, ?)`,
		id, chatID, role, contentJSON, metadataJSON, now,
	)
	return err
}

// ── Schema bootstrap ─────────────────────────────────────

// EnsureTables creates all required tables if they don't already exist.
// Compatible with the TypeORM-managed schema in the NestJS/Electron app.
func (d *DB) EnsureTables() error {
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS "users" (
			"id"        varchar PRIMARY KEY NOT NULL,
			"email"     varchar NOT NULL DEFAULT '',
			"name"      varchar NOT NULL DEFAULT '',
			"createdAt" datetime NOT NULL DEFAULT (datetime('now')),
			"updatedAt" datetime NOT NULL DEFAULT (datetime('now'))
		)`,
		`CREATE TABLE IF NOT EXISTS "projects" (
			"id"              varchar PRIMARY KEY NOT NULL,
			"userId"          varchar NOT NULL,
			"name"            varchar NOT NULL,
			"description"     varchar NOT NULL DEFAULT '',
			"sandboxId"       varchar,
			"sandboxSnapshot" varchar NOT NULL DEFAULT '',
			"status"          varchar NOT NULL DEFAULT 'creating',
			"statusError"     text,
			"agentType"       varchar NOT NULL DEFAULT 'claude_code',
			"gitRepo"         varchar,
			"agentConfig"     text,
			"forkedFromId"    varchar,
			"branchName"      varchar,
			"createdAt"       datetime NOT NULL DEFAULT (datetime('now')),
			"updatedAt"       datetime NOT NULL DEFAULT (datetime('now')),
			"deletedAt"       datetime
		)`,
		`CREATE TABLE IF NOT EXISTS "tasks" (
			"id"              varchar PRIMARY KEY NOT NULL,
			"projectId"       varchar NOT NULL,
			"title"           varchar NOT NULL DEFAULT '',
			"status"          varchar NOT NULL DEFAULT 'idle',
			"claudeSessionId" varchar,
			"mode"            varchar,
			"createdAt"       datetime NOT NULL DEFAULT (datetime('now')),
			"updatedAt"       datetime NOT NULL DEFAULT (datetime('now'))
		)`,
		`CREATE TABLE IF NOT EXISTS "messages" (
			"id"        varchar PRIMARY KEY NOT NULL,
			"taskId"    varchar NOT NULL,
			"role"      varchar NOT NULL,
			"content"   text NOT NULL DEFAULT '[]',
			"metadata"  text,
			"createdAt" datetime NOT NULL DEFAULT (datetime('now'))
		)`,
		`CREATE TABLE IF NOT EXISTS "settings" (
			"key"       varchar PRIMARY KEY NOT NULL,
			"value"     text NOT NULL,
			"updatedAt" datetime NOT NULL DEFAULT (datetime('now'))
		)`,
	}
	for _, stmt := range stmts {
		if _, err := d.db.Exec(stmt); err != nil {
			return fmt.Errorf("ensure tables: %w", err)
		}
	}
	return nil
}

// EnsureSettingsTable creates the settings table if it doesn't already exist.
func (d *DB) EnsureSettingsTable() error {
	_, err := d.db.Exec(`CREATE TABLE IF NOT EXISTS "settings" (
		"key"       varchar PRIMARY KEY NOT NULL,
		"value"     text NOT NULL,
		"updatedAt" datetime NOT NULL DEFAULT (datetime('now'))
	)`)
	return err
}

// GetAllSettings returns all key-value pairs from the settings table.
func (d *DB) GetAllSettings() (map[string]string, error) {
	type row struct {
		Key   string `db:"key"`
		Value string `db:"value"`
	}
	var rows []row
	if err := d.db.Select(&rows, `SELECT "key", "value" FROM "settings"`); err != nil {
		return make(map[string]string), nil
	}
	result := make(map[string]string, len(rows))
	for _, r := range rows {
		result[r.Key] = r.Value
	}
	return result, nil
}

// SetSetting upserts a single setting into the settings table.
func (d *DB) SetSetting(key, value string) error {
	now := nowISO()
	_, err := d.db.Exec(
		`INSERT INTO "settings" ("key", "value", "updatedAt") VALUES (?, ?, ?)
		 ON CONFLICT("key") DO UPDATE SET "value" = excluded."value", "updatedAt" = excluded."updatedAt"`,
		key, value, now,
	)
	return err
}

// ── Helpers ──────────────────────────────────────────────

func nowISO() string {
	return time.Now().UTC().Format("2006-01-02 15:04:05.000")
}

// MarshalJSON marshals a value to a JSON string for storing in the DB.
func MarshalJSON(v interface{}) string {
	b, err := json.Marshal(v)
	if err != nil {
		return "[]"
	}
	return string(b)
}

// MarshalJSONPtr marshals a value to a JSON string pointer (nil for nil input).
func MarshalJSONPtr(v interface{}) *string {
	if v == nil {
		return nil
	}
	s := MarshalJSON(v)
	return &s
}
