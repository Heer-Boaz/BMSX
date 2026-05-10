import { consoleCore } from '../../../core/console';
import skyboxFS from '../shaders/skybox.frag.glsl';
import skyboxVS from '../shaders/skybox.vert.glsl';
import type { RenderContext } from '../../backend/backend';
import { RenderPassLibrary } from '../../backend/pass/library';
import { SkyboxPipelineState } from '../../backend/backend';
import { TEXTURE_UNIT_TEXTPAGE_PRIMARY, TEXTURE_UNIT_TEXTPAGE_SECONDARY } from '../../backend/webgl/constants';
import { WebGLBackend } from '../../backend/webgl/backend';
import { VDP_PRIMARY_SLOT_TEXTURE_KEY, VDP_SECONDARY_SLOT_TEXTURE_KEY } from '../../../rompack/format';
import { _skyTint, _skyExposure } from '../../shared/queues';

let vaoSkybox: WebGLVertexArrayObject = null;
let skyboxProgram: WebGLProgram;
let skyboxPositionLocation: number;
let skyboxViewLocation: WebGLUniformLocation;
let skyboxProjectionLocation: WebGLUniformLocation;
let skyboxTextpagePrimaryLocation: WebGLUniformLocation;
let skyboxTextpageSecondaryLocation: WebGLUniformLocation;
let skyboxFaceUvRectLocation: WebGLUniformLocation;
let skyboxFaceTextpageLocation: WebGLUniformLocation;
let skyboxTintLocation: WebGLUniformLocation;
let skyboxExposureLocation: WebGLUniformLocation;
export let skyboxBuffer: WebGLBuffer;
export function initSkyboxPipeline(backend: WebGLBackend): void {
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
	skyboxTextpagePrimaryLocation = gl.getUniformLocation(skyboxProgram, 'u_textpage_primary')!;
	skyboxTextpageSecondaryLocation = gl.getUniformLocation(skyboxProgram, 'u_textpage_secondary')!;
	skyboxFaceUvRectLocation = gl.getUniformLocation(skyboxProgram, 'u_face_uv_rect[0]')!;
	skyboxFaceTextpageLocation = gl.getUniformLocation(skyboxProgram, 'u_face_textpage[0]')!;
	skyboxTintLocation = gl.getUniformLocation(skyboxProgram, 'u_skyTint')!;
	skyboxExposureLocation = gl.getUniformLocation(skyboxProgram, 'u_skyExposure')!;
	gl.uniform1i(skyboxTextpagePrimaryLocation, TEXTURE_UNIT_TEXTPAGE_PRIMARY);
	gl.uniform1i(skyboxTextpageSecondaryLocation, TEXTURE_UNIT_TEXTPAGE_SECONDARY);
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
	if (state.width && state.height) backend.setViewportRect(0, 0, state.width, state.height);
	backend.setCullEnabled(false);
	backend.setDepthMask(false);
	backend.setDepthTestEnabled(false);
	backend.bindVertexArray(vaoSkybox);
	gl.uniformMatrix4fv(skyboxViewLocation, false, state.view);
	gl.uniformMatrix4fv(skyboxProjectionLocation, false, state.proj);
	gl.uniform4fv(skyboxFaceUvRectLocation, state.faceUvRects);
	gl.uniform1iv(skyboxFaceTextpageLocation, state.faceTextpageBindings);
	gl.uniform3f(skyboxTintLocation, _skyTint[0], _skyTint[1], _skyTint[2]);
	gl.uniform1f(skyboxExposureLocation, _skyExposure);
	context.activeTexUnit = TEXTURE_UNIT_TEXTPAGE_PRIMARY;
	context.bind2DTex(state.textpagePrimaryTex);
	context.activeTexUnit = TEXTURE_UNIT_TEXTPAGE_SECONDARY;
	context.bind2DTex(state.textpageSecondaryTex);
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
			textures: [{ name: 'u_textpage_primary' }, { name: 'u_textpage_secondary' }],
			samplers: [{ name: 's_textpage_primary' }, { name: 's_textpage_secondary' }],
		},
		bootstrap: (backend) => {
			initSkyboxPipeline(backend as WebGLBackend);
		},
		writesDepth: false,
		shouldExecute: () => !!consoleCore.view.skyboxFaceUvRects,
		exec: (backend, fbo, s) => {
			const webglBackend = backend as WebGLBackend;
			const runtime: SkyboxRuntime = { backend: webglBackend, gl: webglBackend.gl as WebGL2RenderingContext, context: consoleCore.view };
			drawSkybox(runtime, fbo as WebGLFramebuffer, s as SkyboxPipelineState);
		},
		prepare: (backend, _state) => {
			const gv = consoleCore.view;
			if (!gv.skyboxFaceUvRects || !gv.skyboxFaceTextpageBindings) return;
			const width = gv.offscreenCanvasSize.x; const height = gv.offscreenCanvasSize.y;
			const textpagePrimaryTex = gv.textures[VDP_PRIMARY_SLOT_TEXTURE_KEY];
			if (!textpagePrimaryTex) {
				throw new Error(`[Skybox] Texture '${VDP_PRIMARY_SLOT_TEXTURE_KEY}' missing from view textures.`);
			}
			const textpageSecondaryTex = gv.textures[VDP_SECONDARY_SLOT_TEXTURE_KEY];
			if (!textpageSecondaryTex) {
				throw new Error(`[Skybox] Texture '${VDP_SECONDARY_SLOT_TEXTURE_KEY}' missing from view textures.`);
			}
			// Update state with dynamic data (reuse camera matrices)
			registry.setState('skybox', {
				width,
				height,
				view: gv.vdpTransform.skyboxView,
				proj: gv.vdpTransform.proj,
				textpagePrimaryTex,
				textpageSecondaryTex,
				faceUvRects: gv.skyboxFaceUvRects,
				faceTextpageBindings: gv.skyboxFaceTextpageBindings,
			});
			registry.validatePassResources('skybox', backend);
		},
	});
}
