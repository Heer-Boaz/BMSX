// Exercise the actual TypeScript CPU decode owner, not a parallel field decoder.
// Mocked bus/frame bindings supply raw words; no instruction is executed.
import {CPU} from '../../machine/ts/machine/cpu/cpu';
import {createDecodedInstructionPage,DecodedDispatchOp} from '../../machine/ts/machine/cpu/execution_image';
import {OPCODE_RK_OPERANDS,OPCODE_USES_BX,OPCODE_USES_DISP,RK_OPERAND_B,RK_OPERAND_C} from '../../machine/ts/spec/blua32/opcode';
import {signExtend,writeInstructionWord} from '../../machine/ts/spec/blua32/instruction_format';
import {decodeBlua32InstructionAtPc} from '../../toolchain/ts/rompack/disassembler';
const cpu:any=Object.create(CPU.prototype),page=createDecodedInstructionPage(false,null,0);
const code=new Uint8Array(8);
const globalSlots=new Uint32Array(4096),systemGlobalSlots=new Uint32Array(4096);
for(let i=0;i<globalSlots.length;i++){globalSlots[i]=(0x12340000+i)>>>0;systemGlobalSlots[i]=(0x56780000+i)>>>0;}
const globalMapBase=0x08300000,systemBase=globalMapBase+4*globalSlots.length;
const frame:any={executionImage:{executionDomainId:0,globalMapBase,globalNameCount:globalSlots.length,systemNameCount:systemGlobalSlots.length}};
let source=0,body=0,pc=0;cpu.executionBusSignals=0;
cpu.memory={readBusFaultSequence:()=>0,readMappedBusU32LE:(address:number)=>address===pc?source:body,
 readRamRecordWord:(address:number)=>address < systemBase ? globalSlots[(address-globalMapBase)>>>2] : systemGlobalSlots[(address-systemBase)>>>2]};
let seed=0x8ab42c31;function random(){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;}
function hex(v:number){return (v>>>0).toString(16).padStart(8,'0');}
const count=16384;process.stdout.write(`${count}\n`);
for(let n=0;n<count;n++){
 let op=n&63;const wide=(n>>>6)&1;if(!wide && op===0)op=1;
 body=(random()&~0xfc0000)|(op<<18);source=wide?(random()&~0xfc0000):body;source>>>=0;body>>>=0;
 // Global opcodes bind image-name indices through the activated map slots. Keep
 // those indices in this fixture's populated range for both instruction widths.
 if(op>=54 && op<=57){body&=0x00ffffff;if(wide)source&=~0xfc0;else source=body;}
 pc=(random()&~0x3ff)>>>0;page.widths[0]=0;cpu.decodeInstruction(frame,page,0,pc,false);
 writeInstructionWord(code,0,source);writeInstructionWord(code,1,body);
 const d=decodeBlua32InstructionAtPc(code,0,0);
 const rkB=signExtend(d.b,9+wide*6),rkC=signExtend(d.c,9+wide*6);
 const usesBx=OPCODE_USES_BX[op]!==0,usesDisp=OPCODE_USES_DISP[op]!==0;
 const next=(pc+(wide?8:4))>>>0,target=(next+d.sbx*4)>>>0;
 if(page.a[0]!==d.a)throw new Error(`CPU/disassembler A mismatch in vector ${n}`);
 if(usesBx) {
  if((op>=40 && op<=42 && page.bx[0]!==target)
   || (op===11 && page.sbx[0]!==d.sbx)
   || ((op===2 || op===43 || op===53) && page.bx[0]!==d.bx)
   || (op>=54 && op<=57 && page.bx[0] !== (op<=55 ? systemGlobalSlots[d.bx] : globalSlots[d.bx]))
   || (op===43 && page.c[0]!==d.c))
   throw new Error(`CPU/disassembler Bx mismatch in vector ${n}`);
 } else {
  const rk=OPCODE_RK_OPERANDS[op]!;
  const b=!usesDisp && (rk&RK_OPERAND_B) ? rkB : d.b;
  const c=!usesDisp && (rk&RK_OPERAND_C) ? rkC : d.c;
  if(page.b[0]!==b || page.c[0]!==c || (usesDisp && page.disp[0]!==d.disp))
   throw new Error(`CPU/disassembler operands mismatch in vector ${n}`);
 }
 process.stdout.write(`${hex(pc)} ${hex(source)} ${hex(body)} ${wide} ${hex(op)} ${hex(d.a)} ${hex(d.b)} ${hex(d.c)} ${hex(d.bx)} ${hex(d.sbx)} ${hex(rkB)} ${hex(rkC)} ${hex(target)} ${hex(d.disp)} ${page.ops[0]===DecodedDispatchOp.ReservedMemory?1:0} ${wide&&op===0?1:0}\n`);
}
