import type { Canvas, CanvasRenderingContext2D } from 'canvas';
import { resolve as resolvePath, sep as pathSep } from 'path';
import type { ImageResource } from './rompacker.rompack';
import {
	GX_CART_TEXTURE_GROUP_ID_LIMIT,
	GX_SYSTEM_TEXTURE_GROUP_ID,
	GX_TEXTURE_PAGE_PIXELS,
} from './texture_atlas_contract';

// @ts-ignore
const { createCanvas } = require('canvas');

export type TexturePackingBounds = {
	maxPixelWidth: number;
	maxHeight: number;
	pageLocal: boolean;
};

type PackedImage = {
	image: ImageResource;
	x: number;
	y: number;
};

type SkylineNode = {
	x: number;
	y: number;
	width: number;
};

export function resolveTextureGroupId(filepath: string, systemResourceRoots: readonly string[], current = 0): number {
	const absolutePath = resolvePath(filepath);
	for (let index = 0; index < systemResourceRoots.length; index += 1) {
		const absoluteSystemRoot = resolvePath(systemResourceRoots[index]);
		if (absolutePath === absoluteSystemRoot || absolutePath.startsWith(absoluteSystemRoot + pathSep)) {
			return GX_SYSTEM_TEXTURE_GROUP_ID;
		}
	}
	if (current >= GX_CART_TEXTURE_GROUP_ID_LIMIT) {
		throw new Error(`[RomPacker] Cart texture group id ${current} collides with reserved system texture group id ${GX_SYSTEM_TEXTURE_GROUP_ID}.`);
	}
	return current;
}

function sortedImages(images: ImageResource[]): ImageResource[] {
	return images.slice().sort((left, right) => {
		const leftArea = left.img!.width * left.img!.height;
		const rightArea = right.img!.width * right.img!.height;
		return rightArea - leftArea
			|| right.img!.height - left.img!.height
			|| right.img!.width - left.img!.width
			|| left.id - right.id;
	});
}

function packPageLocal(images: ImageResource[], bounds: TexturePackingBounds): PackedImage[] {
	let skyline: SkylineNode[] = [{ x: 0, y: 0, width: bounds.maxPixelWidth }];
	const packed: PackedImage[] = [];
	for (const image of sortedImages(images)) {
		const width = image.img!.width;
		const height = image.img!.height;
		if (width > bounds.maxPixelWidth || height > bounds.maxHeight) {
			throw new Error(`[RomPacker] GX image '${image.name}' does not fit its ${bounds.maxPixelWidth}x${bounds.maxHeight} pixel slots.`);
		}
		if (width > GX_TEXTURE_PAGE_PIXELS || height > GX_TEXTURE_PAGE_PIXELS) {
			throw new Error(`[RomPacker] Page-local GX image '${image.name}' does not fit one ${GX_TEXTURE_PAGE_PIXELS}x${GX_TEXTURE_PAGE_PIXELS} texture page.`);
		}

		const candidateXs = new Set<number>();
		for (let nodeIndex = 0; nodeIndex < skyline.length; nodeIndex += 1) {
			candidateXs.add(skyline[nodeIndex].x);
		}
		for (let pageX = 0; pageX < bounds.maxPixelWidth; pageX += GX_TEXTURE_PAGE_PIXELS) {
			candidateXs.add(pageX);
		}

		let bestX = -1;
		let bestY = bounds.maxHeight + 1;
		const sortedCandidateXs = Array.from(candidateXs).sort((left, right) => left - right);
		for (let candidateIndex = 0; candidateIndex < sortedCandidateXs.length; candidateIndex += 1) {
			const x = sortedCandidateXs[candidateIndex];
			if (x + width > bounds.maxPixelWidth
				|| (x & (GX_TEXTURE_PAGE_PIXELS - 1)) + width > GX_TEXTURE_PAGE_PIXELS) {
				continue;
			}

			const right = x + width;
			let y = 0;
			for (let nodeIndex = 0; nodeIndex < skyline.length; nodeIndex += 1) {
				const node = skyline[nodeIndex];
				if (node.x < right && node.x + node.width > x && node.y > y) {
					y = node.y;
				}
			}
			if ((y & (GX_TEXTURE_PAGE_PIXELS - 1)) + height > GX_TEXTURE_PAGE_PIXELS) {
				y = (y + GX_TEXTURE_PAGE_PIXELS) & ~(GX_TEXTURE_PAGE_PIXELS - 1);
			}
			if (y + height <= bounds.maxHeight && (y < bestY || (y === bestY && x < bestX))) {
				bestX = x;
				bestY = y;
			}
		}
		if (bestX < 0) {
			throw new Error(`[RomPacker] Page-local GX texture group does not fit its ${bounds.maxPixelWidth}x${bounds.maxHeight} pixel slots.`);
		}

		const placementRight = bestX + width;
		const nextSkyline: SkylineNode[] = [];
		let inserted = false;
		for (let nodeIndex = 0; nodeIndex < skyline.length; nodeIndex += 1) {
			const node = skyline[nodeIndex];
			const nodeRight = node.x + node.width;
			if (nodeRight <= bestX) {
				nextSkyline.push(node);
				continue;
			}
			if (node.x >= placementRight) {
				if (!inserted) {
					nextSkyline.push({ x: bestX, y: bestY + height, width });
					inserted = true;
				}
				nextSkyline.push(node);
				continue;
			}
			if (node.x < bestX) {
				nextSkyline.push({ x: node.x, y: node.y, width: bestX - node.x });
			}
			if (nodeRight > placementRight) {
				if (!inserted) {
					nextSkyline.push({ x: bestX, y: bestY + height, width });
					inserted = true;
				}
				nextSkyline.push({ x: placementRight, y: node.y, width: nodeRight - placementRight });
			}
		}
		if (!inserted) {
			nextSkyline.push({ x: bestX, y: bestY + height, width });
		}

		const mergedSkyline: SkylineNode[] = [];
		for (let nodeIndex = 0; nodeIndex < nextSkyline.length; nodeIndex += 1) {
			const node = nextSkyline[nodeIndex];
			const previous = mergedSkyline[mergedSkyline.length - 1];
			if (previous && previous.y === node.y && previous.x + previous.width === node.x) {
				previous.width += node.width;
			} else {
				mergedSkyline.push(node);
			}
		}
		skyline = mergedSkyline;
		packed.push({ image, x: bestX, y: bestY });
	}
	return packed;
}

function packSurfaceImages(images: ImageResource[], bounds: TexturePackingBounds): PackedImage[] {
	const packed: PackedImage[] = [];
	let x = 0;
	let y = 0;
	let rowHeight = 0;
	for (const image of sortedImages(images)) {
		const width = image.img!.width;
		const height = image.img!.height;
		if (width > bounds.maxPixelWidth || height > bounds.maxHeight) {
			throw new Error(`[RomPacker] GX image '${image.name}' does not fit its ${bounds.maxPixelWidth}x${bounds.maxHeight} pixel slots.`);
		}
		if (x + width > bounds.maxPixelWidth) {
			x = 0;
			y += rowHeight;
			rowHeight = 0;
		}
		if (y + height > bounds.maxHeight) {
			throw new Error(`[RomPacker] GX texture group does not fit its ${bounds.maxPixelWidth}x${bounds.maxHeight} pixel slots.`);
		}
		packed.push({ image, x, y });
		x += width;
		if (height > rowHeight) {
			rowHeight = height;
		}
	}
	return packed;
}

export function createTextureAtlas(images: ImageResource[], bounds: TexturePackingBounds): Canvas {
	if (images.length === 0) {
		throw new Error('[RomPacker] GX texture packing group has no images.');
	}
	const packed = bounds.pageLocal ? packPageLocal(images, bounds) : packSurfaceImages(images, bounds);
	let width = 1;
	let height = 1;
	for (let index = 0; index < packed.length; index += 1) {
		const item = packed[index];
		const right = item.x + item.image.img!.width;
		const bottom = item.y + item.image.img!.height;
		if (right > width) width = right;
		if (bottom > height) height = bottom;
	}
	const canvas: Canvas = createCanvas(width, height);
	const context: CanvasRenderingContext2D = canvas.getContext('2d');
	for (let index = 0; index < packed.length; index += 1) {
		const item = packed[index];
		context.drawImage(item.image.img!, item.x, item.y);
		item.image.textureU = item.x;
		item.image.textureV = item.y;
	}
	return canvas;
}
