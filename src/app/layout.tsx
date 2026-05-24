import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'MCPetty',
  description: 'The Ultimate BottleNeck. Proudly serving as the front door to a server stack held together by a single unshielded ethernet cable and your tears.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `if(localStorage.getItem('theme')==='light')document.documentElement.classList.add('light')` }} />
      </head>
      <body>{children}</body>
    </html>
  )
}
