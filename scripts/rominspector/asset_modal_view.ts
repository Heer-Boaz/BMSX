import { formatHexDumpRow } from '../../machine/ts/common/byte_hex_string';
import type { RomAsset } from '../../toolchain/ts/rompack/assets';
import type { RomTocEntry } from '../../machine/ts/rompack/toc';
import type { GLTFModel } from '../../toolchain/ts/rompack/gltf';
import type { CartManifest } from '../../machine/ts/rompack/manifest';
import { decodeBinary } from '../../machine/ts/common/serializer/binencoder';
import { loadModelFromBuffer as loadGLTFModelFromBuffer } from '../../toolchain/ts/rompack/loader';
import { BLUA32_IMAGE_ID } from '../../toolchain/ts/rompack/blua32_image';
import {
	BLUA32_SYMBOLS_IMAGE_ID,
	decodeBlua32SymbolsImage,
} from '../../toolchain/ts/rompack/blua32_symbols';
import { asciiWaveBraille, generateBrailleAsciiArt, generatePixelPerfectAsciiArt, renderBufferBar } from './asciiart';
import { decodeAudioPreviewToPcm } from './audio_preview';
import { decodeCollisionShapeVariant, type CollisionShapeVariant } from '../../toolchain/ts/rompack/collision_shape_codec';
import { decodeRomAssetImage, type RomTextureDecodeCache } from '../../toolchain/ts/rompack/asset_image';
export type { RomTextureDecodeCache as TextureDecodeCache } from '../../toolchain/ts/rompack/asset_image';
import {
	disassembleBlua32Image,
	loadBlua32ImageFromAssets,
	ROM_MANIFEST_ASSET_ID,
} from './shared';

const PER_PIXEL_RENDERING_THRESHOLD = 64;
const HEX_BYTES_PER_LINE = 16;
const HEX_PREVIEW_MAX_BYTES = 4096;

export type AssetPreviewSection = {
	titleLine: string;
	rgba: Uint8Array;
	width: number;
	height: number;
	zoom: number;
	pixelPerfect: boolean;
	outputWidth: number;
	outputHeight: number;
};

export type AssetModalView = {
	title: string;
	infoLines: string[];
	previewFixedLines: string[];
	previewSections: AssetPreviewSection[];
	preview: string;
	details: string;
	hex: string;
};

type BuildAssetModalViewContext = {
	rombin: Uint8Array;
	assetList: RomAsset[];
	tocEntries: readonly RomTocEntry[];
	decodedTexture: RomTextureDecodeCache;
	manifest: CartManifest | null;
	projectRootPath: string | null;
	formatByteSize(size: number): string;
	modalWidth: number;
	modalHeight: number;
	previewZoom: number;
};

function asciiHexDump(buf: Uint8Array, maxBytes = HEX_PREVIEW_MAX_BYTES): string {
	let result = '';
	const length = Math.min(buf.byteLength, maxBytes);
	for (let i = 0; i < length; i += HEX_BYTES_PER_LINE) {
		result += formatHexDumpRow(buf, i, length, HEX_BYTES_PER_LINE) + '\n';
	}
	if (buf.byteLength > maxBytes) {
		result += `... truncated: showing first ${maxBytes} bytes of ${buf.byteLength}\n`;
	}
	return result.trimEnd();
}

function renderHexDumpSectionPreview(title: string, start: number, end: number, buf: Uint8Array, formatByteSize: (size: number) => string): string {
	return `${title}: [${start} - ${end}] (${formatByteSize(buf.byteLength)})\n${asciiHexDump(buf)}`;
}

function buildOverlayBuffer(imgW: number, imgH: number, shape: CollisionShapeVariant): Uint8Array {
	const buf = new Uint8Array(imgW * imgH * 4);
	const put = (x: number, y: number) => {
		if (x < 0 || y < 0 || x >= imgW || y >= imgH) return;
		const i = ((y | 0) * imgW + (x | 0)) << 2;
		buf[i] = 255; buf[i + 1] = 255; buf[i + 2] = 0; buf[i + 3] = 255;
	};
	const line = (x0: number, y0: number, x1: number, y1: number) => {
		x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
		const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
		const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1; let err = dx + dy;
		for (;;) {
			put(x0, y0);
			if (x0 === x1 && y0 === y1) break;
			const e2 = 2 * err;
			if (e2 >= dy) { err += dy; x0 += sx; }
			if (e2 <= dx) { err += dx; y0 += sy; }
		}
	};
	const bounds = shape.bounds;
	line(bounds.left, bounds.top, bounds.right, bounds.top);
	line(bounds.right, bounds.top, bounds.right, bounds.bottom);
	line(bounds.right, bounds.bottom, bounds.left, bounds.bottom);
	line(bounds.left, bounds.bottom, bounds.left, bounds.top);
	if (shape.pieces !== undefined) for (const piece of shape.pieces) {
		if (piece.kind === 'aabb') {
			const b = piece.bounds;
			line(b.left, b.top, b.right, b.top); line(b.right, b.top, b.right, b.bottom);
			line(b.right, b.bottom, b.left, b.bottom); line(b.left, b.bottom, b.left, b.top);
		} else {
			const p = piece.vertices;
			for (let i = 0; i < p.length; i += 2) {
				const j = (i + 2 === p.length) ? 0 : i + 2;
				line(p[i], p[i + 1], p[j], p[j + 1]);
			}
		}
	}
	return buf;
}

function scaleImageNearest(data: Uint8Array, width: number, height: number, zoom: number): { data: Uint8Array; width: number; height: number } {
	if (zoom === 1) {
		return { data, width, height };
	}
	const scaledWidth = Math.max(1, Math.round(width * zoom));
	const scaledHeight = Math.max(1, Math.round(height * zoom));
	const scaledData = new Uint8Array(scaledWidth * scaledHeight * 4);
	for (let y = 0; y < scaledHeight; y += 1) {
		const sourceY = Math.min(height - 1, Math.floor(y / zoom));
		for (let x = 0; x < scaledWidth; x += 1) {
			const sourceX = Math.min(width - 1, Math.floor(x / zoom));
			const sourceIndex = (sourceY * width + sourceX) << 2;
			const targetIndex = (y * scaledWidth + x) << 2;
			scaledData[targetIndex] = data[sourceIndex];
			scaledData[targetIndex + 1] = data[sourceIndex + 1];
			scaledData[targetIndex + 2] = data[sourceIndex + 2];
			scaledData[targetIndex + 3] = data[sourceIndex + 3];
		}
	}
	return { data: scaledData, width: scaledWidth, height: scaledHeight };
}

function formatZoom(zoom: number): string {
	return Number.isInteger(zoom) ? zoom.toFixed(1) : zoom.toString();
}

function previewFixedLine(width: number, height: number, zoom: number): string {
	return `Size: ${width}x${height} | Zoom: ${formatZoom(zoom)}x`;
}

function buildPreviewSection(titleLine: string, rgba: Uint8Array, width: number, height: number, zoom: number): AssetPreviewSection {
	const section: AssetPreviewSection = {
		titleLine,
		rgba,
		width,
		height,
		zoom: 1,
		pixelPerfect: false,
		outputWidth: width,
		outputHeight: height,
	};
	setPreviewSectionZoom(section, zoom);
	return section;
}

function setPreviewSectionZoom(section: AssetPreviewSection, zoom: number): void {
	section.zoom = zoom;
	section.pixelPerfect = section.width <= PER_PIXEL_RENDERING_THRESHOLD && section.height <= PER_PIXEL_RENDERING_THRESHOLD;
	section.outputWidth = section.pixelPerfect
		? Math.max(1, Math.round(section.width * zoom))
		: Math.max(1, Math.floor(section.width * zoom / 2));
	section.outputHeight = section.pixelPerfect
		? Math.max(1, Math.round(section.height * zoom))
		: Math.max(1, Math.ceil(section.height * zoom / 4));
}

export function setAssetModalPreviewZoom(view: AssetModalView, zoom: number): void {
	for (let sectionIndex = 0; sectionIndex < view.previewSections.length; sectionIndex += 1) {
		setPreviewSectionZoom(view.previewSections[sectionIndex], zoom);
	}
	const image = view.previewSections[0];
	view.previewFixedLines[0] = previewFixedLine(image.width, image.height, zoom);
}

function cropRgba(data: Uint8Array, width: number, startX: number, startY: number, endX: number, endY: number): Uint8Array {
	const cropWidth = endX - startX;
	const cropHeight = endY - startY;
	const cropped = new Uint8Array(cropWidth * cropHeight * 4);
	for (let y = 0; y < cropHeight; y += 1) {
		const sourceRow = ((startY + y) * width + startX) << 2;
		const targetRow = (y * cropWidth) << 2;
		cropped.set(data.subarray(sourceRow, sourceRow + (cropWidth << 2)), targetRow);
	}
	return cropped;
}

function splitAsciiArtLines(text: string): string[] {
	// disable-next-line newline_normalization_pattern -- rominspector ASCII previews are rendered as LF-delimited logical rows.
	const lines = text.split('\n');
	if (lines.length > 0 && lines[lines.length - 1] === '') {
		lines.pop();
	}
	return lines;
}

export function renderPreviewSectionWindow(section: AssetPreviewSection, startCol: number, startRow: number, viewportWidth: number, viewportHeight: number): { lines: string[]; clipX: number } {
	if (viewportWidth <= 0 || viewportHeight <= 0 || startCol >= section.outputWidth || startRow >= section.outputHeight) {
		return { lines: [], clipX: 0 };
	}
	const visibleEndCol = Math.min(section.outputWidth, startCol + viewportWidth);
	const visibleEndRow = Math.min(section.outputHeight, startRow + viewportHeight);
	const horizontalScale = section.pixelPerfect ? section.zoom : section.zoom / 2;
	const verticalScale = section.pixelPerfect ? section.zoom : section.zoom / 4;
	const sourceStartX = Math.max(0, Math.floor(startCol / horizontalScale));
	const sourceEndX = Math.min(section.width, Math.ceil(visibleEndCol / horizontalScale));
	const sourceStartY = Math.max(0, Math.floor(startRow / verticalScale));
	const sourceEndY = Math.min(section.height, Math.ceil(visibleEndRow / verticalScale));
	const cropped = cropRgba(section.rgba, section.width, sourceStartX, sourceStartY, sourceEndX, sourceEndY);
	const cropWidth = Math.max(1, sourceEndX - sourceStartX);
	const cropHeight = Math.max(1, sourceEndY - sourceStartY);
	const outputStartCol = section.pixelPerfect
		? Math.floor(sourceStartX * section.zoom)
		: Math.floor(sourceStartX * section.zoom / 2);
	const outputStartRow = section.pixelPerfect
		? Math.floor(sourceStartY * section.zoom)
		: Math.floor(sourceStartY * section.zoom / 4);
	const clipX = Math.max(0, startCol - outputStartCol);
	const clipY = Math.max(0, startRow - outputStartRow);
	const limitRow = clipY + viewportHeight;
	if (section.pixelPerfect) {
		const scaled = scaleImageNearest(cropped, cropWidth, cropHeight, section.zoom);
		const lines = splitAsciiArtLines(generatePixelPerfectAsciiArt(scaled.data, scaled.width, scaled.height)).slice(clipY, limitRow);
		return {
			lines,
			clipX,
		};
	}
	const artWidth = Math.max(1, Math.ceil(cropWidth * section.zoom / 2) + 8);
	const lines = splitAsciiArtLines(generateBrailleAsciiArt(cropped, cropWidth, cropHeight, artWidth, { scaleLimit: section.zoom })).slice(clipY, limitRow);
	return {
		lines,
		clipX,
	};
}

function isGLTFModel(obj: unknown): obj is GLTFModel {
	return !!obj && typeof obj === 'object' && Array.isArray((obj as { meshes?: unknown }).meshes);
}

export async function buildAssetModalView(selected: RomAsset, ctx: BuildAssetModalViewContext): Promise<AssetModalView> {
	const imgmeta = selected.imgmeta!;
	const audiometa = selected.audiometa!;
	const metadataLines: string[] = [];
	const previewFixedLines: string[] = [];
	const previewSections: AssetPreviewSection[] = [];
	let preview = '';
	let disassembly = '';
	const modalWidth = Math.max(20, ctx.modalWidth);
	const modalHeight = Math.max(8, ctx.modalHeight);

	switch (selected.op === 'delete' ? 'delete' : selected.type) {
		case 'delete': metadataLines.push('TOC operation: delete'); break;
		case 'image': {
			const imagePreview = decodeRomAssetImage(ctx.rombin, ctx.assetList, selected, ctx.decodedTexture);
			previewSections.push(buildPreviewSection('', imagePreview.rgba, imagePreview.width, imagePreview.height, ctx.previewZoom));
			previewFixedLines.push(previewFixedLine(imagePreview.width, imagePreview.height, ctx.previewZoom));
			if (selected.collision_bin_start !== undefined) {
				const shape = decodeCollisionShapeVariant(ctx.rombin.subarray(selected.collision_bin_start, selected.collision_bin_end));
				previewSections.push(buildPreviewSection('Collision shapes:', buildOverlayBuffer(imgmeta.width, imgmeta.height, shape), imgmeta.width, imgmeta.height, ctx.previewZoom));
			}
			for (const [key, value] of Object.entries(imgmeta)) metadataLines.push(`${key}: ${JSON.stringify(value)}`);
			break;
		}
		case 'texture': {
			const imagePreview = decodeRomAssetImage(ctx.rombin, ctx.assetList, selected, ctx.decodedTexture);
			previewSections.push(buildPreviewSection('', imagePreview.rgba, imagePreview.width, imagePreview.height, ctx.previewZoom));
			previewFixedLines.push(previewFixedLine(imagePreview.width, imagePreview.height, ctx.previewZoom));
			for (const [key, value] of Object.entries(selected.texturemeta)) metadataLines.push(`${key}: ${JSON.stringify(value)}`);
			break;
		}
		case 'audio':
			if (audiometa.audiotype === 'music') {
				metadataLines.push('Audio type: Music');
				metadataLines.push(audiometa.loop !== undefined && audiometa.loop !== null ? `Loop position: ${audiometa.loop}` : 'Loop: Nein');
			} else if (audiometa.audiotype === 'sfx') {
				metadataLines.push('Audio type: SFX');
			}
			metadataLines.push(`Priority: ${audiometa.priority === undefined ? 'Unset!' : audiometa.priority}`);
			if (!selected.buffer || selected.buffer.byteLength === 0) {
				selected.buffer = Buffer.from(ctx.rombin.subarray(selected.start, selected.end));
			}
			{
				const decoded = decodeAudioPreviewToPcm(selected.buffer);
				const pcm = new Uint8Array(decoded.samples.buffer, decoded.samples.byteOffset, decoded.samples.byteLength);
				metadataLines.push(`Sample rate: ${decoded.sampleRate}`);
				metadataLines.push(`Channels: ${decoded.channels}`);
				metadataLines.push(`Frames: ${decoded.frames}`);
				metadataLines.push(`Preview format: ${decoded.format.toUpperCase()}`);
				preview = asciiWaveBraille(pcm, 16, modalWidth, modalHeight, decoded.channels);
			}
			break;
		case 'code':
			if (selected.resid === BLUA32_IMAGE_ID) {
				const { image, symbols, sourceTextByPath, missingSourcePaths } = loadBlua32ImageFromAssets(ctx.rombin, ctx.tocEntries);
				disassembly = disassembleBlua32Image(image, symbols, sourceTextByPath);
				metadataLines.push(`BLua32 image address: ${image.address.toString(16).toUpperCase()}h`);
				metadataLines.push(`BLua32 functions: ${image.functions.length}`);
				metadataLines.push(`BLua32 constants: ${image.constants.length}`);
				metadataLines.push(`BLua32 text bytes: ${image.header.textByteCount}`);
				if (missingSourcePaths.length > 0) {
					metadataLines.push(`Source comments: unavailable (${missingSourcePaths.length} missing Lua paths)`);
				}
				preview = '[BLua32 image: open Details tab for disassembly]';
			} else if (selected.resid === BLUA32_SYMBOLS_IMAGE_ID) {
				const symbols = decodeBlua32SymbolsImage(ctx.rombin.subarray(selected.start, selected.end));
				metadataLines.push(`BLua32 symbol functions: ${symbols.functionAddresses.length}`);
				preview = JSON.stringify(symbols, null, 2);
			} else {
				throw new Error(`Unsupported code asset '${selected.resid}'.`);
			}
			break;
		case 'data':
			if (selected.resid === ROM_MANIFEST_ASSET_ID) {
				const payload = ctx.projectRootPath ? { project_root_path: ctx.projectRootPath, manifest: ctx.manifest } : { manifest: ctx.manifest };
				preview = JSON.stringify(payload, null, 2);
			} else {
				if (!selected.buffer) {
					selected.buffer = decodeBinary(ctx.rombin.subarray(selected.start, selected.end));
				}
				metadataLines.push(`Data size: ${ctx.formatByteSize(selected.end - selected.start)}`);
				preview = JSON.stringify(selected.buffer, null, 2);
			}
			break;
		case 'model':
			const modelData = isGLTFModel(selected.buffer)
				? selected.buffer
				: await loadGLTFModelFromBuffer(
					String(selected.resid),
					ctx.rombin.subarray(selected.start, selected.end),
					selected.model_texture_start
						? ctx.rombin.subarray(selected.model_texture_start, selected.model_texture_end!)
						: undefined,
				);
			if (!isGLTFModel(modelData)) {
				throw new Error(`Asset '${selected.resid}' buffer is not a GLTFModel.`);
			}
			metadataLines.push(`Model size: ${ctx.formatByteSize(selected.end - selected.start)}`);
			metadataLines.push(`Nodes: ${modelData.nodes ? modelData.nodes.length : 0}`);
			metadataLines.push(`Scenes: ${modelData.scenes ? modelData.scenes.length : 0}`);
			metadataLines.push(`Skins: ${modelData.skins ? modelData.skins.length : 0}`);
			const first = modelData.meshes[0];
			if (first) {
				preview =
					`Meshes: ${modelData.meshes.length}\n` +
					`Vertices: ${first.positions.length / 3}\n` +
					`UVs: ${first.texcoords ? first.texcoords.length / 2 : 0}\n` +
					`Normals: ${first.normals ? first.normals.length / 3 : 0}\n` +
					`Indices: ${first.indices ? first.indices.length : 0}\n` +
					`Animations: ${modelData.animations ? modelData.animations.length : 0}\n`;
			} else {
				preview = 'No mesh data';
			}
			break;
		default:
			preview = '[No preview available]';
			break;
	}

	const bufferLines: string[] = [];
	const hasBuffer = selected.start !== undefined && selected.end !== undefined;
	const hasMetabuffer = selected.metabuffer_start !== undefined && selected.metabuffer_end !== undefined;
	const bufferSize = hasBuffer ? selected.end - selected.start : 0;
	const metabufferSize = hasMetabuffer ? selected.metabuffer_end - selected.metabuffer_start : 0;
	if (bufferSize || metabufferSize) {
		const regions: Array<{ start: number; end: number; colorTag: string; label: string }> = [];
		if (hasBuffer) {
			regions.push({ start: selected.start, end: selected.end, colorTag: '{light-red-fg}', label: 'buffer' });
		}
		if (hasMetabuffer) {
			regions.push({ start: selected.metabuffer_start, end: selected.metabuffer_end, colorTag: '{light-blue-fg}', label: 'metabuffer' });
		}
		// disable-next-line newline_normalization_pattern -- buffer bar renderer returns LF-delimited terminal rows.
		const renderedBarLines = renderBufferBar(regions, ctx.rombin.byteLength, Math.max(16, modalWidth - 2), undefined, { forceVisibleTinyRegions: true }).split('\n');
		bufferLines.push(`Buffer: ${renderedBarLines[0]}`);
		if (renderedBarLines[1]) bufferLines.push(renderedBarLines[1]);
		if (bufferSize) bufferLines.push(`Buffer: ${selected.start} - ${selected.end} (${ctx.formatByteSize(bufferSize)})`);
		if (metabufferSize) bufferLines.push(`Metabuffer: ${selected.metabuffer_start} - ${selected.metabuffer_end} (${ctx.formatByteSize(metabufferSize)})`);
		if (bufferSize && metabufferSize) bufferLines.push(`Total size: ${ctx.formatByteSize(bufferSize + metabufferSize)}`);
	}

	let details = metadataLines.join('\n');
	if (disassembly) {
		details += `${details ? '\n\n' : ''}Disassembly:\n${disassembly}`;
	}

	let hex = '';
	if (typeof selected.start === 'number' && typeof selected.end === 'number') {
		const assetBuf = selected.buffer instanceof Uint8Array ? selected.buffer : ctx.rombin.subarray(selected.start, selected.end);
		hex += renderHexDumpSectionPreview('Buffer', selected.start, selected.end, assetBuf, ctx.formatByteSize);
	}
	if (typeof selected.metabuffer_start === 'number' && typeof selected.metabuffer_end === 'number' && selected.metabuffer_end > selected.metabuffer_start) {
		const metaBuf = ctx.rombin.subarray(selected.metabuffer_start, selected.metabuffer_end);
		hex += `${hex ? '\n\n' : ''}${renderHexDumpSectionPreview('Metabuffer', selected.metabuffer_start, selected.metabuffer_end, metaBuf, ctx.formatByteSize)}`;
	}

	return {
		title: `Asset - ID: ${selected.resid} | Type: ${selected.type}`,
		infoLines: bufferLines,
		previewFixedLines,
		previewSections,
		preview,
		details: details || '[No details]',
		hex: hex || '[No hex data available]',
	};
}
