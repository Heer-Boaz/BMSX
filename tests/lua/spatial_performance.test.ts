import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import { type CPU, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { CpuSnapshotObjectKind } from '../../machine/ts/machine/cpu/snapshot';
import type { Table } from '../../machine/ts/machine/cpu/table';
import { INSTRUCTION_BYTES } from '../../machine/ts/spec/blua32/instruction_format';
import { MemoryAccessKind } from '../../machine/ts/spec/blua32/memory_access_kind';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { parseLuaChunk } from '../../toolchain/ts/lua/analysis/parse';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { describeBlua32InstructionAtPc } from '../../toolchain/ts/rompack/disassembler';
import { createTestSystemCpu, linkTestSystemBlua32 } from '../helpers/blua32';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { profileWarmGuestKernel } from '../helpers/guest_kernel';
import { WORLD_CPU_MODULES, WORLD_CPU_SETUP } from '../helpers/world_cpu';
import { materializeCpuCompletionValues, runCompletionClosure } from './cpu_test_harness';

// Reference workload design: Bevy's stress_tests/transform_hierarchy.rs separates
// update_leaves, update_shallow, wide trees and inactive rigs. Here the measured
// window excludes construction and varies affected width independently of the
// unrelated World population. These are guest machine cycles, not host timings.
// https://github.com/bevyengine/bevy/blob/main/examples/stress_tests/transform_hierarchy.rs
const worldFixture = WORLD_CPU_SETUP + `
prefab.define({def_id='measure.2d',class={},spatial={family='2d',authority='affine'}})
prefab.define({def_id='measure.3d',class={},spatial={family='3d',authority='affine'}})
local options<const> = {}
local branches2<const>, branches3<const> = {}, {}
local selected_width=1
local leaf2, leaf3
local build<const> = function(id, width)
 local root<const> = world:spawn(id, options).spatial
 local child
 for index=1,width do
  child=world:spawn(id,options).spatial
  assert(hierarchy.reparent(child,root,false)==hierarchy.committed)
  hierarchy.resolve(child)
 end
 return root, child
end
local complete<const> = function(context,result)
 assert(result==hierarchy.committed)
 context.completed=context.completed+1
end
local retired<const> = setmetatable({}, {__mode='v'})
local context<const> = {completed=0}
local anchor2, anchor3
probe = {
 graph=world._spatial_hierarchy, retired=retired,
 admit=function()
  branches2[1],leaf2=build('measure.2d',1)
  branches3[1],leaf3=build('measure.3d',1)
  branches2[2]=build('measure.2d',8)
  branches3[2]=build('measure.3d',8)
  branches2[3]=build('measure.2d',32)
  branches3[3]=build('measure.3d',32)
  anchor2=world:spawn('measure.2d',options).spatial
  anchor3=world:spawn('measure.3d',options).spatial
  hierarchy.resolve(anchor2)
  hierarchy.resolve(anchor3)
 end,
 unrelated=function(count)
  for index=1,count do
   local id<const> = index%2==0 and 'measure.2d' or 'measure.3d'
   hierarchy.resolve(world:spawn(id,options).spatial)
  end
 end,
 select_width=function(index) selected_width=index end,
 leaf2=function(count)
  for index=1,count do hierarchy.write_origin2(leaf2,index,-index); hierarchy.resolve(leaf2) end
 end,
 leaf3=function(count)
  for index=1,count do hierarchy.write_origin3(leaf3,index,-index,index*2); hierarchy.resolve(leaf3) end
 end,
 branch2=function(count)
  local root<const> = branches2[selected_width]
  for index=1,count do
   hierarchy.write_origin2(root,index,-index)
   local child=root._first_child
   while child~=nil do hierarchy.resolve(child); child=child._next_sibling end
  end
 end,
 branch3=function(count)
  local root<const> = branches3[selected_width]
  for index=1,count do
   hierarchy.write_origin3(root,index,-index,index*2)
   local child=root._first_child
   while child~=nil do hierarchy.resolve(child); child=child._next_sibling end
  end
 end,
 churn=function(count)
  for index=1,count do
   local a<const> = world:spawn('measure.2d',options)
   local b<const> = world:spawn('measure.3d',options)
   retired[1],retired[2],retired[3],retired[4]=a,a.spatial,b,b.spatial
   world:_open_mutation_barrier()
   world:reparent(a.spatial,anchor2,false,complete,context)
   world:reparent(b.spatial,anchor3,false,complete,context)
   world:_commit_mutation_barrier()
   hierarchy.resolve(a.spatial)
   hierarchy.resolve(b.spatial)
   world:_open_mutation_barrier()
   world:reparent(a.spatial,nil,true,complete,context)
   world:reparent(b.spatial,nil,true,complete,context)
   world:_commit_mutation_barrier()
   world:_open_mutation_barrier()
   a:mark_for_disposal()
   b:mark_for_disposal()
   world:_commit_mutation_barrier()
   assert(a.world==nil and b.world==nil and a.spatial._hierarchy==nil and b.spatial._hierarchy==nil)
  end
 end,
 steady=function(count)
  for index=1,count do
   anchor2:set_local_origin(index,-index)
   anchor3:set_local_origin(index,-index,index*2)
   anchor2:resolve_world()
   anchor3:resolve_world()
  end
 end,
 check=function()
  assert(not world._mutation_barrier_open and world._pending_mutation_mask==0)
  assert(world._pending_admission_count==0 and world._pending_disposal_count==0
   and world._pending_reparent_count==0 and world._pending_component_count==0
   and world._pending_component_attach_count==0 and world._pending_component_detach_count==0
   and world._pending_object_count==0 and world._pending_tag_count==0)
  assert(next(world._pending_admissions)==nil and next(world._pending_disposals)==nil
   and next(world._pending_reparent_targets)==nil and next(world._pending_reparent_parents)==nil
   and next(world._pending_reparent_modes)==nil and next(world._pending_reparent_callbacks)==nil
   and next(world._pending_reparent_contexts)==nil and next(world._pending_components)==nil
   and next(world._pending_component_attaches)==nil and next(world._pending_component_detaches)==nil
   and next(world._pending_objects)==nil and next(world._pending_tag_objects)==nil
   and next(world._pending_tag_names)==nil)
  for index=1,world._spatial_hierarchy._scratch_capacity do
   assert(world._spatial_hierarchy._scratch[index]==false)
  end
  return context.completed
 end,
}
`;

function heapObjects(cpu: CPU) {
	const snapshot = cpu.captureRuntimeState().snapshot;
	let tables = 0;
	let closures = 0;
	for (const offset of snapshot.objectWords) {
		if (snapshot.word(offset) === CpuSnapshotObjectKind.Table) tables += 1;
		if (snapshot.word(offset) === CpuSnapshotObjectKind.Closure) closures += 1;
	}
	return { objects: snapshot.objectCount, tables, closures };
}

for (const optLevel of [0, 3] as const) {
	test(`spatial CPU: unrelated World size does not tax a changed leaf or dirty branch (O${optLevel})`, t => {
		const { cpu, images } = createCartlibProgramHarness(worldFixture, { optLevel, modules: WORLD_CPU_MODULES });
		const initialHeap = cpu.luaHeap.usedBytes();
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
		const bootCycles = 20_000_000 - cpu.instructionBudgetRemaining;
		const bootAllocatedBytes = cpu.luaHeap.usedBytes() - initialHeap;
		const probe = cpu.getGlobalByKey(cpu.stringPool.find('probe')!) as Table;
		const before = cpu.collectTrackedHeapBytes();
		const beforeObjects = heapObjects(cpu);
		const admissionCycles = runCompletionClosure(cpu, probe.getStringKey(cpu.stringPool.find('admit')!) as Closure, []);
		const admittedAllocated = cpu.luaHeap.usedBytes() - before;
		const admittedRetained = cpu.collectTrackedHeapBytes() - before;
		const admittedObjects = heapObjects(cpu);
		const graph = probe.getStringKey(cpu.stringPool.find('graph')!) as Table;
		const baseCount = graph.getStringKey(cpu.stringPool.find('_count')!);
		const rows = [];
		for (const unrelated of [0, 256]) {
			if (unrelated !== 0) runCompletionClosure(cpu, probe.getStringKey(cpu.stringPool.find('unrelated')!) as Closure, [unrelated]);
			const leafCycles = [];
			const branchCycles: number[][] = [];
			for (const dimension of [2, 3]) {
				const leaf = probe.getStringKey(cpu.stringPool.find(`leaf${dimension}`)!) as Closure;
				const leafProfile = profileWarmGuestKernel(cpu, leaf, 128);
				assert.equal(leafProfile.reservations, 0);
				assert.equal(leafProfile.reservedBytes, 0);
				assert.equal(leafProfile.retainedAfter, leafProfile.retainedBefore);
				leafCycles.push(leafProfile.cycles);
				const branch = probe.getStringKey(cpu.stringPool.find(`branch${dimension}`)!) as Closure;
				const widths = [];
				for (let index = 1; index <= 3; index += 1) {
					runCompletionClosure(cpu, probe.getStringKey(cpu.stringPool.find('select_width')!) as Closure, [index]);
					const branchProfile = profileWarmGuestKernel(cpu, branch, 128);
					widths.push(branchProfile.cycles);
					assert.equal(branchProfile.reservations, 0);
					assert.equal(branchProfile.reservedBytes, 0);
					assert.equal(branchProfile.retainedAfter, branchProfile.retainedBefore);
				}
				// A fixed root charge plus one identical sibling charge. The equality
				// compares slopes, not a frozen compiler-specific cycle threshold.
				assert.ok(widths[1] > widths[0]);
				assert.equal((widths[1] - widths[0]) * 31, (widths[2] - widths[0]) * 7);
				branchCycles.push(widths);
			}
			rows.push({ unrelated, leafCycles, branchCycles });
		}
		assert.deepEqual(rows[1].leafCycles, rows[0].leafCycles);
		assert.deepEqual(rows[1].branchCycles, rows[0].branchCycles);
		runCompletionClosure(cpu, probe.getStringKey(cpu.stringPool.find('check')!) as Closure, []);
		t.diagnostic(JSON.stringify({ optLevel, iterations: 128, widths: [1, 8, 32], baseCount, rows,
			bootCycles, bootAllocatedBytes, bootRetainedBytes: before - initialHeap, admissionCycles, admittedAllocated, admittedRetained,
			admittedObjects: admittedObjects.objects - beforeObjects.objects,
			admittedTables: admittedObjects.tables - beforeObjects.tables,
			linkedCodeBytes: images.cartImage.textBytes.byteLength, configuredBssBytes: images.cartImage.header.bssByteCount,
			scratchSlots: graph.getStringKey(cpu.stringPool.find('_scratch_capacity')!) }));
	});

	test(`spatial CPU: World churn retires identities and reuses bounded retained storage (O${optLevel})`, t => {
		const { cpu, images } = createCartlibProgramHarness(worldFixture, { optLevel, modules: WORLD_CPU_MODULES });
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
		const probe = cpu.getGlobalByKey(cpu.stringPool.find('probe')!) as Table;
		runCompletionClosure(cpu, probe.getStringKey(cpu.stringPool.find('admit')!) as Closure, []);
		const churn = probe.getStringKey(cpu.stringPool.find('churn')!) as Closure;
		const graph = probe.getStringKey(cpu.stringPool.find('graph')!) as Table;
		const scratch = graph.getStringKey(cpu.stringPool.find('_scratch')!);
		// Warm the actual measurement shape, including managed queues and the
		// event-port weak-key cache's rehash/collection cycle. A shorter warmup
		// can leave that cache at a different capacity despite equal live keys.
		profileWarmGuestKernel(cpu, churn, 16);
		const retained = cpu.collectTrackedHeapBytes();
		const objects = heapObjects(cpu);
		const scratchSlots = graph.getStringKey(cpu.stringPool.find('_scratch_capacity')!);
		const measurements = [];
		for (let batch = 0; batch < 3; batch += 1) {
			const profile = profileWarmGuestKernel(cpu, churn, 16);
			assert.ok(profile.reservations > 0, 'public gameplay/component identities have real allocation costs');
			assert.ok(profile.reservedBytes > 0);
			assert.equal(cpu.collectTrackedHeapBytes(), retained, 'retired instances must not accumulate in queues or scratch');
			assert.deepEqual(heapObjects(cpu), objects);
			assert.equal(graph.getStringKey(cpu.stringPool.find('_scratch')!), scratch);
			assert.equal(graph.getStringKey(cpu.stringPool.find('_scratch_capacity')!), scratchSlots);
			const retired = probe.getStringKey(cpu.stringPool.find('retired')!) as Table;
			for (let index = 1; index <= 4; index += 1) assert.equal(retired.getInteger(index), null);
			runCompletionClosure(cpu, probe.getStringKey(cpu.stringPool.find('check')!) as Closure, []);
			measurements.push({ ...profile, collectedRetained: retained });
		}
		const steady = profileWarmGuestKernel(cpu, probe.getStringKey(cpu.stringPool.find('steady')!) as Closure, 512);
		assert.equal(steady.reservations, 0);
		assert.equal(steady.reservedBytes, 0);
		assert.equal(steady.retainedAfter, steady.retainedBefore);
		t.diagnostic(JSON.stringify({ optLevel, publicObjectsPerIteration: 2, spatialComponentsPerIteration: 2,
			measurements, steady, retainedObjects: objects, scratchSlots,
			linkedCodeBytes: images.cartImage.textBytes.byteLength, configuredBssBytes: images.cartImage.header.bssByteCount,
			topologyCompilation: 'fixed linked functions; no topology-specific generated evaluator' }));
	});
}

// Deliberately a storage/access microkernel, NOT a second hierarchy backend.
// Both representations use the same coefficients, expression grouping, record
// count, linked-next traversal and iteration counts. The BSS candidate exercises
// compiler-emitted f64 loads/stores (including fractional coefficients), rather
// than treating typed syntax as a speed or total-workload proof.
function storageFixture(dimension: 2 | 3, typed: boolean) {
	const axes = dimension === 2 ? ['x', 'y'] : ['x', 'y', 'z'];
	const fields = [...axes.flatMap(column => axes.map(row => column + row)), ...axes.map(axis => 'o' + axis)];
	const capacity = 32;
	const declaration = typed
		? `struct pose\n${fields.map(field => `${field}: f64`).join('\n')}\nnext: word\nend\nbss records: pose[${capacity}]`
		: 'local records<const> = {}';
	const node = (name: string, index: string) => typed
		? `local ${name}<const>: *pose = &records[${index}]`
		: `local ${name}<const> = records[${index}]`;
	const initialize = fields.map((field, index) => `node.${field}=${index + 0.25}`).join('\n');
	const composition = axes.flatMap(column => axes.map(row =>
		`out.${column + row}=${axes.map(axis => `left.${axis + row}*right.${column + axis}`).join('+')}`))
		.concat(axes.map(row => `out.o${row}=${axes.map(axis => `left.${axis + row}*right.o${axis}`).join('+')}+left.o${row}`)).join('\n');
	return `${declaration}
for index=0,${capacity - 1} do
 ${typed ? '' : 'records[index]={}'}
 ${node('node', 'index')}
 ${initialize}
 node.next=index+1
end
${node('left', '0')}
${node('right', '1')}
${node('out', '2')}
probe = {
 clean=function(count)
  local sum=0
  for index=1,count do sum=sum+${axes.map(axis => `out.o${axis}`).join('+')} end
  return sum
 end,
 motion=function(count)
  for index=1,count do
   ${axes.map((axis, i) => `out.o${axis}=index+${i + 0.25}`).join('\n')}
  end
  return ${axes.map(axis => `out.o${axis}`).join('+')}
 end,
 compose=function(count)
  for index=1,count do
   ${composition}
  end
  return ${fields.map(field => `out.${field}`).join('+')}
 end,
 traverse=function(count)
  local sum=0
  for index=1,count do
   local cursor=0
   while cursor<${capacity} do
    ${node('current', 'cursor')}
    sum=sum+${axes.map(axis => `current.o${axis}`).join('+')}
    cursor=current.next
   end
  end
  return sum
 end,
}
`;
}

for (const optLevel of [0, 3] as const) for (const dimension of [2, 3] as const) {
	test(`spatial CPU: flat scalar versus configured typed f64 BSS kernels (${dimension}D O${optLevel})`, t => {
		const rows = [];
		for (const typed of [false, true]) {
			const source = storageFixture(dimension, typed);
			const compiled = compileLuaChunkToProgram(parseLuaChunk(source, 'storage-kernels').chunk, [], {
				entrySource: source, programDomain: 'system', optLevel,
			});
			const linked = linkTestSystemBlua32(compiled);
			const { cpu } = createTestSystemCpu(linked);
			const initialHeap = cpu.luaHeap.usedBytes();
			assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
			const admissionCycles = 10_000_000 - cpu.instructionBudgetRemaining;
			const allocatedBytes = cpu.luaHeap.usedBytes() - initialHeap;
			const retainedBytes = cpu.collectTrackedHeapBytes() - initialHeap;
			const objects = heapObjects(cpu);
			const probe = cpu.getGlobalByKey(cpu.stringPool.find('probe')!) as Table;
			const kernels = [];
			for (const name of ['clean', 'motion', 'compose', 'traverse']) {
				const kernel = probe.getStringKey(cpu.stringPool.find(name)!) as Closure;
				const emitted = linked.image.functions.find(fn => fn.address === kernel.functionAddress)!;
				let f64Accesses = 0;
				for (let pc = emitted.codeAddress; pc < emitted.codeAddress + emitted.codeByteCount; pc += INSTRUCTION_BYTES) {
					const instruction = describeBlua32InstructionAtPc(linked.image, null, pc);
					assert.notEqual(instruction.op, OpCode.NEWT);
					assert.notEqual(instruction.op, OpCode.CLOSURE);
					assert.notEqual(instruction.op, OpCode.CALL, 'synthetic kernels contain no per-coefficient accessor calls');
					if ((instruction.op === OpCode.LOAD_MEM_D || instruction.op === OpCode.STORE_MEM_D)
						&& instruction.operands.some(operand => operand.field === 'c' && operand.text === String(MemoryAccessKind.F64LE))) f64Accesses += 1;
				}
				if (typed) assert.ok(f64Accesses > 0, `${name} must execute actual f64 memory access`);
				const profile = profileWarmGuestKernel(cpu, kernel, 256);
				assert.equal(profile.reservations, 0);
				assert.equal(profile.reservedBytes, 0);
				assert.equal(profile.retainedAfter, profile.retainedBefore);
				kernels.push({ name, ...profile, completion: materializeCpuCompletionValues(cpu),
					kernelCodeBytes: emitted.codeByteCount, maxStackSlots: emitted.maxStack, f64Accesses });
			}
			rows.push({ representation: typed ? 'typed-f64-BSS' : 'flat-scalar-tables', dimension, optLevel,
				capacity: 32, admissionCycles, allocatedBytes, retainedBytes, ...objects,
				linkedCodeBytes: linked.image.textBytes.byteLength, configuredBssBytes: linked.image.header.bssByteCount, kernels });
		}
		for (let index = 0; index < rows[0].kernels.length; index += 1) {
			assert.deepEqual(rows[1].kernels[index].completion, rows[0].kernels[index].completion,
				`${rows[0].kernels[index].name}: storage must not change arithmetic or traversal results`);
		}
		assert.equal(rows[1].tables, rows[0].tables - 33, 'configured BSS replaces one record list and 32 numeric tables');
		assert.equal(rows[0].configuredBssBytes, 0);
		assert.equal(rows[1].configuredBssBytes, 32 * ((dimension * dimension + dimension) * 8 + 4));
		for (const row of rows) t.diagnostic(JSON.stringify(row));
	});
}
