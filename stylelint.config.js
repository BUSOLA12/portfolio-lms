// Stylelint — the primitive guard.
//
// CLAUDE.md: "Components never reference a primitive. Semantic tokens only
// (--action-primary-bg, not --green-600). Rebrands must touch one layer."
//
// That rule is only worth writing down if something enforces it, because the
// failure is silent: a component reaching for --green-600 looks correct and
// renders correctly, and only breaks years later during a rebrand, everywhere
// at once. This config makes it a lint error instead.
//
// Per D13 the guard covers COLOUR and SHAPE primitives only. Spacing and type
// are exempt: --space-5 and --size-lg are already the semantic names for their
// steps, and tokens.css publishes no layer above them, so banning them left a
// compliant component with no legal way to reference either scale.
//
// tokens.css is exempt entirely — primitives legitimately live there, and it is
// the one file allowed to declare them.

// Matched against a custom property name with its leading `--` removed, which
// is the form stylelint's custom-property-pattern receives.
//
// --border-hair and --border-firm are listed individually on purpose: the
// --border-* namespace also holds --border-default, --border-subtle,
// --border-strong and --border-focus, which are semantic and must stay legal.
const PRIMITIVE_BODY = [
  '(?:green|ochre|slate|red|paper|line|shadow|radius)[a-z0-9-]*',
  'white',
  'success(?:-soft)?',
  'border-(?:hair|firm)',
].join('|');

/** Matches a read of a primitive, e.g. `var(--green-600)`. */
const PRIMITIVE_READ = new RegExp(`var\\(\\s*--(?:${PRIMITIVE_BODY})`);

/** Matches any custom property name that is NOT a primitive. */
const NOT_A_PRIMITIVE = `^(?!(?:${PRIMITIVE_BODY})$).+$`;

export default {
  extends: ['stylelint-config-standard'],

  ignoreFiles: ['**/node_modules/**', '**/.next/**', 'apps/web/styles/tokens.css'],

  rules: {
    // CSS Modules' :global and composes are not standard CSS.
    'selector-pseudo-class-no-unknown': [
      true,
      { ignorePseudoClasses: ['global', 'local'] },
    ],
    'property-no-unknown': [true, { ignoreProperties: ['composes'] }],
  },

  overrides: [
    {
      files: ['apps/web/components/**/*.css', 'apps/web/app/**/*.css'],
      rules: {
        // Catches `color: var(--green-600)` and every other primitive read.
        'declaration-property-value-disallowed-list': [
          { '/.*/': [PRIMITIVE_READ] },
          {
            message:
              'Components reference semantic colour and shape tokens only, never primitives. Use --action-primary-bg, not --green-600. Spacing and type primitives (--space-*, --size-*) are exempt per D13. (CLAUDE.md, design system rules)',
          },
        ],

        // Catches a component redeclaring a primitive rather than reading one.
        'custom-property-pattern': [
          NOT_A_PRIMITIVE,
          {
            message:
              'Colour and shape primitives are declared in tokens.css and nowhere else. A component may not define one.',
          },
        ],
      },
    },
  ],
};
