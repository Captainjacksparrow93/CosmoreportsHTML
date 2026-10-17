/* Draws every value-driven part of the report from window.REPORT_DATA (assets/js/report-data.js):
 * bar charts, daily curves, 5D bars and their trend icons, sentiment circles, situation gauges,
 * percentages and their Positive / Negative labels.
 * Call CKReport.render(newData) to redraw with other values. */
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var templates = {};
  try { templates = JSON.parse(document.getElementById('dyn-templates').textContent || '{}'); } catch (e) { templates = {}; }

  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var num = function (v) { return typeof v === 'number' && isFinite(v); };

  // gauge zones, low to high: 0-15, 16-35, 36-45, 46-55, 56-65, 66-85, 86-100
  var ZONE_LO = [0, 16, 36, 46, 56, 66, 86];
  var ZONE_HI = [15, 35, 45, 55, 65, 85, 100];
  function zoneOf(v) { for (var i = 6; i >= 0; i--) if (v >= ZONE_LO[i]) return i; return 0; }

  // y position for a value on a chart axis (piecewise between the axis ticks)
  function yOf(ticks, v) {
    v = clamp(v, ticks[0][0], ticks[ticks.length - 1][0]);
    for (var i = 0; i < ticks.length - 1; i++) {
      var a = ticks[i], b = ticks[i + 1];
      if (v <= b[0]) return a[1] + ((v - a[0]) / (b[0] - a[0])) * (b[1] - a[1]);
    }
    return ticks[ticks.length - 1][1];
  }

  function el(tag, style, parent) {
    var e = document.createElement(tag);
    if (style) e.style.cssText = style;
    if (parent) parent.appendChild(e);
    return e;
  }
  function svg(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  // Replace the number inside a text element, keeping its styling (e.g. a smaller "%")
  function setNumber(root, v) {
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), t;
    while ((t = w.nextNode())) {
      if (/-?\d+/.test(t.nodeValue)) { t.nodeValue = t.nodeValue.replace(/-?\d+/, String(v)); return t; }
    }
    return null;
  }
  function setText(root, s) {
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), t, first = true;
    while ((t = w.nextNode())) {
      if (!t.nodeValue.trim()) continue;
      t.nodeValue = first ? s : '';
      first = false;
    }
  }
  function textWidth(node) {
    if (!node) return 0;
    var r = document.createRange();
    r.selectNodeContents(node);
    var z = parseFloat(getComputedStyle(node.parentElement.closest('.page')).zoom) || 1;
    return r.getBoundingClientRect().width / z;
  }
  // smooth curve through points (Catmull-Rom as cubic Béziers)
  function smoothPath(p) {
    if (!p.length) return '';
    var d = 'M' + p[0][0] + ' ' + p[0][1];
    for (var i = 0; i < p.length - 1; i++) {
      var p0 = p[i - 1] || p[i], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2] || p2;
      d += 'C' + (p1[0] + (p2[0] - p0[0]) / 6) + ' ' + (p1[1] + (p2[1] - p0[1]) / 6) + ' ' +
        (p2[0] - (p3[0] - p1[0]) / 6) + ' ' + (p2[1] - (p3[1] - p1[1]) / 6) + ' ' + p2[0] + ' ' + p2[1];
    }
    return d;
  }

  function drawBars(layer, c, values) {
    var y0 = yOf(c.ticks, 0);
    c.slots.forEach(function (s) {
      var v = values ? values[s.cat] : undefined;
      if (v === undefined) return;
      if (v === null || !num(v)) {
        if (!templates.na) return;
        var na = el('div', 'position:absolute;left:' + s.x + 'px;top:' + (y0 - templates.na.h) + 'px;width:' + templates.na.w + 'px;height:' + templates.na.h + 'px', layer);
        na.innerHTML = templates.na.html;
        return;
      }
      v = clamp(v, 0, 100);
      var top = yOf(c.ticks, v);
      el('div', 'position:absolute;left:' + s.x + 'px;top:' + top + 'px;width:' + s.w + 'px;height:' + Math.max(0, y0 - top) + 'px;' +
        (s.css || 'background:linear-gradient(#8fb4ff,#3c64d6);border-radius:8px;'), layer);
      if (c.label) {
        var lab = el('div', 'position:absolute;left:' + (s.x - 30) + 'px;top:' + (top - c.label.gap - c.label.h) + 'px;width:' + (s.w + 60) + 'px;height:' + c.label.h + 'px;' +
          c.label.css + 'line-height:' + c.label.h + 'px;text-align:center;white-space:nowrap', layer);
        lab.textContent = Math.round(v) + '%';
      }
    });
  }

  function drawArea(layer, c, values) {
    if (!values || !values.length) return;
    var s = svg('svg', { width: '100%', height: '100%', style: 'position:absolute;left:0;top:0;overflow:visible' }, layer);
    var y0 = yOf(c.ticks, 0);
    var pts = [];
    for (var i = 0; i < values.length && i < c.xs.length; i++) if (num(values[i])) pts.push([c.xs[i], +yOf(c.ticks, clamp(values[i], 0, 100)).toFixed(2)]);
    if (!pts.length) return;
    var line = smoothPath(pts);
    if (c.fill) svg('path', { d: line + 'L' + pts[pts.length - 1][0] + ' ' + y0 + 'L' + pts[0][0] + ' ' + y0 + 'Z', fill: c.fill.color, 'fill-opacity': c.fill.opacity }, s);
    var st = c.line || c.areaStroke;
    if (st) svg('path', { d: line, fill: 'none', stroke: st.color, 'stroke-width': st.width, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, s);
    pts.forEach(function (p) {
      svg('circle', { cx: p[0], cy: p[1], r: c.dot.r, fill: c.dot.color }, s);
      svg('circle', { cx: p[0], cy: p[1], r: c.dot.ir, fill: c.dot.icolor }, s);
    });
  }

  function drawLiquid(layer, c, v) {
    var d = c.circle.d, r = d / 2 - 1, cx = c.circle.x + d / 2, cy = c.circle.y + d / 2;
    var level = clamp(Math.abs(v), 0, 100) / 100;
    var color = (v < 0 ? (templates.liquid && templates.liquid.neg) || '#e8414a' : (templates.liquid && templates.liquid.pos) || '#5de68f');
    var s = svg('svg', { width: '100%', height: '100%', style: 'position:absolute;left:0;top:0;overflow:visible' }, layer);
    var id = 'lq' + Math.random().toString(36).slice(2, 8);
    svg('circle', { cx: cx, cy: cy, r: r }, svg('clipPath', { id: id }, svg('defs', {}, s)));
    var g = svg('g', { 'clip-path': 'url(#' + id + ')' }, s);
    if (level <= 0) return;
    var top = cy + r - level * 2 * r, amp = Math.min(d * 0.035, level * r), x0 = cx - r - 4, x1 = cx + r + 4, n = 4;
    var dd = 'M' + x0 + ' ' + top;
    for (var i = 0; i < n; i++) {
      var xa = x0 + ((x1 - x0) * i) / n, xb = x0 + ((x1 - x0) * (i + 1)) / n, sgn = i % 2 ? 1 : -1;
      dd += 'Q' + (xa + xb) / 2 + ' ' + (top + sgn * amp) + ' ' + xb + ' ' + top;
    }
    svg('path', { d: dd + 'L' + x1 + ' ' + (cy + r + 4) + 'L' + x0 + ' ' + (cy + r + 4) + 'Z', fill: color }, g);
  }

  function stateOf(kind, v, original) {
    if (kind === 'sentiment') return v >= 0 ? 'Positive' : 'Negative';
    if (original === 'Opportunity' || original === 'Threat') return v >= 56 ? 'Opportunity' : v >= 46 ? 'Moderate' : 'Threat';
    return v >= 56 ? 'Positive' : v >= 46 ? 'Moderate' : 'Negative';
  }

  function applyNumber(page, c, v) {
    var sel = function (a) { return page.querySelectorAll('[' + a + '="' + CSS.escape(c.key) + '"]'); };
    var nEl = sel('data-num')[0];
    if (!nEl) return;
    var rounded = Math.round(v);
    // number text, and the "%" / caret that follow it
    var before = textWidth(nEl.__numNode || setNumber(nEl, nEl.__last != null ? nEl.__last : c.v0));
    var node = setNumber(nEl, rounded);
    nEl.__numNode = node;
    nEl.__last = rounded;
    var align = node ? getComputedStyle(node.parentElement).textAlign : 'left';
    // let a wider number grow away from its anchor instead of overflowing to the right
    var line = node && node.parentElement.closest('div');
    if (line && (align === 'right' || align === 'end')) { line.style.left = 'auto'; line.style.right = '0'; line.style.width = 'max-content'; }
    else if (line && align === 'center') { line.style.left = '50%'; line.style.width = 'max-content'; line.style.translate = '-50% 0'; }
    var delta = (textWidth(node) - before) * (align === 'center' ? 0.5 : align === 'right' ? 0 : 1);
    var shift = function (e) {
      e.__dx = (e.__dx || 0) + delta;
      e.style.translate = e.__dx + 'px 0';
    };
    sel('data-num-pct').forEach(shift);
    sel('data-caret').forEach(shift);

    var kind = c.type;
    var state = stateOf(kind, rounded, c.labelText);
    sel('data-num-label').forEach(function (e) { setText(e, state); });
    var pillCss = templates.pills && (templates.pills[state] || (state === 'Opportunity' && templates.pills.Positive) || (state === 'Threat' && templates.pills.Negative));
    sel('data-num-pill').forEach(function (e) {
      var bg = pillCss && /background[^;]*;/.exec(pillCss);
      e.style.background = bg ? bg[0].replace(/^background(-image)?:/, '').replace(/;$/, '') : state === 'Positive' || state === 'Opportunity' ? '#12ba82' : state === 'Moderate' ? '#cfcfcf' : '#e2453c';
    });
    // caret: up (green) when good, down (red) when not, hidden when moderate.
    // The design draws it for the design value, so flip only when the direction differs.
    var good = function (x) { return kind === 'sentiment' ? x >= 0 : x >= 56; };
    var up = good(rounded), upDesign = good(c.v0);
    var hide = kind !== 'sentiment' && rounded >= 46 && rounded < 56;
    sel('data-caret').forEach(function (w) {
      var f = w.firstElementChild;
      if (!f) return;
      w.style.visibility = hide ? 'hidden' : '';
      var z = parseFloat(getComputedStyle(w.closest('.page')).zoom) || 1;
      var fr = f.getBoundingClientRect(), wr = w.getBoundingClientRect();
      w.style.transformOrigin = (fr.left + fr.width / 2 - wr.left) / z + 'px ' + (fr.top + fr.height / 2 - wr.top) / z + 'px';
      w.style.rotate = up === upDesign ? '0deg' : '180deg';
      w.querySelectorAll('path').forEach(function (p) { p.setAttribute('fill', up ? '#57d48e' : '#dc1b16'); });
    });

    if (c.circle) drawLiquid(page.querySelector('.dyn'), c, rounded);
    if (c.gauge) {
      var gv = clamp(rounded, 0, 100), z = zoneOf(gv);
      sel('data-gkey').forEach(function (e) {
        if (e.hasAttribute('data-seg')) {
          var on = +e.getAttribute('data-seg') === z;
          e.querySelector('[data-v="dim"]').hidden = on;
          e.querySelector('[data-v="on"]').hidden = !on;
        } else if (e.hasAttribute('data-needle')) {
          var frac = (gv - ZONE_LO[z]) / Math.max(1, ZONE_HI[z] - ZONE_LO[z]);
          var target = -(180 - ((z + frac) * 180) / 7); // screen angle; -180 = left, 0 = right
          e.style.rotate = (target - parseFloat(e.getAttribute('data-ang0'))) + 'deg';
        }
      });
    }
  }

  function applyHBars(page, data) {
    var zoneIcons = templates.zoneIcons;
    page.querySelectorAll('[data-hkey]').forEach(function (e) {
      var k = e.getAttribute('data-hkey'), i = k.lastIndexOf('|');
      var block = data[k.slice(0, i)], v = block ? block[k.slice(i + 1)] : undefined;
      if (!num(v)) return;
      v = clamp(v, 0, 100);
      if (e.hasAttribute('data-hfill')) {
        e.style.width = (parseFloat(e.getAttribute('data-htrack')) * v) / 100 + 'px';
      } else if (e.hasAttribute('data-hpct')) {
        setNumber(e, Math.round(v));
      } else if (e.hasAttribute('data-hicon') && zoneIcons) {
        var f = e.firstElementChild;
        if (!f) return;
        var t = zoneIcons[6 - zoneOf(v)];
        if (!t) return;
        var fw = parseFloat(f.style.width), fh = parseFloat(f.style.height);
        var sc = Math.min(fw / t.w, fh / t.h);
        f.innerHTML = '<div style="position:absolute;left:' + (fw - t.w * sc) / 2 + 'px;top:' + (fh - t.h * sc) / 2 + 'px;width:' + t.w + 'px;height:' + t.h + 'px;transform:scale(' + sc + ');transform-origin:0 0">' + t.html + '</div>';
      }
    });
  }

  function render(data) {
    data = data || window.REPORT_DATA || {};
    document.querySelectorAll('.page').forEach(function (page) {
      var cfgEl = page.querySelector('.dyn-config');
      var layer = page.querySelector('.dyn');
      if (!layer) return;
      layer.innerHTML = '';
      applyHBars(page, data);
      if (!cfgEl) return;
      var comps = JSON.parse(cfgEl.textContent);
      comps.forEach(function (c) {
        var v = data[c.key];
        if (v === undefined) return;
        if (c.type === 'vbar') drawBars(layer, c, v);
        else if (c.type === 'area') drawArea(layer, c, v);
        else if (num(v)) applyNumber(page, c, v);
      });
    });
  }

  window.CKReport = { render: render };
  var go = function () { render(); };
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(go); else window.addEventListener('load', go);
})();
