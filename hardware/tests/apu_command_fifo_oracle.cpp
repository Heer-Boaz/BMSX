// FIFO order and 21-word snapshot oracle from the actual C++ owner.
#include "machine/devices/audio/command_fifo.h"
#include <iomanip>
#include <iostream>
using namespace bmsx;
int main() {
 ApuCommandFifo q;ApuParameterRegisterWords words{},out{};
 const auto emit=[&](){if(q.popInto(out)!=1u) return false;std::cout<<std::hex<<std::setfill('0')<<std::setw(8)<<out[0]<<'\n';return true;};
 for(u32 i=0;i<APU_PARAMETER_REGISTER_COUNT;i++) words[i]=0xa0000000u+i;
 q.enqueue(1,words);words.fill(0);
 if(q.count()!=1)return 1;
 const auto state=q.captureState();
 for(u32 i=0;i<APU_PARAMETER_REGISTER_COUNT;i++)if(state.registerWords[i]!=0xa0000000u+i)return 1;
 if(!emit())return 1;
 for(u32 i=0;i<17;i++){words[0]=i;q.enqueue(1,words);}
 if(q.count()!=16)return 1;
 for(u32 i=1;i<=16;i++)if(!emit())return 1;
 for(u32 i=0;i<16;i++){words[0]=100+i;q.enqueue(1,words);}
 if(!emit())return 1;
 words[0]=200;q.enqueue(1,words);
 for(u32 i=101;i<=115;i++)if(!emit())return 1;
 if(!emit() || !q.empty())return 1;
}
