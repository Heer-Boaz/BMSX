#pragma once

#include "machine/cpu/cpu.h"
#include "machine/bus/io.h"
#include "machine/devices/vdp/contracts.h"
#include "machine/memory/memory.h"
#include "machine/memory/map.h"
#include "machine/scheduler/device.h"
#include "machine/devices/device_status.h"
#include "machine/devices/vdp/bbu.h"
#include "machine/devices/vdp/blitter.h"
#include "machine/devices/vdp/budget.h"
#include "machine/devices/vdp/device_output.h"
#include "machine/devices/vdp/fbm.h"
#include "machine/devices/vdp/frame.h"
#include "machine/devices/vdp/pmu.h"
#include "machine/devices/vdp/registers.h"
#include "machine/devices/vdp/sbx.h"
#include "machine/devices/vdp/vout.h"
#include "machine/devices/vdp/vram_garbage.h"
#include "machine/devices/vdp/xf.h"
#include <array>
#include <vector>

namespace bmsx {

class ImgDecController;
class VDP;

struct VdpState {
	VdpXfState xf{};
	std::array<u32, VDP_REGISTER_COUNT> vdpRegisterWords{};
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
	uint32_t surfaceWidth = 0;
	uint32_t surfaceHeight = 0;
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
	void setScanoutTiming(bool vblankActive, int cyclesIntoFrame, int cyclesPerFrame, int vblankStartCycle);
	bool canAcceptVdpSubmit() const;
	void acceptSubmitAttempt();
	void rejectSubmitAttempt();
	void beginDmaSubmit();
	void endDmaSubmit();
	bool sealDmaTransfer(uint32_t src, size_t byteLength);
	void writeVdpFifoBytes(const u8* data, size_t length);
	void writeVram(uint32_t addr, const u8* data, size_t length) override;
	void readVram(uint32_t addr, u8* out, size_t length) const override;
	void beginFrame();
	void setTiming(int64_t cpuHz, int64_t workUnitsPerSec, int64_t nowCycles);
	void accrueCycles(int cycles, int64_t nowCycles);
	void onService(int64_t nowCycles);
	void advanceWork(int workUnits);
	bool presentReadyFrameOnVblankEdge();
	uint32_t frameBufferWidth() const { return m_fbm.width(); }
	uint32_t frameBufferHeight() const { return m_fbm.height(); }
	bool readFrameBufferPixels(VdpFrameBufferPage page, uint32_t x, uint32_t y, uint32_t width, uint32_t height, u8* out, size_t outBytes);
	void drainFrameBufferPresentation(VdpFrameBufferPresentationSink& sink);
	void syncFrameBufferPresentation(VdpFrameBufferPresentationSink& sink);
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
	bool hasPendingRenderWork() const { return m_activeFrame.occupied ? !m_activeFrame.ready : (m_pendingFrame.occupied && m_pendingFrame.cost > 0); }
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

	const VdpDeviceOutput& readDeviceOutput();
	void drainSurfaceUploads(VdpSurfaceUploadSink& sink);
	void syncSurfaceUploads(VdpSurfaceUploadSink& sink);

private:
	static Value readVdpStatusThunk(void* context, uint32_t addr);
	static Value readVdpDataThunk(void* context, uint32_t addr);
	static void onFifoWriteThunk(void* context, uint32_t addr, Value value);
	static void onFifoCtrlWriteThunk(void* context, uint32_t addr, Value value);
	static void onCommandWriteThunk(void* context, uint32_t addr, Value value);
	static void onDitherWriteThunk(void* context, uint32_t addr, Value value);
	static void onRegisterWriteThunk(void* context, uint32_t addr, Value value);
	static void onPmuRegisterWindowWriteThunk(void* context, uint32_t addr, Value value);
	static void onSbxRegisterWindowWriteThunk(void* context, uint32_t addr, Value value);
	static void onSbxCommitWriteThunk(void* context, uint32_t addr, Value value);
	static void onFaultAckWriteThunk(void* context, uint32_t addr, Value value);

	bool writeVdpRegister(uint32_t index, u32 value);
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
	DeviceStatusLatch m_fault;
	ImgDecController* m_imgDecController = nullptr;
		std::vector<VdpSurfaceUploadSlot> m_vramSlots;
		VdpSurfaceUpload m_surfaceUploadOutput;
		std::vector<u8> m_vramStaging;
	std::vector<u8> m_vramGarbageScratch;
	std::array<u8, 4> m_vramSeedPixel{{0, 0, 0, 0}};
	uint32_t m_vramMachineSeed = 0;
	uint32_t m_vramBootSeed = 0;
	uint32_t m_readBudgetBytes = 0;
	bool m_readOverflow = false;
	VdpSbxUnit m_sbx;
	SkyboxSamples m_sbxSealSamples{};
	VdpXfUnit m_xf;
	VdpPmuUnit m_pmu;
	VdpBbuUnit m_bbu;
	VdpVoutUnit m_vout;
	int64_t m_cpuHz = 1;
	int64_t m_workUnitsPerSec = 1;
	int64_t m_workCarry = 0;
	int m_availableWorkUnits = 0;
	bool m_dmaSubmitActive = false;
	std::array<u32, VDP_CMD_ARG_COUNT> m_vdpRegisters{};
	std::array<u8, 4> m_vdpFifoWordScratch{{0, 0, 0, 0}};
	int m_vdpFifoWordByteCount = 0;
	std::array<u32, VDP_STREAM_CAPACITY_WORDS> m_vdpFifoStreamWords{};
	u32 m_vdpFifoStreamWordCount = 0;
	BuildingFrame m_buildFrame;
	SubmittedFrame m_activeFrame;
	SubmittedFrame m_pendingFrame;
	std::vector<u8> m_frameBufferPriorityLayer;
	std::vector<f32> m_frameBufferPriorityValue;
	std::vector<u32> m_frameBufferPrioritySeq;
	std::vector<std::vector<GlyphRunGlyph>> m_glyphBufferPool;
	std::vector<std::vector<TileRunBlit>> m_tileBufferPool;
	u32 m_blitterSequence = 0;
	bool m_lastFrameCommitted = true;
	int m_lastFrameCost = 0;
	bool m_lastFrameHeld = false;
	VdpFbmUnit m_fbm;
	std::array<ReadSurface, 4> m_readSurfaces{};
	std::array<ReadCache, 4> m_readCaches{};
	VdpFrameBufferSize m_configuredFrameBufferSize;
	DeviceScheduler& m_scheduler;

	void registerVramSlot(const VdpVramSurface& surface);
	bool setVramSlotLogicalDimensions(VdpSurfaceUploadSlot& slot, uint32_t width, uint32_t height, uint32_t faultDetail);
	std::vector<VdpSurfacePixelsState> captureSurfacePixels() const;
	void restoreSurfacePixels(const VdpSurfacePixelsState& state);
	void registerReadSurface(uint32_t surfaceId);
	void invalidateReadCache(uint32_t surfaceId);
	ReadCache& getReadCache(uint32_t surfaceId, const VdpSurfaceUploadSlot& surface, uint32_t x, uint32_t y);
	void prefetchReadCache(uint32_t surfaceId, const VdpSurfaceUploadSlot& surface, uint32_t x, uint32_t y);
	void copySurfacePixels(const VdpSurfaceUploadSlot& surface, uint32_t x, uint32_t y, uint32_t width, uint32_t height, std::vector<u8>& out);
	VdpSurfaceUploadSlot* findMappedVramSlot(uint32_t addr, size_t length);
	const VdpSurfaceUploadSlot* findMappedVramSlot(uint32_t addr, size_t length) const;
	VdpSurfaceUploadSlot* findVramSlotOrFault(uint32_t surfaceId, uint32_t faultCode);
	const VdpSurfaceUploadSlot* findVramSlotOrFault(uint32_t surfaceId, uint32_t faultCode) const;
	void markVramSlotDirty(VdpSurfaceUploadSlot& slot, uint32_t startRow, uint32_t rowCount);
	void markVramSlotDirtySpan(VdpSurfaceUploadSlot& slot, uint32_t row, uint32_t xStart, uint32_t xEnd);
	VdpSurfaceUploadSlot* findRegisteredVramSlotBySurfaceId(uint32_t surfaceId);
	const VdpSurfaceUploadSlot* findRegisteredVramSlotBySurfaceId(uint32_t surfaceId) const;
	void clearSurfaceUploadDirty(uint32_t surfaceId);
	void emitSurfaceUpload(VdpSurfaceUploadSink& sink, const VdpSurfaceUploadSlot& slot, bool requiresFullSync);
	void seedVramSlotPixels(VdpSurfaceUploadSlot& slot);
	u32 nextBlitterSequence();
	void assignLayeredBlitterCommand(BlitterCommand& command, BlitterCommandType type, int renderCost, Layer2D layer, f32 priority);
	std::vector<GlyphRunGlyph> acquireGlyphBuffer();
	std::vector<TileRunBlit> acquireTileBuffer();
	void recycleBlitterBuffers(std::vector<BlitterCommand>& queue);
	void resetBuildFrameState();
	void resetQueuedFrameState();
	bool enqueueBlitterCommand(BlitterCommand&& command);
	bool canAcceptSubmittedFrame() const { return !m_pendingFrame.occupied; }
	bool beginSubmittedFrame(VdpDexFrameState state);
	void cancelSubmittedFrame();
	bool sealSubmittedFrame();
	void promotePendingFrame();
	void executeFrameBufferCommands(const std::vector<BlitterCommand>& commands);
	void ensureFrameBufferPriorityCapacity(size_t pixelCount);
	void resetFrameBufferPriority();
	void fillFrameBuffer(std::vector<u8>& pixels, const FrameBufferColor& color);
	void blendFrameBufferPixel(std::vector<u8>& pixels, size_t index, u8 r, u8 g, u8 b, u8 a, Layer2D layer, f32 priority, u32 seq);
	void rasterizeFrameBufferFill(std::vector<u8>& pixels, f32 x0, f32 y0, f32 x1, f32 y1, const FrameBufferColor& color, Layer2D layer, f32 priority, u32 seq);
	void rasterizeFrameBufferLine(std::vector<u8>& pixels, f32 x0, f32 y0, f32 x1, f32 y1, f32 thicknessValue, const FrameBufferColor& color, Layer2D layer, f32 priority, u32 seq);
	void rasterizeFrameBufferBlit(std::vector<u8>& pixels, const BlitterSource& source, f32 dstXValue, f32 dstYValue, f32 scaleX, f32 scaleY, bool flipH, bool flipV, const FrameBufferColor& color, Layer2D layer, f32 priority, u32 seq);
	void copyFrameBufferRect(std::vector<u8>& pixels, i32 srcX, i32 srcY, i32 width, i32 height, i32 dstX, i32 dstY, Layer2D layer, f32 priority, u32 seq);
	void presentFrameBufferPageOnVblankEdge();
	void scheduleNextService(int64_t nowCycles);
	bool hasOpenDirectVdpFifoIngress() const;
	bool hasBlockedSubmitPath() const;
		void refreshSubmitBusyStatus();
		void resetVdpRegisters();
		void onDitherWrite(Value value);
		void onVdpRegisterWrite(uint32_t addr);
	void writePmuBankSelect(u32 value);
	void onPmuRegisterWindowWrite(uint32_t addr);
	void syncPmuRegisterWindow();
	void onSbxRegisterWindowWrite(uint32_t addr, Value value);
	void onSbxCommitWrite();
	void syncSbxRegisterWindow();
	void configureSelectedSlotDimension(u32 word);
	VdpLatchedGeometry readLatchedGeometry() const;
		bool enqueueLatchedClear();
		bool enqueueLatchedFillRect();
		bool enqueueLatchedDrawLine();
		bool enqueueLatchedBlit();
		bool enqueueCopyRect(i32 srcX, i32 srcY, i32 width, i32 height, i32 dstX, i32 dstY, f32 priority, Layer2D layer);
		bool enqueueLatchedCopyRect();
	void pushVdpFifoWord(u32 word);
	bool consumeSealedVdpStream(uint32_t baseAddr, size_t byteLength);
	void consumeSealedVdpWordStream(u32 wordCount);
	void sealVdpFifoTransfer();
	void latchPayloadTileRun(uint32_t payloadBase, uint32_t tileCount, i32 cols, i32 rows, i32 tileW, i32 tileH, i32 originX, i32 originY, i32 scrollX, i32 scrollY, f32 priority, Layer2D layer);
	void latchPayloadTileRunWords(const u32* payloadWords, uint32_t tileCount, i32 cols, i32 rows, i32 tileW, i32 tileH, i32 originX, i32 originY, i32 scrollX, i32 scrollY, f32 priority, Layer2D layer);
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
	void latchPayloadTileRunFrom(const TileRunPayload& payload, uint32_t tileCount, i32 cols, i32 rows, i32 tileW, i32 tileH, i32 originX, i32 originY, i32 scrollX, i32 scrollY, f32 priority, Layer2D layer);
	bool appendTileRunSource(BlitterCommand& command, const BlitterSource& source, const TileRunClipWindow& clip, i32 tileW, i32 tileH, i32 tileX, i32 tileY, i32 row, int& visibleRowCount, int& visibleNonEmptyTileCount, i32& lastVisibleRow);
	u32 consumeReplayPacketFromMemory(u32 word, u32 cursor, u32 end);
	u32 consumeXfPacketFromMemory(u32 word, u32 cursor, u32 end);
	u32 consumeReplayPacketFromWords(u32 word, u32 cursor, u32 wordCount);
	u32 consumeXfPacketFromWords(u32 word, u32 cursor, u32 wordCount);
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
		bool tryResolveSurfaceIdForSlot(u32 slot, uint32_t& surfaceId, uint32_t faultCode);
		bool tryResolveBlitterSourceWordsInto(u32 slot, u32 u, u32 v, u32 w, u32 h, BlitterSource& target, uint32_t faultCode);
		const VdpSurfaceUploadSlot* tryResolveBlitterSurfaceForSource(const BlitterSource& source, uint32_t faultCode, uint32_t zeroSizeFaultCode);
		bool resolveSkyboxSampleInto(u32 slot, u32 u, u32 v, u32 w, u32 h, ResolvedBlitterSample& target, VdpSbxFrameResolution& resolution) const;
		void resolveBbuSourceInto(const VdpBbuPacket& packet, VdpBbuSourceResolution& target) const;
		bool resolveSkyboxFrameSamplesInto(u32 control, const VdpSbxUnit::FaceWords& faceWords, SkyboxSamples& samples, VdpSbxFrameResolution& resolution);
		bool resolveSkyboxFrameSamples(u32 control, const VdpSbxUnit::FaceWords& faceWords, SkyboxSamples& samples);

	void commitLiveVisualState();
};

} // namespace bmsx
