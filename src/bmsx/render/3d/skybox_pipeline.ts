import { $ } from '../../core/engine_core';
import { Runtime } from '../../machine/runtime/runtime';
import skyboxFS from '../3d/shaders/skybox.frag.glsl';
import skyboxVS from '../3d/shaders/skybox.vert.glsl';
import type { RenderContext } from '../backend/pipeline_interfaces';
import { RenderPassLibrary } from '../backend/renderpasslib';
import { SkyboxPipelineState } from '../backend/pipeline_interfaces';
import { TEXTURE_UNIT_ATLAS_PRIMARY, TEXTURE_UNIT_ATLAS_SECONDARY } from '../backend/webgl/webgl.constants';
import { WebGLBackend } from '../backend/webgl/webgl_backend';
import { ATLAS_PRIMARY_SLOT_ID, ATLAS_SECONDARY_SLOT_ID, ENGINE_ATLAS_INDEX } from '../../rompack/rompack';
import { _skyTint, _skyExposure } from '../shared/render_queues';
import { resolveActiveCamera3D } from '../shared/hardware_camera';
import { SKYBOX_FACE_KEYS } from '../shared/render_types';

let vaoSkybox: WebGLVertexArrayObject = null;
let skyboxProgram: WebGLProgram;
let skyboxPositionLocation: number;
let skyboxViewLocation: WebGLUniformLocation;
let skyboxProjectionLocation: WebGLUniformLocation;
let skyboxAtlasPrimaryLocation: WebGLUniformLocation;
let skyboxAtlasSecondaryLocation: WebGLUniformLocation;
let skyboxFaceUvRectLocation: WebGLUniformLocation;
let skyboxFaceAtlasLocation: WebGLUniformLocation;
let skyboxTintLocation: WebGLUniformLocation;
let skyboxExposureLocation: WebGLUniformLocation;
const SKYBOX_FACE_COUNT = SKYBOX_FACE_KEYS.length;
const skyboxFaceUvRects = new Float32Array(SKYBOX_FACE_COUNT * 4);
const skyboxFaceAtlasBindings = new Int32Array(SKYBOX_FACE_COUNT);
export let skyboxBuffer: WebGLBuffer;
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
	skyboxAtlasPrimaryLocation = gl.getUniformLocation(skyboxProgram, 'u_atlas_primary')!;
	skyboxAtlasSecondaryLocation = gl.getUniformLocation(skyboxProgram, 'u_atlas_secondary')!;
	skyboxFaceUvRectLocation = gl.getUniformLocation(skyboxProgram, 'u_face_uv_rect[0]')!;
	skyboxFaceAtlasLocation = gl.getUniformLocation(skyboxProgram, 'u_face_atlas[0]')!;
	skyboxTintLocation = gl.getUniformLocation(skyboxProgram, 'u_skyTint')!;
	skyboxExposureLocation = gl.getUniformLocation(skyboxProgram, 'u_skyExposure')!;
	gl.uniform1i(skyboxAtlasPrimaryLocation, TEXTURE_UNIT_ATLAS_PRIMARY);
	gl.uniform1i(skyboxAtlasSecondaryLocation, TEXTURE_UNIT_ATLAS_SECONDARY);
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
	gl.uniform4fv(skyboxFaceUvRectLocation, state.faceUvRects);
	gl.uniform1iv(skyboxFaceAtlasLocation, state.faceAtlasBindings);
	gl.uniform3f(skyboxTintLocation, _skyTint[0], _skyTint[1], _skyTint[2]);
	gl.uniform1f(skyboxExposureLocation, _skyExposure);
	context.activeTexUnit = TEXTURE_UNIT_ATLAS_PRIMARY;
	context.bind2DTex(state.atlasPrimaryTex);
	context.activeTexUnit = TEXTURE_UNIT_ATLAS_SECONDARY;
	context.bind2DTex(state.atlasSecondaryTex);
	const passStub = { fbo: framebuffer, desc: { label: 'skybox' } };
	backend.draw(passStub, 0, 36);
	backend.bindVertexArray(null);
}

export function registerSkyboxPass_WebGL(registry: RenderPassLibrary) {
	registry.register({
		id: 'skybox',
		name: 'Skybox',
		vsCode: skyboxVS,
		fsCode: skyboxFS,
		bindingLayout: {
			uniforms: ['FrameUniforms'],
			textures: [{ name: 'u_atlas_primary' }, { name: 'u_atlas_secondary' }],
			samplers: [{ name: 's_atlas_primary' }, { name: 's_atlas_secondary' }],
		},
		bootstrap: (backend) => {
			init(backend as WebGLBackend);
		},
		writesDepth: false,
		shouldExecute: () => !!resolveActiveCamera3D() && !!$.view.skyboxFaceIds,
		exec: (backend, fbo, s) => {
			const webglBackend = backend as WebGLBackend;
			const runtime: SkyboxRuntime = { backend: webglBackend, gl: webglBackend.gl as WebGL2RenderingContext, context: $.view };
			drawSkybox(runtime, fbo as WebGLFramebuffer, s as SkyboxPipelineState);
		},
		prepare: (backend, _state) => {
			const gv = $.view;
			if (!gv.skyboxFaceIds) return;
			const width = gv.offscreenCanvasSize.x; const height = gv.offscreenCanvasSize.y;
			const cam = resolveActiveCamera3D();
			if (!cam) return;
			const atlasPrimaryTex = gv.textures[ATLAS_PRIMARY_SLOT_ID];
			if (!atlasPrimaryTex) {
				throw new Error("[Skybox] Texture '_atlas_primary' missing from view textures.");
			}
			const atlasSecondaryTex = gv.textures[ATLAS_SECONDARY_SLOT_ID];
			if (!atlasSecondaryTex) {
				throw new Error("[Skybox] Texture '_atlas_secondary' missing from view textures.");
			}
			const runtime = Runtime.instance;
			for (let index = 0; index < SKYBOX_FACE_COUNT; index += 1) {
				const imageId = gv.skyboxFaceIds[SKYBOX_FACE_KEYS[index]];
				const handle = runtime.resolveAssetHandle(imageId);
				const sample = runtime.machine.vdp.resolveBlitterSample(handle);
				if (sample.atlasId === ENGINE_ATLAS_INDEX) {
					throw new Error(`[Skybox] Image '${imageId}' resolved to the engine atlas. Skybox faces must use primary or secondary atlas slots.`);
				}
				const uvBase = index * 4;
				skyboxFaceUvRects[uvBase + 0] = sample.source.srcX / sample.surfaceWidth;
				skyboxFaceUvRects[uvBase + 1] = sample.source.srcY / sample.surfaceHeight;
				skyboxFaceUvRects[uvBase + 2] = sample.source.width / sample.surfaceWidth;
				skyboxFaceUvRects[uvBase + 3] = sample.source.height / sample.surfaceHeight;
				skyboxFaceAtlasBindings[index] = sample.atlasId;
			}
			// Update state with dynamic data (reuse camera matrices)
			const mats = cam.getMatrices();
			registry.setState('skybox', {
				width,
				height,
				view: cam.skyboxView,
				proj: mats.proj,
				atlasPrimaryTex,
				atlasSecondaryTex,
				faceUvRects: skyboxFaceUvRects,
				faceAtlasBindings: skyboxFaceAtlasBindings,
			});
			registry.validatePassResources('skybox', backend);
		},
	});
}
