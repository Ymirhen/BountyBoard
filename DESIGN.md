# Carpathia Bounty Board: design

## Purpose

The Wayward Vagrants' mercs take contracts from the Black Market. Each bounty is a **one-shot module** that a GM writes and hosts. The board:

- shows players what's on offer;
- gives GMs a structured tool for planning, running and closing out their one-shots.

Sign-ups happen on Discord, not on the board.

## Decisions

| Topic | Decision |
| --- | --- |
| Hosting | GitHub Pages, static files only, no server |
| Data | Google Drive and Sheets, reached from the browser with Google sign-in |
| Who can post | Approved GMs only. Google enforces this: only editors of the Bounty Records sheet can write to it |
| Approval | None. A GM's bounty is live as soon as they publish it |
| Sign-ups | Handled on Discord |
| Editing | GMs load, edit and manage their modules through the website |
| Languages | Plain HTML, CSS and JavaScript, with no build step |

## Roles

- **Visitor:** anyone. Reads the board without signing in.
- **GM:** signs in with Google and is an editor of the Bounty Records sheet. Writes modules, publishes cards, updates status, and closes bounties out.
- **Officer:** manages the GM list by adding and removing sheet editors in Drive. Can fix records directly in the sheet.

## Data layout

```
Bounty Project/                    (Drive folder, owned by the guild lead)
├── Bounties/                      poster art, shared GM material
└── Bounty Records (sheet)
    ├── Active                     public cards shown on the board
    ├── Completed                  archive
    ├── Failed                     archive
    └── Completed by players       one row per merc per completed bounty

Each GM's own Drive (private, created by the board on first save)
└── Carpathia Bounty Board/
    ├── Module data/               <title>.json, the module the builder loads and saves
    └── Session modules/           <title> - Session module.pdf, regenerated on every save
```

### Active tab (public)

`id, title, level, initial_reward, final_reward, status, gm_name, session_time, location, hook, image_url, created_at, updated_at`

- `status` is `Open` or `Full`. Closed bounties leave this tab.
- `initial_reward` is what the posting offers. `final_reward` is what was actually paid, set at close-out.
- Nothing secret goes here, because the sheet is link-shared as Viewer.

### Completed / Failed tabs

`id, title, level, initial_reward, final_reward, gm_name, session_time, party, closed_at, notes`

### Completed by players tab

`character, player, bounty_id, bounty_title, level, gold_earned, date`

## Module structure

| Section | Contents |
| --- | --- |
| On the board (public) | Title, level 0–10, initial reward, status, session time, location, GM name, poster art URL, hook |
| Overview | Premise, objective, success and failure conditions, briefing |
| Scenes (repeatable) | Name, location, what happens, RP beats, rolls and checks |
| NPCs (repeatable) | Name, title, portrait URL, HP, raid marker, positive and negative traits, card description, motivation, secret. Optional combat stats: Offense 1–3, Defense 1–3, Heals (level 1–3), Buffs (level 1–3) |
| Enemies (repeatable) | Name, title, portrait URL, HP, raid marker, Offense 1–3, Defense 1–3, Heals and Buffs toggles with levels, positive and negative traits, card description, tactics. The builder shows the D100 tables for the chosen tiers |
| Twists and rewards | Complications, items, reputation, GM notes |
| Outcome (after close-out) | Completed / Failed, final reward, party, gold per merc, notes |

## Bounty wall (public board)

- The board is a mahogany-paneled wall seen through a window. Level 10 is the top row and level 0 the bottom; empty levels collapse to a thin strip with their plaque.
- Each bounty is a parchment notice tacked to its level's brass rail, with a slight stable tilt. It shows poster art (or the hook), title, koban level coins, reward, GM and session time. Clicking opens the full posting.
- **Camera:** moving the mouse into the outer 20% of the window glides the view that way, and the centre is a dead zone so cards stay put while you aim. Click-drag and touch-drag pan, the wheel scrolls (and lets the page scroll once the wall's end is reached), and arrow keys pan when the wall has focus. With reduced motion, edge-gliding is off.
- Status filter chips dim non-matching notices. A **List view** toggle (remembered per browser) shows the plain sortable grid.

## Unit cards

Every NPC and enemy can be exported as a unit card (1000 × 620 PNG, rendered at 2×):
- **Left side:** name with its raid marker symbol, `<title>`, the portrait, and level badges (Offense, Defense, plus Healing and Buff when enabled). An NPC with no combat stats is marked as a non-combatant.
- **Right side:** an NPC / ENEMY tag, HP, Positive and Negative trait columns, and the card description.
- Trait lines written as "Name: effect" get a bold name. The text shrinks automatically when there are many traits.
- The icons are original line art.

Portraits only export if the image host allows cross-origin use. `i.ibb.co` direct links are the recommended host.

## Session module PDF

On every save, the module is laid out as a printed one-shot (A4) and saved to the GM's "Session modules" folder:
- **Cover page:** title, level coins, rewards, GM, session, location, poster art, the posting, and a GM-only notice.
- **Body:** the overview with objective, success and failure boxes; the briefing as a read-aloud box; scenes with RP beats and roll boxes; the cast and enemies as unit cards with their D100 tables; a healing and buffing reference; twists; rewards; GM notes; and the outcome once closed.
- Pages are flowed by the board itself: headings stay with what follows, and cards and boxes never split.

"Download PDF" in the builder makes the same PDF locally without saving.

## Flows

1. **Write and publish:**
   1. The GM signs in and opens Host a new bounty, then fills in the builder and saves.
   2. The board folder and its subfolders are created if missing. The module JSON is saved in Module data, and the session module PDF is generated into Session modules.
   3. The card is added to the Active tab, or updated if it's already there.
   4. If the GM isn't a sheet editor, the module is still saved privately, and the board explains that only approved GMs can publish.
2. **Edit:** the GM opens My bounties, picks a module, edits it and saves. The same three things are updated.
3. **Mark full:** the GM sets the status to Full and saves. The card's stamp changes.
4. **Close out:**
   1. The GM chooses Completed or Failed, sets the final reward (it defaults to the initial reward), lists the party as `Character - Player` lines, and sets gold per merc.
   2. A row goes to Completed or Failed, and on completion, one row per merc goes to Completed by players.
   3. The card is removed from Active.
   4. The module and its PDF record the outcome.

## Privacy and security

- Module plans are private through Drive ownership: they're created in the GM's own Drive with the `drive.file` scope. The app can only see files it created, never the rest of the GM's Drive.
- The site holds no secrets. The OAuth client ID is public by design, and there is no client secret.
- A static site can't hide configuration, so there is no private GM email list in the code. GM status is "is an editor of the sheet", which is managed in Drive.
- Everything read from the sheet is shown as plain text, and only `https` image links are used.

## Out of scope for v1 / later ideas

- Sign-ups and party slots on the board (Discord for now).
- Off-screen alt missions with timers and AI-resolved outcomes, as discussed by the guild. These need scheduled automation, which a static site can't do on its own.
- Co-GMs on one module (sharing the module JSON with another GM).
- Generating poster art from the board.
