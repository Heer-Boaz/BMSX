await t.waitForCart();
await t.frames(10);

t.openLuaSource('player/player.lua');
await t.frames(2);

const projectileReceiver = t.hover(1150, 12);
t.assert(projectileReceiver !== null, 'dynamic receiver argument hint did not resolve');
t.assert(
	projectileReceiver.contentLines.includes('(method) enemy:receive_player_projectile(projectile)'),
	'dynamic receiver argument hint resolved to the wrong declaration',
);

const indexedCollider = t.hover(388, 19);
t.assert(indexedCollider !== null, 'numeric-loop indexed receiver did not resolve');
t.assert(
	indexedCollider.contentLines.includes('(method) collider_2d_component:set_enabled(enabled)'),
	'numeric-loop indexed receiver resolved to the wrong declaration',
);

const forwardedOwner = t.hover(238, 7);
t.assert(forwardedOwner !== null, 'forwarded instance receiver did not resolve');
t.assert(
	forwardedOwner.contentLines.includes('(method) world_object:add_component(comp)'),
	'forwarded instance receiver resolved to the wrong inherited declaration',
);
