// lib/slideshow-styles.js — client-safe metadata for carousel formats + styles.
// Pure data (no server deps), so both the UI and the server renderer can import
// it. The server renderer (lib/slideshow.js) adds the actual layout/colors.
export const SLIDESHOW_FORMATS = [
  { key: 'listicle',  label: 'Listicle',     desc: 'Numbered tips' },
  { key: 'howto',     label: 'How-to',       desc: 'Step-by-step' },
  { key: 'story',     label: 'Story',        desc: 'Hook to lesson' },
  { key: 'myths',     label: 'Myth vs fact', desc: 'Bust misconceptions' },
  { key: 'framework', label: 'Framework',    desc: 'A named model in parts' },
  { key: 'quotes',    label: 'Quote cards',  desc: 'Punchy quotable lines' },
]

// `swatch` is a CSS background for the style chip; `ai` flags the AI-photo style.
export const SLIDE_STYLE_LIST = [
  { key: 'bold',      label: 'Bold',      ai: false, swatch: '#0E0F13', fg: '#FFD24A' },
  { key: 'minimal',   label: 'Minimal',   ai: false, swatch: '#FFFFFF', fg: '#2D6CF6' },
  { key: 'editorial', label: 'Editorial', ai: false, swatch: '#FBF7EF', fg: '#C2740A' },
  { key: 'gradient',  label: 'Gradient',  ai: false, swatch: 'linear-gradient(135deg,#6D3BD0,#2D6CF6)', fg: '#FFE08A' },
  { key: 'mint',      label: 'Mint',      ai: false, swatch: '#0B3D2E', fg: '#5FE3A1' },
  { key: 'photo',     label: 'AI photo',  ai: true,  swatch: 'linear-gradient(135deg,#222,#555)', fg: '#FFD24A' },
]
