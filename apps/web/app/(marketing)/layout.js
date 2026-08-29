// (marketing) — the public portfolio and course catalogue.
//
// This group is statically rendered and must never pull in the app or admin
// bundles: a visitor reading the portfolio does not download the dashboard.
// SiteHeader and SiteFooter arrive at step 9.1; this is the bare shell.

export default function MarketingLayout({ children }) {
  return <div data-route-group="marketing">{children}</div>;
}
