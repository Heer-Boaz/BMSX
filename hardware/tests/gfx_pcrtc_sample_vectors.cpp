#include "render/backend/software/gx_gpu_scanout.cpp"
#include "render/backend/software/gx_gpu_state.h"
#include <iostream>
using namespace bmsx;
static u32 word(u32 a){const u32 i=a>>1;return ((a&1?0xa5a5u:0x5a5au)^(i&0xffffu)^(i>>16))&0xffffu;}
int main(){GxGpuSoftwareState software(2u<<20,0);for(u32 i=0;i<software.vram.size();i++)software.vram[i]=word(i);unsigned count;std::cin>>count;for(unsigned n=0;n<count;n++){
 u32 circuit,disp,x,y,need,expectA,expectB,expected;std::cin>>std::hex>>circuit>>disp>>x>>y>>need>>expectA>>expectB>>expected;
 const u32 p=(disp>>15)&31,fbw=(disp>>9)&63,base=(disp&511)<<12;u32 a=0,b=0,num=1;
 if(p==0||p==1)a=gxGpuLocalMemoryAddress32(base,fbw,x,y);
 else if(p==2)a=gxGpuLocalMemoryAddress16(base,fbw,x,y);
 else if(p==10)a=gxGpuLocalMemoryAddress16S(base,fbw,x,y);
 else if(p==31)a=gxGpuLocalMemoryAddressGx16(base,fbw*64,x,y);
 else if(p==18&&!circuit){a=gxGpuLocalMemoryAddressGpu24(base,fbw,x,y,0);b=gxGpuLocalMemoryAddressGpu24(base,fbw,x,y,1);num=2;}else num=0;
 GxGpuPcrtcCircuit c{};c.framebufferBaseWord=base;c.framebufferPagesPerRow=fbw;c.framebufferWidth=fbw*64;
 u32 rgba=0;
 if(p==0)rgba=circuitPixel<GX_GPU_PCRTC_STORAGE_CT32>(software,c,x,y);
 else if(p==1)rgba=circuitPixel<GX_GPU_PCRTC_STORAGE_CT24>(software,c,x,y);
 else if(p==2)rgba=circuitPixel<GX_GPU_PCRTC_STORAGE_CT16>(software,c,x,y);
 else if(p==10)rgba=circuitPixel<GX_GPU_PCRTC_STORAGE_CT16S>(software,c,x,y);
 else if(p==31)rgba=circuitPixel<GX_GPU_PCRTC_STORAGE_GX16>(software,c,x,y);
 else if(num==2)rgba=circuitPixel<GX_GPU_PCRTC_STORAGE_GPU24>(software,c,x,y);
 else rgba=circuitPixel<GX_GPU_PCRTC_STORAGE_ZERO>(software,c,x,y);
 if(num!=need||a>>1!=expectA||b>>1!=expectB||rgba!=expected){std::cerr<<"mismatch "<<std::dec<<n<<'\n';return 1;}
 }std::cout<<"PASS "<<std::dec<<count<<" PCRTC samples against actual TS/C++ scanout and address owners\n";}
