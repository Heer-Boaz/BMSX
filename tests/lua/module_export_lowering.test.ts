import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { splitText } from '../../machine/ts/common/text_lines';
import { LuaLexer } from '../../machine/ts/lua/syntax/lexer';
import { LuaParser } from '../../machine/ts/lua/syntax/parser';
import type { OptimizationLevel } from '../../machine/ts/lua/compiler/optimizer';
import { CPU, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { disassembleProgram } from '../../machine/ts/machine/cpu/disassembler';
import { IrqController } from '../../machine/ts/machine/devices/irq/controller';
import { Memory } from '../../machine/ts/machine/memory/memory';
import type { ProgramConstReloc } from '../../machine/ts/lua/compiler/program_object';
import { compileLuaChunkToProgram, type CompiledProgram } from '../../machine/ts/lua/compiler';
import { finalizeTestSystemProgram } from '../helpers/program_image';

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
	optLevel: OptimizationLevel = 0,
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
		{ entrySource, optLevel },
	);
	return {
		compiled,
		disasm: disassembleProgramWithoutIrqVector(compiled, false),
		constRelocs: compiled.constRelocs,
	};
}

function compileWithConstModule(entrySource: string, modulePath: string, moduleSource: string): { compiled: CompiledProgram; disasm: string } {
	const entryChunk = parseSource(entrySource, 'entry.lua');
	const declaredModuleSource = `module<const>\n${moduleSource}`;
	const moduleChunk = parseSource(declaredModuleSource, `${modulePath}.lua`);
	const compiled = compileLuaChunkToProgram(
		entryChunk,
		[{ path: modulePath, chunk: moduleChunk, source: declaredModuleSource }],
		{ entrySource },
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

function createCpu(compiled: CompiledProgram): { cpu: CPU; image: ReturnType<typeof finalizeTestSystemProgram>['image'] } {
	const finalized = finalizeTestSystemProgram(compiled);
	const memory = new Memory({ systemRom: finalized.romBytes, cartRom: new Uint8Array(0) });
	const cpu = new CPU(memory, new IrqController(memory));
	cpu.setProgram(finalized.program, finalized.image.symbols, finalized.metadata, 0, 0, 0);
	return { cpu, image: finalized.image };
}

test('dynamic module calls observe replaced direct and method fields at every optimization level', () => {
	const moduleSource = [
		'local api = { value = 10 }',
		'function api.read() return 7 end',
		'function api:method() return self.value end',
		'return api',
	].join('\n');
	const entrySource = [
		'local api<const> = require("foo")',
		'api.read = function() return 9 end',
		'api.method = function(self) return self.value + 1 end',
		'return api.read(), api:method()',
	].join('\n');
	for (const optLevel of [0, 3] as const) {
		const { compiled, constRelocs, disasm } = compileWithModule(entrySource, 'foo', moduleSource, [], optLevel);
		assert.equal(constRelocs.some(reloc => reloc.kind === 'export_proto' && (reloc.symbol === 'foo__read' || reloc.symbol === 'foo__method')), false);
		assert.equal(constRelocs.some(reloc => reloc.kind === 'module' && reloc.symbol.startsWith('foo__')), false);
		assert.match(disasm, /\bGETFIELD\b/);
		assert.match(disasm, /\bSELF\b/);
		assert.deepEqual(compiled.program.moduleExports, [{ path: 'foo', exportPathKey: '', slotName: 'foo' }]);
		assert.equal(compiled.metadata.exportProtoIdBySlot.foo__read, undefined);
		assert.equal(compiled.metadata.exportProtoIdBySlot.foo__method, undefined);
		const { cpu, image } = createCpu(compiled);
		cpu.start(image.vectors.sectionInitProtoIndex);
		assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
		runStaticModuleInitializers(cpu, compiled);
		cpu.start(image.vectors.resetProtoIndex);
		assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
		assert.deepEqual(Array.from(cpu.lastReturnValues), [9, 11]);
	}
});

test('explicit const-module functions call sibling exports through link symbols', () => {
	const moduleSource = [
		'module<const>',
		'local linear<const> = function(value) return value end',
		'local twice<const> = function(value) return linear(value) * 2 end',
		'return { linear = linear, twice = twice }',
	].join('\n');
	const compiled = compileWithModule('return require("foo").twice(3)', 'foo', moduleSource);
	assert.equal(compiled.compiled.metadata.exportProtoIdBySlot.foo__linear?.includes('/static:'), true);
	assert.equal(compiled.compiled.metadata.exportProtoIdBySlot.foo__twice?.includes('/static:'), true);
	assert.equal(compiled.constRelocs.some(reloc => reloc.kind === 'export_proto' && reloc.symbol === 'foo__linear'), true);
	assert.equal(compiled.constRelocs.some(reloc => reloc.kind === 'export_proto' && reloc.symbol === 'foo__twice'), true);
	assert.doesNotMatch(compiled.disasm, /\bNEWT\b/, 'const-module exports do not materialize a runtime table');
	const { cpu, image } = createCpu(compiled.compiled);
	cpu.start(image.vectors.sectionInitProtoIndex);
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	cpu.start(image.vectors.resetProtoIndex);
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	assert.deepEqual(Array.from(cpu.lastReturnValues), [6]);
});

test('bios easing calls through its live runtime table', () => {
	const moduleSource = readFileSync('machine/firmware/bios/easing.lua', 'utf8');
	const compiled = compileWithModule(
		'return require("bios/easing").arc01(0.25)',
		'bios/easing',
		moduleSource,
		[{ path: 'bios/util/clamp', source: readFileSync('machine/firmware/bios/util/clamp.lua', 'utf8') }],
	);
	assert.equal(compiled.constRelocs.some(reloc => reloc.kind === 'export_proto' && reloc.symbol === 'bios__easing__arc01'), false);
	assert.match(compiled.disasm, /\bGETFIELD\b/, 'runtime module calls load the current table field');
	assert.match(compiled.disasm, /\bNEWT\b/, 'public easing table remains available for Lua API consumers');
	const { cpu, image } = createCpu(compiled.compiled);
	cpu.start(image.vectors.sectionInitProtoIndex);
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	runStaticModuleInitializers(cpu, compiled.compiled);
	cpu.start(image.vectors.resetProtoIndex);
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	assert.deepEqual(Array.from(cpu.lastReturnValues), [0.5]);
});

test('dynamic module data reads observe table mutations at every optimization level', () => {
	const moduleSource = [
		'local api<const> = { value = 0 }',
		'function api.bump()',
		'\tapi.value = api.value + 1',
		'\tlocal alias<const> = api',
		'\treturn api.value, alias.value',
		'end',
		'return api',
	].join('\n');
	for (const optLevel of [0, 3] as const) {
		const { compiled, constRelocs, disasm } = compileWithModule('local api<const> = require("foo")\nreturn api.bump()', 'foo', moduleSource, [], optLevel);
		assert.equal(constRelocs.some(reloc => reloc.kind === 'module' && reloc.symbol === 'foo__value'), false, 'mutable fields must not read stale initialization-time export slots');
		assert.match(disasm, /\bGETFIELD\b/, 'mutable fields must be read from the live module table');
		const { cpu, image } = createCpu(compiled);
		cpu.start(image.vectors.sectionInitProtoIndex);
		assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
		runStaticModuleInitializers(cpu, compiled);
		cpu.start(image.vectors.resetProtoIndex);
		assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
		assert.deepEqual(Array.from(cpu.lastReturnValues), [1, 1]);
	}
});

test('dynamic module function value reads use the live table, not export-proto relocations', () => {
	const moduleSource = [
		'local api = {}',
		'function api.read() return 7 end',
		'return api',
	].join('\n');
	const compiled = compileWithModule('local api<const> = require("foo")\nlocal read = api.read\nreturn read()', 'foo', moduleSource);
	assert.equal(compiled.constRelocs.some(reloc => reloc.kind === 'export_proto' && reloc.symbol === 'foo__read'), false, 'function value read must not emit an export-proto relocation');
	assert.equal(compiled.constRelocs.some(reloc => reloc.kind === 'module' && reloc.symbol === 'foo__read'), false, 'function value read must not target an initialization-time export slot');
	assert.match(compiled.disasm, /\bGETFIELD\b/, 'function value read must use the live module table');
	const { cpu, image } = createCpu(compiled.compiled);
	cpu.start(image.vectors.sectionInitProtoIndex);
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	runStaticModuleInitializers(cpu, compiled.compiled);
	cpu.start(image.vectors.resetProtoIndex);
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	assert.deepEqual(Array.from(cpu.lastReturnValues), [7]);
});

test('optimizer preserves a sibling closure upvalue environment', () => {
	const moduleSource = [
		'local value',
		'local clear<const> = function() value = nil end',
		'local api = {}',
		'function api.apply(input)',
		'\tvalue = input',
		'\tclear()',
		'\treturn input, value',
		'end',
		'return api',
	].join('\n');
	const { compiled } = compileWithModule('local api<const> = require("foo")\nreturn api.apply(41)', 'foo', moduleSource, [], 3);
	const { cpu, image } = createCpu(compiled);
	cpu.start(image.vectors.sectionInitProtoIndex);
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	runStaticModuleInitializers(cpu, compiled);
	cpu.start(image.vectors.resetProtoIndex);
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	assert.deepEqual(Array.from(cpu.lastReturnValues), [41, null]);
});

// Nested namespaces in dynamic modules remain ordinary runtime-table paths.
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
	const { cpu, image } = createCpu(compiled);
	cpu.start(image.vectors.sectionInitProtoIndex);
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	runStaticModuleInitializers(cpu, compiled);
	cpu.start(image.vectors.resetProtoIndex);
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	assert.deepEqual(Array.from(cpu.lastReturnValues), [5]);
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
