// Tailwind 3 config — design tokens mirror playground-next's so vendored
// pyric-ui selectors land on consistent colors. Dark-only.
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
    './vendor/**/*.{ts,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        'content-bg': '#16161a',
        'sidebar-bg': '#1e1e24',
        'soft-white': '#fbfbfe',
        'slate-gray': '#72728a',
        primary: '#19cc61',
      },
      fontFamily: {
        display: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: [
          'JetBrains Mono',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Monaco',
          'monospace',
        ],
      },
    },
  },
  plugins: [],
};
