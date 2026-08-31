await t.waitForCart();
await t.frames(10);

t.openLuaSource('director.lua');
await t.frames(2);

const inherited = t.hover(87, 8);
t.assert(inherited !== null, 'configured base method hover did not resolve');
t.assert(
	inherited.contentLines.includes('(method) world_object:set_space(space_id)'),
	'configured base method resolved to the wrong declaration',
);

const initialized = t.hover(92, 8);
t.assert(initialized !== null, 'configured initializer field hover did not resolve');
t.assert(
	initialized.contentLines.includes('(field) self.events'),
	'configured initializer field resolved to the wrong declaration',
);

const chained = t.hover(92, 14);
t.assert(chained !== null, 'configured factory-return method hover did not resolve');
t.assert(
	chained.contentLines.includes('(method) event_port:emit(event_name, payload)'),
	'configured factory-return method resolved to the wrong declaration',
);

const inheritedLookup = t.hover(248, 34);
t.assert(inheritedLookup !== null, 'second configured base method hover did not resolve');
t.assert(
	inheritedLookup.contentLines.includes('(method) world_object:get_component(component_class, id_local)'),
	'second configured base method resolved to the wrong declaration',
);
