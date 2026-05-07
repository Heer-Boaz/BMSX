import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('resumeFromSnapshot applies machine state before hot-resuming Lua code', () => {
	const src = readFileSync('src/bmsx/ide/runtime/lua_pipeline.ts', 'utf8');
	const start = src.indexOf('export async function resumeFromSnapshot');
	assert.ok(start > -1, 'resumeFromSnapshot not found');
	const nextExport = src.indexOf('\nexport function ', start + 1);
	const snippet = src.slice(start, nextExport === -1 ? undefined : nextExport);
	assert.equal(snippet.includes('applyRuntimeMachineState(runtime, snapshot.machineState)'), true, 'snapshot path should restore machine state');
	assert.equal(snippet.includes('resumeLuaProgramState(runtime, snapshot'), true, 'snapshot path should resume through the Lua owner');
});

test('reloadLuaProgramState applies hot-resume without reinitialising interpreter', () => {
	const src = readFileSync('src/bmsx/ide/runtime/lua_pipeline.ts', 'utf8');
	const start = src.indexOf('export function reloadLuaProgramState');
	assert.ok(start > -1, 'reloadLuaProgramState not found');
	const nextExport = src.indexOf('\nexport function ', start + 1);
	const snippet = src.slice(start, nextExport === -1 ? undefined : nextExport);
	assert.equal(snippet.includes('reinitializeLuaProgramFromSnapshot'), false, 'reloadLuaProgramState should not reset interpreter');
	assert.equal(snippet.includes('hotResumeProgramEntry'), true, 'reloadLuaProgramState should apply hot-resume');
});

test('hotResumeProgramEntry keeps interpreter resident', () => {
	const src = readFileSync('src/bmsx/ide/runtime/lua_pipeline.ts', 'utf8');
	const start = src.indexOf('export function hotResumeProgramEntry');
	assert.ok(start > -1, 'hotResumeProgramEntry not found');
	const nextExport = src.indexOf('\nexport function ', start + 1);
	const snippet = src.slice(start, nextExport === -1 ? undefined : nextExport);
	assert.equal(snippet.includes('createLuaInterpreter('), false, 'hotResumeProgramEntry should not create a new interpreter');
	assert.equal(snippet.includes('beginEntryExecution(runtime, entryProtoIndex)'), true, 'hotResumeProgramEntry must execute the updated path');
	assert.equal(snippet.includes('clearCartModuleCacheForHotResume'), true, 'hotResumeProgramEntry should reuse the hot-resume cache path');
});
