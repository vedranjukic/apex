# Prompt Input, File References & Code Snippets

The chat prompt uses a `contentEditable` div instead of a plain `<textarea>` so that inline reference tags can be mixed with text. Two reference types are supported:

1. **File/folder references** -- triggered by typing `@`, selecting from a file picker popup
2. **Code snippet references** -- created by copying text in the code editor and pasting into the prompt

## Key Files

| File | Purpose |
|------|---------|
| `apps/dashboard/src/components/agent/prompt-input.tsx` | `PromptInput` component: contentEditable editor, `@` detection, tag insertion/removal, paste interception, submit serialization |
| `apps/dashboard/src/components/agent/file-picker.tsx` | `FilePicker` popup: filter input, directory navigation, file/folder selection |
| `apps/dashboard/src/components/agent/agent-chat.tsx` | `AgentChat` + `WelcomePrompt`: wire `requestListing` and `onSend` to `PromptInput` |
| `apps/dashboard/src/pages/project-page.tsx` | Threads `fileActions.requestListing` to chat; formats files and snippets into the WebSocket prompt |
| `apps/dashboard/src/stores/file-tree-store.ts` | Zustand store caching `FileEntry[]` per directory; `getAllCachedFiles()` flattens all cached files |
| `apps/dashboard/src/stores/editor-store.ts` | `CodeSelection` interface; `codeSelection` state set on copy in the code editor |
| `apps/dashboard/src/components/editor/code-viewer.tsx` | `onCopy` handler captures selection metadata + writes custom clipboard MIME type |
| `apps/dashboard/src/styles.css` | `.prompt-editor:empty::before` rule for the placeholder text |

## Architecture

```
ProjectPage
  └─ CentralPanel
      ├─ CodeViewer  (onCopy → editorStore.codeSelection + clipboard)
      └─ AgentChat  (receives requestListing prop)
          ├─ WelcomePrompt  (uses PromptInput)
          └─ PromptInput
              ├─ contentEditable div  (text + inline file/snippet tags)
              ├─ FilePicker popup     (shown on @ trigger)
              └─ Toolbar + Send button
```

## File References

### Data flow

```
1. User types "@" in the contentEditable div
2. handleInput() detects "@" preceded by whitespace or start-of-content
3. Saves a Range marking the "@" position (triggerRangeRef)
4. Opens FilePicker popup above the cursor

5. FilePicker reads useFileTreeStore.cache for the current directory
6. If directory is not cached, calls requestListing(path) via WebSocket
7. User filters with the text input, navigates directories by clicking
8. User selects a file (click/Enter) or folder (Shift+Click / Shift+Enter)

9. handleFileSelect() receives (filePath, isDirectory)
10. Removes the "@" trigger text from the DOM
11. Inserts a <span contentEditable="false" data-file-path="..."> tag
12. Places the cursor after the tag
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

When the user selects text in the CodeViewer and copies it (Ctrl+C), the selection metadata is captured. When pasted into the chat prompt, a compact snippet tag is inserted instead of raw code. The tag shows `filename:startLine-endLine`. On submit, the selection coordinates are sent to the backend -- the actual code content is not duplicated in the prompt.

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

3. User pastes into the chat prompt (Ctrl+V)
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
- Pasting into the chat prompt creates a snippet tag
- Pasting into any other application pastes the code as plain text

The `editorStore.codeSelection` field serves as a fallback for browsers that strip custom MIME types.

## PromptInput Component

### Props

```typescript
interface Props {
  onSend: (prompt: string, files?: string[], mode?: string, model?: string, snippets?: CodeSelection[]) => void;
  disabled?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  requestListing?: (path: string) => void;
}
```

When `requestListing` is not provided, the `@` trigger is inert (no picker opens).

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
- **Paste**: Checks for snippet MIME type first; otherwise strips HTML and inserts plain text.
- **Backspace**: At the boundary of any tag (file or snippet), removes the entire tag.
- **Empty detection**: `isEditorEmpty()` used to disable the send button.

### Tag removal

Both file and snippet tags can be removed by:
1. **Backspace key** at the tag boundary (checks for `FILE_TAG_ATTR` or `SNIPPET_TAG_ATTR`).
2. **X button click** via `mousedown` listener on the close span.

### Submit serialization

`extractContent(el)` returns:

```typescript
{ text: string; files: string[]; snippets: CodeSelection[] }
```

- Text nodes concatenated as-is.
- File tag spans contribute `@filename` to text, path to `files[]`.
- Snippet tag spans contribute `[snippet: path:line:char-line:char]` to text, parsed `CodeSelection` to `snippets[]`.
- `<br>` elements become `\n`.

## How References Are Sent to the Backend

When the user submits a prompt with references:

1. `PromptInput.onSend(text, files, mode, model, snippets)` is called.
2. `AgentChat` forwards to `onSendPrompt(chatId, text, files, mode, model, snippets)`.
3. `ProjectPage.handleSendPrompt()`:
   - Creates a local message with original text for display.
   - Stores `metadata.referencedFiles` and `metadata.codeSnippets`.
   - Constructs `fullPrompt` by prepending reference blocks:
     - `"Referenced files:\n- /path\n\n"` for file references
     - `"Referenced code selections:\n- /path lines L:C-L:C\n\n"` for snippets
   - Sends `fullPrompt` over WebSocket via `sendPrompt(chatId, fullPrompt)`.

The backend receives a single string prompt with coordinate-based references. The WebSocket protocol is unchanged.

## How to Modify

### Adding a new reference type

1. Define a new `data-*` attribute constant (like `FILE_TAG_ATTR`, `SNIPPET_TAG_ATTR`).
2. Create a `createXxxTag()` function following the same pattern.
3. Add detection logic (trigger character in `handleInput`, or paste interception in `handlePaste`).
4. Extend `extractContent()` to recognize the new tag type.
5. Update the `onSend` signature and `handleSendPrompt` formatting.

### Changing tag appearance

Edit the `className` string and SVG icon constants (`FILE_ICON_SVG`, `FOLDER_ICON_SVG`, `CODE_ICON_SVG`, `CLOSE_ICON_SVG`). Tags are created imperatively (not JSX) because they are inserted into the contentEditable DOM directly.

### Changing how references are sent to the backend

Edit `handleSendPrompt` in `project-page.tsx` and `handleNewChatPrompt` in `agent-chat.tsx`. Currently they prepend text blocks to the prompt string. To send references as structured data, modify the WebSocket `send_prompt` event payload and the corresponding backend handler in `agent.gateway.ts`.
