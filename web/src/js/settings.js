API.initTheme();
    API.requireAuth();

    const adminSettingsState = {
      assignmentGrade: 'all',
      assignmentClass: 'all',
      messageType: 'grade',
      messageGrade: 'all',
      messageClass: 'all',
      assignments: [],
      messages: [],
      assignmentStatusById: {},
      assignmentStatusLoading: {},
      assignmentStatusOpen: {},
      assignmentStatusFilterById: {}
    };

    async function init() {
      const user = await API.ensureUser();
      if (!user) return;
      await API.loadUserInfo();
      await API.initNotifications();
      await loadProfile();
      if (user.is_admin) {
        document.getElementById('adminAssignmentSection').style.display = 'block';
        document.getElementById('adminMessageSection').style.display = 'block';
        document.getElementById('adminUserSection').style.display = 'block';
        initAdminSelectors();
        await Promise.all([
          loadAdminAssignments(),
          loadAdminMessages(),
          loadAdminUsers()
        ]);
      }
    }

    async function loadProfile() {
      const data = await API.me();
      if (!data || data.error) return;

      document.getElementById('settingName').value = data.name;
      document.getElementById('settingClass').value = data.is_admin ? '관리자 · 전체 학년/반 조회 가능' : `${data.grade}학년 ${data.class_number}반`;

      const avatar = document.getElementById('profileAvatar');
      avatar.textContent = '';
      if (API.isSafeImageUrl(data.profile_image_url)) {
        const image = document.createElement('img');
        image.src = data.profile_image_url;
        image.style.width = '80px';
        image.style.height = '80px';
        image.style.borderRadius = '50%';
        image.style.objectFit = 'cover';
        image.alt = `${data.name} 프로필 이미지`;
        avatar.appendChild(image);
      } else {
        avatar.textContent = data.name.charAt(0);
      }

      const toggle = document.getElementById('alarmToggle');
      if (data.is_alarm_enabled) toggle.classList.add('on');
      else toggle.classList.remove('on');

      const themeModeSelect = document.getElementById('themeModeSelect');
      themeModeSelect.value = API.getTheme();
      updateThemeHelpText(themeModeSelect.value, API.getResolvedTheme(themeModeSelect.value));

      const user = API.getUser();
      if (user) {
        user.name = data.name;
        user.grade = data.grade;
        user.class_number = data.class_number;
        user.is_admin = Boolean(data.is_admin);
        API.setUser(user);
      }
    }

    function adminUserOptions(max, suffix, value) {
      return Array.from({ length: max }, (_, i) => {
        const optionValue = i + 1;
        return `<option value="${optionValue}"${Number(value) === optionValue ? ' selected' : ''}>${optionValue}${suffix}</option>`;
      }).join('');
    }

    function buildFilterOptions(max, suffix, selectedValue, allLabel) {
      return [`<option value="all"${selectedValue === 'all' ? ' selected' : ''}>${allLabel}</option>`]
        .concat(Array.from({ length: max }, (_, i) => {
          const optionValue = String(i + 1);
          return `<option value="${optionValue}"${selectedValue === optionValue ? ' selected' : ''}>${optionValue}${suffix}</option>`;
        }))
        .join('');
    }

    function initAdminSelectors() {
      document.getElementById('adminSettingsAssignmentGrade').innerHTML = buildFilterOptions(3, '학년', adminSettingsState.assignmentGrade, '전체 학년');
      document.getElementById('adminSettingsAssignmentClass').innerHTML = buildFilterOptions(4, '반', adminSettingsState.assignmentClass, '전체 반');
      document.getElementById('adminSettingsMessageGrade').innerHTML = buildFilterOptions(3, '학년', adminSettingsState.messageGrade, '전체 학년');
      document.getElementById('adminSettingsMessageClass').innerHTML = buildFilterOptions(4, '반', adminSettingsState.messageClass, '전체 반');
      document.getElementById('adminSettingsMessageType').value = adminSettingsState.messageType;
      syncAdminMessageSelectors();
    }

    function syncAdminMessageSelectors() {
      const classSelect = document.getElementById('adminSettingsMessageClass');
      classSelect.style.display = adminSettingsState.messageType === 'class' ? 'block' : 'none';
    }

    function getVisibleAdminAssignments() {
      return adminSettingsState.assignments.filter(assignment => {
        const gradeMatch = adminSettingsState.assignmentGrade === 'all' || String(assignment.target_grade) === adminSettingsState.assignmentGrade;
        const classMatch = adminSettingsState.assignmentClass === 'all' || String(assignment.target_class) === adminSettingsState.assignmentClass;
        return gradeMatch && classMatch;
      });
    }

    function getVisibleAdminMessages() {
      return adminSettingsState.messages.filter(message => {
        const gradeMatch = adminSettingsState.messageGrade === 'all' || String(message.target_grade) === adminSettingsState.messageGrade;
        if (!gradeMatch) return false;
        if (adminSettingsState.messageType === 'grade') return true;
        return adminSettingsState.messageClass === 'all' || String(message.target_class) === adminSettingsState.messageClass;
      });
    }

    function pruneAssignmentStatusCache() {
      const validIds = new Set(adminSettingsState.assignments.map(assignment => String(assignment.assignment_id)));
      ['assignmentStatusById', 'assignmentStatusLoading', 'assignmentStatusOpen', 'assignmentStatusFilterById'].forEach(key => {
        Object.keys(adminSettingsState[key]).forEach(id => {
          if (!validIds.has(id)) delete adminSettingsState[key][id];
        });
      });
    }

    function renderAssignmentStatusPanel(assignmentId) {
      if (!adminSettingsState.assignmentStatusOpen[assignmentId]) return '';

      if (adminSettingsState.assignmentStatusLoading[assignmentId]) {
        return '<div class="assignment-status-panel"><div class="assignment-status-empty">불러오는 중...</div></div>';
      }

      const statusData = adminSettingsState.assignmentStatusById[assignmentId];
      if (!statusData) return '';

      if (statusData.error) {
        return `<div class="assignment-status-panel"><div class="assignment-status-empty">${API.escapeHTML(statusData.error)}</div></div>`;
      }

      if (!Array.isArray(statusData.students) || statusData.students.length === 0) {
        return '<div class="assignment-status-panel"><div class="assignment-status-empty">대상 학생이 없습니다.</div></div>';
      }

      const filter = adminSettingsState.assignmentStatusFilterById[assignmentId] || 'all';
      const filteredStudents = statusData.students.filter(student => {
        if (filter === 'completed') return Number(student.is_completed) === 1;
        if (filter === 'pending') return Number(student.is_completed) !== 1;
        return true;
      });

      return `
        <div class="assignment-status-panel">
          <div class="assignment-status-filter">
            <button type="button" class="status-filter-btn ${filter === 'all' ? 'active' : ''}" data-id="${assignmentId}" data-filter="all">전체</button>
            <button type="button" class="status-filter-btn ${filter === 'completed' ? 'active' : ''}" data-id="${assignmentId}" data-filter="completed">제출함만</button>
            <button type="button" class="status-filter-btn ${filter === 'pending' ? 'active' : ''}" data-id="${assignmentId}" data-filter="pending">미제출만</button>
          </div>
          <div class="assignment-status-list">
            ${filteredStudents.length === 0 ? '<div class="assignment-status-empty">조건에 맞는 학생이 없습니다.</div>' : filteredStudents.map(student => `
              <div class="assignment-status-item">
                <div>
                  <div class="assignment-status-name">${API.escapeHTML(student.name)}</div>
                  <div class="assignment-status-meta">${API.escapeHTML(student.grade)}학년 ${API.escapeHTML(student.class_number)}반</div>
                </div>
                <span class="assignment-status-badge ${Number(student.is_completed) === 1 ? 'done' : 'pending'}">
                  ${Number(student.is_completed) === 1 ? '제출함' : '미제출'}
                </span>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    function renderAdminAssignments() {
      const container = document.getElementById('adminAssignmentList');
      const assignments = getVisibleAdminAssignments();
      if (assignments.length === 0) {
        container.innerHTML = '<div class="empty-state">선택한 범위의 과제가 없습니다.</div>';
        return;
      }

      container.innerHTML = assignments.map(assignment => {
        const statusData = adminSettingsState.assignmentStatusById[assignment.assignment_id];
        const isOpen = Boolean(adminSettingsState.assignmentStatusOpen[assignment.assignment_id]);
        const completedCount = Array.isArray(statusData?.students)
          ? statusData.students.filter(student => Number(student.is_completed) === 1).length
          : null;
        const pendingCount = Array.isArray(statusData?.students)
          ? statusData.students.length - completedCount
          : null;

        return `
          <div class="assignment-item assignment-admin-item">
            <div class="info">
              <div class="title">${API.escapeHTML(assignment.title)}</div>
              ${assignment.content ? `<div class="detail">${API.renderTextWithLinks(assignment.content)}</div>` : ''}
              <div class="meta">${API.escapeHTML(assignment.due_date)} · ${API.escapeHTML(assignment.target_class ? assignment.target_grade + '학년 ' + assignment.target_class + '반' : assignment.target_grade + '학년 전체')} · ${API.escapeHTML(assignment.creator_name || '')}</div>
              ${completedCount === null ? '' : `<div class="admin-user-meta">제출함 ${completedCount}명 · 미제출 ${pendingCount}명</div>`}
              ${renderAssignmentStatusPanel(assignment.assignment_id)}
            </div>
            <div class="actions">
              <button class="btn btn-secondary btn-sm toggle-assignment-status" data-id="${assignment.assignment_id}">${isOpen ? '제출 현황 숨기기' : '제출 현황 보기'}</button>
              <button class="btn btn-danger btn-sm delete-admin-assignment" data-id="${assignment.assignment_id}">삭제</button>
            </div>
          </div>
        `;
      }).join('');
    }

    function renderAdminMessages() {
      const container = document.getElementById('adminMessageList');
      const messages = getVisibleAdminMessages();
      if (messages.length === 0) {
        container.innerHTML = '<div class="empty-state">선택한 범위의 메세지가 없습니다.</div>';
        return;
      }

      container.innerHTML = messages.map(message => {
        const badge = message.type === 'grade' ? '<span class="msg-badge grade">학년</span>' : '<span class="msg-badge class">반</span>';
        return `
          <div class="message-item">
            <div class="msg-header">
              <span class="msg-sender">${API.escapeHTML(message.sender_name)} ${badge}</span>
              <span class="msg-time">${new Date(message.created_at).toLocaleString('ko-KR')}</span>
            </div>
            <div class="msg-content">${API.escapeHTML(message.content)}</div>
            <div class="msg-time" style="margin-top:6px">${message.type === 'grade' ? `${message.target_grade}학년` : `${message.target_grade}학년 ${message.target_class}반`}</div>
            <div class="actions" style="margin-top:10px">
              <button class="btn btn-danger btn-sm delete-admin-message" data-id="${message.message_id}">삭제</button>
            </div>
          </div>
        `;
      }).join('');
    }

    async function loadAdminAssignments() {
      const res = await API.getAssignments();
      adminSettingsState.assignments = Array.isArray(res) ? res : [];
      pruneAssignmentStatusCache();
      renderAdminAssignments();
    }

    async function toggleAssignmentStatusView(assignmentId) {
      if (!assignmentId) return;

      if (adminSettingsState.assignmentStatusOpen[assignmentId]) {
        adminSettingsState.assignmentStatusOpen[assignmentId] = false;
        renderAdminAssignments();
        return;
      }

      adminSettingsState.assignmentStatusOpen[assignmentId] = true;

      if (!adminSettingsState.assignmentStatusById[assignmentId]) {
        adminSettingsState.assignmentStatusLoading[assignmentId] = true;
        renderAdminAssignments();

        const res = await API.getAssignmentStatus(assignmentId);
        if (!res || res.error) {
          adminSettingsState.assignmentStatusById[assignmentId] = {
            error: res?.error || '제출 현황을 불러오지 못했습니다.',
            students: []
          };
        } else {
          adminSettingsState.assignmentStatusById[assignmentId] = res;
        }
        adminSettingsState.assignmentStatusLoading[assignmentId] = false;
      }

      renderAdminAssignments();
    }

    async function loadAdminMessages() {
      const res = await API.getMessages(null, null, adminSettingsState.messageType);
      adminSettingsState.messages = Array.isArray(res) ? res : [];
      renderAdminMessages();
    }

    async function loadAdminUsers() {
      const res = await API.getAdminUsers();
      const container = document.getElementById('adminUserList');
      if (!Array.isArray(res)) {
        container.innerHTML = `<div class="empty-state">${API.escapeHTML(res?.error || '유저 목록을 불러오지 못했습니다.')}</div>`;
        return;
      }

      container.innerHTML = res.map(user => `
        <div class="admin-user-item" data-id="${user.user_id}">
          <div class="admin-user-top">
            <strong>${API.escapeHTML(user.name)}</strong>
            <span class="admin-role-badge ${user.is_admin ? 'admin' : 'student'}">${user.is_admin ? '관리자' : '일반'}</span>
          </div>
          <div class="admin-user-grid">
            <div class="form-group">
              <label>이름</label>
              <input type="text" class="admin-name-input" value="${API.escapeHTML(user.name)}">
            </div>
            <div class="form-group">
              <label>학년</label>
              <select class="admin-grade-select">${adminUserOptions(3, '학년', user.grade)}</select>
            </div>
            <div class="form-group">
              <label>반</label>
              <select class="admin-class-select">${adminUserOptions(4, '반', user.class_number)}</select>
            </div>
          </div>
          <div class="admin-user-meta">생성일 ${new Date(user.created_at).toLocaleString('ko-KR')}</div>
          <div class="admin-user-actions">
            <button class="btn btn-primary btn-sm save-admin-user">저장</button>
            ${user.is_admin ? '' : '<button class="btn btn-danger btn-sm delete-admin-user">삭제</button>'}
          </div>
        </div>
      `).join('');
    }

    document.getElementById('saveProfileBtn').addEventListener('click', async () => {
      const name = document.getElementById('settingName').value.trim();
      if (!name) { alert('이름을 입력해주세요.'); return; }
      const res = await API.updateUser(API.getUser().id, { name });
      if (res && res.success) {
        const user = API.getUser();
        user.name = name;
        API.setUser(user);
        await API.loadUserInfo();
        document.getElementById('profileAvatar').textContent = name.charAt(0);
        alert('프로필이 저장되었습니다.');
      } else {
        alert(res?.error || '저장에 실패했습니다.');
      }
    });

    document.getElementById('alarmToggle').addEventListener('click', async function() {
      const newVal = !this.classList.contains('on');
      this.classList.toggle('on');
      await API.updateUser(API.getUser().id, { is_alarm_enabled: newVal ? 1 : 0 });
    });

    function updateThemeHelpText(theme, resolvedTheme) {
      const helpText = document.getElementById('themeModeHelp');
      if (!helpText) return;
      if (theme === 'system') {
        helpText.textContent = `시스템 설정을 따라갑니다. 현재 ${resolvedTheme === 'dark' ? '다크모드' : '라이트모드'}가 적용 중입니다.`;
        return;
      }
      helpText.textContent = `앱 전체에 ${theme === 'dark' ? '다크모드' : '라이트모드'}를 고정해서 적용합니다.`;
    }

    document.getElementById('themeModeSelect').addEventListener('change', function() {
      const nextTheme = API.setTheme(this.value);
      updateThemeHelpText(nextTheme, API.getResolvedTheme(nextTheme));
    });

    window.addEventListener('themechange', (event) => {
      const themeModeSelect = document.getElementById('themeModeSelect');
      if (!themeModeSelect) return;
      const currentTheme = event.detail?.theme || API.getTheme();
      const resolvedTheme = event.detail?.resolvedTheme || API.getResolvedTheme(currentTheme);
      themeModeSelect.value = currentTheme;
      updateThemeHelpText(currentTheme, resolvedTheme);
    });

    document.getElementById('adminUserList').addEventListener('click', async (e) => {
      const item = e.target.closest('.admin-user-item');
      if (!item) return;
      const userId = parseInt(item.dataset.id, 10);
      if (!userId) return;

      if (e.target.classList.contains('save-admin-user')) {
        const payload = {
          name: item.querySelector('.admin-name-input').value.trim(),
          grade: parseInt(item.querySelector('.admin-grade-select').value, 10),
          class_number: parseInt(item.querySelector('.admin-class-select').value, 10)
        };
        const res = await API.updateAdminUser(userId, payload);
        if (!res || res.error) {
          alert(res?.error || '저장에 실패했습니다.');
          return;
        }
        alert('유저 정보가 저장되었습니다.');
        await loadAdminUsers();
        return;
      }

      if (e.target.classList.contains('delete-admin-user')) {
        if (!confirm('정말 이 계정을 삭제하시겠습니까?')) return;
        const res = await API.deleteAdminUser(userId);
        if (!res || res.error) {
          alert(res?.error || '삭제에 실패했습니다.');
          return;
        }
        await loadAdminUsers();
      }
    });

    document.getElementById('adminAssignmentList').addEventListener('click', async (e) => {
      const toggleButton = e.target.closest('.toggle-assignment-status');
      if (toggleButton) {
        await toggleAssignmentStatusView(parseInt(toggleButton.dataset.id, 10));
        return;
      }

      const filterButton = e.target.closest('.status-filter-btn');
      if (filterButton) {
        adminSettingsState.assignmentStatusFilterById[filterButton.dataset.id] = filterButton.dataset.filter;
        renderAdminAssignments();
        return;
      }

      const deleteButton = e.target.closest('.delete-admin-assignment');
      if (!deleteButton) return;
      if (!confirm('정말 이 과제를 삭제하시겠습니까?')) return;
      const res = await API.deleteAssignment(parseInt(deleteButton.dataset.id, 10));
      if (!res || res.error) {
        alert(res?.error || '과제 삭제에 실패했습니다.');
        return;
      }
      await loadAdminAssignments();
      await API.refreshNotifications();
    });

    document.getElementById('adminMessageList').addEventListener('click', async (e) => {
      if (!e.target.classList.contains('delete-admin-message')) return;
      if (!confirm('정말 이 메세지를 삭제하시겠습니까?')) return;
      const res = await API.deleteMessage(parseInt(e.target.dataset.id, 10));
      if (!res || res.error) {
        alert(res?.error || '메세지 삭제에 실패했습니다.');
        return;
      }
      await loadAdminMessages();
      await API.refreshNotifications();
    });

    document.querySelectorAll('.admin-accordion-toggle').forEach(button => {
      button.addEventListener('click', () => {
        const panel = document.getElementById(button.dataset.target);
        const isOpen = button.classList.toggle('open');
        panel.classList.toggle('show', isOpen);
      });
    });

    document.getElementById('adminSettingsAssignmentGrade').addEventListener('change', (e) => {
      adminSettingsState.assignmentGrade = e.target.value;
      renderAdminAssignments();
    });

    document.getElementById('adminSettingsAssignmentClass').addEventListener('change', (e) => {
      adminSettingsState.assignmentClass = e.target.value;
      renderAdminAssignments();
    });

    document.getElementById('adminSettingsMessageType').addEventListener('change', async (e) => {
      adminSettingsState.messageType = e.target.value;
      syncAdminMessageSelectors();
      await loadAdminMessages();
    });

    document.getElementById('adminSettingsMessageGrade').addEventListener('change', (e) => {
      adminSettingsState.messageGrade = e.target.value;
      renderAdminMessages();
    });

    document.getElementById('adminSettingsMessageClass').addEventListener('change', (e) => {
      adminSettingsState.messageClass = e.target.value;
      renderAdminMessages();
    });

    init();
