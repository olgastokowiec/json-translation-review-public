# Contributing

Thanks for helping out.

- There is no build step and there are no dependencies. Open `app/index.html` in Google Chrome.
- Run the tests with `npm test` (Node 20 or newer).
- `app/lib.js` holds the logic (file format, saving, checks, the English diff) and has tests. `app/app.js` is the screen.
- Keep the file format backward compatible: older files (`translation-review/1` and `/2`) must keep opening. If you change the format, update `schema/translation-review.schema.json`, `examples/de.json`, the docs and the tests together.
- The project targets macOS and Google Chrome.
