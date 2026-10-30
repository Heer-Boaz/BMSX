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
		name: 'whole world-affine writes solve one parent inverse and preserve authority on failure',
		source: `
local p<const> = h.create2(graph, nil, 2,0,1,2, 10,20)
local c<const> = h.create2(graph, nil, 1,0,0,1, 0,0)
assert(h.reparent(c, p, false) == h.committed)
assert(h.write_world2(c, 1,2,-2,0, 20,28))
assert(c.xx == 0 and c.xy == 1 and c.yx == -1 and c.yy == 0 and c.ox == 3 and c.oy == 4)
h.resolve(c)
assert2(c, 1,2,-2,0, 20,28)
h.write_local2(p, 0,0,0,0, 10,20)
local flags<const> = c._flags
assert(not h.write_world2(c, 3,4,5,6, 70,80))
assert(c._flags == flags and c.xx == 0 and c.xy == 1 and c.yx == -1 and c.yy == 0
 and c.ox == 3 and c.oy == 4 and c.spatial_parent == p)
local p3<const> = h.create3(graph, nil, 2,0,0, 1,2,0, 0,0,4, 10,20,30)
local c3<const> = h.create3(graph, nil, 1,0,0, 0,1,0, 0,0,1, 0,0,0)
assert(h.reparent(c3, p3, false) == h.committed)
assert(h.write_world3(c3, 1,2,0, -2,0,0, 0,0,-4, 20,28,46))
assert(c3.xx == 0 and c3.xy == 1 and c3.xz == 0 and c3.yx == -1 and c3.yy == 0 and c3.yz == 0
 and c3.zx == 0 and c3.zy == 0 and c3.zz == -1 and c3.ox == 3 and c3.oy == 4 and c3.oz == 4)
h.resolve(c3)
assert3(c3, 1,2,0, -2,0,0, 0,0,-4, 20,28,46)
h.write_local3(p3, 0,0,0, 0,0,0, 0,0,0, 1,2,3)
local flags3<const> = c3._flags
assert(not h.write_world3(c3, 2,0,0, 0,2,0, 0,0,2, 7,8,9))
assert(c3._flags == flags3 and c3.xx == 0 and c3.xy == 1 and c3.yx == -1 and c3.yy == 0
 and c3.zz == -1 and c3.ox == 3 and c3.oy == 4 and c3.oz == 4 and c3.spatial_parent == p3)
`,
	},
	{
		name: 'retained affine math permits aliasing and distinguishes points from vectors',
		source: `
local a2<const> = require('cartlib/math/affine2')
local a3<const> = require('cartlib/math/affine3')
local left<const> = { xx=2,xy=0,yx=1,yy=2,ox=10,oy=20 }
local right<const> = { xx=0,xy=1,yx=-1,yy=0,ox=3,oy=4 }
a2.compose(right, left, right)
assert(right.xx == 1 and right.xy == 2 and right.yx == -2 and right.yy == 0 and right.ox == 20 and right.oy == 28)
assert(a2.inverse(left, left))
assert(left.xx == 0.5 and left.xy == 0 and left.yx == -0.25 and left.yy == 0.5 and left.ox == 0 and left.oy == -10)
local node<const> = h.create2(graph, nil, 2,0,1,2, 10,20)
h.resolve(node)
local x<const>, y<const> = a2.transform_point(node, 3,4)
local vx<const>, vy<const> = a2.transform_vector(node, 3,4)
assert(x == 20 and y == 28 and vx == 10 and vy == 8)
local success<const>, lx<const>, ly<const> = a2.inverse_transform_point(node, x,y)
local vector_success<const>, lvx<const>, lvy<const> = a2.inverse_transform_vector(node, vx,vy)
assert(success and vector_success and lx == 3 and ly == 4 and lvx == 3 and lvy == 4)
local left<const>, top<const>, right<const>, bottom<const> = a2.basis_bounds(2,0,1,-3, -1,-2,4,5)
assert(left == -4 and top == -15 and right == 13 and bottom == 6)
local reflected_left<const>, reflected_top<const>, reflected_right<const>, reflected_bottom<const> =
 a2.basis_bounds(0,2,-3,1, 0,0,4,5)
assert(reflected_left == -15 and reflected_top == 0 and reflected_right == 0 and reflected_bottom == 13)
local zero_left<const>, zero_top<const>, zero_right<const>, zero_bottom<const> = a2.basis_bounds(0,0,0,0, -1,-2,4,5)
assert(zero_left == 0 and zero_top == 0 and zero_right == 0 and zero_bottom == 0)
local matrix<const> = { xx=2,xy=0,xz=0,yx=1,yy=2,yz=0,zx=0,zy=0,zz=4,ox=10,oy=20,oz=30 }
local inverse<const> = {}
assert(a3.inverse(inverse, matrix))
a3.compose(matrix, inverse, matrix)
assert(matrix.xx == 1 and matrix.xy == 0 and matrix.xz == 0 and matrix.yx == 0 and matrix.yy == 1
 and matrix.yz == 0 and matrix.zx == 0 and matrix.zy == 0 and matrix.zz == 1
 and matrix.ox == 0 and matrix.oy == 0 and matrix.oz == 0)
local node3<const> = h.create3(graph, nil, 2,0,0, 1,2,0, 0,0,4, 10,20,30)
h.resolve(node3)
local x3<const>, y3<const>, z3<const> = a3.transform_point(node3, 3,4,5)
local vx3<const>, vy3<const>, vz3<const> = a3.transform_vector(node3, 3,4,5)
assert(x3 == 20 and y3 == 28 and z3 == 50 and vx3 == 10 and vy3 == 8 and vz3 == 20)
local success3<const>, lx3<const>, ly3<const>, lz3<const> = a3.inverse_transform_point(node3, x3,y3,z3)
local vector_success3<const>, lvx3<const>, lvy3<const>, lvz3<const> = a3.inverse_transform_vector(node3, vx3,vy3,vz3)
assert(success3 and vector_success3 and lx3 == 3 and ly3 == 4 and lz3 == 5 and lvx3 == 3 and lvy3 == 4 and lvz3 == 5)
h.write_local3(node3, 0,0,0, 0,0,0, 0,0,0, 1,2,3)
h.resolve(node3)
assert(not a3.inverse_transform_point(node3, 1,2,3) and not a3.inverse_transform_vector(node3, 1,2,3))
local xx<const>, xy<const>, xz<const>, yx<const>, yy<const>, yz<const>, zx<const>, zy<const>, zz<const>, ox<const>, oy<const>, oz<const> =
 a3.trs(7,8,9, 0,0,1,0, 2,3,4)
assert(xx == -2 and xy == 0 and xz == 0 and yx == 0 and yy == -3 and yz == 0
 and zx == 0 and zy == 0 and zz == 4 and ox == 7 and oy == 8 and oz == 9)
`,
	},
	{
		name: 'bulk retirement materializes every survivor before unlinking any selected ancestor',
		source: `
for dimension = 2, 3 do
 for reverse = 0, 1 do
  local graph<const> = h.new()
  local a, survivor, b, leaf
  if dimension == 2 then
   a = h.create2(graph, nil, 2,0,1,2, 10,20)
   survivor = h.create2(graph, nil, 0,1,-1,0, 3,4)
   b = h.create2(graph, nil, 2,0,0,3, 5,6)
   leaf = h.create2(graph, nil, 1,0,0,1, 7,8)
  else
   a = h.create3(graph, nil, 2,0,0, 1,2,0, 0,0,4, 10,20,30)
   survivor = h.create3(graph, nil, 0,1,0, -1,0,0, 0,0,1, 3,4,5)
   b = h.create3(graph, nil, 2,0,0, 0,3,0, 0,0,-1, 5,6,7)
   leaf = h.create3(graph, nil, 1,0,0, 0,1,0, 0,0,1, 7,8,9)
  end
  assert(h.reparent(survivor, a, false) == h.committed)
  assert(h.reparent(b, survivor, false) == h.committed)
  assert(h.reparent(leaf, b, false) == h.committed)
  h.resolve(leaf)
  local saved_x<const>, saved_y<const>, saved_z<const> = leaf.wox, leaf.woy, leaf.woz
  local saved_xx<const>, saved_xy<const>, saved_xz<const> = leaf.wxx, leaf.wxy, leaf.wxz
  local saved_yy<const>, saved_zz<const> = leaf.wyy, leaf.wzz
  a._retiring = true
  b._retiring = true
  local first<const> = reverse == 0 and a or b
  local last<const> = reverse == 0 and b or a
  h.materialize_surviving_children(first)
  h.materialize_surviving_children(last)
  h.detach_surviving_children(first)
  h.detach_surviving_children(last)
  h.retire(first)
  h.retire(last)
  assert(a._hierarchy == nil and b._hierarchy == nil and graph._count == 2)
  assert(survivor.spatial_parent == nil and leaf.spatial_parent == nil)
  assert(a._first_child == nil and a._last_child == nil and b._first_child == nil and b._last_child == nil)
  h.resolve(leaf)
  assert(leaf.wox == saved_x and leaf.woy == saved_y and leaf.woz == saved_z
   and leaf.wxx == saved_xx and leaf.wxy == saved_xy and leaf.wxz == saved_xz
   and leaf.wyy == saved_yy and leaf.wzz == saved_zz)
  assert(b.xx == 2 and b.yy == 3 and b.ox == 5 and b.oy == 6)
  assert(h.reparent(leaf, a, true) == h.retired_target)
 end
end
`,
	},
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
		name: 'world-origin writes reuse clean affine roots without losing dirty basis or descendant propagation',
		source: `
local root2<const> = h.create2(graph, nil, 2,0,1,3, 7,8)
local root3<const> = h.create3(graph, nil, 2,0,0, 1,3,0, 0,1,-4, 7,8,9)
h.resolve(root2)
h.resolve(root3)
local basis2<const>, basis3<const> = root2._basis_revision, root3._basis_revision
local origin2<const>, origin3<const> = root2._origin_revision, root3._origin_revision
assert(h.write_world_origin2(root2, 10,20))
assert(h.write_world_origin3(root3, 30,40,50))
assert(root2.wox == 10 and root2.woy == 20 and root2._flags == 0)
assert(root3.wox == 30 and root3.woy == 40 and root3.woz == 50 and root3._flags == 0)
assert(root2._basis_revision == basis2 and root3._basis_revision == basis3)
assert(root2._origin_revision == origin2 + 1 and root3._origin_revision == origin3 + 1)
h.write_local2(root2, 0,2,-3,0, 10,20)
assert(h.write_world_origin2(root2, 60,70))
h.resolve(root2)
assert2(root2, 0,2,-3,0, 60,70)
local child<const> = h.create3(graph, nil, 1,0,0, 0,1,0, 0,0,1, 1,2,3)
assert(h.reparent(child, root3, false) == h.committed)
h.resolve(child)
assert(h.write_world_origin3(root3, 100,200,300))
h.resolve(child)
assert(child.wox == 104 and child.woy == 209 and child.woz == 288)
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
