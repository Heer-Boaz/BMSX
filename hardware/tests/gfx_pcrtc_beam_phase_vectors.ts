// The physical sample-grid phase is a proposal; H*D, LC and field totals are
// obtained from the real TS PCRTC timing owner. Sampled FIELD, VBlank and
// beam position are also checked against the actual runtime service owner.
// No software rendering output or DAC waveform is claimed by these vectors.
import { GxGpuPcrtc, GxGpuPcrtcTiming } from '../../machine/ts/machine/devices/gx/gpu_pcrtc';
import { GX_GPU_PCRTC_RESET_CONFIG_WORDS } from '../../machine/ts/spec/gx/pcrtc';
let seed=0xc30182f9;function rand(){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;}
function hex(v:number){return (v>>>0).toString(16).padStart(8,'0');}
const count=1024;process.stdout.write(`${count}\n`);
let field=0;
for(let n=0;n<count;n++){
 const w=Uint32Array.from(GX_GPU_PCRTC_RESET_CONFIG_WORDS);
 if(n!==0){w[12]=rand() & ~0x00030000;w[13]=rand();w[16]=rand();w[17]=rand();w[18]=rand();w[20]=rand();w[21]=rand();}
 if(n===1){w[12]=(127<<3)|1;w[13]=0;w[16]=1;w[17]=0;w[18]=0;w[20]=1;w[21]=0;}
 if(n===2){w[12]=(127<<3)|1;w[13]=0;w[16]=2;w[17]=0;w[18]=0;w[20]=7;w[21]=0;}
 if(n===3)w[12]!|=1<<16;
 if(n===4)w[12]!&=~0x3f8;
 if(n===5){w[20]=0;w[21]=0;}
 if(n>=6 && n%3===0){w[12]=((rand()&127)<<3)|((rand()&7))|((rand()&3)<<10);w[16]=rand()&31;w[17]=0;w[18]=0;w[20]=rand()&31;w[21]=0;}
 // Zero landmarks occur at restart, even if no half-line has elapsed.
 // All-active geometry puts both landmarks exactly at field end.
 if(n===6){w[12]=(1<<3)|1;w[13]=0;w[16]=1000;w[17]=0;w[18]=0;w[20]=1<<20;w[21]=0;}
 if(n===7){w[12]=(127<<3)|1;w[13]=0;w[16]=1;w[17]=0;w[18]=0;w[20]=0;w[21]=3<<10;}
 // Odd VFP and nonzero CMOD toggle FIELD; restart itself retains FIELD.
 if(n===8){w[12]=(1<<13)|(127<<3)|1;w[13]=0;w[16]=1;w[17]=0;w[18]=0;w[20]=1;w[21]=1<<10;}
 if(n===9){w[12]=1<<16;w[13]=0;w[16]=1;w[17]=0;w[18]=0;w[20]=1;w[21]=1<<10;}
 const t=new GxGpuPcrtcTiming();t.update(w);const rate=((w[12]!>>>3)&127)*2,P=t.halfLineClockNumerator,T=t.totalHalfLines;
 // A 13.5 MHz timebase lets each runtime service step represent one physical
 // reference edge. Device service coalesces events, whereas the proposed RTL
 // reports their count; compare resulting state, not equal IRQ/event counts.
 const device=new GxGpuPcrtc();device.reset(100);device.setCpuHz(13_500_000,100);
 for(const index of [12,13,16,17,18,20,21]) device.writeConfigWord(index,w[index]!,100);
 const saved=device.captureState(100);saved.csrWord=(saved.csrWord&~(1<<13))|(field<<13);device.restoreState(saved,100);
 const service=device.nextDeadlineCycle()===100 ? device.service(100) : 0;
 const initialVblank=service&3,initialVsync=(device.readCsr()>>>3)&1;
 field=device.field();
 process.stdout.write([w[12],w[13],w[16],w[17],w[18],w[20],w[21],t.running?1:0,P,rate,T,t.activeDisplayHalfLines,t.vsyncHalfLine,t.fieldToggles?1:0,initialVblank,initialVsync,field].map(v=>hex(v!)).join(' ')+'\n');
 let phase=0,line=0,halves=0,fields=0;
 for(let tick=0;tick<32;tick++){
  let crossed=0,wraps=0,vblank=0,vsync=0;
  if(t.running){const sum=phase+rate;crossed=(sum-sum%P)/P;phase=sum%P;
   for(let i=0;i<crossed;i++){
    line++;
    if(line===t.activeDisplayHalfLines)vblank++;
    if(line===t.vsyncHalfLine)vsync++;
    if(line===T){line=0;wraps++;if(t.activeDisplayHalfLines===0)vblank++;if(t.vsyncHalfLine===0)vsync++;}
   }
   halves+=crossed;fields+=wraps;
   if(vsync!==0)field=t.fieldToggles ? field^(vsync&1) : 1;
  }
  device.service(101+tick);
  const blank=t.running&&line>=t.activeDisplayHalfLines;
  if(device.field()!==field || device.vblankActive()!==blank ||
   (t.running && device.currentHalfLine(101+tick)%T!==line))
   throw new Error(`runtime service mismatch configuration ${n}, sample ${tick}`);
  process.stdout.write([phase,line,halves,fields,crossed,wraps,vblank,vsync,blank?1:0,field].map(hex).join(' ')+'\n');
 }
}
