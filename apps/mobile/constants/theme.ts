/* Global styles and design tokens for HOMIE mobile app */

export const Colors = {
  // Brand
  primary: '#818cf8',       // Indigo
  primaryDark: '#6366f1',
  accent: '#34d399',        // Emerald
  danger: '#ef4444',
  warning: '#f59e0b',

  // Backgrounds
  bg: '#09090b',            // Near-black
  bgCard: '#18181b',
  bgElevated: '#27272a',
  bgInput: '#1c1c1e',

  // Borders
  border: '#3f3f46',
  borderLight: '#27272a',

  // Text
  textPrimary: '#fafafa',
  textSecondary: '#a1a1aa',
  textMuted: '#71717a',
  textDisabled: '#52525b',

  // Status
  success: '#22c55e',
  successBg: '#14532d22',
  errorBg: '#7f1d1d22',
  warningBg: '#78350f22',
  infoBg: '#1e3a5f22',
} as const;

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const FontSize = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 20,
  xxl: 24,
  h1: 32,
  h2: 28,
} as const;

export const Radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 999,
} as const;
