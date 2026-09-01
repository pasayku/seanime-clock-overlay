# types/

This folder is intentionally empty in git.

Run `./scripts/get-types.sh` (from the repo root) to download Seanime's
upstream `.d.ts` files here for editor autocomplete/type-checking. They are
referenced by the triple-slash comments at the top of
`seanime-clock-overlay.ts`.

These files are **not** required at runtime — Seanime evaluates the plugin's
`.ts` payload itself — they only help your editor while you write code.
