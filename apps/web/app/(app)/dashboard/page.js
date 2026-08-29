// Provisional. Step 5.6 builds the real learner dashboard; this exists so the
// (app) route group has a route that renders.

export default function DashboardPlaceholder() {
  return (
    <main style={{ padding: 'var(--space-6)' }}>
      <h1 style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
        Dashboard
      </h1>
      <p className="measure" style={{ color: 'var(--text-secondary)' }}>
        Route group <code>(app)</code>. Behind an auth session from step 1.11.
      </p>
    </main>
  );
}
