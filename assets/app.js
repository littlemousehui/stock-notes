// 觀察筆記：共用程式（資料載入、計算、圖表、頁面繪製）。
// 每日更新只需要改 data/ 裡的檔案，不需要改這個檔案。
(function () {
  'use strict';

  var ETF = window.ETF = { stocks: [], prices: {}, reviews: {}, m: null, errors: [] };

  /* ================= 資料登錄（data/*.js 會呼叫） ================= */
  ETF.manifest = function (m) { ETF.m = m; };
  ETF.addStocks = function (a) { ETF.stocks = a; };
  ETF.addPrices = function (code, p) {
    p.rows = p.rows.map(function (r) {
      return { date: r[0], open: r[1], high: r[2], low: r[3], close: r[4], change: r[5], volume: r[6] };
    });
    ETF.prices[code] = p;
  };
  ETF.addReview = function (r) { ETF.reviews[r.id] = r; };

  function loadScript(src) {
    return new Promise(function (resolve) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = function () { ETF.errors.push(src); resolve(); };
      document.head.appendChild(s);
    });
  }

  ETF.ready = function (cb) {
    if (!ETF.m) { document.body.insertAdjacentHTML('beforeend', '<p class="error">找不到 data/manifest.js</p>'); return; }
    var files = ['data/stocks.js']
      .concat(ETF.m.stocks.map(function (c) { return 'data/prices/' + c + '.js'; }))
      .concat(ETF.m.reviews.map(function (id) { return 'data/reviews/' + id + '.js'; }));
    Promise.all(files.map(loadScript)).then(function () {
      chrome();
      cb();
      if (ETF.errors.length) {
        document.querySelector('main').insertAdjacentHTML('afterbegin',
          '<p class="error">以下資料檔載入失敗：' + ETF.errors.map(esc).join('、') + '</p>');
      }
    });
  };

  /* ================= 小工具 ================= */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function num(n, d) {
    return Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function price(n) { return num(n, 2); }
  function lots(shares) { return num(Math.round(shares / 1000), 0); }      // 張
  function signed(n, d) { return (n > 0 ? '+' : '') + num(n, d); }
  function dir(n) { return n > 0 ? 'up' : n < 0 ? 'down' : 'flat'; }
  function arrow(n) { return n > 0 ? '▲' : n < 0 ? '▼' : '－'; }
  function md(date) { return date.slice(5).replace('-', '/'); }
  function param(k) { return new URLSearchParams(location.search).get(k); }

  function stock(code) {
    return ETF.stocks.filter(function (s) { return s.code === code; })[0];
  }
  function rows(code) { return (ETF.prices[code] || { rows: [] }).rows; }
  function indexOf(code, date) {
    var r = rows(code);
    for (var i = 0; i < r.length; i++) if (r[i].date === date) return i;
    return -1;
  }
  function prevClose(r) { return r.close - r.change; }
  function pct(r) { var p = prevClose(r); return p ? r.change / p * 100 : 0; }
  // 前 n 個交易日的平均成交量；不足 3 天回傳 null
  function avgVol(code, i, n) {
    var r = rows(code), a = r.slice(Math.max(0, i - n), i);
    if (a.length < 3) return null;
    return a.reduce(function (s, x) { return s + x.volume; }, 0) / a.length;
  }
  function latestDate() {
    var d = '';
    ETF.m.stocks.forEach(function (c) { var r = rows(c); if (r.length && r[r.length - 1].date > d) d = r[r.length - 1].date; });
    return d;
  }

  /* ================= 觀察條件（由程式判斷，不由 AI 判斷） ================= */
  // 回傳 { hit: true|false|null, detail }；null 表示資料不足
  function check(code, cond, i) {
    var r = rows(code)[i];
    if (!r) return { hit: null, detail: '當日沒有行情' };
    switch (cond.type) {
      case 'close_below':
        return { hit: r.close < cond.value, detail: '收盤 ' + price(r.close) };
      case 'close_above':
        return { hit: r.close >= cond.value, detail: '收盤 ' + price(r.close) };
      case 'change_pct_below':
        return { hit: pct(r) <= cond.value, detail: '漲跌幅 ' + signed(pct(r), 2) + '%' };
      case 'change_pct_above':
        return { hit: pct(r) >= cond.value, detail: '漲跌幅 ' + signed(pct(r), 2) + '%' };
      case 'volume_ratio_above':
        var a = avgVol(code, i, 5);
        if (a == null) return { hit: null, detail: '前面不足 3 個交易日，無法計算均量' };
        return { hit: r.volume / a >= cond.value, detail: '為前五日均量的 ' + num(r.volume / a, 2) + ' 倍' };
      default:
        return { hit: null, detail: '未知的條件類型：' + cond.type };
    }
  }
  function hitBadge(h) {
    return h === true ? '<span class="chip hit">已觸發</span>'
      : h === false ? '<span class="chip miss">未觸發</span>'
      : '<span class="chip na">資料不足</span>';
  }

  /* ================= 回顧排序 ================= */
  function reviewKey(r) { return (r.type === 'weekly' ? r.to + '~' : r.date); }
  function reviewsSorted() {
    return ETF.m.reviews.map(function (id) { return ETF.reviews[id]; }).filter(Boolean)
      .sort(function (a, b) { return reviewKey(a) < reviewKey(b) ? -1 : 1; });
  }
  function reviewTitle(r) {
    return r.type === 'weekly'
      ? r.id.replace(/^(\d+)-w(\d+)$/, '$1 年第 $2 週') + ' 每週回顧'
      : r.date + ' 今日回顧';
  }
  function typeChip(r) {
    return r.type === 'weekly' ? '<span class="chip weekly">每週</span>' : '<span class="chip daily">今日</span>';
  }
  function verdictChip(v) {
    var c = v === '相符' ? 'ok' : v === '不相符' ? 'no' : 'na';
    return '<span class="chip v-' + c + '">' + esc(v) + '</span>';
  }

  /* ================= 圖表（SVG，自己畫，不用外部函式庫） ================= */
  function sparkline(r) {
    if (r.length < 2) return '';
    var w = 140, h = 40, p = 3;
    var cs = r.map(function (x) { return x.close; });
    var lo = Math.min.apply(null, cs), hi = Math.max.apply(null, cs), span = (hi - lo) || 1;
    var pts = cs.map(function (c, i) {
      return (p + i * (w - 2 * p) / (cs.length - 1)).toFixed(1) + ',' + (h - p - (c - lo) / span * (h - 2 * p)).toFixed(1);
    }).join(' ');
    // 迷你走勢一律用琥珀色：它畫的是整段期間，和卡片上「今日漲跌」的紅綠不是同一件事
    return '<svg class="spark" viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true"><polyline points="' + pts + '"/></svg>';
  }

  function chart(el, r) {
    var mode = 'line';
    function draw() {
      if (!r.length) { el.innerHTML = '<p class="muted">尚無行情資料。</p>'; return; }
      var W = 760, PH = 230, VH = 70, GAP = 26, L = 76, R = 12, T = 12;
      var H = T + PH + GAP + VH + 24;
      var n = r.length, band = (W - L - R) / n;
      var lo = Math.min.apply(null, r.map(function (x) { return x.low; }));
      var hi = Math.max.apply(null, r.map(function (x) { return x.high; }));
      var pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;
      var y = function (v) { return T + (hi - v) / (hi - lo) * PH; };
      var x = function (i) { return L + band * i + band / 2; };
      var vmax = Math.max.apply(null, r.map(function (z) { return z.volume; }));
      var vy0 = T + PH + GAP + VH;
      var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="走勢圖">';

      for (var k = 0; k <= 4; k++) {            // 價格格線
        var v = lo + (hi - lo) * k / 4, yy = y(v);
        s += '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + yy + '" y2="' + yy + '"/>' +
          '<text class="axis" x="' + (L - 8) + '" y="' + (yy + 4) + '" text-anchor="end">' + price(v) + '</text>';
      }
      s += '<text class="axis" x="' + (L - 8) + '" y="' + (vy0 - VH + 4) + '" text-anchor="end">量</text>';

      if (mode === 'line') {
        s += '<polyline class="line" points="' + r.map(function (z, i) { return x(i) + ',' + y(z.close).toFixed(1); }).join(' ') + '"/>';
        r.forEach(function (z, i) { s += '<circle class="dot ' + dir(z.change) + '" cx="' + x(i) + '" cy="' + y(z.close).toFixed(1) + '" r="3.5"/>'; });
      } else {
        var bw = Math.min(22, band * 0.6);
        r.forEach(function (z, i) {
          var d = z.close >= z.open ? 'up' : 'down';
          var top = y(Math.max(z.open, z.close)), bot = y(Math.min(z.open, z.close));
          s += '<line class="wick ' + d + '" x1="' + x(i) + '" x2="' + x(i) + '" y1="' + y(z.high) + '" y2="' + y(z.low) + '"/>' +
            '<rect class="body ' + d + '" x="' + (x(i) - bw / 2) + '" y="' + top + '" width="' + bw + '" height="' + Math.max(1.5, bot - top) + '"/>';
        });
      }

      var vw = Math.min(22, band * 0.6);
      var step = Math.ceil(n / 10);
      r.forEach(function (z, i) {
        var vh = z.volume / vmax * VH;
        s += '<rect class="vol ' + dir(z.change) + '" x="' + (x(i) - vw / 2) + '" y="' + (vy0 - vh) + '" width="' + vw + '" height="' + vh + '"/>';
        if (i % step === 0 || i === n - 1) s += '<text class="axis" x="' + x(i) + '" y="' + (vy0 + 16) + '" text-anchor="middle">' + md(z.date) + '</text>';
        s += '<rect class="hit" data-i="' + i + '" x="' + (L + band * i) + '" y="' + T + '" width="' + band + '" height="' + (PH + GAP + VH) + '"/>';
      });
      s += '</svg>';

      el.innerHTML =
        '<div class="chart-bar">' +
        '<div class="seg" role="group" aria-label="圖表類型">' +
        '<button type="button" data-mode="line"' + (mode === 'line' ? ' class="on"' : '') + '>折線</button>' +
        '<button type="button" data-mode="candle"' + (mode === 'candle' ? ' class="on"' : '') + '>K 線</button>' +
        '</div><div class="readout" aria-live="polite"></div></div>' + s;

      var out = el.querySelector('.readout');
      var show = function (i) {
        var z = r[i];
        out.innerHTML = '<b>' + z.date + '</b> 開 ' + price(z.open) + '　高 ' + price(z.high) + '　低 ' + price(z.low) +
          '　收 <span class="' + dir(z.change) + '">' + price(z.close) + '（' + signed(pct(z), 2) + '%）</span>　量 ' + lots(z.volume) + ' 張';
      };
      show(n - 1);
      el.querySelectorAll('.hit').forEach(function (h) {
        h.addEventListener('mouseenter', function () { show(+h.dataset.i); });
        h.addEventListener('click', function () { show(+h.dataset.i); });
      });
      el.querySelectorAll('.seg button').forEach(function (b) {
        b.addEventListener('click', function () { mode = b.dataset.mode; draw(); });
      });
    }
    draw();
  }

  /* ================= 共用頁首頁尾 ================= */
  function chrome() {
    var m = ETF.m, d = latestDate();
    var banner = m.demo ? '<div class="banner">作業示範版：行情為證交所實際資料，「見解」為範例文字，不是任何人的真實投資紀錄。</div>' : '';
    document.body.insertAdjacentHTML('afterbegin',
      banner +
      '<header class="top"><div class="wrap">' +
      '<a class="brand" href="index.html"><span class="mark">▚</span> 觀察筆記</a>' +
      '<span class="fresh">資料更新至 <b>' + esc(d) + '</b></span>' +
      '</div></header>');
    document.body.insertAdjacentHTML('beforeend',
      '<footer class="foot"><div class="wrap">' +
      '<p>行情來源：臺灣證券交易所公開資料。本站為個人學習與紀錄用途，所有內容都不是投資建議，也不構成任何買賣推薦。</p>' +
      '</div></footer>');
  }

  /* ================= 首頁 ================= */
  function pageHome(main) {
    var cards = ETF.m.stocks.map(function (code) {
      var s = stock(code) || { code: code, name: code, kind: '' }, r = rows(code), last = r[r.length - 1];
      if (!last) return '<a class="card" href="stock.html?code=' + code + '"><h3>' + esc(code) + '</h3><p class="muted">尚無行情</p></a>';
      var hits = (s.conditions || []).filter(function (c) { return check(code, c, r.length - 1).hit === true; }).length;
      return '<a class="card" href="stock.html?code=' + esc(code) + '">' +
        '<div class="card-top"><span class="code">' + esc(code) + '</span><span class="name">' + esc(s.name) + '</span></div>' +
        '<div class="kind">' + esc(s.kind) + '</div>' +
        '<div class="px ' + dir(last.change) + '">' + price(last.close) + '</div>' +
        '<div class="chg ' + dir(last.change) + '">' + arrow(last.change) + ' ' + signed(last.change, 2) + '（' + signed(pct(last), 2) + '%）</div>' +
        sparkline(r) +
        '<div class="card-foot"><span>量 ' + lots(last.volume) + ' 張</span>' +
        (hits ? '<span class="chip hit">' + hits + ' 項條件觸發</span>' : '<span class="muted">條件未觸發</span>') + '</div>' +
        '</a>';
    }).join('');

    var list = reviewsSorted().reverse().map(function (r) {
      return '<li><a href="review.html?id=' + esc(r.id) + '">' + typeChip(r) +
        '<span class="rv-title">' + esc(reviewTitle(r)) + '</span>' +
        '<span class="rv-sum">' + esc(r.summary) + '</span></a></li>';
    }).join('');

    main.innerHTML =
      '<section><h2>關注清單</h2><div class="cards">' + cards + '</div></section>' +
      composerHtml() +
      '<section><h2>最近回顧</h2><ul class="rv-list">' + (list || '<li class="muted">還沒有回顧。</li>') + '</ul></section>';
    composerBind(main);
  }

  /* ---------- 首頁：更新入口（產生要貼給 AI 的訊息） ---------- */
  // 靜態網頁無法自己存檔，所以這裡只負責把使用者填的內容整理成一段訊息，由 AI 依 CLAUDE.md 寫入。
  function composerHtml() {
    var fields = ETF.m.stocks.map(function (code) {
      var s = stock(code) || { name: '' };
      return '<label class="field"><span><b class="code">' + esc(code) + '</b> ' + esc(s.name) + '</span>' +
        '<textarea rows="2" data-note="' + esc(code) + '" placeholder="今天對這檔的看法（沒有就留空）"></textarea></label>';
    }).join('');
    return '<section><h2>我要更新 <small>在這裡填好，複製後貼給 AI</small></h2>' +
      '<p class="muted small">這個網站只負責顯示。行情由 AI 去證交所讀取，見解與新標的也由 AI 寫入檔案，所以更新的方式是：在下面填好 → 按「產生訊息」→ 貼到 AI 對話裡。</p>' +
      '<div class="composer">' +
      '<details open><summary>✎ 寫今天的見解</summary><div class="form" data-form="note">' + fields +
      '<label class="field"><span>下週想觀察的事（每週最後一個交易日再填，可留空）</span><textarea rows="2" data-next placeholder="例如：成交量是否回到平常水準"></textarea></label>' +
      '<button type="button" class="btn" data-make="note">產生訊息</button></div></details>' +
      '<details><summary>＋ 新增關注標的</summary><div class="form" data-form="stock">' +
      '<label class="field"><span>股票代號（上市股票或 ETF）</span><input type="text" data-new="code" inputmode="numeric" placeholder="例如 2454"></label>' +
      '<label class="field"><span>為什麼想關注它</span><textarea rows="2" data-new="why" placeholder="用自己的話寫"></textarea></label>' +
      '<label class="field"><span>想設的觀察條件（可留空，之後再設）</span><textarea rows="2" data-new="cond" placeholder="例如：收盤跌破 50 元；成交量達前五日均量 2 倍"></textarea></label>' +
      '<button type="button" class="btn" data-make="stock">產生訊息</button></div></details>' +
      '<div class="out is-hidden"><label class="field"><span>把下面這段貼給 AI</span><textarea rows="7" readonly data-out></textarea></label>' +
      '<button type="button" class="btn" data-copy>複製</button> <span class="muted small" data-status aria-live="polite"></span></div>' +
      '</div></section>';
  }
  function composerBind(main) {
    var box = main.querySelector('.composer');
    if (!box) return;
    var out = box.querySelector('[data-out]'), wrap = box.querySelector('.out'), status = box.querySelector('[data-status]');
    function show(text) { out.value = text; wrap.classList.remove('is-hidden'); status.textContent = ''; out.focus(); out.select(); }
    box.querySelector('[data-make="note"]').addEventListener('click', function () {
      var lines = [];
      box.querySelectorAll('[data-note]').forEach(function (t) {
        var v = t.value.trim();
        if (v) lines.push('- ' + t.getAttribute('data-note') + '：' + v);
      });
      var next = box.querySelector('[data-next]').value.trim();
      var msg = '更新今天。\n\n';
      msg += lines.length ? '我今天的見解：\n' + lines.join('\n') + '\n（沒列出的標的今天沒有要記的。）' : '今天沒有要記的見解，只更新行情。';
      if (next) msg += '\n\n下週想觀察：\n- ' + next;
      show(msg);
    });
    box.querySelector('[data-make="stock"]').addEventListener('click', function () {
      var code = box.querySelector('[data-new="code"]').value.trim();
      if (!code) { wrap.classList.remove('is-hidden'); out.value = ''; status.textContent = '請先填股票代號。'; return; }
      var why = box.querySelector('[data-new="why"]').value.trim();
      var cond = box.querySelector('[data-new="cond"]').value.trim();
      show('請加一檔關注標的。\n\n- 代號：' + code +
        '\n- 關注原因：' + (why || '（還沒想好，請問我）') +
        '\n- 觀察條件：' + (cond || '先不設'));
    });
    box.querySelector('[data-copy]').addEventListener('click', function () {
      if (!out.value) return;
      var done = function () { status.textContent = '已複製，請貼到 AI 對話裡。'; };
      var manual = function () { out.focus(); out.select(); status.textContent = '請按 Ctrl+C 複製。'; };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(out.value).then(done, manual);
      else manual();
    });
  }

  /* ================= 標的頁 ================= */
  function pageStock(main) {
    var code = param('code'), s = stock(code), r = rows(code);
    if (!s) { main.innerHTML = '<p class="error">找不到標的：' + esc(code) + '</p>'; return; }
    document.title = s.code + ' ' + s.name + '｜觀察筆記';
    var last = r[r.length - 1];

    var head = '<section class="hero"><div><div class="code big">' + esc(s.code) + '</div>' +
      '<h1>' + esc(s.name) + '</h1><div class="kind">' + esc(s.kind) + '　<span class="chip daily">' + esc(s.status) + '</span></div>' +
      '<p class="why">' + esc(s.why) + '</p></div>' +
      (last ? '<div class="quote"><div class="px ' + dir(last.change) + '">' + price(last.close) + '</div>' +
        '<div class="chg ' + dir(last.change) + '">' + arrow(last.change) + ' ' + signed(last.change, 2) + '（' + signed(pct(last), 2) + '%）</div>' +
        '<div class="muted">' + last.date + ' 收盤</div></div>' : '') + '</section>';

    var stats = '';
    if (last) {
      var hi = r.reduce(function (a, b) { return b.high > a.high ? b : a; });
      var lo = r.reduce(function (a, b) { return b.low < a.low ? b : a; });
      var a5 = avgVol(code, r.length - 1, 5);
      var first = r[0], total = (last.close - prevClose(first)) / prevClose(first) * 100;
      stats = '<section><h2>區間統計 <small>' + first.date + ' 至 ' + last.date + '，共 ' + r.length + ' 個交易日</small></h2><div class="stats">' +
        '<div><span>區間漲跌幅</span><b class="' + dir(total) + '">' + signed(total, 2) + '%</b></div>' +
        '<div><span>區間最高</span><b>' + price(hi.high) + '</b><i>' + md(hi.date) + '</i></div>' +
        '<div><span>區間最低</span><b>' + price(lo.low) + '</b><i>' + md(lo.date) + '</i></div>' +
        '<div><span>前五日均量</span><b>' + (a5 == null ? '－' : lots(a5) + ' 張') + '</b></div>' +
        '<div><span>最新量／均量</span><b>' + (a5 == null ? '－' : num(last.volume / a5, 2) + ' 倍') + '</b></div>' +
        '</div></section>';
    }

    var conds = (s.conditions || []).map(function (c) {
      var days = [];
      r.forEach(function (z, i) { if (check(code, c, i).hit === true) days.push(z.date); });
      var now = last ? check(code, c, r.length - 1) : { hit: null, detail: '' };
      return '<tr><td>' + esc(c.label) + '</td><td>' + hitBadge(now.hit) + '</td><td class="muted">' + esc(now.detail) + '</td>' +
        '<td>' + (days.length ? days.map(md).join('、') : '<span class="muted">無</span>') + '</td></tr>';
    }).join('');

    var notes = [];
    reviewsSorted().reverse().forEach(function (rv) {
      (rv.notes || []).forEach(function (n) {
        if (n.code === code) notes.push('<li><a href="review.html?id=' + esc(rv.id) + '">' + typeChip(rv) + ' ' + esc(reviewTitle(rv)) + '</a><p>' + esc(n.text) + '</p></li>');
      });
    });

    var table = r.slice().reverse().map(function (z) {
      return '<tr><td>' + z.date + '</td><td>' + price(z.open) + '</td><td>' + price(z.high) + '</td><td>' + price(z.low) + '</td>' +
        '<td class="' + dir(z.change) + '">' + price(z.close) + '</td><td class="' + dir(z.change) + '">' + signed(z.change, 2) + '</td>' +
        '<td class="' + dir(z.change) + '">' + signed(pct(z), 2) + '%</td><td>' + lots(z.volume) + '</td></tr>';
    }).join('');

    var p = ETF.prices[code] || {};
    main.innerHTML = head +
      '<section><h2>走勢圖</h2><div class="panel" id="chart"></div></section>' + stats +
      '<section><h2>觀察條件 <small>由程式依行情自動判斷</small></h2><div class="panel scroll"><table><thead><tr><th>條件</th><th>最新狀態</th><th>依據</th><th>曾觸發的日期</th></tr></thead><tbody>' +
      (conds || '<tr><td colspan="4" class="muted">尚未設定條件。</td></tr>') + '</tbody></table></div></section>' +
      '<section><h2>我的見解紀錄</h2><ul class="timeline">' + (notes.join('') || '<li class="muted">還沒有見解。</li>') + '</ul></section>' +
      '<section><h2>每日行情</h2><div class="panel scroll"><table class="numeric"><thead><tr><th>日期</th><th>開盤</th><th>最高</th><th>最低</th><th>收盤</th><th>漲跌</th><th>漲跌幅</th><th>成交量（張）</th></tr></thead><tbody>' + table + '</tbody></table></div>' +
      '<p class="muted small">來源：' + esc(p.source || '') + '（讀取日 ' + esc(p.fetched || '') + '）</p></section>';
    chart(document.getElementById('chart'), r);
  }

  /* ================= 回顧頁 ================= */
  function pageReview(main) {
    var id = param('id'), rv = ETF.reviews[id];
    if (!rv) { main.innerHTML = '<p class="error">找不到回顧：' + esc(id) + '</p>'; return; }
    document.title = reviewTitle(rv) + '｜觀察筆記';
    var weekly = rv.type === 'weekly';
    var all = reviewsSorted(), at = all.indexOf(rv), prev = all[at - 1], next = all[at + 1];
    var link = function (code) { var s = stock(code); return '<a class="code" href="stock.html?code=' + esc(code) + '">' + esc(code) + '</a> ' + esc(s ? s.name : ''); };

    // 行情表：數字全部由程式從 data/prices 算出
    var body = ETF.m.stocks.map(function (code) {
      var r = rows(code);
      if (!weekly) {
        var i = indexOf(code, rv.date), z = r[i];
        if (!z) return '<tr><td>' + link(code) + '</td><td colspan="7" class="muted">當日沒有行情</td></tr>';
        var a = avgVol(code, i, 5);
        return '<tr><td>' + link(code) + '</td><td>' + price(z.open) + '</td><td>' + price(z.high) + '</td><td>' + price(z.low) + '</td>' +
          '<td class="' + dir(z.change) + '">' + price(z.close) + '</td><td class="' + dir(z.change) + '">' + signed(z.change, 2) + '</td>' +
          '<td class="' + dir(z.change) + '">' + signed(pct(z), 2) + '%</td><td>' + lots(z.volume) + '</td>' +
          '<td>' + (a == null ? '－' : num(z.volume / a, 2) + ' 倍') + '</td></tr>';
      }
      var w = r.filter(function (z) { return z.date >= rv.from && z.date <= rv.to; });
      if (!w.length) return '<tr><td>' + link(code) + '</td><td colspan="7" class="muted">本週沒有行情</td></tr>';
      var base = prevClose(w[0]), end = w[w.length - 1].close, ch = end - base, cp = ch / base * 100;
      var hi = Math.max.apply(null, w.map(function (z) { return z.high; }));
      var lo = Math.min.apply(null, w.map(function (z) { return z.low; }));
      var av = w.reduce(function (s, z) { return s + z.volume; }, 0) / w.length;
      var ups = w.filter(function (z) { return z.change > 0; }).length;
      return '<tr><td>' + link(code) + '</td><td>' + price(w[0].open) + '</td><td>' + price(hi) + '</td><td>' + price(lo) + '</td>' +
        '<td class="' + dir(ch) + '">' + price(end) + '</td><td class="' + dir(ch) + '">' + signed(ch, 2) + '</td>' +
        '<td class="' + dir(ch) + '">' + signed(cp, 2) + '%</td><td>' + lots(av) + '</td><td>' + ups + ' 漲 ' + (w.length - ups) + ' 跌平</td></tr>';
    }).join('');
    var thead = weekly
      ? '<th>標的</th><th>週開盤</th><th>週最高</th><th>週最低</th><th>週收盤</th><th>週漲跌</th><th>週漲跌幅</th><th>日均量（張）</th><th>漲跌天數</th>'
      : '<th>標的</th><th>開盤</th><th>最高</th><th>最低</th><th>收盤</th><th>漲跌</th><th>漲跌幅</th><th>成交量（張）</th><th>量／前五日均量</th>';

    var notes = (rv.notes || []).map(function (n) {
      return '<li><div class="who">' + link(n.code) + '</div><p>' + esc(n.text) + '</p></li>';
    }).join('');

    var cmp = (rv.compare || []).map(function (c) {
      var p = ETF.reviews[c.previous.id];
      return '<div class="cmp"><div class="who">' + link(c.code) + ' ' + verdictChip(c.verdict) + '</div>' +
        '<div class="cmp-grid"><div><span>先前的看法' + (p ? '（<a href="review.html?id=' + esc(p.id) + '">' + esc(p.type === 'weekly' ? reviewTitle(p) : md(p.date)) + '</a>）' : '') + '</span><p>' + esc(c.previous.text) + '</p></div>' +
        '<div><span>' + (weekly ? '本週' : '今日') + '實際情況</span><p>' + esc(c.today) + '</p></div></div></div>';
    }).join('') || '<p class="muted">' + esc(rv.compareNote || '沒有可對照的先前見解。') + '</p>';

    var conds = '';
    ETF.m.stocks.forEach(function (code) {
      var s = stock(code), r = rows(code);
      (s && s.conditions || []).forEach(function (c) {
        if (!weekly) {
          var k = check(code, c, indexOf(code, rv.date));
          conds += '<tr><td>' + link(code) + '</td><td>' + esc(c.label) + '</td><td>' + hitBadge(k.hit) + '</td><td class="muted">' + esc(k.detail) + '</td></tr>';
        } else {
          var days = [];
          r.forEach(function (z, i) { if (z.date >= rv.from && z.date <= rv.to && check(code, c, i).hit === true) days.push(z.date); });
          conds += '<tr><td>' + link(code) + '</td><td>' + esc(c.label) + '</td><td>' + hitBadge(days.length > 0) + '</td>' +
            '<td>' + (days.length ? days.map(md).join('、') : '<span class="muted">本週沒有觸發</span>') + '</td></tr>';
        }
      });
    });

    var todos = (rv.todos || []).map(function (t) {
      return '<li class="' + (t.done ? 'done' : '') + '"><span class="box">' + (t.done ? '✓' : '') + '</span><div>' + esc(t.text) +
        '<small>自 ' + md(t.since) + ' 起追蹤' + (t.doneNote ? '　' + esc(t.doneNote) : '') + '</small></div></li>';
    }).join('');

    var nextWeek = weekly && rv.nextWeek && rv.nextWeek.length
      ? '<section><h2>下週想觀察 <small>取自我自己的見解</small></h2><ul class="plain">' + rv.nextWeek.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul></section>' : '';

    main.innerHTML =
      '<section class="hero"><div>' + typeChip(rv) + '<h1>' + esc(reviewTitle(rv)) + '</h1>' +
      (weekly ? '<div class="muted">' + rv.from + ' 至 ' + rv.to + '</div>' : '') +
      '<p class="lead">' + esc(rv.summary) + '</p></div></section>' +
      '<section><h2>' + (weekly ? '本週行情' : '今日行情') + ' <small>數字由程式自行情資料計算</small></h2><div class="panel scroll"><table class="numeric"><thead><tr>' + thead + '</tr></thead><tbody>' + body + '</tbody></table></div></section>' +
      '<section><h2>' + (weekly ? '本週見解摘要' : '我的見解') + '</h2><ul class="notes">' + (notes || '<li class="muted">這次沒有留下見解。</li>') + '</ul></section>' +
      '<section><h2>與先前見解對照</h2>' + cmp + '</section>' +
      '<section><h2>觀察條件檢查 <small>由程式自動判斷</small></h2><div class="panel scroll"><table><thead><tr><th>標的</th><th>條件</th><th>結果</th><th>' + (weekly ? '觸發日期' : '依據') + '</th></tr></thead><tbody>' + conds + '</tbody></table></div></section>' +
      '<section><h2>待追蹤問題</h2><ul class="todos">' + (todos || '<li class="muted">目前沒有待追蹤的問題。</li>') + '</ul></section>' +
      nextWeek +
      '<nav class="pager">' +
      (prev ? '<a href="review.html?id=' + esc(prev.id) + '">← ' + esc(reviewTitle(prev)) + '</a>' : '<span></span>') +
      (next ? '<a href="review.html?id=' + esc(next.id) + '">' + esc(reviewTitle(next)) + ' →</a>' : '<span></span>') +
      '</nav>';
  }

  /* ================= 啟動 ================= */
  document.addEventListener('DOMContentLoaded', function () {
    var main = document.querySelector('main');
    var page = document.body.getAttribute('data-page');
    ETF.ready(function () {
      if (page === 'home') pageHome(main);
      else if (page === 'stock') pageStock(main);
      else if (page === 'review') pageReview(main);
    });
  });
})();
