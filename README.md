# Translation Review

A small Mac app for reviewing translations stored in JSON files. You open a file, go through the strings one by one, and approve, edit or flag each one. Your edits and review statuses are saved straight back into the file you opened.

It is built for the moment after a machine or an AI has drafted your translations, or after your English text changed: you need a person to check every string, and you want to see exactly what changed.

- **One string at a time**, with the English next to the translation.
- **Review statuses:** to review, approved, flagged for later.
- **English changed?** The string goes back to "to review" and the app shows the old and new English side by side.
- **Checks as you type:** placeholders like `{{name}}` must match the English.
- **Three suggestions per string:** if your file has translation options, pick one as a starting point.
- **No servers, no accounts, no dependencies.** It runs in your browser, and your files never leave your computer.

## Quick start

You need a Mac and Google Chrome.

1. Download or clone this repo.
2. Open `app/index.html` in Chrome.
3. Click **Open file…** and choose `examples/de.json`. The first time, Chrome asks whether the app may save changes to the file: choose **Save changes** (or **Allow**).
4. For each string, edit the translation if needed, then press **Save & approve → next** (or Cmd+Enter), **Flag for later**, or **Save (to review)**.
5. Close the tab whenever you like. Everything is already saved in the file. Next time, **Reopen de.json** takes you straight back.

## Install as a Mac app

```sh
sh mac/make-app.sh
```

This creates `Translation Review Public.app` in your Applications folder. It opens the review page in Chrome. Drag it to the Dock if you like. Run the command again if you move this folder.

## Using it with your own project

Translation Review is the **review** step. It opens a JSON file in a fixed format (see below). To use it on your own project, you create that file from your English JSON, review it, then write the translated JSON files back. The `docs/` folder has small, dependency-free Node scripts for both steps:

- [docs/generic-scripts-README.md](docs/generic-scripts-README.md): overview and setup
- [docs/PREPARE.md](docs/PREPARE.md): create or refresh a review file from your English JSON
- [docs/PUBLISH.md](docs/PUBLISH.md): put the reviewed translations back into your project

You can also write your own scripts: the format is small, and `schema/translation-review.schema.json` describes it.

## Good to know

**Other browsers.** Only Chrome (and Edge) can save over the original file. In Safari or Firefox the app still works, but you click **Download file** when you're done and replace the original with the downloaded copy.

**Translation options.** When a string has three suggested translations, they appear as A, B and C above the text box. Click one (or press Ctrl+1, 2 or 3) to put it in the text box, edit it if you like, then approve. The text box stays empty until you choose. Once every string in the file is approved, the options are removed from the file.

**Where do the options come from?** The app only reads the `options` list of each entry; it doesn't create it. You (or an AI or machine translation tool) fill it in by editing the review file: put up to three candidate translations in each entry's `options`. The prepare script doesn't translate, but it keeps existing options when you run it again. If an entry has no options, you simply type the translation yourself.

**If the file changes while the app is open** (for example a script refreshed it), the app notices before saving, loads the new version, and applies your edit on top. Nothing is overwritten.

## The file format

```json
{
  "format": "translation-review/3",
  "sourceLanguage": "en",
  "targetLanguage": "de",
  "entries": [
    {
      "key": "home:title",
      "source": "Welcome, {{name}}",
      "target": "Willkommen, {{name}}",
      "placeholders": ["name"],
      "status": "approved"
    }
  ]
}
```

The full definition is in [schema/translation-review.schema.json](schema/translation-review.schema.json), and [examples/de.json](examples/de.json) shows every kind of entry. The app writes files in a fixed layout (field order, 2-space indent, final newline), so saving only changes what you edited.

## For developers

- No build step and no dependencies. Open `app/index.html` in Chrome.
- `app/lib.js`: file format, saving, checks and the English diff (no screen code). `app/app.js`: the screen.
- Tests: `npm test` (Node 20 or newer).
- See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © Olga Stokowiec
