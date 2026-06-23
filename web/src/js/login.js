let googleClientId = null;
    let googleSetupToken = null;
    let googleButtonRendered = false;

    function showError(msg) {
      const el = document.getElementById('authError');
      el.textContent = msg;
      el.style.display = 'block';
    }

    function hideError() {
      document.getElementById('authError').style.display = 'none';
    }

    function showLoginForm() {
      hideError();
      document.getElementById('googleProfileForm').style.display = 'none';
      document.getElementById('loginForm').style.display = 'block';
    }

    function showGoogleProfileForm(profile, setupToken) {
      hideError();
      googleSetupToken = setupToken;
      document.getElementById('loginForm').style.display = 'none';
      document.getElementById('googleProfileForm').style.display = 'block';
      document.getElementById('googleProfileName').value = profile?.name || '';
      document.getElementById('googleProfileEmail').value = profile?.email || '';
    }

    function getGoogleApi() {
      return window.google?.accounts?.id || null;
    }

    async function handleGoogleCredential(credential) {
      hideError();
      const res = await API.googleAuth(credential);
      if (!res || res.error) {
        showError(res?.error || '구글 로그인에 실패했습니다.');
        return;
      }
      if (res.requiresProfile) {
        showGoogleProfileForm(res.profile, res.setupToken);
        return;
      }
      API.setUser(res.user);
      window.location.href = 'calendar.html';
    }

    function renderGoogleLoginIfNeeded() {
      if (!googleClientId || googleButtonRendered) return;

      const api = getGoogleApi();
      if (!api) {
        window.setTimeout(renderGoogleLoginIfNeeded, 200);
        return;
      }

      document.getElementById('googleDivider').style.display = 'block';
      document.getElementById('googleLoginBox').style.display = 'block';
      document.getElementById('googleDomainHint').style.display = 'block';
      api.initialize({
        client_id: googleClientId,
        ux_mode: 'popup',
        callback: async (response) => {
          if (!response?.credential) {
            showError('구글 인증 결과를 가져오지 못했습니다.');
            return;
          }
          await handleGoogleCredential(response.credential);
        }
      });
      api.renderButton(
        document.getElementById('googleLoginButton'),
        {
          theme: 'outline',
          size: 'large',
          width: 340,
          text: 'signin_with',
          shape: 'rectangular'
        }
      );
      googleButtonRendered = true;
    }

    async function loadPublicConfig() {
      const config = await API.publicConfig();
      if (config && config.googleClientId) {
        googleClientId = config.googleClientId;
        renderGoogleLoginIfNeeded();
        return;
      }
      showError('구글 로그인이 아직 설정되지 않았습니다.');
    }

    document.getElementById('cancelGoogleSetup').addEventListener('click', () => {
      googleSetupToken = null;
      showLoginForm();
    });

    document.getElementById('googleProfileBtn').addEventListener('click', async () => {
      hideError();
      if (!googleSetupToken) {
        showError('구글 가입 정보가 만료되었습니다. 다시 로그인해주세요.');
        showLoginForm();
        return;
      }

      const payload = {
        setupToken: googleSetupToken,
        grade: parseInt(document.getElementById('googleGrade').value, 10),
        class_number: parseInt(document.getElementById('googleClass').value, 10)
      };
      const res = await API.googleRegister(payload);
      if (!res || res.error) {
        showError(res?.error || '구글 가입을 완료하지 못했습니다.');
        return;
      }
      API.setUser(res.user);
      window.location.href = 'calendar.html';
    });

    API.me().then(data => {
      if (data && data.user_id) {
        API.setUser({ id: data.user_id, name: data.name, grade: data.grade, class_number: data.class_number, profile_image_url: data.profile_image_url, is_alarm_enabled: data.is_alarm_enabled, is_admin: data.is_admin });
        window.location.href = 'calendar.html';
      }
    }).catch(() => {});

    loadPublicConfig().catch(() => {});
