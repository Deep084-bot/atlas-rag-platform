/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./web/index.html', './web/src/**/*.{js,jsx,ts,tsx}'],
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
        glow: '0 0 0 1px rgba(124, 199, 255, 0.18), 0 24px 80px rgba(0, 0, 0, 0.45)',
        'glow-lg': '0 0 0 1px rgba(124, 199, 255, 0.25), 0 32px 96px rgba(0, 0, 0, 0.5)',
        'card': '0 0 0 1px rgba(255,255,255,0.06), 0 8px 32px rgba(0,0,0,0.3)',
        'card-hover': '0 0 0 1px rgba(72, 215, 200, 0.2), 0 12px 48px rgba(0,0,0,0.4)',
        'soft': '0 4px 24px rgba(0,0,0,0.3)',
        'panel': '0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.06)',
        'dashboard': '0 30px 80px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.10)',
        'dashboard-hover': '0 36px 100px rgba(0,0,0,0.55), 0 0 0 1px rgba(72, 215, 200, 0.15)'
      },
      animation: {
        'fade-in': 'fade-in 0.8s ease-out forwards',
        'fade-in-up': 'fade-in-up 0.6s ease-out forwards',
        'slide-down': 'slide-down 0.3s ease-out forwards',
        'breathe': 'breathe 4s ease-in-out infinite'
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' }
        },
        'fade-in-up': {
          '0%': { opacity: '0', transform: 'translateY(24px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' }
        },
        'slide-down': {
          '0%': { opacity: '0', transform: 'translateY(-8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' }
        },
        'breathe': {
          '0%, 100%': { opacity: '0.6' },
          '50%': { opacity: '1' }
        }
      }
    }
  },
  plugins: []
};
