#pragma once

#include "machine/cpu/cpu.h"
#include "machine/bus/io.h"
#include "machine/devices/vdp/contracts.h"
#include "machine/memory/memory.h"
#include "machine/memory/map.h"
#include "machine/scheduler/device.h"
#include "machine/devices/vdp/budget.h"
#include <array>
#include <optional>
#include <string>
#include <vector>

namespace bmsx {

class ImgDecController;
class BFont;
class VDP;
struct VdpGles2Blitter;
struct VdpSoftwareBlitter;
void restoreVdpContextState(VDP& vdp);
void captureVdpContextState(VDP& vdp);

struct VdpState {
	std::optional<SkyboxFaceSources> skyboxFaceSources;
	i32 ditherType = 0;
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
			VdpFrameBufferSize frameBufferSize
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
	void syncRegisters();
	void setDitherType(i32 type);
	void writeVram(uint32_t addr, const u8* data, size_t length) override;
	void readVram(uint32_t addr, u8* out, size_t length) const override;
	void beginFrame();
	bool canAcceptSubmittedFrame() const { return !m_pendingFrame.occupied; }
	void beginSubmittedFrame();
	void cancelSubmittedFrame();
	void sealSubmittedFrame();
	void setTiming(int64_t cpuHz, int64_t workUnitsPerSec, int64_t nowCycles);
	void accrueCycles(int cycles, int64_t nowCycles);
	void onService(int64_t nowCycles);
	void advanceWork(int workUnits);
	bool commitReadyFrameOnVblankEdge();
	void enqueueClear(const Color& color);
	void enqueueBlit(u32 slot, u32 u, u32 v, u32 w, u32 h, f32 x, f32 y, f32 z, Layer2D layer, f32 scaleX, f32 scaleY, bool flipH, bool flipV, const Color& color, f32 parallaxWeight = 0.0f);
	void enqueueCopyRect(i32 srcX, i32 srcY, i32 width, i32 height, i32 dstX, i32 dstY, f32 z, Layer2D layer);
	void enqueueFillRect(f32 x0, f32 y0, f32 x1, f32 y1, f32 z, Layer2D layer, const Color& color);
	void enqueueDrawLine(f32 x0, f32 y0, f32 x1, f32 y1, f32 z, Layer2D layer, const Color& color, f32 thickness);
	void enqueueDrawRect(f32 x0, f32 y0, f32 x1, f32 y1, f32 z, Layer2D layer, const Color& color);
	void enqueueDrawPoly(const std::vector<f32>& points, f32 z, const Color& color, f32 thickness, Layer2D layer);
	void enqueueGlyphRun(const std::string& text, f32 x, f32 y, f32 z, BFont* font, const Color& color, const std::optional<Color>& backgroundColor, i32 start, i32 end, Layer2D layer);
	void enqueueGlyphRun(const std::vector<std::string>& lines, f32 x, f32 y, f32 z, BFont* font, const Color& color, const std::optional<Color>& backgroundColor, i32 start, i32 end, Layer2D layer);
	void enqueueTileRun(const std::vector<std::optional<VdpSlotSource>>& sources, i32 cols, i32 rows, i32 tileW, i32 tileH, i32 originX, i32 originY, i32 scrollX, i32 scrollY, f32 z, Layer2D layer);
	void enqueuePayloadTileRun(uint32_t payloadBase, uint32_t tileCount, i32 cols, i32 rows, i32 tileW, i32 tileH, i32 originX, i32 originY, i32 scrollX, i32 scrollY, f32 z, Layer2D layer);
	void enqueuePayloadTileRunWords(const u32* payloadWords, uint32_t tileCount, i32 cols, i32 rows, i32 tileW, i32 tileH, i32 originX, i32 originY, i32 scrollX, i32 scrollY, f32 z, Layer2D layer);
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
	void setSkyboxSources(const SkyboxFaceSources& sources);
	void clearSkybox();
	VdpState captureState() const;
	void restoreState(const VdpState& state);
	VdpSaveState captureSaveState() const;
	void restoreSaveState(const VdpSaveState& state);
	i32 committedDitherType() const { return m_committedDitherType; }
	bool committedHasSkybox() const { return m_committedHasSkybox; }
	const SkyboxFaceSources& committedSkyboxFaceSources() const { return m_committedSkyboxFaceSources; }
	uint32_t trackedUsedVramBytes() const;
	uint32_t trackedTotalVramBytes() const;
	bool lastFrameCommitted() const { return m_lastFrameCommitted; }
	int lastFrameCost() const { return m_lastFrameCost; }
	bool lastFrameHeld() const { return m_lastFrameHeld; }
	bool needsImmediateSchedulerService() const { return !m_activeFrame.occupied && m_pendingFrame.occupied; }
	bool hasPendingRenderWork() const { return m_activeFrame.occupied ? (!m_activeFrame.ready && !m_execution.pending) : (m_pendingFrame.occupied && m_pendingFrame.cost > 0); }
	int getPendingRenderWorkUnits() const;

	struct FrameBufferColor {
		u8 r = 255;
		u8 g = 255;
		u8 b = 255;
		u8 a = 255;
	};
	struct BlitterSource {
		u32 surfaceId = 0;
		u32 srcX = 0;
		u32 srcY = 0;
		u32 width = 0;
		u32 height = 0;
	};
	struct ResolvedBlitterSample {
		BlitterSource source{};
		uint32_t surfaceWidth = 0;
		uint32_t surfaceHeight = 0;
		u32 slot = 0;
	};
	struct GlyphRunGlyph : BlitterSource {
		f32 dstX = 0.0f;
		f32 dstY = 0.0f;
		u32 advance = 0;
	};
	struct TileRunBlit : BlitterSource {
		f32 dstX = 0.0f;
		f32 dstY = 0.0f;
	};
	BlitterSource resolveBlitterSource(const VdpSlotSource& source) const;
	ResolvedBlitterSample resolveBlitterSample(const VdpSlotSource& source) const;
	enum class BlitterCommandType : u8 {
		Clear,
		Blit,
		CopyRect,
		FillRect,
		DrawLine,
		GlyphRun,
		TileRun,
	};
	struct BlitterCommand {
		BlitterCommandType type = BlitterCommandType::Clear;
		u32 seq = 0;
		int renderCost = 0;
		f32 z = 0.0f;
		Layer2D layer = Layer2D::World;
		BlitterSource source{};
		f32 dstX = 0.0f;
		f32 dstY = 0.0f;
		f32 scaleX = 1.0f;
		f32 scaleY = 1.0f;
		f32 parallaxWeight = 0.0f;
		bool flipH = false;
		bool flipV = false;
		i32 srcX = 0;
		i32 srcY = 0;
		i32 width = 0;
		i32 height = 0;
		f32 x0 = 0.0f;
		f32 y0 = 0.0f;
		f32 x1 = 0.0f;
		f32 y1 = 0.0f;
		f32 thickness = 1.0f;
		FrameBufferColor color{};
		std::optional<FrameBufferColor> backgroundColor;
		u32 lineHeight = 0;
		std::vector<GlyphRunGlyph> glyphs;
		std::vector<TileRunBlit> tiles;
	};
		struct SubmittedFrame {
			std::vector<BlitterCommand> queue;
			bool occupied = false;
			bool hasCommands = false;
			bool ready = false;
			int cost = 0;
			int workRemaining = 0;
			i32 ditherType = 0;
			SkyboxFaceSources skyboxFaceSources;
			bool hasSkybox = false;
		};
		struct BuildingFrame {
			std::vector<BlitterCommand> queue;
			bool open = false;
			int cost = 0;
		};
	struct ExecutionState {
		std::vector<BlitterCommand> queue;
		bool pending = false;
	};
	const std::vector<BlitterCommand>* takeReadyExecutionQueue();
	void completeReadyExecution(const std::vector<BlitterCommand>* queue);
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
	const std::vector<VramSlot>& surfaceUploadSlots() const { return m_vramSlots; }
	void clearSurfaceUploadDirty(uint32_t surfaceId);

				private:
			static Value readVdpStatusThunk(void* context, uint32_t addr);
		static Value readVdpDataThunk(void* context, uint32_t addr);
		static void onFifoWriteThunk(void* context, uint32_t addr, Value value);
		static void onFifoCtrlWriteThunk(void* context, uint32_t addr, Value value);
		static void onCommandWriteThunk(void* context, uint32_t addr, Value value);
		static void onRegisterWriteThunk(void* context, uint32_t addr, Value value);
		static void onSlotAtlasWriteThunk(void* context, uint32_t addr, Value value);

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
	struct VramGarbageStream {
		uint32_t machineSeed = 0;
		uint32_t bootSeed = 0;
		uint32_t slotSalt = 0;
		uint32_t addr = 0;
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
	SkyboxFaceSources m_skyboxFaceSources;
	bool m_hasSkybox = false;
	SkyboxFaceSources m_committedSkyboxFaceSources;
	bool m_committedHasSkybox = false;
	i32 m_lastDitherType = 0;
	i32 m_committedDitherType = 0;
	int64_t m_cpuHz = 1;
		int64_t m_workUnitsPerSec = 1;
		int64_t m_workCarry = 0;
		int m_availableWorkUnits = 0;
		uint32_t m_vdpStatus = 0;
		bool m_dmaSubmitActive = false;
		std::array<u32, VDP_CMD_ARG_COUNT> m_vdpRegisters{};
		std::array<u8, 4> m_vdpFifoWordScratch{{0, 0, 0, 0}};
		int m_vdpFifoWordByteCount = 0;
		std::array<u32, VDP_STREAM_CAPACITY_WORDS> m_vdpFifoStreamWords{};
		u32 m_vdpFifoStreamWordCount = 0;
		BuildingFrame m_buildFrame;
	ExecutionState m_execution;
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
	void onSlotAtlasWrite(uint32_t addr, Value value);
	void syncAtlasSlotRegisters();
	void syncAtlasSlotSurface(uint32_t slotId, uint32_t atlasId);
	void setVramSlotLogicalDimensions(VramSlot& slot, uint32_t width, uint32_t height);
	std::vector<VdpSurfacePixelsState> captureSurfacePixels() const;
	void restoreSurfacePixels(const VdpSurfacePixelsState& state);
	void registerReadSurface(uint32_t surfaceId);
	const VramSlot& getReadSurface(uint32_t surfaceId) const;
	void invalidateReadCache(uint32_t surfaceId);
	ReadCache& getReadCache(uint32_t surfaceId, const VramSlot& surface, uint32_t x, uint32_t y);
	void prefetchReadCache(uint32_t surfaceId, const VramSlot& surface, uint32_t x, uint32_t y);
	void readSurfacePixels(uint32_t surfaceId, const VramSlot& surface, uint32_t x, uint32_t y, uint32_t width, uint32_t height, std::vector<u8>& out);
	VramSlot& findVramSlot(uint32_t addr, size_t length);
	const VramSlot& findVramSlot(uint32_t addr, size_t length) const;
	void markVramSlotDirty(VramSlot& slot, uint32_t startRow, uint32_t rowCount);
	void markVramSlotDirtySpan(VramSlot& slot, uint32_t row, uint32_t xStart, uint32_t xEnd);
	VramSlot* findRegisteredVramSlotBySurfaceId(uint32_t surfaceId);
	VramSlot& getVramSlotBySurfaceId(uint32_t surfaceId);
	const VramSlot& getVramSlotBySurfaceId(uint32_t surfaceId) const;
			uint32_t nextVramMachineSeed() const;
	uint32_t nextVramBootSeed() const;
	void fillVramGarbageScratch(u8* data, size_t length, VramGarbageStream& stream) const;
	void seedVramStaging();
	void seedVramSlotPixels(VramSlot& slot);
	FrameBufferColor packFrameBufferColor(const Color& color) const;
	u32 nextBlitterSequence();
	std::vector<GlyphRunGlyph> acquireGlyphBuffer();
	std::vector<TileRunBlit> acquireTileBuffer();
	void recycleBlitterBuffers(std::vector<BlitterCommand>& queue);
	void resetBuildFrameState();
	void resetQueuedFrameState();
	void enqueueBlitterCommand(BlitterCommand&& command);
	int calculateVisibleRectCost(double width, double height) const;
	int calculateAlphaMultiplier(const FrameBufferColor& color) const;
	void assignBuildToSlot(bool active);
	void promotePendingFrame();
	void scheduleNextService(int64_t nowCycles);
	bool hasOpenDirectVdpFifoIngress() const;
	bool hasBlockedSubmitPath() const;
	void setStatusFlag(uint32_t mask, bool active);
	void refreshSubmitBusyStatus();
	void resetVdpRegisters();
	void writeVdpRegister(uint32_t index, u32 value);
	void onVdpRegisterWrite(uint32_t addr);
	void validateVdpSlotRegister(u32 slot) const;
	void configureSelectedSlotDimension(u32 word);
	struct LayerPriority {
		Layer2D layer = Layer2D::World;
		f32 z = 0.0f;
	};
	struct DrawCtrl {
		bool flipH = false;
		bool flipV = false;
		f32 parallaxWeight = 0.0f;
	};
	LayerPriority decodeLayerPriority(u32 value) const;
	DrawCtrl decodeDrawCtrl(u32 value) const;
	f32 q16ToFloat(u32 value) const;
	i32 q16ToPixel(u32 value) const;
	FrameBufferColor unpackArgbColor(u32 value) const;
	u32 packedLow16(u32 value) const;
	u32 packedHigh16(u32 value) const;
	void enqueueLatchedClear();
	void enqueueLatchedFillRect();
	void enqueueLatchedDrawLine();
	void enqueueLatchedBlit();
	void enqueueLatchedCopyRect();
	void pushVdpFifoWord(u32 word);
	void consumeSealedVdpStream(uint32_t baseAddr, size_t byteLength);
	void consumeSealedVdpWordStream(u32 wordCount);
	void sealVdpFifoTransfer();
	uint32_t consumeReplayPacketFromMemory(u32 word, uint32_t cursor, uint32_t end);
	u32 consumeReplayPacketFromWords(u32 word, u32 cursor, u32 wordCount);
	u32 decodeReg1Packet(u32 word) const;
	struct RegnPacket {
		u32 firstRegister = 0;
		u32 count = 0;
	};
	RegnPacket decodeRegnPacket(u32 word) const;
	void consumeReplayCommandPacket(u32 word);
	void consumeDirectVdpCommand(u32 cmd);
	void executeVdpDrawDoorbell(u32 command);
	void onVdpFifoWrite();
	void onVdpFifoCtrlWrite();
	void onVdpCommandWrite();
		void clearActiveFrame();
		void commitActiveVisualState();
		void finishCommittedFrameOnVblankEdge();
	uint32_t resolveSurfaceIdForSlot(u32 slot) const;

	friend struct VdpGles2Blitter;
	friend void restoreVdpContextState(VDP& vdp);
	friend void captureVdpContextState(VDP& vdp);

	void commitLiveVisualState();
};

} // namespace bmsx
