await t.waitForCart();
await t.frames(10);

t.openLuaSource('cartlib/actioneffects/actioneffect_component.lua');
await t.frames(2);

const stateMachineMethod = t.hover(9, 34);
t.assert(stateMachineMethod !== null, 'co-attached component receiver did not resolve');
t.assert(
	stateMachineMethod.contentLines.includes('(method) fsm_component:bind_state_path(path)'),
	'co-attached component receiver resolved to the wrong declaration',
);
