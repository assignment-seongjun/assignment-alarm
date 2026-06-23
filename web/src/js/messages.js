let filterType = 'grade';
    let messages = [];

    API.requireAuth();

    async function init() {
      const user = await API.ensureUser();
      if (!user) return;
      await API.loadUserInfo();
      initTargetSelectors();
      syncMessageForm();
      await API.initNotifications();
      await loadMessages();
    }

    function initTargetSelectors() {
      const gradeSelect = document.getElementById('msgTargetGrade');
      const classSelect = document.getElementById('msgTargetClass');

      gradeSelect.innerHTML = Array.from({ length: 3 }, (_, i) => `<option value="${i + 1}">${i + 1}학년</option>`).join('');
      classSelect.innerHTML = Array.from({ length: 4 }, (_, i) => `<option value="${i + 1}">${i + 1}반</option>`).join('');
    }

    function syncMessageForm() {
      const user = API.getUser();
      const typeSelect = document.getElementById('msgType');
      const gradeSelect = document.getElementById('msgTargetGrade');
      const classSelect = document.getElementById('msgTargetClass');
      const form = document.getElementById('messageForm');

      if (!user) return;

      if (!user.is_admin) {
        form.style.display = 'none';
        return;
      }

      form.style.display = 'flex';

      const currentType = typeSelect.value;
      const showGradeTarget = true;
      const showClassTarget = currentType === 'class';

      gradeSelect.style.display = showGradeTarget ? 'block' : 'none';
      classSelect.style.display = showClassTarget ? 'block' : 'none';

      if (user.is_admin) {
        if (!gradeSelect.value) gradeSelect.value = String(user.grade || 1);
        if (!classSelect.value) classSelect.value = String(user.class_number || 1);
      }
    }

    async function loadMessages() {
      const data = await API.getMessages(null, null, filterType);
      if (data) messages = data;
      renderMessages();
    }

    function renderMessages() {
      const user = API.getUser();
      document.getElementById('messageTitle').textContent =
        filterType === 'grade'
          ? `📢 학년 공지${user ? user.is_admin ? ' (전체)' : ' (' + user.grade + '학년)' : ''}`
          : `💬 반 공지${user ? user.is_admin ? ' (전체)' : ' (' + user.grade + '학년 ' + user.class_number + '반)' : ''}`;

      document.getElementById('msgType').value = user && user.is_admin ? filterType : 'class';
      document.getElementById('showGradeMsg').classList.toggle('active', filterType === 'grade');
      document.getElementById('showClassMsg').classList.toggle('active', filterType === 'class');
      syncMessageForm();

      const container = document.getElementById('messageList');
      if (messages.length === 0) {
        container.innerHTML = '<div class="empty-state">메세지가 없습니다.</div>';
        return;
      }
      container.innerHTML = messages.map(m => {
        const badge = m.type === 'grade' ? '<span class="msg-badge grade">학년</span>' : '<span class="msg-badge class">반</span>';
        const time = new Date(m.created_at).toLocaleString('ko-KR');
        const canDelete = user && (Number(m.sender_id) === Number(user.id) || user.is_admin);
        return `<div class="message-item">
          <div class="msg-header">
            <span class="msg-sender">${API.escapeHTML(m.sender_name)} ${badge}</span>
            <span class="msg-time">${time}</span>
          </div>
          <div class="msg-content">${API.escapeHTML(m.content)}</div>
          <div class="msg-time" style="margin-top:6px">${m.type === 'grade' ? `${m.target_grade}학년` : `${m.target_grade}학년 ${m.target_class}반`}</div>
          ${canDelete ? `<div class="actions" style="margin-top:10px"><button class="btn btn-danger btn-sm delete-message" data-id="${m.message_id}">삭제</button></div>` : ''}
        </div>`;
      }).join('');
    }

    document.getElementById('sendMsgBtn').addEventListener('click', async () => {
      const content = document.getElementById('msgContent').value.trim();
      const type = document.getElementById('msgType').value;
      const user = API.getUser();
      if (!content) { alert('내용을 입력해주세요.'); return; }
      if (!user) { alert('로그인이 필요합니다.'); return; }
      if (!user.is_admin) { alert('관리자만 공지를 보낼 수 있습니다.'); return; }
      const payload = { content, type };
      payload.target_grade = parseInt(document.getElementById('msgTargetGrade').value, 10);
      if (type === 'class') {
        payload.target_class = parseInt(document.getElementById('msgTargetClass').value, 10);
      }

      const res = await API.sendMessage(payload);
      if (res && res.success) {
        document.getElementById('msgContent').value = '';
        await loadMessages();
        await API.refreshNotifications();
      } else {
        alert(res?.error || '전송에 실패했습니다.');
      }
    });

    document.getElementById('messageList').addEventListener('click', async (e) => {
      if (!e.target.classList.contains('delete-message')) return;
      if (!confirm('정말 삭제하시겠습니까?')) return;
      const res = await API.deleteMessage(parseInt(e.target.dataset.id));
      if (!res || !res.success) { alert(res?.error || '삭제에 실패했습니다.'); return; }
      await loadMessages();
      await API.refreshNotifications();
    });

    document.getElementById('msgType').addEventListener('change', async (e) => {
      syncMessageForm();
      filterType = e.target.value;
      await loadMessages();
    });

    document.getElementById('showGradeMsg').addEventListener('click', async () => {
      if (filterType === 'grade') return;
      filterType = 'grade';
      await loadMessages();
    });

    document.getElementById('showClassMsg').addEventListener('click', async () => {
      if (filterType === 'class') return;
      filterType = 'class';
      await loadMessages();
    });

    init();
