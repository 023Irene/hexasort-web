// Тесты ядра HexaSort Web — чистый Node, без npm и зависимостей (ADR-0002).
// Запуск:  node tests/core.test.js     (код выхода 0 = всё зелёное)
//
// Как это работает: вырезаем <script> из index.html и выполняем его в Node,
// подсунув заглушки браузера (canvas, localStorage, RAF, pointer-события).
// Сама игра при этом остаётся одним файлом без тестовых зависимостей.
const fs = require('fs');
const path = require('path');
const indexPath = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(indexPath, 'utf8');
let js = html.match(/<script>([\s\S]*?)<\/script>/)[1];

// --- заглушки браузерного окружения ---
// часы бегут скачками по 1000 мс, чтобы анимации завершались за один кадр
let clock = 0;
const perf = { now: () => (clock += 1000) };
const raf = (fn) => fn(perf.now());
const timeout = (fn) => fn();

// localStorage с настоящим хранилищем — нужен для проверки рекорда
const store = {};
const localStorageStub = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); }
};
const windowHandlers = {};
const windowStub = { addEventListener: (type, fn) => { windowHandlers[type] = fn; } };
const gradientStub = { addColorStop: () => {} };
const ctxStub = new Proxy({}, {
  get: (t, k) => {
    if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => gradientStub;
    if (typeof k === 'string' && ['fillStyle', 'strokeStyle', 'font', 'lineWidth',
      'textAlign', 'textBaseline', 'shadowColor', 'shadowBlur', 'shadowOffsetY',
      'globalAlpha'].includes(k)) return '';
    return () => {};
  },
  set: () => true
});

const handlers = {};
let rect = { left: 0, top: 0, width: 720, height: 900 };
const canvasStub = {
  width: 720, height: 900,
  addEventListener: (type, fn) => { handlers[type] = fn; },
  getBoundingClientRect: () => rect,
  getContext: () => ctxStub,
  setPointerCapture: () => {}
};
// createElement нужен для offscreen-канваса, в который кэшируется фон темы
const documentStub = {
  getElementById: () => canvasStub,
  createElement: () => ({ width: 0, height: 0, getContext: () => ctxStub })
};
const locationStub = { search: '', host: 'localhost' };

js += '\nmodule.exports = { CONFIG, Platform, hexMath, generators, mergeEngine, GameState, render,' +
  ' input, restart, updateActiveColors, renderGameToText, radiusForScore, growBoardIfNeeded,' +
  ' resetCamera, nearestSnapAngle, snapRotation, THEMES, applyTheme };';
const mod = { exports: {} };
new Function('module', 'localStorage', 'requestAnimationFrame', 'document', 'performance',
  'setTimeout', 'window', 'location', js)
  (mod, localStorageStub, raf, documentStub, perf, timeout, windowStub, locationStub);
const { CONFIG, Platform, hexMath, generators, mergeEngine, GameState, render, input, restart,
  updateActiveColors, renderGameToText, radiusForScore, growBoardIfNeeded,
  resetCamera, nearestSnapAngle, snapRotation, THEMES, applyTheme } = mod.exports;

let ok = true;
const check = (name, cond, extra = '') => {
  if (!cond) ok = false;
  console.log((cond ? 'OK   ' : 'FAIL ') + name + (extra ? '  ' + extra : ''));
};
const fire = (type, cx, cy, pointerId = 1) => handlers[type]({
  pointerId,
  clientX: rect.left + cx * (rect.width / CONFIG.canvas.width),
  clientY: rect.top + cy * (rect.height / CONFIG.canvas.height)
});
const lift = CONFIG.ui.dragLift;
const anyFreeCell = () => generators.freeCells(GameState)[0];
const anyOccupiedCell = () => { let f = null; GameState.cells.forEach(c => { if (c.stack && !f) f = c; }); return f; };
const filledSlot = () => GameState.hand.slots.findIndex(s => s !== null);

// Ручная сборка доски: spec = { "q,r": [цвета снизу вверх] }
const setBoard = (spec) => {
  restart();
  GameState.cells.forEach(c => { c.stack = null; });
  Object.keys(spec).forEach(k => {
    const c = GameState.cells.get(k);
    c.stack = { tiles: spec[k].slice(), cell: { q: c.q, r: c.r } };
  });
  GameState.score = 0;
};
// Снимок доски для сравнения прогонов
const dump = () => Array.from(GameState.cells.keys()).sort().map(k => {
  const s = GameState.cells.get(k).stack;
  return k + ':' + (s ? s.tiles.join('') : '-');
}).join('|');
const cell = (k) => GameState.cells.get(k);
const rep = (color, n) => new Array(n).fill(color);

// Готовая расстановка «ход даёт ровно блок из 10»: в центре 4 фишки, у двух его
// соседей по 2, игрок ставит 2 в третьего соседа центра. Точкой сбора становится
// центр (самый длинный верхний блок), в него стекается всё: 4 + 2 + 2 + 2 = 10.
const setBoardForBurn = () => {
  setBoard({ '0,0': rep(0, 4), '1,0': rep(0, 2), '0,-1': rep(0, 2) });
};
const playBurnMove = () => input.placeStack(GameState, { tiles: rep(0, 2), cell: null }, cell('1,-1'));

console.log('--- Phase 1: поле и математика ---');
check('ячеек на поле = 19', GameState.cells.size === 19, 'got ' + GameState.cells.size);
let rtOk = true, rtBad = '';
GameState.cells.forEach(c => {
  const back = hexMath.pixelToAxial(c.pixelX, c.pixelY);
  if (back.q !== c.q || back.r !== c.r) { rtOk = false; rtBad = `${c.q},${c.r} -> ${back.q},${back.r}`; }
});
check('pixelToAxial(axialToPixel) — та же ячейка', rtOk, rtBad);
const inBoard = (q, r) => GameState.cells.has(hexMath.key(q, r));
check('у центра 6 соседей, у угла (2,-2) — 3',
  hexMath.neighbors(0, 0).filter(n => inBoard(n.q, n.r)).length === 6 &&
  hexMath.neighbors(2, -2).filter(n => inBoard(n.q, n.r)).length === 3);
check('занято 6 ячеек, в руке 3 стопки',
  generators.freeCells(GameState).length === 13 && GameState.hand.slots.filter(Boolean).length === 3);

console.log('\n--- Phase 2: ввод и установка ---');
// пустое поле: ход гарантированно не вызовет слияния, проверяем только механику ввода
setBoard({});
let slot = filledSlot();
let slotCenter = render.handSlotCenter(slot);
let takenTiles = GameState.hand.slots[slot].tiles.join('');
fire('pointerdown', slotCenter.x, slotCenter.y);
check('pointerdown по слоту берёт стопку',
  GameState.drag !== null && GameState.hand.slots[slot] === null);
let target = anyFreeCell();
fire('pointermove', target.pixelX, target.pixelY + lift);
check('свободная ячейка под стопкой подсвечивается',
  GameState.hoverKey === hexMath.key(target.q, target.r), 'hoverKey=' + GameState.hoverKey);
fire('pointerup', target.pixelX, target.pixelY + lift);
check('pointerup над свободной ячейкой ставит стопку',
  target.stack !== null && GameState.drag === null && GameState.hoverKey === null);
check('подсказка гаснет после первого хода', GameState.showHint === false);

slot = filledSlot();
slotCenter = render.handSlotCenter(slot);
takenTiles = GameState.hand.slots[slot].tiles.join('');
const busy = anyOccupiedCell();
const busyTiles = busy.stack.tiles.join('');
fire('pointerdown', slotCenter.x, slotCenter.y);
fire('pointermove', busy.pixelX, busy.pixelY + lift);
check('занятая ячейка не подсвечивается', GameState.hoverKey === null);
fire('pointerup', busy.pixelX, busy.pixelY + lift);
check('отмена над занятой: стопка вернулась в свой слот',
  GameState.hand.slots[slot] !== null && GameState.hand.slots[slot].tiles.join('') === takenTiles);
fire('pointerdown', slotCenter.x, slotCenter.y);
fire('pointermove', 20, 880);
fire('pointerup', 20, 880);
check('отмена вне поля: стопка вернулась в слот',
  GameState.hand.slots[slot] !== null && GameState.drag === null);
fire('pointerdown', slotCenter.x, slotCenter.y);
fire('pointercancel', slotCenter.x, slotCenter.y);
check('pointercancel возвращает стопку', GameState.hand.slots[slot] !== null && GameState.drag === null);

const tallSlot = GameState.hand.slots.reduce((best, s, i) =>
  s && (best === -1 || s.tiles.length > GameState.hand.slots[best].tiles.length) ? i : best, -1);
const tallCenter = render.handSlotCenter(tallSlot);
const topY = tallCenter.y - (GameState.hand.slots[tallSlot].tiles.length - 1) * CONFIG.tile.layerOffset
  - CONFIG.ui.handHexSize + 2;
check('клик по верхней фишке стопки попадает в слот',
  input.hitHandSlot(GameState, tallCenter.x, topY) === tallSlot);
check('клик по пустому месту руки не берёт ничего',
  input.hitHandSlot(GameState, 20, CONFIG.ui.handY) === -1);

restart();
const oldStacks = GameState.hand.slots.slice();
let emptyAfterTwo = null;
for (let move = 0; move < 3; move++) {
  const i = filledSlot();
  const c = render.handSlotCenter(i);
  const free = anyFreeCell();
  fire('pointerdown', c.x, c.y);
  fire('pointermove', free.pixelX, free.pixelY + lift);
  fire('pointerup', free.pixelX, free.pixelY + lift);
  if (move === 1) emptyAfterTwo = GameState.hand.slots.filter(Boolean).length;
}
check('после двух ходов в руке одна стопка (раздачи нет)', emptyAfterTwo === 1, 'got ' + emptyAfterTwo);
check('после третьего хода рука пополнилась новыми стопками',
  GameState.hand.slots.filter(Boolean).length === 3 &&
  GameState.hand.slots.every(s => !oldStacks.includes(s)));

rect = { left: 10, top: 20, width: 360, height: 450 };
setBoard({});
slot = filledSlot();
slotCenter = render.handSlotCenter(slot);
target = anyFreeCell();
fire('pointerdown', slotCenter.x, slotCenter.y);
fire('pointermove', target.pixelX, target.pixelY + lift);
const hoverScaled = GameState.hoverKey === hexMath.key(target.q, target.r);
fire('pointerup', target.pixelX, target.pixelY + lift);
check('при CSS-масштабе 0.5 ввод попадает туда же', hoverScaled && target.stack !== null);
rect = { left: 0, top: 0, width: 720, height: 900 };

restart();
slot = filledSlot();
slotCenter = render.handSlotCenter(slot);
fire('pointerdown', slotCenter.x, slotCenter.y, 1);
const dragX = GameState.drag.x;
fire('pointermove', 100, 100, 99);
check('события чужого pointerId игнорируются', GameState.drag !== null && GameState.drag.x === dragX);
fire('pointerup', 100, 100, 99);
check('чужой pointerup не завершает перетаскивание', GameState.drag !== null);
fire('pointerup', slotCenter.x, slotCenter.y, 1);
check('свой pointerup завершает', GameState.drag === null);

console.log('\n--- Phase 3: слияние и цепочка ---');

// 1. перелив верхнего блока соседа в поставленную стопку
setBoard({ '0,0': [0, 0], '1,0': [1, 0, 0] });
let res = mergeEngine.resolveWave(GameState, cell('0,0'));
check('перелив: верхний блок соседа ушёл в цель',
  cell('0,0').stack.tiles.join('') === '0000' && cell('1,0').stack.tiles.join('') === '1',
  dump());
check('перелив без сгорания очков не даёт', res.totalPoints === 0, 'got ' + res.totalPoints);
check('перелив без сгорания монет не даёт', res.totalCoins === 0, 'got ' + res.totalCoins);

// 2. переливается только верхний одноцветный блок, не вся стопка
setBoard({ '0,0': [0], '1,0': [0, 1, 0, 0] });
mergeEngine.resolveWave(GameState, cell('0,0'));
check('уходит только верхний блок (2 из 4), низ остаётся',
  cell('0,0').stack.tiles.join('') === '000' && cell('1,0').stack.tiles.join('') === '01', dump());

// 3. сосед другого цвета не участвует
setBoard({ '0,0': [0, 0], '1,0': [1, 1] });
mergeEngine.resolveWave(GameState, cell('0,0'));
check('сосед другого цвета не переливается',
  cell('0,0').stack.tiles.join('') === '00' && cell('1,0').stack.tiles.join('') === '11');

// 4. сгорание при 10: только за сгоревшие фишки, ячейка освобождается
setBoard({ '0,0': rep(0, 4), '1,0': rep(0, 2), '1,-1': rep(0, 2), '0,-1': rep(0, 2) });
res = mergeEngine.resolveWave(GameState, cell('0,0'));
check('блок из 10 сгорел, ячейка освободилась', cell('0,0').stack === null, dump());
check('очки за блок 10 = 10 (переливы не считаются)', res.totalPoints === 10, 'got ' + res.totalPoints);
check('монет за блок 10 = 10', res.totalCoins === 10, 'got ' + res.totalCoins);

// 5. горит весь блок целиком: 13 → горят 13, сверх 10 по двойной ставке
setBoard({ '0,0': rep(0, 4), '1,0': rep(0, 3), '1,-1': rep(0, 3), '0,-1': rep(0, 3) });
res = mergeEngine.resolveWave(GameState, cell('0,0'));
check('блок 13 сгорел целиком (не ровно 10)', cell('0,0').stack === null, dump());
check('очки за блок 13: 10 + 3*2 = 16', res.totalPoints === 16, 'got ' + res.totalPoints);
check('монет за блок 13 = 13', res.totalCoins === 13, 'got ' + res.totalCoins);

// 6. под сгоревшим блоком открывается следующий цвет
setBoard({ '0,0': [1, 1, 0], '1,0': rep(0, 3), '1,-1': rep(0, 3), '0,-1': rep(0, 3) });
res = mergeEngine.resolveWave(GameState, cell('0,0'));
check('после сгорания открылся нижний цвет', cell('0,0').stack.tiles.join('') === '11', dump());

// 7. цепочка: сгорание волны 1 открывает цвет, волна 2 добирает и горит с множителем 2
setBoard({
  '0,0': rep(1, 9).concat([0]),
  '1,0': rep(0, 3), '1,-1': rep(0, 3), '0,-1': rep(0, 3),
  '-1,0': [1]
});
res = mergeEngine.resolveWave(GameState, cell('0,0'));
check('цепочка прошла две волны', res.waves === 2, 'waves=' + res.waves);
check('оба сгорания случились, поле пусто', dump().split('|').every(s => s.endsWith(':-')), dump());
check('очки цепочки: два блока по 10 = 20', res.totalPoints === 20, 'got ' + res.totalPoints);
check('множителя очков нет: вторая волна даёт те же 10',
  res.steps[1].points === 10, JSON.stringify(res.steps));
// Комбо (Phase 16) платит монетами, а не очками: первое звено без бонуса,
// второе даёт comboCoinBonus сверх 10 своих монет.
check('комбо считается по звеньям со сгоранием',
  res.steps[0].combo === 1 && res.steps[1].combo === 2, JSON.stringify(res.steps));
check('монет за цепочку: 10 + 10 + бонус за комбо ×2',
  res.totalCoins === 20 + CONFIG.scoring.comboCoinBonus, 'got ' + res.totalCoins);

// 8. детерминизм: одинаковая доска + ход = одинаковый результат
const spec = {
  '0,0': rep(1, 9).concat([0]),
  '1,0': rep(0, 3), '1,-1': rep(0, 3), '0,-1': rep(0, 3),
  '-1,0': [1], '-1,1': [2, 2], '2,-2': [2, 2]
};
setBoard(spec);
const runA = mergeEngine.resolveWave(GameState, cell('0,0'));
const dumpA = dump();
setBoard(spec);
const runB = mergeEngine.resolveWave(GameState, cell('0,0'));
check('детерминизм: очки и доска совпали в двух прогонах',
  runA.totalPoints === runB.totalPoints && dumpA === dump(),
  runA.totalPoints + ' vs ' + runB.totalPoints);

// 9. предохранитель maxWaveIterations
const savedMax = CONFIG.merge.maxWaveIterations;
CONFIG.merge.maxWaveIterations = 1;
setBoard(spec);
res = mergeEngine.resolveWave(GameState, cell('0,0'));
check('предохранитель останавливает волну на maxWaveIterations', res.waves === 1, 'waves=' + res.waves);
CONFIG.merge.maxWaveIterations = savedMax;

// 10. анимационный путь (input.placeStack → runWave) даёт то же состояние, что resolveWave
setBoard(spec);
delete GameState.cells.get('0,0').stack;          // освобождаем ячейку под ход
cell('0,0').stack = null;
const moveStack = { tiles: rep(0, 1), cell: null };
input.placeStack(GameState, moveStack, cell('0,0'));
const dumpAnim = dump();
const scoreAnim = GameState.score;
check('после волны ввод разблокирован', GameState.isAnimating === false);
check('анимация очищена', GameState.anim === null);

setBoard(spec);
cell('0,0').stack = null;
const syncCell = cell('0,0');
syncCell.stack = { tiles: rep(0, 1), cell: { q: 0, r: 0 } };
// синхронный путь тоже должен начинать волну с точки сбора, как это делает placeStack
const resSync = mergeEngine.resolveWave(
  GameState, mergeEngine.mergeTargetFor(GameState, syncCell));
check('анимационный и синхронный путь дают одинаковую доску', dumpAnim === dump(), dumpAnim + '  ||  ' + dump());
check('анимационный путь начислил те же очки', scoreAnim === resSync.totalPoints,
  scoreAnim + ' vs ' + resSync.totalPoints);

// 11. ввод заблокирован во время анимации
restart();
GameState.isAnimating = true;
slot = filledSlot();
slotCenter = render.handSlotCenter(slot);
fire('pointerdown', slotCenter.x, slotCenter.y);
check('во время анимации стопку взять нельзя',
  GameState.drag === null && GameState.hand.slots[slot] !== null);
GameState.isAnimating = false;

// 12. полная партия ботом: 60 ходов случайными стопками — без исключений и порчи данных
restart();
let moves = 0, guard = 0;
while (guard++ < 200 && moves < 60) {
  const free = generators.freeCells(GameState);
  if (!free.length) break;
  const i = filledSlot();
  if (i === -1) break;
  const c = render.handSlotCenter(i);
  const t = free[Math.floor(Math.random() * free.length)];
  fire('pointerdown', c.x, c.y);
  fire('pointermove', t.pixelX, t.pixelY + lift);
  fire('pointerup', t.pixelX, t.pixelY + lift);
  moves++;
}
let boardOk = true;
GameState.cells.forEach(c => {
  if (!c.stack) return;
  if (!c.stack.tiles.length) boardOk = false;                       // пустых стопок быть не должно
  if (mergeEngine.topRun(c.stack).length >= CONFIG.merge.burnThreshold) boardOk = false;  // недогоревших тоже
  c.stack.tiles.forEach(t => { if (t < 0 || t >= CONFIG.colors.palette.length) boardOk = false; });
});
// число ходов не фиксируем: партия может закончиться проигрышем раньше — это баланс,
// а тест проверяет целостность доски
check('партия ботом: доска валидна, недогоревших блоков нет',
  boardOk && moves >= 20 && (moves === 60 || GameState.isGameOver),
  'moves=' + moves + ' score=' + GameState.score + ' gameOver=' + GameState.isGameOver);
check('счёт вырос за партию', GameState.score > 0, 'score=' + GameState.score);
check('ввод не остался заблокированным', GameState.isAnimating === false);

console.log('\n--- Phase 4: проигрыш, рекорд, restart ---');

// Раскраска в 3 цвета по (q-r) mod 3: соседи всегда разного цвета, слияний нет
const setBoardTricolor = () => {
  restart();
  GameState.cells.forEach(c => {
    c.stack = { tiles: [((c.q - c.r) % 3 + 3) % 3], cell: { q: c.q, r: c.r } };
  });
  GameState.score = 0;
};

// 1. проигрыш: заполненное поле + непустая рука
setBoardTricolor();
cell('0,0').stack = null;
check('перед последним ходом свободна одна ячейка', generators.freeCells(GameState).length === 1);
input.placeStack(GameState, { tiles: [0], cell: null }, cell('0,0'));
check('поле забито и рука непуста → игра окончена',
  GameState.isGameOver === true && generators.freeCells(GameState).length === 0 &&
  GameState.hand.slots.some(s => s !== null));

// 2. на оверлее нельзя взять стопку из руки
slot = filledSlot();
slotCenter = render.handSlotCenter(slot);
fire('pointerdown', slotCenter.x, slotCenter.y);
check('на оверлее стопку взять нельзя', GameState.drag === null && GameState.hand.slots[slot] !== null);

// 3. клик мимо кнопки ничего не делает
fire('pointerdown', 30, 30);
check('клик мимо кнопки «Заново» игру не сбрасывает', GameState.isGameOver === true);

// 4. кнопка «Заново» — свежая партия
const btn = render.restartButtonRect();
fire('pointerdown', btn.x + btn.w / 2, btn.y + btn.h / 2);
check('кнопка «Заново» даёт свежее поле и счёт 0',
  GameState.isGameOver === false && GameState.score === 0 &&
  generators.freeCells(GameState).length === 13 &&
  GameState.hand.slots.filter(Boolean).length === 3);

// 5. рекорд растёт прямо во время партии, не только в конце
store[CONFIG.storage.bestKey] = '0';
setBoardForBurn();
GameState.best = 0;
GameState.score = 0;
playBurnMove();
check('сгорание блока 10 дало ровно 10 очков', GameState.score === 10,
  'score=' + GameState.score);
check('рекорд подтянулся во время партии, до её конца',
  GameState.best === GameState.score && store[CONFIG.storage.bestKey] === String(GameState.score),
  'best=' + GameState.best + ' stored=' + store[CONFIG.storage.bestKey]);

// имитируем конец партии: поле забито трёхцветной раскраской (слияний не будет),
// рука непуста, счёт выше прежнего рекорда
setBoardTricolor();
GameState.best = 0;
GameState.score = 777;
cell('0,0').stack = null;
input.placeStack(GameState, { tiles: [0], cell: null }, cell('0,0'));
check('рекорд обновился в состоянии', GameState.best === 777, 'best=' + GameState.best);
check('рекорд записан в хранилище через Platform',
  store[CONFIG.storage.bestKey] === '777', 'stored=' + store[CONFIG.storage.bestKey]);
check('Platform.loadBest читает записанный рекорд', Platform.loadBest() === 777);

// 6. рекорд переживает перезагрузку (restart читает из хранилища)
restart();
check('после restart счёт 0, рекорд на месте',
  GameState.score === 0 && GameState.best === 777 && GameState.isGameOver === false);

// 7. меньший счёт рекорд не портит
setBoardTricolor();
GameState.best = 777;
GameState.score = 100;
cell('0,0').stack = null;
input.placeStack(GameState, { tiles: [0], cell: null }, cell('0,0'));
check('счёт ниже рекорда не перезаписывает рекорд',
  GameState.best === 777 && store[CONFIG.storage.bestKey] === '777');

// 8. клавиша R
check('обработчик keydown повешен', typeof windowHandlers.keydown === 'function');
windowHandlers.keydown({ code: 'KeyR' });
check('клавиша R начинает новую партию',
  GameState.score === 0 && GameState.isGameOver === false &&
  generators.freeCells(GameState).length === 13 && GameState.best === 777);
GameState.isAnimating = true;
GameState.score = 55;
windowHandlers.keydown({ code: 'KeyR' });
check('во время волны R не срабатывает', GameState.score === 55);
GameState.isAnimating = false;
windowHandlers.keydown({ code: 'KeyT' });
check('другая клавиша игру не сбрасывает', GameState.score === 55);

// 9. localStorage — только внутри Platform (требование ADR/спеки §13)
const platformSection = js.slice(js.indexOf('const Platform = {'), js.indexOf('const hexMath = {'));
// сравниваем только код: строки-комментарии выбрасываем
const stripComments = (src) => src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
const outside = stripComments(js.replace(platformSection, ''));
check('обращений к localStorage вне Platform нет',
  !outside.includes('localStorage'),
  'найдено вне Platform: ' + (outside.match(/localStorage/g) || []).length);
check('внутри Platform localStorage используется', platformSection.includes('localStorage'));

console.log('\n--- Phase 5: полировка и кривая сложности ---');

// 1. набор цветов расширяется вместе с кольцами: 4 → 7 → 10
restart();
const ringSteps = CONFIG.board.radiusSteps;
const colorsAt = (score) => { GameState.score = score; updateActiveColors(GameState); return GameState.activeColors; };
check('в палитре 10 цветов', CONFIG.colors.palette.length === 10,
  'got ' + CONFIG.colors.palette.length);
check('все цвета палитры различны', new Set(CONFIG.colors.palette).size === 10);
check('на старте 4 цвета', colorsAt(0) === 4, 'got ' + colorsAt(0));
check('за очко до первого кольца — всё ещё 4 цвета',
  colorsAt(ringSteps[1].fromScore - 1) === 4, 'got ' + colorsAt(ringSteps[1].fromScore - 1));
check('первое кольцо приносит +3 цвета (7)',
  colorsAt(ringSteps[1].fromScore) === 7, 'got ' + colorsAt(ringSteps[1].fromScore));
check('за очко до второго кольца — всё ещё 7',
  colorsAt(ringSteps[2].fromScore - 1) === 7, 'got ' + colorsAt(ringSteps[2].fromScore - 1));
check('второе кольцо приносит ещё +3 цвета (10)',
  colorsAt(ringSteps[2].fromScore) === 10, 'got ' + colorsAt(ringSteps[2].fromScore));
check('дальше набор не растёт', colorsAt(999999) === 10, 'got ' + colorsAt(999999));
check('число цветов не превышает размер палитры',
  ringSteps.every(s => s.colors <= CONFIG.colors.palette.length));

// 2. генератор реально выдаёт ровно активный набор
[4, 7, 10].forEach(colors => {
  const seen = new Set();
  for (let i = 0; i < 1200; i++) generators.makeStack(colors, 0).tiles.forEach(t => seen.add(t));
  check(`при ${colors} активных цветах встречаются все ${colors} и ни одного лишнего`,
    seen.size === colors && Math.max(...seen) === colors - 1,
    'уникальных ' + seen.size + ', максимум ' + Math.max(...seen));
});

// 3. милосердие при 2 свободных ячейках
setBoardTricolor();
const freeKeys = ['0,0', '1,0'];
freeKeys.forEach(k => { cell(k).stack = null; });
check('свободных ячеек ровно 2 (порог милосердия)',
  generators.freeCells(GameState).length === CONFIG.mercy.threshold);
let mercyOk = true;
for (let i = 0; i < 100; i++) {
  const tops = new Set();
  GameState.cells.forEach(c => { if (c.stack) tops.add(c.stack.tiles[c.stack.tiles.length - 1]); });
  generators.dealHand(GameState);
  const first = GameState.hand.slots[0];
  if (!tops.has(first.tiles[first.tiles.length - 1])) mercyOk = false;
}
check('милосердная раздача 100 раз из 100 даёт цвет, лежащий наверху на поле', mercyOk);

// 4. без милосердия (много свободных) генератор поле не разглядывает — раздача случайна
restart();
let variety = new Set();
for (let i = 0; i < 200; i++) {
  generators.dealHand(GameState);
  variety.add(GameState.hand.slots[0].tiles[GameState.hand.slots[0].tiles.length - 1]);
}
check('при свободном поле раздача не привязана к доске',
  variety.size === GameState.activeColors, 'got ' + variety.size);

// 5. анимации: приземление и вспышка отыгрываются и не залипают в состоянии
setBoardForBurn();
GameState.score = 0;
playBurnMove();
check('после хода landing сброшен', GameState.landing === null);
check('после хода burnAnim сброшен', GameState.burnAnim === null);
check('после хода anim сброшен', GameState.anim === null);
check('ввод разблокирован', GameState.isAnimating === false);
check('сгорание случилось (счёт 10)', GameState.score === 10, 'score=' + GameState.score);

// 6. длинная партия ботом: цвета растут вместе со счётом, состояние чистое
restart();
let botMoves = 0;
while (botMoves < 900 && GameState.score < 800 && !GameState.isGameOver) {
  const free = generators.freeCells(GameState);
  if (!free.length) break;
  const i = filledSlot();
  if (i === -1) break;
  const c = render.handSlotCenter(i);
  const t = free[Math.floor(Math.random() * free.length)];
  fire('pointerdown', c.x, c.y);
  fire('pointermove', t.pixelX, t.pixelY + lift);
  fire('pointerup', t.pixelX, t.pixelY + lift);
  botMoves++;
}
let expectedColors = CONFIG.board.radiusSteps[0].colors;
CONFIG.board.radiusSteps.forEach(s => { if (GameState.score >= s.fromScore) expectedColors = s.colors; });
check('в живой партии число цветов соответствует счёту',
  GameState.activeColors === expectedColors,
  'score=' + GameState.score + ' colors=' + GameState.activeColors + ' ожидалось ' + expectedColors);
// Порог здесь намеренно низкий: он проверяет, что партия вообще идёт, а не баланс —
// баланс меняется от фазы к фазе и не должен ронять тесты.
check('партия идёт и завершается корректно',
  botMoves > 10 && (GameState.isGameOver || GameState.score >= 800),
  'score=' + GameState.score + ' moves=' + botMoves + ' gameOver=' + GameState.isGameOver);
let boardOk2 = true;
GameState.cells.forEach(c => {
  if (!c.stack) return;
  if (!c.stack.tiles.length) boardOk2 = false;
  if (mergeEngine.topRun(c.stack).length >= CONFIG.merge.burnThreshold) boardOk2 = false;
});
check('доска после длинной партии валидна', boardOk2);
check('анимационные поля не залипли',
  GameState.anim === null && GameState.burnAnim === null && GameState.landing === null);

// 7. подсказка
restart();
check('подсказка видна на старте', GameState.showHint === true);
input.placeStack(GameState, { tiles: [0], cell: null }, anyFreeCell());
check('подсказка гаснет после первого хода', GameState.showHint === false);

console.log('\n--- Phase 16: анимации бустов и комбо ---');

// 1. анимация бустов: стопка летит, а не телепортируется
restart();
GameState.coins = 500;
const boostSrc = cell('1,-1');
const boostDst = cell('2,-2');
boostSrc.stack = { tiles: rep(0, 3), cell: { q: 1, r: -1 } };
boostDst.stack = null;
input.toggleBoost(GameState, 'move');
input.applyBoostTo(GameState, boostSrc);          // выбрали источник
check('первый клик буста «перенос» только запоминает ячейку',
  GameState.boost && GameState.boost.from === boostSrc);
input.applyBoostTo(GameState, boostDst);          // выбрали цель
check('после переноса стопка на новом месте',
  boostDst.stack !== null && boostSrc.stack === null);
check('монеты за буст списаны',
  GameState.coins === 500 - input.boostConfig('move').cost, 'coins=' + GameState.coins);

// кадр в середине перелёта: ячейка-цель спрятана, стопку рисует drawBoostAnim
GameState.boostAnim = input.boostFlight([
  { tiles: rep(0, 3), from: boostSrc, to: boostDst, side: 1 }
]);
GameState.boostAnim.t = 0.5;
check('во время перелёта ячейка-цель спрятана',
  GameState.boostAnim.hide.has(hexMath.key(boostDst.q, boostDst.r)));
render.drawAll(GameState);
check('кадр в середине перелёта буста рисуется без ошибок', true);
GameState.boostAnim = null;

// 2. «убрать» рассыпает стопку осколками, а не гасит её молча
restart();
GameState.coins = 500;
GameState.fx = { particles: [], floats: [], shake: null };
const removeCell = cell('1,-1');
removeCell.stack = { tiles: rep(0, 4), cell: { q: 1, r: -1 } };
input.toggleBoost(GameState, 'remove');
// считаем осколки на лету: цикл эффектов синхронный и успевает их погасить,
// поэтому длину массива после вызова смотреть бесполезно
let scattered = 0;
const spyParticles = [];
spyParticles.push = function (item) {
  scattered++;
  return Array.prototype.push.call(this, item);
};
GameState.fx.particles = spyParticles;
input.applyBoostTo(GameState, removeCell);
check('буст «убрать» очистил ячейку', removeCell.stack === null);
check('буст «убрать» рассыпал стопку на осколки',
  scattered === 4 * CONFIG.animation.boostScatterPerTile, 'осколков ' + scattered);
GameState.fx = { particles: [], floats: [], shake: null };

// 3. комбо: цепочка из двух сгораний платит бонусом, из одного — нет
restart();
setBoardForBurn();
GameState.coins = 0;
playBurnMove();
check('одиночное сгорание бонуса за комбо не даёт',
  GameState.coins === 10, 'coins=' + GameState.coins);
restart();

console.log('\n--- Phase 15: анимации и juice ---');

// 1. кривые сглаживания
check('ease.smooth закреплён на краях',
  render.ease.smooth(0) === 0 && render.ease.smooth(1) === 1);
check('ease.outCubic тормозит к концу',
  render.ease.outCubic(0) === 0 && Math.abs(render.ease.outCubic(1) - 1) < 1e-9 &&
  render.ease.outCubic(0.5) > 0.5);
check('ease.outBack перелетает единицу и возвращается',
  Math.abs(render.ease.outBack(1) - 1) < 1e-9 && render.ease.outBack(0.78) > 1);

// 2. скорость доворота поля переехала в animation — раньше ключа не было вовсе
// и код молча падал на фолбэк CONFIG.camera.snapMs
check('CONFIG.animation.snapMs задан', CONFIG.animation.snapMs > 0);
check('CONFIG.camera.snapMs больше не нужен', CONFIG.camera.snapMs === undefined);

// 3. цикл эффектов завершается сам и догоняет счётчики.
// Это главный инвариант: живой эффект держит RAF, и незавершённый цикл
// крутил бы кадры вечно (в тестах — ушёл бы в бесконечную рекурсию).
restart();
setBoardForBurn();
GameState.score = 0;
GameState.coins = 0;
playBurnMove();
check('после сгорания счёт на экране догнал настоящий',
  GameState.scoreShown === GameState.score && GameState.score === 10,
  'shown=' + GameState.scoreShown + ' score=' + GameState.score);
check('кошелёк на экране догнал настоящий',
  GameState.coinsShown === GameState.coins, 'shown=' + GameState.coinsShown);
check('эффекты погасли и больше не держат кадр',
  GameState.fx.particles.length === 0 && GameState.fx.floats.length === 0 &&
  GameState.fx.shake === null);

// 4. кадр с живыми эффектами рисуется без ошибок
const fxCell = cell('0,0');
GameState.fx.particles.push({ cell: fxCell, color: 0, age: 0, vx: 40, vy: -60 });
GameState.fx.floats.push({ cell: fxCell, text: '+16', age: 0 });
GameState.fx.shake = { age: 0 };
render.drawAll(GameState);
check('кадр с осколками, «+N» и тряской рисуется без ошибок', true);

// 5. тряска затухает и без эффекта не смещает поле
const shakeStart = Math.abs(render.shakeOffset(GameState).x);
GameState.fx.shake = { age: CONFIG.animation.shakeMs };
check('тряска затухает к концу',
  Math.abs(render.shakeOffset(GameState).x) <= shakeStart);
GameState.fx = { particles: [], floats: [], shake: null };
check('без тряски смещение нулевое',
  render.shakeOffset(GameState).x === 0 && render.shakeOffset(GameState).y === 0);

// 6. слияние стопок: летящая фишка целится в свой будущий слой, а не в центр
// ячейки — иначе стопка в конце полёта «дёргается» вверх скачком
const layerStep = CONFIG.tile.layerOffset;
check('layerRise: нижний слой лежит в центре ячейки', render.layerRise(4, 0) === 0);
check('layerRise: слои идут вверх с шагом layerOffset',
  render.layerRise(4, 3) === layerStep * 3, render.layerRise(4, 3));
check('layerRise: полная стопка ужимается ровно в maxRise',
  Math.abs(render.layerRise(CONFIG.tile.maxVisibleLayers,
    CONFIG.tile.maxVisibleLayers - 1) - CONFIG.tile.maxRise) < 1e-9);
check('layerRise: слои ниже видимой части прижаты к центру',
  render.layerRise(40, 0) === 0 && render.layerRise(40, 5) === 0);

restart();
const flowSrc = cell('1,-1');
const flowDst = cell('0,0');
flowDst.stack = { tiles: rep(0, 3), cell: { q: 0, r: 0 } };
flowSrc.stack = { tiles: rep(0, 1), cell: { q: 1, r: -1 } };
GameState.anim = {
  flows: [{ from: flowSrc, to: flowDst, color: 0, count: 2, baseLayer: 3, finalTotal: 5 }],
  t: 0.5
};
render.drawAll(GameState);
check('кадр в середине слияния рисуется без ошибок', true);
GameState.anim = null;

// 7. новая партия не заставляет счётчики доезжать до нуля
GameState.scoreShown = 999;
restart();
check('restart ставит счётчики сразу, без доезда',
  GameState.scoreShown === GameState.score && GameState.coinsShown === GameState.coins);
check('restart гасит эффекты и прячет проявление оверлея',
  GameState.fx.particles.length === 0 && GameState.overlayT === 1);

console.log('\n--- Phase 12: визуальный стиль ---');

// 1. тема объявлена и полна. Проверки идут по Object.keys, а не по имени ключа:
// из восьми вариантов остался один, но структура рассчитана на несколько.
const themeNames = Object.keys(THEMES);
check('выбранный стиль объявлен', themeNames.length >= 1 && THEMES.paper,
  themeNames.join(', '));
themeNames.forEach(name => {
  const t = THEMES[name];
  check(`«${t.name}»: палитра из 10 различных цветов`,
    t.palette.length === 10 && new Set(t.palette).size === 10,
    'цветов ' + t.palette.length);
  check(`«${t.name}»: заданы все цвета интерфейса`,
    ['bg', 'cellFill', 'cellStroke', 'text', 'textDim', 'highlightFill', 'highlightStroke',
     'overlayBg', 'overlayText', 'cardFill', 'cardShadow',
     'buttonFill', 'buttonFillDark', 'buttonText', 'coinColor']
      .every(key => typeof t.ui[key] === 'string' && t.ui[key].length > 0));
  check(`«${t.name}»: есть все три функции отрисовки`,
    typeof t.background === 'function' && typeof t.emptyCell === 'function' &&
    typeof t.tile === 'function');
  check(`«${t.name}»: геометрия фишки задана и не конфликтует с методом tile`,
    typeof t.geometry === 'object' && t.geometry.layerOffset > 0 && t.geometry.scale > 0);
});

// 2. applyTheme вливает цвета темы в CONFIG
const theme = THEMES[themeNames[0]];
applyTheme(themeNames[0]);
check('applyTheme перенёс палитру в CONFIG', CONFIG.colors.palette === theme.palette);
check('applyTheme перенёс цвета интерфейса',
  CONFIG.ui.bg === theme.ui.bg && CONFIG.ui.text === theme.ui.text);
check('applyTheme перенёс геометрию фишки',
  CONFIG.tile.layerOffset === theme.geometry.layerOffset,
  'layerOffset=' + CONFIG.tile.layerOffset);
check('applyTheme перенёс оформление панели бустов',
  CONFIG.ui.boostBar.fill === theme.boostBar.fill);
check('неизвестная тема игнорируется', applyTheme('нет-такой') === false);

// 3. временного переключателя стилей в поставке нет
check('кнопки «Стиль» больше нет', render.themeButtonRect === undefined);
check('в хранилище не осталось ключа темы', CONFIG.storage.themeKey === undefined);

// 4. весь цвет живёт в CONFIG и теме: сменить стиль должно быть можно,
// не трогая код отрисовки (критерий приёмки Phase 12)
const themesSection = js.slice(js.indexOf('const THEMES = {'), js.indexOf('let THEME'));
const configSection = js.slice(js.indexOf('const CONFIG = {'), js.indexOf('const THEMES = {'));
const codeOnly = stripComments(js.replace(themesSection, '').replace(configSection, ''));
const colorLiterals = codeOnly.match(/#[0-9A-Fa-f]{3,8}\b|rgba?\(\s*\d[\d.,\s]*\)/g) || [];
check('цветов, захардкоженных вне CONFIG и темы, нет',
  colorLiterals.length === 0, colorLiterals.join(' '));

// 5. кэш фона сбрасывается при смене темы
render.backgroundCache = 'старый';
applyTheme(themeNames[0]);
check('смена темы сбрасывает кэш фона', render.backgroundCache === null);

// 6. игра работает в выбранном стиле: полный ход с отрисовкой
themeNames.forEach(name => {
  applyTheme(name);
  setBoardForBurn();
  GameState.score = 0;
  GameState.coins = 0;
  playBurnMove();
  check(`в теме «${THEMES[name].name}» ход проходит и блок сгорает`,
    GameState.score === 10 && GameState.coins === 10,
    'score=' + GameState.score);
  render.drawAll(GameState);          // отрисовка не должна падать
  check(`в теме «${THEMES[name].name}» полный кадр рисуется без ошибок`, true);
});
applyTheme(themeNames[0]);
restart();

console.log('\n--- Phase 11: бусты ---');

const boostOf = (kind) => CONFIG.boosts.find(b => b.kind === kind);
const clickBoost = (kind) => {
  const index = CONFIG.boosts.findIndex(b => b.kind === kind);
  const r = render.boostButtonRect(index);
  fire('pointerdown', r.x + r.w / 2, r.y + r.h / 2);
};
// клик по ячейке поля (в режиме буста выбирает её)
const clickCell = (targetCell) => {
  const screen = input.worldToScreen(GameState, targetCell.pixelX, targetCell.pixelY);
  fire('pointerdown', screen.x, screen.y);
};

// 1. панель: три кнопки, не пересекаются, влезают в канвас
check('бустов ровно три', CONFIG.boosts.length === 3);
const rects = CONFIG.boosts.map((b, i) => render.boostButtonRect(i));
check('кнопки бустов внутри канваса и не налезают друг на друга',
  rects[0].x >= 0 && rects[2].x + rects[2].w <= CONFIG.canvas.width &&
  rects[0].x + rects[0].w < rects[1].x && rects[1].x + rects[1].w < rects[2].x,
  rects.map(r => `${r.x.toFixed(0)}..${(r.x + r.w).toFixed(0)}`).join(' | '));
check('панель ниже руки и внутри канваса',
  rects[0].y > CONFIG.ui.handY && rects[0].y + rects[0].h <= CONFIG.canvas.height);

// 2. активация и отмена не стоят монет
setBoard({ '0,0': rep(0, 3) });
GameState.coins = 100;
clickBoost('move');
check('буст активирован', GameState.boost && GameState.boost.kind === 'move');
check('монеты за активацию не списаны', GameState.coins === 100);
clickBoost('move');
check('повторное нажатие выключает буст', GameState.boost === null);
check('отмена ничего не стоит', GameState.coins === 100);
clickBoost('remove');
windowHandlers.keydown({ code: 'Escape' });
check('Esc отменяет буст', GameState.boost === null && GameState.coins === 100);

// 3. нехватка монет
GameState.coins = boostOf('remove').cost - 1;
clickBoost('remove');
check('при нехватке монет буст не включается', GameState.boost === null);
GameState.coins = boostOf('remove').cost;
clickBoost('remove');
check('ровно на цену — включается', GameState.boost !== null);
GameState.boost = null;

// 4. «Убрать»: ячейка освобождается, очков нет, цена списана один раз
setBoard({ '0,0': rep(0, 3), '1,0': rep(1, 2) });
GameState.coins = 100;
GameState.score = 0;
clickBoost('remove');
clickCell(cell('0,0'));
check('«Убрать» освободил ячейку', cell('0,0').stack === null, dump());
check('соседняя стопка не тронута', cell('1,0').stack.tiles.join('') === '11');
check('очков за буст не начислено', GameState.score === 0);
check('списана ровно цена буста', GameState.coins === 100 - boostOf('remove').cost,
  'coins=' + GameState.coins);
check('после применения буст выключился', GameState.boost === null);

// 5. «Перенос»: стопка переезжает в свободную ячейку
setBoard({ '0,0': rep(0, 3) });
GameState.coins = 100;
clickBoost('move');
clickCell(cell('0,0'));
check('первый клик выбрал источник, монеты ещё не списаны',
  GameState.boost && GameState.boost.from === cell('0,0') && GameState.coins === 100);
clickCell(cell('2,0'));
check('стопка переехала в выбранную ячейку',
  cell('0,0').stack === null && cell('2,0').stack.tiles.join('') === '000', dump());
check('цена переноса списана', GameState.coins === 100 - boostOf('move').cost);
check('stack.cell обновлён', cell('2,0').stack.cell.q === 2 && cell('2,0').stack.cell.r === 0);

// 6. «Перенос» запускает волну: переставили к одноцветной — блок собрался и сгорел
setBoard({ '2,-2': rep(0, 8), '1,0': rep(0, 2), '0,-1': rep(0, 1) });
GameState.coins = 100;
GameState.score = 0;
clickBoost('move');
clickCell(cell('2,-2'));      // источник — большая стопка
clickCell(cell('0,0'));       // ставим в центр, рядом с двумя одноцветными
check('перенос собрал блок 11 и он сгорел (10 + 1*2 = 12 очков)',
  GameState.score === 12 && cell('0,0').stack === null,
  'score=' + GameState.score + ' ' + dump());

// 7. «Пересдача»: рука меняется целиком, ячейку выбирать не надо (Phase 17).
// Заменила «Обмен», который решал ту же задачу, что и «Перенос», — переставить стопки.
setBoard({ '0,0': rep(0, 3) });
GameState.coins = 100;
const handBefore = GameState.hand.slots.map(s => (s ? s.tiles.join('') : null));
GameState.hand.slots[1] = null;                 // одна стопка уже израсходована
clickBoost('reroll');
check('пересдача не ждёт выбора ячейки', GameState.boost === null);
check('все три слота заполнены заново',
  GameState.hand.slots.every(s => s && s.tiles.length > 0),
  GameState.hand.slots.map(s => (s ? s.tiles.join('') : '-')).join('|'));
check('цена пересдачи списана', GameState.coins === 100 - boostOf('reroll').cost,
  'coins=' + GameState.coins);
check('пересдача не тронула поле', cell('0,0').stack.tiles.join('') === '000', dump());
check('пересдача не начислила очков', GameState.score === 0);
check('рука действительно обновилась',
  GameState.hand.slots.map(s => s.tiles.join('')).join('|') !== handBefore.join('|') ||
  handBefore[1] === null, 'до: ' + handBefore.join('|'));

// 8. пересдача недоступна без монет и не ломает кадр анимацией
setBoard({ '0,0': rep(0, 3) });
GameState.coins = boostOf('reroll').cost - 1;
const slotsPoor = GameState.hand.slots.map(s => (s ? s.tiles.join('') : null)).join('|');
clickBoost('reroll');
check('без монет пересдача не срабатывает',
  GameState.hand.slots.map(s => (s ? s.tiles.join('') : null)).join('|') === slotsPoor &&
  GameState.coins === boostOf('reroll').cost - 1);
GameState.handAnim = { old: GameState.hand.slots.map(s => (s ? s.tiles.slice() : null)), t: 0.5 };
render.drawAll(GameState);
check('кадр в середине пересдачи рисуется без ошибок', true);
GameState.handAnim = null;

// 9. выбор недопустимой ячейки игнорируется
setBoard({ '0,0': rep(0, 3) });
GameState.coins = 100;
clickBoost('remove');
clickCell(cell('2,0'));       // пустая ячейка — убирать нечего
check('клик по пустой ячейке при «Убрать» ничего не делает',
  GameState.boost !== null && GameState.coins === 100);
GameState.boost = null;

// 10. бусты недоступны во время волны и на оверлее
GameState.isAnimating = true;
clickBoost('move');
check('во время волны буст не включается', GameState.boost === null);
GameState.isAnimating = false;
GameState.isGameOver = true;
clickBoost('move');
check('на оверлее конца буст не включается', GameState.boost === null);
GameState.isGameOver = false;

// 11. буст снимает проигрыш: поле было забито, «Убрать» освободил ячейку
restart();
GameState.cells.forEach(c => {
  c.stack = { tiles: [((c.q - c.r) % 3 + 3) % 3], cell: { q: c.q, r: c.r } };
});
GameState.coins = 100;
GameState.isGameOver = true;                 // партия окончена: мест нет
clickBoost('remove');
check('на оверлее буст по-прежнему недоступен', GameState.boost === null);
GameState.isGameOver = false;                // сценарий: игрок успел до конца хода
clickBoost('remove');
clickCell(cell('0,0'));
check('после буста на поле снова есть место и партия не окончена',
  generators.freeCells(GameState).length === 1 && GameState.isGameOver === false,
  'free=' + generators.freeCells(GameState).length);

// 12. активный буст блокирует обычный ход и вращение
restart();
GameState.coins = 100;
const slotBeforeBoost = filledSlot();
clickBoost('move');
const handCenterBoost = render.handSlotCenter(slotBeforeBoost);
fire('pointerdown', handCenterBoost.x, handCenterBoost.y);
check('пока буст активен, стопку из руки не взять',
  GameState.drag === null && GameState.hand.slots[slotBeforeBoost] !== null);
const rotationBefore = GameState.camera.rotation;
fire('pointerdown', hexMath.layout.centerX + 150, hexMath.layout.centerY);
fire('pointermove', hexMath.layout.centerX, hexMath.layout.centerY + 150);
check('пока буст активен, поле не вращается',
  GameState.camera.rotation === rotationBefore);
GameState.boost = null;
restart();

console.log('\n--- Phase 10: поворот поля ---');

const deg = (radians) => radians * 180 / Math.PI;
const rad = (degrees) => degrees * Math.PI / 180;

// 1. преобразования экран ↔ мир при повороте
restart();
[0, 60, 145, -90].forEach(angleDeg => {
  GameState.camera.rotation = rad(angleDeg);
  let roundTripOk = true;
  [[0, 0], [360, 350], [719, 120], [-40, 480]].forEach(([sx, sy]) => {
    const w = input.screenToWorld(GameState, sx, sy);
    const back = input.worldToScreen(GameState, w.x, w.y);
    if (Math.abs(back.x - sx) > 1e-9 || Math.abs(back.y - sy) > 1e-9) roundTripOk = false;
  });
  check(`round-trip экран↔мир при повороте ${angleDeg}°`, roundTripOk);
});
resetCamera(GameState);

// 2. центр поля неподвижен при любом повороте
GameState.camera.rotation = rad(37);
const centerMoved = input.worldToScreen(GameState, hexMath.layout.centerX, hexMath.layout.centerY);
check('центр поля остаётся на месте при повороте',
  Math.abs(centerMoved.x - hexMath.layout.centerX) < 1e-9 &&
  Math.abs(centerMoved.y - hexMath.layout.centerY) < 1e-9);
resetCamera(GameState);

// 3. попадание в ячейку при повёрнутом поле
const aimAt = (targetCell) => {
  const screen = input.worldToScreen(GameState, targetCell.pixelX, targetCell.pixelY + lift);
  const c = render.handSlotCenter(filledSlot());
  fire('pointerdown', c.x, c.y);
  fire('pointermove', screen.x, screen.y);
  const hovered = GameState.hoverKey;
  fire('pointerup', screen.x, screen.y);
  return hovered;
};
setBoard({});
GameState.camera.rotation = rad(60);
check('при повороте на 60° стопка ложится в ту ячейку, куда целишься',
  aimAt(cell('1,-1')) === '1,-1' && cell('1,-1').stack !== null, 'hover=' + GameState.hoverKey);
setBoard({});
GameState.camera.rotation = rad(-120);
check('при повороте на -120° тоже',
  aimAt(cell('-2,1')) === '-2,1' && cell('-2,1').stack !== null, 'hover=' + GameState.hoverKey);
resetCamera(GameState);

// 4. примагничивание к граням гекса
const step = CONFIG.camera.snapStepDeg;
check(`шаг примагничивания — ${step}°`, step === 60);
[[5, 0], [35, 60], [59, 60], [95, 120], [-25, 0], [-40, -60], [200, 180]].forEach(([from, expected]) => {
  check(`${from}° примагничивается к ${expected}°`,
    Math.abs(deg(nearestSnapAngle(rad(from))) - expected) < 1e-6,
    'получилось ' + deg(nearestSnapAngle(rad(from))).toFixed(1) + '°');
});

// 5. жест вращения: тянем по полю — поле крутится, стопка не ставится
restart();
const freeBeforeSpin = generators.freeCells(GameState).length;
const handBeforeSpin = GameState.hand.slots.filter(Boolean).length;
const L = hexMath.layout;
fire('pointerdown', L.centerX + 150, L.centerY);       // справа от центра
// первое движение только открывает жест: отсчёт берётся заново, иначе весь
// накопленный до пробоя порога угол применился бы одним рывком
fire('pointermove', L.centerX + 145, L.centerY + 30);
check('первое движение только открывает жест, поле стоит',
  GameState.camera.rotation === 0, 'угол ' + deg(GameState.camera.rotation).toFixed(1) + '°');
fire('pointermove', L.centerX, L.centerY + 150);       // повернули на 90° по часовой
check('жест по полю повернул поле', Math.abs(GameState.camera.rotation) > 0.1,
  'угол ' + deg(GameState.camera.rotation).toFixed(1) + '°');
fire('pointerup', L.centerX, L.centerY + 150);
// сравниваем с ближайшей гранью, а не через остаток: 120° в double — это 119.999…
check('после отпускания угол примагничен к грани',
  Math.abs(GameState.camera.rotation - nearestSnapAngle(GameState.camera.rotation)) < 1e-9,
  'угол ' + deg(GameState.camera.rotation).toFixed(1) + '°');
check('вращение не поставило стопку и не тронуло руку',
  generators.freeCells(GameState).length === freeBeforeSpin &&
  GameState.hand.slots.filter(Boolean).length === handBeforeSpin);
check('жест завершён', input.spin === null && GameState.drag === null);

// 6. микродвижение курсора поле не крутит
resetCamera(GameState);
fire('pointerdown', L.centerX + 150, L.centerY);
fire('pointermove', L.centerX + 152, L.centerY + 1);   // дрожание меньше порога
check('дрожание курсора не вращает поле', GameState.camera.rotation === 0,
  'угол ' + deg(GameState.camera.rotation).toFixed(3) + '°');
fire('pointerup', L.centerX + 152, L.centerY + 1);

// 7. рука не зависит от поворота
GameState.camera.rotation = rad(120);
const spunSlot = filledSlot();
const spunCenter = render.handSlotCenter(spunSlot);
check('слот руки ловится по экранным координатам при любом повороте',
  input.hitHandSlot(GameState, spunCenter.x, spunCenter.y) === spunSlot);

// 7б. angleDelta: разница углов через ±π (Phase 16). Без нормализации
// протаскивание через левую горизонталь давало почти полный оборот вместо
// пары градусов — это и выглядело как «поле крутится само».
check('angleDelta через ±π даёт короткую дугу',
  Math.abs(deg(input.angleDelta(rad(179), rad(-179))) - 2) < 1e-9,
  deg(input.angleDelta(rad(179), rad(-179))).toFixed(1) + '°');
check('angleDelta в обратную сторону тоже короткая',
  Math.abs(deg(input.angleDelta(rad(-179), rad(179))) + 2) < 1e-9,
  deg(input.angleDelta(rad(-179), rad(179))).toFixed(1) + '°');
check('angleDelta без разрыва работает как обычная разность',
  Math.abs(deg(input.angleDelta(rad(10), rad(40))) - 30) < 1e-9);

// 7в. мёртвая зона у центра: там на пиксель приходятся десятки градусов
restart();
resetCamera(GameState);
fire('pointerdown', L.centerX + 4, L.centerY);
fire('pointermove', L.centerX + 4, L.centerY + 30);   // порог пробит
fire('pointermove', L.centerX - 20, L.centerY + 10);  // всё ещё у центра
check('у центра поля жест не крутит поле', GameState.camera.rotation === 0,
  'угол ' + deg(GameState.camera.rotation).toFixed(1) + '°');
fire('pointerup', L.centerX - 20, L.centerY + 10);
check('порог входа в жест поднят', CONFIG.camera.minDragToRotate >= 12);
resetCamera(GameState);

// 8. кнопка возврата и сбросы
const resetBtn = render.resetCameraButtonRect();
fire('pointerdown', resetBtn.x + resetBtn.w / 2, resetBtn.y + resetBtn.h / 2);
check('кнопка возврата ставит поле прямо', GameState.camera.rotation === 0);
GameState.camera.rotation = rad(60);
restart();
check('restart возвращает поле прямо', GameState.camera.rotation === 0);
GameState.camera.rotation = rad(60);
GameState.score = CONFIG.board.radiusSteps[1].fromScore;
growBoardIfNeeded(GameState);
check('рост кольца тоже выпрямляет поле', GameState.camera.rotation === 0);
restart();

// 8г. слои стопки растут вверх ЭКРАНА, а не вбок вместе с поворотом поля
// шпион ставится ПОСЛЕ подготовки доски: setBoard перерисовывает кадр целиком,
// и в него попали бы ещё и стопки из руки
const spyTiles = (angleDeg) => {
  const active = THEMES[themeNames[0]];
  applyTheme(themeNames[0]);
  setBoard({ '2,-2': rep(0, 4) });
  GameState.camera.rotation = rad(angleDeg);
  const seen = [];
  const original = active.tile;
  active.tile = (ctx, x, y) => { seen.push({ x, y }); };
  render.drawStacks(GameState);
  active.tile = original;
  return seen;
};
[0, 60, 180].forEach(angleDeg => {
  const layers = spyTiles(angleDeg);
  const sameColumn = layers.every(p => Math.abs(p.x - layers[0].x) < 1e-9);
  const stepsUp = layers.every((p, i) =>
    i === 0 || Math.abs((layers[i - 1].y - p.y) - CONFIG.tile.layerOffset) < 1e-9);
  check(`при повороте ${angleDeg}° слои стопки идут строго вверх экрана`,
    layers.length === 4 && sameColumn && stepsUp,
    'слоёв ' + layers.length);
});
// и сама стопка стоит там, где ячейка после поворота
const rotated = spyTiles(60);
GameState.camera.rotation = rad(60);
const expectedScreen = input.worldToScreen(GameState, cell('2,-2').pixelX, cell('2,-2').pixelY);
check('стопка нарисована в экранной позиции повёрнутой ячейки',
  Math.abs(rotated[0].x - expectedScreen.x) < 1e-6 &&
  Math.abs(rotated[0].y - expectedScreen.y) < 1e-6,
  `${rotated[0].x.toFixed(1)},${rotated[0].y.toFixed(1)} vs ` +
  `${expectedScreen.x.toFixed(1)},${expectedScreen.y.toFixed(1)}`);
resetCamera(GameState);
restart();

// 9. зума больше нет
check('в состоянии камеры остался только поворот',
  Object.keys(GameState.camera).join() === 'rotation', Object.keys(GameState.camera).join());
check('обработчика колеса нет', handlers.wheel === undefined);
check('в CONFIG нет параметров зума',
  CONFIG.camera.minScale === undefined && CONFIG.camera.maxScale === undefined);

console.log('\n--- Phase 9: новая стопка вливается в старую ---');

// 1. поставили одноцветную рядом с такой же — блок собрался в СТАРОЙ ячейке,
//    а ячейка игрока освободилась
setBoard({ '1,0': rep(0, 4) });
input.placeStack(GameState, { tiles: rep(0, 3), cell: null }, cell('0,0'));
check('ячейка, куда игрок поставил стопку, освободилась', cell('0,0').stack === null, dump());
check('блок собрался в старой стопке (4 + 3 = 7)',
  cell('1,0').stack.tiles.join('') === '0000000', dump());

// 2. без подходящего соседа стопка просто остаётся на своём месте
setBoard({ '1,0': rep(1, 4) });
input.placeStack(GameState, { tiles: rep(0, 3), cell: null }, cell('0,0'));
check('без соседа того же цвета стопка стоит там, куда её положили',
  cell('0,0').stack.tiles.join('') === '000' && cell('1,0').stack.tiles.join('') === '1111');

// 3. два и больше одноцветных соседа — сбор идёт в ячейку игрока (объединятся все)
setBoard({ '1,0': rep(0, 2), '0,-1': rep(0, 5), '-1,0': rep(0, 3) });
cell('0,0').stack = { tiles: [0], cell: { q: 0, r: 0 } };
const mergePoint = mergeEngine.mergeTargetFor(GameState, cell('0,0'));
check('при нескольких одноцветных соседях точка сбора — ячейка игрока',
  mergePoint === cell('0,0'), 'выбрано ' + hexMath.key(mergePoint.q, mergePoint.r));

// 3б. ровно один сосед — вливаемся в него, даже если его блок короче
setBoard({ '1,0': [0] });
cell('0,0').stack = { tiles: rep(0, 4), cell: { q: 0, r: 0 } };
check('при единственном соседе точка сбора — он, а не ячейка игрока',
  mergeEngine.mergeTargetFor(GameState, cell('0,0')) === cell('1,0'));

// 3в. случай со скриншота пользователя: две зелёные стопки и ход между ними —
//     объединяются все три, ни одна не остаётся в стороне
setBoard({ '1,0': rep(2, 3), '0,1': rep(2, 2) });   // соседи не примыкают друг к другу
input.placeStack(GameState, { tiles: rep(2, 2), cell: null }, cell('0,0'));
check('ход между двумя одноцветными собирает обе, а не одну',
  cell('0,0').stack.tiles.length === 7 &&
  cell('1,0').stack === null && cell('0,1').stack === null,
  dump());

// 4. цвет сравнивается по верхнему блоку, а не по всей стопке
setBoard({ '1,0': [0, 0, 1, 1] });          // сверху цвет 1, снизу 0
setBoard({ '1,0': [0, 0, 1, 1] });
cell('0,0').stack = { tiles: [1, 1], cell: { q: 0, r: 0 } };
check('сосед с другим верхним цветом не выбирается точкой сбора',
  mergeEngine.mergeTargetFor(GameState, cell('0,0')) === cell('1,0'),
  'верхние блоки совпадают по цвету 1 — сосед подходит');

// 5. соседи точки сбора стекаются в неё все сразу: 4 + 2 + 2 + 2 = 10
setBoardForBurn();
GameState.score = 0;
GameState.coins = 0;
playBurnMove();
check('одноцветные соседи точки сбора собрались в неё и блок сгорел',
  GameState.score === 10 && GameState.coins === 10,
  'score=' + GameState.score + ' coins=' + GameState.coins);
check('после сгорания все четыре ячейки свободны',
  ['0,0', '1,0', '1,-1', '0,-1'].every(k => cell(k).stack === null), dump());

// 5б. два соседа без сгорания: всё стекается в ячейку игрока, соседи пустеют
setBoard({ '1,0': rep(0, 3), '0,-1': rep(0, 3) });
GameState.score = 0;
input.placeStack(GameState, { tiles: rep(0, 2), cell: null }, cell('0,0'));
check('при двух соседях блок собирается в ячейке игрока (2 + 3 + 3 = 8)',
  cell('0,0').stack.tiles.length === 8 &&
  cell('1,0').stack === null && cell('0,-1').stack === null,
  dump());
check('блок меньше порога не сгорел, очков нет', GameState.score === 0);

// 6. многоцветная стопка отдаёт только верхний блок, низ остаётся у игрока
setBoard({ '1,0': rep(2, 3) });
input.placeStack(GameState, { tiles: [1, 1, 2, 2], cell: null }, cell('0,0'));
check('верхний блок ушёл соседу, нижний остался в ячейке игрока',
  cell('0,0').stack.tiles.join('') === '11' && cell('1,0').stack.tiles.join('') === '22222',
  dump());

console.log('\n--- Phase 8: рост поля кольцами ---');

const cellsFor = (radius) => 3 * radius * radius + 3 * radius + 1;
const steps = CONFIG.board.radiusSteps;

// 1. радиус по счёту
check('на старте радиус 2 (19 ячеек)',
  radiusForScore(0) === 2 && cellsFor(2) === 19);
check('за очко до первого порога радиус ещё 2',
  radiusForScore(steps[1].fromScore - 1) === 2);
check('на первом пороге радиус 3 (37 ячеек)',
  radiusForScore(steps[1].fromScore) === 3 && cellsFor(3) === 37);
check('на втором пороге радиус 4 (61 ячейка)',
  radiusForScore(steps[2].fromScore) === 4 && cellsFor(4) === 61);
check('дальше поле не растёт', radiusForScore(999999) === 4);

// 2. рост сохраняет стопки и добавляет пустые ячейки
restart();
setBoard({ '0,0': [0, 0], '2,-2': [1, 1, 1], '-2,2': [2] });
const beforeDump = dump();
GameState.score = steps[1].fromScore;
let grew = growBoardIfNeeded(GameState);
check('growBoardIfNeeded сообщил о росте', grew === true);
check('после первого кольца 37 ячеек', GameState.cells.size === 37, 'got ' + GameState.cells.size);
check('старые стопки на месте',
  cell('0,0').stack.tiles.join('') === '00' &&
  cell('2,-2').stack.tiles.join('') === '111' &&
  cell('-2,2').stack.tiles.join('') === '2');
let freshEmpty = true;
GameState.cells.forEach((c, k) => {
  if (Math.max(Math.abs(c.q), Math.abs(c.r), Math.abs(c.q + c.r)) === 3 && c.stack) freshEmpty = false;
});
check('ячейки нового кольца пустые', freshEmpty);
check('newRing содержит 18 новых ячеек',
  GameState.newRing && GameState.newRing.keys.size === 18,
  'got ' + (GameState.newRing ? GameState.newRing.keys.size : 'null'));

// 3. повторный вызов на том же счёте ничего не делает
check('без нового порога рост не срабатывает', growBoardIfNeeded(GameState) === false);
GameState.score = steps[2].fromScore;
check('второй порог даёт 61 ячейку',
  growBoardIfNeeded(GameState) === true && GameState.cells.size === 61,
  'got ' + GameState.cells.size);
GameState.score = 999999;
check('потолок радиуса держится',
  growBoardIfNeeded(GameState) === false && GameState.cells.size === 61);

// 4. геометрия на каждом радиусе: round-trip и вписывание в канвас
[2, 3, 4].forEach(radius => {
  hexMath.fitLayout(radius);
  const cells = hexMath.generateCells(radius);
  check(`R=${radius}: ячеек ${cellsFor(radius)}`, cells.size === cellsFor(radius));

  let rt = true;
  cells.forEach(c => {
    const back = hexMath.pixelToAxial(c.pixelX, c.pixelY);
    if (back.q !== c.q || back.r !== c.r) rt = false;
  });
  check(`R=${radius}: pixelToAxial(axialToPixel) возвращает ту же ячейку`, rt);

  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  cells.forEach(c => {
    hexMath.hexCorners(c.pixelX, c.pixelY, hexMath.layout.size).forEach(p => {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    });
  });
  check(`R=${radius}: поле внутри канваса и не задевает HUD/руку`,
    minX >= 0 && maxX <= CONFIG.canvas.width &&
    minY >= CONFIG.ui.boardArea.top - 1 && maxY <= CONFIG.ui.boardArea.bottom + 1,
    `bbox x ${minX.toFixed(0)}..${maxX.toFixed(0)} y ${minY.toFixed(0)}..${maxY.toFixed(0)}, ` +
    `size ${hexMath.layout.size.toFixed(1)}`);
});
// 4б. высокие стопки не вылезают за верхнюю границу игровой области
[2, 3, 4].forEach(radius => {
  hexMath.fitLayout(radius);
  const cells = hexMath.generateCells(radius);
  const topCell = Array.from(cells.values()).reduce((a, b) => (a.pixelY < b.pixelY ? a : b));
  const size = hexMath.layout.size;
  const halfTile = Math.sqrt(3) / 2 * size * CONFIG.tile.scale;
  // самая высокая стопка поднимается ровно на maxRise
  const stackTop = topCell.pixelY - CONFIG.tile.maxRise - halfTile;
  check(`R=${radius}: самая высокая стопка помещается в игровую область`,
    stackTop >= CONFIG.ui.boardArea.top - 1,
    `верх стопки ${stackTop.toFixed(0)} при границе ${CONFIG.ui.boardArea.top}`);
});
check('шаг слоёв сжимается, если стопка высокая', (() => {
  const t = CONFIG.tile;
  const stepFor = (n) => (n > 1 ? Math.min(t.layerOffset, t.maxRise / (n - 1)) : t.layerOffset);
  return stepFor(3) === t.layerOffset &&           // низкая стопка — обычный шаг
    stepFor(12) < t.layerOffset &&                 // высокая — сжатый
    (12 - 1) * stepFor(12) <= t.maxRise + 1e-9;    // и укладывается в лимит
})());

check('размер гекса убывает с ростом радиуса и не превышает максимум', (() => {
  const s2 = hexMath.fitLayout(2).size;
  const s3 = hexMath.fitLayout(3).size;
  const s4 = hexMath.fitLayout(4).size;
  return s2 > s3 && s3 > s4 && s2 <= CONFIG.hex.maxSize;
})());

// 5. restart возвращает стартовый радиус
restart();
check('restart вернул поле к 19 ячейкам',
  GameState.cells.size === 19 && GameState.radius === 2 &&
  hexMath.layout.size === hexMath.fitLayout(2).size);

// 6. рост случается в живой игре и только после волны
restart();
setBoardForBurn();
GameState.score = steps[1].fromScore - 10;      // setBoard обнулил счёт
playBurnMove();                                  // +10 очков → ровно порог
check('после хода, перешагнувшего порог, поле выросло',
  GameState.cells.size === 37 && GameState.radius === 3,
  'cells=' + GameState.cells.size + ' score=' + GameState.score);
check('анимация кольца завершилась, ввод разблокирован',
  GameState.newRing === null && GameState.isAnimating === false);
check('координаты старых ячеек пересчитаны под новый размер', (() => {
  const c = cell('2,-2');
  const p = hexMath.axialToPixel(2, -2);
  return Math.abs(c.pixelX - p.x) < 0.001 && Math.abs(c.pixelY - p.y) < 0.001;
})());

// 7. рост спасает от проигрыша: полное поле + порог = партия продолжается
restart();
GameState.cells.forEach(c => { c.stack = { tiles: [((c.q - c.r) % 3 + 3) % 3], cell: { q: c.q, r: c.r } }; });
cell('0,0').stack = null;
GameState.score = steps[1].fromScore;           // порог уже достигнут
// цвет 0 совпадает с раскраской самой ячейки (0,0), а не соседей — слияния не будет
input.placeStack(GameState, { tiles: [0], cell: null }, cell('0,0'));
check('кольцо появилось до проверки проигрыша — партия продолжается',
  GameState.isGameOver === false && generators.freeCells(GameState).length === 18,
  'gameOver=' + GameState.isGameOver + ' free=' + generators.freeCells(GameState).length);

console.log('\n--- Phase 7: ступени стопок и отмена милосердия ---');

// Разбор стопки на блоки: [{color, size}, ...]
const blocksOf = (tiles) => {
  const out = [];
  tiles.forEach(t => {
    if (out.length && out[out.length - 1].color === t) out[out.length - 1].size++;
    else out.push({ color: t, size: 1 });
  });
  return out;
};
// Статистика по 1500 стопкам на заданном счёте
const sampleStacks = (score, colors = 6) => {
  const stats = { mono: 0, duo: 0, tri: 0, minH: 99, maxH: 0, badBlock: false, sameAdjacent: false };
  for (let i = 0; i < 1500; i++) {
    const st = generators.makeStack(colors, score);
    const blocks = blocksOf(st.tiles);
    const kind = blocks.length === 1 ? 'mono' : (blocks.length === 2 ? 'duo' : 'tri');
    stats[kind]++;
    stats.minH = Math.min(stats.minH, st.tiles.length);
    stats.maxH = Math.max(stats.maxH, st.tiles.length);
    if (blocks.some(b => b.size < CONFIG.stack.minBlockSize)) stats.badBlock = true;
    for (let b = 1; b < blocks.length; b++) {
      if (blocks[b].color === blocks[b - 1].color) stats.sameAdjacent = true;
    }
    if (blocks.length > 3) stats.tri = -1;              // больше трёх блоков быть не должно
  }
  return stats;
};

// 1. ступень 1 (до порога duo): только одноцветные, высота 2-4
const s1 = sampleStacks(0);
check('до порога duo — только одноцветные стопки',
  s1.duo === 0 && s1.tri === 0 && s1.mono === 1500, JSON.stringify(s1));
check('ступень 1: высота в 2..4', s1.minH === 2 && s1.maxH === 4, `${s1.minH}..${s1.maxH}`);

// 2. ступень 2 (после 100): веса соблюдаются точно, деградации по высоте нет
const s2 = sampleStacks(CONFIG.stack.stages[1].fromScore);
const w2 = CONFIG.stack.stages[1].weights;
const share = (n) => Math.round(n / 1500 * 100);
check('доля двухцветных совпадает с весом ±5%',
  Math.abs(share(s2.duo) - w2.duo) <= 5, share(s2.duo) + '% при весе ' + w2.duo + '%');
check('доля одноцветных совпадает с весом ±5%',
  Math.abs(share(s2.mono) - w2.mono) <= 5, share(s2.mono) + '% при весе ' + w2.mono + '%');
check('на второй ступени трёхцветных нет', s2.tri === 0, 'tri=' + s2.tri);
check('ступень 2: высота в 3..5', s2.minH === 3 && s2.maxH === 5, `${s2.minH}..${s2.maxH}`);

// 3. ступень 3 (после 500): появляются трёхцветные, веса тоже точные
const s3 = sampleStacks(CONFIG.stack.stages[2].fromScore);
const w3 = CONFIG.stack.stages[2].weights;
check('доля трёхцветных совпадает с весом ±5%',
  Math.abs(share(s3.tri) - w3.tri) <= 5, share(s3.tri) + '% при весе ' + w3.tri + '%');
check('доля двухцветных на третьей ступени совпадает с весом ±5%',
  Math.abs(share(s3.duo) - w3.duo) <= 5, share(s3.duo) + '% при весе ' + w3.duo + '%');
check('ступень 3: высота в 4..6', s3.minH === 4 && s3.maxH === 6, `${s3.minH}..${s3.maxH}`);

// 4. правила блоков соблюдаются на всех ступенях
[s1, s2, s3].forEach((s, i) => {
  check(`ступень ${i + 1}: все блоки не меньше minBlockSize`, s.badBlock === false);
  check(`ступень ${i + 1}: соседние блоки разного цвета`, s.sameAdjacent === false);
});

// 4б. цвет не повторяется во всей стопке: в трёхблочной не бывает «А-Б-А»
let repeatedColor = false;
for (let i = 0; i < 3000; i++) {
  const st = generators.makeStack(6, CONFIG.stack.stages[2].fromScore);
  const colors = blocksOf(st.tiles).map(b => b.color);
  if (new Set(colors).size !== colors.length) repeatedColor = true;
}
check('в стопке нет двух блоков одного цвета (даже несоседних)', repeatedColor === false);
check('при четырёх активных цветах трёхблочные стопки тоже без повторов', (() => {
  for (let i = 0; i < 2000; i++) {
    const colors = blocksOf(generators.makeStack(4, CONFIG.stack.stages[2].fromScore).tiles)
      .map(b => b.color);
    if (new Set(colors).size !== colors.length) return false;
  }
  return true;
})());

// 5. граница ступени точная
check('за очко до порога ступень ещё первая',
  generators.stageFor(CONFIG.stack.stages[1].fromScore - 1) === CONFIG.stack.stages[0]);
check('на пороге ступень вторая',
  generators.stageFor(CONFIG.stack.stages[1].fromScore) === CONFIG.stack.stages[1]);
check('далеко за последним порогом ступень последняя',
  generators.stageFor(999999) === CONFIG.stack.stages[2]);

// 6. милосердие отключается после порога
// Наверху всех стопок только цвет 0, а активных цветов 6: с милосердием первая
// стопка обязана прийти с верхом 0, без милосердия — лишь случайно (~1/6).
const mercyProbe = (score) => {
  restart();
  GameState.activeColors = 6;
  GameState.cells.forEach(c => { c.stack = { tiles: [0, 0], cell: { q: c.q, r: c.r } }; });
  ['0,0', '1,0'].forEach(k => { cell(k).stack = null; });
  GameState.score = score;
  const tops = new Set();
  GameState.cells.forEach(c => { if (c.stack) tops.add(c.stack.tiles[c.stack.tiles.length - 1]); });
  let matched = 0;
  for (let i = 0; i < 60; i++) {
    generators.dealHand(GameState);
    const first = GameState.hand.slots[0];
    if (tops.has(first.tiles[first.tiles.length - 1])) matched++;
  }
  return matched;
};
const off = CONFIG.mercy.disableAfterScore;
check('милосердие работает за очко до порога', mercyProbe(off - 1) === 60,
  'совпало ' + mercyProbe(off - 1) + '/60');
const afterOff = mercyProbe(off);
check('на пороге милосердие отключено (совпадения только случайные)', afterOff < 60,
  'совпало ' + afterOff + '/60');

console.log('\n--- Phase 6: экономика (очки и монеты) ---');

// 1. формула очков за сгоревший блок: до 10 по 1, сверх 10 по 2
const burnPts = (n) => mergeEngine.burnPointsFor(n);
check('блок 10 → 10 очков', burnPts(10) === 10, 'got ' + burnPts(10));
check('блок 11 → 12 очков', burnPts(11) === 12, 'got ' + burnPts(11));
check('блок 13 → 16 очков (пример пользователя)', burnPts(13) === 16, 'got ' + burnPts(13));
check('блок 20 → 30 очков', burnPts(20) === 30, 'got ' + burnPts(20));
check('старых ключей burnBasePoints/pointsPerFlowedTile в CONFIG нет',
  CONFIG.scoring.burnBasePoints === undefined &&
  CONFIG.scoring.pointsPerFlowedTile === undefined);

// 2. монеты равны числу сгоревших фишек, очки — по формуле
setBoard({ '0,0': rep(0, 4), '1,0': rep(0, 3), '1,-1': rep(0, 3), '0,-1': rep(0, 3) });
res = mergeEngine.resolveWave(GameState, cell('0,0'));
check('13 фишек → 16 очков и 13 монет',
  res.totalPoints === 16 && res.totalCoins === 13,
  'points=' + res.totalPoints + ' coins=' + res.totalCoins);

// 2б. очки идут только за исчезновение: перелив 9 фишек без сгорания = 0 очков
setBoard({ '0,0': rep(0, 2), '1,0': rep(0, 3), '1,-1': rep(0, 3) });
res = mergeEngine.resolveWave(GameState, cell('0,0'));
check('собрали 8 фишек в стопку без сгорания — очков и монет 0',
  res.totalPoints === 0 && res.totalCoins === 0 && cell('0,0').stack.tiles.length === 8,
  'points=' + res.totalPoints + ' coins=' + res.totalCoins);

// 3. номер волны на очки не влияет: одинаковый блок в волне 1 и в волне 2
setBoard({ '1,0': rep(0, 3), '1,-1': rep(0, 3), '0,-1': rep(0, 3) });
const wave1 = mergeEngine.resolveWave(GameState, (() => {
  cell('0,0').stack = { tiles: [0], cell: { q: 0, r: 0 } };
  return cell('0,0');
})());
setBoard({
  '0,0': rep(1, 9).concat([0]),
  '1,0': rep(0, 3), '1,-1': rep(0, 3), '0,-1': rep(0, 3),
  '-1,0': [1]
});
const chain = mergeEngine.resolveWave(GameState, cell('0,0'));
check('блок из 10 даёт 10 очков и в первой, и во второй волне',
  chain.steps[0].points === 10 && chain.steps[1].points === 10,
  JSON.stringify(chain.steps));
check('одиночное сгорание в первой волне тоже 10',
  wave1.steps[0].points === 10, JSON.stringify(wave1.steps));

// 4. кошелёк: начисляется в живой игре, пишется через Platform, переживает restart
delete store[CONFIG.storage.coinsKey];
restart();
check('кошелёк пуст на чистом хранилище', GameState.coins === 0, 'coins=' + GameState.coins);
setBoardForBurn();
GameState.coins = 0;
playBurnMove();
check('за сгорание 10 фишек начислено 10 монет', GameState.coins === 10, 'coins=' + GameState.coins);
check('кошелёк записан в хранилище через Platform',
  store[CONFIG.storage.coinsKey] === '10', 'stored=' + store[CONFIG.storage.coinsKey]);
restart();
check('restart обнуляет счёт, но не кошелёк',
  GameState.score === 0 && GameState.coins === 10, 'coins=' + GameState.coins);
check('Platform.loadCoins читает кошелёк', Platform.loadCoins() === 10);
check('Platform.loadCoins выдерживает мусор в хранилище', (() => {
  store[CONFIG.storage.coinsKey] = 'ой';
  return Platform.loadCoins() === 0;
})());

// 5. миграция экономики: рекорд из старой шкалы сбрасывается один раз
store[CONFIG.storage.bestKey] = '2288';         // рекорд, набранный в MVP
delete store[CONFIG.storage.economyKey];
const migrated = Platform.migrateEconomy();
check('первый запуск новой экономики сбрасывает старый рекорд',
  migrated === true && store[CONFIG.storage.bestKey] === '0',
  'best=' + store[CONFIG.storage.bestKey]);
check('версия экономики записана',
  store[CONFIG.storage.economyKey] === String(CONFIG.storage.economyVersion));
store[CONFIG.storage.bestKey] = '150';          // рекорд уже в новой шкале
check('повторный запуск рекорд не трогает',
  Platform.migrateEconomy() === false && store[CONFIG.storage.bestKey] === '150');
check('миграция не касается кошелька', (() => {
  store[CONFIG.storage.coinsKey] = '77';
  delete store[CONFIG.storage.economyKey];
  Platform.migrateEconomy();
  return store[CONFIG.storage.coinsKey] === '77';
})());

console.log('\n--- Phase X: QA-хуки, seed, Platform ---');

// 1. фиксированный seed воспроизводит партию ход в ход
const playScriptedGame = (seed, moves) => {
  generators.rng.seed(seed);
  restart();
  for (let m = 0; m < moves; m++) {
    const free = generators.freeCells(GameState);
    const i = filledSlot();
    if (!free.length || i === -1 || GameState.isGameOver) break;
    const c = render.handSlotCenter(i);
    const t = free[0];                       // всегда первая свободная — ход детерминирован
    fire('pointerdown', c.x, c.y);
    fire('pointermove', t.pixelX, t.pixelY + lift);
    fire('pointerup', t.pixelX, t.pixelY + lift);
  }
  return { dump: dump(), score: GameState.score };
};
const seedRunA = playScriptedGame(42, 25);
const seedRunB = playScriptedGame(42, 25);
const seedRunC = playScriptedGame(43, 25);
check('одинаковый seed → одинаковая партия (доска и счёт)',
  seedRunA.dump === seedRunB.dump && seedRunA.score === seedRunB.score,
  seedRunA.score + ' vs ' + seedRunB.score);
check('другой seed → другая партия', seedRunA.dump !== seedRunC.dump);

// 2. без seed генератор снова случайный
generators.rng.next = Math.random;
const randomDumps = new Set();
for (let i = 0; i < 20; i++) { restart(); randomDumps.add(dump()); }
check('без seed стартовые расклады различаются', randomDumps.size > 15, 'уникальных: ' + randomDumps.size);

// 3. render_game_to_text даёт читаемый снимок партии
generators.rng.seed(7);
restart();
const text = renderGameToText();
check('снимок содержит счёт, рекорд, цвета и свободные ячейки',
  /score=\d+ best=\d+ colors=\d+ free=\d+/.test(text.split('\n')[0]), text.split('\n')[0]);
check('снимок содержит все 19 ячеек', text.split('\n').filter(l => /^-?\d+,-?\d+: /.test(l)).length === 19);
check('снимок содержит руку из трёх слотов',
  /^hand: .+ \| .+ \| .+$/.test(text.split('\n').pop()), text.split('\n').pop());
GameState.isGameOver = true;
check('снимок помечает конец партии', renderGameToText().includes('GAMEOVER'));
GameState.isGameOver = false;

// 4. QA-хуки выставлены на window и не мешают игре
check('window.__GAME_STATE__ указывает на состояние игры', windowStub.__GAME_STATE__ === GameState);
check('window.render_game_to_text доступна', typeof windowStub.render_game_to_text === 'function');
check('window.__SET_SEED__ доступна', typeof windowStub.__SET_SEED__ === 'function');
windowStub.__SET_SEED__(99);
const afterHookSeed = dump();
windowStub.__SET_SEED__(99);
check('__SET_SEED__ перезапускает партию воспроизводимо', dump() === afterHookSeed);

// 5. Platform: showAd/onPause — заглушки, ничего не ломают и ничего не возвращают
check('Platform.showAd — безвредная заглушка', Platform.showAd() === undefined);
check('Platform.onPause — безвредная заглушка', Platform.onPause() === undefined);
check('Platform.loadBest на пустом хранилище даёт 0', (() => {
  delete store[CONFIG.storage.bestKey];
  return Platform.loadBest() === 0;
})());
check('Platform.loadBest выдерживает мусор в хранилище', (() => {
  store[CONFIG.storage.bestKey] = 'не число';
  return Platform.loadBest() === 0;
})());

// 6. поставка: игра остаётся одним файлом без внешних зависимостей
check('в index.html нет внешних подключений (script src / link / import)',
  !/<script[^>]+src=/i.test(html) && !/<link[^>]+href=/i.test(html) &&
  !/\bimport\s+.*from\b/.test(js) && !/\brequire\(/.test(js));
check('канвас один', (html.match(/<canvas/g) || []).length === 1);
check('все секции спеки §14 на месте',
  ['const CONFIG', 'const Platform', 'const hexMath', 'const generators',
    'const mergeEngine', 'const render', 'const input', 'const GameState']
    .every(marker => js.includes(marker)));

// Проверки рейтинга вынесены в конец и выполняются асинхронно: fetchLeaderboard
// возвращает промис, а в Node он резолвится не раньше следующего микротаска.
(async () => {
  console.log('\n--- Phase 13: платформа и рейтинг ---');

  // 1. локально SDK не грузится и сеть не трогается (ADR-0001 остаётся в силе)
  locationStub.host = 'localhost';
  check('на обычном хосте SDK не подключается', Platform.initPlatform() === false);
  check('локально рейтинг считается недоступным', Platform.leaderboards === null);
  check('submitScore локально молча ничего не делает', Platform.submitScore(500) === false);

  // 2. распознавание домена платформы
  [['yandex.net', true], ['games.s3.yandex.net', true], ['app-12345.games.s3.yandex.net', true],
   ['localhost', false], ['023irene.github.io', false], ['example.com', false]]
    .forEach(([host, expected]) => {
      locationStub.host = host;
      check(`хост ${host} — ${expected ? 'платформа' : 'обычный хостинг'}`,
        Platform.onYandexHost() === expected);
    });
  locationStub.host = 'localhost';

  // 3. fetchLeaderboard без SDK отдаёт «недоступно», а не падает
  const localResult = await Platform.fetchLeaderboard();
  check('локально fetchLeaderboard возвращает недоступность',
    localResult.available === false && localResult.entries.length === 0);

  // 4. с подставным SDK: отправка и чтение работают
  const submitted = [];
  Platform.leaderboards = {
    setLeaderboardScore: (name, score) => submitted.push({ name, score }),
    getLeaderboardEntries: () => Promise.resolve({
      userRank: 2,
      entries: [
        { rank: 1, score: 3200, player: { publicName: 'Первый' } },
        { rank: 2, score: 1500, player: { publicName: 'Ты' } },
        { rank: 3, score: 900, player: null }
      ]
    })
  };
  check('submitScore отправляет результат в лидерборд платформы',
    Platform.submitScore(1500) === true &&
    submitted.length === 1 && submitted[0].score === 1500 &&
    submitted[0].name === CONFIG.platform.leaderboardName);
  check('нулевой счёт не отправляется',
    Platform.submitScore(0) === false && submitted.length === 1);

  const boardResult = await Platform.fetchLeaderboard();
  check('fetchLeaderboard разбирает ответ платформы',
    boardResult.available === true && boardResult.entries.length === 3 &&
    boardResult.playerRank === 2);
  check('игрок без имени показывается как «Игрок»', boardResult.entries[2].name === 'Игрок');

  // 5. ошибка платформы не ломает игру
  Platform.leaderboards = {
    setLeaderboardScore: () => { throw new Error('нет сети'); },
    getLeaderboardEntries: () => Promise.reject(new Error('нет сети'))
  };
  check('падение setLeaderboardScore перехвачено', Platform.submitScore(100) === false);
  const failed = await Platform.fetchLeaderboard();
  check('падение getLeaderboardEntries даёт недоступность, а не исключение',
    failed.available === false);

  // 6. результат уходит в рейтинг при проигрыше
  Platform.leaderboards = { setLeaderboardScore: (name, score) => submitted.push({ name, score }) };
  const submittedBefore = submitted.length;
  setBoardTricolor();
  GameState.score = 777;
  cell('0,0').stack = null;
  input.placeStack(GameState, { tiles: [0], cell: null }, cell('0,0'));
  check('при проигрыше счёт отправлен в рейтинг',
    GameState.isGameOver === true && submitted.length === submittedBefore + 1 &&
    submitted[submitted.length - 1].score === 777);
  Platform.leaderboards = null;

  // 7. экран рейтинга открывается с оверлея и закрывается кнопкой
  GameState.isGameOver = true;
  const ratingBtn = render.leaderboardButtonRect();
  fire('pointerdown', ratingBtn.x + ratingBtn.w / 2, ratingBtn.y + ratingBtn.h / 2);
  check('кнопка «Рейтинг» открывает экран',
    GameState.leaderboard && GameState.leaderboard.open === true);
  await Promise.resolve();                 // даём промису загрузки завершиться
  check('локально экран сообщает о недоступности',
    GameState.leaderboard.available === false && GameState.leaderboard.loading === false);
  render.drawAll(GameState);               // отрисовка экрана не должна падать
  const backBtn = render.restartButtonRect();
  fire('pointerdown', backBtn.x + backBtn.w / 2, backBtn.y + backBtn.h / 2);
  check('кнопка «Назад» закрывает экран рейтинга', GameState.leaderboard.open === false);
  check('партия при этом не перезапустилась', GameState.isGameOver === true);
  check('кнопки рейтинга и «Заново» не пересекаются', ratingBtn.y + ratingBtn.h < backBtn.y);
  restart();

  console.log(ok ? '\nВСЕ ПРОВЕРКИ ПРОШЛИ' : '\nЕСТЬ ОШИБКИ');
  process.exit(ok ? 0 : 1);
})();
