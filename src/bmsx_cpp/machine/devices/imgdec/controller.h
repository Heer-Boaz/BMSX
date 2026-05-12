#pragma once

#include "machine/devices/dma/image_copy.h"
#include "machine/memory/memory.h"
#include "machine/scheduler/device.h"
#include <cstdint>
#include <exception>
#include <functional>
#include <optional>
#include <vector>

namespace bmsx {

class DmaController;
class IrqController;
class MicrotaskQueue;
class VDP;

class ImgDecController {
public:
	ImgDecController(
		Memory& memory,
		DmaController& dma,
		VDP& vdp,
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
	struct ImgDecJob {
		std::vector<uint8_t> buffer;
		uint32_t dst = 0;
		uint32_t cap = 0;
		std::function<void(uint32_t width, uint32_t height, bool clipped)> resolve;
		std::function<void(std::exception_ptr)> reject;
	};

	static ImageCopyPlan planImageCopy(uint32_t targetBaseAddr, uint32_t targetCapacity, const DecodedImage& result, uint32_t capacityLimit);
	bool startNextQueuedJob();
	void startJob(std::vector<uint8_t>&& buffer, uint32_t dst, uint32_t cap, uint32_t src, uint32_t len, bool signalIrq);
	void writeJobRegisters(uint32_t status, uint32_t written, uint32_t src, uint32_t len, uint32_t dst, uint32_t cap);
	uint32_t decodeTargetCapacity(uint32_t dst) const;
	void beginDecode(DecodedImage&& result, uint32_t targetBaseAddr, uint32_t targetCapacity);
	void advanceDecode();
	void finishSuccess(bool clipped);
	void finishError(std::exception_ptr error);
	void scheduleNextService(int64_t nowCycles);

	int64_t m_cpuHz = 1;
	int64_t m_decodeBytesPerSec = 1;
	int64_t m_decodeCarry = 0;
	uint32_t m_availableDecodeBytes = 0;
	bool m_active = false;
	uint32_t m_status = 0;
	std::exception_ptr m_pendingError;
	std::optional<DecodedImage> m_pendingResult;
	uint32_t m_pendingTargetBase = 0;
	uint32_t m_pendingTargetCapacity = 0;
	uint32_t m_activeCapacityLimit = 0;
	bool m_decodeActive = false;
	size_t m_decodeRemaining = 0;
	ImageCopyPlan m_decodePlan;
	std::vector<uint8_t> m_decodePixels;
	uint32_t m_decodeWidth = 0;
	uint32_t m_decodeHeight = 0;
	bool m_decodeQueued = false;
	uint64_t m_decodeToken = 0;
	std::vector<ImgDecJob> m_queuedJobs;
	size_t m_queuedJobHead = 0;
	std::function<void(uint32_t width, uint32_t height, bool clipped)> m_activeResolve;
	std::function<void(std::exception_ptr)> m_activeReject;
	bool m_signalIrq = false;
	Memory& m_memory;
	DmaController& m_dma;
	VDP& m_vdp;
	IrqController& m_irq;
	DeviceScheduler& m_scheduler;
	MicrotaskQueue& m_microtasks;
};

} // namespace bmsx
