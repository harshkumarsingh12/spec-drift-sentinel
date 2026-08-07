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
        <header className="topbar">
          <div className="topbar-inner">
            <Link href="/" className="brand">
              Spec Drift <span>Sentinel</span>
            </Link>
            <nav className="nav">
              <Link href="/inbox">Inbox</Link>
              <Link href="/matrix">Matrix</Link>
              <Link href="/timeline">Timeline</Link>
            </nav>
          </div>
        </header>
        <main className="shell">{children}</main>
      </body>
    </html>
  );
}
