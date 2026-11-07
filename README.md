# Ora Screen Markup

Ora Screen Markup is a small Mac tool for capturing the screen and marking it
up. Every mark becomes a numbered note beside the picture, so the marked-up
picture and its notes can be copied into a design session or exported as one
readable PDF.

Ora Screen Markup is one of the Ora tools; Ora itself is at
https://ora-ai.app. The other products' pages: Ora Agent Bridge
(https://github.com/ora-commons/ora-agent-bridge), Ora Programming Loop
(https://github.com/ora-commons/ora-programming-loop), Ora AI Boost
(https://github.com/ora-commons/ora-adversarial-review), and Ora Vibe Coder
(https://github.com/ora-commons/ora-vibe-coder).

To report a problem, open the
[Issues page](https://github.com/ora-commons/ora-screen-markup/issues).
Reports are read and handled as capacity allows; no support is promised.

License: [CC0 1.0 Universal](LICENSE) for first-party material; see
[NOTICE.md](NOTICE.md) for third-party licences.

## Start here

This release is for a Mac with Apple Silicon running macOS 14 or later.
Download the release zip from the release page and unzip it.

1. Move **Ora Screen Markup.app** from the unzipped folder into the
   **Applications** folder.
2. The first time you open it, macOS warns that it cannot check the app for
   malicious software, because the app is not Apple-notarized yet — it is
   free until the developer joins the Apple developer program. Dismiss the
   warning, open **System Settings → Privacy & Security**, scroll to the
   notice about the blocked app, and choose **Open Anyway**; confirm once
   more and the app opens.
3. Capturing the screen needs macOS's screen recording permission. The first
   capture attempt asks for it and opens System Settings to
   **Privacy & Security → Screen Recording**; enable **Ora Screen Markup**
   there, then reopen the app and capture again.
4. Capture with **Region**, **Window** or **Screen** — or the global
   shortcuts Control-Shift-R, Control-Shift-W and Control-Shift-S — mark the
   picture up with the Markup tools, and give every mark its numbered note
   beside the picture. Everything these steps name is described under
   **Capturing and marking up** below.

Two commands keep the whole drawing:

- **Export PDF** writes one PDF into `~/Pictures/Ora Screen Markup/` — the
  annotated picture on the first page and every numbered note as selectable
  text after it — and reveals the finished PDF in Finder.
- Saving with **Save Editable Drawing** (the **Save editable** button or
  Command-S) writes one `.excalidraw` file with every picture, mark, number,
  note and crop; reopening it with **Open Editable Drawing** (the
  **Open Existing** button or Command-O) restores all of it for further
  editing. Every mark and note stays editable.

To find the version, open the app's first menu — **Ora Screen Markup** — and
choose **About Ora Screen Markup**; the About window shows the version.

To update, download a newer release and replace the app in Applications with
it; your captures are kept. To remove the app, move it to the Trash; your
captures stay in `~/Pictures/Ora Screen Markup/` until you delete them.

## Capturing and marking up

### Capturing

The first numbered row is **Capture**, with **Region**, **Window** and
**Screen** buttons and a remembered **Discard existing contents** checkbox.
These actions are also in the File menu and work from any application:

| Shortcut | What it does |
| --- | --- |
| Control-Shift-R | Capture a region |
| Control-Shift-W | Capture a window |
| Control-Shift-S | Capture the whole screen |

**Open Existing** sits after the capture buttons to start from an editable drawing.

Region capture starts empty on the display under the pointer. Click one corner,
move to the opposite corner, then click again; dragging out a rectangle also
works. Move the rectangle or adjust its edge and corner handles, then click
**OK ↵** beside it or press Return to capture. Escape cancels at any stage.
Click outside the rectangle to start a new selection. Empty selections cannot
be captured; small selections keep their chosen size.

Window capture lists each on-screen application's windows by application name
and window title. Choose the intended window, then click **Capture**; **Cancel**
keeps the current drawing. Untitled windows remain available, and Screen Markup's
own window is excluded.

**Add Region**, **Add Window** and **Add Screen** capture the same way, but the
captured picture is added to the drawing as another editable picture instead of
starting a fresh one. During an Add capture, **Discard existing contents** is
disabled and shown unchecked; its remembered setting returns when the capture
finishes or is cancelled. The other capture buttons use that setting to choose
between starting a fresh drawing and adding to it. Opening a saved drawing
still replaces the current one.
If an added picture cannot be read, or the capture is cancelled, the drawing
stays as it was. Add captures always keep the drawing, whatever the remembered
Discard setting is.

Screen capture needs macOS's screen recording permission. The first attempt
asks for it and opens System Settings to Privacy & Security > Screen
Recording; until it is granted the tool says so and nothing else changes.
If the switch is already enabled but capture is denied after changing signing
identity, remove the old Screen Markup entry, add the installed app from
`/Applications` again, enable it, then quit and reopen the app. This refresh
is needed once when moving from the old ad hoc builds to the stable signer.

A picture can also be brought in with **Insert image** in the Capture row
(File > Insert Image), with **File > Paste Picture**, by pasting onto the
canvas, or by dropping a picture onto the window. Each picture brought in
this way is added to the drawing as its own object; nothing already there is
replaced. The original file is only read, never written to. Pasting while
editing text remains ordinary text paste.

**Discard existing contents** starts checked. Leave it checked to start a new
capture immediately; the current drawing is replaced only when the capture
succeeds. Uncheck it to keep the current drawing and add the new region, window
or screen as another editable picture. This applies to the capture buttons,
File menu and global shortcuts. Cancelling or failing a capture leaves the
drawing unchanged. The checkbox is remembered when the app is reopened.

Open still prepares the incoming drawing first. If the current editable drawing
is unsaved or changed, a dialog offers Cancel or Replace, with Copy result,
Export PDF and Save editable for the current drawing. Cancelled or failed
captures, imports and file choosers leave the current scene in place.

### Marking up

The second numbered area, **Markup**, has selection, pan, shapes, arrows,
lines, drawing, text and erasing beside its heading. A second line starts with
Undo, Redo, zoom out, zoom in and the menu button, followed by Ora's tools:

- **Highlight** — a wide translucent freehand stroke.
- **Polygon** — a line closed onto its first vertex.
- **Revision cloud** — a scalloped closed line with a transparent interior, so the content underneath stays visible.
- **Callout** — an arrow with a note beside it.
- **Number marker** — a bare number dropped on the picture.
- **Crop drawing** — sets what the finished picture keeps.

Zoom and the menu forward to Excalidraw's own controls, so one zoom step or one
menu item here is one step in the editor itself; the editor's own zoom controls
and hamburger menu are hidden. The menu keeps frame, embed, laser pointer, pen
mode, tool locking, Mermaid and help, and Excalidraw still provides drawing,
styling and the footer **Library** command.

The mouse wheel zooms in and out around the pointer, as it does in Ora.
With **Select** active, hold the left mouse button and drag empty canvas to
pan. Dragging a picture or mark still moves it; Shift-drag selects an area.
Drawing tools keep their usual drag behavior.

Excalidraw's style panel — the tall column of colour, stroke, fill and text
settings that appears when a tool is picked or something is selected — folds
behind the **Show style panel** / **Hide style panel** button after the Markup
tools. It starts folded each time the app opens, and the choice is not
remembered.

One drawing can hold several pictures. Every picture is an object that can be
selected, moved, resized with its handles and erased, and a new picture lands
above the pictures already there and below the marks, so the marks stay
visible. **Send to back** on the editor's right-click menu moves a picture
behind everything else, and Undo reverses it. To trim one picture itself,
double-click it, or select it and use **Crop image** in the opened style
panel. **Crop drawing** puts an adjustable dashed rectangle around the
content: whatever lies outside it is left out of Copy result, PDF and Send,
but stays in the drawing, unchanged and editable. Drag its handles to adjust
it, press Delete to remove it, and Undo and Redo treat it like any other
element.

The Ora logo and vertical title sit between the drawing and the notes;
incoming pictures and fit commands use the whole drawing area. The numbered
notes stay beside the drawing on the right.

Every mark gets a number. The number sits at the back end of an arrow, and on
the outside edge of any other shape, and it follows the mark when it is moved,
reshaped or rotated. The list beside the picture holds one row per mark with
its note; the notes of a callout and of a text mark stay in step with what is
written on the picture. Deleting a mark removes its row, and Undo brings it
back with the same number.

### Copying and exporting

The third numbered row holds **Copy result**, **Export PDF**, **Save editable**
and **Library**. Copy result puts one PNG on the clipboard: the complete marked-up
picture, clipped to the drawing crop when one is set, with every numbered note
underneath it, outside the crop. Notes wrap at a readable size;
the image grows taller instead of cutting text off or shrinking it to fit.
The picture keeps its original pixels and size. With no notes, Copy result
copies the picture alone. Copied notes are image pixels rather than selectable
text; a receiving AI may resize very long images or misread text.
With nothing selected, Command-C on the canvas does the same, and so does
Edit > Copy. With objects selected, Command-C copies just those objects —
a copied picture stays a picture you can move, resize and crop on its own.
While editing a note or canvas text, Command-C copies
selected text, and the Edit menu preserves ordinary text editing. File > Copy
Result always copies the whole result. Use Duplicate to duplicate selected
marks. A success message appears after the native clipboard write succeeds.

**Export PDF** writes one PDF into `~/Pictures/Ora Screen Markup/`: the annotated
picture, clipped to the drawing crop when one is set, on the first page and
every numbered note as selectable text on the
pages after it. Each export gets its own dated name and nothing is ever
overwritten. The finished PDF is revealed in Finder.

### Editable drawings

**Save editable** (Command-S or Shift-Command-S) opens a native file chooser and
writes one `.excalidraw` file atomically. It includes the embedded pictures,
marks, numbers, notes and crop data, including the drawing-crop rectangle.
**Open Existing** (Command-O) or dropping an
editable `.excalidraw` file restores those details for further editing. Invalid
files and missing embedded pictures are rejected before replacing the scene.
A successful save is the preservation point; copying or exporting a PDF does
not save an editable drawing.

Older editable files keep their blur patches and retain the original image
pixels beneath a blur. Share Copy
result or Export PDF when the recipient should see only the flattened blur.
Quitting with unsaved editable content offers Save, Discard and Cancel. Closing
the window keeps the scene in the running app; reopening its window restores it.
There is no autosave or multi-capture collection.

## Build and install

```sh
scripts/build-app.sh            # build only
scripts/build-app.sh --install  # build and install into /Applications
```

The script installs the pinned editor packages with `npm ci`, builds the
bundled editor, builds the app with `swift build -c release`, packages
`dist/Ora Screen Markup.app` and signs it for this Mac. With `--install` the
finished bundle is copied to `/Applications/Ora Screen Markup.app`.

Installation requires the stable **Ora Screen Markup Local Signing** Code
Signing identity in the login Keychain. Its private key stays in Keychain;
trust is limited to code signing for this local installation. To use another
existing identity, set `ORA_SCREEN_MARKUP_SIGN_IDENTITY` to its certificate
name or fingerprint. A build-only run can fall back to an ad hoc signature;
the installer refuses that fallback because changing identity would invalidate
the screen-recording permission after updates.

Node and the Xcode command line tools are needed; no Xcode project is used.

## Return mode

A host can open the tool with `--return-folder <folder>` for one round trip.
The global capture shortcuts stay off, the window opens and waits for you to
choose Region, Window or Screen, and the output row gains a **Send** button. Sending writes
the flattened picture and its notes as `picture.png` and `notes.txt` into
that folder and closes the app; closing it any other way writes a
`cancelled` marker for the host. `--return-to <name>` names the destination:
the button reads "Send to <name>" and sending confirms "Sent to <name>."
Without it both say Vibe Coder. When sending fails, use **Copy result** to
keep the picture, then press **Capture** again.

## Notes

The interface uses the same dark-paper palette as Ora Markdown Viewer,
copied unchanged into `web/src/dark.css`. The window, editor controls, notes
and drawing surface use that palette. A subtle cream outline keeps dark
marks readable, including while drawing or editing text. The drawing
renderer keeps captured images in their original colors. Copy and PDF
export keep the original ink on white paper, without the display outline.

The editor is Excalidraw 0.18.1, bundled with its own fonts and licences in
`web/`. Ora's inline wordmark, gold step circles and Rock Salt spine typography
come from Vibe Coder. The complete local Rock Salt Regular font and its Apache
License 2.0 are bundled together; Copyright (c) 2010 by Font Diner, Inc DBA
Sideshow. The licence is also included in the bundled third-party notices.
The app itself is the Swift code in `Sources/OraScreenMarkup/`.
