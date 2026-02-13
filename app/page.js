import PdfMerger from './pdf-merger';

export default function Home() {
  return (
    <div className="container">
      <header className="header">
        <div className="header-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M14 2v6h6" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M12 18v-6" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M9 15h6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h1>PDF Merger</h1>
        <p>Merge PDFs & images into one document — fast and private.</p>
        <div className="privacy-badge">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0110 0v4" />
          </svg>
          100% local — files never leave your device
        </div>
      </header>

      <PdfMerger />

      <footer className="footer">
        <p>All processing happens in your browser. No servers. No uploads. Completely private.</p>
      </footer>
    </div>
  );
}
