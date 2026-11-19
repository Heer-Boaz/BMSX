import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { parseLuaChunk } from '../../toolchain/ts/lua/analysis/parse';
import { createTestSystemCpu, linkTestSystemBlua32 } from '../helpers/blua32';
import { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import * as v from '../../machine/ts/machine/cpu/value';

function compile(source: string, optLevel: 0|1|2|3, module=false) {
	const text = 'module<const>\nreturn function(word) return blua32.float_bits(blua32.float_from_bits(word)) end';
	return compileLuaChunkToProgram(parseLuaChunk(source,'words.lua').chunk,module?[{path:'word_bits',source:text,chunk:parseLuaChunk(text,'word_bits.lua').chunk}]:[],{entrySource:source,optLevel,programDomain:'system'});
}
const source = 'local f<const> = require("word_bits");return f(0x80000000),f(0x7fa12345),blua32.float_from_bits(0xffa12345),blua32.float_bits(2.0)';
for(const opt of [0,1,2,3] as const) for(const backend of [CpuExecutionBackend.Interpreter]) {
	test(`word moves O${opt} ${backend}: static functions reinterpret full payloads without calls or memory`,()=>{
		const image=linkTestSystemBlua32(compile(source,opt,true)),{cpu}=createTestSystemCpu(image,backend);
		assert.equal(cpu.runUntilDepth(0,100000),RunResult.Halted);
		const values:v.Value[]=[];cpu.readCompletionValues(values);
		assert.deepEqual(values,[v.valueInteger(-2147483648),v.valueInteger(0x7fa12345),v.valueFloatBits(0xffa12345),v.valueInteger(0x40000000)]);
	});
	test(`word moves O${opt} ${backend}: wrong subtypes fault even when a result is discarded`,()=>{
		for(const expression of ['blua32.float_bits(2)','blua32.float_from_bits(2.0)','blua32.float_bits(nil)','blua32.float_from_bits({})']) {
			const image=linkTestSystemBlua32(compile(expression+';return 1',opt)),{cpu}=createTestSystemCpu(image,backend);
			for(let step=0;step<1000 && cpu.readLuaFaultReasonWord()===0;++step) if(cpu.runUntilDepth(0,1)===RunResult.Halted) break;
			assert.equal(cpu.readLuaFaultReasonWord(),10,expression);
		}
	});
}
const runner=process.env.BMSX_CPU32_RUNNER;
for(const opt of [0,3] as const) test(`word moves O${opt}: real C++ instructions match TS words and cycles`,{skip:!runner},()=>{
	const image=linkTestSystemBlua32(compile(source,opt,true)),{cpu}=createTestSystemCpu(image);cpu.runUntilDepth(0,100000);
	const results:v.Value[]=[];cpu.readCompletionValues(results);
	const expected=[`budget ${cpu.instructionBudgetRemaining} fault 0`,...results.map(value=>`${v.valueTag(value).toString(16)} ${v.valuePayload(value).toString(16)}`)].join('\n')+'\n';
	assert.equal(execFileSync(runner!,['--execute-rom'],{input:image.romBytes,encoding:'utf8'}),expected);
});

for (const kind of ['float_bits','float_from_bits']) test(`generated ${kind}: warm payload transfers keep exact operand faults`, () => {
 const image=linkTestSystemBlua32(compile(`return function(value) return blua32.${kind}(value) end`,3));
 const {cpu}=createTestSystemCpu(image,CpuExecutionBackend.JavaScript);
 const owner=cpu.activeThread.currentFrame!.executionImage;
 assert.equal(cpu.runUntilDepth(0,100000),RunResult.Halted);
 const values:v.Value[]=[];cpu.readCompletionValues(values);
 const closure=v.asClosure(values[0],cpu.gc);
 for(let i=0;i<20;++i) {
  cpu.beginCompletionCall(closure,[kind==='float_bits'?v.valueFloatBits(0xffa12345):v.valueInteger(0xffa12345)]);
  assert.equal(cpu.runUntilDepth(0,1000),RunResult.Halted);
  const results:v.Value[]=[];cpu.readCompletionValues(results);
  assert.deepEqual(results,[kind==='float_bits'?v.valueInteger(0xffa12345):v.valueFloatBits(0xffa12345)]);
 }
 assert.ok(owner.compiledCodeLookup?.find(cpu.captureClosureBinding(closure).codeAddress,0)?.compiledBlocks,'the warm word move must enter generated code');
 cpu.beginCompletionCall(closure,[kind==='float_bits'?v.valueInteger(1):v.valueFloat(1)]);
 cpu.runUntilDepth(0,2);
 assert.equal(cpu.readLuaFaultReasonWord(),10);
 assert.equal(cpu.instructionBudgetRemaining,0);
});
