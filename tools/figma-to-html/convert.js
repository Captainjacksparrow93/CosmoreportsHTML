// Figma (.fig kiwi JSON) -> absolute-positioned HTML converter.
// usage: node convert.js <doc.json> <images-dir> <out-dir> "<Title>"
const fs = require('fs');
const path = require('path');

const [, , DOC, IMGDIR, OUT, TITLE] = process.argv;
const d = JSON.parse(fs.readFileSync(DOC));
const blobs = d.blobs.map(b => Buffer.from(b.bytes.slice(4), 'base64'));

const gid = g => (g ? g.sessionID + ':' + g.localID : null);
const nodes = {};
const kids = {};
for (const n of d.nodeChanges) {
  nodes[gid(n.guid)] = n;
  const p = n.parentIndex && gid(n.parentIndex.guid);
  if (p) (kids[p] = kids[p] || []).push(gid(n.guid));
}
for (const p in kids) kids[p].sort((a, b) => (nodes[a].parentIndex.position < nodes[b].parentIndex.position ? -1 : 1));

// ---------- helpers ----------
const r2 = v => {
  const x = Math.round(v * 100) / 100;
  return Object.is(x, -0) ? 0 : x;
};
const px = v => r2(v) + 'px';
const b64hex = s => Buffer.from(s.replace(/^b64:/, ''), 'base64').toString('hex');
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = s => esc(s).replace(/"/g, '&quot;');

function rgba(c, op = 1) {
  const a = r2((c.a == null ? 1 : c.a) * op * 1000) / 1000;
  const R = Math.round(c.r * 255), G = Math.round(c.g * 255), B = Math.round(c.b * 255);
  if (a >= 1) return '#' + [R, G, B].map(v => v.toString(16).padStart(2, '0')).join('');
  return `rgba(${R},${G},${B},${a})`;
}

function inv(t) {
  const det = t.m00 * t.m11 - t.m01 * t.m10;
  return {
    m00: t.m11 / det, m01: -t.m01 / det, m10: -t.m10 / det, m11: t.m00 / det,
    m02: (t.m01 * t.m12 - t.m11 * t.m02) / det,
    m12: (t.m10 * t.m02 - t.m00 * t.m12) / det,
  };
}
const apply = (t, x, y) => [t.m00 * x + t.m01 * y + t.m02, t.m10 * x + t.m11 * y + t.m12];
const mul = (a, b) => ({
  m00: a.m00 * b.m00 + a.m01 * b.m10, m01: a.m00 * b.m01 + a.m01 * b.m11, m02: a.m00 * b.m02 + a.m01 * b.m12 + a.m02,
  m10: a.m10 * b.m00 + a.m11 * b.m10, m11: a.m10 * b.m01 + a.m11 * b.m11, m12: a.m10 * b.m02 + a.m11 * b.m12 + a.m12,
});
const ID = { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 };

// Decode a Figma path commands blob into SVG path data, optionally transformed.
function pathD(blobIdx, t) {
  const b = blobs[blobIdx];
  let o = 0;
  const out = [];
  const pt = () => {
    let x = b.readFloatLE(o), y = b.readFloatLE(o + 4);
    o += 8;
    if (t) [x, y] = apply(t, x, y);
    return r2(x) + ' ' + r2(y);
  };
  while (o < b.length) {
    const c = b[o++];
    if (c === 0) out.push('Z');
    else if (c === 1) out.push('M' + pt());
    else if (c === 2) out.push('L' + pt());
    else if (c === 3) out.push('Q' + pt() + ' ' + pt());
    else if (c === 4) out.push('C' + pt() + ' ' + pt() + ' ' + pt());
    else break;
  }
  return out.join('');
}

const usedImages = new Set();
function imageUrl(p) {
  const h = b64hex(p.image.hash);
  usedImages.add(h);
  return 'assets/images/' + h + imageExt(h);
}
const extCache = {};
function imageExt(h) {
  if (extCache[h]) return extCache[h];
  const buf = fs.readFileSync(path.join(IMGDIR, h)).subarray(0, 4);
  const e = buf[0] === 0x89 ? '.png' : buf[0] === 0xff ? '.jpg' : buf.toString('ascii', 0, 3) === 'GIF' ? '.gif' : '.png';
  return (extCache[h] = e);
}

const BLEND = {
  MULTIPLY: 'multiply', SCREEN: 'screen', OVERLAY: 'overlay', DARKEN: 'darken', LIGHTEN: 'lighten',
  COLOR_DODGE: 'color-dodge', COLOR_BURN: 'color-burn', HARD_LIGHT: 'hard-light', SOFT_LIGHT: 'soft-light',
  DIFFERENCE: 'difference', EXCLUSION: 'exclusion', HUE: 'hue', SATURATION: 'saturation', COLOR: 'color', LUMINOSITY: 'luminosity',
  LINEAR_BURN: 'multiply', LINEAR_DODGE: 'screen',
};

// ---------- paints -> CSS ----------
function gradientPoints(p, w, h) {
  const it = inv(p.transform);
  const a = apply(it, 0, 0.5), b = apply(it, 1, 0.5);
  return [[a[0] * w, a[1] * h], [b[0] * w, b[1] * h]];
}
function cssLinear(p, w, h) {
  const [[x0, y0], [x1, y1]] = gradientPoints(p, w, h);
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const ang = Math.atan2(ux, -uy);
  const L = Math.abs(w * Math.sin(ang)) + Math.abs(h * Math.cos(ang));
  const sx = w / 2 - (L / 2) * ux, sy = h / 2 - (L / 2) * uy;
  const stops = p.stops.map(s => {
    const qx = x0 + s.position * dx, qy = y0 + s.position * dy;
    const pos = ((qx - sx) * ux + (qy - sy) * uy) / L;
    return rgba(s.color, p.opacity ?? 1) + ' ' + r2(pos * 100) + '%';
  });
  return `linear-gradient(${r2((ang * 180) / Math.PI)}deg, ${stops.join(', ')})`;
}
function cssRadial(p, w, h) {
  const it = inv(p.transform);
  const c = apply(it, 0.5, 0.5), ex = apply(it, 1, 0.5), ey = apply(it, 0.5, 1);
  const rx = Math.hypot((ex[0] - c[0]) * w, (ex[1] - c[1]) * h);
  const ry = Math.hypot((ey[0] - c[0]) * w, (ey[1] - c[1]) * h);
  const stops = p.stops.map(s => rgba(s.color, p.opacity ?? 1) + ' ' + r2(s.position * 100) + '%');
  return `radial-gradient(${px(rx)} ${px(ry)} at ${px(c[0] * w)} ${px(c[1] * h)}, ${stops.join(', ')})`;
}
function cssAngular(p, w, h) {
  const it = inv(p.transform);
  const c = apply(it, 0.5, 0.5), e = apply(it, 1, 0.5);
  const ang = (Math.atan2((e[1] - c[1]) * h, (e[0] - c[0]) * w) * 180) / Math.PI + 90;
  const stops = p.stops.map(s => rgba(s.color, p.opacity ?? 1) + ' ' + r2(s.position * 100) + '%');
  return `conic-gradient(from ${r2(ang)}deg at ${px(c[0] * w)} ${px(c[1] * h)}, ${stops.join(', ')})`;
}

// One CSS background layer (string) for a paint, plus size/position/repeat.
function paintLayer(p, w, h) {
  switch (p.type) {
    case 'SOLID': {
      const c = rgba(p.color, p.opacity ?? 1);
      return { img: `linear-gradient(${c}, ${c})` };
    }
    case 'GRADIENT_LINEAR': return { img: cssLinear(p, w, h) };
    case 'GRADIENT_RADIAL': case 'GRADIENT_DIAMOND': return { img: cssRadial(p, w, h) };
    case 'GRADIENT_ANGULAR': return { img: cssAngular(p, w, h) };
    case 'IMAGE': {
      const url = `url(${imageUrl(p)})`;
      const mode = p.imageScaleMode;
      if (mode === 'FIT') return { img: url, size: 'contain', pos: 'center', rep: 'no-repeat', op: p.opacity };
      if (mode === 'TILE') {
        const s = p.scale || 1;
        return { img: url, size: `${px(p.originalImageWidth * s)} ${px(p.originalImageHeight * s)}`, pos: '0 0', rep: 'repeat', op: p.opacity };
      }
      if (mode === 'STRETCH' && p.transform) {
        const t = p.transform;
        const bw = w / t.m00, bh = h / t.m11;
        return { img: url, size: `${px(bw)} ${px(bh)}`, pos: `${px(-t.m02 * bw)} ${px(-t.m12 * bh)}`, rep: 'no-repeat', op: p.opacity };
      }
      return { img: url, size: 'cover', pos: 'center', rep: 'no-repeat', op: p.opacity };
    }
  }
  return null;
}

// Background CSS for a box. Paints with opacity on images, or blend modes, become separate layers.
function boxPaints(paints, w, h) {
  const vis = (paints || []).filter(p => p.visible !== false && (p.opacity ?? 1) > 0);
  const simple = [], layers = [];
  for (const p of vis) {
    const l = paintLayer(p, w, h);
    if (!l) continue;
    const needLayer = (p.type === 'IMAGE' && (p.opacity ?? 1) < 1) || (p.blendMode && p.blendMode !== 'NORMAL' && BLEND[p.blendMode]);
    if (needLayer) layers.push({ l, p });
    else simple.push(l);
  }
  // Figma paints: last = top. CSS backgrounds: first = top.
  let css = '';
  if (!css && simple.length) {
    const L = simple.slice().reverse();
    css = 'background-image:' + L.map(l => l.img).join(',') + ';';
    if (L.some(l => l.size)) {
      css += 'background-size:' + L.map(l => l.size || 'auto').join(',') + ';';
      css += 'background-position:' + L.map(l => l.pos || '0 0').join(',') + ';';
      css += 'background-repeat:' + L.map(l => l.rep || 'no-repeat').join(',') + ';';
    }
  }
  // solid fast path (single solid paint)
  if (vis.length === 1 && vis[0].type === 'SOLID' && !layers.length) css = 'background:' + rgba(vis[0].color, vis[0].opacity ?? 1) + ';';
  const extra = layers.map(({ l, p }) => {
    let s = `position:absolute;inset:0;border-radius:inherit;background-image:${l.img};`;
    if (l.size) s += `background-size:${l.size};background-position:${l.pos};background-repeat:${l.rep};`;
    if ((p.opacity ?? 1) < 1 && p.type === 'IMAGE') s += `opacity:${r2(p.opacity)};`;
    if (BLEND[p.blendMode]) s += `mix-blend-mode:${BLEND[p.blendMode]};`;
    return `<div style="${s}"></div>`;
  });
  return { css, extra: extra.join('') };
}

// ---------- SVG paints/filters ----------
let defId = 0;
function svgPaint(p, w, h, defs) {
  if (p.type === 'SOLID') return { fill: rgba(p.color, 1), op: (p.color.a ?? 1) * (p.opacity ?? 1) };
  const id = 'g' + ++defId;
  const it = inv(p.transform || ID);
  const gt = `matrix(${[it.m00, it.m10, it.m01, it.m11, it.m02, it.m12].map(r2).join(' ')})`;
  const stops = (p.stops || []).map(s => `<stop offset="${r2(s.position)}" stop-color="${rgba({ ...s.color, a: 1 })}"${(s.color.a ?? 1) < 1 ? ` stop-opacity="${r2(s.color.a)}"` : ''}/>`).join('');
  if (p.type === 'GRADIENT_LINEAR') {
    defs.push(`<linearGradient id="${id}" gradientUnits="objectBoundingBox" x1="0" y1="0.5" x2="1" y2="0.5" gradientTransform="${gt}">${stops}</linearGradient>`);
  } else if (p.type.startsWith('GRADIENT_')) {
    defs.push(`<radialGradient id="${id}" gradientUnits="objectBoundingBox" cx="0.5" cy="0.5" r="0.5" gradientTransform="${gt}">${stops}</radialGradient>`);
  } else if (p.type === 'IMAGE') {
    defs.push(`<pattern id="${id}" patternUnits="userSpaceOnUse" width="${r2(w)}" height="${r2(h)}"><image href="${imageUrl(p)}" width="${r2(w)}" height="${r2(h)}" preserveAspectRatio="${p.imageScaleMode === 'FIT' ? 'xMidYMid meet' : 'xMidYMid slice'}"/></pattern>`);
  } else return null;
  return { fill: `url(#${id})`, op: p.opacity ?? 1 };
}

function svgFilter(effects, defs) {
  const ef = (effects || []).filter(e => e.visible !== false && (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW'));
  if (!ef.length) return '';
  const id = 'f' + ++defId;
  const parts = [];
  const drops = [], inners = [];
  ef.forEach((e, i) => {
    const sd = r2(e.radius / 2);
    const col = rgba({ ...e.color, a: 1 }), a = r2(e.color.a ?? 1);
    if (e.type === 'DROP_SHADOW') {
      parts.push(`<feGaussianBlur in="SourceAlpha" stdDeviation="${sd}" result="b${i}"/><feOffset in="b${i}" dx="${r2(e.offset.x)}" dy="${r2(e.offset.y)}" result="o${i}"/><feFlood flood-color="${col}" flood-opacity="${a}"/><feComposite in2="o${i}" operator="in" result="d${i}"/>`);
      drops.push(`d${i}`);
    } else {
      parts.push(`<feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -1 1" result="v${i}"/><feOffset in="v${i}" dx="${r2(e.offset.x)}" dy="${r2(e.offset.y)}" result="vo${i}"/><feGaussianBlur in="vo${i}" stdDeviation="${sd}" result="vb${i}"/><feComposite in="vb${i}" in2="SourceAlpha" operator="in" result="vi${i}"/><feFlood flood-color="${col}" flood-opacity="${a}"/><feComposite in2="vi${i}" operator="in" result="n${i}"/>`);
      inners.push(`n${i}`);
    }
  });
  const merge = [...drops, 'SourceGraphic', ...inners].map(r => `<feMergeNode in="${r}"/>`).join('');
  defs.push(`<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB">${parts.join('')}<feMerge>${merge}</feMerge></filter>`);
  return `url(#${id})`;
}

// ---------- effects for HTML boxes ----------
function boxEffects(n) {
  const shadows = [], filters = [], back = [];
  let glass = null;
  for (const e of n.effects || []) {
    if (e.visible === false) continue;
    if (e.type === 'DROP_SHADOW') shadows.push(`${px(e.offset.x)} ${px(e.offset.y)} ${px(e.radius)} ${px(e.spread || 0)} ${rgba(e.color)}`);
    else if (e.type === 'INNER_SHADOW') shadows.push(`inset ${px(e.offset.x)} ${px(e.offset.y)} ${px(e.radius)} ${px(e.spread || 0)} ${rgba(e.color)}`);
    else if (e.type === 'FOREGROUND_BLUR' || e.type === 'LAYER_BLUR') filters.push(`blur(${px(e.radius / 2)})`);
    else if (e.type === 'BACKGROUND_BLUR') back.push(`blur(${px(e.radius / 2)})`);
    else if (e.type === 'GLASS') glass = e;
  }
  if (glass) {
    // Approximation of Figma's Glass effect: frosted backdrop + angled specular rim light.
    if (!back.length) back.push(`blur(${px(Math.max(glass.radius, 2) / 2)})`);
    back.push('saturate(1.15)');
    const a = (glass.specularAngle * Math.PI) / 180;
    const k = r2(glass.specularIntensity * 0.55);
    const bx = r2(Math.cos(a) * (glass.bevelSize || 1) * 1.5), by = r2(-Math.sin(a) * (glass.bevelSize || 1) * 1.5);
    shadows.push(`inset ${bx}px ${by}px 1px rgba(255,255,255,${k})`, `inset ${-bx}px ${-by}px 1px rgba(255,255,255,${r2(k / 2.5)})`);
  }
  return { shadows, filters, back };
}

// ---------- geometry for vectors ----------
function radii(n) {
  if (n.rectangleCornerRadiiIndependent) {
    const v = [n.rectangleTopLeftCornerRadius, n.rectangleTopRightCornerRadius, n.rectangleBottomRightCornerRadius, n.rectangleBottomLeftCornerRadius].map(x => x || 0);
    if (v.some(x => x)) return v.map(px).join(' ');
    return '';
  }
  return n.cornerRadius ? px(n.cornerRadius) : '';
}

function transformCss(t, w, h) {
  if (!t) return 'left:0;top:0;';
  const rot = Math.abs(t.m01) > 1e-6 || Math.abs(t.m10) > 1e-6 || Math.abs(t.m00 - 1) > 1e-6 || Math.abs(t.m11 - 1) > 1e-6;
  if (!rot) return `left:${px(t.m02)};top:${px(t.m12)};`;
  return `left:0;top:0;transform-origin:0 0;transform:matrix(${[t.m00, t.m10, t.m01, t.m11].map(v => r2(v * 10000) / 10000).join(',')},${r2(t.m02)},${r2(t.m12)});`;
}

// ---------- text ----------
const WEIGHT = { Thin: 100, ExtraLight: 200, Light: 300, Regular: 400, Medium: 500, SemiBold: 600, Bold: 700, ExtraBold: 800, Black: 900 };
function fontCss(fn) {
  const style = fn.style.replace(/\s+/g, '');
  const italic = /Italic/.test(style);
  const wname = style.replace('Italic', '') || 'Regular';
  return `font-family:'${fn.family}';font-weight:${WEIGHT[wname] || 400};${italic ? 'font-style:italic;' : ''}`;
}
function lsCss(ls, fs) {
  if (!ls || !ls.value) return '';
  return `letter-spacing:${px(ls.units === 'PERCENT' ? (ls.value / 100) * fs : ls.value)};`;
}
function textFillCss(paints, w, h) {
  const vis = (paints || []).filter(p => p.visible !== false);
  if (!vis.length) return 'color:transparent;';
  const p = vis[vis.length - 1];
  if (p.type === 'SOLID') return `color:${rgba(p.color, p.opacity ?? 1)};`;
  const l = paintLayer(p, w, h);
  return l ? `color:transparent;background-image:${l.img};-webkit-background-clip:text;background-clip:text;` : '';
}
function styleCss(st, base, w, h) {
  let s = '';
  const fn = st.fontName || base.fontName;
  if (st.fontName && (st.fontName.family !== base.fontName.family || st.fontName.style !== base.fontName.style)) s += fontCss(st.fontName);
  if (st.fontSize != null && st.fontSize !== base.fontSize) s += `font-size:${px(st.fontSize)};`;
  if (st.fillPaints) s += textFillCss(st.fillPaints, w, h);
  if (st.letterSpacing) s += lsCss(st.letterSpacing, st.fontSize || base.fontSize);
  if (st.textDecoration) s += st.textDecoration === 'UNDERLINE' ? 'text-decoration:underline;' : st.textDecoration === 'STRIKETHROUGH' ? 'text-decoration:line-through;' : 'text-decoration:none;';
  if (st.textCase) s += textCaseCss(st.textCase);
  void fn;
  return s;
}
function textCaseCss(tc) {
  return { UPPER: 'text-transform:uppercase;', LOWER: 'text-transform:lowercase;', TITLE: 'text-transform:capitalize;', SMALL_CAPS: 'font-variant:small-caps;', SMALL_CAPS_FORCED: 'font-variant:all-small-caps;' }[tc] || '';
}

function renderText(n, w, h) {
  const td = n.textData;
  const chars = [...td.characters]; // code points
  // characterStyleIDs index UTF-16 code units in Figma; map per code unit
  const units = td.characters;
  const ids = td.characterStyleIDs || [];
  const table = {};
  for (const o of td.styleOverrideTable || []) table[o.styleID] = o;
  const align = { LEFT: 'left', CENTER: 'center', RIGHT: 'right', JUSTIFIED: 'justify' }[n.textAlignHorizontal || 'LEFT'];
  const fsz = n.fontSize;
  const fillCss = textFillCss(n.fillPaints, w, h);
  // A gradient text fill must sit on each line box: background-clip:text does not reach positioned children.
  const gradFill = fillCss.includes('background-image') ? fillCss.replace('color:transparent;', '') : '';
  let base = fontCss(n.fontName) + `font-size:${px(fsz)};` + (gradFill ? 'color:transparent;' : fillCss) + lsCss(n.letterSpacing, fsz);
  if (n.textDecoration === 'UNDERLINE') base += 'text-decoration:underline;';
  if (n.textDecoration === 'STRIKETHROUGH') base += 'text-decoration:line-through;';
  if (n.textCase) base += textCaseCss(n.textCase);
  base += `text-align:${align};`;

  const runsFor = (a, z) => {
    let out = '', cur = null, buf = '';
    const flush = () => {
      if (!buf) return;
      const txt = esc(buf);
      const st = cur && table[cur];
      out += st ? `<span style="${styleCss(st, n, w, h)}">${txt}</span>` : txt;
      buf = '';
    };
    for (let i = a; i < z; i++) {
      let ch = units[i];
      if (ch === '\n' || ch === ' ') continue;
      const sid = ids[i] || 0;
      if (sid !== cur) { flush(); cur = sid; }
      buf += ch;
    }
    flush();
    return out;
  };

  const dt = n.derivedTextData;
  const bl = dt && dt.baselines;
  const lhRule = n.lineHeight || { value: 100, units: 'PERCENT' };
  if (!bl || !bl.length) {
    const lh = lhRule.units === 'PIXELS' ? px(lhRule.value) : lhRule.units === 'RAW' ? r2(lhRule.value) : 'normal';
    return `<div style="position:absolute;inset:0;white-space:pre-wrap;line-height:${lh};${base}${gradFill}">${runsFor(0, units.length)}</div>`;
  }
  // list support: figure bullets per paragraph
  const paraLines = td.lines || [];
  let paraStarts = [0];
  for (let i = 0; i < units.length; i++) if (units[i] === '\n') paraStarts.push(i + 1);
  const paraOf = ci => { let p = 0; for (let k = 0; k < paraStarts.length; k++) if (paraStarts[k] <= ci) p = k; return p; };
  const counters = {};
  let html = '';
  bl.forEach((b, i) => {
    let L;
    if (i + 1 < bl.length && bl[i + 1].lineY > b.lineY) L = bl[i + 1].lineY - b.lineY;
    else if (lhRule.units === 'PIXELS') L = lhRule.value;
    else if (lhRule.units === 'RAW') L = lhRule.value * fsz;
    else L = (b.lineHeight * (lhRule.value || 100)) / 100;
    // paragraph spacing may enlarge gap; clamp to rule when PIXELS
    if (lhRule.units === 'PIXELS' && L > lhRule.value) L = lhRule.value;
    const pIdx = paraOf(b.firstCharacter);
    const pl = paraLines[pIdx];
    let pre = '';
    let pad = '';
    if (pl && pl.lineType && pl.lineType !== 'PLAIN') {
      const indent = (pl.indentationLevel || 1) * fsz * 1.0;
      pad = `padding-left:${px(b.position.x)};`;
      if (paraStarts[pIdx] === b.firstCharacter) {
        let mark = '•';
        if (pl.lineType === 'ORDERED_LIST') { counters[pl.indentationLevel] = (counters[pl.indentationLevel] || 0) + 1; mark = counters[pl.indentationLevel] + '.'; }
        pre = `<span style="position:absolute;left:${px(Math.max(0, b.position.x - indent * 0.75))}">${mark}</span>`;
      }
    }
    const top = b.lineY;
    // Gradient lines span the whole text box so tall glyphs are never clipped by the painted background.
    const box = gradFill
      ? `top:0;padding-top:${px(top)};height:${px(Math.max(h, top + L))};${gradFill}background-size:${px(w)} ${px(h)};background-repeat:no-repeat;`
      : `top:${px(top)};height:${px(L)};`;
    html += `<div style="position:absolute;left:0;${box}width:100%;line-height:${px(L)};white-space:pre;${pad}">${pre}${runsFor(b.firstCharacter, b.endCharacter)}</div>`;
  });
  void chars;
  return `<div style="position:absolute;inset:0;${base}">${html}</div>`;
}

// ---------- node rendering ----------
const SHAPES = new Set(['VECTOR', 'ELLIPSE', 'LINE', 'STAR', 'REGULAR_POLYGON', 'BOOLEAN_OPERATION']);

function geomOf(n, t) {
  const fg = (n.fillGeometry || []).map(g => ({ d: pathD(g.commandsBlob, t), rule: g.windingRule === 'ODD' ? 'evenodd' : 'nonzero' }));
  return fg;
}
// Clip path (in parent space) for a mask node.
function maskPath(m) {
  const t = m.transform || ID;
  let parts = geomOf(m, t).map(g => g.d);
  if (!parts.length) {
    const collect = (k, acc) => {
      for (const c of kids[k] || []) {
        const cn = nodes[c];
        if (cn.visible === false) continue;
        const ct = mul(acc, cn.transform || ID);
        const g = geomOf(cn, ct).map(x => x.d);
        if (g.length) parts.push(...g);
        else if (cn.type === 'ROUNDED_RECTANGLE' || cn.type === 'FRAME') {
          if (kids[c]) collect(c, ct);
          else parts.push(rectPath(cn.size.x, cn.size.y, ct));
        }
      }
    };
    collect(gid(m.guid), t);
    if (!parts.length) parts.push(rectPath(m.size.x, m.size.y, t));
  }
  return parts.join('');
}
function rectPath(w, h, t) {
  const p = [[0, 0], [w, 0], [w, h], [0, h]].map(([x, y]) => apply(t, x, y).map(r2).join(' '));
  return `M${p[0]}L${p[1]}L${p[2]}L${p[3]}Z`;
}

function renderChildren(k, depth) {
  const list = (kids[k] || []).map(c => nodes[c]).filter(c => c.visible !== false || c.mask);
  let out = '';
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (c.mask && c.visible !== false) {
      const rest = [];
      let j = i + 1;
      for (; j < list.length && !list[j].mask; j++) rest.push(list[j]);
      const clip = maskPath(c).replace(/"/g, '');
      out += `<div style="position:absolute;inset:0;clip-path:path('${clip}');">` + rest.map(r => renderNode(r, depth + 1)).join('') + '</div>';
      i = j - 1;
      continue;
    }
    if (c.visible === false) continue;
    out += renderNode(c, depth + 1);
  }
  return out;
}

function renderStrokeSvg(n, w, h) {
  const sg = n.strokeGeometry || [];
  const sp = (n.strokePaints || []).filter(p => p.visible !== false);
  if (!sg.length || !sp.length) return '';
  const defs = [];
  let body = '';
  for (const p of sp) {
    const sv = svgPaint(p, w, h, defs);
    if (!sv) continue;
    for (const g of sg) body += `<path d="${pathD(g.commandsBlob)}" fill="${sv.fill}"${sv.op < 1 ? ` fill-opacity="${r2(sv.op)}"` : ''}${g.windingRule === 'ODD' ? ' fill-rule="evenodd"' : ''}/>`;
  }
  if (!body) return '';
  return `<svg style="position:absolute;left:0;top:0;overflow:visible" width="${r2(Math.max(w, 1))}" height="${r2(Math.max(h, 1))}">${defs.length ? '<defs>' + defs.join('') + '</defs>' : ''}${body}</svg>`;
}

function renderNode(n, depth) {
  const w = n.size ? n.size.x : 0, h = n.size ? n.size.y : 0;
  const k = gid(n.guid);
  let style = 'position:absolute;' + transformCss(n.transform, w, h) + `width:${px(w)};height:${px(h)};`;
  if ((n.opacity ?? 1) < 1) style += `opacity:${r2(n.opacity)};`;
  if (n.blendMode && BLEND[n.blendMode]) style += `mix-blend-mode:${BLEND[n.blendMode]};`;
  const eff = boxEffects(n);
  if (eff.filters.length) style += `filter:${eff.filters.join(' ')};`;
  const name = n.name ? ` data-name="${escAttr(n.name.slice(0, 60))}"` : '';

  if (n.type === 'TEXT') {
    let s = style;
    if (eff.shadows.length) {
      const ts = (n.effects || []).filter(e => e.visible !== false && e.type === 'DROP_SHADOW').map(e => `${px(e.offset.x)} ${px(e.offset.y)} ${px(e.radius)} ${rgba(e.color)}`);
      if (ts.length) s += `text-shadow:${ts.join(',')};`;
    }
    return `<div class="t" style="${s}">${renderText(n, w, h)}</div>`;
  }

  if (SHAPES.has(n.type)) {
    const defs = [];
    let body = '';
    const fills = (n.fillPaints || []).filter(p => p.visible !== false);
    const fg = n.fillGeometry || [];
    for (const p of fills) {
      const sv = svgPaint(p, w, h, defs);
      if (!sv) continue;
      for (const g of fg) body += `<path d="${pathD(g.commandsBlob)}" fill="${sv.fill}"${sv.op < 1 ? ` fill-opacity="${r2(sv.op)}"` : ''}${g.windingRule === 'ODD' ? ' fill-rule="evenodd"' : ''}/>`;
    }
    const sp = (n.strokePaints || []).filter(p => p.visible !== false);
    for (const p of sp) {
      const sv = svgPaint(p, w, h, defs);
      if (!sv) continue;
      for (const g of n.strokeGeometry || []) body += `<path d="${pathD(g.commandsBlob)}" fill="${sv.fill}"${sv.op < 1 ? ` fill-opacity="${r2(sv.op)}"` : ''}${g.windingRule === 'ODD' ? ' fill-rule="evenodd"' : ''}/>`;
    }
    if (!body) return '';
    const filt = svgFilter(n.effects, defs);
    let s = style;
    if (eff.back.length && fg.length) s += `backdrop-filter:${eff.back.join(' ')};-webkit-backdrop-filter:${eff.back.join(' ')};clip-path:path('${fg.map(g => pathD(g.commandsBlob)).join('')}');`;
    s = s.replace(`width:${px(w)};height:${px(h)};`, `width:${px(Math.max(w, 1))};height:${px(Math.max(h, 1))};`);
    return `<svg${name} style="${s}overflow:visible" width="${r2(Math.max(w, 1))}" height="${r2(Math.max(h, 1))}">${defs.length ? '<defs>' + defs.join('') + '</defs>' : ''}${filt ? `<g filter="${filt}">${body}</g>` : body}</svg>`;
  }

  // FRAME / ROUNDED_RECTANGLE / GROUP
  const rad = radii(n);
  if (rad) style += `border-radius:${rad};`;
  const bg = boxPaints(n.fillPaints, w, h);
  style += bg.css;
  if (eff.shadows.length) style += `box-shadow:${eff.shadows.join(',')};`;
  if (eff.back.length) style += `backdrop-filter:${eff.back.join(' ')};-webkit-backdrop-filter:${eff.back.join(' ')};`;
  const clips = n.type === 'FRAME' && !n.resizeToFit && !n.frameMaskDisabled;
  const inner = renderChildren(k, depth);
  const stroke = renderStrokeSvg(n, w, h);
  if (clips && inner) {
    // clip children but not the box-shadow / stroke
    return `<div${name} style="${style}">${bg.extra}<div style="position:absolute;inset:0;overflow:hidden;border-radius:inherit">${inner}</div>${stroke}</div>`;
  }
  return `<div${name} style="${style}">${bg.extra}${inner}${stroke}</div>`;
}

// ---------- pages ----------
const canvas = (kids['0:0'] || []).map(c => nodes[c]).find(c => c.type === 'CANVAS' && (kids[gid(c.guid)] || []).length);
const pages = (kids[gid(canvas.guid)] || []).map(c => nodes[c]).filter(c => c.visible !== false && c.type === 'FRAME');
pages.sort((a, b) => a.transform.m02 - b.transform.m02);

const pageHtml = pages.map((p, i) => {
  const w = p.size.x, h = p.size.y;
  const bg = boxPaints(p.fillPaints, w, h);
  const inner = renderChildren(gid(p.guid), 0);
  const stroke = renderStrokeSvg(p, w, h);
  return `<section class="page" id="page-${i + 1}" data-page="${i + 1}" aria-label="Page ${i + 1}" style="width:${px(w)};height:${px(h)}">` +
    `<div class="page-inner" style="width:${px(w)};height:${px(h)};${bg.css}">${bg.extra}${inner}${stroke}</div></section>`;
});

fs.mkdirSync(path.join(OUT, 'assets/images'), { recursive: true });
for (const h of usedImages) fs.copyFileSync(path.join(IMGDIR, h), path.join(OUT, 'assets/images', h + imageExt(h)));

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(TITLE)}</title>
<link rel="preload" href="assets/css/fonts.css" as="style">
<link rel="stylesheet" href="assets/css/fonts.css">
<link rel="stylesheet" href="assets/css/report.css">
</head>
<body>
<header class="toolbar" role="toolbar" aria-label="Report controls">
  <div class="tb-title">${esc(TITLE)}</div>
  <nav class="tb-nav">
    <button type="button" data-act="prev" aria-label="Previous page">&#8592;</button>
    <span class="tb-count"><input type="number" min="1" max="${pages.length}" value="1" aria-label="Page number" id="pageInput"> / ${pages.length}</span>
    <button type="button" data-act="next" aria-label="Next page">&#8594;</button>
  </nav>
  <div class="tb-zoom">
    <button type="button" data-act="zoom-out" aria-label="Zoom out">&minus;</button>
    <button type="button" data-act="fit" class="tb-fit" aria-label="Fit to width">Fit</button>
    <button type="button" data-act="zoom-in" aria-label="Zoom in">+</button>
    <button type="button" data-act="print" aria-label="Print or save as PDF">Print / PDF</button>
  </div>
</header>
<main class="doc" id="doc">
${pageHtml.join('\n')}
</main>
<script src="assets/js/report.js"></script>
</body>
</html>
`;
fs.writeFileSync(path.join(OUT, 'index.html'), html);
console.log(TITLE, 'pages', pages.length, 'images', usedImages.size, 'html KB', Math.round(html.length / 1024));
