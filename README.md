# Carpathia Bounty Board

A Black Market bounty board for the Wayward Vagrants guild (Carpathia System). It's a static site on GitHub Pages with Google Drive as the backend, so there's no server to run.

- **Anyone** can read the board.
- **Guild members** sign in with Google to post a bounty.
- Each bounty's **private details** go in a Google Doc in the poster's own Drive. Google's own sharing decides who can open it: the poster, plus any GMs listed in `config.js`.
- New bounties stay hidden until an officer sets `approved` to `TRUE` in the sheet. You can turn this off with `REQUIRE_APPROVAL` in `config.js`.

The site is plain HTML, CSS and JavaScript with no build step. `config.js` is the only file you should need to edit.

## How it works

| Piece | Where it lives | Who can see it |
| --- | --- | --- |
| Board page | GitHub Pages (this repo) | Everyone |
| Bounty summaries (title, level, reward, status…) | The "Bounties" tab of the board Google Sheet | Everyone (the sheet is link-shared as Viewer) |
| Private event details | A Google Doc created in the poster's Drive | The poster, plus GMs it's shared with |

Never put anything secret in the sheet, because it's public. Secrets go in the details doc.

### Sheet columns

`id, title, level, reward_gold, status, poster_name, location, summary, details_doc_url, image_url, created_at, approved`

- `status` is `Open`, `Claimed` or `Completed`. Posters and officers edit it directly in the sheet.
- `approved` is `TRUE` or `FALSE`.

## Setup

1. **Enable GitHub Pages:** go to Settings → Pages → *Deploy from a branch* → `main` / root.
2. **Share the board sheet:**
   - Share it as *Anyone with the link: Viewer* so the board can read it.
   - Add guild members who should post as **Editors**, because posting appends a row with their own Google account.
3. **Create a Google OAuth client** (needed for sign-in and posting):
   1. In [Google Cloud Console](https://console.cloud.google.com/), create a project.
   2. Enable the **Google Drive API** and the **Google Sheets API**.
   3. Under *OAuth consent screen*, choose External and leave it in **Testing**. Add the guild members' Google accounts as **test users** (up to 100), so no Google verification is needed. They'll see an "unverified app" warning once.
   4. Under *Credentials*, create an *OAuth client ID* of type **Web application**. Add `https://ymirhen.github.io` under **Authorized JavaScript origins**.
   5. Paste the client ID into `GOOGLE_CLIENT_ID` in `config.js`. The client ID is public by design, and there is no client secret.
4. **Add GM emails** to `GM_EMAILS` in `config.js`. Every new details doc is shared with them as viewers. Note that this list is public in the repo.

## Local preview

Serve the folder with any static server, for example `python3 -m http.server`. Then open:
- `http://localhost:8000/?demo=1` to see sample bounties without touching the sheet.
- `http://localhost:8000/` to read the real sheet once it's shared.

Google sign-in only works on origins you listed in the OAuth client, so add `http://localhost:8000` there if you want to test posting locally.

## Permissions the site asks for

- `drive.file` lets it create the details doc in your Drive. It can only see files this app created, never the rest of your Drive.
- `spreadsheets` lets it add your bounty row to the board sheet.

## Poster art prompt (sumi-e wanted poster)

Paste the style block exactly as it is, then add one subject line. Upload the result somewhere public and put the link in the "Poster art URL" field.

```
Japanese wanted poster ("tehaisho") painted in black sumi-e ink wash on aged cream washi paper. Loose expressive brush strokes, dry-brush texture, ragged torn edges on the figure, heavy ink splatter and flecks around it. Pure black ink only, with pale negative space for highlights. Composition: a single dark figure in the center, one huge bold calligraphy title area at the top right (leave it empty), two vertical columns of small calligraphy at the left (leave them empty), and three small red square hanko seals at the bottom right. No gradients, no color other than black ink and red seals, high contrast, vertical portrait layout.
Subject: [WHO: race/build/outfit], [HEADGEAR/SILHOUETTE DETAIL], holding [WEAPON], [POSE/MOOD].
```
