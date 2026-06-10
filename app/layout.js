export const metadata = {
  title: 'Cadence',
  description: 'Turn how you write on LinkedIn into tweets that post themselves.',
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
