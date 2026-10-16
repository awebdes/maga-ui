/**
 * The app screen around the banner, in the three languages the banner ships in. A reconstruction
 * of the Ipoteka home screen from the design-system tokens, not a copy of the production app.
 */
import type { Lang } from '../engine';

export interface ScreenStrings {
  greeting: string;
  name: string;
  balance: string;
  amount: string;
  currency: string;
  accounts: string;
  cards: [string, string, string];
  actions: [string, string, string, string];
  recent: string;
  all: string;
  ops: { title: string; meta: string; amount: string }[];
  tabs: [string, string, string, string, string];
  caption: string;
  promo: string;
}

const NBSP = ' ';
const sum = (n: string) => n.replace(/ /g, NBSP);

export const STRINGS: Record<Lang, ScreenStrings> = {
  ru: {
    greeting: 'Добрый день,',
    name: 'Дилноза',
    balance: 'Общий баланс',
    amount: sum('12 450 300'),
    currency: 'сум',
    accounts: 'Все счета',
    cards: ['Humo ·· 4417', 'Uzcard ·· 0932', 'Visa ·· 7781'],
    actions: ['Переводы', 'Платежи', 'Кредиты', 'Вклады'],
    recent: 'Последние операции',
    all: 'Все',
    ops: [
      { title: 'Korzinka', meta: 'Супермаркеты · сегодня, 14:20', amount: sum('−245 000') },
      { title: 'Yandex Go', meta: 'Такси · сегодня, 09:12', amount: sum('−32 000') },
      { title: 'Азиз Р.', meta: 'Перевод на карту · вчера', amount: sum('+500 000') },
      { title: 'Uzum Market', meta: 'Покупки · вчера', amount: sum('−1 120 000') },
    ],
    tabs: ['Главная', 'Платежи', 'Переводы', 'История', 'Ещё'],
    caption: 'Главный экран приложения',
    promo: 'Акции',
  },
  uz: {
    greeting: 'Xayrli kun,',
    name: 'Dilnoza',
    balance: 'Umumiy balans',
    amount: sum('12 450 300'),
    currency: 'so‘m',
    accounts: 'Barcha hisoblar',
    cards: ['Humo ·· 4417', 'Uzcard ·· 0932', 'Visa ·· 7781'],
    actions: ['O‘tkazmalar', 'To‘lovlar', 'Kreditlar', 'Omonatlar'],
    recent: 'So‘nggi amallar',
    all: 'Barchasi',
    ops: [
      { title: 'Korzinka', meta: 'Supermarketlar · bugun, 14:20', amount: sum('−245 000') },
      { title: 'Yandex Go', meta: 'Taksi · bugun, 09:12', amount: sum('−32 000') },
      { title: 'Aziz R.', meta: 'Kartaga o‘tkazma · kecha', amount: sum('+500 000') },
      { title: 'Uzum Market', meta: 'Xaridlar · kecha', amount: sum('−1 120 000') },
    ],
    tabs: ['Asosiy', 'To‘lovlar', 'O‘tkazmalar', 'Tarix', 'Yana'],
    caption: 'Ilovaning asosiy ekrani',
    promo: 'Aksiyalar',
  },
  en: {
    greeting: 'Good afternoon,',
    name: 'Dilnoza',
    balance: 'Total balance',
    amount: sum('12 450 300'),
    currency: 'UZS',
    accounts: 'All accounts',
    cards: ['Humo ·· 4417', 'Uzcard ·· 0932', 'Visa ·· 7781'],
    actions: ['Transfers', 'Payments', 'Loans', 'Deposits'],
    recent: 'Recent transactions',
    all: 'See all',
    ops: [
      { title: 'Korzinka', meta: 'Groceries · today, 14:20', amount: sum('−245 000') },
      { title: 'Yandex Go', meta: 'Taxi · today, 09:12', amount: sum('−32 000') },
      { title: 'Aziz R.', meta: 'Card transfer · yesterday', amount: sum('+500 000') },
      { title: 'Uzum Market', meta: 'Shopping · yesterday', amount: sum('−1 120 000') },
    ],
    tabs: ['Home', 'Payments', 'Transfers', 'History', 'More'],
    caption: 'App home screen',
    promo: 'Offers',
  },
};
