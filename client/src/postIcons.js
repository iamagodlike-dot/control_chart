const ICON_RULES = [
  [/рихт/i, '🔨'],
  [/свар/i, '⚡'],
  [/маляр|покрас/i, '🎨'],
  [/полиров/i, '✨'],
  [/разбор/i, '🔧'],
  [/сбор/i, '🛠️'],
  [/диагност/i, '🔍'],
  [/шин|колес/i, '🛞'],
  [/подгот/i, '🧰'],
  [/электр/i, '🔌'],
];

export function iconFor(text, fallback) {
  if (!text) return fallback;
  const rule = ICON_RULES.find(([re]) => re.test(text));
  return rule ? rule[1] : fallback;
}
