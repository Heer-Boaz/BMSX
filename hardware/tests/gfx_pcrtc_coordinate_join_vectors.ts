// Coordinates come from actual TS PCRTC scanout traversal vectors. Samples and
// composition use the actual TS scanout row owners, with separate memories so
// that constructing a blend oracle does not alter the source image.
import {readFileSync} from 'node:fs';
import {writeGenericCircuitRows} from '../../machine/ts/render/backend/software/gx_gpu_scanout_specialized.generated';
import {GxGpuPcrtcTiming,GxGpuPcrtcScanout,GX_GPU_PCRTC_SCANOUT_DRAW_RAW_RGB as RGB,GX_GPU_PCRTC_SCANOUT_DRAW_RAW_RGBA as RGBA,
 GX_GPU_PCRTC_SCANOUT_DRAW_RAW_ALPHA as ALPHA,GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_SOURCE_RGB as SRC_RGB,
 GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_SOURCE_RGBA as SRC_RGBA,GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_CONSTANT_RGB as C_RGB,
 GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_CONSTANT_RGBA as C_RGBA} from '../../machine/ts/machine/devices/gx/gpu_pcrtc';
import {GX_GPU_PCRTC_RESET_CONFIG_WORDS} from '../../machine/ts/spec/gx/pcrtc';
const sat=process.argv.includes('--saturate');const rows=readFileSync('build/tests/gfx-pcrtc-window-vectors.txt','utf8').trim().split('\n').slice(1).map(v=>v.split(' ').map(x=>parseInt(x,16)>>>0));
const count=sat?256:rows.length;let seed=0x76e7bc21;function random(){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;}
function hex(v:number){return(v>>>0).toString(16).padStart(8,'0');}
const vram=new Uint16Array(1<<20),cmpVram=new Uint16Array(1<<20);for(let a=0;a<vram.length;a++){const i=a>>>1;vram[a]=((a&1?0xa5a5:0x5a5a)^(i&0xffff)^(i>>>16))&65535;}
const sw={vram,vramWordMask:0xfffff},cmpSw={vram:cmpVram,vramWordMask:0xfffff},state={width:1},target=new Uint32Array(1);
const c={framebufferStoragePath:0,framebufferBaseWord:0,framebufferPagesPerRow:1,framebufferWidth:64,framebufferX:0,framebufferY:0,
 displayX:0,displayRight:1,fieldDisplayY:0,fieldDisplayLineCount:1,sourcePhaseX:0,sourceDivisionMultiplierX:1<<18,
 magnificationX:1,sourceAdvanceX:1,sourceRemainderStepX:0,fieldSourceNumeratorY:0,fieldSourceDivisionMultiplierY:1<<18,fieldSourceStride:1,fieldSourcePhase:0,fieldSourceNumeratorStepY:1};
function pixel(disp:number,x:number,y:number,lane:number){
 const p=disp>>>15&31;c.framebufferStoragePath=p===0?0:p===1?1:p===2?2:p===10?3:p===18&&!lane?4:p===31?5:6;
 c.framebufferBaseWord=(disp&511)<<12;c.framebufferPagesPerRow=(disp>>>9)&63;c.framebufferWidth=c.framebufferPagesPerRow*64;
 c.framebufferX=x;c.framebufferY=y;target[0]=0;writeGenericCircuitRows(sw as never,state as never,target,{outputRowStep:1} as never,c as never,RGBA);return target[0]!;
}
const b={...c,framebufferStoragePath:0,framebufferBaseWord:0,framebufferPagesPerRow:1,framebufferWidth:64,framebufferX:0,framebufferY:0};
function compose(pm:number,bg:number,mask:number,c1:number,c2:number){
 target[0]=bg&0xffffff;const amod=pm>>>6&1,slbg=pm>>>7&1,mmod=pm>>>5&1,alp=pm>>>8&255,scanout={outputRowStep:1,blendAlpha:alp};
 function draw(p:number,path:number){cmpVram[0]=p&65535;cmpVram[1]=p>>>16;writeGenericCircuitRows(cmpSw as never,state as never,target,scanout as never,b as never,path);}
 if((pm&2)&&(mask&2)){if(!slbg)draw(c2,amod?RGBA:RGB);else if(amod)draw(c2,ALPHA);}
 if((pm&1)&&(mask&1)){if(!mmod)draw(c1,amod?SRC_RGB:SRC_RGBA);else if(alp===255)draw(c1,amod?RGB:RGBA);else if(alp===0){if(!amod)draw(c1,ALPHA);}else draw(c1,amod?C_RGB:C_RGBA);}
 return target[0]!;
}
const formats=[0,1,2,10,18,31,3,30];
if(sat){const words=Uint32Array.from(GX_GPU_PCRTC_RESET_CONFIG_WORDS);words[0]=0x8003;words[12]=(words[12]!&~0x01e30000)|(1<<21);words[14]=0;words[4]=0;words[5]=4095;words[8]=0;words[9]=4095;
 const timing=new GxGpuPcrtcTiming();timing.update(words);const scan=new GxGpuPcrtcScanout();scan.setField(0);scan.update(words,timing);
 if(!scan.outputActive||scan.circuits.some(c=>c.displayX!==0||c.displayY!==0||c.sourceAdvanceX!==1||c.fieldSourcePhase!==0))throw new Error('burst scanout setup');}
process.stdout.write(`${count}\n`);
for(let n=0;n<count;n++){
 let a=rows[n]!;if(sat){const w=Uint32Array.from(GX_GPU_PCRTC_RESET_CONFIG_WORDS);w[0]=0x8003;w[12]=(w[12]!&~0x01e30000)|(1<<21);w[14]=0;a=[w[0]!,w[12]!,0,0,1,n,0,0,4095,0,0,4095,0,3,n,0,n,0];}
 const [pm,sm1,sm2,field,running,ox,sy,d1l,d1h,f1h,d2l,d2h,f2h,mask,x1,y1,x2,y2]=a as number[];
 const p1=sat?18:formats[n&7]!,p2=sat?0:formats[(n>>>3)&7]!,disp1=sat?((18<<15)|(2<<9)):((random()&0x7fff)|(p1<<15)),disp2=sat?((2<<9)|64):((random()&0x7fff)|(p2<<15));
 const bg=random(),c1=mask!&1?pixel(disp1,x1!,y1!,0):0,c2=mask!&2?pixel(disp2,x2!,y2!,1):0,expected=compose(pm!,bg,mask!,c1,c2);
 process.stdout.write([n,pm,bg,sm1,sm2,field,running,ox,sy,disp1,f1h,d1l,d1h,disp2,f2h,d2l,d2h,mask,x1,y1,x2,y2,expected].map(v=>hex(v!)).join(' ')+'\n');
}
