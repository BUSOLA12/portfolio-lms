// (admin) — the instructor's own surface.
//
// Client-rendered, no SEO, and gated on is_admin. The admin bundle must not
// reach marketing visitors. AdminNav arrives at step 2.7; this is the bare
// shell.

export default function AdminLayout({ children }) {
  return <div data-route-group="admin">{children}</div>;
}
