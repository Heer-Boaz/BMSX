// Compare the TS-produced system-cycle trace with the real C++ PCRTC owner.
#include "machine/devices/gx/gpu_pcrtc.h"
#include <iostream>
using namespace bmsx;
int main(){unsigned count;std::cin>>count;GxGpuPcrtc d;d.reset(0);d.setCpuHz(33868800,0);auto words=GX_GPU_PCRTC_RESET_CONFIG_WORDS;
 for(unsigned cycle=1;cycle<=count;cycle++){
  u32 valid,index,word,restart,running,line,blank,field,read,expvblank,expvsync,phase;
  std::cin>>std::hex>>valid>>index>>word>>restart>>running>>line>>blank>>field>>read>>expvblank>>expvsync>>phase;
  d.writeCsr(0x1f,cycle);bool vblank=false;
  if(d.nextDeadlineCycle()>=0 && d.nextDeadlineCycle()<=cycle)vblank|=(d.service(cycle)&3)==1;
  bool actual_restart=false;if(valid){actual_restart=d.writeConfigWord(index,word,cycle);words[index]=word;}
  GxGpuPcrtcTiming t;t.update(words);
  if(d.nextDeadlineCycle()>=0 && d.nextDeadlineCycle()<=cycle)vblank|=(d.service(cycle)&3)==1;
  const u32 actual_line=t.running?d.currentHalfLine(cycle)%t.totalHalfLines:0;
  if(actual_restart!=bool(restart)||t.running!=bool(running)||actual_line!=line||d.vblankActive()!=bool(blank)||d.field()!=field||d.readRegisterWord(index)!=read||vblank!=bool(expvblank)||((d.readCsr()>>3)&1)!=bool(expvsync)){
   std::cerr<<"runtime mismatch at system cycle "<<std::dec<<cycle<<'\n';return 1;
  }
 }
 std::cout<<"PASS "<<std::dec<<count<<" system-cycle programmed-write/beam states against actual TS/C++ PCRTC owners\n";
}
