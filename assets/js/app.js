/* =========================================================================
 * Tra cứu dữ liệu văn bằng – web tĩnh (HTML/CSS/JS thuần)
 * Đọc data/index.json (danh sách file) và data/files/**.json (từng file Excel)
 * ========================================================================= */
(() => {
  'use strict';

  const DATA_DIR = 'data/';
  const PAGE_SIZE = 50;
  const ANY_COL = '*';          // tìm trong tất cả cột
  const FILE_COL = '__file';    // tìm theo tên file
  const GROUP_COL = '__group';  // năm / thư mục
  const NAME_COL = 'Họ, chữ đệm và tên';
  const MAIN_COLS = [
    'Họ, chữ đệm và tên', 'Ngày, tháng, năm sinh', 'Số hiệu bằng',
    'Số vào sổ gốc cấp văn bằng', 'Ngành đào tạo', 'Xếp loại tốt nghiệp',
  ];
  const NOWRAP_COLS = new Set(['STT', 'Ngày, tháng, năm sinh', 'Số hiệu bằng', 'Số vào sổ gốc cấp văn bằng',
    'Số định danh cá nhân', 'Giới tính', 'Ngày tháng năm cấp bằng', 'Niên khóa', NAME_COL]);

  const app = document.getElementById('app');
  const state = {
    manifest: null,
    byId: new Map(),
    docs: new Map(),
    pending: new Map(),
    lastHomeHash: '#/',
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
  /** Chuẩn hoá để so khớp: chữ thường, (bỏ dấu), gộp khoảng trắng, ngày dạng dd/mm/yyyy */
  const norm = (s, accent) => padDates(accent ? String(s).normalize('NFC').toLowerCase() : fold(s))
    .replace(/\s+/g, ' ').trim();

  function debounce(fn, ms) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }

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
    toast('Đã sao chép vào clipboard');
  }

  /** Bôi vàng các từ khoá trong text (không phân biệt dấu nếu accent=false) */
  function highlight(text, terms, accent) {
    text = String(text ?? '');
    if (!text || !terms || !terms.length) return esc(text);
    let folded = '';
    const map = [];
    for (let i = 0; i < text.length; i++) {
      const f = accent ? text[i].toLowerCase() : fold(text[i]);
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

  function buildHash(path, params) {
    const qs = params.toString();
    return '#' + path + (qs ? '?' + qs : '');
  }

  function replaceHash(path, params) {
    history.replaceState(null, '', buildHash(path, params));
    if (path === '/') state.lastHomeHash = location.hash;
  }

  /* ------------------------------------------------------------ data load */
  // Hỗ trợ cả file:// (bấm đúp index.html) và http://
  const pendingScripts = new Map();

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.charset = 'utf-8';
      s.onload = () => { s.remove(); resolve(); };
      s.onerror = (e) => { s.remove(); reject(new Error('Failed to load script: ' + src)); };
      document.head.appendChild(s);
    });
  }

  // Hook nhận dữ liệu file khi chạy offline bằng thẻ script
  window.__LOAD_FILE__ = function (doc) {
    if (doc && doc.id) {
      const entry = state.byId.get(doc.id);
      if (entry) doc.entry = entry;
      initDoc(doc);
      state.docs.set(doc.id, doc);
      const res = pendingScripts.get(doc.id);
      if (res) {
        pendingScripts.delete(doc.id);
        res.resolve(doc);
      }
    }
  };

  function initDoc(doc) {
    doc.colIndex = Object.create(null);
    doc.columns.forEach((c, i) => { doc.colIndex[c] = i; });
    doc.fileNorm = { false: norm(doc.name, false), true: norm(doc.name, true) };
    doc.prep = {};
  }

  async function loadManifest() {
    // Nếu mở qua file:// hoặc đã được nạp sẵn index.js
    if (window.__DATA_MANIFEST__) {
      return onManifestLoaded(window.__DATA_MANIFEST__);
    }

    if (location.protocol === 'file:') {
      await loadScript(DATA_DIR + 'index.js');
      if (window.__DATA_MANIFEST__) {
        return onManifestLoaded(window.__DATA_MANIFEST__);
      }
    }

    try {
      const res = await fetch(DATA_DIR + 'index.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const m = await res.json();
      return onManifestLoaded(m);
    } catch (e) {
      // Fallback sang index.js qua script tag nếu fetch bị chặn
      await loadScript(DATA_DIR + 'index.js');
      if (window.__DATA_MANIFEST__) {
        return onManifestLoaded(window.__DATA_MANIFEST__);
      }
      throw e;
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

  function loadDoc(entry) {
    if (state.docs.has(entry.id)) return Promise.resolve(state.docs.get(entry.id));
    if (state.pending.has(entry.id)) return state.pending.get(entry.id);

    const isFileProto = location.protocol === 'file:';
    let p;

    if (isFileProto) {
      // Nạp qua script tag (offline không bị chặn CORS)
      const jsRel = entry.path.replace(/\.json$/, '.js');
      const scriptUrl = DATA_DIR + jsRel.split('/').map(encodeURIComponent).join('/');
      p = new Promise((resolve, reject) => {
        pendingScripts.set(entry.id, { resolve, reject });
        loadScript(scriptUrl).catch((err) => {
          pendingScripts.delete(entry.id);
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

  async function loadMany(entries, onProgress) {
    const todo = entries.filter((e) => !state.docs.has(e.id));
    let done = entries.length - todo.length;
    const failed = [];
    onProgress(done, entries.length);
    let i = 0;
    const worker = async () => {
      while (i < todo.length) {
        const e = todo[i++];
        try { await loadDoc(e); } catch (err) { failed.push(e); console.error(e.path, err); }
        done++;
        onProgress(done, entries.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, todo.length) }, worker));
    return failed;
  }

  /** Dữ liệu đã chuẩn hoá của 1 file (tính 1 lần, dùng lại) */
  function prepared(doc, accent) {
    const key = accent ? 'a' : 'n';
    if (doc.prep[key]) return doc.prep[key];
    const stt = doc.colIndex.STT;
    const cells = doc.rows.map((r) => r.map((v) => (v ? norm(v, accent) : '')));
    const all = cells.map((r) => r.filter((v, i) => v && i !== stt).join(' \u0001 '));
    doc.prep[key] = { cells, all };
    return doc.prep[key];
  }

  /* ------------------------------------------------------------- searching */
  function readQuery(params) {
    const qs = params.getAll('q');
    const cs = params.getAll('c');
    const conds = qs.map((q, i) => ({ c: cs[i] || ANY_COL, q }));
    return {
      conds,
      exact: params.get('exact') === '1',
      word: params.get('word') === '1',
      accent: params.get('accent') === '1',
    };
  }

  function compile(query) {
    return query.conds
      .filter((c) => c.q.trim())
      .map((c) => {
        const phrase = norm(c.q, query.accent);
        return { col: c.c, phrase, tokens: phrase.split(' ').filter(Boolean) };
      });
  }

  const WORD_CH = /[\p{L}\p{N}]/u;
  const isWordCh = (ch) => !!ch && WORD_CH.test(ch);
  const wordAt = (hay, i, len) => !isWordCh(hay[i - 1]) && !isWordCh(hay[i + len]);
  /** t xuất hiện trong hay như một từ trọn vẹn */
  function wordHit(hay, t) {
    let p = hay.indexOf(t);
    while (p !== -1) {
      if (wordAt(hay, p, t.length)) return true;
      p = hay.indexOf(t, p + 1);
    }
    return false;
  }
  const subHit = (hay, t) => hay.includes(t);

  /** Mức độ phù hợp của 1 ô với 1 điều kiện (để xếp hạng kết quả) */
  function cellScore(hay, c) {
    if (!hay) return 0;
    if (hay === c.phrase) return 1000;
    let s = 0;
    const pi = hay.indexOf(c.phrase);
    if (pi !== -1) s += wordAt(hay, pi, c.phrase.length) ? 300 : 100;
    if (pi === 0) s += 20;
    for (const t of c.tokens) {
      if (wordHit(hay, t)) s += 10;
      else if (hay.includes(t)) s += 3;
    }
    return s;
  }

  /** Trả về điểm phù hợp (>0) nếu dòng thỏa mọi điều kiện, ngược lại 0 */
  function matchRow(doc, i, prep, cq, query) {
    const { exact } = query;
    const hit = query.word ? wordHit : subHit;
    let score = 1;
    for (const c of cq) {
      if (c.col === FILE_COL) {
        const hay = doc.fileNorm[query.accent];
        if (!(exact ? hay === c.phrase : c.tokens.every((t) => hit(hay, t)))) return 0;
      } else if (c.col === ANY_COL) {
        const cells = prep.cells[i];
        if (exact) {
          if (!cells.includes(c.phrase)) return 0;
          score += 1000;
        } else {
          if (!c.tokens.every((t) => hit(prep.all[i], t))) return 0;
          let best = 0;
          for (const v of cells) { if (v) best = Math.max(best, cellScore(v, c)); }
          score += best;
        }
      } else {
        const idx = doc.colIndex[c.col];
        if (idx === undefined) return 0;
        const hay = prep.cells[i][idx] || '';
        if (!(exact ? hay === c.phrase : c.tokens.every((t) => hit(hay, t)))) return 0;
        score += cellScore(hay, c);
      }
    }
    return score;
  }

  function searchDocs(docs, query) {
    const cq = compile(query);
    const out = [];
    for (const doc of docs) {
      if (!cq.length) {
        for (let i = 0; i < doc.rows.length; i++) out.push({ doc, i });
        continue;
      }
      const prep = prepared(doc, query.accent);
      for (let i = 0; i < doc.rows.length; i++) {
        const s = matchRow(doc, i, prep, cq, query);
        if (s) out.push({ doc, i, s });
      }
    }
    // Xếp hạng: khớp đúng cả ô > khớp cụm từ > khớp nguyên từ > khớp một phần
    if (cq.length) out.sort((a, b) => b.s - a.s);
    return out;
  }

  /** Từ khoá cần bôi vàng theo từng cột */
  function termsFor(query) {
    const cq = compile(query);
    const any = [];
    const byCol = {};
    for (const c of cq) {
      const terms = query.exact ? [c.phrase] : c.tokens;
      if (c.col === ANY_COL) any.push(...terms);
      else (byCol[c.col] = byCol[c.col] || []).push(...terms);
    }
    return (col) => any.concat(byCol[col] || []);
  }

  function cellValue(doc, i, col) {
    if (col === FILE_COL) return doc.name;
    if (col === GROUP_COL) return doc.group;
    const idx = doc.colIndex[col];
    return idx === undefined ? '' : (doc.rows[i][idx] || '');
  }

  function sortKey(v) {
    const s = String(v).trim();
    const d = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
    if (d) return { n: +(d[3] + d[2].padStart(2, '0') + d[1].padStart(2, '0')) };
    if (/^-?\d+(\.\d+)?$/.test(s)) return { n: parseFloat(s) };
    return { s };
  }

  function sortResults(results, col, dir) {
    if (!col) return results;
    const mul = dir === 'desc' ? -1 : 1;
    const collator = new Intl.Collator('vi', { sensitivity: 'base', numeric: true });
    const keyed = results.map((r) => ({ r, k: sortKey(cellValue(r.doc, r.i, col)) }));
    keyed.sort((a, b) => {
      const ea = a.k.s === '' ;
      const eb = b.k.s === '';
      if (ea !== eb) return ea ? 1 : -1; // ô trống luôn ở cuối
      if (a.k.n !== undefined && b.k.n !== undefined) return (a.k.n - b.k.n) * mul;
      return collator.compare(a.k.s ?? String(a.k.n), b.k.s ?? String(b.k.n)) * mul;
    });
    return keyed.map((x) => x.r);
  }

  /* ----------------------------------------------------------- components */
  function colOptions(columns, selected, withFile) {
    const opts = [`<option value="${ANY_COL}">Tất cả các cột</option>`];
    if (withFile) opts.push(`<option value="${FILE_COL}">Tên file Excel</option>`);
    opts.push('<optgroup label="Theo cột">');
    columns.forEach((c) => opts.push(`<option value="${esc(c)}">${esc(c)}</option>`));
    opts.push('</optgroup>');
    const html = opts.join('');
    return selected ? html.replace(`value="${esc(selected)}"`, `value="${esc(selected)}" selected`) : html;
  }

  function condHTML(columns, withFile, cond, first) {
    return `<div class="cond${first ? ' first' : ''}">
      <select title="Chọn cột cần tìm">${colOptions(columns, cond.c, withFile)}</select>
      <div class="q-wrap"><input type="search" value="${esc(cond.q)}"
        placeholder="${first ? 'Nhập họ tên, số hiệu bằng, số định danh, ngày sinh (dd/mm/yyyy)...' : 'Nhập giá trị cần tìm...'}"></div>
      ${first ? '' : '<button type="button" class="btn-close" data-act="remove" title="Bỏ điều kiện này"></button>'}
    </div>`;
  }

  function searchFormHTML(opts) {
    const { columns, withFile, query, groups, group } = opts;
    const conds = query.conds.length ? query.conds : [{ c: ANY_COL, q: '' }];
    const groupChips = groups ? `
      <div class="search-actions">
        <span class="check" style="cursor:default">Phạm vi năm:</span>
        <div class="chips" data-role="groups">
          <button type="button" class="chip${!group ? ' active' : ''}" data-group="">Tất cả</button>
          ${groups.map((g) => `<button type="button" class="chip${g.name === group ? ' active' : ''}" data-group="${esc(g.name)}">${esc(g.name)}<small>${fmtNum(g.count)}</small></button>`).join('')}
        </div>
      </div>` : '';
    return `<form class="search-form" autocomplete="off">
      <div class="conds">${conds.map((c, i) => condHTML(columns, withFile, c, i === 0)).join('')}</div>
      <div class="search-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-act="add">+ Thêm điều kiện</button>
        <label class="check" title="vd. tìm &quot;hoa&quot; sẽ không ra &quot;Hoàng&quot;, &quot;Thoa&quot;"><input type="checkbox" name="word"${query.word ? ' checked' : ''}> Khớp nguyên từ</label>
        <label class="check" title="Giá trị của ô phải giống hệt nội dung tìm"><input type="checkbox" name="exact"${query.exact ? ' checked' : ''}> Khớp chính xác cả ô</label>
        <label class="check"><input type="checkbox" name="accent"${query.accent ? ' checked' : ''}> Phân biệt dấu</label>
        <span class="spacer"></span>
        <button type="button" class="btn btn-sm" data-act="clear">Xóa tìm kiếm</button>
        <button type="submit" class="btn btn-primary">Tìm kiếm</button>
      </div>
      ${groupChips}
      <div class="hint">Mẹo: gõ không dấu vẫn tìm được (vd. <code>nguyen thi hoa</code>). Các từ được tìm độc lập, kết quả phải chứa đủ các từ.
        Có thể thêm nhiều điều kiện (vd. Họ tên + Năm sinh) - kết quả phải thỏa tất cả điều kiện.</div>
    </form>`;
  }

  /** Gắn sự kiện cho form tìm kiếm; onChange(query, immediate) */
  function bindSearchForm(form, columns, withFile, onChange) {
    const read = () => ({
      conds: [...form.querySelectorAll('.cond')].map((el) => ({
        c: el.querySelector('select').value,
        q: el.querySelector('input').value,
      })),
      exact: form.elements.exact.checked,
      word: form.elements.word.checked,
      accent: form.elements.accent.checked,
    });
    const live = debounce(() => onChange(read(), false), 280);
    form.addEventListener('input', (e) => { if (e.target.matches('input[type=search]')) live(); });
    form.addEventListener('change', (e) => { if (!e.target.matches('input[type=search]')) onChange(read(), true); });
    form.addEventListener('submit', (e) => { e.preventDefault(); onChange(read(), true); });
    form.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'add') {
        form.querySelector('.conds').insertAdjacentHTML('beforeend',
          condHTML(columns, withFile, { c: columns.includes(NAME_COL) ? NAME_COL : ANY_COL, q: '' }, false));
        form.querySelector('.cond:last-child input').focus();
      } else if (act === 'remove') {
        btn.closest('.cond').remove();
        onChange(read(), true);
      } else if (act === 'clear') {
        form.querySelectorAll('.cond:not(.first)').forEach((el) => el.remove());
        const first = form.querySelector('.cond.first');
        first.querySelector('input').value = '';
        first.querySelector('select').value = ANY_COL;
        onChange(read(), true);
        first.querySelector('input').focus();
      }
    });
  }

  function queryToParams(params, query) {
    params.delete('q');
    params.delete('c');
    query.conds.filter((c) => c.q.trim() || c.c !== ANY_COL).forEach((c) => {
      params.append('q', c.q);
      params.append('c', c.c);
    });
    query.exact ? params.set('exact', '1') : params.delete('exact');
    query.word ? params.set('word', '1') : params.delete('word');
    query.accent ? params.set('accent', '1') : params.delete('accent');
    params.delete('page');
  }

  /**
   * Vẽ bảng kết quả có sắp xếp + phân trang.
   * cols: [{key,label,cls,render?}]
   */
  function renderTable(container, opts) {
    const { results, cols, params, path, terms, accent, emptyHTML, showFile } = opts;
    const sortCol = params.get('sort') || '';
    const dir = params.get('dir') || 'asc';
    const sorted = sortResults(results, sortCol, dir);
    const total = sorted.length;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const page = Math.min(Math.max(1, +params.get('page') || 1), pages);
    const start = (page - 1) * PAGE_SIZE;
    const slice = sorted.slice(start, start + PAGE_SIZE);

    if (!total) {
      container.innerHTML = emptyHTML;
      return;
    }

    const head = cols.map((c) => {
      const sorted = c.key === sortCol;
      const arrow = sorted ? (dir === 'asc' ? ' [tang]' : ' [giam]') : '';
      return `<th class="${c.cls || ''}${sorted ? ' sorted' : ''}" data-sort="${esc(c.key)}" title="Bấm để sắp xếp">${esc(c.label)}<span class="sort">${arrow}</span></th>`;
    }).join('');

    const body = slice.map((r, k) => {
      const tds = cols.map((c) => {
        if (c.key === '__idx') return `<td class="idx">${start + k + 1}</td>`;
        const v = cellValue(r.doc, r.i, c.key);
        let cls = c.cls || '';
        if (NOWRAP_COLS.has(c.key)) cls += ' nowrap';
        if (c.key === NAME_COL) cls += ' name-cell';
        if (c.key === FILE_COL) cls += ' file-cell';
        return `<td class="${cls}">${highlight(v, terms(c.key), accent)}</td>`;
      }).join('');
      return `<tr data-pos="${start + k}">${tds}</tr>`;
    }).join('');

    container.innerHTML = `
      <div class="table-wrap"><table class="data"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>
      <div class="pager">
        <span class="info">Hiển thị ${fmtNum(start + 1)}-${fmtNum(start + slice.length)} / ${fmtNum(total)} bản ghi - Bấm vào một dòng để xem chi tiết</span>
        ${pagerHTML(page, pages)}
      </div>`;

    container.querySelector('thead').addEventListener('click', (e) => {
      const th = e.target.closest('th[data-sort]');
      if (!th || th.dataset.sort === '__idx') return;
      const key = th.dataset.sort;
      if (sortCol === key) {
        if (dir === 'asc') params.set('dir', 'desc');
        else { params.delete('sort'); params.delete('dir'); }
      } else {
        params.set('sort', key);
        params.set('dir', 'asc');
      }
      params.delete('page');
      replaceHash(path, params);
      renderTable(container, opts);
    });
    container.querySelector('tbody').addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-pos]');
      if (tr) openRecord(sorted, +tr.dataset.pos, terms, accent, showFile);
    });
    container.querySelector('.pager').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-page]');
      if (!b || b.disabled) return;
      params.set('page', b.dataset.page);
      replaceHash(path, params);
      renderTable(container, opts);
      container.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function pagerHTML(page, pages) {
    if (pages <= 1) return '';
    const nums = new Set([1, pages, page - 2, page - 1, page, page + 1, page + 2]);
    const list = [...nums].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
    let html = `<button data-page="${page - 1}" ${page === 1 ? 'disabled' : ''}>Trang trước</button>`;
    let prev = 0;
    for (const n of list) {
      if (n - prev > 1) html += '<button disabled>...</button>';
      html += `<button data-page="${n}" class="${n === page ? 'active' : ''}">${n}</button>`;
      prev = n;
    }
    html += `<button data-page="${page + 1}" ${page === pages ? 'disabled' : ''}>Trang sau</button>`;
    return `<div class="pages">${html}</div>`;
  }

  /* ---------------------------------------------------------------- modal */
  const modal = document.getElementById('modal');
  let modalCtx = null;

  function openRecord(list, pos, terms, accent, showFile) {
    modalCtx = { list, pos, terms, accent, showFile, showEmpty: false };
    drawRecord();
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function drawRecord() {
    const { list, pos, terms, accent, showEmpty } = modalCtx;
    const { doc, i } = list[pos];
    const row = doc.rows[i];
    const name = cellValue(doc, i, NAME_COL);
    document.getElementById('modal-title').textContent = name || `Bản ghi #${i + 1}`;
    const kv = doc.columns.map((c, idx) => {
      const v = row[idx] || '';
      if (!v && !showEmpty) return '';
      return `<div class="k">${esc(c)}</div><div class="v${v ? '' : ' empty-v'}">${v ? highlight(v, terms(c), accent) : '(trống)'}</div>`;
    }).join('');
    document.getElementById('modal-body').innerHTML = `
      <div class="kv">${kv}</div>
      <div class="source-box">Nguồn: <b>${esc(doc.fileName)}</b> - Năm/thư mục: <b>${esc(doc.group)}</b> - Dòng dữ liệu thứ ${i + 1}
        ${doc.title ? `<br><span style="color:var(--muted)">${esc(doc.title)}</span>` : ''}</div>`;
    document.getElementById('modal-foot').innerHTML = `
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button class="btn btn-sm" data-m="prev" ${pos === 0 ? 'disabled' : ''}>Trước</button>
        <span class="check" style="cursor:default">${fmtNum(pos + 1)} / ${fmtNum(list.length)}</span>
        <button class="btn btn-sm" data-m="next" ${pos === list.length - 1 ? 'disabled' : ''}>Sau</button>
        <label class="check"><input type="checkbox" data-m="empty" ${showEmpty ? 'checked' : ''}> Hiện cả trường trống</label>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-sm" data-m="copy">Sao chép</button>
        ${modalCtx.showFile ? `<a class="btn btn-sm btn-primary" href="#/file/${encodeURIComponent(doc.id)}">Mở file này</a>` : ''}
      </div>`;
  }

  function closeModal() {
    modal.hidden = true;
    document.body.style.overflow = '';
    modalCtx = null;
  }

  modal.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) return closeModal();
    if (e.target.closest('a[href^="#/file/"]')) return closeModal();
    const m = e.target.closest('[data-m]');
    if (!m || !modalCtx) return;
    const act = m.dataset.m;
    if (act === 'prev' && modalCtx.pos > 0) { modalCtx.pos--; drawRecord(); }
    if (act === 'next' && modalCtx.pos < modalCtx.list.length - 1) { modalCtx.pos++; drawRecord(); }
    if (act === 'empty') { modalCtx.showEmpty = m.checked; drawRecord(); }
    if (act === 'copy') {
      const { doc, i } = modalCtx.list[modalCtx.pos];
      const text = doc.columns.map((c, idx) => (doc.rows[i][idx] ? `${c}: ${doc.rows[i][idx]}` : ''))
        .filter(Boolean).concat(`Nguồn: ${doc.fileName}`).join('\n');
      copyText(text);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (modal.hidden || !modalCtx) return;
    if (e.key === 'Escape') closeModal();
    if (e.key === 'ArrowLeft' && modalCtx.pos > 0) { modalCtx.pos--; drawRecord(); }
    if (e.key === 'ArrowRight' && modalCtx.pos < modalCtx.list.length - 1) { modalCtx.pos++; drawRecord(); }
  });

  /* ------------------------------------------------------------ home view */
  function groupStats() {
    const map = new Map();
    state.manifest.files.forEach((f) => map.set(f.group, (map.get(f.group) || 0) + f.count));
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'vi', { numeric: true }))
      .map(([name, count]) => ({ name, count }));
  }

  function renderHome(params) {
    const m = state.manifest;
    const query = readQuery(params);
    const group = params.get('g') || '';
    state.lastHomeHash = location.hash || '#/';
    document.title = 'Tra cứu dữ liệu văn bằng';

    app.innerHTML = `
      <section class="panel">
        <div class="panel-title">
          <h2>Tìm kiếm trong toàn bộ dữ liệu</h2>
          <span class="sub">${fmtNum(m.totalRecords)} bản ghi trong ${fmtNum(m.totalFiles)} file Excel</span>
        </div>
        ${searchFormHTML({ columns: m.columns, withFile: true, query, groups: groupStats(), group })}
      </section>
      <section class="panel" id="area"></section>`;

    const form = app.querySelector('.search-form');
    bindSearchForm(form, m.columns, true, (q) => {
      queryToParams(params, q);
      params.delete('sort');
      params.delete('dir');
      replaceHash('/', params);
      updateHome(params);
    });
    form.querySelector('[data-role=groups]').addEventListener('click', (e) => {
      const chip = e.target.closest('[data-group]');
      if (!chip) return;
      form.querySelectorAll('[data-group]').forEach((c) => c.classList.toggle('active', c === chip));
      chip.dataset.group ? params.set('g', chip.dataset.group) : params.delete('g');
      params.delete('page');
      replaceHash('/', params);
      updateHome(params);
    });

    updateHome(params);
    if (!query.conds.some((c) => c.q.trim())) form.querySelector('.cond.first input').focus();
  }

  function scopeFiles(params) {
    const g = params.get('g') || '';
    return state.manifest.files.filter((f) => !g || f.group === g);
  }

  async function updateHome(params) {
    const area = document.getElementById('area');
    if (!area) return;
    const query = readQuery(params);
    const seq = ++state.seq;
    if (!compile(query).length) {
      renderFileList(area, params);
      return;
    }

    const entries = scopeFiles(params);
    const needLoad = entries.some((e) => !state.docs.has(e.id));
    if (needLoad) {
      area.innerHTML = `<div class="loading-block"><span class="spinner"></span>
        Đang tải dữ liệu <b data-role="p">0</b> / ${fmtNum(entries.length)} file… (chỉ tải lần đầu)
        <div class="progress"><div></div></div></div>`;
    }
    const failed = await loadMany(entries, (done, total) => {
      if (!needLoad || seq !== state.seq) return;
      const p = area.querySelector('[data-role=p]');
      if (p) {
        p.textContent = fmtNum(done);
        area.querySelector('.progress > div').style.width = `${(done / total) * 100}%`;
      }
    });
    if (seq !== state.seq) return;

    const docs = entries.map((e) => state.docs.get(e.id)).filter(Boolean);
    const t0 = performance.now();
    const results = searchDocs(docs, query);
    const ms = Math.round(performance.now() - t0);

    const extraCols = query.conds.map((c) => c.c)
      .filter((c) => c !== ANY_COL && c !== FILE_COL && !MAIN_COLS.includes(c));
    const cols = [{ key: '__idx', label: '#', cls: 'idx' }]
      .concat([...new Set(MAIN_COLS.concat(extraCols))].map((c) => ({ key: c, label: c })))
      .concat([{ key: GROUP_COL, label: 'Năm' }, { key: FILE_COL, label: 'File Excel' }]);

    const fileCount = new Set(results.map((r) => r.doc.id)).size;
    area.innerHTML = `
      <div class="result-head">
        <div class="result-count">Tìm thấy ${fmtNum(results.length)} bản ghi
          <small>trong ${fmtNum(fileCount)} file - ${ms} ms${params.get('g') ? ` - năm ${esc(params.get('g'))}` : ''}</small></div>
        <a class="btn btn-sm" href="#/" data-role="back">Quay lại danh sách file</a>
      </div>
      ${failed.length ? `<div class="error-box" style="margin-bottom:10px">Không tải được ${failed.length} file: ${failed.slice(0, 5).map((f) => esc(f.name)).join(', ')}${failed.length > 5 ? '...' : ''}</div>` : ''}
      <div data-role="table"></div>`;
    area.querySelector('[data-role=back]').addEventListener('click', () => { state.lastHomeHash = '#/'; });

    renderTable(area.querySelector('[data-role=table]'), {
      results, cols, params, path: '/', terms: termsFor(query), accent: query.accent, showFile: true,
      emptyHTML: `<div class="empty">Không tìm thấy bản ghi nào phù hợp.<br>
        Thử bỏ bớt điều kiện, chọn "Tất cả các cột" hoặc kiểm tra lại chính tả.</div>`,
    });
  }

  function renderFileList(area, params) {
    const fq = params.get('fq') || '';
    const sort = params.get('fs') || 'group';
    area.innerHTML = `
      <div class="panel-title">
        <h2>Danh sách file dữ liệu</h2>
        <span class="sub" data-role="count"></span>
      </div>
      <div class="toolbar">
        <input class="input" type="search" placeholder="Lọc theo tên file (vd. KT4A, Đà Nẵng, 2640...)" value="${esc(fq)}" data-role="fq">
        <select class="select" data-role="fs" title="Sắp xếp">
          <option value="group">Sắp xếp: theo năm</option>
          <option value="name">Sắp xếp: theo tên file</option>
          <option value="count">Sắp xếp: nhiều bản ghi nhất</option>
        </select>
      </div>
      <div data-role="list"></div>`;
    const fqInput = area.querySelector('[data-role=fq]');
    const fsSelect = area.querySelector('[data-role=fs]');
    fsSelect.value = sort;

    const draw = () => {
      const tokens = fold(fqInput.value).split(/\s+/).filter(Boolean);
      const g = params.get('g') || '';
      let files = state.manifest.files.filter((f) => (!g || f.group === g) && tokens.every((t) => f._fold.includes(t)));
      const coll = new Intl.Collator('vi', { numeric: true });
      if (fsSelect.value === 'name') files = files.slice().sort((a, b) => coll.compare(a.name, b.name));
      else if (fsSelect.value === 'count') files = files.slice().sort((a, b) => b.count - a.count);
      else files = files.slice().sort((a, b) => coll.compare(a.group, b.group) || coll.compare(a.name, b.name));

      const total = files.reduce((s, f) => s + f.count, 0);
      area.querySelector('[data-role=count]').textContent = `${fmtNum(files.length)} file - ${fmtNum(total)} bản ghi`;
      const list = area.querySelector('[data-role=list]');
      if (!files.length) {
        list.innerHTML = '<div class="empty">Không có file nào khớp với bộ lọc.</div>';
        return;
      }
      const card = (f) => `
        <a class="file-card" href="#/file/${encodeURIComponent(f.id)}" title="${esc(f.source)}">
          <span class="file-icon">XLS</span>
          <span class="file-info">
            <span class="file-name">${highlight(f.name, tokens, false)}</span>
            <span class="file-meta"><span class="badge">${fmtNum(f.count)} bản ghi</span><span class="badge badge-gray">${esc(f.group)}</span></span>
          </span>
        </a>`;
      if (fsSelect.value === 'group') {
        const groups = new Map();
        files.forEach((f) => { if (!groups.has(f.group)) groups.set(f.group, []); groups.get(f.group).push(f); });
        list.innerHTML = [...groups.entries()].map(([gname, fs]) => `
          <div class="group-head"><h3>${esc(gname)}</h3><span>${fmtNum(fs.length)} file - ${fmtNum(fs.reduce((s, f) => s + f.count, 0))} bản ghi</span></div>
          <div class="file-grid">${fs.map(card).join('')}</div>`).join('');
      } else {
        list.innerHTML = `<div class="file-grid">${files.map(card).join('')}</div>`;
      }
    };

    const save = () => {
      fqInput.value.trim() ? params.set('fq', fqInput.value) : params.delete('fq');
      fsSelect.value !== 'group' ? params.set('fs', fsSelect.value) : params.delete('fs');
      replaceHash('/', params);
    };
    fqInput.addEventListener('input', debounce(() => { save(); draw(); }, 150));
    fsSelect.addEventListener('change', () => { save(); draw(); });
    draw();
  }

  /* ------------------------------------------------------------ file view */
  async function renderFile(id, params) {
    const entry = state.byId.get(id);
    if (!entry) {
      app.innerHTML = `<div class="panel empty">Không tìm thấy file dữ liệu này.<br><br>
        <a class="btn" href="#/">Về danh sách file</a></div>`;
      return;
    }
    document.title = `${entry.name} - Tra cứu dữ liệu văn bằng`;
    app.innerHTML = `<div class="loading-block"><span class="spinner"></span> Đang tải ${esc(entry.fileName)}...</div>`;
    let doc;
    try {
      doc = await loadDoc(entry);
    } catch (err) {
      app.innerHTML = `<div class="error-box"><h3>Không tải được file dữ liệu</h3>${esc(entry.path)} - ${esc(err.message)}</div>`;
      return;
    }
    if (parseHash().path !== `/file/${id}`) return; // người dùng đã chuyển trang

    const query = readQuery(params);
    const nonEmpty = doc.columns.filter((c, idx) => doc.rows.some((r) => r[idx]));
    const jsonUrl = DATA_DIR + entry.path;
    const path = `/file/${id}`;

    app.innerHTML = `
      <div class="breadcrumb">
        <a href="${esc(state.lastHomeHash)}">Danh sách file</a><span class="sep">/</span>
        <span>${esc(doc.group)}</span><span class="sep">/</span><span>${esc(doc.fileName)}</span>
      </div>
      <section class="panel">
        <div class="file-header">
          <div>
            <h1>${esc(doc.name)}</h1>
            <div class="meta">
              <span>Năm/thư mục: <b>${esc(doc.group)}</b></span>
              <span>Số bản ghi: <b>${fmtNum(doc.rows.length)}</b></span>
              <span>Sheet: <b>${esc(doc.sheet)}</b></span>
              ${doc.title ? `<span>${esc(doc.title)}</span>` : ''}
            </div>
          </div>
          <div class="actions">
            <a class="btn btn-sm" href="${esc(jsonUrl)}" download="${esc(doc.name)}.json">Tải file JSON</a>
          </div>
        </div>
      </section>
      <section class="panel">
        <div class="panel-title"><h2>Tìm trong file này</h2><span class="sub">Có thể tìm theo bất kỳ cột nào của file Excel</span></div>
        ${searchFormHTML({ columns: nonEmpty, withFile: false, query })}
      </section>
      <section class="panel" id="area"></section>`;

    const area = document.getElementById('area');
    const draw = () => {
      const q = readQuery(params);
      const results = searchDocs([doc], q);
      const has = compile(q).length > 0;
      const cols = nonEmpty.map((c) => ({ key: c, label: c, cls: c === 'STT' ? 'idx' : '' }));
      area.innerHTML = `
        <div class="result-head">
          <div class="result-count">${has ? `Tìm thấy ${fmtNum(results.length)} / ${fmtNum(doc.rows.length)} bản ghi` : `Toàn bộ ${fmtNum(doc.rows.length)} bản ghi`}
            <small>- ${nonEmpty.length} cột có dữ liệu</small></div>
        </div>
        <div data-role="table"></div>`;
      renderTable(area.querySelector('[data-role=table]'), {
        results, cols, params, path, terms: termsFor(q), accent: q.accent, showFile: false,
        emptyHTML: '<div class="empty">Không có bản ghi nào phù hợp trong file này.</div>',
      });
    };

    bindSearchForm(app.querySelector('.search-form'), nonEmpty, false, (q) => {
      queryToParams(params, q);
      replaceHash(path, params);
      draw();
    });
    draw();
  }

  /* ----------------------------------------------------------------- boot */
  function route() {
    if (!modal.hidden) closeModal();
    const { path, params } = parseHash();
    window.scrollTo(0, 0);
    const fm = path.match(/^\/file\/(.+)$/);
    if (fm) renderFile(decodeURIComponent(fm[1]), params);
    else renderHome(params);
  }

  function renderStats() {
    const m = state.manifest;
    document.getElementById('stats').innerHTML = `
      <div class="stat"><b>${fmtNum(m.totalFiles)}</b><span>file Excel</span></div>
      <div class="stat"><b>${fmtNum(m.totalRecords)}</b><span>bản ghi</span></div>
      <div class="stat"><b>${esc(m.generatedAt || '')}</b><span>cập nhật dữ liệu</span></div>`;
    document.getElementById('footer').textContent =
      `Dữ liệu được tạo lúc ${m.generatedAt || '?'} từ ${fmtNum(m.totalFiles)} file Excel.`;
  }

  async function boot() {
    try {
      await loadManifest();
    } catch (err) {
      const isFile = location.protocol === 'file:';
      app.innerHTML = `<div class="error-box">
        <h3>Không đọc được dữ liệu (data/index.json)</h3>
        ${isFile
          ? `<p>Bạn đang mở trang bằng file <code>index.html</code> trực tiếp. Hãy đảm bảo đã chạy <code>build.bat</code> để tạo dữ liệu.</p>`
          : `<p>Chưa có dữ liệu hoặc đường dẫn sai. Hãy chạy <code>build.bat</code> để tạo dữ liệu JSON từ file Excel.</p>`}
        <p style="opacity:.7">Chi tiết: ${esc(err.message)}</p></div>`;
      return;
    }
    renderStats();
    window.addEventListener('hashchange', route);
    route();
  }

  boot();
})();
