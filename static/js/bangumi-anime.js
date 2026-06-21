(function () {
  var root = document.querySelector('.anime-dashboard');
  if (!root) return;

  var grid = root.querySelector('[data-anime-grid]');
  var status = root.querySelector('[data-anime-status]');
  var setup = root.querySelector('[data-anime-setup]');
  var usernameInput = root.querySelector('[data-anime-username-input]');
  var tabs = Array.prototype.slice.call(root.querySelectorAll('[data-anime-tab]'));
  var configuredUsername = root.dataset.bangumiUsername || '';
  var previewUsername = '';
  try {
    previewUsername = new URLSearchParams(window.location.search).get('user') || '';
  } catch (error) {
    previewUsername = '';
  }
  var username = (previewUsername || configuredUsername).trim();
  var subjectType = root.dataset.subjectType || '2';
  var types = {
    current: root.dataset.currentType || '3',
    completed: root.dataset.completedType || '2'
  };
  var limits = {
    current: root.dataset.limitCurrent || '24',
    completed: root.dataset.limitCompleted || '48'
  };
  var cache = {};
  var activeTab = 'current';

  if (setup && !configuredUsername) {
    setup.hidden = false;
  }

  if (usernameInput) {
    usernameInput.value = username;
  }

  function setStatus(message) {
    status.textContent = message;
    status.hidden = !message;
  }

  function setUsername(value) {
    username = String(value || '').trim();
    cache = {};
    if (usernameInput) {
      usernameInput.value = username;
    }

    if (!configuredUsername && username) {
      try {
        var url = new URL(window.location.href);
        url.searchParams.set('user', username);
        window.history.replaceState({}, '', url);
      } catch (error) {
        // Ignore history failures; fetching still works.
      }
    }

    fetchTab(activeTab);
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, function (char) {
      return {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
      }[char];
    });
  }

  function pickTitle(subject) {
    if (!subject) return 'Untitled';
    return subject.name_cn || subject.name || 'Untitled';
  }

  function pickImage(subject) {
    var images = subject && subject.images;
    return images && (images.medium || images.common || images.grid || images.small);
  }

  function pickSubjectId(item) {
    return item.subject_id || (item.subject && item.subject.id) || '';
  }

  function pickTagName(tag) {
    if (typeof tag === 'string') return tag;
    return tag && (tag.name || tag.title || tag.label || tag.value);
  }

  function pickTags(item, subject) {
    var seen = {};
    return []
      .concat(item.tags || [])
      .concat((subject && subject.tags) || [])
      .map(pickTagName)
      .filter(Boolean)
      .filter(function (tag) {
        var key = String(tag).toLowerCase();
        if (seen[key]) return false;
        seen[key] = true;
        return true;
      })
      .slice(0, 5);
  }

  function formatScore(value) {
    var score = Number(value || 0);
    return score > 0 ? score.toFixed(1).replace(/\.0$/, '') : '-';
  }

  function formatRelease(dateValue) {
    if (!dateValue) return 'TBA';
    var parts = String(dateValue).split('-');
    var year = parts[0];
    var month = Number(parts[1] || 0);
    if (!year || !month) return year || 'TBA';
    try {
      return new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric' }).format(new Date(Number(year), month - 1, 1));
    } catch (error) {
      return year + '-' + String(month).padStart(2, '0');
    }
  }

  function formatEpisodeStatus(item, subject) {
    var watched = Number(item.ep_status || 0);
    var total = Number(subject && subject.eps || 0);
    if (watched && total) return watched + '/' + total + ' eps';
    if (watched) return watched + ' eps';
    if (total) return total + ' eps';
    return '';
  }

  function pickSummary(subject, item) {
    var text = (subject && subject.short_summary) || item.comment || '';
    text = String(text).replace(/\[[^\]]+\]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text) return 'No short description available yet.';
    return text.length > 220 ? text.slice(0, 217).trim() + '...' : text;
  }

  function render(items) {
    grid.innerHTML = '';
    if (!items.length) {
      setStatus(activeTab === 'current' ? 'No current anime found.' : 'No completed anime found.');
      return;
    }

    setStatus('');
    var fragment = document.createDocumentFragment();
    items.forEach(function (item) {
      var subject = item.subject || {};
      var title = pickTitle(subject);
      var image = pickImage(subject);
      var subjectId = pickSubjectId(item);
      var subjectUrl = subjectId ? 'https://bgm.tv/subject/' + encodeURIComponent(subjectId) : 'https://bgm.tv/';
      var tags = pickTags(item, subject);
      var release = formatRelease(subject.date);
      var episodeStatus = formatEpisodeStatus(item, subject);
      var summary = pickSummary(subject, item);
      var card = document.createElement('article');
      card.className = 'anime-card reveal-item is-visible';
      card.innerHTML = [
        '<a class="anime-cover" href="' + subjectUrl + '" target="_blank" rel="noopener">',
          image ? '<img src="' + escapeHtml(image) + '" alt="' + escapeHtml(title) + '" loading="lazy">' : '<span class="anime-cover-fallback">No cover</span>',
        '</a>',
        '<div class="anime-card-body">',
          '<div class="anime-kicker">',
            '<span>' + escapeHtml(release) + '</span>',
            episodeStatus ? '<span>' + escapeHtml(episodeStatus) + '</span>' : '',
          '</div>',
          '<h2><a href="' + subjectUrl + '" target="_blank" rel="noopener">' + escapeHtml(title) + '</a></h2>',
          '<div class="anime-rating">',
            '<span><strong>Overall</strong> ' + escapeHtml(formatScore(subject.score)) + '</span>',
            '<span><strong>My rating</strong> ' + escapeHtml(formatScore(item.rate)) + '</span>',
          '</div>',
          '<p class="anime-summary">' + escapeHtml(summary) + '</p>',
          item.comment ? '<p class="anime-comment"><strong>Note</strong> ' + escapeHtml(item.comment) + '</p>' : '',
          tags.length ? '<div class="anime-tags">' + tags.map(function (tag) { return '<span>' + escapeHtml(tag) + '</span>'; }).join('') + '</div>' : '',
        '</div>'
      ].join('');
      fragment.appendChild(card);
    });
    grid.appendChild(fragment);
  }

  function fetchTab(tab) {
    activeTab = tab;
    tabs.forEach(function (button) {
      var isActive = button.dataset.animeTab === tab;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-selected', String(isActive));
    });

    if (!username) {
      grid.innerHTML = '';
      setStatus('Bangumi username is not configured yet.');
      return;
    }

    if (cache[tab]) {
      render(cache[tab]);
      return;
    }

    setStatus('Loading Bangumi collection...');
    var url = 'https://api.bgm.tv/v0/users/' + encodeURIComponent(username) +
      '/collections?subject_type=' + encodeURIComponent(subjectType) +
      '&type=' + encodeURIComponent(types[tab]) +
      '&limit=' + encodeURIComponent(limits[tab]) +
      '&offset=0';

    fetch(url, { headers: { 'Accept': 'application/json' } })
      .then(function (response) {
        if (!response.ok) throw new Error('Bangumi returned ' + response.status);
        return response.json();
      })
      .then(function (payload) {
        cache[tab] = payload.data || [];
        render(cache[tab]);
      })
      .catch(function () {
        grid.innerHTML = '';
        setStatus('Could not load Bangumi collection.');
      });
  }

  tabs.forEach(function (button) {
    button.addEventListener('click', function () {
      fetchTab(button.dataset.animeTab);
    });
  });

  if (setup) {
    setup.addEventListener('submit', function (event) {
      event.preventDefault();
      setUsername(usernameInput && usernameInput.value);
    });
  }

  fetchTab(activeTab);
})();
