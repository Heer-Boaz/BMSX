// Actual C++ PCRTC traversal + scanout pixel + blend owners cross-check.
#include "render/backend/software/gx_gpu_scanout.cpp"
#include "render/backend/software/gx_gpu_state.h"
#include <iostream>
using namespace bmsx;
static u32 word(u32 a){const u32 i=a>>1;return ((a&1u?0xa5a5u:0x5a5au)^(i&0xffffu)^(i>>16))&0xffffu;}
static u32 pixel(GxGpuSoftwareState &s,u32 disp,u32 x,u32 y,bool circuit2){
 const u32 p=(disp>>15)&31u,fbw=(disp>>9)&63u,base=(disp&511u)<<12;GxGpuPcrtcCircuit c{};c.framebufferBaseWord=base;c.framebufferPagesPerRow=fbw;c.framebufferWidth=fbw*64;
 if(p==0)return circuitPixel<GX_GPU_PCRTC_STORAGE_CT32>(s,c,x,y);
 if(p==1)return circuitPixel<GX_GPU_PCRTC_STORAGE_CT24>(s,c,x,y);
 if(p==2)return circuitPixel<GX_GPU_PCRTC_STORAGE_CT16>(s,c,x,y);
 if(p==10)return circuitPixel<GX_GPU_PCRTC_STORAGE_CT16S>(s,c,x,y);
 if(p==31)return circuitPixel<GX_GPU_PCRTC_STORAGE_GX16>(s,c,x,y);
 if(p==18&&!circuit2)return circuitPixel<GX_GPU_PCRTC_STORAGE_GPU24>(s,c,x,y);
 return circuitPixel<GX_GPU_PCRTC_STORAGE_ZERO>(s,c,x,y);
}
int main(){GxGpuSoftwareState software(2u<<20,0);for(u32 i=0;i<software.vram.size();i++)software.vram[i]=word(i);unsigned count;std::cin>>count;
 for(unsigned n=0;n<count;n++){
  u32 tag,pm,bg,sm1,sm2,field,running,ox,sy,disp1,f1h,d1l,d1h,disp2,f2h,d2l,d2h,expected_mask,ex1,ey1,ex2,ey2,expected;
  std::cin>>std::hex>>tag>>pm>>bg>>sm1>>sm2>>field>>running>>ox>>sy>>disp1>>f1h>>d1l>>d1h>>disp2>>f2h>>d2l>>d2h>>expected_mask>>ex1>>ey1>>ex2>>ey2>>expected;
  auto w=GX_GPU_PCRTC_RESET_CONFIG_WORDS;w[0]=pm;w[12]=sm1;w[14]=sm2;w[4]=d1l;w[5]=d1h;w[3]=f1h;w[8]=d2l;w[9]=d2h;w[7]=f2h;
  GxGpuPcrtcTiming timing;timing.update(w);if(timing.running!=static_cast<bool>(running))return 1;GxGpuPcrtcScanout scan;scan.setField(field);scan.update(w,timing);
  u32 mask=0,out[4]={};if(scan.outputActive){const u32 step=timing.signalStepX,crop=(scan.cropSignalX+step-1)/step;
   const i64 x=static_cast<i64>(ox)-crop,y=static_cast<i64>(sy)-scan.cropSignalY;
   for(u32 lane=0;lane<2;lane++){const auto &c=scan.circuits[lane];i64 row=y-c.fieldDisplayY;
    if(!c.enabled||x<c.displayX||x>=c.displayRight||row<0||row%scan.outputRowStep||row/scan.outputRowStep>=c.fieldDisplayLineCount)continue;
    const u32 k=x-c.displayX,first=c.sourcePhaseX/c.magnificationX,rem=c.sourcePhaseX%c.magnificationX;
    out[lane*2]=c.framebufferX+first+k*c.sourceAdvanceX+(rem+k*c.sourceRemainderStepX)/c.magnificationX;
    const u32 line=row/scan.outputRowStep,num=c.fieldSourceNumeratorY+line*c.fieldSourceNumeratorStepY;
    out[lane*2+1]=c.framebufferY+((num*c.fieldSourceDivisionMultiplierY)>>18)*c.fieldSourceStride+c.fieldSourcePhase;mask|=1u<<lane;
   }
  }
  if(mask!=expected_mask||((mask&1u)&&(out[0]!=ex1||out[1]!=ey1))||((mask&2u)&&(out[2]!=ex2||out[3]!=ey2))){std::cerr<<"coordinate mismatch "<<std::dec<<n<<'\n';return 1;}
  const u32 c1=mask&1u?pixel(software,disp1,out[0],out[1],false):0u,c2=mask&2u?pixel(software,disp2,out[2],out[3],true):0u;
  const bool a=pm&64u,slbg=pm&128u,m=pm&32u;u32 result=outputArgb(bg&0xffffffu);
  if((pm&2u)&&(mask&2u)){if(!slbg)result=(result&0xff000000u)|(outputArgb(c2)&0xffffffu);if(a)result=(result&0xffffffu)|(c2&0xff000000u);}
  if((pm&1u)&&(mask&1u)){const u32 alpha=m?(pm>>8)&255u:std::min((c1>>24)*2u,255u);result=blendOutputArgb(result,c1,alpha,a?(result&0xff000000u):(c1&0xff000000u));}
  if(outputArgb(result)!=expected){std::cerr<<"pixel mismatch "<<std::dec<<n<<'\n';return 1;}
 }
 std::cout<<"PASS "<<std::dec<<count<<" coordinate/fetch/composition samples vs actual TS/C++ scanout owners\n";
}
