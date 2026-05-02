import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'OCI Platform — ITU/WHO/WIPO',
  description:
    'Open Code Initiative — unified platform for benchmarking and assessing health AI under the ITU-WHO-WIPO Global Initiative on AI for Health (GI-AI4H).',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
