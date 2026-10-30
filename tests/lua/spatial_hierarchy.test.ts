import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import { type CPU, RunResult } from '../../machine/ts/machine/cpu/cpu';
import type { Table } from '../../machine/ts/machine/cpu/table';
import { parseLuaChunk } from '../../toolchain/ts/lua/analysis/parse';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { createTestSystemCpu, linkTestSystemBlua32 } from '../helpers/blua32';
import { materializeCpuCompletionValues, runCompletionClosure } from './cpu_test_harness';

const spatialModules = [
	'cartlib/math/affine2',
	'cartlib/math/affine3',
	'cartlib/world/spatial_hierarchy',
].map(path => {
	const source = readFileSync(`${path}.lua`, 'utf8');
	return { path, source, chunk: parseLuaChunk(source, path).chunk };
});

function createSpatialCpu(source: string, optLevel: 0 | 3) {
	// This system fixture has no BIOS assertion service. Record the first
	// violated contract in guest scalars and inspect its actual completion value.
	source = `local assertion_index = 0
local first_failed_assertion = 0
local assert<const> = function(condition)
	assertion_index = assertion_index + 1
	if not condition and first_failed_assertion == 0 then first_failed_assertion = assertion_index end
end
${source}
return first_failed_assertion`;
	const compiled = compileLuaChunkToProgram(parseLuaChunk(source, 'spatial-fixture').chunk, spatialModules, {
		entrySource: source,
		programDomain: 'system',
		optLevel,
	});
	const linked = linkTestSystemBlua32(compiled);
	const { cpu } = createTestSystemCpu(linked);
	const initialHeap = cpu.luaHeap.usedBytes();
	assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [0], 'all guest spatial contract assertions must pass');
	const allocated = cpu.luaHeap.usedBytes() - initialHeap;
	const retained = cpu.collectTrackedHeapBytes() - initialHeap;
	return { cpu, codeBytes: linked.image.textBytes.byteLength, allocated, retained };
}

function measureWarmKernel(cpu: CPU, run: Closure, iterations: number) {
	runCompletionClosure(cpu, run, [64]);
	const heap = cpu.luaHeap;
	const before = cpu.collectTrackedHeapBytes();
	const reserve = heap.reserve;
	let reservations = 0;
	let reservedBytes = 0;
	heap.reserve = function (bytes, tag0, scalar0, reference0, tag1, scalar1, reference1, tag2, scalar2, reference2) {
		reserve.call(heap, bytes, tag0, scalar0, reference0, tag1, scalar1, reference1, tag2, scalar2, reference2);
		reservations += 1;
		reservedBytes += bytes;
	};
	let cycles: number;
	try {
		cycles = runCompletionClosure(cpu, run, [iterations]);
	} finally {
		heap.reserve = reserve;
	}
	assert.equal(reservations, 0, 'successful reservations expose transient allocation even if collection hides it');
	assert.equal(reservedBytes, 0);
	assert.equal(heap.usedBytes(), before);
	return { iterations, cycles, reservations, reservedBytes };
}

const fixture = `
local h<const> = require('cartlib/world/spatial_hierarchy')
local graph<const> = h.new()
local assert2<const> = function(n, xx, xy, yx, yy, ox, oy)
	assert(n.wxx == xx and n.wxy == xy and n.wyx == yx and n.wyy == yy)
	assert(n.wox == ox and n.woy == oy)
end
local assert3<const> = function(n, xx, xy, xz, yx, yy, yz, zx, zy, zz, ox, oy, oz)
	assert(n.wxx == xx and n.wxy == xy and n.wxz == xz)
	assert(n.wyx == yx and n.wyy == yy and n.wyz == yz)
	assert(n.wzx == zx and n.wzy == zy and n.wzz == zz)
	assert(n.wox == ox and n.woy == oy and n.woz == oz)
end
`;

const behaviors = [
	{
		name: 'column-affine composition preserves nonuniform scale, shear and reflection in both families',
		source: `
local p2<const> = h.create2(graph, nil, 2, 0, 1, 3, 10, 20)
local c2<const> = h.create2(graph, nil, 0, 1, -1, 0, 4, 5)
assert(h.reparent(c2, p2, false) == h.committed)
assert(h.resolve(c2) == c2)
assert2(c2, 1, 3, -2, 0, 23, 35)
local p3<const> = h.create3(graph, nil, 2,0,0, 1,3,0, 0,1,4, 10,20,30)
local c3<const> = h.create3(graph, nil, 1,0,1, 0,-1,0, 1,0,0, 2,3,4)
assert(h.reparent(c3, p3, false) == h.committed)
assert(h.resolve(c3) == c3)
assert3(c3, 2,1,4, -1,-3,0, 2,0,0, 17,33,46)
`,
	},
	{
		name: 'a changed parent basis moves child origins; origin-only writes preserve basis revisions',
		source: `
local p<const> = h.create2(graph, nil, 1,0,0,1, 10,20)
local c<const> = h.create2(graph, nil, 1,0,0,1, 3,4)
assert(h.reparent(c, p, false) == h.committed)
h.resolve(c)
local basis<const> = c._basis_revision
h.write_origin2(p, 20,30)
h.resolve(c)
assert2(c, 1,0,0,1, 23,34)
assert(c._basis_revision == basis)
h.write_local2(p, 0,1,-1,0, 20,30)
h.resolve(c)
assert2(c, 0,1,-1,0, 16,33)
assert(c._basis_revision == basis + 1)
local p3<const> = h.create3(graph, nil, 1,0,0, 0,1,0, 0,0,1, 1,2,3)
local c3<const> = h.create3(graph, nil, 1,0,0, 0,1,0, 0,0,1, 2,3,4)
assert(h.reparent(c3, p3, false) == h.committed)
h.resolve(c3)
local basis3<const> = c3._basis_revision
h.write_origin3(p3, 10,20,30)
h.resolve(c3)
assert3(c3, 1,0,0, 0,1,0, 0,0,1, 12,23,34)
assert(c3._basis_revision == basis3)
h.write_local3(p3, 0,1,0, -1,0,0, 0,0,2, 10,20,30)
h.resolve(c3)
assert3(c3, 0,1,0, -1,0,0, 0,0,2, 7,22,38)
`,
	},
	{
		name: 'Keep World retains full affine state without a TRS decomposition',
		source: `
local old<const> = h.create2(graph, nil, 2,0,0,1, 10,20)
local c<const> = h.create2(graph, nil, 1,1,0,1, 3,4)
local new<const> = h.create2(graph, nil, -1,0,1,2, -5,6)
assert(h.reparent(c, old, false) == h.committed)
h.resolve(c)
assert2(c, 2,1,0,1, 16,24)
assert(h.reparent(c, new, true) == h.committed)
assert(c.xx == -1.5 and c.xy == 0.5 and c.yx == 0.5 and c.yy == 0.5)
assert(c.ox == -12 and c.oy == 9)
h.resolve(c)
assert2(c, 2,1,0,1, 16,24)
local p3<const> = h.create3(graph, nil, 2,0,0, 1,3,0, 0,1,4, 10,20,30)
local c3<const> = h.create3(graph, nil, 1,0,1, 0,-1,0, 1,0,0, 2,3,4)
local new3<const> = h.create3(graph, nil, -1,-1,-1, 1,2,2, 1,2,3, -2,5,8)
assert(h.reparent(c3, p3, false) == h.committed)
h.resolve(c3)
assert(h.reparent(c3, new3, true) == h.committed)
assert(c3.xx == -3 and c3.xy == -4 and c3.xz == 3)
assert(c3.yx == -1 and c3.yy == -5 and c3.yz == 3)
assert(c3.zx == -4 and c3.zy == -2 and c3.zz == 0)
assert(c3.ox == -10 and c3.oy == -1 and c3.oz == 10)
h.resolve(c3)
assert3(c3, 2,1,4, -1,-3,0, 2,0,0, 17,33,46)
`,
	},
	{
		name: 'singular parents admit Keep Local but reject inverse operations without writes',
		source: `
local zero<const> = h.create2(graph, nil, 0,0,0,0, 10,20)
local c<const> = h.create2(graph, nil, 1,2,3,4, 5,6)
assert(h.reparent(c, zero, true) == h.singular_parent)
assert(c.spatial_parent == nil and c.xx == 1 and c.xy == 2 and c.yx == 3 and c.yy == 4)
assert(c.ox == 5 and c.oy == 6)
assert(h.reparent(c, zero, false) == h.committed)
h.resolve(c)
assert2(c, 0,0,0,0, 10,20)
assert(not h.write_world_origin2(c, 90,80))
assert(c.ox == 5 and c.oy == 6 and c.spatial_parent == zero)
assert(h.reparent(c, nil, true) == h.committed)
h.resolve(c)
assert2(c, 0,0,0,0, 10,20)
local invertible<const> = h.create2(graph, nil, -1,0,1,2, 5,6)
assert(h.reparent(c, invertible, true) == h.committed)
h.resolve(c)
assert2(c, 0,0,0,0, 10,20)
local zero3<const> = h.create3(graph, nil, 0,0,0, 0,0,0, 0,0,0, 1,2,3)
local c3<const> = h.create3(graph, nil, 1,0,0, 0,1,0, 0,0,1, 4,5,6)
assert(h.reparent(c3, zero3, true) == h.singular_parent)
assert(c3.spatial_parent == nil and c3.xx == 1 and c3.yy == 1 and c3.zz == 1)
assert(c3.ox == 4 and c3.oy == 5 and c3.oz == 6)
assert(h.reparent(c3, zero3, false) == h.committed)
h.resolve(c3)
assert3(c3, 0,0,0, 0,0,0, 0,0,0, 1,2,3)
assert(not h.write_world_origin3(c3, 90,80,70))
assert(c3.ox == 4 and c3.oy == 5 and c3.oz == 6)
assert(h.reparent(c3, nil, true) == h.committed)
h.resolve(c3)
assert3(c3, 0,0,0, 0,0,0, 0,0,0, 1,2,3)
local invertible3<const> = h.create3(graph, nil, -1,-1,-1, 1,2,2, 1,2,3, -2,5,8)
assert(h.reparent(c3, invertible3, true) == h.committed)
h.resolve(c3)
assert3(c3, 0,0,0, 0,0,0, 0,0,0, 1,2,3)
`,
	},
	{
		name: 'world-origin writes use the current parent inverse and retain the local basis',
		source: `
local p<const> = h.create2(graph, nil, 2,0,1,2, 10,20)
local c<const> = h.create2(graph, nil, 0,1,-1,0, 3,4)
assert(h.reparent(c, p, false) == h.committed)
assert(h.write_world_origin2(c, 24,28))
assert(c.ox == 5 and c.oy == 4 and c.xx == 0 and c.xy == 1 and c.yx == -1 and c.yy == 0)
h.resolve(c)
assert2(c, 1,2,-2,0, 24,28)
local p3<const> = h.create3(graph, nil, -1,-1,-1, 1,2,2, 1,2,3, 10,20,30)
local c3<const> = h.create3(graph, nil, 1,0,0, 0,1,0, 0,0,1, 0,0,0)
assert(h.reparent(c3, p3, false) == h.committed)
assert(h.write_world_origin3(c3, 15,32,46))
assert(c3.ox == 2 and c3.oy == 3 and c3.oz == 4)
h.resolve(c3)
assert3(c3, -1,-1,-1, 1,2,2, 1,2,3, 15,32,46)
`,
	},
	{
		name: 'relationship admission rejects self, cycles, other graphs/families and parented origin-only bodies',
		source: `
local a<const> = h.create2(graph, nil, 1,0,0,1, 1,2)
local b<const> = h.create2(graph, nil, 1,0,0,1, 3,4)
assert(h.reparent(a, a, false) == h.invalid_relationship)
assert(h.reparent(a, b, false) == h.committed)
assert(h.reparent(b, a, false) == h.invalid_relationship)
assert(a.spatial_parent == b and b.spatial_parent == nil)
local other<const> = h.create2(h.new(), nil, 1,0,0,1, 0,0)
assert(h.reparent(b, other, false) == h.invalid_relationship)
local other3<const> = h.create3(graph, nil, 1,0,0, 0,1,0, 0,0,1, 0,0,0)
assert(h.reparent(b, other3, false) == h.invalid_relationship)
local body<const> = h.create_origin2(graph, nil, 7,8)
assert(h.reparent(body, b, false) == h.invalid_relationship)
h.write_origin2(body, 9,10)
h.resolve(body)
assert2(body, 1,0,0,1, 9,10)
`,
	},
	{
		name: 'Keep Local reparent invalidates a clean moved subtree under an already dirty parent',
		source: `
local old<const> = h.create2(graph, nil, 1,0,0,1, 1,2)
local new<const> = h.create2(graph, nil, 1,0,0,1, 100,200)
local child<const> = h.create2(graph, nil, 1,0,0,1, 3,4)
local leaf<const> = h.create2(graph, nil, 1,0,0,1, 5,6)
assert(h.reparent(child, old, false) == h.committed)
assert(h.reparent(leaf, child, false) == h.committed)
h.resolve(leaf)
assert2(leaf, 1,0,0,1, 9,12)
assert(h.reparent(child, new, false) == h.committed)
h.resolve(leaf)
assert2(leaf, 1,0,0,1, 108,210)
local origin_revision<const> = leaf._origin_revision
h.resolve(leaf)
assert(leaf._origin_revision == origin_revision)
h.write_origin2(new, 10,20)
h.write_origin2(new, 30,40)
h.resolve(leaf)
assert2(leaf, 1,0,0,1, 38,50)
assert(leaf._origin_revision == origin_revision + 1)
h.write_origin2(new, 50,60)
h.write_local2(new, 2,0,1,3, 50,60)
h.resolve(leaf)
assert2(leaf, 2,0,1,3, 76,90)
for index = 1, graph._scratch_capacity do assert(graph._scratch[index] == false) end
`,
	},
	{
		name: 'parent removal preserves surviving child poses and never rebinds a namesake',
		source: `
local owner<const> = { id = 'same-member' }
local p<const> = h.create2(graph, owner, -2,0,1,2, 10,20)
local a<const> = h.create2(graph, nil, 1,0,0,1, 3,4)
local b<const> = h.create2(graph, nil, 1,0,0,1, 5,6)
local leaf<const> = h.create2(graph, nil, 1,0,0,1, 1,2)
assert(h.reparent(a, p, false) == h.committed)
assert(h.reparent(b, p, false) == h.committed)
assert(h.reparent(leaf, a, false) == h.committed)
h.resolve(leaf)
assert2(leaf, -2,0,1,2, 8,32)
assert(graph._count == 4)
assert(h.remove(p) == h.committed)
assert(graph._count == 3 and p._hierarchy == nil)
assert(a.spatial_parent == nil and b.spatial_parent == nil and leaf.spatial_parent == a)
h.resolve(leaf)
assert2(leaf, -2,0,1,2, 8,32)
h.resolve(b)
assert2(b, -2,0,1,2, 6,32)
local replacement<const> = h.create2(graph, owner, 1,0,0,1, 100,200)
assert(replacement ~= p and a.spatial_parent == nil and b.spatial_parent == nil)
assert(h.reparent(a, p, true) == h.retired_target)
assert(h.reparent(p, replacement, false) == h.retired_target)
assert(h.remove(p) == h.retired_target and graph._count == 4)
local p3<const> = h.create3(graph, owner, -2,0,0, 0,3,0, 0,0,4, 10,20,30)
local c3<const> = h.create3(graph, nil, 1,0,0, 0,1,0, 0,0,1, 2,3,4)
assert(h.reparent(c3, p3, false) == h.committed)
assert(h.remove(p3) == h.committed)
assert(c3.spatial_parent == nil)
h.resolve(c3)
assert3(c3, -2,0,0, 0,3,0, 0,0,4, 6,29,46)
`,
	},
	{
		name: 'flat-root origin publication stays clean without bypassing child or pending-basis work',
		source: `
local p<const> = h.create_origin2(graph, nil, 1,2)
h.resolve(p)
local basis<const> = p._basis_revision
h.write_origin2(p, 3,4)
assert(p._flags == 0 and p._basis_revision == basis)
assert2(p, 1,0,0,1, 3,4)
local child<const> = h.create2(graph, nil, 1,0,0,1, 5,6)
assert(h.reparent(child, p, false) == h.committed)
h.resolve(child)
h.write_origin2(p, 7,8)
h.resolve(child)
assert2(child, 1,0,0,1, 12,14)
local pending<const> = h.create2(graph, nil, 1,0,0,1, 1,2)
h.resolve(pending)
h.write_local2(pending, 2,1,3,4, 5,6)
h.write_origin2(pending, 7,8)
h.resolve(pending)
assert2(pending, 2,1,3,4, 7,8)
local p3<const> = h.create3(graph, nil, 1,0,0, 0,1,0, 0,0,1, 1,2,3)
h.resolve(p3)
local basis3<const> = p3._basis_revision
h.write_origin3(p3, 4,5,6)
assert(p3._flags == 0 and p3._basis_revision == basis3)
assert3(p3, 1,0,0, 0,1,0, 0,0,1, 4,5,6)
local child3<const> = h.create3(graph, nil, 1,0,0, 0,1,0, 0,0,1, 7,8,9)
assert(h.reparent(child3, p3, false) == h.committed)
h.resolve(child3)
h.write_origin3(p3, 10,11,12)
h.resolve(child3)
assert3(child3, 1,0,0, 0,1,0, 0,0,1, 17,19,21)
local pending3<const> = h.create3(graph, nil, 1,0,0, 0,1,0, 0,0,1, 0,0,0)
h.resolve(pending3)
h.write_local3(pending3, 2,1,0, 3,4,1, 0,1,2, 1,2,3)
h.write_origin3(pending3, 7,8,9)
h.resolve(pending3)
assert3(pending3, 2,1,0, 3,4,1, 0,1,2, 7,8,9)
`,
	},
	{
		name: 'stackless invalidation reaches sibling branches after a middle-child unlink',
		source: `
local p<const> = h.create2(graph, nil, 1,0,0,1, 0,0)
local a<const> = h.create2(graph, nil, 1,0,0,1, 1,2)
local b<const> = h.create2(graph, nil, 1,0,0,1, 3,4)
local c<const> = h.create2(graph, nil, 1,0,0,1, 5,6)
local a_leaf<const> = h.create2(graph, nil, 1,0,0,1, 7,8)
local b_leaf<const> = h.create2(graph, nil, 1,0,0,1, 9,10)
assert(h.reparent(a, p, false) == h.committed)
assert(h.reparent(b, p, false) == h.committed)
assert(h.reparent(c, p, false) == h.committed)
assert(h.reparent(a_leaf, a, false) == h.committed)
assert(h.reparent(b_leaf, b, false) == h.committed)
h.resolve(a_leaf)
h.resolve(b_leaf)
h.resolve(c)
h.write_origin2(p, 10,20)
h.resolve(a_leaf)
h.resolve(b_leaf)
h.resolve(c)
assert2(a_leaf, 1,0,0,1, 18,30)
assert2(b_leaf, 1,0,0,1, 22,34)
assert2(c, 1,0,0,1, 15,26)
assert(h.reparent(b, nil, false) == h.committed)
h.write_origin2(p, 30,40)
h.resolve(a_leaf)
h.resolve(b_leaf)
h.resolve(c)
assert2(a_leaf, 1,0,0,1, 38,50)
assert2(b_leaf, 1,0,0,1, 12,14)
assert2(c, 1,0,0,1, 35,46)
`,
	},
];

for (const optLevel of [0, 3] as const) {
	for (const behavior of behaviors) {
		test(`spatial O${optLevel}: ${behavior.name}`, () => {
			createSpatialCpu(fixture + behavior.source, optLevel);
		});
	}
}

test('spatial: warmed 2D/3D writes and queries make zero guest heap reservations', t => {
	const { cpu, codeBytes, allocated, retained } = createSpatialCpu(fixture + `
local p2<const> = h.create2(graph, nil, 2,0,1,2, 10,20)
local c2<const> = h.create2(graph, nil, 1,0,0,1, 3,4)
local p3<const> = h.create3(graph, nil, 2,0,0, 1,2,0, 0,1,2, 10,20,30)
local c3<const> = h.create3(graph, nil, 1,0,0, 0,1,0, 0,0,1, 2,3,4)
assert(h.reparent(c2, p2, false) == h.committed)
assert(h.reparent(c3, p3, false) == h.committed)
h.resolve(c2)
h.resolve(c3)
local basis2<const> = c2._basis_revision
local basis3<const> = c3._basis_revision
probe = {
	run = function(count)
		for index = 1, count do
			h.write_origin2(p2, index, -index)
			h.resolve(c2)
			h.resolve(c2)
			h.write_origin3(p3, index, index * 2, -index)
			h.resolve(c3)
			h.resolve(c3)
		end
	end,
	check = function()
		assert(c2._basis_revision == basis2 and c3._basis_revision == basis3)
		assert(c2.wox == 2058 and c2.woy == -2040)
		assert(c3.wox == 2055 and c3.woy == 4106 and c3.woz == -2040)
		for index = 1, graph._scratch_capacity do assert(graph._scratch[index] == false) end
		return first_failed_assertion
	end,
}
`, 3);
	const probe = cpu.getGlobalByKey(cpu.stringPool.find('probe')!) as Table;
	const run = probe.getStringKey(cpu.stringPool.find('run')!) as Closure;
	const measured = measureWarmKernel(cpu, run, 2048);
	runCompletionClosure(cpu, probe.getStringKey(cpu.stringPool.find('check')!) as Closure, []);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [0]);
	t.diagnostic(JSON.stringify({ ...measured, codeBytes, allocated, retained }));
});

test('spatial: clean read cost is independent of hierarchy depth', t => {
	const { cpu } = createSpatialCpu(fixture + `
local build<const> = function(depth)
	local previous = h.create2(graph, nil, 1,0,0,1, 1,2)
	for index = 1, depth do
		local current<const> = h.create2(graph, nil, 1,0,0,1, 1,2)
		assert(h.reparent(current, previous, false) == h.committed)
		previous = current
	end
	h.resolve(previous)
	return previous
end
probe = {
	shallow = build(1), deep = build(128),
	read = function(node, count)
		local sum = 0
		for index = 1, count do sum = sum + h.resolve(node).wox end
		return sum
	end,
}
`, 3);
	const probe = cpu.getGlobalByKey(cpu.stringPool.find('probe')!) as Table;
	const read = probe.getStringKey(cpu.stringPool.find('read')!) as Closure;
	const shallow = probe.getStringKey(cpu.stringPool.find('shallow')!) as Table;
	const deep = probe.getStringKey(cpu.stringPool.find('deep')!) as Table;
	runCompletionClosure(cpu, read, [shallow, 32]);
	runCompletionClosure(cpu, read, [deep, 32]);
	const shallowCycles = runCompletionClosure(cpu, read, [shallow, 2048]);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [2 * 2048]);
	const deepCycles = runCompletionClosure(cpu, read, [deep, 2048]);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [129 * 2048]);
	assert.equal(deepCycles, shallowCycles, 'a clean read must not traverse its ancestors');
	t.diagnostic(JSON.stringify({ iterations: 2048, shallowCycles, deepCycles }));
});

test('spatial: flat-root and full-basis/inverse kernels have separate allocation-free measurements', t => {
	const { cpu, codeBytes, allocated, retained } = createSpatialCpu(fixture + `
local root2<const> = h.create_origin2(graph, nil, 0,0)
local root3<const> = h.create3(graph, nil, 1,0,0, 0,1,0, 0,0,1, 0,0,0)
local p2<const> = h.create2(graph, nil, 2,0,1,2, 0,0)
local c2<const> = h.create2(graph, nil, 1,0,0,1, 2,4)
local p3<const> = h.create3(graph, nil, 2,0,0, 1,2,0, 0,1,2, 0,0,0)
local c3<const> = h.create3(graph, nil, 1,0,0, 0,1,0, 0,0,1, 2,3,4)
assert(h.reparent(c2, p2, false) == h.committed)
assert(h.reparent(c3, p3, false) == h.committed)
h.resolve(root2)
h.resolve(root3)
probe = {
	run_root = function(count)
		for index = 1, count do
			h.write_origin2(root2, index, -index)
			h.resolve(root2)
			h.write_origin3(root3, index, index * 2, -index)
			h.resolve(root3)
		end
	end,
	check_root = function()
		assert2(root2, 1,0,0,1, 2048,-2048)
		assert3(root3, 1,0,0, 0,1,0, 0,0,1, 2048,4096,-2048)
		assert(root2._flags == 0 and root3._flags == 0)
		return first_failed_assertion
	end,
	run_basis = function(count)
		for index = 1, count do
			h.write_local2(p2, 2,0,1,2, index,-index)
			h.resolve(c2)
			h.write_world_origin2(c2, index + 8, -index + 8)
			h.resolve(c2)
			h.write_local3(p3, 2,0,0, 1,2,0, 0,1,2, index,index * 2,-index)
			h.resolve(c3)
			h.write_world_origin3(c3, index + 7, index * 2 + 10, -index + 8)
			h.resolve(c3)
		end
	end,
	check_basis = function()
		assert2(c2, 2,0,1,2, 2056,-2040)
		assert3(c3, 2,0,0, 1,2,0, 0,1,2, 2055,4106,-2040)
		assert(c2.ox == 2 and c2.oy == 4)
		assert(c3.ox == 2 and c3.oy == 3 and c3.oz == 4)
		return first_failed_assertion
	end,
}
`, 3);
	const probe = cpu.getGlobalByKey(cpu.stringPool.find('probe')!) as Table;
	for (const lane of ['root', 'basis'] as const) {
		const run = probe.getStringKey(cpu.stringPool.find(`run_${lane}`)!) as Closure;
		const measured = measureWarmKernel(cpu, run, 2048);
		runCompletionClosure(cpu, probe.getStringKey(cpu.stringPool.find(`check_${lane}`)!) as Closure, []);
		assert.deepEqual(materializeCpuCompletionValues(cpu), [0]);
		t.diagnostic(JSON.stringify({ lane, ...measured, codeBytes, allocated, retained }));
	}
});
