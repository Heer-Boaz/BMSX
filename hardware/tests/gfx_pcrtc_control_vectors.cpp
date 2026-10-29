// Independent parity against actual C++ PCRTC owner for the TS-produced trace.
#include "machine/devices/gx/gpu_pcrtc.h"
#include <iostream>
using namespace bmsx;
int main(){unsigned count;std::cin>>count;GxGpuPcrtc d;d.reset(0);d.setCpuHz(33868800,0);
 for(unsigned cycle=1;cycle<=count;cycle++){
  u32 valid,index,word,csr,imr,expectedIrq,line,irq=0;std::cin>>std::hex>>valid>>index>>word>>csr>>imr>>expectedIrq>>line;
  if(d.nextDeadlineCycle()>=0 && d.nextDeadlineCycle()<=cycle)irq|=(d.service(cycle)&4)?1:0;
  if(valid){if(index<22)d.writeConfigWord(index,word,cycle);else if(index==22){auto action=d.writeCsr(word,cycle);if(action&0x200)d.reset(cycle);}else if(index==24 && d.writeImr(word))irq=1;}
  if(d.nextDeadlineCycle()>=0 && d.nextDeadlineCycle()<=cycle)irq|=(d.service(cycle)&4)?1:0;
  GxGpuPcrtcTiming timing;auto words=GX_GPU_PCRTC_RESET_CONFIG_WORDS;
  for(u32 i=0;i<22;i++)words[i]=d.readRegisterWord(i);timing.update(words);
  const u32 actualLine=timing.running?d.currentHalfLine(cycle)%timing.totalHalfLines:0;
  if(d.readCsr()!=csr || d.readImr()!=imr || irq!=expectedIrq || line!=actualLine){std::cerr<<"status/IRQ/line mismatch at cycle "<<std::dec<<cycle<<'\n';return 1;}
 }
 std::cout<<"PASS "<<std::dec<<count<<" PCRTC CSR/IMR/IRQ cycles against actual TS/C++ owners\n";
}
