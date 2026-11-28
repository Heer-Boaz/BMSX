import assert from 'node:assert/strict';
import test from 'node:test';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { type Value, valueInteger } from '../../machine/ts/machine/cpu/value';
import { SYSTEM_EXECUTION_DOMAIN_ID, SYSTEM_EXECUTION_DOMAIN_MASK } from '../../machine/ts/spec/blua32/execution_domain';
import { INSTRUCTION_BYTES } from '../../machine/ts/spec/blua32/instruction_format';
import { applyHotResumeRelocation, buildHotResumeRelocation } from '../../ide/runtime/hot_resume_relocation';
import { verifyHotResumeBinding } from '../../ide/runtime/hot_resume_binding';
import { buildBlua32ExecutionRevision } from '../../toolchain/ts/rompack/blua32_revision';
import { blua32SlotLiveAtPc } from '../../toolchain/ts/rompack/blua32_symbols';
import { writeTestBlua32Rom } from '../helpers/blua32';
import { runCpuWithinBudget, runGuestToHalt } from '../helpers/cpu_execution';
import { linkManagedTestSystem } from '../helpers/managed_system';
import { createTestRuntime } from '../helpers/runtime_sources';

test('Hot Resume updates a finite call target only where the compiler proves it is live', () => {
	const path = 'fixture/finite-pc';
	const main = `bss alias_seed: word
bss selector: word
local targets<const> = require('${path}')
local marker<const> = *alias_seed
local value<const> = (targets.condition(*selector ~= 0) and targets.left or targets.right)((targets.argument(7)))
return value, marker`;
	const mix = Array.from({ length: 44 }, (_, i) => `x = (x + ${i + 1}) & 255`).join('\n');
	const rotate = 'x = (x + 71) & 255; x = (x + 185) & 255';
	const module = (grow: boolean) => `module<const>
bss observed: word
local condition<const> = function(flag)
	*observed = *observed + 1
	return flag
end
local left<const> = function(x)
	*observed = *observed + x
	${grow ? rotate : ''}
	return x - 1
end
local right<const> = function(x)
	*observed = *observed + x
	${grow ? '' : rotate}
	return x * 5
end
local argument<const> = function(x)
	${mix}
	return x
end
return { condition = condition, left = left, right = right, argument = argument }`;
	const old = linkManagedTestSystem(main, 3, [{ path, source: module(false) }]);
	const next = linkManagedTestSystem(main, 3, [{ path, source: module(true) }]);
	const previousImage = old.layout, nextImage = next.layout;
	const metadata = old.symbols.metadata;
	const entry = metadata.functionIds.indexOf('module:main/entry');
	const argument = metadata.functionIds.findIndex(id => id.endsWith('__argument'));
	const right = metadata.functionIds.findIndex(id => id.endsWith('__right'));
	const calls = metadata.softwareFramesByFunction[entry]!.calls;
	const branch = calls.find(call => call.targetFunctions.length === 2)!;
	const argumentCall = calls.find(call => call.targetFunctions.includes(argument))!;
	assert.equal(argumentCall.baseDelta, 0);
	const argumentLink = metadata.softwareFramesByFunction[argument]!.linkSlots[0];
	assert.equal(argumentLink.wordOffset, 0);
	assert.ok(argumentLink.slot > 0);
	const entryPc = previousImage.functions[entry].codeAddress;
	const issuePc = entryPc + branch.wordOffset * INSTRUCTION_BYTES;
	const oldTarget = previousImage.functions[right].codeAddress;
	const newTarget = nextImage.functions[right].codeAddress;
	assert.notEqual(newTarget, oldTarget);
	for (const word of [argumentCall.wordOffset, argumentCall.continuationWordOffset, branch.wordOffset])
		assert.equal(blua32SlotLiveAtPc(branch.targetLiveWordRanges, entryPc, entryPc + word * INSTRUCTION_BYTES), true);
	assert.equal(blua32SlotLiveAtPc(branch.targetLiveWordRanges, entryPc, entryPc), false);
	assert.equal(blua32SlotLiveAtPc(branch.targetLiveWordRanges, entryPc, entryPc + branch.continuationWordOffset * INSTRUCTION_BYTES), false);

	const sources = (image: typeof old) => new Map(Array.from(image.diagnosticSources, ([path, item]) => [path, item.source]));
	const revision = buildBlua32ExecutionRevision(previousImage, old.symbols, sources(old), next, sources(next));
	for (const stop of [previousImage.functions[argument].codeAddress, issuePc]) {
		const runtime = createTestRuntime(writeTestBlua32Rom(old));
		runtime.boot();
		const { cpu, memory, executionAddressSpace } = runtime.machine;
		const stopAt = (pc: number) => {
			cpu.setExecutionHook((_domain, current) => current === pc, SYSTEM_EXECUTION_DOMAIN_MASK, SYSTEM_EXECUTION_DOMAIN_MASK);
			assert.equal(runCpuWithinBudget(cpu, 1_000_000), RunResult.ExecutionStopped);
			cpu.setExecutionHook(null, 0, 0);
		};
		stopAt(entryPc);
		const thread = cpu.activeThread, frame = thread.currentFrame!, depth = cpu.getFrameDepth();
		const rootBase = frame.stackBase;
		const slot = rootBase + branch.baseDelta;
		const markerSlot = rootBase + metadata.localSlotsByFunction[entry].find(local => local.name === 'marker')!.registerIndex;
		const seed = metadata.staticScopes.declarations.find(declaration => declaration.name === 'alias_seed')!;
		memory.writeMappedU32LE(seed.address!, oldTarget);
		stopAt(stop);
		assert.equal(cpu.getFrameDepth(), depth);
		assert.equal(thread.currentFrame, frame);
		assert.equal(thread.stackRegisters.get(slot), valueInteger(oldTarget));
		assert.equal(thread.stackRegisters.get(markerSlot), valueInteger(oldTarget));
		assert.equal(verifyHotResumeBinding(cpu, SYSTEM_EXECUTION_DOMAIN_ID, previousImage, nextImage), false);
		const relocation = buildHotResumeRelocation(cpu, [{ previousImage, nextImage, revision }, null, null], depth);
		memory.installSystemRom(writeTestBlua32Rom(next));
		cpu.replaceExecutionImages([executionAddressSpace.resolveSystemDomain()]);
		applyHotResumeRelocation(cpu, relocation);
		assert.equal(thread.stackRegisters.get(slot), valueInteger(newTarget));
		assert.equal(thread.stackRegisters.get(markerSlot), valueInteger(oldTarget));
		assert.equal(cpu.getFrameDepth(), depth);
		runGuestToHalt(cpu, 1_000_000);
		const values: Value[] = [];
		cpu.readCompletionValues(values);
		assert.deepEqual(values, [valueInteger(((7 + (44 * 45) / 2) & 255) * 5), valueInteger(oldTarget)]);
	}
});

test('Hot Resume preserves a register-resident lexical environment in a software call', () => {
	const mix = Array.from({ length: 40 }, (_, i) => `x = (x + ${i + 1}) & 255`).join('\n');
	const source = (fresh: boolean) => `bss observed: word
local anchor<const> = { score = 77 }
local function earlier(x)
	*observed = x
	${fresh ? '*observed = x + 1' : ''}
	return x
end
local function leaf(x)
	${mix}
	return x + ${fresh ? 9 : 7}, anchor
end
local x, object = leaf(earlier(6))
return x, object.score
`;
	const old = linkManagedTestSystem(source(false), 3);
	const next = linkManagedTestSystem(source(true), 3);
	const previousImage = old.layout, nextImage = next.layout;
	const entry = old.symbols.metadata.functionIds.indexOf('module:main/entry');
	const leafId = 'module:main/entry/local:leaf';
	const leaf = old.symbols.metadata.functionIds.indexOf(leafId);
	const nextLeaf = next.symbols.metadata.functionIds.indexOf(leafId);
	assert.equal(old.symbols.metadata.softwareFramesByFunction[leaf]?.entry, true);
	assert.equal(next.symbols.metadata.softwareFramesByFunction[nextLeaf]?.entry, true);
	const oldPc = previousImage.functions[leaf].codeAddress;
	const newPc = nextImage.functions[nextLeaf].codeAddress;
	assert.notEqual(oldPc, newPc);
	const runtime = createTestRuntime(writeTestBlua32Rom(old));
	runtime.boot();
	const { cpu, memory, executionAddressSpace } = runtime.machine;
	cpu.setExecutionHook((_domain, pc) => pc === oldPc, SYSTEM_EXECUTION_DOMAIN_MASK, SYSTEM_EXECUTION_DOMAIN_MASK);
	assert.equal(runCpuWithinBudget(cpu, 1_000_000), RunResult.ExecutionStopped);
	cpu.setExecutionHook(null, 0, 0);
	const depth = cpu.getFrameDepth(), frame = cpu.activeThread.currentFrame!;
	assert.equal(cpu.readFrameFunctionAddress(depth - 1), previousImage.functions[entry].address);
	const capture = old.symbols.metadata.localSlotsByFunction[leaf].find(local => local.name === 'anchor')!;
	const saved = frame.registers.get(capture.registerIndex);
	const sources = (image: typeof old) => new Map(Array.from(image.diagnosticSources, ([path, item]) => [path, item.source]));
	const revision = buildBlua32ExecutionRevision(previousImage, old.symbols, sources(old), next, sources(next));
	const relocation = buildHotResumeRelocation(cpu, [{ previousImage, nextImage, revision }, null, null], depth);
	memory.installSystemRom(writeTestBlua32Rom(next));
	cpu.replaceExecutionImages([executionAddressSpace.resolveSystemDomain()]);
	applyHotResumeRelocation(cpu, relocation);
	assert.equal(cpu.getFrameDepth(), depth);
	assert.equal(cpu.activeThread.currentFrame, frame);
	assert.equal(frame.pc, newPc);
	assert.equal(frame.registers.get(capture.registerIndex), saved);
	runGuestToHalt(cpu, 1_000_000);
	const values: Value[] = [];
	cpu.readCompletionValues(values);
	assert.deepEqual(values, [valueInteger(((6 + (40 * 41) / 2) & 255) + 9), valueInteger(77)]);
});
