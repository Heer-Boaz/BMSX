import assert from 'node:assert/strict';
import { test } from 'node:test';

import { luaFunctionDisplayName } from '../../toolchain/ts/lua/stack_frame_label';

test('stack frame labels preserve the nearest authored function context', () => {
	assert.equal(
		luaFunctionDisplayName('module:cart/entry/local:run'),
		'run',
	);
	assert.equal(
		luaFunctionDisplayName('module:cart/entry/local:run#2'),
		'run',
	);
	assert.equal(
		luaFunctionDisplayName('module:combat/module/decl:combat.define_fsm/anon:266:20:274:5'),
		'combat.define_fsm.<anonymous>',
	);
	assert.equal(
		luaFunctionDisplayName('module:cart/entry/anon:10:2:12:4'),
		'entry.<anonymous>',
	);
});
