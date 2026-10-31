import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import { type CPU, RunResult } from '../../machine/ts/machine/cpu/cpu';
import type { Table } from '../../machine/ts/machine/cpu/table';
import { ValueTag } from '../../machine/ts/machine/cpu/value';
import {
	BLUA32_FUNCTION_CODE_ADDRESS_OFFSET, BLUA32_FUNCTION_CODE_BYTE_COUNT_OFFSET,
	BLUA32_FUNCTION_MAX_STACK_OFFSET,
} from '../../machine/ts/spec/blua32/image_format';
import { INSTRUCTION_BYTES } from '../../machine/ts/spec/blua32/instruction_format';
import { MAPPED_PAGE_BYTE_MASK } from '../../machine/ts/machine/memory/mapped_page';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import type { Blua32ImageLayout } from '../../toolchain/ts/rompack/blua32_image';
import { describeMappedBlua32InstructionAtPc } from '../../toolchain/ts/rompack/disassembler';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { profileWarmGuestKernel } from '../helpers/guest_kernel';
import { WORLD_CPU_MODULES, WORLD_CPU_SETUP } from '../helpers/world_cpu';
import { materializeCpuCompletionValues, runCompletionClosure } from './cpu_test_harness';

// Bevy's transform_hierarchy stress test separates propagation and inactive
// consumers; the acceptance here additionally inspects the *installed* AOT and
// firmware-generated functions, not a second implementation of their kernels.
// https://github.com/bevyengine/bevy/blob/main/examples/stress_tests/transform_hierarchy.rs
const fixture = WORLD_CPU_SETUP + `
local affine2<const> = require('cartlib/math/affine2')
local affine3<const> = require('cartlib/math/affine3')
local visual2<const> = require('cartlib/component/visual_2d_component')
local timelines<const> = require('cartlib/timeline/timeline_component')
local manual<const> = function(context)
 return timelines.new({owner=context.owner,clock_mode='manual'})
end
prefab.define({def_id='emitted.2d',class={},spatial={family='2d',authority='affine'},components={manual}})
prefab.define({def_id='emitted.3d',class={},spatial={family='3d',authority='affine'},components={manual}})
local root2<const> = world:spawn('emitted.2d',{}).spatial
local actor2<const> = world:spawn('emitted.2d',{})
local root3<const> = world:spawn('emitted.3d',{}).spatial
local actor3<const> = world:spawn('emitted.3d',{})
local child2<const>,child3<const> = actor2.spatial,actor3.spatial
hierarchy.reparent(child2,root2,false)
hierarchy.reparent(child3,root3,false)
local visual<const> = visual2.new({owner=actor2,initial={}},'visual')
actor2:add_component(visual)
hierarchy.resolve(child2)
hierarchy.resolve(child3)
visual:resolve_pose()
probe = {
 coefficient_owners={root2,child2,root3,child3,visual},
 kernels={resolve=hierarchy.resolve,write_origin2=hierarchy.write_origin2,write_origin3=hierarchy.write_origin3,
  write_local2=hierarchy.write_local2,write_local3=hierarchy.write_local3,
  evaluate2=affine2.evaluate,evaluate3=affine3.evaluate,visual=visual2.resolve_pose},
 entries={},
 run2=function(count)
  for index=1,count do
   hierarchy.write_local2(root2,2,1,0,3,index,-index)
   hierarchy.resolve(child2)
  end
 end,
 run3=function(count)
  for index=1,count do
   hierarchy.write_local3(root3,2,1,0,0,3,1,0,0,4,index,-index,index*2)
   hierarchy.resolve(child3)
  end
 end,
 visual=function(count)
  for index=1,count do
   visual:set_presentation_affine(2,1,0,3,index,-index)
   visual:resolve_pose()
  end
 end,
 compile=function()
  local curve<const> = {interpolation='linear',keys={
   {time_ms=0,value=0},{time_ms=250,value=10},{time_ms=1000,value=40}}}
  local definitions<const> = {
   {owner=actor2,name='origin2',operation='local_origin2',target=child2,channels={ox=curve}},
   {owner=actor2,name='affine2',operation='local_affine2',target=child2,channels={xx=2,xy=1,yx=0,yy=3,ox=curve,oy=7}},
   {owner=actor3,name='affine3',operation='local_affine3',target=child3,
    channels={xx=2,xy=1,xz=0,yx=0,yy=3,yz=1,zx=0,zy=0,zz=4,ox=curve,oy=7,oz=11}},
   {owner=actor2,name='presentation',operation='presentation_affine2',target=visual,
    channels={xx=2,xy=1,yx=0,yy=3,ox=curve,oy=7}},
  }
  for index=1,#definitions do
   local source<const> = definitions[index]
   source.owner.timelines:define(source.name,{phase=source.name=='presentation' and 'presentation' or 'physical',
    duration_ms=1000,playback_mode='loop',bindings={'pose'},tracks={{kind='spatial',binding='pose',
     operation=source.operation,channels=source.channels}}},{pose=source.target})
   source.owner.timelines:play(source.name)
   probe.entries[index]=source.owner.timelines:get(source.name)
  end
 end,
 sample=function(count,selection)
  local entry<const> = probe.entries[selection]
  local sample<const> = entry.program.tracks.spatial_runners[1]
  for index=1,count do sample(entry,0,index%1000) end
 end,
 tick=function(count)
  for index=1,count do
   actor2.timelines:tick_gameplay(1)
   actor3.timelines:tick_gameplay(1)
   hierarchy.resolve(child2)
   hierarchy.resolve(child3)
   visual:resolve_pose()
  end
 end,
 check=function()
  hierarchy.resolve(child2)
  hierarchy.resolve(child3)
  assert(child2.wxx==4 and child2.wxy==5 and child2.wyx==0 and child2.wyy==9)
  assert(child3.wxx==4 and child3.wxy==5 and child3.wxz==1 and child3.wzz==16)
  assert(visual:resolve_pose()==visual)
  return true
 end,
}
`;

function inspectInstalledKernel(cpu: CPU, image: Blua32ImageLayout, closure: Closure, owner: string) {
	const address = closure.functionAddress;
	const codeAddress = cpu.memory.readMappedU32LE(address + BLUA32_FUNCTION_CODE_ADDRESS_OFFSET);
	const codeBytes = cpu.memory.readMappedU32LE(address + BLUA32_FUNCTION_CODE_BYTE_COUNT_OFFSET);
	const maxStackSlots = cpu.memory.readMappedU32LE(address + BLUA32_FUNCTION_MAX_STACK_OFFSET);
	const bytes = new Uint8Array(codeBytes);
	cpu.memory.readBytesInto(codeAddress, bytes, bytes.length);
	const calls = [];
	const reads = [];
	let methodLookups = 0;
	for (let pc = codeAddress; pc < codeAddress + codeBytes; pc += INSTRUCTION_BYTES) {
		// Firmware functions have a captured constant pool, not the ROM image's
		// constant table. Operand/register decoding is shared; do not mislabel
		// their dynamic constants using the unrelated AOT table.
		const instruction = describeMappedBlua32InstructionAtPc(image, bytes, codeAddress, pc, { showConsts: false });
		assert.notEqual(instruction.op, OpCode.NEWT, `${owner}: steady-state table construction`);
		assert.notEqual(instruction.op, OpCode.CLOSURE, `${owner}: steady-state closure construction`);
		if (instruction.op === OpCode.SELF) methodLookups += 1;
		if (instruction.op === OpCode.CALL) calls.push({ pc, calleeSlot: instruction.operands.find(operand => operand.field === 'a')!.registerIndex! });
		if (instruction.op === OpCode.GETFIELD || instruction.op === OpCode.GETT) reads.push({ pc,
			op: instruction.op, tableSlot: instruction.operands.find(operand => operand.field === 'b')!.registerIndex! });
	}
	return { owner, closure, codeAddress, codeBytes, maxStackSlots, methodLookups, calls, reads };
}

for (const optLevel of [0, 3] as const) test(`actual spatial AOT and firmware kernels have coarse, allocation-free datapaths (O${optLevel})`, t => {
	const { cpu, images } = createCartlibProgramHarness(fixture, { optLevel, modules: WORLD_CPU_MODULES });
	assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
	const probe = cpu.getGlobalByKey(cpu.stringPool.find('probe')!) as Table;
	const exports = probe.getStringKey(cpu.stringPool.find('kernels')!) as Table;
	const kernels = [];
	for (const name of ['resolve','write_origin2','write_origin3','write_local2','write_local3','evaluate2','evaluate3','visual']) {
		const closure = exports.getStringKey(cpu.stringPool.find(name)!) as Closure;
		const inspected = inspectInstalledKernel(cpu, images.cartImage, closure, name);
		assert.equal(inspected.methodLookups, 0, `${name}: coefficient work uses direct fields, not method dispatch`);
		assert.ok(inspected.calls.length <= (name.startsWith('evaluate') ? 0 : 1), `${name}: only one coarse invalidate/evaluate/resolve boundary`);
		kernels.push(inspected);
	}
	const compile = probe.getStringKey(cpu.stringPool.find('compile')!) as Closure;
	const compileBefore = cpu.collectTrackedHeapBytes();
	cpu.beginCompletionCall(compile);
	assert.equal(cpu.runUntilDepth(0, 100_000_000), RunResult.Halted);
	const compileCycles = 100_000_000 - cpu.instructionBudgetRemaining;
	const compileAllocatedBytes = cpu.luaHeap.usedBytes() - compileBefore;
	const compileRetainedBytes = cpu.collectTrackedHeapBytes() - compileBefore;
	const entries = probe.getStringKey(cpu.stringPool.find('entries')!) as Table;
	const groups = [];
	for (let index = 1; index <= 4; index += 1) {
		const entry = entries.getInteger(index) as Table;
		const program = entry.getStringKey(cpu.stringPool.find('program')!) as Table;
		const tracks = program.getStringKey(cpu.stringPool.find('tracks')!) as Table;
		const runners = tracks.getStringKey(cpu.stringPool.find('spatial_runners')!) as Table;
		const closure = runners.getInteger(1) as Closure;
		assert.ok(!images.cartImage.functions.some(fn => fn.address === closure.functionAddress), 'inspect actual RAM firmware output, not an AOT stand-in');
		const group = inspectInstalledKernel(cpu, images.cartImage, closure, `spatial-group-${index}`);
		assert.equal(group.calls.length, 1, 'one publication per group, independent of two/six/twelve coefficient width');
		assert.equal(group.methodLookups, 0);
		groups.push(group);
		kernels.push(group);
		for (const [owner, callback] of [[`values-${index}`, tracks.getStringKey(cpu.stringPool.find('play_value_runner')!)],
			['timeline.evaluate_play', program.getStringKey(cpu.stringPool.find('evaluate_play')!)]] as const) {
			const inspected = inspectInstalledKernel(cpu, images.cartImage, callback as Closure, owner);
			assert.equal(inspected.calls.length, 1, `${owner}: one group/values boundary, not one call per coefficient`);
			assert.equal(inspected.methodLookups, 0);
			// The production evaluation factory shares one shape-specialized
			// evaluator between these entries; it is one installed code owner.
			if (!kernels.some(kernel => kernel.closure.functionAddress === inspected.closure.functionAddress)) kernels.push(inspected);
		}
	}
	const sites = new Map(kernels.flatMap(kernel => kernel.calls.map(call => [call.pc, { ...call, owner: kernel.owner }])));
	const readSites = new Map(kernels.flatMap(kernel => kernel.reads.map(read => [read.pc, { ...read, owner: kernel.owner }])));
	const coefficientOwners = probe.getStringKey(cpu.stringPool.find('coefficient_owners')!) as Table;
	const actualOwners = new Set(Array.from({ length: 5 }, (_, index) => coefficientOwners.getInteger(index + 1)));
	const coefficients = ['xx','xy','xz','yx','yy','yz','zx','zy','zz','ox','oy','oz'];
	const coefficientFields = new Set(['','w','attachment_','presentation_','_local_'].flatMap(prefix => coefficients.map(field => prefix + field)));
	const directReads = new Map<string, number>();
	const observed = new Map<string, Map<number, number>>();
	cpu.setInstructionObserver({ points: [new Set(), new Set([...sites.keys(), ...readSites.keys()]), new Set()], observe(domain, pc, registers) {
		assert.equal(domain, 0);
		const read = readSites.get(pc);
		if (read !== undefined) {
			const frame = cpu.activeThread.frames[cpu.activeThread.frames.length - 1];
			const page = frame.decodedPage!;
			const offset = (pc & MAPPED_PAGE_BYTE_MASK) >>> 2;
			// Consume the CPU owner's already-decoded operands. AOT field keys
			// use image constants; the firmware compiler loads its captured keys
			// into registers. Never decode a private constant-pool facade here.
			let field;
			if (read.op === OpCode.GETFIELD) field = images.cartImage.constants[page.c[offset]];
			else {
				const key = page.rkC[offset];
				if (key < 0) field = images.cartImage.constants[-1 - key];
				else if (registers.getTag(key) === ValueTag.String) field = cpu.stringPool.toString(registers.getStringId(key));
			}
			if (coefficientFields.has(field as string)) {
				assert.equal(registers.getTag(read.tableSlot), ValueTag.Table);
				assert.ok(actualOwners.has(registers.getTable(read.tableSlot)), `${read.owner}: coefficient ${field} must be on the actual component/node, not a nested view`);
				directReads.set(read.owner, (directReads.get(read.owner) || 0) + 1);
			}
			return;
		}
		const site = sites.get(pc)!;
		assert.equal(registers.getTag(site.calleeSlot), ValueTag.Closure);
		const callee = registers.getClosure(site.calleeSlot).functionAddress;
		let callees = observed.get(site.owner);
		if (callees === undefined) { callees = new Map(); observed.set(site.owner, callees); }
		callees.set(callee, (callees.get(callee) || 0) + 1);
	} });
	try {
		for (const name of ['run2','run3','visual','tick']) runCompletionClosure(cpu, probe.getStringKey(cpu.stringPool.find(name)!) as Closure, [8]);
		for (let index = 1; index <= 4; index += 1) runCompletionClosure(cpu, probe.getStringKey(cpu.stringPool.find('sample')!) as Closure, [8, index]);
	} finally { cpu.setInstructionObserver(null); }
	for (const owner of ['evaluate2','evaluate3','visual','spatial-group-1']) assert.ok(directReads.get(owner)! > 0, `${owner}: exercise real flat coefficient reads`);
	for (let index = 1; index <= 4; index += 1) {
		const entry = entries.getInteger(index) as Table;
		const writer = (entry.getStringKey(cpu.stringPool.find('channel_writers')!) as Table).getInteger(1) as Closure;
		const calls = observed.get(`spatial-group-${index}`)!;
		assert.equal(calls.size, 1);
		assert.ok(calls.has(writer.functionAddress), 'the sole group call must be its admitted substantive writer');
	}
	const measurements = [];
	for (const name of ['run2','run3','visual','tick']) {
		const profile = profileWarmGuestKernel(cpu, probe.getStringKey(cpu.stringPool.find(name)!) as Closure, 256);
		assert.equal(profile.reservations, 0);
		assert.equal(profile.reservedBytes, 0);
		assert.equal(profile.retainedAfter, profile.retainedBefore);
		measurements.push({ owner: name, ...profile });
	}
	runCompletionClosure(cpu, probe.getStringKey(cpu.stringPool.find('check')!) as Closure, []);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [true]);
	const addressOwners = new Map(kernels.map(kernel => [kernel.closure.functionAddress, kernel.owner]));
	const callOwners = [...observed].map(([owner, targets]) => ({ owner, targets: [...targets].map(([address, calls]) => {
		const index = images.cartImage.functions.findIndex(fn => fn.address === address);
		return { callee: addressOwners.get(address) || images.cartSymbols.metadata.functionDisplayNames[index], calls };
	}) }));
	t.diagnostic(JSON.stringify({ optLevel, compileCycles, compileAllocatedBytes, compileRetainedBytes,
		kernels: kernels.map(({ owner, codeBytes, maxStackSlots, methodLookups, calls }) => ({ owner, codeBytes, maxStackSlots, methodLookups, callSites: calls.length })),
		callOwners, directCoefficientReads: Object.fromEntries(directReads), measurements }));
});
