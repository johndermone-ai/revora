/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef4ff', 100: '#dce8ff', 200: '#c0d4ff', 300: '#95b8ff',
          400: '#6393ff', 500: '#3e6df7', 600: '#2450e6', 700: '#1c40c4',
          800: '#1c379f', 900: '#1c327e'
        }
      },
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] }
    }
  },
  plugins: []
};
