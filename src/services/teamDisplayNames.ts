// Informal short names for live-feed commentary text (e.g. "FULL TIME.
// Coventry 0 Brighton 5" instead of the full official name) -- distinct from
// SportMonks' own short_code (e.g. "COV"/"BHA"), which is used for the
// fixture label next to the timestamp instead. Keyed on the exact string
// SportMonks/our fixtures.home_team|away_team stores. Falls back to the full
// name for anything not listed (e.g. Scottish Premiership clubs, or a club
// newly promoted into a tracked league before this list is updated).
const TEAM_DISPLAY_NAMES: Record<string, string> = {
  "Arsenal": "Arsenal",
  "Aston Villa": "Villa",
  "AFC Bournemouth": "Bournemouth",
  "Brentford": "Brentford",
  "Brighton & Hove Albion": "Brighton",
  "Chelsea": "Chelsea",
  "Coventry City": "Coventry",
  "Crystal Palace": "Palace",
  "Everton": "Everton",
  "Fulham": "Fulham",
  "Hull City": "Hull",
  "Ipswich Town": "Ipswich",
  "Leeds United": "Leeds",
  "Liverpool": "Liverpool",
  "Manchester City": "Man City",
  "Manchester United": "Man United",
  "Newcastle United": "Newcastle",
  "Nottingham Forest": "Forest",
  "Sunderland": "Sunderland",
  "Tottenham Hotspur": "Spurs",
};

export function shortTeamName(fullName: string | null | undefined): string {
  if (!fullName) return fullName ?? "";
  return TEAM_DISPLAY_NAMES[fullName] ?? fullName;
}
