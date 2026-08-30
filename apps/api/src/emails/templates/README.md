# Email templates

A template is a plain function. It takes whatever it needs to say its piece and
returns the three parts of a message:

```js
export function guardianInvitation({ guardianName, claimUrl }) {
  return {
    subject: '...',
    html: '...',
    text: '...',
  };
}
```

Three rules, so that `emailService` stays the only thing that knows about
sending:

1. **A template never sends.** It returns a message and nothing else — no
   provider, no `email_log`, no database. `sendEmail` in
   `services/emailService.js` owns all three.
2. **A template always returns `text` alongside `html`.** Some clients render
   only the plain part, and a dunning reminder that arrives blank is a reminder
   that did not arrive.
3. **A template takes values, not records.** Pass the claim URL, not the token
   row; the learner's name, not the user. It keeps templates testable without a
   database and stops a raw token reaching a template by accident.

The templates themselves arrive at step 1.6 (guardian invitation, email
verification), 1.8 (password reset) and stage 8 (dunning, expiry, class session
reminders, the guardian summary).
