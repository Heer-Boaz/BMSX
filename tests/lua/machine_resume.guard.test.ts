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
	assert.equal(snippet.includes('runtime.startLoadedProgram(programImage.entryProtoIndex, [], false, false)'), true, 'hotResumeProgramEntry must execute the updated path');
	assert.equal(snippet.includes('encodeCompiledProgramImage(compiled)'), true, 'hotResumeProgramEntry must pass compiled code through the compiler-owned ProgramImage object boundary');
	assert.equal(snippet.includes('inflateExecutableProgramImage(programImage, compiled.metadata)'), true, 'hotResumeProgramEntry must install through the program/linker executable boundary');
	assert.equal(snippet.includes('resolveRuntimeProgramRelocations('), false, 'hotResumeProgramEntry must not own raw relocation resolution');
	assert.equal(snippet.includes('if (!params.preserveSystemModules)'), true, 'hot-resume must preserve live module objects (single generation); only a full reload clears the module cache');
});

test('Lua source boot installs through the program-image executable boundary', () => {
	const src = readFileSync('machine/ts/ide/runtime/lua_pipeline.ts', 'utf8');
	const start = src.indexOf('function bootLuaProgram');
	assert.ok(start > -1, 'bootLuaProgram not found');
	const nextExport = src.indexOf('\nexport function ', start + 1);
	const snippet = src.slice(start, nextExport === -1 ? undefined : nextExport);
	assert.equal(snippet.includes('encodeCompiledProgramImage(compiled)'), true, 'source boot must pass through the compiler-owned ProgramImage object boundary');
	assert.equal(snippet.includes('inflateExecutableProgramImage(programImage, compiled.metadata)'), true, 'source boot must install through the program/linker executable boundary');
	assert.equal(snippet.includes('resolveRuntimeProgramRelocations('), false, 'source boot must not own raw relocation resolution');
});


test('host eval append installs through the program-image executable boundary', () => {
	const src = readFileSync('machine/ts/machine/program/executor.ts', 'utf8');
	const start = src.indexOf('export function runHostEvalChunk');
	assert.ok(start > -1, 'runHostEvalChunk not found');
	const nextExport = src.indexOf('\nexport function ', start + 1);
	const snippet = src.slice(start, nextExport === -1 ? undefined : nextExport);
	assert.equal(snippet.includes('encodeAppendedProgramImage(compiled)'), true, 'host eval append must pass through the compiler-owned ProgramImage object boundary');
	assert.equal(snippet.includes('inflateExecutableProgramImage(programImage, compiled.metadata)'), true, 'host eval append must install through the program/linker executable boundary');
	assert.equal(snippet.includes('resolveRuntimeProgramRelocations('), false, 'host eval append must not own raw relocation resolution');
});
