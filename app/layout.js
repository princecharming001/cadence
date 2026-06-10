export const metadata = {
  title: 'Cadence',
  description: 'X post scheduler',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0, background: '#0d0d0d', color: '#e8e8e8' }}>
        {children}
      </body>
    </html>
  )
}
