#pragma once

#include "machine/devices/gx/device_output.h"
#include "machine/cpu/cpu.h"
#include "machine/memory/memory.h"
#include "machine/devices/irq/controller.h"
#include "machine/scheduler/device.h"
#include "spec/bmsx/model.h"
#include "cartridge_fixture.h"

namespace bmsx::test {

// Real device-output owners, with disabled display circuits and a fixed background.
struct GpuOutputFixture {
	std::array<u8, 1> rom{};
	Memory memory{MemoryInit{{rom.data(), 0u}, cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes};
	IrqController irq{memory};
	ExecutionAddressSpace addressSpace{memory};
	CPU cpu{memory, irq, addressSpace};
	DeviceScheduler scheduler{cpu};
	DmaController dma{memory, cpu, irq, scheduler};
	GxGpuCommandBuffer commands{dma};
	GxGpuReadbackPort readback{dma};
	std::array<u32, GX_GPU_PCRTC_CONFIG_WORD_COUNT> words{};
	GxGpuPcrtcTiming timing{};
	GxGpuPcrtcScanout scanout{};
	std::vector<u8> vram = std::vector<u8>(PSX_MACHINE_SPEC.gxGpuVramBytes);
	GxGpuDeviceOutput output{commands, readback, words, timing, scanout, vram};
};

} // namespace bmsx::test
