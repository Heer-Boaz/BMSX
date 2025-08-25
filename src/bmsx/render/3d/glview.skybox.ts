import { AssetBarrier } from '../../core/assetbarrier';
import { $ } from '../../core/game';
import { taskGate } from '../../core/taskgate';
import { glSwitchProgram } from '../glutils';
import { GLView, TEXTURE_UNIT_SKYBOX } from '../glview';
import { TextureKey } from '../texturemanager';
import { BaseView, SkyboxImageIds } from '../view';
import skyboxFragCode from './shaders/skybox.frag.glsl';
import skyboxVertCode from './shaders/skybox.vert.glsl';

let vaoSkybox: WebGLVertexArrayObject | null = null;

let skyboxProgram: WebGLProgram;
let skyboxPositionLocation: number;
let skyboxViewLocation: WebGLUniformLocation;
let skyboxProjectionLocation: WebGLUniformLocation;
let skyboxTextureLocation: WebGLUniformLocation;

export let skyboxKey: TextureKey | undefined;
export let skyboxFaceIds: SkyboxImageIds | undefined;
const skyboxGroup = taskGate.group('texture:skybox:main'); // dedicated groep

// Add a small cache so we don't re-bind the same cubemap every draw
let lastBoundSkyboxKey: TextureKey | undefined = undefined;
let lastBoundSkyboxTexture: WebGLTexture | null = null;

// bump() bij scene/skybox wissel:
export function resetSkyboxGroup() { skyboxGroup.bump(); }
export let skyboxBuffer: WebGLBuffer;
export let skyboxTexture: WebGLTexture | null = null;

export function init(gl: WebGL2RenderingContext) {
	vaoSkybox = gl.createVertexArray()!;
	createSkyboxProgram(gl);
	setupSkyboxLocations(gl);
	createSkyboxBuffer(gl);

	glSwitchProgram(gl, skyboxProgram);
	gl.bindVertexArray(vaoSkybox);

	gl.bindBuffer(gl.ARRAY_BUFFER, skyboxBuffer);
	gl.vertexAttribPointer(skyboxPositionLocation, 3, gl.FLOAT, false, 0, 0);
	gl.enableVertexAttribArray(skyboxPositionLocation);
}

export function createSkyboxProgram(gl: WebGL2RenderingContext): void {
	const gv = $.viewAs<GLView>();
	const b = gv.getBackend();
	const program = b.buildProgram(skyboxVertCode, skyboxFragCode, 'skybox');
	if (!program) throw Error('Failed to build skybox shader program');
	skyboxProgram = program;
}

export function setupSkyboxLocations(gl: WebGL2RenderingContext): void {
	gl.useProgram(skyboxProgram);
	skyboxPositionLocation = gl.getAttribLocation(skyboxProgram, 'a_position');
	skyboxViewLocation = gl.getUniformLocation(skyboxProgram, 'u_view')!;
	skyboxProjectionLocation = gl.getUniformLocation(skyboxProgram, 'u_projection')!;
	skyboxTextureLocation = gl.getUniformLocation(skyboxProgram, 'u_skybox')!;

	// koppel sampler -> texture unit
	gl.uniform1i(skyboxTextureLocation, TEXTURE_UNIT_SKYBOX);
}

export function createSkyboxBuffer(gl: WebGL2RenderingContext): void {
	// CCW vanuit het centrum van de cube gezien (dus vertices in "normale" volgorde om naar binnen te kijken)
	const p = new Float32Array([
		// +Z (front)
		-1, -1, 1,
		1, -1, 1,
		1, 1, 1,
		-1, -1, 1,
		1, 1, 1,
		-1, 1, 1,

		// -Z (back)
		1, -1, -1,
		-1, -1, -1,
		-1, 1, -1,
		1, -1, -1,
		-1, 1, -1,
		1, 1, -1,

		// -X (left)
		-1, -1, -1,
		-1, -1, 1,
		-1, 1, 1,
		-1, -1, -1,
		-1, 1, 1,
		-1, 1, -1,

		// +X (right)
		1, -1, 1,
		1, -1, -1,
		1, 1, -1,
		1, -1, 1,
		1, 1, -1,
		1, 1, 1,

		// +Y (top)
		-1, 1, 1,
		1, 1, 1,
		1, 1, -1,
		-1, 1, 1,
		1, 1, -1,
		-1, 1, -1,

		// -Y (bottom)
		-1, -1, -1,
		1, -1, -1,
		1, -1, 1,
		-1, -1, -1,
		1, -1, 1,
		-1, -1, 1,
	]);

	skyboxBuffer = gl.createBuffer()!;
	gl.bindBuffer(gl.ARRAY_BUFFER, skyboxBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, p, gl.STATIC_DRAW);
}

export function setSkyboxImages(ids: SkyboxImageIds) {
	const loaders = [
		BaseView.imgassets[ids.posX].imgbin,
		BaseView.imgassets[ids.negX].imgbin,
		BaseView.imgassets[ids.posY].imgbin,
		BaseView.imgassets[ids.negY].imgbin,
		BaseView.imgassets[ids.posZ].imgbin,
		BaseView.imgassets[ids.negZ].imgbin,
	] as const;

	skyboxKey = $.texmanager.acquireCubemap(
		{
			name: "skybox/main",
			faceLoaders: loaders,
			faceIdsForKey: [ids.posX, ids.negX, ids.posY, ids.negY, ids.posZ, ids.negZ] as const,
			assetBarrier: new AssetBarrier<WebGLTexture>(skyboxGroup),
			desc: {},
			fallbackColor: [255, 0, 0, 255],
			streamed: true,
			// delayMs: 2000,
		}
	);
	skyboxFaceIds = ids;

	// Reset binding cache because the skybox key changed
	lastBoundSkyboxKey = undefined;
	lastBoundSkyboxTexture = null;
}

export interface SkyboxPassState {
	view: Float32Array;
	proj: Float32Array;
	tex: WebGLTexture;
	width?: number;
	height?: number;
}

// Legacy drawSkybox removed; use drawSkyboxWithState via backend pipeline.

// Variant used by backend pipeline when camera matrices & texture already prepared.
export function drawSkyboxWithState(
	gl: WebGL2RenderingContext,
	framebuffer: WebGLFramebuffer,
	state: SkyboxPassState
): void {
	console.log(`Rendering skybox stuff`);

	gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
	if (state.width && state.height) gl.viewport(0, 0, state.width, state.height);
	gl.disable(gl.CULL_FACE);
	glSwitchProgram(gl, skyboxProgram);
	gl.bindVertexArray(vaoSkybox);
	gl.uniformMatrix4fv(skyboxViewLocation, false, state.view);
	gl.uniformMatrix4fv(skyboxProjectionLocation, false, state.proj);
	if (lastBoundSkyboxTexture !== state.tex) {
		$.viewAs<GLView>().activeTexUnit = TEXTURE_UNIT_SKYBOX;
		$.viewAs<GLView>().bindCubemapTex(state.tex);
		lastBoundSkyboxTexture = state.tex;
		lastBoundSkyboxKey = skyboxKey; // approximate; key may not change
	}
	gl.drawArrays(gl.TRIANGLES, 0, 36);
	gl.bindVertexArray(null);
	gl.enable(gl.CULL_FACE);
}
