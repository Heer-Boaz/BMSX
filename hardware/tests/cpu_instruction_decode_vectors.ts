// Exercise the actual TypeScript CPU decode owner, not a parallel field decoder.
// Mocked bus/frame bindings supply raw words; no instruction is executed.
import {CPU} from '../../machine/ts/machine/cpu/cpu';
import {createDecodedInstructionPage} from '../../machine/ts/machine/cpu/execution_image';
const cpu:any=Object.create(CPU.prototype),page=createDecodedInstructionPage(false,null,0);
const frame:any={executionImage:{executionDomainId:0,globalSlots:new Uint32Array(1),systemGlobalSlots:new Uint32Array(1)}};
let source=0,body=0,pc=0;cpu.executionBusSignals=0;
cpu.memory={readBusFaultSequence:()=>0,readMappedBusU32BE:(address:number)=>address===pc?source:body};
let seed=0x8ab42c31;function random(){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;}
function hex(v:number){return (v>>>0).toString(16).padStart(8,'0');}
const count=16384;process.stdout.write(`${count}\n`);
for(let n=0;n<count;n++){
 let op=n&63;const wide=(n>>>6)&1;if(!wide && op===0)op=1;
 body=(random()&~0xfc0000)|(op<<18);source=wide?(random()&~0xfc0000):body;source>>>=0;body>>>=0;
 pc=(random()&~0x3ff)>>>0;page.widths[0]=0;cpu.decodeInstruction(frame,page,0,pc,false);
 const sbx=page.sbx[0]!,bx=(sbx&(wide?0x3ffffff:0xfffff))>>>0;
 const next=(pc+(wide?8:4))>>>0,target=(next+sbx*4)>>>0;
 process.stdout.write(`${hex(pc)} ${hex(source)} ${hex(body)} ${wide} ${hex(op)} ${hex(page.a[0]!)} ${hex(page.b[0]!)} ${hex(page.c[0]!)} ${hex(bx)} ${hex(sbx)} ${hex(page.rkB[0]!)} ${hex(page.rkC[0]!)} ${hex(target)} ${hex(page.disp[0]!)} ${page.ops[0]===68?1:0} ${wide&&op===0?1:0}\n`);
}
