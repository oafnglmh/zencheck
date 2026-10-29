/* =========================================================================
 * Tra cứu văn bằng - CCE (Giao diện tối giản phong cách tìm kiếm Google)
 * ========================================================================= */
(() => {
  'use strict';

  const DATA_DIR = 'data/';
  const PAGE_SIZE = 15;
  const NAME_COL = 'Họ, chữ đệm và tên';

  const app = document.getElementById('app');
  const headerBrand = document.getElementById('header-brand');
  const headerSearch = document.getElementById('header-search');
  const headerStat = document.getElementById('header-stat');
  const miniForm = document.getElementById('mini-search-form');
  const miniInput = document.getElementById('mini-search-input');
  const miniSuggest = document.getElementById('mini-suggest-box');

  const state = {
    manifest: null,
    names: [],
    namesFold: [],
    byId: new Map(),
    docs: new Map(),
    pending: new Map(),
    pendingScripts: new Map(),
    seq: 0,
  };

  /* ---------------------------------------------------------------- utils */
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtNum = (n) => Number(n || 0).toLocaleString('vi-VN');
  const MARKS = /[\u0300-\u036f]/g;
  const fold = (s) => String(s).toLowerCase().normalize('NFD').replace(MARKS, '').replace(/đ/g, 'd');
  const padDates = (s) => s.replace(/(^|\D)(\d{1,2})([/.-])(\d{1,2})\3(\d{4})(?!\d)/g,
    (m, pre, d, sep, mo, y) => `${pre}${d.padStart(2, '0')}/${mo.padStart(2, '0')}/${y}`);
  const norm = (s) => padDates(fold(s)).replace(/\s+/g, ' ').trim();

  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.hidden = true; }, 2200);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    toast('Đã sao chép vào bộ nhớ tạm');
  }

  function highlight(text, terms) {
    text = String(text ?? '');
    if (!text || !terms || !terms.length) return esc(text);
    let folded = '';
    const map = [];
    for (let i = 0; i < text.length; i++) {
      const f = fold(text[i]);
      for (let k = 0; k < f.length; k++) { folded += f[k]; map.push(i); }
    }
    const ranges = [];
    for (const t of terms) {
      if (!t) continue;
      let from = 0;
      let p;
      while ((p = folded.indexOf(t, from)) !== -1) {
        ranges.push([map[p], map[p + t.length - 1] + 1]);
        from = p + t.length;
      }
    }
    if (!ranges.length) return esc(text);
    ranges.sort((a, b) => a[0] - b[0]);
    const merged = [ranges[0]];
    for (const r of ranges.slice(1)) {
      const last = merged[merged.length - 1];
      if (r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else merged.push(r);
    }
    let out = '';
    let pos = 0;
    for (const [a, b] of merged) {
      out += esc(text.slice(pos, a)) + '<mark>' + esc(text.slice(a, b)) + '</mark>';
      pos = b;
    }
    return out + esc(text.slice(pos));
  }

  /* --------------------------------------------------------------- routing */
  function parseHash() {
    const h = location.hash.replace(/^#/, '') || '/';
    const qi = h.indexOf('?');
    const path = qi === -1 ? h : h.slice(0, qi);
    const params = new URLSearchParams(qi === -1 ? '' : h.slice(qi + 1));
    return { path, params };
  }

  function setHash(path, params) {
    const qs = params.toString();
    location.hash = '#' + path + (qs ? '?' + qs : '');
  }

  function replaceHash(path, params) {
    const qs = params.toString();
    history.replaceState(null, '', '#' + path + (qs ? '?' + qs : ''));
  }

  /* ------------------------------------------------------------ data load */
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.charset = 'utf-8';
      s.onload = () => { s.remove(); resolve(); };
      s.onerror = () => { s.remove(); reject(new Error('Failed to load script: ' + src)); };
      document.head.appendChild(s);
    });
  }

  window.__LOAD_FILE__ = function (doc) {
    if (doc && doc.id) {
      const entry = state.byId.get(doc.id);
      if (entry) doc.entry = entry;
      initDoc(doc);
      state.docs.set(doc.id, doc);
      const res = state.pendingScripts.get(doc.id);
      if (res) {
        state.pendingScripts.delete(doc.id);
        res.resolve(doc);
      }
    }
  };

  function initDoc(doc) {
    doc.colIndex = Object.create(null);
    doc.columns.forEach((c, i) => { doc.colIndex[c] = i; });
    const stt = doc.colIndex.STT;
    const cells = doc.rows.map((r) => r.map((v) => (v ? norm(v) : '')));
    const all = cells.map((r) => r.filter((v, i) => v && i !== stt).join(' \u0001 '));
    doc.prep = { cells, all };
  }

  async function loadManifest() {
    if (window.__DATA_MANIFEST__) return onManifestLoaded(window.__DATA_MANIFEST__);

    if (location.protocol === 'file:') {
      await loadScript(DATA_DIR + 'index.js');
      if (window.__DATA_MANIFEST__) return onManifestLoaded(window.__DATA_MANIFEST__);
    }

    try {
      const res = await fetch(DATA_DIR + 'index.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const m = await res.json();
      return onManifestLoaded(m);
    } catch {
      await loadScript(DATA_DIR + 'index.js');
      if (window.__DATA_MANIFEST__) return onManifestLoaded(window.__DATA_MANIFEST__);
      throw new Error('Không đọc được dữ liệu index');
    }
  }

  function onManifestLoaded(m) {
    m.files.forEach((f) => {
      f._fold = fold(`${f.name} ${f.title || ''} ${f.source || ''}`);
      state.byId.set(f.id, f);
    });
    state.manifest = m;
    return m;
  }

  async function loadNames() {
    if (state.names.length) return state.names;
    if (window.__NAMES__) return setNames(window.__NAMES__);

    if (location.protocol === 'file:') {
      try {
        await loadScript(DATA_DIR + 'names.js');
        if (window.__NAMES__) return setNames(window.__NAMES__);
      } catch (e) {
        console.warn('Could not load names.js via script tag', e);
      }
    }

    try {
      const res = await fetch(DATA_DIR + 'names.json');
      if (res.ok) {
        const list = await res.json();
        return setNames(list);
      }
    } catch {
      try {
        await loadScript(DATA_DIR + 'names.js');
        if (window.__NAMES__) return setNames(window.__NAMES__);
      } catch { }
    }
    return [];
  }

  function setNames(list) {
    state.names = list;
    state.namesFold = list.map((n) => fold(n));
    return list;
  }

  function loadDoc(entry) {
    if (state.docs.has(entry.id)) return Promise.resolve(state.docs.get(entry.id));
    if (state.pending.has(entry.id)) return state.pending.get(entry.id);

    const isFileProto = location.protocol === 'file:';
    let p;

    if (isFileProto) {
      const jsRel = entry.path.replace(/\.json$/, '.js');
      const scriptUrl = DATA_DIR + jsRel.split('/').map(encodeURIComponent).join('/');
      p = new Promise((resolve, reject) => {
        state.pendingScripts.set(entry.id, { resolve, reject });
        loadScript(scriptUrl).catch((err) => {
          state.pendingScripts.delete(entry.id);
          reject(err);
        });
      });
    } else {
      const url = DATA_DIR + entry.path.split('/').map(encodeURIComponent).join('/') + '?v=' + (entry.mtime || '');
      p = fetch(url)
        .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then((doc) => {
          doc.entry = entry;
          initDoc(doc);
          state.docs.set(entry.id, doc);
          return doc;
        });
    }

    p = p.finally(() => { state.pending.delete(entry.id); });
    state.pending.set(entry.id, p);
    return p;
  }

  async function loadAllDocs(onProgress) {
    if (state.docs.size >= state.manifest.files.length) return;

    // Ưu tiên nạp 1 file bundle gộp duy nhất (nhanh gấp 50 lần nạp 620 file lẻ)
    if (window.__DATA_BUNDLE__) {
      initBundle(window.__DATA_BUNDLE__);
      if (onProgress) onProgress(state.manifest.files.length, state.manifest.files.length);
      return;
    }

    if (location.protocol === 'file:') {
      try {
        await loadScript(DATA_DIR + 'bundle.js');
        if (window.__DATA_BUNDLE__) {
          initBundle(window.__DATA_BUNDLE__);
          if (onProgress) onProgress(state.manifest.files.length, state.manifest.files.length);
          return;
        }
      } catch (e) {
        console.warn('Could not load bundle.js via script tag', e);
      }
    }

    try {
      const res = await fetch(DATA_DIR + 'bundle.json');
      if (res.ok) {
        const bundle = await res.json();
        initBundle(bundle);
        if (onProgress) onProgress(state.manifest.files.length, state.manifest.files.length);
        return;
      }
    } catch {
      try {
        await loadScript(DATA_DIR + 'bundle.js');
        if (window.__DATA_BUNDLE__) {
          initBundle(window.__DATA_BUNDLE__);
          if (onProgress) onProgress(state.manifest.files.length, state.manifest.files.length);
          return;
        }
      } catch { }
    }

    // Fallback: Nếu không có bundle thì nạp song song từng file như cũ
    const entries = state.manifest.files;
    const todo = entries.filter((e) => !state.docs.has(e.id));
    let done = entries.length - todo.length;
    if (onProgress) onProgress(done, entries.length);
    let i = 0;
    const worker = async () => {
      while (i < todo.length) {
        const e = todo[i++];
        try { await loadDoc(e); } catch (err) { console.error(e.path, err); }
        done++;
        if (onProgress) onProgress(done, entries.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, todo.length) }, worker));
  }

  function initBundle(bundle) {
    bundle.forEach((doc) => {
      const entry = state.byId.get(doc.id);
      if (entry) doc.entry = entry;
      initDoc(doc);
      state.docs.set(doc.id, doc);
    });
  }

  /* ------------------------------------------------------------- search */
  const WORD_CH = /[\p{L}\p{N}]/u;
  const isWordCh = (ch) => !!ch && WORD_CH.test(ch);
  const wordAt = (hay, i, len) => !isWordCh(hay[i - 1]) && !isWordCh(hay[i + len]);

  function wordHit(hay, t) {
    let p = hay.indexOf(t);
    while (p !== -1) {
      if (wordAt(hay, p, t.length)) return true;
      p = hay.indexOf(t, p + 1);
    }
    return false;
  }

  function search(queryStr) {
    const phrase = norm(queryStr);
    const tokens = phrase.split(' ').filter(Boolean);
    if (!tokens.length) return { results: [], tokens: [] };

    const results = [];
    const docs = state.manifest.files.map((f) => state.docs.get(f.id)).filter(Boolean);

    for (const doc of docs) {
      const { cells, all } = doc.prep;
      const nameIdx = doc.colIndex[NAME_COL];
      for (let i = 0; i < doc.rows.length; i++) {
        const line = all[i] + ' \u0001 ' + norm(doc.group) + ' \u0001 ' + norm(doc.fileName);
        if (!tokens.every((t) => line.includes(t))) continue;

        // Tính điểm ưu tiên
        let score = 1;
        const nameVal = nameIdx !== undefined ? cells[i][nameIdx] : '';
        if (nameVal === phrase) score += 1000;
        else if (nameVal && nameVal.includes(phrase)) score += 400;
        else if (line.includes(phrase)) score += 200;

        for (const t of tokens) {
          if (nameVal && wordHit(nameVal, t)) score += 50;
          else if (wordHit(line, t)) score += 10;
        }

        results.push({ doc, i, score });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return { results, tokens };
  }

  /* ----------------------------------------------------- autocomplete */
  function getSuggestions(val, limit = 15) {
    val = fold(val.trim());
    if (!val) return [];
    const tokens = val.split(/\s+/).filter(Boolean);
    const matches = [];

    // Ưu tiên 1: Tên bắt đầu bằng từ khóa
    // Ưu tiên 2: Tên chứa từ khóa
    const starts = [];
    const contains = [];

    for (let i = 0; i < state.names.length; i++) {
      const f = state.namesFold[i];
      if (tokens.every((t) => f.includes(t))) {
        if (f.startsWith(val)) {
          starts.push(state.names[i]);
          if (starts.length >= limit) break;
        } else {
          if (contains.length < limit) contains.push(state.names[i]);
        }
      }
    }

    return [...starts, ...contains].slice(0, limit);
  }

  function bindAutocomplete(inputEl, boxEl, wrapEl, onSelect) {
    let activeIdx = -1;
    let currentItems = [];

    const close = () => {
      boxEl.hidden = true;
      boxEl.innerHTML = '';
      if (wrapEl) wrapEl.classList.remove('has-suggest');
      activeIdx = -1;
      currentItems = [];
    };

    const render = (items) => {
      currentItems = items;
      activeIdx = -1;
      if (!items.length) {
        close();
        return;
      }
      const val = inputEl.value.trim();
      const tokens = fold(val).split(/\s+/).filter(Boolean);

      boxEl.innerHTML = items.map((item, idx) => `
        <div class="suggest-item" data-idx="${idx}">
          <span class="suggest-icon"></span>
          <span class="suggest-text">${highlight(item, tokens)}</span>
        </div>
      `).join('');

      boxEl.hidden = false;
      if (wrapEl) wrapEl.classList.add('has-suggest');
    };

    inputEl.addEventListener('input', () => {
      const q = inputEl.value;
      if (!q.trim()) {
        close();
        return;
      }
      const list = getSuggestions(q, 8);
      render(list);
    });

    inputEl.addEventListener('keydown', (e) => {
      if (boxEl.hidden || !currentItems.length) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeIdx = (activeIdx + 1) % currentItems.length;
        updateActive();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeIdx = (activeIdx - 1 + currentItems.length) % currentItems.length;
        updateActive();
      } else if (e.key === 'Enter') {
        if (activeIdx >= 0 && activeIdx < currentItems.length) {
          e.preventDefault();
          select(currentItems[activeIdx]);
        }
      } else if (e.key === 'Escape') {
        close();
      }
    });

    function updateActive() {
      const els = boxEl.querySelectorAll('.suggest-item');
      els.forEach((el, idx) => {
        el.classList.toggle('active', idx === activeIdx);
        if (idx === activeIdx) {
          el.scrollIntoView({ block: 'nearest' });
        }
      });
      if (activeIdx >= 0) {
        inputEl.value = currentItems[activeIdx];
      }
    }

    function select(name) {
      inputEl.value = name;
      close();
      onSelect(name);
    }

    boxEl.addEventListener('mousedown', (e) => {
      const item = e.target.closest('.suggest-item');
      if (!item) return;
      const idx = +item.dataset.idx;
      select(currentItems[idx]);
    });

    document.addEventListener('click', (e) => {
      if (!boxEl.contains(e.target) && e.target !== inputEl) {
        close();
      }
    });
  }

  /* ------------------------------------------------------------- views */
  function renderHome() {
    headerBrand.hidden = true;
    headerSearch.hidden = true;
    document.querySelector('.app-header').classList.remove('has-border');
    document.title = 'Tra cứu văn bằng - CCE';

    app.innerHTML = `
      <div class="home-center">
        <div class="home-logo-wrap">
          <img src="assets/logo.png" alt="CCE Logo" class="home-logo">
          <h1 class="home-title">Tra cứu văn bằng</h1>
          <p class="home-subtitle">Trung tâm Đào tạo Thường xuyên - Đại học Đà Nẵng</p>
        </div>
        <div class="search-box-wrap" id="home-search-wrap">
          <form id="home-search-form" autocomplete="off">
            <div class="search-bar">
              <span class="search-icon-svg"></span>
              <input type="search" id="home-search-input" autofocus autocomplete="off"
                placeholder="Nhập họ tên, số hiệu bằng, số định danh...">
            </div>
            <div class="suggest-box" id="home-suggest-box" hidden></div>
          </form>
        </div>
      </div>`;

    const form = document.getElementById('home-search-form');
    const input = document.getElementById('home-search-input');
    const box = document.getElementById('home-suggest-box');
    const wrap = document.getElementById('home-search-wrap');

    const doSearch = (q) => {
      q = q.trim();
      if (q) setHash('/search', new URLSearchParams({ q }));
    };

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      doSearch(input.value);
    });

    bindAutocomplete(input, box, wrap, (name) => {
      doSearch(name);
    });
  }

  async function renderSearch(params) {
    const q = params.get('q') || '';
    if (!q.trim()) { setHash('/', new URLSearchParams()); return; }

    headerBrand.hidden = false;
    headerSearch.hidden = false;
    document.querySelector('.app-header').classList.add('has-border');
    miniInput.value = q;
    document.title = `${q} - Tìm kiếm văn bằng`;

    const seq = ++state.seq;

    // Kiểm tra cần nạp dữ liệu không
    const needLoad = state.manifest.files.some((f) => !state.docs.has(f.id));
    if (needLoad) {
      app.innerHTML = `
        <div class="loading-state">
          <div class="spinner"></div>
          <p>Đang chuẩn bị dữ liệu (<span id="load-prog">0</span>/${fmtNum(state.manifest.totalFiles)} file)...</p>
        </div>`;
      await loadAllDocs((done, total) => {
        if (seq !== state.seq) return;
        const el = document.getElementById('load-prog');
        if (el) el.textContent = fmtNum(done);
      });
      if (seq !== state.seq) return;
    }

    const t0 = performance.now();
    const { results, tokens } = search(q);
    const ms = Math.round(performance.now() - t0);

    const total = results.length;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const page = Math.min(Math.max(1, +params.get('page') || 1), pages);
    const start = (page - 1) * PAGE_SIZE;
    const slice = results.slice(start, start + PAGE_SIZE);

    if (!total) {
      app.innerHTML = `
        <div class="results-page">
          <div class="results-meta">Khoảng 0 kết quả (${ms} mili-giây)</div>
          <div class="empty-state">
            <p>Không tìm thấy thông tin phù hợp với từ khóa: <b>${esc(q)}</b></p>
            <p style="margin-top:8px;font-size:13px">Gợi ý: Kiểm tra lại chính tả, thử gõ không dấu hoặc thử nhập số hiệu bằng / số định danh.</p>
          </div>
        </div>`;
      return;
    }

    const cards = slice.map((item, idx) => {
      const { doc, i } = item;
      const getVal = (col) => {
        const ci = doc.colIndex[col];
        return ci !== undefined ? (doc.rows[i][ci] || '') : '';
      };

      const name = getVal(NAME_COL) || 'Chưa rõ họ tên';
      const dob = getVal('Ngày, tháng, năm sinh');
      const soHieu = getVal('Số hiệu bằng');
      const soVaoSo = getVal('Số vào sổ gốc cấp văn bằng');
      const nganh = getVal('Ngành đào tạo');
      const xepLoai = getVal('Xếp loại tốt nghiệp');
      const cccd = getVal('Số định danh cá nhân');

      const snippetParts = [];
      if (dob) snippetParts.push(`<span>Ngày sinh: <b>${highlight(dob, tokens)}</b></span>`);
      if (soHieu) snippetParts.push(`<span>Số bằng: <b>${highlight(soHieu, tokens)}</b></span>`);
      if (soVaoSo) snippetParts.push(`<span>Số vào sổ: <b>${highlight(soVaoSo, tokens)}</b></span>`);
      if (nganh) snippetParts.push(`<span>Ngành: <b>${highlight(nganh, tokens)}</b></span>`);
      if (xepLoai) snippetParts.push(`<span>Xếp loại: <b>${highlight(xepLoai, tokens)}</b></span>`);
      if (cccd) snippetParts.push(`<span>CCCD/Định danh: <b>${highlight(cccd, tokens)}</b></span>`);

      return `
        <article class="result-card" data-idx="${start + idx}">
          <div class="result-file-source">
            <span>Năm ${esc(doc.group)}</span>
            <span class="sub">›</span>
            <span class="sub">${esc(doc.fileName)}</span>
          </div>
          <div class="result-name-link">${highlight(name, tokens)}</div>
          <div class="result-snippet">${snippetParts.join('')}</div>
        </article>`;
    }).join('');

    app.innerHTML = `
      <div class="results-page">
        <div class="results-meta">Khoảng ${fmtNum(total)} kết quả (${ms} mili-giây)</div>
        <div class="results-list">${cards}</div>
        ${paginationHTML(page, pages)}
      </div>`;

    app.querySelector('.results-list').addEventListener('click', (e) => {
      const card = e.target.closest('.result-card');
      if (!card) return;
      const pos = +card.dataset.idx;
      openModal(results, pos, tokens);
    });

    const pag = app.querySelector('.pagination');
    if (pag) {
      pag.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-p]');
        if (!btn || btn.disabled) return;
        params.set('page', btn.dataset.p);
        replaceHash('/search', params);
        window.scrollTo(0, 0);
        renderSearch(params);
      });
    }
  }

  function paginationHTML(page, pages) {
    if (pages <= 1) return '';
    const nums = new Set([1, pages, page - 2, page - 1, page, page + 1, page + 2]);
    const list = [...nums].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
    let html = `<button data-p="${page - 1}" ${page === 1 ? 'disabled' : ''}>Trước</button>`;
    let prev = 0;
    for (const n of list) {
      if (n - prev > 1) html += '<button disabled>...</button>';
      html += `<button data-p="${n}" class="${n === page ? 'active' : ''}">${n}</button>`;
      prev = n;
    }
    html += `<button data-p="${page + 1}" ${page === pages ? 'disabled' : ''}>Sau</button>`;
    return `<div class="pagination">${html}</div>`;
  }

  /* ------------------------------------------------------------- modal */
  const modal = document.getElementById('modal');
  let modalList = null;
  let modalPos = 0;
  let modalTokens = [];

  function openModal(list, pos, tokens) {
    modalList = list;
    modalPos = pos;
    modalTokens = tokens;
    drawModal();
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function drawModal() {
    const { doc, i } = modalList[modalPos];
    const nameIdx = doc.colIndex[NAME_COL];
    const name = nameIdx !== undefined ? doc.rows[i][nameIdx] : `Bản ghi #${i + 1}`;
    document.getElementById('modal-title').textContent = name || 'Chi tiết';

    const items = doc.columns.map((c, idx) => {
      const v = doc.rows[i][idx] || '';
      if (!v) return '';
      return `<div class="detail-k">${esc(c)}</div><div class="detail-v">${highlight(v, modalTokens)}</div>`;
    }).filter(Boolean).join('');

    document.getElementById('modal-body').innerHTML = `
      <div class="detail-grid">${items}</div>
      <div class="detail-source">
        Nguồn: <b>${esc(doc.fileName)}</b> (Năm ${esc(doc.group)})
        ${doc.title ? `<br>${esc(doc.title)}` : ''}
      </div>`;

    document.getElementById('modal-foot').innerHTML = `
      <div style="display:flex;gap:8px;align-items:center">
        <button class="btn-g" id="btn-m-prev" ${modalPos === 0 ? 'disabled' : ''}>Trước</button>
        <span style="font-size:13px;color:var(--muted)">${fmtNum(modalPos + 1)} / ${fmtNum(modalList.length)}</span>
        <button class="btn-g" id="btn-m-next" ${modalPos === modalList.length - 1 ? 'disabled' : ''}>Sau</button>
      </div>
      <button class="btn-g" id="btn-m-copy">Sao chép</button>`;

    document.getElementById('btn-m-prev').onclick = () => { if (modalPos > 0) { modalPos--; drawModal(); } };
    document.getElementById('btn-m-next').onclick = () => { if (modalPos < modalList.length - 1) { modalPos++; drawModal(); } };
    document.getElementById('btn-m-copy').onclick = () => {
      const text = doc.columns.map((c, idx) => (doc.rows[i][idx] ? `${c}: ${doc.rows[i][idx]}` : ''))
        .filter(Boolean).concat(`Nguồn: ${doc.fileName}`).join('\n');
      copyText(text);
    };
  }

  function closeModal() {
    modal.hidden = true;
    document.body.style.overflow = '';
  }

  modal.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (modal.hidden) return;
    if (e.key === 'Escape') closeModal();
    if (e.key === 'ArrowLeft' && modalPos > 0) { modalPos--; drawModal(); }
    if (e.key === 'ArrowRight' && modalList && modalPos < modalList.length - 1) { modalPos++; drawModal(); }
  });

  /* ------------------------------------------------------------- router */
  function route() {
    if (!modal.hidden) closeModal();
    const { path, params } = parseHash();
    if (path === '/search') renderSearch(params);
    else renderHome();
  }

  miniForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = miniInput.value.trim();
    if (q) setHash('/search', new URLSearchParams({ q }));
  });

  bindAutocomplete(miniInput, miniSuggest, miniForm, (name) => {
    setHash('/search', new URLSearchParams({ q: name }));
  });

  async function boot() {
    try {
      await Promise.all([loadManifest(), loadNames()]);
      window.addEventListener('hashchange', route);
      route();
    } catch (err) {
      app.innerHTML = `<div class="empty-state"><h3>Không đọc được dữ liệu</h3><p>${esc(err.message)}</p></div>`;
    }
  }

  boot();
})();
