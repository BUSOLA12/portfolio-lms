// Badge — the platform's state vocabulary, made visible.
//
// CLAUDE.md: "Four states, no fifth. If something doesn't fit, redesign the
// flow rather than adding a state." So this component takes exactly four, and
// an unknown value is not silently tolerated — it falls back to `locked`, the
// most restrictive of the four, rather than rendering unstyled.
//
// Note the naming collision CLAUDE.md warns about: the visual state is
// `active`; the enrollment status is `enrolled`. This component speaks the
// visual vocabulary, and whatever maps a domain row onto it does so server-side
// — per D1, in the payment view service at 3.4 — never here.

import styles from './Badge.module.css';

const STATES = {
  done: styles.done,
  active: styles.active,
  locked: styles.locked,
  overdue: styles.overdue,
};

export function Badge({ state = 'locked', className, children, ...props }) {
  const classes = [styles.badge, STATES[state] ?? STATES.locked];
  if (className) classes.push(className);

  return (
    <span className={classes.join(' ')} {...props}>
      {children}
    </span>
  );
}
