# CORS setup for the cloud adapters

The CODA Settings page lets you point read-state / starred / notes / DMZ writes at a cloud bucket via three adapters: **WebDAV**, **Dropbox**, and **S3-compatible** (Cloudflare R2 / Backblaze B2 / Wasabi / MinIO / AWS S3).

Because the writes happen from a browser (the deployed `pages.dev` site) to a different origin (the storage host), the browser blocks them by default. CORS — Cross-Origin Resource Sharing — is the bucket-side header configuration that says "yes, this origin is allowed to write to me." Each provider configures it differently. This page lists working recipes for the three the adapter supports.

Throughout the recipes below, replace `https://witch-hat-atelier.pages.dev` with whatever URL you actually deployed to. The origin must match exactly — no trailing slash, scheme included.

---

## 1. Cloudflare R2 (S3-compatible adapter)

R2 is the same dashboard as Cloudflare Pages, so if your site is already hosted there, this is the lowest-friction option.

### 1.1 Create the bucket
1. Cloudflare dashboard → R2 → **Create bucket**.
2. Name it (e.g. `coda-state`). Pick a location hint close to you.

### 1.2 Create API credentials
1. R2 → **Manage R2 API Tokens** → **Create API Token**.
2. Permissions: **Object Read & Write**.
3. Scope it to the bucket from §1.1 (do not grant account-wide access).
4. Save the **Access Key ID** and **Secret Access Key**. You will not see the secret again.
5. Your **Account ID** is in the top-right of the dashboard. The endpoint is `https://<account-id>.r2.cloudflarestorage.com`.

### 1.3 Configure CORS on the bucket
1. R2 → your bucket → **Settings** → **CORS Policy** → **Edit**.
2. Paste this JSON (replacing the origin with your deployed URL):

   ```json
   [
     {
       "AllowedOrigins": ["https://witch-hat-atelier.pages.dev"],
       "AllowedMethods": ["GET", "PUT", "DELETE", "HEAD"],
       "AllowedHeaders": ["*"],
       "ExposeHeaders": ["ETag"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

3. Save.

`ExposeHeaders: ["ETag"]` is forward-compatible — once the §5 conditional-write follow-up lands, the adapter reads `ETag` from response headers. Without `ExposeHeaders` the browser sees the header but the adapter cannot read it.

### 1.4 Plug it into the site
1. Open the deployed site → click the cog sigil at the bottom of the rail.
2. Adapter: **S3-compatible (R2, B2, Wasabi)**.
3. Endpoint: `https://<account-id>.r2.cloudflarestorage.com`
4. Region: `auto`
5. Access key ID / Secret access key: from §1.2.
6. Bucket: the name from §1.1.
7. Type `PLAINTEXT` in the acknowledgement field (encryption is a follow-up PR; this gate is deliberate).
8. **Test connection** → expect OK.
9. **Save and reload**. From now on, every read / star / note / DMZ post writes an event to your R2 bucket.

Cloudflare's reference for R2 CORS: <https://developers.cloudflare.com/r2/buckets/cors/>.

---

## 2. Dropbox (Dropbox adapter)

Dropbox's Content API is configured by Dropbox to allow same-origin browser calls when authenticated with a valid app-scoped token. There is **no bucket-side CORS configuration to set** — you just need a token with the right scopes.

### 2.1 Create a Dropbox app
1. Sign in at <https://www.dropbox.com/developers/apps>.
2. **Create app** → API: *Scoped access*; Access: *App folder* (recommended, sandboxes writes to one folder); Name: anything, e.g. `coda-state`.
3. On the app's **Permissions** tab, enable `files.content.write` and `files.content.read`. Click **Submit**.

### 2.2 Generate an access token
1. On the app's **Settings** tab, scroll to *OAuth 2* → *Generated access token* → **Generate**.
2. Copy the token.

Generated tokens are short-lived and meant for prototyping. Full OAuth-with-refresh is a follow-up PR.

### 2.3 Plug it into the site
1. Settings → Adapter: **Dropbox**.
2. Access token: paste from §2.2.
3. Folder path: the default `/Apps/CODA` matches the App folder Dropbox creates.
4. Type `PLAINTEXT`, **Test**, **Save and reload**.

---

## 3. WebDAV / Nextcloud (WebDAV adapter)

WebDAV servers vary. The two configurations below cover the common ones.

### 3.1 Nextcloud
Nextcloud has CORS support via the [`headers` directive](https://docs.nextcloud.com/server/latest/admin_manual/configuration_server/reverse_proxy_configuration.html) in your reverse proxy, or via the `OC\Files\View` middleware if you self-host the bare PHP. The simplest path: add the headers at the reverse-proxy level (nginx / Caddy / Apache in front of Nextcloud).

Example nginx snippet inside the `server { }` block that proxies Nextcloud:

```nginx
location /remote.php/dav/ {
    add_header Access-Control-Allow-Origin "https://witch-hat-atelier.pages.dev" always;
    add_header Access-Control-Allow-Methods "GET, PUT, DELETE, PROPFIND, OPTIONS" always;
    add_header Access-Control-Allow-Headers "Authorization, Content-Type, Depth, If-Match" always;
    add_header Access-Control-Expose-Headers "ETag" always;
    add_header Access-Control-Allow-Credentials "true" always;
    if ($request_method = OPTIONS) {
        return 204;
    }
    proxy_pass http://nextcloud-upstream;
    # ... rest of your existing proxy_set_header lines ...
}
```

Use an **app password**, not your account password: Nextcloud → Settings → Security → Devices & sessions → Create new app password.

In the CODA Settings page, the WebDAV server URL is the WebDAV root for your user:
`https://<your-nextcloud-host>/remote.php/dav/files/<your-username>`

### 3.2 Generic WebDAV (Apache `mod_dav`, sabre/dav, etc.)
Same headers as Nextcloud above, applied at the server level. If the server is bare `mod_dav` on Apache, the equivalent stanza:

```apache
<Location "/dav">
    Header always set Access-Control-Allow-Origin "https://witch-hat-atelier.pages.dev"
    Header always set Access-Control-Allow-Methods "GET, PUT, DELETE, PROPFIND, OPTIONS"
    Header always set Access-Control-Allow-Headers "Authorization, Content-Type, Depth, If-Match"
    Header always set Access-Control-Expose-Headers "ETag"
    Header always set Access-Control-Allow-Credentials "true"
    RewriteEngine On
    RewriteCond %{REQUEST_METHOD} OPTIONS
    RewriteRule ^(.*)$ $1 [R=204,L]
</Location>
```

---

## 4. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `Test connection` fails with "blocked by CORS policy" in DevTools console | `AllowedOrigins` doesn't exactly match your deployed URL (trailing slash, http vs https, www mismatch) | Re-edit the CORS rule; copy the URL exactly from the browser address bar |
| Writes succeed but reads come back empty | Bucket and adapter prefix mismatch — the adapter writes to `coda/v1/...` (private) and `coda/dmz/...` (board). If the bucket already has different content at those prefixes, the adapter sees it. | Check the bucket contents. Start with an empty bucket if unsure. |
| Test connection OK, but Save reloads to an empty reader | Adapter loaded successfully but the snapshot didn't materialise. Check DevTools → Application → Local Storage for `coda.adapter` config, and DevTools → Network for the GET to the snapshot key. | If the snapshot key 404s, the adapter is fine — you just have no prior events. Star an article to write the first event. |
| Dropbox 401 unauthorized | Token expired or app permissions weren't granted | Re-generate the token in §2.2; re-submit permissions in §2.1 |
| WebDAV 405 Method Not Allowed on PUT | Reverse proxy stripped the `PUT` method | Confirm the proxy allows PUT / DELETE through to the WebDAV backend |

If `Test connection` fails with a CORS error, the request never reached the bucket — fix the bucket-side CORS first. If it fails with a 401/403/404, CORS is fine; the issue is the credentials or the bucket name.

---

## 5. After this lands

These recipes only cover storage CORS. They do not address:
- **Encryption.** Writes are still plaintext until the §5 follow-up PR ships AES-256-GCM with an Argon2id passphrase-derived key. Treat the bucket as readable by anyone with the credentials.
- **Conditional writes.** The §5 follow-up will add `If-Match` / `ETag` retry on 412 so two devices writing at the same time don't lose an event. Until then, briefly-concurrent writes can drop one append.
- **Real RSS feeds.** All of the above wires up state sync. Subscribing to feeds requires the §4 Cloudflare Worker, which is not built yet. See `ROADMAP.md` §4 and §8.1.
