import type { Canvas, CanvasRenderingContext2D } from 'canvas';
import { resolve as resolvePath, sep as pathSep } from 'path';
import type { GxTexturePageTile } from '../../toolchain/ts/rompack/assets';
import type { ImageResource } from './rompacker.rompack';
import {
	GX_SYSTEM_TEXTURE_ATLAS_NAME,
	GX_TEXTURE_PAGE_PIXEL_SHIFT,
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

type PackedAtlas = {
	images: PackedImage[];
	width: number;
	height: number;
};

type SkylineNode = {
	x: number;
	y: number;
	width: number;
};

function texturePageCount(width: number, height: number): number {
	const columns = ((width - 1) >>> GX_TEXTURE_PAGE_PIXEL_SHIFT) + 1;
	const rows = ((height - 1) >>> GX_TEXTURE_PAGE_PIXEL_SHIFT) + 1;
	return columns * rows;
}

function buildTexturePageTiles(image: ImageResource, x: number, y: number): GxTexturePageTile[] {
	const tiles: GxTexturePageTile[] = [];
	let targetY = 0;
	let sourceY = y;
	while (targetY < image.img!.height) {
		let height = GX_TEXTURE_PAGE_PIXELS - (sourceY & (GX_TEXTURE_PAGE_PIXELS - 1));
		const remainingHeight = image.img!.height - targetY;
		if (height > remainingHeight) height = remainingHeight;
		let targetX = 0;
		let sourceX = x;
		while (targetX < image.img!.width) {
			let width = GX_TEXTURE_PAGE_PIXELS - (sourceX & (GX_TEXTURE_PAGE_PIXELS - 1));
			const remainingWidth = image.img!.width - targetX;
			if (width > remainingWidth) width = remainingWidth;
			tiles.push({ u: sourceX, v: sourceY, x: targetX, y: targetY, w: width, h: height });
			targetX += width;
			sourceX += width;
		}
		targetY += height;
		sourceY += height;
	}
	return tiles;
}

export function resolveTextureAtlasName(
	filepath: string,
	systemResourceRoots: readonly string[],
	authoredName: string | undefined,
): string {
	const absolutePath = resolvePath(filepath);
	for (let index = 0; index < systemResourceRoots.length; index += 1) {
		const absoluteSystemRoot = resolvePath(systemResourceRoots[index]);
		if (absolutePath === absoluteSystemRoot || absolutePath.startsWith(absoluteSystemRoot + pathSep)) {
			return GX_SYSTEM_TEXTURE_ATLAS_NAME;
		}
	}
	if (authoredName == null) {
		throw new Error(`[RomPacker] Cart image '${filepath}' must declare a named @atlas=<name> residency group.`);
	}
	return authoredName;
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

function validateImages(
	images: readonly ImageResource[],
	bounds: TexturePackingBounds,
): void {
	for (let imageIndex = 0; imageIndex < images.length; imageIndex += 1) {
		const image = images[imageIndex];
		const width = image.img!.width;
		const height = image.img!.height;
		if (width > bounds.maxPixelWidth || height > bounds.maxHeight) {
			throw new Error(`[RomPacker] GX image '${image.name}' does not fit its ${bounds.maxPixelWidth}x${bounds.maxHeight} transfer bounds.`);
		}
		if (bounds.pageLocal
			&& (width > GX_TEXTURE_PAGE_PIXELS || height > GX_TEXTURE_PAGE_PIXELS)) {
			throw new Error(`[RomPacker] Page-local GX image '${image.name}' does not fit one ${GX_TEXTURE_PAGE_PIXELS}x${GX_TEXTURE_PAGE_PIXELS} texture page.`);
		}
	}
}

function packingWidths(
	images: readonly ImageResource[],
	bounds: TexturePackingBounds,
): number[] {
	const candidates = new Set<number>();
	let widest = 0;
	let rowWidth = 0;
	for (let imageIndex = 0; imageIndex < images.length; imageIndex += 1) {
		const width = images[imageIndex].img!.width;
		if (width > widest) widest = width;
		rowWidth += width;
		if (rowWidth <= bounds.maxPixelWidth) candidates.add(rowWidth);
	}
	candidates.add(widest);
	let powerOfTwoWidth = 1;
	while (powerOfTwoWidth < widest) powerOfTwoWidth <<= 1;
	while (powerOfTwoWidth < bounds.maxPixelWidth) {
		candidates.add(powerOfTwoWidth);
		powerOfTwoWidth <<= 1;
	}
	if (bounds.pageLocal) {
		for (let width = GX_TEXTURE_PAGE_PIXELS;
			width < bounds.maxPixelWidth;
			width += GX_TEXTURE_PAGE_PIXELS) {
			candidates.add(width);
		}
	}
	candidates.add(bounds.maxPixelWidth);
	return Array.from(candidates).sort((left, right) => left - right);
}

function packSkyline(
	images: readonly ImageResource[],
	maxWidth: number,
	maxHeight: number,
	pageLocal: boolean,
): PackedAtlas | undefined {
	let skyline: SkylineNode[] = [{ x: 0, y: 0, width: maxWidth }];
	const packed: PackedImage[] = [];
	let packedWidth = 1;
	let packedHeight = 1;
	for (let imageIndex = 0; imageIndex < images.length; imageIndex += 1) {
		const image = images[imageIndex];
		const width = image.img!.width;
		const height = image.img!.height;
		const constrainToPage = pageLocal
			|| (width <= GX_TEXTURE_PAGE_PIXELS && height <= GX_TEXTURE_PAGE_PIXELS);

		const candidateXs = new Set<number>();
		for (let nodeIndex = 0; nodeIndex < skyline.length; nodeIndex += 1) {
			candidateXs.add(skyline[nodeIndex].x);
		}
		if (constrainToPage) {
			for (let pageX = 0; pageX < maxWidth; pageX += GX_TEXTURE_PAGE_PIXELS) {
				candidateXs.add(pageX);
			}
		}

		let bestX = -1;
		let bestY = maxHeight + 1;
		const sortedCandidateXs = Array.from(candidateXs).sort((left, right) => left - right);
		for (let candidateIndex = 0; candidateIndex < sortedCandidateXs.length; candidateIndex += 1) {
			const x = sortedCandidateXs[candidateIndex];
			if (x + width > maxWidth
				|| (constrainToPage
					&& (x & (GX_TEXTURE_PAGE_PIXELS - 1)) + width > GX_TEXTURE_PAGE_PIXELS)) {
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
			if (constrainToPage
				&& (y & (GX_TEXTURE_PAGE_PIXELS - 1)) + height > GX_TEXTURE_PAGE_PIXELS) {
				y = (y + GX_TEXTURE_PAGE_PIXELS) & ~(GX_TEXTURE_PAGE_PIXELS - 1);
			}
			if (y + height <= maxHeight && (y < bestY || (y === bestY && x < bestX))) {
				bestX = x;
				bestY = y;
			}
		}
		if (bestX < 0) {
			return undefined;
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
		const right = bestX + width;
		const bottom = bestY + height;
		if (right > packedWidth) packedWidth = right;
		if (bottom > packedHeight) packedHeight = bottom;
	}
	return {
		images: packed,
		width: packedWidth,
		height: packedHeight,
	};
}

function packImages(images: ImageResource[], bounds: TexturePackingBounds): PackedAtlas {
	const orderedImages = sortedImages(images);
	validateImages(orderedImages, bounds);
	const widths = packingWidths(orderedImages, bounds);
	let selected: PackedAtlas | undefined;
	let selectedArea = 0;
	let selectedPageCount = 0;
	for (let widthIndex = 0; widthIndex < widths.length; widthIndex += 1) {
		const packed = packSkyline(
			orderedImages,
			widths[widthIndex],
			bounds.maxHeight,
			bounds.pageLocal,
		);
		if (packed == null) continue;
		const area = packed.width * packed.height;
		const pageCount = texturePageCount(packed.width, packed.height);
		if (selected == null
			|| area < selectedArea
			|| (area === selectedArea && pageCount < selectedPageCount)
			|| (area === selectedArea
				&& pageCount === selectedPageCount
				&& packed.height < selected.height)
			|| (area === selectedArea
				&& pageCount === selectedPageCount
				&& packed.height === selected.height
				&& packed.width < selected.width)) {
			selected = packed;
			selectedArea = area;
			selectedPageCount = pageCount;
		}
	}
	if (selected == null) {
		const prefix = bounds.pageLocal ? 'Page-local GX' : 'GX';
		throw new Error(`[RomPacker] ${prefix} texture group does not fit its ${bounds.maxPixelWidth}x${bounds.maxHeight} transfer bounds.`);
	}
	return selected;
}

export function createTextureAtlas(images: ImageResource[], bounds: TexturePackingBounds): Canvas {
	if (images.length === 0) {
		throw new Error('[RomPacker] GX texture packing group has no images.');
	}
	const packed = packImages(images, bounds);
	const canvas: Canvas = createCanvas(packed.width, packed.height);
	const context: CanvasRenderingContext2D = canvas.getContext('2d');
	for (let index = 0; index < packed.images.length; index += 1) {
		const item = packed.images[index];
		context.drawImage(item.image.img!, item.x, item.y);
		item.image.textureU = item.x;
		item.image.textureV = item.y;
		const imageWidth = item.image.img!.width;
		const imageHeight = item.image.img!.height;
		const crossesPage = (item.x & (GX_TEXTURE_PAGE_PIXELS - 1)) + imageWidth > GX_TEXTURE_PAGE_PIXELS
			|| (item.y & (GX_TEXTURE_PAGE_PIXELS - 1)) + imageHeight > GX_TEXTURE_PAGE_PIXELS;
		if (!bounds.pageLocal && crossesPage) {
			item.image.gxPageTiles = buildTexturePageTiles(item.image, item.x, item.y);
		} else {
			delete item.image.gxPageTiles;
		}
	}
	return canvas;
}
