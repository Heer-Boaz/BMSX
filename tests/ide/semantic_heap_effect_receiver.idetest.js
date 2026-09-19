await t.waitForCart();
await t.frames(10);

t.openLuaSource('cartlib/actioneffects/actioneffect_component.lua');
await t.frames(2);

const own = t.hover(71, 7);
t.assert(own !== null, 'component method hover did not resolve');
t.assert(
	own.contentLines.includes('(method) actioneffect_component:rebind_effect(id, definition)'),
	'component method resolved to the wrong declaration',
);

// `owner.state_machines` is attached by fsm_component:on_attach at run time,
// not declared on the owner: without an annotation it stays unresolved.
const attached = t.hover(9, 34);
t.assert(
	attached === null || !attached.contentLines.some(line => line.startsWith('(')),
	'a field attached by another component was resolved without a defining declaration',
);
