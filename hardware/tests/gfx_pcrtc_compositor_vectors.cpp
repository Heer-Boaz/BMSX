// Replay with the actual C++ scanout blend owner; BG/source packing is RGBA.
#include "render/backend/software/gx_gpu_scanout.cpp"
#include <iostream>
using namespace bmsx;
int main(){unsigned count;std::cin>>count;for(unsigned n=0;n<count;n++){
 u32 pm,bg,c1,c2,in1,in2,expect;std::cin>>std::hex>>pm>>bg>>c1>>c2>>in1>>in2>>expect;
 const bool a=pm&64u,s=pm&128u,m=pm&32u;
 u32 out=outputArgb(bg&0xffffffu);
 if((pm&2u)&&in2){if(!s)out=(out&0xff000000u)|(outputArgb(c2)&0xffffffu);if(a)out=(out&0xffffffu)|(c2&0xff000000u);}
 if((pm&1u)&&in1){const u32 alpha=m?(pm>>8)&255u:std::min((c1>>24)*2u,255u);
  out=blendOutputArgb(out,c1,alpha,a?(out&0xff000000u):(c1&0xff000000u));}
 const u32 actual=outputArgb(out);if(actual!=expect){std::cerr<<"case "<<std::dec<<n<<" got "<<std::hex<<actual<<" expected "<<expect<<'\n';return 1;}
 }std::cout<<"PASS "<<std::dec<<count<<" PCRTC composition pixels vs TS/C++ scanout owners\n";}
