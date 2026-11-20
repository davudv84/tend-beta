#!/usr/bin/env node
'use strict';
/*
 * sheet.cjs: cut, clean, align and pack the art of an office simulation, and draw a preview of it.
 * Pure Node (node:fs, node:path, node:zlib), no packages. Run it with "${HIVE_NODE:-node}".
 * It never draws a character or a prop: it only keys, cuts, downsamples, cleans, mirrors, aligns and packs
 * pictures an image model made (ART.md beside this folder).
 *
 *   char    --out cN.png --height 36 --sheet s1.png=down,up,right,talk,stretch [--sheet ...] [--palette ref.png]
 *           [--flip right,carryRight]   mirror rows the model drew facing left; then LOOK at cN-facing.png
 *   pack    --out cast.png c0.png c1.png ...
 *   shrink  <in.png> <out.png> --px <art pixel size> [--key] [--cut]
 *   room    <room.png> --cell 16 --out map.json
 *   preview <simulation folder> --out preview.png [--zoom 3] [--clean]
 *   check   <simulation folder>        the preset bar and the line rules, before you hand it in
 *   reuse   --preset <id> --list | --character <name or n> --out cN.png | --room --out <simulation folder>
 *           with no image model only: a shipped preset's drawn characters, desks and chairs, or its whole room
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const POSE_ROWS = ['down', 'up', 'left', 'right', 'sitDown', 'sitUp', 'sitLeft', 'sitRight', 'workDown', 'workUp', 'workLeft', 'workRight',
  'carryDown', 'carryUp', 'carryLeft', 'carryRight', 'stretch', 'drink', 'read', 'use', 'talk', 'cheer', 'nap', 'crouch', 'reach'];
const MIRROR = { left: 'right', sitLeft: 'sitRight', workLeft: 'workRight', carryLeft: 'carryRight' };
const CELL = 48, FEET = 45, FRAMES = 4;
// The lowest pixel of a seated row in its 48 px frame (the shipped simulations); every other row stands on y 45.
const SEAT_BOTTOM = { sitDown: 36, sitUp: 36, workDown: 36, workUp: 36, sitLeft: 41, sitRight: 41, workLeft: 41, workRight: 41 };

/* ---------- PNG ---------- */
const blank = (w, h) => ({ w, h, data: Buffer.alloc(w * h * 4) });
function readPng(file) {
  const b = fs.readFileSync(file);
  if (b.length < 8 || b.readUInt32BE(0) !== 0x89504e47) fail(`${file} is not a PNG`);
  let p = 8, w = 0, h = 0, depth = 0, type = 0, inter = 0, plte = null, trns = null; const idat = [];
  while (p + 8 <= b.length) {
    const len = b.readUInt32BE(p), t = b.toString('latin1', p + 4, p + 8), d = b.subarray(p + 8, p + 8 + len); p += 12 + len;
    if (t === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; type = d[9]; inter = d[12]; }
    else if (t === 'PLTE') plte = d; else if (t === 'tRNS') trns = d; else if (t === 'IDAT') idat.push(d); else if (t === 'IEND') break;
  }
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  if (depth !== 8 || inter || !ch) fail(`${file}: only 8 bit, not interlaced PNGs are read (save it again as 8 bit RGBA)`);
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * ch, px = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], s = y * (stride + 1) + 1, o = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? px[o + x - ch] : 0, u = y ? px[o - stride + x] : 0, c = x >= ch && y ? px[o - stride + x - ch] : 0;
      let v = raw[s + x];
      if (f === 1) v += a; else if (f === 2) v += u; else if (f === 3) v += (a + u) >> 1;
      else if (f === 4) { const q = a + u - c, pa = Math.abs(q - a), pb = Math.abs(q - u), pc = Math.abs(q - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? u : c; }
      px[o + x] = v & 255;
    }
  }
  const img = blank(w, h), D = img.data;
  for (let i = 0; i < w * h; i++) {
    const s = i * ch, o = i * 4;
    if (type === 6) px.copy(D, o, s, s + 4);
    else if (type === 2) { D[o] = px[s]; D[o + 1] = px[s + 1]; D[o + 2] = px[s + 2]; D[o + 3] = 255; }
    else if (type === 3) { const k = px[s]; D[o] = plte[k * 3]; D[o + 1] = plte[k * 3 + 1]; D[o + 2] = plte[k * 3 + 2]; D[o + 3] = trns && k < trns.length ? trns[k] : 255; }
    else { D[o] = D[o + 1] = D[o + 2] = px[s]; D[o + 3] = type === 4 ? px[s + 1] : 255; }
  }
  return img;
}
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (buf) => { let c = -1; for (const x of buf) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function writePng(file, img) {
  const chunk = (t, d) => { const o = Buffer.alloc(12 + d.length); o.writeUInt32BE(d.length, 0); o.write(t, 4, 'latin1'); d.copy(o, 8); o.writeUInt32BE(crc32(o.subarray(4, 8 + d.length)), 8 + d.length); return o; };
  const head = Buffer.alloc(13); head.writeUInt32BE(img.w, 0); head.writeUInt32BE(img.h, 4); head[8] = 8; head[9] = 6;
  const raw = Buffer.alloc((img.w * 4 + 1) * img.h);
  for (let y = 0; y < img.h; y++) img.data.copy(raw, y * (img.w * 4 + 1) + 1, y * img.w * 4, (y + 1) * img.w * 4);
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));
}

/* ---------- picture helpers ---------- */
function fail(msg) { console.error(`sheet: ${msg}`); process.exit(1); }
const at = (img, x, y) => (y * img.w + x) * 4;
const opaque = (img, x, y) => img.data[at(img, x, y) + 3] >= 128;
function crop(img, x0, y0, x1, y1) {
  const out = blank(x1 - x0, y1 - y0);
  for (let y = y0; y < y1; y++) img.data.copy(out.data, (y - y0) * out.w * 4, at(img, x0, y), at(img, x1, y));
  return out;
}
function box(img, min = 1) {
  let x0 = img.w, y0 = img.h, x1 = -1, y1 = -1;
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) if (img.data[at(img, x, y) + 3] >= min) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}
/** Draw `src` onto `dst` at (dx, dy), scaled by `k` (nearest), only its opaque pixels; `flip` mirrors it. */
function blit(dst, src, dx, dy, k = 1, flip = false, alpha = 1) {
  const W = Math.round(src.w * k), H = Math.round(src.h * k);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const X = Math.round(dx) + x, Y = Math.round(dy) + y;
    if (X < 0 || Y < 0 || X >= dst.w || Y >= dst.h) continue;
    const sx = Math.min(src.w - 1, Math.floor(x / k)), s = at(src, flip ? src.w - 1 - sx : sx, Math.min(src.h - 1, Math.floor(y / k))), a = (src.data[s + 3] / 255) * alpha;
    if (!a) continue;
    const o = at(dst, X, Y);
    for (let c = 0; c < 3; c++) dst.data[o + c] = Math.round(src.data[s + c] * a + dst.data[o + c] * (1 - a));
    dst.data[o + 3] = Math.max(dst.data[o + 3], Math.round(a * 255));
  }
}
/** Pictures with no transparency: the background (the border's commonest colour) is keyed out from the edges in. */
function key(img) {
  let seeThrough = 0;
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i] < 128) seeThrough++;
  if (seeThrough > img.w * img.h * 0.02) return img;
  const count = new Map(), q = (o) => ((img.data[o] >> 3) << 10) | ((img.data[o + 1] >> 3) << 5) | (img.data[o + 2] >> 3);
  for (let x = 0; x < img.w; x++) for (const y of [0, img.h - 1]) { const k = q(at(img, x, y)); count.set(k, (count.get(k) || 0) + 1); }
  for (let y = 0; y < img.h; y++) for (const x of [0, img.w - 1]) { const k = q(at(img, x, y)); count.set(k, (count.get(k) || 0) + 1); }
  const bg = [...count].sort((a, b) => b[1] - a[1])[0][0], br = (bg >> 10) << 3, bgc = ((bg >> 5) & 31) << 3, bb = (bg & 31) << 3;
  const near = (o) => Math.abs(img.data[o] - br) + Math.abs(img.data[o + 1] - bgc) + Math.abs(img.data[o + 2] - bb) < 60;
  const seen = new Uint8Array(img.w * img.h), stack = [];
  for (let x = 0; x < img.w; x++) stack.push([x, 0], [x, img.h - 1]);
  for (let y = 0; y < img.h; y++) stack.push([0, y], [img.w - 1, y]);
  while (stack.length) {
    const [x, y] = stack.pop(), i = y * img.w + x;
    if (x < 0 || y < 0 || x >= img.w || y >= img.h || seen[i] || !near(i * 4)) continue;
    seen[i] = 1; img.data[i * 4 + 3] = 0;
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  return img;
}
/** Runs of a profile with something in them, merged across small gaps, then joined until there are `want`. */
function bands(profile, want) {
  let segs = [], start = -1;
  profile.forEach((v, i) => { if (v && start < 0) start = i; if (!v && start >= 0) { segs.push([start, i]); start = -1; } });
  if (start >= 0) segs.push([start, profile.length]);
  const merged = [];
  for (const s of segs) if (merged.length && s[0] - merged[merged.length - 1][1] < 6) merged[merged.length - 1][1] = s[1]; else merged.push(s);
  segs = merged.filter((s) => s[1] - s[0] >= 12 || profile.slice(s[0], s[1]).reduce((a, b) => a + b, 0) > 200);
  while (segs.length > want) {
    let best = 0;
    for (let i = 1; i < segs.length - 1; i++) if (segs[i + 1][0] - segs[i][1] < segs[best + 1][0] - segs[best][1]) best = i;
    segs.splice(best, 2, [segs[best][0], segs[best + 1][1]]);
  }
  return segs;
}
/** A generated sheet cut into `rows` x `cols` figure boxes (the model never keeps an exact grid). */
function cutGrid(img, rows, cols, name) {
  const rp = new Array(img.h).fill(0);
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) if (opaque(img, x, y)) rp[y]++;
  const rb = bands(rp, rows);
  if (rb.length !== rows) fail(`${name}: found ${rb.length} rows of figures, expected ${rows}. Generate it again with wider gutters.`);
  return rb.map(([y0, y1]) => {
    const cp = new Array(img.w).fill(0);
    for (let y = y0; y < y1; y++) for (let x = 0; x < img.w; x++) if (opaque(img, x, y)) cp[x]++;
    const cb = bands(cp, cols);
    if (cb.length !== cols) fail(`${name}: the row at y ${y0} has ${cb.length} figures, expected ${cols}`);
    return cb.map(([x0, x1]) => { const b = box(crop(img, x0, y0, x1, y1), 128); return { x0, y0: y0 + b.y0, x1, y1: y0 + b.y1 }; });
  });
}
/** Downsample on a p px grid from the box's bottom centre: each pixel is the commonest colour of the middle of its
 *  block, never an average of different colours; see through when under 45 percent of the block is opaque. */
function downsample(img, b, p) {
  const cx = (b.x0 + b.x1) / 2, nw = Math.ceil((b.x1 - b.x0) / p / 2) + 1, nh = Math.ceil((b.y1 - b.y0) / p) + 1, out = blank(2 * nw, nh);
  for (let j = 0; j < nh; j++) for (let i = 0; i < 2 * nw; i++) sample(img, cx + (i - nw) * p, b.y1 - (j + 1) * p, p, out, at(out, i, nh - 1 - j));
  return out;
}
/** A whole picture on a p px grid from its top left corner: floor(w / p) by floor(h / p) pixels. */
function grid(img, p) {
  const out = blank(Math.floor(img.w / p), Math.floor(img.h / p));
  for (let j = 0; j < out.h; j++) for (let i = 0; i < out.w; i++) sample(img, i * p, j * p, p, out, at(out, i, j));
  return out;
}
/** The p x p block at (sx, sy): the commonest colour of its middle 60 percent, or see through when under 45 percent of it is opaque. */
function sample(img, sx, sy, p, out, o) {
  const m = 0.2, ya = Math.max(0, Math.round(sy + m * p)), yb = Math.min(img.h, Math.max(ya + 1, Math.round(sy + p - m * p)));
  const xa = Math.max(0, Math.round(sx + m * p)), xb = Math.min(img.w, Math.max(xa + 1, Math.round(sx + p - m * p)));
  const buckets = new Map(); let n = 0, on = 0;
  for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) {
    n++; const q = at(img, x, y); if (img.data[q + 3] < 128) continue; on++;
    const k = ((img.data[q] >> 3) << 10) | ((img.data[q + 1] >> 3) << 5) | (img.data[q + 2] >> 3);
    const e = buckets.get(k) || [0, 0, 0, 0]; e[0]++; e[1] += img.data[q]; e[2] += img.data[q + 1]; e[3] += img.data[q + 2]; buckets.set(k, e);
  }
  if (!n || on < 0.45 * n) return;
  let e = null; for (const v of buckets.values()) if (!e || v[0] > e[0]) e = v;
  out.data[o] = e[1] / e[0]; out.data[o + 1] = e[2] / e[0]; out.data[o + 2] = e[3] / e[0]; out.data[o + 3] = 255;
}
/** 8 connected pieces of the opaque pixels, largest first. */
function pieces(img) {
  const lab = new Int32Array(img.w * img.h), out = [];
  for (let s = 0; s < img.w * img.h; s++) {
    if (lab[s] || !img.data[s * 4 + 3]) continue;
    const part = [], stack = [s]; lab[s] = out.length + 1;
    while (stack.length) {
      const i = stack.pop(), x = i % img.w, y = (i - x) / img.w; part.push(i);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const X = x + dx, Y = y + dy, k = Y * img.w + X;
        if (X >= 0 && Y >= 0 && X < img.w && Y < img.h && !lab[k] && img.data[k * 4 + 3]) { lab[k] = out.length + 1; stack.push(k); }
      }
    }
    out.push(part);
  }
  return out.sort((a, b) => b.length - a.length);
}
const clear = (img, part) => { for (const i of part) img.data[i * 4 + 3] = 0; };
function snap(img, pal) {
  for (let o = 0; o < img.data.length; o += 4) {
    if (!img.data[o + 3]) continue;
    let best = null, bd = Infinity;
    for (const c of pal) { const d = 0.9 * (img.data[o] - c[0]) ** 2 + 1.77 * (img.data[o + 1] - c[1]) ** 2 + 0.33 * (img.data[o + 2] - c[2]) ** 2; if (d < bd) { bd = d; best = c; } }
    if (Math.sqrt(bd) < 48) { img.data[o] = best[0]; img.data[o + 1] = best[1]; img.data[o + 2] = best[2]; }
  }
}
function paletteOf(img) {
  const seen = new Map();
  for (let o = 0; o < img.data.length; o += 4) if (img.data[o + 3] > 200) { const k = ((img.data[o] >> 2) << 12) | ((img.data[o + 1] >> 2) << 6) | (img.data[o + 2] >> 2); const e = seen.get(k) || [0, 0, 0, 0]; e[0]++; e[1] += img.data[o]; e[2] += img.data[o + 1]; e[3] += img.data[o + 2]; seen.set(k, e); }
  return [...seen.values()].filter((e) => e[0] >= 2).map((e) => [e[1] / e[0], e[2] / e[0], e[3] / e[0]]);
}
/** A cleaned figure into its 48 px frame: centred on its mass, its lowest pixel on the row's line. */
function place(fig, row, lift, warn) {
  const b = box(fig), cell = blank(CELL, CELL);
  if (!b) return cell;
  const f = crop(fig, b.x0, b.y0, b.x1, b.y1);
  let mass = 0, sum = 0;
  for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) if (f.data[at(f, x, y) + 3]) { mass++; sum += x; }
  let x = Math.round(24 - sum / Math.max(mass, 1) - 0.5), y = (SEAT_BOTTOM[row] ?? FEET) - lift - f.h + 1;
  if (y < 0) { warn.push(`${row}: ${row in SEAT_BOTTOM || lift ? 'moved down' : 'top clipped by'} ${-y} px`); if (row in SEAT_BOTTOM || lift) y = 0; }
  if (f.w > CELL) warn.push(`${row}: ${f.w} px wide, clipped`);
  x = f.w <= CELL ? Math.min(Math.max(x, 0), CELL - f.w) : Math.floor((CELL - f.w) / 2);
  blit(cell, f, x, y);
  return cell;
}

/* ---------- commands ---------- */
function args(list) {
  const o = { _: [] };
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (!a.startsWith('--')) { o._.push(a); continue; }
    const k = a.slice(2), v = list[i + 1] && !list[i + 1].startsWith('--') ? list[++i] : true;
    if (k === 'sheet') (o.sheet ||= []).push(v); else o[k] = v;
  }
  return o;
}

function char(o) {
  const target = Number(o.height || 36), sheets = o.sheet || [];
  if (!o.out || !sheets.length) fail('char needs --out cN.png and at least one --sheet file.png=row,row,...');
  const pal = o.palette ? paletteOf(readPng(o.palette)) : null, rows = {}, warn = [], report = { height: target, sheets: {} };
  for (const spec of sheets) {
    const [file, list] = spec.split('='), names = (list || '').split(',').filter(Boolean);
    const bad = names.filter((n) => !POSE_ROWS.includes(n) || n in MIRROR);
    if (!names.length || bad.length) fail(`${spec}: rows are named from ${POSE_ROWS.filter((n) => !(n in MIRROR)).join(', ')} (left rows are mirrored for you)${bad.length ? `; not ${bad.join(', ')}` : ''}`);
    const img = key(readPng(file)), grid = cutGrid(img, names.length, FRAMES, file);
    const hs = grid[0].map((b) => b.y1 - b.y0).sort((a, b) => a - b), p = (hs[1] + hs[2]) / 2 / target;
    report.sheets[path.basename(file)] = { rows: names, artPixel: +p.toFixed(2), anchor: names[0] };
    names.forEach((row, i) => {
      if (rows[row]) return; // the first sheet that names a row gives it; later ones use it only as their scale anchor
      const ground = Math.max(...grid[i].map((b) => b.y1));
      rows[row] = grid[i].map((b) => {
        const small = downsample(img, b, p);
        for (const part of pieces(small)) if (part.length <= 2) clear(small, part);
        if (pal) snap(small, pal);
        if (row === 'reach') for (const part of pieces(small).slice(1)) clear(small, part);
        return place(small, row, row === 'cheer' ? Math.round((ground - b.y1) / p) : 0, warn);
      });
    });
  }
  // An image model often draws a "facing right" row facing left. Mirrored into the left row, that makes people walk
  // backwards, so the agent looks at the facing strip below and names every such row in --flip.
  const flips = String(o.flip === true ? '' : o.flip || '').split(',').filter(Boolean);
  const badFlip = flips.filter((r) => !Object.values(MIRROR).includes(r));
  if (badFlip.length) fail(`--flip takes the right rows: ${Object.values(MIRROR).join(', ')}; not ${badFlip.join(', ')}`);
  for (const r of flips) if (rows[r]) rows[r] = rows[r].map((c) => { const m = blank(c.w, c.h); blit(m, c, 0, 0, 1, true); return m; });
  const missing = POSE_ROWS.filter((r) => !rows[r] && !(MIRROR[r] && rows[MIRROR[r]]));
  const out = blank(CELL * FRAMES, CELL * POSE_ROWS.length);
  POSE_ROWS.forEach((r, ri) => {
    const from = rows[r] || (MIRROR[r] && rows[MIRROR[r]]);
    if (from) from.forEach((cell, f) => blit(out, cell, f * CELL, ri * CELL, 1, !rows[r]));
  });
  writePng(o.out, out);
  // The facing strip: frame 0 of each right row, 4x. Every figure in it must face the right edge.
  const right = Object.values(MIRROR).filter((r) => rows[r]), Z = 4, strip = blank(CELL * Z * right.length, CELL * Z);
  right.forEach((r, i) => blit(strip, rows[r][0], i * CELL * Z, 0, Z));
  const facing = o.out.replace(/\.png$/i, '') + '-facing.png';
  writePng(facing, strip);
  report.standing = heightsOf(out, 0); report.warnings = warn; report.missing = missing;
  report.flipped = flips;
  report.look = `${facing}: ${right.join(', ')}, left to right. Each must face the RIGHT edge (nose, chest and toes toward it). Run again with --flip naming every one that faces left, or people walk backwards.`;
  console.log(JSON.stringify(report, null, 1));
  if (missing.length) fail(`${o.out} has no ${missing.join(', ')}: generate a sheet with those rows`);
}
function heightsOf(sheet, ri, col0 = 0) {
  return [0, 1, 2, 3].map((f) => { const b = box(crop(sheet, col0 + f * CELL, ri * CELL, col0 + (f + 1) * CELL, (ri + 1) * CELL)); return b ? b.y1 - b.y0 : 0; });
}

function pack(o) {
  if (!o.out || !o._.length) fail('pack needs --out cast.png and the c0.png c1.png ... files in order');
  const cs = o._.map(readPng), out = blank(cs.length * CELL * FRAMES, CELL * POSE_ROWS.length), problems = [];
  cs.forEach((c, n) => {
    if (c.w !== CELL * FRAMES || c.h !== CELL * POSE_ROWS.length) fail(`${o._[n]} is ${c.w} x ${c.h}; a character sheet is ${CELL * FRAMES} x ${CELL * POSE_ROWS.length}`);
    blit(out, c, n * CELL * FRAMES, 0);
    POSE_ROWS.forEach((r, ri) => heightsOf(c, ri).forEach((h, f) => { if (!h) problems.push(`c${n} ${r} frame ${f + 1} is empty`); }));
    for (let i = 3; i < c.data.length; i += 4) if (c.data[i] && c.data[i] < 255) { problems.push(`c${n} has soft edges: alpha is only 0 or 255`); break; }
    const b = box(crop(c, 0, 0, CELL, CELL));
    if (b && (b.y1 - 1 !== FEET)) problems.push(`c${n} stands with its feet at y ${b.y1 - 1}, not ${FEET}`);
    if (b && (b.y1 - b.y0 < 34 || b.y1 - b.y0 > 38)) problems.push(`c${n} stands ${b.y1 - b.y0} px tall; the bar is 34 to 38 (a small creature may be less: say why)`);
  });
  writePng(o.out, out);
  console.log(JSON.stringify({ out: o.out, size: [out.w, out.h], characters: cs.length, frames: FRAMES, rows: POSE_ROWS, problems }, null, 1));
  if (problems.length) process.exitCode = 1;
}

function shrink(o) {
  const [src, dst] = o._, p = Number(o.px);
  if (!src || !dst || !(p >= 1)) fail('shrink needs <in.png> <out.png> --px <art pixel size, at least 1>');
  let img = readPng(src);
  if (o.key) img = key(img);
  const small = grid(img, p), b = box(small);
  if (!b) fail(`${src} has nothing opaque`);
  if (!o.cut) { writePng(dst, o.key ? crop(small, b.x0, b.y0, b.x1, b.y1) : small); console.log(JSON.stringify({ out: dst, size: [small.w, small.h] })); return; }
  const out = [];
  pieces(small).filter((part) => part.length >= 12).forEach((part, n) => {
    const one = blank(small.w, small.h);
    for (const i of part) small.data.copy(one.data, i * 4, i * 4, i * 4 + 4);
    const pb = box(one), file = dst.replace(/\.png$/i, `-${n}.png`);
    writePng(file, crop(one, pb.x0, pb.y0, pb.x1, pb.y1)); out.push({ file, size: [pb.x1 - pb.x0, pb.y1 - pb.y0], at: [pb.x0, pb.y0] });
  });
  console.log(JSON.stringify(out, null, 1));
}

function room(o) {
  const [src] = o._, cell = Number(o.cell || 16);
  if (!src || !o.out || ![16, 32].includes(cell)) fail('room needs <room.png> --cell 16|32 --out map.json');
  const img = readPng(src);
  if (img.w % cell || img.h % cell) fail(`${src} is ${img.w} x ${img.h}: crop it to whole cells of ${cell} first`);
  const W = img.w / cell, H = img.h / cell;
  if (img.w > 2048 || img.h > 1536) fail(`${src} is over 2048 x 1536`);
  fs.writeFileSync(o.out, JSON.stringify({ layers: [{ name: 'floor', data: Array.from({ length: W * H }, (_, i) => i + 1) }], walk: new Array(W * H).fill(1), doors: [{ x: 0, y: H - 1 }] }));
  console.log(JSON.stringify({ map: o.out, manifest: { scene: { cell, width: W, height: H }, tiles: [{ file: `art/${path.basename(src)}`, cell }] }, next: 'set walk to 0 on every cell people cannot stand on, and the real door' }, null, 1));
}

const DIGITS = ['111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001', '111100111001111', '111100111101111', '111001001001001', '111101111101111', '111101111001111'];
function text(img, s, x, y, k, rgb) {
  [...String(s)].forEach((d, n) => DIGITS[+d].split('').forEach((b, i) => { if (b === '1') rect(img, x + (n * 4 + (i % 3)) * k, y + Math.floor(i / 3) * k, k, k, rgb, 1, true); }));
}
function rect(img, x, y, w, h, rgb, alpha = 1, fill = false) {
  for (let Y = Math.max(0, Math.floor(y)); Y < Math.min(img.h, y + h); Y++) for (let X = Math.max(0, Math.floor(x)); X < Math.min(img.w, x + w); X++) {
    if (!fill && Y > y && Y < y + h - 1 && X > x && X < x + w - 1) continue;
    const o = at(img, X, Y); for (let c = 0; c < 3; c++) img.data[o + c] = Math.round(rgb[c] * alpha + img.data[o + c] * (1 - alpha)); img.data[o + 3] = 255;
  }
}
function preview(o) {
  const dir = o._[0], z = Number(o.zoom || 1);
  if (!dir || !o.out) fail('preview needs <simulation folder> --out preview.png');
  const J = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')), m = J('manifest.json'), map = J('map.json'), cs = m.scene.cell;
  const img = blank(m.scene.width * cs, m.scene.height * cs);
  rect(img, 0, 0, img.w, img.h, [0x22, 0x22, 0x22], 1, true);
  const tiles = []; // every tile of every sheet, numbered from 1
  for (const t of m.tiles || []) { const s = readPng(path.join(dir, t.file)); for (let y = 0; y + t.cell <= s.h; y += t.cell) for (let x = 0; x + t.cell <= s.w; x += t.cell) tiles.push(crop(s, x, y, x + t.cell, y + t.cell)); }
  for (const l of map.layers) l.data.forEach((n, i) => { if (n && tiles[n - 1]) blit(img, tiles[n - 1], (i % m.scene.width) * cs, Math.floor(i / m.scene.width) * cs); });
  const props = (m.props || []).map((p) => ({ ...p, img: readPng(path.join(dir, p.file)) }));
  const sheet = m.cast ? readPng(path.join(dir, m.cast.sheet)) : null, fw = m.cast?.frameWidth || CELL, fh = m.cast?.frameHeight || CELL, k = m.cast?.scale ?? 1.25;
  const rowsOf = m.cast?.rows || POSE_ROWS.slice(0, 8), frame = (c, row, f = 0) => crop(sheet, (c * (m.cast.frames || 4) + f) * fw, rowsOf.indexOf(row) * fh, (c * (m.cast.frames || 4) + f + 1) * fw, (rowsOf.indexOf(row) + 1) * fh);
  const people = [], nChars = m.cast?.characters.length || 0;
  (m.seats || []).forEach((s, i) => { // seated, in the nearest sorted prop within 16 px (the app's chair rule), as the app places a sitter
    if (!sheet) return;
    const sx = (s.x + 0.5) * cs, sy = (s.y + 0.5) * cs, d = (p) => Math.hypot(Math.max(p.x - sx, 0, sx - p.x - p.img.w), Math.max(p.y - sy, 0, sy - p.y - p.img.h));
    const chair = props.filter((p) => p.depth === 'sort').sort((a, b) => d(a) - d(b)).find((p) => d(p) <= 16.5);
    const row = { down: 'workDown', up: 'workUp', left: 'workLeft', right: 'workRight' }[s.facing], kk = fh / 32;
    const top = chair ? chair.y - ({ up: 16, left: 8, right: 8 }[s.facing] ?? 6) * kk : sy - fh * k;
    people.push({ foot: chair ? chair.y + chair.img.h + (s.facing === 'up' ? -0.5 : 0.5) : sy, img: frame(i % Math.max(nChars, 1), rowsOf.includes(row) ? row : 'sitDown'), x: (chair ? chair.x + chair.img.w / 2 : sx) - (fw * k) / 2, y: top });
  });
  (m.stops || []).forEach((s, i) => { if (sheet) people.push({ foot: (s.y + 1) * cs, img: frame(i % Math.max(nChars, 1), { down: 'down', up: 'up', left: 'left', right: 'right' }[s.facing] || 'down'), x: (s.x + 0.5) * cs - (fw * k) / 2, y: (s.y + 1) * cs - (FEET + 1) * k }); });
  for (const p of props.filter((p) => p.depth === 'below')) blit(img, p.img, p.x, p.y);
  const sorted = [...props.filter((p) => p.depth === 'sort').map((p) => ({ foot: p.y + p.img.h, draw: () => blit(img, p.img, p.x, p.y) })), ...people.map((p) => ({ foot: p.foot + 0.25, draw: () => blit(img, p.img, p.x, p.y, k) }))];
  sorted.sort((a, b) => a.foot - b.foot).forEach((s) => s.draw());
  for (const p of props.filter((p) => p.depth === 'above')) blit(img, p.img, p.x, p.y);
  const big = blank(img.w * z, img.h * z); blit(big, img, 0, 0, z);
  if (!o.clean) {
    const C = cs * z, cellBox = (c, rgb) => c && rect(big, c.x * C, c.y * C, C, C, rgb);
    map.walk.forEach((v, i) => { if (!v) rect(big, (i % m.scene.width) * C, Math.floor(i / m.scene.width) * C, C, C, [220, 40, 40], 0.3, true); });
    for (let x = 0; x <= m.scene.width; x += 1) rect(big, x * C, 0, 1, big.h, [0, 0, 0], x % 4 ? 0.15 : 0.45, true);
    for (let y = 0; y <= m.scene.height; y += 1) rect(big, 0, y * C, big.w, 1, [0, 0, 0], y % 4 ? 0.15 : 0.45, true);
    const dk = Math.max(1, Math.floor(z));
    for (let x = 0; x < m.scene.width; x += 4) text(big, x, x * C + 2, 2, dk, [255, 255, 255]);
    for (let y = 4; y < m.scene.height; y += 4) text(big, y, 2, y * C + 2, dk, [255, 255, 255]);
    (m.seats || []).forEach((s) => cellBox(s, [40, 220, 240]));
    (m.stops || []).forEach((s) => cellBox(s, [250, 220, 40]));
    (map.doors || []).forEach((s) => cellBox(s, [60, 120, 255]));
    cellBox(m.oneOnOne, [230, 60, 230]); cellBox(m.waitAt, [255, 140, 0]); cellBox(m.reportTo, [255, 255, 255]); cellBox(m.board?.stand, [40, 220, 90]);
    if (m.board) { rect(big, m.board.x * z, m.board.y * z, m.board.w * z, m.board.h * z, [40, 220, 90]); if (m.board.askMe) rect(big, m.board.askMe.x * z, m.board.askMe.y * z, m.board.askMe.w * z, m.board.askMe.h * z, [255, 140, 0]); }
  }
  writePng(o.out, big);
  console.log(JSON.stringify({ out: o.out, size: [big.w, big.h], marks: o.clean ? 'none' : 'red cells cannot be walked; cyan seats, yellow stops, blue doors, magenta 1:1, orange wait spot and askMe, white report spot, green board and its stand; numbers every 4 cells' }));
}

/** The preset bar, measured as the app measures a hand in (its gaps), plus the line rules it refuses on. */
function check(o) {
  const dir = o._[0];
  if (!dir) fail('check needs <simulation folder>');
  const J = (f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return null; } };
  const m = J('manifest.json') || fail('no manifest.json'), lines = J('lines.json') || {}, gaps = [], refused = [], style = [];
  const LANGS = ['en', 'ar', 'de', 'es', 'fr', 'it', 'ja', 'ko', 'pt-BR', 'tr', 'zh-CN'], IDLE = ['plant', 'read', 'sofa', 'stretch', 'look', 'play', 'phone', 'snack'];
  if (m.detail !== 'rich') gaps.push('say "detail": "rich" so the app measures it against the preset bar');
  const rows = m.cast?.rows || [], kinds = new Set((m.activities || []).map((a) => a.kind)), moves = m.moves || [];
  const noRows = POSE_ROWS.filter((r) => !rows.includes(r));
  if (noRows.length) gaps.push(`cast.rows lacks ${noRows.join(', ')}`);
  if ((m.cast?.frames || 0) < 4) gaps.push('cast.frames is 4');
  for (const c of m.cast?.characters || []) if (!c.avatar || !c.headshot) refused.push(`${c.name} needs an avatar and a headshot`);
  if (!m.orchestrator) refused.push('"orchestrator": { "character": 0, "seat": 0 }');
  const idle = IDLE.filter((k) => kinds.has(k));
  if (idle.length < 6) gaps.push(`${idle.length} of the idle activities (${IDLE.join(', ')}); at least 6`);
  if (moves.length < 4) gaps.push(`${moves.length} moves; at least 4`);
  for (const mv of moves) if (!kinds.has(mv.id)) gaps.push(`no activity does the move ${mv.id}`);
  for (const k of ['stops', 'hangout', 'board', 'oneOnOne', 'waitAt', 'work', 'burst']) if (!m[k] || (Array.isArray(m[k]) && !m[k].length)) gaps.push(`no "${k}"`);
  if (m.board && (!m.board.askMe || !m.board.stand)) gaps.push('the board needs "askMe" and "stand"');
  const moments = new Set(['working', 'idle', 'waiting', 'blocked', 'success', 'cheer', 'report', 'received', 'oneOnOne', 'fourthWall', ...[...kinds].filter((k) => k !== 'work' && k !== 'wander'), ...moves.map((mv) => mv.id)]);
  for (const mo of moments) { const short = LANGS.filter((l) => (lines[mo]?.[l]?.length || 0) < 12); if (short.length) gaps.push(`lines "${mo}": fewer than 12 in ${short.join(' ')}`); }
  const shortTalks = LANGS.filter((l) => (lines.exchanges?.[l]?.length || 0) < 20);
  if (shortTalks.length) gaps.push(`fewer than 20 exchanges in ${shortTalks.join(' ')}`);
  for (const [mo, byLang] of Object.entries(lines)) for (const [l, list] of Object.entries(byLang || {})) {
    if (mo !== 'exchanges' && list.length > 24) refused.push(`lines "${mo}" ${l}: ${list.length} lines, at most 24`);
    if (mo === 'exchanges' && list.length > 48) refused.push(`exchanges ${l}: ${list.length} talks, at most 48`);
    for (const t of (mo === 'exchanges' ? list.flat() : list)) {
      const where = `${mo} ${l}: "${t}"`;
      if ([...t].length > 60) refused.push(`${where} is over 60 characters`);
      const brace = (t.match(/[{}][^{}]*[{}]?/g) || []).find((b) => !/^\{(name|done|open|tokens|idle)\}$/.test(b));
      if (brace) refused.push(`${where}: a brace is only {name} {done} {open} {tokens} {idle}`);
      if (/[‐-―−]| - /.test(t)) style.push(`${where} has a dash`);
      if (/\bworkers?\b|\bMichael\b/i.test(t)) style.push(`${where}: never "worker" or "Michael"`);
      if (l === 'ja' && !/[぀-ヿ一-鿿]/.test(t)) style.push(`${where} has no Japanese`);
      if (l === 'ko' && /[぀-ヿ一-鿿]/.test(t)) style.push(`${where} has Han or kana`);
      if (l === 'tr' && /[가-힯]/.test(t)) style.push(`${where} has Hangul`);
    }
  }
  for (const [mo, byLang] of Object.entries(lines)) if (mo === 'exchanges') for (const [l, list] of Object.entries(byLang)) list.forEach((x, i) => { if (!Array.isArray(x) || x.length < 2 || x.length > 4) refused.push(`exchanges ${l} #${i + 1}: 2 to 4 lines`); });
  console.log(JSON.stringify({ gaps, refused, style }, null, 1));
  if (gaps.length || refused.length || style.length) process.exitCode = 1;
}

/* ---------- reuse: the presets' own drawn art, the road with no image model (ART.md) ---------- */
// The six presets drawn for the app. Star Hike and the classic office are licensed art: never reused, and the hand in
// refuses their pictures.
// Their shown names are the app's (OWN_THEME_NAMES in src/shared/officeTheme.ts), not their manifests' labels.
const OWN_PRESETS = { 'open-seas': 'One Fragment', playroom: 'Toy Tale', 'neon-district': 'Cyber Dunk', 'executive-wing': 'Off-white House', 'hacker-house': 'South of Market', 'wizard-school': 'Hurry Porter' };
// What a room is made of in a preset's manifest; the rest (who, what world, its words) is the new simulation's own.
const NOT_ROOM = ['format', 'id', 'label', 'base', 'inspiredBy', 'detail', 'cast', 'orchestrator', 'cover', 'inboxThinking'];
function presetOf(o) {
  const root = o.from || process.env.MD_SIMULATION_PRESETS;
  if (!root || !fs.existsSync(root)) fail('there is no preset art to reuse here (MD_SIMULATION_PRESETS is not set: a Cloud Office, or an app before 0.5.8). Ask the person to connect an image model (ART.md).');
  if (!Object.hasOwn(OWN_PRESETS, o.preset)) fail(`--preset is one of ${Object.keys(OWN_PRESETS).join(', ')}${o.preset === 'starhike' ? '. Star Hike is licensed art and is never reused' : ''}`);
  const dir = path.join(root, o.preset);
  return { dir, m: JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) };
}
function reuse(o) {
  const { dir, m } = presetOf(o), chars = m.cast?.characters || [];
  const drawn = JSON.stringify(m.cast?.rows || []) === JSON.stringify(POSE_ROWS);
  if (o.list) {
    const props = fs.readdirSync(path.join(dir, 'art')).filter((f) => /^(desk|chair)-\d+\.png$/.test(f));
    console.log(JSON.stringify({ preset: o.preset, name: OWN_PRESETS[o.preset], characters: chars.map((c, n) => `${n}: ${c.name}`), scale: m.cast?.scale ?? 1, allRows: drawn, seats: (m.seats || []).length, props }, null, 1));
    if (!drawn) console.log(`${o.preset}'s characters are not drawn in the ${POSE_ROWS.length} rows yet: take characters from another preset (its room still works).`);
    return;
  }
  if (!o.out) fail('reuse needs --list, or --character and --out, or --room and --out');
  if (o.room) {
    const sim = o.out, art = path.join(sim, 'art'); fs.mkdirSync(art, { recursive: true });
    const props = fs.readdirSync(path.join(dir, 'art')).filter((f) => /^(desk|chair)-\d+\.png$/.test(f) || f === 'floor.png');
    for (const f of props) fs.copyFileSync(path.join(dir, 'art', f), path.join(art, f));
    fs.copyFileSync(path.join(dir, 'map.json'), path.join(sim, 'map.json'));
    const keys = Object.fromEntries(Object.entries(m).filter(([k]) => !NOT_ROOM.includes(k)));
    fs.writeFileSync(path.join(sim, 'room-keys.json'), JSON.stringify(keys, null, 1));
    console.log(JSON.stringify({ room: o.preset, copied: ['map.json', ...props.map((f) => `art/${f}`)], keys: path.join(sim, 'room-keys.json'),
      look: `Merge room-keys.json into your manifest.json, then delete it. Rename every room, seat, stop and move for your world and write your own lines for them; keep their places. The room is ${OWN_PRESETS[o.preset]}'s: tell the person so.` }, null, 1));
    return;
  }
  if (!drawn) fail(`${o.preset}'s characters are not drawn in the ${POSE_ROWS.length} rows yet; take characters from another preset (--list shows them)`);
  const want = String(o.character ?? ''), n = /^\d+$/.test(want) ? Number(want) : chars.findIndex((c) => c.name.toLowerCase() === want.toLowerCase());
  const c = chars[n];
  if (!c) fail(`${o.preset} has no character "${want}": ${chars.map((x, i) => `${i}: ${x.name}`).join(', ')}`);
  const fw = m.cast.frameWidth || CELL, fh = m.cast.frameHeight || CELL;
  if (fw !== CELL || fh !== CELL) fail(`${o.preset}'s frames are ${fw} x ${fh}, not ${CELL}`);
  const sheet = readPng(path.join(dir, m.cast.sheet || 'art/cast.png')), x0 = (c.column ?? n * FRAMES) * CELL;
  writePng(o.out, crop(sheet, x0, 0, x0 + CELL * FRAMES, CELL * POSE_ROWS.length));
  const base = o.out.replace(/\.png$/i, ''), faces = {};
  for (const k of ['avatar', 'headshot']) if (c[k]) { faces[k] = o[k] || `${base}-${k}.png`; fs.mkdirSync(path.dirname(faces[k]), { recursive: true }); fs.copyFileSync(path.join(dir, c[k]), faces[k]); }
  console.log(JSON.stringify({ out: o.out, from: `${OWN_PRESETS[o.preset]}: ${c.name}`, scale: m.cast.scale ?? 1, ...faces,
    look: `Give them a name that fits this drawing and your world, and set cast.scale to ${m.cast.scale ?? 1}. People from presets with another scale stand at another height: take them from one preset, or from presets with the same scale.` }, null, 1));
}

const [cmd, ...rest] = process.argv.slice(2);
const run = { char, pack, shrink, room, preview, check, reuse }[cmd];
if (!run) fail('commands: char, pack, shrink, room, preview, check, reuse (the head of this file shows each one)');
run(args(rest));
