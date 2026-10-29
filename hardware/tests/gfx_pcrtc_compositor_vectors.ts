// Expected pixels via the actual TS scanout row owners, including the public
// PMODE/window composition rules. CT32 makes every source RGBA bit observable.
import { writeGenericCircuitRows } from '../../machine/ts/render/backend/software/gx_gpu_scanout_specialized.generated';
import { GX_GPU_PCRTC_SCANOUT_DRAW_RAW_RGB as RGB,GX_GPU_PCRTC_SCANOUT_DRAW_RAW_RGBA as RGBA,
 GX_GPU_PCRTC_SCANOUT_DRAW_RAW_ALPHA as ALPHA,GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_SOURCE_RGB as SRC_RGB,
 GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_SOURCE_RGBA as SRC_RGBA,GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_CONSTANT_RGB as C_RGB,
 GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_CONSTANT_RGBA as C_RGBA } from '../../machine/ts/machine/devices/gx/gpu_pcrtc';
let seed=0x7a839d11;function random(){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;}
function hex(v:number){return (v>>>0).toString(16).padStart(8,'0');}
const vram=new Uint16Array(1<<20),software={vram,vramWordMask:0xfffff},state={width:1},target=new Uint32Array(1);
const circuit={framebufferStoragePath:0,framebufferBaseWord:0,framebufferPagesPerRow:1,framebufferWidth:64,
 framebufferX:0,framebufferY:0,displayX:0,displayRight:1,fieldDisplayY:0,fieldDisplayLineCount:1,
 sourcePhaseX:0,sourceDivisionMultiplierX:1<<18,magnificationX:1,sourceAdvanceX:1,sourceRemainderStepX:0,
 fieldSourceNumeratorY:0,fieldSourceDivisionMultiplierY:1<<18,fieldSourceStride:1,fieldSourcePhase:0,fieldSourceNumeratorStepY:1};
const count=8192;process.stdout.write(`${count}\n`);
for(let n=0;n<count;n++){
 let pmode=random(),bg=random(),c1=random(),c2=random();const inside1=(n>>3)&1,inside2=(n>>4)&1;
 if(n<256)pmode=(pmode&~0xffe3)|((n&3)|(((n>>2)&7)<<5)|([0,1,127,128,254,255][n%6]!<<8));
 target[0]=bg&0xffffff;const amod=(pmode>>6)&1,slbg=(pmode>>7)&1,mmod=(pmode>>5)&1,alp=(pmode>>8)&255;
 const scanout={outputRowStep:1,blendAlpha:alp};
 function draw(pixel:number,path:number){vram[0]=pixel&65535;vram[1]=pixel>>>16;writeGenericCircuitRows(software as never,state as never,target,scanout as never,circuit as never,path);}
 if((pmode&2)&&inside2){if(!slbg)draw(c2,amod?RGBA:RGB);else if(amod)draw(c2,ALPHA);}
 if((pmode&1)&&inside1){
  if(!mmod)draw(c1,amod?SRC_RGB:SRC_RGBA);
  else if(alp===255)draw(c1,amod?RGB:RGBA);
  else if(alp===0){if(!amod)draw(c1,ALPHA);}
  else draw(c1,amod?C_RGB:C_RGBA);
 }
 process.stdout.write(`${hex(pmode)} ${hex(bg)} ${hex(c1)} ${hex(c2)} ${inside1} ${inside2} ${hex(target[0]!)}\n`);
}
