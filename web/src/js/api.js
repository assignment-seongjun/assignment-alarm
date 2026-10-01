const API = {
  currentUser: null,
  currentUserRequest: null,
  currentUserCacheTtlMs: 60 * 1000,
  currentUserFetchedAtKey: 'assignment-user-fetched-at',
  themeStorageKey: 'assignment-theme',
  themeOptions: ['system', 'dark', 'light'],
  themeMediaQuery: null,
  themeMediaBound: false,
  publicConfigRequest: null,
  publicConfigCacheTtlMs: 5 * 60 * 1000,
  publicConfigCacheKey: 'assignment-public-config-cache',
  notificationRequest: null,
  notificationCache: null,
  notificationCacheTtlMs: 20 * 1000,
  storageGet(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  storageSet(key, value) {
    try { localStorage.setItem(key, value); } catch {}
  },
  storageRemove(key) {
    try { localStorage.removeItem(key); } catch {}
  },
  normalizeFlag(value) { return value === true || value === 1 || value === '1'; },
  getToken() { return null; },
  setToken() {
    this.storageRemove('token');
  },
  clearToken() {
    this.storageRemove('token');
  },
  getUser() {
    try {
      return this.normalizeUser(this.currentUser || JSON.parse(this.storageGet('user') || 'null'));
    } catch {
      return null;
    }
  },
  setUser(u) {
    const prevUser = this.getUser();
    const user = this.normalizeUser(u);
    this.currentUser = user;
    this.storageSet('user', JSON.stringify(user));
    this.setCurrentUserFetchedAt();
    if (!prevUser || String(prevUser.id) !== String(user?.id)) {
      this.clearNotificationCache();
    }
  },
  clearUser() {
    const hadUser = Boolean(this.getUser());
    this.currentUser = null;
    this.storageRemove('user');
    this.storageRemove(this.currentUserFetchedAtKey);
    if (hadUser) {
      this.clearNotificationCache();
    }
  },

  getCurrentUserFetchedAt() {
    try {
      const value = Number.parseInt(this.storageGet(this.currentUserFetchedAtKey) || '0', 10);
      return Number.isFinite(value) ? value : 0;
    } catch {
      return 0;
    }
  },

  setCurrentUserFetchedAt(value = Date.now()) {
    try {
      this.storageSet(this.currentUserFetchedAtKey, String(value));
    } catch {}
  },

  getTheme() {
    try {
      const savedTheme = this.storageGet(this.themeStorageKey);
      return this.themeOptions.includes(savedTheme) ? savedTheme : 'system';
    } catch {
      return 'system';
    }
  },

  getResolvedTheme(theme = this.getTheme()) {
    if (theme === 'dark' || theme === 'light') return theme;
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'light';
  },

  applyTheme(theme = this.getTheme()) {
    const nextTheme = this.themeOptions.includes(theme) ? theme : 'system';
    const resolvedTheme = this.getResolvedTheme(nextTheme);
    const root = document.documentElement;
    const body = document.body;
    root.classList.toggle('theme-dark', resolvedTheme === 'dark');
    root.dataset.theme = resolvedTheme;
    root.dataset.themePreference = nextTheme;
    if (body) {
      body.classList.toggle('theme-dark', resolvedTheme === 'dark');
      body.dataset.theme = resolvedTheme;
      body.dataset.themePreference = nextTheme;
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('themechange', {
        detail: { theme: nextTheme, resolvedTheme }
      }));
    }
  },

  setTheme(theme) {
    const nextTheme = this.themeOptions.includes(theme) ? theme : 'system';
    try {
      this.storageSet(this.themeStorageKey, nextTheme);
    } catch {}
    this.applyTheme(nextTheme);
    return nextTheme;
  },

  initTheme() {
    if (!this.themeMediaBound && typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      this.themeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handleThemeMediaChange = () => {
        if (this.getTheme() === 'system') {
          this.applyTheme('system');
        }
      };
      if (typeof this.themeMediaQuery.addEventListener === 'function') {
        this.themeMediaQuery.addEventListener('change', handleThemeMediaChange);
      } else if (typeof this.themeMediaQuery.addListener === 'function') {
        this.themeMediaQuery.addListener(handleThemeMediaChange);
      }
      this.themeMediaBound = true;
    }
    this.applyTheme(this.getTheme());
  },

  escapeHTML(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  isSafeContentUrl(value) {
    if (!value) return false;
    try {
      const url = new URL(String(value).trim(), window.location.origin);
      return ['http:', 'https:'].includes(url.protocol);
    } catch {
      return false;
    }
  },

  isSafeContentImageUrl(value) {
    if (!this.isSafeContentUrl(value)) return false;
    try {
      const url = new URL(String(value).trim(), window.location.origin);
      if (url.origin === window.location.origin) {
        return url.pathname.startsWith('/uploads/');
      }
      return true;
    } catch {
      return false;
    }
  },

  renderTextWithLinks(value) {
    const text = String(value ?? '');
    if (!text) return '';

    const tokenPattern = /!\[([^\]]*)\]\(([^)\s]+)\)|\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<]+)/g;
    const parts = [];
    let lastIndex = 0;
    let match;

    while ((match = tokenPattern.exec(text)) !== null) {
      const [fullMatch, imageAlt, imageUrl, linkLabel, linkUrl, bareUrl] = match;
      if (match.index > lastIndex) {
        parts.push(this.escapeHTML(text.slice(lastIndex, match.index)));
      }

      if (imageUrl !== undefined) {
        if (this.isSafeContentImageUrl(imageUrl)) {
          const safeSrc = this.escapeHTML(new URL(String(imageUrl).trim(), window.location.origin).toString());
          const safeAlt = this.escapeHTML(imageAlt || '첨부 이미지');
          parts.push(`<img class="assignment-inline-image" src="${safeSrc}" alt="${safeAlt}" loading="lazy">`);
        } else {
          parts.push(this.escapeHTML(fullMatch));
        }
      } else if (linkUrl !== undefined) {
        if (this.isSafeContentUrl(linkUrl)) {
          const safeHref = this.escapeHTML(new URL(String(linkUrl).trim(), window.location.origin).toString());
          const safeLabel = this.escapeHTML(linkLabel);
          parts.push(`<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${safeLabel}</a>`);
        } else {
          parts.push(this.escapeHTML(fullMatch));
        }
      } else if (bareUrl) {
        if (this.isSafeContentUrl(bareUrl)) {
          const safeHref = this.escapeHTML(new URL(String(bareUrl).trim(), window.location.origin).toString());
          const safeLabel = this.escapeHTML(bareUrl);
          parts.push(`<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${safeLabel}</a>`);
        } else {
          parts.push(this.escapeHTML(fullMatch));
        }
      }

      lastIndex = match.index + fullMatch.length;
    }

    if (lastIndex < text.length) {
      parts.push(this.escapeHTML(text.slice(lastIndex)));
    }

    return parts.join('');
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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        signal: controller.signal,
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      let data;
      try { data = await res.json(); } catch {
        return { success: false, status: res.status, error: '서버가 응답하지 않습니다. 잠시 후 다시 시도해주세요.' };
      }
      const isAuthRequest = ['/api/auth/login', '/api/auth/register', '/api/auth/google', '/api/auth/google/register'].includes(url);
      if (res.status === 401 && !isAuthRequest) {
        this.clearToken();
        this.clearUser();
        if (!this.isLoginPage()) window.location.href = 'login.html';
        return { success: false, status: 401, error: '인증이 만료되었습니다.' };
      }
      if (!res.ok) {
        return { success: false, status: res.status, error: data?.error || '요청을 처리하지 못했습니다. 다시 시도해주세요.' };
      }
      return data;
    } catch (error) {
      return { success: false, error: error?.name === 'AbortError'
        ? '응답 시간이 초과되었습니다. 다시 시도해주세요.'
        : '서버에 연결할 수 없습니다. 인터넷 연결을 확인하고 다시 시도해주세요.' };
    } finally {
      clearTimeout(timeout);
    }
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

  getCachedPublicConfig() {
    try {
      const cached = JSON.parse(this.storageGet(this.publicConfigCacheKey) || 'null');
      if (!cached || typeof cached !== 'object') return null;
      if (!cached.fetchedAt || Date.now() - Number(cached.fetchedAt) > this.publicConfigCacheTtlMs) return null;
      return cached.value || null;
    } catch {
      return null;
    }
  },

  setCachedPublicConfig(value) {
    try {
      this.storageSet(this.publicConfigCacheKey, JSON.stringify({
        value,
        fetchedAt: Date.now()
      }));
    } catch {}
  },

  async publicConfig(options = {}) {
    const force = Boolean(options?.force);
    if (!force) {
      const cached = this.getCachedPublicConfig();
      if (cached) return cached;
    }

    if (this.publicConfigRequest) {
      return this.publicConfigRequest;
    }

    this.publicConfigRequest = this.get('/api/public-config')
      .then((config) => {
        const normalized = config && typeof config === 'object' ? config : {};
        this.setCachedPublicConfig(normalized);
        return normalized;
      })
      .finally(() => {
        this.publicConfigRequest = null;
      });

    return this.publicConfigRequest;
  },

  normalizeUser(u) {
    if (!u) return null;
    return {
      id: u.id || u.user_id,
      name: u.name,
      grade: u.grade,
      class_number: u.class_number,
      profile_image_url: u.profile_image_url || null,
      is_alarm_enabled: this.normalizeFlag(u.is_alarm_enabled),
      is_admin: this.normalizeFlag(u.is_admin)
    };
  },

  async ensureUser(options = {}) {
    const force = Boolean(options?.force);
    const cachedUser = this.getUser();
    const fetchedAt = this.getCurrentUserFetchedAt();
    if (!force && cachedUser?.id && cachedUser.grade && cachedUser.class_number && Date.now() - fetchedAt < this.currentUserCacheTtlMs) {
      return cachedUser;
    }

    if (this.currentUserRequest) {
      return this.currentUserRequest;
    }

    this.currentUserRequest = this.me()
      .then((serverUser) => {
        if (serverUser?.error && serverUser.status !== 401) throw new Error(serverUser.error);
        const user = this.normalizeUser(serverUser);
        if (user && user.id && user.grade && user.class_number) {
          this.setUser(user);
          return user;
        }

        this.clearToken();
        this.clearUser();
        window.location.href = 'login.html';
        return null;
      })
      .finally(() => {
        this.currentUserRequest = null;
      });

    return this.currentUserRequest;
  },

  getAssignments() { return this.get('/api/assignments'); },
  getAssignmentStatus(id) { return this.get(`/api/assignments/${id}/status`); },
  createAssignment(data) { return this.post('/api/assignments', data); },
  updateAssignment(id, data) { return this.put(`/api/assignments/${id}`, data); },
  deleteAssignment(id) { return this.del(`/api/assignments/${id}`); },
  uploadAssignmentImage(dataUrl, fileName) { return this.post('/api/uploads/assignment-image', { image_data_url: dataUrl, file_name: fileName || null }); },

  getUserAssignments(userId) { return this.get(`/api/user-assignments/${userId}`); },
  toggleAssignment(assignmentId, completed) { return this.put('/api/user-assignments', { assignment_id: assignmentId, is_completed: completed }); },
  getUserAssignmentsWithDetails(userId) { return this.get(`/api/users/${userId}/assignments`); },

  getAdminAssignments(params = {}) {
    const query = new URLSearchParams();
    if (params.page) query.set('page', String(params.page));
    if (params.pageSize) query.set('pageSize', String(params.pageSize));
    if (params.grade) query.set('grade', String(params.grade));
    if (params.class_number) query.set('class_number', String(params.class_number));
    return this.get(query.toString() ? `/api/admin/assignments?${query}` : '/api/admin/assignments');
  },

  getMessages(_grade, _cls, type) {
    const params = new URLSearchParams();
    if (type) params.set('type', type);
    const query = params.toString();
    return this.get(query ? `/api/messages?${query}` : '/api/messages');
  },
  getAdminMessages(params = {}) {
    const query = new URLSearchParams();
    if (params.page) query.set('page', String(params.page));
    if (params.pageSize) query.set('pageSize', String(params.pageSize));
    if (params.type) query.set('type', String(params.type));
    if (params.grade) query.set('grade', String(params.grade));
    if (params.class_number) query.set('class_number', String(params.class_number));
    return this.get(query.toString() ? `/api/admin/messages?${query}` : '/api/admin/messages');
  },
  sendMessage(data) { return this.post('/api/messages', data); },
  deleteMessage(id) { return this.del(`/api/messages/${id}`); },
  // AI 챗봇은 현재 비활성화되어 있습니다. 복구 시 서버 구현과 함께 검토하세요.
  // sendChatMessage(message, history = []) { return this.post('/api/chatbot', { message, history }); },

  getUserById(id) { return this.get(`/api/users/${id}`); },
  updateUser(id, data) { return this.put(`/api/users/${id}`, data); },
  getAdminUsers(params = {}) {
    const query = new URLSearchParams();
    if (params.page) query.set('page', String(params.page));
    if (params.pageSize) query.set('pageSize', String(params.pageSize));
    return this.get(query.toString() ? `/api/admin/users?${query}` : '/api/admin/users');
  },
  updateAdminUser(id, data) { return this.put(`/api/admin/users/${id}`, data); },
  deleteAdminUser(id) { return this.del(`/api/admin/users/${id}`); },

  clearNotificationCache() {
    this.notificationCache = null;
    this.notificationRequest = null;
  },

  async getNotifications(options = {}) {
    const user = this.getUser();
    if (!user) return [];
    const force = Boolean(options?.force);
    const userId = String(user.id);

    if (!force && this.notificationCache?.userId === userId && Date.now() - this.notificationCache.fetchedAt < this.notificationCacheTtlMs) {
      return this.notificationCache.items;
    }

    if (this.notificationRequest?.userId === userId) {
      return this.notificationRequest.promise;
    }

    const promise = this.get('/api/notifications')
      .then((items) => {
        if (!Array.isArray(items)) return items;
        const normalized = items;
        this.notificationCache = {
          userId,
          items: normalized,
          fetchedAt: Date.now()
        };
        return normalized;
      })
      .finally(() => {
        if (this.notificationRequest?.userId === userId) {
          this.notificationRequest = null;
        }
      });

    this.notificationRequest = { userId, promise };
    return promise;
  },

  getNotificationSeenKey(userId) {
    return `notification-last-seen-${userId}`;
  },

  getNotificationSeenAt(userId) {
    return this.storageGet(this.getNotificationSeenKey(userId)) || '1970-01-01T00:00:00.000Z';
  },

  setNotificationSeenAt(userId, seenAt) {
    this.storageSet(this.getNotificationSeenKey(userId), seenAt);
  },

  safeInternalLink(value) {
    try {
      const url = new URL(String(value || ''), window.location.origin + '/');
      if (url.origin !== window.location.origin || !['/calendar.html', '/register.html', '/messages.html', '/settings.html'].includes(url.pathname)) return '';
      return url.pathname + url.search + url.hash;
    } catch { return ''; }
  },

  formatNotificationTime(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    return date.toLocaleString('ko-KR', {
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
    if (button.dataset.notificationsBound === '1') {
      await this.refreshNotifications();
      return;
    }
    button.dataset.notificationsBound = '1';

    let latestRenderedNotificationAt = null;

    const getTimestamp = (value) => {
      const time = new Date(value).getTime();
      return Number.isFinite(time) ? time : 0;
    };

    const positionPanel = () => {
      if (!panel.classList.contains('show')) return;

      if (window.innerWidth <= 640) {
        const buttonRect = button.getBoundingClientRect();
        const viewportPadding = 12;
        const panelWidth = Math.min(340, window.innerWidth - viewportPadding * 2);
        const left = Math.max(
          viewportPadding,
          Math.min(window.innerWidth - viewportPadding - panelWidth, buttonRect.right - panelWidth)
        );

        panel.style.position = 'fixed';
        panel.style.top = `${buttonRect.bottom + 10}px`;
        panel.style.left = `${left}px`;
        panel.style.right = 'auto';
        panel.style.width = `${panelWidth}px`;
      } else {
        panel.style.position = '';
        panel.style.top = '';
        panel.style.left = '';
        panel.style.right = '';
        panel.style.width = '';
      }
    };

      const render = async ({ force = false } = {}) => {
        const user = this.getUser();
        if (!user) return;

        const hasFreshCache = !force
          && this.notificationCache?.userId === String(user.id)
          && Date.now() - this.notificationCache.fetchedAt < this.notificationCacheTtlMs;

        if (!hasFreshCache) {
          list.innerHTML = '<div class="notification-empty">불러오는 중...</div>';
        }

        const items = await this.getNotifications({ force });
        if (!Array.isArray(items)) {
          list.innerHTML = `<div class="notification-empty" role="status">${this.escapeHTML(items?.error || '알림을 불러오지 못했습니다.')}</div>`;
          return;
        }
        latestRenderedNotificationAt = items.reduce((latest, item) => {
          return getTimestamp(item.created_at) > getTimestamp(latest) ? item.created_at : latest;
        }, null);

      const seenAt = this.getNotificationSeenAt(user.id);
      const seenTime = getTimestamp(seenAt);
      const unreadCount = items.filter(item => getTimestamp(item.created_at) > seenTime).length;

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
        <button type="button" class="notification-item" data-link="${this.escapeHTML(this.safeInternalLink(item.link))}">
          <div class="notification-item-header">
            <span class="notification-item-title">${this.escapeHTML(item.title)}</span>
            <span class="notification-item-time">${this.formatNotificationTime(item.created_at)}</span>
          </div>
          <div class="notification-item-body">${this.escapeHTML(item.body)}</div>
          <div class="notification-item-meta">${this.escapeHTML(item.meta)}</div>
        </button>
      `).join('');
    };

    const markCurrentNotificationsSeen = () => {
      const user = this.getUser();
      if (!user || !latestRenderedNotificationAt) return;
      this.setNotificationSeenAt(user.id, latestRenderedNotificationAt);
      badge.textContent = '0';
      badge.classList.remove('show');
    };

      const refreshIfVisible = async () => {
        if (document.visibilityState !== 'visible') return;
        await render();
        positionPanel();
      };

      this.refreshNotifications = async (options = {}) => render(options);
      await render();

    button.addEventListener('click', async (e) => {
      e.stopPropagation();
        const isOpen = panel.classList.toggle('show');
        button.setAttribute('aria-expanded', String(isOpen));
        if (isOpen) {
          positionPanel();
          await render();
        markCurrentNotificationsSeen();
        positionPanel();
      }
    });

      refreshBtn?.addEventListener('click', async (e) => {
        e.stopPropagation();
        await render({ force: true });
        if (panel.classList.contains('show')) markCurrentNotificationsSeen();
      });

    list.addEventListener('click', (e) => {
      const item = e.target.closest('.notification-item');
      if (!item) return;
      panel.classList.remove('show');
      button.setAttribute('aria-expanded', 'false');
      const link = this.safeInternalLink(item.dataset.link);
      if (link) window.location.href = link;
    });

    document.addEventListener('click', (e) => {
      if (!panel.contains(e.target) && !button.contains(e.target)) {
        panel.classList.remove('show');
        button.setAttribute('aria-expanded', 'false');
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && panel.classList.contains('show')) {
        panel.classList.remove('show');
        button.setAttribute('aria-expanded', 'false');
        button.focus();
      }
    });

    document.addEventListener('visibilitychange', () => {
      refreshIfVisible().catch(() => {});
    });
      window.addEventListener('focus', () => {
        refreshIfVisible().catch(() => {});
      });
      window.setInterval(() => {
        refreshIfVisible().catch(() => {});
      }, 60000);
      window.addEventListener('resize', positionPanel);
    },

  async refreshNotifications() {},
  async logout() {
    const result = await this.logoutRequest();
    if (!result?.success) {
      alert(result?.error || '로그아웃하지 못했습니다. 다시 시도해주세요.');
      return;
    }
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
API.initTheme();
window.API = API;
