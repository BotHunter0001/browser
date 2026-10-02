/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./public/**/*.html', './public/**/*.js', './public/**/*.css'],
  theme: {
    extend: {
      fontFamily: {
        display: ['Manrope', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
