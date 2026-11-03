/**
 * The app screen around the banner, in the three languages the banner ships in. RU is the Ipoteka
 * home screen from Figma («1.0. Home Page», First Enter / Main); UZ and EN are our translations
 * until the app's own strings arrive.
 */
import type { Lang } from '../engine';

export interface ScreenStrings {
  balance: string;
  amount: string;
  currency: string;
  newCard: string;
  newCardSub: string;
  search: string;
  /** the banners that share the carousel with the one being made */
  autoloan: [string, string];
  more: string;
  daromax: string;
  upTo18: string;
  card: string;
  cardSub: string;
  loans: string;
  loansBanner: [string, string];
  in2min: string;
  deposits: string;
  depositsBanner: [string, string];
  tabs: [string, string, string, string, string];
}

const NBSP = ' ';

export const STRINGS: Record<Lang, ScreenStrings> = {
  ru: {
    balance: 'Общий баланс',
    amount: '0',
    currency: 'сум',
    newCard: 'Новая карта',
    newCardSub: 'Добавить или заказать',
    search: 'Карта или телефон',
    autoloan: ['Автокредит', `от${NBSP}0%`],
    more: 'Подробнее',
    daromax: 'Увеличивайте свой доход с «DaroMax»',
    upTo18: `до${NBSP}18%`,
    card: 'Новая Ipoteka карта',
    cardSub: 'Пополнение, переводы, снятие — абсолютно бесплатно',
    loans: 'Кредиты',
    loansBanner: ['До 100 миллионов', 'на любые цели'],
    in2min: `за${NBSP}2 минуты`,
    deposits: 'Депозиты',
    depositsBanner: ['Зарабатывайте', `на вкладах до${NBSP}18%`],
    tabs: ['Главный', 'Оплата', 'Переводы', 'История', 'Поддержка'],
  },
  uz: {
    balance: 'Umumiy balans',
    amount: '0',
    currency: 'so‘m',
    newCard: 'Yangi karta',
    newCardSub: 'Qo‘shish yoki buyurtma qilish',
    search: 'Karta yoki telefon',
    autoloan: ['Avtokredit', `0%${NBSP}dan`],
    more: 'Batafsil',
    daromax: '«DaroMax» bilan daromadingizni oshiring',
    upTo18: `18%${NBSP}gacha`,
    card: 'Yangi Ipoteka karta',
    cardSub: 'To‘ldirish, o‘tkazma, yechib olish — mutlaqo bepul',
    loans: 'Kreditlar',
    loansBanner: ['100 million so‘mgacha', 'istalgan maqsadga'],
    in2min: `2${NBSP}daqiqada`,
    deposits: 'Depozitlar',
    depositsBanner: ['Omonatlarda', `18%${NBSP}gacha daromad`],
    tabs: ['Asosiy', 'To‘lov', 'O‘tkazmalar', 'Tarix', 'Yordam'],
  },
  en: {
    balance: 'Total balance',
    amount: '0',
    currency: 'UZS',
    newCard: 'New card',
    newCardSub: 'Add or order',
    search: 'Card or phone',
    autoloan: ['Car loan', `from${NBSP}0%`],
    more: 'Learn more',
    daromax: 'Grow your income with DaroMax',
    upTo18: `up${NBSP}to${NBSP}18%`,
    card: 'New Ipoteka card',
    cardSub: 'Top-ups, transfers, withdrawals — all free',
    loans: 'Loans',
    loansBanner: ['Up to 100 million', 'for any purpose'],
    in2min: `in${NBSP}2 minutes`,
    deposits: 'Deposits',
    depositsBanner: ['Earn up to 18%', 'on deposits'],
    tabs: ['Home', 'Payments', 'Transfers', 'History', 'Support'],
  },
};
