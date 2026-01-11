// Provides batched 2D sprite + primitive rendering using shared buffers.
import type { ImgMeta } from '../../rompack/rompack';
import spriteFS from '../2d/shaders/2d.frag.glsl';
import spriteVS from '../2d/shaders/2d.vert.glsl';
import type { GPUBackend, RenderContext, RenderPassStateRegistry } from '../backend/pipeline_interfaces';
import { RenderPassLibrary } from '../backend/renderpasslib';
import { SpritesPipelineState } from '../backend/pipeline_interfaces';
import type { FrameSharedState } from '../backend/pipeline_interfaces';
import {
	DEFAULT_ZCOORD,
	MAX_SPRITES,
	SPRITE_DRAW_OFFSET,
	TEXTURE_UNIT_ATLAS_PRIMARY,
	TEXTURE_UNIT_ATLAS_SECONDARY,
	TEXTURE_UNIT_ATLAS_ENGINE,
	VERTICES_PER_SPRITE,
	ZCOORD_MAX,
} from '../backend/webgl/webgl.constants';
import { ENGINE_ATLAS_TEXTURE_KEY } from 'bmsx/rompack/rompack';
import { $ } from '../../core/engine_core';
import type { WebGLBackend } from '../backend/webgl/webgl_backend';
import { makePipelineBuildDesc, shaderModule } from '../backend/shader_module';
import { drainOverlayFrameIntoSpriteQueue } from '../../vm/vm_render_facade';
import type { LightingFrameState } from '../lighting/lightingsystem';
import { clamp } from '../../utils/clamp';
import {
	beginSpriteQueue,
	forEachSprite,
	spriteParallaxRig,
} from '../shared/render_queues';

const SPRITE_INSTANCE_STRIDE = 40;
const SPRITE_INSTANCE_FLOAT_STRIDE = SPRITE_INSTANCE_STRIDE / 4;
const SPRITE_INSTANCE_POS_OFFSET = 0;
const SPRITE_INSTANCE_SIZE_OFFSET = 8;
const SPRITE_INSTANCE_UV0_OFFSET = 16;
const SPRITE_INSTANCE_UV1_OFFSET = 24;
const SPRITE_INSTANCE_Z_OFFSET = 32;
const SPRITE_INSTANCE_ATLAS_OFFSET = 34;
const SPRITE_INSTANCE_FX_OFFSET = 35;
const SPRITE_INSTANCE_COLOR_OFFSET = 36;

const SPRITE_CORNER_DATA = new Float32Array([
	0, 0,
	0, 1,
	1, 0,
	1, 0,
	0, 1,
	1, 1,
]);

const MAX_U16 = 0xffff;
const MAX_U8 = 0xff;
const MAX_S8 = 0x7f;

const packUnorm8 = (value: number) => Math.round(clamp(value, 0, 1) * MAX_U8);
const packUnorm16 = (value: number) => Math.round(clamp(value, 0, 1) * MAX_U16);
const packSnorm8 = (value: number) => Math.round(clamp(value, -1, 1) * MAX_S8);

export let spriteShaderProgram: WebGLProgram;
let cornerLocation: number;
let instPosLocation: number;
let instSizeLocation: number;
let instUv0Location: number;
let instUv1Location: number;
let instZLocation: number;
let instAtlasLocation: number;
let instFxLocation: number;
let instColorLocation: number;
let texture0Location: WebGLUniformLocation;
let texture1Location: WebGLUniformLocation;
let texture2Location: WebGLUniformLocation;
let cornerBuffer: WebGLBuffer;
let instanceBuffer: WebGLBuffer;
let spriteVAO: WebGLVertexArrayObject = null;
const spriteInstanceData = new ArrayBuffer(SPRITE_INSTANCE_STRIDE * MAX_SPRITES);
const spriteShaderData = {
	instanceF32: new Float32Array(spriteInstanceData),
	instanceU16: new Uint16Array(spriteInstanceData),
	instanceU8: new Uint8Array(spriteInstanceData),
	instanceS8: new Int8Array(spriteInstanceData),
};
let spriteShaderScaleLocation: WebGLUniformLocation;
let spriteShaderParallaxRigLocation: WebGLUniformLocation;
let spriteShaderParallaxRig2Location: WebGLUniformLocation;
let spriteShaderParallaxFlipWindowLocation: WebGLUniformLocation;

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
		corner: gl.getAttribLocation(spriteShaderProgram, 'a_corner'),
		inst_pos: gl.getAttribLocation(spriteShaderProgram, 'i_pos'),
		inst_size: gl.getAttribLocation(spriteShaderProgram, 'i_size'),
		inst_uv0: gl.getAttribLocation(spriteShaderProgram, 'i_uv0'),
		inst_uv1: gl.getAttribLocation(spriteShaderProgram, 'i_uv1'),
		inst_z: gl.getAttribLocation(spriteShaderProgram, 'i_z'),
		inst_atlas: gl.getAttribLocation(spriteShaderProgram, 'i_atlas_id'),
		inst_fx: gl.getAttribLocation(spriteShaderProgram, 'i_fx'),
		inst_color: gl.getAttribLocation(spriteShaderProgram, 'i_color'),
	};
	cornerLocation = locations.corner;
	instPosLocation = locations.inst_pos;
	instSizeLocation = locations.inst_size;
	instUv0Location = locations.inst_uv0;
	instUv1Location = locations.inst_uv1;
	instZLocation = locations.inst_z;
	instAtlasLocation = locations.inst_atlas;
	instFxLocation = locations.inst_fx;
	instColorLocation = locations.inst_color;
	texture0Location = gl.getUniformLocation(spriteShaderProgram, 'u_texture0')!;
	texture1Location = gl.getUniformLocation(spriteShaderProgram, 'u_texture1')!;
	texture2Location = gl.getUniformLocation(spriteShaderProgram, 'u_texture2')!;
	spriteShaderScaleLocation = gl.getUniformLocation(spriteShaderProgram, 'u_scale');
	spriteShaderParallaxRigLocation = gl.getUniformLocation(spriteShaderProgram, 'u_parallax_rig')!;
	spriteShaderParallaxRig2Location = gl.getUniformLocation(spriteShaderProgram, 'u_parallax_rig2')!;
	spriteShaderParallaxFlipWindowLocation = gl.getUniformLocation(spriteShaderProgram, 'u_parallax_flip_window')!;
}

export function setupDefaultUniformValues(backend: WebGLBackend): void {
	const gl = backend.gl;
	gl.useProgram(spriteShaderProgram);
	gl.uniform1f(spriteShaderScaleLocation, 1);
	gl.uniform4f(spriteShaderParallaxRigLocation, 0, 1, 0, 0);
	gl.uniform4f(spriteShaderParallaxRig2Location, 0, 1, 1, 0);
	gl.uniform1f(spriteShaderParallaxFlipWindowLocation, 0.6);
	gl.uniform1i(texture0Location, TEXTURE_UNIT_ATLAS_PRIMARY);
	gl.uniform1i(texture1Location, TEXTURE_UNIT_ATLAS_SECONDARY);
	gl.uniform1i(texture2Location, TEXTURE_UNIT_ATLAS_ENGINE);
}

export function setupBuffers(backend: WebGLBackend): void {
	const gl = backend.gl;
	cornerBuffer = gl.createBuffer()!;
	gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, SPRITE_CORNER_DATA, gl.STATIC_DRAW);
	backend.accountUpload('vertex', SPRITE_CORNER_DATA.byteLength);

	instanceBuffer = gl.createBuffer()!;
	gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, SPRITE_INSTANCE_STRIDE * MAX_SPRITES, gl.DYNAMIC_DRAW);
}

export function setupSpriteLocations(backend: WebGLBackend): void {
	// Program is bound by the backend; prefer VAO to avoid per-frame attrib churn
	const gl = backend.gl;
	const vao = backend.createVertexArray() as WebGLVertexArrayObject;
	backend.bindVertexArray(vao);
	backend.bindArrayBuffer(cornerBuffer);
	backend.enableVertexAttrib(cornerLocation);
	backend.vertexAttribPointer(cornerLocation, 2, gl.FLOAT, false, 0, 0);

	backend.bindArrayBuffer(instanceBuffer);
	backend.enableVertexAttrib(instPosLocation);
	backend.vertexAttribPointer(instPosLocation, 2, gl.FLOAT, false, SPRITE_INSTANCE_STRIDE, SPRITE_INSTANCE_POS_OFFSET);
	backend.vertexAttribDivisor(instPosLocation, 1);

	backend.enableVertexAttrib(instSizeLocation);
	backend.vertexAttribPointer(instSizeLocation, 2, gl.FLOAT, false, SPRITE_INSTANCE_STRIDE, SPRITE_INSTANCE_SIZE_OFFSET);
	backend.vertexAttribDivisor(instSizeLocation, 1);

	backend.enableVertexAttrib(instUv0Location);
	backend.vertexAttribPointer(instUv0Location, 2, gl.FLOAT, false, SPRITE_INSTANCE_STRIDE, SPRITE_INSTANCE_UV0_OFFSET);
	backend.vertexAttribDivisor(instUv0Location, 1);

	backend.enableVertexAttrib(instUv1Location);
	backend.vertexAttribPointer(instUv1Location, 2, gl.FLOAT, false, SPRITE_INSTANCE_STRIDE, SPRITE_INSTANCE_UV1_OFFSET);
	backend.vertexAttribDivisor(instUv1Location, 1);

	backend.enableVertexAttrib(instZLocation);
	backend.vertexAttribPointer(instZLocation, 1, gl.UNSIGNED_SHORT, true, SPRITE_INSTANCE_STRIDE, SPRITE_INSTANCE_Z_OFFSET);
	backend.vertexAttribDivisor(instZLocation, 1);

	backend.enableVertexAttrib(instAtlasLocation);
	backend.vertexAttribIPointer(instAtlasLocation, 1, gl.UNSIGNED_BYTE, SPRITE_INSTANCE_STRIDE, SPRITE_INSTANCE_ATLAS_OFFSET);
	backend.vertexAttribDivisor(instAtlasLocation, 1);

	backend.enableVertexAttrib(instFxLocation);
	backend.vertexAttribPointer(instFxLocation, 1, gl.BYTE, true, SPRITE_INSTANCE_STRIDE, SPRITE_INSTANCE_FX_OFFSET);
	backend.vertexAttribDivisor(instFxLocation, 1);

	backend.enableVertexAttrib(instColorLocation);
	backend.vertexAttribPointer(instColorLocation, 4, gl.UNSIGNED_BYTE, true, SPRITE_INSTANCE_STRIDE, SPRITE_INSTANCE_COLOR_OFFSET);
	backend.vertexAttribDivisor(instColorLocation, 1);
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
	gl.uniform4f(
		spriteShaderParallaxRigLocation,
		spriteParallaxRig.vy,
		spriteParallaxRig.scale,
		spriteParallaxRig.impact,
		spriteParallaxRig.impact_t,
	);
	gl.uniform4f(
		spriteShaderParallaxRig2Location,
		spriteParallaxRig.bias_px,
		spriteParallaxRig.parallax_strength,
		spriteParallaxRig.scale_strength,
		spriteParallaxRig.flip_strength,
	);
	gl.uniform1f(spriteShaderParallaxFlipWindowLocation, spriteParallaxRig.flip_window);

	const ideScale = state.viewportTypeIde === 'viewport' ? 1 : (state.baseWidth / state.width);
	let currentScale = 1;
	const setScale = (scale: number) => {
		if (scale === currentScale) return;
		gl.uniform1f(spriteShaderScaleLocation, scale);
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
	const { instanceF32, instanceU16, instanceU8, instanceS8 } = spriteShaderData;
	// Ambient sprites are disabled for now; when we have a more efficient path, reuse the block below.
	// const ambientFrameIntensity = state.ambientIntensity;
	// const ambientFrameColor = state.ambientColor;
	// const ambientMixR = ambientFrameColor[0] * ambientFrameIntensity;
	// const ambientMixG = ambientFrameColor[1] * ambientFrameIntensity;
	// const ambientMixB = ambientFrameColor[2] * ambientFrameIntensity;
	let i = 0;
	const flush = () => {
		if (i <= 0) return;
		const usedBytes = i * SPRITE_INSTANCE_STRIDE;
		const used = instanceU8.subarray(0, usedBytes);
		gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
		gl.bufferSubData(gl.ARRAY_BUFFER, 0, used);
		backend.accountUpload('vertex', used.byteLength);
		const passStub = { fbo, desc: { label: 'sprites' } } as Parameters<GPUBackend['draw']>[0];
		backend.drawInstanced!(passStub, VERTICES_PER_SPRITE, i, SPRITE_DRAW_OFFSET);
		i = 0;
	};
	forEachSprite(({ options, imgmeta }) => {
		const layer = options.layer;
		const desiredScale = layer === 'ide' ? ideScale : 1;
		if (desiredScale !== currentScale) {
			flush();
			setScale(desiredScale);
		}
		const pos = options.pos;
		const flip = options.flip!;
		const scale = options.scale!;
		const colorize = options.colorize!;
		const parallaxEnabled = layer !== 'ui' && layer !== 'ide';
		const parallaxWeightValue = parallaxEnabled ? (options.parallax_weight ?? 0) : 0;
		// Ambient sprites disabled for now; re-enable by using the mixing block below.
		// const layerIsOverlay = options.layer === 'ui' || options.layer === 'ide';
		// const ambientEnabled = !layerIsOverlay && (options.ambient_affected != null ? options.ambient_affected : state.ambientEnabledDefault);
		// const ambientFactorSprite = options.ambient_factor != null ? options.ambient_factor : state.ambientFactorDefault;
		// const ambientFactor = ambientEnabled ? ambientFactorSprite : 0;
		// const mixR = (1 - ambientFactor) + ambientFactor * ambientMixR;
		// const mixG = (1 - ambientFactor) + ambientFactor * ambientMixG;
		// const mixB = (1 - ambientFactor) + ambientFactor * ambientMixB;
		const sizeX = imgmeta.width * scale.x;
		const sizeY = imgmeta.height * scale.y;
		const texcoords = getTexCoords(flip.flip_h, flip.flip_v, imgmeta);
		const floatOffset = i * SPRITE_INSTANCE_FLOAT_STRIDE;
		instanceF32[floatOffset + 0] = pos.x;
		instanceF32[floatOffset + 1] = pos.y;
		instanceF32[floatOffset + 2] = sizeX;
		instanceF32[floatOffset + 3] = sizeY;
		instanceF32[floatOffset + 4] = texcoords[0];
		instanceF32[floatOffset + 5] = texcoords[1];
		instanceF32[floatOffset + 6] = texcoords[10];
		instanceF32[floatOffset + 7] = texcoords[11];

		const byteOffset = i * SPRITE_INSTANCE_STRIDE;
		const zNorm = 1 - (pos.z ?? DEFAULT_ZCOORD) / ZCOORD_MAX;
		instanceU16[(byteOffset + SPRITE_INSTANCE_Z_OFFSET) >> 1] = packUnorm16(zNorm);
		instanceU8[byteOffset + SPRITE_INSTANCE_ATLAS_OFFSET] = imgmeta.atlasid;
		instanceS8[byteOffset + SPRITE_INSTANCE_FX_OFFSET] = packSnorm8(parallaxWeightValue);
		instanceU8[byteOffset + SPRITE_INSTANCE_COLOR_OFFSET + 0] = packUnorm8(colorize.r);
		instanceU8[byteOffset + SPRITE_INSTANCE_COLOR_OFFSET + 1] = packUnorm8(colorize.g);
		instanceU8[byteOffset + SPRITE_INSTANCE_COLOR_OFFSET + 2] = packUnorm8(colorize.b);
		instanceU8[byteOffset + SPRITE_INSTANCE_COLOR_OFFSET + 3] = packUnorm8(colorize.a);
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
			setupDefaultUniformValues(backend);
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
