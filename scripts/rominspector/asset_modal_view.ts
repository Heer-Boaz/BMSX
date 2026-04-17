import { PNG } from 'pngjs';
import type { GLTFModel, ImgMeta, RomAsset, RomManifest } from '../../src/bmsx/rompack/rompack';
import { decodeBinary } from '../../src/bmsx/common/serializer/binencoder';
import { loadModelFromBuffer as loadGLTFModelFromBuffer } from '../../src/bmsx/rompack/romloader';
import { decodeProgramSymbolsAsset, PROGRAM_ASSET_ID, PROGRAM_SYMBOLS_ASSET_ID } from '../../src/bmsx/machine/program/asset';
import { generateAtlasName } from '../rompacker/atlasbuilder';
import { asciiWaveBraille, generateBrailleAsciiArt, generatePixelPerfectAsciiArt, renderBufferBar } from './asciiart';
import { decodeAudioPreviewToPcm } from './audio_preview';
import {
	disassembleProgramAsset,
	loadProgramFromAssets,
	ROM_MANIFEST_ASSET_ID,
} from './inspector_shared';

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
	manifest: RomManifest | null;
	projectRootPath: string | null;
	formatByteSize(size: number): string;
	modalWidth: number;
	modalHeight: number;
	previewZoom: number;
};

function getRomSliceView(rombin: Uint8Array, start: number, end: number): Uint8Array {
	return rombin.subarray(start, end);
}

function formatHexDumpLine(buf: Uint8Array, byteOffset: number): string {
	const slice = buf.subarray(byteOffset, byteOffset + HEX_BYTES_PER_LINE);
	let line = byteOffset.toString(16).padStart(8, '0') + '  ';
	line += Array.from(slice).map(b => b.toString(16).padStart(2, '0')).join(' ').padEnd(HEX_BYTES_PER_LINE * 3 - 1, ' ');
	line += '  ';
	line += Array.from(slice).map(b => (b >= 32 && b <= 126 ? String.fromCharCode(b) : '.')).join('');
	return line;
}

function asciiHexDump(buf: Uint8Array, maxBytes = HEX_PREVIEW_MAX_BYTES): string {
	let result = '';
	const length = Math.min(buf.byteLength, maxBytes);
	for (let i = 0; i < length; i += HEX_BYTES_PER_LINE) {
		result += formatHexDumpLine(buf, i) + '\n';
	}
	if (buf.byteLength > maxBytes) {
		result += `... truncated: showing first ${maxBytes} bytes of ${buf.byteLength}\n`;
	}
	return result.trimEnd();
}

function renderHexDumpSectionPreview(title: string, start: number, end: number, buf: Uint8Array, formatByteSize: (size: number) => string): string {
	return `${title}: [${start} - ${end}] (${formatByteSize(buf.byteLength)})\n${asciiHexDump(buf)}`;
}

async function loadDataFromBuffer(buf: Uint8Array): Promise<any> {
	return decodeBinary(new Uint8Array(buf.slice(0)));
}

function buildOverlayBuffer(imgW: number, imgH: number, polys: number[][]): Uint8Array {
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
	for (const p of polys || []) {
		for (let i = 0; i < p.length; i += 2) {
			const j = (i + 2 === p.length) ? 0 : i + 2;
			line(p[i], p[i + 1], p[j], p[j + 1]);
		}
	}
	return buf;
}

function extractSubimageAndSizeFromAtlassedImage(imgToExtract: Buffer, imgmeta: ImgMeta): { subimage: Buffer; width: number; height: number } {
	const atlas = PNG.sync.read(imgToExtract);
	let imgW = atlas.width;
	let imgH = atlas.height;
	let offsetX = 0;
	let offsetY = 0;
	if (imgmeta.atlassed) {
		const coords = Array.from(imgmeta.texcoords as number[]);
		const xs: number[] = [];
		const ys: number[] = [];
		for (let i = 0; i + 1 < coords.length; i += 2) {
			xs.push(coords[i]);
			ys.push(coords[i + 1]);
		}
		const minU = Math.max(0, Math.min(...xs));
		const maxU = Math.min(1, Math.max(...xs));
		const minV = Math.max(0, Math.min(...ys));
		const maxV = Math.min(1, Math.max(...ys));
		offsetX = Math.round(minU * atlas.width);
		offsetY = Math.round(minV * atlas.height);
		imgW = Math.max(1, Math.min(atlas.width - offsetX, Math.round((maxU - minU) * atlas.width)));
		imgH = Math.max(1, Math.min(atlas.height - offsetY, Math.round((maxV - minV) * atlas.height)));
	}
	const subimageData = new Uint8Array(imgW * imgH * 4);
	const atlasW = atlas.width;
	const atlasData = atlas.data as Uint8Array;
	for (let y = 0; y < imgH; y += 1) {
		const srcRow = ((offsetY + y) * atlasW) << 2;
		const destRow = (y * imgW) << 2;
		for (let x = 0; x < imgW; x += 1) {
			const srcIdx = srcRow + ((offsetX + x) << 2);
			const dstIdx = destRow + (x << 2);
			if (srcIdx + 3 < atlasData.length) {
				subimageData[dstIdx] = atlasData[srcIdx];
				subimageData[dstIdx + 1] = atlasData[srcIdx + 1];
				subimageData[dstIdx + 2] = atlasData[srcIdx + 2];
				subimageData[dstIdx + 3] = atlasData[srcIdx + 3];
			}
		}
	}
	return { subimage: Buffer.from(subimageData), width: imgW, height: imgH };
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

function previewOutputMetrics(width: number, height: number, zoom: number) {
	const pixelPerfect = width <= PER_PIXEL_RENDERING_THRESHOLD && height <= PER_PIXEL_RENDERING_THRESHOLD;
	if (pixelPerfect) {
		return {
			pixelPerfect: true,
			outputWidth: Math.max(1, Math.round(width * zoom)),
			outputHeight: Math.max(1, Math.round(height * zoom)),
		};
	}
	return {
		pixelPerfect: false,
		outputWidth: Math.max(1, Math.floor(width * zoom / 2)),
		outputHeight: Math.max(1, Math.ceil(height * zoom / 4)),
	};
}

function formatZoom(zoom: number): string {
	return Number.isInteger(zoom) ? zoom.toFixed(1) : zoom.toString();
}

function previewFixedLine(width: number, height: number, zoom: number): string {
	return `Size: ${width}x${height} | Zoom: ${formatZoom(zoom)}x`;
}

function buildPreviewSection(titleLine: string, rgba: Uint8Array, width: number, height: number, zoom: number): AssetPreviewSection {
	const metrics = previewOutputMetrics(width, height, zoom);
	return {
		titleLine,
		rgba,
		width,
		height,
		zoom,
		pixelPerfect: metrics.pixelPerfect,
		outputWidth: metrics.outputWidth,
		outputHeight: metrics.outputHeight,
	};
}

function cropRgba(data: Uint8Array, width: number, startX: number, startY: number, endX: number, endY: number): Uint8Array {
	const cropWidth = Math.max(0, endX - startX);
	const cropHeight = Math.max(0, endY - startY);
	const cropped = new Uint8Array(cropWidth * cropHeight * 4);
	for (let y = 0; y < cropHeight; y += 1) {
		const sourceRow = ((startY + y) * width + startX) << 2;
		const targetRow = (y * cropWidth) << 2;
		cropped.set(data.subarray(sourceRow, sourceRow + (cropWidth << 2)), targetRow);
	}
	return cropped;
}

function splitAsciiArtLines(text: string): string[] {
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

function decodePngSection(buf: Buffer): { rgba: Uint8Array; width: number; height: number } {
	const png = PNG.sync.read(buf);
	return {
		rgba: new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.byteLength),
		width: png.width,
		height: png.height,
	};
}

function isGLTFModel(obj: unknown): obj is GLTFModel {
	return !!obj && typeof obj === 'object' && Array.isArray((obj as { meshes?: unknown }).meshes);
}

function errorText(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
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

	switch (selected.type) {
		case 'image':
			if (imgmeta.atlassed && imgmeta.texcoords) {
				const atlasName = generateAtlasName(imgmeta.atlasid as number);
				const atlasAsset = ctx.assetList.find(a => a.resid === atlasName && a.type === 'atlas');
				if (atlasAsset) {
					try {
						const atlasBuf = atlasAsset.buffer instanceof Uint8Array ? Buffer.from(atlasAsset.buffer) : Buffer.from(ctx.rombin.slice(atlasAsset.start, atlasAsset.end));
						const imagePreview = extractSubimageAndSizeFromAtlassedImage(atlasBuf, imgmeta);
						previewSections.push(buildPreviewSection('', new Uint8Array(imagePreview.subimage.buffer, imagePreview.subimage.byteOffset, imagePreview.subimage.byteLength), imagePreview.width, imagePreview.height, ctx.previewZoom));
						previewFixedLines.push(previewFixedLine(imagePreview.width, imagePreview.height, ctx.previewZoom));
					} catch (e: unknown) {
						preview = `[Error generating ASCII art from image: ${errorText(e)}]`;
					}
				} else {
					preview = '[Atlas asset not found]';
				}
				if (imgmeta.hitpolygons?.original && imgmeta.width && imgmeta.height) {
					previewSections.push(buildPreviewSection('HitPolygons (convex pieces) overlay:', buildOverlayBuffer(imgmeta.width, imgmeta.height, imgmeta.hitpolygons.original), imgmeta.width, imgmeta.height, ctx.previewZoom));
				}
				for (const [key, value] of Object.entries(imgmeta)) metadataLines.push(`${key}: ${JSON.stringify(value)}`);
			} else {
				let rendered = false;
				let decodeError = '';
				if (typeof selected.start === 'number' && typeof selected.end === 'number') {
					try {
						const buf = Buffer.from(ctx.rombin.slice(selected.start, selected.end));
						const png = decodePngSection(buf);
						previewSections.push(buildPreviewSection('', png.rgba, png.width, png.height, ctx.previewZoom));
						previewFixedLines.push(previewFixedLine(png.width, png.height, ctx.previewZoom));
						rendered = true;
					} catch (e: unknown) {
						decodeError = errorText(e);
					}
				}
				if (!rendered && selected.buffer) {
					try {
						const png = decodePngSection(Buffer.from(selected.buffer));
						previewSections.push(buildPreviewSection('', png.rgba, png.width, png.height, ctx.previewZoom));
						previewFixedLines.push(previewFixedLine(png.width, png.height, ctx.previewZoom));
						rendered = true;
					} catch (e: unknown) {
						decodeError = errorText(e);
					}
				}
				if (!rendered) {
					preview = decodeError ? `[Error generating ASCII art from image: ${decodeError}]` : '[No PNG buffer in ROM for this image.]';
				}
			}
			break;
		case 'atlas':
			for (const [key, value] of Object.entries(imgmeta)) metadataLines.push(`${key}: ${JSON.stringify(value)}`);
			try {
				const atlasPreview = decodePngSection(selected.buffer instanceof Uint8Array ? Buffer.from(selected.buffer) : Buffer.from(ctx.rombin.slice(selected.start, selected.end)));
				previewSections.push(buildPreviewSection('', atlasPreview.rgba, atlasPreview.width, atlasPreview.height, ctx.previewZoom));
				previewFixedLines.push(previewFixedLine(atlasPreview.width, atlasPreview.height, ctx.previewZoom));
			} catch (e: unknown) {
				preview = `[Error generating ASCII art from image: ${errorText(e)}]`;
			}
			break;
		case 'audio':
			if (audiometa.audiotype === 'music') {
				metadataLines.push('Audio type: Music');
				metadataLines.push(audiometa.loop !== undefined && audiometa.loop !== null ? `Loop position: ${audiometa.loop}` : 'Loop: Nein');
			} else if (audiometa.audiotype === 'sfx') {
				metadataLines.push('Audio type: SFX');
			}
			metadataLines.push(`Priority: ${audiometa.priority === undefined ? 'Unset!' : audiometa.priority}`);
			if (!selected.buffer || selected.buffer.byteLength === 0) {
				selected.buffer = Buffer.from(getRomSliceView(ctx.rombin, selected.start, selected.end));
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
		case 'data':
			if (selected.resid === ROM_MANIFEST_ASSET_ID) {
				const payload = ctx.projectRootPath ? { project_root_path: ctx.projectRootPath, manifest: ctx.manifest } : { manifest: ctx.manifest };
				preview = JSON.stringify(payload, null, 2);
			} else if (selected.resid === PROGRAM_ASSET_ID) {
				const { programAsset, program, metadata, sourceTextForPath, missingSourcePaths } = loadProgramFromAssets(ctx.rombin, ctx.assetList);
				disassembly = disassembleProgramAsset(program, metadata, sourceTextForPath);
				metadataLines.push(`Program entry proto: ${programAsset.entryProtoIndex}`);
				metadataLines.push(`Program protos: ${program.protos.length}`);
				metadataLines.push(`Program consts: ${program.constPool.length}`);
				metadataLines.push(`Program code bytes: ${program.code.length}`);
				if (missingSourcePaths.length > 0) {
					metadataLines.push(`Source comments: unavailable (${missingSourcePaths.length} missing Lua paths)`);
				}
				preview = '[Program asset: open Details tab for disassembly]';
			} else if (selected.resid === PROGRAM_SYMBOLS_ASSET_ID) {
				const symbols = decodeProgramSymbolsAsset(new Uint8Array(ctx.rombin.slice(selected.start, selected.end)));
				metadataLines.push(`Program symbols protos: ${symbols.metadata.protoIds.length}`);
				preview = JSON.stringify(symbols.metadata, null, 2);
			} else {
				if (!selected.buffer || typeof selected.buffer !== 'object') {
					selected.buffer = await loadDataFromBuffer(new Uint8Array(ctx.rombin.slice(selected.start, selected.end)));
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
					ctx.rombin.slice(selected.start, selected.end),
					selected.texture_start !== undefined && selected.texture_end !== undefined
						? ctx.rombin.slice(selected.texture_start, selected.texture_end)
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
		const assetBuf = selected.buffer instanceof Uint8Array ? selected.buffer : getRomSliceView(ctx.rombin, selected.start, selected.end);
		hex += renderHexDumpSectionPreview('Buffer', selected.start, selected.end, assetBuf, ctx.formatByteSize);
	}
	if (typeof selected.metabuffer_start === 'number' && typeof selected.metabuffer_end === 'number' && selected.metabuffer_end > selected.metabuffer_start) {
		const metaBuf = getRomSliceView(ctx.rombin, selected.metabuffer_start, selected.metabuffer_end);
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
