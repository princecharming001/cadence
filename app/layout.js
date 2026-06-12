export const metadata = {
  title: 'Cadence',
  description: 'Your voice, posting itself — across X, LinkedIn, Instagram & TikTok.',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0, background: '#F6F5F1', color: '#1A1916' }}>
        {children}
      </body>
    </html>
  )
}
