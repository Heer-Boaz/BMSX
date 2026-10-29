// Compare the TS vectors to the actual C++ phase resolver.
#include "machine/devices/audio/playback.h"
#include <iostream>
using namespace bmsx;
int main(){unsigned count;std::cin>>count;for(unsigned n=0;n<count;n++){
 u32 rate,hz,remainder;u64 whole;std::cin>>std::hex>>rate>>hz>>whole>>remainder;
 ApuPhaseStep out{};resolveApuPhaseStep(out,rate,hz);
 if(static_cast<u64>(out.wholeQ16)!=whole||static_cast<u32>(out.remainder)!=remainder){std::cerr<<"rate mismatch "<<n<<'\n';return 1;}
}std::cout<<"PASS "<<std::dec<<count<<" full-word rate products against actual TS/C++ resolvers\n";}
