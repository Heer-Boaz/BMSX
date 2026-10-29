// Independently replay both pre- and post-publication frames in the C++ mixer.
#include "common/endian.h"
#include "machine/devices/audio/output.h"
#include <iostream>
#include <vector>
using namespace bmsx;
int main(){unsigned count;std::cin>>count;std::vector<u8> bytes(512);writeLE32(bytes.data()+64,0x000c0008);writeLE32(bytes.data()+68,0x00140064);writeLE32(bytes.data()+72,0x11111111);writeLE16(bytes.data()+400,1000);
 ApuParameterRegisterWords r{};r[APU_PARAMETER_GAIN_Q12_INDEX]=4096;ApuAudioSource a;a.sourceAddr=0x40000190;a.sourceBytes=4;a.sampleRateHz=44100;a.channels=1;a.bitsPerSample=16;a.frameCount=8;a.dataOffset=0;a.dataBytes=4;a.loopStartSample=0;a.loopEndSample=8;
 ApuAudioSource b=a;b.sourceAddr=0x40000000;b.sourceBytes=128;b.bitsPerSample=4;b.dataOffset=64;b.dataBytes=12;ApuOutputMixer m;ApuSourceByteView av{Span<const u8>(bytes.data()+400,4),0},bv{Span<const u8>(bytes.data(),128),0};m.playVoice(0,a,av,r);m.playVoice(1,b,bv,r);
 for(unsigned e=0;e<count;e++){if(e==1)writeLE16(bytes.data()+400,3000);u32 expected;std::cin>>std::hex>>expected;(void)m.renderMachineFrames(1,e);u32 got=m.outputRing.readFramePacked();if(got!=expected){std::cerr<<"frame "<<e<<" got "<<std::hex<<got<<" expected "<<expected<<'\n';return 1;}}
 std::cout<<"PASS "<<std::dec<<count<<" PCM publication/BADP mixed snapshots vs TS/C++\n";
}
