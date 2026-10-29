// Actual JS bitwise semantics plus the CPU value-slot numeric read. Each word
// is an IEEE-754 binary64 operand, exactly the datapath boundary after RK read.
import {ValueSlots} from '../../machine/ts/machine/cpu/value_slots';
import {ValueTag} from '../../machine/ts/machine/cpu/value';
const slots=new ValueSlots(2);slots.setNil(0);
if((slots.getNumber(0)|0)!==0)throw new Error('nil numeric read');
slots.setEncoded(0,ValueTag.False,0,null);
if((slots.getNumber(0)|0)!==0)throw new Error('false numeric read');
const data=new DataView(new ArrayBuffer(8));
function fromBits(bits:bigint):number{data.setBigUint64(0,bits,true);return data.getFloat64(0,true);}
function toBits(value:number):bigint{data.setFloat64(0,value,true);return data.getBigUint64(0,true);}
function hex64(value:bigint):string{return value.toString(16).padStart(16,'0');}
let seed=0x6e314f89;function random(){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;}
const special=[0x0000000000000000n,0x8000000000000000n,0x3ff0000000000000n,0xbff0000000000000n,
 0x41e0000000000000n,0xc1e0000000000000n,0x41f0000000000000n,0xc1f0000000000000n,
 0x4330000000000000n,0x4520000000000000n,0x4530000000000000n,0x7ff0000000000000n,
 0xfff0000000000000n,0x7ff8000000000001n,0x3fefffffffffffffn,0xbfefffffffffffffn,
 0x403f000000000000n,0x4040000000000000n,0xbff0000000000000n,0x41efffffffe00000n];
const count=32768;process.stdout.write(`${count}\n`);
for(let n=0;n<count;n++){
 const op=n%6,dest=random()&0x3fff;
 let l=(BigInt(random())<<32n)|BigInt(random()),r=(BigInt(random())<<32n)|BigInt(random());
 if(n<2048)l=(l&0x800fffffffffffffn)|(BigInt(n)<<52n);
 if(n>=2048 && n%7===0)l=special[n%special.length]!;
 if(n%3===0)r=special[(n*7+1)%special.length]!;
 const left=fromBits(l),right=fromBits(r);let out=0;
 switch(op){case 0:out=left&right;break;case 1:out=left|right;break;case 2:out=left^right;break;
  case 3:out=left<<(right&31);break;case 4:out=left>>(right&31);break;case 5:out=~left;break;}
 process.stdout.write(`${(1<<op).toString(16)} ${dest.toString(16)} ${hex64(l)} ${hex64(r)} ${hex64(toBits(out))}\n`);
}
