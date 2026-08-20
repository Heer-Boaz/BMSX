import type { RectBounds } from '../../machine/ts/common/rect';
import {
	aabbCollisionPiece,
	encodeCollisionShapeVariants,
	type AabbCollisionShapePiece,
} from '../../toolchain/ts/rompack/collision_shape_encode';

export type CompiledCollisionMapLayer = {
	name: string;
	buffer: Uint8Array;
};

type CollisionMapDocument = {
	tile_size: number;
	layers: Record<string, string>;
	rows: string[];
};

type CellRect = {
	left: number;
	top: number;
	right: number;
	bottom: number;
};

function assertCollisionMapDocument(source: unknown, sourcePath: string): asserts source is CollisionMapDocument {
	if (source === null || Array.isArray(source) || typeof source !== 'object') {
		throw new Error(`Collision map '${sourcePath}' must contain one mapping.`);
	}
	const document = source as CollisionMapDocument;
	if (!Number.isInteger(document.tile_size) || document.tile_size <= 0) {
		throw new Error(`Collision map '${sourcePath}' must define a positive integer tile_size.`);
	}
	if (document.layers === null || Array.isArray(document.layers) || typeof document.layers !== 'object') {
		throw new Error(`Collision map '${sourcePath}' must define collision layers.`);
	}
	if (!Array.isArray(document.rows) || document.rows.length === 0) {
		throw new Error(`Collision map '${sourcePath}' must define rows.`);
	}
	const width = document.rows[0].length;
	if (width === 0) {
		throw new Error(`Collision map '${sourcePath}' rows may not be empty.`);
	}
	for (let rowIndex = 0; rowIndex < document.rows.length; rowIndex += 1) {
		const row = document.rows[rowIndex];
		if (typeof row !== 'string' || row.length !== width) {
			throw new Error(`Collision map '${sourcePath}' row ${rowIndex + 1} must contain exactly ${width} symbols.`);
		}
	}
	const layerNames = Object.keys(document.layers);
	if (layerNames.length === 0) {
		throw new Error(`Collision map '${sourcePath}' must define at least one collision layer.`);
	}
	for (let index = 0; index < layerNames.length; index += 1) {
		const name = layerNames[index];
		const symbols = document.layers[name];
		if (!/^[a-z][a-z0-9_]*$/.test(name)) {
			throw new Error(`Collision map '${sourcePath}' layer '${name}' must use snake_case.`);
		}
		if (typeof symbols !== 'string' || symbols.length === 0) {
			throw new Error(`Collision map '${sourcePath}' layer '${name}' must name at least one symbol.`);
		}
	}
}

function collectLayerRects(rows: readonly string[], symbols: string): CellRect[] {
	const width = rows[0].length;
	const active = new Map<number, CellRect>();
	const completed: CellRect[] = [];
	for (let y = 0; y < rows.length; y += 1) {
		const row = rows[y];
		const next = new Map<number, CellRect>();
		let x = 0;
		while (x < width) {
			while (x < width && symbols.indexOf(row[x]) < 0) x += 1;
			const left = x;
			while (x < width && symbols.indexOf(row[x]) >= 0) x += 1;
			if (left === x) continue;
			const key = left * (width + 1) + x;
			const previous = active.get(key);
			if (previous === undefined) {
				next.set(key, { left, top: y, right: x, bottom: y + 1 });
			} else {
				previous.bottom = y + 1;
				next.set(key, previous);
			}
		}
		for (const [key, rect] of active) {
			if (!next.has(key)) completed.push(rect);
		}
		active.clear();
		for (const [key, rect] of next) active.set(key, rect);
	}
	for (const rect of active.values()) completed.push(rect);
	completed.sort((left, right) =>
		left.top - right.top
		|| left.left - right.left
		|| left.bottom - right.bottom
		|| left.right - right.right);
	return completed;
}

function pixelBounds(rect: CellRect, tileSize: number): RectBounds {
	return {
		left: rect.left * tileSize,
		top: rect.top * tileSize,
		right: rect.right * tileSize,
		bottom: rect.bottom * tileSize,
	};
}

function layerBounds(rects: readonly CellRect[], tileSize: number): RectBounds {
	const first = rects[0];
	let left = first.left;
	let top = first.top;
	let right = first.right;
	let bottom = first.bottom;
	for (let index = 1; index < rects.length; index += 1) {
		const rect = rects[index];
		if (rect.left < left) left = rect.left;
		if (rect.top < top) top = rect.top;
		if (rect.right > right) right = rect.right;
		if (rect.bottom > bottom) bottom = rect.bottom;
	}
	return pixelBounds({ left, top, right, bottom }, tileSize);
}

function flipBounds(bounds: RectBounds, width: number, height: number, flipH: boolean, flipV: boolean): RectBounds {
	return {
		left: flipH ? width - bounds.right : bounds.left,
		top: flipV ? height - bounds.bottom : bounds.top,
		right: flipH ? width - bounds.left : bounds.right,
		bottom: flipV ? height - bounds.top : bounds.bottom,
	};
}

function flipPieces(
	pieces: readonly AabbCollisionShapePiece[],
	width: number,
	height: number,
	flipH: boolean,
	flipV: boolean,
): AabbCollisionShapePiece[] {
	const result = new Array<AabbCollisionShapePiece>(pieces.length);
	for (let index = 0; index < pieces.length; index += 1) {
		result[index] = aabbCollisionPiece(flipBounds(pieces[index].bounds, width, height, flipH, flipV));
	}
	return result;
}

export function compileCollisionMap(source: unknown, sourcePath: string): CompiledCollisionMapLayer[] {
	assertCollisionMapDocument(source, sourcePath);
	const tileSize = source.tile_size;
	const width = source.rows[0].length * tileSize;
	const height = source.rows.length * tileSize;
	const layerNames = Object.keys(source.layers).sort((left, right) => left.localeCompare(right));
	const layers = new Array<CompiledCollisionMapLayer>(layerNames.length);
	for (let layerIndex = 0; layerIndex < layerNames.length; layerIndex += 1) {
		const name = layerNames[layerIndex];
		const rects = collectLayerRects(source.rows, source.layers[name]);
		if (rects.length === 0) {
			throw new Error(`Collision map '${sourcePath}' layer '${name}' contains no collision tiles.`);
		}
		const bounds = layerBounds(rects, tileSize);
		const pieces = new Array<AabbCollisionShapePiece>(rects.length);
		for (let index = 0; index < rects.length; index += 1) {
			pieces[index] = aabbCollisionPiece(pixelBounds(rects[index], tileSize));
		}
		layers[layerIndex] = {
			name,
			buffer: encodeCollisionShapeVariants({
				original: { bounds, pieces },
				fliph: {
					bounds: flipBounds(bounds, width, height, true, false),
					pieces: flipPieces(pieces, width, height, true, false),
				},
				flipv: {
					bounds: flipBounds(bounds, width, height, false, true),
					pieces: flipPieces(pieces, width, height, false, true),
				},
				fliphv: {
					bounds: flipBounds(bounds, width, height, true, true),
					pieces: flipPieces(pieces, width, height, true, true),
				},
			}),
		};
	}
	return layers;
}
