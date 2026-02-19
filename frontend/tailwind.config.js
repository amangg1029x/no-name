/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg:      '#0f0f1a',
        card:    '#1a1a2e',
        cardhi:  '#1f1f3a',
        border:  '#2a2a4a',
        cred:    '#ff3366',
        cblue:   '#00d4ff',
        cgreen:  '#00ff88',
        camber:  '#ffaa00',
        cpurple: '#bb88ff',
      },
      fontFamily: {
        mono:    ['"Share Tech Mono"', 'monospace'],
        display: ['"Exo 2"', 'sans-serif'],
        ui:      ['Rajdhani', 'sans-serif'],
      },
    },
  },
  plugins: [],
}