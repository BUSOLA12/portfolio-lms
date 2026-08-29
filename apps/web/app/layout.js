// Root layout. Wraps every route group.
//
// globals.css is imported here and only here, which is what pulls tokens.css
// into the application exactly once.
//
// Dark mode is opt-in by design: tokens.css keys its dark palette off
// [data-theme="dark"] on the document element, not prefers-color-scheme. The
// mechanism that sets that attribute is not part of this step.

import './globals.css';

export const metadata = {
  title: {
    default: 'Portfolio + LMS',
    template: '%s · Portfolio + LMS',
  },
  description:
    'Software services and training cohorts. Two audiences, kept as separate journeys.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        {/* The body font is on the critical path for every route. The display
            and mono faces are not, so they load on demand. */}
        <link
          rel="preload"
          href="/fonts/public-sans-latin.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
