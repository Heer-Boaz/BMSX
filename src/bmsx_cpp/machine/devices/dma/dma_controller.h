#pragma once

#include "machine/memory/memory.h"
#include "machine/scheduler/device_scheduler.h"

#include <cstdint>
#include <deque>
#include <exception>
#include <functional>
#include <vector>

namespace bmsx {

class IrqController;
class VDP;

class DmaController {
public:
	enum class Channel : uint8_t {
		Iso = 0,
		Bulk = 1,
	};

		DmaController(
				Memory& memory,
				IrqController& irq,
				VDP& vdp,
				DeviceScheduler& scheduler
	);

	void setTiming(int64_t cpuHz, int64_t isoBytesPerSec, int64_t bulkBytesPerSec, int64_t nowCycles);
	void accrueCycles(int cycles, int64_t nowCycles);
	void onService(int64_t nowCycles);
	void tryStartIo();
	bool hasPendingVdpSubmit() const;
	bool hasPendingIsoTransfer() const;
	bool hasPendingBulkTransfer() const;
	uint32_t pendingIsoBytes() const;
	uint32_t pendingBulkBytes() const;
	void enqueueImageCopy(const Memory::ImageWritePlan& plan, std::vector<uint8_t>&& pixels, std::function<void(bool error, bool clipped, std::exception_ptr fault)> onComplete);
	void reset();

	private:
		static void onCtrlWriteThunk(void* context, uint32_t addr, Value value);

		struct DmaJob {
		enum class Kind : uint8_t { Io, Image };
		Kind kind = Kind::Io;
		Channel channel = Channel::Bulk;
		uint32_t written = 0;
		bool clipped = false;
		bool error = false;
		std::exception_ptr fault = nullptr;

			uint32_t src = 0;
			uint32_t dst = 0;
			uint32_t remaining = 0;
			bool strict = false;

			Memory::ImageWritePlan plan;
			std::vector<uint8_t> pixels;
		uint32_t row = 0;
		uint32_t rowOffset = 0;
		bool vramTarget = false;
		std::function<void(bool error, bool clipped, std::exception_ptr fault)> onComplete;
	};

	struct DmaChannelState {
		uint32_t budget = 0;
		std::deque<DmaJob> queue;
		bool hasActive = false;
		DmaJob active;
	};

	void accrueChannel(Channel channel, int64_t bytesPerSec, int64_t& carry, int cycles);
	void scheduleNextService(int64_t nowCycles);
	int64_t cyclesUntilBytes(int64_t bytesPerSec, int64_t carry, uint32_t targetBytes) const;
	void tickChannel(Channel channel, bool& ioWrittenDirty, bool& imgWrittenDirty);
	uint32_t processJob(DmaJob& job, uint32_t budget);
	uint32_t processImageJob(DmaJob& job, uint32_t budget);
	bool isJobComplete(const DmaJob& job) const;
	void finishJob(DmaJob& job);
	void finishIoJob(DmaJob& job);
	void finishIoSuccess(bool clipped);
	void finishIoError(bool clipped);
	void finishIoRejected();
	uint32_t resolveMaxWritable(uint32_t dst) const;
	uint32_t pendingBytesForChannel(Channel channel) const;

	DmaChannelState m_channels[2];
	int64_t m_cpuHz = 1;
	int64_t m_isoBytesPerSec = 1;
	int64_t m_bulkBytesPerSec = 1;
	int64_t m_isoCarry = 0;
	int64_t m_bulkCarry = 0;
	uint32_t m_ioWrittenValue = 0;
	uint32_t m_imgWrittenValue = 0;
			Memory& m_memory;
			VDP& m_vdp;
			IrqController& m_irq;
			DeviceScheduler& m_scheduler;
	std::vector<uint8_t> m_buffer;
};

} // namespace bmsx
