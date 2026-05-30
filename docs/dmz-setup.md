# DMZ setup, browser-only (no terminal)

The DMZ is the shared board. Anyone who opens the page can read it, post text, edit
their own notes, and upload files. This guide turns that on using only websites you
click through. No command line, no git client, no installs.

You do this once. Everyone else just opens the page.

Two halves:

- **Text board** (notes you type) lives in a GitHub branch, written by the Worker.
- **Files** (images, PDFs, anything you attach) live in **Telegram**, also through the
  Worker, so storage is effectively unlimited and free.

The text board has to exist first. Files build on top of it.

---

## Part A: the text board (all in the browser)

### 1. Make a data branch on GitHub

1. Open your repository on github.com.
2. Click the **branch dropdown** (top-left of the file list, usually says `main`).
3. Type `dmz-data` in the box and click **Create branch: dmz-data from main**.

That is it. A copy of `main` is fine; the Worker only writes files under `dmz/` on that
branch.

### 2. Make a GitHub access token

1. Top-right avatar, **Settings**, then far down the left side **Developer settings**.
2. **Personal access tokens**, then **Fine-grained tokens**, then **Generate new token**.
3. **Repository access**: Only select repositories, pick your repo.
4. **Permissions**, **Repository permissions**, find **Contents** and set it to
   **Read and write**.
5. Generate, then **copy the token now** (you cannot see it again).

### 3. Pick two random strings

Use any password generator. Make two long strings and label them:

- **HMAC secret**, the Worker uses it to prove who posted each note. Nobody types it.
- **Owner token**, yours. You paste it into the app later; it lets you edit or delete
  any note. Keep it private.

### 4. Put everything on the Pages project (Cloudflare dashboard)

Your site is a Cloudflare **Pages** project (it deploys from this repo). The DMZ
backend runs as a Pages Function on the same site, so the settings go on the Pages
project, there is no separate Worker.

1. Go to **dash.cloudflare.com**, open **Workers & Pages**, click your project
   (**witch-hat-atelier**).
2. Open **Settings**, then **Variables and Secrets**.
3. Add these as **Secret** (the encrypted kind):
   - `DMZ_GITHUB_TOKEN` = the token from step 2
   - `DMZ_HMAC_SECRET` = your HMAC secret
   - `DMZ_OWNER_TOKEN` = your owner token
4. Add these as **Text/Variable** (plain):
   - `DMZ_GITHUB_OWNER` = your GitHub username
   - `DMZ_GITHUB_REPO` = the repository name
   - `DMZ_GITHUB_BRANCH` = `dmz-data`
   - `DMZ_ALLOWED_ORIGINS` = the address where your site is hosted, for example
     `https://your-site.pages.dev`
5. Save. The dashboard redeploys the Worker for you.

> Your Pages project is connected to this GitHub repo, so it redeploys automatically
> whenever changes merge to the main branch. After saving variables, trigger one
> redeploy (or merge any change) so the new values and the `/dmz/*` function go live.

### 5. Check it

Open `https://witch-hat-atelier.pages.dev/dmz/health` in the browser (use your own
`pages.dev` address if it differs). You want `"configured": true`.

### 6. That is it, the board is live for everyone

Once the steps above are deployed, every device that opens the page joins the same
board automatically. Nobody has to open Settings, paste a URL, or tick a box. Each
device can post and can edit or remove the notes it created.

You only open **Settings**, **DMZ shared board** if you want owner powers: paste your
**owner token** there, on your own device, to edit or remove anyone's note. The base
URL field is only for the unusual case where the page and the DMZ backend are hosted on
different origins.

---

## Part B: files (Telegram storage, also browser-only)

This adds the **Attach a file** button and unlimited file storage.

### 1. Make a Telegram bot

1. In Telegram, open a chat with **@BotFather**.
2. Send `/newbot`, follow the prompts, and copy the **bot token** it gives you.

### 2. Make a place for files and find its id

1. Create a Telegram **channel or group** for the files (private is fine).
2. Add your bot to it as an **administrator** so it can post.
3. Post any message in that chat.
4. In a browser, open
   `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates` and read the
   `"chat":{"id": ...}` number. Channel and group ids usually start with `-100`.

### 3. Add the two Telegram values on the Worker

Back in Cloudflare, **Workers & Pages**, your **witch-hat-atelier** project,
**Settings**, **Variables and Secrets**. Add as **Secret**:

- `DMZ_TELEGRAM_TOKEN` = the bot token
- `DMZ_TELEGRAM_CHAT` = the chat id number

Optional plain variable `DMZ_MAX_FILE_MB` changes the per-file size limit (default 25).
Save and redeploy. Reopen `https://witch-hat-atelier.pages.dev/dmz/health`; you now
want `"files": true`.

Reload the app. The **Attach a file** button appears on the board.

---

## What moderation does, and what it cannot do

Every post and upload is checked on the Worker, before it lands, so editing the page in
browser dev tools cannot get around it.

- **Text, captions, and file names** run through a matcher that folds look-alike
  letters, strips accents, undoes common leetspeak, and fuzzy-matches an adult-content
  lexicon. Clear CSAM-adjacent terms are hard-blocked; general adult terms are rejected.
- **Files** are also gated by type and size. Executable and active-script types
  (`.exe`, `.js`, `.html`, `.svg`, and similar) are refused so the board cannot hand out
  malware.

Honest limits, so nothing surprises you:

- **Image contents are not scanned by default.** A clean filename and caption on an
  explicit image will pass unless the optional Workers AI hook is configured, and even
  then it covers still images, not video or audio.
- **Deleting a file removes it from the board, not from Telegram.** A bot cannot reliably
  delete its own old uploads, so the bytes may stay in your Telegram chat after the note
  disappears.
- **"No length limit" means no artificial cap**, not infinity. The real ceiling is what
  the GitHub Contents API stores in one file.

## Quick health check

- `/dmz/health` showing `{"configured": true, "files": true}` means both halves are live.
- `configured` false means a Part A value is missing or misspelled.
- `files` false means a Part B Telegram value is missing.
