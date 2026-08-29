// Provisional. Step 9.2 builds the real portfolio home; this exists so the
// (marketing) route group has something to render and so the token and font
// wiring can be checked in a browser.

export default function MarketingHome() {
  return (
    <main style={{ padding: 'var(--space-6)' }}>
      <h1 style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
        Portfolio + LMS
      </h1>
      <p className="measure" style={{ color: 'var(--text-secondary)' }}>
        Route group <code>(marketing)</code>. Software services for clients, training
        cohorts for learners — two audiences, two journeys.
      </p>
      <p style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
        ₦250,000 · ₦150,000 · ₦100,000
      </p>
    </main>
  );
}
