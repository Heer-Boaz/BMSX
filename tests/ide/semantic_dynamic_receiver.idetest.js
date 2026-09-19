await t.waitForCart();
await t.frames(10);

t.openLuaSource('player/player.lua');
await t.frames(2);

// Interactive hovers follow definitions, as a language server does. A receiver
// that is a callback parameter, a table element or a forwarded parameter is
// not determined by definitions: it stays unresolved, never wrongly resolved.
const semanticLabels = tooltip => tooltip === null ? [] : tooltip.contentLines.filter(line => line.startsWith('('));

const own = t.hover(392, 6);
t.assert(own !== null, 'self method hover did not resolve');
t.assert(own.contentLines.includes('(method) player:initialize_options()'), 'self method resolved to the wrong declaration');

for (const [row, column, receiver] of [[1150, 12, 'callback parameter'], [388, 19, 'indexed table element'], [238, 7, 'forwarded parameter']]) {
	t.assert(semanticLabels(t.hover(row, column)).length === 0, `${receiver} receiver was resolved without a defining declaration`);
}
