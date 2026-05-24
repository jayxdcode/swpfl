// saved.js
(async function() {
  const { getItems, setItems, getSettings, exportBlob, log } = window.swpStore;
  
  const listEl = document.getElementById('savedList');
  const emptyEl = document.getElementById('emptyState');
  const searchEl = document.getElementById('searchInput');
  const sortEl = document.getElementById('sortSelect');
  const exportBtn = document.getElementById('exportBtn');
  const importFile = document.getElementById('importFile');
  const bulkDeleteBtn = document.getElementById('bulkDeleteBtn');
  
  let items = await getItems();
  let filter = '';
  let sortMode = 'new';
  let selected = new Set();
  
  function render() {
    const q = filter.trim().toLowerCase();
    let arr = items.slice();
    
    if (q) {
      arr = arr.filter(x =>
        (x.title || '').toLowerCase().includes(q) ||
        (x.content || '').toLowerCase().includes(q) ||
        (x.tags || []).join(' ').toLowerCase().includes(q)
      );
    }
    if (sortMode === 'new') arr.sort((a, b) => b.ts - a.ts);
    if (sortMode === 'old') arr.sort((a, b) => a.ts - b.ts);
    if (sortMode === 'title') arr.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    if (sortMode === 'pin') arr.sort((a, b) => (b.pinned === true) - (a.pinned === true) || (b.ts - a.ts));
    
    listEl.innerHTML = '';
    if (arr.length === 0) { emptyEl.style.display = 'block'; return; }
    emptyEl.style.display = 'none';
    
    for (const it of arr) {
      const li = document.createElement('li');
      li.className = 'saved-item';
      li.dataset.id = it.id;
      
      const cbWrap = document.createElement('div');
      cbWrap.className = 'checkbox';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = selected.has(it.id);
      cb.addEventListener('change', () => { cb.checked ? selected.add(it.id) : selected.delete(it.id); });
      cbWrap.appendChild(cb);
      
      const meta = document.createElement('div');
      meta.className = 'meta';
      const title = document.createElement('span');
      title.className = 'title';
      title.textContent = it.title || '(untitled)';
      const info = document.createElement('small');
      const d = new Date(it.ts || Date.now());
      info.textContent = `• ${d.toLocaleString()}${it.url?` • ${new URL(it.url).hostname}`:''}`;
      const tags = document.createElement('small');
      tags.className = 'tags';
      if (it.tags?.length) tags.textContent = `#${it.tags.join(' #')}`;
      
      const content = document.createElement('div');
      content.className = 'content';
      content.style.opacity = .9;
      content.textContent = (it.content || '').slice(0, 280);
      
      meta.appendChild(title);
      meta.appendChild(info);
      if (it.tags?.length) meta.appendChild(tags);
      
      const actions = document.createElement('div');
      actions.className = 'actions';
      
      const pinBtn = document.createElement('button');
      pinBtn.className = 'icon-btn pin';
      pinBtn.dataset.pinned = it.pinned ? 'true' : 'false';
      pinBtn.title = 'Pin';
      pinBtn.innerHTML = `<i class='bx ${it.pinned?'bx-pin':'bx-pin'}'></i>`;
      pinBtn.addEventListener('click', async () => {
        it.pinned = !it.pinned;
        await setItems(items);
        render();
      });
      
      const copyBtn = document.createElement('button');
      copyBtn.className = 'icon-btn';
      copyBtn.title = 'Copy content';
      copyBtn.innerHTML = `<i class='bx bx-copy'></i>`;
      copyBtn.addEventListener('click', async () => {
        await navigator.clipboard.writeText(it.content || '');
      });
      
      const editBtn = document.createElement('button');
      editBtn.className = 'icon-btn';
      editBtn.title = 'Edit';
      editBtn.innerHTML = `<i class='bx bx-edit-alt'></i>`;
      editBtn.addEventListener('click', () => enterEdit(li, it));
      
      const delBtn = document.createElement('button');
      delBtn.className = 'icon-btn';
      delBtn.title = 'Delete';
      delBtn.innerHTML = `<i class='bx bx-trash'></i>`;
      delBtn.addEventListener('click', async () => {
        items = items.filter(x => x.id !== it.id);
        await setItems(items);
        render();
      });
      
      actions.append(pinBtn, copyBtn, editBtn, delBtn);
      li.append(cbWrap, meta, actions, content);
      listEl.appendChild(li);
    }
    // bubble metrics to dashboard
    const cached = document.getElementById('cachedEntries');
    if (cached) cached.textContent = items.length.toString();
  }
  
  function enterEdit(li, it) {
    li.classList.add('editing');
    const ed = document.createElement('div');
    ed.className = 'inline-editor';
    
    ed.innerHTML = `
    <div class="row">
      <input class="ed-title" placeholder="Title" />
      <input class="ed-artist" placeholder="Artist" />
      <input class="ed-album" placeholder="Album" />
    </div>
    <textarea class="ed-lrc" rows="3" placeholder="LRC lyrics..."></textarea>
    <textarea class="ed-translation" rows="3" placeholder="Translation..."></textarea>
    <textarea class="ed-romanization" rows="3" placeholder="Romanization..."></textarea>
    <div class="row">
      <button class="btn" data-act="save"><i class='bx bx-check'></i> Save</button>
      <button class="btn" data-act="cancel"><i class='bx bx-x'></i> Cancel</button>
    </div>
  `;
    
    // Pre-fill
    ed.querySelector('.ed-title').value = it.title || '';
    ed.querySelector('.ed-artist').value = it.artist || '';
    ed.querySelector('.ed-album').value = it.album || '';
    ed.querySelector('.ed-lrc').value = it.lrc || '';
    ed.querySelector('.ed-translation').value = it.translation || '';
    ed.querySelector('.ed-romanization').value = it.romanization || '';
    
    li.appendChild(ed);
    
    // Cancel
    ed.querySelector('[data-act="cancel"]').addEventListener('click', () => {
      li.classList.remove('editing');
      ed.remove();
    });
    
    // Save
    ed.querySelector('[data-act="save"]').addEventListener('click', async () => {
      it.title = ed.querySelector('.ed-title').value.trim();
      it.artist = ed.querySelector('.ed-artist').value.trim();
      it.album = ed.querySelector('.ed-album').value.trim();
      it.lrc = ed.querySelector('.ed-lrc').value.trim();
      it.translation = ed.querySelector('.ed-translation').value.trim();
      it.romanization = ed.querySelector('.ed-romanization').value.trim();
      await setItems(items);
      render();
    });
  }
  
  // Events
  searchEl.addEventListener('input', () => {
    filter = searchEl.value;
    render();
  });
  sortEl.addEventListener('change', () => {
    sortMode = sortEl.value;
    render();
  });
  exportBtn.addEventListener('click', async () => {
    const payload = JSON.stringify({ type: 'swpfl-items', version: 1, items }, null, 2);
    await exportBlob(`swpfl-items-${new Date().toISOString().slice(0,10)}.json`, payload);
  });
  importFile.addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const text = await f.text();
    try {
      const j = JSON.parse(text);
      if (j.type === 'swpfl-items' && Array.isArray(j.items)) {
        items = j.items;
        await setItems(items);
        render();
      }
    } catch (err) { console.error(err); }
    e.target.value = '';
  });
  bulkDeleteBtn.addEventListener('click', async () => {
    if (selected.size === 0) return;
    items = items.filter(x => !selected.has(x.id));
    selected.clear();
    await setItems(items);
    render();
  });
  
  // Live updates when storage changes (sync between popup + content)
  browser.storage.onChanged.addListener(async (changes, area) => {
    const key = 'swpfl:items';
    if (changes[key]) {
      items = changes[key].newValue || [];
      render();
    }
  });
  
  render();
})();