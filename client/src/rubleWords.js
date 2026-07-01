const ONES = {
  m: ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'],
  f: ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'],
};
const TEENS = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
const TENS = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
const HUNDREDS = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];

const SCALES = [
  { one: 'рубль', few: 'рубля', many: 'рублей', gender: 'm' },
  { one: 'тысяча', few: 'тысячи', many: 'тысяч', gender: 'f' },
  { one: 'миллион', few: 'миллиона', many: 'миллионов', gender: 'm' },
  { one: 'миллиард', few: 'миллиарда', many: 'миллиардов', gender: 'm' },
];

function pluralize(n, scale) {
  const n100 = n % 100;
  const n10 = n % 10;
  if (n100 >= 11 && n100 <= 19) return scale.many;
  if (n10 === 1) return scale.one;
  if (n10 >= 2 && n10 <= 4) return scale.few;
  return scale.many;
}

function threeDigitsToWords(n, gender) {
  const words = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h) words.push(HUNDREDS[h]);
  if (rest >= 10 && rest <= 19) {
    words.push(TEENS[rest - 10]);
  } else {
    const t = Math.floor(rest / 10);
    const o = rest % 10;
    if (t) words.push(TENS[t]);
    if (o) words.push(ONES[gender][o]);
  }
  return words;
}

export function numberToWordsRu(amount) {
  const value = Math.max(0, Number(amount) || 0);
  let rubles = Math.floor(value);
  let kopecks = Math.round((value - rubles) * 100);
  if (kopecks === 100) { rubles += 1; kopecks = 0; }

  if (rubles === 0) {
    return `Ноль рублей ${String(kopecks).padStart(2, '0')} копеек`;
  }

  const groups = [];
  let n = rubles;
  while (n > 0) {
    groups.push(n % 1000);
    n = Math.floor(n / 1000);
  }

  const parts = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i];
    if (g === 0) continue;
    const scale = SCALES[i];
    parts.push(...threeDigitsToWords(g, scale.gender));
    if (i > 0) parts.push(pluralize(g, scale));
  }
  parts.push(pluralize(rubles, SCALES[0]));

  const sentence = parts.join(' ');
  const capitalized = sentence.charAt(0).toUpperCase() + sentence.slice(1);
  return `${capitalized} ${String(kopecks).padStart(2, '0')} копеек`;
}
