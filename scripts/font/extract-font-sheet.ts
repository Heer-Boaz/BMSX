import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { PNG } from 'pngjs';

type GlyphSpec = { suffix: string; code: number };

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
};

type RawArgs = { [key: string]: string };

type MapEntry = { suffix: string; code?: number; char?: string };

function buildDefaultGlyphs(): GlyphSpec[] {
	const list: GlyphSpec[] = [];
	for (let i = 0; i < 10; i += 1) {
		list.push({ suffix: String(i), code: 48 + i });
	}
	const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
	for (let i = 0; i < upper.length; i += 1) {
		list.push({ suffix: upper[i], code: upper.charCodeAt(i) });
	}
	list.push({ suffix: 'Apostroph', code: 39 });
	list.push({ suffix: 'Colon', code: 58 });
	list.push({ suffix: 'Comma', code: 44 });
	list.push({ suffix: 'Continue', code: 16 });
	list.push({ suffix: 'Dot', code: 46 });
	list.push({ suffix: 'Exclamation', code: 33 });
	const ijCodePoint = '\u00A1'.codePointAt(0);
	if (ijCodePoint === undefined) {
		throw new Error('Failed to resolve code point for IJ glyph');
	}
	list.push({ suffix: 'IJ', code: ijCodePoint });
	list.push({ suffix: 'Line', code: 196 });
	list.push({ suffix: 'Percent', code: 37 });
	list.push({ suffix: 'Question', code: 63 });
	list.push({ suffix: 'Slash', code: 47 });
	list.push({ suffix: 'Space', code: 32 });
	list.push({ suffix: 'SpeakEnd', code: 93 });
	list.push({ suffix: 'SpeakStart', code: 91 });
	list.push({ suffix: 'Streep', code: 45 });
	return list;
}

function parseCli(argv: string[]): CliConfig {
	const raw: RawArgs = {};
	let overwrite = false;
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
	};
}

function parseNumber(value: string, flagName: string): number {
	const parsed = Number.parseInt(value, 10);
	if (Number.isFinite(parsed) === false || parsed <= 0) {
		throw new Error(`Invalid value for ${flagName}: ${value}`);
	}
	return parsed;
}

function loadGlyphSpecs(mapPath: string | null): GlyphSpec[] {
	if (!mapPath) {
		return buildDefaultGlyphs();
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
		let code = 0;
		if (typeof entry.code === 'number') {
			code = entry.code;
		} else if (typeof entry.char === 'string') {
			if (entry.char.length === 0) {
				throw new Error(`Glyph map entry at index ${i} has an empty char value`);
			}
			const point = entry.char.codePointAt(0);
			if (point === undefined) {
				throw new Error(`Unable to derive code point for glyph ${entry.suffix}`);
			}
			code = point;
		} else {
			throw new Error(`Glyph map entry at index ${i} must provide either code or char`);
		}
		specs.push({ suffix: entry.suffix, code });
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
	const glyphs = loadGlyphSpecs(cli.mapPath);
	ensureUniqueSuffixes(glyphs);
	const totalTiles = columns * rows;
	mkdirSync(outputDir, { recursive: true });
	for (let i = 0; i < glyphs.length; i += 1) {
		const spec = glyphs[i];
		if (spec.code < 0 || spec.code >= totalTiles) {
			throw new Error(`Glyph ${spec.suffix} references code ${spec.code} outside the sheet grid`);
		}
		const col = spec.code % columns;
		const row = Math.trunc(spec.code / columns);
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
