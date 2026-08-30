await t.waitForCart();
await t.frames(10);

t.openLuaSource('cart.lua');
t.replaceActiveCodeSource([
	'local target<const> = {}',
	'function target:run(value, delay) return value end',
	'target:run(1, 2)',
	'math.max(1, 2)',
	'return missing',
].join('\n'));
await t.frames(2);

const method = t.hover(2, 8);
t.assert(method !== null, 'semantic method hover did not open');
t.assert(
	method.contentLines.includes('(method) target:run(value, delay)'),
	'method hover did not use the resolved declaration signature',
);
t.assert(method.row === 2 && method.startColumn === 7 && method.endColumn === 10, 'method hover range is wrong');

const retained = t.hover(2, 8);
t.assert(retained === method, 'unchanged hover query rebuilt its retained tooltip');

const builtin = t.hover(3, 6);
t.assert(builtin !== null, 'builtin hover did not open');
t.assert(
	builtin.contentLines.includes('(function) math.max(first, ...)'),
	'builtin hover did not follow the exported firmware function',
);
t.assert(
	builtin.contentLines.includes('math.max = <function> (function)'),
	'builtin hover did not compose the suspended runtime value',
);

const missing = t.hover(4, 8);
t.assert(missing === null, 'unresolved static text was presented as a debugger value');

const constant = t.hover(0, 7);
t.assert(constant !== null, 'declaration hover did not open');
t.assert(constant.contentLines.includes('(constant) target'), 'declaration hover kind is wrong');
