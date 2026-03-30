#!/usr/bin/env bash
set -euo pipefail

# Requantize all pietious PNG assets to strict MSX1 palette.
node - <<'NODE'
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const root = 'src/carts/pietious/res/img';
const palette = [
	[0, 0, 0],
	[0, 241, 20], [68, 249, 86], [85, 79, 255], [128, 111, 255], [250, 80, 51], [12, 255, 255],
	[255, 81, 52], [255, 115, 86], [226, 210, 4], [242, 217, 71], [4, 212, 19], [231, 80, 229],
	[208, 208, 208], [255, 255, 255],
];

function walk(dir, out) {
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
	const p = path.join(dir, e.name);
	if (e.isDirectory()) walk(p, out);
	else if (e.isFile() && p.endsWith('.png')) out.push(p);
	}
}

function srgbToLinear(c) {
	c /= 255;
	return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function rgbToLab(r, g, b) {
	const rl = srgbToLinear(r), gl = srgbToLinear(g), bl = srgbToLinear(b);
	const x = rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375;
	const y = rl * 0.2126729 + gl * 0.7151522 + bl * 0.0721750;
	const z = rl * 0.0193339 + gl * 0.1191920 + bl * 0.9503041;
	const xr = x / 0.95047, yr = y / 1.0, zr = z / 1.08883;
	const f = t => t > 0.008856 ? Math.pow(t, 1 / 3) : (7.787 * t + 16 / 116);
	const fx = f(xr), fy = f(yr), fz = f(zr);
	return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const palLab = palette.map(c => rgbToLab(c[0], c[1], c[2]));

function nearestIndex(r, g, b, allowBlack) {
	const lab = rgbToLab(r, g, b);
	let best = -1, bestD = 1e99;
	for (let i = 0; i < palette.length; i++) {
	if (!allowBlack && i === 0) continue;
	const p = palLab[i];
	const d = (lab[0] - p[0]) ** 2 + (lab[1] - p[1]) ** 2 + (lab[2] - p[2]) ** 2;
	if (d < bestD) { bestD = d; best = i; }
	}
	return best;
}

function mapGeneral(r, g, b) {
	let i = nearestIndex(r, g, b, true);
	if (i === 0) {
	const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
	const sat = Math.max(r, g, b) - Math.min(r, g, b);
	const nearBlack = lum < 12 && sat < 10;
	if (!nearBlack) i = nearestIndex(r, g, b, false);
	}
	return palette[i];
}

const files = [];
walk(root, files);
let changed = 0;
for (const f of files) {
	const img = PNG.sync.read(fs.readFileSync(f));
	let touched = false;
	for (let i = 0; i < img.data.length; i += 4) {
	if (img.data[i + 3] === 0) continue;
	const c = mapGeneral(img.data[i], img.data[i + 1], img.data[i + 2]);
	if (img.data[i] !== c[0] || img.data[i + 1] !== c[1] || img.data[i + 2] !== c[2]) touched = true;
	img.data[i] = c[0];
	img.data[i + 1] = c[1];
	img.data[i + 2] = c[2];
	img.data[i + 3] = 255;
	}
	if (touched) {
	fs.writeFileSync(f, PNG.sync.write(img));
	changed++;
	}
}
console.log('global_pass_changed_files=' + changed);
NODE

# Verify strict MSX1 palette for all pietious PNG assets.
node - <<'NODE'
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const pal = new Set([
	'0,0,0', '0,241,20', '68,249,86', '85,79,255', '128,111,255', '250,80,51',
	'12,255,255', '255,81,52', '255,115,86', '226,210,4', '242,217,71', '4,212,19',
	'231,80,229', '208,208,208', '255,255,255'
]);
const files = [];
function walk(dir) {
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
	const p = path.join(dir, e.name);
	if (e.isDirectory()) walk(p);
	else if (e.isFile() && p.endsWith('.png')) files.push(p);
	}
}
walk('src/carts/pietious/res/img');
let offTotal = 0;
let pxTotal = 0;
for (const f of files) {
	const img = PNG.sync.read(fs.readFileSync(f));
	let off = 0, total = 0;
	for (let i = 0; i < img.data.length; i += 4) {
	if (img.data[i + 3] === 0) continue;
	total++;
	const k = `${img.data[i]},${img.data[i + 1]},${img.data[i + 2]}`;
	if (!pal.has(k)) off++;
	}
	offTotal += off;
	pxTotal += total;
	if (off !== 0) console.log(`${f}: off_palette=${off}/${total}`);
}
console.log(`checked_png_files=${files.length}`);
console.log(`off_palette_pixels=${offTotal}/${pxTotal}`);
NODE
