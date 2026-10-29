// Run the same words through the actual C++ IMGDEC and scheduler owners.
#include "machine/cpu/cpu.h"
#include "machine/devices/dma/controller.h"
#include "machine/devices/imgdec/controller.h"
#include "machine/devices/irq/controller.h"
#include "machine/memory/memory.h"
#include "machine/scheduler/device.h"
#include "spec/bmsx/io.h"
#include "spec/bmsx/model.h"
#include "spec/imgdec/registers.h"
#include "spec/imgdec/stream.h"
#include <cstdio>
#include <cstring>
#include <fstream>
#include <limits>
#include <stdexcept>
#include <vector>

int main(int argc, char** argv) {
    const bool packet = argc > 1 && std::strcmp(argv[1], "--packet") == 0;
    std::ifstream source("tests/imgdec_payload_vectors.hex");
    std::vector<bmsx::u32> input;
    bmsx::u32 word;
    while (source >> std::hex >> word) input.push_back(word);
    bmsx::Memory memory(bmsx::MemoryInit{{}, {}}, bmsx::PSX_MACHINE_SPEC.ramBytes);
    bmsx::IrqController irq(memory);
    bmsx::ExecutionAddressSpace execution(memory);
    bmsx::CPU cpu(memory, irq, execution);
    bmsx::DeviceScheduler scheduler(cpu);
    bmsx::DmaController dma(memory, cpu, irq, scheduler);
    bmsx::ImgDecController imgdec(memory, cpu, irq, scheduler, dma,
        bmsx::PSX_MACHINE_SPEC.imgDecCyclesPerOutputWord);
    dma.reset(); imgdec.reset(); irq.reset();
    memory.writeMappedU32LE(bmsx::IO_IMGDEC_INPUT_WORD_COUNT, static_cast<bmsx::u32>(input.size() + 3));
    if (packet) {
        memory.writeMappedU32LE(bmsx::IO_IMGDEC_TEXTURE_DESTINATION, 0xfedc1234);
        memory.writeMappedU32LE(bmsx::IO_IMGDEC_TEXTURE_SIZE, 0x12345678);
        memory.writeMappedU32LE(bmsx::IO_IMGDEC_CLUT_DESTINATION, 0x8080abcd);
    }
    memory.writeMappedU32LE(bmsx::IO_IMGDEC_CONTROL, bmsx::IMGDEC_CONTROL_START);
    memory.writeMappedU32LE(bmsx::IO_IMGDEC_DATA, bmsx::IMGDEC_STREAM_MAGIC);
    memory.writeMappedU32LE(bmsx::IO_IMGDEC_DATA, packet ? 3 : 23);
    memory.writeMappedU32LE(bmsx::IO_IMGDEC_DATA, packet ? 20 : 0);
    for (auto item : input) memory.writeMappedU32LE(bmsx::IO_IMGDEC_DATA, item);
    while (imgdec.captureState().decodedWordCount != 23) {
        auto deadline = scheduler.nextDeadline();
        if (deadline == std::numeric_limits<bmsx::i64>::max())
            throw std::runtime_error("IMGDEC did not schedule payload output");
        scheduler.advanceTo(deadline);
        while (scheduler.hasDueTimer()) {
            if (scheduler.popDueTimer() != bmsx::DEVICE_SERVICE_IMGDEC)
                throw std::runtime_error("unexpected scheduled device");
            imgdec.onService(deadline);
        }
    }
    auto state = imgdec.captureState();
    if (state.outputWords.size() != (packet ? 29u : 26u)) throw std::runtime_error("IMGDEC output word count");
    for (size_t i = packet ? 0 : 3; i < state.outputWords.size(); ++i) std::printf("%08x\n", state.outputWords[i]);
}
