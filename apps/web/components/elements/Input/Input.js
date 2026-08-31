// Input — the elements layer.
//
// A bare control. The label, hint and error text belong to Field, which wraps
// it; keeping them apart means a Field can wrap a Select on the same terms.

import styles from './Input.module.css';

export function Input({ invalid = false, className, ...props }) {
  const classes = [styles.input];
  if (invalid) classes.push(styles.invalid);
  if (className) classes.push(className);

  return (
    <input
      className={classes.join(' ')}
      // Announced to a screen reader, not only drawn. Field wires the message
      // itself through aria-describedby.
      aria-invalid={invalid || undefined}
      {...props}
    />
  );
}
