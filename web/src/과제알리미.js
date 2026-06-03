const DB_NAME = 'HomeworkDB';
const STORE_NAME = 'tasks';
let db = null;
let currentDate = new Date();
let selectedGrade = '1';
let selectedClass = '1';
let tasks = {};

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains(STORE_NAME)) d.createObjectStore(STORE_NAME, { keyPath: 'key' });
    };
    request.onsuccess = (e) => { db = e.target.result; resolve(db); };
    request.onerror = (e) => reject(e);
  });
}

function dbGet(key) {
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result?.value ?? null);
    req.onerror = () => resolve(null);
  });
}

function dbSet(key, value) {
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({ key, value });
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

function getSelectedKey() { return `${selectedGrade}-${selectedClass}`; }
function getTasks() { return tasks[getSelectedKey()] || []; }
async function setTasks(arr) { tasks[getSelectedKey()] = arr; await dbSet('myTasks', tasks); }
async function setSetting(key, value) { await dbSet(key, value); }

async function loadAllTasks() {
  const saved = await dbGet('myTasks');
  if (saved) tasks = saved;
  for (let g = 1; g <= 3; g++) {
    for (let c = 1; c <= 4; c++) {
      const key = `${g}-${c}`;
      if (!tasks[key]) tasks[key] = [];
    }
  }
  const savedGrade = await dbGet('selectedGrade');
  const savedClass = await dbGet('selectedClass');
  if (savedGrade) selectedGrade = savedGrade;
  if (savedClass) selectedClass = savedClass;
  document.getElementById('gradeSelect').value = selectedGrade;
  document.getElementById('classSelect').value = selectedClass;
}

function renderCalendar() {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const currentTasks = getTasks();

  document.getElementById('monthTitle').textContent = `${year}년 ${month + 1}월 (${selectedGrade}학년 ${selectedClass}반)`;

  const firstDay = new Date(year, month, 1).getDay();
  const lastDate = new Date(year, month + 1, 0).getDate();
  const today = new Date();

  let html = '';
  for (let i = 0; i < firstDay; i++) html += '<div class="day empty"></div>';

  for (let d = 1; d <= lastDate; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === d;
    const dayTasks = currentTasks.filter(t => t.date === dateStr);

    let tags = '';
    dayTasks.sort((a, b) => a.priority === 'urgent' ? -1 : 1).forEach(t => {
      const cls = t.done ? 'done' : t.priority;
      tags += `<div class="task-tag ${cls}" data-id="${t.id}">${t.title}</div>`;
    });

    html += `<div class="day${isToday ? ' today' : ''}" data-date="${dateStr}">
      <div class="date">${d}</div>${tags}</div>`;
  }

  document.getElementById('calendarBody').innerHTML = html;
  updateStats();
}

document.getElementById('gradeSelect').addEventListener('change', async (e) => { selectedGrade = e.target.value; await setSetting('selectedGrade', selectedGrade); renderCalendar(); });
document.getElementById('classSelect').addEventListener('change', async (e) => { selectedClass = e.target.value; await setSetting('selectedClass', selectedClass); renderCalendar(); });

function updateStats() {
  const currentTasks = getTasks();
  document.getElementById('urgentCount').textContent = currentTasks.filter(t => t.priority === 'urgent' && !t.done).length;
  document.getElementById('normalCount').textContent = currentTasks.filter(t => t.priority === 'normal' && !t.done).length;
  document.getElementById('doneCount').textContent = currentTasks.filter(t => t.done).length;
}

function showFilteredTasks(filterFn, title) {
  const currentTasks = getTasks();
  const filtered = currentTasks.filter(filterFn);
  if (filtered.length === 0) return;

  document.getElementById('modalTitle').textContent = `${title} (${selectedGrade}학년 ${selectedClass}반)`;
  let html = '';
  filtered.forEach(t => {
    html += `<div class="task-item${t.done ? ' done' : ''}">
      <span>${t.done ? '✅' : '⬜'} ${t.title} (${t.date})${t.memo ? ' ' + t.memo : ''}</span>
      <div class="task-actions">
        ${!t.done ? `<button class="btn-check" data-id="${t.id}">완료</button>` : ''}
        <button class="btn-delete" data-id="${t.id}">삭제</button>
      </div>
    </div>`;
  });
  document.getElementById('taskList').innerHTML = html;
  document.getElementById('modal').classList.add('show');
}

document.querySelectorAll('.stat-card').forEach(card => {
  card.addEventListener('click', () => {
    const currentTasks = getTasks();
    if (card.classList.contains('urgent')) {
      showFilteredTasks(t => t.priority === 'urgent' && !t.done, '긴급 과제');
    } else if (card.classList.contains('normal')) {
      showFilteredTasks(t => t.priority === 'normal' && !t.done, '진행중인 과제');
    } else if (card.classList.contains('done')) {
      showFilteredTasks(t => t.done, '완료된 과제');
    }
  });
});

document.getElementById('addBtn').addEventListener('click', async () => {
  const title = document.getElementById('taskTitle').value.trim();
  const date = document.getElementById('taskDate').value;
  if (!title || !date) { alert('과제 이름과 날짜를 입력해주세요.'); return; }

  const currentTasks = getTasks();
  currentTasks.push({
    id: Date.now(),
    title,
    date,
    priority: document.getElementById('taskPriority').value,
    memo: document.getElementById('taskMemo').value,
    done: false
  });
  await setTasks(currentTasks);
  renderCalendar();
  document.getElementById('taskTitle').value = '';
  document.getElementById('taskMemo').value = '';
});

document.getElementById('prevMonth').addEventListener('click', () => { currentDate.setMonth(currentDate.getMonth() - 1); renderCalendar(); });
document.getElementById('nextMonth').addEventListener('click', () => { currentDate.setMonth(currentDate.getMonth() + 1); renderCalendar(); });

document.getElementById('calendarBody').addEventListener('click', async (e) => {
  const tag = e.target.closest('.task-tag');
  if (tag) {
    const id = parseInt(tag.dataset.id);
    const currentTasks = getTasks();
    const task = currentTasks.find(t => t.id === id);
    if (task && !task.done) { task.done = true; await setTasks(currentTasks); renderCalendar(); }
    return;
  }
  const day = e.target.closest('.day');
  if (day && !day.classList.contains('empty')) {
    const date = day.dataset.date;
    const currentTasks = getTasks();
    const dayTasks = currentTasks.filter(t => t.date === date);
    if (dayTasks.length === 0) return;

    document.getElementById('modalTitle').textContent = `${date} 과제 (${selectedGrade}학년 ${selectedClass}반)`;
    let html = '';
    dayTasks.forEach(t => {
      html += `<div class="task-item${t.done ? ' done' : ''}">
        <span>${t.done ? '✅' : '⬜'} ${t.title} ${t.memo ? '(' + t.memo + ')' : ''}</span>
        <div class="task-actions">
          ${!t.done ? `<button class="btn-check" data-id="${t.id}">완료</button>` : ''}
          <button class="btn-delete" data-id="${t.id}">삭제</button>
        </div>
      </div>`;
    });
    document.getElementById('taskList').innerHTML = html;
    document.getElementById('modal').classList.add('show');
  }
});

document.getElementById('taskList').addEventListener('click', async (e) => {
  const id = parseInt(e.target.dataset.id);
  const currentTasks = getTasks();
  if (e.target.classList.contains('btn-check')) {
    const task = currentTasks.find(t => t.id === id);
    if (task) { task.done = true; await setTasks(currentTasks); renderCalendar(); document.getElementById('modal').classList.remove('show'); }
  }
  if (e.target.classList.contains('btn-delete')) {
    await setTasks(currentTasks.filter(t => t.id !== id));
    renderCalendar(); document.getElementById('modal').classList.remove('show'); }
});

document.getElementById('closeModal').addEventListener('click', () => document.getElementById('modal').classList.remove('show'));
document.getElementById('modal').addEventListener('click', (e) => { if (e.target.id === 'modal') document.getElementById('modal').classList.remove('show'); });

document.getElementById('taskDate').valueAsDate = new Date();

openDB().then(async () => {
  await loadAllTasks();
  renderCalendar();
});
