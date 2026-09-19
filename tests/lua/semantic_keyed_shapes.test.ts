import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildLuaSemanticFrontend } from '../../toolchain/ts/lua/semantic/frontend';

function completedNames(body: string): string[] {
	const source = `${body}\nreturn selected.marker`;
	const frontend = buildLuaSemanticFrontend([{ path: 'shape.lua', source }]);
	const context = frontend.getFile('shape.lua').findMemberCompletionContextAt(source.split('\n').length, 'return selected.'.length + 1)!;
	return frontend.snapshot.symbolResolver.getWholeProgramMembers(context.receiver).map(declaration => declaration.name);
}

test('stored values follow the last assignment in the current block', () => {
	assert.deepEqual(completedNames(`local function build()
	local value = { earlier = true }
	value = { current = true }
	local result = { item = value }
	return result
end
local selected = build().item`), ['current']);
});

test('simultaneous assignments read their old inputs before publishing new values', () => {
	assert.deepEqual(completedNames(`local function build()
	local left, right = { left = true }, { right = true }
	left, right = right, left
	local result = { item = left }
	return result
end
local selected = build().item`), ['right']);
});

test('a single parameter reassignment replaces its entry value before a store', () => {
	assert.deepEqual(completedNames(`local function build(value)
	value = { current = true }
	local result = { item = value }
	return result
end
local selected = build({ earlier = true }).item`), ['current']);
});

test('a store after a branch retains both reaching values', () => {
	assert.deepEqual(completedNames(`local function build(flag)
	local value = { left = true }
	if flag then value = { right = true } end
	local result = { item = value }
	return result
end
local selected = build(unknown).item`), ['left', 'right']);
});

test('indexed property writes resolve when the key is read through an alias', () => {
	assert.deepEqual(completedNames(`local key = {}
local alias = key
local store = external
store[key].marker = true
local selected = store[alias]`), ['marker']);
});

test('an arithmetic write key shares the numeric element domain', () => {
	for (const key of ['1 + 0', 'slot']) {
		assert.deepEqual(completedNames(`local slot = 1 + 0
local store = {}
store[${key}] = { marker = true }
local selected = store[1]`), ['marker']);
	}
});

test('a call can replace a captured value before it is stored', () => {
	assert.deepEqual(completedNames(`local function build()
	local value = { earlier = true }
	local function replace() value = { current = true } end
	replace()
	local result = { item = value }
	return result
end
local selected = build().item`), ['current', 'earlier']);
});

test('a shared storage alias does not merge the prototypes of its possible values', () => {
	assert.deepEqual(completedNames(`local first = { marker = true }
local second = { unrelated = true }
local left = setmetatable({}, { __index = first })
local right = setmetatable({}, { __index = second })
local holder = left
holder = right
local selected = left`), ['marker']);
});

test('completion includes effects on the object returned by an identity callback', () => {
	assert.deepEqual(completedNames(`local function identity(value) return value end
local function initialize(value)
	local target = identity(value)
	target.marker = true
end
local selected = {}
initialize(selected)`), ['marker']);
});

for (const buckets of [false, true]) for (const chains of [false, true]) for (const common of [false, true]) {
	test(`keyed component shape: buckets=${buckets}, inheritance=${chains}, shared allocation body=${common}`, () => {
		const source = `local base = {}; base.__index = base
		function base.new() return setmetatable({},base) end
		local first = {}; first.__index = first
		local second = {}; second.__index = second
		setmetatable(first,{__index=base})
		setmetatable(second,{__index=base})
		function first.new() return setmetatable(${common ? 'base.new()' : '{}'}, first) end
		function second.new() return setmetatable(${common ? 'base.new()' : '{}'}, second) end
		function first:move() end
		function second:collide() end
		local cache = {}
		local function chain(class)
		 local cached=cache[class]
		 if cached then return cached end
		 local list={}
		 local current=class
		 while current do
		  list[#list+1]=current
		  local mt=getmetatable(current)
		  current=mt and mt.__index
		 end
		 cache[class]=list
		 return list
		end
		local store={}
		local function add(value)
		 ${chains ? 'local classes=chain(getmetatable(value))\n for i=1,#classes do\n local class=classes[i]' : 'local class=getmetatable(value)'}
		 ${buckets ? 'local bucket=store[class]\n if bucket==nil then bucket={} store[class]=bucket end\n local slot=#bucket+1\n bucket[slot]=value' : 'store[class]=value'}
		 ${chains ? 'end' : ''}
		end
		local factories={first.new,second.new}
		for i=1,#factories do add(factories[i]()) end
		local selected=store[first]${buckets ? '[1]' : ''}
		selected:move()`;
		const frontend = buildLuaSemanticFrontend([{ path: 'keyed.lua', source }]);
		const file = frontend.getFile('keyed.lua');
		const context = file.findMemberCompletionContextAt(source.split('\n').length, source.split('\n').at(-1)!.indexOf('move') + 1)!;
		const names = () => frontend.snapshot.symbolResolver.getWholeProgramMembers(context.receiver).map(declaration => declaration.name);
		assert.deepEqual(names(), ['__index', 'move', 'new']);
		const metrics = frontend.snapshot.symbolResolver.getSemanticQueryMetrics();
		assert.deepEqual(names(), ['__index', 'move', 'new']);
		assert.deepEqual(frontend.snapshot.symbolResolver.getSemanticQueryMetrics(), metrics, 'warm completion consumes the retained answer');
	});
}

for (const topLevel of [true, false]) test(`constructor query follows external registry IDs: topLevel=${topLevel}`, () => {
	const lines = [
	 'local component = {}',
	 'component.__index = component',
	 'function component.new() return setmetatable({}, component) end',
	 'function component:move() end',
	 'local store = {}',
	 'function store:initialize() self.values = {} end',
	 'function store:add(value) self.values[getmetatable(value)] = value end',
	 'function store:get(class) return self.values[class] end',
	 'local definitions = {}',
	 'local function define(source)',
	 ' setmetatable(source.class, {__index = store})',
	 ' definitions[source.id] = {',
	 '  ctor = source.class.construct,',
	 '  initialize = store.initialize,',
	 '  components = source.components,',
	 '  meta = {__index = source.class},',
	 ' }',
	 'end',
	 'local function lookup(id) return definitions[id] end',
	 'local function spawn(id)',
	 ' local definition = lookup(id)',
	 ' local obj = setmetatable({}, definition.meta)',
	 ' definition.initialize(obj)',
	 ' local factories = definition.components',
	 ' for i = 1, #factories do obj:add(factories[i]()) end',
	 ' local ctor = definition.ctor',
	 ' if ctor then ctor(obj) end',
	 ' return obj',
	 'end',
	 'local actor = {}',
	 'actor.__index = actor',
	 'function actor:construct()',
	 ' local found = self:get(component)',
	 ' found:move()',
	 'end',
	 'local function register()',
	 " define({id = object_id, class = actor, components = {component.new}})",
	 'end',
	 ...(topLevel ? ['register()', "spawn(object_id)"] : ['local function boot()', ' register()', " spawn(object_id)", 'end', 'boot()']),
	];
	const frontend = buildLuaSemanticFrontend([
		{ path: 'construct.lua', source: lines.join('\n') },
		{ path: 'ids.lua', source: "object_id = 'example'" },
	]);
	const file = frontend.getFile('construct.lua');
	const usageIndex = lines.findIndex(line => line.includes('found:move'));
	const context = file.findMemberCompletionContextAt(usageIndex + 1, 8)!;

	const names = frontend.snapshot.symbolResolver.getWholeProgramMembers(context.receiver).map(declaration => declaration.name);
	assert.deepEqual(names, ['__index', 'move', 'new']);
});
