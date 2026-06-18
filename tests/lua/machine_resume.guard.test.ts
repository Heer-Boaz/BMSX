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
	assert.equal(snippet.includes('runtime.startLoadedProgram(entryProtoIndex, [], false, false)'), true, 'hotResumeProgramEntry must execute the updated path');
	assert.equal(snippet.includes('resolveRuntimeProgramRelocations(program, metadata, constRelocs)'), true, 'hotResumeProgramEntry must resolve export-symbol placeholders before installing the replacement program');
	assert.equal(snippet.includes('if (!params.preserveSystemModules)'), true, 'hot-resume must preserve live module objects (single generation); only a full reload clears the module cache');
});

test('system builtin prelude starts from fresh CPU entry state', () => {
	const src = readFileSync('machine/ts/machine/firmware/runtime.ts', 'utf8');
	const start = src.indexOf('export function runSystemBuiltinPrelude');
	assert.ok(start > -1, 'runSystemBuiltinPrelude not found');
	const nextExport = src.indexOf('\nexport function ', start + 1);
	const snippet = src.slice(start, nextExport === -1 ? undefined : nextExport);
	assert.equal(snippet.includes('runtime.machine.cpu.start(compiled.entryProtoIndex)'), true, 'prelude should reset stale active CPU/HALT state before executing setup code');
	assert.equal(snippet.includes('callClosure(runtime, { protoIndex: compiled.entryProtoIndex'), false, 'prelude must not enter through the previous CPU call stack');
});
