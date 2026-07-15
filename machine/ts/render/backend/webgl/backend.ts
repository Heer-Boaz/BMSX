// WebGL backend implementation extracted from legacy gpu_backend.ts
import { color_arr, type TextureSource } from '../../../rompack/format';
// Legacy-specific pipeline hooks removed; pipelines own their setup/exec.
import * as GLR from './gl_resources';
import { GPUBackend, GraphicsPipelineBindingLayout, GraphicsPipelineBuildDesc, PassEncoder, RenderPassDesc, RenderPassInstanceHandle, RenderPassStateRegistry, RenderTargetHandle, type SizedArrayBufferView } from '../backend';
import { RGBA8_LINEAR_TEXTURE_PARAMS, type TextureParams } from '../texture_params';
import { TEXTURE_UNIT_CUBEMAP, TEXTURE_UNIT_UPLOAD } from './constants';
import { CATCH_WEBGL_ERROR, checkWebGLError } from './helpers';
import { createSolidRgba8Pixels } from '../../shared/solid_pixels';
import { registerHostOverlayPass, registerHostMenuPass } from '../../host_overlay/webgl/pipeline';
import { registerCRT } from '../../post/crt/webgl/pipeline';
import { registerDeviceQuantize } from '../../post/device_quantize/webgl/pipeline';
import { FRAME_UNIFORM_BINDING, updateAndBindFrameUniforms } from '../frame_uniforms';
import type { RenderPassLibrary } from '../pass/library';
import { captureRenderedVramSnapshot, registerGxGpuPass } from './gx_gpu';
import { registerGxCharacterPlanePass } from './gx_character_plane';
import type { GxGpu } from '../../../machine/devices/gx/gpu';

// (Texture units sourced from render_view constants to avoid duplication.)
const FBO_CACHE_DEPTH_ID_STRIDE = 0x1000000;

export class WebGLBackend implements GPUBackend {
	get type(): 'webgl2' {
		return 'webgl2';
	}

	private texIds = new WeakMap<WebGLTexture, number>();
	private nextTexId = 1;
	private fboCache = new Map<number, WebGLFramebuffer>();
	private readonly passEncoderScratch: PassEncoder = { fbo: null, desc: {} };
	// Legacy / custom pipeline states not managed by PipelineManager (or pre-registered);
	// typed as Partial<PipelineStates> for compile-time narrowing while still allowing
	// arbitrary extension via index signature.
	private extraStates: Partial<RenderPassStateRegistry> & { [k: string]: unknown } = {};
	private currentProgram: WebGLProgram = null;
	private currentVAO: WebGLVertexArrayObject = null;
	private currentArrayBuffer: WebGLBuffer = null;
	private currentElementArrayBuffer: WebGLBuffer = null;
	private cachedViewportX = -1;
	private cachedViewportY = -1;
	private cachedViewportW = -1;
	private cachedViewportH = -1;
	private cachedBlendEnabled: boolean = null;
	private cachedCullEnabled: boolean = null;
	private cachedDepthMask: boolean = null;
	private cachedDepthTestEnabled: boolean = null;
	private cachedDepthFunc: number = null;
	private cachedBlendFunc: { src: number; dst: number } = null;
	private currentActiveTexUnit = 0;
	private boundTex2D: (WebGLTexture | null)[] = [];
	private boundTexCube: (WebGLTexture | null)[] = [];
	private texInfo = new WeakMap<WebGLTexture, { w: number; h: number; srgb: boolean }>();
	private readbackFbo: WebGLFramebuffer = null;
	private uniformCache = new WeakMap<WebGLProgram, Map<string, WebGLUniformLocation>>();
	private attribCache = new WeakMap<WebGLProgram, Map<string, number>>();
	private bufferSizes = new WeakMap<WebGLBuffer, number>();
	private frameStats = { draws: 0, drawIndexed: 0, drawsInstanced: 0, drawIndexedInstanced: 0, bytesUploaded: 0, vertexBytes: 0, indexBytes: 0, uniformBytes: 0, textureBytes: 0 };
	private nextPipelineId = 1;
	private _context: WebGL2RenderingContext;
	public get context(): WebGL2RenderingContext { return this._context; }
	constructor(public gl: WebGL2RenderingContext) {
		this._context = gl;
		gl.disable(gl.DITHER);
		this.readbackFbo = gl.createFramebuffer()!;
		for (let unit = 0; unit < 32; unit += 1) {
			this.boundTex2D[unit] = null;
			this.boundTexCube[unit] = null;
		}
	}

	registerBuiltinPasses(registry: RenderPassLibrary): void {
		registry.register({
			id: 'frame_resolve',
			name: 'FrameResolve',
			stateOnly: true,
			graph: { skip: true },
			exec: () => { },
			prepare: (backend) => {
				const gv = registry.view;
				updateAndBindFrameUniforms(backend, gv.offscreenCanvasSize.x, gv.offscreenCanvasSize.y, gv.viewportSize.x, gv.viewportSize.y);
			},
		});
		registerGxGpuPass(registry);
		registerGxCharacterPlanePass(registry);
		registerDeviceQuantize(registry);
		registerCRT(registry);
		registerHostOverlayPass(registry);
		registerHostMenuPass(registry);
	}

	bindRenderPassPipeline(pass: PassEncoder, pipeline: RenderPassInstanceHandle, bindingLayout?: GraphicsPipelineBindingLayout): void {
		this.setGraphicsPipeline(pass, pipeline);
		const uniformList = bindingLayout?.uniforms;
		if (uniformList) {
			for (const uniformName of uniformList) {
				switch (uniformName) {
					case 'FrameUniforms':
						this.setUniformBlockBinding('FrameUniforms', FRAME_UNIFORM_BINDING);
						break;
				}
			}
		}
	}

	setAlphaBlended2DState(srcFactor: number, dstFactor: number): void {
		this.setCullEnabled(false);
		this.setDepthTestEnabled(false);
		this.setDepthMask(false);
		this.setBlendEnabled(true);
		this.setBlendFunc(srcFactor, dstFactor);
	}

	private bindTexture2DForUpload(texture: WebGLTexture, desc: TextureParams): void {
		const gl = this.gl;
		this.setActiveTexture(TEXTURE_UNIT_UPLOAD);
		gl.bindTexture(gl.TEXTURE_2D, texture);
		this.boundTex2D[TEXTURE_UNIT_UPLOAD] = null;
		GLR.glSetTexture2DParams(gl, desc);
	}

	createTexture(data: Uint8Array, width: number, height: number, desc: TextureParams): WebGLTexture {
		const srgb = desc.srgb;
		const internalFormat = srgb ? this.gl.SRGB8_ALPHA8 : this.gl.RGBA8;
		const gl = this.gl;
		const tex = gl.createTexture()!;
		this.bindTexture2DForUpload(tex, desc);
		gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
		gl.bindTexture(gl.TEXTURE_2D, null);
		this.texInfo.set(tex, { w: width, h: height, srgb });
		this.accountUpload('texture', width * height * 4);
		return tex;
	}

	updateTexture(handle: WebGLTexture, data: Uint8Array, width: number, height: number, desc: TextureParams): void {
		const gl = this.gl;
		const info = this.texInfo.get(handle);
		const srgb = desc.srgb;
		const internalFormat = srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8;
		this.bindTexture2DForUpload(handle, desc);
		const needsRecreate = !info || info.w !== width || info.h !== height || info.srgb !== srgb;
		if (needsRecreate) {
			gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
		} else {
			gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, data);
		}
		this.texInfo.set(handle, { w: width, h: height, srgb });
		this.accountUpload('texture', width * height * 4);
		gl.bindTexture(gl.TEXTURE_2D, null);
	}

	resizeTexture(handle: WebGLTexture, width: number, height: number, desc: TextureParams): WebGLTexture {
		const gl = this.gl;
		const srgb = desc.srgb;
		const internalFormat = srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8;
		this.bindTexture2DForUpload(handle, desc);
		gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
		this.texInfo.set(handle, { w: width, h: height, srgb });
		gl.bindTexture(gl.TEXTURE_2D, null);
		return handle;
	}

	updateTextureRegion(handle: WebGLTexture, data: Uint8Array, width: number, height: number, x: number, y: number, desc: TextureParams, sourceOffset = 0): void {
		const gl = this.gl;
		this.bindTexture2DForUpload(handle, desc);
		gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, width, height, gl.RGBA, gl.UNSIGNED_BYTE, data, sourceOffset);
		this.accountUpload('texture', width * height * 4);
		gl.bindTexture(gl.TEXTURE_2D, null);
	}

	readTextureRegion(handle: WebGLTexture, out: Uint8Array, width: number, height: number, x: number, y: number, _desc: TextureParams): void {
		const gl = this.gl;
		const size = this.texInfo.get(handle);
		if (!size) {
			throw new Error('[WebGLBackend] Texture size not tracked for readback.');
		}
		const prevFbo = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
		gl.bindFramebuffer(gl.FRAMEBUFFER, this.readbackFbo);
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, handle, 0);
		const glY = size.h - y - height;
		if (glY < 0) {
			throw new Error('[WebGLBackend] Readback Y coordinate out of bounds.');
		}
		gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
		gl.readPixels(x, glY, width, height, gl.RGBA, gl.UNSIGNED_BYTE, out);
		gl.bindFramebuffer(gl.FRAMEBUFFER, prevFbo);
	}

	createSolidTexture2D(width: number, height: number, color: number, desc: TextureParams): WebGLTexture {
		const gl = this.gl;
		gl.activeTexture(gl.TEXTURE0 + TEXTURE_UNIT_UPLOAD);
		const tex = gl.createTexture()!;
		gl.bindTexture(gl.TEXTURE_2D, tex);
		const data = createSolidRgba8Pixels(width, height, color);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
		this.accountUpload('texture', width * height * 4);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_BASE_LEVEL, 0);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, 0);
		GLR.glSetTexture2DParams(gl, desc);
		gl.bindTexture(gl.TEXTURE_2D, null);
		this.texInfo.set(tex, { w: width, h: height, srgb: false });
		return tex;
	}


	private createCubemapStorage(): WebGLTexture {
		const gl = this.gl;
		gl.activeTexture(gl.TEXTURE0 + TEXTURE_UNIT_CUBEMAP);
		const tex = gl.createTexture()!;
		gl.bindTexture(gl.TEXTURE_CUBE_MAP, tex);
		return tex;
	}

	private bindCubemapStorage(cubemap: WebGLTexture): void {
		const gl = this.gl;
		gl.activeTexture(gl.TEXTURE0 + TEXTURE_UNIT_CUBEMAP);
		gl.bindTexture(gl.TEXTURE_CUBE_MAP, cubemap);
	}

	private cubemapFaceTarget(face: number): GLenum {
		return this.gl.TEXTURE_CUBE_MAP_POSITIVE_X + face;
	}

	private uploadCubemapSource(target: GLenum, src: TextureSource): void {
		const gl = this.gl;
		if (src.data) {
			gl.texImage2D(target, 0, gl.RGBA, src.width, src.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, src.data);
			this.accountUpload('texture', src.width * src.height * 4);
			return;
		}
		gl.texImage2D(target, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src as ImageBitmap);
		this.accountUpload('texture', src.width * src.height * 4);
	}

	private finishCubemapStorage(desc: TextureParams): void {
		const gl = this.gl;
		GLR.glSetTextureCubeParams(gl, desc);
		gl.bindTexture(gl.TEXTURE_CUBE_MAP, null);
	}

	createCubemapFromSources(faces: readonly [TextureSource, TextureSource, TextureSource, TextureSource, TextureSource, TextureSource], desc: TextureParams): WebGLTexture {
		const tex = this.createCubemapStorage();
		for (let i = 0; i < 6; i++) {
			this.uploadCubemapSource(this.cubemapFaceTarget(i), faces[i]);
		}
		this.finishCubemapStorage(desc);
		return tex;
	}
	createSolidCubemap(size: number, color: number, desc: TextureParams): WebGLTexture {
		const gl = this.gl;
		const tex = this.createCubemapStorage();
		const data = createSolidRgba8Pixels(size, size, color);
		for (let face = 0; face < 6; face += 1) {
			gl.texImage2D(this.cubemapFaceTarget(face), 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
		}
		this.accountUpload('texture', size * size * 4 * 6);
		this.finishCubemapStorage(desc);
		return tex;
	}
	createCubemapEmpty(size: number, desc: TextureParams): WebGLTexture {
		const gl = this.gl;
		const tex = this.createCubemapStorage();
		for (let face = 0; face < 6; face += 1) {
			gl.texImage2D(this.cubemapFaceTarget(face), 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
		}
		this.accountUpload('texture', size * size * 4 * 6);
		this.finishCubemapStorage(desc);
		return tex;
	}
	uploadCubemapFace(cubemap: WebGLTexture, face: number, src: TextureSource): void {
		const gl = this.gl;
		this.bindCubemapStorage(cubemap);
		this.uploadCubemapSource(this.cubemapFaceTarget(face), src);
		gl.bindTexture(gl.TEXTURE_CUBE_MAP, null);
	}
	destroyTexture(handle: WebGLTexture): void {
		const textureId = this.texIds.get(handle);
		if (textureId !== undefined) {
			for (const [key, framebuffer] of this.fboCache) {
				const depthId = key % FBO_CACHE_DEPTH_ID_STRIDE;
				const colorId = (key - depthId) / FBO_CACHE_DEPTH_ID_STRIDE;
				if (colorId === textureId || depthId === textureId) {
					this.gl.deleteFramebuffer(framebuffer);
					this.fboCache.delete(key);
				}
			}
		}
		for (let unit = 0; unit < this.boundTex2D.length; unit += 1) {
			if (this.boundTex2D[unit] === handle) {
				this.boundTex2D[unit] = null;
			}
			if (this.boundTexCube[unit] === handle) {
				this.boundTexCube[unit] = null;
			}
		}
		this.texInfo.delete(handle);
		this.texIds.delete(handle);
		this.gl.deleteTexture(handle);
	}

	invalidateTextureBindingCache(): void {
		this.currentActiveTexUnit = -1;
		for (let unit = 0; unit < this.boundTex2D.length; unit += 1) {
			this.boundTex2D[unit] = null;
			this.boundTexCube[unit] = null;
		}
	}

	createColorTexture(desc: { width: number; height: number; format?: GLenum; initialClearColor?: color_arr }): WebGLTexture {
		const gl = this.gl;
		const tex = gl.createTexture()!;
		gl.activeTexture(gl.TEXTURE0 + TEXTURE_UNIT_UPLOAD);
		gl.bindTexture(gl.TEXTURE_2D, tex);
		// Use RGBA8 when no explicit format was requested; invalid explicit formats must fail in GL.
		const internal = (desc.format === undefined ? gl.RGBA8 : desc.format) as GLenum;
		gl.texImage2D(gl.TEXTURE_2D, 0, internal, desc.width, desc.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
		GLR.glSetTexture2DParams(gl, RGBA8_LINEAR_TEXTURE_PARAMS);
		if (desc.initialClearColor !== undefined) {
			const fbo = gl.createFramebuffer();
			gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
			gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
			gl.clearColor(...desc.initialClearColor);
			gl.clear(gl.COLOR_BUFFER_BIT);
			gl.deleteFramebuffer(fbo);
		}
		gl.bindTexture(gl.TEXTURE_2D, null);
		this.texInfo.set(tex, { w: desc.width, h: desc.height, srgb: false });
		return tex;
	}
	createDepthTexture(desc: { width: number; height: number }): WebGLTexture {
		const gl = this.gl;
		const tex = gl.createTexture()!;
		gl.activeTexture(gl.TEXTURE0 + TEXTURE_UNIT_UPLOAD);
		gl.bindTexture(gl.TEXTURE_2D, tex);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT16, desc.width, desc.height, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_SHORT, null);
		this.accountUpload('texture', desc.width * desc.height * 2);
		GLR.glSetTexture2DParams(gl, RGBA8_LINEAR_TEXTURE_PARAMS);
		return tex;
	}
	createRenderTarget(color?: WebGLTexture, depth?: WebGLTexture): RenderTargetHandle {
		const gl = this.gl;
		const fbo = gl.createFramebuffer();
		gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
		if (color !== undefined) {
			gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0);
		}
		if (depth !== undefined) {
			gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth, 0);
		}
		// Ensure draw buffer routing is valid for user FBOs
		if (color !== undefined) {
			gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
		} else {
			gl.drawBuffers([gl.NONE]);
		}
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		return fbo;
	}
	destroyRenderTarget(handle: WebGLFramebuffer): void {
		this.gl.deleteFramebuffer(handle);
	}
	clear(color: color_arr | undefined, depth: number | undefined): void {
		const gl = this.gl;
		let mask = 0;
		if (color !== undefined) { gl.clearColor(...color); mask |= gl.COLOR_BUFFER_BIT; }
		if (depth !== undefined) { gl.clearDepth(depth); mask |= gl.DEPTH_BUFFER_BIT; }
		if (mask !== 0) gl.clear(mask);
	}
	beginRenderPass(desc: RenderPassDesc): PassEncoder {
		let fbo: WebGLFramebuffer = null;
		// Normalize single color into colors[0]
		const firstColor = desc.colors?.[0] ?? desc.color;
		const hasColor = firstColor !== undefined;
		const hasDepth = desc.depth !== undefined;
		if (hasColor || hasDepth) {
			let colorTex: WebGLTexture | null = null;
			if (hasColor) {
				colorTex = firstColor.tex as WebGLTexture;
			}
			let depthTex: WebGLTexture | null = null;
			if (hasDepth) {
				depthTex = desc.depth.tex as WebGLTexture;
			}
			if (hasColor) {
				if (!this.texIds.has(colorTex)) this.texIds.set(colorTex, this.nextTexId++);
				const cid = this.texIds.get(colorTex)!;
				let did = 0;
				if (depthTex !== null) {
					if (!this.texIds.has(depthTex)) this.texIds.set(depthTex, this.nextTexId++);
					did = this.texIds.get(depthTex)!;
				}
				const key = cid * FBO_CACHE_DEPTH_ID_STRIDE + did;
				let cached = this.fboCache.get(key);
				if (!cached) {
					cached = this.createRenderTarget(colorTex, depthTex) as WebGLFramebuffer;
					this.fboCache.set(key, cached);
				}
				fbo = cached;
			} else {
				fbo = this.createRenderTarget(colorTex, depthTex) as WebGLFramebuffer;
			}
			this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, fbo);
			let clearColor: color_arr | undefined;
			if (hasColor) {
				clearColor = firstColor.clear;
			}
			let clearDepth: number | undefined;
			if (hasDepth) {
				clearDepth = desc.depth.clearDepth;
			}
			if (clearColor !== undefined || clearDepth !== undefined) {
				this.clear(clearColor, clearDepth);
			}
		}
		// Set the program related to this render-pass (if defined)
		this.passEncoderScratch.fbo = fbo;
		this.passEncoderScratch.desc = desc;
		return this.passEncoderScratch;
	}
	endRenderPass(_pass: PassEncoder): void {
		const gl = this.gl;
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	}
	getCaps() {
		return {
			maxColorAttachments: 1,
			maxTextureSize: this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE) as number,
			supportsInstancing: true,
			supportsDepthTexture: true,
			supportsCorePresentation: true,
		};
	}
	// --- Pipeline API ---
	createRenderPassInstance(desc: GraphicsPipelineBuildDesc): RenderPassInstanceHandle {
		const program = this.buildProgram(desc.vsCode, desc.fsCode, desc.label);
		if (!program) throw new Error(`Failed to create pipeline for ${desc.label}`);
		const id = this.nextPipelineId;
		this.nextPipelineId += 1;
		return { id, label: desc.label, backendData: program };
	}
	destroyRenderPassInstance(p: RenderPassInstanceHandle): void {
		if (p.backendData) this.gl.deleteProgram(p.backendData as WebGLProgram);
	}
	setGraphicsPipeline(_pass: PassEncoder, pipeline: RenderPassInstanceHandle): void {
		const prog = pipeline.backendData as WebGLProgram;
		this.useProgram(prog);
	}
	useProgram(program: WebGLProgram): void {
		if (this.currentProgram === program) return;
		this.gl.useProgram(program);
		this.currentProgram = program;
	}
	draw(_pass: PassEncoder, first: number, count: number): void {
		this.frameStats.draws++;
		this.gl.drawArrays(this.gl.TRIANGLES, first, count); // Assume TRIANGLES; customize if needed
	}
	drawIndexed(_pass: PassEncoder, indexCount: number, firstIndex: number, indexType?: number): void {
		this.frameStats.drawIndexed++;
		const type = (indexType ?? this.gl.UNSIGNED_SHORT);
		const bytesPerIndex = (type === this.gl.UNSIGNED_INT) ? 4 : (type === this.gl.UNSIGNED_BYTE ? 1 : 2);
		this.gl.drawElements(this.gl.TRIANGLES, indexCount, type, firstIndex * bytesPerIndex);
	}
	getPassState<S = unknown>(label: string): S {
		return this.extraStates[label] as S;
	}
	setPassState<State = unknown>(label: string, state: State): void {
		// Migrate to external manager.setState; for now keep extraStates
		this.extraStates[label] = state;
	}
	buildProgram(vsSource: string, fsSource: string, label: string, shaderDefines = ''): WebGLProgram {
		const gl = this.gl;
		function compile(type: number, source: string, stage: string): WebGLShader {
			const shader = gl.createShader(type);
			if (!shader) return null;
			if (shaderDefines.length !== 0) {
				const versionEnd = source.indexOf('\n') + 1;
				source = source.slice(0, versionEnd) + shaderDefines + source.slice(versionEnd);
			}
			gl.shaderSource(shader, source);
			gl.compileShader(shader);
			if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
				console.error(`Shader compile failed (${label}:${stage}):`, gl.getShaderInfoLog(shader));
				gl.deleteShader(shader);
				return null;
			}
			return shader;
		}
		const vs = compile(gl.VERTEX_SHADER, vsSource, 'vs');
		const fs = compile(gl.FRAGMENT_SHADER, fsSource, 'fs');
		if (!vs || !fs) return null;
		const prog = gl.createProgram();
		if (!prog) return null;
		gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
		if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
			console.error('Program link failed (' + label + '):', gl.getProgramInfoLog(prog));
			gl.deleteProgram(prog);
			return null;
		}
		gl.deleteShader(vs); gl.deleteShader(fs);
		return prog;
	}

	// --- Optional buffer/VAO helpers ---
		createVertexBuffer(data: ArrayBufferView, usage: 'static' | 'dynamic'): WebGLBuffer {
			const gl = this.gl;
			const buf = gl.createBuffer(); if (!buf) throw new Error('Failed to create buffer');
			gl.bindBuffer(gl.ARRAY_BUFFER, buf);
			gl.bufferData(gl.ARRAY_BUFFER, data, usage === 'static' ? gl.STATIC_DRAW : gl.DYNAMIC_DRAW);
			this.accountUpload('vertex', data.byteLength);
			this.bufferSizes.set(buf, data.byteLength);
			gl.bindBuffer(gl.ARRAY_BUFFER, null);
			this.currentArrayBuffer = null;
			return buf;
	}
	updateVertexBuffer(buf: WebGLBuffer, data: ArrayBufferView, dstOffset = 0, sourceOffset = 0, elementCount?: number): void {
		const gl = this.gl;
		gl.bindBuffer(gl.ARRAY_BUFFER, buf);
		const current = this.bufferSizes.get(buf) ?? 0;
		const sized = data as SizedArrayBufferView;
		const bytesPerElement = data instanceof DataView ? 1 : sized.BYTES_PER_ELEMENT ?? 1;
		const availableElements = data instanceof DataView ? data.byteLength : sized.length ?? data.byteLength / bytesPerElement;
		const uploadElements = elementCount === undefined ? availableElements - sourceOffset : elementCount;
		const uploadBytes = uploadElements * bytesPerElement;
		const needed = dstOffset + uploadBytes;
		if (needed > current) {
			gl.bufferData(gl.ARRAY_BUFFER, needed, gl.DYNAMIC_DRAW);
			this.bufferSizes.set(buf, needed);
		}
		gl.bufferSubData(gl.ARRAY_BUFFER, dstOffset, data, sourceOffset, uploadElements);
		this.accountUpload('vertex', uploadBytes);
		gl.bindBuffer(gl.ARRAY_BUFFER, null);
		this.currentArrayBuffer = null;
	}
	// moved below with cached variants

	drawInstanced(_pass: PassEncoder, vertexCount: number, instanceCount: number, firstVertex = 0, firstInstance = 0): void {
		this.frameStats.drawsInstanced++;
		if (CATCH_WEBGL_ERROR) checkWebGLError('drawInstanced: before drawArraysInstanced');
		this.gl.drawArraysInstanced(this.gl.TRIANGLES, firstVertex, vertexCount, instanceCount);
		if (CATCH_WEBGL_ERROR) checkWebGLError(`drawInstanced: after drawArraysInstanced. firstVertex: ${firstVertex}, vertexCount: ${vertexCount}, instanceCount: ${instanceCount}, firstInstance: ${firstInstance}`);
	}
	drawIndexedInstanced(_pass: PassEncoder, indexCount: number, instanceCount: number, firstIndex = 0, _baseVertex = 0, firstInstance = 0, indexType?: number): void {
		this.frameStats.drawIndexedInstanced++;
		const gl = this.gl;
		const type = (indexType ?? gl.UNSIGNED_SHORT);
		const bytesPerIndex = (type === gl.UNSIGNED_INT) ? 4 : (type === gl.UNSIGNED_BYTE ? 1 : 2);
		if (CATCH_WEBGL_ERROR) checkWebGLError('drawIndexedInstanced: before drawElementsInstanced');
		gl.drawElementsInstanced(gl.TRIANGLES, indexCount, type, firstIndex * bytesPerIndex, instanceCount);
		// Inline detailed diagnostics on error to pinpoint root cause
		const err = CATCH_WEBGL_ERROR ? gl.getError() : gl.NO_ERROR;
		if (CATCH_WEBGL_ERROR && err !== gl.NO_ERROR) {
			const vao = gl.getParameter(gl.VERTEX_ARRAY_BINDING) as WebGLVertexArrayObject;
			const ebo = gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING) as WebGLBuffer;
			// Attempt to inspect a few common attributes
			const posLoc = this.getAttribLocation('a_position');
			const instLoc0 = this.getAttribLocation('a_i0');
			const instLoc1 = this.getAttribLocation('a_i1');
			const instLoc2 = this.getAttribLocation('a_i2');
			const instLoc3 = this.getAttribLocation('a_i3');
			const attribEnabled = gl.VERTEX_ATTRIB_ARRAY_ENABLED;
			const attribDivisor = gl.VERTEX_ATTRIB_ARRAY_DIVISOR;
			const attribBufferBinding = gl.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING;
			let pos: { enabled: boolean; divisor: number; buf: WebGLBuffer } | null = null;
			if (posLoc >= 0) {
				pos = {
					enabled: !!gl.getVertexAttrib(posLoc, attribEnabled),
					divisor: gl.getVertexAttrib(posLoc, attribDivisor) as number,
					buf: gl.getVertexAttrib(posLoc, attribBufferBinding) as WebGLBuffer,
				};
			}
			let inst0: { enabled: boolean; divisor: number; buf: WebGLBuffer } | null = null;
			if (instLoc0 >= 0) {
				inst0 = {
					enabled: !!gl.getVertexAttrib(instLoc0, attribEnabled),
					divisor: gl.getVertexAttrib(instLoc0, attribDivisor) as number,
					buf: gl.getVertexAttrib(instLoc0, attribBufferBinding) as WebGLBuffer,
				};
			}
			let inst1: { enabled: boolean; divisor: number; buf: WebGLBuffer } | null = null;
			if (instLoc1 >= 0) {
				inst1 = {
					enabled: !!gl.getVertexAttrib(instLoc1, attribEnabled),
					divisor: gl.getVertexAttrib(instLoc1, attribDivisor) as number,
					buf: gl.getVertexAttrib(instLoc1, attribBufferBinding) as WebGLBuffer,
				};
			}
			let inst2: { enabled: boolean; divisor: number; buf: WebGLBuffer } | null = null;
			if (instLoc2 >= 0) {
				inst2 = {
					enabled: !!gl.getVertexAttrib(instLoc2, attribEnabled),
					divisor: gl.getVertexAttrib(instLoc2, attribDivisor) as number,
					buf: gl.getVertexAttrib(instLoc2, attribBufferBinding) as WebGLBuffer,
				};
			}
			let inst3: { enabled: boolean; divisor: number; buf: WebGLBuffer } | null = null;
			if (instLoc3 >= 0) {
				inst3 = {
					enabled: !!gl.getVertexAttrib(instLoc3, attribEnabled),
					divisor: gl.getVertexAttrib(instLoc3, attribDivisor) as number,
					buf: gl.getVertexAttrib(instLoc3, attribBufferBinding) as WebGLBuffer,
				};
			}
			let u0: WebGLBuffer = null, u1: WebGLBuffer = null;
			u0 = gl.getIndexedParameter(gl.UNIFORM_BUFFER_BINDING, 0) as WebGLBuffer;
			u1 = gl.getIndexedParameter(gl.UNIFORM_BUFFER_BINDING, 1) as WebGLBuffer;
			console.error(
				`WebGL error ${err} after drawElementsInstanced; ` +
				`firstIndex=${firstIndex} indexCount=${indexCount} instanceCount=${instanceCount} firstInstance=${firstInstance} indexType=${type}; ` +
				`vao=${!!vao} ebo=${!!ebo} ubo0=${!!u0} ubo1=${!!u1}; ` +
				`pos=${pos ? `en=${pos.enabled} buf=${!!pos.buf}` : 'n/a'}; ` +
				`inst=${inst0 ? `en=${inst0.enabled} div=${inst0.divisor} buf=${!!inst0.buf}` : 'n/a'},` +
				`${inst1 ? `en=${inst1.enabled} div=${inst1.divisor} buf=${!!inst1.buf}` : 'n/a'},` +
				`${inst2 ? `en=${inst2.enabled} div=${inst2.divisor} buf=${!!inst2.buf}` : 'n/a'},` +
				`${inst3 ? `en=${inst3.enabled} div=${inst3.divisor} buf=${!!inst3.buf}` : 'n/a'}`
			);
		}
	}

	createUniformBuffer(byteSize: number, usage: 'static' | 'dynamic'): WebGLBuffer {
		const gl = this.gl;
		const buf = gl.createBuffer();
		if (!buf) throw new Error('Failed to create uniform buffer');
		gl.bindBuffer(gl.UNIFORM_BUFFER, buf);
		gl.bufferData(gl.UNIFORM_BUFFER, byteSize, usage === 'static' ? gl.STATIC_DRAW : gl.DYNAMIC_DRAW);
		gl.bindBuffer(gl.UNIFORM_BUFFER, null);
		return buf;
	}

		updateUniformBuffer(buf: WebGLBuffer, data: ArrayBufferView, dstByteOffset = 0): void {
			const gl = this.gl;
			gl.bindBuffer(gl.UNIFORM_BUFFER, buf);
			gl.bufferSubData(gl.UNIFORM_BUFFER, dstByteOffset, data);
			gl.bindBuffer(gl.UNIFORM_BUFFER, null);
			this.accountUpload('uniform', data.byteLength);
		}

	bindUniformBufferBase(bindingIndex: number, buf: WebGLBuffer): void {
		const gl = this.gl;
		gl.bindBufferBase(gl.UNIFORM_BUFFER, bindingIndex, buf);
	}

	// --- Render state helpers ---
	setActiveTexture(unit: number): void {
		if (this.currentActiveTexUnit === unit) return;
		this.gl.activeTexture(this.gl.TEXTURE0 + unit);
		this.currentActiveTexUnit = unit;
	}
	bindTexture2D(tex: WebGLTexture): void {
		const unit = this.currentActiveTexUnit;
		if (this.boundTex2D[unit] === tex) return;
		this.gl.bindTexture(this.gl.TEXTURE_2D, tex);
		this.boundTex2D[unit] = tex;
	}
	bindTextureCube(tex: WebGLTexture): void {
		const unit = this.currentActiveTexUnit;
		if (this.boundTexCube[unit] === tex) return;
		this.gl.bindTexture(this.gl.TEXTURE_CUBE_MAP, tex);
		this.boundTexCube[unit] = tex;
	}
	// --- Uniform helpers ---
	private getCurrentProgramOrThrow(): WebGLProgram {
		const p = this.currentProgram ?? (this.gl.getParameter(this.gl.CURRENT_PROGRAM) as WebGLProgram);
		if (!p) throw new Error('No current program bound');
		this.currentProgram = p;
		return p;
	}
	getAttribLocation(name: string): number {
		const prog = this.getCurrentProgramOrThrow();
		let map = this.attribCache.get(prog);
		if (!map) { map = new Map(); this.attribCache.set(prog, map); }
		if (map.has(name)) return map.get(name)!;
		const loc = this.gl.getAttribLocation(prog, name);
		map.set(name, loc);
		return loc;
	}
	private getUniformLocationCached(name: string): WebGLUniformLocation {
		const prog = this.getCurrentProgramOrThrow();
		let map = this.uniformCache.get(prog);
		if (!map) { map = new Map(); this.uniformCache.set(prog, map); }
		if (map.has(name)) return map.get(name)!;
		const loc = this.gl.getUniformLocation(prog, name);
		map.set(name, loc);
		return loc;
	}
	setUniform1f(name: string, v: number): void {
		const loc = this.getUniformLocationCached(name); if (loc) this.gl.uniform1f(loc, v);
	}
	setUniform2f(name: string, x: number, y: number): void {
		const loc = this.getUniformLocationCached(name); if (loc) this.gl.uniform2f(loc, x, y);
	}
	setUniform1fv(name: string, data: Float32Array): void {
		const loc = this.getUniformLocationCached(name); if (loc) this.gl.uniform1fv(loc, data);
	}
	setUniform2fv(name: string, data: Float32Array): void {
		const loc = this.getUniformLocationCached(name); if (loc) this.gl.uniform2fv(loc, data);
	}
	setUniform1i(name: string, v: number): void {
		const loc = this.getUniformLocationCached(name); if (loc) this.gl.uniform1i(loc, v);
	}
	setUniform1ui(name: string, v: number): void {
		const loc = this.getUniformLocationCached(name); if (loc) this.gl.uniform1ui(loc, v);
	}
	setUniform3fv(name: string, data: Float32Array): void {
		const loc = this.getUniformLocationCached(name); if (loc) this.gl.uniform3fv(loc, data);
	}
	setUniformMatrix3fv(name: string, data: Float32Array): void {
		const loc = this.getUniformLocationCached(name); if (loc) this.gl.uniformMatrix3fv(loc, false, data);
	}
	setUniformMatrix4fv(name: string, data: Float32Array): void {
		const loc = this.getUniformLocationCached(name); if (loc) this.gl.uniformMatrix4fv(loc, false, data);
	}
	setUniform4f(name: string, x: number, y: number, z: number, w: number): void {
		const loc = this.getUniformLocationCached(name); if (loc) this.gl.uniform4f(loc, x, y, z, w);
	}
	setUniformBlockBinding(blockName: string, bindingIndex: number): void {
		const gl = this.gl;
		const prog = this.currentProgram ?? (gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram);
		if (!prog) return;
		const blockIndex = gl.getUniformBlockIndex(prog, blockName);
		const INVALID_INDEX = (gl.INVALID_INDEX ?? 0xFFFFFFFF);
		if (blockIndex === INVALID_INDEX) return;
		gl.uniformBlockBinding(prog, blockIndex, bindingIndex);
	}

	beginFrame(): void { this.frameStats.draws = this.frameStats.drawIndexed = this.frameStats.drawsInstanced = this.frameStats.drawIndexedInstanced = 0; this.frameStats.bytesUploaded = 0; this.frameStats.vertexBytes = 0; this.frameStats.indexBytes = 0; this.frameStats.uniformBytes = 0; this.frameStats.textureBytes = 0; }
	endFrame(): void { /* no-op for now */ }
	getFrameStats() {
		return this.frameStats;
	}
	captureGxGpuVramSnapshot(gxGpu: GxGpu): void {
		const output = gxGpu.readDeviceOutput();
		captureRenderedVramSnapshot(gxGpu, output);
	}
	accountUpload(kind: 'vertex' | 'index' | 'uniform' | 'texture', bytes: number): void {
		this.frameStats.bytesUploaded += bytes;
		switch (kind) {
			case 'vertex':
				this.frameStats.vertexBytes += bytes;
				break;
			case 'index':
				this.frameStats.indexBytes += bytes;
				break;
			case 'uniform':
				this.frameStats.uniformBytes += bytes;
				break;
			case 'texture':
				this.frameStats.textureBytes += bytes;
				break;
		}
	}

	// --- Cached buffer/VAO/state binds ---
	bindArrayBuffer(buf: WebGLBuffer): void {
		if (this.currentArrayBuffer === buf) return;
		this.gl.bindBuffer(this.gl.ARRAY_BUFFER, buf);
		this.currentArrayBuffer = buf;
	}
	bindElementArrayBuffer(buf: WebGLBuffer): void {
		if (this.currentElementArrayBuffer === buf) return;
		this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, buf);
		this.currentElementArrayBuffer = buf;
	}
	createVertexArray(): WebGLVertexArrayObject {
		const vao = this.gl.createVertexArray();
		if (!vao) throw new Error('Failed to create VAO');
		return vao;
	}
	bindVertexArray(vao: WebGLVertexArrayObject): void {
		// VAO switch changes the element-array binding association.
		// Invalidate cached ARRAY/ELEMENT_ARRAY buffers so subsequent
		// bind calls actually rebind for the new VAO.
		if (this.currentVAO === vao) return;
		this.gl.bindVertexArray(vao);
		this.currentVAO = vao;
		// In WebGL2, ELEMENT_ARRAY_BUFFER binding is stored per-VAO.
		// If we keep the cache, we might skip binding the index buffer
		// for a freshly bound VAO, leading to INVALID_OPERATION on draw.
		this.currentElementArrayBuffer = null;
		// ARRAY_BUFFER binding is global but used during vertexAttribPointer;
		// clearing avoids stale cache preventing intended binds during VAO setup.
		this.currentArrayBuffer = null;
	}
	deleteVertexArray(vao: WebGLVertexArrayObject): void {
		if (vao) this.gl.deleteVertexArray(vao);
	}

	setViewportRect(x: number, y: number, w: number, h: number): void {
		if (this.cachedViewportX === x && this.cachedViewportY === y && this.cachedViewportW === w && this.cachedViewportH === h) return;
		this.gl.viewport(x, y, w, h);
		this.cachedViewportX = x;
		this.cachedViewportY = y;
		this.cachedViewportW = w;
		this.cachedViewportH = h;
	}
	setCullEnabled(enabled: boolean): void {
		if (this.cachedCullEnabled === enabled) return;
		if (enabled) this.gl.enable(this.gl.CULL_FACE); else this.gl.disable(this.gl.CULL_FACE);
		this.cachedCullEnabled = enabled;
	}
	setDepthMask(write: boolean): void {
		if (this.cachedDepthMask === write) return;
		this.gl.depthMask(write);
		this.cachedDepthMask = write;
	}
	setDepthTestEnabled(enabled: boolean): void {
		if (this.cachedDepthTestEnabled === enabled) return;
		if (enabled) this.gl.enable(this.gl.DEPTH_TEST); else this.gl.disable(this.gl.DEPTH_TEST);
		this.cachedDepthTestEnabled = enabled;
	}
	setDepthFunc(func: number): void {
		if (this.cachedDepthFunc === func) return;
		this.gl.depthFunc(func);
		this.cachedDepthFunc = func;
	}
	setBlendEnabled(enabled: boolean): void {
		if (this.cachedBlendEnabled === enabled) return;
		if (enabled) this.gl.enable(this.gl.BLEND); else this.gl.disable(this.gl.BLEND);
		this.cachedBlendEnabled = enabled;
	}
	setBlendFunc(src: number, dst: number): void {
		const c = this.cachedBlendFunc;
		if (c && c.src === src && c.dst === dst) return;
		this.gl.blendFunc(src, dst);
		this.cachedBlendFunc = { src, dst };
	}
}
