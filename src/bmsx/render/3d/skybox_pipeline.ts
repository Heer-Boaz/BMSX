// Skybox pipeline (formerly glview.skybox) inlined from legacy module.
import { AssetBarrier } from '../../core/assetbarrier';
import { $ } from '../../core/game';
import { taskGate } from '../../core/taskgate';
import skyboxFS from '../3d/shaders/skybox.frag.glsl';
import skyboxVS from '../3d/shaders/skybox.vert.glsl';
import type { RenderContext, TextureHandle } from '../backend/pipeline_interfaces';
import { RenderPassLibrary } from '../backend/renderpasslib';
import { SkyboxPipelineState } from '../backend/pipeline_interfaces';
import { TEXTURE_UNIT_SKYBOX } from '../backend/webgl/webgl.constants';
import { WebGLBackend } from '../backend/webgl/webgl_backend';
import { TextureKey } from '../texturemanager';
import { GameView } from '../gameview';
import type { TextureSource } from '../../rompack/rompack';
import { SkyboxImageIds } from '../shared/render_types';

function resolveSkyboxImage(assetId: string): Promise<TextureSource> {
	const asset = GameView.imgassets[assetId];
	if (!asset) {
		throw new Error(`[SkyboxPipeline] Skybox image '${assetId}' not found.`);
	}
	const binPromise = asset.imgbin;
	if (!binPromise) {
		throw new Error(`[SkyboxPipeline] Skybox asset '${assetId}' does not expose an imgbin promise.`);
	}
	return binPromise;
}

let vaoSkybox: WebGLVertexArrayObject = null;
let skyboxProgram: WebGLProgram;
let skyboxPositionLocation: number;
let skyboxViewLocation: WebGLUniformLocation;
let skyboxProjectionLocation: WebGLUniformLocation;
let skyboxTextureLocation: WebGLUniformLocation;
let skyboxDitherIntensityLocation: WebGLUniformLocation;
let skyboxTintLocation: WebGLUniformLocation;
let skyboxExposureLocation: WebGLUniformLocation;

export let skyboxKey: TextureKey; export let skyboxFaceIds: SkyboxImageIds; const skyboxGroup = taskGate.group('texture:skybox:main');
let lastBoundSkyboxTexture: TextureHandle = null;
export let skyboxBuffer: WebGLBuffer; export let skyboxTexture: TextureHandle = null;
export function init(backend: WebGLBackend): void {
	const gl = backend.gl as WebGL2RenderingContext;
	vaoSkybox = gl.createVertexArray()!;
	createSkyboxProgram(backend);
	setupSkyboxLocations(gl);
	createSkyboxBuffer(gl);
	gl.bindVertexArray(vaoSkybox);
	gl.bindBuffer(gl.ARRAY_BUFFER, skyboxBuffer);
	gl.vertexAttribPointer(skyboxPositionLocation, 3, gl.FLOAT, false, 0, 0);
	gl.enableVertexAttribArray(skyboxPositionLocation);
}
export function createSkyboxProgram(backend: WebGLBackend): void {
	const gl = backend.gl as WebGL2RenderingContext;
	// Prefer program that PipelineManager bound before bootstrap
	const current = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram;
	if (current) { skyboxProgram = current; return; }
	const program = backend.buildProgram(skyboxVS, skyboxFS, 'skybox');
	if (!program) throw Error('Failed to build skybox shader program');
	skyboxProgram = program;
}
export function setupSkyboxLocations(gl: WebGL2RenderingContext): void {
	if (!skyboxProgram) {
		const current = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram;
		if (!current) throw new Error('Skybox program not bound during bootstrap');
		skyboxProgram = current;
	}
	skyboxPositionLocation = gl.getAttribLocation(skyboxProgram, 'a_position');
	skyboxViewLocation = gl.getUniformLocation(skyboxProgram, 'u_view')!;
	skyboxProjectionLocation = gl.getUniformLocation(skyboxProgram, 'u_projection')!;
	skyboxTextureLocation = gl.getUniformLocation(skyboxProgram, 'u_skybox')!;
	skyboxDitherIntensityLocation = gl.getUniformLocation(skyboxProgram, 'u_ditherIntensity')!;
	skyboxTintLocation = gl.getUniformLocation(skyboxProgram, 'u_skyTint')!;
	skyboxExposureLocation = gl.getUniformLocation(skyboxProgram, 'u_skyExposure')!;
	gl.uniform1i(skyboxTextureLocation, TEXTURE_UNIT_SKYBOX);
	gl.uniform1f(skyboxDitherIntensityLocation, 0.3);
	gl.uniform3f(skyboxTintLocation, 1.0, 1.0, 1.0);
	gl.uniform1f(skyboxExposureLocation, 1.0);

}
export function createSkyboxBuffer(gl: WebGL2RenderingContext): void {
	// 36 vertices (12 triangles) cube; each face rendered separately
	const p = new Float32Array([
		// Front
		-1, -1, 1, 1, -1, 1, 1, 1, 1,
		-1, -1, 1, 1, 1, 1, -1, 1, 1,
		// Back
		-1, -1, -1, -1, 1, -1, 1, 1, -1,
		-1, -1, -1, 1, 1, -1, 1, -1, -1,
		// Top
		-1, 1, -1, -1, 1, 1, 1, 1, 1,
		-1, 1, -1, 1, 1, 1, 1, 1, -1,
		// Bottom
		-1, -1, -1, 1, -1, -1, 1, -1, 1,
		-1, -1, -1, 1, -1, 1, -1, -1, 1,
		// Right
		1, -1, -1, 1, 1, -1, 1, 1, 1,
		1, -1, -1, 1, 1, 1, 1, -1, 1,
		// Left
		-1, -1, -1, -1, -1, 1, -1, 1, 1,
		-1, -1, -1, -1, 1, 1, -1, 1, -1,
	]);
	skyboxBuffer = gl.createBuffer()!;
	gl.bindBuffer(gl.ARRAY_BUFFER, skyboxBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, p, gl.STATIC_DRAW);
}
export function setSkyboxImages(ids: SkyboxImageIds) {
	// Extract all face ids to avoid unsafe casts
	const { posx: posX, negx: negX, posy: posY, negy: negY, posz: posZ, negz: negZ } = ids;

	// If an id is missing, use null for that face loader so the texture system can use the fallback
	const loaders = [
		posX != null ? resolveSkyboxImage(posX) : null,
		negX != null ? resolveSkyboxImage(negX) : null,
		posY != null ? resolveSkyboxImage(posY) : null,
		negY != null ? resolveSkyboxImage(negY) : null,
		posZ != null ? resolveSkyboxImage(posZ) : null,
		negZ != null ? resolveSkyboxImage(negZ) : null,
	] as const;

	// Keep face id tuple in parallel; missing ids are represented as null
	const faceIdsForKey = [
		posX ,
		negX ,
		posY ,
		negY ,
		posZ ,
		negZ ,
	] as const;

	skyboxKey = $.texmanager.acquireCubemap({
		name: "skybox/main",
		faceLoaders: loaders,
		faceIdsForKey,
		assetBarrier: new AssetBarrier<WebGLTexture>(skyboxGroup),
		desc: {},
		fallbackColor: [0, 0, 0, 255],
		streamed: true
	});
	skyboxFaceIds = ids;
	lastBoundSkyboxTexture = null;
}
interface SkyboxRuntime {
	backend: WebGLBackend;
	gl: WebGL2RenderingContext;
	context: RenderContext;
}

export function drawSkybox(runtime: SkyboxRuntime, framebuffer: WebGLFramebuffer, state: SkyboxPipelineState): void {
	const { backend, gl, context } = runtime;
	if (state.width && state.height) backend.setViewport({ x: 0, y: 0, w: state.width, h: state.height });
	backend.setCullEnabled(false);
	backend.setDepthMask(false);
	backend.setDepthTestEnabled(false);
	backend.bindVertexArray(vaoSkybox);
	gl.uniformMatrix4fv(skyboxViewLocation, false, state.view);
	gl.uniformMatrix4fv(skyboxProjectionLocation, false, state.proj);
	gl.uniform3f(skyboxTintLocation, _skyTint[0], _skyTint[1], _skyTint[2]);
	gl.uniform1f(skyboxExposureLocation, _skyExposure);
	if (lastBoundSkyboxTexture !== state.tex) {
		context.activeTexUnit = TEXTURE_UNIT_SKYBOX;
		context.bindCubemapTex(state.tex);
		lastBoundSkyboxTexture = state.tex;
	}
	const passStub = { fbo: framebuffer, desc: { label: 'skybox' } };
	backend.draw(passStub, 0, 36);
	backend.bindVertexArray(null);
}

// --- Public API: tint/exposure controls ------------------------------------
let _skyTint: [number, number, number] = [1, 1, 1];
let _skyExposure = 1.0;
export function setSkyboxTintExposure(tint: [number, number, number], exposure = 1.0): void {
	_skyTint = [Math.max(0, tint[0]), Math.max(0, tint[1]), Math.max(0, tint[2])];
	_skyExposure = Math.max(0, exposure);
}

export function registerSkyboxPass_WebGL(registry: RenderPassLibrary) {
	registry.register({
		id: 'skybox',
		name: 'Skybox',
		vsCode: skyboxVS,
		fsCode: skyboxFS,
		bindingLayout: {
			uniforms: ['FrameUniforms'],
			textures: [{ name: 'u_skybox' }],
			samplers: [{ name: 's_skybox' }],
		},
		bootstrap: (backend) => {
			init(backend as WebGLBackend);
		},
		writesDepth: false,
		shouldExecute: () => !!$.world.activeCamera3D && !!skyboxKey,
		exec: (backend, fbo, s) => {
			const webglBackend = backend as WebGLBackend;
			const runtime: SkyboxRuntime = { backend: webglBackend, gl: webglBackend.gl as WebGL2RenderingContext, context: $.view };
			drawSkybox(runtime, fbo as WebGLFramebuffer, s as SkyboxPipelineState);
		},
		prepare: (backend, _state) => {
			const gv = $.view;
			const width = gv.offscreenCanvasSize.x; const height = gv.offscreenCanvasSize.y;
			const cam = $.world.activeCamera3D;
			if (!cam) return;
			const tex = $.texmanager.getTexture(skyboxKey) as TextureHandle;
			if (!tex) return;
			// Update state with dynamic data (reuse camera matrices)
			const mats = cam.getMatrices();
			registry.setState('skybox', { width, height, view: cam.skyboxView, proj: mats.proj, tex });
			registry.validatePassResources('skybox', backend);
		},
	});
}
