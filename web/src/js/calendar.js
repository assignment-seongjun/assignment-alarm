let currentDate = new Date();
    let assignments = [];
    let assignmentsLoading = false;
    let adminGradeFilter = 'all';
    let adminClassFilter = 'all';

    API.requireAuth();

    async function init() {
      const cachedUser = API.getUser();
      if (cachedUser) {
        API.loadUserInfo();
        initAdminFilters(cachedUser);
        renderCalendar(true);
      }

      const user = await API.ensureUser();
      if (!user) return;
      API.loadUserInfo();
      API.initNotifications().catch(() => {});
      initAdminFilters(user);
      renderCalendar(true);
      loadAssignments(user).catch(() => {
        assignmentsLoading = false;
        renderCalendar(false);
      });
    }

    async function loadAssignments(user) {
      assignmentsLoading = true;
      const data = user.is_admin
        ? await API.getAssignments()
        : await API.getUserAssignmentsWithDetails(user.id, user.grade, user.class_number);
      assignments = Array.isArray(data) ? data : [];
      assignmentsLoading = false;
      renderCalendar(false);
    }

    function initAdminFilters(user) {
      if (!user || !user.is_admin) return;

      const wrap = document.getElementById('adminCalendarFilter');
      const gradeSelect = document.getElementById('adminGradeFilter');
      const classSelect = document.getElementById('adminClassFilter');

      wrap.classList.add('show');
      gradeSelect.innerHTML = ['<option value="all">전체 학년</option>']
        .concat(Array.from({ length: 3 }, (_, i) => `<option value="${i + 1}">${i + 1}학년</option>`))
        .join('');
      classSelect.innerHTML = ['<option value="all">전체 반</option>']
        .concat(Array.from({ length: 4 }, (_, i) => `<option value="${i + 1}">${i + 1}반</option>`))
        .join('');

      gradeSelect.value = adminGradeFilter;
      classSelect.value = adminClassFilter;
    }

    function getVisibleAssignments() {
      const user = API.getUser();
      if (!user || !user.is_admin) return assignments;

      return assignments.filter(a => {
        const gradeMatch = adminGradeFilter === 'all' || String(a.target_grade) === adminGradeFilter;
        const classMatch = adminClassFilter === 'all' || String(a.target_class) === adminClassFilter;
        return gradeMatch && classMatch;
      });
    }

    function renderCalendar(forceLoading = assignmentsLoading) {
      const year = currentDate.getFullYear();
      const month = currentDate.getMonth();
      const user = API.getUser();
      const visibleAssignments = getVisibleAssignments();
      const loadingBanner = document.getElementById('calendarLoadingBanner');

      document.getElementById('monthTitle').textContent = `${year}년 ${month + 1}월`;
      document.getElementById('classScope').textContent = user && user.is_admin
        ? `${adminGradeFilter === 'all' ? '전체 학년' : adminGradeFilter + '학년'} / ${adminClassFilter === 'all' ? '전체 반' : adminClassFilter + '반'}`
        : user && user.grade && user.class_number
          ? `${user.grade}학년 ${user.class_number}반 과제`
          : '';
      if (loadingBanner) {
        loadingBanner.hidden = !forceLoading;
      }

      const firstDay = new Date(year, month, 1).getDay();
      const lastDate = new Date(year, month + 1, 0).getDate();
      const today = new Date();
      const urgentThreshold = new Date(today.getTime() + 86400000 * 2).toISOString().split('T')[0];

      let html = '';
      for (let i = 0; i < firstDay; i++) html += '<div class="day empty"></div>';

      for (let d = 1; d <= lastDate; d++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === d;
        const dayTasks = visibleAssignments.filter(a => a.due_date === dateStr);

        let tags = '';
        dayTasks.sort((a, b) => a.is_completed === b.is_completed ? 0 : a.is_completed ? 1 : -1).forEach(a => {
          const cls = a.is_completed
            ? 'done'
            : a.due_date <= urgentThreshold
              ? 'urgent'
              : 'normal';
          const label = user && user.is_admin
            ? `${a.target_grade}학년 ${a.target_class}반 · ${a.title}`
            : a.title;
          tags += `<div class="task-tag ${cls} task-item-el" data-id="${a.assignment_id}">${API.escapeHTML(label)}</div>`;
        });

        html += `<div class="day${isToday ? ' today' : ''}" data-date="${dateStr}">
          <div class="date">${d}</div>${tags}</div>`;
      }

      document.getElementById('calendarBody').innerHTML = html;
      updateStats(visibleAssignments, forceLoading);
    }

    function updateStats(visibleAssignments, isLoading = false) {
      if (isLoading) {
        document.getElementById('urgentCount').textContent = '...';
        document.getElementById('normalCount').textContent = '...';
        document.getElementById('doneCount').textContent = '...';
        return;
      }
      const today = new Date();
      const twoDaysLater = new Date(today.getTime() + 86400000 * 2).toISOString().split('T')[0];
      const urgent = visibleAssignments.filter(a => !a.is_completed && a.due_date <= twoDaysLater);
      const normal = visibleAssignments.filter(a => !a.is_completed && a.due_date > twoDaysLater);
      const done = visibleAssignments.filter(a => a.is_completed);
      document.getElementById('urgentLabel').textContent = '긴급';
      document.getElementById('normalLabel').textContent = '진행중';
      document.getElementById('doneLabel').textContent = '제출함';
      document.getElementById('urgentCount').textContent = urgent.length;
      document.getElementById('normalCount').textContent = normal.length;
      document.getElementById('doneCount').textContent = done.length;
    }

    document.getElementById('calendarBody').addEventListener('click', async (e) => {
      const user = API.getUser();
      const day = e.target.closest('.day');
      if (day && !day.classList.contains('empty')) {
        const date = day.dataset.date;
        const dayTasks = getVisibleAssignments().filter(a => a.due_date === date);
        if (dayTasks.length === 0) return;

        document.getElementById('modalTitle').textContent = `${date} 과제`;
        let html = '';
        dayTasks.forEach(a => {
          html += `<div class="assignment-item${a.is_completed ? ' done' : ''}">
            <div class="info">
              <div class="title">${API.escapeHTML(a.title)}</div>
              ${a.content ? `<div class="detail">${API.renderTextWithLinks(a.content)}</div>` : ''}
              <div class="meta">${API.escapeHTML(a.creator_name || '선생님')} · ${user && user.is_admin ? `${a.target_grade}학년 ${a.target_class}반` : a.is_completed ? '☑ 제출함' : '☐ 미제출'}</div>
            </div>
            <div class="actions">
              ${!(user && user.is_admin) ? `<label class="submit-check"><input type="checkbox" class="modal-submit-toggle" data-id="${a.assignment_id}" ${a.is_completed ? 'checked' : ''}> <span>제출함</span></label>` : ''}
              ${user && (a.created_by === user.id || user.is_admin) ? `<button class="btn btn-danger btn-sm modal-delete" data-id="${a.assignment_id}">삭제</button>` : ''}
            </div>
          </div>`;
        });
        document.getElementById('taskList').innerHTML = html;
        document.getElementById('modal').classList.add('show');
      }
    });

    document.getElementById('taskList').addEventListener('click', async (e) => {
      const id = parseInt(e.target.dataset.id);
      if (!id) return;
      if (e.target.classList.contains('modal-delete')) {
        const res = await API.deleteAssignment(id);
        if (!res || !res.success) return;
        assignments = assignments.filter(a => a.assignment_id !== id);
        renderCalendar();
        await API.refreshNotifications();
        document.getElementById('modal').classList.remove('show');
      }
    });

    document.getElementById('taskList').addEventListener('change', async (e) => {
      if (!e.target.classList.contains('modal-submit-toggle')) return;
      const id = parseInt(e.target.dataset.id, 10);
      if (!id) return;
      const res = await API.toggleAssignment(id, e.target.checked);
      if (!res || !res.success) {
        e.target.checked = !e.target.checked;
        return;
      }
      const task = assignments.find(a => a.assignment_id === id);
      if (task) task.is_completed = e.target.checked ? 1 : 0;
      renderCalendar();
    });

    document.getElementById('prevMonth').addEventListener('click', () => { currentDate.setMonth(currentDate.getMonth() - 1); renderCalendar(); });
    document.getElementById('nextMonth').addEventListener('click', () => { currentDate.setMonth(currentDate.getMonth() + 1); renderCalendar(); });
    document.getElementById('adminGradeFilter').addEventListener('change', (e) => {
      adminGradeFilter = e.target.value;
      if (adminGradeFilter === 'all') {
        adminClassFilter = 'all';
        document.getElementById('adminClassFilter').value = 'all';
      }
      renderCalendar();
    });
    document.getElementById('adminClassFilter').addEventListener('change', (e) => {
      adminClassFilter = e.target.value;
      renderCalendar();
    });
    document.getElementById('closeModal').addEventListener('click', () => document.getElementById('modal').classList.remove('show'));
    document.getElementById('modal').addEventListener('click', (e) => { if (e.target.id === 'modal') document.getElementById('modal').classList.remove('show'); });

    init();
