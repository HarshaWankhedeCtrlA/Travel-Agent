/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        wa: {
          bg: "#ece5dd",
          panel: "#f0f2f5",
          header: "#075e54",
          teal: "#128c7e",
          bubbleIn: "#dcf8c6",
          bubbleOut: "#ffffff",
        },
      },
    },
  },
  plugins: [],
};
