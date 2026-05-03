#pragma once

#include "machine/cpu/cpu.h"
#include "machine/bus/io.h"
#include "machine/devices/vdp/contracts.h"
#include "machine/memory/memory.h"
#include "machine/memory/map.h"
#include "machine/scheduler/device.h"
#include "machine/devices/vdp/bbu.h"
#include "machine/devices/vdp/blitter.h"
#include "machine/devices/vdp/budget.h"
#include "machine/devices/vdp/camera.h"
#include "machine/devices/vdp/frame.h"
#include "machine/devices/vdp/pmu.h"
#include "machine/devices/vdp/registers.h"
#include "machine/devices/vdp/sbx.h"
#include "machine/devices/vdp/vram_garbage.h"
#include <array>
#include <vector>

namespace bmsx {

static const std::array<Color, 16> MSX1_PALETTE = {
	Color::fromRGBA8(0, 0, 0, 0),         Color::fromRGBA8(0, 0, 0, 255),
	Color::fromRGBA8(0, 241, 20, 255),    Color::fromRGBA8(68, 249, 86, 255),
	Color::fromRGBA8(85, 79, 255, 255),   Color::fromRGBA8(128, 111, 255, 255),
	Color::fromRGBA8(250, 80, 51, 255),   Color::fromRGBA8(12, 255, 255, 255),
	Color::fromRGBA8(255, 81, 52, 255),   Color::fromRGBA8(255, 115, 86, 255),
	Color::fromRGBA8(226, 210, 4, 255),   Color::fromRGBA8(242, 217, 71, 255),
	Color::fromRGBA8(4, 212, 19, 255),    Color::fromRGBA8(231, 80, 229, 255),
	Color::fromRGBA8(208, 208, 208, 255), Color::fromRGBA8(255, 255, 255, 255),
};

class Api;
class ImgDecController;
class VDP;

struct VdpState {
	VdpCameraState camera{};
	u32 skyboxControl = 0;
	VdpSbxUnit::FaceWords skyboxFaceWords{};
	u32 pmuSelectedBank = 0;
	VdpPmuUnit::BankWords pmuBankWords{};
	i32 ditherType = 0;
	u32 vdpFaultCode = VDP_FAULT_NONE;
	u32 vdpFaultDetail = 0;
};

struct VdpSurfacePixelsState {
	uint32_t surfaceId = 0;
	std::vector<u8> pixels;
};

struct VdpSaveState : VdpState {
	std::vector<u8> vramStaging;
	std::vector<VdpSurfacePixelsState> surfacePixels;
	std::vector<u8> displayFrameBufferPixels;
};

struct VdpFrameBufferSize {
	uint32_t width = 0;
	uint32_t height = 0;
};

struct VdpEntropySeeds {
	uint32_t machineSeed = 0x42564d58u;
	uint32_t bootSeed = 0x7652414du;
};

struct VdpVramSurface {
	uint32_t surfaceId = 0;
	uint32_t baseAddr = 0;
	uint32_t capacity = 0;
	uint32_t width = 0;
	uint32_t height = 0;
};

struct VdpBlitterSurfaceSize {
	uint32_t width = 0;
	uint32_t height = 0;
};

constexpr uint32_t VDP_RD_SURFACE_SYSTEM = 0u;
constexpr uint32_t VDP_RD_SURFACE_PRIMARY = 1u;
constexpr uint32_t VDP_RD_SURFACE_SECONDARY = 2u;
constexpr uint32_t VDP_RD_SURFACE_FRAMEBUFFER = 3u;
constexpr uint32_t VDP_RD_SURFACE_COUNT = 4u;

class VDP : public Memory::VramWriter {
public:
	VDP(
		Memory& memory,
		DeviceScheduler& scheduler,
		VdpFrameBufferSize frameBufferSize,
		VdpEntropySeeds entropySeeds = {}
	);

	void initializeRegisters();
	void resetIngressState();
	void resetStatus();
	void setVblankStatus(bool active);
	bool canAcceptVdpSubmit() const;
	void acceptSubmitAttempt();
	void rejectSubmitAttempt();
	void beginDmaSubmit();
	void endDmaSubmit();
	void sealDmaTransfer(uint32_t src, size_t byteLength);
	void writeVdpFifoBytes(const u8* data, size_t length);
	void writeVram(uint32_t addr, const u8* data, size_t length) override;
	void readVram(uint32_t addr, u8* out, size_t length) const override;
	void beginFrame();
	bool canAcceptSubmittedFrame() const { return !m_pendingFrame.occupied; }
	void beginSubmittedFrame();
	void cancelSubmittedFrame();
	bool sealSubmittedFrame();
	void setTiming(int64_t cpuHz, int64_t workUnitsPerSec, int64_t nowCycles);
	void accrueCycles(int cycles, int64_t nowCycles);
	void onService(int64_t nowCycles);
	void advanceWork(int workUnits);
	bool commitReadyFrameOnVblankEdge();
	uint32_t frameBufferWidth() const { return m_frameBufferWidth; }
	uint32_t frameBufferHeight() const { return m_frameBufferHeight; }
	std::vector<u8>& frameBufferRenderReadback() { return getVramSlotBySurfaceId(VDP_RD_SURFACE_FRAMEBUFFER).cpuReadback; }
	const std::vector<u8>& frameBufferRenderReadback() const { return getVramSlotBySurfaceId(VDP_RD_SURFACE_FRAMEBUFFER).cpuReadback; }
	std::vector<u8>& frameBufferDisplayReadback() { return m_displayFrameBufferCpuReadback; }
	const std::vector<u8>& frameBufferDisplayReadback() const { return m_displayFrameBufferCpuReadback; }
	void swapFrameBufferReadbackPages();
	void invalidateFrameBufferReadCache();
	VdpBlitterSurfaceSize resolveBlitterSurfaceSize(uint32_t surfaceId) const;
	uint32_t readVdpStatus();
	uint32_t readVdpData();

	void initializeVramSurfaces();
	void setDecodedVramSurfaceDimensions(uint32_t baseAddr, uint32_t width, uint32_t height);
	void configureVramSlotSurface(uint32_t slotId, uint32_t width, uint32_t height);
	void attachImgDecController(ImgDecController& controller);
	void captureVisualStateFields(VdpState& state) const;
	VdpState captureState() const;
	void restoreState(const VdpState& state);
	VdpSaveState captureSaveState() const;
	void restoreSaveState(const VdpSaveState& state);
	uint32_t trackedUsedVramBytes() const;
	uint32_t trackedTotalVramBytes() const;
	bool lastFrameCommitted() const { return m_lastFrameCommitted; }
	int lastFrameCost() const { return m_lastFrameCost; }
	bool lastFrameHeld() const { return m_lastFrameHeld; }
	bool needsImmediateSchedulerService() const { return !m_activeFrame.occupied && m_pendingFrame.occupied; }
	bool hasPendingRenderWork() const { return m_activeFrame.occupied ? (!m_activeFrame.ready && !m_execution.pending) : (m_pendingFrame.occupied && m_pendingFrame.cost > 0); }
	int getPendingRenderWorkUnits() const;

	using FrameBufferColor = VdpFrameBufferColor;
	using BlitterSource = VdpBlitterSource;
	using ResolvedBlitterSample = VdpResolvedBlitterSample;
	using SkyboxSamples = VdpSkyboxSamples;
	using GlyphRunGlyph = VdpGlyphRunGlyph;
	using TileRunBlit = VdpTileRunBlit;
	using BlitterCommandType = VdpBlitterCommandType;
	using BlitterCommand = VdpBlitterCommand;
	using SubmittedFrame = VdpSubmittedFrame;
	using BuildingFrame = VdpBuildingFrame;
	using ExecutionState = VdpExecutionState;

	struct VramSlot {
		struct DirtySpan {
			uint32_t xStart = 0;
			uint32_t xEnd = 0;
		};
		uint32_t baseAddr = 0;
		uint32_t capacity = 0;
		uint32_t surfaceId = 0;
		uint32_t surfaceWidth = 0;
		uint32_t surfaceHeight = 0;
		std::vector<u8> cpuReadback;
		uint32_t dirtyRowStart = 0;
		uint32_t dirtyRowEnd = 0;
		std::vector<DirtySpan> dirtySpansByRow;
	};

	struct VdpHostOutput {
		uint32_t executionToken = 0;
		const std::vector<BlitterCommand>* executionQueue = nullptr;
		const std::vector<VdpBbuBillboardEntry>* executionBillboards = nullptr;
		bool executionWritesFrameBuffer = false;
		i32 ditherType = 0;
		const VdpCameraSnapshot* camera = nullptr;
		bool skyboxEnabled = false;
		const SkyboxSamples* skyboxSamples = nullptr;
		const std::vector<VdpBbuBillboardEntry>* billboards = nullptr;
		const std::vector<VramSlot>* surfaceUploadSlots = nullptr;
		uint32_t frameBufferWidth = 0;
		uint32_t frameBufferHeight = 0;
		std::vector<u8>* frameBufferRenderReadback = nullptr;
	};

	VdpHostOutput readHostOutput();
	void clearSurfaceUploadDirty(uint32_t surfaceId);
	void completeHostExecution(const VdpHostOutput& output);

private:
	static Value readVdpStatusThunk(void* context, uint32_t addr);
	static Value readVdpDataThunk(void* context, uint32_t addr);
	static void onFifoWriteThunk(void* context, uint32_t addr, Value value);
	static void onFifoCtrlWriteThunk(void* context, uint32_t addr, Value value);
	static void onCommandWriteThunk(void* context, uint32_t addr, Value value);
	static void onDitherWriteThunk(void* context, uint32_t addr, Value value);
	static void onRegisterWriteThunk(void* context, uint32_t addr, Value value);
	static void onPmuRegisterWindowWriteThunk(void* context, uint32_t addr, Value value);
	static void onSbxCommitWriteThunk(void* context, uint32_t addr, Value value);
	static void onCameraCommitWriteThunk(void* context, uint32_t addr, Value value);
	static void onFaultAckWriteThunk(void* context, uint32_t addr, Value value);

	void writeVdpRegister(uint32_t index, u32 value);
	void consumeDirectVdpCommand(u32 cmd);
	void rejectBusySubmitAttempt(uint32_t detail);

	struct ReadSurface {
		uint32_t surfaceId = 0;
		bool registered = false;
	};
	struct ReadCache {
		uint32_t x0 = 0;
		uint32_t y = 0;
		uint32_t width = 0;
		std::vector<u8> data;
	};
	Memory& m_memory;
	ImgDecController* m_imgDecController = nullptr;
	std::vector<VramSlot> m_vramSlots;
	std::vector<u8> m_vramStaging;
	std::vector<u8> m_vramGarbageScratch;
	std::array<u8, 4> m_vramSeedPixel{{0, 0, 0, 0}};
	uint32_t m_vramMachineSeed = 0;
	uint32_t m_vramBootSeed = 0;
	uint32_t m_readBudgetBytes = 0;
	bool m_readOverflow = false;
	VdpSbxUnit m_sbx;
	VdpSbxUnit::FaceWords m_sbxPacketFaceWords{};
	VdpSbxUnit::FaceWords m_sbxMmioFaceWords{};
	VdpCameraUnit m_camera;
	std::array<f32, 16> m_cameraMmioView{};
	std::array<f32, 16> m_cameraMmioProj{};
	std::array<f32, 3> m_cameraMmioEye{};
	VdpPmuUnit m_pmu;
	VdpBbuUnit m_bbu;
	SkyboxSamples m_committedSkyboxSamples{};
	VdpCameraSnapshot m_committedCamera{};
	std::vector<VdpBbuBillboardEntry> m_committedBillboards;
	i32 m_liveDitherType = 0;
	i32 m_committedDitherType = 0;
	int64_t m_cpuHz = 1;
	int64_t m_workUnitsPerSec = 1;
	int64_t m_workCarry = 0;
	int m_availableWorkUnits = 0;
	uint32_t m_vdpStatus = 0;
	uint32_t m_faultCode = VDP_FAULT_NONE;
	uint32_t m_faultDetail = 0;
	bool m_dmaSubmitActive = false;
	std::array<u32, VDP_CMD_ARG_COUNT> m_vdpRegisters{};
	std::array<u8, 4> m_vdpFifoWordScratch{{0, 0, 0, 0}};
	int m_vdpFifoWordByteCount = 0;
	std::array<u32, VDP_STREAM_CAPACITY_WORDS> m_vdpFifoStreamWords{};
	u32 m_vdpFifoStreamWordCount = 0;
		BuildingFrame m_buildFrame;
		ExecutionState m_execution;
		uint32_t m_hostOutputToken = 0;
		SubmittedFrame m_activeFrame;
	SubmittedFrame m_pendingFrame;
	std::vector<std::vector<GlyphRunGlyph>> m_glyphBufferPool;
	std::vector<std::vector<TileRunBlit>> m_tileBufferPool;
	u32 m_blitterSequence = 0;
	bool m_lastFrameCommitted = true;
	int m_lastFrameCost = 0;
	bool m_lastFrameHeld = false;
	uint32_t m_frameBufferWidth = 0;
	uint32_t m_frameBufferHeight = 0;
	std::vector<u8> m_displayFrameBufferCpuReadback;
	std::array<ReadSurface, 4> m_readSurfaces{};
	std::array<ReadCache, 4> m_readCaches{};
	VdpFrameBufferSize m_configuredFrameBufferSize;
	DeviceScheduler& m_scheduler;

	void registerVramSlot(const VdpVramSurface& surface);
	void setVramSlotLogicalDimensions(VramSlot& slot, uint32_t width, uint32_t height);
	std::vector<VdpSurfacePixelsState> captureSurfacePixels() const;
	void restoreSurfacePixels(const VdpSurfacePixelsState& state);
	void registerReadSurface(uint32_t surfaceId);
	const VramSlot& getReadSurface(uint32_t surfaceId) const;
	void invalidateReadCache(uint32_t surfaceId);
	ReadCache& getReadCache(uint32_t surfaceId, const VramSlot& surface, uint32_t x, uint32_t y);
	void prefetchReadCache(uint32_t surfaceId, const VramSlot& surface, uint32_t x, uint32_t y);
	void readSurfacePixels(const VramSlot& surface, uint32_t x, uint32_t y, uint32_t width, uint32_t height, std::vector<u8>& out);
	VramSlot* findMappedVramSlot(uint32_t addr, size_t length);
	VramSlot& findVramSlot(uint32_t addr, size_t length);
	const VramSlot& findVramSlot(uint32_t addr, size_t length) const;
	void markVramSlotDirty(VramSlot& slot, uint32_t startRow, uint32_t rowCount);
	void markVramSlotDirtySpan(VramSlot& slot, uint32_t row, uint32_t xStart, uint32_t xEnd);
	VramSlot* findRegisteredVramSlotBySurfaceId(uint32_t surfaceId);
	VramSlot& getVramSlotBySurfaceId(uint32_t surfaceId);
	const VramSlot& getVramSlotBySurfaceId(uint32_t surfaceId) const;
	void seedVramStaging();
	void seedVramSlotPixels(VramSlot& slot);
	u32 nextBlitterSequence();
	void assignLayeredBlitterCommand(BlitterCommand& command, BlitterCommandType type, int renderCost, Layer2D layer, f32 z);
	std::vector<GlyphRunGlyph> acquireGlyphBuffer();
	std::vector<TileRunBlit> acquireTileBuffer();
	void recycleBlitterBuffers(std::vector<BlitterCommand>& queue);
	void resetBuildFrameState();
	void resetQueuedFrameState();
	void enqueueBlitterCommand(BlitterCommand&& command);
	int calculateVisibleRectCost(double width, double height) const;
	int calculateAlphaMultiplier(const FrameBufferColor& color) const;
		bool assignBuildToSlot(bool active);
	void promotePendingFrame();
	void scheduleNextService(int64_t nowCycles);
	bool hasOpenDirectVdpFifoIngress() const;
	bool hasBlockedSubmitPath() const;
		void setStatusFlag(uint32_t mask, bool active);
		void raiseFault(uint32_t code, uint32_t detail);
		void clearFault();
		void refreshSubmitBusyStatus();
		void resetVdpRegisters();
		void onDitherWrite(Value value);
		void onVdpRegisterWrite(uint32_t addr);
		void onVdpFaultAckWrite();
	void writePmuBankSelect(u32 value);
	void onPmuRegisterWindowWrite(uint32_t addr);
	void syncPmuRegisterWindow();
	void onSbxCommitWrite();
	void onCameraCommitWrite();
	void syncSbxRegisterWindow();
	void syncCameraRegisterWindow();
	void configureSelectedSlotDimension(u32 word);
	VdpLatchedGeometry readLatchedGeometry() const;
		bool enqueueLatchedClear();
		bool enqueueLatchedFillRect();
		bool enqueueLatchedDrawLine();
		bool enqueueLatchedBlit();
		void enqueueCopyRect(i32 srcX, i32 srcY, i32 width, i32 height, i32 dstX, i32 dstY, f32 z, Layer2D layer);
		bool enqueueLatchedCopyRect();
	void pushVdpFifoWord(u32 word);
	void consumeSealedVdpStream(uint32_t baseAddr, size_t byteLength);
	void consumeSealedVdpWordStream(u32 wordCount);
	void sealVdpFifoTransfer();
	void latchPayloadTileRun(uint32_t payloadBase, uint32_t tileCount, i32 cols, i32 rows, i32 tileW, i32 tileH, i32 originX, i32 originY, i32 scrollX, i32 scrollY, f32 z, Layer2D layer);
	void latchPayloadTileRunWords(const u32* payloadWords, uint32_t tileCount, i32 cols, i32 rows, i32 tileW, i32 tileH, i32 originX, i32 originY, i32 scrollX, i32 scrollY, f32 z, Layer2D layer);
	enum class TileRunPayloadSource : u8 {
		Memory,
		WordStream,
	};
	struct TileRunPayload {
		TileRunPayloadSource source;
		uint32_t memoryBase;
		const u32* words;
	};
	struct TileRunClipWindow {
		i32 frameWidth = 0;
		i32 frameHeight = 0;
		i32 dstX = 0;
		i32 dstY = 0;
		i32 srcClipX = 0;
		i32 srcClipY = 0;
		bool visible = false;
	};
	TileRunClipWindow clipTileRun(i32 cols, i32 rows, i32 tileW, i32 tileH, i32 originX, i32 originY, i32 scrollX, i32 scrollY) const;
	u32 readTileRunPayloadWord(const TileRunPayload& payload, u32 wordOffset) const;
	void latchPayloadTileRunFrom(const TileRunPayload& payload, const char* sourceName, uint32_t tileCount, i32 cols, i32 rows, i32 tileW, i32 tileH, i32 originX, i32 originY, i32 scrollX, i32 scrollY, f32 z, Layer2D layer);
	void appendTileRunSource(BlitterCommand& command, const BlitterSource& source, const TileRunClipWindow& clip, i32 tileW, i32 tileH, i32 tileX, i32 tileY, i32 row, const char* sourceName, int& visibleRowCount, int& visibleNonEmptyTileCount, i32& lastVisibleRow);
	enum class ReplayPayloadSource : u8 {
		Memory,
		WordStream,
	};
	u32 consumeReplayPacket(u32 word, u32 cursor, u32 limit, ReplayPayloadSource source);
	u32 readReplayPayloadWord(u32 cursor, u32 offset, ReplayPayloadSource source) const;
	u32 decodeReg1Packet(u32 word) const;
	struct RegnPacket {
		u32 firstRegister = 0;
		u32 count = 0;
	};
		bool decodeRegnPacket(u32 word, RegnPacket& packet) const;
		bool latchBillboardPacket(const VdpBbuPacket& packet);
		bool consumeReplayCommandPacket(u32 word);
		bool executeVdpDrawDoorbell(u32 command);
	void onVdpFifoWrite();
	void onVdpFifoCtrlWrite();
	void onVdpCommandWrite();
	void clearActiveFrame();
	void commitActiveVisualState();
	void finishCommittedFrameOnVblankEdge();
		uint32_t resolveSurfaceIdForSlot(u32 slot) const;
		bool tryResolveSurfaceIdForSlot(u32 slot, uint32_t& surfaceId, uint32_t faultCode);
		void resolveBlitterSourceWordsInto(u32 slot, u32 u, u32 v, u32 w, u32 h, BlitterSource& target) const;
		uint32_t resolveSlotForSurfaceId(uint32_t surfaceId) const;
		VdpBlitterSurfaceSize resolveBlitterSurfaceForSource(const BlitterSource& source) const;
		void resolveBlitterSampleWordsInto(u32 slot, u32 u, u32 v, u32 w, u32 h, ResolvedBlitterSample& target) const;
		bool tryResolveBlitterSourceWordsInto(u32 slot, u32 u, u32 v, u32 w, u32 h, BlitterSource& target, uint32_t faultCode);
		bool tryResolveBlitterSurfaceForSource(const BlitterSource& source, VdpBlitterSurfaceSize& target, uint32_t faultCode, uint32_t zeroSizeFaultCode);
		bool tryResolveBlitterSampleWordsInto(u32 slot, u32 u, u32 v, u32 w, u32 h, ResolvedBlitterSample& target, uint32_t faultCode);
		bool resolveSkyboxFrameSamples(u32 control, const VdpSbxUnit::FaceWords& faceWords, SkyboxSamples& samples);

	void commitLiveVisualState();
};

} // namespace bmsx
