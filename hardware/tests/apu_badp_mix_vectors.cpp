// Replays the TS-created BADP sources through the unchanged C++ mixer.
#include "common/endian.h"
#include "machine/devices/audio/output.h"
#include <array>
#include <iostream>
#include <vector>
using namespace bmsx;
int main() {
 unsigned frames,voices,words,channels;std::cin>>frames>>voices>>words>>channels;
 std::vector<u8> bytes(words*4);
 for(unsigned n=0;n<words;++n){u32 word;std::cin>>std::hex>>word;writeLE32(bytes.data()+n*4,word);}
 ApuOutputMixer mixer;
 for(unsigned v=0;v<voices;++v) {
  ApuParameterRegisterWords regs{};regs[APU_PARAMETER_RATE_STEP_Q16_INDEX]=0x8000;
  regs[APU_PARAMETER_START_SAMPLE_INDEX]=1;
  static constexpr u32 gains[]={4096,2048,static_cast<u32>(-2048),1024,8192,static_cast<u32>(-4096),3333,777};
  regs[APU_PARAMETER_GAIN_Q12_INDEX]=gains[v%8];
  ApuAudioSource source;source.sourceAddr=0x40000000+v*128;source.sourceBytes=76+8*channels;
  source.sampleRateHz=44100;source.channels=channels;source.bitsPerSample=4;source.frameCount=8;
  source.dataOffset=72;source.dataBytes=4+8*channels;source.loopStartSample=1;source.loopEndSample=7;
  ApuSourceByteView view{Span<const u8>(bytes.data()+v*128,source.sourceBytes),0};mixer.playVoice(v,source,view,regs);
 }
 for(unsigned epoch=0;epoch<frames;++epoch) {
  for(unsigned v=0;v<voices;++v) {u32 frame,next,fraction,gain,reset;std::cin>>std::dec>>frame>>next>>fraction>>std::hex>>gain>>std::dec>>reset;}
  u32 expected;std::cin>>std::hex>>expected;(void)mixer.renderMachineFrames(1,epoch);
  u32 actual=mixer.outputRing.readFramePacked();
  if(actual!=expected){std::cerr<<"epoch "<<std::dec<<epoch<<" expected "<<std::hex<<expected<<" got "<<actual<<'\n';return 1;}
 }
 std::cout<<"PASS "<<std::dec<<frames<<" frames, "<<voices<<" voices, "<<channels<<" source channel(s) against TS and C++ production mixers\n";
}
