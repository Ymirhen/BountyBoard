// Black Market Bounty Board configuration.
// Everything in this file is public (it's served by GitHub Pages), so never put secrets here.
window.BOARD_CONFIG = {
  // "Bounty Records" sheet in the "Bounty Project" Drive folder.
  // The board shows the "Active" tab; closed bounties move to "Completed" / "Failed",
  // and every merc on a completed bounty gets a row in "Completed by players".
  SHEET_ID: "18aIWb5d0SXblGI3A52q0Eni004KktkowDzoevcJS0HA",
  TABS: {
    active: "Active",
    completed: "Completed",
    failed: "Failed",
    players: "Completed by players",
  },

  // "Bounties" folder inside the shared "Bounty Project" folder. Every bounty gets its own folder here:
  //   Bounties/<GM name>/<bounty title>/  holding the module JSON, the session PDF and the unit cards.
  // GMs need Editor access to this folder. The board never reads or writes outside it.
  BOUNTIES_FOLDER_ID: "1d1ZtfKF1M7snVNc7oyjLzdZym-1pezH8",

  // OAuth client ID from Google Cloud Console (type: Web application).
  // Leave empty to run the board read-only (no sign-in, no hosting).
  GOOGLE_CLIENT_ID: "1057468511719-60ijafobim2afleic2rf91953o9ld369.apps.googleusercontent.com",
};
