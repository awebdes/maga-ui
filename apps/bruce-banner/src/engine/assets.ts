/**
 * The brand image library. Files live in src/brand/img (vendored, see scripts/vendor-legacy.mjs);
 * the catalog is data the editor, the AI prompt and the renderer share.
 */

export type AssetKind = 'illustration' | 'card' | 'logo';

export interface AssetInfo {
  id: string;
  kind: AssetKind;
  /** file name under src/brand/img */
  file: string;
  /** intrinsic size, for aspect-correct drawing before the image decodes */
  natural: { w: number; h: number };
  label: string;
  /** what is in the picture, for the AI that picks art for a brief */
  about: string;
}

export const ASSETS: AssetInfo[] = [
  { id: 'money-loan', kind: 'illustration', file: 'money-loan.png', natural: { w: 640, h: 640 }, label: 'Пачка денег', about: 'stack of green banknotes with an orange band and two silver coins: loans, cash, money for any purpose' },
  { id: 'deposit-time', kind: 'illustration', file: 'deposit-time.png', natural: { w: 640, h: 640 }, label: 'Сейф с процентом', about: 'green safe with an orange percent sign: deposits, interest, savings that grow' },
  { id: 'money-deposit', kind: 'illustration', file: 'money-deposit.png', natural: { w: 640, h: 640 }, label: 'Сейф с замком', about: 'green safe with a dial and an orange fingerprint lock: savings, deposit guarantee, safety' },
  { id: 'mortgage', kind: 'illustration', file: 'mortgage.png', natural: { w: 640, h: 640 }, label: 'Дом с процентом', about: 'green house with a percent coin and an orange person: mortgage, housing, real estate' },
  { id: 'ruble', kind: 'illustration', file: 'ruble.png', natural: { w: 640, h: 640 }, label: 'Монета рубль', about: 'green coin with the ruble sign: ruble exchange rate, currency exchange' },
  { id: 'zero-percent', kind: 'illustration', file: 'zero-percent.png', natural: { w: 640, h: 360 }, label: '0%', about: 'big green 3D "0%": zero commission, free transfers, no fees' },
  { id: 'card-humo-a', kind: 'card', file: 'card-humo-a.png', natural: { w: 640, h: 403 }, label: 'Карта Humo', about: 'Ipoteka Bank Humo card, green leaves' },
  { id: 'card-humo-b', kind: 'card', file: 'card-humo-b.png', natural: { w: 640, h: 419 }, label: 'Карта Uzcard', about: 'Ipoteka Bank Uzcard card, green sphere' },
  { id: 'card-mc-standard', kind: 'card', file: 'card-mc-standard.png', natural: { w: 640, h: 403 }, label: 'Mastercard Standard', about: 'Ipoteka Bank Mastercard Standard, silver' },
  { id: 'card-mc-gold', kind: 'card', file: 'card-mc-gold.png', natural: { w: 640, h: 403 }, label: 'Mastercard Gold', about: 'Ipoteka Bank Mastercard Gold, gold' },
  { id: 'card-visa-classic', kind: 'card', file: 'card-visa-classic.png', natural: { w: 640, h: 420 }, label: 'Visa Classic', about: 'Ipoteka Bank Visa Classic debit, champagne' },
  { id: 'card-visa-gold', kind: 'card', file: 'card-visa-gold.png', natural: { w: 640, h: 420 }, label: 'Visa Gold', about: 'Ipoteka Bank Visa Gold, gold' },
  { id: 'logo-humo', kind: 'logo', file: 'logo-humo.png', natural: { w: 190, h: 49 }, label: 'Humo', about: 'Humo payment system logo' },
  { id: 'logo-uzcard', kind: 'logo', file: 'logo-uzcard.png', natural: { w: 480, h: 640 }, label: 'Uzcard', about: 'Uzcard payment system logo' },
  { id: 'logo-mastercard', kind: 'logo', file: 'logo-mastercard.svg', natural: { w: 30.7856, h: 19 }, label: 'Mastercard', about: 'Mastercard logo' },
  { id: 'logo-visa', kind: 'logo', file: 'logo-visa.svg', natural: { w: 79, h: 22.5 }, label: 'Visa', about: 'Visa logo' },
];

export const assetById = (id: string) => ASSETS.find((a) => a.id === id);

export const isBlobRef = (ref: string) => ref.startsWith('blob:');
