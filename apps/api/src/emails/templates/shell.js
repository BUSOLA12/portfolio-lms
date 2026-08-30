// Shared rendering for email templates: escaping, and the HTML shell.
//
// Both halves are here rather than in each template because stage 8 adds eight
// more of these — dunning, expiry, class session reminders, the guardian
// summary — and a layout copied nine times is a layout that will differ nine
// ways.

const ENTITIES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Every value a template puts into its `html` half passes through this. A
 * learner's full name is user-supplied and would otherwise reach a guardian's
 * inbox verbatim, inside a markup rendering context. The `text` half needs no
 * escaping — it is never parsed as markup.
 */
export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ENTITIES[character]);
}

/**
 * The shell every message renders into.
 *
 * Deliberately plain: one style block, no external stylesheet, no custom
 * properties — email clients support none of that reliably, so `tokens.css`
 * has no jurisdiction here and the colours are literal. Single column, 44px
 * tap target, readable on a phone, which is where this audience opens it.
 */
export function layout(body) {
  return [
    '<!doctype html>',
    '<html lang="en">',
    '  <head>',
    '    <meta charset="utf-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1" />',
    '    <style>',
    '      body { margin: 0; padding: 24px 16px; background: #f6f5f2; color: #1c2b25;',
    "        font: 16px/1.6 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }",
    '      .sheet { max-width: 34em; margin: 0 auto; padding: 24px; background: #ffffff;',
    '        border-radius: 8px; }',
    '      p { margin: 0 0 16px; }',
    '      .action { display: inline-block; min-height: 44px; padding: 12px 20px;',
    '        background: #1f6f4a; color: #ffffff; border-radius: 6px;',
    '        text-decoration: none; font-weight: 600; }',
    '      .fallback, .note { font-size: 14px; color: #55605a; }',
    '      .url { word-break: break-all; }',
    '    </style>',
    '  </head>',
    '  <body>',
    '    <div class="sheet">' + body + '</div>',
    '  </body>',
    '</html>',
  ].join('\n');
}
