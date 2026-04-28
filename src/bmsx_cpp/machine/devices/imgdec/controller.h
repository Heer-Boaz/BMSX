#pragma once

#include "core/taskgate.h"
#include "machine/devices/dma/image_copy.h"
#include "machine/memory/memory.h"
#include "machine/scheduler/device.h"
#include <cstdint>
#include <exception>
#include <deque>
#include <functional>
#include <optional>
#include <vector>

namespace bmsx {

class DmaController;
class IrqController;
class MicrotaskQueue;

class ImgDecController {
public:
	ImgDecController(
		Memory& memory,
		DmaController& dma,
		IrqController& irq,
		DeviceScheduler& scheduler,
		MicrotaskQueue& microtasks
	);

	void setTiming(int64_t cpuHz, int64_t decodeBytesPerSec, int64_t nowCycles);
	void accrueCycles(int cycles, int64_t nowCycles);
	void onCtrlWrite(int64_t nowCycles);
	void onService(int64_t nowCycles);
	bool hasPendingDecodeWork() const;
	uint32_t getPendingDecodeBytes() const;
	void reset();
	void decodeToVram(std::vector<uint8_t>&& buffer,
		uint32_t dst,
		uint32_t cap,
		std::function<void(uint32_t width, uint32_t height, bool clipped)> onComplete = {},
		std::function<void(std::exception_ptr)> onError = {});

	private:
		static void onCtrlWriteThunk(void* context, uint32_t addr, Value value);

	struct DecodedImage {
		std::vector<uint8_t> pixels;
		uint32_t width = 0;
		uint32_t height = 0;
	};
	struct ImageDecodeTarget {
		uint32_t baseAddr = 0;
		uint32_t capacity = 0;
	};
	struct ImgDecJob {
		std::vector<uint8_t> buffer;
		uint32_t dst = 0;
		uint32_t cap = 0;
		std::function<void(uint32_t width, uint32_t height, bool clipped)> resolve;
		std::function<void(std::exception_ptr)> reject;
	};

	static ImageCopyPlan planImageCopy(const ImageDecodeTarget& target, const DecodedImage& result, uint32_t capacityLimit);
	void tryStartQueued();
	void startJob(std::vector<uint8_t>&& buffer, uint32_t dst, uint32_t cap, uint32_t src, uint32_t len, std::optional<ImgDecJob> job, bool signalIrq);
	ImageDecodeTarget resolveDecodeTarget(uint32_t dst);
	void beginDecode(DecodedImage&& result, const ImageDecodeTarget& target);
	void advanceDecode();
	void finishSuccess(bool clipped);
	void finishError(std::exception_ptr error = nullptr);
	void scheduleNextService(int64_t nowCycles);

	GateGroup m_gate;
	GateToken m_gateToken;
	int64_t m_cpuHz = 1;
	int64_t m_decodeBytesPerSec = 1;
	int64_t m_decodeCarry = 0;
	uint32_t m_availableDecodeBytes = 0;
	bool m_active = false;
	uint32_t m_status = 0;
	std::exception_ptr m_pendingError;
	std::optional<DecodedImage> m_pendingResult;
	std::optional<ImageDecodeTarget> m_pendingTarget;
	uint32_t m_pendingCap = 0;
	bool m_decodeActive = false;
	size_t m_decodeRemaining = 0;
	ImageCopyPlan m_decodePlan;
	std::vector<uint8_t> m_decodePixels;
	uint32_t m_decodeWidth = 0;
	uint32_t m_decodeHeight = 0;
	bool m_decodeQueued = false;
	uint64_t m_decodeToken = 0;
	std::deque<ImgDecJob> m_queuedJobs;
	std::optional<ImgDecJob> m_activeJob;
	bool m_signalIrq = false;
	Memory& m_memory;
	DmaController& m_dma;
	IrqController& m_irq;
	DeviceScheduler& m_scheduler;
	MicrotaskQueue& m_microtasks;
};

} // namespace bmsx
