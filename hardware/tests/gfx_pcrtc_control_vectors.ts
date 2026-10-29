// System-edge ordering oracle from the actual TS PCRTC implementation.
import { GxGpuPcrtc } from '../../machine/ts/machine/devices/gx/gpu_pcrtc';
import { GX_GPU_PCRTC_RESET_CONFIG_WORDS } from '../../machine/ts/spec/gx/pcrtc';
const count=16384, d=new GxGpuPcrtc();let seed=0x49f70b65;
function rnd(){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;}
function w(x:number){return (x>>>0).toString(16).padStart(8,'0');}
d.reset(0);d.setCpuHz(33868800,0);const words=Uint32Array.from(GX_GPU_PCRTC_RESET_CONFIG_WORDS);
let irqs=0,acks=0,resets=0,unmask=0,vsync=0,hsync=0;
process.stdout.write(`${count}\n`);
for(let cycle=1;cycle<=count;cycle++){
 let irq=0,valid=0,index=0,word=0;
 if(d.nextDeadlineCycle()>=0 && d.nextDeadlineCycle()<=cycle)irq|=(d.service(cycle)&4)?1:0;
 const step=cycle%24;
 const quiet=cycle>count-3000;
 if(step===0){valid=1;index=24;word=(rnd()&0x1f)<<8;unmask++;}
 else if(step===3 || step===7){valid=1;index=22;word=rnd()&31;acks++;}
 else if(step===11){valid=1;index=22;word=(cycle%264===11)?0x300:0x100;if(word&0x200)resets++;}
 else if(step===14){valid=1;index=12;word=(cycle&128)?0x000003f9:0x00000009;}
 else if(step===15){valid=1;index=13;word=0;}
 else if(step===16){valid=1;index=16;word=1;}
 else if(step===17){valid=1;index=17;word=0;}
 else if(step===18){valid=1;index=18;word=0;}
 else if(step===19){valid=1;index=20;word=(rnd()&1)?0:1;}
 else if(step===20){valid=1;index=21;word=(rnd()&1)?0x400:0;}
 else if(step===21){valid=1;index=14;word=rnd();}
 if(quiet){valid=cycle===count-2999?1:0;index=22;word=0x200;}
 if(valid){
  if(index<22){d.writeConfigWord(index,word,cycle);words[index]=word;}
  else if(index===22){const action=d.writeCsr(word,cycle);if(action&0x200){d.reset(cycle);words.set(GX_GPU_PCRTC_RESET_CONFIG_WORDS);}}
  else if(index===24 && d.writeImr(word))irq=1;
 }
 if(d.nextDeadlineCycle()>=0 && d.nextDeadlineCycle()<=cycle)irq|=(d.service(cycle)&4)?1:0;
 const csr=d.readCsr(),imr=d.readImr();irqs+=irq;hsync+=(csr&4)?1:0;vsync+=(csr&8)?1:0;
 const line=d.timing.running?d.currentHalfLine(cycle)%d.timing.totalHalfLines:0;
 process.stdout.write([valid,index,word,csr,imr,irq,line].map(w).join(' ')+'\n');
}
if(!irqs||!acks||!resets||!unmask||!hsync||!vsync)throw new Error('missing CSR/IRQ coverage');
process.stderr.write(`irq=${irqs} csrAck=${acks} reset=${resets} maskWrites=${unmask}\n`);
