import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/schibsted-grotesk';
import 'leaflet/dist/leaflet.css';
import './globals.css';
import { AuthProvider } from '@/lib/auth';
import Header from '@/components/Header';

export const metadata: Metadata = {
  title: { default: 'RentRadar: find a rent that is actually fair', template: '%s | RentRadar' },
  description: 'Search rental homes, see an AI-estimated fair rent for each one, and avoid fake listings.',
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <AuthProvider>
          <Header />
          <main>{children}</main>
        </AuthProvider>
      </body>
    </html>
  );
}
