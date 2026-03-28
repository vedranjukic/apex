import type { Monaco } from 'monaco-editor';

let configured = false;

export function ensureMonacoTsDefaults(monaco: Monaco) {
  if (configured) return;
  configured = true;

  const { JsxEmit, ModuleKind, ModuleResolutionKind, ScriptTarget } =
    monaco.languages.typescript;

  const shared = {
    jsx: JsxEmit.ReactJSX,
    target: ScriptTarget.ESNext,
    module: ModuleKind.ESNext,
    moduleResolution: ModuleResolutionKind.NodeJs,
    allowNonTsExtensions: true,
    esModuleInterop: true,
    allowJs: true,
  };

  monaco.languages.typescript.typescriptDefaults.setCompilerOptions(shared);
  monaco.languages.typescript.javascriptDefaults.setCompilerOptions(shared);

  const diagnostics = {
    noSemanticValidation: true,
    noSyntaxValidation: false,
  };
  monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions(diagnostics);
  monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions(diagnostics);
}
