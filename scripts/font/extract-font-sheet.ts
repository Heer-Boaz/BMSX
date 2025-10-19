import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { PNG } from 'pngjs';

type GlyphOrder = 'codepoint' | 'sequential';

type GlyphSpec = { suffix: string; tile: number };

type CliConfig = {
	sheetPath: string;
	outputDir: string;
	mapPath: string | null;
	tileWidth: number;
	tileHeight: number;
	columns: number | null;
	rows: number | null;
	offsetX: number;
	offsetY: number;
	overwrite: boolean;
	order: GlyphOrder;
	inspect: boolean;
};

type RawArgs = { [key: string]: string };

type MapEntry = { suffix: string; tile?: number; code?: number; char?: string };

type BaseGlyph = { suffix: string; code: number };

function baseGlyphs(): BaseGlyph[] {
	const glyphs: BaseGlyph[] = [];
	for (let i = 0; i < 10; i += 1) {
		glyphs.push({ suffix: String(i), code: 48 + i });
	}
	const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
	for (let i = 0; i < upper.length; i += 1) {
		glyphs.push({ suffix: upper[i], code: upper.charCodeAt(i) });
	}
	glyphs.push({ suffix: 'Apostroph', code: 39 });
	glyphs.push({ suffix: 'Colon', code: 58 });
	glyphs.push({ suffix: 'Comma', code: 44 });
	glyphs.push({ suffix: 'Continue', code: 16 });
	glyphs.push({ suffix: 'Dot', code: 46 });
	glyphs.push({ suffix: 'Exclamation', code: 33 });
	const ijCodePoint = '\u00A1'.codePointAt(0);
	if (ijCodePoint === undefined) {
		throw new Error('Failed to resolve code point for IJ glyph');
	}
	glyphs.push({ suffix: 'IJ', code: ijCodePoint });
	glyphs.push({ suffix: 'Line', code: 196 });
	glyphs.push({ suffix: 'Percent', code: 37 });
	glyphs.push({ suffix: 'Question', code: 63 });
	glyphs.push({ suffix: 'Slash', code: 47 });
	glyphs.push({ suffix: 'Space', code: 32 });
	glyphs.push({ suffix: 'SpeakEnd', code: 93 });
	glyphs.push({ suffix: 'SpeakStart', code: 91 });
	glyphs.push({ suffix: 'Streep', code: 45 });
	return glyphs;
}

function buildDefaultGlyphs(order: GlyphOrder): GlyphSpec[] {
	const base = baseGlyphs();
	const list: GlyphSpec[] = [];
	for (let i = 0; i < base.length; i += 1) {
		const tile = order === 'sequential' ? i : base[i].code;
		list.push({ suffix: base[i].suffix, tile });
	}
	return list;
}

function parseCli(argv: string[]): CliConfig {
	const raw: RawArgs = {};
	let overwrite = false;
	let order: GlyphOrder = 'codepoint';
	let inspect = false;
	for (let i = 0; i < argv.length; i += 1) {
		const token = argv[i];
		if (token.startsWith('--') === false) {
			throw new Error(`Unexpected argument syntax: ${token}`);
		}
		const key = token.slice(2);
		if (key === 'overwrite') {
			overwrite = true;
			continue;
		}
		if (key === 'inspect') {
			inspect = true;
			continue;
		}
		if (key === 'order') {
			if (i + 1 >= argv.length) {
				throw new Error('Missing value for --order');
			}
			const value = argv[i + 1];
			if (value !== 'codepoint' && value !== 'sequential') {
				throw new Error(`Unsupported order value: ${value}`);
			}
			order = value;
			i += 1;
			continue;
		}
		if (i + 1 >= argv.length) {
			throw new Error(`Missing value for --${key}`);
		}
		const value = argv[i + 1];
		raw[key] = value;
		i += 1;
	}
	const sheetPath = raw.sheet;
	if (!sheetPath) {
		throw new Error('Missing required --sheet argument');
	}
	const outputDir = raw.output;
	if (!outputDir) {
		throw new Error('Missing required --output argument');
	}
	let tileWidth = 8;
	if (raw.tileWidth) {
		tileWidth = parseNumber(raw.tileWidth, '--tileWidth');
	}
	let tileHeight = 8;
	if (raw.tileHeight) {
		tileHeight = parseNumber(raw.tileHeight, '--tileHeight');
	}
	let columns: number | null = null;
	if (raw.columns) {
		columns = parseNumber(raw.columns, '--columns');
	}
	let rows: number | null = null;
	if (raw.rows) {
		rows = parseNumber(raw.rows, '--rows');
	}
	let offsetX = 0;
	if (raw.offsetX) {
		offsetX = parseNumber(raw.offsetX, '--offsetX');
	}
	let offsetY = 0;
	if (raw.offsetY) {
		offsetY = parseNumber(raw.offsetY, '--offsetY');
	}
	const mapPath = raw.map ? raw.map : null;
	return {
		sheetPath,
		outputDir,
		mapPath,
		tileWidth,
		tileHeight,
		columns,
		rows,
		offsetX,
		offsetY,
		overwrite,
		order,
		inspect,
	};
}

function parseNumber(value: string, flagName: string): number {
	const parsed = Number.parseInt(value, 10);
	if (Number.isFinite(parsed) === false || parsed <= 0) {
		throw new Error(`Invalid value for ${flagName}: ${value}`);
	}
	return parsed;
}

function loadGlyphSpecs(mapPath: string | null, order: GlyphOrder): GlyphSpec[] {
	if (!mapPath) {
		return buildDefaultGlyphs(order);
	}
	const resolved = resolve(process.cwd(), mapPath);
	if (existsSync(resolved) === false) {
		throw new Error(`Glyph map not found: ${resolved}`);
	}
	const contents = readFileSync(resolved, 'utf8');
	const parsed = JSON.parse(contents);
	if (Array.isArray(parsed) === false) {
		throw new Error('Glyph map must be an array');
	}
	const specs: GlyphSpec[] = [];
	for (let i = 0; i < parsed.length; i += 1) {
		const entry = parsed[i] as MapEntry;
		if (!entry || typeof entry !== 'object') {
			throw new Error(`Glyph map entry at index ${i} must be an object`);
		}
		if (!entry.suffix) {
			throw new Error(`Glyph map entry at index ${i} is missing a suffix`);
		}
		let tile = -1;
		if (typeof entry.tile === 'number') {
			tile = entry.tile;
		} else if (typeof entry.code === 'number') {
			tile = entry.code;
		} else if (typeof entry.char === 'string') {
			if (entry.char.length === 0) {
				throw new Error(`Glyph map entry at index ${i} has an empty char value`);
			}
			const point = entry.char.codePointAt(0);
			if (point === undefined) {
				throw new Error(`Unable to derive code point for glyph ${entry.suffix}`);
			}
			tile = point;
		} else {
			throw new Error(`Glyph map entry at index ${i} must provide tile, code, or char`);
		}
		specs.push({ suffix: entry.suffix, tile });
	}
	return specs;
}

function cropGlyph(sheet: PNG, x: number, y: number, width: number, height: number): PNG {
	const glyph = new PNG({ width, height, filterType: -1 });
	for (let row = 0; row < height; row += 1) {
		const srcStart = ((y + row) * sheet.width + x) << 2;
		const srcEnd = srcStart + (width << 2);
		const destStart = (row * width) << 2;
		const slice = sheet.data.subarray(srcStart, srcEnd);
		glyph.data.set(slice, destStart);
	}
	return glyph;
}

function glyphPreview(glyph: PNG): string {
	const lines: string[] = [];
	for (let y = 0; y < glyph.height; y += 1) {
		let line = '';
		for (let x = 0; x < glyph.width; x += 1) {
			const idx = (y * glyph.width + x) << 2;
			const alpha = glyph.data[idx + 3];
			line += alpha > 127 ? '#' : ' ';
		}
		lines.push(line);
	}
	return lines.join('\n');
}

function dumpTilePreviews(sheet: PNG, columns: number, rows: number, tileWidth: number, tileHeight: number, offsetX: number, offsetY: number): void {
	const totalTiles = columns * rows;
	for (let tile = 0; tile < totalTiles; tile += 1) {
		const col = tile % columns;
		const row = Math.trunc(tile / columns);
		const x = offsetX + col * tileWidth;
		const y = offsetY + row * tileHeight;
		const glyph = cropGlyph(sheet, x, y, tileWidth, tileHeight);
		const preview = glyphPreview(glyph);
		console.log(`Tile ${tile}`);
		console.log(preview);
		console.log('');
	}
}

function ensureUniqueSuffixes(glyphs: GlyphSpec[]): void {
	const seen: Record<string, true> = {};
	for (let i = 0; i < glyphs.length; i += 1) {
		const suffix = glyphs[i].suffix;
		if (seen[suffix]) {
			throw new Error(`Duplicate glyph suffix detected: ${suffix}`);
		}
		seen[suffix] = true;
	}
}

function run(): void {
	const cli = parseCli(process.argv.slice(2));
	const sheetPath = resolve(process.cwd(), cli.sheetPath);
	if (existsSync(sheetPath) === false) {
		throw new Error(`Sprite sheet not found: ${sheetPath}`);
	}
	const outputDir = resolve(process.cwd(), cli.outputDir);
	const sheetBuffer = readFileSync(sheetPath);
	const sheet = PNG.sync.read(sheetBuffer);
	let tileWidth = cli.tileWidth;
	let tileHeight = cli.tileHeight;
	const usableWidth = sheet.width - cli.offsetX;
	if (usableWidth <= 0) {
		throw new Error('Horizontal offset leaves no usable pixels in the sheet');
	}
	const usableHeight = sheet.height - cli.offsetY;
	if (usableHeight <= 0) {
		throw new Error('Vertical offset leaves no usable pixels in the sheet');
	}
	let columns = cli.columns;
	if (columns === null) {
		if (usableWidth % tileWidth !== 0) {
			throw new Error('Usable sheet width is not divisible by tile width. Provide --columns to override.');
		}
		columns = usableWidth / tileWidth;
	}
	let rows = cli.rows;
	if (rows === null) {
		if (usableHeight % tileHeight !== 0) {
			throw new Error('Usable sheet height is not divisible by tile height. Provide --rows to override.');
		}
		rows = usableHeight / tileHeight;
	}
	if (Number.isInteger(columns) === false) {
		throw new Error('Computed columns is not an integer. Adjust --tileWidth or provide --columns.');
	}
	if (Number.isInteger(rows) === false) {
		throw new Error('Computed rows is not an integer. Adjust --tileHeight or provide --rows.');
	}
	columns = Math.trunc(columns);
	rows = Math.trunc(rows);
	const requiredWidth = cli.offsetX + columns * tileWidth;
	if (requiredWidth > sheet.width) {
		throw new Error('Configured columns exceed sprite sheet width');
	}
	const requiredHeight = cli.offsetY + rows * tileHeight;
	if (requiredHeight > sheet.height) {
		throw new Error('Configured rows exceed sprite sheet height');
	}
	const glyphs = loadGlyphSpecs(cli.mapPath, cli.order);
	ensureUniqueSuffixes(glyphs);
	const totalTiles = columns * rows;
	if (cli.inspect) {
		dumpTilePreviews(sheet, columns, rows, tileWidth, tileHeight, cli.offsetX, cli.offsetY);
	}
	mkdirSync(outputDir, { recursive: true });
	for (let i = 0; i < glyphs.length; i += 1) {
		const spec = glyphs[i];
		if (spec.tile < 0 || spec.tile >= totalTiles) {
			throw new Error(`Glyph ${spec.suffix} references tile ${spec.tile} outside the sheet grid`);
		}
		const col = spec.tile % columns;
		const row = Math.trunc(spec.tile / columns);
		const x = cli.offsetX + col * tileWidth;
		const y = cli.offsetY + row * tileHeight;
		if (x + tileWidth > sheet.width || y + tileHeight > sheet.height) {
			throw new Error(`Glyph ${spec.suffix} exceeds sheet bounds at (${x}, ${y})`);
		}
		const glyph = cropGlyph(sheet, x, y, tileWidth, tileHeight);
		const filename = `Letter_${spec.suffix}.png`;
		const outPath = resolve(outputDir, filename);
		if (cli.overwrite === false && existsSync(outPath)) {
			throw new Error(`Output file already exists: ${outPath}`);
		}
		const buffer = PNG.sync.write(glyph);
		writeFileSync(outPath, buffer);
		console.log(`Wrote ${outPath}`);
	}
}

run();
