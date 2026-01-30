#pragma once

#include "../memory.h"

#include <cstdint>
#include <deque>
#include <functional>
#include <vector>

namespace bmsx {

class DmaController {
public:
	enum class Channel : uint8_t {
		Iso = 0,
		Bulk = 1,
	};

	DmaController(Memory& memory, std::function<void(uint32_t)> raiseIrq);

	void tick();
	void setChannelBudgets(uint32_t isoBytesPerTick, uint32_t bulkBytesPerTick);
	void enqueueImageCopy(const Memory::ImageWritePlan& plan, std::vector<uint8_t>&& pixels, std::function<void(bool error, bool clipped)> onComplete);
	void reset();

private:
	struct DmaJob {
		enum class Kind : uint8_t { Io, Image };
		Kind kind = Kind::Io;
		Channel channel = Channel::Bulk;
		uint32_t written = 0;
		bool clipped = false;
		bool error = false;

		uint32_t src = 0;
		uint32_t dst = 0;
		uint32_t remaining = 0;
		bool strict = false;

		Memory::ImageWritePlan plan;
		std::vector<uint8_t> pixels;
		uint32_t row = 0;
		uint32_t rowOffset = 0;
		bool vramTarget = false;
		std::function<void(bool error, bool clipped)> onComplete;
	};

	struct DmaChannelState {
		uint32_t budget = 0;
		std::deque<DmaJob> queue;
		bool hasActive = false;
		DmaJob active;
	};

	void tryStartIo();
	void tickChannel(Channel channel, bool& ioWrittenDirty, bool& imgWrittenDirty);
	uint32_t processJob(DmaJob& job, uint32_t budget);
	uint32_t processImageJob(DmaJob& job, uint32_t budget);
	bool isJobComplete(const DmaJob& job) const;
	void finishJob(DmaJob& job);
	void finishIoJob(DmaJob& job);
	void finishIoSuccess(bool clipped);
	void finishIoError(bool clipped);
	uint32_t resolveMaxWritable(uint32_t dst) const;

	DmaChannelState m_channels[2];
	bool m_ioJobActive = false;
	uint32_t m_ioWrittenValue = 0;
	uint32_t m_imgWrittenValue = 0;
	Memory& m_memory;
	std::function<void(uint32_t)> m_raiseIrq;
	std::vector<uint8_t> m_buffer;
};

} // namespace bmsx
