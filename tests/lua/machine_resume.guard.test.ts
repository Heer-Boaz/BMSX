import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('resumeFromSnapshot applies machine state before hot-resuming Lua code', () => {
	const src = readFileSync('machine/ts/ide/runtime/hot_resume.ts', 'utf8');
	const start = src.indexOf('export async function resumeFromSnapshot');
	assert.ok(start > -1, 'resumeFromSnapshot not found');
	const nextExport = src.indexOf('\nexport function ', start + 1);
	const snippet = src.slice(start, nextExport === -1 ? undefined : nextExport);
	assert.equal(snippet.includes('applyRuntimeMachineState(runtime, snapshot.machineState)'), true, 'snapshot path should restore machine state');
	assert.equal(snippet.includes('resumeLuaProgramState(runtime, snapshot'), true, 'snapshot path should resume through the Lua owner');
});

test('hotResumeProgramEntry keeps interpreter resident', () => {
	const src = readFileSync('machine/ts/ide/runtime/hot_resume.ts', 'utf8');
	const start = src.indexOf('export function hotResumeProgramEntry');
	assert.ok(start > -1, 'hotResumeProgramEntry not found');
	// Bound to the next function declaration (exported or not) so the snippet
	// stays scoped to hotResumeProgramEntry regardless of neighbouring helpers.
	const boundaries = [src.indexOf('\nexport function ', start + 1), src.indexOf('\nfunction ', start + 1)].filter(index => index > -1);
	const nextExport = boundaries.length > 0 ? Math.min(...boundaries) : -1;
	const snippet = src.slice(start, nextExport === -1 ? undefined : nextExport);
	assert.equal(snippet.includes('createLuaInterpreter('), false, 'hotResumeProgramEntry should not create a new interpreter');
	assert.equal(snippet.includes('runtime.startLoadedProgram('), false, 'hotResumeProgramEntry must not restart the reset vector');
	assert.equal(snippet.includes('runtime.machine.cpu.setProgram(program, compiled.metadata)'), true, 'hotResumeProgramEntry must patch the installed program in place');
	assert.equal(snippet.includes('encodeCompiledProgramImage(compiled)'), true, 'hotResumeProgramEntry must pass compiled code through the compiler-owned ProgramImage object boundary');
	assert.equal(snippet.includes('inflateExecutableProgramImage(programImage, compiled.metadata, runtime.programDataBaseAddress, runtime.programBssBaseAddress)'), true, 'hotResumeProgramEntry must install through the program/linker executable boundary');
	assert.equal(snippet.includes('resolveRuntimeProgramRelocations('), false, 'hotResumeProgramEntry must not own raw relocation resolution');
	assert.equal(snippet.includes('if (!params.preserveSystemModules)'), true, 'hot-resume must preserve live module objects (single generation); only a full reload clears the module cache');
});

test('hot-resume restores live state before calling cart init', () => {
	const src = readFileSync('machine/ts/ide/runtime/hot_resume.ts', 'utf8');
	const start = src.indexOf('export function resumeLuaProgramState');
	assert.ok(start > -1, 'resumeLuaProgramState not found');
	const nextExport = src.indexOf('\nexport function ', start + 1);
	const snippet = src.slice(start, nextExport === -1 ? undefined : nextExport);
	const restoreIndex = snippet.indexOf('restoreRuntimeLuaSnapshot(runtime, snapshot)');
	const initIndex = snippet.indexOf('runHotResumeInit(runtime)');
	assert.ok(restoreIndex > -1, 'hot-resume must restore the live snapshot');
	assert.ok(initIndex > -1, 'hot-resume must call cart init directly');
	assert.ok(restoreIndex < initIndex, 'hot-resume init must run after live-state restore');
	assert.equal(snippet.includes('finishLuaEntryLifecycle('), false, 'hot-resume must not use lifecycle IRQ transport');
});

test('Lua source boot installs through the program-image executable boundary', () => {
	const src = readFileSync('machine/ts/ide/runtime/lua_pipeline.ts', 'utf8');
	const start = src.indexOf('function bootLuaProgram');
	assert.ok(start > -1, 'bootLuaProgram not found');
	const nextExport = src.indexOf('\nexport function ', start + 1);
	const snippet = src.slice(start, nextExport === -1 ? undefined : nextExport);
	assert.equal(snippet.includes('encodeCompiledProgramImage(compiled)'), true, 'source boot must pass through the compiler-owned ProgramImage object boundary');
	assert.equal(snippet.includes('inflateExecutableProgramImage(programImage, compiled.metadata, runtime.programDataBaseAddress, runtime.programBssBaseAddress)'), true, 'source boot must install through the program/linker executable boundary');
	assert.equal(snippet.includes('resolveRuntimeProgramRelocations('), false, 'source boot must not own raw relocation resolution');
});


test('host eval append preserves installed program ROM while resolving appended code', () => {
	const src = readFileSync('machine/ts/machine/program/executor.ts', 'utf8');
	const start = src.indexOf('export function runHostEvalChunk');
	assert.ok(start > -1, 'runHostEvalChunk not found');
	const nextExport = src.indexOf('\nexport function ', start + 1);
	const snippet = src.slice(start, nextExport === -1 ? undefined : nextExport);
	assert.equal(snippet.includes('appendLuaChunkToProgram(currentProgram'), true, 'host eval append must compile against the currently installed program');
	assert.equal(snippet.includes('resolveRuntimeProgramRelocations(compiled.program, compiled.metadata, compiled.constRelocs)'), true, 'host eval append must resolve appended code relocations in the program owner');
	assert.equal(snippet.includes('runtime.machine.cpu.setProgram(compiled.program, compiled.metadata)'), true, 'host eval append must keep the base program ROM mapping intact');
	assert.equal(snippet.includes('encodeAppendedProgramImage('), false, 'host eval append must not rebuild a ProgramImage that drops the installed rodata ROM');
	assert.equal(snippet.includes('inflateExecutableProgramImage('), false, 'host eval append must not reinflate and shift the installed program ROM boundary');
});

test('runtime boot asks the program linker for linked boot images', () => {
	const src = readFileSync('machine/ts/ide/runtime/lua_pipeline.ts', 'utf8');
	assert.equal(src.includes('linkBootProgramImages('), true, 'runtime boot must route system+cart linking through the program/linker boot owner');
	assert.equal(src.includes('linkProgramImages('), false, 'runtime boot must not own raw multi-image link orchestration');
});
