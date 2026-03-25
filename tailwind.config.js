export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        tgDark: '#0e1621',     // Main background
        tgPanel: '#17212b',    // Sidebar/Header
        tgBlue: '#5288c1',     // Accent
        tgMsgIn: '#182533',    // Incoming message
        tgMsgOut: '#2b5278',   // Outgoing message
        tgText: '#f5f5f5',     // Text
        tgHint: '#6c7883'      // Hint text
      }
    },
  },
  plugins: [],
}
