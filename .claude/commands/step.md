Implement exactly one step of the build plan: $ARGUMENTS

Before writing anything:

1. Read CLAUDE.md and docs/build-plan.md.
2. Find the step numbered $ARGUMENTS. If it does not exist, stop and say so.
3. Check its listed dependencies. If any earlier step it depends on is not
   marked DONE, stop and tell me which one is missing.
4. Restate back to me, briefly: what gets built, the files created or changed,
   the database tables touched, and the done-when condition.
5. Check the "Still open" section. If this step needs a value listed there,
   stop and ask. Never invent a price, a capacity, a provider, an option list,
   or copy.
6. Check decisions D1 to D12. They are settled. Apply them; do not re-argue.

Then build only that step. Nothing from the next step, no scaffolding for
later steps, no files the step does not list.

When finished:

- Run `npm run lint` and `npm run format:check` and report the actual output.
- State the done-when condition and whether it is met.
- Stop. Do not start the next step. Do not offer to.

If the step turns out larger than its description, stop and tell me before
writing more.
