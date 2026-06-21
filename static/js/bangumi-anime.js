(function () {
  var root = document.querySelector('.anime-dashboard');
  if (!root) return;

  var grid = root.querySelector('[data-anime-grid]');
  var status = root.querySelector('[data-anime-status]');
  var tabs = Array.prototype.slice.call(root.querySelectorAll('[data-anime-tab]'));
  var username = root.dataset.bangumiUsername;
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

  function setStatus(message) {
    status.textContent = message;
    status.hidden = !message;
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
      var tags = (item.tags || []).map(pickTagName).filter(Boolean).slice(0, 5);
      var card = document.createElement('article');
      card.className = 'anime-card reveal-item is-visible';
      card.innerHTML = [
        '<a class="anime-cover" href="' + subjectUrl + '" target="_blank" rel="noopener">',
          image ? '<img src="' + escapeHtml(image) + '" alt="' + escapeHtml(title) + '" loading="lazy">' : '<span class="anime-cover-fallback">No cover</span>',
        '</a>',
        '<div class="anime-card-body">',
          '<h2><a href="' + subjectUrl + '" target="_blank" rel="noopener">' + escapeHtml(title) + '</a></h2>',
          '<div class="anime-meta">',
            item.rate ? '<span>Score ' + escapeHtml(item.rate) + '</span>' : '',
            item.ep_status ? '<span>EP ' + escapeHtml(item.ep_status) + '</span>' : '',
          '</div>',
          item.comment ? '<p class="anime-comment">' + escapeHtml(item.comment) + '</p>' : '',
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

  fetchTab(activeTab);
})();
