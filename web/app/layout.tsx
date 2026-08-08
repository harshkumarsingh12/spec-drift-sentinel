import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Spec Drift Sentinel',
  description: 'Ratify proposed test changes against the acceptance criteria that authorise them.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="app-frame">
          <header className="topbar">
            <div className="topbar-inner">
              <Link href="/" className="brand">
                <span className="brand-mark">🛰️</span>
                Spec Drift <span>Sentinel</span>
              </Link>
              <nav className="nav">
                <Link href="/inbox">Inbox</Link>
                <Link href="/matrix">Matrix</Link>
                <Link href="/timeline">Timeline</Link>
              </nav>
              <a
                className="topbar-cta"
                href="https://github.com/harshkumarsingh12/spec-drift-sentinel"
                target="_blank"
                rel="noreferrer"
              >
                GitHub ↗
              </a>
            </div>
          </header>
          <main className="shell">{children}</main>
        </div>
      </body>
    </html>
  );
}
