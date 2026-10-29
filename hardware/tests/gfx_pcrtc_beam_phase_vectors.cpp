// Replay the proposed physical phase integration using the real C++ timing
// owner's numerator, denominator/running state and vertical field length.
// The actual C++ runtime service is sampled alongside the independent phase
// model for FIELD, VBlank and beam position; IRQ/event counts coalesce there.
#include "machine/devices/gx/gpu_pcrtc.h"
#include <iostream>
using namespace bmsx;
int main(){unsigned count;std::cin>>count;u32 field=0;for(unsigned n=0;n<count;n++){
 u32 a,b,c,d,e,f,g,run,P,rate,T,active,sync,toggle,initialVblank,initialVsync,initialField;std::cin>>std::hex>>a>>b>>c>>d>>e>>f>>g>>run>>P>>rate>>T>>active>>sync>>toggle>>initialVblank>>initialVsync>>initialField;
 auto w=GX_GPU_PCRTC_RESET_CONFIG_WORDS;w[12]=a;w[13]=b;w[16]=c;w[17]=d;w[18]=e;w[20]=f;w[21]=g;
 GxGpuPcrtcTiming t;t.update(w);
 if(t.running!=bool(run)||t.halfLineClockNumerator!=P||(((a>>3)&127u)*2u)!=rate||t.totalHalfLines!=T||t.activeDisplayHalfLines!=active||t.vsyncHalfLine!=sync||t.fieldToggles!=bool(toggle)){std::cerr<<"timing "<<std::dec<<n<<'\n';return 1;}
 GxGpuPcrtc device;device.reset(100);device.setCpuHz(13500000,100);
 for(const u32 index : {12u,13u,16u,17u,18u,20u,21u})device.writeConfigWord(index,w[index],100);
 auto saved=device.captureState(100);saved.csrWord=(saved.csrWord&~(1u<<13))|(field<<13);device.restoreState(saved,100);
 const u32 result=device.nextDeadlineCycle()==100 ? device.service(100) : 0;
 if((result&3)!=initialVblank||((device.readCsr()>>3)&1)!=initialVsync||device.field()!=initialField){std::cerr<<"restart "<<std::dec<<n<<'\n';return 1;}
 field=device.field();
 u32 phase=0,line=0,halves=0,fields=0;
 for(unsigned tick=0;tick<32;tick++){
  u32 ep,el,eh,ef,ec,ew,ev,es,ea,efi;std::cin>>std::hex>>ep>>el>>eh>>ef>>ec>>ew>>ev>>es>>ea>>efi;u32 cross=0,wraps=0,vblank=0,vsync=0;
  if(run){const u32 sum=phase+rate;cross=sum/P;phase=sum%P;
   for(u32 i=0;i<cross;i++){line++;vblank+=line==active;vsync+=line==sync;if(line==T){line=0;wraps++;vblank+=active==0;vsync+=sync==0;}}
   halves+=cross;fields+=wraps;if(vsync)field=toggle ? field^(vsync&1) : 1;
  }
  device.service(101+tick);
  if(phase!=ep||line!=el||halves!=eh||fields!=ef||cross!=ec||wraps!=ew||vblank!=ev||vsync!=es||(run && line>=active)!=bool(ea)||field!=efi){std::cerr<<"sample "<<std::dec<<n<<':'<<tick<<'\n';return 1;}
  if(device.field()!=field||device.vblankActive()!=bool(ea)||(run&&device.currentHalfLine(101+tick)%T!=line)){std::cerr<<"runtime service "<<std::dec<<n<<':'<<tick<<'\n';return 1;}
 }
}std::cout<<"PASS "<<std::dec<<count<<" timing configurations vs actual TS/C++ PCRTC timing and sampled runtime service owners, physical phase and vertical landmarks\n";}
