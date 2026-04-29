
const authForm = document.getElementById('authForm');
const registerFields = document.getElementById('registerFields');
const submitButton = document.getElementById('submitButton');
const formHint = document.getElementById('formHint');
const roleSelect = document.getElementById('role');

function showHint(message, isError = false) {
  formHint.textContent = message;
  formHint.style.color = isError ? 'var(--danger)' : 'var(--muted)';
}



function validateForm() {
  const role = roleSelect.value;
  const email = authForm.email.value.trim();
  const password = authForm.password.value;

  if (!role) {
    alert('Please select a role.');
    return false;
  }

  if (!email) {
    alert('Please enter a valid email address.');
    return false;
  }

  if (!password || password.length < 6) {
    alert('Password must be at least 6 characters long.');
    return false;
  }

  if (currentMode === 'register') {
    const name = authForm.displayName.value.trim();
    const confirmPassword = authForm.confirmPassword.value;

    if (!name) {
      alert('Please enter your full name.');
      return false;
    }

    if (confirmPassword !== password) {
      alert('Password and confirm password do not match.');
      return false;
    }
  }

  return true;
}

const API_BASE_URL = 'http://localhost:3000';

async function apiCall(path, body) {
  const resp = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  const text = await resp.text();
  if (!text) {
    throw new Error(`Empty response from server (status ${resp.status})`);
  }

  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`Failed to parse JSON from server (status ${resp.status}): ${text}`);
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  if (!validateForm()) return;

  const email = authForm.email.value.trim();
  const password = authForm.password.value;
  const displayName = authForm.displayName?.value.trim() || null;

  try {
    // Auto-login (no role needed)
    const result = await apiCall('/api/login', { email, password });

    if (!result || !result.success) {
      throw new Error(result?.message || 'Invalid credentials.');
    }

    const verb = 'logged in';
    alert(`Success: You are now ${verb} as ${result.user.role} (${result.user.email}).`);
    console.log('[AUTH SUCCESS]', result);

    // Persist simple session and redirect admin users.
    localStorage.setItem('authUser', JSON.stringify(result.user));

    if (result.user.role === 'staff') {
      window.location.href = 'http://localhost:3000/staff-dashboard.html';
    } else if (result.user.role === 'doctor') {
      window.location.href = 'http://localhost:3000/doctor-dashboard.html';
    } else if (result.user.role === 'patient') {
      window.location.href = 'http://localhost:3000/dashboard.html';
    }
  } catch (err) {
    console.error('[AUTH ERROR]', err);

    // More helpful error message when the backend isn't reachable.
    if (err.message && err.message.includes('Failed to fetch')) {
      showHint(
        'Unable to contact the backend server at http://localhost:3000. Make sure you started the server with `npm start` and are accessing the app from the same origin (http://localhost:3000).',
        true
      );
    } else {
      showHint(`Error: ${err.message}`, true);
    }
  }
}

function init() {
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => setMode(tab.dataset.target));
  });

  authForm.addEventListener('submit', handleSubmit);
  setMode('login');
}

init();
