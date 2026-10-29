// Expected window/coordinates are derived from real PCRTC scanout traversal
// owners, not from the RTL's reciprocal table or a second fixed-point encoder.
import {GxGpuPcrtcTiming,GxGpuPcrtcScanout} from '../../machine/ts/machine/devices/gx/gpu_pcrtc';
import {GX_GPU_PCRTC_RESET_CONFIG_WORDS} from '../../machine/ts/spec/gx/pcrtc';
let seed=0xc10c7e75;function random(){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;}
function hex(v:number){return (v>>>0).toString(16).padStart(8,'0');}
function div(n:number,d:number){return (n-n%d)/d;}
const count=8192;process.stdout.write(`${count}\n`);
for(let n=0;n<count;n++){
 const words=Uint32Array.from(GX_GPU_PCRTC_RESET_CONFIG_WORDS),pm=random(),step=n<16?n:random()&15;
 words[0]=pm;words[3]=random();words[4]=random();words[5]=random();words[7]=random();words[8]=random();words[9]=random();
 words[12]=(words[12]!&~0x01e30000)|(step<<21)|((n%97===0)?0x00010000:0);
 words[14]=random();let field=random()&1;
 if(n===16){words[0]=3;words[3]=20<<11;words[4]=680|(7<<12)|(3<<23)|(1<<27);words[5]=31|(7<<12);words[7]=0;words[8]=680|(5<<12)|(3<<23);words[9]=31|(7<<12);words[12]=(words[12]!&~0x01e30000)|(4<<21);words[14]=1;field=0;}
 if(n===17){words[0]=1;words[3]=2047|(2047<<11);words[4]=4095|(2047<<12);words[5]=4095|(2047<<12);words[12]=(words[12]!&~0x01e30000)|(1<<21);words[14]=0;field=0;}
 const timing=new GxGpuPcrtcTiming();timing.update(words);const scan=new GxGpuPcrtcScanout();scan.setField(field);scan.update(words,timing);
 const chosen=scan.circuits[n&1]!,s=timing.signalStepX;
 const begin=chosen.displaySignalX;let outputX=0;
 if(s){const a=div(begin+s-1,s);const width=(words[(n&1)?9:5]!&4095)+1;outputX=a+(random()%(div(width+s-1,s)+3));}
 let signalY=chosen.displaySignalY+random()%(((words[(n&1)?9:5]!>>>12)&2047)+3);
 if(n===16){outputX=170;signalY=7;}
 if(n===17){outputX=8190;signalY=4094;}
 let mask=0;const out=[0,0,0,0];
 if(scan.outputActive){
  const cropNumerator=scan.cropSignalX+s-1,cropPixel=div(cropNumerator,s);
  const x=outputX-cropPixel,y=signalY-scan.cropSignalY;
  for(let lane=0;lane<2;lane++){
   const c=scan.circuits[lane]!;const rowdiff=y-c.fieldDisplayY;
   if(!c.enabled||x<c.displayX||x>=c.displayRight||rowdiff<0||rowdiff%scan.outputRowStep||div(rowdiff,scan.outputRowStep)>=c.fieldDisplayLineCount)continue;
   const k=x-c.displayX;
   const first=div(c.sourcePhaseX,c.magnificationX),rem=c.sourcePhaseX%c.magnificationX;
   const extra=rem+k*c.sourceRemainderStepX;
   const sourceX=c.framebufferX+first+k*c.sourceAdvanceX+div(extra,c.magnificationX);
   const line=div(rowdiff,scan.outputRowStep);
   const numerator=c.fieldSourceNumeratorY+line*c.fieldSourceNumeratorStepY;
   const sourceY=c.framebufferY+((numerator*c.fieldSourceDivisionMultiplierY)>>>18)*c.fieldSourceStride+c.fieldSourcePhase;
   mask|=1<<lane;out[lane*2]=sourceX;out[lane*2+1]=sourceY;
  }
 }
 if(n===16&&(mask&1)===0)throw new Error('documented interlaced example not inside');
 if(n===16&&out[1]!==21)throw new Error(`documented interlaced Y ${out[1]}`);
 if(n===17&&(mask!==1||out[0]!==6142||out[1]!==4094))throw new Error('maximum extent wrap');
 process.stdout.write([words[0],words[12],words[14],field,timing.running?1:0,outputX,signalY,words[4],words[5],words[3],words[8],words[9],words[7],mask,...out].map(v=>hex(v!)).join(' ')+'\n');
}
