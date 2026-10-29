// Independent complete-word rate resolver vectors from the actual TS owner.
import { resolveApuPhaseStep } from '../../machine/ts/machine/devices/audio/playback';
const edges=[0,1,2,0x7fffffff,0x80000000,0xffffffff,0xffff0000,0x10000,44100];
const count=2048;let seed=0x65432abc;let row=0,column=0;
process.stdout.write(`${count}\n`);
for(let i=0;i<count;i++){
 let rate:number,hz:number;
 if(i<81){rate=edges[row]!;hz=edges[column]!;column++;if(column===edges.length){column=0;row++;}}
 else{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;rate=seed>>>0;seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;hz=seed>>>0;}
 const out={wholeQ16:0,remainder:0};resolveApuPhaseStep(out,rate,hz);
 process.stdout.write(`${rate.toString(16)} ${hz.toString(16)} ${BigInt.asUintN(64,BigInt(out.wholeQ16)).toString(16)} ${(out.remainder>>>0).toString(16)}\n`);
}
