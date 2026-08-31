// Select — the elements layer.
//
// The native <select>, deliberately. A custom listbox would need its own focus
// management, keyboard handling and mobile behaviour, and would still be worse
// on the Android phones this audience uses than the picker they already know.

import styles from './Select.module.css';

export function Select({ invalid = false, className, children, ...props }) {
  const classes = [styles.select];
  if (invalid) classes.push(styles.invalid);
  if (className) classes.push(className);

  return (
    <select className={classes.join(' ')} aria-invalid={invalid || undefined} {...props}>
      {children}
    </select>
  );
}
