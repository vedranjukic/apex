package dashboard

import (
	"context"
	"fmt"
	"strings"

	"github.com/apex/cli/internal/chat"
	"github.com/apex/cli/internal/db"
	"github.com/apex/cli/internal/sandbox"
	"github.com/apex/cli/internal/types"
	"github.com/charmbracelet/bubbles/key"
	"github.com/charmbracelet/bubbles/list"
	"github.com/charmbracelet/bubbles/textinput"
	"github.com/charmbracelet/bubbles/textarea"
	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

const (
	focusProjects = 0
	focusChats    = 1
	focusContent  = 2
	focusPrompt   = 3
)

// truncateRunes truncates s to max runes, appending "..." if truncated.
func truncateRunes(s string, max int) string {
	if max <= 3 {
		return s
	}
	runes := []rune(s)
	if len(runes) <= max {
		return s
	}
	return string(runes[:max-3]) + "..."
}

// ProjectItem implements list.DefaultItem for projects.
type projectItem struct {
	project db.ProjectRow
}

func (i projectItem) Title() string {
	return truncateRunes(i.project.Name, 20)
}
func (i projectItem) Description() string { return i.project.Status + " · " + formatTime(i.project.CreatedAt) }
func (i projectItem) FilterValue() string { return i.project.Name }

// ChatItem implements list.DefaultItem for chats.
type chatItem struct {
	chat db.ChatRow
}

func (i chatItem) Title() string {
	title := i.chat.Title
	if title == "" {
		title = "(empty)"
	}
	return truncateRunes(title, 40)
}
func (i chatItem) Description() string { return formatTime(i.chat.UpdatedAt) }
func (i chatItem) FilterValue() string { return i.chat.Title }

func formatTime(iso string) string {
	if len(iso) >= 10 {
		return iso[:10]
	}
	return iso
}

type model struct {
	db     *db.DB
	cfg    *Config
	width  int
	height int
	focus  int

	projects     []db.ProjectRow
	chats        []db.ChatRow
	projectList  list.Model
	chatList     list.Model
	viewport     viewport.Model
	viewportInit bool

	projectDelegate list.DefaultDelegate
	chatDelegate    list.DefaultDelegate

	lastProjectIdx int
	lastChatIdx    int

	// Prompt panel (when sandbox is running)
	promptInput    textarea.Model
	agentMode      string
	manager        *sandbox.Manager
	connectedProj  string // project ID we're connected to
	streaming        bool
	promptDoneCh     chan promptDoneMsg
	contentUpdatedCh chan string // chatID when new assistant message written to DB
	promptErr        string

	// Create project
	creatingProject   bool   // input panel visible
	projectCreating   bool   // create in progress (block Enter, show status)
	projectNameInput  textinput.Model
	projectCreateErr  string

	// Delete project confirmation
	confirmingDelete  bool   // confirmation dialog visible
	confirmDeleteIdx  int    // project index to delete
	projectDeleteErr  string // error message when delete fails

	// Lipgloss styles
	panelStyle         lipgloss.Style
	focusLineStyle     lipgloss.Style // line under panel when focused
	promptPanelStyle   lipgloss.Style
	promptPanelFocused lipgloss.Style
}

type promptDoneMsg struct {
	chatID string
}

type contentUpdatedMsg struct {
	chatID string
}

type promptConnectErrMsg struct {
	err error
}

type projectCreatedMsg struct {
	project db.ProjectRow
}

type projectCreateErrMsg struct {
	err error
}

type projectDeletedMsg struct {
	projectID string
}

type projectDeleteErrMsg struct {
	err error
}

// NewModel creates a new dashboard TUI model.
func NewModel(database *db.DB, cfg *Config) (*model, error) {
	projDel := list.NewDefaultDelegate()
	projDel.ShowDescription = true
	projDel.SetSpacing(0)
	projDel.SetHeight(2)
	// Initial width; updated in WindowSizeMsg to prevent long names wrapping
	projDel.Styles.NormalTitle = projDel.Styles.NormalTitle.MaxWidth(16)
	projDel.Styles.SelectedTitle = projDel.Styles.SelectedTitle.MaxWidth(16)
	projDel.Styles.DimmedTitle = projDel.Styles.DimmedTitle.MaxWidth(16)

	chatDel := list.NewDefaultDelegate()
	chatDel.ShowDescription = true
	chatDel.SetSpacing(0)
	chatDel.SetHeight(2)
	chatDel.Styles.NormalTitle = chatDel.Styles.NormalTitle.MaxWidth(16)
	chatDel.Styles.SelectedTitle = chatDel.Styles.SelectedTitle.MaxWidth(16)
	chatDel.Styles.DimmedTitle = chatDel.Styles.DimmedTitle.MaxWidth(16)

	projects, err := database.ListProjects(db.DefaultUserID)
	if err != nil {
		return nil, err
	}

	projectItems := make([]list.Item, len(projects))
	for i, p := range projects {
		projectItems[i] = projectItem{project: p}
	}

	projList := list.New(projectItems, projDel, 24, 12)
	projList.Title = "Projects"
	projList.SetShowFilter(false)
	projList.SetFilteringEnabled(false)
	projList.SetShowStatusBar(false)
	projList.SetShowHelp(false)

	chatList := list.New([]list.Item{}, chatDel, 24, 12)
	chatList.Title = "Chats"
	chatList.SetShowFilter(false)
	chatList.SetFilteringEnabled(false)
	chatList.SetShowStatusBar(false)
	chatList.SetShowHelp(false)

	vp := viewport.New(48, 12)
	vp.Style = lipgloss.NewStyle()

	ti := textarea.New()
	ti.Placeholder = "Type a prompt... (Enter to send · Alt+Enter new line)"
	ti.KeyMap.InsertNewline = key.NewBinding(key.WithKeys("alt+enter", "ctrl+m"), key.WithHelp("alt+enter", "new line"))
	ti.SetWidth(60)
	ti.SetHeight(3)
	ti.ShowLineNumbers = false
	ti.Prompt = ""
	// Remove default border/background from textarea
	ti.FocusedStyle.Base = lipgloss.NewStyle()
	ti.BlurredStyle.Base = lipgloss.NewStyle()

	projNameInput := textinput.New()
	projNameInput.Placeholder = "my-project"
	projNameInput.Prompt = "Project name: "
	projNameInput.Width = 40

	m := &model{
		db:              database,
		cfg:             cfg,
		width:           80,
		height:          24,
		focus:           focusProjects,
		projects:        projects,
		projectList:     projList,
		chatList:        chatList,
		viewport:        vp,
		promptInput:     ti,
		agentMode:       "agent",
		projectDelegate: projDel,
		chatDelegate:    chatDel,
		lastProjectIdx:  -1,
		lastChatIdx:     -1,
		promptDoneCh:    make(chan promptDoneMsg, 1),
		contentUpdatedCh: make(chan string, 32),
		panelStyle: lipgloss.NewStyle().Padding(0, 1),
		focusLineStyle: lipgloss.NewStyle().
			Foreground(lipgloss.Color("170")).
			Padding(0, 0),
		promptPanelStyle: lipgloss.NewStyle().Padding(0, 2),
		promptPanelFocused: lipgloss.NewStyle().Padding(0, 2),
		projectNameInput: projNameInput,
	}
	// Initial load: show first project's chats if any
	if len(projects) > 0 {
		m.lastProjectIdx = 0
		m.loadChatsForProject(0)
	} else {
		m.viewport.SetContent("No projects yet. Run: apex project create --name <name>")
	}
	return m, nil
}

func (m model) Init() tea.Cmd {
	return nil
}

// hasPromptPanel returns true when we should show the prompt (project has running sandbox).
func (m *model) hasPromptPanel() bool {
	if len(m.projects) == 0 || m.projectList.Index() < 0 || m.projectList.Index() >= len(m.projects) {
		return false
	}
	p := m.projects[m.projectList.Index()]
	return p.SandboxID != nil && *p.SandboxID != "" && p.Status == "running"
}

func (m *model) selectedProject() *db.ProjectRow {
	if m.projectList.Index() < 0 || m.projectList.Index() >= len(m.projects) {
		return nil
	}
	return &m.projects[m.projectList.Index()]
}

func (m *model) selectedChat() *db.ChatRow {
	if m.chatList.Index() < 0 || m.chatList.Index() >= len(m.chats) {
		return nil
	}
	return &m.chats[m.chatList.Index()]
}

func (m *model) maxFocus() int {
	if m.hasPromptPanel() {
		return 4 // projects, chats, content, prompt
	}
	return 3
}

func (m *model) connectToSandbox() error {
	if m.cfg == nil || !m.cfg.CanConnect() {
		return errNeedsConfig
	}
	p := m.selectedProject()
	if p == nil || p.SandboxID == nil || *p.SandboxID == "" {
		return errNoSandbox
	}
	if m.manager != nil && m.connectedProj == p.ID {
		return nil // already connected
	}
	if m.manager != nil {
		m.manager.Close()
		m.manager = nil
		m.connectedProj = ""
	}
	manager, err := sandbox.NewManager(m.cfg.AnthropicKey, m.cfg.DaytonaKey, m.cfg.DaytonaURL)
	if err != nil {
		return err
	}
	ctx := context.Background()
	if err := manager.Connect(ctx, *p.SandboxID); err != nil {
		return err
	}
	m.manager = manager
	m.connectedProj = p.ID
	return nil
}

var errNeedsConfig = &errConfig{msg: "Run 'apex configure' to set up API keys"}
var errNoSandbox = &errConfig{msg: "Project has no running sandbox"}

type errConfig struct{ msg string }

func (e *errConfig) Error() string { return e.msg }

func (m *model) runDeleteProject(idx int) tea.Cmd {
	if idx < 0 || idx >= len(m.projects) {
		return nil
	}
	proj := m.projects[idx]
	projectID := proj.ID
	sandboxID := proj.SandboxID
	cfg := m.cfg
	db := m.db

	// Close our connection if we're connected to this project
	if m.manager != nil && m.connectedProj == projectID {
		m.manager.Close()
		m.manager = nil
		m.connectedProj = ""
	}

	return func() tea.Msg {
		// Try to delete sandbox first (best effort)
		if sandboxID != nil && *sandboxID != "" && cfg != nil && cfg.CanConnect() {
			manager, err := sandbox.NewManager(cfg.AnthropicKey, cfg.DaytonaKey, cfg.DaytonaURL)
			if err == nil {
				ctx := context.Background()
				_ = manager.DeleteSandbox(ctx, *sandboxID)
				manager.Close()
			}
		}
		if err := db.DeleteProject(projectID); err != nil {
			return projectDeleteErrMsg{err: err}
		}
		return projectDeletedMsg{projectID: projectID}
	}
}

func (m *model) runCreateProject(name string) tea.Cmd {
	userID, err := m.db.EnsureDefaultUser()
	if err != nil {
		return func() tea.Msg { return projectCreateErrMsg{err: fmt.Errorf("ensure user: %w", err)} }
	}
	project, err := m.db.CreateProject(userID, name, "", "claude_code", "", nil)
	if err != nil {
		return func() tea.Msg { return projectCreateErrMsg{err: fmt.Errorf("create project: %w", err)} }
	}
	// Run sandbox provisioning in Cmd (goroutine) so UI stays responsive
	cfg := m.cfg
	db := m.db
	return func() tea.Msg {
		if cfg == nil || !cfg.CanConnect() {
			db.UpdateProjectStatus(project.ID, "stopped", nil, nil)
			proj, _ := db.GetProject(project.ID)
			if proj != nil {
				return projectCreatedMsg{project: *proj}
			}
			return projectCreateErrMsg{err: fmt.Errorf("run 'apex configure' to set up API keys")}
		}
		manager, mErr := sandbox.NewManager(cfg.AnthropicKey, cfg.DaytonaKey, cfg.DaytonaURL)
		if mErr != nil {
			errMsg := mErr.Error()
			db.UpdateProjectStatus(project.ID, "error", nil, &errMsg)
			return projectCreateErrMsg{err: fmt.Errorf("sandbox manager: %w", mErr)}
		}
		defer manager.Close()
		ctx := context.Background()
		sandboxID, sErr := manager.CreateSandbox(ctx, project.SandboxSnapshot, name, "")
		if sErr != nil {
			errMsg := sErr.Error()
			db.UpdateProjectStatus(project.ID, "error", nil, &errMsg)
			return projectCreateErrMsg{err: fmt.Errorf("sandbox: %w", sErr)}
		}
		db.UpdateProjectStatus(project.ID, "running", &sandboxID, nil)
		proj, _ := db.GetProject(project.ID)
		if proj != nil {
			return projectCreatedMsg{project: *proj}
		}
		return projectCreatedMsg{project: *project}
	}
}

func (m *model) trySendPrompt() tea.Cmd {
	if m.streaming {
		return nil
	}
	input := m.promptInput.Value()
	if input == "" {
		m.promptErr = ""
		return nil
	}
	p := m.selectedProject()
	if p == nil {
		m.promptErr = "Select a project"
		return nil
	}
	activeChat := m.selectedChat()
	if activeChat == nil && len(m.chats) > 0 {
		m.promptErr = "Select a chat"
		return nil
	}
	// Create new chat if none selected or list is empty
	if activeChat == nil {
		chatRow, err := m.db.CreateChat(p.ID, input)
		if err != nil {
			m.promptErr = "Failed to create chat"
			return nil
		}
		activeChat = chatRow
		m.loadChatsForProject(m.projectList.Index())
		m.lastChatIdx = 0
	}

	// Add user message to DB
	contentJSON := db.MarshalJSON([]types.ContentBlock{{Type: "text", Text: input}})
	if err := m.db.AddMessage(activeChat.ID, "user", contentJSON, nil); err != nil {
		m.promptErr = "Failed to save message"
		return nil
	}
	m.db.UpdateChatStatus(activeChat.ID, "running")

	// Rename draft chat to prompt (matches tasks.service naming: first 100 chars)
	if activeChat.Title == draftChatTitle {
		title := input
		if len(title) > 100 {
			title = title[:100] + "…"
		}
		m.db.UpdateChatTitle(activeChat.ID, title)
		for i := range m.chats {
			if m.chats[i].ID == activeChat.ID {
				m.chats[i].Title = title
				items := make([]list.Item, len(m.chats))
				for j, c := range m.chats {
					items[j] = chatItem{chat: c}
				}
				m.chatList.SetItems(items)
				break
			}
		}
	}

	sessionID := ""
	if activeChat.ClaudeSessionID != nil {
		sessionID = *activeChat.ClaudeSessionID
	}

	m.promptInput.Reset()
	m.promptErr = ""
	m.streaming = true

	// Run connect + send in Cmd (executed in goroutine by Bubble Tea) so UI stays responsive.
	// Use tea.Batch so we get both: real-time content updates during streaming, and done when complete.
	chatID := activeChat.ID
	contentCh := m.contentUpdatedCh
	doneCh := m.promptDoneCh
	dbCopy := m.db
	onUpdated := func(cid string) {
		select {
		case contentCh <- cid:
		default:
		}
	}

	blockUntilDone := func() tea.Msg {
		if err := m.connectToSandbox(); err != nil {
			return promptConnectErrMsg{err: err}
		}
		if err := m.manager.SendPrompt(chatID, input, sessionID, m.agentMode); err != nil {
			return promptConnectErrMsg{err: fmt.Errorf("send: %w", err)}
		}
		go func() {
			chat.ProcessBridgeToDB(dbCopy, m.manager, chatID, onUpdated)
			select {
			case doneCh <- promptDoneMsg{chatID: chatID}:
			default:
			}
		}()
		return <-doneCh
	}

	waitForContentUpdate := func() tea.Msg {
		return contentUpdatedMsg{chatID: <-contentCh}
	}

	return tea.Batch(blockUntilDone, waitForContentUpdate)
}

func (m *model) loadChatsForProject(index int) {
	if index < 0 || index >= len(m.projects) {
		m.chats = nil
		m.chatList.SetItems([]list.Item{})
		m.viewport.SetContent("Select a project")
		return
	}
	p := m.projects[index]
	chats, err := m.db.ListChats(p.ID)
	if err != nil {
		m.chats = nil
		m.chatList.SetItems([]list.Item{})
		m.viewport.SetContent("Failed to load chats")
		return
	}
	m.chats = chats
	items := make([]list.Item, len(chats))
	for i, c := range chats {
		items[i] = chatItem{chat: c}
	}
	m.chatList.SetItems(items)
	m.chatList.ResetSelected()
	m.lastChatIdx = 0
	if len(chats) > 0 {
		m.loadContentForChat(0)
	} else {
		m.viewport.SetContent("No chats in this project")
	}
}

// syncPanelSizes sets list/viewport sizes. The focused panel gets contentHeight-1
// so there's room for the 1-line focus indicator at the bottom.
func (m *model) syncPanelSizes(col1, col2, col3, listHeight int) {
	projH := listHeight
	if m.focus == focusProjects {
		projH = listHeight - 1
		if projH < 4 {
			projH = 4
		}
	}
	chatH := listHeight
	if m.focus == focusChats {
		chatH = listHeight - 1
		if chatH < 4 {
			chatH = 4
		}
	}
	contentH := listHeight
	if m.focus == focusContent {
		contentH = listHeight - 1
		if contentH < 4 {
			contentH = 4
		}
	}
	m.projectList.SetSize(col1-2, projH)
	m.chatList.SetSize(col2-2, chatH)
	m.viewport.Height = contentH
}

// syncPanelSizesOnFocus recalculates and applies panel sizes from current width/height.
const draftChatTitle = "(draft)"

// ensureDraftChat creates a draft chat if none exists, or selects existing draft. Returns true if a chat is ready.
func (m *model) ensureDraftChat() bool {
	p := m.selectedProject()
	if p == nil || !m.hasPromptPanel() {
		return false
	}
	// If there's already a draft chat, select it
	for i, c := range m.chats {
		if c.Title == draftChatTitle {
			m.chatList.Select(i)
			m.lastChatIdx = i
			return true
		}
	}
	// Create new draft
	chatRow, err := m.db.CreateChat(p.ID, draftChatTitle)
	if err != nil {
		return false
	}
	m.loadChatsForProject(m.projectList.Index())
	m.lastChatIdx = 0
	_ = chatRow
	return true
}

func (m *model) refreshProjects() {
	projects, err := m.db.ListProjects(db.DefaultUserID)
	if err != nil {
		return
	}
	m.projects = projects
	items := make([]list.Item, len(projects))
	for i, p := range projects {
		items[i] = projectItem{project: p}
	}
	m.projectList.SetItems(items)
}

func (m *model) syncPanelSizesOnFocus() {
	col1 := m.width / 4
	col2 := m.width / 4
	col3 := m.width / 2
	if col1 < 12 {
		col1 = 12
	}
	if col2 < 12 {
		col2 = 12
	}
	if col3 < 20 {
		col3 = 20
	}
	listHeight := m.height - 2
	if m.hasPromptPanel() {
		listHeight = m.height - 7
	}
	if listHeight < 6 {
		listHeight = 6
	}
	m.syncPanelSizes(col1, col2, col3, listHeight)
}

func (m *model) waitForContentUpdateCmd() tea.Cmd {
	return func() tea.Msg {
		return contentUpdatedMsg{chatID: <-m.contentUpdatedCh}
	}
}

func (m *model) loadContentForChat(index int) {
	m.refreshContentForChat(index, true)
}

func (m *model) refreshContentForChat(index int, forceBottom bool) {
	if index < 0 || index >= len(m.chats) {
		m.viewport.SetContent("Select a chat")
		return
	}
	c := m.chats[index]
	rows, err := m.db.GetMessages(c.ID)
	if err != nil {
		m.viewport.SetContent("Failed to load messages")
		return
	}
	if len(rows) == 0 {
		m.viewport.SetContent("No messages")
		return
	}
	wasAtBottom := m.viewport.AtBottom()
	msgs := chat.RowsToMessages(rows)
	content := chat.FormatChatHistory(msgs)
	m.viewport.SetContent(content)
	if forceBottom || wasAtBottom {
		m.viewport.GotoBottom()
	}
}

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case promptConnectErrMsg:
		m.promptErr = msg.err.Error()
		m.streaming = false
		return m, nil

	case projectCreatedMsg:
		m.creatingProject = false
		m.projectCreating = false
		m.projectNameInput.Reset()
		m.projectNameInput.Blur()
		m.projectCreateErr = ""
		m.refreshProjects()
		// Select the new project
		for i, p := range m.projects {
			if p.ID == msg.project.ID {
				m.projectList.Select(i)
				m.lastProjectIdx = i
				m.loadChatsForProject(i)
				break
			}
		}
		return m, nil

	case projectCreateErrMsg:
		m.creatingProject = true
		m.projectCreating = false
		m.projectNameInput.Focus()
		m.projectCreateErr = msg.err.Error()
		return m, nil

	case projectDeletedMsg:
		m.confirmingDelete = false
		m.projectDeleteErr = ""
		if m.manager != nil && m.connectedProj == msg.projectID {
			m.manager.Close()
			m.manager = nil
			m.connectedProj = ""
		}
		m.refreshProjects()
		m.chatList.SetItems([]list.Item{})
		m.viewport.SetContent("Select a project")
		if len(m.projects) > 0 {
			// Select previous position or last item
			sel := m.projectList.Index()
			if sel >= len(m.projects) {
				sel = len(m.projects) - 1
			}
			m.projectList.Select(sel)
			m.lastProjectIdx = sel
			m.loadChatsForProject(sel)
		} else {
			m.lastProjectIdx = -1
		}
		return m, nil

	case projectDeleteErrMsg:
		m.confirmingDelete = false
		m.projectDeleteErr = msg.err.Error()
		return m, nil

	case contentUpdatedMsg:
		if m.streaming && m.chatList.Index() >= 0 && m.chatList.Index() < len(m.chats) &&
			m.chats[m.chatList.Index()].ID == msg.chatID {
			m.refreshContentForChat(m.chatList.Index(), false)
		}
		return m, m.waitForContentUpdateCmd()

	case promptDoneMsg:
		m.streaming = false
		if m.chatList.Index() >= 0 && m.chatList.Index() < len(m.chats) {
			m.loadContentForChat(m.chatList.Index())
		}
		if m.projectList.Index() >= 0 && m.projectList.Index() < len(m.projects) {
			m.loadChatsForProject(m.projectList.Index())
		}
		return m, nil

	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		col1 := msg.Width / 4
		col2 := msg.Width / 4
		col3 := msg.Width / 2
		if col1 < 12 {
			col1 = 12
		}
		if col2 < 12 {
			col2 = 12
		}
		if col3 < 20 {
			col3 = 20
		}
		listHeight := msg.Height - 2
		if m.hasPromptPanel() {
			listHeight = msg.Height - 7
		}
		if listHeight < 6 {
			listHeight = 6
		}
		m.syncPanelSizes(col1, col2, col3, listHeight)
		// Enforce width on delegates so long names/descriptions truncate instead of wrapping
		itemW := col1 - 4
		if itemW < 8 {
			itemW = 8
		}
		for _, style := range []*lipgloss.Style{
			&m.projectDelegate.Styles.NormalTitle, &m.projectDelegate.Styles.NormalDesc,
			&m.projectDelegate.Styles.SelectedTitle, &m.projectDelegate.Styles.SelectedDesc,
			&m.projectDelegate.Styles.DimmedTitle, &m.projectDelegate.Styles.DimmedDesc,
		} {
			*style = style.MaxWidth(itemW)
		}
		itemW = col2 - 4
		if itemW < 8 {
			itemW = 8
		}
		for _, style := range []*lipgloss.Style{
			&m.chatDelegate.Styles.NormalTitle, &m.chatDelegate.Styles.NormalDesc,
			&m.chatDelegate.Styles.SelectedTitle, &m.chatDelegate.Styles.SelectedDesc,
			&m.chatDelegate.Styles.DimmedTitle, &m.chatDelegate.Styles.DimmedDesc,
		} {
			*style = style.MaxWidth(itemW)
		}
		m.viewport.Width = col3 - 2
		m.viewportInit = true
		m.promptInput.SetWidth(msg.Width - 4)
		m.projectNameInput.Width = msg.Width - 20
		return m, nil

	case tea.KeyMsg:
		// Clear delete error on any key (dismiss)
		if m.projectDeleteErr != "" && !m.confirmingDelete {
			m.projectDeleteErr = ""
		}

		// Delete confirmation
		if m.confirmingDelete {
			switch msg.String() {
			case "y", "Y":
				if cmd := m.runDeleteProject(m.confirmDeleteIdx); cmd != nil {
					m.confirmingDelete = false
					m.projectDeleteErr = ""
					return m, cmd
				}
			case "n", "N", "enter", "esc":
				m.confirmingDelete = false
				return m, nil
			}
			return m, nil
		}

		// Create project mode
		if m.creatingProject {
			if m.projectCreating {
				// Create in progress: block all input until done
				return m, nil
			}
			switch msg.String() {
			case "esc":
				m.creatingProject = false
				m.projectNameInput.Reset()
				m.projectNameInput.Blur()
				m.projectCreateErr = ""
				return m, nil
			case "enter":
				name := strings.TrimSpace(m.projectNameInput.Value())
				if name != "" {
					if createCmd := m.runCreateProject(name); createCmd != nil {
						m.projectCreating = true
						m.projectCreateErr = ""
						return m, createCmd
					}
				}
				return m, nil
			}
			var inputCmd tea.Cmd
			m.projectNameInput, inputCmd = m.projectNameInput.Update(msg)
			return m, inputCmd
		}

		// When in prompt: Ctrl+keys, Tab; q, enter go to textarea
		if m.focus == focusPrompt {
			switch msg.String() {
			case "ctrl+c":
				if m.manager != nil {
					m.manager.Close()
				}
				return m, tea.Quit
			case "enter":
				if m.hasPromptPanel() {
					if cmd := m.trySendPrompt(); cmd != nil {
						return m, cmd
					}
				}
				return m, nil
			case "tab", "shift+tab":
				maxF := m.maxFocus()
				if msg.String() == "tab" {
					m.focus = (m.focus + 1) % maxF
				} else {
					m.focus = (m.focus + maxF - 1) % maxF
				}
				m.promptInput.Blur()
				if m.focus == focusPrompt {
					m.promptInput.Focus()
				}
				m.syncPanelSizesOnFocus()
				return m, nil
			}
			// All other keys pass through to textarea
		} else {
			// Not in prompt: handle shortcuts
			switch msg.String() {
			case "ctrl+n":
				if m.focus == focusChats && m.hasPromptPanel() {
					// Find or create draft chat, then focus prompt
					if m.ensureDraftChat() {
						m.focus = focusPrompt
						m.promptInput.Focus()
						m.syncPanelSizesOnFocus()
					}
					return m, nil
				}
				// Create new project (when projects panel or no prompt panel)
				m.creatingProject = true
				m.projectNameInput.Reset()
				m.projectNameInput.Focus()
				m.projectNameInput.Width = m.width - 20
				m.projectCreateErr = ""
				return m, nil
			case "q", "ctrl+c":
				if m.manager != nil {
					m.manager.Close()
				}
				return m, tea.Quit
			case "tab", "shift+tab":
				maxF := m.maxFocus()
				if msg.String() == "tab" {
					m.focus = (m.focus + 1) % maxF
				} else {
					m.focus = (m.focus + maxF - 1) % maxF
				}
				if m.focus == focusPrompt {
					m.promptInput.Focus()
				} else {
					m.promptInput.Blur()
				}
				m.syncPanelSizesOnFocus()
				return m, nil
			case "backspace", "delete":
				if m.focus == focusProjects {
					idx := m.projectList.Index()
					if idx >= 0 && idx < len(m.projects) {
						m.confirmingDelete = true
						m.confirmDeleteIdx = idx
						m.projectDeleteErr = ""
						return m, nil
					}
				}
				return m, nil
			case "enter":
				switch m.focus {
				case focusProjects:
					idx := m.projectList.Index()
					if idx >= 0 && idx < len(m.projects) {
						m.loadChatsForProject(idx)
						m.focus = focusChats
					}
					return m, nil
				case focusChats:
					idx := m.chatList.Index()
					if idx >= 0 && idx < len(m.chats) {
						m.loadContentForChat(idx)
						m.focus = focusContent
					}
					return m, nil
				}
			}
		}
	}

	// Route input to focused component
	var cmd tea.Cmd
	switch m.focus {
	case focusProjects:
		m.projectList, cmd = m.projectList.Update(msg)
		if idx := m.projectList.Index(); idx != m.lastProjectIdx && idx >= 0 && idx < len(m.projects) {
			m.lastProjectIdx = idx
			m.loadChatsForProject(idx)
			if m.manager != nil && m.connectedProj != m.projects[idx].ID {
				m.manager.Close()
				m.manager = nil
				m.connectedProj = ""
			}
		}
	case focusChats:
		m.chatList, cmd = m.chatList.Update(msg)
		if idx := m.chatList.Index(); idx != m.lastChatIdx && idx >= 0 && idx < len(m.chats) {
			m.lastChatIdx = idx
			m.loadContentForChat(idx)
		}
	case focusContent:
		m.viewport, cmd = m.viewport.Update(msg)
	case focusPrompt:
		// Auto-create draft chat when typing in prompt with no chats (fresh project)
		if m.hasPromptPanel() && len(m.chats) == 0 && m.selectedProject() != nil {
			m.ensureDraftChat()
		}
		m.promptInput, cmd = m.promptInput.Update(msg)
	}
	return m, cmd
}

func (m model) View() string {
	if m.height <= 0 || m.width <= 0 {
		return ""
	}

	col1 := m.width / 4
	col2 := m.width / 4
	col3 := m.width / 2
	if col1 < 12 {
		col1 = 12
	}
	if col2 < 12 {
		col2 = 12
	}
	if col3 < 20 {
		col3 = 20
	}

	mainHeight := m.height - 2
	if m.hasPromptPanel() {
		mainHeight = m.height - 7
	}
	if mainHeight < 6 {
		mainHeight = 6
	}

	// Render each panel; add focus line at bottom when focused
	projContent := m.projectList.View()
	if m.focus == focusProjects {
		focusLine := m.focusLineStyle.Width(col1 - 2).Render(strings.Repeat("─", col1-2))
		projContent = lipgloss.JoinVertical(lipgloss.Left, projContent, focusLine)
	}
	projView := m.panelStyle.Width(col1).Height(mainHeight).MaxHeight(mainHeight).Render(projContent)

	chatContent := m.chatList.View()
	if m.focus == focusChats {
		focusLine := m.focusLineStyle.Width(col2 - 2).Render(strings.Repeat("─", col2-2))
		chatContent = lipgloss.JoinVertical(lipgloss.Left, chatContent, focusLine)
	}
	chatView := m.panelStyle.Width(col2).Height(mainHeight).MaxHeight(mainHeight).Render(chatContent)

	content := "Select a project and chat"
	if len(m.chats) > 0 && m.chatList.Index() >= 0 && m.chatList.Index() < len(m.chats) {
		content = m.viewport.View()
	} else if m.viewport.TotalLineCount() > 0 {
		content = m.viewport.View()
	}
	if m.focus == focusContent {
		focusLine := m.focusLineStyle.Width(col3 - 2).Render(strings.Repeat("─", col3-2))
		content = lipgloss.JoinVertical(lipgloss.Left, content, focusLine)
	}
	contentView := m.panelStyle.Width(col3).Height(mainHeight).MaxHeight(mainHeight).Render(content)

	layout := lipgloss.JoinHorizontal(lipgloss.Top, projView, chatView, contentView)

	if m.hasPromptPanel() {
		promptStyle := m.promptPanelStyle
		if m.focus == focusPrompt {
			promptStyle = m.promptPanelFocused
		}
		statusText := ""
		if m.streaming {
			statusText = " Thinking..."
		} else if m.promptErr != "" {
			statusText = " " + m.promptErr
		}
		promptContent := lipgloss.JoinVertical(lipgloss.Left,
			m.promptInput.View(),
			lipgloss.NewStyle().Foreground(lipgloss.Color("241")).Render(statusText),
		)
		if m.focus == focusPrompt {
			focusLine := m.focusLineStyle.Width(m.width - 4).Render(strings.Repeat("─", m.width-4))
			promptContent = lipgloss.JoinVertical(lipgloss.Left, promptContent, focusLine)
		}
		promptHeight := 5
		if m.focus == focusPrompt {
			promptHeight = 6
		}
		promptPanel := promptStyle.Width(m.width).Height(promptHeight).Render(promptContent)
		layout = layout + "\n" + promptPanel
	}

	// Create project panel (replaces help when active)
	if m.creatingProject {
		var createContent string
		if m.projectCreating {
			createContent = lipgloss.JoinVertical(lipgloss.Left,
				lipgloss.NewStyle().Foreground(lipgloss.Color("170")).Render("Creating project \""+strings.TrimSpace(m.projectNameInput.Value())+"\"..."),
				lipgloss.NewStyle().Foreground(lipgloss.Color("241")).Render(" Provisioning sandbox... please wait"),
			)
		} else if m.projectCreateErr != "" {
			createContent = lipgloss.JoinVertical(lipgloss.Left,
				m.projectNameInput.View(),
				lipgloss.NewStyle().Foreground(lipgloss.Color("196")).Render(" "+m.projectCreateErr),
				lipgloss.NewStyle().Foreground(lipgloss.Color("241")).Render(" Esc: cancel · Enter: try again"),
			)
		} else {
			createContent = lipgloss.JoinVertical(lipgloss.Left,
				m.projectNameInput.View(),
				lipgloss.NewStyle().Foreground(lipgloss.Color("241")).Render(" Esc: cancel · Enter: create"),
			)
		}
		return layout + "\n" + lipgloss.NewStyle().Padding(0, 1).Render(createContent)
	}

	var helpLine string
	if m.confirmingDelete && m.confirmDeleteIdx >= 0 && m.confirmDeleteIdx < len(m.projects) {
		name := m.projects[m.confirmDeleteIdx].Name
		helpLine = lipgloss.NewStyle().Foreground(lipgloss.Color("170")).Render("Delete \"") +
			lipgloss.NewStyle().Foreground(lipgloss.Color("252")).Render(name) +
			lipgloss.NewStyle().Foreground(lipgloss.Color("170")).Render("\"? ") +
			lipgloss.NewStyle().Foreground(lipgloss.Color("241")).Render("y: yes · N/Esc: cancel")
	} else if m.projectDeleteErr != "" && m.focus == focusProjects {
		helpLine = lipgloss.NewStyle().Foreground(lipgloss.Color("196")).Render("Delete failed: "+m.projectDeleteErr)
	} else {
		help := " Tab: focus · Enter: select · Ctrl+N: new · Backspace: delete · ↑/↓/PgUp/PgDn: scroll · q: quit"
		if m.hasPromptPanel() {
			help = " Tab: focus · Enter: send · Alt+Enter: new line · Ctrl+N: new · Backspace: delete · ↑/↓/PgUp/PgDn: scroll · q: quit"
		}
		helpLine = lipgloss.NewStyle().Foreground(lipgloss.Color("241")).Render(help)
	}
	return layout + "\n" + helpLine
}

// Ensure model implements tea.Model
var _ tea.Model = (*model)(nil)
