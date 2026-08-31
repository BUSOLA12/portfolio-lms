// Button — the elements layer, per D2.
//
// Four variants, matching the four the design system defines. No size prop:
// the 44px minimum touch target is the floor and there is no case yet for
// anything above it. Adding one later is additive; guessing at one now would
// put an untested shape in every screen.
//
// Deliberately unmarked by 'use client'. It holds no state and calls no hook,
// so it renders in a server component and inherits the client boundary of any
// consumer that passes an onClick.

import styles from './Button.module.css';

const VARIANTS = {
  primary: styles.primary,
  accent: styles.accent,
  outline: styles.outline,
  quiet: styles.quiet,
};

export function Button({
  variant = 'primary',
  block = false,
  type = 'button',
  className,
  children,
  ...props
}) {
  // Explicit, because a bare <button> inside a form defaults to submit and
  // silently posts it — a footgun worth closing once here rather than at every
  // call site.
  const classes = [styles.button, VARIANTS[variant] ?? VARIANTS.primary];
  if (block) classes.push(styles.block);
  if (className) classes.push(className);

  return (
    <button type={type} className={classes.join(' ')} {...props}>
      {children}
    </button>
  );
}
