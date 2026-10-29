// Cross-check generated vectors against actual C++ mixer and phase resolver.
#include "machine/devices/audio/output.h"
#include "machine/devices/audio/playback.h"
#include <iostream>
using namespace bmsx;
int main(){unsigned cases,frames;std::cin>>cases>>frames;
 for(unsigned c=0;c<cases;c++){
  u32 start,count,lo,hi,rate,hz,rem;u64 whole;
  std::cin>>std::hex>>start>>count>>lo>>hi>>rate>>hz>>whole>>rem;
  ApuPhaseStep phase{};resolveApuPhaseStep(phase,rate,hz);
  if(static_cast<u64>(phase.wholeQ16)!=whole||static_cast<u32>(phase.remainder)!=rem){std::cerr<<"rate mismatch "<<c;return 1;}
  ApuOutputMixer mixer;ApuParameterRegisterWords regs{};regs[APU_PARAMETER_START_SAMPLE_INDEX]=start;regs[APU_PARAMETER_RATE_STEP_Q16_INDEX]=rate;regs[APU_PARAMETER_GAIN_Q12_INDEX]=4096;
  ApuAudioSource source{};source.sampleRateHz=hz;source.channels=1;source.bitsPerSample=16;source.frameCount=count;source.loopStartSample=lo;source.loopEndSample=hi;source.generatorKind=1;source.generatorDutyQ12=2048;
  ApuSourceByteView view{};mixer.playVoice(0,source,view,regs);
  for(unsigned f=0;f<frames;f++){
   u32 was,active,ended,cur,next,frac,remainder,packed;u64 cursor;
   std::cin>>std::hex>>was>>active>>ended>>cur>>next>>frac>>cursor>>remainder>>packed;
   auto before=mixer.captureState();if((!before.voices.empty())!=bool(was)){std::cerr<<"active before mismatch "<<c<<':'<<f;return 1;}
   auto e=mixer.renderMachineFrames(1,f);auto got=mixer.outputRing.readFramePacked();auto after=mixer.captureState();
   if((e&1)!=ended||got!=packed||(!after.voices.empty() && (static_cast<u64>(after.voices[0].cursorQ16)!=cursor || static_cast<u32>(after.voices[0].phaseRemainder)!=remainder))){std::cerr<<"output/state mismatch "<<c<<':'<<f;return 1;}
  }
 }
 std::cout<<"PASS "<<std::dec<<cases<<" x "<<frames<<" actual TS/C++ mixer cursor and square outputs\n";
}
