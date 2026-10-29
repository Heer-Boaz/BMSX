// Replay the TypeScript fixture producer's plain numeric test stream through
// the actual C++ mixer/PCM/BADP/phase owners. No second fixture encoder, format
// decoder, sample interpolator or playback-cursor implementation is supplied.
#include "common/endian.h"
#include "machine/devices/audio/output.h"

#include <cassert>
#include <iostream>
#include <string>
#include <vector>

int main() {
    using namespace bmsx;
    size_t caseCount, outputFrames;
    std::cin >> caseCount >> outputFrames;
    std::cout << "{\"scope\":\"Actual C++ ApuOutputMixer replay of the identical TS-produced fixture bytes\",\"scenarios\":[";
    for (size_t entry = 0; entry < caseCount; ++entry) {
        std::string id;
        u32 bits, channels, hz, rate, start, loopStart, loopEnd, offset, voices, dataOffset, byteCount, sourceFrames;
        i32 mutateFrame, rateChangeFrame;
        u32 rateChangeWord;
        std::cin >> id >> bits >> channels >> hz >> rate >> start >> loopStart >> loopEnd
                 >> offset >> voices >> mutateFrame >> rateChangeFrame >> rateChangeWord >> dataOffset >> byteCount >> sourceFrames;
        std::vector<u8> original(byteCount);
        for (u8& byte : original) { u32 value; std::cin >> value; byte = static_cast<u8>(value); }
        assert(std::cin.good());
        ApuOutputMixer mixer;
        ApuParameterRegisterWords registers{};
        registers[APU_PARAMETER_RATE_STEP_Q16_INDEX] = rate;
        registers[APU_PARAMETER_GAIN_Q12_INDEX] = APU_GAIN_Q12_ONE / voices;
        registers[APU_PARAMETER_START_SAMPLE_INDEX] = start;
        ApuAudioSource source;
        source.sourceAddr = 0x40000000u + offset;
        source.sourceBytes = byteCount - offset;
        source.sampleRateHz = hz;
        source.channels = channels;
        source.bitsPerSample = bits;
        source.frameCount = sourceFrames;
        source.dataOffset = dataOffset;
        source.dataBytes = byteCount - offset - dataOffset;
        source.loopStartSample = loopStart;
        source.loopEndSample = loopEnd;
        std::vector<std::vector<u8>> buffers(voices, original);
        for (u32 voice = 0; voice < voices; ++voice) {
            const ApuSourceByteView view{Span<const u8>(buffers[voice].data() + offset, byteCount - offset), 0u};
            source.sourceAddr = 0x40000000u + offset + voice * ((byteCount + 3u) & ~3u);
            mixer.playVoice(voice, source, view, registers);
        }
        u32 checksum = 0x811c9dc5u, endedMask = 0;
        for (size_t frame = 0; frame < outputFrames; ++frame) {
            if (static_cast<i64>(frame) == rateChangeFrame) {
                registers[APU_PARAMETER_RATE_STEP_Q16_INDEX] = rateChangeWord;
                for (u32 voice = 0; voice < voices; ++voice)
                    mixer.writeSlotRegisterWord(voice, source, registers, APU_PARAMETER_RATE_STEP_Q16_INDEX);
            }
            if (static_cast<i64>(frame) == mutateFrame) {
                for (auto& bytes : buffers) {
                    const size_t address = offset + dataOffset + (bits == 4u ? 4u + channels * 4u : 0u);
                    writeLE16(bytes.data() + address, 0x2abcu);
                }
            }
            endedMask |= mixer.renderMachineFrames(1, static_cast<i64>(frame));
            checksum = (checksum ^ mixer.outputRing.readFramePacked()) * 0x01000193u;
        }
        assert(endedMask == 0);
        if (entry != 0) std::cout << ',';
        std::cout << "{\"id\":\"" << id << "\",\"checksum32\":" << checksum
                  << ",\"ended_mask\":" << endedMask << '}';
    }
    std::cout << "]}\n";
}
