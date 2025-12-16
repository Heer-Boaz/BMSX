import type { Canvas, CanvasRenderingContext2D } from 'canvas';
import type { AtlasTexcoords, ImageResource } from './rompacker.rompack';
import { resolve as resolvePath, sep as pathSep } from 'path';
import { commonResPath, ENGINE_ATLAS_INDEX } from './rompacker';
// @ts-ignore
const { createCanvas } = require('canvas');

const ATLAS_MAX_SIZE_IN_PIXELS = 2048;
const CROP_ATLAS = true;

// Reserve and extrude a border around each image in the atlas.
// This prevents gaps/bleeding when sampling the atlas (especially with subpixel
// screen placement / scaling) while keeping the UVs mapped to the full image
// area (no shrink/stretch of small sprites like glyphs).
const ATLAS_IMAGE_PADDING = 1;

export type Rect = { width: number; height: number; id: number; };
export type Bin = { x: number; y: number; width: number; height: number; };

export function generateAtlasName(atlasIndex: number): string {
	const idxStr = atlasIndex.toString().padStart(2, '0');
	return atlasIndex === 0 ? '_atlas' : `_atlas_${idxStr}`;
}

export function atlasIndexResolver(filepath: string, current?: number) {
	const abs = resolvePath(filepath);
	const engineResourceRoots = new Set(
		[commonResPath]
			.filter(Boolean)
			.map((p: string) => resolvePath(p))
	);

	for (const base of engineResourceRoots) {
		if (abs === base || abs.startsWith(base + pathSep)) {
			return ENGINE_ATLAS_INDEX;
		}
	}
	return current ?? 0;
};

/**
 * Splits a free rectangle into smaller rectangles based on the position and size of a used rectangle
 * @param freeRect The free rectangle to split.
 * @param usedRect The used rectangle to use as a reference for splitting the free rectangle.
 * @returns An array of new free rectangles created by splitting the original free rectangle, or null when the rectangles do not overlap.
 */
function splitFreeRectangle(freeRect: Bin, usedRect: Bin): Bin[] {
	const overlapMinX = Math.max(freeRect.x, usedRect.x);
	const overlapMinY = Math.max(freeRect.y, usedRect.y);
	const overlapMaxX = Math.min(freeRect.x + freeRect.width, usedRect.x + usedRect.width);
	const overlapMaxY = Math.min(freeRect.y + freeRect.height, usedRect.y + usedRect.height);

	// If there is no intersection between the rectangles, keep the original free rectangle.
	if (overlapMinX >= overlapMaxX || overlapMinY >= overlapMaxY) {
		return null;
	}

	const newFreeRects: Bin[] = [];

	// Region above the placed rectangle
	if (overlapMinY > freeRect.y) {
		newFreeRects.push({
			x: freeRect.x,
			y: freeRect.y,
			width: freeRect.width,
			height: overlapMinY - freeRect.y,
		});
	}

	// Region below the placed rectangle
	if (overlapMaxY < freeRect.y + freeRect.height) {
		newFreeRects.push({
			x: freeRect.x,
			y: overlapMaxY,
			width: freeRect.width,
			height: (freeRect.y + freeRect.height) - overlapMaxY,
		});
	}

	const verticalSpan = overlapMaxY - overlapMinY;

	// Region to the left of the placed rectangle, aligned to the intersection band
	if (overlapMinX > freeRect.x && verticalSpan > 0) {
		newFreeRects.push({
			x: freeRect.x,
			y: overlapMinY,
			width: overlapMinX - freeRect.x,
			height: verticalSpan,
		});
	}

	// Region to the right of the placed rectangle, aligned to the intersection band
	if (overlapMaxX < freeRect.x + freeRect.width && verticalSpan > 0) {
		newFreeRects.push({
			x: overlapMaxX,
			y: overlapMinY,
			width: (freeRect.x + freeRect.width) - overlapMaxX,
			height: verticalSpan,
		});
	}

	return newFreeRects.filter(rect => rect.width > 0 && rect.height > 0);
}

/**
 * Prunes the free rectangles array by removing any rectangles that are fully contained within a new rectangle, and adding the new rectangle if it is not fully contained within any existing free rectangle.
 * @param newFreeRectangles An array of new free rectangles to add to the free rectangles array.
 * @param freeRectangles The current array of free rectangles.
 */
function pruneFreeRectangles(newFreeRectangles: Bin[], freeRectangles: Bin[]): void {
	newFreeRectangles.forEach((newRect) => {
		let addNewRect = true;

		// Remove any free rectangles that are fully contained within the new rectangle
		freeRectangles.forEach((freeRect, index) => {
			if (isContained(newRect, freeRect)) {
				addNewRect = false;
			} else if (isContained(freeRect, newRect)) {
				freeRectangles.splice(index, 1);
			}
		});

		if (addNewRect) {
			freeRectangles.push(newRect);
		}
	});
}

/**
 * Checks if a rectangle is fully contained within another rectangle.
 * @param rect1 The first rectangle to check.
 * @param rect2 The second rectangle to check.
 * @returns True if rect1 is fully contained within rect2, false otherwise.
 */
function isContained(rect1: Bin, rect2: Bin): boolean {
	return rect1.x >= rect2.x && rect1.y >= rect2.y &&
		rect1.x + rect1.width <= rect2.x + rect2.width &&
		rect1.y + rect1.height <= rect2.y + rect2.height;
}

/**
 * Packs an array of rectangles into a texture atlas using the maximal rectangles algorithm.
 * @param rects An array of rectangles to pack into the texture atlas.
 * @param binWidth The maximum width of the texture atlas.
 * @param binHeight The maximum height of the texture atlas.
 * @returns An object containing the packed rectangles, their positions in the texture atlas, and the dimensions of the texture atlas.
 */
function maximalRectanglesPacker(rects: Rect[], binWidth: number, binHeight: number): { items: { item: Rect, x: number, y: number; }[], width: number, height: number; } {
	// Sort the rectangles by area in descending order
	const sortedRects = rects.slice().sort((a, b) => b.width * b.height - a.width * a.height);

	// Initialize the used bins array
	const usedBins: { item: Rect, x: number, y: number; }[] = [];

	// Initialize the available free rectangles array
	const freeRectangles: Bin[] = [{ x: 0, y: 0, width: binWidth, height: binHeight }];

	// Helper function to find the best placement for a rectangle
	function findBestPlacement(rect: Rect): { bin: Bin, score: number; } {
		let bestBin: Bin = null;
		let bestScore = Number.MAX_VALUE;

		for (const freeRect of freeRectangles) {
			if (rect.width <= freeRect.width && rect.height <= freeRect.height) {
				const score = freeRect.width * freeRect.height - rect.width * rect.height;

				if (score < bestScore) {
					bestScore = score;
					bestBin = {
						x: freeRect.x,
						y: freeRect.y,
						width: rect.width,
						height: rect.height,
					};
				}
			}
		}

		return bestBin ? { bin: bestBin, score: bestScore } : null;
	}

	// Pack all rectangles
	for (const rect of sortedRects) {
		const bestPlacement = findBestPlacement(rect);

		if (bestPlacement) {
			usedBins.push({ item: rect, x: bestPlacement.bin.x, y: bestPlacement.bin.y });

			const newFreeRectangles: Bin[] = [];
			for (const freeRect of freeRectangles) {
				const splitRects = splitFreeRectangle(freeRect, bestPlacement.bin);
				if (splitRects) {
					newFreeRectangles.push(...splitRects);
				} else {
					newFreeRectangles.push(freeRect);
				}
			}
			freeRectangles.length = 0;
			pruneFreeRectangles(newFreeRectangles, freeRectangles);
		}
	}

	// Return the packed bins and the dimensions of the texture atlas
	const items = usedBins.map(({ item, x, y }) => ({ item, x, y }));
	const width = usedBins.reduce((maxWidth, { item, x }) => Math.max(maxWidth, x + item.width), 0);
	const height = usedBins.reduce((maxHeight, { item, y }) => Math.max(maxHeight, y + item.height), 0);

	return { items: items, width: width, height: height };
}

/**
 * Represents a shelf in the shelf bin packing algorithm.
 */
type Shelf = {
	x: number;
	y: number;
	width: number;
	height: number;
};

/**
 * Packs an array of rectangles into a texture atlas using the shelf bin packing algorithm.
 * @param rects An array of rectangles to pack into the texture atlas.
 * @param binWidth The maximum width of the texture atlas.
 * @param binHeight The maximum height of the texture atlas.
 * @returns An object containing the packed rectangles, their positions in the texture atlas, and the dimensions of the texture atlas.
 */
function shelfBinPacker(rects: Rect[], binWidth: number, binHeight: number): { items: { item: Rect, x: number, y: number; }[], width: number, height: number; } {
	// Sort the rectangles by height in descending order
	const sortedRects = rects.slice().sort((a, b) => b.height - a.height);

	// Initialize the used bins array
	const usedBins: { item: Rect, x: number, y: number; }[] = [];

	// Initialize the current shelf
	let currentShelf: Shelf = { x: 0, y: 0, width: binWidth, height: sortedRects[0].height };

	// Pack all rectangles
	for (const rect of sortedRects) {
		// Check if the rectangle fits into the current shelf
		if (currentShelf.width >= rect.width) {
			// Add the rectangle to the current shelf
			usedBins.push({ item: rect, x: currentShelf.x, y: currentShelf.y });
			currentShelf.x += rect.width;
			currentShelf.width -= rect.width;
		} else {
			// Create a new shelf for the rectangle
			currentShelf = {
				x: 0,
				y: currentShelf.y + currentShelf.height,
				width: binWidth - rect.width,
				height: rect.height,
			};

			if (currentShelf.y + currentShelf.height > binHeight) {
				throw new Error("The rectangles do not fit into the given bin dimensions.");
			}

			// Add the rectangle to the new shelf
			usedBins.push({ item: rect, x: currentShelf.x, y: currentShelf.y });
			currentShelf.x += rect.width;
		}
	}

	// Return the packed bins and the dimensions of the texture atlas
	const items = usedBins.map(({ item, x, y }) => ({ item, x, y }));
	const width = usedBins.reduce((maxWidth, { item, x }) => Math.max(maxWidth, x + item.width), 0);
	const height = usedBins.reduce((maxHeight, { item, y }) => Math.max(maxHeight, y + item.height), 0);

	return { items: items, width: width, height: height };
}

/**
 * Represents a node in a binary tree used by the maximal rectangles algorithm.
 */
type Node = {
	x: number;
	y: number;
	width: number;
	height: number;
};

/**
 * Packs an array of rectangles into a texture atlas using the texture-packing with rotation and flipping algorithm.
 * @param rects An array of rectangles to pack into the texture atlas.
 * @param binWidth The maximum width of the texture atlas.
 * @param binHeight The maximum height of the texture atlas.
 * @returns An object containing the packed rectangles, their positions in the texture atlas, and the dimensions of the texture atlas.
 */
function tprfPacker(rects: Rect[], binWidth: number, binHeight: number): { items: { item: Rect, x: number, y: number; }[], width: number, height: number; } {
	// Sort the rectangles by area in descending order
	const sortedRects = rects.slice().sort((a, b) => b.width * b.height - a.width * a.height);

	// Initialize the used bins array
	const usedBins: { item: Rect, x: number, y: number; }[] = [];

	// Initialize the initial free node
	const initialNode: Node = { x: 0, y: 0, width: binWidth, height: binHeight };

	// Initialize the free nodes list
	const freeNodes: Node[] = [initialNode];

	function sanitizeFreeNodes(): void {
		for (let i = freeNodes.length - 1; i >= 0; --i) {
			const node = freeNodes[i];
			if (node.width <= 0 || node.height <= 0) {
				freeNodes.splice(i, 1);
				continue;
			}
			for (let j = 0; j < freeNodes.length; ++j) {
				if (i === j) continue;
				if (isContained(freeNodes[i] as unknown as Bin, freeNodes[j] as unknown as Bin)) {
					freeNodes.splice(i, 1);
					break;
				}
			}
		}
	}

	// Calculate the touching perimeter of a rectangle placed at a node
	function touchingPerimeter(rect: Rect, node: Node): number {
		let perimeter = 0;

		if (node.x === 0 || node.x + rect.width === binWidth) {
			perimeter += rect.height;
		}

		if (node.y === 0 || node.y + rect.height === binHeight) {
			perimeter += rect.width;
		}

		for (const usedBin of usedBins) {
			if (usedBin.y + usedBin.item.height === node.y) {
				const widthIntersection = Math.max(0, Math.min(node.x + rect.width, usedBin.x + usedBin.item.width) - Math.max(node.x, usedBin.x));
				perimeter += widthIntersection;
			}

			if (usedBin.x + usedBin.item.width === node.x) {
				const heightIntersection = Math.max(0, Math.min(node.y + rect.height, usedBin.y + usedBin.item.height) - Math.max(node.y, usedBin.y));
				perimeter += heightIntersection;
			}
		}

		return perimeter;
	}

	// Check if a rectangle can fit into a node without overlaps
	function canFit(rect: Rect, node: Node): boolean {
		return rect.width <= node.width && rect.height <= node.height;
	}

	// Pack all rectangles
	for (const rect of sortedRects) {
		let bestNode: Node = null;
		let bestPerimeter = Number.MAX_VALUE;

		// Find the best node to place the rectangle
		for (const freeNode of freeNodes) {
			if (canFit(rect, freeNode)) {
				const perimeter = touchingPerimeter(rect, freeNode);

				if (perimeter < bestPerimeter) {
					bestNode = freeNode;
					bestPerimeter = perimeter;
				}
			}
		}

		if (!bestNode) {
			throw new Error("The rectangles do not fit into the given bin dimensions.");
		}

		// Add the rectangle to the best node
		usedBins.push({ item: rect, x: bestNode.x, y: bestNode.y });

		// Update the free nodes list
		const rightNodeWidth = bestNode.width - rect.width;
		if (rightNodeWidth > 0) {
			freeNodes.push({
				x: bestNode.x + rect.width,
				y: bestNode.y,
				width: rightNodeWidth,
				height: bestNode.height,
			});
		}
		const bottomNodeHeight = bestNode.height - rect.height;
		if (bottomNodeHeight > 0) {
			freeNodes.push({
				x: bestNode.x,
				y: bestNode.y + rect.height,
				width: rect.width,
				height: bottomNodeHeight,
			});
		}

		// Remove the used node from the free nodes list
		const nodeIndex = freeNodes.indexOf(bestNode);
		freeNodes.splice(nodeIndex, 1);
		sanitizeFreeNodes();
	}

	// Return the packed bins and the dimensions of the texture atlas
	const items = usedBins.map(({ item, x, y }) => ({ item, x, y }));
	const width = usedBins.reduce((maxWidth, { item, x }) => Math.max(maxWidth, x + item.width), 0);
	const height = usedBins.reduce((maxHeight, { item, y }) => Math.max(maxHeight, y + item.height), 0);

	return { items: items, width: width, height: height };
}

export function createOptimizedAtlas(imageResources: ImageResource[]): Canvas {
	if (imageResources.length === 0) {
		return createCanvas(1, 1);
	}
	const rects = imageResources.map(img_resource => ({
		x: undefined as number,
		y: undefined as number,
		width: (img_resource.img?.width ?? 0) + ATLAS_IMAGE_PADDING * 2,
		height: (img_resource.img?.height ?? 0) + ATLAS_IMAGE_PADDING * 2,
		id: img_resource.id
	}));

	const results: Array<{ items: { item: Rect, x: number, y: number; }[], width: number, height: number; }> = [];
	const packers: Array<{ name: string; fn: (rectangles: Rect[], width: number, height: number) => { items: { item: Rect, x: number, y: number; }[], width: number, height: number; }; }> = [
		{ name: 'maximalRectanglesPacker', fn: maximalRectanglesPacker },
		{ name: 'shelfBinPacker', fn: shelfBinPacker },
		{ name: 'tprfPacker', fn: tprfPacker },
	];

	for (const packer of packers) {
		try {
			const clonedRects = rects.map(rect => ({ width: rect.width as number, height: rect.height as number, id: rect.id }));
			const packed = packer.fn(clonedRects, ATLAS_MAX_SIZE_IN_PIXELS, ATLAS_MAX_SIZE_IN_PIXELS);
			results.push(packed);
		}
		catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.warn(`[AtlasBuilder] ${packer.name} failed: ${message}`);
		}
	}

	if (results.length === 0) {
		throw new Error('All atlas packing algorithms failed to fit the provided images within the configured atlas dimensions.');
	}

	// Determine the smallest result
	const smallest_result = results.reduce((smallest, current) => {
		const smallestArea = smallest.width * smallest.height;
		const currentArea = current.width * current.height;
		return currentArea < smallestArea ? current : smallest;
	});

	const atlas_width = CROP_ATLAS ? smallest_result.width : ATLAS_MAX_SIZE_IN_PIXELS, atlas_height = CROP_ATLAS ? smallest_result.height : ATLAS_MAX_SIZE_IN_PIXELS;

	const atlasCanvas: Canvas = createCanvas(atlas_width, atlas_height);
	const ctx: CanvasRenderingContext2D = atlasCanvas.getContext('2d')!;

	// Draw images onto the atlas canvas
	for (const packedRect of smallest_result.items) {
		const img_asset = imageResources.find(candidate => candidate.id === packedRect.item.id);
		if (!img_asset) {
			throw new Error(`Failed to locate image resource with id ${packedRect.item.id} for atlas packing.`);
		}
		if (!img_asset.img) {
			throw new Error(`Image resource "${img_asset.name}" is missing its image payload.`);
		}
		const img = img_asset.img;
		const pad = ATLAS_IMAGE_PADDING;
		const dx = packedRect.x + pad;
		const dy = packedRect.y + pad;

		// Draw the main image
		ctx.drawImage(img, dx, dy);

		// Extrude edge pixels into the padding area to prevent sampling gaps.
		if (pad > 0) {
			// Left / right borders
			ctx.drawImage(img, 0, 0, 1, img.height, packedRect.x, dy, pad, img.height);
			ctx.drawImage(img, img.width - 1, 0, 1, img.height, dx + img.width, dy, pad, img.height);
			// Top / bottom borders
			ctx.drawImage(img, 0, 0, img.width, 1, dx, packedRect.y, img.width, pad);
			ctx.drawImage(img, 0, img.height - 1, img.width, 1, dx, dy + img.height, img.width, pad);
			// Corners
			ctx.drawImage(img, 0, 0, 1, 1, packedRect.x, packedRect.y, pad, pad);
			ctx.drawImage(img, img.width - 1, 0, 1, 1, dx + img.width, packedRect.y, pad, pad);
			ctx.drawImage(img, 0, img.height - 1, 1, 1, packedRect.x, dy + img.height, pad, pad);
			ctx.drawImage(img, img.width - 1, img.height - 1, 1, 1, dx + img.width, dy + img.height, pad, pad);
		}

		// UVs cover ONLY the actual image pixels (exclude the padding).
		img_asset.atlasTexcoords = uvcoords(dx, dy, atlas_width, atlas_height, img.width, img.height);
	}
	return atlasCanvas;
}

/**
 * Calculates the UV coordinates of the inner image region that has been packed into a texture atlas.
 * Note: the atlas builder reserves a padded border around each image and extrudes edge pixels into it.
 * UVs must therefore address the *inner* (non-padded) rectangle using texel edges.
 * @param x The x-coordinate of the image in the texture atlas.
 * @param y The y-coordinate of the image in the texture atlas.
 * @param width The width of the texture atlas.
 * @param height The height of the texture atlas.
 * @param imageWidth The width of the image.
 * @param imageHeight The height of the image.
 * @returns An object containing the UV coordinates of the image in the texture atlas.
 */
function uvcoords(x: number, y: number, width: number, height: number, imageWidth: number, imageHeight: number): AtlasTexcoords {
	const left = x / width;
	const top = y / height;
	const right = (x + imageWidth) / width;
	const bottom = (y + imageHeight) / height;

	return [
		left, top,
		left, bottom,
		right, top,
		right, top,
		left, bottom,
		right, bottom,
	] as AtlasTexcoords;
}
