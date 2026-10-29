// System-cycle programmed writes and beam state from the actual TS owner.
import { GxGpuPcrtc, GxGpuPcrtcTiming } from '../../machine/ts/machine/devices/gx/gpu_pcrtc';
import { GX_GPU_PCRTC_RESET_CONFIG_WORDS } from '../../machine/ts/spec/gx/pcrtc';
const total=8192, d=new GxGpuPcrtc(), words=Uint32Array.from(GX_GPU_PCRTC_RESET_CONFIG_WORDS);
let seed=0x73ad1931;function rnd(){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;}
const indices=[12,13,16,17,18,19,20,21,14,15,0,2];
// H=D=1 and LC=127 exercise over one hundred beam landmarks in one system
// tick, including a fresh zero landmark on an edge that also services the old
// beam. The remaining cycles retain the mixed random changed/unchanged writes.
const extremeWrites: Record<number, [number,number]> = {
 1:[12,(127<<3)|1|(1<<13)],2:[16,1],3:[17,0],4:[18,0],5:[13,0],6:[20,1],7:[21,0],
 101:[20,1<<20],102:[20,1],103:[20,1<<20],104:[20,1],105:[20,1<<20],106:[20,1],
 120:[12,0],121:[12,(127<<3)|1|(1<<13)],130:[13,16],140:[21,0x00200000],
 150:[21,0],151:[20,1<<20],152:[20,1],200:[16,0],201:[16,1],
};
let oldVblankWithRestart=0,oldVsyncWithRestart=0,maxVblank=0,maxVsync=0,phase=0,logicalLine=0;
d.reset(0);d.setCpuHz(33_868_800,0);process.stdout.write(`${total}\n`);
for(let cycle=1;cycle<=total;cycle++){
 let valid=0,index=0,word=0,restart=0,vblank=0;
 const oldTiming=new GxGpuPcrtcTiming();oldTiming.update(words);
 let nextPhase=phase,nextLine=logicalLine,vc=0,sc=0;
 if(oldTiming.running){
  const period=oldTiming.halfLineClockNumerator*784, sum=phase+((words[12]!>>>3)&127)*625;
  const crossings=(sum-sum%period)/period;nextPhase=sum%period;
  const lines=logicalLine+crossings;nextLine=lines%oldTiming.totalHalfLines;
  const wraps=(lines-nextLine)/oldTiming.totalHalfLines;
  vc=wraps+(nextLine>=oldTiming.activeDisplayHalfLines?1:0)-(logicalLine>=oldTiming.activeDisplayHalfLines?1:0);
  sc=wraps+(nextLine>=oldTiming.vsyncHalfLine?1:0)-(logicalLine>=oldTiming.vsyncHalfLine?1:0);
 }
 d.writeCsr(0x1f,cycle);
 if(d.nextDeadlineCycle()>=0 && d.nextDeadlineCycle()<=cycle)vblank|=(d.service(cycle)&3)===1?1:0;
 const oldVblank=vblank,oldVsync=(d.readCsr()>>>3)&1;
 const step=cycle%48;
 if(cycle<=256){const extreme=extremeWrites[cycle];if(extreme){valid=1;[index,word]=extreme;}}
 else if(step<12){valid=1;index=indices[step]!;word=rnd();
  if(step===0)word=(word & ~0x00030000) | 1; // include runnable timing
  if(step===2)word=(word&~0x003fffff) | 1;
  if(step===3 || step===4)word=0;
  if(step===5 && (cycle&128)!==0)word=words[index]!; // same write, no restart
  if(step===6)word=(word&0x000fffff)|0x00100000;
  if(step===7)word=(word&0x000003ff)|0x00000400;
 }
 if(valid){restart=d.writeConfigWord(index,word,cycle)?1:0;words[index]=word;
  oldVblankWithRestart+=restart && oldVblank ? 1 : 0;
  oldVsyncWithRestart+=restart && oldVsync ? 1 : 0;}
 const t=new GxGpuPcrtcTiming();t.update(words);
 if(restart){phase=0;logicalLine=0;vc+=t.running&&t.activeDisplayHalfLines===0?1:0;sc+=t.running&&t.vsyncHalfLine===0?1:0;}
 else{phase=nextPhase;logicalLine=nextLine;}
 maxVblank=Math.max(maxVblank,vc);maxVsync=Math.max(maxVsync,sc);
 if(d.nextDeadlineCycle()>=0 && d.nextDeadlineCycle()<=cycle)vblank|=(d.service(cycle)&3)===1?1:0;
 const line=t.running?d.currentHalfLine(cycle)%t.totalHalfLines:0;
 if(line!==logicalLine || (vc!==0)!==(vblank!==0) || (sc!==0)!==(((d.readCsr()>>>3)&1)!==0))throw new Error(`phase model mismatch cycle ${cycle}`);
 const out=[valid,index,word,restart,t.running?1:0,line,d.vblankActive()?1:0,d.field(),d.readRegisterWord(index),vc,sc,phase];
 process.stdout.write(out.map(x=>(x>>>0).toString(16).padStart(8,'0')).join(' ')+'\n');
}
if(!oldVblankWithRestart||!oldVsyncWithRestart)throw new Error('missing coincident old event/restart coverage');
if(maxVblank<102 || maxVsync<102)throw new Error('missing multiple-landmark extreme coverage');
process.stderr.write(`old VBlank + restart ${oldVblankWithRestart}, old VSync + restart ${oldVsyncWithRestart}, maximum counts ${maxVblank}/${maxVsync}\n`);
