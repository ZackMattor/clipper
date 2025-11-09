const API_BASE = '/api';

const tableBody = document.querySelector('#media-table-body');
const searchInput = document.querySelector('#media-search');
const statusEl = document.querySelector('#media-status');
const refreshBtn = document.querySelector('#refresh-media');
const subtitlesModal = document.querySelector('#raw-subtitles-modal');
const subtitlesText = document.querySelector('#raw-subtitles-text');

let mediaItems = [];
const processingIds = new Set();
const failingIds = new Set();

refreshBtn?.addEventListener('click', () => {
  loadMedia();
});

searchInput?.addEventListener('input', () => {
  renderTable();
});

subtitlesModal
  ?.querySelectorAll('[data-close]')
  .forEach((trigger) => trigger.addEventListener('click', () => closeSubtitlesModal()));

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && subtitlesModal && !subtitlesModal.hidden) {
    closeSubtitlesModal();
  }
});

async function loadMedia(options = { quiet: false }) {
  if (!options.quiet) {
    statusEl.textContent = 'Loading media...';
  }
  try {
    const response = await fetch(`${API_BASE}/src_medias`);
    if (!response.ok) {
      throw new Error(`Server responded with ${response.status}`);
    }
    mediaItems = await response.json();
    renderTable();
    if (!options.quiet) {
      statusEl.textContent = `Showing ${mediaItems.length} source media item${
        mediaItems.length === 1 ? '' : 's'
      }.`;
    }
  } catch (error) {
    tableBody.innerHTML = '';
    statusEl.textContent = `Error loading media: ${error.message}`;
  }
}

function renderTable() {
  if (!tableBody) return;
  const query = (searchInput?.value ?? '').trim().toLowerCase();
  const matches = mediaItems.filter((entry) =>
    entry.name.toLowerCase().includes(query)
  );
  tableBody.innerHTML = '';
  if (!matches.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 4;
    cell.className = 'media-empty';
    cell.textContent = mediaItems.length
      ? 'No media folders match this search.'
      : 'No media folders found.';
    row.appendChild(cell);
    tableBody.appendChild(row);
    return;
  }

  matches.forEach((entry) => {
    const row = document.createElement('tr');

    const nameCell = document.createElement('td');
    nameCell.textContent = entry.name;

    const statusCell = document.createElement('td');
    statusCell.appendChild(createStatusBadge(entry.status));

    const subtitleCell = document.createElement('td');
    const subtitleBtn = document.createElement('button');
    subtitleBtn.type = 'button';
    subtitleBtn.className = 'subtitle-btn';
    subtitleBtn.textContent = 'View subtitles';
    const canView = entry.status === 'ready';
    subtitleBtn.disabled = !canView;
    subtitleBtn.title = canView ? 'View subtitle contents' : 'Available once processing succeeds';
    subtitleBtn.addEventListener('click', () => {
      viewSubtitles(entry.id, subtitleBtn);
    });
    subtitleCell.appendChild(subtitleBtn);

    const actionCell = document.createElement('td');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'process-btn';
    const isProcessing = processingIds.has(entry.id) || entry.status === 'in_progress';
    button.disabled = isProcessing;
    button.textContent = isProcessing ? 'Processing…' : 'Process';
    if (isProcessing) {
      const spinner = document.createElement('span');
      spinner.className = 'spinner';
      button.prepend(spinner);
    }
    button.addEventListener('click', () => {
      triggerProcess(entry.id);
    });
    actionCell.appendChild(button);

    if (entry.status === 'ready' || failingIds.has(entry.id)) {
      const failBtn = document.createElement('button');
      failBtn.type = 'button';
      failBtn.className = 'danger-btn';
      const isFailing = failingIds.has(entry.id);
      failBtn.disabled = isFailing;
      failBtn.textContent = isFailing ? 'Marking…' : 'Mark failed';
      if (isFailing) {
        const spinner = document.createElement('span');
        spinner.className = 'spinner';
        failBtn.prepend(spinner);
      }
      failBtn.addEventListener('click', () => {
        markFailed(entry.id);
      });
      actionCell.appendChild(failBtn);
    }

    row.appendChild(nameCell);
    row.appendChild(statusCell);
    row.appendChild(subtitleCell);
    row.appendChild(actionCell);
    tableBody.appendChild(row);
  });
}

function createStatusBadge(status) {
  const badge = document.createElement('span');
  badge.className = `status-badge status-${status}`;
  badge.textContent = formatStatus(status);
  return badge;
}

function formatStatus(status) {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

async function triggerProcess(mediaId) {
  if (processingIds.has(mediaId)) {
    return;
  }
  processingIds.add(mediaId);
  renderTable();
  statusEl.textContent = `Processing media #${mediaId}...`;
  try {
    const response = await fetch(`${API_BASE}/src_medias/${mediaId}/process`, {
      method: 'POST'
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || `Server responded with ${response.status}`);
    }
    await loadMedia({ quiet: true });
    statusEl.textContent = `Media #${mediaId} processed successfully.`;
  } catch (error) {
    await loadMedia({ quiet: true });
    statusEl.textContent = `Failed to process media #${mediaId}: ${error.message}`;
  } finally {
    processingIds.delete(mediaId);
    renderTable();
  }
}

async function markFailed(mediaId) {
  if (failingIds.has(mediaId)) {
    return;
  }
  failingIds.add(mediaId);
  renderTable();
  statusEl.textContent = `Marking media #${mediaId} as failed...`;
  try {
    const response = await fetch(`${API_BASE}/src_medias/${mediaId}/fail`, {
      method: 'POST'
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || `Server responded with ${response.status}`);
    }
    await loadMedia({ quiet: true });
    statusEl.textContent = `Media #${mediaId} marked as failed.`;
  } catch (error) {
    await loadMedia({ quiet: true });
    statusEl.textContent = `Failed to mark media #${mediaId}: ${error.message}`;
  } finally {
    failingIds.delete(mediaId);
    renderTable();
  }
}

async function viewSubtitles(mediaId, button) {
  if (!button) return;
  const previousLabel = button.textContent;
  button.disabled = true;
  button.textContent = 'Loading…';
  try {
    const response = await fetch(`${API_BASE}/src_medias/${mediaId}/subtitles/raw`);
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || `Server responded with ${response.status}`);
    }
    const payload = await response.json();
    openSubtitlesModal(payload.rawContent || 'No subtitles found.');
    statusEl.textContent = `Loaded subtitles for media #${mediaId}.`;
  } catch (error) {
    statusEl.textContent = `Failed to load subtitles for media #${mediaId}: ${error.message}`;
  } finally {
    button.textContent = previousLabel;
    const media = mediaItems.find((entry) => entry.id === mediaId);
    button.disabled = !media || media.status !== 'ready';
  }
}

function openSubtitlesModal(contents) {
  if (!subtitlesModal || !subtitlesText) return;
  subtitlesText.textContent = contents;
  subtitlesModal.hidden = false;
}

function closeSubtitlesModal() {
  if (!subtitlesModal || !subtitlesText) return;
  subtitlesModal.hidden = true;
  subtitlesText.textContent = '';
}

loadMedia();
