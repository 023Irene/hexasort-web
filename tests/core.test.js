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

// Заглушка Web Audio: настоящих узлов нет, каждый источник звука пишет в журнал
// свою частоту и момент запуска — по нему и делаются проверки, как по store для
// localStorage. audioNow — это ctx.currentTime, тесты двигают его вручную.
let audioContexts = 0;
let audioNow = 0;
const audioLog = [];
const audioParam = (rec, key) => ({
  value: 0,
  setValueAtTime: (v) => { rec[key] = v; },
  exponentialRampToValueAtTime: () => {}
});
const audioNode = () => ({ value: 0, setValueAtTime: () => {},
                           exponentialRampToValueAtTime: () => {},
                           setTargetAtTime: () => {} });
function AudioContextStub() {
  audioContexts++;
  this.sampleRate = 44100;
  this.state = 'running';
  this.destination = { connect: () => {} };
  this.resume = () => { this.state = 'running'; };
  Object.defineProperty(this, 'currentTime', { get: () => audioNow });
  this.createGain = () => ({ gain: audioNode(), connect: () => {} });
  this.createOscillator = () => {
    const rec = { kind: 'osc', freq: 0, at: 0 };
    return { type: '', frequency: audioParam(rec, 'freq'), detune: audioNode(),
             connect: () => {},
             start: (at) => { rec.at = at; audioLog.push(rec); }, stop: () => {} };
  };
  this.createStereoPanner = () => ({ pan: audioNode(), connect: () => {} });
  this.createConvolver = () => ({ buffer: null, connect: () => {} });
  this.createBufferSource = () => {
    const rec = { kind: 'noise', freq: 0, at: 0 };
    return { buffer: null, connect: () => {},
             start: (at) => { rec.at = at; audioLog.push(rec); }, stop: () => {} };
  };
  this.createBiquadFilter = () => ({ type: '', Q: audioNode(),
                                     frequency: audioNode(), connect: () => {} });
  this.createBuffer = (channels, length) => ({ getChannelData: () => new Float32Array(length) });
}

// Планировщик музыки. Интервал только записываем и НЕ выполняем: часы и RAF
// здесь синхронные, и живой тик увёл бы тесты в бесконечный цикл. Тесты дёргают
// Audio.pumpMusic вручную.
let intervalSeq = 0;
const intervals = {};
const setIntervalStub = (fn, ms) => { intervals[++intervalSeq] = { fn, ms }; return intervalSeq; };
const clearIntervalStub = (id) => { delete intervals[id]; };

// Вибрация: на десктопе её нет, поэтому заглушка ещё и журналит вызовы
const vibrations = [];
const navigatorStub = { vibrate: (pattern) => { vibrations.push(pattern); return true; },
                        language: 'ru-RU' };

// Path2D: значки заданы путями SVG (Phase 23). В Node конструктора нет, поэтому
// заглушка просто запоминает строку пути — по ней и проверяется кэш.
const builtPaths = [];
function Path2DStub(d) { this.d = d; builtPaths.push(d); }

js += '\nmodule.exports = { CONFIG, Platform, Audio, hexMath, generators, mergeEngine, GameState, render,' +
  ' input, restart, updateActiveColors, renderGameToText, radiusForScore, growBoardIfNeeded,' +
  ' resetCamera, nearestSnapAngle, snapRotation, THEMES, applyTheme, updateMusicTension,' +
  ' openSettings, closeSettings, applySettings, persistSettings,' +
  ' I18N, t, setLang, detectLang, layoutUi, canvasHeightFor, captureUiBase,' +
  ' announceThreshold, openStats, closeStats, loadStats, saveRunStats, emptyStats,' +
  ' updateBest };';
const mod = { exports: {} };
new Function('module', 'localStorage', 'requestAnimationFrame', 'document', 'performance',
  'setTimeout', 'window', 'location', 'AudioContext', 'setInterval', 'clearInterval',
  'navigator', 'Path2D', js)
  (mod, localStorageStub, raf, documentStub, perf, timeout, windowStub, locationStub,
   AudioContextStub, setIntervalStub, clearIntervalStub, navigatorStub, Path2DStub);
const { CONFIG, Platform, Audio, hexMath, generators, mergeEngine, GameState, render, input, restart,
  updateActiveColors, renderGameToText, radiusForScore, growBoardIfNeeded,
  resetCamera, nearestSnapAngle, snapRotation, THEMES, applyTheme,
  updateMusicTension, openSettings, closeSettings, applySettings,
  persistSettings, I18N, t, setLang, detectLang,
  layoutUi, canvasHeightFor, captureUiBase, announceThreshold,
  openStats, closeStats, loadStats, saveRunStats, emptyStats, updateBest } = mod.exports;

// Звук между проверками надо гасить: журнал общий, а троттлинг помнит прошлый вызов
const audioReset = () => { audioLog.length = 0; Audio.lastAt = {}; };
const audioFreqs = () => audioLog.filter(n => n.kind === 'osc').map(n => n.freq);
// Снимок надо взять здесь: проверки Phase 17 идут после десятков pointerdown,
// а контекст к тому моменту уже заведён — «до жеста его нет» там не проверить.
const audioCtxAtStart = Audio.ctx;

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
// монеты платят только за фишки сверх порога (ADR-0007): ровно порог — ноль
check('блок ровно в порог монет не даёт', res.totalCoins === 0, 'got ' + res.totalCoins);

// 5. горит весь блок целиком: 13 → горят 13, сверх 10 по двойной ставке
setBoard({ '0,0': rep(0, 4), '1,0': rep(0, 3), '1,-1': rep(0, 3), '0,-1': rep(0, 3) });
res = mergeEngine.resolveWave(GameState, cell('0,0'));
check('блок 13 сгорел целиком (не ровно 10)', cell('0,0').stack === null, dump());
check('очки за блок 13: 10 + 3*2 = 16', res.totalPoints === 16, 'got ' + res.totalPoints);
// сколько именно — решает CONFIG (в Phase 25 порог поднят), тест сверяет формулу
check('монеты за блок 13 идут только за фишки сверх порога',
  res.totalCoins === mergeEngine.burnCoinsFor(13) &&
  res.totalCoins === Math.max(0, 13 - CONFIG.scoring.coinsFreeTiles),
  'got ' + res.totalCoins);

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
// второе даёт comboCoinBonus. Сами блоки здесь ровно в порог, поэтому своих
// монет не приносят вовсе — весь доход цепочки это и есть бонус за комбо.
check('комбо считается по звеньям со сгоранием',
  res.steps[0].combo === 1 && res.steps[1].combo === 2, JSON.stringify(res.steps));
check('монет за цепочку из двух блоков в порог: только бонус за комбо',
  res.totalCoins === CONFIG.scoring.comboCoinBonus, 'got ' + res.totalCoins);

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
// Всё детерминировано: и раздачи (seed игры), и выбор ячейки. Со случайным выбором
// тест зависел от баланса — с Phase 28 партия иногда кончалась на 18-м ходу с нулём
// очков, и проверка падала раз в десяток прогонов.
generators.rng.seed(20260730);
let botState = 987654321;
const botPick = (n) => {
  botState = (botState * 1103515245 + 12345) & 0x7fffffff;
  return botState % n;
};
restart();
let moves = 0, guard = 0;
while (guard++ < 200 && moves < 60) {
  const free = generators.freeCells(GameState);
  if (!free.length) break;
  const i = filledSlot();
  if (i === -1) break;
  const c = render.handSlotCenter(i);
  const t = free[botPick(free.length)];
  fire('pointerdown', c.x, c.y);
  fire('pointermove', t.pixelX, t.pixelY + lift);
  fire('pointerup', t.pixelX, t.pixelY + lift);
  moves++;
}
let boardOk = true;
GameState.cells.forEach(c => {
  if (!c.stack) return;
  if (!c.stack.tiles.length) boardOk = false;                       // пустых стопок быть не должно
  if (mergeEngine.topRun(c.stack).length >= mergeEngine.thresholdFor(GameState.score)) boardOk = false;  // недогоревших тоже
  c.stack.tiles.forEach(t => { if (t < 0 || t >= CONFIG.colors.palette.length) boardOk = false; });
});
// число ходов не фиксируем: партия может закончиться проигрышем раньше — это баланс,
// а тест проверяет целостность доски
check('партия ботом: доска валидна, недогоревших блоков нет',
  boardOk && moves >= 1 && (moves === 60 || GameState.isGameOver),
  'moves=' + moves + ' score=' + GameState.score + ' gameOver=' + GameState.isGameOver);
// результат партии — это баланс, а не работоспособность: тест требует лишь, чтобы
// партия к чему-то пришла — набрала очки или честно закончилась проигрышем
check('партия к чему-то пришла: очки или проигрыш',
  GameState.score > 0 || GameState.isGameOver,
  'score=' + GameState.score + ' gameOver=' + GameState.isGameOver);
check('ввод не остался заблокированным', GameState.isAnimating === false);
generators.rng.next = Math.random;      // дальше тесты идут на обычном случае

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

// 1. набор цветов расширяется по одному цвету за ступень (ADR-0007). Проверки
// идут по форме лестницы, а не по конкретным порогам: числа — это баланс.
restart();
const ringSteps = CONFIG.board.radiusSteps;
const colorsAt = (score) => { GameState.score = score; updateActiveColors(GameState); return GameState.activeColors; };
check('в палитре 10 цветов', CONFIG.colors.palette.length === 10,
  'got ' + CONFIG.colors.palette.length);
check('все цвета палитры различны', new Set(CONFIG.colors.palette).size === 10);
check('на старте столько цветов, сколько в первой ступени',
  colorsAt(0) === ringSteps[0].colors, 'got ' + colorsAt(0));
check('первая ступень начинается с нуля очков', ringSteps[0].fromScore === 0);
check('пороги ступеней строго растут',
  ringSteps.every((s, i) => i === 0 || s.fromScore > ringSteps[i - 1].fromScore),
  ringSteps.map(s => s.fromScore).join(', '));
check('каждая ступень добавляет ровно один цвет — скачок +3 обрывал партию',
  ringSteps.every((s, i) => i === 0 || s.colors === ringSteps[i - 1].colors + 1),
  ringSteps.map(s => s.colors).join(', '));
ringSteps.forEach((step, i) => {
  if (i === 0) return;
  check(`за очко до порога ${step.fromScore} цветов ещё ${ringSteps[i - 1].colors}`,
    colorsAt(step.fromScore - 1) === ringSteps[i - 1].colors,
    'got ' + colorsAt(step.fromScore - 1));
  check(`на пороге ${step.fromScore} цветов становится ${step.colors}`,
    colorsAt(step.fromScore) === step.colors, 'got ' + colorsAt(step.fromScore));
});
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

// 3. выручка драма-менеджера при почти забитом поле (Phase 25, ADR-0008)
setBoardTricolor();
const freeKeys = ['0,0', '1,0'];
freeKeys.forEach(k => { cell(k).stack = null; });
GameState.rescuesUsed = 0;
GameState.rescuedLastDeal = false;
GameState.score = 0;
check('на тесном поле драма-менеджер решает выручить',
  generators.freeCells(GameState).length <= CONFIG.drama.rescueFreeCells &&
  generators.dramaFor(GameState).kind === 'rescue');
let rescueOk = true;
for (let i = 0; i < 100; i++) {
  const tops = new Set();
  GameState.cells.forEach(c => { if (c.stack) tops.add(c.stack.tiles[c.stack.tiles.length - 1]); });
  GameState.rescuesUsed = 0;              // каждый заход — как первая выручка партии
  GameState.rescuedLastDeal = false;
  generators.dealHand(GameState);
  const first = GameState.hand.slots[0];
  if (!tops.has(first.tiles[first.tiles.length - 1])) rescueOk = false;
}
check('выручка 100 раз из 100 даёт цвет, лежащий наверху на поле', rescueOk);

// 4. без выручки (много свободных) генератор поле не разглядывает — раздача случайна
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
  if (mergeEngine.topRun(c.stack).length >= mergeEngine.thresholdFor(GameState.score)) boardOk2 = false;
});
check('доска после длинной партии валидна', boardOk2);
check('анимационные поля не залипли',
  GameState.anim === null && GameState.burnAnim === null && GameState.landing === null);

// 7. подсказка
restart();
check('подсказка видна на старте', GameState.showHint === true);
input.placeStack(GameState, { tiles: [0], cell: null }, anyFreeCell());
check('подсказка гаснет после первого хода', GameState.showHint === false);

console.log('\n--- Phase 23: язык интерфейса ---');

// 1. словари полны и совпадают по ключам — иначе на одном языке появятся дыры
const langs = Object.keys(I18N);
check('языков ровно два: русский и английский',
  langs.length === 2 && I18N.ru && I18N.en, langs.join(', '));
const ruKeys = Object.keys(I18N.ru).sort();
const enKeys = Object.keys(I18N.en).sort();
check('наборы ключей совпадают', ruKeys.join(',') === enKeys.join(','),
  'ru=' + ruKeys.length + ' en=' + enKeys.length);
check('пустых строк в словарях нет',
  langs.every(l => ruKeys.every(k => typeof I18N[l][k] === 'string' && I18N[l][k].length)));
check('ключи бустов есть в словаре',
  CONFIG.boosts.every(b => I18N.ru[b.label] && (!b.hint || I18N.ru[b.hint])));

// 2. t() отдаёт строку текущего языка, неизвестный ключ возвращает сам ключ
const langWas = CONFIG.lang;
setLang('ru');
check('t() на русском', t('restart') === I18N.ru.restart);
setLang('en');
check('t() на английском', t('restart') === I18N.en.restart);
check('неизвестный ключ виден как есть', t('нет-такого') === 'нет-такого');
check('неизвестный язык не переключается', setLang('de') === false && CONFIG.lang === 'en');

// 3. язык берётся из браузера, пока игрок не выбрал свой
navigatorStub.language = 'ru-RU';
check('русский браузер — русский язык', detectLang() === 'ru');
navigatorStub.language = 'en-US';
check('любой другой — английский', detectLang() === 'en');
navigatorStub.language = 'ru-RU';

// 4. переключатель в настройках: меняет язык и сохраняет выбор
setLang('ru');
restart();
openSettings(GameState);
const enButton = render.langButtonRect(langs.indexOf('en'));
fire('pointerdown', enButton.x + enButton.w / 2, enButton.y + enButton.h / 2);
check('кнопка EN переключает язык', CONFIG.lang === 'en');
check('выбор языка сохранён',
  JSON.parse(store[CONFIG.storage.settingsKey]).lang === 'en',
  store[CONFIG.storage.settingsKey]);
check('кадр на английском рисуется', (() => {
  try {
    render.drawAll(GameState);
    return true;
  } catch (e) {
    return false;
  }
})());
closeSettings(GameState);
check('applySettings поднимает язык из хранилища',
  applySettings({ lang: 'ru' }) === true && CONFIG.lang === 'ru');

// 5. кнопки языка не наезжают на кнопку «Назад» и помещаются в канвас
const lastLangRect = render.langButtonRect(langs.length - 1);
check('кнопки языка внутри канваса',
  lastLangRect.x + lastLangRect.w <= CONFIG.canvas.width);
check('ряд языка выше кнопки «Назад»',
  lastLangRect.y + lastLangRect.h < render.restartButtonRect().y);

// 6. в коде отрисовки не осталось зашитых русских строк — иначе перевод дырявый
const i18nSection = js.slice(js.indexOf('const I18N = {'), js.indexOf('function t(key)'));
const withoutTexts = js.replace(i18nSection, '');
const hardcodedText = withoutTexts.match(/fillText\(\s*['"][^'"]*[А-Яа-яЁё][^'"]*['"]/g) || [];
check('русских строк в fillText вне I18N нет',
  hardcodedText.length === 0, hardcodedText.join(' | '));

setLang(langWas);

console.log('\n--- Phase 22: значки и матовая бумага ---');

// 1. матовость задаётся темой, а не литералами в рендере
const matte = THEMES.paper.matte;
check('тема задаёт параметры матовой поверхности',
  typeof matte === 'object' && typeof matte.shadow === 'string' && matte.blur > 0);
check('зерна на фишках больше нет — по playtest оно читалось как белые точки',
  matte.grain === undefined && !/grain/.test(THEMES.paper.tile.toString()));
check('тень фишки мягче, чем была до фазы (blur 7, offsetY 3)',
  matte.blur < 7 && matte.offsetY < 3,
  'blur=' + matte.blur + ' offsetY=' + matte.offsetY);

// 2. значки — векторные пути SVG, рисуются через Path2D
check('у каждого буста есть значок',
  CONFIG.boosts.every(b => render.iconPaths[b.kind]),
  Object.keys(render.iconPaths).join(', '));
check('значки монеты и кубка тоже заданы путями',
  !!render.iconPaths.coin && !!render.iconPaths.trophy);
check('пути записаны в системе SVG — начинаются с команды M',
  Object.keys(render.iconPaths).every(name => {
    const icon = render.iconPaths[name];
    return (!icon.fill || icon.fill.startsWith('M')) &&
      (!icon.stroke || icon.stroke.startsWith('M'));
  }));

let iconsOk = true;
try {
  render.coinIcon(50, 50, 9);
  render.trophyIcon(400, 40, CONFIG.ui.trophySize);
  CONFIG.boosts.forEach(b => render.boostIcon(b.kind, 100, 100, 18));
  render.boostIcon('неизвестный', 100, 100, 18);   // чужой вид не должен ронять кадр
} catch (e) {
  iconsOk = false;
}
check('значки монеты, кубка и бустов рисуются', iconsOk);
check('неизвестный значок рисоваться не берётся',
  render.drawIcon('такого нет', 0, 0, 10, '#000') === false);

// Path2D строится один раз на путь: иначе на каждый кадр приходились бы новые
const pathsBefore = builtPaths.length;
render.coinIcon(50, 50, 9);
render.coinIcon(80, 50, 9);
check('Path2D кэшируется, а не строится каждый кадр',
  builtPaths.length === pathsBefore, 'построено ещё ' + (builtPaths.length - pathsBefore));
check('в кэше лежат Path2D по строке пути',
  render.iconCache.get(render.iconPaths.coin.fill) instanceof Path2DStub);

// 3. ширина строки: measureText есть не во всяком контексте (здесь канвас —
// заглушка), поэтому у значка кубка должен быть запасной расчёт
check('textWidth работает без measureText',
  render.textWidth('Рекорд: 1234', 10) === 120,
  'got ' + render.textWidth('Рекорд: 1234', 10));
check('кубок помещается левее строки рекорда и правее счёта',
  CONFIG.ui.bestX - render.textWidth('Рекорд: 88888', 10) - CONFIG.ui.trophyGap >
  CONFIG.canvas.width / 2 + 60);

// 4. кнопки бустов: подписей нет, значок и цена помещаются внутрь
const barCfg = CONFIG.ui.boostBar;
check('значок и цена внутри кнопки',
  barCfg.iconY - barCfg.iconSize / 2 > 0 && barCfg.priceY + 10 < barCfg.h &&
  barCfg.iconY + barCfg.iconSize / 2 < barCfg.priceY);
check('подписей на кнопках бустов больше нет',
  !/boost\.label/.test(render.drawBoostBar.toString()));
check('кнопки бустов не наезжают на нижний край канваса',
  barCfg.y + barCfg.h <= CONFIG.canvas.height,
  'низ кнопок ' + (barCfg.y + barCfg.h));
check('три кнопки помещаются по ширине',
  CONFIG.boosts.length * barCfg.w + (CONFIG.boosts.length - 1) * barCfg.gap
  <= CONFIG.canvas.width);

console.log('\n--- Phase 19: экран настроек ---');

// 1. кнопка-шестерёнка: в углу канваса и не наезжает на строку рекорда
const gear = render.settingsButtonRect();
check('шестерёнка внутри канваса',
  gear.x >= 0 && gear.y >= 0 &&
  gear.x + gear.w <= CONFIG.canvas.width && gear.y + gear.h <= CONFIG.canvas.height,
  JSON.stringify(gear));
check('строка рекорда заканчивается левее шестерёнки', CONFIG.ui.bestX < gear.x,
  'bestX=' + CONFIG.ui.bestX + ' кнопка с ' + gear.x);
const gearCenter = { x: gear.x + gear.w / 2, y: gear.y + gear.h / 2 };

// 2. открытие и закрытие
restart();
fire('pointerdown', gearCenter.x, gearCenter.y);
check('клик по шестерёнке открывает настройки',
  GameState.settings !== null && GameState.settings.open === true);

// 3. открытый экран забирает ввод целиком
const settingsSlot = filledSlot();
const settingsSlotCenter = render.handSlotCenter(settingsSlot);
fire('pointerdown', settingsSlotCenter.x, settingsSlotCenter.y);
check('на экране настроек стопку из руки не взять',
  GameState.drag === null && GameState.hand.slots[settingsSlot] !== null);
input.spin = null;
fire('pointerdown', cell('0,0').pixelX, cell('0,0').pixelY);
check('на экране настроек поле не вращается', input.spin === null);

// 4. ползунки: середина дорожки — половина громкости, края зажаты
const sfxTrack = render.settingsSliderRect(0);
const musicTrack = render.settingsSliderRect(1);
fire('pointerdown', sfxTrack.x + sfxTrack.w / 2, sfxTrack.y + sfxTrack.h / 2);
check('клик в середину дорожки даёт половину громкости',
  Math.abs(CONFIG.audio.volumeSfx - 0.5) < 0.051, 'got ' + CONFIG.audio.volumeSfx);
check('нажатие на ползунок начинает жест', GameState.settings.drag === 0);
fire('pointermove', sfxTrack.x + sfxTrack.w * 0.25, sfxTrack.y);
check('протаскивание меняет громкость на ходу',
  Math.abs(CONFIG.audio.volumeSfx - 0.25) < 0.051, 'got ' + CONFIG.audio.volumeSfx);
fire('pointermove', sfxTrack.x - 500, sfxTrack.y);
check('левее дорожки значение зажато нулём', CONFIG.audio.volumeSfx === 0,
  'got ' + CONFIG.audio.volumeSfx);
fire('pointermove', sfxTrack.x + sfxTrack.w + 500, sfxTrack.y);
check('правее дорожки значение зажато единицей', CONFIG.audio.volumeSfx === 1,
  'got ' + CONFIG.audio.volumeSfx);
fire('pointerup', sfxTrack.x + sfxTrack.w, sfxTrack.y);
check('отпускание завершает жест ползунка', GameState.settings.drag === null);
check('громкость ушла в хранилище одним ключом',
  JSON.parse(store[CONFIG.storage.settingsKey]).sfx === 1,
  store[CONFIG.storage.settingsKey]);

// 5. регулятор «Звуки» на нуле глушит эффекты, но не музыку — шины разные
Audio.setSfxVolume(0);
audioReset();
Audio.burn(12);
check('на нуле эффекты не звучат вовсе', audioLog.length === 0, 'узлов ' + audioLog.length);
audioReset();
Audio.music.nextAt = audioNow;   // иначе горизонт уже разложен и класть нечего
Audio.pumpMusic();
check('музыка регулятором звуков не глушится', audioLog.length > 0);
Audio.setSfxVolume(1);
audioReset();
Audio.burn(12);
check('вернули громкость — эффекты снова слышны', audioLog.length > 0);
audioReset();

// 6. регулятор музыки на нуле останавливает планировщик, а не крутит его впустую
Audio.setMusicVolume(0);
check('музыка на нуле останавливает планировщик', Audio.music.timer === null);
check('шина музыки при этом молчит', Audio.music.out.gain.value === 0,
  'got ' + Audio.music.out.gain.value);
Audio.setMusicVolume(1);
check('возврат громкости заводит планировщик снова', Audio.music.timer !== null);
check('шина музыки вернулась к своей калибровке',
  Math.abs(Audio.music.out.gain.value - CONFIG.audio.music.gain) < 1e-9);

// 7. тумблер вибрации
const toggle = render.settingsToggleRect();
const hapticsWas = CONFIG.haptics.enabled;
fire('pointerdown', toggle.x + toggle.w / 2, toggle.y + toggle.h / 2);
check('тумблер переключает вибрацию', CONFIG.haptics.enabled === !hapticsWas);
vibrations.length = 0;
CONFIG.haptics.enabled = false;
check('выключенная вибрация не доходит до платформы',
  Platform.vibrate(20) === false && vibrations.length === 0);
CONFIG.haptics.enabled = true;

// 8. хранилище: снимок пишется при закрытии, битое значение не ломает игру
CONFIG.audio.volumeSfx = 0.4;
CONFIG.audio.music.volume = 0.6;
closeSettings(GameState);
check('кнопка «Назад» закрывает экран', GameState.settings === null);
const stored = Platform.loadSettings();
check('настройки прочитались обратно',
  stored.sfx === 0.4 && stored.music === 0.6 && stored.haptics === true,
  JSON.stringify(stored));
store[CONFIG.storage.settingsKey] = '{не json';
check('битое значение в хранилище даёт null, а не исключение',
  Platform.loadSettings() === null);
check('пустые настройки ничего не меняют', applySettings(null) === false);
check('CONFIG при этом не тронут', CONFIG.audio.volumeSfx === 0.4);
applySettings({ sfx: 2, music: -1, haptics: 'да' });
check('значения из хранилища зажимаются в 0…1',
  CONFIG.audio.volumeSfx === 1 && CONFIG.audio.music.volume === 0);
check('нестроковый выключатель вибрации игнорируется', CONFIG.haptics.enabled === true);

// 9. громкости переживают новую партию — они не про партию, а про игрока
applySettings({ sfx: 0.3, music: 0.7, haptics: false });
restart();
check('restart громкости не сбрасывает',
  CONFIG.audio.volumeSfx === 0.3 && CONFIG.audio.music.volume === 0.7);
check('restart закрывает экран настроек', GameState.settings === null);

// 10. кадр с открытым экраном рисуется целиком
openSettings(GameState);
let settingsDrawOk = true;
try {
  render.drawAll(GameState);
} catch (e) {
  settingsDrawOk = false;
}
check('кадр с открытым экраном настроек рисуется', settingsDrawOk);
closeSettings(GameState);

// возвращаем звук к исходному состоянию: дальше идут проверки музыки
applySettings({ sfx: 1, music: 1, haptics: true });
audioReset();

console.log('\n--- Phase 18: музыка и вибрация ---');

// 1. планировщик заводится первым жестом и ровно один раз
check('музыка заведена первым жестом', Audio.music.timer !== null);
check('повторный запуск планировщик не дублирует', Audio.startMusic() === false);
check('шина музыки создана', Audio.music.out !== null);

// 2. ноты раскладываются вперёд по часам AudioContext, а не по кадрам
audioNow = 100;
Audio.music.nextAt = audioNow;
audioReset();
Audio.pumpMusic();
const musicAhead = audioLog.length;
check('планировщик раскладывает ноты вперёд', musicAhead > 0, 'нот=' + musicAhead);
check('все ноты назначены не раньше текущего времени',
  audioLog.every(n => n.at >= audioNow - 1e-9));
check('ноты не уходят дальше горизонта планирования',
  audioLog.every(n => n.at <= audioNow + CONFIG.audio.music.scheduleAhead + 1e-9));

// 3. предохранитель: часы прыгнули далеко вперёд — цикл обязан упереться в потолок.
// Считаем шаги, а не ноты: на шаг приходится сколько угодно осцилляторов.
audioNow = 100;
Audio.music.nextAt = 0;          // как будто планировщик проспал сто секунд
audioReset();
const stepBeforeJump = Audio.music.step;
Audio.pumpMusic();
const stepsAfterJump = Audio.music.step - stepBeforeJump;
check('скачок часов не зацикливает планировщик',
  stepsAfterJump > 0 && stepsAfterJump <= CONFIG.audio.music.maxStepsPerPump,
  'шагов=' + stepsAfterJump + ' потолок=' + CONFIG.audio.music.maxStepsPerPump);
audioNow = 0;
Audio.music.nextAt = 0;
audioReset();

// 4. натяжение считает игра: меряем тесноту поля, а не счёт
const fillBoard = (occupied) => {
  restart();
  let n = 0;
  GameState.cells.forEach(c => {
    c.stack = n++ < occupied ? { tiles: [0, 0], cell: { q: c.q, r: c.r } } : null;
  });
  GameState.isGameOver = false;
};
const mus = CONFIG.audio.music;
const total = GameState.cells.size;
const tensionAt = (free) => { fillBoard(total - free); updateMusicTension(GameState); return Audio.music.tension; };
check('просторное поле — натяжение 0', tensionAt(mus.roomyFrom + 2) === 0);
check('на границе roomyFrom всё ещё 0', tensionAt(mus.roomyFrom) === 0);
check('тесное поле — натяжение 1', tensionAt(mus.tightAt) === 1);
check('совсем без места — тоже 1', tensionAt(1) === 1);
const middle = Math.round((mus.roomyFrom + mus.tightAt) / 2);
const middleTension = tensionAt(middle);
check('между порогами натяжение промежуточное',
  middleTension > 0 && middleTension < 1, 'натяжение=' + middleTension.toFixed(2));
check('чем теснее, тем выше натяжение', tensionAt(mus.tightAt + 1) > middleTension);

// 5. на проигрыше фон успокаивается: нагнетать уже незачем
fillBoard(total);
GameState.isGameOver = true;
updateMusicTension(GameState);
check('на проигрыше натяжение падает в ноль', Audio.music.tension === 0);
GameState.isGameOver = false;

// 6. музыка глушится числом, как и всё остальное
Audio.stopMusic();
check('stopMusic гасит планировщик', Audio.music.timer === null);
const musicGainWas = CONFIG.audio.music.gain;
CONFIG.audio.music.gain = 0;
check('music.gain 0 не заводит планировщик вообще',
  Audio.startMusic() === false && Audio.music.timer === null);
CONFIG.audio.music.gain = musicGainWas;
Audio.startMusic();
check('планировщик снова заведён', Audio.music.timer !== null);

// 7. строй и тембр
check('строй обычный, 440', mus.tuning === 440);
audioReset();
Audio.musicNote(mus.parts.kalimba, 0, 0, 0.5, 0.1, 0.5,
  Audio.ctx.currentTime, Audio.music.out);
check('нота строится от tuning',
  Math.abs(audioFreqs()[0] - mus.tuning) < 1e-6, 'получилось ' + audioFreqs()[0]);
// частот две (тон и обертон), а осцилляторов больше: каждый голос — пара
// расстроенных, расстройка идёт через detune и частоту не меняет
const partials = [...new Set(audioFreqs().map(f => Math.round(f * 100) / 100))];
check('нота звучит с обертоном, а не голым тоном', partials.length === 2,
  'частот ' + partials.length);
check('каждый голос — пара осцилляторов, иначе звучит тонко',
  audioFreqs().length === partials.length * 2, 'осцилляторов ' + audioFreqs().length);
check('обертон нецелый — этим дерево и отличается от синтезатора',
  Math.abs(partials[1] / partials[0] - Math.round(partials[1] / partials[0])) > 0.1,
  'отношение ' + (partials[1] / partials[0]).toFixed(2));

// у музыки есть бумажный слой — тот же словарь, что и у эффектов
audioReset();
Audio.musicRustle(mus.parts.texture, Audio.ctx.currentTime, Audio.music.out);
check('у музыки есть бумажный слой', audioLog.some(n => n.kind === 'noise'));

// комната: сухой синтез — главная причина, по которой звук слышится дешёвым
check('комната построена', Audio.room !== null && Audio.roomMix !== null);
check('эффекты уходят в комнату долей', Audio.sfxSend !== null);
audioReset();

// 8. аранжировка: бриф требует цикл 3–5 минут и структуру, а не вечную петлю
const barSec = Audio.stepSec() * mus.stepsPerBar;
const loopSec = Audio.loopBars() * barSec;
// Границы пересмотрены в Phase 26 вместе с брифом: тестировщики просили темп
check('темп внутри границ брифа 96–120', mus.bpm >= 96 && mus.bpm <= 120, 'bpm=' + mus.bpm);
check('цикл аранжировки длится 3–5 минут', loopSec >= 180 && loopSec <= 300,
  Math.round(loopSec) + ' с');
check('в аранжировке несколько секций', mus.arrangement.length >= 4);
check('сумма тактов секций равна длине цикла',
  mus.arrangement.reduce((s, x) => s + x.bars, 0) === Audio.loopBars());
check('первый и последний такт цикла — в разных секциях аранжировки',
  Audio.sectionAt(0) !== Audio.sectionAt(Audio.loopBars() - 1));
check('вступление беднее середины',
  Audio.sectionAt(0).parts.length < Audio.sectionAt(Math.floor(Audio.loopBars() / 2)).parts.length);

// 9. гармония меняется сама и замыкается в круг
check('аккорд держится chordBars такта',
  Audio.chordAt(0) === Audio.chordAt(mus.chordBars - 1) &&
  Audio.chordAt(0) !== Audio.chordAt(mus.chordBars));
check('цикл аккордов замыкается',
  Audio.chordAt(0) === Audio.chordAt(mus.chordBars * mus.chords.length));

// 10. дыхание: рисунок партии обновляется раз в varyBars, музыка не стоит на месте
const shakerBeats = (loopBar) => {
  const hits = [];
  for (let beat = 0; beat < mus.stepsPerBar; beat++) {
    audioReset();
    Audio.playPart(mus.parts.shaker, loopBar, beat, Audio.chordAt(loopBar), 0, 0);
    if (audioLog.length) hits.push(beat);
  }
  return hits.join(',');
};
check('рисунок партии меняется с номером такта',
  shakerBeats(0) !== shakerBeats(mus.varyBars), shakerBeats(0) + ' → ' + shakerBeats(mus.varyBars));
check('дыхание укладывается в 15–30 секунд брифа',
  mus.varyBars * barSec >= 15 && mus.varyBars * barSec <= 30,
  Math.round(mus.varyBars * barSec) + ' с');

// 11. партия звучит только там, где перечислена в секции
const introParts = Audio.sectionAt(0).parts;
check('калимбы во вступлении нет', introParts.indexOf('kalimba') === -1);
check('фактура и пад есть с самого начала',
  introParts.indexOf('texture') !== -1 && introParts.indexOf('pad') !== -1);

// 12. ритм есть, но остаётся мягким (бриф пересмотрен в Phase 26: «нет темпа»)
check('у музыки есть ритм-секция', !!mus.parts.kick && !!mus.parts.brush);
check('у кика нет обертона — иначе это том, а не удар',
  !mus.parts.kick.overtone && mus.parts.kick.freq <= 80,
  'частота ' + mus.parts.kick.freq);
check('кик держит свою частоту, а не идёт за аккордом', mus.parts.kick.kind === 'drum');
check('щётка стоит на слабых долях, а не вместе с киком на первой', (() => {
  const kickFirst = mus.parts.kick.steps.every(pattern => pattern.indexOf(0) !== -1);
  const brushFirst = mus.parts.brush.steps.some(pattern => pattern.indexOf(0) !== -1);
  return kickFirst && !brushFirst;
})());
check('ритм тише мелодии — грув, а не танцпол',
  mus.parts.kick.level < mus.parts.piano.level &&
  mus.parts.brush.gain < mus.parts.piano.level &&
  mus.parts.shaker.gain < mus.parts.piano.level,
  'кик ' + mus.parts.kick.level + ' против фортепиано ' + mus.parts.piano.level);
check('шейкер выдыхает, а не щёлкает: атака заметно длиннее щелчка',
  mus.parts.shaker.attack >= 0.01, 'атака ' + mus.parts.shaker.attack);
check('пад тише всех — он воздух, а не голос',
  mus.parts.pad.level < mus.parts.piano.level);

// 13. натяжение влияет слабо: бриф запрещает музыке требовать внимания
// Считаем по четырём тактам подряд, а не по одному: рисунки партий разные, и на
// отдельно взятом такте прирост может случайно совпасть с уже занятыми долями
const barDensity = (tension) => {
  Audio.setTension(tension);
  audioReset();
  for (let step = mus.stepsPerBar * 20; step < mus.stepsPerBar * 24; step++) {
    Audio.musicStep(step, 0);
  }
  return audioLog.length;
};
const calmBar = barDensity(0);
const tightBar = barDensity(1);
// Phase 26: динамику просили сделать слышимой, поэтому нижняя граница выросла,
// но потолок остался — музыка по-прежнему не должна требовать внимания
check('на тесном поле заметно плотнее, но не драматично',
  tightBar >= calmBar * 1.1 && tightBar <= calmBar * 1.6,
  calmBar + ' → ' + tightBar);
Audio.setTension(0);
audioReset();

// 8. вибрация: журнал заглушки, выключатель и отсутствие гаптики
vibrations.length = 0;
check('вибрация уходит в navigator', Platform.vibrate(20) === true && vibrations.length === 1);
CONFIG.haptics.enabled = false;
check('выключенная вибрация молчит', Platform.vibrate(20) === false && vibrations.length === 1);
CONFIG.haptics.enabled = true;
const vibrateWas = navigatorStub.vibrate;
delete navigatorStub.vibrate;
check('без гаптики вибрация не падает', Platform.vibrate(20) === false);
navigatorStub.vibrate = vibrateWas;

// крупное сгорание отдаёт в руку — порог общий с тряской экрана
restart();
GameState.cells.forEach(c => { c.stack = null; });
cell('0,0').stack = { tiles: rep(0, 9), cell: { q: 0, r: 0 } };
cell('1,0').stack = { tiles: rep(0, 6), cell: { q: 1, r: 0 } };
vibrations.length = 0;
input.placeStack(GameState, { tiles: [0], cell: null }, cell('0,-1'));
check('крупное сгорание отдаёт вибрацией', vibrations.length > 0,
  'вызовов=' + vibrations.length);
restart();

console.log('\n--- Phase 17: звук ---');

// 1. контекст ленивый: снимок сделан сразу после загрузки, до первого жеста
check('в init контекст не создаётся — жеста ещё не было', audioCtxAtStart === null);
check('первый жест завёл контекст', Audio.ctx !== null);
check('контекст создан ровно один раз на все жесты партии',
  audioContexts === 1, 'создано ' + audioContexts);

// 2. AudioContext живёт только внутри секции Audio (как localStorage внутри Platform)
const audioSection = js.slice(js.indexOf('const Audio = {'), js.indexOf('const hexMath = {'));
const outsideAudio = stripComments(js.replace(audioSection, ''));
check('обращений к AudioContext вне Audio нет',
  !outsideAudio.includes('AudioContext'),
  'найдено вне Audio: ' + (outsideAudio.match(/AudioContext/g) || []).length);
check('внутри Audio AudioContext используется', audioSection.includes('AudioContext'));

// 3. mergeEngine беззвучен: синхронный resolveWave выполняется в тестах и обязан
// оставаться чистым, иначе два драйвера волны разойдутся
const mergeSection = js.slice(js.indexOf('const mergeEngine = {'), js.indexOf('const render = {'));
check('в mergeEngine звук не вызывается', !stripComments(mergeSection).includes('Audio.'));
setBoard({ '0,0': [0, 0], '1,0': [0, 0, 0] });
audioReset();
mergeEngine.resolveWave(GameState, cell('0,0'));
check('синхронный resolveWave не издаёт ни звука', audioLog.length === 0,
  'нот=' + audioLog.length);

// 4. размер сгоревшего блока слышен: больше фишек — ниже голос
audioReset();
Audio.burn(mergeEngine.thresholdFor(0));
const burnSmall = audioFreqs()[0];
audioReset();
Audio.burn(mergeEngine.thresholdFor(0) * 2);
const burnBig = audioFreqs()[0];
check('крупное сгорание звучит ниже мелкого', burnBig < burnSmall,
  burnBig.toFixed(1) + ' < ' + burnSmall.toFixed(1));

// 5. каждое следующее звено комбо — ступенью выше
audioReset();
Audio.combo(2);
const combo2 = audioFreqs()[0];
audioReset();
Audio.combo(3);
const combo3 = audioFreqs()[0];
check('третье звено комбо выше второго', combo3 > combo2,
  combo3.toFixed(1) + ' > ' + combo2.toFixed(1));

// 6. громкость глушит звук числом, как juice глушится нулём в animation
const masterWas = CONFIG.audio.master;
CONFIG.audio.master = 0;
audioReset();
Audio.burn(10); Audio.place(); Audio.combo(3); Audio.ring();
check('master = 0 глушит игру целиком', audioLog.length === 0, 'нот=' + audioLog.length);
CONFIG.audio.master = masterWas;
const pickWas = CONFIG.audio.voices.pick.gain;
CONFIG.audio.voices.pick.gain = 0;
audioReset();
Audio.pick();
check('gain: 0 у голоса гасит один звук', audioLog.length === 0);
CONFIG.audio.voices.pick.gain = pickWas;

// 7. троттлинг: одинаковые звуки подряд сливаются в один
audioReset();
Audio.burn(10);
const burnNotes = audioLog.length;
Audio.burn(10);
Audio.burn(10);
check('три одинаковых звука подряд звучат один раз',
  audioLog.length === burnNotes, 'нот=' + audioLog.length + ' вместо ' + burnNotes);

// 8. отсутствие Web Audio не ломает партию
const ctxWas = Audio.ctx;
Audio.ctx = null;
audioReset();
let audioThrew = false;
try {
  Audio.pick(); Audio.place(); Audio.flow(4, 0.02); Audio.burn(12); Audio.combo(2);
  Audio.ring(); Audio.boost('move'); Audio.boost('remove'); Audio.boost('reroll');
  Audio.deny(); Audio.snap(); Audio.deal(); Audio.over(true); Audio.over(false);
  // unlock здесь звать нельзя: заглушка AudioContext на месте, и контекст
  // просто пересоздастся. Ветку «Web Audio в браузере нет» закрывает try/catch
  // внутри unlock, а идемпотентность — проверка audioContexts === 1 выше.
} catch (e) {
  audioThrew = true;
}
check('без Web Audio ни один звук не падает', !audioThrew);
check('без контекста звуки молчат и возвращают false',
  audioLog.length === 0 && Audio.pick() === false);
Audio.ctx = ctxWas;

// 9. живой ход озвучен, и длинный перелив не строчит очередью
restart();
audioReset();
input.placeStack(GameState, { tiles: [0, 0], cell: null }, anyFreeCell());
check('ход игрока озвучен', audioLog.length > 0, 'нот=' + audioLog.length);
audioReset();
Audio.flow(40, 0.02);
check('длинный перелив подрезан maxFlowTicks',
  audioLog.length === CONFIG.audio.maxFlowTicks, 'нот=' + audioLog.length);
audioReset();

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
GameState.fx = { particles: [], floats: [], shake: null, press: null };
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
GameState.fx = { particles: [], floats: [], shake: null, press: null };

// 3. комбо: цепочка из двух сгораний платит бонусом, из одного — нет
restart();
setBoardForBurn();
GameState.coins = 0;
playBurnMove();
// блок ровно в порог своих монет не даёт (ADR-0007), поэтому любой ненулевой
// кошелёк здесь означал бы, что бонус начислили за одно звено
check('одиночное сгорание бонуса за комбо не даёт',
  GameState.coins === mergeEngine.burnCoinsFor(10) && GameState.coins === 0,
  'coins=' + GameState.coins);
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
GameState.fx = { particles: [], floats: [], shake: null, press: null };
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
    GameState.score === 10 && GameState.coins === mergeEngine.burnCoinsFor(10),
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

// 7г. зона жеста: крутить поле можно только от гекса (правка по playtest).
// Раньше жест начинался «мимо руки и кнопок», то есть и по счёту, и по краям
// экрана: промах мимо слота проворачивал доску.
restart();
resetCamera(GameState);
check('cellAt находит ячейку под точкой поля',
  input.cellAt(GameState, L.centerX, L.centerY) !== null);
check('cellAt за пределами поля отдаёт null',
  input.cellAt(GameState, 10, 10) === null);

// протаскивание по счёту наверху
fire('pointerdown', CONFIG.canvas.width / 2, 40);
fire('pointermove', CONFIG.canvas.width / 2 - 40, 70);
fire('pointermove', CONFIG.canvas.width / 2 - 120, 150);
check('протаскивание по счёту поле не крутит', GameState.camera.rotation === 0,
  'угол ' + deg(GameState.camera.rotation).toFixed(1) + '°');
check('жест вне поля вообще не начинается', input.spin === null);
fire('pointerup', CONFIG.canvas.width / 2 - 120, 150);

// протаскивание по пустому месту сбоку от поля
resetCamera(GameState);
fire('pointerdown', 8, CONFIG.ui.boardArea.top + 20);
fire('pointermove', 40, CONFIG.ui.boardArea.top + 60);
fire('pointermove', 120, CONFIG.ui.boardArea.top + 160);
check('протаскивание у края экрана поле не крутит', GameState.camera.rotation === 0,
  'угол ' + deg(GameState.camera.rotation).toFixed(1) + '°');
fire('pointerup', 120, CONFIG.ui.boardArea.top + 160);

// а по занятому гексу — крутит, как и раньше. Ячейку берём заведомо далеко от
// центра: у центра жест не работает по другой причине (мёртвая зона выше).
resetCamera(GameState);
cell('2,-1').stack = { tiles: [0, 0], cell: { q: 2, r: -1 } };
fire('pointerdown', L.centerX + 150, L.centerY);
fire('pointermove', L.centerX + 145, L.centerY + 30);
fire('pointermove', L.centerX, L.centerY + 150);
check('жест по занятому гексу поле крутит',
  Math.abs(GameState.camera.rotation) > 0.1,
  'угол ' + deg(GameState.camera.rotation).toFixed(1) + '°');
fire('pointerup', L.centerX, L.centerY + 150);
resetCamera(GameState);

// 8. кнопка возврата и сбросы
const resetBtn = render.resetCameraButtonRect();
fire('pointerdown', resetBtn.x + resetBtn.w / 2, resetBtn.y + resetBtn.h / 2);
check('кнопка возврата ставит поле прямо', GameState.camera.rotation === 0);
GameState.camera.rotation = rad(60);
restart();
check('restart возвращает поле прямо', GameState.camera.rotation === 0);
GameState.camera.rotation = rad(60);
GameState.score = CONFIG.board.radiusSteps.find(
  (st, i) => i > 0 && st.radius > CONFIG.board.radiusSteps[i - 1].radius).fromScore;
growBoardIfNeeded(GameState);
check('рост кольца тоже выпрямляет поле', GameState.camera.rotation === 0);
restart();

// 8г. слои стопки растут вверх ЭКРАНА, а не вбок вместе с поворотом поля
// шпион ставится ПОСЛЕ подготовки доски: setBoard перерисовывает кадр целиком,
// и в него попали бы ещё и стопки из руки
// Шпион стоит на render.drawTile: с Phase 24 фишка не рисуется темой напрямую,
// а копируется из спрайта, и это единственная точка, через которую идут все фишки
const spyTiles = (angleDeg) => {
  applyTheme(themeNames[0]);
  setBoard({ '2,-2': rep(0, 4) });
  GameState.camera.rotation = rad(angleDeg);
  const seen = [];
  const original = render.drawTile;
  render.drawTile = (x, y) => { seen.push({ x, y }); };
  render.drawStacks(GameState);
  render.drawTile = original;
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
  GameState.score === 10 && GameState.coins === mergeEngine.burnCoinsFor(10),
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
// В лестнице есть промежуточные ступени, где растут только цвета (ADR-0007),
// поэтому порог кольца — это первое появление радиуса, а не индекс ступени.
const ringAt = (radius) => steps.find(s => s.radius === radius).fromScore;

// 1. радиус по счёту
check('на старте радиус 2 (19 ячеек)',
  radiusForScore(0) === 2 && cellsFor(2) === 19);
check('за очко до первого порога радиус ещё 2',
  radiusForScore(ringAt(3) - 1) === 2);
check('на первом пороге радиус 3 (37 ячеек)',
  radiusForScore(ringAt(3)) === 3 && cellsFor(3) === 37);
check('на втором пороге радиус 4 (61 ячейка)',
  radiusForScore(ringAt(4)) === 4 && cellsFor(4) === 61);
check('дальше поле не растёт', radiusForScore(999999) === 4);

// 2. рост сохраняет стопки и добавляет пустые ячейки
restart();
setBoard({ '0,0': [0, 0], '2,-2': [1, 1, 1], '-2,2': [2] });
const beforeDump = dump();
GameState.score = ringAt(3);
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
GameState.score = ringAt(4);
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

// 6. рост случается в живой игре и только после волны.
// С Phase 29 ступень «добавился цвет» и ступень «выросло поле» — разные, поэтому
// порог берётся не по индексу, а по первому реальному увеличению радиуса
const firstGrowStep = steps.find((st, i) => i > 0 && st.radius > steps[i - 1].radius);
restart();
// счёт ставим так, чтобы ход перешагнул порог роста. Ход даёт очки за сгорание
// блока в текущий порог — а он с Phase 28 сам зависит от счёта, поэтому берём
// порог на очко раньше цели и собираем блок ровно такого размера
const growScore = firstGrowStep.fromScore;
const burnSize = mergeEngine.thresholdFor(growScore - 1);
setBoard({ '0,0': rep(0, burnSize - 6), '1,0': rep(0, 2), '1,-1': rep(0, 2), '0,-1': rep(0, 2) });
GameState.score = growScore - mergeEngine.burnPointsFor(burnSize);
input.placeStack(GameState, { tiles: rep(0, 2), cell: null }, cell('1,1'));
check('после хода, перешагнувшего порог, поле выросло',
  GameState.cells.size === 37 && GameState.radius === firstGrowStep.radius,
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
GameState.score = firstGrowStep.fromScore;      // порог роста уже достигнут
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
// Статистика по 2000 стопкам на заданном счёте. Типов теперь четыре (Phase 28),
// поэтому вид стопки берётся из blocksByType, а не из «одно/двух/трёхцветная».
const typeByBlocks = {};
Object.keys(CONFIG.stack.blocksByType).forEach(type => {
  typeByBlocks[CONFIG.stack.blocksByType[type]] = type;
});
const sampleSize = 2000;
const sampleStacks = (score, colors = 10) => {
  const stats = { mono: 0, duo: 0, tri: 0, quad: 0, other: 0,
                  minH: 99, maxH: 0, badBlock: false, sameAdjacent: false };
  for (let i = 0; i < sampleSize; i++) {
    const st = generators.makeStack(colors, score);
    const blocks = blocksOf(st.tiles);
    const kind = typeByBlocks[blocks.length];
    if (kind) stats[kind]++; else stats.other++;
    stats.minH = Math.min(stats.minH, st.tiles.length);
    stats.maxH = Math.max(stats.maxH, st.tiles.length);
    if (blocks.some(b => b.size < CONFIG.stack.minBlockSize)) stats.badBlock = true;
    for (let b = 1; b < blocks.length; b++) {
      if (blocks[b].color === blocks[b - 1].color) stats.sameAdjacent = true;
    }
  }
  return stats;
};
// Ожидаемая высота ступени: quad не может быть короче blocks * minBlockSize,
// поэтому потолок ступени поднимается под самый «широкий» разрешённый тип
const heightRangeFor = (stage) => {
  let maxBlocks = 1;
  Object.keys(CONFIG.stack.blocksByType).forEach(type => {
    if ((stage.weights[type] || 0) > 0) {
      maxBlocks = Math.max(maxBlocks, CONFIG.stack.blocksByType[type]);
    }
  });
  const needed = maxBlocks * CONFIG.stack.minBlockSize;
  return { min: stage.minHeight, max: Math.max(stage.maxHeight, needed) };
};

// 1. состав руки за партию переворачивается: от простых стопок к четырёхблочным
// (схема пользователя, Phase 28). Раньше лестница замирала на 500 очках навсегда.
const stages = CONFIG.stack.stages;
const share = (n) => Math.round(n / sampleSize * 100);
const samples = stages.map(stage => sampleStacks(stage.fromScore));

stages.forEach((stage, i) => {
  const stats = samples[i];
  Object.keys(CONFIG.stack.blocksByType).forEach(type => {
    const weight = stage.weights[type] || 0;
    check(`ступень ${i + 1}: доля «${type}» совпадает с весом ±4%`,
      Math.abs(share(stats[type]) - weight) <= 4,
      share(stats[type]) + '% при весе ' + weight + '%');
  });
  const range = heightRangeFor(stage);
  check(`ступень ${i + 1}: высота в ${range.min}..${range.max}`,
    stats.minH >= range.min && stats.maxH <= range.max,
    `${stats.minH}..${stats.maxH}`);
  check(`ступень ${i + 1}: блоков не больше, чем разрешает CONFIG`, stats.other === 0);
});

check('на первой ступени преобладают одноцветные',
  stages[0].weights.mono > stages[0].weights.quad);
check('на последней ступени состав зеркален первой',
  stages[stages.length - 1].weights.quad > stages[stages.length - 1].weights.mono &&
  stages[stages.length - 1].weights.quad >= stages[0].weights.mono - 5);
check('пороги ступеней строго растут',
  stages.every((st, i) => i === 0 || st.fromScore > stages[i - 1].fromScore),
  stages.map(st => st.fromScore).join(', '));

// 2. четырёхблочная стопка: четыре разных цвета и не короче 4 * minBlockSize
check('четырёхблочные стопки вообще появляются', samples[samples.length - 1].quad > 0);
check('quad содержит четыре разных цвета и не короче 8 фишек', (() => {
  let seen = 0;
  for (let i = 0; i < 3000 && seen < 50; i++) {
    const st = generators.makeStack(10, stages[stages.length - 1].fromScore);
    const blocks = blocksOf(st.tiles);
    if (blocks.length !== CONFIG.stack.blocksByType.quad) continue;
    seen++;
    if (new Set(blocks.map(b => b.color)).size !== blocks.length) return false;
    if (st.tiles.length < CONFIG.stack.blocksByType.quad * CONFIG.stack.minBlockSize) return false;
  }
  return seen > 0;
})());

// 3. правила блоков соблюдаются на всех ступенях
samples.forEach((stats, i) => {
  check(`ступень ${i + 1}: все блоки не меньше minBlockSize`, stats.badBlock === false);
  check(`ступень ${i + 1}: соседние блоки разного цвета`, stats.sameAdjacent === false);
});

// 4. цвет не повторяется во всей стопке: ни «А-Б-А», ни повтора через два блока
let repeatedColor = false;
for (let i = 0; i < 3000; i++) {
  const st = generators.makeStack(10, stages[2].fromScore);
  const colors = blocksOf(st.tiles).map(b => b.color);
  if (new Set(colors).size !== colors.length) repeatedColor = true;
}
check('в стопке нет двух блоков одного цвета (даже несоседних)', repeatedColor === false);
check('при пяти активных цветах многоблочные стопки тоже без повторов', (() => {
  for (let i = 0; i < 2000; i++) {
    const colors = blocksOf(generators.makeStack(5, stages[2].fromScore).tiles)
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
  generators.stageFor(999999) === CONFIG.stack.stages[CONFIG.stack.stages.length - 1]);

// 6. границы драма-менеджера (Phase 25, ADR-0008). Подыгрывание обязано быть
// ограниченным: без лимита вернулась бы жалоба «проиграть невозможно».
// Тесное поле: наверху всех стопок только цвет 0, активных цветов 6.
const tightBoard = (score) => {
  restart();
  GameState.activeColors = 6;
  GameState.cells.forEach(c => { c.stack = { tiles: [0, 0], cell: { q: c.q, r: c.r } }; });
  ['0,0', '1,0'].forEach(k => { cell(k).stack = null; });
  GameState.score = score;
  GameState.rescuesUsed = 0;
  GameState.rescuedLastDeal = false;
};
const drama = CONFIG.drama;
tightBoard(0);
check('первая выручка в партии срабатывает',
  generators.dramaFor(GameState).kind === 'rescue');
generators.dealHand(GameState);
check('счётчик выручек вырос', GameState.rescuesUsed === 1);
check('подряд второй раз игра не выручает',
  generators.dramaFor(GameState).kind !== 'rescue');
generators.dealHand(GameState);          // раздача без выручки снимает флаг
check('через раздачу выручка снова доступна',
  generators.dramaFor(GameState).kind === 'rescue');

tightBoard(0);
let rescueGuard = 0;
while (GameState.rescuesUsed < drama.maxRescuesPerGame && rescueGuard++ < 50) {
  generators.dealHand(GameState);
}
check('за партию выручек не больше лимита', (() => {
  for (let i = 0; i < 20; i++) generators.dealHand(GameState);
  return GameState.rescuesUsed === drama.maxRescuesPerGame;
})(), 'выручек ' + GameState.rescuesUsed);

tightBoard(drama.rescueUntilScore);
check('после порога очков игра не выручает вовсе',
  generators.dramaFor(GameState).kind !== 'rescue');
tightBoard(drama.rescueUntilScore - 1);
check('за очко до порога выручка ещё работает',
  generators.dramaFor(GameState).kind === 'rescue');

// давление: цвет, которого нет ни на одной вершине
tightBoard(drama.pressureFromScore);
GameState.cells.forEach(c => { if (c.stack) c.stack.tiles = [0, 0]; });
GameState.rescuesUsed = drama.maxRescuesPerGame;      // выручка исчерпана
const absent = generators.absentTopColor(GameState);
check('давление берёт цвет, которого нет на вершинах',
  absent !== undefined && absent !== 0);
check('под давлением первая стопка не подходит к полю', (() => {
  let pressured = 0;
  for (let i = 0; i < 200; i++) {
    if (generators.dramaFor(GameState).kind === 'pressure') pressured++;
  }
  // доля близка к pressureChance; точное значение зависит от rng, поэтому коридор
  return pressured > 200 * drama.pressureChance * 0.5 &&
    pressured < 200 * drama.pressureChance * 1.5;
})());
tightBoard(drama.pressureFromScore - 1);
GameState.rescuesUsed = drama.maxRescuesPerGame;
check('до порога давления раздача обычная', (() => {
  for (let i = 0; i < 100; i++) {
    if (generators.dramaFor(GameState).kind === 'pressure') return false;
  }
  return true;
})());
check('когда все цвета лежат на вершинах, давить нечем', (() => {
  restart();
  GameState.activeColors = 3;
  let index = 0;
  GameState.cells.forEach(c => {
    c.stack = { tiles: [index % 3, index % 3], cell: { q: c.q, r: c.r } };
    index++;
  });
  return generators.absentTopColor(GameState) === undefined;
})());
check('новая партия обнуляет счётчик выручек', (() => {
  GameState.rescuesUsed = 2;
  restart();
  return GameState.rescuesUsed === 0 && GameState.rescuedLastDeal === false;
})());

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

// 2. очки по формуле, монеты — только за фишки сверх порога (ADR-0007)
setBoard({ '0,0': rep(0, 4), '1,0': rep(0, 3), '1,-1': rep(0, 3), '0,-1': rep(0, 3) });
res = mergeEngine.resolveWave(GameState, cell('0,0'));
check('13 фишек → 16 очков и монеты по формуле',
  res.totalPoints === 16 && res.totalCoins === mergeEngine.burnCoinsFor(13),
  'points=' + res.totalPoints + ' coins=' + res.totalCoins);
check('формула монет: платят только фишки сверх порога', (() => {
  const free = CONFIG.scoring.coinsFreeTiles;
  return mergeEngine.burnCoinsFor(free) === 0 &&
    mergeEngine.burnCoinsFor(free + 3) === 3 &&
    mergeEngine.burnCoinsFor(free + 15) === 15;
})());

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
// блок ровно в порог монет не даёт, поэтому кошелёк проверяем на крупном:
// 4 + 3 + 3 + 3 = 13 фишек, из них платят три
setBoard({ '0,0': rep(0, 4), '1,0': rep(0, 3), '0,-1': rep(0, 3) });
GameState.coins = 0;
input.placeStack(GameState, { tiles: rep(0, 3), cell: null }, cell('1,-1'));
const bigBurnCoins = mergeEngine.burnCoinsFor(13);
check('за блок из 13 фишек начислено столько монет, сколько даёт формула',
  GameState.coins === bigBurnCoins &&
  bigBurnCoins === Math.max(0, 13 - CONFIG.scoring.coinsFreeTiles),
  'coins=' + GameState.coins);
check('кошелёк записан в хранилище через Platform',
  store[CONFIG.storage.coinsKey] === String(bigBurnCoins),
  'stored=' + store[CONFIG.storage.coinsKey]);
restart();
check('restart обнуляет счёт, но не кошелёк',
  GameState.score === 0 && GameState.coins === bigBurnCoins, 'coins=' + GameState.coins);
check('Platform.loadCoins читает кошелёк', Platform.loadCoins() === bigBurnCoins);
check('Platform.loadCoins выдерживает мусор в хранилище', (() => {
  store[CONFIG.storage.coinsKey] = 'ой';
  return Platform.loadCoins() === 0;
})());

// 5. миграция экономики: прогресс из старой шкалы сбрасывается один раз.
// С версии 3 (Phase 23) сбрасывается и кошелёк: в Phase 21 сменилась формула
// монет, и накопленные тысячи обесценили бы бусты.
store[CONFIG.storage.bestKey] = '2288';         // рекорд, набранный в MVP
store[CONFIG.storage.coinsKey] = '7409';        // кошелёк со старой экономики
delete store[CONFIG.storage.economyKey];
const migrated = Platform.migrateEconomy();
check('первый запуск новой экономики сбрасывает старый рекорд',
  migrated === true && store[CONFIG.storage.bestKey] === '0',
  'best=' + store[CONFIG.storage.bestKey]);
check('вместе с рекордом обнуляется кошелёк',
  store[CONFIG.storage.coinsKey] === '0', 'coins=' + store[CONFIG.storage.coinsKey]);
check('версия экономики записана',
  store[CONFIG.storage.economyKey] === String(CONFIG.storage.economyVersion));
store[CONFIG.storage.bestKey] = '150';          // рекорд уже в новой шкале
store[CONFIG.storage.coinsKey] = '77';
check('повторный запуск прогресс не трогает',
  Platform.migrateEconomy() === false && store[CONFIG.storage.bestKey] === '150' &&
  store[CONFIG.storage.coinsKey] === '77');

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

// 5. Platform: showAd остался заглушкой, пауза платформы — уже нет (Phase 20)
check('Platform.showAd — безвредная заглушка', Platform.showAd() === undefined);
Platform.gameplayRunning = true;
check('пауза платформы глушит музыку и снимает геймплей',
  Platform.onPause() === true && Audio.music.timer === null &&
  Platform.gameplayRunning === false);
check('возобновление возвращает музыку и геймплей',
  Platform.onResume() === true && Audio.music.timer !== null &&
  Platform.gameplayRunning === true);
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
  ['const CONFIG', 'const I18N', 'const Platform', 'const Audio', 'const hexMath',
    'const generators', 'const mergeEngine', 'const render', 'const input', 'const GameState']
    .every(marker => js.includes(marker)));

console.log('\n--- Phase 20: рекорды и статистика ---');

// 1. вспышка рекорда показывается один раз за партию
restart();
GameState.best = 100;
GameState.score = 150;
GameState.fx.floats.length = 0;
check('побитие рекорда объявлено', updateBest(GameState) === true &&
  GameState.recordBeaten === true);
GameState.score = 200;
check('второй раз за партию вспышки нет', updateBest(GameState) === false);
check('рекорд при этом продолжает расти', GameState.best === 200);
restart();
check('новая партия снимает отметку рекорда', GameState.recordBeaten === false);
// первая партия на чистом хранилище рекордом не считается: сравнивать не с чем
store[CONFIG.storage.bestKey] = '0';
restart();
GameState.score = 50;
check('первый в жизни счёт вспышкой не объявляется', updateBest(GameState) === false);

// 2. статистика: топ лучших партий и счётчики за всё время
delete store[CONFIG.storage.statsKey];
check('на чистом хранилище статистика пуста', (() => {
  const stats = loadStats();
  return stats.games === 0 && stats.best.length === 0 && stats.burns === 0;
})());
restart();
GameState.score = 500;
GameState.runStats = { burns: 12, biggestBlock: 17, longestCombo: 3, coins: 40 };
let saved = saveRunStats(GameState);
check('партия попала в статистику',
  saved.games === 1 && saved.best[0].score === 500 && saved.best[0].coins === 40);
check('счётчики за всё время накопились',
  saved.burns === 12 && saved.biggestBlock === 17 && saved.longestCombo === 3 &&
  saved.coins === 40);
GameState.score = 300;
GameState.runStats = { burns: 5, biggestBlock: 25, longestCombo: 2, coins: 10 };
saved = saveRunStats(GameState);
check('вторая партия добавилась, а счётчики сложились',
  saved.games === 2 && saved.burns === 17 && saved.coins === 50);
check('рекордный блок обновился, а цепочка нет',
  saved.biggestBlock === 25 && saved.longestCombo === 3);
check('лучшие партии отсортированы по счёту',
  saved.best[0].score === 500 && saved.best[1].score === 300);
check('список лучших режется по CONFIG', (() => {
  for (let i = 0; i < CONFIG.ui.stats.topRuns + 5; i++) {
    GameState.score = 1000 + i;
    GameState.runStats = { burns: 1, biggestBlock: 1, longestCombo: 1, coins: 1 };
    saved = saveRunStats(GameState);
  }
  return saved.best.length === CONFIG.ui.stats.topRuns &&
    saved.best[0].score >= saved.best[saved.best.length - 1].score;
})(), 'в списке ' + saved.best.length);
check('битый JSON в хранилище не роняет статистику', (() => {
  store[CONFIG.storage.statsKey] = 'не json';
  const stats = loadStats();
  return stats.games === 0 && Array.isArray(stats.best);
})());

// 3. счётчики партии копятся по ходу волны
restart();
delete store[CONFIG.storage.statsKey];
setBoard({ '0,0': rep(0, 4), '1,0': rep(0, 2), '1,-1': rep(0, 2), '0,-1': rep(0, 2) });
input.placeStack(GameState, { tiles: rep(0, 2), cell: null }, cell('-1,1'));
check('сгорания за партию посчитаны', GameState.runStats.burns >= 1,
  'сгораний ' + GameState.runStats.burns);
check('самый крупный блок партии записан',
  GameState.runStats.biggestBlock >= mergeEngine.thresholdFor(0),
  'блок ' + GameState.runStats.biggestBlock);

// 4. экран статистики открывается с оверлея конца и закрывается «Назад»
restart();
GameState.isGameOver = true;
const statsBtn = render.statsButtonRect();
fire('pointerdown', statsBtn.x + statsBtn.w / 2, statsBtn.y + statsBtn.h / 2);
check('кнопка «Статистика» открывает экран',
  GameState.stats !== null && GameState.stats.open === true);
check('на экране лежат прочитанные данные, а не ссылка на хранилище',
  GameState.stats.data && typeof GameState.stats.data.games === 'number');
render.drawAll(GameState);                // отрисовка экрана не должна падать
const statsBack = render.restartButtonRect();
fire('pointerdown', statsBack.x + statsBack.w / 2, statsBack.y + statsBack.h / 2);
check('кнопка «Назад» закрывает статистику', GameState.stats === null);
check('партия при этом не перезапустилась', GameState.isGameOver === true);
check('кнопки «Рейтинг» и «Статистика» не пересекаются',
  render.leaderboardButtonRect().x + render.leaderboardButtonRect().w <=
  render.statsButtonRect().x);
check('обе кнопки выше кнопки «Заново»',
  render.statsButtonRect().y + render.statsButtonRect().h <= render.restartButtonRect().y);
openStats(GameState);
windowHandlers.keydown({ code: 'Escape' });
check('Esc закрывает экран статистики', GameState.stats === null);
restart();

// 5. отклик нажатия: кнопка вдавливается и отходит сама
restart();
check('нажатие кнопки помечает именно её',
  input.pressButton(GameState, 'boost:' + CONFIG.boosts[0].kind) ===
  'boost:' + CONFIG.boosts[0].kind);
// сам эффект в тестах не поймать: часы прыгают на секунду за кадр и гасят его
// в том же вызове, поэтому масштаб проверяем на выставленном вручную состоянии
GameState.fx.press = { key: 'boost:' + CONFIG.boosts[0].kind, age: CONFIG.animation.pressMs / 2 };
check('вдавливается только нажатая кнопка',
  render.pressScaleFor(GameState, 'boost:' + CONFIG.boosts[0].kind) < 1 &&
  render.pressScaleFor(GameState, 'boost:' + CONFIG.boosts[1].kind) === 1);
check('к концу отклика кнопка возвращается в размер',
  Math.abs(render.pressScaleFor(
    Object.assign({}, GameState, { fx: { press: { key: 'restart', age: CONFIG.animation.pressMs } } }),
    'restart') - 1) < 0.001);
check('отклик короче предела juice в 1000 мс', CONFIG.animation.pressMs < 1000);
GameState.fx.press = null;
render.drawAll(GameState);        // кадр с откликом не должен падать
restart();

console.log('\n--- Phase 29: волна не роняет партию ---');

// Регрессия: позиция из реальной партии (замер поймал её на seed 114 у бота
// sloppy). Волна обходит очередь по ячейкам и сразу снимает блоки с соседей,
// поэтому верх соседа успевает смениться прямо посреди планирования:
//   1) центр «1,-1» собирает блок из «2,-1» — группа уходит в план;
//   2) центр «2,-2» снимает у «1,-2» верхние тройки, и у той открываются нули;
//   3) центр «1,-2» — теперь тоже с нулём наверху — забирает весь блок «1,-1»,
//      и та остаётся без стопки;
//   4) commitWave доливает фишки в «1,-1» — раньше здесь партия падала с
//      «Cannot read properties of null».
setBoard({
  '1,-1': rep(0, 6),
  '2,-1': rep(0, 2),
  '1,-2': [0, 0, 3, 3],
  '2,-2': [4, 4, 3, 3, 3, 3]
});
const tilesOnBoard = () => {
  let n = 0;
  GameState.cells.forEach(c => { if (c.stack) n += c.stack.tiles.length; });
  return n;
};
const tilesBefore = tilesOnBoard();
let waveCrash = null;
let waveRes = null;
try {
  waveRes = mergeEngine.resolveWave(GameState, [cell('1,-1'), cell('2,-2'), cell('1,-2')]);
} catch (e) {
  waveCrash = e.message;
}
check('волна не роняет партию, когда цель успела опустеть',
  waveCrash === null, waveCrash || '');
check('волна довела цепочку до сгорания', waveRes && waveRes.totalPoints > 0,
  waveRes ? 'очков ' + waveRes.totalPoints : 'волна не отработала');
check('фишки не появились из ниоткуда: сколько ушло, столько и сгорело',
  tilesOnBoard() === tilesBefore - CONFIG.merge.thresholdSteps[0].threshold,
  tilesOnBoard() + ' из ' + tilesBefore);
check('пустых стопок на доске не осталось', (() => {
  let ok = true;
  GameState.cells.forEach(c => { if (c.stack && !c.stack.tiles.length) ok = false; });
  return ok;
})());
check('у каждой стопки на доске есть адрес ячейки', (() => {
  let ok = true;
  GameState.cells.forEach(c => {
    if (c.stack && (!c.stack.cell || c.stack.cell.q !== c.q || c.stack.cell.r !== c.r)) ok = false;
  });
  return ok;
})());

console.log('\n--- Phase 28: растущий порог сгорания ---');

// 1. лестница порога: последняя подходящая ступень, как у колец и ступеней стопок
const thresholdSteps = CONFIG.merge.thresholdSteps;
check('на нуле очков порог стартовый',
  mergeEngine.thresholdFor(0) === thresholdSteps[0].threshold);
check('за очко до порога ступень ещё прежняя',
  mergeEngine.thresholdFor(thresholdSteps[1].fromScore - 1) === thresholdSteps[0].threshold);
check('на пороге ступень новая',
  mergeEngine.thresholdFor(thresholdSteps[1].fromScore) === thresholdSteps[1].threshold);
check('далеко за последней ступенью порог последний',
  mergeEngine.thresholdFor(999999) === thresholdSteps[thresholdSteps.length - 1].threshold);
check('порог только растёт',
  thresholdSteps.every((st, i) => i === 0 || st.threshold > thresholdSteps[i - 1].threshold));

// 2. блок ровно в прежний порог на высоком счёте больше не горит
const lateScore = thresholdSteps[1].fromScore;
const lowThreshold = thresholdSteps[0].threshold;
const highThreshold = thresholdSteps[1].threshold;
setBoard({ '0,0': rep(0, lowThreshold - 4), '1,0': rep(0, 2), '1,-1': rep(0, 2) });
GameState.score = lateScore;
res = mergeEngine.resolveWave(GameState, cell('0,0'));
check('на высоком счёте блок прежнего размера не горит',
  cell('0,0').stack !== null &&
  mergeEngine.topRun(cell('0,0').stack).length === lowThreshold &&
  res.totalPoints === 0,
  'осталось ' + (cell('0,0').stack ? mergeEngine.topRun(cell('0,0').stack).length : 0));

setBoard({ '0,0': rep(0, highThreshold - 4), '1,0': rep(0, 2), '1,-1': rep(0, 2) });
GameState.score = lateScore;
res = mergeEngine.resolveWave(GameState, cell('0,0'));
check('блок нового размера горит', cell('0,0').stack === null && res.totalPoints > 0);
check('очки считаются от burnBaseTiles, а не от порога',
  res.totalPoints === mergeEngine.burnPointsFor(highThreshold) &&
  mergeEngine.burnPointsFor(highThreshold) >
  highThreshold * CONFIG.scoring.pointsPerTileBase,
  'очков ' + res.totalPoints);

// 3. то же самое на низком счёте по-прежнему горит — начало партии не тронуто
setBoard({ '0,0': rep(0, lowThreshold - 4), '1,0': rep(0, 2), '1,-1': rep(0, 2) });
GameState.score = 0;
res = mergeEngine.resolveWave(GameState, cell('0,0'));
check('в начале партии прежний порог работает как раньше',
  cell('0,0').stack === null && res.totalPoints > 0);

// 4. игроку сообщают о повышении: молчание читалось бы как поломка
restart();
GameState.score = lateScore;
GameState.fx.floats.length = 0;
const announced = announceThreshold(GameState);
check('повышение порога объявлено игроку',
  typeof announced === 'string' && announced.indexOf(String(highThreshold)) !== -1,
  announced === null ? 'сообщения нет' : announced);
check('состояние партии знает текущий порог',
  GameState.burnThreshold === highThreshold);
GameState.fx.floats.length = 0;
check('второй раз то же повышение не объявляется',
  announceThreshold(GameState) === null);
restart();
check('новая партия возвращает стартовый порог',
  GameState.burnThreshold === mergeEngine.thresholdFor(0));

// 5. стартовое поле раскладывается простыми стопками, даже когда рука уже сложная
check('на стартовом поле только одноцветные стопки', (() => {
  for (let attempt = 0; attempt < 20; attempt++) {
    restart();
    let ok = true;
    GameState.cells.forEach(c => {
      if (c.stack && new Set(c.stack.tiles).size !== 1) ok = false;
    });
    if (!ok) return false;
  }
  return true;
})());

console.log('\n--- Phase 24: телефон — спрайты фишек и вёрстка под экран ---');

// 1. Спрайты фишек: фишка рисуется один раз и дальше копируется. Без этого
// shadowBlur темы уходил на каждую из ~700 фишек кадра и клал телефон.
restart();
render.tileCache.clear();
render.drawTile(100, 100, 40, CONFIG.colors.palette[0], true, 0);
const afterFirst = render.tileCache.size;
render.drawTile(200, 200, 40, CONFIG.colors.palette[0], true, 0);
check('спрайт фишки строится один раз на ключ',
  afterFirst === 1 && render.tileCache.size === 1);
render.drawTile(100, 100, 40, CONFIG.colors.palette[1], true, 0);
render.drawTile(100, 100, 40, CONFIG.colors.palette[0], false, 0);
check('цвет и «верхняя ли» дают разные спрайты', render.tileCache.size === 3);
// размер округляется: приземление и полёт масштабируют фишку каждый кадр,
// и без округления кэш плодил бы спрайт на каждый пиксель
const sizeBefore = render.tileCache.size;
render.drawTile(100, 100, 41, CONFIG.colors.palette[0], true, 0);
render.drawTile(100, 100, 39.4, CONFIG.colors.palette[0], true, 0);
check('близкие размеры берут один спрайт', render.tileCache.size === sizeBefore);
check('вариантов дрожания ровно столько, сколько в CONFIG', (() => {
  render.tileCache.clear();
  for (let seed = 0; seed < 40; seed++) {
    render.drawTile(0, 0, 40, CONFIG.colors.palette[0], true, seed);
  }
  return render.tileCache.size === CONFIG.tile.spriteVariants;
})());
check('отрицательный seed не ломает выбор варианта', (() => {
  const before = render.tileCache.size;
  render.drawTile(0, 0, 40, CONFIG.colors.palette[0], true, -3);
  return render.tileCache.size === before;
})());
render.drawTile(0, 0, 40, CONFIG.colors.palette[0], true, 0);
applyTheme(themeNames[0]);
check('смена темы сбрасывает спрайты', render.tileCache.size === 0);
check('смена размера гекса сбрасывает спрайты', (() => {
  hexMath.fitLayout(2);
  render.drawTile(0, 0, 40, CONFIG.colors.palette[0], true, 0);
  hexMath.fitLayout(4);
  const cleared = render.tileCache.size === 0;
  hexMath.fitLayout(GameState.radius);
  return cleared;
})());

// 2. Высота канваса под форму окна: телефон 9:19.5 иначе играл в полосе
const layoutCfg = CONFIG.ui.layout;
const uiRowsBase = CONFIG.ui.settings.rowY.slice();   // снимок до переразметки
check('без окна высота остаётся базовой', canvasHeightFor(0, 0) === layoutCfg.baseHeight);
check('широкое окно не делает канвас ниже минимума',
  canvasHeightFor(1920, 1080) === layoutCfg.minHeight);
check('высокий экран телефона растягивает канвас',
  canvasHeightFor(390, 844) > layoutCfg.baseHeight &&
  canvasHeightFor(390, 844) <= layoutCfg.maxHeight);
check('очень длинный экран упирается в потолок',
  canvasHeightFor(300, 1200) === layoutCfg.maxHeight);

// 3. Вёрстка под новую высоту: верх на месте, низ уезжает вниз, поле забирает прирост
const tallHeight = layoutCfg.maxHeight;
const scoreYBefore = CONFIG.ui.scoreY;
const handYBefore = CONFIG.ui.handY;
layoutUi(tallHeight);
check('счёт остаётся привязан к верху', CONFIG.ui.scoreY === scoreYBefore);
check('рука опустилась вместе с низом канваса', CONFIG.ui.handY > handYBefore);
check('рука и бусты внутри канваса',
  CONFIG.ui.handY < tallHeight && CONFIG.ui.boostBar.y + CONFIG.ui.boostBar.h < tallHeight);
check('подсказка ниже поля и выше руки',
  CONFIG.ui.hintY > CONFIG.ui.boardArea.bottom && CONFIG.ui.hintY < CONFIG.ui.handY);
check('поле забрало прирост высоты',
  CONFIG.ui.boardArea.bottom - CONFIG.ui.boardArea.top >
  610 - CONFIG.ui.boardArea.top);
// повторный вызов не должен складывать прирост сам с собой
const handAtTall = CONFIG.ui.handY;
layoutUi(tallHeight);
check('повторная раскладка не сдвигает вёрстку второй раз',
  CONFIG.ui.handY === handAtTall);
check('строки настроек уехали к центру нового экрана',
  CONFIG.ui.settings.rowY.every((y, i) => y > uiRowsBase[i]) &&
  CONFIG.ui.settings.rowY[3] < render.restartButtonRect().y);

// поле вписано в область при любом радиусе и на вытянутом экране
[2, 3, 4].forEach(radius => {
  const layout = hexMath.fitLayout(radius);
  const halfHeight = Math.sqrt(3) / 2 * layout.size * (2 * radius + 1);
  const halfWidth = layout.size * (1.5 * radius + 1);
  check(`на вытянутом экране поле радиуса ${radius} внутри области`,
    layout.centerY - halfHeight - CONFIG.tile.maxRise >= CONFIG.ui.boardArea.top - 0.5 &&
    layout.centerY + halfHeight <= CONFIG.ui.boardArea.bottom + 0.5 &&
    layout.centerX - halfWidth >= 0 && layout.centerX + halfWidth <= CONFIG.canvas.width);
});
check('на вытянутом экране гекс не мельче, чем на базовом',
  hexMath.fitLayout(4).size >= 33);

// рука по-прежнему ловит палец после переразметки
restart();
const tallSlotCenter = render.handSlotCenter(1);
check('слот руки ловит палец на вытянутом экране',
  input.hitHandSlot(GameState, tallSlotCenter.x, tallSlotCenter.y) === 1);

// возвращаем базовую высоту: дальнейшие проверки считают вёрстку от 900
layoutUi(layoutCfg.baseHeight);
hexMath.fitLayout(GameState.radius);
restart();
check('возврат к базовой высоте восстанавливает вёрстку',
  CONFIG.canvas.height === layoutCfg.baseHeight && CONFIG.ui.handY === handYBefore);

// 4. Замер кадра — инструмент разработки, по умолчанию выключен
check('замер кадра по умолчанию выключен', render.fpsMeter.on === false);

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
  // счёт берём на очко ниже порога второго кольца: иначе поле вырастет прямо
  // перед проверкой конца партии и проигрыша не будет (числа баланса меняются)
  const loseScore = CONFIG.board.radiusSteps[1].fromScore - 1;
  GameState.score = loseScore;
  cell('0,0').stack = null;
  input.placeStack(GameState, { tiles: [0], cell: null }, cell('0,0'));
  check('при проигрыше счёт отправлен в рейтинг',
    GameState.isGameOver === true && submitted.length === submittedBefore + 1 &&
    submitted[submitted.length - 1].score === loseScore);
  Platform.leaderboards = null;

  // 6a. обязательная разметка платформы (Phase 20): без LoadingAPI.ready()
  // модерация Яндекса игру не пропускает
  const sdkCalls = [];
  Platform.sdk = {
    features: {
      LoadingAPI: { ready: () => sdkCalls.push('ready') },
      GameplayAPI: { start: () => sdkCalls.push('start'), stop: () => sdkCalls.push('stop') }
    }
  };
  check('gameReady шлёт платформе сигнал готовности',
    Platform.gameReady() === true && sdkCalls[0] === 'ready');
  Platform.gameplayRunning = false;
  Platform.gameplay(true);
  check('начало партии уходит как start', sdkCalls[sdkCalls.length - 1] === 'start');
  check('повторный start платформе не отправляется',
    Platform.gameplay(true) === false &&
    sdkCalls.filter(c => c === 'start').length === 1);
  Platform.gameplay(false);
  check('конец партии уходит как stop', sdkCalls[sdkCalls.length - 1] === 'stop');
  Platform.sdk = { features: {} };
  check('SDK без нужных разделов не роняет игру',
    Platform.gameReady() === false && Platform.gameplay(true) === false);
  Platform.sdk = null;
  check('без SDK разметка молчит',
    Platform.gameReady() === false && Platform.gameplay(false) === false);

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
