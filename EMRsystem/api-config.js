(function () {
  const renderApiUrl = 'https://emrsystem-9gng.onrender.com';
  const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const apiBaseUrl = isLocalhost ? 'http://localhost:3000' : renderApiUrl.replace(/\/$/, '');

  window.PROFELECT_API_BASE_URL = apiBaseUrl;

  const originalFetch = window.fetch.bind(window);
  window.fetch = function (resource, options) {
    if (typeof resource === 'string' && resource.startsWith('/api/')) {
      return originalFetch(`${apiBaseUrl}${resource}`, options);
    }

    return originalFetch(resource, options);
  };
})();
