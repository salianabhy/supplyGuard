// ==========================================================================
// SupplyGuard Frontend Application Controller
// ==========================================================================

const form = document.querySelector('#verify-form');
const input = document.querySelector('#image-input');
const dropzone = document.querySelector('#dropzone');
const preview = document.querySelector('#preview');
const clearBtn = document.querySelector('#clear-image-btn');
const button = document.querySelector('#verify-button');
const error = document.querySelector('#error');
const empty = document.querySelector('#empty-state');
const result = document.querySelector('#result');
const themeToggle = document.querySelector('#theme-toggle');
const toastEl = document.querySelector('#toast');

// Modal Elements
const timelineModal = document.querySelector('#timeline-modal');
const openTimelineBtn = document.querySelector('#open-timeline-btn');
const closeTimelineBtn = document.querySelector('#close-modal-btn');
const viewChainHistoryBtn = document.querySelector('#view-chain-history-btn');
const fetchBatchBtn = document.querySelector('#fetch-batch-btn');
const modalBatchInput = document.querySelector('#modal-batch-input');
const timelineContainer = document.querySelector('#timeline-container');
const timelineLoading = document.querySelector('#timeline-loading');
const modalBatchMeta = document.querySelector('#modal-batch-meta');

// Camera Elements
const cameraBtn = document.querySelector('#camera-btn');
const cameraModal = document.querySelector('#camera-modal');
const closeCameraBtn = document.querySelector('#close-camera-btn');
const webcamVideo = document.querySelector('#webcam-video');
const cameraCanvas = document.querySelector('#camera-canvas');
const snapBtn = document.querySelector('#snap-btn');
let activeMediaStream = null;

// Presets
const presetBtns = document.querySelectorAll('.preset-btn');
const PRESET_URLS = {
  real: '/static/samples/real_sample.jpg',
  fake: '/static/samples/fake_sample.png',
  synthetic: '/static/samples/synthetic_sample.jpg'
};

// --------------------------------------------------------------------------
// 1. Theme Management
// --------------------------------------------------------------------------
const savedTheme = localStorage.getItem('supplyguard_theme') || 'dark';
document.documentElement.setAttribute('data-theme', savedTheme);

themeToggle.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('supplyguard_theme', next);
  showToast(`Switched to ${next} theme`);
});

// --------------------------------------------------------------------------
// 2. Toast Notifications
// --------------------------------------------------------------------------
let toastTimer = null;
function showToast(message) {
  clearTimeout(toastTimer);
  toastEl.textContent = message;
  toastEl.classList.remove('hidden');
  toastTimer = setTimeout(() => {
    toastEl.classList.add('hidden');
  }, 3200);
}

// --------------------------------------------------------------------------
// 3. Image Selection & Preview
// --------------------------------------------------------------------------
function setImageFile(file) {
  if (!file) return;
  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(file);
  input.files = dataTransfer.files;

  preview.src = URL.createObjectURL(file);
  dropzone.classList.add('has-image');
  error.textContent = '';
}

function clearImage() {
  input.value = '';
  preview.src = '';
  dropzone.classList.remove('has-image');
  error.textContent = '';
}

input.addEventListener('change', () => {
  if (input.files && input.files[0]) {
    setImageFile(input.files[0]);
  }
});

clearBtn.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  clearImage();
});

// --------------------------------------------------------------------------
// 4. Native Drag-and-Drop & Clipboard Paste
// --------------------------------------------------------------------------
['dragenter', 'dragover'].forEach((eventName) => {
  dropzone.addEventListener(eventName, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropzone.classList.add('dragover');
  });
});

['dragleave', 'drop'].forEach((eventName) => {
  dropzone.addEventListener(eventName, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropzone.classList.remove('dragover');
  });
});

dropzone.addEventListener('drop', (e) => {
  const files = e.dataTransfer && e.dataTransfer.files;
  if (files && files.length > 0) {
    setImageFile(files[0]);
  }
});

// Paste from Clipboard anywhere on page
window.addEventListener('paste', (e) => {
  const items = (e.clipboardData || e.originalEvent.clipboardData).items;
  for (let i = 0; i < items.length; i++) {
    if (items[i].type.indexOf('image') !== -1) {
      const file = items[i].getAsFile();
      setImageFile(file);
      showToast('Image pasted from clipboard');
      break;
    }
  }
});

// --------------------------------------------------------------------------
// 5. 1-Click Demo Presets
// --------------------------------------------------------------------------
presetBtns.forEach((btn) => {
  btn.addEventListener('click', async () => {
    const presetKey = btn.dataset.preset;
    const url = PRESET_URLS[presetKey];
    if (!url) return;

    try {
      showToast(`Loading demo sample: ${btn.querySelector('.preset-title').textContent}...`);
      const res = await fetch(url);
      if (!res.ok) throw new Error('Sample not found');
      const blob = await res.blob();
      const ext = presetKey === 'fake' ? 'png' : 'jpg';
      const file = new File([blob], `sample_${presetKey}.${ext}`, { type: blob.type || 'image/jpeg' });
      setImageFile(file);

      // Auto-populate batch ID if present
      if (btn.dataset.batch) {
        document.querySelector('#batch_id_input').value = btn.dataset.batch;
      }
    } catch (err) {
      showToast(`Failed to load preset: ${err.message}`);
    }
  });
});

// --------------------------------------------------------------------------
// 6. Verification Form Submission
// --------------------------------------------------------------------------
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  error.textContent = '';

  if (!input.files || input.files.length === 0) {
    error.textContent = 'Please choose, drag, or paste a package image first.';
    return;
  }

  button.disabled = true;
  button.querySelector('.btn-text').textContent = 'Analyzing Package (YOLOv8)...';

  try {
    const formData = new FormData(form);
    const response = await fetch('/api/verify', { method: 'POST', body: formData });
    const data = await response.json();

    if (!response.ok || data.error) {
      const message =
        data.error ||
        (Array.isArray(data.detail)
          ? data.detail.map((d) => `${d.loc ? d.loc.slice(-1)[0] + ': ' : ''}${d.msg}`).join(', ')
          : data.detail) ||
        'Verification failed.';
      throw new Error(message);
    }

    // Hide empty state and show result
    empty.classList.add('hidden');
    result.classList.remove('hidden');

    const isFake = data.prediction === 'FAKE';
    result.classList.toggle('fake', isFake);

    // Verdict Badge
    const predictionEl = document.querySelector('#prediction');
    const verdictIcon = document.querySelector('#verdict-icon');
    const verdictSubbadge = document.querySelector('#verdict-subbadge');

    predictionEl.textContent = data.prediction;
    if (isFake) {
      verdictIcon.textContent = '!';
      verdictSubbadge.textContent = 'SUSPECT · FLAGGED';
    } else {
      verdictIcon.textContent = '✓';
      verdictSubbadge.textContent = 'GENUINE · VERIFIED';
    }

    // Confidence & Probabilities
    document.querySelector('#confidence').textContent = `${data.confidence_percent}%`;
    const realProb = (data.probabilities && data.probabilities.REAL) || (isFake ? 100 - data.confidence_percent : data.confidence_percent);
    const fakeProb = (data.probabilities && data.probabilities.FAKE) || (isFake ? data.confidence_percent : 100 - data.confidence_percent);

    document.querySelector('#real-bar').style.width = `${realProb}%`;
    document.querySelector('#fake-bar').style.width = `${fakeProb}%`;
    document.querySelector('#real-prob-val').textContent = `${realProb.toFixed(1)}%`;
    document.querySelector('#fake-prob-val').textContent = `${fakeProb.toFixed(1)}%`;

    // Telemetry
    document.querySelector('#t-latency').textContent = data.latency_ms ? `${data.latency_ms} ms` : '< 50 ms';
    document.querySelector('#t-dims').textContent = data.dimensions || '--';
    document.querySelector('#t-size').textContent = data.file_size_kb ? `${data.file_size_kb} KB` : '--';
    document.querySelector('#t-model').textContent = 'YOLOv8n-Cls';

    // Cryptographic Hashes
    const hashEl = document.querySelector('#hash');
    hashEl.textContent = data.image_sha256;
    hashEl.dataset.fullHash = data.image_sha256;

    const ledgerEl = document.querySelector('#ledger');
    const copyTxBtn = document.querySelector('#copy-tx-btn');
    if (data.blockchain && data.blockchain.recorded) {
      ledgerEl.classList.add('recorded');
      ledgerEl.textContent = `On-Chain: ${data.blockchain.transaction_hash.slice(0, 14)}...`;
      copyTxBtn.dataset.txHash = data.blockchain.transaction_hash;
      copyTxBtn.classList.remove('hidden');
      showToast('Verification record anchored to Ethereum ledger!');
    } else {
      ledgerEl.classList.remove('recorded');
      ledgerEl.textContent = (data.blockchain && data.blockchain.reason) || 'Not requested';
      copyTxBtn.classList.add('hidden');
    }
  } catch (caught) {
    error.textContent = caught.message || 'Verification service unavailable.';
  } finally {
    button.disabled = false;
    button.querySelector('.btn-text').textContent = 'Run YOLO Verification';
  }
});

// --------------------------------------------------------------------------
// 7. Clipboard Copy Helpers
// --------------------------------------------------------------------------
document.querySelector('#copy-hash-btn').addEventListener('click', () => {
  const hash = document.querySelector('#hash').dataset.fullHash || document.querySelector('#hash').textContent;
  if (hash && hash !== '-') {
    navigator.clipboard.writeText(hash).then(() => showToast('Image SHA-256 copied!'));
  }
});

document.querySelector('#copy-tx-btn').addEventListener('click', (e) => {
  const tx = e.currentTarget.dataset.txHash;
  if (tx) {
    navigator.clipboard.writeText(tx).then(() => showToast('Transaction hash copied!'));
  }
});

// --------------------------------------------------------------------------
// 8. Certificate Export (Print)
// --------------------------------------------------------------------------
document.querySelector('#print-cert-btn').addEventListener('click', () => {
  window.print();
});

// --------------------------------------------------------------------------
// 9. On-Chain Batch Provenance Timeline Modal
// --------------------------------------------------------------------------
async function loadBatchTimeline(batchId) {
  if (!batchId) return;
  timelineLoading.classList.remove('hidden');
  timelineContainer.innerHTML = '';
  modalBatchMeta.classList.add('hidden');

  try {
    const res = await fetch(`/api/batch/${encodeURIComponent(batchId)}`);
    const data = await res.json();
    timelineLoading.classList.add('hidden');

    if (!data.exists) {
      timelineContainer.innerHTML = `
        <div style="padding: 24px; text-align: center; color: var(--text-muted); font-size: 13px;">
          No on-chain records found for batch <b>${batchId}</b>. Verify the batch ID or ensure a batch was seeded.
        </div>`;
      return;
    }

    // Populate Meta
    modalBatchMeta.classList.remove('hidden');
    document.querySelector('#meta-batch-id').textContent = data.batch_id;
    document.querySelector('#meta-product-id').textContent = data.product_id;
    document.querySelector('#meta-manufacturer').textContent = data.manufacturer;

    // Render Timeline Items
    const records = data.records || [];
    if (records.length === 0) {
      timelineContainer.innerHTML = '<div style="padding: 16px;">No history records found.</div>';
      return;
    }

    timelineContainer.innerHTML = records
      .map((r) => {
        const isFake = r.eventType === 'FLAGGED_FAKE' || r.verdict === 'FAKE';
        const nodeClass = isFake ? 'timeline-node fake-node' : 'timeline-node';
        const tagClass = isFake ? 'timeline-stage-tag fake-tag' : 'timeline-stage-tag';
        const dateStr = r.formattedTime ? new Date(r.formattedTime).toLocaleString() : `Block Time: ${r.timestamp}`;

        return `
        <div class="timeline-card">
          <div class="${nodeClass}"></div>
          <div class="timeline-card-head">
            <span class="${tagClass}">${r.eventType}</span>
            <span class="timeline-time">${dateStr}</span>
          </div>
          <div class="timeline-details">
            <div><b>Actor:</b> <code>${r.actor}</code></div>
            <div><b>Location:</b> ${r.location}</div>
            ${r.verdict && r.verdict !== 'NONE' ? `<div><b>AI Verdict:</b> <strong style="color: ${isFake ? 'var(--red)' : 'var(--emerald)'}">${r.verdict} (${r.confidencePercent}%)</strong></div>` : ''}
            <div><b>Hash:</b> <code>${r.dataHash.slice(0, 20)}...</code></div>
            ${r.notes ? `<div><b>Notes:</b> ${r.notes}</div>` : ''}
          </div>
        </div>`;
      })
      .join('');
  } catch (err) {
    timelineLoading.classList.add('hidden');
    timelineContainer.innerHTML = `<div style="padding: 20px; color: var(--red);">Failed to query ledger: ${err.message}</div>`;
  }
}

function openTimeline(defaultBatch) {
  if (defaultBatch) {
    modalBatchInput.value = defaultBatch;
  }
  timelineModal.showModal();
  loadBatchTimeline(modalBatchInput.value.trim());
}

openTimelineBtn.addEventListener('click', () => {
  openTimeline(document.querySelector('#batch_id_input').value.trim() || 'SG-BATCH-001');
});

viewChainHistoryBtn.addEventListener('click', () => {
  openTimeline(document.querySelector('#batch_id_input').value.trim() || 'SG-BATCH-001');
});

closeTimelineBtn.addEventListener('click', () => {
  timelineModal.close();
});

fetchBatchBtn.addEventListener('click', () => {
  loadBatchTimeline(modalBatchInput.value.trim());
});

timelineModal.addEventListener('click', (e) => {
  const rect = timelineModal.getBoundingClientRect();
  const isInDialog =
    rect.top <= e.clientY && e.clientY <= rect.top + rect.height && rect.left <= e.clientX && e.clientX <= rect.left + rect.width;
  if (!isInDialog) {
    timelineModal.close();
  }
});

// --------------------------------------------------------------------------
// 10. Live Camera Scanner Modal
// --------------------------------------------------------------------------
cameraBtn.addEventListener('click', async () => {
  try {
    activeMediaStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    webcamVideo.srcObject = activeMediaStream;
    cameraModal.showModal();
  } catch (err) {
    showToast(`Camera access failed: ${err.message}`);
  }
});

function stopCamera() {
  if (activeMediaStream) {
    activeMediaStream.getTracks().forEach((track) => track.stop());
    activeMediaStream = null;
  }
  cameraModal.close();
}

closeCameraBtn.addEventListener('click', stopCamera);

cameraModal.addEventListener('click', (e) => {
  const rect = cameraModal.getBoundingClientRect();
  const isInDialog =
    rect.top <= e.clientY && e.clientY <= rect.top + rect.height && rect.left <= e.clientX && e.clientX <= rect.left + rect.width;
  if (!isInDialog) {
    stopCamera();
  }
});

snapBtn.addEventListener('click', () => {
  if (!webcamVideo.videoWidth) return;
  cameraCanvas.width = webcamVideo.videoWidth;
  cameraCanvas.height = webcamVideo.videoHeight;
  const ctx = cameraCanvas.getContext('2d');
  ctx.drawImage(webcamVideo, 0, 0, cameraCanvas.width, cameraCanvas.height);

  cameraCanvas.toBlob((blob) => {
    if (blob) {
      const file = new File([blob], `camera_scan_${Date.now()}.jpg`, { type: 'image/jpeg' });
      setImageFile(file);
      stopCamera();
      showToast('Camera capture ready for verification');
    }
  }, 'image/jpeg', 0.92);
});