const API = {
  currentUser: null,
  getToken() { return localStorage.getItem('token'); },
  setToken(t) { localStorage.setItem('token', t); },
  clearToken() { localStorage.removeItem('token'); },
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

  async request(method, url, body) {
    const headers = { 'Content-Type': 'application/json' };
    const hadToken = !!this.getToken();
    const token = this.getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    if (res.status === 401) {
      if (hadToken) {
        this.clearToken();
        this.clearUser();
        window.location.href = 'login.html';
        return { error: '인증이 만료되었습니다.' };
      }
      return res.json();
    }
    return res.json();
  },

  get(url) { return this.request('GET', url); },
  post(url, body) { return this.request('POST', url, body); },
  put(url, body) { return this.request('PUT', url, body); },
  del(url) { return this.request('DELETE', url); },

  login(email, password) { return this.post('/api/auth/login', { email, password }); },
  register(data) { return this.post('/api/auth/register', data); },
  me() { return this.get('/api/auth/me'); },

  normalizeUser(u) {
    if (!u) return null;
    return {
      id: u.id || u.user_id,
      email: u.email,
      name: u.name,
      grade: u.grade,
      class_number: u.class_number,
      profile_image_url: u.profile_image_url || null,
      is_alarm_enabled: u.is_alarm_enabled
    };
  },

  async ensureUser() {
    const cached = this.normalizeUser(this.getUser());
    if (cached && cached.id && cached.grade && cached.class_number) {
      this.setUser(cached);
      return cached;
    }

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

  getAssignments(grade, cls) { return this.get(`/api/assignments?grade=${encodeURIComponent(grade)}&class=${encodeURIComponent(cls || '')}`); },
  createAssignment(data) { return this.post('/api/assignments', data); },
  updateAssignment(id, data) { return this.put(`/api/assignments/${id}`, data); },
  deleteAssignment(id) { return this.del(`/api/assignments/${id}`); },

  getUserAssignments(userId) { return this.get(`/api/user-assignments/${userId}`); },
  toggleAssignment(assignmentId, completed) { return this.put('/api/user-assignments', { assignment_id: assignmentId, is_completed: completed }); },
  getUserAssignmentsWithDetails(userId, grade, cls) { return this.get(`/api/users/${userId}/assignments?grade=${encodeURIComponent(grade)}&class=${encodeURIComponent(cls || '')}`); },

  getMessages(grade, cls, type) {
    const params = new URLSearchParams({
      grade: String(grade),
      class: String(cls || '')
    });
    if (type) params.set('type', type);
    return this.get(`/api/messages?${params.toString()}`);
  },
  sendMessage(data) { return this.post('/api/messages', data); },
  deleteMessage(id) { return this.del(`/api/messages/${id}`); },

  getUserById(id) { return this.get(`/api/users/${id}`); },
  updateUser(id, data) { return this.put(`/api/users/${id}`, data); },

  logout() {
    this.clearToken();
    this.clearUser();
    window.location.href = 'login.html';
  },

  requireAuth() {
    if (!this.getToken()) window.location.href = 'login.html';
  },

  async loadUserInfo() {
    const user = this.normalizeUser(this.getUser());
    if (!user) return;
    const nameEl = document.getElementById('userName');
    if (nameEl) nameEl.textContent = `${user.name || ''}${user.grade && user.class_number ? ' (' + user.grade + '학년 ' + user.class_number + '반)' : ''}`;
  }
};

window.API = API;
