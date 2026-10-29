// Replays both source reads through actual C++ scanout owners, then uses the
// actual C++ blend owner. Input/output words are console RGBA representation.
#include "render/backend/software/gx_gpu_scanout.cpp"
#include "render/backend/software/gx_gpu_state.h"
#include <iostream>
using namespace bmsx;
static u32 word(u32 a){u32 i=a>>1;return ((a&1?0xa5a5u:0x5a5au)^(i&0xffffu)^(i>>16))&0xffffu;}
static u32 pixel(GxGpuSoftwareState &s,u32 disp,u32 x,u32 y,bool circuit2){
 const u32 p=(disp>>15)&31,fbw=(disp>>9)&63,base=(disp&511)<<12;GxGpuPcrtcCircuit c{};c.framebufferBaseWord=base;c.framebufferPagesPerRow=fbw;c.framebufferWidth=fbw*64;
 if(p==0)return circuitPixel<GX_GPU_PCRTC_STORAGE_CT32>(s,c,x,y);
 if(p==1)return circuitPixel<GX_GPU_PCRTC_STORAGE_CT24>(s,c,x,y);
 if(p==2)return circuitPixel<GX_GPU_PCRTC_STORAGE_CT16>(s,c,x,y);
 if(p==10)return circuitPixel<GX_GPU_PCRTC_STORAGE_CT16S>(s,c,x,y);
 if(p==31)return circuitPixel<GX_GPU_PCRTC_STORAGE_GX16>(s,c,x,y);
 if(p==18&&!circuit2)return circuitPixel<GX_GPU_PCRTC_STORAGE_GPU24>(s,c,x,y);
 return circuitPixel<GX_GPU_PCRTC_STORAGE_ZERO>(s,c,x,y);
}
int main(){GxGpuSoftwareState s(2u<<20,0);for(u32 i=0;i<s.vram.size();i++)s.vram[i]=word(i);unsigned count;std::cin>>count;
 for(unsigned n=0;n<count;n++){
  u32 tag,pm,bg,in1,in2,d1,x1,y1,c1,d2,x2,y2,c2,expected;
  std::cin>>std::hex>>tag>>pm>>bg>>in1>>in2>>d1>>x1>>y1>>c1>>d2>>x2>>y2>>c2>>expected;
  if(pixel(s,d1,x1,y1,false)!=c1||pixel(s,d2,x2,y2,true)!=c2){std::cerr<<"source mismatch "<<std::dec<<n<<'\n';return 1;}
  const bool a=pm&64u,slbg=pm&128u,m=pm&32u;u32 out=outputArgb(bg&0xffffffu);
  if((pm&2u)&&in2){if(!slbg)out=(out&0xff000000u)|(outputArgb(c2)&0xffffffu);if(a)out=(out&0xffffffu)|(c2&0xff000000u);}
  if((pm&1u)&&in1){const u32 alpha=m?(pm>>8)&255u:std::min((c1>>24)*2u,255u);out=blendOutputArgb(out,c1,alpha,a?(out&0xff000000u):(c1&0xff000000u));}
  if(outputArgb(out)!=expected){std::cerr<<"composite mismatch "<<std::dec<<n<<'\n';return 1;}
 }
 std::cout<<"PASS "<<std::dec<<count<<" joined scanout/compositor samples vs actual TS/C++ owners\n";
}
