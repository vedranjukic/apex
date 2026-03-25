# Prompt Input, File References, Code Snippets & Image Attachments

The thread prompt uses a `contentEditable` div instead of a plain `<textarea>` so that inline reference tags can be mixed with text. Four input types are supported:

1. **File/folder references** -- triggered by typing `@` and selecting "Files" from the category picker
2. **GitHub issue/PR references** -- triggered by typing `@` and selecting "Issue" or "PR" from the category picker (only available when the project has `githubContext`)
3. **Code snippet references** -- created by copying text in the code editor and pasting into the prompt
4. **Image attachments** -- added via the toolbar image button or by pasting/dropping images from the clipboard

## Key Files

| File | Purpose |
|------|---------|
| `apps/dashboard/src/components/agent/prompt-input.tsx` | `PromptInput` + `CategoryPicker` components: contentEditable editor, `@` detection, category picker (Files/Issue/PR), tag insertion/removal, paste interception, submit serialization with GitHub context injection |
| `apps/dashboard/src/components/agent/file-picker.tsx` | `FilePicker` popup: filter input, directory navigation, file/folder selection |
| `apps/dashboard/src/components/agent/agent-thread.tsx` | `AgentThread` + `WelcomePrompt`: wire `requestListing`, `githubContext`, and `onSend` to `PromptInput` |
| `apps/dashboard/src/pages/project-page.tsx` | Threads `fileActions.requestListing` and `project.githubContext` to thread; formats files and snippets into the WebSocket prompt; re-subscribes agent socket when sandbox becomes available |
| `apps/dashboard/src/api/client.ts` | `GitHubContextData` type, `githubApi.resolve()`, `projectsApi.create()` with `gitBranch`/`githubContext` fields |
| `apps/api/src/modules/github/github.service.ts` | GitHub API service: fetch issues/PRs, resolve URLs |
| `apps/api/src/modules/github/github.routes.ts` | `GET /api/github/resolve?url=` endpoint |
| `libs/shared/src/lib/github-url.ts` | `parseGitHubUrl()` — shared URL parser for repo/issue/PR/branch/commit URLs |
| `apps/dashboard/src/stores/file-tree-store.ts` | Zustand store caching `FileEntry[]` per directory; `getAllCachedFiles()` flattens all cached files |
| `apps/dashboard/src/stores/editor-store.ts` | `CodeSelection` interface; `codeSelection` state set on copy in the code editor |
| `apps/dashboard/src/components/editor/code-viewer.tsx` | `onCopy` handler captures selection metadata + writes custom clipboard MIME type |
| `apps/dashboard/src/styles.css` | `.prompt-editor:empty::before` rule for the placeholder text |

## Architecture

```
ProjectPage
  └─ CentralPanel
      ├─ CodeViewer  (onCopy → editorStore.codeSelection + clipboard)
      └─ AgentThread  (receives requestListing + githubContext props)
          ├─ WelcomePrompt  (uses PromptInput)
          └─ PromptInput
              ├─ Image preview strip  (thumbnails with remove buttons)
              ├─ contentEditable div  (text + inline file/snippet/github tags)
              ├─ CategoryPicker popup (shown on @ trigger — Files, Issue, PR)
              ├─ FilePicker popup     (shown after selecting "Files" category)
              └─ Toolbar (agent dropdown + model dropdown + image button + send button)
```

## File References

### Data flow

```
1. User types "@" in the contentEditable div
2. handleInput() detects "@" preceded by whitespace or start-of-content
3. Saves a Range marking the "@" position (triggerRangeRef)
4. Opens CategoryPicker popup above the cursor
   - Shows "Files" (if requestListing is available)
   - Shows "Issue" (if project has githubContext with type 'issue')
   - Shows "PR" (if project has githubContext with type 'pull')
   - If only "Files" is available (no GitHub context), skips directly to FilePicker

5a. [Files path] User selects "Files" → CategoryPicker transitions to FilePicker
    FilePicker reads useFileTreeStore.cache for the current directory
    If directory is not cached, calls requestListing(path) via WebSocket
    User filters with the text input, navigates directories by clicking
    User selects a file (click/Enter) or folder (Shift+Click / Shift+Enter)
    handleFileSelect() removes the "@" trigger text, inserts a file tag

5b. [Issue/PR path] User selects "Issue" or "PR"
    handleCategorySelect() removes the "@" trigger text from the DOM
    Inserts a <span contentEditable="false" data-github-context="..."> tag
    On submit, the full issue/PR content (title, body, URL) is prepended to the prompt
```

### File tag DOM structure

```html
<span
  contenteditable="false"
  data-file-path="/home/user/project/src/index.ts"
  data-file-name="index.ts"
  title="/home/user/project/src/index.ts"
  class="... bg-primary/10 text-primary ..."
>
  <span><!-- file or folder SVG icon --></span>
  <span>index.ts</span>
  <span><!-- X close icon --></span>
</span>
```

- `data-file-path`: Full absolute path, used during serialization.
- `data-file-name`: Basename, used for display text in serialized output.
- File references get a file icon; folder references get a folder icon.

### GitHub context tag DOM structure

```html
<span
  contenteditable="false"
  data-github-context="issue"
  data-github-label="@issue"
  title="Issue #4134: Add network blocklist support for sandboxes"
  class="... bg-green-500/10 text-green-400 ..."
>
  <span><!-- issue or PR SVG icon --></span>
  <span>Issue #4134</span>
  <span><!-- X close icon --></span>
</span>
```

- `data-github-context`: `"issue"` or `"pull"` — used by `extractContent()` to detect GitHub tags.
- `data-github-label`: Display text (`@issue` or `@pr`) used in serialized output.
- On submit, if a GitHub tag is present and `githubContext` prop is set, `handleSubmit()` prepends the full issue/PR content (type, number, title, URL, body) to the prompt text before sending.
- GitHub context data (`GitHubContextData`) is stored on the project row and passed down through `ProjectPage → CentralPanel → AgentThread → PromptInput` as the `githubContext` prop.

### CategoryPicker keyboard shortcuts

| Key | Action |
|-----|--------|
| Arrow Up / Down | Move highlight |
| Enter / Tab | Select category |
| Escape | Close picker |

### FilePicker keyboard shortcuts

| Key | Action |
|-----|--------|
| Arrow Up / Down | Move highlight |
| Enter | Select file, or descend into directory |
| Shift+Enter | Select directory as a reference |
| Backspace (empty filter) | Navigate to parent directory |
| Escape | Close picker |

## Code Snippet References

### Concept

When the user selects text in the CodeViewer and copies it (Ctrl+C), the selection metadata is captured. When pasted into the thread prompt, a compact snippet tag is inserted instead of raw code. The tag shows `filename:startLine-endLine`. On submit, the selection coordinates are sent to the backend -- the actual code content is not duplicated in the prompt.

### CodeSelection interface

```typescript
interface CodeSelection {
  filePath: string;
  startLine: number;   // 1-based
  endLine: number;     // 1-based
  startChar: number;   // 0-based offset within startLine
  endChar: number;     // 0-based offset within endLine
}
```

Defined in `editor-store.ts` and exported.

### Data flow

```
1. User selects text in CodeViewer and copies (Ctrl+C)
2. CodeViewer onCopy handler:
   a. Reads window.getSelection() range
   b. Walks line <div>s to find startLine/endLine
   c. Computes startChar/endChar from range offsets
   d. Writes clean text to clipboard as text/plain
   e. Writes CodeSelection JSON as application/x-codeany-snippet
   f. Stores CodeSelection in editorStore.codeSelection
   g. Calls e.preventDefault() to avoid copying line numbers

3. User pastes into the thread prompt (Ctrl+V)
4. handlePaste() in PromptInput:
   a. Checks clipboardData for application/x-codeany-snippet
   b. If found, parses the JSON → CodeSelection
   c. If not found, falls back to editorStore.codeSelection
   d. If a snippet is detected, inserts a snippet tag (not raw text)
   e. Clears editorStore.codeSelection
   f. If no snippet detected, falls back to plain text paste

5. On submit, extractContent() collects snippet tags:
   - Parses data-snippet JSON into CodeSelection objects
   - Returns { text, files, snippets }

6. handleSendPrompt() formats snippets as coordinate references:
   "Referenced code selections:
    - /path/to/file.ts lines 12:0-25:18"
```

### Snippet tag DOM structure

```html
<span
  contenteditable="false"
  data-snippet='{"filePath":"/path/to/file.ts","startLine":12,"endLine":25,"startChar":0,"endChar":18}'
  data-snippet-label="file.ts:12-25"
  title="/path/to/file.ts:12:0-25:18"
  class="... bg-accent/10 text-accent ..."
>
  <span><!-- code SVG icon --></span>
  <span>file.ts:12-25</span>
  <span><!-- X close icon --></span>
</span>
```

- Snippet tags use green/accent colors to distinguish from file/folder tags (indigo/primary).
- `data-snippet`: Full JSON payload with selection coordinates.
- `data-snippet-label`: Display label shown in the tag.
- The actual code text is never stored in the tag or sent in the prompt; only file path and character-precise coordinates are transmitted.

### Custom clipboard MIME type

The `application/x-codeany-snippet` MIME type carries the `CodeSelection` JSON alongside the normal `text/plain`. This allows:
- Pasting into the thread prompt creates a snippet tag
- Pasting into any other application pastes the code as plain text

The `editorStore.codeSelection` field serves as a fallback for browsers that strip custom MIME types.

## Image Attachments

### Concept

Users can attach images (PNG, JPEG, GIF, WebP) to any prompt. Images are converted to base64 data URLs client-side, shown as thumbnail previews above the text input, and sent as `image` content blocks alongside the text. The agent receives images as `file` parts via the OpenCode API, enabling multimodal prompts (e.g. "what do you see in this screenshot?").

### Data flow

```
1. User clicks the image button (ImagePlus icon) in the toolbar
   OR pastes an image from the clipboard (Ctrl+V)
2. addImageFiles() reads each File via FileReader.readAsDataURL()
3. Creates ImageAttachment { id, dataUrl, source: { type: 'base64', media_type, data } }
4. Image thumbnails appear in a preview strip above the text input
5. User can remove images via the X button on each thumbnail

6. On submit, images are passed through onSend → handleSendPrompt:
   a. Optimistic local message includes image content blocks + text block
   b. Image sources (base64 payloads) are forwarded via WebSocket

7. WebSocket send_prompt { threadId, prompt, ..., images }
8. Backend stores image + text content blocks in the DB message
9. Bridge receives images, converts to OpenCode FilePartInput format:
   { type: "file", mime: "image/png", url: "data:image/png;base64,..." }
10. OpenCode processes the multimodal prompt
```

### ImageAttachment type

```typescript
interface ImageSource {
  type: 'base64';
  media_type: string;  // e.g. "image/png", "image/jpeg"
  data: string;        // base64-encoded image data
}

interface ImageAttachment {
  id: string;          // crypto.randomUUID()
  dataUrl: string;     // data:image/png;base64,... (for preview rendering)
  source: ImageSource; // payload sent to backend
}
```

Defined and exported from `prompt-input.tsx`. `ImageSource` is defined in `api/client.ts` and `libs/shared/src/lib/interfaces.ts`.

### Accepted formats

| Format | MIME Type | Max Size |
|--------|-----------|----------|
| PNG | `image/png` | 20 MB |
| JPEG | `image/jpeg` | 20 MB |
| GIF | `image/gif` | 20 MB |
| WebP | `image/webp` | 20 MB |

### Image rendering in messages

`ContentBlockView` in `message-bubble.tsx` renders `type: 'image'` blocks as `<img>` elements using a data URL constructed from `block.source.media_type` and `block.source.data`. Images display with `max-w-xs max-h-64` constraints.

### OpenCode bridge format

OpenCode does not have a native `image` part type. Images are sent as `FilePartInput`:

```json
{ "type": "file", "mime": "image/png", "url": "data:image/png;base64,...", "filename": "image-1.png" }
```

The bridge script (`bridge-script.ts`) converts the `{ media_type, data }` payload from the WebSocket into this format before calling `prompt_async`.

---

## PromptInput Component

### Props

```typescript
interface Props {
  onSend: (prompt: string, files?: string[], mode?: string, model?: string, snippets?: CodeSelection[], agentType?: string, images?: ImageAttachment[]) => void;
  disabled?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  requestListing?: (path: string) => void;
  hideAgentDropdown?: boolean;
  githubContext?: GitHubContextData | null;
}
```

When `requestListing` is not provided and no `githubContext` exists, the `@` trigger is inert (no picker opens). When only files are available (no GitHub context), `@` opens the file browser directly, skipping the category picker.

### Imperative handle

```typescript
interface PromptInputHandle {
  fill: (text: string) => void;
}
```

### contentEditable behaviors

- **Placeholder**: CSS rule `.prompt-editor:empty::before { content: attr(data-placeholder) }`.
- **Enter**: Submits the prompt.
- **Shift+Enter**: Inserts a newline.
- **Paste**: Checks for image files first (adds as image attachments); then checks for snippet MIME type; otherwise strips HTML and inserts plain text.
- **Backspace**: At the boundary of any tag (file or snippet), removes the entire tag.
- **Empty detection**: Send button is enabled when there is text content OR image attachments.

### Tag removal

File, snippet, and GitHub context tags can be removed by:
1. **Backspace key** at the tag boundary (checks for `FILE_TAG_ATTR`, `SNIPPET_TAG_ATTR`, or `GITHUB_TAG_ATTR`).
2. **X button click** via `mousedown` listener on the close span.

### Submit serialization

`extractContent(el)` returns:

```typescript
{ text: string; files: string[]; snippets: CodeSelection[]; hasGithubContext: boolean }
```

- Text nodes concatenated as-is.
- File tag spans contribute `@filename` to text, path to `files[]`.
- Snippet tag spans contribute `[snippet: path:line:char-line:char]` to text, parsed `CodeSelection` to `snippets[]`.
- GitHub context tag spans set `hasGithubContext = true` and contribute `@issue` or `@pr` to text.
- `<br>` elements become `\n`.

When `hasGithubContext` is true and the `githubContext` prop is set, `handleSubmit()` prepends the full GitHub content to the prompt:
```
GitHub Issue #123: <title>
<url>

<body>

---

<user's prompt text>
```

## How References and Images Are Sent to the Backend

When the user submits a prompt with references and/or images:

1. `PromptInput.onSend(text, files, mode, model, snippets, agentType, images)` is called.
2. `AgentThread` forwards to `onSendPrompt(threadId, text, files, mode, model, snippets, agentType, images)`.
3. `ProjectPage.handleSendPrompt()`:
   - Creates a local message with original text for display. If images are attached, the local message includes `{ type: 'image', source }` content blocks before the text block.
   - Stores `metadata.referencedFiles` and `metadata.codeSnippets`.
   - Constructs `fullPrompt` by prepending reference blocks:
     - `"Referenced files:\n- /path\n\n"` for file references
     - `"Referenced code selections:\n- /path lines L:C-L:C\n\n"` for snippets
   - Sends `fullPrompt` and `images` (array of `ImageSource`) over WebSocket via `sendPrompt(threadId, fullPrompt, mode, model, agentType, images)`.

4. Backend `send_prompt` handler (`agent.ws.ts`):
   - Stores user message with image content blocks + text block in the DB.
   - Forwards images alongside the prompt to `executeAgainstSandbox()`.
   - `SandboxManager.sendPrompt()` passes images to the bridge via `start_claude` WebSocket message.
   - Bridge converts images to OpenCode `FilePartInput` format and includes them in the `prompt_async` call.

## How to Modify

### Adding a new reference type

1. Define a new `data-*` attribute constant (like `FILE_TAG_ATTR`, `SNIPPET_TAG_ATTR`, `GITHUB_TAG_ATTR`).
2. Create a `createXxxTag()` function following the same pattern.
3. Add a new entry to the `CategoryPicker` items array (or add detection logic in `handleInput` / `handlePaste`).
4. Extend `extractContent()` to recognize the new tag type.
5. Update the `onSend` signature and `handleSendPrompt` formatting.

### Changing tag appearance

Edit the `className` string and SVG icon constants (`FILE_ICON_SVG`, `FOLDER_ICON_SVG`, `CODE_ICON_SVG`, `ISSUE_ICON_SVG`, `PR_ICON_SVG`, `CLOSE_ICON_SVG`). Tags are created imperatively (not JSX) because they are inserted into the contentEditable DOM directly.

### Changing how references are sent to the backend

Edit `handleSendPrompt` in `project-page.tsx` and `handleNewThreadPrompt` in `agent-thread.tsx`. Currently they prepend text blocks to the prompt string. To send references as structured data, modify the WebSocket `send_prompt` event payload and the corresponding backend handler in `agent.gateway.ts`.
