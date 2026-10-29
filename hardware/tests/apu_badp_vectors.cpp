// Independently replay the TS-produced source image and stateful request stream
// through the unchanged C++ BADP decoder. No codec recurrence, seek algorithm,
// retained-frame cache, mixer or timing model is supplied by this probe.
#include "common/endian.h"
#include "machine/devices/audio/badp_decoder_hot_path.h"

#include <array>
#include <cassert>
#include <cstdlib>
#include <iostream>
#include <string>
#include <vector>

int main() {
    using namespace bmsx;
    struct Voice {
        const u8* data = nullptr;
        size_t frames = 0;
        u32 channels = 0;
        ApuBadpSeekTable seek;
        ApuBadpDecoderState decoder;
    };
    size_t scenarioCount;
    std::cin >> scenarioCount;
    size_t totalEvents = 0, totalOperands = 0, totalStates = 0;
    size_t totalResets = 0, totalReads = 0, totalPairs = 0, totalWrites = 0;
    std::cout << "{\"scope\":\"Actual unchanged C++ BADP decoder replay of TS-produced source bytes and stateful golden requests; no copied codec, mixer, cache or timing model\",\"runtime_owners_modified\":false,\"scenarios\":[";
    for (size_t scenario = 0; scenario < scenarioCount; ++scenario) {
        std::string id;
        size_t imageWords, voiceCount, eventCount;
        std::cin >> id >> imageWords >> voiceCount >> eventCount;
        std::vector<u8> image(imageWords * 4);
        for (size_t word = 0; word < imageWords; ++word) {
            u32 value;
            std::cin >> std::hex >> value;
            writeLE32(image.data() + word * 4, value);
        }
        std::cin >> std::dec;
        std::vector<Voice> voices(voiceCount);
        for (size_t descriptor = 0; descriptor < voiceCount; ++descriptor) {
            u32 voice, sourceBase, dataOffset, frames, channels, seekBase, seekCount, loopStart, loopEnd;
            std::cin >> voice >> sourceBase >> dataOffset >> frames >> channels
                >> seekBase >> seekCount >> loopStart >> loopEnd;
            Voice& target = voices[voice];
            target.data = image.data() + sourceBase + dataOffset;
            target.frames = frames;
            target.channels = channels;
            loadApuBadpSeekTable(target.seek, image.data(), sourceBase);
            assert(target.seek.byteOffset == seekBase && target.seek.entryCount == seekCount);
        }
        size_t operands = 0, resets = 0, reads = 0, pairs = 0, writes = 0;
        for (size_t event = 0; event < eventCount; ++event) {
            u32 op, voice, arg0, arg1, arg2, expectedCurrent, expectedNeighbor;
            i32 epoch;
            std::array<i64, 16> expected;
            std::cin >> op >> epoch >> voice >> arg0 >> arg1 >> arg2 >> expectedCurrent >> expectedNeighbor;
            for (i64& field : expected) std::cin >> field;
            assert(std::cin.good());
            Voice& target = voices[voice];
            switch (op) {
                case 0:
                    resetApuBadpDecoder(target.data, target.frames, target.channels, target.seek,
                        target.decoder, arg0);
                    ++resets;
                    break;
                case 1:
                case 2: {
                    i16 left, right;
                    readApuBadpFrameAt(target.data, target.frames, target.channels, target.seek,
                        target.decoder, arg0, left, right);
                    u32 sample = static_cast<u32>(static_cast<u16>(left))
                        | (static_cast<u32>(static_cast<u16>(right)) << 16);
                    if (sample != expectedCurrent) {
                        std::cerr << id << " event " << event << " epoch " << epoch
                            << " voice " << voice << " frame " << arg0 << " current operand mismatch\n";
                        std::abort();
                    }
                    ++operands;
                    if (op == 2 && arg1 != arg0) {
                        readApuBadpFrameAt(target.data, target.frames, target.channels, target.seek,
                            target.decoder, arg1, left, right);
                        sample = static_cast<u32>(static_cast<u16>(left))
                            | (static_cast<u32>(static_cast<u16>(right)) << 16);
                        if (sample != expectedNeighbor) {
                            std::cerr << id << " event " << event << " epoch " << epoch
                                << " voice " << voice << " frame " << arg1 << " neighbor operand mismatch\n";
                            std::abort();
                        }
                        ++operands;
                    } else if (op == 2) {
                        assert(sample == expectedNeighbor);
                    }
                    if (op == 1) ++reads;
                    else ++pairs;
                    break;
                }
                case 3:
                    // A committed source write changes bytes, not already
                    // loaded predictors/headers or the retained decoded pair.
                    for (u32 lane = 0; lane < 4; ++lane)
                        if ((arg1 & (1u << lane)) != 0)
                            image[arg0 + lane] = static_cast<u8>(arg2 >> (lane * 8));
                    ++writes;
                    break;
                default:
                    std::abort();
            }
            const ApuBadpDecoderState& state = target.decoder;
            const std::array<i64, 16> actual = {
                state.predictors[0], state.predictors[1], state.stepIndices[0], state.stepIndices[1],
                static_cast<i64>(state.nextFrame), static_cast<i64>(state.blockEnd),
                static_cast<i64>(state.blockFrames), static_cast<i64>(state.blockFrameIndex),
                static_cast<i64>(state.payloadOffset), static_cast<i64>(state.nibbleCursor),
                state.decodedFrame,
                static_cast<u32>(static_cast<u16>(state.decodedLeft))
                    | (static_cast<u32>(static_cast<u16>(state.decodedRight)) << 16),
                state.previousDecodedFrame,
                static_cast<u32>(static_cast<u16>(state.previousDecodedLeft))
                    | (static_cast<u32>(static_cast<u16>(state.previousDecodedRight)) << 16),
                state.decodedFrame >= 0 ? 1 : 0, state.previousDecodedFrame >= 0 ? 1 : 0,
            };
            for (size_t field = 0; field < actual.size(); ++field) {
                if (actual[field] != expected[field]) {
                    std::cerr << id << " event " << event << " epoch " << epoch
                        << " voice " << voice << " field " << field << " actual " << actual[field]
                        << " expected " << expected[field] << '\n';
                    std::abort();
                }
            }
            ++totalStates;
        }
        if (scenario != 0) std::cout << ',';
        std::cout << "{\"id\":\"" << id << "\",\"events\":" << eventCount
            << ",\"reset_requests\":" << resets << ",\"read_requests\":" << reads
            << ",\"pair_requests\":" << pairs << ",\"write_events\":" << writes
            << ",\"state_checks\":" << eventCount << ",\"operand_checks\":" << operands << '}';
        totalEvents += eventCount; totalOperands += operands;
        totalResets += resets; totalReads += reads; totalPairs += pairs; totalWrites += writes;
    }
    std::cout << "],\"scenario_count\":" << scenarioCount << ",\"event_count\":" << totalEvents
        << ",\"state_checks\":" << totalStates << ",\"operand_checks\":" << totalOperands
        << ",\"reset_requests\":" << totalResets << ",\"read_requests\":" << totalReads
        << ",\"pair_requests\":" << totalPairs << ",\"write_events\":" << totalWrites << "}\n";
}
