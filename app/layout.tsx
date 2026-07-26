import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'RLSOK ReleaseGate',
  description: 'Release control for executable robot policies.'
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning style={{ backgroundColor: '#090A0C', colorScheme: 'dark' }}>
      <head>
        <meta name="color-scheme" content="dark" />
        <style dangerouslySetInnerHTML={{ __html: 'html,body{margin:0;width:100%;min-height:100%;background:#090A0C;color:#E5E7EB}' }} />
        <script dangerouslySetInnerHTML={{ __html: "document.documentElement.lang=(navigator.language||'en').toLowerCase().startsWith('zh')?'zh':'en';" }} />
      </head>
      <body style={{ backgroundColor: '#090A0C' }}>{children}</body>
    </html>
  );
}
