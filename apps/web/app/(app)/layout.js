// (app) — the authenticated learner and guardian surface.
//
// Everything here sits behind an auth session and is client-rendered against
// the Express API. The TanStack Query provider and the auth context arrive at
// step 1.11; this is the bare shell.

export default function AppLayout({ children }) {
  return <div data-route-group="app">{children}</div>;
}
