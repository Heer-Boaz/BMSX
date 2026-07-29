import assert from 'node:assert/strict';
import test from 'node:test';

import { WebGLBackend } from '../../machine/ts/render/backend/webgl/backend';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';

test('WebGL backend publishes retained GL state only when it changes', () => {
	const blendColors: number[][] = [];
	const programs: WebGLProgram[] = [];
	const context = {
		DITHER: 0x0bd0,
		disable: () => { },
		createFramebuffer: () => ({}),
		useProgram: (program: WebGLProgram) => {
			programs.push(program);
		},
		blendColor: (red: number, green: number, blue: number, alpha: number) => {
			blendColors.push([red, green, blue, alpha]);
		},
	} as unknown as WebGL2RenderingContext;
	const backend = new WebGLBackend(context, PSX_MACHINE_SPEC.gxGpuVramBytes);
	const firstProgram = {} as WebGLProgram;
	const secondProgram = {} as WebGLProgram;

	backend.useProgram(firstProgram);
	assert.equal(programs.length, 1);
	backend.useProgram(firstProgram);
	assert.equal(programs.length, 1);
	backend.useProgram(secondProgram);

	backend.setBlendColor(0, 0, 0, 0);
	assert.equal(blendColors.length, 1);
	backend.setBlendColor(0, 0, 0, 0);
	assert.equal(blendColors.length, 1);
	backend.setBlendColor(0, 0, 0, 0.25);

	assert.deepEqual(blendColors, [
		[0, 0, 0, 0],
		[0, 0, 0, 0.25],
	]);
	assert.deepEqual(programs, [firstProgram, secondProgram]);
});

test('WebGL resource uploads keep retained texture-unit state coherent', () => {
	let activeTextureUnit = 0;
	const boundTextures: (WebGLTexture | null)[] = [];
	const context = {
		DITHER: 0x0bd0,
		TEXTURE0: 0x84c0,
		TEXTURE_2D: 0x0de1,
		TEXTURE_CUBE_MAP: 0x8513,
		TEXTURE_CUBE_MAP_POSITIVE_X: 0x8515,
		RGBA: 0x1908,
		RGBA8: 0x8058,
		UNSIGNED_BYTE: 0x1401,
		UNSIGNED_SHORT: 0x1403,
		DEPTH_COMPONENT: 0x1902,
		DEPTH_COMPONENT16: 0x81a5,
		TEXTURE_BASE_LEVEL: 0x813c,
		TEXTURE_MAX_LEVEL: 0x813d,
		TEXTURE_WRAP_S: 0x2802,
		TEXTURE_WRAP_T: 0x2803,
		TEXTURE_WRAP_R: 0x8072,
		TEXTURE_MIN_FILTER: 0x2801,
		TEXTURE_MAG_FILTER: 0x2800,
		CLAMP_TO_EDGE: 0x812f,
		disable: () => { },
		createFramebuffer: () => ({}),
		createTexture: () => ({}),
		activeTexture: (texture: number) => {
			activeTextureUnit = texture - 0x84c0;
		},
		bindTexture: (_target: number, texture: WebGLTexture | null) => {
			boundTextures[activeTextureUnit] = texture;
		},
		texImage2D: () => { },
		texSubImage2D: () => { },
		texParameteri: () => { },
	} as unknown as WebGL2RenderingContext;
	const backend = new WebGLBackend(context, PSX_MACHINE_SPEC.gxGpuVramBytes);
	const sampledTexture = {} as WebGLTexture;
	const textureParams = {
		size: { x: 1, y: 1 },
		srgb: false,
		wrapS: 0,
		wrapT: 0,
		minFilter: 0,
		magFilter: 0,
	};

	backend.setActiveTexture(3);
	backend.bindTexture2D(sampledTexture);

	backend.createTexture(new Uint8Array(4), 1, 1, textureParams);
	backend.setActiveTexture(3);
	backend.bindTexture2D(sampledTexture);
	assert.equal(activeTextureUnit, 3);

	backend.createSolidTexture2D(1, 1, 0xffffffff, textureParams);
	backend.setActiveTexture(3);
	backend.bindTexture2D(sampledTexture);
	assert.equal(activeTextureUnit, 3);

	const cubemap = backend.createSolidCubemap(1, 0xffffffff, textureParams);
	backend.setActiveTexture(3);
	backend.bindTexture2D(sampledTexture);
	assert.equal(activeTextureUnit, 3);

	backend.uploadCubemapFace(cubemap, 0, {
		data: new Uint8Array(4),
		width: 1,
		height: 1,
	});
	backend.setActiveTexture(3);
	backend.bindTexture2D(sampledTexture);
	assert.equal(activeTextureUnit, 3);

	backend.createColorTexture({ width: 1, height: 1 });
	backend.setActiveTexture(3);
	backend.bindTexture2D(sampledTexture);
	assert.equal(activeTextureUnit, 3);

	backend.createDepthTexture({ width: 1, height: 1 });
	backend.setActiveTexture(3);
	backend.bindTexture2D(sampledTexture);
	assert.equal(activeTextureUnit, 3);
	assert.equal(boundTextures[3], sampledTexture);
});
