/**
 * Procedural demo content so the first open already looks like a promo: a tall banking home screen
 * (long enough to scroll), a savings screen, a tablet budget view and a web dashboard.
 * Generic brand, realistic Uzbek data.
 */

const F = (w: number, s: number) => `${w} ${s}px Geist, Inter, system-ui, sans-serif`;

function rr(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.roundRect(x, y, w, h, r);
}

function text(c: CanvasRenderingContext2D, s: string, x: number, y: number, font: string, color: string, align: CanvasTextAlign = 'left') {
  c.font = font;
  c.fillStyle = color;
  c.textAlign = align;
  c.textBaseline = 'alphabetic';
  c.fillText(s, x, y);
}

function statusBar(c: CanvasRenderingContext2D, w: number, color: string, scale = 3) {
  const s = scale;
  text(c, '9:41', 54 * s / 3 + 40, 70 * s / 3 + 20, F(600, 17 * s), color);
  // signal, wifi, battery
  c.fillStyle = color;
  const bx = w - 150 * (s / 3) - 40;
  const by = 54 * s / 3 + 12;
  for (let i = 0; i < 4; i++) c.fillRect(bx + i * 7 * s / 1.5, by + 22 - i * 5 - 6, 5 * s / 1.5, 6 + i * 5);
  rr(c, bx + 80, by + 2, 25 * s / 1.5 + 8, 13 * s / 1.5, 4 * s);
  c.lineWidth = 3;
  c.strokeStyle = color;
  c.globalAlpha = 0.45;
  c.stroke();
  c.globalAlpha = 1;
  rr(c, bx + 84, by + 6, 25 * s / 1.5 - 2, 13 * s / 1.5 - 8, 2.5 * s);
  c.fill();
}

const ICONS = ['➜', '₸', '⌁', '+'];

const TX: { name: string; cat: string; amt: string; color: string; letter: string; plus?: boolean }[] = [
  { name: 'Korzinka', cat: 'Супермаркеты', amt: '−214 600', color: '#E8443A', letter: 'K' },
  { name: 'Перевод от Дилшода', cat: 'Входящий перевод', amt: '+1 500 000', color: '#2BB673', letter: 'Д', plus: true },
  { name: 'Yandex Go', cat: 'Такси', amt: '−32 000', color: '#F7C600', letter: 'Y' },
  { name: 'Uzum Market', cat: 'Покупки онлайн', amt: '−689 000', color: '#7A3CF0', letter: 'U' },
  { name: 'Ucell', cat: 'Мобильная связь', amt: '−50 000', color: '#8E44AD', letter: 'U' },
  { name: 'Зарплата', cat: 'ООО «Тексан»', amt: '+9 800 000', color: '#2BB673', letter: 'З', plus: true },
  { name: 'Makro', cat: 'Супермаркеты', amt: '−146 300', color: '#D72C2C', letter: 'M' },
  { name: 'Coffee Lab', cat: 'Кафе и рестораны', amt: '−48 000', color: '#8B5A2B', letter: 'C' },
  { name: 'Hududgaz', cat: 'Коммунальные услуги', amt: '−186 420', color: '#1F8BFF', letter: 'H' },
  { name: 'Evos', cat: 'Кафе и рестораны', amt: '−97 000', color: '#2E9D4A', letter: 'E' },
  { name: 'Перевод Нигоре', cat: 'Исходящий перевод', amt: '−400 000', color: '#5C6BC0', letter: 'Н' },
  { name: 'Кэшбэк', cat: 'За октябрь', amt: '+84 210', color: '#FF8A00', letter: '%', plus: true },
  { name: 'Artel Service', cat: 'Электроника', amt: '−1 249 000', color: '#0B4EA2', letter: 'A' },
  { name: 'Metro Tashkent', cat: 'Транспорт', amt: '−2 000', color: '#4A90E2', letter: 'M' },
  { name: 'Spotify', cat: 'Подписки', amt: '−39 900', color: '#1DB954', letter: 'S' },
  { name: 'Safia', cat: 'Кафе и рестораны', amt: '−126 000', color: '#C2185B', letter: 'S' },
];

/** tall home screen, 1179 px wide (3× of a 393 pt phone) */
export function bankingHome(): HTMLCanvasElement {
  const W = 1179;
  const H = 5200;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#F2F3F7';
  c.fillRect(0, 0, W, H);
  const g = c.createLinearGradient(0, 0, W, 1150);
  g.addColorStop(0, '#2A3BFF');
  g.addColorStop(0.55, '#5B2CFF');
  g.addColorStop(1, '#A040FF');
  c.fillStyle = g;
  c.fillRect(0, 0, W, 1180);
  // soft blobs
  const blob = (x: number, y: number, r: number, col: string) => {
    const rg = c.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, col);
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = rg;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  };
  blob(980, 180, 520, 'rgba(255,120,200,0.45)');
  blob(120, 900, 600, 'rgba(60,200,255,0.35)');
  statusBar(c, W, '#fff');

  const P = 60;
  // header
  c.fillStyle = 'rgba(255,255,255,0.22)';
  c.beginPath();
  c.arc(P + 60, 250, 60, 0, Math.PI * 2);
  c.fill();
  text(c, 'АК', P + 60, 270, F(600, 44), '#fff', 'center');
  text(c, 'Добрый вечер,', P + 150, 236, F(400, 40), 'rgba(255,255,255,0.75)');
  text(c, 'Азиз', P + 150, 292, F(600, 52), '#fff');
  c.fillStyle = 'rgba(255,255,255,0.2)';
  c.beginPath();
  c.arc(W - P - 60, 250, 60, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = '#fff';
  c.lineWidth = 6;
  c.beginPath();
  c.moveTo(W - P - 82, 268);
  c.lineTo(W - P - 38, 268);
  c.moveTo(W - P - 76, 268);
  c.quadraticCurveTo(W - P - 76, 222, W - P - 60, 222);
  c.quadraticCurveTo(W - P - 44, 222, W - P - 44, 268);
  c.stroke();
  c.fillStyle = '#FF5A7A';
  c.beginPath();
  c.arc(W - P - 30, 214, 13, 0, Math.PI * 2);
  c.fill();

  // balance
  text(c, 'Общий баланс', P, 470, F(400, 42), 'rgba(255,255,255,0.75)');
  text(c, '24 870 450', P, 600, F(600, 128), '#fff');
  c.font = F(600, 128);
  const bw = c.measureText('24 870 450').width;
  text(c, 'сум', P + bw + 24, 600, F(500, 60), 'rgba(255,255,255,0.7)');
  c.fillStyle = 'rgba(80,255,170,0.22)';
  rr(c, P, 650, 330, 72, 36);
  c.fill();
  text(c, '↑ +12,4% за месяц', P + 30, 700, F(500, 36), '#9CFFD0');

  // quick actions
  const acts = ['Перевод', 'Оплата', 'QR', 'Пополнить'];
  const aw = (W - P * 2 - 3 * 36) / 4;
  acts.forEach((a, i) => {
    const x = P + i * (aw + 36);
    c.fillStyle = 'rgba(255,255,255,0.16)';
    rr(c, x, 800, aw, 230, 44);
    c.fill();
    c.fillStyle = '#fff';
    c.beginPath();
    c.arc(x + aw / 2, 880, 48, 0, Math.PI * 2);
    c.fill();
    text(c, ICONS[i], x + aw / 2, 900, F(700, 52), '#3B30FF', 'center');
    text(c, a, x + aw / 2, 990, F(500, 34), '#fff', 'center');
  });

  // sheet
  let y = 1130;
  c.fillStyle = '#F2F3F7';
  rr(c, 0, y, W, H - y, 70);
  c.fill();
  y += 120;
  text(c, 'Мои карты', P, y, F(600, 56), '#0E0F14');
  text(c, 'Все', W - P, y, F(500, 42), '#3B30FF', 'right');
  y += 50;
  const cards = [
    { n: 'Uzcard · 4417', b: '8 420 000', g: ['#0E0F14', '#2D2F3A'] },
    { n: 'Humo · 9860', b: '12 950 450', g: ['#FF6A3D', '#FF2E7E'] },
    { n: 'Visa · 2231', b: '$ 284.10', g: ['#00B386', '#0079C1'] },
  ];
  cards.forEach((cd, i) => {
    const x = P + i * 640;
    const cg = c.createLinearGradient(x, y, x + 600, y + 370);
    cg.addColorStop(0, cd.g[0]);
    cg.addColorStop(1, cd.g[1]);
    c.fillStyle = cg;
    rr(c, x, y, 600, 370, 44);
    c.fill();
    text(c, cd.n, x + 44, y + 90, F(500, 36), 'rgba(255,255,255,0.75)');
    text(c, cd.b, x + 44, y + 300, F(600, 64), '#fff');
    c.fillStyle = 'rgba(255,255,255,0.3)';
    c.beginPath();
    c.arc(x + 520, y + 80, 34, 0, Math.PI * 2);
    c.arc(x + 480, y + 80, 34, 0, Math.PI * 2);
    c.fill();
  });
  y += 370 + 90;

  // cashback banner
  const bg = c.createLinearGradient(P, y, W - P, y + 260);
  bg.addColorStop(0, '#FFE7C2');
  bg.addColorStop(1, '#FFD0E0');
  c.fillStyle = bg;
  rr(c, P, y, W - P * 2, 260, 48);
  c.fill();
  text(c, 'Кэшбэк 5% на кафе', P + 50, y + 105, F(600, 50), '#2B1A10');
  text(c, 'До конца ноября · подключите в два касания', P + 50, y + 170, F(400, 34), 'rgba(43,26,16,0.65)');
  c.fillStyle = '#FF8A00';
  c.beginPath();
  c.arc(W - P - 120, y + 130, 80, 0, Math.PI * 2);
  c.fill();
  text(c, '%', W - P - 120, y + 160, F(700, 84), '#fff', 'center');
  y += 260 + 120;

  // transactions
  text(c, 'Последние операции', P, y, F(600, 56), '#0E0F14');
  y += 50;
  const groups = [
    ['Сегодня', 0, 4],
    ['Вчера', 4, 9],
    ['8 ноября', 9, 16],
  ] as const;
  for (const [label, a, b] of groups) {
    y += 40;
    text(c, label, P, y + 30, F(500, 36), 'rgba(14,15,20,0.45)');
    y += 60;
    c.fillStyle = '#fff';
    rr(c, P, y, W - P * 2, (b - a) * 190 + 30, 48);
    c.fill();
    y += 15;
    for (let i = a; i < b; i++) {
      const t = TX[i];
      c.fillStyle = t.color;
      c.beginPath();
      c.arc(P + 100, y + 95, 58, 0, Math.PI * 2);
      c.fill();
      text(c, t.letter, P + 100, y + 113, F(600, 50), '#fff', 'center');
      text(c, t.name, P + 190, y + 85, F(500, 44), '#0E0F14');
      text(c, t.cat, P + 190, y + 138, F(400, 34), 'rgba(14,15,20,0.5)');
      text(c, t.amt + ' сум', W - P - 40, y + 110, F(600, 42), t.plus ? '#13A35C' : '#0E0F14', 'right');
      if (i < b - 1) {
        c.fillStyle = 'rgba(14,15,20,0.06)';
        c.fillRect(P + 190, y + 189, W - P * 2 - 230, 2);
      }
      y += 190;
    }
    y += 15;
  }
  y += 60;
  text(c, 'Показать все операции', W / 2, y, F(500, 42), '#3B30FF', 'center');
  return cv;
}

/** one-screen savings goal view */
export function savingsScreen(): HTMLCanvasElement {
  const W = 1179;
  const H = 2556;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#0D0E12';
  c.fillRect(0, 0, W, H);
  statusBar(c, W, '#fff');
  const P = 60;
  text(c, 'Копилка', P, 300, F(600, 84), '#fff');
  text(c, 'Цель: путешествие в Самарканд', P, 370, F(400, 40), 'rgba(255,255,255,0.55)');
  // ring
  const cx = W / 2;
  const cy = 900;
  const R = 330;
  c.lineWidth = 64;
  c.lineCap = 'round';
  c.strokeStyle = 'rgba(255,255,255,0.08)';
  c.beginPath();
  c.arc(cx, cy, R, 0, Math.PI * 2);
  c.stroke();
  const rg = c.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
  rg.addColorStop(0, '#59BCFF');
  rg.addColorStop(1, '#8B5CFF');
  c.strokeStyle = rg;
  c.beginPath();
  c.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * 0.72);
  c.stroke();
  text(c, '72%', cx, cy + 10, F(600, 150), '#fff', 'center');
  text(c, '5 040 000 из 7 000 000', cx, cy + 90, F(400, 40), 'rgba(255,255,255,0.55)', 'center');
  // bars
  let y = 1420;
  text(c, 'Пополнения', P, y, F(600, 52), '#fff');
  y += 60;
  const vals = [0.35, 0.5, 0.42, 0.8, 0.62, 0.9, 0.55, 1, 0.74, 0.66, 0.88, 0.95];
  const bw = (W - P * 2) / vals.length;
  vals.forEach((v, i) => {
    const h = v * 380;
    const g = c.createLinearGradient(0, y + 400 - h, 0, y + 400);
    g.addColorStop(0, i === 7 ? '#59BCFF' : 'rgba(255,255,255,0.28)');
    g.addColorStop(1, i === 7 ? '#1F8BFF' : 'rgba(255,255,255,0.08)');
    c.fillStyle = g;
    rr(c, P + i * bw + 10, y + 400 - h, bw - 20, h, 18);
    c.fill();
  });
  y += 520;
  const rows = [
    ['Автопополнение', 'Каждый понедельник', '+150 000'],
    ['Округление покупок', 'До 1 000 сум', '+38 420'],
    ['Процент на остаток', '18% годовых', '+74 300'],
  ];
  rows.forEach(([a, b, v]) => {
    c.fillStyle = 'rgba(255,255,255,0.06)';
    rr(c, P, y, W - P * 2, 170, 40);
    c.fill();
    text(c, a, P + 44, y + 75, F(500, 42), '#fff');
    text(c, b, P + 44, y + 125, F(400, 34), 'rgba(255,255,255,0.5)');
    text(c, v, W - P - 44, y + 100, F(600, 42), '#7CFFB2', 'right');
    y += 200;
  });
  c.fillStyle = '#fff';
  rr(c, P, H - 260, W - P * 2, 150, 75);
  c.fill();
  text(c, 'Пополнить копилку', W / 2, H - 167, F(600, 46), '#0D0E12', 'center');
  return cv;
}

/** web dashboard for the laptop, 16:10 */
export function dashboardScreen(): HTMLCanvasElement {
  const W = 2560;
  const H = 1600;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#F6F7F9';
  c.fillRect(0, 0, W, H);
  // sidebar
  c.fillStyle = '#0E0F14';
  c.fillRect(0, 0, 420, H);
  text(c, '◆  Ledger', 60, 120, F(600, 44), '#fff');
  ['Обзор', 'Платежи', 'Счета', 'Карты', 'Отчёты', 'Команда', 'Настройки'].forEach((s, i) => {
    if (i === 0) {
      c.fillStyle = 'rgba(255,255,255,0.1)';
      rr(c, 30, 200 + i * 90 - 52, 360, 76, 18);
      c.fill();
    }
    text(c, s, 70, 200 + i * 90, F(500, 34), i === 0 ? '#fff' : 'rgba(255,255,255,0.55)');
  });
  const X = 500;
  text(c, 'Обзор', X, 150, F(600, 68), '#0E0F14');
  text(c, 'Ноябрь 2026 · все счета', X, 210, F(400, 32), 'rgba(14,15,20,0.5)');
  const kpi = [
    ['Выручка', '1,84 млрд', '+18%'],
    ['Платежей', '42 118', '+6%'],
    ['Средний чек', '43 700', '+2%'],
    ['Возвраты', '0,8%', '−0,3'],
  ];
  const kw = (W - X - 80 - 3 * 40) / 4;
  kpi.forEach(([a, b, d], i) => {
    const x = X + i * (kw + 40);
    c.fillStyle = '#fff';
    rr(c, x, 280, kw, 220, 32);
    c.fill();
    text(c, a, x + 40, 350, F(500, 30), 'rgba(14,15,20,0.5)');
    text(c, b, x + 40, 440, F(600, 60), '#0E0F14');
    text(c, d, x + kw - 40, 350, F(600, 28), '#13A35C', 'right');
  });
  // chart
  c.fillStyle = '#fff';
  rr(c, X, 540, W - X - 80, 620, 32);
  c.fill();
  text(c, 'Оборот по дням', X + 40, 610, F(600, 36), '#0E0F14');
  const pts: number[] = [];
  for (let i = 0; i < 30; i++) pts.push(0.45 + 0.25 * Math.sin(i * 0.45) + 0.18 * Math.sin(i * 1.3 + 1) + i * 0.008);
  const cx0 = X + 60;
  const cw = W - X - 200;
  const cy0 = 1100;
  const ch = 400;
  const g = c.createLinearGradient(0, cy0 - ch, 0, cy0);
  g.addColorStop(0, 'rgba(59,48,255,0.28)');
  g.addColorStop(1, 'rgba(59,48,255,0)');
  c.beginPath();
  pts.forEach((p, i) => {
    const x = cx0 + (i / 29) * cw;
    const y = cy0 - p * ch;
    if (i) c.lineTo(x, y);
    else c.moveTo(x, y);
  });
  c.lineTo(cx0 + cw, cy0);
  c.lineTo(cx0, cy0);
  c.fillStyle = g;
  c.fill();
  c.beginPath();
  pts.forEach((p, i) => {
    const x = cx0 + (i / 29) * cw;
    const y = cy0 - p * ch;
    if (i) c.lineTo(x, y);
    else c.moveTo(x, y);
  });
  c.strokeStyle = '#3B30FF';
  c.lineWidth = 6;
  c.stroke();
  // table
  c.fillStyle = '#fff';
  rr(c, X, 1200, W - X - 80, 340, 32);
  c.fill();
  [['ООО «Тексан»', 'Зарплатный проект', '+284 000 000'], ['Korzinka', 'Эквайринг', '+42 610 000'], ['Hududgaz', 'Коммунальные', '−8 120 000']].forEach(
    ([a, b, v], i) => {
      const y = 1290 + i * 90;
      text(c, a, X + 40, y, F(500, 32), '#0E0F14');
      text(c, b, X + 700, y, F(400, 30), 'rgba(14,15,20,0.5)');
      text(c, v + ' сум', W - 140, y, F(600, 32), v.startsWith('+') ? '#13A35C' : '#0E0F14', 'right');
    },
  );
  return cv;
}

/** tablet: budget overview, 3:4 portrait */
export function tabletScreen(): HTMLCanvasElement {
  const W = 1640;
  const H = 2360;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const c = cv.getContext('2d')!;
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#FFF6EC');
  g.addColorStop(1, '#FCE7F3');
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  const P = 90;
  text(c, 'Бюджет на ноябрь', P, 220, F(600, 88), '#1A1022');
  text(c, 'Осталось 3 210 000 сум на 20 дней', P, 300, F(400, 44), 'rgba(26,16,34,0.55)');
  const cats = [
    ['Продукты', 0.72, '#FF6A3D'],
    ['Транспорт', 0.38, '#3B30FF'],
    ['Кафе', 0.91, '#E91E63'],
    ['Связь', 0.5, '#00B386'],
    ['Дом', 0.24, '#FF9F1C'],
    ['Подписки', 0.64, '#8B5CFF'],
  ] as const;
  cats.forEach(([n, v, col], i) => {
    const x = P + (i % 2) * ((W - P * 2) / 2 + 20);
    const y = 420 + Math.floor(i / 2) * 420;
    const w = (W - P * 2) / 2 - 20;
    c.fillStyle = '#fff';
    rr(c, x, y, w, 380, 56);
    c.fill();
    c.fillStyle = col;
    c.beginPath();
    c.arc(x + 100, y + 110, 50, 0, Math.PI * 2);
    c.fill();
    text(c, n, x + 180, y + 128, F(600, 50), '#1A1022');
    text(c, `${Math.round(v * 100)}%`, x + w - 60, y + 128, F(600, 50), col, 'right');
    c.fillStyle = 'rgba(26,16,34,0.07)';
    rr(c, x + 60, y + 250, w - 120, 36, 18);
    c.fill();
    c.fillStyle = col;
    rr(c, x + 60, y + 250, (w - 120) * v, 36, 18);
    c.fill();
  });
  c.fillStyle = '#1A1022';
  rr(c, P, H - 330, W - P * 2, 180, 90);
  c.fill();
  text(c, 'Настроить лимиты', W / 2, H - 220, F(600, 56), '#fff', 'center');
  return cv;
}
