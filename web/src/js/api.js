const API = {
  getToken() { return localStorage.getItem('token'); },
  setToken(t) { localStorage.setItem('token', t); },
  clearToken() { localStorage.removeItem('token'); },
  getUser() { return JSON.parse(localStorage.getItem('user') || 'null'); },
  setUser(u) { localStorage.setItem('user', JSON.stringify(u)); },
  clearUser() { localStorage.removeItem('user'); },

  async request(method, url, body) {
    const headers = { 'Content-Type': 'application/json' };
    const token = this.getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    if (res.status === 401) {
      this.clearToken();
      this.clearUser();
      window.location.href = 'login.html';
      return;
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

  getAssignments(grade, cls) { return this.get(`/api/assignments?grade=${grade}&class=${cls || ''}`); },
  createAssignment(data) { return this.post('/api/assignments', data); },
  updateAssignment(id, data) { return this.put(`/api/assignments/${id}`, data); },
  deleteAssignment(id) { return this.del(`/api/assignments/${id}`); },

  getUserAssignments(userId) { return this.get(`/api/user-assignments/${userId}`); },
  toggleAssignment(assignmentId, completed) { return this.put('/api/user-assignments', { assignment_id: assignmentId, is_completed: completed }); },
  getUserAssignmentsWithDetails(userId, grade, cls) { return this.get(`/api/users/${userId}/assignments?grade=${grade}&class=${cls || ''}`); },

  getMessages(grade, cls) { return this.get(`/api/messages?grade=${grade}&class=${cls || ''}`); },
  sendMessage(data) { return this.post('/api/messages', data); },

  getUser(id) { return this.get(`/api/users/${id}`); },
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
    const user = this.getUser();
    if (!user) return;
    const nameEl = document.getElementById('userName');
    if (nameEl) nameEl.textContent = `${user.name} (${user.grade}학년 ${user.class_number}반)`;
  }
};
