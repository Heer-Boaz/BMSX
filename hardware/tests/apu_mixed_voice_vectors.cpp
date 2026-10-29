// Replay the identical mixed PCM/BADP sources through the actual C++ mixer.
#include "common/endian.h"
#include "machine/devices/audio/output.h"
#include <iostream>
#include <vector>
using namespace bmsx;
int main(){unsigned frames,voices,words;std::cin>>frames>>voices>>words;std::vector<u8> bytes(words*4);
 for(unsigned i=0;i<words;i++){u32 x;std::cin>>std::hex>>x;writeLE32(bytes.data()+i*4,x);}ApuOutputMixer mixer;
 const u32 bits[]={8,8,16,16,4,4},channels[]={1,2,1,2,1,2},offs[]={3,3,3,3,72,72},gains[]={4096,2048,static_cast<u32>(-2048),3333,1024,static_cast<u32>(-4096)};
 for(unsigned v=0;v<voices;v++){ApuParameterRegisterWords r{};r[APU_PARAMETER_RATE_STEP_Q16_INDEX]=0x8000;r[APU_PARAMETER_START_SAMPLE_INDEX]=1;
  r[APU_PARAMETER_GAIN_Q12_INDEX]=gains[v];r[APU_PARAMETER_FILTER_CONTROL_INDEX]=v==1?0:1;r[APU_PARAMETER_FILTER_B0_B1_INDEX]=0x20002000;
  ApuAudioSource s;s.sourceAddr=0x40000000+v*128;s.sourceBytes=128;s.sampleRateHz=44100;s.channels=channels[v];s.bitsPerSample=bits[v];s.frameCount=8;s.dataOffset=offs[v];s.dataBytes=64;s.loopStartSample=1;s.loopEndSample=7;
  ApuSourceByteView view{Span<const u8>(bytes.data()+v*128,128),0};mixer.playVoice(v,s,view,r);}
 for(unsigned e=0;e<frames;e++){for(unsigned v=0;v<voices;v++){u32 a,b,c,g;std::cin>>std::dec>>a>>b>>c>>std::hex>>g;}u32 expected;std::cin>>std::hex>>expected;(void)mixer.renderMachineFrames(1,e);auto got=mixer.outputRing.readFramePacked();if(got!=expected){std::cerr<<"frame "<<std::dec<<e<<" got "<<std::hex<<got<<" expected "<<expected<<'\n';return 1;}}
 std::cout<<"PASS "<<std::dec<<frames<<" mixed PCM8/PCM16 and BADP mono/stereo frames vs TS/C++ mixers\n";
}
