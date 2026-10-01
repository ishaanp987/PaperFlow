const main = document.querySelector('#main');
let settings, current, draft, dirty = false, submitting = false, timer, toastTimer;
const labels = { uploaded: 'Uploaded', extracting: 'Reading PDF', generating: 'Building guide', ready: 'Ready to review', processing_error: 'Needs attention', publishing: 'Publishing', partial: 'Publish incomplete', published: 'Published' };
const e = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const icons = {
  upload: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V3m-6 6 6-6 6 6M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/></svg>',
  file: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6"/></svg>',
};
const action = (name, label, style = 'button', disabled = false) => `<button type="button" class="${style}" data-action="${name}" ${disabled ? 'disabled' : ''}>${label}</button>`;
function toast(message, error = false) {
  const element = document.querySelector('#toast'); element.textContent = message; element.className = `visible${error ? ' error' : ''}`;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => element.className = '', 6000);
}
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { ...(options.body && typeof options.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  let data; try { data = await response.json(); } catch { throw new Error('The app did not respond. Check that PaperFlow is still running.'); }
  if (!response.ok) throw new Error(data.error || 'The request failed.'); return data;
}
const post = (path, data = {}) => api(path, { method: 'POST', body: JSON.stringify(data) });
const status = (value) => `<span class="status ${['processing_error','partial'].includes(value) ? 'error' : ''}">${e(labels[value] || value)}</span>`;
function nav(route) { document.querySelectorAll('[data-nav]').forEach(link => link.classList.toggle('active', link.dataset.nav === (route === 'settings' ? 'settings' : 'library'))); }
function markDirty() { dirty = true; const label = document.querySelector('#save-state'); if (label) { label.textContent = 'Unsaved edits'; label.className = 'dirty-label'; } }
function guardNavigation() { return !dirty || confirm('You have unsaved edits. Leave this guide without saving them?'); }

async function route() {
  clearInterval(timer); current = null; draft = null; dirty = false;
  const hash = location.hash.slice(1) || 'library'; nav(hash);
  main.className = hash === 'settings' ? 'settings-page' : hash.startsWith('lecture/') ? 'lecture-page' : 'library-page';
  main.innerHTML = '<p class="loading">Opening PaperFlow…</p>';
  try {
    settings = await api('/api/settings');
    if (hash === 'settings') renderSettings();
    else if (hash.startsWith('lecture/')) {
      current = await api(`/api/lectures/${encodeURIComponent(hash.slice(8))}`); draft = current.study ? structuredClone(current.study) : null; renderLecture();
      timer = setInterval(pollLecture, 1800);
    } else await renderLibrary();
  } catch (error) { main.innerHTML = `<div class="notice error"><p>${e(error.message)}</p></div>${action('reload','Try again')}`; }
}

async function renderLibrary() {
  const lectures = await api('/api/lectures');
  main.innerHTML = `<div class="topbar"><a href="#settings">Settings</a></div>
    <h1>From paper to understanding.</h1><p class="subtitle">Upload your notes. Build a study guide. Keep what matters.</p>
    <div class="upload-area" id="dropzone">${icons.upload}<h2>Drop your lecture PDF here</h2><p class="muted">PDF only · up to 20 MB</p>
      ${action('choose','Choose a PDF')}<input type="file" id="file-input" accept="application/pdf,.pdf" class="hidden"><p id="upload-error" class="upload-error" role="alert"></p>
    </div>
    <div class="steps" aria-label="Workflow"><div class="step"><span class="step-number">01</span><span>Read your notes</span></div><span class="step-line"></span><div class="step"><span class="step-number">02</span><span>Review &amp; edit</span></div><span class="step-line"></span><div class="step"><span class="step-number">03</span><span>Save to Notion</span></div></div>
    <div class="section-heading"><h2>Your library</h2><span class="muted small">${lectures.length} ${lectures.length === 1 ? 'lecture' : 'lectures'}</span></div>
    ${lectures.length ? `<ul class="lecture-list">${lectures.map(lecture => `<li><a class="lecture-row" href="#lecture/${e(lecture.id)}"><span class="lecture-icon">${icons.file}</span><span class="lecture-info"><strong>${e(lecture.title)}</strong><small>${e(lecture.course || 'Not processed yet')} · ${lecture.pageCount} ${lecture.pageCount === 1 ? 'page' : 'pages'}${lecture.source === 'demo' ? ' · Demo' : ''}</small></span>${status(lecture.status)}</a></li>`).join('')}</ul>` : `<div class="empty-state">${icons.file}<h3>Your next lecture starts here.</h3><p class="muted">Processed notes and flashcards will appear here.</p>${action('demo','Explore a sample','button-text')}</div>`}
    ${!settings.ready ? `<div class="setup-note"><p>Add your OpenAI key and Notion destination to get started. You can upload a PDF first.</p><a href="#settings">Set up PaperFlow</a></div>` : ''}
    ${lectures.length ? `<div class="top-spacer">${action('demo','Explore a sample','button-text')}</div>` : ''}`;
  const dropzone = document.querySelector('#dropzone');
  dropzone.addEventListener('dragover', event => { event.preventDefault(); dropzone.classList.add('dragging'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragging'));
  dropzone.addEventListener('drop', event => { event.preventDefault(); dropzone.classList.remove('dragging'); if (event.dataTransfer.files.length !== 1) return toast('Choose one lecture PDF at a time.', true); upload(event.dataTransfer.files[0]); });
  document.querySelector('#file-input').addEventListener('change', event => upload(event.target.files[0]));
}

async function upload(file) {
  if (!file || submitting) return;
  const errorElement = document.querySelector('#upload-error');
  if (!/\.pdf$/i.test(file.name) || file.size > 20 * 1024 * 1024 || !file.size) { errorElement.textContent = 'Choose a non-empty PDF up to 20 MB.'; return; }
  submitting = true; const choose = document.querySelector('[data-action="choose"]'); choose.disabled = true; choose.textContent = 'Uploading…'; errorElement.textContent = '';
  try {
    const result = await api('/api/lectures', { method: 'POST', headers: { 'Content-Type': 'application/pdf', 'X-Filename': encodeURIComponent(file.name) }, body: file });
    toast(result.duplicate ? 'This PDF is already in your library.' : 'PDF saved. You can generate your guide now.'); location.hash = `lecture/${result.lecture.id}`;
  } catch (error) { errorElement.textContent = error.message; }
  finally { submitting = false; choose.disabled = false; choose.textContent = 'Choose a PDF'; }
}

function renderSettings() {
  const env = settings.environmentFields;
  main.innerHTML = `<div class="topbar"><a href="#library">Back to library</a></div><div class="page-intro"><h1>Make PaperFlow yours.</h1><p class="subtitle">Connect the tools you already use. Your keys stay on this computer.</p></div>
  <form class="settings-form" id="settings-form" autocomplete="off">
    <section class="settings-section"><h2>OpenAI</h2><p>Reads your PDF and builds the study guide. API usage is billed separately from ChatGPT. <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">Get an API key</a></p>
      <label class="field"><span>API key</span><div class="credential-row"><input type="password" id="openaiKey" aria-label="OpenAI API key" autocomplete="new-password" placeholder="${settings.openaiConfigured ? 'Key saved — leave blank to keep it' : 'Paste your OpenAI API key'}" ${env.includes('openaiKey') ? 'disabled' : ''}>${action('remove-openai','Remove saved key','button-secondary',!settings.openaiConfigured || env.includes('openaiKey'))}</div><small>${env.includes('openaiKey') ? 'Managed by OPENAI_API_KEY.' : 'Stored by the local server, never in browser storage.'}</small></label>
      <label class="field"><span>Vision model</span><input id="model" aria-label="Vision model" required value="${e(settings.model)}" ${env.includes('model') ? 'disabled' : ''}><small>The default supports PDFs and structured output. Choose another compatible model if needed.</small></label>
      ${action('test-openai','Save & test OpenAI','button-secondary')}<span id="openai-result" class="connection-result" role="status"></span>
    </section>
    <section class="settings-section"><h2>Notion</h2><p>Publishes reviewed lectures under a page you choose. <a href="https://developers.notion.com/guides/get-started/quick-start" target="_blank" rel="noreferrer">Get a token</a>. For an internal connection, grant read, insert and update content permissions, then add it to your destination page through the page’s Connections menu.</p>
      <label class="field"><span>Token</span><div class="credential-row"><input type="password" id="notionKey" aria-label="Notion token" autocomplete="new-password" placeholder="${settings.notionConfigured ? 'Token saved — leave blank to keep it' : 'Paste your Notion token'}" ${env.includes('notionKey') ? 'disabled' : ''}>${action('remove-notion','Remove saved token','button-secondary',!settings.notionConfigured || env.includes('notionKey'))}</div><small>${env.includes('notionKey') ? 'Managed by NOTION_API_KEY.' : 'Use your own workspace token or internal connection token.'}</small></label>
      <label class="field"><span>Destination page URL or ID</span><input id="notionParentId" aria-label="Destination page URL or ID" value="${e(settings.notionParentId)}" placeholder="Paste the link to your PaperFlow page" ${env.includes('notionParentId') ? 'disabled' : ''}><small>Create a normal Notion page named PaperFlow. Lectures will be grouped by course below it.</small></label>
      ${action('test-notion','Save & test Notion','button-secondary')}<span id="notion-result" class="connection-result" role="status"></span>
    </section>
    <div class="notice"><p>Notes are sent to OpenAI when you generate a guide, and to Notion when you publish. Original PDFs, edits and keys are stored in your local PaperFlow data folder. Credentials are stored as local plaintext with restricted file permissions where supported. Use this app on a computer you trust.</p></div>
    <div class="settings-actions"><button type="submit" class="button">Save settings</button><a href="#library">Go to library</a></div>
  </form>`;
  document.querySelector('#settings-form').addEventListener('submit', async event => { event.preventDefault(); try { await saveSettings(); toast('Settings saved.'); } catch (error) { toast(error.message, true); } });
}

async function saveSettings() {
  const form = document.querySelector('#settings-form');
  if (!form.reportValidity()) throw new Error('Complete the highlighted fields.');
  const input = {};
  for (const key of ['openaiKey','notionKey','model','notionParentId']) {
    const element = document.getElementById(key);
    if (element.disabled) continue;
    if (['openaiKey','notionKey'].includes(key) && !element.value.trim()) continue;
    input[key] = element.value;
  }
  settings = await post('/api/settings', input);
  for (const [key, configured] of [['openaiKey',settings.openaiConfigured],['notionKey',settings.notionConfigured]]) {
    const element = document.getElementById(key); element.value = ''; element.placeholder = configured ? 'Saved — leave blank to keep it' : 'Paste your key or token';
    const remove = document.querySelector(`[data-action="remove-${key === 'openaiKey' ? 'openai' : 'notion'}"]`); remove.disabled = !configured || settings.environmentFields.includes(key);
  }
  document.querySelector('#notionParentId').value = settings.notionParentId;
}

function renderLecture() {
  if (!current) return;
  const busy = ['extracting','generating','publishing'].includes(current.status);
  const title = current.study?.title || current.filename;
  main.innerHTML = `<div class="editor-top"><a class="back-link" href="#library">← Your library</a><div class="editor-actions"><a class="button-secondary" target="_blank" rel="noreferrer" href="/api/lectures/${current.id}/pdf">Original PDF</a>${current.notionUrl ? `<a class="button-secondary" href="${e(current.notionUrl)}" target="_blank" rel="noreferrer">Open in Notion</a>` : ''}</div></div>
    <div class="editor-heading"><h1>${e(title)}</h1>${status(current.status)}</div><p class="editor-meta truncate">${e(current.filename)} · ${current.pageCount} ${current.pageCount === 1 ? 'page' : 'pages'}${current.model ? ` · ${e(current.model)}` : ''}</p>
    ${current.source === 'demo' ? '<div class="notice warning"><p>This is a sample guide with prewritten content. No AI call was made. Try editing and exporting the cards; upload your own PDF to process or publish notes.</p></div>' : ''}
    ${current.error ? `<div class="notice error" role="alert"><p>${e(current.error)}</p></div>` : ''}
    ${current.status === 'published' ? '<div class="notice success"><p>Your study guide and original PDF are saved in Notion.</p></div>' : ''}
    ${busy ? `<div class="busy-box"><div class="spinner" aria-hidden="true"></div><h2>${current.status === 'extracting' ? 'Reading your pages…' : current.status === 'generating' ? 'Building your study guide…' : 'Saving your lecture to Notion…'}</h2><p class="muted">You can return to the library. Progress is saved while PaperFlow is running.</p><p class="progress-stage">${current.status === 'extracting' ? 'Step 1 of 2 · Transcribing handwriting, formulas and diagrams' : current.status === 'generating' ? 'Step 2 of 2 · Organizing notes and creating flashcards' : 'Checking existing pages and uploading the original PDF'}</p></div>` : ''}
    ${!busy && !current.study ? `<div class="busy-box"><h2>${current.transcription ? 'Your transcription is saved.' : 'Your notes are ready to read.'}</h2><p class="muted">${current.transcription ? 'Retrying will generate the guide from the saved transcription.' : 'PaperFlow will send this PDF to OpenAI to read the notes and generate a study guide. API usage charges apply.'}</p>${action('process',current.status === 'processing_error' ? 'Retry processing' : 'Generate study guide')}${!settings.openaiConfigured ? ' <a href="#settings">Add your OpenAI key first</a>' : ''}<p class="small muted top-spacer">Review handwriting, mathematical symbols and generated answers before studying.</p></div>` : ''}
    ${!busy && current.study ? editorMarkup() : ''}
    ${current.transcription && !busy ? transcriptMarkup() : ''}`;
  if (current.study && !busy) bindEditor();
}

function field(path, label, value, textarea = false, extra = '') {
  const locked = current.publishStarted;
  return `<label class="field"><span>${label}</span>${textarea ? `<textarea class="edit-textarea" data-field="${path}" ${locked ? 'readonly' : ''} ${extra}>${e(value)}</textarea>` : `<input class="edit-input" data-field="${path}" value="${e(value)}" ${locked ? 'readonly' : ''} ${extra}>`}</label>`;
}
function sourceTag(item) { return `<span class="source-tag">${item.sourcePages.length ? `Source: page ${item.sourcePages.join(', ')}` : 'No page reference — verify against the PDF'}</span>`; }
function editorMarkup() {
  const locked = current.publishStarted;
  const add = (name, label) => locked ? '' : `<button type="button" class="button-text" data-add="${name}">${label}</button>`;
  const remove = (name, index) => locked ? '' : `<button type="button" class="remove-item" data-remove="${name}:${index}" aria-label="Remove ${name} ${index + 1}">Remove</button>`;
  const list = (name, title, first, second) => `<section class="edit-section" id="${name}"><h2>${title}</h2>${draft[name].map((item,index) => `<div class="item-editor"><div class="item-header"><input aria-label="${title} title ${index + 1}" class="edit-input" data-field="${name}.${index}.${first}" value="${e(item[first])}" ${locked ? 'readonly' : ''}>${remove(name,index)}</div><textarea aria-label="${title} explanation ${index + 1}" class="edit-textarea" data-field="${name}.${index}.${second}" ${locked ? 'readonly' : ''}>${e(item[second])}</textarea>${sourceTag(item)}</div>`).join('') || '<p class="no-items">No items in this section.</p>'}${add(name,`Add ${title.toLowerCase().replace(/s$/, '')}`)}</section>`;
  return `<div class="editor-grid"><div class="editor-content">
    <div class="metadata-grid">${field('course','Course',draft.course,false,'maxlength="120"')}${field('title','Topic',draft.title,false,'maxlength="200"')}${field('date','Lecture date',draft.date || '',false,'type="date"')}</div>
    <section class="edit-section" id="summary"><div class="review-title"><h2>Summary</h2><span id="save-state" class="${dirty ? 'dirty-label' : 'muted small'}">${dirty ? 'Unsaved edits' : 'Saved locally'}</span></div>${field('summary','Lecture summary',draft.summary,true)}</section>
    <section class="edit-section" id="cleanedNotes"><h2>Cleaned notes</h2>${field('cleanedNotes','Editable notes',draft.cleanedNotes,true,'rows="9"')}</section>
    ${list('keyConcepts','Key concepts','title','explanation')}${list('definitions','Definitions','term','meaning')}${list('formulas','Formulas','expression','explanation')}
    <section class="edit-section" id="reviewPoints"><h2>Things to review</h2><div class="review-points">${draft.reviewPoints.map((item,index) => `<div class="review-point"><textarea class="edit-textarea" aria-label="Review point ${index + 1}" data-field="reviewPoints.${index}" ${locked ? 'readonly' : ''}>${e(item)}</textarea>${remove('reviewPoints',index)}</div>`).join('')}</div>${add('reviewPoints','Add review point')}</section>
    <section class="edit-section" id="flashcards"><div class="section-heading"><h2>Flashcards</h2><span class="muted small">${draft.flashcards.length} cards</span></div>${draft.flashcards.map((card,index) => `<div class="item-editor"><div class="flashcard-header"><span class="card-number">Card ${index + 1}</span>${remove('flashcards',index)}</div><div class="flashcard-fields">${field(`flashcards.${index}.front`,'Front — question',card.front,true)}${field(`flashcards.${index}.back`,'Back — answer',card.back,true)}</div>${sourceTag(card)}</div>`).join('') || '<p class="no-items">No cards yet. Add cards supported by your notes.</p>'}${add('flashcards','Add flashcard')}</section>
    <div class="guide-footer"><div class="editor-actions">${!locked ? action('save','Save edits','button-secondary') : ''}${action('csv','Download Anki CSV','button-secondary',!draft.flashcards.length)}</div><span class="small muted">${current.usage.input + current.usage.output ? `${(current.usage.input + current.usage.output).toLocaleString()} tokens used` : 'Saved on this computer'}</span></div>
  </div><aside class="editor-aside"><h3>Review before you study.</h3><p>Check formulas, unclear handwriting and card answers against the original PDF.</p>
    <a href="#summary" data-scroll="summary">Summary</a><a href="#cleanedNotes" data-scroll="cleanedNotes">Cleaned notes</a><a href="#keyConcepts" data-scroll="keyConcepts">Key concepts</a><a href="#definitions" data-scroll="definitions">Definitions</a><a href="#formulas" data-scroll="formulas">Formulas</a><a href="#flashcards" data-scroll="flashcards">Flashcards</a>
    <div class="top-spacer">${!locked ? action('save','Save edits','button-secondary') : ''}</div>
    <div class="top-spacer">${current.status !== 'published' ? action('publish',current.status === 'partial' ? 'Retry Notion publish' : 'Publish to Notion','button',current.source === 'demo') : ''}</div>
    <p class="top-spacer">${locked ? 'This guide is locked because publishing has started. Retries complete the same saved version.' : 'Publishing saves your current edits and sends the guide and original PDF to Notion.'}</p>
    ${!settings.notionConfigured || !settings.notionParentId ? '<a href="#settings">Set up Notion</a>' : ''}
  </aside></div>`;
}

function bindEditor() {
  main.querySelectorAll('[data-field]').forEach(input => input.addEventListener('input', () => {
    const keys = input.dataset.field.split('.'); let target = draft;
    for (const key of keys.slice(0,-1)) target = target[key];
    const key = keys.at(-1); target[key] = input.dataset.field === 'date' ? input.value || null : input.value; markDirty();
  }));
}
function transcriptMarkup() {
  return `<details class="transcript"><summary>Original transcription · ${current.transcription.pages.length} pages</summary>${current.transcription.pages.map(page => `<section class="transcript-page"><h3>Page ${page.page}</h3><pre>${e(page.text || '[Blank page]')}</pre>${page.diagrams.length ? `<p><strong>Diagrams</strong></p><ul>${page.diagrams.map(text => `<li>${e(text)}</li>`).join('')}</ul>` : ''}${page.uncertainties.length ? `<div class="notice warning"><strong>Check these details</strong><ul>${page.uncertainties.map(text => `<li>${e(text)}</li>`).join('')}</ul></div>` : ''}</section>`).join('')}</details>`;
}

async function saveGuide() {
  if (!current || current.publishStarted || !dirty) return;
  current = await post(`/api/lectures/${current.id}`, draft); dirty = false;
  const label = document.querySelector('#save-state'); if (label) { label.textContent = 'Saved locally'; label.className = 'muted small'; }
}
async function pollLecture() {
  if (!current || !['extracting','generating','publishing'].includes(current.status)) return;
  const id = current.id;
  try {
    const fresh = await api(`/api/lectures/${id}`);
    if (!current || current.id !== id) return;
    if (fresh.status !== current.status) { current = fresh; draft = fresh.study ? structuredClone(fresh.study) : null; renderLecture(); }
  } catch { /* Keep saved UI; the active operation reports connection errors. */ }
}

main.addEventListener('click', async event => {
  const button = event.target.closest('button');
  const scroll = event.target.closest('[data-scroll]');
  if (scroll) { event.preventDefault(); document.getElementById(scroll.dataset.scroll)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); return; }
  if (!button || button.disabled) return;
  if (button.dataset.add) {
    const name = button.dataset.add; const limits = { keyConcepts:25,definitions:25,formulas:25,reviewPoints:30,flashcards:60 };
    if (draft[name].length >= limits[name]) return toast(`This section allows up to ${limits[name]} items.`,true);
    const values = { keyConcepts:{title:'',explanation:'',sourcePages:[]}, definitions:{term:'',meaning:'',sourcePages:[]}, formulas:{expression:'',explanation:'',sourcePages:[]}, flashcards:{front:'',back:'',sourcePages:[]}, reviewPoints:'' };
    draft[name].push(values[name]); markDirty(); renderLecture(); document.getElementById(name)?.scrollIntoView({block:'center'}); return;
  }
  if (button.dataset.remove) { const [name,index] = button.dataset.remove.split(':'); draft[name].splice(Number(index),1); markDirty(); renderLecture(); return; }
  const name = button.dataset.action;
  if (name === 'choose') return document.querySelector('#file-input').click();
  if (name === 'reload') return route();
  button.disabled = true;
  try {
    if (name === 'demo') { const lecture = await post('/api/demo'); location.hash = `lecture/${lecture.id}`; }
    else if (name === 'save') { await saveGuide(); toast('Edits saved.'); }
    else if (name === 'csv') { await saveGuide(); location.assign(`/api/lectures/${current.id}/csv`); toast('Flashcards are ready for Anki import.'); }
    else if (name === 'process' || name === 'publish') {
      const id = current.id;
      if (name === 'publish') await saveGuide();
      const request = post(`/api/lectures/${id}/${name}`).then(result => ({result}), error => ({error}));
      // Observe the server status while the operation is in progress.
      await new Promise(resolve => setTimeout(resolve,180));
      if (current?.id === id) { const fresh = await api(`/api/lectures/${id}`); current = fresh; renderLecture(); }
      const outcome = await request;
      if (outcome.error) throw outcome.error;
      const result = outcome.result;
      if (current?.id === id) { current = result; draft = result.study ? structuredClone(result.study) : null; renderLecture(); }
      if (result.error) toast(result.error,true); else toast(name === 'process' ? 'Your study guide is ready to review.' : 'Guide and PDF published to Notion.');
    }
    else if (name === 'test-openai' || name === 'test-notion') {
      const provider = name.split('-')[1]; await saveSettings();
      const resultElement = document.getElementById(`${provider}-result`); resultElement.className = 'connection-result'; resultElement.textContent = 'Checking connection…';
      try { const result = await post('/api/settings/test',{provider}); resultElement.textContent = result.message; }
      catch (error) { resultElement.textContent = error.message; resultElement.className = 'connection-result error'; }
    }
    else if (name === 'remove-openai' || name === 'remove-notion') {
      const key = name === 'remove-openai' ? 'openaiKey' : 'notionKey';
      if (confirm('Remove this saved credential from PaperFlow?')) { await post('/api/settings',{[key]:''}); settings = await api('/api/settings'); renderSettings(); toast('Saved credential removed.'); }
    }
  } catch (error) { toast(error.message,true); }
  finally { if (button.isConnected) button.disabled = false; }
});

document.addEventListener('click', event => {
  const link = event.target.closest('a[href^="#"]');
  if (link && !link.dataset.scroll && link.hash !== location.hash && !guardNavigation()) event.preventDefault();
});
window.addEventListener('beforeunload',event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('hashchange',route);
await route();
