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

Each GM's own Drive (private)
├── Bounty module - <title>.json   module source of truth, created by the board
└── Run sheet - <title> (Doc)      readable GM handout, regenerated on every save
```

### Active tab (public)

`id, title, level, reward_gold, status, gm_name, session_time, party_size, location, hook, image_url, created_at, updated_at`

- `status` is `Open` or `Full`. Closed bounties leave this tab.
- Nothing secret goes here, because the sheet is link-shared as Viewer.

### Completed / Failed tabs

`id, title, level, reward_gold, gm_name, session_time, party, closed_at, notes`

### Completed by players tab

`character, player, bounty_id, bounty_title, level, gold_earned, date`

## Module structure

| Section | Contents |
| --- | --- |
| On the board (public) | Title, level 1–10, reward, party size, status, session time, location, GM name, poster art URL, hook |
| Overview | Premise, objective, estimated length, success and failure conditions |
| Briefing | What the Black Market contact tells the mercs |
| Scenes (repeatable) | Name, location, what happens, RP beats, rolls and checks |
| NPCs (repeatable) | Name, role, motivation, secret |
| Encounters (repeatable) | Enemy, count, HP, Carpathia Offense 1–3 and Defense 1–3, raid marker, buffs / NDE, tactics. The builder and the run sheet show the D100 tables for the chosen tiers |
| Twists and rewards | Complications, items, reputation, GM notes |
| Outcome (after close-out) | Completed / Failed, party, gold per merc, notes |

## Flows

1. **Write and publish:**
   1. The GM signs in and opens Host a new bounty, then fills in the builder and saves.
   2. The module JSON is saved in the GM's Drive, and the run sheet Doc is created or updated.
   3. The card is added to the Active tab, or updated if it's already there.
   4. If the GM isn't a sheet editor, the module is still saved privately, and the board explains that only approved GMs can publish.
2. **Edit:** the GM opens My bounties, picks a module, edits it and saves. The same three things are updated.
3. **Mark full:** the GM sets the status to Full and saves. The card's stamp changes.
4. **Close out:**
   1. The GM chooses Completed or Failed, lists the party as `Character - Player` lines, and sets gold per merc.
   2. A row goes to Completed or Failed, and on completion, one row per merc goes to Completed by players.
   3. The card is removed from Active.
   4. The module and run sheet record the outcome.

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
