# Maga UI

Библиотека компонентов для интерфейсов, где фокус на одном центральном объекте, а всё остальное — второстепенный хром. Тёмные стеклянные «острова» по краям, пружинная анимация, bloom за главной кнопкой.

Сейчас это HTML-прототип: потыкать, почувствовать интеракции, решить, что и как переносить в продакшн.

## Kiln (`apps/kiln/`)

Первый проект на ките: форма или SVG → 3D-композиция → материал, свет, ракурс → production PNG с прозрачным фоном (path tracing в браузере, WebGPU). Phase 1a: приложение на ките и look-dev Green clay под референсы. Phase 1b: композиция из отдельных объектов — выбор и перетаскивание во вьюпорте, группы, форма и материал у каждого объекта, отмена — [`apps/kiln/README.md`](apps/kiln/README.md). Находки Phase 0 — [`apps/kiln/SPIKE.md`](apps/kiln/SPIKE.md).

```sh
cd apps/kiln
npm install
npm run dev        # → localhost:5173 (приложение), /lookdev.html, /spike.html
npm test           # vitest: мешер, геометрия, свет, тональная кривая, документ сцены
node tests/e2e/app.mjs      # Playwright + SwiftShader WebGPU: редактор и экспорт
node tests/e2e/lookdev.mjs  # сверка цветов с референсом (--ref путь к картинке)
```

## Bruce Banner (`apps/bruce-banner/`)

Промо-баннеры для приложения Ipoteka Bank (слот 328×106) на RU/UZ/EN для команд без дизайнера: бриф словами → AI пишет тексты на трёх языках и ставит иллюстрацию → проверка в телефоне → ZIP. Перенос старого Bruce Banner с паритетом рендера пиксель в пиксель — [`apps/bruce-banner/README.md`](apps/bruce-banner/README.md).

```sh
cd apps/bruce-banner
npm install
npm run vendor     # брендовые шрифты и картинки (не в git, пока репо публичный)
npm run dev        # → localhost:5173, AI на моках, пока нет ключа Gemini
npm test           # vitest: движок, проверки, вырезка фона, сервер AI
npm run e2e:app    # Playwright: редактор, экспорт, превью
```

## Запуск (прототип кита)

Открыть `prototype/index.html` в браузере. Сборка и сервер не нужны (vanilla JS, без модулей, работает с `file://`).

Single-file версия (CSS и JS заинлайнены):

```sh
python3 tools/build_single.py            # → dist/maga-ui-kit.html
python3 tools/build_single.py out.html --fragment   # без <html>/<head>, для хостов со своим каркасом
```

## Что внутри

**Stage** — две сцены в одном каркасе:
- **Type** — 3D-леттеринг на CSS 3D (слои + `preserve-3d`, вращение только через composite). Хватай и крути, отпустишь — пружинит обратно с инерцией. Шрифты с превью по ховеру, материалы, панель свойств.
- **Enhance** — сравнение до/после: слайдер, side-by-side, picture-in-picture, «только результат» (зажми — увидишь оригинал). Картинка генерируется процедурно, можно открыть свою.

**Kit** — все компоненты по отдельности, с состояниями и короткими правилами использования.

## Компоненты

| Компонент | Класс | Заметки |
|---|---|---|
| Glass island | `.glass.island` | Rim light за курсором, dim по удалённости |
| Cell / buttons | `.cell` + `primary` `ghost` `clear` `icon-btn` `pill` | Press 0.96, release пружиной |
| Juice button | `[data-juice]` | Заряжается синим, bloom за соседним стеклом |
| Segmented | `.seg` | Индикатор на пружине, стрелки |
| Tabs | `.tabs` | Подчёркивание по ширине текста |
| Fill slider | `.fs` + `split` `stat` `lg` `vertical` | Тап = прыжок, драг = относительный, Shift = точно, rubber band, магнит к дефолту, дабл-клик = сброс |
| Select / menu | `.select`, `[data-menu]` | Подсветка скользит между пунктами |
| Switch, tag | `.switch`, `.tag[data-toggle]` | |
| Media tile | `.media` | Клик или drop картинки |
| Pager | `.pager` | Свайп, счётчик-одометр |
| Prompt | `.prompt` | Автовысота, негативный промпт раскрывается |
| Material swatch | `.swatch > .sphere` | Блик следует за курсором |
| Coach (тур) | `.coach` | Прогресс-точки, кольцо на целевом элементе |
| Tooltip, toast | `[data-tip]`, `MU.toast()` | Первый тултип 520 мс, следующие сразу |

Разметка — это API: компоненты читают `data-*` атрибуты и инициализируются `MU.initComponents(scope)`.

## Поведение «фокус на объекте»

- Острова тускнеют пропорционально расстоянию до курсора (Focus mode в меню аватара).
- Через 2.6 с без движения хром уходит почти в ноль, объект остаётся.
- `H` прячет интерфейс целиком.

## Горячие клавиши

`?` тур · `H` скрыть интерфейс · `K` Stage/Kit · `M` материалы · `F` шрифты · `O` автоорбита · `E` экспорт · `+`/`−` зум · `1–4` режимы сравнения

## Что зафейкано

- Export и Enhance — анимация прогресса и тост, файл не сохраняется, апскейла нет.
- «Before» — это даунскейл сгенерированной картинки, «After» — оригинал + фильтр по Strength.
- Style reference, Creativity, Detail, Face restore — визуал без эффекта.

## Структура

```
prototype/
  index.html          разметка Stage + Kit
  css/tokens.css      цвета, типографика, радиусы, пружины (linear())
  css/components.css  все компоненты
  css/stage.css       сцены, раскладка островов, idle/proximity
  css/art.css         иллюстрации тура
  css/kit.css         страница Kit
  js/core.js          Spring, тикер, rim light, idle, juice, тултипы, поповеры, тосты
  js/components.js    инициализация компонентов
  js/scene-type.js    3D-текст, материалы, шрифты
  js/scene-enhance.js процедурный пейзаж, режимы сравнения
  js/app.js           связка: сцены, панели, тур, шорткаты
tools/build_single.py сборка в один файл
```
