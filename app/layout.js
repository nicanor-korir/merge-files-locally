import './globals.css';

export const metadata = {
  title: 'PDF Merger — Local & Private',
  description: 'Merge PDFs and images into one PDF. Everything runs locally in your browser.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
