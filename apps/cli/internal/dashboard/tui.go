package dashboard

import (
	"context"
	"fmt"
	"io"
	"strings"

	"github.com/apex/cli/internal/thread"
	"github.com/apex/cli/internal/db"
	"github.com/apex/cli/internal/sandbox"
	"github.com/apex/cli/internal/types"
	"github.com/charmbracelet/bubbles/key"
	"github.com/charmbracelet/bubbles/list"
	"github.com/charmbracelet/bubbles/textarea"
	"github.com/charmbracelet/bubbles/textinput"
	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

const (
	focusList    = 0
	focusContent = 1
	focusPrompt  = 2
)

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

func formatTime(iso string) string {
	if len(iso) >= 10 {
		return iso[:10]
	}
	return iso
}

// treeItem represents either a project header or a thread entry in the unified tree list.
type treeItem struct {
	isProject  bool
	expanded   bool
	project    db.ProjectRow
	thread     db.ThreadRow
	projectIdx int
}

func (i treeItem) FilterValue() string {
	if i.isProject {
		return i.project.Name
	}
	return i.thread.Title
}

// treeDelegate renders tree items: projects as bold headers with expand arrows,
// threads indented underneath.
type treeDelegate struct{}

func (d treeDelegate) Height() int                             { return 1 }
func (d treeDelegate) Spacing() int                            { return 0 }
func (d treeDelegate) Update(_ tea.Msg, _ *list.Model) tea.Cmd { return nil }

func threadStatusIndicator(status string) (symbol string, color lipgloss.Color) {
	switch status {
	case "running":
		return "●", lipgloss.Color("214") // yellow/orange
	case "waiting_for_input":
		return "?", lipgloss.Color("214") // yellow/orange question mark
	case "completed":
		return "✓", lipgloss.Color("76") // green
	case "error":
		return "✗", lipgloss.Color("196") // red
	default:
		return "○", lipgloss.Color("243") // dim gray
	}
}

func (d treeDelegate) Render(w io.Writer, m list.Model, index int, item list.Item) {
	ti, ok := item.(treeItem)
	if !ok {
		return
	}

	selected := index == m.Index()
	width := m.Width()
	if width <= 0 {
		width = 30
	}

	var line string
	if ti.isProject {
		arrow := "▶"
		if ti.expanded {
			arrow = "▼"
		}
		name := truncateRunes(ti.project.Name, width-14)
		status := ti.project.Status
		left := arrow + " " + name
		right := status
		pad := width - lipgloss.Width(left) - lipgloss.Width(right)
		if pad < 1 {
			pad = 1
		}
		raw := left + strings.Repeat(" ", pad) + right
		if selected {
			line = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("170")).Render(raw)
		} else {
			line = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("252")).Render(raw)
		}
	} else {
		title := ti.thread.Title
		if title == "" {
			title = "(empty)"
		}
		symbol, symbolColor := threadStatusIndicator(ti.thread.Status)
		title = truncateRunes(title, width-6)

		indent := "   "
		textColor := lipgloss.Color("245")
		if selected {
			textColor = lipgloss.Color("170")
		}

		line = lipgloss.NewStyle().Foreground(textColor).Render(indent) +
			lipgloss.NewStyle().Foreground(symbolColor).Render(symbol+" ") +
			lipgloss.NewStyle().Foreground(textColor).Render(title)
	}

	fmt.Fprint(w, line)
}

type model struct {
	db     *db.DB
	cfg    *Config
	width  int
	height int
	focus  int

	projects     []db.ProjectRow
	projectThreads map[string][]db.ThreadRow
	expanded     map[string]bool
	treeItems    []treeItem
	treeList     list.Model
	viewport     viewport.Model
	viewportInit bool
	viewingThreadID string
	fullscreen   bool

	// Prompt panel (when sandbox is running)
	promptInput      textarea.Model
	agentMode        string
	manager          *sandbox.Manager
	connectedProj    string
	streamingThreadID  string // thread ID currently streaming, empty if none
	waitingForAnswer bool
	pendingQuestion  string // questionID for the pending ask_user
	promptDoneCh     chan promptDoneMsg
	contentUpdatedCh chan string
	askUserCh        chan askUserMsg
	answerCh         chan answerPayload // sends answers to the bridge goroutine
	promptErr        string

	// Create project
	creatingProject  bool
	projectCreating  bool
	projectNameInput textinput.Model
	projectCreateErr string

	// Delete project confirmation
	confirmingDelete bool
	confirmDeleteID  string
	projectDeleteErr string

	// Lipgloss styles
	panelStyle         lipgloss.Style
	focusLineStyle     lipgloss.Style
	promptPanelStyle   lipgloss.Style
	promptPanelFocused lipgloss.Style
}

type promptDoneMsg struct {
	threadID string
}

type contentUpdatedMsg struct {
	threadID string
}

type askUserMsg struct {
	threadID     string
	questionID string
}

type answerPayload struct {
	threadID     string
	questionID string
	answer     string
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
	projects, err := database.ListProjects(db.DefaultUserID)
	if err != nil {
		return nil, err
	}

	tl := list.New([]list.Item{}, treeDelegate{}, 30, 12)
	tl.Title = "Projects"
	tl.SetShowFilter(false)
	tl.SetFilteringEnabled(false)
	tl.SetShowStatusBar(false)
	tl.SetShowHelp(false)

	vp := viewport.New(48, 12)
	vp.Style = lipgloss.NewStyle()

	ti := textarea.New()
	ti.Placeholder = "Type a prompt... (Enter to send · Alt+Enter new line)"
	ti.KeyMap.InsertNewline = key.NewBinding(key.WithKeys("alt+enter", "ctrl+m"), key.WithHelp("alt+enter", "new line"))
	ti.SetWidth(60)
	ti.SetHeight(3)
	ti.ShowLineNumbers = false
	ti.Prompt = ""
	ti.FocusedStyle.Base = lipgloss.NewStyle()
	ti.BlurredStyle.Base = lipgloss.NewStyle()

	projNameInput := textinput.New()
	projNameInput.Placeholder = "my-project"
	projNameInput.Prompt = "Project name: "
	projNameInput.Width = 40

	m := &model{
		db:               database,
		cfg:              cfg,
		width:            80,
		height:           24,
		focus:            focusList,
		projects:         projects,
		projectThreads:     make(map[string][]db.ThreadRow),
		expanded:         make(map[string]bool),
		treeList:         tl,
		viewport:         vp,
		promptInput:      ti,
		agentMode:        "agent",
		promptDoneCh:     make(chan promptDoneMsg, 1),
		contentUpdatedCh: make(chan string, 32),
		askUserCh:        make(chan askUserMsg, 1),
		answerCh:         make(chan answerPayload, 1),
		panelStyle:       lipgloss.NewStyle().Padding(0, 1),
		focusLineStyle: lipgloss.NewStyle().
			Foreground(lipgloss.Color("170")).
			Padding(0, 0),
		promptPanelStyle:   lipgloss.NewStyle().Padding(0, 2),
		promptPanelFocused: lipgloss.NewStyle().Padding(0, 2),
		projectNameInput:   projNameInput,
	}

	for _, p := range projects {
		threads, _ := database.ListThreads(p.ID)
		m.projectThreads[p.ID] = threads
	}

	for _, p := range projects {
		m.expanded[p.ID] = true
	}
	m.buildTreeItems()

	if len(projects) == 0 {
		m.viewport.SetContent("No projects yet. Press Ctrl+N to create one.")
	} else {
		threads := m.projectThreads[projects[0].ID]
		if len(threads) > 0 {
			m.loadContentForThreadByID(threads[0].ID)
			m.treeList.Select(1) // first thread (index 0 is the project header)
		}
	}

	return m, nil
}

func (m model) Init() tea.Cmd {
	return nil
}

// buildTreeItems rebuilds the flat item list from projects + expanded threads,
// preserving the current selection when possible.
func (m *model) buildTreeItems() {
	prevIdx := m.treeList.Index()
	var prevItem treeItem
	if prevIdx >= 0 && prevIdx < len(m.treeItems) {
		prevItem = m.treeItems[prevIdx]
	}

	var items []treeItem
	for i, p := range m.projects {
		exp := m.expanded[p.ID]
		items = append(items, treeItem{
			isProject:  true,
			expanded:   exp,
			project:    p,
			projectIdx: i,
		})
		if exp {
			threads := m.projectThreads[p.ID]
			for _, c := range threads {
				items = append(items, treeItem{
					isProject:  false,
					project:    p,
					thread:     c,
					projectIdx: i,
				})
			}
		}
	}
	m.treeItems = items

	listItems := make([]list.Item, len(items))
	for i, ti := range items {
		listItems[i] = ti
	}
	m.treeList.SetItems(listItems)

	if prevIdx >= 0 {
		for i, ti := range items {
			if prevItem.isProject && ti.isProject && ti.project.ID == prevItem.project.ID {
				m.treeList.Select(i)
				return
			}
			if !prevItem.isProject && !ti.isProject && ti.thread.ID == prevItem.thread.ID {
				m.treeList.Select(i)
				return
			}
		}
		if prevIdx >= len(items) && len(items) > 0 {
			m.treeList.Select(len(items) - 1)
		}
	}
}

func (m *model) selectInTree(projectID string, threadID string) {
	for i, ti := range m.treeItems {
		if threadID != "" && !ti.isProject && ti.thread.ID == threadID {
			m.treeList.Select(i)
			return
		}
		if threadID == "" && ti.isProject && ti.project.ID == projectID {
			m.treeList.Select(i)
			return
		}
	}
}

func (m *model) hasPromptPanel() bool {
	p := m.selectedProject()
	if p == nil {
		return false
	}
	return p.SandboxID != nil && *p.SandboxID != "" && p.Status == "running"
}

func (m *model) selectedProject() *db.ProjectRow {
	idx := m.treeList.Index()
	if idx < 0 || idx >= len(m.treeItems) {
		return nil
	}
	pIdx := m.treeItems[idx].projectIdx
	if pIdx < 0 || pIdx >= len(m.projects) {
		return nil
	}
	return &m.projects[pIdx]
}

func (m *model) selectedThread() *db.ThreadRow {
	idx := m.treeList.Index()
	if idx < 0 || idx >= len(m.treeItems) {
		return nil
	}
	ti := m.treeItems[idx]
	if ti.isProject {
		return nil
	}
	threads := m.projectThreads[ti.project.ID]
	for i := range threads {
		if threads[i].ID == ti.thread.ID {
			return &threads[i]
		}
	}
	return nil
}

func (m *model) viewingThread() *db.ThreadRow {
	if m.viewingThreadID == "" {
		return nil
	}
	for _, threads := range m.projectThreads {
		for i := range threads {
			if threads[i].ID == m.viewingThreadID {
				return &threads[i]
			}
		}
	}
	return nil
}

func agentTypeLabel(at *string) string {
	if at == nil || *at == "" {
		return ""
	}
	switch *at {
	case "build":
		return "Build"
	case "plan":
		return "Plan"
	case "sisyphus":
		return "Sisyphus"
	default:
		return *at
	}
}

func (m *model) selectedTreeItem() *treeItem {
	idx := m.treeList.Index()
	if idx < 0 || idx >= len(m.treeItems) {
		return nil
	}
	return &m.treeItems[idx]
}

func (m *model) maxFocus() int {
	if m.hasPromptPanel() {
		return 3 // list, content, prompt
	}
	return 2
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
		return nil
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

const draftThreadTitle = "(draft)"

func (m *model) ensureDraftThread() bool {
	p := m.selectedProject()
	if p == nil || !m.hasPromptPanel() {
		return false
	}
	threads := m.projectThreads[p.ID]
	for _, c := range threads {
		if c.Title == draftThreadTitle {
			m.selectInTree(p.ID, c.ID)
			return true
		}
	}
	threadRow, err := m.db.CreateThread(p.ID, draftThreadTitle)
	if err != nil {
		return false
	}
	_ = threadRow
	m.reloadProjectThreads(p.ID)
	m.expanded[p.ID] = true
	m.buildTreeItems()
	threads = m.projectThreads[p.ID]
	for _, c := range threads {
		if c.Title == draftThreadTitle {
			m.selectInTree(p.ID, c.ID)
			break
		}
	}
	return true
}

func (m *model) reloadProjectThreads(projectID string) {
	threads, err := m.db.ListThreads(projectID)
	if err != nil {
		m.projectThreads[projectID] = nil
		return
	}
	m.projectThreads[projectID] = threads
}

func (m *model) runDeleteProject(projectID string) tea.Cmd {
	var proj *db.ProjectRow
	for i := range m.projects {
		if m.projects[i].ID == projectID {
			proj = &m.projects[i]
			break
		}
	}
	if proj == nil {
		return nil
	}
	sandboxID := proj.SandboxID
	cfg := m.cfg
	dbRef := m.db

	if m.manager != nil && m.connectedProj == projectID {
		m.manager.Close()
		m.manager = nil
		m.connectedProj = ""
	}

	return func() tea.Msg {
		if sandboxID != nil && *sandboxID != "" && cfg != nil && cfg.CanConnect() {
			manager, err := sandbox.NewManager(cfg.AnthropicKey, cfg.DaytonaKey, cfg.DaytonaURL)
			if err == nil {
				ctx := context.Background()
				_ = manager.DeleteSandbox(ctx, *sandboxID)
				manager.Close()
			}
		}
		if err := dbRef.DeleteProject(projectID); err != nil {
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
	project, err := m.db.CreateProject(userID, name, "", "build", "", nil)
	if err != nil {
		return func() tea.Msg { return projectCreateErrMsg{err: fmt.Errorf("create project: %w", err)} }
	}
	cfg := m.cfg
	dbRef := m.db
	return func() tea.Msg {
		if cfg == nil || !cfg.CanConnect() {
			dbRef.UpdateProjectStatus(project.ID, "stopped", nil, nil)
			proj, _ := dbRef.GetProject(project.ID)
			if proj != nil {
				return projectCreatedMsg{project: *proj}
			}
			return projectCreateErrMsg{err: fmt.Errorf("run 'apex configure' to set up API keys")}
		}
		manager, mErr := sandbox.NewManager(cfg.AnthropicKey, cfg.DaytonaKey, cfg.DaytonaURL)
		if mErr != nil {
			errMsg := mErr.Error()
			dbRef.UpdateProjectStatus(project.ID, "error", nil, &errMsg)
			return projectCreateErrMsg{err: fmt.Errorf("sandbox manager: %w", mErr)}
		}
		defer manager.Close()
		ctx := context.Background()
		sandboxID, sErr := manager.CreateSandbox(ctx, project.SandboxSnapshot, name, "")
		if sErr != nil {
			errMsg := sErr.Error()
			dbRef.UpdateProjectStatus(project.ID, "error", nil, &errMsg)
			return projectCreateErrMsg{err: fmt.Errorf("sandbox: %w", sErr)}
		}
		dbRef.UpdateProjectStatus(project.ID, "running", &sandboxID, nil)
		proj, _ := dbRef.GetProject(project.ID)
		if proj != nil {
			return projectCreatedMsg{project: *proj}
		}
		return projectCreatedMsg{project: *project}
	}
}

func (m *model) trySendAnswer() tea.Cmd {
	answer := m.promptInput.Value()
	if answer == "" {
		return nil
	}
	m.promptInput.Reset()
	m.promptInput.Placeholder = "Type a prompt... (Enter to send · Alt+Enter new line)"
	m.waitingForAnswer = false
	questionID := m.pendingQuestion
	m.pendingQuestion = ""
	m.streamingThreadID = m.viewingThreadID

	// Update status to running immediately so the tree shows it
	threadID := m.viewingThreadID
	m.db.UpdateThreadStatus(threadID, "running")
	if p := m.selectedProject(); p != nil {
		m.reloadProjectThreads(p.ID)
		m.buildTreeItems()
	}

	// Send via the answerCh -- the bridge goroutine (which owns the
	// active manager connection) will read this and call SendUserAnswer.
	select {
	case m.answerCh <- answerPayload{
		threadID:     threadID,
		questionID: questionID,
		answer:     answer,
	}:
	default:
		m.promptErr = "Answer channel full"
		m.streamingThreadID = ""
	}
	return nil
}

func (m *model) trySendPrompt() tea.Cmd {
	if m.streamingThreadID != "" && m.streamingThreadID == m.viewingThreadID {
		return nil
	}
	if m.waitingForAnswer {
		return m.trySendAnswer()
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
	activeThread := m.selectedThread()
	if activeThread == nil {
		threadRow, err := m.db.CreateThread(p.ID, input)
		if err != nil {
			m.promptErr = "Failed to create thread"
			return nil
		}
		activeThread = threadRow
		m.reloadProjectThreads(p.ID)
		m.expanded[p.ID] = true
		m.buildTreeItems()
		m.selectInTree(p.ID, activeThread.ID)
	}

	contentJSON := db.MarshalJSON([]types.ContentBlock{{Type: "text", Text: input}})
	if err := m.db.AddMessage(activeThread.ID, "user", contentJSON, nil); err != nil {
		m.promptErr = "Failed to save message"
		return nil
	}
	m.db.UpdateThreadStatus(activeThread.ID, "running")

	if activeThread.Title == draftThreadTitle {
		title := input
		if len(title) > 100 {
			title = title[:100] + "…"
		}
		m.db.UpdateThreadTitle(activeThread.ID, title)
		threads := m.projectThreads[p.ID]
		for i := range threads {
			if threads[i].ID == activeThread.ID {
				threads[i].Title = title
				break
			}
		}
		m.projectThreads[p.ID] = threads
		m.buildTreeItems()
		m.selectInTree(p.ID, activeThread.ID)
	}

	sessionID := ""
	if activeThread.ClaudeSessionID != nil {
		sessionID = *activeThread.ClaudeSessionID
	}

	m.promptInput.Reset()
	m.promptErr = ""
	m.streamingThreadID = activeThread.ID
	m.viewingThreadID = activeThread.ID

	threadID := activeThread.ID
	contentCh := m.contentUpdatedCh
	doneCh := m.promptDoneCh
	askCh := m.askUserCh
	answerCh := m.answerCh
	dbCopy := m.db
	onUpdated := func(cid string) {
		select {
		case contentCh <- cid:
		default:
		}
	}
	onAskUser := func(cid, questionID string) {
		select {
		case askCh <- askUserMsg{threadID: cid, questionID: questionID}:
		default:
		}
	}

	blockUntilDone := func() tea.Msg {
		if err := m.connectToSandbox(); err != nil {
			return promptConnectErrMsg{err: err}
		}
		agent := "build"
		if m.agentMode == "plan" {
			agent = "plan"
		}
		if err := m.manager.SendPrompt(threadID, input, sessionID, agent, ""); err != nil {
			return promptConnectErrMsg{err: fmt.Errorf("send: %w", err)}
		}

		bridgeDone := make(chan struct{})
		mgr := m.manager

		// Listen for user answers from the TUI and forward them to the bridge.
		// This goroutine has access to mgr (the active connection).
		go func() {
			for {
				select {
				case ans := <-answerCh:
					mgr.SendUserAnswer(ans.threadID, ans.questionID, ans.answer)
				case <-bridgeDone:
					return
				}
			}
		}()

		go func() {
			thread.ProcessBridgeToDBWithCallbacks(dbCopy, mgr, threadID, thread.BridgeCallbacks{
				OnContentUpdated: onUpdated,
				OnAskUser:        onAskUser,
			})
			close(bridgeDone)
			select {
			case doneCh <- promptDoneMsg{threadID: threadID}:
			default:
			}
		}()
		return <-doneCh
	}

	waitForContentUpdate := func() tea.Msg {
		return contentUpdatedMsg{threadID: <-contentCh}
	}

	waitForAskUser := func() tea.Msg {
		return <-askCh
	}

	return tea.Batch(blockUntilDone, waitForContentUpdate, waitForAskUser)
}

func (m *model) refreshProjects() {
	projects, err := m.db.ListProjects(db.DefaultUserID)
	if err != nil {
		return
	}
	m.projects = projects
	for _, p := range projects {
		if _, ok := m.projectThreads[p.ID]; !ok {
			threads, _ := m.db.ListThreads(p.ID)
			m.projectThreads[p.ID] = threads
		}
		if _, ok := m.expanded[p.ID]; !ok {
			m.expanded[p.ID] = true
		}
	}
	m.buildTreeItems()
}

func (m *model) waitForContentUpdateCmd() tea.Cmd {
	return func() tea.Msg {
		return contentUpdatedMsg{threadID: <-m.contentUpdatedCh}
	}
}

func (m *model) waitForAskUserCmd() tea.Cmd {
	return func() tea.Msg {
		return <-m.askUserCh
	}
}

func (m *model) loadContentForThreadByID(threadID string) {
	m.refreshContentForThreadByID(threadID, true)
}

func (m *model) refreshContentForThreadByID(threadID string, forceBottom bool) {
	rows, err := m.db.GetMessages(threadID)
	if err != nil {
		m.viewport.SetContent("Failed to load messages")
		return
	}
	if len(rows) == 0 {
		m.viewport.SetContent("No messages")
		return
	}
	wasAtBottom := m.viewport.AtBottom()
	msgs := thread.RowsToMessages(rows)
	content := thread.FormatThreadHistory(msgs)
	m.viewport.SetContent(content)
	if forceBottom || wasAtBottom {
		m.viewport.GotoBottom()
	}
	m.viewingThreadID = threadID
}

func (m *model) syncLayout() {
	leftCol := m.width * 2 / 5
	rightCol := m.width - leftCol
	if leftCol < 20 {
		leftCol = 20
	}
	if rightCol < 20 {
		rightCol = 20
	}
	if m.fullscreen {
		rightCol = m.width
	}

	listHeight := m.height - 2
	if m.hasPromptPanel() {
		listHeight = m.height - 7
	}
	if listHeight < 6 {
		listHeight = 6
	}

	if !m.fullscreen {
		treeH := listHeight
		if m.focus == focusList {
			treeH = listHeight - 1
			if treeH < 4 {
				treeH = 4
			}
		}
		m.treeList.SetSize(leftCol-2, treeH)
	}

	contentH := listHeight
	if m.focus == focusContent {
		contentH = listHeight - 1
		if contentH < 4 {
			contentH = 4
		}
	}
	if m.viewingThreadID != "" {
		contentH -= 3 // header (title + separator + blank line)
		if contentH < 4 {
			contentH = 4
		}
	}
	m.viewport.Width = rightCol - 2
	m.viewport.Height = contentH
}

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case promptConnectErrMsg:
		m.promptErr = msg.err.Error()
		m.streamingThreadID = ""
		return m, nil

	case projectCreatedMsg:
		m.creatingProject = false
		m.projectCreating = false
		m.projectNameInput.Reset()
		m.projectNameInput.Blur()
		m.projectCreateErr = ""
		m.refreshProjects()
		m.expanded[msg.project.ID] = true
		m.buildTreeItems()
		m.selectInTree(msg.project.ID, "")
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
		delete(m.expanded, msg.projectID)
		delete(m.projectThreads, msg.projectID)
		m.refreshProjects()
		m.viewport.SetContent("Select a project")
		m.viewingThreadID = ""
		return m, nil

	case projectDeleteErrMsg:
		m.confirmingDelete = false
		m.projectDeleteErr = msg.err.Error()
		return m, nil

	case contentUpdatedMsg:
		if m.streamingThreadID == msg.threadID && m.viewingThreadID == msg.threadID {
			m.refreshContentForThreadByID(msg.threadID, false)
		}
		return m, m.waitForContentUpdateCmd()

	case askUserMsg:
		m.streamingThreadID = ""
		m.waitingForAnswer = true
		m.pendingQuestion = msg.questionID
		m.promptInput.Placeholder = "Type your answer... (Enter to send)"
		if m.viewingThreadID == msg.threadID {
			m.refreshContentForThreadByID(msg.threadID, false)
		}
		if p := m.selectedProject(); p != nil {
			m.reloadProjectThreads(p.ID)
			m.buildTreeItems()
		}
		m.focus = focusPrompt
		m.promptInput.Focus()
		return m, m.waitForAskUserCmd()

	case promptDoneMsg:
		m.streamingThreadID = ""
		m.waitingForAnswer = false
		m.pendingQuestion = ""
		if m.viewingThreadID != "" {
			m.loadContentForThreadByID(m.viewingThreadID)
		}
		if p := m.selectedProject(); p != nil {
			m.reloadProjectThreads(p.ID)
			m.buildTreeItems()
		}
		return m, nil

	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		m.syncLayout()
		m.promptInput.SetWidth(msg.Width - 4)
		m.projectNameInput.Width = msg.Width - 20
		m.viewportInit = true
		return m, nil

	case tea.KeyMsg:
		if m.projectDeleteErr != "" && !m.confirmingDelete {
			m.projectDeleteErr = ""
		}

		// Delete confirmation dialog
		if m.confirmingDelete {
			switch msg.String() {
			case "y", "Y":
				if cmd := m.runDeleteProject(m.confirmDeleteID); cmd != nil {
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

		// Create project input mode
		if m.creatingProject {
			if m.projectCreating {
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

		// Prompt panel focused
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
				m.syncLayout()
				return m, nil
			}
		} else {
			switch msg.String() {
			case "f":
				if m.viewingThreadID != "" {
					m.fullscreen = !m.fullscreen
					if m.fullscreen {
						m.focus = focusContent
					} else {
						m.focus = focusList
					}
					m.promptInput.Blur()
					m.syncLayout()
				}
				return m, nil
			case "esc":
				if m.fullscreen {
					m.fullscreen = false
					m.focus = focusList
					m.promptInput.Blur()
					m.syncLayout()
					return m, nil
				}
			case "ctrl+n":
				m.creatingProject = true
				m.projectNameInput.Reset()
				m.projectNameInput.Focus()
				m.projectNameInput.Width = m.width - 20
				m.projectCreateErr = ""
				return m, nil
			case "n":
				if m.focus == focusList && m.hasPromptPanel() {
					if m.ensureDraftThread() {
						m.focus = focusPrompt
						m.promptInput.Focus()
						m.syncLayout()
					}
					return m, nil
				}
			case "q", "ctrl+c":
				if m.manager != nil {
					m.manager.Close()
				}
				return m, tea.Quit
			case "tab", "shift+tab":
				if m.fullscreen {
					return m, nil
				}
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
				m.syncLayout()
				return m, nil
			case "backspace", "delete":
				if m.focus == focusList {
					ti := m.selectedTreeItem()
					if ti != nil && ti.isProject {
						m.confirmingDelete = true
						m.confirmDeleteID = ti.project.ID
						m.projectDeleteErr = ""
						return m, nil
					}
				}
				return m, nil
			case "enter":
				if m.focus == focusList {
					ti := m.selectedTreeItem()
					if ti != nil {
						if ti.isProject {
							m.expanded[ti.project.ID] = !m.expanded[ti.project.ID]
							if m.expanded[ti.project.ID] {
								m.reloadProjectThreads(ti.project.ID)
							}
							m.buildTreeItems()
							m.selectInTree(ti.project.ID, "")
							return m, nil
						}
						m.loadContentForThreadByID(ti.thread.ID)
						m.focus = focusContent
						m.syncLayout()
						return m, nil
					}
				}
			}
		}
	}

	// Route input to focused component
	var cmd tea.Cmd
	switch m.focus {
	case focusList:
		oldProj := m.selectedProject()
		m.treeList, cmd = m.treeList.Update(msg)
		newProj := m.selectedProject()

		if oldProj != nil && newProj != nil && oldProj.ID != newProj.ID {
			if m.manager != nil && m.connectedProj != newProj.ID {
				m.manager.Close()
				m.manager = nil
				m.connectedProj = ""
			}
		}

		ti := m.selectedTreeItem()
		if ti != nil && !ti.isProject && ti.thread.ID != m.viewingThreadID {
			m.loadContentForThreadByID(ti.thread.ID)
		}
	case focusContent:
		m.viewport, cmd = m.viewport.Update(msg)
	case focusPrompt:
		if m.hasPromptPanel() && m.selectedThread() == nil && m.selectedProject() != nil {
			m.ensureDraftThread()
		}
		m.promptInput, cmd = m.promptInput.Update(msg)
	}
	return m, cmd
}

func (m model) View() string {
	if m.height <= 0 || m.width <= 0 {
		return ""
	}

	leftCol := m.width * 2 / 5
	rightCol := m.width - leftCol
	if leftCol < 20 {
		leftCol = 20
	}
	if rightCol < 20 {
		rightCol = 20
	}
	if m.fullscreen {
		rightCol = m.width
	}

	mainHeight := m.height - 2
	if m.hasPromptPanel() {
		mainHeight = m.height - 7
	}
	if mainHeight < 6 {
		mainHeight = 6
	}

	// Right panel: thread header + content viewport
	var header string
	if vt := m.viewingThread(); vt != nil {
		titleStyle := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("252"))
		dimStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("241"))
		shortID := vt.ID
		if len(shortID) > 8 {
			shortID = shortID[:8]
		}
		meta := dimStyle.Render(shortID)
		if label := agentTypeLabel(vt.AgentType); label != "" {
			meta += dimStyle.Render(" · "+label)
		}
		symbol, symbolColor := threadStatusIndicator(vt.Status)
		statusPart := lipgloss.NewStyle().Foreground(symbolColor).Render(symbol)
		title := vt.Title
		if title == "" {
			title = "(empty)"
		}
		title = truncateRunes(title, rightCol-20)
		header = statusPart + " " + titleStyle.Render(title) + "  " + meta
		separator := dimStyle.Render(strings.Repeat("─", rightCol-4))
		header = header + "\n" + separator
	}

	content := "Select a thread to view messages"
	if m.viewingThreadID != "" {
		content = m.viewport.View()
	} else if m.viewport.TotalLineCount() > 0 {
		content = m.viewport.View()
	}
	if header != "" {
		content = header + "\n" + content
	}
	if m.focus == focusContent && !m.fullscreen {
		focusLine := m.focusLineStyle.Width(rightCol - 2).Render(strings.Repeat("─", rightCol-2))
		content = lipgloss.JoinVertical(lipgloss.Left, content, focusLine)
	}
	contentView := m.panelStyle.Width(rightCol).Height(mainHeight).MaxHeight(mainHeight).Render(content)

	var layout string
	if m.fullscreen {
		layout = contentView
	} else {
		// Left panel: project/thread tree
		treeContent := m.treeList.View()
		if m.focus == focusList {
			focusLine := m.focusLineStyle.Width(leftCol - 2).Render(strings.Repeat("─", leftCol-2))
			treeContent = lipgloss.JoinVertical(lipgloss.Left, treeContent, focusLine)
		}
		treeView := m.panelStyle.Width(leftCol).Height(mainHeight).MaxHeight(mainHeight).Render(treeContent)
		layout = lipgloss.JoinHorizontal(lipgloss.Top, treeView, contentView)
	}

	// Prompt panel
	if m.hasPromptPanel() {
		promptStyle := m.promptPanelStyle
		if m.focus == focusPrompt {
			promptStyle = m.promptPanelFocused
		}
		statusText := ""
		if m.waitingForAnswer && m.viewingThreadID != "" && m.pendingQuestion != "" {
			statusText = " ? Waiting for your answer (type below, press Enter)"
		} else if m.streamingThreadID != "" && m.streamingThreadID == m.viewingThreadID {
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

	// Create project overlay
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

	// Help / confirmation line
	var helpLine string
	if m.confirmingDelete && m.confirmDeleteID != "" {
		name := ""
		for _, p := range m.projects {
			if p.ID == m.confirmDeleteID {
				name = p.Name
				break
			}
		}
		helpLine = lipgloss.NewStyle().Foreground(lipgloss.Color("170")).Render("Delete \"") +
			lipgloss.NewStyle().Foreground(lipgloss.Color("252")).Render(name) +
			lipgloss.NewStyle().Foreground(lipgloss.Color("170")).Render("\"? ") +
			lipgloss.NewStyle().Foreground(lipgloss.Color("241")).Render("y: yes · N/Esc: cancel")
	} else if m.projectDeleteErr != "" {
		helpLine = lipgloss.NewStyle().Foreground(lipgloss.Color("196")).Render("Delete failed: " + m.projectDeleteErr)
	} else {
		help := " Tab: focus · Enter: expand/select · f: fullscreen · Ctrl+N: new project · Backspace: delete · q: quit"
		if m.fullscreen {
			help = " f/Esc: exit fullscreen · ↑/↓: scroll · q: quit"
		} else if m.hasPromptPanel() {
			help = " Tab: focus · Enter: send/expand · f: fullscreen · Ctrl+N: new project · n: new thread · q: quit"
		}
		helpLine = lipgloss.NewStyle().Foreground(lipgloss.Color("241")).Render(help)
	}
	return layout + "\n" + helpLine
}

var _ tea.Model = (*model)(nil)
