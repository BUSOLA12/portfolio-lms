// Scratch page for the elements layer — step 1.10's done-when.
//
// Development surface, not a product route. It renders every element in both
// themes at once so the layer can be checked in one screenshot, and it is the
// thing the stylelint primitive guard is pointed at alongside the components
// themselves. Delete it, or gate it, once the real screens at 1.11 exist.
//
// Text here is placeholder. It names what the control is, nothing more — no
// product copy is invented on a scratch page.

import { Badge } from '../../components/elements/Badge/Badge.js';
import { Button } from '../../components/elements/Button/Button.js';
import { Card } from '../../components/elements/Card/Card.js';
import { Field } from '../../components/elements/Field/Field.js';
import { Input } from '../../components/elements/Input/Input.js';
import { Select } from '../../components/elements/Select/Select.js';
import { Toast } from '../../components/elements/Toast/Toast.js';

import styles from './page.module.css';

export const metadata = {
  title: 'Elements',
  robots: { index: false, follow: false },
};

function Gallery() {
  return (
    <>
      <section className={styles.section}>
        <h2 className={styles['section-title']}>Button</h2>
        <div className={styles.row}>
          <Button variant="accent">Accent</Button>
          <Button variant="primary">Primary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="quiet">Quiet</Button>
          <Button disabled>Disabled</Button>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles['section-title']}>Field, Input and Select</h2>
        <div className={styles.stack}>
          <Field id="full-name" label="Full name" hint="As it should appear on records.">
            {(control) => <Input {...control} placeholder="Ada Lovelace" />}
          </Field>

          <Field id="email" label="Email address" error="Enter a valid email address">
            {(control) => <Input {...control} type="email" defaultValue="not-an-email" />}
          </Field>

          <Field id="relationship" label="Relationship" optional>
            {(control) => (
              <Select {...control} defaultValue="">
                <option value="" disabled>
                  Choose one
                </option>
                <option value="self">Self</option>
                <option value="guardian">Guardian</option>
              </Select>
            )}
          </Field>

          <Field id="disabled-input" label="Disabled">
            {(control) => <Input {...control} disabled defaultValue="Not editable" />}
          </Field>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles['section-title']}>Badge — the four states</h2>
        <div className={styles.row}>
          <Badge state="done">Done</Badge>
          <Badge state="active">Active</Badge>
          <Badge state="locked">Locked</Badge>
          <Badge state="overdue">Overdue</Badge>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles['section-title']}>Card</h2>
        <div className={styles.stack}>
          <Card>
            <h3 className={styles['card-title']}>A resting card</h3>
            <p className={styles['card-body']}>
              A surface at rest. It does not lift, because nothing here is clickable.
            </p>
            <Card.Footer>
              <span>24 sessions</span>
              <span>120 min</span>
            </Card.Footer>
          </Card>

          <Card interactive>
            <h3 className={styles['card-title']}>An interactive card</h3>
            <p className={styles['card-body']}>
              This one lifts on hover, which is the promise that it can be clicked.
            </p>
          </Card>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles['section-title']}>Toast</h2>
        <div className={styles.stack}>
          <Toast>A neutral message.</Toast>
          <Toast tone="done">Something finished.</Toast>
          <Toast tone="overdue">Something failed.</Toast>
        </div>
      </section>
    </>
  );
}

export default function ElementsPage() {
  return (
    <main className={styles.page}>
      <div className={styles.intro}>
        <h1>Elements</h1>
        <p>
          Every element in the shared layer, rendered in both themes. Development surface
          only.
        </p>
      </div>

      <div className={styles.themes}>
        <div className={styles.panel}>
          <p className={styles['panel-title']}>Light</p>
          <Gallery />
        </div>

        {/* Re-declares the token layer for its own subtree, so both themes are
            visible at once without a toggle. */}
        <div className={styles.panel} data-theme="dark">
          <p className={styles['panel-title']}>Dark</p>
          <Gallery />
        </div>
      </div>
    </main>
  );
}
