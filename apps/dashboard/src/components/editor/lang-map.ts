const EXT_TO_LANGUAGE: Record<string, string> = {
  // Web
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  mts: 'typescript',
  cts: 'typescript',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  json: 'json',
  jsonc: 'json',
  xml: 'xml',
  svg: 'xml',

  // Backend
  py: 'python',
  pyw: 'python',
  go: 'go',
  rs: 'rust',
  java: 'java',
  cs: 'csharp',
  cpp: 'cpp',
  cxx: 'cpp',
  cc: 'cpp',
  c: 'c',
  h: 'c',
  hpp: 'cpp',
  hxx: 'cpp',
  rb: 'ruby',
  php: 'php',
  swift: 'swift',
  kt: 'kotlin',
  kts: 'kotlin',

  // Config / Data
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  cfg: 'ini',
  conf: 'ini',
  graphql: 'graphql',
  gql: 'graphql',
  sql: 'sql',

  // Shell / Ops
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  fish: 'shell',
  ps1: 'powershell',
  psm1: 'powershell',
  psd1: 'powershell',

  // Markup
  md: 'markdown',
  mdx: 'markdown',
  rst: 'restructuredtext',

  // Other
  lua: 'lua',
  pl: 'perl',
  pm: 'perl',
  r: 'r',
  R: 'r',
  ex: 'elixir',
  exs: 'elixir',
  dart: 'dart',
  hbs: 'handlebars',
  handlebars: 'handlebars',
};

const FILENAME_TO_LANGUAGE: Record<string, string> = {
  Dockerfile: 'dockerfile',
  Makefile: 'makefile',
  Rakefile: 'ruby',
  Gemfile: 'ruby',
  '.gitignore': 'ini',
  '.dockerignore': 'ini',
  '.editorconfig': 'ini',
  '.env': 'ini',
  '.env.local': 'ini',
  '.env.development': 'ini',
  '.env.production': 'ini',
};

export function getLanguageFromPath(filePath: string): string {
  const fileName = filePath.split('/').pop() ?? '';

  if (FILENAME_TO_LANGUAGE[fileName]) {
    return FILENAME_TO_LANGUAGE[fileName];
  }

  const ext = fileName.includes('.') ? fileName.split('.').pop()! : '';
  return EXT_TO_LANGUAGE[ext] ?? 'plaintext';
}
