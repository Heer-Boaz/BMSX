// Sprites pipeline (formerly glview.2d) inlined from legacy module.
// Provides batched 2D sprite + primitive rendering using shared buffers.
import { new_vec2, new_vec3 } from '../../utils/vector_operations';
import type { ImgMeta, Polygon, vec2arr } from '../../rompack/rompack';
import spriteFS from '../2d/shaders/2d.frag.glsl';
import spriteVS from '../2d/shaders/2d.vert.glsl';
import * as GLR from '../backend/webgl/gl_resources';
import type { GPUBackend, RenderContext } from '../backend/pipeline_interfaces';
import { RenderPassLibrary } from '../backend/renderpasslib';
import { SpritesPipelineState } from '../backend/pipeline_interfaces';
import { updateAndBindFrameUniforms } from '../backend/frame_uniforms';
import {
	ATLAS_ID_BUFFER_OFFSET_MULTIPLIER,
	ATLAS_ID_COMPONENTS,
	ATLAS_ID_SIZE,
	COLOR_OVERRIDE_BUFFER_OFFSET_MULTIPLIER,
	COLOR_OVERRIDE_COMPONENTS,
	COLOR_OVERRIDE_SIZE,
	DEFAULT_VERTEX_COLOR,
	DEFAULT_ZCOORD,
	MAX_SPRITES,
	POSITION_COMPONENTS,
	RESOLUTION_VECTOR_SIZE,
	SPRITE_DRAW_OFFSET,
	TEXCOORD_COMPONENTS,
	TEXTURE_UNIT_ATLAS,
	TEXTURE_UNIT_ATLAS_DYNAMIC,
	TEXTURE_UNIT_ATLAS_ENGINE,
	TEXTURECOORDS_SIZE,
	VERTEX_BUFFER_OFFSET_MULTIPLIER,
	VERTICES_PER_SPRITE,
	ZCOORD_BUFFER_OFFSET_MULTIPLIER,
	ZCOORD_COMPONENTS,
	ZCOORD_MAX,
	ZCOORDS_SIZE
} from '../backend/webgl/webgl.constants';
import { color, ImgRenderSubmission, RectRenderSubmission, GameView, type RenderLayer } from '../gameview';
import { ENGINE_ATLAS_TEXTURE_KEY } from '../gameview';
import { $ } from '../../core/game';
import { bvec } from './vertexutils2d';
import type { WebGLBackend } from '../backend/webgl/webgl_backend';
import { makePipelineBuildDesc, shaderModule } from '../backend/shader_module';
import { drainOverlayFrameIntoSpriteQueue } from '../../console/console_render_facade';
import {
	beginSpriteQueue,
	forEachSprite,
	sortSpriteQueue,
	spriteQueueBackSize,
	spriteQueueFrontSize,
	submitSprite as enqueueSprite,
} from '../shared/render_queues';

export let spriteShaderProgram: WebGLProgram;
let vertexLocation: number;
let texcoordLocation: number;
let zcoordLocation: number;
let color_overrideLocation: number;
let atlas_idLocation: number;
let resolutionLocation: WebGLUniformLocation;
let texture0Location: WebGLUniformLocation;
let texture1Location: WebGLUniformLocation;
let texture2Location: WebGLUniformLocation;
let spriteAmbientEnabledLocation: WebGLUniformLocation;
let spriteAmbientFactorLocation: WebGLUniformLocation;
let vertexBuffer: WebGLBuffer;
let texcoordBuffer: WebGLBuffer;
let zBuffer: WebGLBuffer;
let color_overrideBuffer: WebGLBuffer;
let atlas_idBuffer: WebGLBuffer;
let spriteVAO: WebGLVertexArrayObject = null;
const spriteShaderData = {
	resolutionVector: new Float32Array(RESOLUTION_VECTOR_SIZE),
	vertexcoords: null as Float32Array, // Lazy init to avoid circular dependency timing with backend
	texcoords: new Float32Array(TEXTURECOORDS_SIZE * MAX_SPRITES),
	zcoords: new Float32Array(ZCOORDS_SIZE * MAX_SPRITES),
	color_override: new Float32Array(COLOR_OVERRIDE_SIZE * MAX_SPRITES),
	atlas_id: new Uint8Array(ATLAS_ID_SIZE * MAX_SPRITES),
};
let spriteShaderScaleLocation: WebGLUniformLocation;

interface SpriteRuntime {
	backend: WebGLBackend;
	gl: WebGL2RenderingContext;
	context: RenderContext;
}

export function setupSpriteShaderLocations(backend: GPUBackend): void {
	const gl = (backend as WebGLBackend).gl;
	// If program not explicitly created yet, pick up the program bound by the PipelineManager
	if (!spriteShaderProgram) {
		const current = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram;
		if (!current) throw new Error('Sprite shader program not bound during bootstrap');
		spriteShaderProgram = current;
	}
	const locations = {
		vertex: gl.getAttribLocation(spriteShaderProgram, 'a_position'),
		texcoord: gl.getAttribLocation(spriteShaderProgram, 'a_texcoord'),
		zcoord: gl.getAttribLocation(spriteShaderProgram, 'a_pos_z'),
		color_override: gl.getAttribLocation(spriteShaderProgram, 'a_color_override'),
		atlas_id: gl.getAttribLocation(spriteShaderProgram, 'a_atlas_id'),
	};
	vertexLocation = locations.vertex;
	texcoordLocation = locations.texcoord;
	zcoordLocation = locations.zcoord;
	color_overrideLocation = locations.color_override;
	atlas_idLocation = locations.atlas_id;
	resolutionLocation = gl.getUniformLocation(spriteShaderProgram, 'u_resolution')!;
	texture0Location = gl.getUniformLocation(spriteShaderProgram, 'u_texture0')!;
	texture1Location = gl.getUniformLocation(spriteShaderProgram, 'u_texture1')!;
	texture2Location = gl.getUniformLocation(spriteShaderProgram, 'u_texture2')!;
	texture2Location = gl.getUniformLocation(spriteShaderProgram, 'u_texture2')!;
	spriteAmbientEnabledLocation = gl.getUniformLocation(spriteShaderProgram, 'u_spriteAmbientEnabled')!;
	spriteAmbientFactorLocation = gl.getUniformLocation(spriteShaderProgram, 'u_spriteAmbientFactor')!;
	spriteShaderScaleLocation = gl.getUniformLocation(spriteShaderProgram, 'u_scale');
}

export function setupDefaultUniformValues(backend: WebGLBackend, defaultScale: number, canvasSize: vec2arr): void {
	const gl = backend.gl;
	gl.useProgram(spriteShaderProgram);
	gl.uniform1f(spriteShaderScaleLocation, defaultScale);
	spriteShaderData.resolutionVector.set([canvasSize[0], canvasSize[1]]);
	gl.uniform2fv(resolutionLocation, spriteShaderData.resolutionVector);
	gl.uniform1i(texture0Location, TEXTURE_UNIT_ATLAS);
	gl.uniform1i(texture1Location, TEXTURE_UNIT_ATLAS_DYNAMIC);
	gl.uniform1i(texture2Location, TEXTURE_UNIT_ATLAS_ENGINE);
	gl.uniform1i(spriteAmbientEnabledLocation, 0);
	gl.uniform1f(spriteAmbientFactorLocation, 1.0);
}

export function setupBuffers(backend: WebGLBackend): void {
	const gl = backend.gl;
	if (!spriteShaderData.vertexcoords) spriteShaderData.vertexcoords = GLR.buildQuadTexCoords();
	const cvertexBuffer = GLR.glCreateBuffer(gl, spriteShaderData.vertexcoords);
	const ctexcoordBuffer = GLR.glCreateBuffer(gl, spriteShaderData.texcoords);
	const czBuffer = GLR.glCreateBuffer(gl, spriteShaderData.zcoords);
	const ccolor_overrideBuffer = GLR.glCreateBuffer(gl, spriteShaderData.color_override);
	const catlas_idBuffer = GLR.glCreateBuffer(gl, spriteShaderData.atlas_id);
	vertexBuffer = cvertexBuffer;
	texcoordBuffer = ctexcoordBuffer;
	zBuffer = czBuffer;
	color_overrideBuffer = ccolor_overrideBuffer;
	atlas_idBuffer = catlas_idBuffer;
}

export function setupSpriteLocations(backend: WebGLBackend): void {
	// Program is bound by the backend; prefer VAO to avoid per-frame attrib churn
	const gl = backend.gl;
	const vao = backend.createVertexArray() as WebGLVertexArrayObject;
	backend.bindVertexArray(vao);
	backend.bindArrayBuffer(vertexBuffer);
	backend.enableVertexAttrib(vertexLocation);
	backend.vertexAttribPointer(vertexLocation, POSITION_COMPONENTS, gl.FLOAT, false, 0, 0);
	backend.bindArrayBuffer(texcoordBuffer);
	backend.enableVertexAttrib(texcoordLocation);
	backend.vertexAttribPointer(texcoordLocation, TEXCOORD_COMPONENTS, gl.FLOAT, false, 0, 0);
	backend.bindArrayBuffer(zBuffer);
	backend.enableVertexAttrib(zcoordLocation);
	backend.vertexAttribPointer(zcoordLocation, ZCOORD_COMPONENTS, gl.FLOAT, false, 0, 0);
	backend.bindArrayBuffer(color_overrideBuffer);
	backend.enableVertexAttrib(color_overrideLocation);
	backend.vertexAttribPointer(color_overrideLocation, COLOR_OVERRIDE_COMPONENTS, gl.FLOAT, false, 0, 0);
	backend.bindArrayBuffer(atlas_idBuffer);
	backend.enableVertexAttrib(atlas_idLocation);
	backend.vertexAttribIPointer(atlas_idLocation, ATLAS_ID_COMPONENTS, gl.UNSIGNED_BYTE, 0, 0);
	backend.bindVertexArray(null);
	spriteVAO = vao;
}

// Note: 'fbo' is provided by the render graph and used only to satisfy the
// PassEncoder shape for backend.draw(). WebGL draw ignores it; WebGPU may use it.
export function renderSpriteBatch(runtime: SpriteRuntime, fbo: unknown, state: SpritesPipelineState): void {
	const { backend, gl, context } = runtime;
	const spriteCount = beginSpriteQueue();
	if (spriteCount === 0) return;
	backend.setViewport({ x: 0, y: 0, w: state.width, h: state.height });
	gl.enable(gl.BLEND);
	gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
	gl.depthMask(false);
	backend.bindVertexArray(spriteVAO as WebGLVertexArrayObject);
	setupDefaultUniformValues(backend, 1.0, [state.baseWidth, state.baseHeight]);
	if (state.atlasTex) {
		context.activeTexUnit = TEXTURE_UNIT_ATLAS;
		context.bind2DTex(state.atlasTex);
	}
	if (state.atlasDynamicTex) {
		context.activeTexUnit = TEXTURE_UNIT_ATLAS_DYNAMIC;
		context.bind2DTex(state.atlasDynamicTex);
	}
	if (state.atlasEngineTex) {
		context.activeTexUnit = TEXTURE_UNIT_ATLAS_ENGINE;
		context.bind2DTex(state.atlasEngineTex);
	}
	const q = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 100) / 100;
	const layerWeight = (layer?: RenderLayer) => {
		if (layer === 'ide') return 2;
		if (layer === 'ui') return 1;
		return 0;
	};
	sortSpriteQueue((a, b) => {
		const la = layerWeight(a.options.layer);
		const lb = layerWeight(b.options.layer);
		if (la !== lb) return la - lb;
		const za = a.options.pos.z ?? 0; const zb = b.options.pos.z ?? 0;
		if (za !== zb) return za - zb;
		const ae = (a.options.ambient_affected ? 1 : 0);
		const be = (b.options.ambient_affected ? 1 : 0);
		if (ae !== be) return ae - be;
		const af = q(a.options.ambient_factor ?? state.ambientFactorDefault);
		const bf = q(b.options.ambient_factor ?? state.ambientFactorDefault);
		if (af !== bf) return af - bf;
		return 0;
	});
	const vertexcoords = spriteShaderData.vertexcoords;
	if (!vertexcoords) return;
	const { texcoords, zcoords, color_override, atlas_id } = spriteShaderData;
	let i = 0;
	let currentAmbientEnabled: number = null;
	let currentAmbientFactor = 1.0;
	const flush = () => {
		if (i <= 0) return;
		updateBuffers(runtime, vertexcoords, texcoords, zcoords, color_override, atlas_id, 0);
		gl.uniform1i(spriteAmbientEnabledLocation, currentAmbientEnabled ?? 0);
		gl.uniform1f(spriteAmbientFactorLocation, currentAmbientFactor);
		const passStub = { fbo, desc: { label: 'sprites' } } as Parameters<GPUBackend['draw']>[0];
		backend.draw(passStub, SPRITE_DRAW_OFFSET, VERTICES_PER_SPRITE * i);
		i = 0;
	};
	const ambientDefaultEnabled = state.ambientEnabledDefault ? 1 : 0;
	forEachSprite(({ options, imgmeta }) => {
		const { pos, flip = { flip_h: false, flip_v: false }, scale = { x: 1, y: 1 }, colorize = DEFAULT_VERTEX_COLOR } = options;
		const layerIsOverlay = options.layer === 'ui' || options.layer === 'ide';
		const ambE = layerIsOverlay ? 0 : (options.ambient_affected != null ? (options.ambient_affected ? 1 : 0) : ambientDefaultEnabled);
		const ambF = q(options.ambient_factor != null ? options.ambient_factor : state.ambientFactorDefault);
		if (currentAmbientEnabled === null) { currentAmbientEnabled = ambE; currentAmbientFactor = ambF; }
		else if (ambE !== currentAmbientEnabled || Math.abs(ambF - currentAmbientFactor) > 1e-3) { flush(); currentAmbientEnabled = ambE; currentAmbientFactor = ambF; }
		const { width, height } = imgmeta;
		bvec.set(vertexcoords, i, pos.x, pos.y, width, height, scale.x, scale.y);
		bvec.set_texturecoords(texcoords, i, getTexCoords(flip.flip_h, flip.flip_v, imgmeta));
		const zNorm = 1 - (pos.z ?? DEFAULT_ZCOORD) / ZCOORD_MAX;
		bvec.set_zcoord(zcoords, i, zNorm);
		bvec.set_color(color_override, i, colorize);
		bvec.set_atlas_id(atlas_id, i, imgmeta.atlasid);
		++i;
		if (i >= MAX_SPRITES) { flush(); }
	});
	if (i > 0) { flush(); }
	backend.bindVertexArray(null);
	gl.depthMask(true);
}

export function drawImg(options: ImgRenderSubmission): void {
	const { imgid } = options;
	if (imgid === 'none') return;
	const asset = GameView.imgassets[imgid];
	if (!asset) {
		throw new Error(`[Sprite Pipeline] drawImg called with unknown image id '${imgid}'.`);
	}
	const imgmeta = asset.imgmeta;
	if (!imgmeta) {
		throw new Error(`[Sprite Pipeline] Image metadata missing for imgid '${imgid}'.`);
	}
	// Deep-copy nested objects to freeze values at submission time
	enqueueSprite({
		options: {
			...options,
			pos: options.pos ? { ...options.pos } : undefined,
			scale: options.scale ? { ...options.scale } : undefined,
			colorize: options.colorize ? { ...options.colorize } : undefined,
			flip: options.flip ? { ...options.flip } : undefined,
		},
		imgmeta,
	});
}

export function getQueuedSpriteCount(): number { return spriteQueueBackSize(); }
export function getSpriteQueueDebug(): { front: number; back: number } { return { front: spriteQueueFrontSize(), back: spriteQueueBackSize() }; }

export function getTexCoords(flip_h: boolean, flip_v: boolean, imgmeta: ImgMeta): number[] {
	if (flip_h && flip_v) return imgmeta['texcoords_fliphv'];
	if (flip_h) return imgmeta['texcoords_fliph'];
	if (flip_v) return imgmeta['texcoords_flipv'];
	return imgmeta['texcoords'];
}

export function updateBuffers(
	runtime: SpriteRuntime,
	vertexcoords: Float32Array,
	texcoords: Float32Array,
	zcoords: Float32Array,
	color_override: Float32Array,
	atlasid: Uint8Array,
	index: number,
): void {
	// Orphan + upload pattern to avoid driver stalls on mobile GPUs.
	const { backend, gl } = runtime;
	gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, vertexcoords.byteLength, gl.DYNAMIC_DRAW);
	gl.bufferSubData(gl.ARRAY_BUFFER, VERTEX_BUFFER_OFFSET_MULTIPLIER * index, vertexcoords);
	backend.accountUpload('vertex', vertexcoords.byteLength);

	gl.bindBuffer(gl.ARRAY_BUFFER, texcoordBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, texcoords.byteLength, gl.DYNAMIC_DRAW);
	gl.bufferSubData(gl.ARRAY_BUFFER, VERTEX_BUFFER_OFFSET_MULTIPLIER * index, texcoords);
	backend.accountUpload('vertex', texcoords.byteLength);

	gl.bindBuffer(gl.ARRAY_BUFFER, zBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, zcoords.byteLength, gl.DYNAMIC_DRAW);
	gl.bufferSubData(gl.ARRAY_BUFFER, ZCOORD_BUFFER_OFFSET_MULTIPLIER * index, zcoords);
	backend.accountUpload('vertex', zcoords.byteLength);

	gl.bindBuffer(gl.ARRAY_BUFFER, color_overrideBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, color_override.byteLength, gl.DYNAMIC_DRAW);
	gl.bufferSubData(gl.ARRAY_BUFFER, COLOR_OVERRIDE_BUFFER_OFFSET_MULTIPLIER * index, color_override);
	backend.accountUpload('vertex', color_override.byteLength);

	gl.bindBuffer(gl.ARRAY_BUFFER, atlas_idBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, atlasid.byteLength, gl.DYNAMIC_DRAW);
	gl.bufferSubData(gl.ARRAY_BUFFER, ATLAS_ID_BUFFER_OFFSET_MULTIPLIER * index, atlasid);
	backend.accountUpload('vertex', atlasid.byteLength);
}

export function correctAreaStartEnd(x: number, y: number, ex: number, ey: number): [number, number, number, number] {
	if (ex < x) { [x, ex] = [ex, x]; }
	if (ey < y) { [y, ey] = [ey, y]; }
	return [x, y, ex, ey];
}

export function drawRectangle(options: RectRenderSubmission): void {
	let { start: { x, y, z }, end: { x: ex, y: ey } } = options.area; const c = options.color; const imgid = 'whitepixel';[x, y, ex, ey] = correctAreaStartEnd(x, y, ex, ey);
	drawImg({ pos: new_vec3(x, y, z), imgid, scale: new_vec2(ex - x, 1), colorize: c, layer: options.layer });
	drawImg({ pos: new_vec3(x, ey, z), imgid, scale: new_vec2(ex - x, 1), colorize: c, layer: options.layer });
	drawImg({ pos: new_vec3(x, y, z), imgid, scale: new_vec2(1, ey - y), colorize: c, layer: options.layer });
	drawImg({ pos: new_vec3(ex, y, z), imgid, scale: new_vec2(1, ey - y), colorize: c, layer: options.layer });
}

export function fillRectangle(options: RectRenderSubmission): void {
	let { start: { x, y, z }, end: { x: ex, y: ey } } = options.area; const c = options.color; const imgid = 'whitepixel';[x, y, ex, ey] = correctAreaStartEnd(x, y, ex, ey);
	drawImg({ pos: new_vec3(x, y, z), imgid, scale: new_vec2(ex - x, ey - y), colorize: c, layer: options.layer });
}

export function drawPolygon(coords: Polygon, z: number, color: color, thickness: number = 1, layer?: RenderLayer): void {
	if (!coords || coords.length < 4) return; const imgid = 'whitepixel';
	for (let i = 0; i < coords.length; i += 2) {
		let x0 = Math.round(coords[i]), y0 = Math.round(coords[i + 1]); const next = (i + 2) % coords.length; let x1 = Math.round(coords[next]), y1 = Math.round(coords[next + 1]);
		const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0); const sx = x0 < x1 ? 1 : -1; const sy = y0 < y1 ? 1 : -1; let err = dx - dy;
		if (dx > dy) {
			while (true) {
				drawImg({ pos: new_vec3(x0, y0, z), imgid, scale: new_vec2(thickness, thickness), colorize: color, layer }); if (x0 === x1 && y0 === y1) break; const e2 = 2 * err; if (e2 > -dy) { err -= dy; x0 += sx; } if (x0 === x1 && y0 === y1) { drawImg({ pos: new_vec3(x0, y0, z), imgid, scale: new_vec2(thickness, thickness), colorize: color, layer }); break; } if (e2 < dx) { err += dx; y0 += sy; }
			}
		} else {
			while (true) {
				drawImg({ pos: new_vec3(x0, y0, z), imgid, scale: new_vec2(thickness, thickness), colorize: color, layer }); if (x0 === x1 && y0 === y1) break; const e2 = 2 * err; if (e2 > -dy) { err -= dy; x0 += sx; } if (x0 === x1 && y0 === y1) { drawImg({ pos: new_vec3(x0, y0, z), imgid, scale: new_vec2(thickness, thickness), colorize: color, layer }); break; } if (e2 < dx) { err += dx; y0 += sy; }
			}
		}
	}
}

export function registerSpritesPass_WebGL(registry: RenderPassLibrary): void {
	registry.register({
		id: 'sprites',
		label: 'sprites',
		name: 'Sprites2D',
		...(() => {
			const vs = shaderModule(spriteVS, { uniforms: ['FrameUniforms'] }, 'sprites-vs');
			const fs = shaderModule(
				spriteFS,
				{
					uniforms: ['FrameUniforms'],
					textures: [{ name: 'u_texture0' }, { name: 'u_texture1' }, { name: 'u_texture2' }],
					samplers: [{ name: 's_texture0' }, { name: 's_texture1' }, { name: 's_texture2' }]
				},
				'sprites-fs'
			);
			const build = makePipelineBuildDesc('Sprites2D', vs, fs);
			return { vsCode: build.vsCode, fsCode: build.fsCode, bindingLayout: build.bindingLayout };
		})(),
		bootstrap: (backend: WebGLBackend) => {
			const webglBackend = backend;
			setupSpriteShaderLocations(webglBackend);
			setupBuffers(webglBackend);
			setupSpriteLocations(webglBackend);
		},
		writesDepth: true,
		shouldExecute: () => true,
		exec: (backend: WebGLBackend, fbo, state: SpritesPipelineState) => {
			const runtime: SpriteRuntime = { backend, gl: backend.gl, context: $.view };
			drainOverlayFrameIntoSpriteQueue();
			updateAndBindFrameUniforms(backend, {
				offscreen: { x: state.width, y: state.height },
				logical: { x: $.view.viewportSize.x, y: $.view.viewportSize.y },
			});
			renderSpriteBatch(runtime, fbo, state);
		},
		prepare: (backend, _state) => {
			const gv = $.view;
			const width = gv.offscreenCanvasSize.x;
			const height = gv.offscreenCanvasSize.y;
			const baseWidth = gv.viewportSize.x;
			const baseHeight = gv.viewportSize.y;
			const atlasTexture = gv.textures['_atlas'];
			if (!atlasTexture) {
				throw new Error("[SpritesPipeline] Texture '_atlas' missing from view textures.");
			}
			const dynamicAtlasTexture = gv.textures['_atlas_dynamic'];
			const engineAtlasTexture = gv.textures[ENGINE_ATLAS_TEXTURE_KEY];
			const spriteState: SpritesPipelineState = {
				width,
				height,
				baseWidth,
				baseHeight,
				// Provide atlas textures for direct binding in render step when needed
				atlasTex: atlasTexture,
				atlasDynamicTex: dynamicAtlasTexture,
				atlasEngineTex: engineAtlasTexture,
				ambientEnabledDefault: gv.spriteAmbientEnabledDefault,
				ambientFactorDefault: gv.spriteAmbientFactorDefault,
				viewportTypeIde: gv.viewportTypeIde,
			};
			registry.setState('sprites', spriteState);
			// Validate binding layout vs resources
			registry.validatePassResources('sprites', backend);
		},
	});
}
