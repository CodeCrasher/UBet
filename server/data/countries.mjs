// Maps team names (and common variants from different providers) to a stable
// 3-letter code + flag emoji, so live-synced fixtures render consistently
// regardless of which provider supplied the name ("South Korea" vs
// "Korea Republic", "USA" vs "United States", "IR Iran" vs "Iran", …).

const TABLE = [
  ['ARG', '🇦🇷', 'Argentina'],
  ['AUS', '🇦🇺', 'Australia'],
  ['AUT', '🇦🇹', 'Austria'],
  ['BEL', '🇧🇪', 'Belgium'],
  ['BOL', '🇧🇴', 'Bolivia'],
  ['BIH', '🇧🇦', 'Bosnia-Herzegovina', 'Bosnia and Herzegovina', 'Bosnia & Herzegovina'],
  ['BRA', '🇧🇷', 'Brazil'],
  ['CMR', '🇨🇲', 'Cameroon'],
  ['CAN', '🇨🇦', 'Canada'],
  ['CHI', '🇨🇱', 'Chile'],
  ['COL', '🇨🇴', 'Colombia'],
  ['CRC', '🇨🇷', 'Costa Rica'],
  ['CIV', '🇨🇮', 'Ivory Coast', "Cote d'Ivoire", "Côte d'Ivoire"],
  ['CRO', '🇭🇷', 'Croatia'],
  ['CZE', '🇨🇿', 'Czech Republic', 'Czechia'],
  ['COD', '🇨🇩', 'DR Congo', 'Congo DR', 'Democratic Republic of the Congo'],
  ['DEN', '🇩🇰', 'Denmark'],
  ['ECU', '🇪🇨', 'Ecuador'],
  ['EGY', '🇪🇬', 'Egypt'],
  ['ENG', '🏴󠁧󠁢󠁥󠁮󠁧󠁿', 'England'],
  ['FRA', '🇫🇷', 'France'],
  ['GER', '🇩🇪', 'Germany'],
  ['GHA', '🇬🇭', 'Ghana'],
  ['GRE', '🇬🇷', 'Greece'],
  ['HON', '🇭🇳', 'Honduras'],
  ['IRN', '🇮🇷', 'Iran', 'IR Iran'],
  ['IRQ', '🇮🇶', 'Iraq'],
  ['ITA', '🇮🇹', 'Italy'],
  ['JAM', '🇯🇲', 'Jamaica'],
  ['JPN', '🇯🇵', 'Japan'],
  ['JOR', '🇯🇴', 'Jordan'],
  ['KSA', '🇸🇦', 'Saudi Arabia'],
  ['KOR', '🇰🇷', 'South Korea', 'Korea Republic', 'Korea, South'],
  ['MAR', '🇲🇦', 'Morocco'],
  ['MEX', '🇲🇽', 'Mexico'],
  ['NED', '🇳🇱', 'Netherlands', 'Holland'],
  ['NZL', '🇳🇿', 'New Zealand'],
  ['NGA', '🇳🇬', 'Nigeria'],
  ['NOR', '🇳🇴', 'Norway'],
  ['PAN', '🇵🇦', 'Panama'],
  ['PAR', '🇵🇾', 'Paraguay'],
  ['PER', '🇵🇪', 'Peru'],
  ['POL', '🇵🇱', 'Poland'],
  ['POR', '🇵🇹', 'Portugal'],
  ['QAT', '🇶🇦', 'Qatar'],
  ['IRL', '🇮🇪', 'Ireland', 'Republic of Ireland'],
  ['ROU', '🇷🇴', 'Romania'],
  ['RSA', '🇿🇦', 'South Africa'],
  ['SCO', '🏴󠁧󠁢󠁳󠁣󠁴󠁿', 'Scotland'],
  ['SEN', '🇸🇳', 'Senegal'],
  ['SRB', '🇷🇸', 'Serbia'],
  ['SVK', '🇸🇰', 'Slovakia'],
  ['SVN', '🇸🇮', 'Slovenia'],
  ['ESP', '🇪🇸', 'Spain'],
  ['SWE', '🇸🇪', 'Sweden'],
  ['SUI', '🇨🇭', 'Switzerland'],
  ['TUN', '🇹🇳', 'Tunisia'],
  ['TUR', '🇹🇷', 'Turkey', 'Türkiye', 'Turkiye'],
  ['UKR', '🇺🇦', 'Ukraine'],
  ['UAE', '🇦🇪', 'United Arab Emirates'],
  ['USA', '🇺🇸', 'United States', 'USA', 'United States of America'],
  ['URU', '🇺🇾', 'Uruguay'],
  ['UZB', '🇺🇿', 'Uzbekistan'],
  ['WAL', '🏴󠁧󠁢󠁷󠁬󠁳󠁿', 'Wales'],
  ['ALG', '🇩🇿', 'Algeria'],
  ['DZA', '🇩🇿', 'Algeria'],
  ['VEN', '🇻🇪', 'Venezuela'],
];

const norm = (s) => String(s || '').trim().toLowerCase().replace(/[._]/g, ' ').replace(/\s+/g, ' ');

const byName = new Map();
const byCode = new Map();
for (const [code, flag, ...names] of TABLE) {
  if (!byCode.has(code)) byCode.set(code, { code, flag, name: names[0] });
  for (const n of names) byName.set(norm(n), { code, flag, name: names[0] });
  byName.set(norm(code), { code, flag, name: names[0] });
}

/**
 * Resolve a provider's team name or 3-letter code to { code, name, flag }.
 * Unknown teams get a derived 3-letter code and a neutral flag so nothing
 * breaks if a provider includes a nation we haven't tabulated.
 */
export function resolveTeam(nameOrCode) {
  if (!nameOrCode) return null;
  const hit = byName.get(norm(nameOrCode));
  if (hit) return hit;
  const name = String(nameOrCode).trim();
  const code = name.replace(/[^a-zA-Z]/g, '').slice(0, 3).toUpperCase() || 'TBD';
  return { code, name, flag: '🏳️' };
}

export function flagFor(code) {
  return byCode.get(code)?.flag || '🏳️';
}
