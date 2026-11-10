// Carpathia System data used by the module builder, unit cards and session-module PDFs.
// An enemy's Offense level sets the table players roll on when attacking it;
// its Defense level sets the table players roll on when it attacks them.
window.CARPATHIA = {
  offense: {
    1: [["1 or less", "-1 HP (self)"], ["2–19", "0 dmg"], ["20–39", "+1 dmg"], ["40–59", "+2 dmg"], ["60–79", "+3 dmg"], ["80–99", "+4 dmg"], ["100+", "+5 dmg"]],
    2: [["1 or less", "-1 HP (self)"], ["2–39", "0 dmg"], ["40–59", "+1 dmg"], ["60–79", "+2 dmg"], ["80–99", "+3 dmg"], ["100+", "+4 dmg"]],
    3: [["1 or less", "-1 HP (self)"], ["2–59", "0 dmg"], ["60–79", "+1 dmg"], ["80–99", "+2 dmg"], ["100+", "+3 dmg"]],
  },
  defense: {
    1: [["1 or less", "-2 HP"], ["2–39", "-1 HP"], ["40+", "0 HP"], ["100+", "+1 counter dmg"]],
    2: [["1 or less", "-3 HP"], ["2–29", "-2 HP"], ["30–49", "-1 HP"], ["50+", "0 HP"], ["100+", "+1 counter dmg"]],
    3: [["1 or less", "-4 HP"], ["2–29", "-3 HP"], ["30–49", "-2 HP"], ["50–69", "-1 HP"], ["70+", "0 HP"], ["100+", "+1 counter dmg"]],
  },
  // Carpathia has a single healing table and a single buffing table; the unit's level is shown alongside.
  healing: [["1 or less", "-1 HP"], ["2–29", "0 HP"], ["30–59", "+1 HP"], ["60–79", "+2 HP"], ["80–99", "+3 HP"], ["100+", "+4 HP"]],
  buffing: [["1–19", "No effect"], ["20–39", "+5"], ["40–59", "+10"], ["60–79", "+15"], ["80–99", "+20"], ["100+", "+25"]],
  tierHints: {
    offense: {
      1: "Small or unarmored: critters, wildlife, civilians",
      2: "Armored or mid-to-large: guardsmen, ogres, elementals, lesser demons",
      3: "Strong, heavily armored or hard to hit: bosses, constructs, giants",
    },
    defense: {
      1: "Slow or weak: oozes, unarmed or restrained foes",
      2: "Proficient in combat or magic: adept swordsmen, necromancers",
      3: "Powerful, hard to dodge",
    },
  },
  // Raid markers as [name, symbol]. Symbols are plain Unicode so they render anywhere.
  markers: [["", ""], ["Skull", "☠"], ["Cross", "✖"], ["Square", "■"], ["Moon", "☾"], ["Triangle", "▲"], ["Diamond", "◆"], ["Circle", "●"], ["Star", "★"]],
};
