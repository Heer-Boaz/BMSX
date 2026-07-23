import assert from 'node:assert/strict';
import test from 'node:test';

import { WebGLBackend } from '../../machine/ts/render/backend/webgl/backend';

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
	const backend = new WebGLBackend(context);
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
