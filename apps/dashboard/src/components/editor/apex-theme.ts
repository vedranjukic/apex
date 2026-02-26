import { themes, type ThemeId } from '../../lib/themes';

export function getMonacoThemeName(themeId: ThemeId): string {
  return `apex-${themeId}`;
}

export function getMonacoThemeData(themeId: ThemeId) {
  return themes[themeId].monacoTheme;
}

export const apexThemeData = themes['midnight-blue'].monacoTheme;
