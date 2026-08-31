// Toast — a transient message.
//
// On the four-state rule: a toast is not a domain state. It reports what just
// happened, not where a learner has got to. Rather than invent a fifth state
// for it, the two tones that need colour borrow the existing `done` and
// `overdue` tokens, and everything else is neutral — so the platform still
// publishes exactly four states and this adds none.
//
// Presentational only. Stacking, timing and dismissal on a timer belong to
// whatever provider mounts these; this renders one message.

import { Button } from '../Button/Button.js';
import styles from './Toast.module.css';

const TONES = {
  neutral: styles.neutral,
  done: styles.done,
  overdue: styles.overdue,
};

export function Toast({ tone = 'neutral', onDismiss, className, children, ...props }) {
  const classes = [styles.toast, TONES[tone] ?? TONES.neutral];
  if (className) classes.push(className);

  return (
    <div
      className={classes.join(' ')}
      // A failure interrupts; anything else waits its turn. `alert` preempts
      // whatever a screen reader is saying, which is right for an error and
      // rude for a confirmation.
      role={tone === 'overdue' ? 'alert' : 'status'}
      {...props}
    >
      <p className={styles.message}>{children}</p>
      {onDismiss ? (
        <Button variant="quiet" onClick={onDismiss} aria-label="Dismiss">
          &times;
        </Button>
      ) : null}
    </div>
  );
}
