const API_BASE = '/api';
const CLIPS_BASE = '/clips';

const modal = document.querySelector('#player-modal');
const modalVideo = document.querySelector('#modal-video');
const subtitlesModal = document.querySelector('#subtitles-modal');
const subtitlesText = document.querySelector('#subtitles-text');
const clipsList = document.querySelector('#clips-list');
const statusEl = document.querySelector('#form-status');
const filterInput = document.querySelector('#filter-input');
const form = document.querySelector('#extract-form');
const sortSelect = document.querySelector('#sort-select');
const mediaListEl = document.querySelector('#media-list');
const mediaSearchInput = document.querySelector('#media-search');
const randomVideo = document.querySelector('#random-clip-video');
const randomTitleEl = document.querySelector('#random-clip-title');
const randomRunEl = document.querySelector('#random-clip-run');
const randomToggleBtn = document.querySelector('#random-toggle');
const randomStatusEl = document.querySelector('#random-status');
const randomQueryFiltersEl = document.querySelector('#random-query-filters');
const submitButton = form ? form.querySelector('button[type="submit"]') : null;
const mediaSelectionHint = document.querySelector('#media-selection-hint');

let clips = [];
let mediaSources = [];
let filtered = [];
let sortKey = 'generated_at';
let sortAsc = false;
let mediaFilterQuery = '';
const selectedMedia = new Set();
let randomQueue = [];
let randomPlaying = false;
let currentRandomClip = null;
let randomSelectedQueries = new Set();

async function fetchClips() {
  const response = await fetch(`${API_BASE}/clips`);
  if (!response.ok) {
    throw new Error(`Failed to load clips (${response.status})`);
  }
  clips = await response.json();
  renderRandomFilters();
  applyFilterAndSort();
  refreshRandomCarousel();
}

function applyFilterAndSort() {
  const query = filterInput.value.trim().toLowerCase();
  filtered = clips.filter((entry) => {
    if (!query) return true;
    const haystack =
      `${entry.query} ${entry.run_directory} ${entry.clip.file}`.toLowerCase();
    return haystack.includes(query);
  });

  const getValue = (entry, key) => {
    if (key.startsWith('clip.')) {
      return entry.clip[key.replace('clip.', '')];
    }
    return entry[key];
  };

  filtered.sort((a, b) => {
    const aVal = getValue(a, sortKey);
    const bVal = getValue(b, sortKey);
    if (aVal === bVal) return 0;
    if (aVal === undefined) return 1;
    if (bVal === undefined) return -1;
    if (typeof aVal === 'number' && typeof bVal === 'number') {
      return sortAsc ? aVal - bVal : bVal - aVal;
    }
    return sortAsc
      ? String(aVal).localeCompare(String(bVal))
      : String(bVal).localeCompare(String(aVal));
  });

  renderTable();
}

function renderTable() {
  clipsList.innerHTML = '';
  for (const entry of filtered) {
    const card = document.createElement('article');
    card.className = 'clip-card';

    const coverDiv = document.createElement('div');
    coverDiv.className = 'clip-cover';
    if (entry.clip.cover_image) {
      const img = document.createElement('img');
      img.src = `${CLIPS_BASE}/${entry.run_directory}/${entry.clip.cover_image}`;
      img.alt = `Cover for ${entry.clip.file}`;
      img.addEventListener('click', () => openPlayer(entry));
      coverDiv.appendChild(img);
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'clip-cover-placeholder';
      placeholder.textContent = 'No cover';
      coverDiv.appendChild(placeholder);
    }

    const details = document.createElement('div');
    details.className = 'clip-details';

    const heading = document.createElement('div');
    heading.innerHTML = `<strong>${entry.query}</strong> · <span>${entry.run_directory}</span>`;
    details.appendChild(heading);

    const summary = document.createElement('div');
    summary.className = 'clip-summary';
    summary.textContent = entry.clip.summary || 'No summary available.';
    details.appendChild(summary);

    const meta = document.createElement('div');
    meta.className = 'clip-meta';
    meta.innerHTML = `
      <div>${new Date(entry.generated_at).toLocaleString()}</div>
      <div>File: ${entry.clip.file}</div>
      <div>Range: ${entry.clip.start.toFixed(2)}s – ${entry.clip.end.toFixed(2)}s</div>
      <div>Encode: ${entry.clip.processing_ms ?? 0} ms</div>
    `;
    details.appendChild(meta);

    if (entry.clip.summary_context?.length) {
      const contextWrapper = document.createElement('div');
      contextWrapper.className = 'clip-context';
      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.textContent = 'View context';
      const pre = document.createElement('pre');
      pre.innerHTML = entry.clip.summary_context
        .map((line) => highlightMatchSafe(line, entry.query))
        .join('\n');
      pre.hidden = true;
      toggleBtn.addEventListener('click', () => {
        pre.hidden = !pre.hidden;
        toggleBtn.textContent = pre.hidden ? 'View context' : 'Hide context';
      });
      contextWrapper.appendChild(toggleBtn);
      contextWrapper.appendChild(pre);
      details.appendChild(contextWrapper);
    }

    const links = document.createElement('div');
    links.className = 'clip-links';
    const clipLink = document.createElement('a');
    clipLink.href = `${CLIPS_BASE}/${entry.run_directory}/${entry.clip.file}`;
    clipLink.target = '_blank';
    clipLink.rel = 'noopener noreferrer';
    clipLink.textContent = 'Download';
    links.appendChild(clipLink);

    if (entry.clip.cover_image) {
      const coverLink = document.createElement('a');
      coverLink.href = `${CLIPS_BASE}/${entry.run_directory}/${entry.clip.cover_image}`;
      coverLink.target = '_blank';
      coverLink.rel = 'noopener noreferrer';
      coverLink.textContent = 'Cover';
      links.appendChild(coverLink);
    }

    details.appendChild(links);

    card.appendChild(coverDiv);
    card.appendChild(details);
    clipsList.appendChild(card);
  }
}

function openPlayer(entry) {
  const videoUrl = `${CLIPS_BASE}/${entry.run_directory}/${entry.clip.file}`;
  const posterUrl = entry.clip.cover_image
    ? `${CLIPS_BASE}/${entry.run_directory}/${entry.clip.cover_image}`
    : '';
  modalVideo.pause();
  modalVideo.src = videoUrl;
  modalVideo.poster = posterUrl;
  modalVideo.load();
  modal.hidden = false;
  modalVideo.play().catch(() => {
    // Ignore autoplay blocking.
  });
}

function closePlayer() {
  modal.hidden = true;
  modalVideo.pause();
  modalVideo.src = '';
}

modal.querySelectorAll('[data-close]').forEach((el) =>
  el.addEventListener('click', () => closePlayer())
);

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !modal.hidden) {
    closePlayer();
  }
});

subtitlesModal.querySelectorAll('[data-close]').forEach((el) =>
  el.addEventListener('click', () => closeSubtitles())
);

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !subtitlesModal.hidden) {
    closeSubtitles();
  }
});

filterInput.addEventListener('input', () => applyFilterAndSort());

if (mediaSearchInput) {
  mediaFilterQuery = mediaSearchInput.value;
  mediaSearchInput.addEventListener('input', () => {
    mediaFilterQuery = mediaSearchInput.value;
    renderMediaList();
  });
}

sortSelect.addEventListener('change', () => {
  sortKey = sortSelect.value;
  sortAsc = false;
  applyFilterAndSort();
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const selectedSources = getSelectedSources();
  if (!selectedSources.length) {
    statusEl.textContent = 'Select at least one source before starting.';
    updateSourceSelectionState();
    return;
  }
  statusEl.textContent = 'Submitting...';
  const formData = new FormData(form);
  const payload = {
    query: formData.get('query'),
    bufferMs: Number(formData.get('bufferMs')) || 0,
    mode: 'clean-transcode',
    container: 'mp4'
  };
  payload.srcMedias = selectedSources;

  try {
    const response = await fetch(`${API_BASE}/clips`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      throw new Error(`Server responded with ${response.status}`);
    }
    await fetchClips();
    statusEl.textContent = 'Extraction started!';
    form.reset();
  } catch (error) {
    statusEl.textContent = `Error: ${(error).message}`;
  }
});

form.addEventListener('reset', () => {
  selectedMedia.clear();
  renderMediaList();
  updateSourceSelectionState();
});

fetchClips().catch((error) => {
  statusEl.textContent = `Failed to load clips: ${error.message}`;
});

async function fetchMedia() {
  const response = await fetch(`${API_BASE}/src_medias?status=ready`);
  if (!response.ok) {
    throw new Error(`Failed to load media (${response.status})`);
  }
  mediaSources = await response.json();
  const availableIds = new Set(mediaSources.map((entry) => entry.id));
  selectedMedia.forEach((id) => {
    if (!availableIds.has(id)) {
      selectedMedia.delete(id);
    }
  });
  renderMediaList();
  updateSourceSelectionState();
}

function renderMediaList() {
  if (!mediaListEl) return;
  const query = mediaFilterQuery.trim().toLowerCase();
  const matches = mediaSources.filter((entry) =>
    entry.name.toLowerCase().includes(query)
  );
  mediaListEl.innerHTML = '';
  if (!matches.length) {
    const empty = document.createElement('p');
    empty.className = 'media-empty';
    empty.textContent = mediaSources.length
      ? 'No media match this search.'
      : 'No media folders found.';
    mediaListEl.appendChild(empty);
    updateSourceSelectionState();
    return;
  }
  matches.forEach((entry) => {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = entry.id;
    input.checked = selectedMedia.has(entry.id);
    input.addEventListener('change', () => {
      if (input.checked) {
        selectedMedia.add(entry.id);
      } else {
        selectedMedia.delete(entry.id);
      }
      updateSourceSelectionState();
    });
    label.appendChild(input);
    const subtitleBtn = document.createElement('button');
    subtitleBtn.type = 'button';
    subtitleBtn.textContent = 'View subtitles';
    subtitleBtn.className = 'subtitle-btn';
    subtitleBtn.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await showSubtitles(entry.id);
    });
    const text = document.createElement('span');
    text.textContent = entry.name;
    label.appendChild(text);
    label.appendChild(subtitleBtn);
    mediaListEl.appendChild(label);
  });
  updateSourceSelectionState();
}

function getSelectedSources() {
  return Array.from(selectedMedia);
}
fetchMedia().catch((error) => {
  console.error('Failed to load media sources', error);
});

initRandomCarousel();
updateSourceSelectionState();
function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (char) => {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    };
    return map[char] || char;
  });
}

function highlightMatchSafe(text, query) {
  const safeText = escapeHtml(text);
  if (!query) return safeText;
  try {
    const regex = new RegExp(query, 'gi');
    return safeText.replace(regex, (match) => `<mark>${match}</mark>`);
  } catch {
    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const fallbackRegex = new RegExp(escapedQuery, 'gi');
    return safeText.replace(fallbackRegex, (match) => `<mark>${match}</mark>`);
  }
}
async function showSubtitles(mediaId) {
  try {
    const response = await fetch(`${API_BASE}/media/${encodeURIComponent(mediaId)}/subtitles`);
    if (!response.ok) {
      throw new Error(`Failed to load subtitles for ${mediaId}`);
    }
    const entries = await response.json();
    const formatted =
      entries
        .map(
          (entry) =>
            `[${formatTimestamp(entry.startMs)} → ${formatTimestamp(entry.endMs)}] ${entry.text}`
        )
        .join('\n') || 'No subtitles found.';
    subtitlesText.textContent = formatted;
    subtitlesModal.hidden = false;
  } catch (error) {
    alert(error.message);
  }
}

function closeSubtitles() {
  subtitlesModal.hidden = true;
  subtitlesText.textContent = '';
}

function formatTimestamp(ms) {
  const totalMs = Math.max(Math.floor(ms), 0);
  const milliseconds = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(
    seconds
  ).padStart(2, '0')},${String(milliseconds).padStart(3, '0')}`;
}

function initRandomCarousel() {
  if (!randomVideo) {
    return;
  }
  randomVideo.muted = false;
  randomToggleBtn?.addEventListener('click', () => {
    if (randomPlaying) {
      pauseRandomCarousel();
    } else {
      startRandomCarousel();
    }
  });
  randomVideo.addEventListener('ended', () => playNextRandomClip());
  randomVideo.addEventListener('error', () => {
    updateRandomStatus('Clip error – skipping…');
    playNextRandomClip();
  });
  updateRandomStatus('Idle');
}

function startRandomCarousel() {
  const pool = getRandomClipPool();
  if (!pool.length) {
    if (!randomSelectedQueries.size) {
      updateRandomStatus('Select one or more search terms to play.');
    } else {
      updateRandomStatus('No clips match the selected filters.');
    }
    return;
  }
  randomPlaying = true;
  randomToggleBtn.textContent = 'Pause';
  randomQueue = shuffleArray(pool.slice());
  playNextRandomClip(true);
  updateRandomStatus('Playing random clips…');
}

function pauseRandomCarousel({ silent = false } = {}) {
  if (!randomVideo) return;
  randomPlaying = false;
  randomVideo.pause();
  randomToggleBtn.textContent = 'Start';
  if (!silent) {
    updateRandomStatus('Paused');
  }
}

function refreshRandomCarousel() {
  const pool = getRandomClipPool();
  randomQueue = [];
  if (!pool.length) {
    pauseRandomCarousel({ silent: true });
    currentRandomClip = null;
    updateRandomMeta();
    if (!randomSelectedQueries.size || !clips.length) {
      updateRandomStatus('Select one or more search terms to play.');
    } else {
      updateRandomStatus('No clips match the selected filters.');
    }
    return;
  }
  if (!randomPlaying) {
    updateRandomStatus(`Idle · ${pool.length} clip${pool.length === 1 ? '' : 's'} match filter`);
    updateRandomMeta();
  } else {
    randomQueue = shuffleArray(pool.slice());
    playNextRandomClip(true);
  }
}

function playNextRandomClip(force = false) {
  if (!randomPlaying || !randomVideo) {
    if (force && randomPlaying) {
      randomPlaying = false;
      randomToggleBtn.textContent = 'Start';
    }
    return;
  }
  const pool = getRandomClipPool();
  if (!pool.length) {
    refreshRandomCarousel();
    return;
  }
  if (!randomQueue.length) {
    randomQueue = shuffleArray(pool.slice());
  }
  if (!randomQueue.length) {
    updateRandomStatus('No clips available.');
    pauseRandomCarousel();
    return;
  }
  currentRandomClip = randomQueue.shift();
  updateRandomMeta(currentRandomClip);
  const videoUrl = `${CLIPS_BASE}/${currentRandomClip.run_directory}/${currentRandomClip.clip.file}`;
  randomVideo.src = videoUrl;
  randomVideo.poster = currentRandomClip.clip.cover_image
    ? `${CLIPS_BASE}/${currentRandomClip.run_directory}/${currentRandomClip.clip.cover_image}`
    : '';
  randomVideo.load();
  randomVideo
    .play()
    .then(() => {
      updateRandomStatus('Playing random clips…');
    })
    .catch(() => {
      updateRandomStatus('Autoplay blocked – click Start to resume.');
      pauseRandomCarousel();
    });
}

function updateRandomMeta(entry = currentRandomClip) {
  if (!randomTitleEl || !randomRunEl) return;
  if (!entry) {
    randomTitleEl.textContent = 'No clip loaded yet.';
    randomRunEl.textContent = '';
    return;
  }
  randomTitleEl.textContent = `${entry.query} · ${entry.clip.file}`;
  randomRunEl.textContent = `Run: ${entry.run_directory} | ${entry.clip.start.toFixed(
    2
  )}s → ${entry.clip.end.toFixed(2)}s`;
}

function updateRandomStatus(message) {
  if (randomStatusEl) {
    randomStatusEl.textContent = message;
  }
}

function updateSourceSelectionState() {
  const hasSelection = selectedMedia.size > 0;
  if (submitButton) {
    submitButton.disabled = !hasSelection;
  }
  if (mediaSelectionHint) {
    if (hasSelection) {
      mediaSelectionHint.textContent = `${selectedMedia.size} source${
        selectedMedia.size === 1 ? '' : 's'
      } selected`;
      mediaSelectionHint.classList.remove('invalid');
    } else {
      mediaSelectionHint.textContent = 'Select at least one source to enable extraction';
      mediaSelectionHint.classList.add('invalid');
    }
  }
}

function shuffleArray(list) {
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function renderRandomFilters() {
  if (!randomQueryFiltersEl) {
    return;
  }
  const uniqueQueries = Array.from(new Set(clips.map((clip) => clip.query))).sort((a, b) =>
    a.localeCompare(b)
  );
  randomQueryFiltersEl.innerHTML = '';
  if (!uniqueQueries.length) {
    const empty = document.createElement('p');
    empty.className = 'random-filter-empty';
    empty.textContent = 'No clips available yet.';
    randomQueryFiltersEl.appendChild(empty);
    randomSelectedQueries.clear();
    return;
  }
  if (!randomSelectedQueries.size) {
    uniqueQueries.forEach((query) => randomSelectedQueries.add(query));
  } else {
    randomSelectedQueries = new Set(
      [...randomSelectedQueries].filter((query) => uniqueQueries.includes(query))
    );
    if (!randomSelectedQueries.size) {
      uniqueQueries.forEach((query) => randomSelectedQueries.add(query));
    }
  }
  uniqueQueries.forEach((query) => {
    const label = document.createElement('label');
    label.className = 'random-filter-option';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = query;
    checkbox.checked = randomSelectedQueries.has(query);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        randomSelectedQueries.add(query);
      } else {
        randomSelectedQueries.delete(query);
      }
      refreshRandomCarousel();
    });
    const text = document.createElement('span');
    text.textContent = query;
    label.appendChild(checkbox);
    label.appendChild(text);
    randomQueryFiltersEl.appendChild(label);
  });
}

function getRandomClipPool() {
  if (!randomSelectedQueries.size) {
    return [];
  }
  return clips.filter((clip) => randomSelectedQueries.has(clip.query));
}
