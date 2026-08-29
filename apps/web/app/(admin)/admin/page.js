// Provisional. Step 2.7 builds the real admin shell; this exists so the
// (admin) route group has a route that renders.
//
// Note the path: this resolves to /admin, not /. The build plan lists step
// 2.7's file as (admin)/page.js and step 9.2's as (marketing)/page.js, which
// would both claim / and collide. Raised in the step report rather than
// settled here.

export default function AdminHomePlaceholder() {
  return (
    <main style={{ padding: 'var(--space-6)' }}>
      <h1 style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
        Admin
      </h1>
      <p className="measure" style={{ color: 'var(--text-secondary)' }}>
        Route group <code>(admin)</code>. Gated on <code>is_admin</code> from step 2.2.
      </p>
    </main>
  );
}
