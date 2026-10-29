// Decode via the actual TS CPU and read numeric values through its RK owner and
// ValueSlots. Storage is a deterministic fixture, not a complete VM frame.
import {CPU} from '../../machine/ts/machine/cpu/cpu';
import {createDecodedInstructionPage} from '../../machine/ts/machine/cpu/execution_image';
import {ValueSlots} from '../../machine/ts/machine/cpu/value_slots';
import {ValueTag} from '../../machine/ts/machine/cpu/value';
const data=new DataView(new ArrayBuffer(8));
function num(v:bigint){data.setBigUint64(0,v,true);return data.getFloat64(0,true);}
function bits(v:number){data.setFloat64(0,v,true);return data.getBigUint64(0,true);}
function h(v:number){return (v>>>0).toString(16);}
function h64(v:bigint){return v.toString(16).padStart(16,'0');}
const special=[0n,0x8000000000000000n,0x3ff0000000000000n,0xbff0000000000000n,0x41e0000000000000n,
 0xc1e0000000000000n,0x41f0000000000000n,0xc1f0000000000000n,0x4330000000000000n,
 0x4520000000000000n,0x4530000000000000n,0x7ff0000000000000n,0xfff0000000000000n,
 0x7ff8000000000000n,0x3fefffffffffffffn,0xbfefffffffffffffn,0x403f000000000000n,
 0x4040000000000000n,0x41efffffffe00000n,0xc031800000000000n,0x4040f00000000000n];
const registers=new ValueSlots(32768), tags=new Uint8Array(16384), scalars=new Float64Array(16384);
for(let i=0;i<32768;i++){
 const n=num(special[(i*5)%special.length]!);if(i%7===0)registers.setNil(i);else registers.setNumber(i,n);
 if(i<16384){tags[i]=(i+1)%7===0?ValueTag.False:ValueTag.Number;scalars[i]=num(special[(i*5+1)%special.length]!);}
}
const cpu:any=Object.create(CPU.prototype),page=createDecodedInstructionPage(false,null,0);
const image:any={executionDomainId:0,globalSlots:new Uint32Array(1),systemGlobalSlots:new Uint32Array(1),constTags:tags,constScalars:scalars};
const frame:any={executionImage:image,registers};let source=0,body=0,pc=0;
cpu.executionBusSignals=0;cpu.memory={readBusFaultSequence:()=>0,readMappedBusU32BE:(address:number)=>address===pc?source:body};
let seed=0x9a7132d1;function random(){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;}
const ops=[24,25,26,27,28,34],count=4096;process.stdout.write(`${count}\n`);
for(let n=0;n<count;n++){
 const op=ops[n%6]!,wide=(n>>>3)&1;body=((random()&~0xfc0000)|(op<<18))>>>0;source=wide?(random()&~0xfc0000)>>>0:body;
 pc=(random()&~0x3ff)>>>0;page.widths[0]=0;cpu.decodeInstruction(frame,page,0,pc,false);
 const a=page.a[0]!,b=page.b[0]!,rkb=page.rkB[0]!,rkc=page.rkC[0]!;
 const lb=op===34?0:rkb<0?1:0,li=op===34?b:rkb<0?-1-rkb:rkb;
 const rb=rkc<0?1:0,ri=rkc<0?-1-rkc:rkc;
 const left=op===34?registers.getNumber(b):cpu.readRKNumber(frame,rkb),right=cpu.readRKNumber(frame,rkc);
 const ltag=lb?tags[li]!:registers.getTag(li),rtag=rb?tags[ri]!:registers.getTag(ri);
 const lscalar=lb?scalars[li]!:registers.getScalar(li),rscalar=rb?scalars[ri]!:registers.getScalar(ri);
 let out=0;switch(op){case 24:out=left&right;break;case 25:out=left|right;break;case 26:out=left^right;break;
 case 27:out=left<<(right&31);break;case 28:out=left>>(right&31);break;case 34:out=~left;break;}
 process.stdout.write(`${h(pc)} ${h(source)} ${h(body)} ${wide} ${h(op)} ${h(a)} ${h(b)} ${h(rkb)} ${h(rkc)} ${lb} ${h(li)} ${rb} ${h(ri)} ${ltag===ValueTag.Number?1:0} ${h64(bits(lscalar))} ${rtag===ValueTag.Number?1:0} ${h64(bits(rscalar))} ${h64(bits(out))}\n`);
}
