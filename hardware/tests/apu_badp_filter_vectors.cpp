// Replay the same source images and filter changes through the real C++ mixer.
#include "common/endian.h"
#include "machine/devices/audio/output.h"
#include <array>
#include <iostream>
#include <vector>
using namespace bmsx;
int main(){
 unsigned frames,voices,words,channels;std::cin>>frames>>voices>>words>>channels;
 std::vector<u8> bytes(words*4);for(unsigned n=0;n<words;n++){u32 w;std::cin>>std::hex>>w;writeLE32(bytes.data()+n*4,w);}
 ApuOutputMixer mixer;std::array<ApuParameterRegisterWords,16> regs{};std::array<ApuAudioSource,16> sources{};
 for(unsigned v=0;v<voices;v++){
  auto&r=regs[v];r[APU_PARAMETER_RATE_STEP_Q16_INDEX]=0x8000;r[APU_PARAMETER_START_SAMPLE_INDEX]=1;
  auto&s=sources[v];s.sourceAddr=0x40000000+v*128;s.sourceBytes=76+8*channels;s.sampleRateHz=44100;
  s.channels=channels;s.bitsPerSample=4;s.frameCount=8;s.dataOffset=72;s.dataBytes=4+8*channels;s.loopStartSample=1;s.loopEndSample=7;
 }
 for(unsigned epoch=0;epoch<frames;epoch++){
  for(unsigned v=0;v<voices;v++){
   u32 frame,next,fraction,gain,reset,control,b01,b2a1,a2,clear;
   std::cin>>std::dec>>frame>>next>>fraction>>std::hex>>gain>>std::dec>>reset>>std::hex>>control>>b01>>b2a1>>a2>>std::dec>>clear;
   auto&r=regs[v];r[APU_PARAMETER_GAIN_Q12_INDEX]=gain;r[APU_PARAMETER_FILTER_CONTROL_INDEX]=control;r[APU_PARAMETER_FILTER_B0_B1_INDEX]=b01;r[APU_PARAMETER_FILTER_B2_A1_INDEX]=b2a1;r[APU_PARAMETER_FILTER_A2_INDEX]=a2;
   if(clear){ApuSourceByteView view{Span<const u8>(bytes.data()+v*128,sources[v].sourceBytes),0};mixer.playVoice(v,sources[v],view,r);}
   else if(reset){r[APU_PARAMETER_START_SAMPLE_INDEX]=3;mixer.writeSlotRegisterWord(v,sources[v],r,APU_PARAMETER_START_SAMPLE_INDEX);}
   mixer.writeSlotRegisterWord(v,sources[v],r,APU_PARAMETER_FILTER_CONTROL_INDEX);
  }
  u32 expected;std::cin>>std::hex>>expected;(void)mixer.renderMachineFrames(1,epoch);u32 actual=mixer.outputRing.readFramePacked();
  if(actual!=expected){std::cerr<<"epoch "<<std::dec<<epoch<<" expected "<<std::hex<<expected<<" got "<<actual<<'\n';return 1;}
 }
 std::cout<<"PASS "<<std::dec<<frames<<" filtered BADP frames from actual TS and C++ APU mixers\n";
}
