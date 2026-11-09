// Carpathia Bounty Board configuration.
// Everything in this file is public (it's served by GitHub Pages), so never put secrets here.
window.BOARD_CONFIG = {
  // "Bounty Records" sheet in the "Bounty Project" Drive folder.
  // The board shows the "Active" tab; "Completed", "Failed" and "Completed by players" are the archive.
  SHEET_ID: "18aIWb5d0SXblGI3A52q0Eni004KktkowDzoevcJS0HA",
  SHEET_TAB: "Active",

  // OAuth client ID from Google Cloud Console (type: Web application).
  // Leave empty to run the board read-only (no sign-in, no posting).
  GOOGLE_CLIENT_ID: "",

  // GM / officer Google accounts that get view access to every new bounty's private details doc.
  GM_EMAILS: [],

  // When true, new bounties are hidden until an officer sets "approved" to TRUE in the sheet.
  REQUIRE_APPROVAL: true,
};
