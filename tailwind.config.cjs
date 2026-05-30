/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./web/index.html', './web/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        atlas: {
          ink: '#06111f',
          mist: '#d6e2f2',
          teal: '#48d7c8',
          sky: '#7cc7ff',
          gold: '#f2c66d',
          panel: 'rgba(8, 19, 33, 0.72)'
        }
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(124, 199, 255, 0.18), 0 24px 80px rgba(0, 0, 0, 0.45)'
      }
    }
  },
  plugins: []
};
