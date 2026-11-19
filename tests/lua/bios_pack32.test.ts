import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {test} from 'node:test';
import {compileLuaChunkToProgram} from '../../toolchain/ts/lua/compiler';
import {parseLuaChunk} from '../../toolchain/ts/lua/analysis/parse';
import {createTestSystemCpu,linkTestSystemBlua32} from '../helpers/blua32';
import {CpuExecutionBackend} from '../../machine/ts/machine/cpu/compiled_block';
import {RunResult} from '../../machine/ts/machine/cpu/cpu';
import * as v from '../../machine/ts/machine/cpu/value';
const paths=['base','number/decimal','number/parse','table','string/base','string/mapped','string/pack','string/float/encode','string/float/decode'];
const modules=paths.map(path=>{const source=readFileSync(`machine/bios/${path}.lua`,'utf8');return{path,source,chunk:parseLuaChunk(source,path+'.lua').chunk};});
const consoleSource='return {write=function() end,end_line=function() end}';modules.push({path:'tty/console',source:consoleSource,chunk:parseLuaChunk(consoleSource,'tty/console.lua').chunk});
const budget=1000000;
function run(source:string,optLevel:0|3,backend:CpuExecutionBackend){
 const image=linkTestSystemBlua32(compileLuaChunkToProgram(parseLuaChunk(source,'pack32.lua').chunk,modules,{entrySource:source,optLevel,programDomain:'system'}));
 const {cpu}=createTestSystemCpu(image,backend);cpu.installBootPrimitives();assert.equal(cpu.runUntilDepth(0,budget),RunResult.Halted);
 const results:v.Value[]=[];cpu.readCompletionValues(results);assert.equal(cpu.readLuaFaultReasonWord(),0);
 return {image,cpu,results};
}
const prefix="require('base');local p<const>=require('string/pack');local s<const>=require('string/base');".replaceAll('<const>=','<const> =');
const source=readFileSync(new URL('../fixtures/compiler32/packet.lua',import.meta.url),'utf8');
for(const opt of [0,3] as const)for(const backend of [CpuExecutionBackend.Interpreter,CpuExecutionBackend.JavaScript])test(`packet32 O${opt} ${backend}: formats use Integer words, Float payloads and exact f64 interchange`,()=>{
 const {cpu,results}=run(source,opt,backend);
 assert.deepEqual(results.slice(0,7),[v.valueInteger(-2147483648),v.valueInteger(-1),v.valueInteger(0x40000000),v.valueInteger(-1),v.valueInteger(-1),v.valueInteger(33),v.valueInteger(12)]);
 const strings=results.slice(7,11).map(x=>cpu.stringPool.bytes(v.asStringId(x)));
 const bytes=(x:string)=>Array.from(x,c=>c.codePointAt(0)!);
 assert.deepEqual(bytes(strings[0]),[0,0,0,128,255,255,255,255,0,0,0,64,0,0,0,0,255,255,255,255,255,255,255,255,255,255,255,255,0,0,0,0]);
 assert.deepEqual(bytes(strings[1]),[0x41,0x70,0,0,0x10,0,0,0]);
 assert.deepEqual(bytes(strings[2]),[0x4f,0,0,0]);assert.deepEqual(bytes(strings[3]),[0xff,0xa1,0x23,0x45]);
 assert.deepEqual(results.slice(11),[v.valueInteger(0x3f800001),v.valueInteger(0xffa12345)]);
});
for(const backend of [CpuExecutionBackend.Interpreter,CpuExecutionBackend.JavaScript])test(`packet32 ${backend}: wide integers reject only out-of-range results, with sign extension and unsigned words`,()=>{
 const {results}=run(prefix+`local ff=s.char(255);local all=ff..ff..ff..ff..ff..ff..ff..ff
local signed=p.unpack('<i8',all)
local unsigned=pcall(p.unpack,'<I8',all)
local w=p.unpack('>i4',s.char(128,0,0,1))
local tiny=p.unpack('b',s.char(255))
local wide=p.unpack('>i8',s.char(255,255,255,255,255,255,255,254))
local too_large=pcall(p.unpack,'>i8',s.char(0,0,0,1,0,0,0,1))
return signed,unsigned,w,tiny,wide,too_large`,3,backend);
 assert.deepEqual(results,[v.valueInteger(-1),v.valueBool(false),v.valueInteger(-2147483647),v.valueInteger(-1),v.valueInteger(-2),v.valueBool(false)]);
});
for(const backend of [CpuExecutionBackend.Interpreter,CpuExecutionBackend.JavaScript])test(`packet32 ${backend}: positions, suffixes and length prefixes cannot wrap their admission boundary`,()=>{
 const {results}=run(prefix+`local a=pcall(p.pack,'I2',-1);local b=pcall(p.pack,'j',1.5)
local c=pcall(p.packsize,'c2147483648');local d=pcall(p.packsize,'c2147483647x')
local e=pcall(p.unpack,'s4',s.char(255,255,255,255));local f=pcall(p.unpack,'','',0/0)
local g=pcall(p.unpack,'','',1/0);local h=pcall(p.unpack,'','',0x80000000)
return a,b,c,d,e,f,g,h,p.packsize('c2147483647')`,3,backend);
 assert.deepEqual(results,[...Array(8).fill(v.valueBool(false)),v.valueInteger(2147483647)]);
});
const native=process.env.BMSX_CPU32_RUNNER;
for(const opt of [0,3] as const)test(`packet32 O${opt}: C++ executes the same BIOS with identical String bytes and cycles`,{skip:!native},()=>{
 const {image,cpu,results}=run(source,opt,CpuExecutionBackend.Interpreter);
 const expected=[`budget ${cpu.instructionBudgetRemaining} fault 0`,...results.map(x=>v.valueIsString(x)?'S '+cpu.stringPool.bytes(v.asStringId(x)):`${v.valueTag(x).toString(16)} ${v.valuePayload(x).toString(16)}`)].join('\n')+'\n';
 assert.deepEqual(execFileSync(native!,['--execute-rom','--boot-primitives',String(budget)],{input:image.romBytes}),Buffer.from(expected,'latin1'));
});
