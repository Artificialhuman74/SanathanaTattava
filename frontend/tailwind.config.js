/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Deep forest green — extracted from the Sanathana Tattva logo
        brand: {
          50:  '#f2f7f3',
          100: '#d9ece0',
          200: '#b0d6be',
          300: '#7db89a',
          400: '#4e9874',
          500: '#297a4d',
          600: '#1a6b2e',  // primary action (buttons, links)
          700: '#14532d',  // hover state
          800: '#0f3d1a',  // deep dark (sidebars, headers)
          900: '#092510',
          950: '#040f07',
        },
        // Warm amber gold — the lettering and drop colour from the logo
        gold: {
          50:  '#fdf8ee',
          100: '#f8edcc',
          200: '#f0d898',
          300: '#e8c164',
          400: '#e8b86d',  // light gold
          500: '#c8963c',  // main gold
          600: '#a87830',
          700: '#885c24',
          800: '#6a4219',
          900: '#4e2e0f',
        },
        // Warm parchment/cream — the burlap background from the logo
        parchment: {
          50:  '#fdfaf5',
          100: '#fdf8f0',  // main page background
          200: '#f5ede0',  // alternate sections
          300: '#ede3d0',
          400: '#e0d0b8',
          500: '#c8b898',
        },
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'hero-pattern': "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.03'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")",
      },
      animation: {
        'fade-in':    'fadeIn 0.5s ease-in-out',
        'slide-up':   'slideUp 0.4s ease-out',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'wiggle':     'wiggle 0.6s ease-in-out',
        'drop-bounce':'dropBounce 0.5s cubic-bezier(0.36, 0.07, 0.19, 0.97)',
        'cart-land':  'cartLand 0.5s cubic-bezier(0.36, 0.07, 0.19, 0.97)',
        'shake':      'shake 0.4s cubic-bezier(0.36, 0.07, 0.19, 0.97)',
        'roll-in-from-top':    'rollInFromTop 0.26s cubic-bezier(0.2, 0.8, 0.2, 1)',
        'roll-in-from-bottom': 'rollInFromBottom 0.26s cubic-bezier(0.2, 0.8, 0.2, 1)',
        'roll-out-up':         'rollOutToTop 0.26s cubic-bezier(0.2, 0.8, 0.2, 1)',
        'roll-out-down':       'rollOutToBottom 0.26s cubic-bezier(0.2, 0.8, 0.2, 1)',
      },
      keyframes: {
        fadeIn:  { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        slideUp: { '0%': { opacity: '0', transform: 'translateY(20px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        wiggle: {
          '0%, 100%': { transform: 'rotate(0deg)' },
          '15%':      { transform: 'rotate(14deg)' },
          '30%':      { transform: 'rotate(-12deg)' },
          '45%':      { transform: 'rotate(10deg)' },
          '60%':      { transform: 'rotate(-8deg)' },
          '75%':      { transform: 'rotate(4deg)' },
        },
        dropBounce: {
          '0%':   { transform: 'scale(1)' },
          '25%':  { transform: 'scale(1.3)' },
          '50%':  { transform: 'scale(0.88)' },
          '70%':  { transform: 'scale(1.1)' },
          '85%':  { transform: 'scale(0.96)' },
          '100%': { transform: 'scale(1)' },
        },
        cartLand: {
          '0%':   { transform: 'scale(1)' },
          '20%':  { transform: 'scale(1.18)' },
          '45%':  { transform: 'scale(0.92)' },
          '65%':  { transform: 'scale(1.06)' },
          '82%':  { transform: 'scale(0.97)' },
          '100%': { transform: 'scale(1)' },
        },
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '20%':      { transform: 'translateX(-5px)' },
          '40%':      { transform: 'translateX(5px)' },
          '60%':      { transform: 'translateX(-4px)' },
          '80%':      { transform: 'translateX(4px)' },
        },
        rollInFromTop: {
          '0%': { transform: 'translateY(-110%)', opacity: '0' },
          '35%': { opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        rollInFromBottom: {
          '0%': { transform: 'translateY(110%)', opacity: '0' },
          '35%': { opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        rollOutToTop: {
          '0%': { transform: 'translateY(0)', opacity: '1' },
          '35%': { opacity: '0' },
          '100%': { transform: 'translateY(-110%)', opacity: '0' },
        },
        rollOutToBottom: {
          '0%': { transform: 'translateY(0)', opacity: '1' },
          '35%': { opacity: '0' },
          '100%': { transform: 'translateY(110%)', opacity: '0' },
        },
      },
      boxShadow: {
        'card': '0 1px 3px 0 rgba(0,0,0,0.07), 0 1px 2px -1px rgba(0,0,0,0.07)',
        'card-hover': '0 10px 25px -5px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05)',
      },
    },
  },
  plugins: [],
};
