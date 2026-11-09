// Carpathia Bounty Board configuration.
// Everything in this file is public (it's served by GitHub Pages), so never put secrets here.
window.BOARD_CONFIG = {
  // The Google Sheet that holds the public bounty summaries.
  SHEET_ID: "1mdGPnD4yEtIZ5hBxBzHgpTEUa6mmkbHTDLUE6HtGfGQ",
  SHEET_TAB: "Bounties",

  // OAuth client ID from Google Cloud Console (type: Web application).
  // Leave empty to run the board read-only (no sign-in, no posting).
  GOOGLE_CLIENT_ID: "",

  // GM / officer Google accounts that get view access to every new bounty's private details doc.
  GM_EMAILS: [],

  // When true, new bounties are hidden until an officer sets "approved" to TRUE in the sheet.
  REQUIRE_APPROVAL: true,
};
