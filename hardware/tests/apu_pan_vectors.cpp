// Re-evaluate the proposed packed Q2.14 per-channel factors using the real
// C++ low/high-word and signed-shift owners. Unity cases also run the existing
// production APU mixer, whose current public gain contract remains unchanged.
#include "common/endian.h"
#include "machine/common/numeric.h"
#include "machine/devices/audio/output.h"
#include <algorithm>
#include <array>
#include <iostream>
using namespace bmsx;
int main() {
    unsigned count;std::cin>>count;
    for(unsigned n=0;n<count;++n) {
        unsigned legacy;std::cin>>std::dec>>legacy;
        ApuOutputMixer mixer;
        ApuParameterRegisterWords regs{};regs[APU_PARAMETER_RATE_STEP_Q16_INDEX]=0x10000;
        std::array<std::array<u8,4>,16> samples{};
        i64 sumLeft=0,sumRight=0;
        for(unsigned slot=0;slot<16;++slot) {
            u32 active,left,right,gain,levels;
            std::cin>>std::dec>>active>>std::hex>>left>>right>>gain>>levels;
            if(active) {
                const i64 master=toSignedWord(gain);
                const i64 gainLeft=shiftRightSigned(master*lowSignedHalfword(levels),14);
                const i64 gainRight=shiftRightSigned(master*highSignedHalfword(levels),14);
                sumLeft+=lowSignedHalfword(left)*gainLeft;
                sumRight+=lowSignedHalfword(right)*gainRight;
                if(legacy) {
                    writeLE16(samples[slot].data(),left);writeLE16(samples[slot].data()+2,right);
                    regs[APU_PARAMETER_GAIN_Q12_INDEX]=gain;
                    ApuAudioSource source;
                    source.sourceAddr=0x40000000+slot*4;source.sourceBytes=4;
                    source.sampleRateHz=44100;source.channels=2;source.bitsPerSample=16;
                    source.frameCount=1;source.dataOffset=0;source.dataBytes=4;
                    ApuSourceByteView view{Span<const u8>(samples[slot].data(),4),0};
                    mixer.playVoice(slot,source,view,regs);
                }
            }
        }
        u32 expected;std::cin>>std::hex>>expected;
        const i64 outLeft=std::clamp(shiftRightSigned(sumLeft,12),i64(-32768),i64(32767));
        const i64 outRight=std::clamp(shiftRightSigned(sumRight,12),i64(-32768),i64(32767));
        const u32 actual=static_cast<u16>(outLeft)|(static_cast<u32>(static_cast<u16>(outRight))<<16);
        if(actual!=expected) {
            std::cerr<<"candidate case "<<std::dec<<n<<" TS "<<std::hex<<expected<<" C++ "<<actual<<'\n';return 1;
        }
        if(legacy) {
            (void)mixer.renderMachineFrames(1,0);
            const u32 original=mixer.outputRing.readFramePacked();
            if(original!=expected) {
                std::cerr<<"unity case "<<std::dec<<n<<" TS "<<std::hex<<expected<<" C++ mixer "<<original<<'\n';return 1;
            }
        }
    }
    std::cout<<"PASS "<<std::dec<<count<<" proposed L/R-gain golden frames in TS and C++, including legacy unity mixer parity\n";
}
