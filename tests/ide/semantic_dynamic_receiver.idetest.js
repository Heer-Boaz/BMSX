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
