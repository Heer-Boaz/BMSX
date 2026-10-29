// Replay the exact TS-produced samples/gains through the unchanged C++ mixer.
#include "common/endian.h"
#include "machine/devices/audio/output.h"
#include <array>
#include <iostream>
using namespace bmsx;
int main() {
    unsigned count; std::cin >> count;
    for (unsigned n=0;n<count;++n) {
        ApuOutputMixer mixer;
        ApuParameterRegisterWords regs{};
        regs[APU_PARAMETER_RATE_STEP_Q16_INDEX]=0x10000;
        std::array<std::array<u8,4>,16> samples{};
        for(unsigned slot=0;slot<16;++slot) {
            unsigned active,left,right,gain;
            std::cin >> std::dec >> active >> std::hex >> left >> right >> gain;
            writeLE16(samples[slot].data(),left);writeLE16(samples[slot].data()+2,right);
            regs[APU_PARAMETER_GAIN_Q12_INDEX]=gain;
            if(active) {
                ApuAudioSource source;
                source.sourceAddr=0x40000000+4*slot;source.sourceBytes=4;
                source.sampleRateHz=44100;source.channels=2;source.bitsPerSample=16;
                source.frameCount=1;source.dataOffset=0;source.dataBytes=4;
                ApuSourceByteView view{Span<const u8>(samples[slot].data(),4),0};
                mixer.playVoice(slot,source,view,regs);
            }
        }
        unsigned expected;std::cin >> std::hex >> expected;
        (void)mixer.renderMachineFrames(1,0);
        const u32 actual=mixer.outputRing.readFramePacked();
        if(actual!=expected) {
            std::cerr << "case " << std::dec << n << " TS " << std::hex << expected << " C++ " << actual << '\n';
            return 1;
        }
    }
    std::cout << "PASS " << std::dec << count << " TS/C++ mixer frames with exact same slot samples and full gain words\n";
}
