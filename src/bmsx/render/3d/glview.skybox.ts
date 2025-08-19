import { AssetBarrier } from '../../core/assetbarrier';
import { taskGate } from '../../core/taskgate';
import { glLoadShader, glSwitchProgram } from '../glutils';
import { TEXTURE_UNIT_SKYBOX } from '../glview';
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
	const program = gl.createProgram();
	if (!program) throw Error('Failed to create skybox GLSL program');
	skyboxProgram = program;
	const vertShader = glLoadShader(gl, gl.VERTEX_SHADER, skyboxVertCode);
	const fragShader = glLoadShader(gl, gl.FRAGMENT_SHADER, skyboxFragCode);
	gl.attachShader(program, vertShader);
	gl.attachShader(program, fragShader);
	gl.linkProgram(program);
	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		throw Error(`Unable to initialize the skybox shader program: ${gl.getProgramInfoLog(program)} `);
	}
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

function faceLoaderFromImgAsset(faceId: string): () => Promise<ImageBitmap> {
	return async () => {
		const imgEl = await BaseView.imgassets[faceId].imgbin; // HTMLImageElement
		return createImageBitmap(imgEl);
	};
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

export function drawSkybox(gl: WebGL2RenderingContext, framebuffer: WebGLFramebuffer, w: number, h: number) {
	if (!skyboxGroup.ready) {
		console.debug('TASKGATE BLOCKED SKYBOX RENDERING!!');
		return;
	}

	const tex = $.texmanager.getTexture(skyboxKey) as WebGLTexture | undefined;
	if (!tex) return;

	gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
	gl.viewport(0, 0, w, h);

	gl.disable(gl.CULL_FACE);
	glSwitchProgram(gl, skyboxProgram);
	gl.bindVertexArray(vaoSkybox);

	const cam = $.model.activeCamera3D;
	if (!cam) return;
	gl.uniformMatrix4fv(skyboxViewLocation, false, cam.skyboxView);
	gl.uniformMatrix4fv(skyboxProjectionLocation, false, cam.projection);

	// Only bind the cubemap if the currently bound skybox differs
	if (lastBoundSkyboxKey !== skyboxKey || lastBoundSkyboxTexture !== tex) {
		gl.activeTexture(gl.TEXTURE0 + TEXTURE_UNIT_SKYBOX);
		gl.bindTexture(gl.TEXTURE_CUBE_MAP, tex);
		lastBoundSkyboxKey = skyboxKey;
		lastBoundSkyboxTexture = tex ?? null;
	}

	gl.drawArrays(gl.TRIANGLES, 0, 36);
	gl.enable(gl.CULL_FACE);
}
