# Carpathia Bounty Board

A Black Market bounty board for the Wayward Vagrants guild (Carpathia System). Each bounty is a one-shot module that one of the guild's GMs writes and hosts. It runs as a static site on GitHub Pages, with Google Drive as the backend.

- **Anyone** can read the board.
- **Approved GMs** sign in with Google to write modules, publish them to the board, update them, and close them out.
- Module plans live in each GM's own Google Drive and stay private.
- Sign-ups happen on Discord.

See [DESIGN.md](DESIGN.md) for the full design. The site is plain HTML, CSS and JavaScript with no build step.

## Setup

1. **GitHub Pages:** go to Settings → Pages → *Deploy from a branch* → `main` / `(root)`. The board is then at `https://ymirhen.github.io/BountyBoard/`.
2. **Bounty Records sheet** (in the "Bounty Project" Drive folder):
   - Share it as *Anyone with the link: Viewer* so the board can read the Active tab.
   - Add each approved GM's Google account as an **Editor**. That's what makes someone a GM.
3. **Google OAuth client:**
   1. In [Google Cloud Console](https://console.cloud.google.com/), create a project.
   2. Enable the **Google Drive API** and the **Google Sheets API**.
   3. Set up the OAuth consent screen: choose External and leave it in **Testing**. Add the GMs' Google accounts as **test users** (up to 100).
   4. Add these scopes: `drive.file`, `spreadsheets`, `openid`, `email`, `profile`.
   5. Under Credentials, create an OAuth client ID of type **Web application**. Set **Authorized JavaScript origins** to `https://ymirhen.github.io`.
   6. Put the client ID in `GOOGLE_CLIENT_ID` in `config.js`. It's public by design, and there is no client secret.

## Files

| File | What it is |
| --- | --- |
| `index.html` | Page layout: board, My bounties, module builder, close-out dialog |
| `app.js` | All behaviour: board, Google sign-in, Drive and Sheets calls, editor |
| `carpathia.js` | Carpathia System D100 offense and defense tables, plus tier hints |
| `config.js` | Sheet ID, tab names, OAuth client ID |
| `styles.css` | Look and feel |

## Local preview

Run `python3 -m http.server 8000`, then open `http://localhost:8000/?demo=1`. Demo mode uses sample data and an in-memory backend, so you can try the whole GM flow without Google. To test real sign-in locally, add `http://localhost:8000` to the OAuth client's JavaScript origins.

## Poster art prompt (sumi-e wanted poster)

Paste the style block exactly as it is, then add one subject line. Upload the image somewhere public, for example the Bounties Drive folder shared by link, and put the link in "Poster art URL".

```
Japanese wanted poster ("tehaisho") painted in black sumi-e ink wash on aged cream washi paper. Loose expressive brush strokes, dry-brush texture, ragged torn edges on the figure, heavy ink splatter and flecks around it. Pure black ink only, with pale negative space for highlights. Composition: a single dark figure in the center, one huge bold calligraphy title area at the top right (leave it empty), two vertical columns of small calligraphy at the left (leave them empty), and three small red square hanko seals at the bottom right. No gradients, no color other than black ink and red seals, high contrast, vertical portrait layout.
Subject: [WHO: race/build/outfit], [HEADGEAR/SILHOUETTE DETAIL], holding [WEAPON], [POSE/MOOD].
```
