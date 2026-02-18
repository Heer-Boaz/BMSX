#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { PNG } from 'pngjs';

const workspaceRoot = process.cwd();
const outputDir = path.join(workspaceRoot, 'src/carts/pietious/res/img');
const mogRoot = process.env.MOG_EMSCRIPTEN_ROOT ?? '/tmp/mog-emscripten-ref';
const xnaRoot = process.env.MAZE_OF_NICOLAAS_XNA_ROOT ?? '/tmp/Maze-of-Nicolaas-XNA-ref/Maze of Nicolaas XNA';
const xnaSourceRoots = [
	path.join(xnaRoot, 'Images'),
	path.join(xnaRoot, 'Maze of Nicolaas XNAContent'),
];

const atlasVarToFile = {
	tiles_bmp: 'tiles.pcx',
	tiles2_bmp: 'tiles2.pcx',
	enemy_bmp: 'enemy.pcx',
	enemy2_bmp: 'enemy2.pcx',
	menu_bmp: 'start.pcx',
	final_bmp: 'final.pcx',
	konami_bmp: 'konami.pcx',
};

const tileExprConsts = {
	TILE_SIZE_X: 16,
	TILE_SIZE_Y: 16,
	TILE_UNIT: 2,
};

const manualSourceOverrides = {
	Stairs1: { atlas: 'tiles.pcx', x: 0, y: 112, w: 16, h: 16 },
	Stairs2: { atlas: 'tiles.pcx', x: 16, y: 112, w: 16, h: 16 },
	Ammo: { atlas: 'tiles.pcx', x: 224, y: 64, w: 32, h: 32 },
	World_Key: { atlas: 'tiles.pcx', x: 448, y: 64, w: 32, h: 32 },
	// In C++ this is the world-door sprite; crop matches 32x23 output shape.
	World_Entrance: { atlas: 'tiles.pcx', x: 32, y: 65, w: 64, h: 47 },
	// World/castle transition tiles are unstable under template matching, so map them directly
	// to the original C++ tile indices from gametiles.cpp.
	WorldTiles1: { atlas: 'tiles.pcx', x: 528, y: 0, w: 16, h: 16 }, // idx 125
	WorldTiles2: { atlas: 'tiles.pcx', x: 528, y: 16, w: 16, h: 16 }, // idx 126
	WorldTiles3: { atlas: 'tiles.pcx', x: 0, y: 0, w: 16, h: 16 }, // idx 0
	WorldTiles4: { atlas: 'tiles.pcx', x: 16, y: 0, w: 16, h: 16 }, // idx 1
	WorldTiles5: { atlas: 'tiles.pcx', x: 32, y: 0, w: 16, h: 16 }, // idx 2
	WorldTiles6: { atlas: 'tiles.pcx', x: 48, y: 0, w: 16, h: 16 }, // idx 3
	WorldTiles7: { atlas: 'tiles.pcx', x: 528, y: 0, w: 16, h: 16 }, // idx 125
	WorldTiles8: { atlas: 'tiles.pcx', x: 528, y: 16, w: 16, h: 16 }, // idx 126
	BackTiles1: { atlas: 'tiles.pcx', x: 544, y: 0, w: 16, h: 16 }, // idx 127
	BackTiles2: { atlas: 'tiles.pcx', x: 560, y: 0, w: 16, h: 16 }, // idx 128
	BackTiles3: { atlas: 'tiles.pcx', x: 544, y: 16, w: 16, h: 16 }, // idx 129
	BackTiles4: { atlas: 'tiles.pcx', x: 560, y: 16, w: 16, h: 16 }, // idx 130
	BackTiles5: { atlas: 'tiles.pcx', x: 576, y: 0, w: 16, h: 16 }, // idx 131
	BackTiles6: { atlas: 'tiles.pcx', x: 592, y: 0, w: 16, h: 16 }, // idx 132
	BackTiles7: { atlas: 'tiles.pcx', x: 576, y: 16, w: 16, h: 16 }, // idx 133
	BackTiles8: { atlas: 'tiles.pcx', x: 592, y: 16, w: 16, h: 16 }, // idx 134
	WorldTiles9: { atlas: 'tiles.pcx', x: 608, y: 0, w: 16, h: 16 }, // idx 135
	WorldTiles10: { atlas: 'tiles.pcx', x: 624, y: 0, w: 16, h: 16 }, // idx 136
	WorldTiles11: { atlas: 'tiles.pcx', x: 608, y: 16, w: 16, h: 16 }, // idx 137
	WorldTiles12: { atlas: 'tiles.pcx', x: 624, y: 16, w: 16, h: 16 }, // idx 138
	WorldTiles13: { atlas: 'tiles.pcx', x: 608, y: 32, w: 16, h: 16 }, // idx 139
	WorldTiles14: { atlas: 'tiles.pcx', x: 624, y: 32, w: 16, h: 16 }, // idx 140
	WorldTiles39: { atlas: 'tiles.pcx', x: 144, y: 48, w: 16, h: 16 }, // idx 143
};

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

function decodeBmp(filePath) {
	const bytes = fs.readFileSync(filePath);
	assert(bytes.length >= 54, `BMP too small: ${filePath}`);
	assert(bytes.toString('ascii', 0, 2) === 'BM', `Not a BMP file: ${filePath}`);

	const pixelOffset = bytes.readUInt32LE(10);
	const dibHeaderSize = bytes.readUInt32LE(14);
	const widthSigned = bytes.readInt32LE(18);
	const heightSigned = bytes.readInt32LE(22);
	const planes = bytes.readUInt16LE(26);
	const bitsPerPixel = bytes.readUInt16LE(28);
	const compression = bytes.readUInt32LE(30);
	const colorsUsed = bytes.readUInt32LE(46);

	assert(planes === 1, `Unexpected BMP planes=${planes}: ${filePath}`);
	assert(compression === 0, `Unsupported BMP compression=${compression}: ${filePath}`);

	const width = Math.abs(widthSigned);
	const height = Math.abs(heightSigned);
	const isTopDown = heightSigned < 0;
	const rowStrideBytes = Math.floor((bitsPerPixel * width + 31) / 32) * 4;

	let palette = null;
	if (bitsPerPixel <= 8) {
		const paletteSize = colorsUsed || (1 << bitsPerPixel);
		const paletteOffset = 14 + dibHeaderSize;
		palette = new Array(paletteSize);
		for (let i = 0; i < paletteSize; i += 1) {
			const p = paletteOffset + i * 4;
			palette[i] = { r: bytes[p + 2], g: bytes[p + 1], b: bytes[p], a: 255 };
		}
	}

	const data = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y += 1) {
		const srcY = isTopDown ? y : height - 1 - y;
		const rowStart = pixelOffset + srcY * rowStrideBytes;
		for (let x = 0; x < width; x += 1) {
			let r = 0;
			let g = 0;
			let b = 0;
			let a = 255;

			if (bitsPerPixel === 24) {
				const p = rowStart + x * 3;
				b = bytes[p];
				g = bytes[p + 1];
				r = bytes[p + 2];
			} else if (bitsPerPixel === 32) {
				const p = rowStart + x * 4;
				b = bytes[p];
				g = bytes[p + 1];
				r = bytes[p + 2];
				a = bytes[p + 3];
			} else if (bitsPerPixel === 8) {
				const color = palette[bytes[rowStart + x]];
				r = color.r;
				g = color.g;
				b = color.b;
				a = color.a;
			} else if (bitsPerPixel === 4) {
				const packed = bytes[rowStart + Math.floor(x / 2)];
				const idx = x % 2 === 0 ? packed >> 4 : packed & 0x0f;
				const color = palette[idx];
				r = color.r;
				g = color.g;
				b = color.b;
				a = color.a;
			} else if (bitsPerPixel === 1) {
				const packed = bytes[rowStart + Math.floor(x / 8)];
				const shift = 7 - (x % 8);
				const idx = (packed >> shift) & 1;
				const color = palette[idx];
				r = color.r;
				g = color.g;
				b = color.b;
				a = color.a;
			} else {
				throw new Error(`Unsupported BMP bpp=${bitsPerPixel}: ${filePath}`);
			}

			const i = (y * width + x) * 4;
			data[i] = r;
			data[i + 1] = g;
			data[i + 2] = b;
			data[i + 3] = a;
		}
	}

	return { width, height, data };
}

function decodePcx(filePath) {
	const bytes = fs.readFileSync(filePath);
	assert(bytes.length >= 128 + 769, `PCX too small: ${filePath}`);
	assert(bytes[0] === 10 && bytes[1] === 5 && bytes[2] === 1 && bytes[3] === 8, `Unsupported PCX header: ${filePath}`);

	const width = bytes.readUInt16LE(8) - bytes.readUInt16LE(4) + 1;
	const height = bytes.readUInt16LE(10) - bytes.readUInt16LE(6) + 1;
	const bytesPerLine = bytes.readUInt16LE(66);

	const indices = new Uint8Array(width * height);
	let src = 128;
	let dst = 0;
	for (let y = 0; y < height; y += 1) {
		let x = 0;
		while (x < bytesPerLine) {
			const value = bytes[src++];
			if ((value & 0xc0) === 0xc0) {
				const count = value & 0x3f;
				const runValue = bytes[src++];
				for (let i = 0; i < count; i += 1) {
					if (x < width) {
						indices[dst++] = runValue;
					}
					x += 1;
				}
			} else {
				if (x < width) {
					indices[dst++] = value;
				}
				x += 1;
			}
		}
	}

	assert(bytes[bytes.length - 769] === 12, `PCX palette marker missing: ${filePath}`);
	const paletteStart = bytes.length - 768;

	const data = new Uint8Array(width * height * 4);
	for (let i = 0; i < indices.length; i += 1) {
		const paletteIndex = indices[i];
		const p = paletteStart + paletteIndex * 3;
		data[i * 4] = bytes[p];
		data[i * 4 + 1] = bytes[p + 1];
		data[i * 4 + 2] = bytes[p + 2];
		data[i * 4 + 3] = paletteIndex === 0 ? 0 : 255;
	}

	return { width, height, data };
}

function writePng(filePath, image) {
	const png = new PNG({ width: image.width, height: image.height });
	png.data = Buffer.from(image.data);
	fs.writeFileSync(filePath, PNG.sync.write(png));
}

function cropImage(image, crop) {
	if (!crop) {
		return image;
	}
	const out = new Uint8Array(crop.w * crop.h * 4);
	for (let y = 0; y < crop.h; y += 1) {
		for (let x = 0; x < crop.w; x += 1) {
			const srcIndex = ((crop.y + y) * image.width + (crop.x + x)) * 4;
			const dstIndex = (y * crop.w + x) * 4;
			out[dstIndex] = image.data[srcIndex];
			out[dstIndex + 1] = image.data[srcIndex + 1];
			out[dstIndex + 2] = image.data[srcIndex + 2];
			out[dstIndex + 3] = image.data[srcIndex + 3];
		}
	}
	return { width: crop.w, height: crop.h, data: out };
}

function scaleSample(source, candidate, outW, outH) {
	const out = new Uint8Array(outW * outH * 4);
	for (let y = 0; y < outH; y += 1) {
		for (let x = 0; x < outW; x += 1) {
			const srcX = Math.min(candidate.w - 1, Math.max(0, Math.floor(((x + 0.5) * candidate.w) / outW)));
			const srcY = Math.min(candidate.h - 1, Math.max(0, Math.floor(((y + 0.5) * candidate.h) / outH)));
			const srcIndex = ((candidate.y + srcY) * source.width + (candidate.x + srcX)) * 4;
			const dstIndex = (y * outW + x) * 4;
			out[dstIndex] = source.data[srcIndex];
			out[dstIndex + 1] = source.data[srcIndex + 1];
			out[dstIndex + 2] = source.data[srcIndex + 2];
			out[dstIndex + 3] = source.data[srcIndex + 3];
		}
	}
	return out;
}

function colorScore(template, candidateData) {
	let total = 0;
	let count = 0;
	for (let i = 0; i < template.data.length; i += 4) {
		const tr = template.data[i];
		const tg = template.data[i + 1];
		const tb = template.data[i + 2];
		const ta = template.data[i + 3];
		const templateTransparent = ta === 0 || (tr === 255 && tg === 0 && tb === 255);

		const candidateOpaque = candidateData[i + 3] > 0;
		if (templateTransparent && !candidateOpaque) {
			continue;
		}
		if (templateTransparent && candidateOpaque) {
			total += 540;
			count += 3;
			continue;
		}
		if (!templateTransparent && !candidateOpaque) {
			total += 765;
			count += 3;
			continue;
		}
		total += Math.abs(tr - candidateData[i]);
		total += Math.abs(tg - candidateData[i + 1]);
		total += Math.abs(tb - candidateData[i + 2]);
		count += 3;
	}
	return count > 0 ? total / count : 1e9;
}

function measureMsx1Screen2Violations(image) {
	let segmentViolations = 0;
	let maxColorsInSegment = 0;

	for (let y = 0; y < image.height; y += 1) {
		for (let x0 = 0; x0 < image.width; x0 += 8) {
			const colors = new Set();
			for (let x = x0; x < x0 + 8 && x < image.width; x += 1) {
				const index = (y * image.width + x) * 4;
				if (image.data[index + 3] === 0) {
					continue;
				}
				colors.add(`${image.data[index]},${image.data[index + 1]},${image.data[index + 2]}`);
			}

			const colorCount = colors.size;
			if (colorCount > maxColorsInSegment) {
				maxColorsInSegment = colorCount;
			}
			if (colorCount > 2) {
				segmentViolations += 1;
			}
		}
	}

	return {
		segmentViolations,
		maxColorsInSegment,
	};
}

function evalExpr(expr) {
	return Function('C', `with(C){return (${expr});}`)(tileExprConsts);
}

function parseGametilesCandidates() {
	const text = fs.readFileSync(path.join(mogRoot, 'sources/gametiles.cpp'), 'utf8');
	const lines = text.split('\n');
	const base = [];
	let tileIndex = 0;

	for (let i = 0; i < lines.length; i += 1) {
		const line = lines[i].trim();
		const match = line.match(/new\s+CTile\(([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,\)]+),/);
		if (!match) {
			continue;
		}
		const atlas = atlasVarToFile[match[1].trim()];
		if (!atlas) {
			tileIndex += 1;
			continue;
		}
		const candidate = {
			index: tileIndex,
			atlas,
			x: evalExpr(match[2]),
			y: evalExpr(match[3]),
			w: evalExpr(match[4]),
			h: evalExpr(match[5]),
			kind: 'full',
		};
		base.push(candidate);
		tileIndex += 1;
	}

	const candidates = [];
	const seen = new Set();
	const add = (candidate) => {
		const key = `${candidate.atlas}:${candidate.x}:${candidate.y}:${candidate.w}:${candidate.h}`;
		if (seen.has(key)) {
			return;
		}
		seen.add(key);
		candidates.push(candidate);
	};

	for (let i = 0; i < base.length; i += 1) {
		const tile = base[i];
		add(tile);

		if (tile.w % 2 === 0 && tile.w >= 16) {
			add({ ...tile, w: tile.w / 2, kind: 'left' });
			add({ ...tile, x: tile.x + tile.w / 2, w: tile.w / 2, kind: 'right' });
		}
		if (tile.h % 2 === 0 && tile.h >= 16) {
			add({ ...tile, h: tile.h / 2, kind: 'top' });
			add({ ...tile, y: tile.y + tile.h / 2, h: tile.h / 2, kind: 'bottom' });
		}
		if (tile.w % 2 === 0 && tile.h % 2 === 0 && tile.w >= 16 && tile.h >= 16) {
			add({ ...tile, w: tile.w / 2, h: tile.h / 2, kind: 'q1' });
			add({ ...tile, x: tile.x + tile.w / 2, w: tile.w / 2, h: tile.h / 2, kind: 'q2' });
			add({ ...tile, y: tile.y + tile.h / 2, w: tile.w / 2, h: tile.h / 2, kind: 'q3' });
			add({ ...tile, x: tile.x + tile.w / 2, y: tile.y + tile.h / 2, w: tile.w / 2, h: tile.h / 2, kind: 'q4' });
		}
	}

	return candidates;
}

function parseLegacyMappings() {
	const scriptPath = path.join(workspaceRoot, 'scripts/pietious/rebuild_pietious_xna_pngs.mjs');
	const text = fs.readFileSync(scriptPath, 'utf8');
	const begin = text.indexOf('function createMappings()');
	const end = text.indexOf('function ensureAllOutputsCovered');
	assert(begin >= 0 && end > begin, 'Could not locate createMappings() in legacy script.');

	const context = {
		assert,
	};
	vm.createContext(context);
	vm.runInContext(text.slice(begin, end), context);
	const mappings = context.createMappings();
	assert(typeof mappings?.entries === 'function', 'Legacy createMappings() did not return a Map-like object.');
	return mappings;
}

function loadSourceTemplates(sourceNames) {
	const templates = new Map();
	for (let i = 0; i < sourceNames.length; i += 1) {
		const name = sourceNames[i];
		let filePath = null;
		for (let j = 0; j < xnaSourceRoots.length; j += 1) {
			const candidatePath = path.join(xnaSourceRoots[j], `${name}.bmp`);
			if (fs.existsSync(candidatePath)) {
				filePath = candidatePath;
				break;
			}
		}
		if (filePath == null) {
			continue;
		}
		templates.set(name, decodeBmp(filePath));
	}
	return templates;
}

function shouldForceAccept(sourceName) {
	return (
		sourceName.startsWith('BackTiles') ||
		/^WorldTiles\d+$/.test(sourceName) ||
		sourceName === 'Stairs1' ||
		sourceName === 'Stairs2' ||
		sourceName === 'Stone' ||
		sourceName === 'Stone_Broken' ||
		sourceName === 'Ammo' ||
		sourceName === 'World_Key' ||
		sourceName === 'Elevator'
	);
}

function resolveSourceMatches(sourceNames, templates, candidates, atlases) {
	const resolved = new Map();
	const unresolved = [];

	for (let i = 0; i < sourceNames.length; i += 1) {
		const sourceName = sourceNames[i];
		const override = manualSourceOverrides[sourceName];
		if (override) {
			resolved.set(sourceName, {
				candidate: override,
				score: 0,
				reason: 'manual_override',
			});
			continue;
		}

		const template = templates.get(sourceName);
		if (template == null) {
			unresolved.push({ sourceName, reason: 'missing_xna_template' });
			continue;
		}

		const aspect = template.width / template.height;
		let best = { score: 1e9, candidate: null };
		let second = { score: 1e9, candidate: null };

		for (let k = 0; k < candidates.length; k += 1) {
			const candidate = candidates[k];
			if (
				candidate.w > template.width * 8 ||
				candidate.h > template.height * 8 ||
				candidate.w < Math.max(1, Math.floor(template.width / 4)) ||
				candidate.h < Math.max(1, Math.floor(template.height / 4))
			) {
				continue;
			}
			const candidateAspect = candidate.w / candidate.h;
			if (candidateAspect < aspect * 0.4 || candidateAspect > aspect * 2.5) {
				continue;
			}

			const atlas = atlases[candidate.atlas];
			const sampled = scaleSample(atlas, candidate, template.width, template.height);
			const score = colorScore(template, sampled);

			if (score < best.score) {
				second = best;
				best = { score, candidate };
			} else if (score < second.score) {
				second = { score, candidate };
			}
		}

		if (best.candidate == null) {
			unresolved.push({ sourceName, reason: 'no_candidate' });
			continue;
		}

		const forceAccept = shouldForceAccept(sourceName);
		const accepted =
			forceAccept ||
			best.score <= 18 ||
			(best.score <= 25 && second.score - best.score >= 4);

		if (accepted) {
			resolved.set(sourceName, {
				candidate: best.candidate,
				score: best.score,
				reason: forceAccept ? 'forced_pattern' : 'score_match',
			});
		} else {
			unresolved.push({
				sourceName,
				reason: 'low_confidence',
				bestScore: best.score,
				secondScore: second.score,
				bestCandidate: best.candidate,
			});
		}
	}

	return { resolved, unresolved };
}

function main() {
	assert(fs.existsSync(outputDir), `Output directory not found: ${outputDir}`);
	assert(fs.existsSync(path.join(mogRoot, 'sources/gametiles.cpp')), `mog-emscripten sources not found: ${mogRoot}`);
	assert(fs.existsSync(xnaRoot), `XNA reference root not found: ${xnaRoot}`);

	const mappings = parseLegacyMappings();
	const sourceNames = [...new Set([...mappings.values()].map((m) => m.sourceName))].sort();
	const templates = loadSourceTemplates(sourceNames);
	const candidates = parseGametilesCandidates();

	const atlases = {};
	const atlasFiles = new Set(Object.values(atlasVarToFile));
	for (const atlasName of atlasFiles) {
		atlases[atlasName] = decodePcx(path.join(mogRoot, 'graphics/original', atlasName));
	}

	const { resolved, unresolved } = resolveSourceMatches(sourceNames, templates, candidates, atlases);

	let written = 0;
	const unresolvedOutputs = [];
	const msx1ViolationOutputs = [];
	for (const [outputName, mapping] of mappings.entries()) {
		const resolution = resolved.get(mapping.sourceName);
		if (resolution == null) {
			unresolvedOutputs.push({ outputName, sourceName: mapping.sourceName });
			continue;
		}

		const template = templates.get(mapping.sourceName);
		assert(template != null, `Template missing after resolution for source '${mapping.sourceName}'.`);

		const atlas = atlases[resolution.candidate.atlas];
		const sampledData = scaleSample(
			atlas,
			resolution.candidate,
			template.width,
			template.height,
		);
		let image = { width: template.width, height: template.height, data: sampledData };
		image = cropImage(image, mapping.crop);
		const msx1 = measureMsx1Screen2Violations(image);
		if (msx1.segmentViolations > 0) {
			msx1ViolationOutputs.push({
				outputName,
				sourceName: mapping.sourceName,
				segmentViolations: msx1.segmentViolations,
				maxColorsInSegment: msx1.maxColorsInSegment,
				atlas: resolution.candidate.atlas,
				x: resolution.candidate.x,
				y: resolution.candidate.y,
				w: resolution.candidate.w,
				h: resolution.candidate.h,
			});
		}

		const outputPath = path.join(outputDir, `${outputName}.png`);
		writePng(outputPath, image);
		written += 1;
	}

	const unresolvedSourceNames = new Set(unresolved.map((u) => u.sourceName));
	for (let i = 0; i < unresolvedOutputs.length; i += 1) {
		unresolvedSourceNames.add(unresolvedOutputs[i].sourceName);
	}

	console.log(`[mog-original] total mappings: ${mappings.size}`);
	console.log(`[mog-original] source names: ${sourceNames.length}`);
	console.log(`[mog-original] resolved source names: ${resolved.size}`);
	console.log(`[mog-original] unresolved source names: ${unresolvedSourceNames.size}`);
	console.log(`[mog-original] written outputs: ${written}`);
	console.log(`[mog-original] unresolved outputs kept as-is: ${unresolvedOutputs.length}`);
	console.log(`[mog-original] outputs with >2 colors in an 8x1 segment: ${msx1ViolationOutputs.length}`);

	if (unresolvedSourceNames.size > 0) {
		const list = [...unresolvedSourceNames].sort();
		console.log('[mog-original] unresolved source names:');
		for (let i = 0; i < list.length; i += 1) {
			console.log(`  - ${list[i]}`);
		}
	}

	if (msx1ViolationOutputs.length > 0) {
		msx1ViolationOutputs.sort((left, right) => right.segmentViolations - left.segmentViolations);
		console.log('[mog-original] msx1-screen2 violations (top 25):');
		for (let i = 0; i < msx1ViolationOutputs.length && i < 25; i += 1) {
			const item = msx1ViolationOutputs[i];
			console.log(
				`  - ${item.outputName} <- ${item.sourceName} (${item.atlas}:${item.x},${item.y},${item.w},${item.h}) segments=${item.segmentViolations} max_colors=${item.maxColorsInSegment}`,
			);
		}
	}
}

main();
