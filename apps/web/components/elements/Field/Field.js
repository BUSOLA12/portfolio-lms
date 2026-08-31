// Field — label, control and message, wired together.
//
// The wiring is the point. A label needs `for`, an error needs to be announced
// rather than only shown, and both need ids that match. Done by hand at each
// call site it will be wrong somewhere, so it is done once here: Field passes
// the ids down and the caller passes the control in.
//
// An error replaces the hint rather than joining it. Two messages under one
// input is a choice for the reader to make at the moment they are least able
// to make it.

import styles from './Field.module.css';

export function Field({ id, label, hint, error, optional = false, children, className }) {
  const messageId = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  const classes = [styles.field];
  if (className) classes.push(className);

  return (
    <div className={classes.join(' ')}>
      <label className={styles.label} htmlFor={id}>
        {label}
        {optional ? <span className={styles.optional}>optional</span> : null}
      </label>

      {/* The control is passed in rather than built here, so one Field serves
          an Input, a Select, or anything else that takes these props. */}
      {children({ id, 'aria-describedby': messageId, invalid: Boolean(error) })}

      {error ? (
        <p
          id={messageId}
          className={`${styles.message} ${styles.error}`}
          // Announced when it appears, without stealing focus from the field
          // the reader is still in.
          role="alert"
        >
          {error}
        </p>
      ) : hint ? (
        <p id={messageId} className={`${styles.message} ${styles.hint}`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
