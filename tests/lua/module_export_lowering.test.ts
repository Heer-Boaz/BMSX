import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { splitText } from '../../machine/ts/common/text_lines';
import { LuaLexer } from '../../machine/ts/lua/syntax/lexer';
import { LuaParser } from '../../machine/ts/lua/syntax/parser';
import { CPU, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { disassembleProgram } from '../../machine/ts/machine/cpu/disassembler';
import { Memory } from '../../machine/ts/machine/memory/memory';
import type { ProgramConstReloc } from '../../machine/ts/machine/program/loader';
import { appendLuaChunkToProgram, compileLuaChunkToProgram, encodeCompiledProgramImage, type CompiledProgram } from '../../machine/ts/machine/program/compiler';
import { inflateExecutableProgramImage, resolveRuntimeProgramRelocations } from '../../machine/ts/machine/program/linker';

function parseSource(source: string, path: string) {
	const lexer = new LuaLexer(source, path);
	const parser = new LuaParser(lexer.scanTokens(), path, splitText(source));
	return parser.parseChunk();
}


function disassembleProgramWithoutIrqVector(compiled: CompiledProgram, showProtoHeaders: boolean): string {
	return disassembleProgram(compiled.program, compiled.metadata, { showProtoHeaders })
		.split('\\n\\n')
		.filter(block => !block.includes('/irq entry='))
		.join('\\n\\n');
}

function compileWithModule(
	entrySource: string,
	modulePath: string,
	moduleSource: string,
	extraModules: ReadonlyArray<{ path: string; source: string }> = [],
): { compiled: CompiledProgram; disasm: string; constRelocs: ProgramConstReloc[] } {
	const entryChunk = parseSource(entrySource, 'entry.lua');
	const moduleChunk = parseSource(moduleSource, `${modulePath}.lua`);
	const compiled = compileLuaChunkToProgram(
		entryChunk,
		[
			{ path: modulePath, chunk: moduleChunk, source: moduleSource },
			...extraModules.map(module => ({
				path: module.path,
				chunk: parseSource(module.source, `${module.path}.lua`),
				source: module.source,
			})),
		],
		{ entrySource },
	);
	return {
		compiled,
		disasm: disassembleProgramWithoutIrqVector(compiled, false),
		constRelocs: compiled.constRelocs,
	};
}

function compileWithConstModule(entrySource: string, modulePath: string, moduleSource: string): { compiled: CompiledProgram; disasm: string } {
	const entryChunk = parseSource(entrySource, 'entry.lua');
	const moduleChunk = parseSource(moduleSource, `${modulePath}.lua`);
	const compiled = compileLuaChunkToProgram(
		entryChunk,
		[{ path: modulePath, chunk: moduleChunk, source: moduleSource }],
		{ entrySource, constModulePaths: [modulePath] },
	);
	return {
		compiled,
		disasm: disassembleProgramWithoutIrqVector(compiled, true),
	};
}

function runStaticModuleInitializers(cpu: CPU, compiled: CompiledProgram): void {
	for (const path of compiled.staticModulePaths) {
		assert.equal(compiled.moduleProtoMap.has(path), true);
		const protoIndex = compiled.moduleProtoMap.get(path) as number;
		const targetDepth = cpu.getFrameDepth();
		cpu.call(cpu.rootClosure(protoIndex));
		assert.equal(cpu.runUntilDepth(targetDepth, 100000), RunResult.Halted);
	}
	cpu.syncGlobalSlotsToTable();
}

// Module return values remain real tables so direct compile-time import member
// reads and dynamic consumers keep Lua semantics. Static module-root calls still
// lower their call target to an export_proto relocation so the linker can replace
// function exports with direct CLOSURE operands.
test('static module function calls use export-proto relocations while preserving runtime tables', () => {
	const moduleSource = [
		'local api = {}',
		'function api.update() end',
		'return api',
	].join('\n');
	const compiled = compileWithModule('local api<const> = require("foo")\napi.update()', 'foo', moduleSource);
	const disasm = compiled.disasm;
	assert.equal(compiled.constRelocs.some(reloc => reloc.kind === 'export_proto' && reloc.symbol === 'foo__update'), true, 'static module-root call must emit an export-proto relocation');
	assert.match(disasm, /\bNEWT\b/, 'module table must still be materialized for module-root consumers');
	assert.match(disasm, /\bSETFIELD\b/, 'exported function must still be stored on the returned table');
	assert.match(disasm, /\bSET(GL|SYS)\b/, 'export slot must remain populated for value reads and non-symbol exports');
});

test('module export functions call sibling exports through link symbols', () => {
	const moduleSource = [
		'local api<const> = {}',
		'function api.linear(value) return value end',
		'function api.twice(value) return api.linear(value) * 2 end',
		'return api',
	].join('\n');
	const compiled = compileWithModule('return require("foo").twice(3)', 'foo', moduleSource);
	assert.equal(compiled.compiled.metadata.exportProtoIdBySlot.foo__linear?.includes('/decl:api.linear'), true);
	assert.equal(compiled.compiled.metadata.exportProtoIdBySlot.foo__twice?.includes('/decl:api.twice'), true);
	assert.equal(compiled.constRelocs.some(reloc => reloc.kind === 'export_proto' && reloc.symbol === 'foo__linear'), true);
	assert.equal(compiled.constRelocs.some(reloc => reloc.kind === 'export_proto' && reloc.symbol === 'foo__twice'), true);
	assert.match(compiled.disasm, /\bNEWT\b/, 'module table remains available for normal module-root consumers');
	const image = encodeCompiledProgramImage(compiled.compiled);
	const cpu = new CPU(new Memory({ systemRom: new Uint8Array(0), cartRom: new Uint8Array(0) }));
	cpu.setProgram(inflateExecutableProgramImage(image), image.link.symbols, compiled.compiled.metadata);
	cpu.start(image.vectors.sectionInitProtoIndex);
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	cpu.start(image.vectors.resetProtoIndex);
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	assert.deepEqual(Array.from(cpu.lastReturnValues), [6]);
});

test('bios easing exports a linkable function while keeping its Lua table', () => {
	const moduleSource = readFileSync('machine/firmware/bios/easing.lua', 'utf8');
	const compiled = compileWithModule(
		'return require("bios/easing").arc01(0.25)',
		'bios/easing',
		moduleSource,
		[{ path: 'bios/util/clamp', source: readFileSync('machine/firmware/bios/util/clamp.lua', 'utf8') }],
	);
	assert.equal(compiled.constRelocs.some(reloc => reloc.kind === 'export_proto' && reloc.symbol === 'bios__easing__arc01'), true);
	assert.match(compiled.disasm, /\bNEWT\b/, 'public easing table remains available for Lua API consumers');
});

// Non-call value reads must not use export_proto relocations; data exports use module-slot relocs.
test('static module data reads use module slots, not export-proto relocations', () => {
	const moduleSource = [
		'local api = { value = 7 }',
		'return api',
	].join('\n');
	const compiled = compileWithModule('local api<const> = require("foo")\nreturn api.value + 1', 'foo', moduleSource);
	assert.equal(compiled.constRelocs.some(reloc => reloc.kind === 'export_proto' && reloc.symbol === 'foo__value'), false, 'data reads must not emit export-proto relocations');
	let hasModuleValueReloc = false;
	for (let index = 0; index < compiled.constRelocs.length; index += 1) {
		const reloc = compiled.constRelocs[index];
		if (reloc.kind === 'module' && reloc.symbol === 'foo__value') {
			hasModuleValueReloc = true;
			break;
		}
	}
	assert.equal(hasModuleValueReloc, true, 'data read must target the module export slot');
});

test('dynamic module function value reads use module slots, not export-proto relocations', () => {
	const moduleSource = [
		'local api = {}',
		'function api.read() return 7 end',
		'return api',
	].join('\n');
	const compiled = compileWithModule('local api<const> = require("foo")\nlocal read = api.read\nreturn read()', 'foo', moduleSource);
	assert.equal(compiled.constRelocs.some(reloc => reloc.kind === 'export_proto' && reloc.symbol === 'foo__read'), false, 'function value read must not emit an export-proto relocation');
	let hasModuleFunctionReloc = false;
	for (let index = 0; index < compiled.constRelocs.length; index += 1) {
		const reloc = compiled.constRelocs[index];
		if (reloc.kind === 'module' && reloc.symbol === 'foo__read') {
			hasModuleFunctionReloc = true;
			break;
		}
	}
	assert.equal(hasModuleFunctionReloc, true, 'function value read must target the runtime export slot');
	const image = encodeCompiledProgramImage(compiled.compiled);
	const cpu = new CPU(new Memory({ systemRom: new Uint8Array(0), cartRom: new Uint8Array(0) }));
	cpu.setProgram(inflateExecutableProgramImage(image), image.link.symbols, compiled.compiled.metadata);
	cpu.start(image.vectors.sectionInitProtoIndex);
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	runStaticModuleInitializers(cpu, compiled.compiled);
	cpu.start(image.vectors.resetProtoIndex);
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	assert.deepEqual(Array.from(cpu.lastReturnValues), [7]);
});

// Nested namespaces are runtime tables; flat export slots only represent direct fields.
test('nested module export namespace uses the table path', () => {
	const moduleSource = [
		'local function a() end',
		'return { sub = { a = a } }',
	].join('\n');
	const { disasm } = compileWithModule('local m<const> = require("bar")\nm.sub.a()', 'bar', moduleSource);
	assert.match(disasm, /\bNEWT\b/, 'nested export namespace still builds a table');
});

// A computed key `[k] = v` must not be misread as the literal key "k"; computed
// field ownership stays with the table value.
test('computed (non-literal) export key uses the table path', () => {
	const moduleSource = [
		'local function update() end',
		'local k<const> = "update"',
		'return { [k] = update }',
	].join('\n');
	const { disasm } = compileWithModule('local m<const> = require("baz")\nm.update()', 'baz', moduleSource);
	assert.match(disasm, /\bNEWT\b/, 'computed export key stays on the table path');
});

test('dynamic root-function modules remain runtime values', () => {
	const moduleSource = [
		'local inc<const> = function(value) return value + 1 end',
		'return inc',
	].join('\n');
	const { compiled, disasm } = compileWithModule('local inc<const> = require("foo")\nreturn inc(4)', 'foo', moduleSource);
	assert.equal(compiled.moduleProtoMap.has('foo'), true, 'dynamic root-function module must keep its initializer proto');
	assert.match(disasm, /\bSET(GL|SYS)\b.*foo\b/, 'module initializer must publish the root function value');
	let hasRootModuleReloc = false;
	for (let index = 0; index < compiled.constRelocs.length; index += 1) {
		const reloc = compiled.constRelocs[index];
		if (reloc.kind === 'module' && reloc.symbol === 'foo') {
			hasRootModuleReloc = true;
			break;
		}
	}
	assert.equal(hasRootModuleReloc, true, 'const local require must read the root function value from the export slot');
	const image = encodeCompiledProgramImage(compiled);
	const cpu = new CPU(new Memory({ systemRom: new Uint8Array(0), cartRom: new Uint8Array(0) }));
	cpu.setProgram(inflateExecutableProgramImage(image), image.link.symbols, compiled.metadata);
	cpu.start(image.vectors.sectionInitProtoIndex);
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	runStaticModuleInitializers(cpu, compiled);
	cpu.start(image.vectors.resetProtoIndex);
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	assert.deepEqual(Array.from(cpu.lastReturnValues), [5]);
});

test('host-eval append resolves installed module roots from the program image', () => {
	const moduleSource = [
		'local inc<const> = function(value) return value + 1 end',
		'return inc',
	].join('\n');
	const { compiled } = compileWithModule('local inc<const> = require("foo")\nreturn 0', 'foo', moduleSource);
	const image = encodeCompiledProgramImage(compiled);
	const baseProgram = inflateExecutableProgramImage(image);
	const source = 'local inc<const> = require("foo")\nreturn inc(9)';
	const appended = appendLuaChunkToProgram(baseProgram, compiled.metadata, parseSource(source, 'host_eval.lua'), { entrySource: source });
	resolveRuntimeProgramRelocations(appended.program, appended.metadata, appended.constRelocs);
	const cpu = new CPU(new Memory({ systemRom: new Uint8Array(0), cartRom: new Uint8Array(0) }));
	cpu.setProgram(appended.program, appended.metadata, appended.metadata);
	cpu.start(image.vectors.sectionInitProtoIndex);
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	runStaticModuleInitializers(cpu, compiled);
	cpu.start(appended.entryProtoIndex);
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	assert.deepEqual(Array.from(cpu.lastReturnValues), [10]);
});

test('const modules inline export constants without runtime module state', () => {
	const moduleSource = [
		'local addr<const> = 4096',
		'local len<const> = 32',
		'local neg<const> = -addr',
		'return { addr = addr, len = len, neg = neg, name = "asset", enabled = true, none = nil }',
	].join('\n');
	const { compiled, disasm } = compileWithConstModule(
		'local assets<const> = require("assets")\nreturn assets.addr, assets.len, assets.neg, assets.name, assets.enabled, assets.none',
		'assets',
		moduleSource,
	);
	assert.equal(compiled.moduleProtoMap.has('assets'), false, 'const module must not produce a runtime module proto');
	assert.equal(compiled.staticModulePaths.includes('assets'), false, 'const module must not be scheduled for static initialization');
	assert.doesNotMatch(disasm, /\bCALL\b/, 'const module import must not emit a runtime import call');
	assert.doesNotMatch(disasm, /\bNEWT\b/, 'const module must not build a runtime export table');
	assert.doesNotMatch(disasm, /\bGET(GL|SYS)\b.*assets/, 'const module reads must not use module export slots');
});

test('const modules inline direct require member reads', () => {
	const moduleSource = [
		'local addr<const> = 4096',
		'return { addr = addr }',
	].join('\n');
	const { compiled, disasm } = compileWithConstModule(
		'return require("assets").addr',
		'assets',
		moduleSource,
	);
	assert.equal(compiled.moduleProtoMap.has('assets'), false, 'const module must not produce a runtime module proto');
	assert.doesNotMatch(disasm, /\bCALL\b/, 'direct const module member read must not emit a runtime import call');
	assert.doesNotMatch(disasm, /\bNEWT\b/, 'direct const module member read must not build a runtime export table');
});

test('compile-time require rejects dynamic module names', () => {
	const moduleSource = 'return { value = 1 }';
	assert.throws(
		() => compileWithModule('local path<const> = "foo"\nreturn require(path).value', 'foo', moduleSource),
		/Compile-time require expects exactly one literal module path/,
	);
});

test('compile-time require rejects missing modules', () => {
	const source = 'return require("missing")';
	assert.throws(
		() => compileLuaChunkToProgram(parseSource(source, 'entry.lua'), [], { entrySource: source }),
		/Compile-time require module 'missing' was not provided to the program compiler/,
	);
});

test('const modules reject non-constant exports', () => {
	const moduleSource = [
		'local function read() return 1 end',
		'return { value = read() }',
	].join('\n');
	assert.throws(
		() => compileWithConstModule('local m<const> = require("assets")\nreturn m.value', 'assets', moduleSource),
		/Const module 'assets' export 'value' is not a compile-time constant or static symbol/,
	);
});

test('const modules reject runtime root values', () => {
	const moduleSource = 'return { value = 7 }';
	assert.throws(
		() => compileWithConstModule('return require("assets")', 'assets', moduleSource),
		/Module 'assets' root is compile-time only/,
	);
	assert.throws(
		() => compileWithConstModule('local assets = require("assets")\nreturn assets', 'assets', moduleSource),
		/Module 'assets' root is compile-time only/,
	);
});
