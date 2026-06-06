import { SYSTEM_LUA_BUILTIN_FUNCTIONS, SYSTEM_LUA_BUILTIN_GLOBALS } from './builtin_descriptors';
import { appendLuaChunkToProgram } from '../program/compiler';
import type { Closure, Program, ProgramMetadata, Table } from '../cpu/cpu';
import type { Runtime } from '../runtime/runtime';

const SYSTEM_BUILTIN_PRELUDE_PATH = 'bios/system_builtin_prelude.lua';

function buildSystemBuiltinPreludeSource(): string {
	const lines: string[] = [
		'local system<const> = require("bios/system")',
	];
	for (let index = 0; index < SYSTEM_LUA_BUILTIN_FUNCTIONS.length; index += 1) {
		const name = SYSTEM_LUA_BUILTIN_FUNCTIONS[index].name;
		lines.push(`${name} = system.${name}`);
	}
	for (let index = 0; index < SYSTEM_LUA_BUILTIN_GLOBALS.length; index += 1) {
		const name = SYSTEM_LUA_BUILTIN_GLOBALS[index].name;
		lines.push(`${name} = system.${name}`);
	}
	return lines.join('\n');
}

export function runSystemBuiltinPrelude(runtime: Runtime, program: Program, metadata: ProgramMetadata): { program: Program; metadata: ProgramMetadata } {
	const source = buildSystemBuiltinPreludeSource();
	const interpreter = runtime.interpreter;
	interpreter.setReservedIdentifiers([]);
	const chunk = interpreter.compileChunk(source, SYSTEM_BUILTIN_PRELUDE_PATH);
	interpreter.setReservedIdentifiers(runtime.getReservedLuaIdentifiers());
	const compiled = appendLuaChunkToProgram(program, metadata, chunk, {
		optLevel: runtime.realtimeCompileOptLevel,
		entrySource: source,
	});
	runtime.machine.cpu.setProgram(compiled.program, compiled.metadata);
	runtime.programMetadata = compiled.metadata;
	runtime.machine.cpu.start(compiled.entryProtoIndex);
	runtime.machine.cpu.runUntilDepth(0, Number.MAX_SAFE_INTEGER);
	if (runtime.machine.cpu.isHaltedUntilIrq()) {
		throw new Error('system builtin prelude cannot halt for IRQ.');
	}
	applySystemBuiltinGlobals(runtime);
	return { program: compiled.program, metadata: compiled.metadata };
}

export function applySystemBuiltinGlobals(runtime: Runtime): void {
	const system = runtime.requireModule('bios/system') as Table;
	for (let index = 0; index < SYSTEM_LUA_BUILTIN_FUNCTIONS.length; index += 1) {
		const name = SYSTEM_LUA_BUILTIN_FUNCTIONS[index].name;
		const member = system.get(runtime.internString(name)) as Closure;
		runtime.setGlobal(name, member);
	}
	for (let index = 0; index < SYSTEM_LUA_BUILTIN_GLOBALS.length; index += 1) {
		const name = SYSTEM_LUA_BUILTIN_GLOBALS[index].name;
		runtime.setGlobal(name, system.get(runtime.internString(name)));
	}
}
