API.requireAuth();
    let adminGradeFilter = 'all';
    let adminClassFilter = 'all';
    let editingAssignmentId = null;
    let isUploadingTaskImage = false;

    async function init() {
      const user = await API.ensureUser();
      if (!user) return;
      API.loadUserInfo();
      API.initNotifications().catch(() => {});
      document.getElementById('targetScope').value = user.is_admin ? '관리자는 원하는 학년/반을 선택해서 과제를 등록할 수 있습니다.' : `${user.grade}학년 ${user.class_number}반`;
      document.getElementById('assignmentListTitle').textContent = user.is_admin ? '전체 과제 관리' : '내가 등록한 과제';
      initAdminFilters(user);
      initTargetSelectors(user);
      resetAssignmentForm();
      await loadMyAssignments();
    }

    function initTargetSelectors(user) {
      if (!user || !user.is_admin) return;
      const row = document.getElementById('adminTargetRow');
      const gradeSelect = document.getElementById('adminTargetGrade');
      const classSelect = document.getElementById('adminTargetClass');
      row.style.display = 'flex';
      gradeSelect.innerHTML = Array.from({ length: 3 }, (_, i) => `<option value="${i + 1}">${i + 1}학년</option>`).join('');
      classSelect.innerHTML = Array.from({ length: 4 }, (_, i) => `<option value="${i + 1}">${i + 1}반</option>`).join('');
      gradeSelect.value = String(user.grade || 1);
      classSelect.value = String(user.class_number || 1);
    }

    function initAdminFilters(user) {
      if (!user || !user.is_admin) return;

      const wrap = document.getElementById('adminAssignmentFilter');
      const gradeSelect = document.getElementById('adminAssignmentGradeFilter');
      const classSelect = document.getElementById('adminAssignmentClassFilter');

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

    function getVisibleAssignments(user, data) {
      if (!user.is_admin) {
        return data ? data.filter(a => Number(a.created_by) === Number(user.id)) : [];
      }

      return (data || []).filter(a => {
        const gradeMatch = adminGradeFilter === 'all' || String(a.target_grade) === adminGradeFilter;
        const classMatch = adminClassFilter === 'all' || String(a.target_class) === adminClassFilter;
        return gradeMatch && classMatch;
      });
    }

    function renderContentPreview() {
      const value = document.getElementById('taskContent').value.trim();
      const wrap = document.getElementById('taskContentPreviewWrap');
      const preview = document.getElementById('taskContentPreview');
      if (!value) {
        wrap.style.display = 'none';
        preview.innerHTML = '';
        return;
      }

      wrap.style.display = 'block';
      preview.innerHTML = API.renderTextWithLinks(value);
    }

    function insertTextAtCursor(element, text) {
      const start = element.selectionStart ?? element.value.length;
      const end = element.selectionEnd ?? element.value.length;
      const currentValue = element.value;
      element.value = `${currentValue.slice(0, start)}${text}${currentValue.slice(end)}`;
      const nextPosition = start + text.length;
      element.focus();
      element.setSelectionRange(nextPosition, nextPosition);
      renderContentPreview();
    }

    function readFileAsDataUrl(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('file-read-failed'));
        reader.readAsDataURL(file);
      });
    }

    async function uploadImagesToContent(files) {
      if (isUploadingTaskImage) return;
      const imageFiles = Array.from(files || []).filter(file => file && String(file.type || '').startsWith('image/'));
      if (imageFiles.length === 0) return;

      const contentField = document.getElementById('taskContent');
      isUploadingTaskImage = true;

      try {
        for (const file of imageFiles) {
          const dataUrl = await readFileAsDataUrl(file);
          const result = await API.uploadAssignmentImage(dataUrl, file.name);
          if (!result || !result.success || !result.markdown) {
            throw new Error(result?.error || 'image-upload-failed');
          }

          const prefix = contentField.value && !contentField.value.endsWith('\n') ? '\n' : '';
          insertTextAtCursor(contentField, `${prefix}${result.markdown}\n`);
        }
      } catch (error) {
        alert(error?.message || '이미지 업로드에 실패했습니다.');
      } finally {
        isUploadingTaskImage = false;
      }
    }

    function resetAssignmentForm() {
      editingAssignmentId = null;
      document.getElementById('assignmentFormTitle').textContent = '새 과제 등록';
      document.getElementById('saveBtn').textContent = '등록하기';
      document.getElementById('cancelEditBtn').style.display = 'none';
      document.getElementById('taskTitle').value = '';
      document.getElementById('taskContent').value = '';
      document.getElementById('taskDate').value = new Date().toISOString().split('T')[0];
      document.getElementById('taskImageInput').value = '';
      renderContentPreview();

      const user = API.getUser();
      if (user && user.is_admin) {
        document.getElementById('adminTargetGrade').value = String(user.grade || 1);
        document.getElementById('adminTargetClass').value = String(user.class_number || 1);
      }
    }

    function startEditAssignment(assignment) {
      editingAssignmentId = assignment.assignment_id;
      document.getElementById('assignmentFormTitle').textContent = '과제 수정';
      document.getElementById('saveBtn').textContent = '수정하기';
      document.getElementById('cancelEditBtn').style.display = 'inline-flex';
      document.getElementById('taskTitle').value = assignment.title || '';
      document.getElementById('taskContent').value = assignment.content || '';
      document.getElementById('taskDate').value = assignment.due_date || '';

      const user = API.getUser();
      if (user && user.is_admin) {
        document.getElementById('adminTargetGrade').value = String(assignment.target_grade || user.grade || 1);
        document.getElementById('adminTargetClass').value = String(assignment.target_class || user.class_number || 1);
      }

      renderContentPreview();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    async function loadMyAssignments() {
      const user = await API.ensureUser();
      if (!user) return;
      const data = await API.getAssignments(user.grade, user.class_number);
      const visibleAssignments = getVisibleAssignments(user, data);
      const container = document.getElementById('myAssignments');
      if (visibleAssignments.length === 0) {
        container.innerHTML = `<div class="empty-state">${user.is_admin ? '등록된 과제가 없습니다.' : '등록한 과제가 없습니다.'}</div>`;
        return;
      }
      container.innerHTML = visibleAssignments.map(a => `
        <div class="assignment-item">
          <div class="info">
            <div class="title">${API.escapeHTML(a.title)}</div>
            ${a.content ? `<div class="detail">${API.renderTextWithLinks(a.content)}</div>` : ''}
            <div class="meta">${API.escapeHTML(a.due_date)} · ${API.escapeHTML(a.target_class ? a.target_grade + '학년 ' + a.target_class + '반' : a.target_grade + '학년 전체')} · ${API.escapeHTML(a.creator_name || '')}</div>
          </div>
          <div class="actions">
            <button class="btn btn-secondary btn-sm edit-my" data-id="${a.assignment_id}">수정</button>
            <button class="btn btn-danger btn-sm delete-my" data-id="${a.assignment_id}">삭제</button>
          </div>
        </div>
      `).join('');
    }

    document.getElementById('saveBtn').addEventListener('click', async () => {
      if (isUploadingTaskImage) {
        alert('이미지 업로드가 끝난 뒤 다시 시도해주세요.');
        return;
      }

      const title = document.getElementById('taskTitle').value.trim();
      const content = document.getElementById('taskContent').value.trim();
      const due_date = document.getElementById('taskDate').value;

      if (!title || !due_date) { alert('과제명과 마감일을 입력해주세요.'); return; }

      const user = API.getUser();
      const payload = { title, content: content || null, due_date };
      if (user && user.is_admin) {
        payload.target_grade = parseInt(document.getElementById('adminTargetGrade').value, 10);
        payload.target_class = parseInt(document.getElementById('adminTargetClass').value, 10);
      }

      const res = editingAssignmentId
        ? await API.updateAssignment(editingAssignmentId, payload)
        : await API.createAssignment(payload);
      if (res && res.success) {
        alert(editingAssignmentId ? '과제가 수정되었습니다.' : '과제가 등록되었습니다.');
        resetAssignmentForm();
        await loadMyAssignments();
        await API.refreshNotifications();
      } else {
        alert(res?.error || (editingAssignmentId ? '수정에 실패했습니다.' : '등록에 실패했습니다.'));
      }
    });

    document.getElementById('insertImageBtn').addEventListener('click', () => {
      document.getElementById('taskImageInput').click();
    });

    document.getElementById('taskImageInput').addEventListener('change', async (event) => {
      await uploadImagesToContent(event.target.files);
      event.target.value = '';
    });

    document.getElementById('taskContent').addEventListener('paste', async (event) => {
      const imageFiles = Array.from(event.clipboardData?.items || [])
        .filter(item => item.kind === 'file' && String(item.type || '').startsWith('image/'))
        .map(item => item.getAsFile())
        .filter(Boolean);

      if (imageFiles.length === 0) return;
      event.preventDefault();
      await uploadImagesToContent(imageFiles);
    });

    document.getElementById('taskContent').addEventListener('input', () => {
      renderContentPreview();
    });

    document.getElementById('myAssignments').addEventListener('click', async (e) => {
      if (e.target.classList.contains('edit-my')) {
        const assignmentId = parseInt(e.target.dataset.id, 10);
        const user = API.getUser();
        if (!user) return;
        const data = await API.getAssignments();
        const visibleAssignments = getVisibleAssignments(user, Array.isArray(data) ? data : []);
        const targetAssignment = visibleAssignments.find(assignment => Number(assignment.assignment_id) === assignmentId);
        if (!targetAssignment) {
          alert('과제 정보를 찾지 못했습니다.');
          return;
        }
        startEditAssignment(targetAssignment);
        return;
      }

      if (e.target.classList.contains('delete-my')) {
        if (!confirm('정말 삭제하시겠습니까?')) return;
        const res = await API.deleteAssignment(parseInt(e.target.dataset.id));
        if (!res || !res.success) { alert(res?.error || '삭제에 실패했습니다.'); return; }
        if (editingAssignmentId === parseInt(e.target.dataset.id, 10)) {
          resetAssignmentForm();
        }
        await loadMyAssignments();
        await API.refreshNotifications();
      }
    });

    document.getElementById('cancelEditBtn').addEventListener('click', () => {
      resetAssignmentForm();
    });

    document.getElementById('adminAssignmentGradeFilter').addEventListener('change', async (e) => {
      adminGradeFilter = e.target.value;
      if (adminGradeFilter === 'all') {
        adminClassFilter = 'all';
        document.getElementById('adminAssignmentClassFilter').value = 'all';
      }
      await loadMyAssignments();
    });

    document.getElementById('adminAssignmentClassFilter').addEventListener('change', async (e) => {
      adminClassFilter = e.target.value;
      await loadMyAssignments();
    });

    init();
