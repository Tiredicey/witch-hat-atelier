# DMZ setup, in plain steps

The DMZ is the shared board. Anyone who opens the page can read it, post text, edit
their own notes, and upload files. This guide turns that on. No coding needed, but you
will copy-paste a few secret values into a Cloudflare Worker.

You only do this once. Everyone else just opens the page.

There are two halves:

- **Text board** (notes you type) is stored in a GitHub branch through the Worker.
- **Files** (images, PDFs, anything you attach) are stored in **Telegram**, also through
  the Worker, so the storage is effectively unlimited and free.

You can set up the text board alone, or both. Files need the Telegram half.

---

## Part A: the text board

### 1. Make a place for the data to live (GitHub)

1. On GitHub, open the repository you want to hold the board data (your fork of
   `witch-hat-atelier` is fine).
2. Create an empty branch named `dmz-data`. The fastest way, if you have the repo on
   your computer:
   ```
   git checkout --orphan dmz-data
   git rm -rf .
   git commit --allow-empty -m "dmz data branch"
   git push origin dmz-data
   ```
   If that looks scary, ask anyone comfortable with git to make an empty branch called
   `dmz-data`. Nothing else goes in it; the Worker fills it.
3. Make a **fine-grained personal access token**: GitHub → Settings → Developer
   settings → Fine-grained tokens. Give it access to that one repository, with
   **Contents: Read and write**. Copy the token somewhere safe for the next step.

### 2. Pick two random passwords

You need two long random strings. Any password generator works. Label them so you
remember which is which:

- **HMAC secret**, the Worker uses this to prove who posted each note. Nobody types it.
- **Owner token**, this is *yours*. Paste it into the app's Settings later, and it lets
  you delete or edit anyone's note. Keep it private.

### 3. Put the secrets on the Worker

The Worker is the small program that already powers feed fetching. From the `worker`
folder, run these and paste each value when asked:

```
wrangler secret put DMZ_GITHUB_TOKEN     # the fine-grained token from step 1.3
wrangler secret put DMZ_HMAC_SECRET      # the HMAC secret from step 2
wrangler secret put DMZ_OWNER_TOKEN      # the owner token from step 2
```

Then set three plain values in `wrangler.toml` under `[vars]` (there is a commented
template in that file):

```
DMZ_GITHUB_OWNER  = "your-github-login"
DMZ_GITHUB_REPO   = "the-repo-name"
DMZ_GITHUB_BRANCH = "dmz-data"
DMZ_ALLOWED_ORIGINS = "https://your-site-url"
```

Deploy with `wrangler deploy`. Visit `https://your-worker-url/dmz/health` in a browser.
You want to see `"configured": true`.

### 4. Turn it on in the app

1. Open the app, go to **Settings → DMZ shared board**.
2. Paste the Worker URL.
3. Paste your **owner token**.
4. Tick **Use the Worker for the DMZ board on this device** and Save. Reload.

Everyone who opens the page now shares one board. Each device can delete and edit the
notes it posted; your owner token can manage all of them.

---

## Part B: files (Telegram storage)

This adds the **Attach a file** button and unlimited file storage.

### 1. Make a Telegram bot

1. In Telegram, open a chat with **@BotFather**.
2. Send `/newbot`, follow the prompts, and copy the **bot token** it gives you.

### 2. Make a place for files and get its id

1. Create a Telegram **channel or group** for the board's files (private is fine).
2. Add your new bot to it as an **administrator** (it needs permission to post).
3. Get the chat's numeric id. The simplest way: post any message in the chat, then open
   `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` in a browser and read the
   `"chat":{"id": ...}` value. Group and channel ids usually start with `-100`.

### 3. Tell the Worker about Telegram

From the `worker` folder:

```
wrangler secret put DMZ_TELEGRAM_TOKEN   # the bot token from B.1
wrangler secret put DMZ_TELEGRAM_CHAT    # the numeric chat id from B.2
```

Optional: set `DMZ_MAX_FILE_MB` in `wrangler.toml` to change the per-file limit
(default 25 MB). Deploy again with `wrangler deploy`. Check `/dmz/health` shows
`"files": true`.

Reload the app. The **Attach a file** button now appears on the board.

---

## How moderation works, and what it cannot do

The Worker checks every post and upload before it lands, on the server, so editing the
page in dev tools cannot get around it:

- **Text and captions and file names** run through a matcher that folds look-alike
  letters, strips accents, undoes common leetspeak, and fuzzy-matches an adult-content
  lexicon. Clear CSAM-adjacent terms are hard-blocked; general adult terms are rejected.
- **Files** are also gated by type and size. Executable and active-script types
  (`.exe`, `.js`, `.html`, `.svg`, and similar) are refused so the board can't be used
  to hand out malware.

Honest limits, so you are not surprised:

- **Image contents are not scanned by default.** A clean filename and caption on an
  explicit image will pass unless you enable the optional Workers AI hook
  (`DMZ_NSFW_MODEL` in `wrangler.toml`). Even then it covers still images, not video or
  audio.
- **Deleting a file removes it from the board, not from Telegram.** A Telegram bot
  cannot reliably delete its own old uploads, so the bytes may remain in your Telegram
  chat after a note disappears from the board.
- **"No length limit" means no artificial cap.** The real ceiling is what the GitHub
  Contents API will store in one file, not infinity.

## Quick health check

- `/dmz/health` → `{"configured": true, "files": true}` means both halves are live.
- `configured` false → a Part A secret or var is missing.
- `files` false → a Part B Telegram secret is missing.
