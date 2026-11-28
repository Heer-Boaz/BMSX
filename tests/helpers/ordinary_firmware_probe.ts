import assert from 'node:assert/strict';
import { RunResult, type CPU } from '../../machine/ts/machine/cpu/cpu';
import { CPU_FIXED_FRAME_COUNT, CPU_FIXED_VALUE_COUNT, DYNAMIC_RAM_BASE, RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { type OptimizationLevel } from '../../toolchain/ts/lua/compiler/optimizer';
import { type ProgramModule } from '../../toolchain/ts/lua/compiler/passes/module_contract';
import { deriveBlua32FixedStack } from '../../toolchain/ts/rompack/blua32_fixed_stack';
import { bindBlua32CodeFunctions } from '../../toolchain/ts/rompack/blua32_reset_code';
import { linkTestSystemBlua32 } from './blua32';
import { parseLuaChunk } from './cpu_test_harness';
import { compileTestSystemWithHeap } from './heap_service_system';

type Leaf = { path: string; member: string; arity: number; result?: false };

export const FIRMWARE_PROBE_MAILBOX = DYNAMIC_RAM_BASE - 64;
const request = FIRMWARE_PROBE_MAILBOX - RAM_BASE;
const vectorPath = 'test/firmware_vector';
const resetPath = 'test/firmware_reset';

// The differential tests prepare their own arena and original native oracle.
// A fixture ROM executes the real BIOS leaf from an ordinary System exception,
// with a test-owned mailbox outside the arena being compared.
export function linkFirmwareProbe(
	optLevel: OptimizationLevel, modules: readonly ProgramModule[], leaves: readonly Leaf[], entrySource = 'return',
) {
	const source = leaves.map(({ path, member }, i) => `local fn${i}<const> = require(${JSON.stringify(path)}).${member}`).join('\n')
		+ `\nlocal operation<const> = mem32le[${FIRMWARE_PROBE_MAILBOX}]\n`
		+ leaves.map(({ arity, result }, i) => {
			const operands = Array.from({ length: arity }, (_, n) => `mem32le[${FIRMWARE_PROBE_MAILBOX + 4 * (n + 1)}]`).join(', ');
			const call = `fn${i}(${operands})`;
			const store = result === false ? `${call}\n  mem32le[${FIRMWARE_PROBE_MAILBOX}] = 0` : `local word<const> = ${call}\n  mem32le[${FIRMWARE_PROBE_MAILBOX}] = word`;
			return `if operation == ${i} then\n  ${store}\n  return\nend`;
		}).join('\n');
	const driver = `mem32le[${FIRMWARE_PROBE_MAILBOX}] = -1\nwhile true do\n  blua32.svc(nil)\n  halt_until_irq\nend`;
	const compiled = compileTestSystemWithHeap(parseLuaChunk(entrySource), [...modules,
		{ path: resetPath, source: driver, chunk: parseLuaChunk(driver, resetPath) },
		{ path: vectorPath, source, chunk: parseLuaChunk(source, vectorPath) },
	], { entrySource, optLevel, programDomain: 'system', resetModule: resetPath, exceptionModule: vectorPath });
	const linked = linkTestSystemBlua32(compiled);
	const index = linked.symbols.functionAddresses.indexOf(linked.vectors.exceptionFunctionAddress);
	const codeTargets = new Set<number>();
	const { valueSlots, frames } = deriveBlua32FixedStack(linked.image, [index], {
		exceptionVectors: new Set([index]), interruptible: false, codeTargets,
	});
	assert.ok(valueSlots <= CPU_FIXED_VALUE_COUNT && frames <= CPU_FIXED_FRAME_COUNT);
	bindBlua32CodeFunctions(linked.image, codeTargets);
	linked.romBytes.set(linked.image.bytes, linked.image.address);
	return linked;
}

export function issueFirmwareProbe(cpu: CPU, operands: readonly number[], operation = 0): void {
	assert.ok(cpu.isHaltedUntilIrq());
	cpu.memory.writeRamRecordWord(request, operation);
	for (let i = 0; i < operands.length; ++i) cpu.memory.writeRamRecordWord(request + 4 * (i + 1), operands[i]);
	cpu.clearHaltUntilIrq();
}

export function grantFirmwareProbe(cpu: CPU, cycles: number): number {
	const result = cpu.runUntilDepth(0, cycles);
	assert.ok(result === RunResult.Yielded || (result === RunResult.Halted && cpu.isHaltedUntilIrq()));
	return cycles - cpu.instructionBudgetRemaining;
}

export function firmwareProbeResult(cpu: CPU): number {
	assert.ok(cpu.isHaltedUntilIrq());
	return cpu.memory.readRamRecordWord(request);
}
