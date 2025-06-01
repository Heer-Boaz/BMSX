import { ILoadedResource } from './rompacker';
const { createCanvas } = require('canvas');

const ATLAS_MAX_SIZE_IN_PIXELS = 2048;
const CROP_ATLAS = true;

export type Rect = { width: number; height: number; id: number; };
export type Bin = { x: number; y: number; width: number; height: number; };

/**
 * Splits a free rectangle into smaller rectangles based on the position and size of a used rectangle.
 * @param freeRect The free rectangle to split.
 * @param usedRect The used rectangle to use as a reference for splitting the free rectangle.
 * @returns An array of new free rectangles created by splitting the original free rectangle.
 */
export function splitFreeRectangle(freeRect: Bin, usedRect: Bin): Bin[] {
	const newFreeRects: Bin[] = [];

	// Check for overlap on the horizontal axis
	if (usedRect.x < freeRect.x + freeRect.width && usedRect.x + usedRect.width > freeRect.x) {
		if (usedRect.y > freeRect.y && usedRect.y < freeRect.y + freeRect.height) {
			// Split the free rectangle horizontally (top)
			newFreeRects.push({
				x: freeRect.x,
				y: freeRect.y,
				width: freeRect.width,
				height: usedRect.y - freeRect.y,
			});
		}

		if (usedRect.y + usedRect.height < freeRect.y + freeRect.height) {
			// Split the free rectangle horizontally (bottom)
			newFreeRects.push({
				x: freeRect.x,
				y: usedRect.y + usedRect.height,
				width: freeRect.width,
				height: (freeRect.y + freeRect.height) - (usedRect.y + usedRect.height),
			});
		}
	}

	// Check for overlap on the vertical axis
	if (usedRect.y < freeRect.y + freeRect.height && usedRect.y + usedRect.height > freeRect.y) {
		if (usedRect.x > freeRect.x && usedRect.x < freeRect.x + freeRect.width) {
			// Split the free rectangle vertically (left)
			newFreeRects.push({
				x: freeRect.x,
				y: freeRect.y,
				width: usedRect.x - freeRect.x,
				height: freeRect.height,
			});
		}

		if (usedRect.x + usedRect.width < freeRect.x + freeRect.width) {
			// Split the free rectangle vertically (right)
			newFreeRects.push({
				x: usedRect.x + usedRect.width,
				y: freeRect.y,
				width: (freeRect.x + freeRect.width) - (usedRect.x + usedRect.width),
				height: freeRect.height,
			});
		}
	}

	return newFreeRects;
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
export function isContained(rect1: Bin, rect2: Bin): boolean {
	return rect1.x >= rect2.x && rect1.y >= rect2.y &&
		rect1.x + rect1.width <= rect2.x + rect2.width &&
		rect1.y + rect1.height <= rect2.y + rect2.height;
}

/**
 * Checks if two bins overlap.
 * @param bin1 The first bin to check.
 * @param bin2 The second bin to check.
 * @returns True if bin1 overlaps with bin2, false otherwise.
 */
export function overlaps(bin1: Bin, bin2: Bin): boolean {
	return bin1.x < bin2.x + bin2.width && bin1.x + bin1.width > bin2.x && bin1.y < bin2.y + bin2.height && bin1.y + bin1.height > bin2.y;
}

/**
 * Packs an array of rectangles into a texture atlas using the maximal rectangles algorithm.
 * @param rects An array of rectangles to pack into the texture atlas.
 * @param binWidth The maximum width of the texture atlas.
 * @param binHeight The maximum height of the texture atlas.
 * @returns An object containing the packed rectangles, their positions in the texture atlas, and the dimensions of the texture atlas.
 */
export function maximalRectanglesPacker(rects: Rect[], binWidth: number, binHeight: number): { items: { item: Rect, x: number, y: number; }[], width: number, height: number; } {
	// Sort the rectangles by area in descending order
	const sortedRects = rects.slice().sort((a, b) => b.width * b.height - a.width * a.height);

	// Initialize the used bins array
	const usedBins: { item: Rect, x: number, y: number; }[] = [];

	// Initialize the available free rectangles array
	const freeRectangles: Bin[] = [{ x: 0, y: 0, width: binWidth, height: binHeight }];

	// Helper function to find the best placement for a rectangle
	function findBestPlacement(rect: Rect): { bin: Bin, score: number; } | null {
		let bestBin: Bin | null = null;
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
				newFreeRectangles.push(...splitRects);
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
export function shelfBinPacker(rects: Rect[], binWidth: number, binHeight: number): { items: { item: Rect, x: number, y: number; }[], width: number, height: number; } {
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
export function tprfPacker(rects: Rect[], binWidth: number, binHeight: number): { items: { item: Rect, x: number, y: number; }[], width: number, height: number; } {
	// Sort the rectangles by area in descending order
	const sortedRects = rects.slice().sort((a, b) => b.width * b.height - a.width * a.height);

	// Initialize the used bins array
	const usedBins: { item: Rect, x: number, y: number; }[] = [];

	// Initialize the initial free node
	const initialNode: Node = { x: 0, y: 0, width: binWidth, height: binHeight };

	// Initialize the free nodes list
	const freeNodes: Node[] = [initialNode];

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
		let bestNode: Node | null = null;
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
		freeNodes.push({ x: bestNode.x + rect.width, y: bestNode.y, width: bestNode.width - rect.width, height: rect.height });
		freeNodes.push({ x: bestNode.x, y: bestNode.y + rect.height, width: rect.width, height: bestNode.height - rect.height });

		// Remove the used node from the free nodes list
		const nodeIndex = freeNodes.indexOf(bestNode);
		freeNodes.splice(nodeIndex, 1);
	}

	// Return the packed bins and the dimensions of the texture atlas
	const items = usedBins.map(({ item, x, y }) => ({ item, x, y }));
	const width = usedBins.reduce((maxWidth, { item, x }) => Math.max(maxWidth, x + item.width), 0);
	const height = usedBins.reduce((maxHeight, { item, y }) => Math.max(maxHeight, y + item.height), 0);

	return { items: items, width: width, height: height };
}

export function createOptimizedAtlas(loadedResources: ILoadedResource[], atlasId: number): HTMLCanvasElement {
	const image_assets = loadedResources.filter(resource => resource.type === "image");
	const rects = image_assets.map(img_resource => ({ x: undefined, y: undefined, width: img_resource.img?.width, height: img_resource.img?.height, id: img_resource.id }));

	const maxrect_result = maximalRectanglesPacker(rects, ATLAS_MAX_SIZE_IN_PIXELS, ATLAS_MAX_SIZE_IN_PIXELS);
	const binpack_result = shelfBinPacker(rects, ATLAS_MAX_SIZE_IN_PIXELS, ATLAS_MAX_SIZE_IN_PIXELS);
	const imagepacker_result = tprfPacker(rects, ATLAS_MAX_SIZE_IN_PIXELS, ATLAS_MAX_SIZE_IN_PIXELS);

	// Determine the smallest result
	const results = [maxrect_result, binpack_result, imagepacker_result];
	const smallest_result = results.reduce((smallest, current) => {
		const smallestArea = smallest.width * smallest.height;
		const currentArea = current.width * current.height;
		return currentArea < smallestArea ? current : smallest;
	});

	const atlas_width = CROP_ATLAS ? smallest_result.width : ATLAS_MAX_SIZE_IN_PIXELS, atlas_height = CROP_ATLAS ? smallest_result.height : ATLAS_MAX_SIZE_IN_PIXELS;

	const atlasCanvas: HTMLCanvasElement = <any>createCanvas(atlas_width, atlas_height);
	const ctx: CanvasRenderingContext2D = atlasCanvas.getContext('2d')!;

	// Draw images onto the atlas canvas
	for (const packedRect of smallest_result.items) {
		const img_asset = image_assets.find(img_asset => img_asset.id == packedRect.item.id);
		const img = img_asset.img;
		ctx.drawImage(img, packedRect.x, packedRect.y);
		img_asset.imgmeta = { ...uvcoords(packedRect.x, packedRect.y, atlas_width, atlas_height, img.width, img.height), atlasid: atlasId };
	}
	return atlasCanvas;
}

/**
 * Calculates the UV coordinates of an image that has been packed into a texture atlas.
 * @param x The x-coordinate of the image in the texture atlas.
 * @param y The y-coordinate of the image in the texture atlas.
 * @param width The width of the texture atlas.
 * @param height The height of the texture atlas.
 * @param imageWidth The width of the image.
 * @param imageHeight The height of the image.
 * @returns An object containing the UV coordinates of the image in the texture atlas.
 */
export function uvcoords(x: number, y: number, width: number, height: number, imageWidth: number, imageHeight: number) {
	const result = {
		width: imageWidth, height: imageHeight, atlassed: true, texcoords: [] as number[], texcoords_fliph: [] as number[], texcoords_flipv: [] as number[], texcoords_fliphv: [] as number[]
	};
	const left = x / width;
	const top = y / height;
	const right = (x + imageWidth) / width;
	const bottom = (y + imageHeight) / height;

	result.texcoords.push(left, top, right, top, left, bottom, left, bottom, right, top, right, bottom);
	result.texcoords_fliph.push(right, top, left, top, right, bottom, right, bottom, left, top, left, bottom);
	result.texcoords_flipv.push(left, bottom, right, bottom, left, top, left, top, right, bottom, right, top);
	result.texcoords_fliphv.push(right, bottom, left, bottom, right, top, right, top, left, bottom, left, top);
	return result;
}
