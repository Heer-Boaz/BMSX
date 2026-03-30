import type { RenderPassLibrary } from '../backend/renderpasslib';
import type { HostOverlayPipelineState, RenderPassStateRegistry, RenderSubmission } from '../backend/pipeline_interfaces';
import { WebGLBackend } from '../backend/webgl/webgl_backend';
import { $ } from '../../core/engine_core';
import { Runtime } from '../../emulator/runtime';
import { TAB_SPACES } from '../shared/bitmap_font';
import type { GlyphRenderSubmission, RectRenderSubmission, color } from '../shared/render_types';
import { consumeOverlayFrame, hasPendingOverlayFrame, type EditorOverlayFrame } from './editor_overlay_queue';
import { TEXTURE_UNIT_POST_PROCESSING_SOURCE } from '../backend/webgl/webgl.constants';
import vertexShaderCode from '../2d/shaders/framebuffer_2d.vert.glsl';
import fragmentShaderCode from '../2d/shaders/framebuffer_2d.frag.glsl';

const HOST_OVERLAY_TEXTURE_KEY = '_host_overlay';

type OverlayImageSource = {
	pixels: Uint8Array;
	regionX: number;
	regionY: number;
	stride: number;
	width: number;
	height: number;
};

interface FullscreenQuad {
	vbo: WebGLBuffer;
	tbo: WebGLBuffer;
	attribPos: number;
	attribTex: number;
	w: number;
	h: number;
}

let overlayPixels = new Uint8Array(0);
let overlayWidth = 0;
let overlayHeight = 0;
let overlayTextureReady = false;
let overlayTextureWidth = 0;
let overlayTextureHeight = 0;
let fsq: FullscreenQuad = null;

function toByteColor(value: color): { r: number; g: number; b: number; a: number } {
	return {
		r: Math.round(value.r * 255),
		g: Math.round(value.g * 255),
		b: Math.round(value.b * 255),
		a: Math.round(value.a * 255),
	};
}

function blendPixel(x: number, y: number, r: number, g: number, b: number, a: number): void {
	if (x < 0 || x >= overlayWidth || y < 0 || y >= overlayHeight) {
		return;
	}
	const index = (y * overlayWidth + x) * 4;
	if (a === 255) {
		overlayPixels[index + 0] = r;
		overlayPixels[index + 1] = g;
		overlayPixels[index + 2] = b;
		overlayPixels[index + 3] = 255;
		return;
	}
	if (a === 0) {
		return;
	}
	const inverse = 255 - a;
	overlayPixels[index + 0] = ((r * a) + (overlayPixels[index + 0] * inverse) + 127) / 255;
	overlayPixels[index + 1] = ((g * a) + (overlayPixels[index + 1] * inverse) + 127) / 255;
	overlayPixels[index + 2] = ((b * a) + (overlayPixels[index + 2] * inverse) + 127) / 255;
	overlayPixels[index + 3] = a + ((overlayPixels[index + 3] * inverse) + 127) / 255;
}

function fillRect(leftValue: number, topValue: number, rightValue: number, bottomValue: number, value: color): void {
	const byteColor = toByteColor(value);
	let left = Math.round(leftValue);
	let top = Math.round(topValue);
	let right = Math.round(rightValue);
	let bottom = Math.round(bottomValue);
	if (right < left) {
		const swap = left;
		left = right;
		right = swap;
	}
	if (bottom < top) {
		const swap = top;
		top = bottom;
		bottom = swap;
	}
	if (left < 0) left = 0;
	if (top < 0) top = 0;
	if (right > overlayWidth) right = overlayWidth;
	if (bottom > overlayHeight) bottom = overlayHeight;
	for (let y = top; y < bottom; y += 1) {
		for (let x = left; x < right; x += 1) {
			blendPixel(x, y, byteColor.r, byteColor.g, byteColor.b, byteColor.a);
		}
	}
}

function strokeRect(area: RectRenderSubmission['area'], value: color): void {
	fillRect(area.left, area.top, area.right, area.top + 1, value);
	fillRect(area.left, area.bottom - 1, area.right, area.bottom, value);
	fillRect(area.left, area.top, area.left + 1, area.bottom, value);
	fillRect(area.right - 1, area.top, area.right, area.bottom, value);
}

function resolveImageSource(imgid: string): OverlayImageSource {
	const handle = Runtime.instance.resolveAssetHandle(imgid);
	return Runtime.instance.vdp.resolveFrameBufferSource(handle);
}

function blitSource(source: OverlayImageSource, dstXValue: number, dstYValue: number, scaleX: number, scaleY: number, flipH: boolean, flipV: boolean, tint: color): void {
	const tintBytes = toByteColor(tint);
	const dstWidth = Math.max(1, Math.round(source.width * scaleX));
	const dstHeight = Math.max(1, Math.round(source.height * scaleY));
	const dstX = Math.round(dstXValue);
	const dstY = Math.round(dstYValue);
	for (let y = 0; y < dstHeight; y += 1) {
		const targetY = dstY + y;
		if (targetY < 0 || targetY >= overlayHeight) {
			continue;
		}
		const srcY = flipV
			? source.height - 1 - Math.floor((y * source.height) / dstHeight)
			: Math.floor((y * source.height) / dstHeight);
		for (let x = 0; x < dstWidth; x += 1) {
			const targetX = dstX + x;
			if (targetX < 0 || targetX >= overlayWidth) {
				continue;
			}
			const srcX = flipH
				? source.width - 1 - Math.floor((x * source.width) / dstWidth)
				: Math.floor((x * source.width) / dstWidth);
			const srcIndex = ((source.regionY + srcY) * source.stride) + ((source.regionX + srcX) * 4);
			const srcAlpha = source.pixels[srcIndex + 3];
			if (srcAlpha === 0) {
				continue;
			}
			blendPixel(
				targetX,
				targetY,
				(source.pixels[srcIndex + 0] * tintBytes.r + 127) / 255,
				(source.pixels[srcIndex + 1] * tintBytes.g + 127) / 255,
				(source.pixels[srcIndex + 2] * tintBytes.b + 127) / 255,
				(srcAlpha * tintBytes.a + 127) / 255,
			);
		}
	}
}

function drawGlyphRun(command: GlyphRenderSubmission): void {
	if (command.font === undefined) {
		throw new Error('[HostOverlay] Glyph submission missing font.');
	}
	const font = command.font;
	const foreground = toByteColor(command.color!);
	let originY = Math.round(command.y);
	const lines = Array.isArray(command.glyphs) ? command.glyphs : [command.glyphs];
	for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
		const line = lines[lineIndex];
		let originX = Math.round(command.x);
		const start = Array.isArray(command.glyphs) ? 0 : (command.glyph_start ?? 0);
		const end = Array.isArray(command.glyphs) ? line.length : (command.glyph_end ?? Number.MAX_SAFE_INTEGER);
		for (let index = start; index < line.length && index < end; index += 1) {
			const char = line.charAt(index);
			if (char === '\n') {
				originX = Math.round(command.x);
				originY += font.lineHeight;
				continue;
			}
			if (char === '\t') {
				originX += font.advance(' ') * TAB_SPACES;
				continue;
			}
			const glyph = font.getGlyph(char);
			if (command.background_color !== undefined) {
				fillRect(originX, originY, originX + glyph.advance, originY + font.lineHeight, command.background_color);
			}
			blitSource(resolveImageSource(glyph.imgid), originX, originY, 1, 1, false, false, {
				r: foreground.r / 255,
				g: foreground.g / 255,
				b: foreground.b / 255,
				a: foreground.a / 255,
			});
			originX += glyph.advance;
		}
		originY += font.lineHeight;
	}
}

function rasterizeCommand(command: RenderSubmission): void {
	switch (command.type) {
		case 'rect':
			if (command.kind === 'fill') {
				fillRect(command.area.left, command.area.top, command.area.right, command.area.bottom, command.color);
				return;
			}
			strokeRect(command.area, command.color);
			return;
		case 'img':
			blitSource(
				resolveImageSource(command.imgid),
				command.pos.x,
				command.pos.y,
				command.scale!.x,
				command.scale!.y,
				command.flip!.flip_h,
				command.flip!.flip_v,
				command.colorize!,
			);
			return;
		case 'glyphs':
			drawGlyphRun(command);
			return;
		case 'poly':
			throw new Error('[HostOverlay] Poly overlay rendering is not implemented.');
		case 'mesh':
			throw new Error('[HostOverlay] Mesh submissions are invalid in host overlay.');
		case 'particle':
			throw new Error('[HostOverlay] Particle submissions are invalid in host overlay.');
	}
}

function rasterizeFrame(frame: EditorOverlayFrame): void {
	const required = frame.width * frame.height * 4;
	if (overlayPixels.length !== required) {
		overlayPixels = new Uint8Array(required);
	}
	overlayWidth = frame.width;
	overlayHeight = frame.height;
	overlayPixels.fill(0);
	const commands = frame.commands;
	for (let i = 0; i < commands.length; i += 1) {
		rasterizeCommand(commands[i]);
	}
	if (!overlayTextureReady) {
		$.view.textures[HOST_OVERLAY_TEXTURE_KEY] = $.texmanager.createTextureFromPixelsSync(HOST_OVERLAY_TEXTURE_KEY, overlayPixels, frame.width, frame.height);
		overlayTextureReady = true;
		overlayTextureWidth = frame.width;
		overlayTextureHeight = frame.height;
	} else {
		if (overlayTextureWidth !== frame.width || overlayTextureHeight !== frame.height) {
			$.view.textures[HOST_OVERLAY_TEXTURE_KEY] = $.texmanager.resizeTextureForKey(HOST_OVERLAY_TEXTURE_KEY, frame.width, frame.height);
			overlayTextureWidth = frame.width;
			overlayTextureHeight = frame.height;
		}
		void $.texmanager.updateTexturesForKey(HOST_OVERLAY_TEXTURE_KEY, overlayPixels, frame.width, frame.height);
	}
}

function createFullscreenQuad(gl: WebGL2RenderingContext, outW: number, outH: number): FullscreenQuad {
	const vsProg = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram;
	const verts = new Float32Array([
		0.0, 0.0, 0.0, outH, outW, 0.0, outW, 0.0, 0.0, outH, outW, outH,
	]);
	const texcoords = new Float32Array([
		0.0, 1.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 0.0, 0.0, 1.0, 0.0,
	]);
	const vbo = gl.createBuffer();
	if (!vbo) {
		throw new Error('[HostOverlay] Failed to create VBO.');
	}
	gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
	gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
	const tbo = gl.createBuffer();
	if (!tbo) {
		throw new Error('[HostOverlay] Failed to create TBO.');
	}
	gl.bindBuffer(gl.ARRAY_BUFFER, tbo);
	gl.bufferData(gl.ARRAY_BUFFER, texcoords, gl.STATIC_DRAW);
	const attribPos = vsProg ? gl.getAttribLocation(vsProg, 'a_position') : -1;
	const attribTex = vsProg ? gl.getAttribLocation(vsProg, 'a_texcoord') : -1;
	return { vbo, tbo, attribPos, attribTex, w: outW, h: outH };
}

function bindUniforms(gl: WebGL2RenderingContext, state: HostOverlayPipelineState): void {
	const program = gl.getParameter(gl.CURRENT_PROGRAM);
	const textureUniform = gl.getUniformLocation(program, 'u_texture');
	const resolutionUniform = gl.getUniformLocation(program, 'u_resolution');
	const scaleUniform = gl.getUniformLocation(program, 'u_scale');
	gl.uniform1i(textureUniform, TEXTURE_UNIT_POST_PROCESSING_SOURCE);
	gl.uniform2f(resolutionUniform, state.width, state.height);
	gl.uniform1f(scaleUniform, 1.0);
}

function renderOverlay(backend: WebGLBackend, state: HostOverlayPipelineState): void {
	const gl = backend.gl as WebGL2RenderingContext;
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	gl.viewport(0, 0, state.width, state.height);
	backend.setDepthTestEnabled(false);
	backend.setDepthMask(false);
	backend.setBlendEnabled(true);
	backend.setBlendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
	if (!fsq || fsq.w !== state.width || fsq.h !== state.height) {
		if (fsq) {
			gl.deleteBuffer(fsq.vbo);
			gl.deleteBuffer(fsq.tbo);
		}
		fsq = createFullscreenQuad(gl, state.width, state.height);
	}
	gl.bindBuffer(gl.ARRAY_BUFFER, fsq.vbo);
	if (fsq.attribPos !== -1) {
		gl.enableVertexAttribArray(fsq.attribPos);
		gl.vertexAttribPointer(fsq.attribPos, 2, gl.FLOAT, false, 0, 0);
	}
	gl.bindBuffer(gl.ARRAY_BUFFER, fsq.tbo);
	if (fsq.attribTex !== -1) {
		gl.enableVertexAttribArray(fsq.attribTex);
		gl.vertexAttribPointer(fsq.attribTex, 2, gl.FLOAT, false, 0, 0);
	}
	$.view.activeTexUnit = TEXTURE_UNIT_POST_PROCESSING_SOURCE;
	$.view.bind2DTex(state.colorTex);
	gl.drawArrays(gl.TRIANGLES, 0, 6);
	backend.setBlendEnabled(false);
	backend.setDepthMask(true);
}

export function registerHostOverlayPass_WebGL(registry: RenderPassLibrary): void {
	registry.register({
		id: 'host_overlay',
		name: 'HostOverlay',
		vsCode: vertexShaderCode,
		fsCode: fragmentShaderCode,
		present: true,
		shouldExecute: () => hasPendingOverlayFrame(),
		prepare: (backend: WebGLBackend) => {
			const frame = consumeOverlayFrame()!;
			rasterizeFrame(frame);
			const state: HostOverlayPipelineState = {
				width: $.view.offscreenCanvasSize.x,
				height: $.view.offscreenCanvasSize.y,
				baseWidth: frame.logicalWidth,
				baseHeight: frame.logicalHeight,
				colorTex: $.texmanager.getTextureByUri(HOST_OVERLAY_TEXTURE_KEY),
			};
			registry.setState('host_overlay', state);
			bindUniforms(backend.gl as WebGL2RenderingContext, state);
		},
		exec: (backend: WebGLBackend, _fbo, state: RenderPassStateRegistry['host_overlay']) => {
			renderOverlay(backend, state);
		},
	});
}

export function registerHostOverlayPass_WebGPU(registry: RenderPassLibrary): void {
	registry.register({
		id: 'host_overlay',
		name: 'HostOverlay',
		stateOnly: true,
		shouldExecute: () => false,
		exec: () => { },
	});
}

export function registerHostOverlayPass_Headless(registry: RenderPassLibrary): void {
	registry.register({
		id: 'host_overlay',
		name: 'HeadlessHostOverlay',
		stateOnly: true,
		shouldExecute: () => {
			if (hasPendingOverlayFrame()) {
				consumeOverlayFrame();
			}
			return false;
		},
		exec: () => { },
	});
}
