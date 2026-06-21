(function () {
  var root = document.querySelector('.anime-dashboard');
  if (!root) return;

  var grid = root.querySelector('[data-anime-grid]');
  var status = root.querySelector('[data-anime-status]');
  var meta = root.querySelector('[data-anime-meta]');
  var setup = root.querySelector('[data-anime-setup]');
  var usernameInput = root.querySelector('[data-anime-username-input]');
  var controls = root.querySelector('[data-anime-controls]');
  var searchInput = root.querySelector('[data-anime-search]');
  var tagSelect = root.querySelector('[data-anime-tag-filter]');
  var clearButton = root.querySelector('[data-anime-clear]');
  var sentinel = root.querySelector('[data-anime-sentinel]');
  var loadMoreButton = root.querySelector('[data-anime-load-more]');
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
    current: root.dataset.limitCurrent || '50',
    completed: root.dataset.limitCompleted || '50'
  };
  var initialVisibleCount = 24;
  var visibleStep = 24;
  var cache = {};
  var activeTab = 'current';
  var activeQuery = '';
  var activeTag = '';
  var requestToken = 0;

  if (setup && !configuredUsername) {
    setup.hidden = false;
  }

  if (usernameInput) {
    usernameInput.value = username;
  }

  function setStatus(message) {
    if (!status) return;
    status.textContent = message;
    status.hidden = !message;
  }

  function setMeta(message) {
    if (!meta) return;
    meta.textContent = message;
    meta.hidden = !message;
  }

  function normalize(value) {
    return String(value || '').trim().toLowerCase();
  }

  function tabLabel(tab) {
    return tab === 'current' ? 'watching' : 'completed';
  }

  function getState(tab) {
    if (!cache[tab]) {
      cache[tab] = {
        error: false,
        fetchPromise: null,
        items: [],
        loadedAll: false,
        loading: false,
        total: null,
        visibleCount: initialVisibleCount
      };
    }
    return cache[tab];
  }

  function getPageSize(tab) {
    var configured = Number(limits[tab] || 50);
    if (!Number.isFinite(configured) || configured <= 0) configured = 50;
    return Math.max(24, Math.min(50, configured));
  }

  function setUsername(value) {
    username = String(value || '').trim();
    cache = {};
    activeTag = '';
    requestToken += 1;
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
        var key = normalize(tag);
        if (seen[key]) return false;
        seen[key] = true;
        return true;
      });
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

  function searchText(item) {
    var subject = item.subject || {};
    return normalize([
      subject.name,
      subject.name_cn,
      subject.date,
      item.comment,
      subject.short_summary,
      pickTags(item, subject).join(' ')
    ].join(' '));
  }

  function matchesFilters(item) {
    var subject = item.subject || {};
    if (activeTag) {
      var tagMatches = pickTags(item, subject).some(function (tag) {
        return normalize(tag) === activeTag;
      });
      if (!tagMatches) return false;
    }

    if (activeQuery) {
      var text = searchText(item);
      return activeQuery.split(/\s+/).filter(Boolean).every(function (term) {
        return text.indexOf(term) !== -1;
      });
    }

    return true;
  }

  function filteredItems(state) {
    return state.items.filter(matchesFilters);
  }

  function updateTagOptions(state) {
    if (!tagSelect) return;

    var counts = {};
    var labels = {};
    state.items.forEach(function (item) {
      pickTags(item, item.subject || {}).forEach(function (tag) {
        var key = normalize(tag);
        counts[key] = (counts[key] || 0) + 1;
        labels[key] = labels[key] || tag;
      });
    });

    if (activeTag && !counts[activeTag]) {
      activeTag = '';
    }

    tagSelect.innerHTML = '';
    var allOption = document.createElement('option');
    allOption.value = '';
    allOption.textContent = 'All tags';
    tagSelect.appendChild(allOption);

    Object.keys(counts)
      .sort(function (a, b) {
        return counts[b] - counts[a] || labels[a].localeCompare(labels[b]);
      })
      .forEach(function (key) {
        var option = document.createElement('option');
        option.value = key;
        option.textContent = labels[key] + ' (' + counts[key] + ')';
        tagSelect.appendChild(option);
      });

    tagSelect.value = activeTag;
  }

  function updateControls(state) {
    if (controls) controls.hidden = !username;
    if (searchInput && searchInput.value !== activeQuery) searchInput.value = activeQuery;
    updateTagOptions(state);
  }

  function updateLoadMore(state, matches) {
    var hasMore = matches.length > state.visibleCount;
    if (loadMoreButton) loadMoreButton.hidden = !hasMore;
    if (sentinel) sentinel.hidden = !hasMore;
  }

  function renderCards(items) {
    grid.innerHTML = '';
    var fragment = document.createDocumentFragment();
    items.forEach(function (item) {
      var subject = item.subject || {};
      var title = pickTitle(subject);
      var image = pickImage(subject);
      var subjectId = pickSubjectId(item);
      var subjectUrl = subjectId ? 'https://bgm.tv/subject/' + encodeURIComponent(subjectId) : 'https://bgm.tv/';
      var tags = pickTags(item, subject).slice(0, 5);
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

  function renderCurrent() {
    var state = getState(activeTab);
    var matches = filteredItems(state);
    var visible = matches.slice(0, state.visibleCount);
    var hasFilter = Boolean(activeQuery || activeTag);

    updateControls(state);
    renderCards(visible);
    updateLoadMore(state, matches);

    if (state.loading) {
      setStatus('Loading full ' + tabLabel(activeTab) + ' collection... ' + state.items.length + (state.total ? '/' + state.total : '') + ' loaded.');
    } else if (state.error) {
      setStatus('Could not load Bangumi collection.');
    } else if (!state.items.length) {
      setStatus(activeTab === 'current' ? 'No current anime found.' : 'No completed anime found.');
    } else if (!matches.length) {
      setStatus('No matches for the current search or tag.');
    } else {
      setStatus('');
    }

    if (!state.items.length && !state.loading) {
      setMeta('');
      return;
    }

    var loadedText = state.loadedAll ? String(state.items.length) : state.items.length + (state.total ? '/' + state.total : '');
    var countText = 'Showing ' + visible.length + ' of ' + matches.length;
    if (hasFilter) countText += ' matching';
    countText += ' ' + tabLabel(activeTab) + ' anime';
    if (!hasFilter && matches.length !== state.items.length) countText += ' from ' + state.items.length + ' loaded';
    countText += state.loading ? ' (' + loadedText + ' loaded).' : '.';
    setMeta(countText);
  }

  function fetchPage(tab, offset, token) {
    var pageSize = getPageSize(tab);
    var url = 'https://api.bgm.tv/v0/users/' + encodeURIComponent(username) +
      '/collections?subject_type=' + encodeURIComponent(subjectType) +
      '&type=' + encodeURIComponent(types[tab]) +
      '&limit=' + encodeURIComponent(pageSize) +
      '&offset=' + encodeURIComponent(offset);

    return fetch(url, { headers: { 'Accept': 'application/json' } })
      .then(function (response) {
        if (!response.ok) throw new Error('Bangumi returned ' + response.status);
        return response.json();
      })
      .then(function (payload) {
        if (token !== requestToken) return null;
        var data = payload && (payload.data || payload.items || []);
        if (!Array.isArray(data)) data = [];
        return {
          data: data,
          limit: pageSize,
          total: Number(payload && (payload.total || payload.total_count || payload.count || 0)) || null
        };
      });
  }

  function loadAll(tab) {
    var state = getState(tab);
    if (state.loading) return state.fetchPromise;
    if (state.loadedAll) {
      renderCurrent();
      return Promise.resolve(state.items);
    }

    var token = requestToken;
    state.error = false;
    state.loading = true;
    state.fetchPromise = (function loadNext(offset) {
      return fetchPage(tab, offset, token).then(function (page) {
        if (!page || token !== requestToken) return state.items;
        state.total = page.total || state.total;
        state.items = state.items.concat(page.data);
        if (tab === activeTab) renderCurrent();

        var loadedEnough = state.total && state.items.length >= state.total;
        var reachedEnd = page.data.length < page.limit;
        if (page.data.length && !loadedEnough && !reachedEnd) {
          return loadNext(offset + page.data.length);
        }

        state.loading = false;
        state.loadedAll = true;
        if (tab === activeTab) renderCurrent();
        return state.items;
      });
    }(0)).catch(function () {
      if (token !== requestToken) return;
      state.loading = false;
      state.error = true;
      if (tab === activeTab) renderCurrent();
    });

    renderCurrent();
    return state.fetchPromise;
  }

  function fetchTab(tab) {
    activeTab = tab;
    activeTag = '';
    tabs.forEach(function (button) {
      var isActive = button.dataset.animeTab === tab;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-selected', String(isActive));
    });

    if (!username) {
      grid.innerHTML = '';
      setMeta('');
      setStatus('Bangumi username is not configured yet.');
      return;
    }

    var state = getState(tab);
    state.visibleCount = Math.max(state.visibleCount, initialVisibleCount);
    loadAll(tab);
  }

  function resetVisibleAndRender() {
    getState(activeTab).visibleCount = initialVisibleCount;
    renderCurrent();
  }

  function showMore() {
    var state = getState(activeTab);
    var matches = filteredItems(state);
    if (matches.length <= state.visibleCount) return;
    state.visibleCount += visibleStep;
    renderCurrent();
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

  if (searchInput) {
    searchInput.addEventListener('input', function () {
      activeQuery = normalize(searchInput.value);
      resetVisibleAndRender();
    });
  }

  if (tagSelect) {
    tagSelect.addEventListener('change', function () {
      activeTag = normalize(tagSelect.value);
      resetVisibleAndRender();
    });
  }

  if (clearButton) {
    clearButton.addEventListener('click', function () {
      activeQuery = '';
      activeTag = '';
      if (searchInput) searchInput.value = '';
      if (tagSelect) tagSelect.value = '';
      resetVisibleAndRender();
    });
  }

  if (loadMoreButton) {
    loadMoreButton.addEventListener('click', showMore);
  }

  function checkScrollLoad() {
    if (!sentinel || sentinel.hidden) return;
    var rect = sentinel.getBoundingClientRect();
    if (rect.top <= window.innerHeight + 600) {
      showMore();
    }
  }

  var scrollScheduled = false;
  function scheduleScrollCheck() {
    if (scrollScheduled) return;
    scrollScheduled = true;
    var scheduler = window.requestAnimationFrame || function (callback) {
      window.setTimeout(callback, 80);
    };
    scheduler(function () {
      scrollScheduled = false;
      checkScrollLoad();
    });
  }

  if (sentinel && 'IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      if (entries.some(function (entry) { return entry.isIntersecting; })) {
        showMore();
      }
    }, { rootMargin: '600px 0px' }).observe(sentinel);
  }
  window.addEventListener('scroll', scheduleScrollCheck, { passive: true });
  window.addEventListener('resize', scheduleScrollCheck);
  window.setInterval(checkScrollLoad, 750);

  fetchTab(activeTab);
})();
