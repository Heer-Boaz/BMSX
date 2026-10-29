// Feed the actual TS owner the existing system-beam trace. Service the old
// timing before each write and service a restart due on the same edge after it.
import { readFileSync } from 'node:fs';
import { GxGpuPcrtc } from '../../machine/ts/machine/devices/gx/gpu_pcrtc';
const rows=readFileSync('build/tests/gfx-pcrtc-system-beam-vectors.txt','utf8').trim().split('\n');
const total=Number(rows.shift()), d=new GxGpuPcrtc();d.reset(0);d.setCpuHz(33868800,0);
let before=0,after=0,both=0,writeBefore=0;
process.stdout.write(`${total}\n`);
for(let cycle=1;cycle<=total;cycle++){
 const [valid,index,word]=rows[cycle-1]!.split(' ').map(v=>parseInt(v,16));
 d.writeCsr(0x1f,cycle);let pre=0,post=0;
 if(d.nextDeadlineCycle()>=0 && d.nextDeadlineCycle()<=cycle && (d.service(cycle)&3)===1){pre=1;d.latchPresentationWords();}
 if(valid)d.writeConfigWord(index!,word!,cycle);
 if(d.nextDeadlineCycle()>=0 && d.nextDeadlineCycle()<=cycle && (d.service(cycle)&3)===1){post=1;d.latchPresentationWords();}
 before+=pre;after+=post;both+=pre&&post?1:0;writeBefore+=valid&&pre?1:0;
 process.stdout.write([valid,index,word,pre,post,...d.presentWords].map(v=>v!.toString(16).padStart(8,'0')).join(' ')+'\n');
}
if(!both||!writeBefore)throw new Error('missing coincident latch and write scenarios');
process.stderr.write(`latches pre=${before} post=${after} both=${both} old-with-write=${writeBefore}\n`);
