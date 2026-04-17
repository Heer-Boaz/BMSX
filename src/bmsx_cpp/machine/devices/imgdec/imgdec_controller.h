#pragma once

#include "core/taskgate.h"
#include "machine/memory/memory.h"
#include <cstdint>
#include <exception>
#include <deque>
#include <functional>
#include <optional>
#include <unordered_map>
#include <vector>

namespace bmsx {

class DmaController;

class ImgDecController {
public:
	ImgDecController(
		Memory& memory,
		DmaController& dma,
		std::function<void(uint32_t)> raiseIrq,
		std::function<int64_t()> getNowCycles,
		std::function<void(int64_t deadlineCycles)> scheduleService,
		std::function<void()> cancelService
	);

	void setTiming(int64_t cpuHz, int64_t decodeBytesPerSec, int64_t nowCycles);
	void accrueCycles(int cycles, int64_t nowCycles);
	void onCtrlWrite(int64_t nowCycles);
	void onService(int64_t nowCycles);
	bool hasPendingDecodeWork() const;
	uint32_t getPendingDecodeBytes() const;
	void reset();
	void registerExternalSlot(uint32_t baseAddr, Memory::ImageWriteEntry* entry);
	void clearExternalSlots();
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
	struct ImgDecEntry {
		bool isAsset = true;
		Memory::AssetEntry* asset = nullptr;
		Memory::ImageWriteEntry* external = nullptr;
	};
	struct ImgDecJob {
		std::vector<uint8_t> buffer;
		uint32_t dst = 0;
		uint32_t cap = 0;
		std::function<void(uint32_t width, uint32_t height, bool clipped)> resolve;
		std::function<void(std::exception_ptr)> reject;
	};

	void tryStartQueued();
	void startJob(std::vector<uint8_t>&& buffer, uint32_t dst, uint32_t cap, uint32_t src, uint32_t len, std::optional<ImgDecJob> job, bool signalIrq);
	ImgDecEntry resolveSlotEntry(uint32_t dst);
	void beginDecode(DecodedImage&& result, const ImgDecEntry& entry);
	void advanceDecode();
	void finishSuccess(bool clipped);
	void finishError(std::exception_ptr error = nullptr);
	void scheduleNextService(int64_t nowCycles);
	int64_t cyclesUntilDecodeBytes(uint32_t targetBytes) const;

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
	std::optional<ImgDecEntry> m_pendingEntry;
	uint32_t m_pendingCap = 0;
	bool m_decodeActive = false;
	size_t m_decodeRemaining = 0;
	Memory::ImageWritePlan m_decodePlan;
	std::vector<uint8_t> m_decodePixels;
	uint32_t m_decodeWidth = 0;
	uint32_t m_decodeHeight = 0;
	bool m_decodeQueued = false;
	uint64_t m_decodeToken = 0;
	std::deque<ImgDecJob> m_queuedJobs;
	std::optional<ImgDecJob> m_activeJob;
	bool m_signalIrq = false;
	std::unordered_map<uint32_t, Memory::ImageWriteEntry*> m_externalSlots;
	Memory& m_memory;
	DmaController& m_dma;
	std::function<void(uint32_t)> m_raiseIrq;
	std::function<int64_t()> m_getNowCycles;
	std::function<void(int64_t deadlineCycles)> m_scheduleService;
	std::function<void()> m_cancelService;
};

} // namespace bmsx
