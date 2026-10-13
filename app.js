'use strict';

const STORAGE_KEY = 'paperTracker.v1';
const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE_PX = 10;

const LOWER_CLASSES = [...'甲乙丙丁戊己庚辛'];
const UPPER_CLASSES = [...'忠孝仁愛信義和平智勇望禮德誠'];

const GRADES = [
  { id: '一', color: '#22a559', classes: LOWER_CLASSES },
  { id: '二', color: '#0ea5b7', classes: LOWER_CLASSES },
  { id: '三', color: '#3b82f6', classes: LOWER_CLASSES },
  { id: '七', color: '#8b5cf6', classes: UPPER_CLASSES },
  { id: '八', color: '#ec4899', classes: UPPER_CLASSES },
  { id: '九', color: '#f97316', classes: UPPER_CLASSES },
];

const PICKER_HINTS = {
  exempt: '本節不需繳回，不列入統計；重置時一併清空。',
  disabled: '停用後按鈕直接隱藏，重置不影響。',
};

const $ = (selector) => document.querySelector(selector);

const classIds = (grade) => grade.classes.map((name) => grade.id + name);

// ---------- State ----------

// status: { [classId]: 'done' | 'issue' }, absent means pending
const state = loadState();

function loadState() {
  const defaults = { status: {}, exempt: [], disabled: [], confirm: true };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    return {
      status: saved.status && typeof saved.status === 'object' ? saved.status : {},
      exempt: Array.isArray(saved.exempt) ? saved.exempt : [],
      disabled: Array.isArray(saved.disabled) ? saved.disabled : [],
      confirm: typeof saved.confirm === 'boolean' ? saved.confirm : true,
    };
  } catch {
    return defaults;
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage may be unavailable (private mode); the page still works for this session.
  }
}

function tileState(id) {
  if (state.exempt.includes(id)) return 'exempt';
  return state.status[id] || 'pending';
}

function setStatus(id, status) {
  if (status === 'pending') delete state.status[id];
  else state.status[id] = status;
  saveState();
  render();
}

// ---------- Board ----------

const board = $('#board');
const tiles = new Map();
const gradeEls = new Map();

function buildBoard() {
  for (const grade of GRADES) {
    const section = document.createElement('section');
    section.className = 'grade';
    section.dataset.size = grade.classes.length;
    section.style.setProperty('--g', grade.color);
    section.innerHTML = `
      <div class="grade-head">
        <span class="grade-name">${grade.id}年級</span>
        <span class="grade-count"></span>
      </div>
      <div class="tiles"></div>`;

    const container = section.querySelector('.tiles');
    for (const id of classIds(grade)) {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'tile';
      tile.dataset.id = id;
      tile.innerHTML = `<span class="tile-name">${id}</span><i class="lamp"></i>`;
      container.append(tile);
      tiles.set(id, tile);
    }

    board.append(section);
    gradeEls.set(grade.id, section);
  }
  board.style.setProperty('--hold-ms', `${LONG_PRESS_MS}ms`);
}

const STATE_LABELS = { pending: '未繳交', done: '已繳交', issue: '有狀況', exempt: '本節免繳' };

function render() {
  const totals = { done: 0, pending: 0, issue: 0 };
  let visibleGrades = 0;

  for (const grade of GRADES) {
    const counts = { done: 0, pending: 0, issue: 0, exempt: 0 };
    let visible = 0;

    for (const id of classIds(grade)) {
      const tile = tiles.get(id);
      const disabled = state.disabled.includes(id);
      tile.hidden = disabled;
      if (disabled) continue;

      const current = tileState(id);
      tile.dataset.state = current;
      tile.setAttribute('aria-label', `${id} ${STATE_LABELS[current]}`);
      counts[current]++;
      visible++;
    }

    const section = gradeEls.get(grade.id);
    const required = visible - counts.exempt;
    section.hidden = visible === 0;
    section.classList.toggle('complete', required > 0 && counts.done === required);
    section.querySelector('.grade-count').textContent = `${counts.done}/${required}`;

    if (visible > 0) visibleGrades++;
    for (const key of Object.keys(totals)) totals[key] += counts[key];
  }

  const required = totals.done + totals.pending + totals.issue;
  $('#n-done').textContent = totals.done;
  $('#n-pending').textContent = totals.pending;
  $('#n-issue').textContent = totals.issue;
  $('#bar-fill').style.width = required ? `${(totals.done / required) * 100}%` : '0';
  $('#progress-text').textContent =
    required && totals.done === required ? '全部收齊 🎉' : `${totals.done} / ${required}`;
  $('#empty').hidden = visibleGrades > 0;
}

// ---------- Tile interaction ----------

async function handleTap(id) {
  const current = tileState(id);
  if (current === 'exempt') {
    toast(`${id} 本節免繳`);
    return;
  }

  const next = current === 'done' ? 'pending' : 'done';
  if (state.confirm) {
    const ok = await ask(id, next === 'done' ? '標示為已繳交？' : '改回未繳交？');
    if (!ok) return;
  }
  setStatus(id, next);
}

function handleLongPress(id) {
  const current = tileState(id);
  if (current === 'exempt') return;

  navigator.vibrate?.(40);
  if (current === 'issue') {
    setStatus(id, 'pending');
    toast(`${id} 已取消狀況`);
  } else {
    setStatus(id, 'issue');
    toast(`${id} 標示為有狀況`);
  }
}

let hold = null;
let suppressClick = false;

function cancelHold() {
  if (!hold) return;
  clearTimeout(hold.timer);
  hold.tile.classList.remove('holding');
  hold = null;
}

board.addEventListener('pointerdown', (event) => {
  suppressClick = false;
  cancelHold();
  const tile = event.target.closest('.tile');
  if (!tile || event.button !== 0 || tileState(tile.dataset.id) === 'exempt') return;

  tile.classList.add('holding');
  hold = {
    tile,
    x: event.clientX,
    y: event.clientY,
    timer: setTimeout(() => {
      // The click that follows releasing the pointer must not toggle the tile again.
      suppressClick = true;
      cancelHold();
      handleLongPress(tile.dataset.id);
    }, LONG_PRESS_MS),
  };
});

board.addEventListener('pointermove', (event) => {
  if (!hold) return;
  const moved = Math.hypot(event.clientX - hold.x, event.clientY - hold.y);
  if (moved > MOVE_TOLERANCE_PX) cancelHold();
});

for (const type of ['pointerup', 'pointercancel', 'pointerleave']) {
  board.addEventListener(type, cancelHold);
}

board.addEventListener('contextmenu', (event) => {
  if (event.target.closest('.tile')) event.preventDefault();
});

board.addEventListener('click', (event) => {
  const tile = event.target.closest('.tile');
  if (!tile) return;
  if (suppressClick) {
    suppressClick = false;
    return;
  }
  handleTap(tile.dataset.id);
});

// Keyboard alternative to long press
board.addEventListener('keydown', (event) => {
  const tile = event.target.closest('.tile');
  if (tile && event.shiftKey && event.key === 'Enter') {
    event.preventDefault();
    handleLongPress(tile.dataset.id);
  }
});

// ---------- Confirm dialog ----------

const confirmDialog = $('#dlg-confirm');

function ask(title, message, { danger = false } = {}) {
  return new Promise((resolve) => {
    $('#confirm-title').textContent = title;
    $('#confirm-msg').textContent = message;
    const okButton = $('#confirm-ok');
    okButton.classList.toggle('btn-danger', danger);
    okButton.classList.toggle('btn-primary', !danger);

    confirmDialog.returnValue = '';
    confirmDialog.addEventListener('close', () => resolve(confirmDialog.returnValue === 'ok'), {
      once: true,
    });
    confirmDialog.showModal();
  });
}

// ---------- Settings ----------

const settingsDialog = $('#dlg-settings');
const pickerGrid = $('#picker-grid');
let pickerMode = 'exempt';

function renderPicker() {
  for (const tab of settingsDialog.querySelectorAll('[role="tab"]')) {
    tab.setAttribute('aria-selected', String(tab.dataset.mode === pickerMode));
  }
  $('#cnt-exempt').textContent = state.exempt.length;
  $('#cnt-disabled').textContent = state.disabled.length;
  $('#picker-hint').textContent = PICKER_HINTS[pickerMode];

  const selected = state[pickerMode];
  pickerGrid.innerHTML = GRADES.map((grade) => {
    const chips = classIds(grade)
      .map((id) => {
        // A disabled class is hidden from the board, so it cannot be marked exempt.
        const locked = pickerMode === 'exempt' && state.disabled.includes(id);
        return `<button type="button" class="chip" data-id="${id}" aria-pressed="${selected.includes(id)}"${locked ? ' disabled' : ''}>${id.slice(1)}</button>`;
      })
      .join('');
    return `
      <div class="picker-row" style="--g:${grade.color}">
        <button type="button" class="chip-all" data-grade="${grade.id}" aria-label="${grade.id}年級全選或全不選">${grade.id}</button>
        <div class="chips">${chips}</div>
      </div>`;
  }).join('');
}

function setPicked(ids, picked) {
  const selected = new Set(state[pickerMode]);
  for (const id of ids) {
    if (picked) selected.add(id);
    else selected.delete(id);
  }
  state[pickerMode] = [...selected];

  if (pickerMode === 'disabled') {
    state.exempt = state.exempt.filter((id) => !state.disabled.includes(id));
  }
  saveState();
  render();
  renderPicker();
}

pickerGrid.addEventListener('click', (event) => {
  const chip = event.target.closest('.chip');
  if (chip) {
    setPicked([chip.dataset.id], chip.getAttribute('aria-pressed') !== 'true');
    return;
  }

  const all = event.target.closest('.chip-all');
  if (!all) return;
  const grade = GRADES.find((item) => item.id === all.dataset.grade);
  const ids = classIds(grade).filter(
    (id) => pickerMode === 'disabled' || !state.disabled.includes(id),
  );
  const allPicked = ids.length > 0 && ids.every((id) => state[pickerMode].includes(id));
  setPicked(ids, !allPicked);
});

settingsDialog.querySelector('.segmented').addEventListener('click', (event) => {
  const tab = event.target.closest('[role="tab"]');
  if (!tab) return;
  pickerMode = tab.dataset.mode;
  renderPicker();
});

$('#btn-settings').addEventListener('click', () => {
  $('#opt-confirm').checked = state.confirm;
  renderPicker();
  settingsDialog.showModal();
});

$('#opt-confirm').addEventListener('change', (event) => {
  state.confirm = event.target.checked;
  saveState();
});

$('#btn-reset').addEventListener('click', async () => {
  const ok = await ask('重置全部', '所有燈號回到未繳交，並清空本節免繳。', { danger: true });
  if (!ok) return;

  state.status = {};
  state.exempt = [];
  saveState();
  render();
  settingsDialog.close();
  toast('已重置');
});

settingsDialog.addEventListener('click', (event) => {
  // A click on the dialog element itself lands on the backdrop.
  if (event.target === settingsDialog || event.target.closest('[data-close]')) {
    settingsDialog.close();
  }
});

// ---------- Toast ----------

const toastEl = $('#toast');
let toastTimer;

function toast(message) {
  // Dialogs render in the top layer, so the toast follows the open one to stay visible.
  const host = document.querySelector('dialog[open]') || document.body;
  if (toastEl.parentElement !== host) host.append(toastEl);

  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1600);
}

// ---------- Init ----------

buildBoard();
render();
