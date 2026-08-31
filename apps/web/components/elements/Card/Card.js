// Card — a surface, and nothing else.
//
// It takes children rather than a title and body, because every screen wants a
// slightly different arrangement inside one and a card that prescribes its own
// contents gets props bolted on until it prescribes nothing.
//
// Card.Footer is the one exception: the rule above it — a top border, mono
// type, muted — is a repeated shape worth keeping in one place. Mono is for
// code and numbers, per CLAUDE.md, which is what a card footer carries.

import styles from './Card.module.css';

export function Card({
  interactive = false,
  as: Element = 'div',
  className,
  children,
  ...props
}) {
  const classes = [styles.card];
  if (interactive) classes.push(styles.interactive);
  if (className) classes.push(className);

  return (
    <Element className={classes.join(' ')} {...props}>
      {children}
    </Element>
  );
}

function CardFooter({ className, children, ...props }) {
  const classes = [styles.footer];
  if (className) classes.push(className);

  return (
    <div className={classes.join(' ')} {...props}>
      {children}
    </div>
  );
}

Card.Footer = CardFooter;
