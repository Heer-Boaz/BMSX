// Provides batched 2D sprite + primitive rendering using shared buffers.
import type { ImgMeta, vec2arr } from '../../rompack/rompack';
import spriteFS from '../2d/shaders/2d.frag.glsl';
import spriteVS from '../2d/shaders/2d.vert.glsl';
import * as GLR from '../backend/webgl/gl_resources';
import type { GPUBackend, RenderContext, RenderPassStateRegistry } from '../backend/pipeline_interfaces';
import { RenderPassLibrary } from '../backend/renderpasslib';
import { SpritesPipelineState } from '../backend/pipeline_interfaces';
import type { FrameSharedState } from '../backend/pipeline_interfaces';
import {
	ATLAS_ID_COMPONENTS,
	ATLAS_ID_SIZE,
	COLOR_OVERRIDE_COMPONENTS,
	COLOR_OVERRIDE_SIZE,
	DEFAULT_ZCOORD,
	MAX_SPRITES,
	POSITION_COMPONENTS,
	RESOLUTION_VECTOR_SIZE,
	SPRITE_DRAW_OFFSET,
	TEXCOORD_COMPONENTS,
	TEXTURE_UNIT_ATLAS_PRIMARY,
	TEXTURE_UNIT_ATLAS_SECONDARY,
	TEXTURE_UNIT_ATLAS_ENGINE,
	TEXTURECOORDS_SIZE,
	VERTICES_PER_SPRITE,
	ZCOORD_COMPONENTS,
	ZCOORD_MAX,
	ZCOORDS_SIZE
} from '../backend/webgl/webgl.constants';
import { ENGINE_ATLAS_TEXTURE_KEY } from 'bmsx/rompack/rompack';
import { $ } from '../../core/engine_core';
import { bvec } from './vertexutils2d';
import type { WebGLBackend } from '../backend/webgl/webgl_backend';
import { makePipelineBuildDesc, shaderModule } from '../backend/shader_module';
import { drainOverlayFrameIntoSpriteQueue } from '../../vm/vm_render_facade';
import type { LightingFrameState } from '../lighting/lightingsystem';
import {
	beginSpriteQueue,
	forEachSprite,
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
	spriteShaderScaleLocation = gl.getUniformLocation(spriteShaderProgram, 'u_scale');
}

export function setupDefaultUniformValues(backend: WebGLBackend, canvasSize: vec2arr): void {
	const gl = backend.gl;
	gl.useProgram(spriteShaderProgram);
	gl.uniform1f(spriteShaderScaleLocation, 1);
	spriteShaderData.resolutionVector[0] = canvasSize[0];
	spriteShaderData.resolutionVector[1] = canvasSize[1];
	gl.uniform2fv(resolutionLocation, spriteShaderData.resolutionVector);
	gl.uniform1i(texture0Location, TEXTURE_UNIT_ATLAS_PRIMARY);
	gl.uniform1i(texture1Location, TEXTURE_UNIT_ATLAS_SECONDARY);
	gl.uniform1i(texture2Location, TEXTURE_UNIT_ATLAS_ENGINE);
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

	const program = gl.getParameter(gl.CURRENT_PROGRAM);

	const u = (n: string) => gl.getUniformLocation(program, n);
	const set1f = (n: string, v: number) => { const loc = u(n); gl.uniform1f(loc, v); };

	// Legacy fallback uniform for shader paths where FrameUniforms.u_logicalSize is not available.
	spriteShaderData.resolutionVector[0] = state.baseWidth;
	spriteShaderData.resolutionVector[1] = state.baseHeight;
	gl.uniform2fv(resolutionLocation, spriteShaderData.resolutionVector);

	const ideScale = state.viewportTypeIde === 'viewport' ? 1 : (state.baseWidth / state.width);
	let currentScale = 1;
	const setScale = (scale: number) => {
		if (scale === currentScale) return;
		set1f('u_scale', scale);
		currentScale = scale;
	};

	// const opts = state.options;
	// const booleans: Array<[string, boolean]> = [
	// ];
	// for (const [name, val] of booleans) gl.uniform1i(u(name), val ? 1 : 0);

	if (state.atlasPrimaryTex) {
		context.activeTexUnit = TEXTURE_UNIT_ATLAS_PRIMARY;
		context.bind2DTex(state.atlasPrimaryTex);
	}
	if (state.atlasSecondaryTex) {
		context.activeTexUnit = TEXTURE_UNIT_ATLAS_SECONDARY;
		context.bind2DTex(state.atlasSecondaryTex);
	}
	if (state.atlasEngineTex) {
		context.activeTexUnit = TEXTURE_UNIT_ATLAS_ENGINE;
		context.bind2DTex(state.atlasEngineTex);
	}
	const vertexcoords = spriteShaderData.vertexcoords;
	if (!vertexcoords) return;
	const { texcoords, zcoords, color_override, atlas_id } = spriteShaderData;
	// Ambient sprites are disabled for now; when we have a more efficient path, reuse the block below.
	// const ambientFrameIntensity = state.ambientIntensity;
	// const ambientFrameColor = state.ambientColor;
	// const ambientMixR = ambientFrameColor[0] * ambientFrameIntensity;
	// const ambientMixG = ambientFrameColor[1] * ambientFrameIntensity;
	// const ambientMixB = ambientFrameColor[2] * ambientFrameIntensity;
	let i = 0;
	const flush = () => {
		if (i <= 0) return;
		updateBuffers(runtime, vertexcoords, texcoords, zcoords, color_override, atlas_id, i);
		const passStub = { fbo, desc: { label: 'sprites' } } as Parameters<GPUBackend['draw']>[0];
		backend.draw(passStub, SPRITE_DRAW_OFFSET, VERTICES_PER_SPRITE * i);
		i = 0;
	};
	forEachSprite(({ options, imgmeta }) => {
		const desiredScale = options.layer === 'ide' ? ideScale : 1;
		if (desiredScale !== currentScale) {
			flush();
			setScale(desiredScale);
		}
		const pos = options.pos;
		const flip = options.flip!;
		const scale = options.scale!;
		const colorize = options.colorize!;
		// Ambient sprites disabled for now; re-enable by using the mixing block below.
		// const layerIsOverlay = options.layer === 'ui' || options.layer === 'ide';
		// const ambientEnabled = !layerIsOverlay && (options.ambient_affected != null ? options.ambient_affected : state.ambientEnabledDefault);
		// const ambientFactorSprite = options.ambient_factor != null ? options.ambient_factor : state.ambientFactorDefault;
		// const ambientFactor = ambientEnabled ? ambientFactorSprite : 0;
		// const mixR = (1 - ambientFactor) + ambientFactor * ambientMixR;
		// const mixG = (1 - ambientFactor) + ambientFactor * ambientMixG;
		// const mixB = (1 - ambientFactor) + ambientFactor * ambientMixB;
		const { width, height } = imgmeta;
		bvec.set(vertexcoords, i, pos.x, pos.y, width, height, scale.x, scale.y);
		bvec.set_texturecoords(texcoords, i, getTexCoords(flip.flip_h, flip.flip_v, imgmeta));
		const zNorm = 1 - (pos.z ?? DEFAULT_ZCOORD) / ZCOORD_MAX;
		bvec.set_zcoord(zcoords, i, zNorm);
		bvec.set_color(color_override, i, colorize /* For ambient, use: { r: colorize.r * mixR, g: colorize.g * mixG, b: colorize.b * mixB, a: colorize.a } */);
		bvec.set_atlas_id(atlas_id, i, imgmeta.atlasid);
		++i;
		if (i >= MAX_SPRITES) { flush(); }
	});
	if (i > 0) { flush(); }
	backend.bindVertexArray(null);
	gl.depthMask(true);
}

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
	spriteCount: number,
): void {
	const { backend, gl } = runtime;
	const usedVertexFloats = spriteCount * VERTICES_PER_SPRITE * POSITION_COMPONENTS;
	const usedVertex = vertexcoords.subarray(0, usedVertexFloats);
	gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, usedVertex, gl.DYNAMIC_DRAW);
	backend.accountUpload('vertex', usedVertex.byteLength);

	const usedTex = texcoords.subarray(0, spriteCount * TEXTURECOORDS_SIZE);
	gl.bindBuffer(gl.ARRAY_BUFFER, texcoordBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, usedTex, gl.DYNAMIC_DRAW);
	backend.accountUpload('vertex', usedTex.byteLength);

	const usedZ = zcoords.subarray(0, spriteCount * ZCOORDS_SIZE);
	gl.bindBuffer(gl.ARRAY_BUFFER, zBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, usedZ, gl.DYNAMIC_DRAW);
	backend.accountUpload('vertex', usedZ.byteLength);

	const usedColor = color_override.subarray(0, spriteCount * COLOR_OVERRIDE_SIZE);
	gl.bindBuffer(gl.ARRAY_BUFFER, color_overrideBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, usedColor, gl.DYNAMIC_DRAW);
	backend.accountUpload('vertex', usedColor.byteLength);

	const usedAtlas = atlasid.subarray(0, spriteCount * ATLAS_ID_SIZE);
	gl.bindBuffer(gl.ARRAY_BUFFER, atlas_idBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, usedAtlas, gl.DYNAMIC_DRAW);
	backend.accountUpload('vertex', usedAtlas.byteLength);
}

export function registerSpritesPass_WebGL(registry: RenderPassLibrary): void {
	registry.register({
		id: 'sprites',
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
			setupDefaultUniformValues(backend, [$.view.viewportSize.x, $.view.viewportSize.y]);
		},
		writesDepth: true,
		shouldExecute: () => true,
		exec: (backend: WebGLBackend, fbo, state: SpritesPipelineState) => {
			const runtime: SpriteRuntime = { backend, gl: backend.gl, context: $.view };
			drainOverlayFrameIntoSpriteQueue();
			renderSpriteBatch(runtime, fbo, state);
		},
		prepare: (backend: GPUBackend, _state: RenderPassStateRegistry['sprites']) => {
			const gv = $.view;
			const width = gv.offscreenCanvasSize.x;
			const height = gv.offscreenCanvasSize.y;
			const baseWidth = gv.viewportSize.x;
			const baseHeight = gv.viewportSize.y;
			const frameShared = registry.getState('frame_shared') as FrameSharedState | undefined;
			const lighting = frameShared?.lighting as LightingFrameState | undefined;
			const ambient = lighting?.ambient;
			const ambientColor: [number, number, number] = ambient ? [ambient.color[0], ambient.color[1], ambient.color[2]] : [0, 0, 0];
			const ambientIntensity = ambient?.intensity ?? 0;
			const atlasTexture = gv.textures['_atlas_primary'];
			if (!atlasTexture) {
				throw new Error("[SpritesPipeline] Texture '_atlas_primary' missing from view textures.");
			}
			const secondaryAtlasTexture = gv.textures['_atlas_secondary'];
			const engineAtlasTexture = gv.textures[ENGINE_ATLAS_TEXTURE_KEY];
			const spriteState: RenderPassStateRegistry['sprites'] = {
				width,
				height,
				baseWidth,
				baseHeight,
				// Provide atlas textures for direct binding in render step when needed
				atlasPrimaryTex: atlasTexture,
				atlasSecondaryTex: secondaryAtlasTexture,
				atlasEngineTex: engineAtlasTexture,
				ambientEnabledDefault: gv.spriteAmbientEnabledDefault,
				ambientFactorDefault: gv.spriteAmbientFactorDefault,
				ambientColor,
				ambientIntensity,
				viewportTypeIde: gv.viewportTypeIde,
			};
			registry.setState('sprites', spriteState);
			// Validate binding layout vs resources
			registry.validatePassResources('sprites', backend);
		},
	});
}
