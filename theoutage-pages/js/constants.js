// Keep in sync with theoutage-api/src/lib/constants.ts — the Worker
// enforces these via CHECK constraints, so drifting here just means
// confusing 400s, not a security issue, but keep them matched anyway.

export const CATEGORIES = [
  "power",
  "internet",
  "cloud",
  "transport",
  "water",
  "telecom",
  "financial",
  "healthcare",
  "government",
  "other",
];

export const SEVERITIES = [
  ["P3", "P3 — Minor"],
  ["P2", "P2 — Major"],
  ["P1", "P1 — Critical"],
];

export const STATUSES = ["draft", "pending_review", "published", "rejected"];

export const MAX_ARTIFACT_BYTES = 10 * 1024 * 1024;
export const MAX_OUTAGE_ARTIFACT_TOTAL_BYTES = 50 * 1024 * 1024;

// ISO 3166-1 alpha-2 — spec §2/§7: "fixed ISO country dropdown list".
export const COUNTRIES = [
  ["AF", "Afghanistan"], ["AL", "Albania"], ["DZ", "Algeria"], ["AD", "Andorra"],
  ["AO", "Angola"], ["AG", "Antigua and Barbuda"], ["AR", "Argentina"], ["AM", "Armenia"],
  ["AU", "Australia"], ["AT", "Austria"], ["AZ", "Azerbaijan"], ["BS", "Bahamas"],
  ["BH", "Bahrain"], ["BD", "Bangladesh"], ["BB", "Barbados"], ["BY", "Belarus"],
  ["BE", "Belgium"], ["BZ", "Belize"], ["BJ", "Benin"], ["BT", "Bhutan"],
  ["BO", "Bolivia"], ["BA", "Bosnia and Herzegovina"], ["BW", "Botswana"], ["BR", "Brazil"],
  ["BN", "Brunei"], ["BG", "Bulgaria"], ["BF", "Burkina Faso"], ["BI", "Burundi"],
  ["CV", "Cabo Verde"], ["KH", "Cambodia"], ["CM", "Cameroon"], ["CA", "Canada"],
  ["CF", "Central African Republic"], ["TD", "Chad"], ["CL", "Chile"], ["CN", "China"],
  ["CO", "Colombia"], ["KM", "Comoros"], ["CG", "Congo"], ["CD", "Congo (DRC)"],
  ["CR", "Costa Rica"], ["CI", "Côte d'Ivoire"], ["HR", "Croatia"], ["CU", "Cuba"],
  ["CY", "Cyprus"], ["CZ", "Czechia"], ["DK", "Denmark"], ["DJ", "Djibouti"],
  ["DM", "Dominica"], ["DO", "Dominican Republic"], ["EC", "Ecuador"], ["EG", "Egypt"],
  ["SV", "El Salvador"], ["GQ", "Equatorial Guinea"], ["ER", "Eritrea"], ["EE", "Estonia"],
  ["SZ", "Eswatini"], ["ET", "Ethiopia"], ["FJ", "Fiji"], ["FI", "Finland"],
  ["FR", "France"], ["GA", "Gabon"], ["GM", "Gambia"], ["GE", "Georgia"],
  ["DE", "Germany"], ["GH", "Ghana"], ["GR", "Greece"], ["GD", "Grenada"],
  ["GT", "Guatemala"], ["GN", "Guinea"], ["GW", "Guinea-Bissau"], ["GY", "Guyana"],
  ["HT", "Haiti"], ["HN", "Honduras"], ["HK", "Hong Kong"], ["HU", "Hungary"],
  ["IS", "Iceland"], ["IN", "India"], ["ID", "Indonesia"], ["IR", "Iran"],
  ["IQ", "Iraq"], ["IE", "Ireland"], ["IL", "Israel"], ["IT", "Italy"],
  ["JM", "Jamaica"], ["JP", "Japan"], ["JO", "Jordan"], ["KZ", "Kazakhstan"],
  ["KE", "Kenya"], ["KI", "Kiribati"], ["KP", "North Korea"], ["KR", "South Korea"],
  ["KW", "Kuwait"], ["KG", "Kyrgyzstan"], ["LA", "Laos"], ["LV", "Latvia"],
  ["LB", "Lebanon"], ["LS", "Lesotho"], ["LR", "Liberia"], ["LY", "Libya"],
  ["LI", "Liechtenstein"], ["LT", "Lithuania"], ["LU", "Luxembourg"], ["MO", "Macao"],
  ["MG", "Madagascar"], ["MW", "Malawi"], ["MY", "Malaysia"], ["MV", "Maldives"],
  ["ML", "Mali"], ["MT", "Malta"], ["MH", "Marshall Islands"], ["MR", "Mauritania"],
  ["MU", "Mauritius"], ["MX", "Mexico"], ["FM", "Micronesia"], ["MD", "Moldova"],
  ["MC", "Monaco"], ["MN", "Mongolia"], ["ME", "Montenegro"], ["MA", "Morocco"],
  ["MZ", "Mozambique"], ["MM", "Myanmar"], ["NA", "Namibia"], ["NR", "Nauru"],
  ["NP", "Nepal"], ["NL", "Netherlands"], ["NZ", "New Zealand"], ["NI", "Nicaragua"],
  ["NE", "Niger"], ["NG", "Nigeria"], ["MK", "North Macedonia"], ["NO", "Norway"],
  ["OM", "Oman"], ["PK", "Pakistan"], ["PW", "Palau"], ["PS", "Palestine"],
  ["PA", "Panama"], ["PG", "Papua New Guinea"], ["PY", "Paraguay"], ["PE", "Peru"],
  ["PH", "Philippines"], ["PL", "Poland"], ["PT", "Portugal"], ["QA", "Qatar"],
  ["RO", "Romania"], ["RU", "Russia"], ["RW", "Rwanda"], ["KN", "Saint Kitts and Nevis"],
  ["LC", "Saint Lucia"], ["VC", "Saint Vincent and the Grenadines"], ["WS", "Samoa"], ["SM", "San Marino"],
  ["ST", "Sao Tome and Principe"], ["SA", "Saudi Arabia"], ["SN", "Senegal"], ["RS", "Serbia"],
  ["SC", "Seychelles"], ["SL", "Sierra Leone"], ["SG", "Singapore"], ["SK", "Slovakia"],
  ["SI", "Slovenia"], ["SB", "Solomon Islands"], ["SO", "Somalia"], ["ZA", "South Africa"],
  ["SS", "South Sudan"], ["ES", "Spain"], ["LK", "Sri Lanka"], ["SD", "Sudan"],
  ["SR", "Suriname"], ["SE", "Sweden"], ["CH", "Switzerland"], ["SY", "Syria"],
  ["TW", "Taiwan"], ["TJ", "Tajikistan"], ["TZ", "Tanzania"], ["TH", "Thailand"],
  ["TL", "Timor-Leste"], ["TG", "Togo"], ["TO", "Tonga"], ["TT", "Trinidad and Tobago"],
  ["TN", "Tunisia"], ["TR", "Turkey"], ["TM", "Turkmenistan"], ["TV", "Tuvalu"],
  ["UG", "Uganda"], ["UA", "Ukraine"], ["AE", "United Arab Emirates"], ["GB", "United Kingdom"],
  ["US", "United States"], ["UY", "Uruguay"], ["UZ", "Uzbekistan"], ["VU", "Vanuatu"],
  ["VA", "Vatican City"], ["VE", "Venezuela"], ["VN", "Vietnam"], ["YE", "Yemen"],
  ["ZM", "Zambia"], ["ZW", "Zimbabwe"],
];
