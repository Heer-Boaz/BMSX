// Compare every displayed word against the real C++ presentation owner.
#include "machine/devices/gx/gpu_pcrtc.h"
#include <iostream>
using namespace bmsx;
int main(){unsigned count;std::cin>>count;GxGpuPcrtc d;d.reset(0);d.setCpuHz(33868800,0);
 for(unsigned cycle=1;cycle<=count;cycle++){
  u32 valid,index,word,expectedPre,expectedPost,pre=0,post=0;
  std::cin>>std::hex>>valid>>index>>word>>expectedPre>>expectedPost;
  d.writeCsr(0x1f,cycle);
  if(d.nextDeadlineCycle()>=0 && d.nextDeadlineCycle()<=cycle && (d.service(cycle)&3)==1){pre=1;d.latchPresentationWords();}
  if(valid)d.writeConfigWord(index,word,cycle);
  if(d.nextDeadlineCycle()>=0 && d.nextDeadlineCycle()<=cycle && (d.service(cycle)&3)==1){post=1;d.latchPresentationWords();}
  if(pre!=expectedPre||post!=expectedPost){std::cerr<<"event mismatch cycle "<<std::dec<<cycle<<'\n';return 1;}
  for(unsigned i=0;i<22;i++){u32 expected;std::cin>>std::hex>>expected;if(d.presentWords()[i]!=expected){std::cerr<<"display word mismatch cycle "<<std::dec<<cycle<<" index "<<i<<'\n';return 1;}}
 }
 std::cout<<"PASS "<<std::dec<<count<<" pre/post write VBlank and 22-word presentation snapshots vs actual TS/C++ owners\n";
}
