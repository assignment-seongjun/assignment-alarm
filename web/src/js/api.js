const API = {
  currentUser: null,
  getToken() { return null; },
  setToken() {
    localStorage.removeItem('token');
  },
  clearToken() {
    localStorage.removeItem('token');
  },
  getUser() {
    try {
      return this.normalizeUser(this.currentUser || JSON.parse(localStorage.getItem('user') || 'null'));
    } catch {
      return null;
    }
  },
  setUser(u) {
    const user = this.normalizeUser(u);
    this.currentUser = user;
    localStorage.setItem('user', JSON.stringify(user));
  },
  clearUser() {
    this.currentUser = null;
    localStorage.removeItem('user');
  },

  escapeHTML(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  isLoginPage() {
    return window.location.pathname.endsWith('/login.html') || window.location.pathname === '/' || window.location.pathname === '';
  },

  isSafeImageUrl(value) {
    if (!value) return false;
    try {
      const url = new URL(String(value), window.location.origin);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  },

  async request(method, url, body) {
    const headers = { 'Content-Type': 'application/json' };
    const res = await fetch(url, {
      method,
      headers,
      credentials: 'same-origin',
      body: body ? JSON.stringify(body) : undefined
    });
    const isAuthRequest = url === '/api/auth/login' || url === '/api/auth/register' || url === '/api/auth/google' || url === '/api/auth/google/register';
    if (res.status === 401) {
      if (isAuthRequest) {
        return res.json();
      }
      this.clearToken();
      this.clearUser();
      if (!this.isLoginPage()) {
        window.location.href = 'login.html';
      }
      return { error: '인증이 만료되었습니다.' };
    }
    return res.json();
  },

  get(url) { return this.request('GET', url); },
  post(url, body) { return this.request('POST', url, body); },
  put(url, body) { return this.request('PUT', url, body); },
  del(url) { return this.request('DELETE', url); },

  login(name, password) { return this.post('/api/auth/login', { name, password }); },
  register(data) { return this.post('/api/auth/register', data); },
  googleAuth(credential) { return this.post('/api/auth/google', { credential }); },
  googleRegister(data) { return this.post('/api/auth/google/register', data); },
  me() { return this.get('/api/auth/me'); },
  logoutRequest() { return this.post('/api/auth/logout'); },
  publicConfig() { return this.get('/api/public-config'); },

  normalizeUser(u) {
    if (!u) return null;
    return {
      id: u.id || u.user_id,
      name: u.name,
      grade: u.grade,
      class_number: u.class_number,
      profile_image_url: u.profile_image_url || null,
      is_alarm_enabled: u.is_alarm_enabled,
      is_admin: Boolean(u.is_admin)
    };
  },

  async ensureUser() {
    const serverUser = await this.me();
    const user = this.normalizeUser(serverUser);
    if (user && user.id && user.grade && user.class_number) {
      this.setUser(user);
      return user;
    }

    this.clearToken();
    this.clearUser();
    window.location.href = 'login.html';
    return null;
  },

  getAssignments() { return this.get('/api/assignments'); },
  getAssignmentStatus(id) { return this.get(`/api/assignments/${id}/status`); },
  createAssignment(data) { return this.post('/api/assignments', data); },
  updateAssignment(id, data) { return this.put(`/api/assignments/${id}`, data); },
  deleteAssignment(id) { return this.del(`/api/assignments/${id}`); },

  getUserAssignments(userId) { return this.get(`/api/user-assignments/${userId}`); },
  toggleAssignment(assignmentId, completed) { return this.put('/api/user-assignments', { assignment_id: assignmentId, is_completed: completed }); },
  getUserAssignmentsWithDetails(userId) { return this.get(`/api/users/${userId}/assignments`); },

  getMessages(_grade, _cls, type) {
    const params = new URLSearchParams();
    if (type) params.set('type', type);
    const query = params.toString();
    return this.get(query ? `/api/messages?${query}` : '/api/messages');
  },
  sendMessage(data) { return this.post('/api/messages', data); },
  deleteMessage(id) { return this.del(`/api/messages/${id}`); },

  getUserById(id) { return this.get(`/api/users/${id}`); },
  updateUser(id, data) { return this.put(`/api/users/${id}`, data); },
  getAdminUsers() { return this.get('/api/admin/users'); },
  updateAdminUser(id, data) { return this.put(`/api/admin/users/${id}`, data); },
  deleteAdminUser(id) { return this.del(`/api/admin/users/${id}`); },

  async getNotifications() {
    const user = await this.ensureUser();
    if (!user) return [];

    const [assignments, messages] = await Promise.all([
      this.getUserAssignmentsWithDetails(user.id, user.grade, user.class_number),
      this.getMessages(user.grade, user.class_number)
    ]);

    const assignmentItems = Array.isArray(assignments)
      ? assignments.map(a => ({
          id: `assignment-${a.assignment_id}`,
          created_at: a.created_at,
          title: '새 과제',
          body: a.title,
          meta: `${a.creator_name || '선생님'} · 마감 ${a.due_date}`,
          link: 'calendar.html',
          kind: 'assignment'
        }))
      : [];

    const messageItems = Array.isArray(messages)
      ? messages.map(m => ({
          id: `message-${m.message_id}`,
          created_at: m.created_at,
          title: m.type === 'grade' ? '학년 공지' : '반 공지',
          body: m.content,
          meta: `${m.sender_name} · ${m.type === 'grade' ? `${m.target_grade}학년` : `${m.target_grade}학년 ${m.target_class}반`}`,
          link: 'messages.html',
          kind: 'message'
        }))
      : [];

    return [...assignmentItems, ...messageItems]
      .filter(item => item.created_at)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 12);
  },

  getNotificationSeenKey(userId) {
    return `notification-last-seen-${userId}`;
  },

  getNotificationSeenAt(userId) {
    return localStorage.getItem(this.getNotificationSeenKey(userId)) || '1970-01-01T00:00:00.000Z';
  },

  setNotificationSeenAt(userId, seenAt) {
    localStorage.setItem(this.getNotificationSeenKey(userId), seenAt);
  },

  formatNotificationTime(value) {
    return new Date(value).toLocaleString('ko-KR', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  },

  async initNotifications() {
    const button = document.getElementById('notificationBtn');
    const panel = document.getElementById('notificationPanel');
    const list = document.getElementById('notificationList');
    const badge = document.getElementById('notificationBadge');
    const refreshBtn = document.getElementById('notificationRefreshBtn');

    if (!button || !panel || !list || !badge) return;

    const render = async () => {
      const user = this.getUser();
      if (!user) return;

      list.innerHTML = '<div class="notification-empty">불러오는 중...</div>';
      const items = await this.getNotifications();
      const seenAt = this.getNotificationSeenAt(user.id);
      const unreadCount = items.filter(item => new Date(item.created_at) > new Date(seenAt)).length;

      if (unreadCount > 0) {
        badge.textContent = unreadCount > 9 ? '9+' : String(unreadCount);
        badge.classList.add('show');
      } else {
        badge.textContent = '0';
        badge.classList.remove('show');
      }

      if (items.length === 0) {
        list.innerHTML = '<div class="notification-empty">최근 알림이 없습니다.</div>';
        return;
      }

      list.innerHTML = items.map(item => `
        <button type="button" class="notification-item" data-link="${item.link}">
          <div class="notification-item-header">
            <span class="notification-item-title">${this.escapeHTML(item.title)}</span>
            <span class="notification-item-time">${this.formatNotificationTime(item.created_at)}</span>
          </div>
          <div class="notification-item-body">${this.escapeHTML(item.body)}</div>
          <div class="notification-item-meta">${this.escapeHTML(item.meta)}</div>
        </button>
      `).join('');
    };

    this.refreshNotifications = render;
    await render();

    button.addEventListener('click', async (e) => {
      e.stopPropagation();
      const isOpen = panel.classList.toggle('show');
      if (isOpen) {
        const user = this.getUser();
        if (user) this.setNotificationSeenAt(user.id, new Date().toISOString());
        await render();
      }
    });

    refreshBtn?.addEventListener('click', async (e) => {
      e.stopPropagation();
      await render();
    });

    list.addEventListener('click', (e) => {
      const item = e.target.closest('.notification-item');
      if (!item) return;
      panel.classList.remove('show');
      window.location.href = item.dataset.link;
    });

    document.addEventListener('click', (e) => {
      if (!panel.contains(e.target) && !button.contains(e.target)) {
        panel.classList.remove('show');
      }
    });
  },

  async refreshNotifications() {},
  async logout() {
    await this.logoutRequest();
    this.clearToken();
    this.clearUser();
    window.location.href = 'login.html';
  },

  requireAuth() {
    this.clearToken();
  },

  async loadUserInfo() {
    const user = this.normalizeUser(this.getUser());
    if (!user) return;
    const nameEl = document.getElementById('userName');
    if (nameEl) {
      nameEl.textContent = user.is_admin
        ? `${user.name || ''} (관리자)`
        : `${user.name || ''}${user.grade && user.class_number ? ' (' + user.grade + '학년 ' + user.class_number + '반)' : ''}`;
    }
  }
};
window.API = API;
