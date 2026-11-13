#include "render/backend/gles2/gx_gpu.h"
#include "render/gx_gpu_presentation.h"

#include "machine/devices/gx/gpu.h"
#include "machine/devices/gx/gpu_command_buffer.h"
#include "spec/gx/gp0.h"
#include "machine/devices/gx/gpu_pcrtc.h"
#include "render/backend/gx_gpu_render_rules.h"
#include "render/backend/gles2/backend.h"
#include "render/backend/gles2/texture_units.h"
#include "render/backend/gles2/texture_copy.h"
#include "render/backend/gles2/gx_gpu_textured_program.h"
#include "render/backend/gles2/gx_gpu_primitive_program.h"
#include "render/backend/gles2/gx_gpu_draw_targets.h"
#include "render/backend/texture_params.h"
#include "render/backend/gles2/shaders/gx_gpu_shaders.h"
#include "render/backend/pass/library.h"

#include <algorithm>
#include <array>
#include <chrono>
#include <cstdio>
#include <cstdint>
#include <cstring>
#include <span>
#include <vector>

namespace bmsx {
namespace {
constexpr i32 kGxGpuVramXAddressPeriod = static_cast<i32>(GX_GPU_VRAM_X_ADDRESS_PERIOD);
constexpr i32 kGxGpuVramYAddressPeriod = static_cast<i32>(GX_GPU_VRAM_Y_ADDRESS_PERIOD);
constexpr size_t kGxGpuPolygonVerticesPerCommand = 6u;
constexpr size_t kGxGpuSolidVertexFloats = 6u;
constexpr size_t kGxGpuSolidTriangleFloats = 3u * kGxGpuSolidVertexFloats;
constexpr size_t kGxGpuSolidVerticesPerCommand = 24u;
constexpr size_t kGxGpuSolidFloatCapacity = GX_GPU_COMMAND_CAPACITY * kGxGpuSolidVerticesPerCommand * kGxGpuSolidVertexFloats;
constexpr size_t kGxGpuFixedSolidVertexFloats = 11u;
constexpr size_t kGxGpuFixedSolidTriangleFloats = 3u * kGxGpuFixedSolidVertexFloats;
constexpr size_t kGxGpuLineVertexFloats = 12u;
constexpr size_t kGxGpuLineVerticesPerSegment = 6u;
constexpr size_t kGxGpuLineSegmentFloats = kGxGpuLineVerticesPerSegment * kGxGpuLineVertexFloats;
constexpr size_t kGxGpuLineSegmentCapacity = 1024u;
// One epoch can close one solid batch per command plus one line batch per retained segment.
constexpr size_t kGxGpuPrimitiveBatchCapacity = GX_GPU_COMMAND_CAPACITY + kGxGpuLineSegmentCapacity;
constexpr u16 kGxGpuBlendPlanCommandEnd = 0xffffu;
constexpr size_t kGxGpuLineFloatCapacity = kGxGpuLineSegmentCapacity * kGxGpuLineSegmentFloats;
constexpr size_t kGxGpuTexturedUvComponents = 2u;
constexpr size_t kGxGpuColorComponents = 3u;
constexpr size_t kGxGpuTextureSourceComponents = 4u;
constexpr size_t kGxGpuTextureSourceFloats = 2u;
constexpr size_t kGxGpuTexturedVertexFloats = 13u;
constexpr size_t kGxGpuFixedTexturedVertexFloats = 19u;
constexpr size_t kGxGpuTexturedTextureSourceFloatOffset = kGxGpuTexturedVertexFloats - kGxGpuTextureSourceFloats;
constexpr size_t kGxGpuFixedTexturedTextureSourceFloatOffset = kGxGpuFixedTexturedVertexFloats - kGxGpuTextureSourceFloats;
constexpr size_t kGxGpuTexturedFloatCapacity = GX_GPU_COMMAND_CAPACITY * kGxGpuPolygonVerticesPerCommand * kGxGpuFixedTexturedVertexFloats;
constexpr u32 kGxGpuTexturePageCoordSize = 256u;
constexpr u32 kGxGpuTexturePage4BitWidthWords = 64u;
constexpr u32 kGxGpuTexturePage8BitWidthWords = 128u;
constexpr size_t kGxGpuTransferVertexFloats = 4u;
constexpr size_t kGxGpuTransferVerticesPerSegment = 6u;
constexpr size_t kGxGpuTransferSegmentFloats = kGxGpuTransferVerticesPerSegment * kGxGpuTransferVertexFloats;
constexpr size_t kGxGpuTransferSegmentsPerRow = 3u;
constexpr size_t kGxGpuTransferFloatCapacity = static_cast<size_t>(GX_GPU_TRANSFER_MAX_HEIGHT) * kGxGpuTransferSegmentsPerRow * kGxGpuTransferVerticesPerSegment * kGxGpuTransferVertexFloats;
constexpr size_t kGxGpuScanoutVertexFloats = 2u;
constexpr size_t kGxGpuScanoutVertexCount = 3u;
constexpr size_t kGxGpuScanoutFloatCount = kGxGpuScanoutVertexCount * kGxGpuScanoutVertexFloats;
constexpr size_t kGxGpuRawVramBytesPerPixel = 4u;
constexpr size_t kGxGpuCpuUploadBytesPerPixel = 2u;
constexpr i32 kGxGpuReadbackPackWidth = 512;
constexpr u32 kGxGpuFullDrawingAreaTopLeftWord = 0u;
constexpr u32 kGxGpuFullDrawingAreaBottomRightWord = (static_cast<u32>(kGxGpuVramXAddressPeriod) - 1u) | ((static_cast<u32>(kGxGpuVramYAddressPeriod) - 1u) << 10u);
constexpr char kGxGpuFixedColorPlaneShaderDefine[] = "#define GX_GPU_FIXED_COLOR_PLANE 1\n";
constexpr char kGxGpuScanoutWeaveShaderDefines[] =
	"#define GX_GPU_INTERLACED_WEAVE 1\n#define GX_GPU_SCANOUT_STORAGE_PATH 6\n";
constexpr char kGxGpuCpuUploadShaderDefine[] = "#define GX_GPU_CPU_UPLOAD_SOURCE 1\n";
constexpr char kGxGpuInterlacedFieldShaderDefine[] = "#define GX_GPU_INTERLACED_FIELD 1\n";
constexpr char kGxGpuFramebufferFetchArmShaderDefine[] = "#define GX_GPU_FRAMEBUFFER_FETCH_ARM 1\n";
constexpr char kGxGpuVramAliasShaderDefine[] = "#define GX_GPU_VRAM_ALIAS 1\n";
constexpr size_t kGxGpuScanoutCircuitUniformVectorCount = 5u;
constexpr size_t kGxGpuScanoutProgramStorageCount = static_cast<size_t>(GX_GPU_PCRTC_SAMPLE_PATH_COUNT);
constexpr size_t kGxGpuScanoutDoubleAlphaProgramBase = kGxGpuScanoutProgramStorageCount;
constexpr size_t kGxGpuScanoutProgramCount = kGxGpuScanoutProgramStorageCount * 2u;
constexpr GLuint kGxGpuScanoutPositionAttrib = 0u;
constexpr GLuint kGxGpuTransferPositionAttrib = 0u;
constexpr GLuint kGxGpuTransferSourceOffsetAttrib = 1u;
constexpr std::array<GLES2AttributeBinding, 1u> kGxGpuScanoutAttributeBindings{{
	{ kGxGpuScanoutPositionAttrib, "a_position" },
}};
constexpr std::array<GLES2AttributeBinding, 2u> kGxGpuTransferAttributeBindings{{
	{ kGxGpuTransferPositionAttrib, "a_position" },
	{ kGxGpuTransferSourceOffsetAttrib, "a_sourceOffset" },
}};

constexpr GLsizei kGxGpuSolidVertexStride = static_cast<GLsizei>(kGxGpuSolidVertexFloats * sizeof(f32));
constexpr GLsizei kGxGpuFixedSolidVertexStride = static_cast<GLsizei>(kGxGpuFixedSolidVertexFloats * sizeof(f32));
constexpr GLsizei kGxGpuLineVertexStride = static_cast<GLsizei>(kGxGpuLineVertexFloats * sizeof(f32));
constexpr GLsizei kGxGpuTexturedVertexStride = static_cast<GLsizei>(kGxGpuTexturedVertexFloats * sizeof(f32));
constexpr GLsizei kGxGpuFixedTexturedVertexStride = static_cast<GLsizei>(kGxGpuFixedTexturedVertexFloats * sizeof(f32));
constexpr GLsizei kGxGpuTransferVertexStride = static_cast<GLsizei>(kGxGpuTransferVertexFloats * sizeof(f32));
constexpr GLsizei kGxGpuScanoutVertexStride = static_cast<GLsizei>(kGxGpuScanoutVertexFloats * sizeof(f32));

constexpr std::array<f32, kGxGpuScanoutFloatCount> kGxGpuScanoutVertices{
	-1.0f, -1.0f,
	3.0f, -1.0f,
	-1.0f, 3.0f,
};


// Geometry is independent of VRAM contents. Prepare the complete command
// interval once, then publish an immutable store before executing its draws.
// Source/destination dependencies still execute in GP0 order; only geometry
// survives those submission boundaries. Immediate transfers use another VBO.
struct GxGpuTexturedGeometry {
	std::array<f32, kGxGpuTexturedFloatCapacity> vertices{};
	std::array<u32, GX_GPU_COMMAND_CAPACITY + 1u> commandFloatOffsets{};
	GLuint buffer = 0;
};

struct GxCpuToVramUploadProfile {
	u64 hostCalls = 0u;
	u64 hostBytes = 0u;
};

// An admitted interval contains at most two pages of packed u16 payloads.
// Next-fit packing of whole commands needs at most three pages: four pages
// would require each adjacent pair to contain more than one page of pixels.
// Headers, odd-pixel padding and partial packets only reduce that bound;
// destination wrapping does not change the number of source pixels.
constexpr size_t kGxGpuCpuUploadPageCount = 3u;
static_assert(GX_GPU_COMMAND_WORD_CAPACITY * 2u <= GX_GPU_TRANSFER_MAX_PIXEL_COUNT * 2u);
struct GxGpuCpuUploadGeneration {
	struct Span {
		u32 pageIndex;
		u32 pixelOffset;
	};
	struct Page {
		u32 textureIndex;
		GxCpuToVramUploadProfile profile;
		u64 cpuNanoseconds;
	};
	std::array<Span, GX_GPU_COMMAND_CAPACITY> commands{};
	std::array<Page, kGxGpuCpuUploadPageCount> pages{};
};

struct GxGpuVertexStream {
	GLuint buffer = 0;
	GLES2DrawState* state = nullptr;
	GLintptr cursor = 0;

	void initialize(GLES2DrawState& drawState) {
		state = &drawState;
		glGenBuffers(1, &buffer);
	}

	void reserve(GLsizeiptr byteCount) {
		state->bindBuffer(GL_ARRAY_BUFFER, buffer);
		// Orphan the preceding submission, not a maximum-size multi-frame arena.
		// GLES2 drivers may otherwise synchronize/copy the entire live buffer on
		// every subdata update, even when the appended ranges do not overlap.
		glBufferData(GL_ARRAY_BUFFER, byteCount, nullptr, GL_STREAM_DRAW);
		cursor = 0;
	}

	GLintptr append(const void* data, GLsizeiptr byteCount) {
		const GLintptr offset = cursor;
		glBufferSubData(GL_ARRAY_BUFFER, offset, byteCount, data);
		cursor += byteCount;
		return offset;
	}
};

enum class GxGpuLineRasterCase : u8 {
	HorizontalMajor,
	VerticalIncreasing,
	VerticalDecreasing,
};

struct GxGpuPreparedRasterPrimitive {
	GxGpuVramCopyRect clippedBounds{};
	i32 x0 = 0;
	i32 y0 = 0;
	i32 x1 = 0;
	i32 y1 = 0;
	u32 color0 = 0u;
	u32 color1 = 0u;
	GxGpuLineRasterCase lineRasterCase = GxGpuLineRasterCase::HorizontalMajor;
	bool emitsVertices = false;
};

struct GxGpuPreparedBlendCommand {
	GxGpuPreparedRasterPrimitive primitive{};
	u16 layer = 0u;
	u16 next = 0u;
	GxGpuRasterKind rasterKind = GxGpuRasterKind::Rectangle;
};

struct GxGpuPrimitiveBatch {
	GxGpuRasterKind rasterKind = GxGpuRasterKind::Rectangle;
	size_t vertexFloatStart = 0u;
	size_t vertexFloatCount = 0u;
	GxGpuVramCopyRect drawBounds{};
	u32 maskBitModeWord = 0u;
	u32 blendMode = 0u;
	u32 skippedLineParity = GX_GPU_SKIPPED_LINE_NONE;
	u32 vramYAddressExtensionWord = 0u;
	bool sampleSyncBefore = false;
	bool fixedColor = false;
	bool blendEnabled = false;
	bool ditherEnabled = false;
};

struct GxGpuPrimitiveSubmission {
	std::array<GxGpuPrimitiveBatch, kGxGpuPrimitiveBatchCapacity> batches{};
	size_t batchCount = 0u;
	size_t solidFloatCount = 0u;
	size_t solidBatchStart = 0u;
	size_t lineFloatCount = 0u;
	size_t lineBatchStart = 0u;
};

struct GxGpuRectangle {
	f32 x0 = 0.0f;
	f32 y0 = 0.0f;
	f32 x1 = 0.0f;
	f32 y1 = 0.0f;
	u32 width = 0u;
	u32 height = 0u;
};

struct GxGpuLineBatchState {
	u32 topLeftWord = 0u;
	u32 bottomRightWord = 0u;
	u32 maskBitModeWord = 0u;
	bool ditherEnabled = false;
	u32 skippedLineParity = GX_GPU_SKIPPED_LINE_NONE;
	bool blendEnabled = false;
	u32 blendMode = 0u;
	u32 vramYAddressExtensionWord = 0u;
	bool readsVram = false;
};

struct GxGpuTransferProgram {
	GLuint id = 0;
	GLint sourceUniform = -1;
	GLint checkMaskBitUniform = -1;
	GLint setMaskBitUniform = -1;
	GLint logicalYBaseUniform = -1;
	i32 sourceTextureUnit = -1;
	u32 maskBitModeWord = 0u;
	bool maskBitModeValid = false;
};

struct GxGpuScanoutProgram {
	GLuint id = 0;
	std::array<GLint, 2> cachedRectUniforms{-1, -1};
	u64 cachedTargetRevision = 0;
	GLint circuitUniform = -1;
	GLint interlaceUniform = -1;
	u32 circuitRevision = 0u;
	i8 circuit = -1;
	i8 circuitField = -1;
	u32 interlaceRevision = 0u;
	i8 interlaceField = -1;
};

} // namespace

struct OpenGLES2GxGpuState {
	std::array<f32, kGxGpuSolidFloatCapacity> solidVertices{};
	std::array<f32, kGxGpuLineFloatCapacity> lineVertices{};
	GxGpuTexturedGeometry texturedGeometry{};
	std::array<u32, kGxGpuTexturedUvComponents * GX_GPU_TRIANGLE_ATTRIBUTE_PLANE_PHASES> texturedUvPlane{};
	std::array<u32, kGxGpuColorComponents * GX_GPU_TRIANGLE_ATTRIBUTE_PLANE_PHASES> colorPlane{};
	std::array<u16, kGxGpuTextureSourceComponents> texturedTextureSource{};
	std::array<f32, kGxGpuTransferFloatCapacity> transferVertices{};
	// CPU upload preparation and synchronous VRAM readback never overlap.
	std::vector<u8> pixelTransferScratch;
	std::vector<u8> vramSnapshotScratch;
	GxGpuVramCopyRect vramCopyRectScratch{};
	GxGpuVramCopyRect solidBatchRect{};
	GxGpuVramCopyRect solidCommandRect{};
	GxGpuVramCopyRect lineBatchRect{};
	GxGpuVramCopyRect texturedBatchRect{};
	GxGpuDirtyRegions texturedSourceReads;
	bool texturedBatchUniformGain = true;
	GxGpuVramCopyRect texturedCommandRect{};
	GxGpuVramCopyRect texturedDependencyBatchRect{};
	GxGpuDirtyRegions sampleDirtyRegions;
	GxGpuVramCopyRect snapshotDirtyRect{};
	GxGpuRectangle rectangleScratch{};
	GxGpuPreparedRasterPrimitive linePreparedScratch{};
	GxGpuLineBatchState lineBatchState{};
	GxGpuPrimitiveSubmission primitiveSubmission{};
	std::array<GxGpuPreparedBlendCommand, kGxGpuLineSegmentCapacity> blendPlanCommands{};
	std::array<u16, kGxGpuLineSegmentCapacity + 1u> blendPlanLayerFirst{};
	std::array<u16, kGxGpuLineSegmentCapacity + 1u> blendPlanLayerLast{};
	GxGpuVramCopyRect blendPlanLineBounds{};
	GxGpuVramCopyRect blendPlanSolidBounds{};
	OpenGLES2Backend* backend = nullptr;
	u32 generation = 0u;
	i32 vramTextureRows = 0;
	u32 vramTextureRowMask = 0u;
	GxGpuPrimitiveProgram solidProgram{};
	GxGpuPrimitiveProgram fixedSolidProgram{};
	GxGpuPrimitiveProgram lineProgram{};
	GxGpuPrimitiveProgram hardwareSolidProgram{}, hardwareFixedSolidProgram{}, hardwareLineProgram{};
	GxGpuTexturedProgram texturedProgram{};
	GxGpuTexturedProgram integerTexturedProgram{};
	// Output path: retained texture word, or zero-gain RGB with its selected mask bit.
	std::array<std::array<std::array<GxGpuTexturedProgram, 3>, 2>, 2> opaqueWordPrograms{};
	GxGpuTexturedProgram fixedTexturedProgram{};
	GxGpuTexturedProgram hardwareTexturedProgram{}, hardwareIntegerTexturedProgram{}, hardwareFixedTexturedProgram{};
	GxGpuTransferProgram transferProgram{};
	GxGpuTransferProgram cpuUploadProgram{};
	std::array<GxGpuScanoutProgram, kGxGpuScanoutProgramCount> scanoutPrograms{};
	std::array<GxGpuScanoutProgram, kGxGpuScanoutProgramCount> scanoutFieldPrograms{};
	GLuint scanoutWeaveProgram = 0;
	GLuint readbackProgram = 0;
	GLES2Texture vramTexture{};
	GLES2Texture vramSampleTexture{};
	GLES2TextureCopy sampleCopy;
	GxGpuDrawTargets drawTargets;
	std::array<GLES2Texture, kGxGpuCpuUploadPageCount> cpuUploadTextures{};
	GxGpuCpuUploadGeneration cpuUploadGeneration{};
	u32 cpuUploadTextureCount = 1u;
	u32 nextCpuUploadTexture = 0u;
	GLES2Texture readbackTexture{};
	GLES2Texture scanoutFieldsTexture{};
	GLuint vramFramebuffer = 0;
	GLuint readbackFramebuffer = 0;
	GLuint scanoutFieldsFramebuffer = 0;
	GxGpuVertexStream vertexStream{};
	GLuint scanoutVertexBuffer = 0;
	GLint scanoutWeaveInterlaceUniform = -1;
	GLint readbackParamsUniform = -1;
	GLint readbackVramYAddressExtensionUniform = -1;
	std::array<std::array<GLint, 20u>, 2u> scanoutCircuitWords{};
	u32 scanoutCircuitWordRevision = 0u;
	i32 scanoutCircuitWordField = -1;
	bool scanoutCircuitWordsValid = false;
	u32 scanoutFixedStateRevision = 0u;
	bool scanoutFixedStateValid = false;
	GLfloat scanoutBackgroundRed = 0.0f;
	GLfloat scanoutBackgroundGreen = 0.0f;
	GLfloat scanoutBackgroundBlue = 0.0f;
	GLfloat scanoutBlendAlpha = 0.0f;
	bool scanoutFieldsValid = false;
	u64 scanoutFieldsVramReplacementSerial = 0u;
	u32 processedCommandCount = 0;
	u32 processedCommandSerial = 0;
	u64 vramSnapshotSerial = 0u;
	bool vramSnapshotValid = false;
	bool framebufferFetch = false;
	bool textureBarrier = false;
};

void OpenGLES2GxGpuStateDeleter::operator()(OpenGLES2GxGpuState* state) const noexcept {
	delete state;
}

namespace {

void initializeGxGpuTexture(OpenGLES2GxGpuState& gx, GLES2Texture& texture, i32 textureUnit, i32 width, i32 height, GLenum format, GLenum type) {
	glGenTextures(1, &texture.id);
	texture.generation = gx.generation;
	texture.width = width;
	texture.height = height;
	gx.backend->setActiveTextureUnit(textureUnit);
	gx.backend->bindTexture2D(&texture);
	glTexImage2D(GL_TEXTURE_2D, 0, format, width, height, 0, format, type, nullptr);
	applyGLES2TextureParams(RGBA8_LINEAR_TEXTURE_PARAMS);
}

} // namespace

void initGxGpu(OpenGLES2Backend& backend) {
	backend.m_gx_gpu.reset(new OpenGLES2GxGpuState);
	OpenGLES2GxGpuState& gx = *backend.m_gx_gpu;
	gx.backend = &backend;
	gx.generation = backend.contextGeneration();
	gx.vramTextureRows = static_cast<i32>(backend.gxGpuVramTextureRows());
	gx.vramTextureRowMask = static_cast<u32>(gx.vramTextureRows) - 1u;
	gx.pixelTransferScratch.resize(std::max(
		static_cast<size_t>(kGxGpuVramXAddressPeriod)
		* static_cast<size_t>(gx.vramTextureRows)
		* kGxGpuRawVramBytesPerPixel,
		GX_GPU_TRANSFER_MAX_PIXEL_COUNT * kGxGpuCpuUploadBytesPerPixel));
	gx.vramSnapshotScratch.resize(
		static_cast<size_t>(kGxGpuVramXAddressPeriod)
		* static_cast<size_t>(gx.vramTextureRows)
		* kGxGpuCpuUploadBytesPerPixel);
	gx.framebufferFetch = backend.armFramebufferFetchAvailable();
	gx.textureBarrier = !gx.framebufferFetch && backend.textureBarrierAvailable();
	const char* framebufferFetchShaderDefine = gx.framebufferFetch ? kGxGpuFramebufferFetchArmShaderDefine : "";
	const char* vramAliasShaderDefine = gx.vramTextureRows == kGxGpuVramYAddressPeriod ? "" : kGxGpuVramAliasShaderDefine;
	char vramShaderDefines[512]{};
	std::snprintf(
		vramShaderDefines,
		sizeof(vramShaderDefines),
		"#define GX_GPU_VRAM_X_ADDRESS_PERIOD %u\n"
		"#define GX_GPU_VRAM_Y_ADDRESS_PERIOD %u\n"
		"#define GX_GPU_VRAM_Y_ADDRESS_EXTENSION_BIT %u\n"
		"#define GX_GPU_VRAM_ADDRESS_WORD_COUNT %zu\n"
		"#define GX_GPU_VRAM_TEXTURE_ROWS %d\n"
		"#define GX_GPU_VRAM_INSTALLED_WORDS %d\n%s%s%s",
		GX_GPU_VRAM_X_ADDRESS_PERIOD,
		GX_GPU_VRAM_Y_ADDRESS_PERIOD,
		GX_GPU_VRAM_Y_ADDRESS_EXTENSION_BIT,
		GX_GPU_VRAM_ADDRESS_WORD_COUNT,
		gx.vramTextureRows,
		kGxGpuVramXAddressPeriod * gx.vramTextureRows,
		vramAliasShaderDefine,
		backend.gxGpuDrawTargetMode() != GxGpuDrawTargetMode::FullVram ? "#define GX_GPU_CACHED_TARGETS 1\n" : "",
		(backend.gxGpuDrawTargetMode() == GxGpuDrawTargetMode::SmallRgb5 || backend.gxGpuDrawTargetMode() == GxGpuDrawTargetMode::SmallRgb5Mali) ? "#define GX_GPU_TARGET_RGB5_A1 1\n" : "");
	char rasterShaderDefines[640]{};
	std::snprintf(rasterShaderDefines, sizeof(rasterShaderDefines), "%s%s", vramShaderDefines, framebufferFetchShaderDefine);
	char fixedColorShaderDefines[704]{};
	std::snprintf(fixedColorShaderDefines, sizeof(fixedColorShaderDefines), "%s%s", kGxGpuFixedColorPlaneShaderDefine, rasterShaderDefines);
	char cpuUploadShaderDefines[640]{};
	std::snprintf(
		cpuUploadShaderDefines,
		sizeof(cpuUploadShaderDefines),
		"%s#define GX_GPU_TRANSFER_HEIGHT %u\n%s",
		kGxGpuCpuUploadShaderDefine,
		GX_GPU_TRANSFER_MAX_HEIGHT,
		vramShaderDefines);
	gx.solidProgram.initialize(*gx.backend, kGxGpuFillVertexShader, kGxGpuFillFragmentShader, "gx_gpu_fill", rasterShaderDefines);
	gx.fixedSolidProgram.initialize(*gx.backend, kGxGpuFillVertexShader, kGxGpuFillFragmentShader, "gx_gpu_fixed_fill", fixedColorShaderDefines);
	gx.lineProgram.initialize(*gx.backend, kGxGpuLineVertexShader, kGxGpuLineFragmentShader, "gx_gpu_line", rasterShaderDefines);
	gx.texturedProgram.initialize(backend, "gx_gpu_textured", rasterShaderDefines, gx.framebufferFetch, gx.textureBarrier);
	char integerUvShaderDefines[704]{};
	std::snprintf(integerUvShaderDefines, sizeof(integerUvShaderDefines), "%s#define GX_GPU_INTEGER_UV 1\n", rasterShaderDefines);
	gx.integerTexturedProgram.initialize(backend, "gx_gpu_integer_textured", integerUvShaderDefines, gx.framebufferFetch, gx.textureBarrier);
	for (size_t output = 0u; output < gx.opaqueWordPrograms.size(); ++output) {
		for (size_t integerUv = 0u; integerUv < gx.opaqueWordPrograms[output].size(); ++integerUv) {
			for (size_t mode = 0u; mode < gx.opaqueWordPrograms[output][integerUv].size(); ++mode) {
				char defines[896]{}, label[48]{};
				std::snprintf(defines, sizeof(defines), "%s#define %s 1\n#define GX_GPU_TEXTURE_MODE %zu\n", integerUv ? integerUvShaderDefines : rasterShaderDefines,
					output == 0u ? "GX_GPU_RAW_OPAQUE_TEXTURE" : "GX_GPU_ZERO_GAIN_OPAQUE_TEXTURE", mode);
				std::snprintf(label, sizeof(label), "gx_gpu_word_%zu_%zu_%zu", output, integerUv, mode);
				auto& program = gx.opaqueWordPrograms[output][integerUv][mode];
				program.opaqueWordOutput = true;
				program.initialize(backend, label, defines, gx.framebufferFetch, gx.textureBarrier);
			}
		}
	}
	gx.fixedTexturedProgram.initialize(backend, "gx_gpu_fixed_textured", fixedColorShaderDefines, gx.framebufferFetch, gx.textureBarrier);
	if (backend.gxGpuDrawTargetMode() == GxGpuDrawTargetMode::SmallRgb5Mali) {
		char hardwareDefines[896]{};
		const auto initializePrimitive = [&](GxGpuPrimitiveProgram& program, const char* vertex, const char* fragment, const char* label, const char* defines) {
			std::snprintf(hardwareDefines, sizeof(hardwareDefines), "%s#define GX_GPU_HARDWARE_BLEND 1\n", defines);
			program.initialize(backend, vertex, fragment, label, hardwareDefines);
			program.hardwareBlending = true;
		};
		initializePrimitive(gx.hardwareSolidProgram, kGxGpuFillVertexShader, kGxGpuFillFragmentShader, "gx_hw_fill", rasterShaderDefines);
		initializePrimitive(gx.hardwareFixedSolidProgram, kGxGpuFillVertexShader, kGxGpuFillFragmentShader, "gx_hw_fixed_fill", fixedColorShaderDefines);
		initializePrimitive(gx.hardwareLineProgram, kGxGpuLineVertexShader, kGxGpuLineFragmentShader, "gx_hw_line", rasterShaderDefines);
		const auto initializeTextured = [&](GxGpuTexturedProgram& program, const char* label, const char* defines) {
			std::snprintf(hardwareDefines, sizeof(hardwareDefines), "%s#define GX_GPU_HARDWARE_BLEND 1\n", defines);
			program.initialize(backend, label, hardwareDefines, gx.framebufferFetch, gx.textureBarrier);
			program.hardwareBlending = true;
			program.twoPassTexturing = true;
		};
		initializeTextured(gx.hardwareTexturedProgram, "gx_hw_textured", rasterShaderDefines);
		initializeTextured(gx.hardwareIntegerTexturedProgram, "gx_hw_integer_textured", integerUvShaderDefines);
		initializeTextured(gx.hardwareFixedTexturedProgram, "gx_hw_fixed_textured", fixedColorShaderDefines);
	}

	gx.transferProgram.id = gx.backend->buildProgram(
		kGxGpuTransferVertexShader,
		kGxGpuTransferFragmentShader,
		"gx_gpu_transfer",
		vramShaderDefines,
		kGxGpuTransferAttributeBindings);
	gx.cpuUploadProgram.id = gx.backend->buildProgram(
		kGxGpuTransferVertexShader,
		kGxGpuTransferFragmentShader,
		"gx_gpu_cpu_upload",
		cpuUploadShaderDefines,
		kGxGpuTransferAttributeBindings);
	const GLuint scanoutVertexShader = gx.backend->compileShader(
		GL_VERTEX_SHADER, kGxGpuScanoutVertexShader, "gx_gpu_scanout_shared", "vertex");
	try {
		for (size_t program = 0u; program < kGxGpuScanoutProgramCount; program += 1u) {
			const size_t storageProgram = program % kGxGpuScanoutProgramStorageCount;
			const size_t storagePath = storageProgram == static_cast<size_t>(GX_GPU_PCRTC_SAMPLE_LINEAR_GX16)
				? static_cast<size_t>(GX_GPU_PCRTC_STORAGE_GX16)
				: storageProgram;
			char defines[640]{};
			const int baseLength = std::snprintf(
				defines,
				sizeof(defines),
				"%s#define GX_GPU_SCANOUT_STORAGE_PATH %zu\n",
				vramShaderDefines,
				storagePath);
			size_t defineLength = static_cast<size_t>(baseLength);
			if (storageProgram == static_cast<size_t>(GX_GPU_PCRTC_SAMPLE_LINEAR_GX16)) {
				defineLength += static_cast<size_t>(std::snprintf(
					defines + defineLength,
					sizeof(defines) - defineLength,
					"#define GX_GPU_SCANOUT_LINEAR_GX16 1\n"));
			}
			if (program >= kGxGpuScanoutDoubleAlphaProgramBase) {
				std::snprintf(
					defines + defineLength,
					sizeof(defines) - defineLength,
					"#define GX_GPU_SCANOUT_DOUBLE_ALPHA 1\n");
			}
			char label[64]{};
			std::snprintf(label, sizeof(label), "gx_gpu_scanout_%zu", program);
			gx.scanoutPrograms[program].id = gx.backend->buildProgramWithVertexShader(
				scanoutVertexShader, kGxGpuScanoutFragmentShader, label, defines, kGxGpuScanoutAttributeBindings);
			char fieldDefines[704]{};
			std::snprintf(fieldDefines, sizeof(fieldDefines), "%s%s", kGxGpuInterlacedFieldShaderDefine, defines);
			std::snprintf(label, sizeof(label), "gx_gpu_scanout_field_%zu", program);
			gx.scanoutFieldPrograms[program].id = gx.backend->buildProgramWithVertexShader(
				scanoutVertexShader, kGxGpuScanoutFragmentShader, label, fieldDefines, kGxGpuScanoutAttributeBindings);
		}
		char scanoutWeaveDefines[sizeof(vramShaderDefines) + sizeof(kGxGpuScanoutWeaveShaderDefines) - 1u]{};
		std::snprintf(scanoutWeaveDefines, sizeof(scanoutWeaveDefines), "%s%s",
			vramShaderDefines, kGxGpuScanoutWeaveShaderDefines);
		gx.scanoutWeaveProgram = gx.backend->buildProgramWithVertexShader(
			scanoutVertexShader,
			kGxGpuScanoutFragmentShader,
			"gx_gpu_scanout_weave",
			scanoutWeaveDefines,
			kGxGpuScanoutAttributeBindings);
		gx.readbackProgram = gx.backend->buildProgramWithVertexShader(
			scanoutVertexShader,
			kGxGpuReadbackFragmentShader,
			"gx_gpu_readback",
			vramShaderDefines,
			kGxGpuScanoutAttributeBindings);
		glDeleteShader(scanoutVertexShader);
	} catch (...) {
		glDeleteShader(scanoutVertexShader);
		throw;
	}

	// Each texel carries exactly one raw word as four nibbles. Use sixteen-bit
	// render targets rather than paying for RGBA8 resolves and tile reloads.
	initializeGxGpuTexture(gx, gx.vramTexture, GLES2_TEXTURE_UNIT_GX_SCANOUT, kGxGpuVramXAddressPeriod, gx.vramTextureRows, GL_RGBA, GL_UNSIGNED_SHORT_4_4_4_4);
	initializeGxGpuTexture(gx, gx.vramSampleTexture, GLES2_TEXTURE_UNIT_GX_SAMPLE, kGxGpuVramXAddressPeriod, gx.vramTextureRows, GL_RGBA, GL_UNSIGNED_SHORT_4_4_4_4);
	gx.sampleCopy.initialize(backend, gx.vramSampleTexture);
	gx.cpuUploadTextureCount = backend.gxGpuDrawTargetMode() == GxGpuDrawTargetMode::FullVram ? 1u : gx.cpuUploadTextures.size();
	for (u32 i = 0u; i < gx.cpuUploadTextureCount; ++i)
		initializeGxGpuTexture(gx, gx.cpuUploadTextures[i], GLES2_TEXTURE_UNIT_GX_TRANSFER,
			kGxGpuVramXAddressPeriod, static_cast<i32>(GX_GPU_TRANSFER_MAX_HEIGHT), GL_RGBA, GL_UNSIGNED_SHORT_4_4_4_4);
	initializeGxGpuTexture(gx, gx.readbackTexture, GLES2_TEXTURE_UNIT_GX_SCANOUT, kGxGpuReadbackPackWidth, static_cast<i32>(GX_GPU_TRANSFER_MAX_HEIGHT), GL_RGBA, GL_UNSIGNED_BYTE);

	glGenFramebuffers(1, &gx.vramFramebuffer);
	gx.backend->drawState.bindFramebuffer(gx.vramFramebuffer);
	glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, gx.vramTexture.id, 0);
	gx.backend->drawState.viewport(0, 0, kGxGpuVramXAddressPeriod, gx.vramTextureRows);
	glClearColor(0.0f, 0.0f, 0.0f, 0.0f);
	glClear(GL_COLOR_BUFFER_BIT);
	gx.sampleDirtyRegions.clear();
	gx.sampleDirtyRegions.mark(0, 0, kGxGpuVramXAddressPeriod, gx.vramTextureRows);
	gx.drawTargets.initialize(backend, backend.gxGpuDrawTargetMode(), gx.vramTexture, gx.vramFramebuffer, gx.vramSampleTexture);
	glGenFramebuffers(1, &gx.readbackFramebuffer);
	gx.backend->drawState.bindFramebuffer(gx.readbackFramebuffer);
	glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, gx.readbackTexture.id, 0);
	gx.scanoutFieldsTexture.width = 0;
	gx.scanoutFieldsTexture.height = 0;
	glGenTextures(1, &gx.scanoutFieldsTexture.id);
	gx.scanoutFieldsTexture.generation = gx.generation;
	gx.backend->setActiveTextureUnit(GLES2_TEXTURE_UNIT_GX_SCANOUT_FIELDS);
	gx.backend->bindTexture2D(&gx.scanoutFieldsTexture);
	applyGLES2TextureParams(RGBA8_LINEAR_TEXTURE_PARAMS);
	glGenFramebuffers(1, &gx.scanoutFieldsFramebuffer);
	gx.backend->drawState.bindFramebuffer(gx.scanoutFieldsFramebuffer);
	glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, gx.scanoutFieldsTexture.id, 0);

	gx.vertexStream.initialize(backend.drawState);
	glGenBuffers(1, &gx.texturedGeometry.buffer);

	glGenBuffers(1, &gx.scanoutVertexBuffer);
	gx.backend->drawState.bindBuffer(GL_ARRAY_BUFFER, gx.scanoutVertexBuffer);
	glBufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(kGxGpuScanoutVertices.size() * sizeof(f32)), kGxGpuScanoutVertices.data(), GL_STATIC_DRAW);

	const std::array<GxGpuTransferProgram*, 2u> transferPrograms{
		&gx.transferProgram,
		&gx.cpuUploadProgram,
	};
	for (GxGpuTransferProgram* program : transferPrograms) {
		program->sourceUniform = glGetUniformLocation(program->id, "u_source");
		program->checkMaskBitUniform = glGetUniformLocation(program->id, "u_checkMaskBit");
		program->setMaskBitUniform = glGetUniformLocation(program->id, "u_setMaskBit");
		program->logicalYBaseUniform = glGetUniformLocation(program->id, "u_logicalYBase");
		gx.backend->drawState.useProgram(program->id);
		glUniform1i(glGetUniformLocation(program->id, "u_vram"), GLES2_TEXTURE_UNIT_GX_SAMPLE);
	}
	for (size_t path = 0u; path < kGxGpuScanoutProgramCount; path += 1u) {
		GxGpuScanoutProgram& scanoutProgram = gx.scanoutPrograms[path];
		GxGpuScanoutProgram& scanoutFieldProgram = gx.scanoutFieldPrograms[path];
		const std::array<GxGpuScanoutProgram*, 2u> programs{&scanoutProgram, &scanoutFieldProgram};
		for (GxGpuScanoutProgram* program : programs) {
			program->circuitUniform = glGetUniformLocation(program->id, "u_circuit[0]");
			program->cachedRectUniforms[0] = glGetUniformLocation(program->id, "u_cachedRect0");
			program->cachedRectUniforms[1] = glGetUniformLocation(program->id, "u_cachedRect1");
			gx.backend->drawState.useProgram(program->id);
			glUniform1i(glGetUniformLocation(program->id, "u_vram"), GLES2_TEXTURE_UNIT_GX_SCANOUT);
			glUniform1i(glGetUniformLocation(program->id, "u_cachedVram0"), GLES2_TEXTURE_UNIT_GX_TRANSFER);
			glUniform1i(glGetUniformLocation(program->id, "u_cachedVram1"), GLES2_TEXTURE_UNIT_GX_DESTINATION);
		}
		scanoutFieldProgram.interlaceUniform = glGetUniformLocation(scanoutFieldProgram.id, "u_interlace");
	}
	gx.scanoutWeaveInterlaceUniform = glGetUniformLocation(gx.scanoutWeaveProgram, "u_interlace");
	gx.readbackParamsUniform = glGetUniformLocation(gx.readbackProgram, "u_readback");
	gx.readbackVramYAddressExtensionUniform = glGetUniformLocation(gx.readbackProgram, "u_vramYAddressExtensionWord");
	gx.backend->drawState.useProgram(gx.scanoutWeaveProgram);
	glUniform1i(glGetUniformLocation(gx.scanoutWeaveProgram, "u_vram"), GLES2_TEXTURE_UNIT_GX_SCANOUT_FIELDS);
	gx.backend->drawState.useProgram(gx.readbackProgram);
	glUniform1i(glGetUniformLocation(gx.readbackProgram, "u_vram"), GLES2_TEXTURE_UNIT_GX_SCANOUT);
	gx.backend->drawState.bindFramebuffer(0);
}

namespace {

} // namespace

void shutdownGxGpu(OpenGLES2Backend& backend) {
	backend.drawState.invalidate();
	OpenGLES2GxGpuState& gx = *backend.m_gx_gpu;
	if (gx.generation == backend.contextGeneration()) {
		const std::array<GLuint, 7> textures{
			gx.vramTexture.id,
			gx.vramSampleTexture.id,
			gx.cpuUploadTextures[0].id,
			gx.cpuUploadTextures[1].id,
			gx.cpuUploadTextures[2].id,
			gx.readbackTexture.id,
			gx.scanoutFieldsTexture.id,
		};
		glDeleteTextures(static_cast<GLsizei>(textures.size()), textures.data());

		const std::array<GLuint, 3> framebuffers{
			gx.vramFramebuffer,
			gx.readbackFramebuffer,
			gx.scanoutFieldsFramebuffer,
		};
		glDeleteFramebuffers(static_cast<GLsizei>(framebuffers.size()), framebuffers.data());

		const std::array<GLuint, 3> buffers{
			gx.vertexStream.buffer,
			gx.texturedGeometry.buffer,
			gx.scanoutVertexBuffer,
		};
		glDeleteBuffers(static_cast<GLsizei>(buffers.size()), buffers.data());

		glDeleteProgram(gx.hardwareSolidProgram.id); glDeleteProgram(gx.hardwareFixedSolidProgram.id);
		glDeleteProgram(gx.hardwareLineProgram.id); glDeleteProgram(gx.hardwareTexturedProgram.id);
		glDeleteProgram(gx.hardwareIntegerTexturedProgram.id); glDeleteProgram(gx.hardwareFixedTexturedProgram.id);
		gx.drawTargets.shutdown();
		gx.sampleCopy.dispose();
		for (const auto& output : gx.opaqueWordPrograms) {
			for (const auto& programs : output) {
				for (const auto& program : programs) glDeleteProgram(program.id);
			}
		}
		const std::array<GLuint, 10> programs{
			gx.solidProgram.id,
			gx.fixedSolidProgram.id,
			gx.lineProgram.id,
			gx.texturedProgram.id,
			gx.integerTexturedProgram.id,
			gx.fixedTexturedProgram.id,
			gx.transferProgram.id,
			gx.cpuUploadProgram.id,
			gx.scanoutWeaveProgram,
			gx.readbackProgram,
		};
		for (GLuint program : programs) {
			glDeleteProgram(program);
		}
		for (size_t path = 0u; path < kGxGpuScanoutProgramCount; path += 1u) {
			glDeleteProgram(gx.scanoutPrograms[path].id);
			glDeleteProgram(gx.scanoutFieldPrograms[path].id);
		}
	}

	backend.m_gx_gpu.reset();
	backend.invalidateTextureBindingCache();
}

namespace {

size_t writeSolidVertex(OpenGLES2GxGpuState& gx, size_t offset, f32 x, f32 y, f32 r, f32 g, f32 b) {
	gx.solidVertices[offset] = x;
	gx.solidVertices[offset + 1u] = y;
	gx.solidVertices[offset + 2u] = r;
	gx.solidVertices[offset + 3u] = g;
	gx.solidVertices[offset + 4u] = b;
	gx.solidVertices[offset + 5u] = 1.0f;
	return offset + kGxGpuSolidVertexFloats;
}

size_t writeSolidColorVertex(OpenGLES2GxGpuState& gx, size_t offset, f32 x, f32 y, u32 colorWord) {
	return writeSolidVertex(gx,
		offset,
		x,
		y,
		static_cast<f32>(colorWord & 0xffu),
		static_cast<f32>((colorWord >> 8u) & 0xffu),
		static_cast<f32>((colorWord >> 16u) & 0xffu));
}

size_t appendSolidTriangle(OpenGLES2GxGpuState& gx,
	size_t vertexFloatCount,
	f32 x0,
	f32 y0,
	u32 color0,
	f32 x1,
	f32 y1,
	u32 color1,
	f32 x2,
	f32 y2,
	u32 color2) {
	size_t offset = vertexFloatCount;
	offset = writeSolidColorVertex(gx, offset, x0, y0, color0);
	offset = writeSolidColorVertex(gx, offset, x1, y1, color1);
	offset = writeSolidColorVertex(gx, offset, x2, y2, color2);
	return offset;
}

size_t writeFixedSolidVertex(OpenGLES2GxGpuState& gx, size_t offset, i32 x, i32 y) {
	gx.solidVertices[offset] = static_cast<f32>(x);
	gx.solidVertices[offset + 1u] = static_cast<f32>(y);
	for (size_t component = 0u; component < kGxGpuColorComponents; component += 1u) {
		gx.solidVertices[offset + 2u + component] = static_cast<f32>(gx.colorPlane[component]);
		gx.solidVertices[offset + 5u + component] = static_cast<f32>(gx.colorPlane[kGxGpuColorComponents + component]);
		gx.solidVertices[offset + 8u + component] = static_cast<f32>(gx.colorPlane[kGxGpuColorComponents * 2u + component]);
	}
	return offset + kGxGpuFixedSolidVertexFloats;
}

size_t appendSolidPrimitiveTriangle(OpenGLES2GxGpuState& gx,
	size_t vertexFloatCount,
	bool fixedColor,
	i32 x0,
	i32 y0,
	u32 color0,
	i32 x1,
	i32 y1,
	u32 color1,
	i32 x2,
	i32 y2,
	u32 color2) {
	if (gxGpuTriangleExceedsPrimitiveSize(x0, y0, x1, y1, x2, y2)) {
		return vertexFloatCount;
	}
	const i32 xShift = gxGpuTriangleRasterShift(x0, x1, x2);
	const i32 yShift = gxGpuTriangleRasterShift(y0, y1, y2);
	x0 += xShift;
	y0 += yShift;
	x1 += xShift;
	y1 += yShift;
	x2 += xShift;
	y2 += yShift;
	if (fixedColor) {
		const i64 determinant = static_cast<i64>(x1 - x0) * (y2 - y1) - static_cast<i64>(x2 - x1) * (y1 - y0);
		if (determinant == 0) {
			return vertexFloatCount;
		}
		gx.colorPlane[0] = color0 & 0xffu;
		gx.colorPlane[1] = (color0 >> 8u) & 0xffu;
		gx.colorPlane[2] = (color0 >> 16u) & 0xffu;
		gx.colorPlane[3] = color1 & 0xffu;
		gx.colorPlane[4] = (color1 >> 8u) & 0xffu;
		gx.colorPlane[5] = (color1 >> 16u) & 0xffu;
		gx.colorPlane[6] = color2 & 0xffu;
		gx.colorPlane[7] = (color2 >> 8u) & 0xffu;
		gx.colorPlane[8] = (color2 >> 16u) & 0xffu;
		gxGpuTriangleAttributePlane(gx.colorPlane.data(), 0u, kGxGpuColorComponents, determinant, x0, y0, x1, y1, x2, y2);
		size_t offset = vertexFloatCount;
		offset = writeFixedSolidVertex(gx, offset, x0, y0);
		offset = writeFixedSolidVertex(gx, offset, x1, y1);
		offset = writeFixedSolidVertex(gx, offset, x2, y2);
		return offset;
	}
	return appendSolidTriangle(gx,
		vertexFloatCount,
		static_cast<f32>(x0),
		static_cast<f32>(y0),
		color0,
		static_cast<f32>(x1),
		static_cast<f32>(y1),
		color1,
		static_cast<f32>(x2),
		static_cast<f32>(y2),
		color2);
}

size_t appendSolidQuad(OpenGLES2GxGpuState& gx,
	size_t vertexFloatCount,
	f32 x0,
	f32 y0,
	u32 color0,
	f32 x1,
	f32 y1,
	u32 color1,
	f32 x2,
	f32 y2,
	u32 color2,
	f32 x3,
	f32 y3,
	u32 color3) {
	size_t offset = vertexFloatCount;
	offset = appendSolidTriangle(gx, offset, x0, y0, color0, x1, y1, color1, x2, y2, color2);
	offset = appendSolidTriangle(gx, offset, x2, y2, color2, x1, y1, color1, x3, y3, color3);
	return offset;
}

size_t appendFillRectangle(OpenGLES2GxGpuState& gx, const GxGpuCommandStorage& commandBuffer, u32 commandIndex, size_t vertexFloatCount) {
	const u32 wordStart = commandBuffer.commandWordStart[commandIndex];
	const u32 colorWord = commandBuffer.words[wordStart];
	const u32 xyWord = commandBuffer.words[wordStart + 1u];
	const u32 sizeWord = commandBuffer.words[wordStart + 2u];
	const u32 width = gxGpuFillWidth(sizeWord);
	const u32 height = gxGpuFillHeight(sizeWord);
	const u32 vramYAddressExtensionWord = commandBuffer.commandVramYAddressExtensionWord[commandIndex];
	if (width == 0u || height == 0u) {
		return vertexFloatCount;
	}
	u32 y = gxGpuTransferY(xyWord, vramYAddressExtensionWord);
	u32 remainingHeight = height;
	size_t offset = vertexFloatCount;
	while (remainingHeight != 0u) {
		const u32 rowHeight = gxGpuVramWrappedHeight(y, remainingHeight, vramYAddressExtensionWord, gx.vramTextureRowMask);
		u32 x = gxGpuFillX(xyWord);
		u32 remainingWidth = width;
		while (remainingWidth != 0u) {
			const u32 runWidth = gxGpuVramWrappedWidth(x, remainingWidth);
			offset = appendSolidQuad(gx,
				offset,
				static_cast<f32>(x),
				static_cast<f32>(y),
				colorWord,
				static_cast<f32>(x),
				static_cast<f32>(y + rowHeight),
				colorWord,
				static_cast<f32>(x + runWidth),
				static_cast<f32>(y),
				colorWord,
				static_cast<f32>(x + runWidth),
				static_cast<f32>(y + rowHeight),
				colorWord);
			x = (x + runWidth) & (static_cast<u32>(kGxGpuVramXAddressPeriod) - 1u);
			remainingWidth -= runWidth;
		}
		y = gxGpuVramYAddress(y + rowHeight, vramYAddressExtensionWord);
		remainingHeight -= rowHeight;
	}
	return offset;
}

size_t appendSolidPolygon(OpenGLES2GxGpuState& gx, const GxGpuCommandStorage& commandBuffer, u32 commandIndex, size_t vertexFloatCount) {
	const u32 opcode = commandBuffer.commandOpcode[commandIndex];
	if (gxGpuCommandTextureEnabled(opcode)) return vertexFloatCount;
	const u32 wordStart = commandBuffer.commandWordStart[commandIndex];
	const u32 record = commandBuffer.commandDrawIndex[commandIndex];
	const u32 positionStride = commandBuffer.drawPositionStride[record];
	const u32 colorStride = commandBuffer.drawColorStride[record];
	const u32 drawingOffsetWord = commandBuffer.commandDrawingOffsetWord[commandIndex];
	const i32 dx = gxGpuSigned11(drawingOffsetWord);
	const i32 dy = gxGpuDrawingOffsetY(drawingOffsetWord);
	const u32 xy0 = commandBuffer.words[wordStart + 1u];
	const u32 xy1 = commandBuffer.words[wordStart + 1u + positionStride];
	const u32 xy2 = commandBuffer.words[wordStart + 1u + positionStride * 2u];
	const u32 color0 = commandBuffer.words[wordStart];
	const u32 color1 = commandBuffer.words[wordStart + colorStride];
	const u32 color2 = commandBuffer.words[wordStart + colorStride * 2u];
	size_t offset = appendSolidPrimitiveTriangle(gx, vertexFloatCount, colorStride != 0u,
		dx + gxGpuSigned11(xy0), dy + gxGpuVertexY(xy0), color0,
		dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color1,
		dx + gxGpuSigned11(xy2), dy + gxGpuVertexY(xy2), color2);
	if (commandBuffer.drawVertexCount[record] == 4u) {
		const u32 xy3 = commandBuffer.words[wordStart + 1u + positionStride * 3u];
		const u32 color3 = commandBuffer.words[wordStart + colorStride * 3u];
		offset = appendSolidPrimitiveTriangle(gx, offset, colorStride != 0u,
			dx + gxGpuSigned11(xy2), dy + gxGpuVertexY(xy2), color2,
			dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color1,
			dx + gxGpuSigned11(xy3), dy + gxGpuVertexY(xy3), color3);
	}
	return offset;
}

GxGpuRectangle& readGxGpuRectangle(
	OpenGLES2GxGpuState& gx,
	const GxGpuCommandStorage& commandBuffer,
	u32 commandIndex,
	u32 opcode
) {
	const u32 wordStart = commandBuffer.commandWordStart[commandIndex];
	const u32 xyWord = commandBuffer.words[wordStart + 1u];
	const u32 sizeWord = commandBuffer.words[wordStart + commandBuffer.drawSizeOffset[commandBuffer.commandDrawIndex[commandIndex]]];
	const u32 width = gxGpuCommandRectangleWidth(opcode, sizeWord);
	const u32 height = gxGpuCommandRectangleHeight(opcode, sizeWord);
	const u32 drawingOffsetWord = commandBuffer.commandDrawingOffsetWord[commandIndex];
	const f32 x0 = static_cast<f32>(gxGpuSigned11(static_cast<u32>(gxGpuSigned11(drawingOffsetWord) + gxGpuSigned11(xyWord))));
	const f32 y0 = static_cast<f32>(gxGpuSigned11(static_cast<u32>(gxGpuDrawingOffsetY(drawingOffsetWord) + gxGpuVertexY(xyWord))));
	gx.rectangleScratch.x0 = x0;
	gx.rectangleScratch.y0 = y0;
	gx.rectangleScratch.x1 = x0 + static_cast<f32>(width);
	gx.rectangleScratch.y1 = y0 + static_cast<f32>(height);
	gx.rectangleScratch.width = width;
	gx.rectangleScratch.height = height;
	return gx.rectangleScratch;
}

size_t appendSolidRectangle(OpenGLES2GxGpuState& gx, const GxGpuCommandStorage& commandBuffer, u32 commandIndex, size_t vertexFloatCount) {
	const u32 opcode = commandBuffer.commandOpcode[commandIndex];
	if (gxGpuCommandTextureEnabled(opcode)) {
		return vertexFloatCount;
	}
	const u32 wordStart = commandBuffer.commandWordStart[commandIndex];
	const u32 colorWord = commandBuffer.words[wordStart];
	const GxGpuRectangle& rect = readGxGpuRectangle(gx, commandBuffer, commandIndex, opcode);
	if (rect.width == 0u || rect.height == 0u) {
		return vertexFloatCount;
	}
	return appendSolidQuad(gx, vertexFloatCount, rect.x0, rect.y0, colorWord, rect.x0, rect.y1, colorWord, rect.x1, rect.y0, colorWord, rect.x1, rect.y1, colorWord);
}

size_t appendPreparedSolidRectangle(OpenGLES2GxGpuState& gx, size_t vertexFloatCount, const GxGpuPreparedRasterPrimitive& rectangle) {
	const f32 x0 = static_cast<f32>(rectangle.x0);
	const f32 y0 = static_cast<f32>(rectangle.y0);
	const f32 x1 = static_cast<f32>(rectangle.x1);
	const f32 y1 = static_cast<f32>(rectangle.y1);
	return appendSolidQuad(gx,
		vertexFloatCount,
		x0,
		y0,
		rectangle.color0,
		x0,
		y1,
		rectangle.color0,
		x1,
		y0,
		rectangle.color0,
		x1,
		y1,
		rectangle.color0);
}

size_t writeLineVertex(OpenGLES2GxGpuState& gx,
	size_t offset,
	f32 x,
	f32 y,
	f32 x0,
	f32 y0,
	f32 x1,
	f32 y1,
	u32 color0,
	u32 color1) {
	gx.lineVertices[offset] = x;
	gx.lineVertices[offset + 1u] = y;
	gx.lineVertices[offset + 2u] = x0;
	gx.lineVertices[offset + 3u] = y0;
	gx.lineVertices[offset + 4u] = x1;
	gx.lineVertices[offset + 5u] = y1;
	gx.lineVertices[offset + 6u] = static_cast<f32>(color0 & 0xffu);
	gx.lineVertices[offset + 7u] = static_cast<f32>((color0 >> 8u) & 0xffu);
	gx.lineVertices[offset + 8u] = static_cast<f32>((color0 >> 16u) & 0xffu);
	gx.lineVertices[offset + 9u] = static_cast<f32>(color1 & 0xffu);
	gx.lineVertices[offset + 10u] = static_cast<f32>((color1 >> 8u) & 0xffu);
	gx.lineVertices[offset + 11u] = static_cast<f32>((color1 >> 16u) & 0xffu);
	return offset + kGxGpuLineVertexFloats;
}

size_t appendPreparedLineSegment(OpenGLES2GxGpuState& gx, size_t vertexFloatCount, const GxGpuPreparedRasterPrimitive& line) {
	const f32 x0Float = static_cast<f32>(line.x0);
	const f32 y0Float = static_cast<f32>(line.y0);
	const f32 x1Float = static_cast<f32>(line.x1);
	const f32 y1Float = static_cast<f32>(line.y1);
	size_t offset = vertexFloatCount;
	if (line.lineRasterCase == GxGpuLineRasterCase::HorizontalMajor) {
		offset = writeLineVertex(gx, offset, x0Float, y0Float - 1.0f, x0Float, y0Float, x1Float, y1Float, line.color0, line.color1);
		offset = writeLineVertex(gx, offset, x0Float, y0Float + 2.0f, x0Float, y0Float, x1Float, y1Float, line.color0, line.color1);
		offset = writeLineVertex(gx, offset, x1Float + 1.0f, y1Float - 1.0f, x0Float, y0Float, x1Float, y1Float, line.color0, line.color1);
		offset = writeLineVertex(gx, offset, x0Float, y0Float + 2.0f, x0Float, y0Float, x1Float, y1Float, line.color0, line.color1);
		offset = writeLineVertex(gx, offset, x1Float + 1.0f, y1Float - 1.0f, x0Float, y0Float, x1Float, y1Float, line.color0, line.color1);
		offset = writeLineVertex(gx, offset, x1Float + 1.0f, y1Float + 2.0f, x0Float, y0Float, x1Float, y1Float, line.color0, line.color1);
		return offset;
	}
	if (line.lineRasterCase == GxGpuLineRasterCase::VerticalIncreasing) {
		offset = writeLineVertex(gx, offset, x0Float - 1.0f, y0Float, x0Float, y0Float, x1Float, y1Float, line.color0, line.color1);
		offset = writeLineVertex(gx, offset, x1Float - 1.0f, y1Float + 1.0f, x0Float, y0Float, x1Float, y1Float, line.color0, line.color1);
		offset = writeLineVertex(gx, offset, x0Float + 2.0f, y0Float, x0Float, y0Float, x1Float, y1Float, line.color0, line.color1);
		offset = writeLineVertex(gx, offset, x1Float - 1.0f, y1Float + 1.0f, x0Float, y0Float, x1Float, y1Float, line.color0, line.color1);
		offset = writeLineVertex(gx, offset, x0Float + 2.0f, y0Float, x0Float, y0Float, x1Float, y1Float, line.color0, line.color1);
		offset = writeLineVertex(gx, offset, x1Float + 2.0f, y1Float + 1.0f, x0Float, y0Float, x1Float, y1Float, line.color0, line.color1);
		return offset;
	}
	offset = writeLineVertex(gx, offset, x1Float - 1.0f, y1Float, x0Float, y0Float, x1Float, y1Float, line.color0, line.color1);
	offset = writeLineVertex(gx, offset, x0Float - 1.0f, y0Float + 1.0f, x0Float, y0Float, x1Float, y1Float, line.color0, line.color1);
	offset = writeLineVertex(gx, offset, x1Float + 2.0f, y1Float, x0Float, y0Float, x1Float, y1Float, line.color0, line.color1);
	offset = writeLineVertex(gx, offset, x0Float - 1.0f, y0Float + 1.0f, x0Float, y0Float, x1Float, y1Float, line.color0, line.color1);
	offset = writeLineVertex(gx, offset, x1Float + 2.0f, y1Float, x0Float, y0Float, x1Float, y1Float, line.color0, line.color1);
	offset = writeLineVertex(gx, offset, x0Float + 2.0f, y0Float + 1.0f, x0Float, y0Float, x1Float, y1Float, line.color0, line.color1);
	return offset;
}

void writeTexturedTextureSource(OpenGLES2GxGpuState& gx, size_t offset) {
	static_assert(sizeof(gx.texturedTextureSource) == kGxGpuTextureSourceFloats * sizeof(f32));
	std::memcpy(gx.texturedGeometry.vertices.data() + offset, gx.texturedTextureSource.data(), sizeof(gx.texturedTextureSource));
}

size_t writeTexturedVertex(OpenGLES2GxGpuState& gx, size_t offset, i32 x, i32 y, u32 colorWord) {
	gx.texturedGeometry.vertices[offset] = static_cast<f32>(x);
	gx.texturedGeometry.vertices[offset + 1u] = static_cast<f32>(y);
	gx.texturedGeometry.vertices[offset + 2u] = static_cast<f32>(colorWord & 0xffu);
	gx.texturedGeometry.vertices[offset + 3u] = static_cast<f32>((colorWord >> 8u) & 0xffu);
	gx.texturedGeometry.vertices[offset + 4u] = static_cast<f32>((colorWord >> 16u) & 0xffu);
	writeTexturedTextureSource(gx, offset + kGxGpuTexturedTextureSourceFloatOffset);
	return offset + kGxGpuTexturedVertexFloats;
}

void prepareTexturedUvPlane(OpenGLES2GxGpuState& gx,
	i64 determinant,
	i32 x0,
	i32 y0,
	i32 u0,
	i32 v0,
	i32 x1,
	i32 y1,
	i32 u1,
	i32 v1,
	i32 x2,
	i32 y2,
	i32 u2,
	i32 v2) {
	gx.texturedUvPlane[0] = u0;
	gx.texturedUvPlane[1] = v0;
	gx.texturedUvPlane[2] = u1;
	gx.texturedUvPlane[3] = v1;
	gx.texturedUvPlane[4] = u2;
	gx.texturedUvPlane[5] = v2;
	gxGpuTriangleAttributePlane(gx.texturedUvPlane.data(), 0u, kGxGpuTexturedUvComponents, determinant, x0, y0, x1, y1, x2, y2);
}

size_t appendTexturedTriangle(OpenGLES2GxGpuState& gx,
	size_t vertexFloatCount,
	i64 determinant,
	i32 x0,
	i32 y0,
	u32 color0,
	i32 u0,
	i32 v0,
	i32 x1,
	i32 y1,
	u32 color1,
	i32 u1,
	i32 v1,
	i32 x2,
	i32 y2,
	u32 color2,
	i32 u2,
	i32 v2) {
	prepareTexturedUvPlane(gx, determinant, x0, y0, u0, v0, x1, y1, u1, v1, x2, y2, u2, v2);
	size_t offset = vertexFloatCount;
	offset = writeTexturedVertex(gx, offset, x0, y0, color0);
	offset = writeTexturedVertex(gx, offset, x1, y1, color1);
	offset = writeTexturedVertex(gx, offset, x2, y2, color2);
	for (size_t vertexOffset = vertexFloatCount; vertexOffset < offset; vertexOffset += kGxGpuTexturedVertexFloats) {
		gx.texturedGeometry.vertices[vertexOffset + 5u] = static_cast<f32>(gx.texturedUvPlane[0]);
		gx.texturedGeometry.vertices[vertexOffset + 6u] = static_cast<f32>(gx.texturedUvPlane[1]);
		gx.texturedGeometry.vertices[vertexOffset + 7u] = static_cast<f32>(gx.texturedUvPlane[2]);
		gx.texturedGeometry.vertices[vertexOffset + 8u] = static_cast<f32>(gx.texturedUvPlane[3]);
		gx.texturedGeometry.vertices[vertexOffset + 9u] = static_cast<f32>(gx.texturedUvPlane[4]);
		gx.texturedGeometry.vertices[vertexOffset + 10u] = static_cast<f32>(gx.texturedUvPlane[5]);
	}
	return offset;
}

size_t writeFixedTexturedVertex(OpenGLES2GxGpuState& gx, size_t offset, i32 x, i32 y) {
	gx.texturedGeometry.vertices[offset] = static_cast<f32>(x);
	gx.texturedGeometry.vertices[offset + 1u] = static_cast<f32>(y);
	for (size_t component = 0u; component < kGxGpuTexturedUvComponents; component += 1u) {
		gx.texturedGeometry.vertices[offset + 2u + component] = static_cast<f32>(gx.texturedUvPlane[component]);
		gx.texturedGeometry.vertices[offset + 4u + component] = static_cast<f32>(gx.texturedUvPlane[kGxGpuTexturedUvComponents + component]);
		gx.texturedGeometry.vertices[offset + 6u + component] = static_cast<f32>(gx.texturedUvPlane[kGxGpuTexturedUvComponents * 2u + component]);
	}
	for (size_t component = 0u; component < kGxGpuColorComponents; component += 1u) {
		gx.texturedGeometry.vertices[offset + 8u + component] = static_cast<f32>(gx.colorPlane[component]);
		gx.texturedGeometry.vertices[offset + 11u + component] = static_cast<f32>(gx.colorPlane[kGxGpuColorComponents + component]);
		gx.texturedGeometry.vertices[offset + 14u + component] = static_cast<f32>(gx.colorPlane[kGxGpuColorComponents * 2u + component]);
	}
	writeTexturedTextureSource(gx, offset + kGxGpuFixedTexturedTextureSourceFloatOffset);
	return offset + kGxGpuFixedTexturedVertexFloats;
}

size_t appendTexturedPrimitiveTriangle(OpenGLES2GxGpuState& gx,
	size_t vertexFloatCount,
	bool fixedColor,
	i32 x0,
	i32 y0,
	u32 color0,
	i32 u0,
	i32 v0,
	i32 x1,
	i32 y1,
	u32 color1,
	i32 u1,
	i32 v1,
	i32 x2,
	i32 y2,
	u32 color2,
	i32 u2,
	i32 v2) {
	if (gxGpuTriangleExceedsPrimitiveSize(x0, y0, x1, y1, x2, y2)) {
		return vertexFloatCount;
	}
	const i64 determinant = static_cast<i64>(x1 - x0) * (y2 - y1) - static_cast<i64>(x2 - x1) * (y1 - y0);
	if (determinant == 0) {
		return vertexFloatCount;
	}
	const i32 xShift = gxGpuTriangleRasterShift(x0, x1, x2);
	const i32 yShift = gxGpuTriangleRasterShift(y0, y1, y2);
	x0 += xShift;
	y0 += yShift;
	x1 += xShift;
	y1 += yShift;
	x2 += xShift;
	y2 += yShift;
	if (fixedColor) {
		prepareTexturedUvPlane(gx, determinant, x0, y0, u0, v0, x1, y1, u1, v1, x2, y2, u2, v2);
		gx.colorPlane[0] = color0 & 0xffu;
		gx.colorPlane[1] = (color0 >> 8u) & 0xffu;
		gx.colorPlane[2] = (color0 >> 16u) & 0xffu;
		gx.colorPlane[3] = color1 & 0xffu;
		gx.colorPlane[4] = (color1 >> 8u) & 0xffu;
		gx.colorPlane[5] = (color1 >> 16u) & 0xffu;
		gx.colorPlane[6] = color2 & 0xffu;
		gx.colorPlane[7] = (color2 >> 8u) & 0xffu;
		gx.colorPlane[8] = (color2 >> 16u) & 0xffu;
		gxGpuTriangleAttributePlane(gx.colorPlane.data(), 0u, kGxGpuColorComponents, determinant, x0, y0, x1, y1, x2, y2);
		size_t offset = vertexFloatCount;
		offset = writeFixedTexturedVertex(gx, offset, x0, y0);
		offset = writeFixedTexturedVertex(gx, offset, x1, y1);
		offset = writeFixedTexturedVertex(gx, offset, x2, y2);
		return offset;
	}
	return appendTexturedTriangle(gx,
		vertexFloatCount,
		determinant,
		x0,
		y0,
		color0,
		u0,
		v0,
		x1,
		y1,
		color1,
		u1,
		v1,
		x2,
		y2,
		color2,
		u2,
		v2);
}

size_t appendTexturedPolygon(OpenGLES2GxGpuState& gx, const GxGpuCommandStorage& commandBuffer, u32 commandIndex, size_t vertexFloatCount) {
	const u32 opcode = commandBuffer.commandOpcode[commandIndex];
	const u32 wordStart = commandBuffer.commandWordStart[commandIndex];
	const u32 record = commandBuffer.commandDrawIndex[commandIndex];
	const u32 positionStride = commandBuffer.drawPositionStride[record];
	const u32 colorStride = commandBuffer.drawColorStride[record];
	const u32 drawingOffsetWord = commandBuffer.commandDrawingOffsetWord[commandIndex];
	const i32 dx = gxGpuSigned11(drawingOffsetWord);
	const i32 dy = gxGpuDrawingOffsetY(drawingOffsetWord);
	const bool fixedColor = colorStride != 0u && !gxGpuCommandRawTextureEnabled(opcode);
	const u32 xy0 = commandBuffer.words[wordStart + 1u];
	const u32 xy1 = commandBuffer.words[wordStart + 1u + positionStride];
	const u32 xy2 = commandBuffer.words[wordStart + 1u + positionStride * 2u];
	const u32 color0 = commandBuffer.words[wordStart];
	const u32 color1 = commandBuffer.words[wordStart + colorStride];
	const u32 color2 = commandBuffer.words[wordStart + colorStride * 2u];
	const u32 texture0 = commandBuffer.words[wordStart + 2u];
	const u32 texture1 = commandBuffer.words[wordStart + 2u + positionStride];
	const u32 texture2 = commandBuffer.words[wordStart + 2u + positionStride * 2u];
	size_t offset = appendTexturedPrimitiveTriangle(gx, vertexFloatCount, fixedColor,
		dx + gxGpuSigned11(xy0), dy + gxGpuVertexY(xy0), color0, gxGpuTextureU(texture0), gxGpuTextureV(texture0),
		dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color1, gxGpuTextureU(texture1), gxGpuTextureV(texture1),
		dx + gxGpuSigned11(xy2), dy + gxGpuVertexY(xy2), color2, gxGpuTextureU(texture2), gxGpuTextureV(texture2));
	if (commandBuffer.drawVertexCount[record] == 4u) {
		const u32 xy3 = commandBuffer.words[wordStart + 1u + positionStride * 3u];
		const u32 color3 = commandBuffer.words[wordStart + colorStride * 3u];
		const u32 texture3 = commandBuffer.words[wordStart + 2u + positionStride * 3u];
		offset = appendTexturedPrimitiveTriangle(gx, offset, fixedColor,
			dx + gxGpuSigned11(xy2), dy + gxGpuVertexY(xy2), color2, gxGpuTextureU(texture2), gxGpuTextureV(texture2),
			dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color1, gxGpuTextureU(texture1), gxGpuTextureV(texture1),
			dx + gxGpuSigned11(xy3), dy + gxGpuVertexY(xy3), color3, gxGpuTextureU(texture3), gxGpuTextureV(texture3));
	}
	return offset;
}

size_t appendTexturedRectangle(OpenGLES2GxGpuState& gx, const GxGpuCommandStorage& commandBuffer, u32 commandIndex, size_t vertexFloatCount) {
	const u32 opcode = commandBuffer.commandOpcode[commandIndex];
	const u32 wordStart = commandBuffer.commandWordStart[commandIndex];
	const u32 colorWord = commandBuffer.words[wordStart];
	const u32 textureWord = commandBuffer.words[wordStart + 2u];
	const GxGpuRectangle& rect = readGxGpuRectangle(gx, commandBuffer, commandIndex, opcode);
	if (rect.width == 0u || rect.height == 0u) {
		return vertexFloatCount;
	}
	const u32 drawModeWord = commandBuffer.commandDrawModeWord[commandIndex];
	gxGpuRectangleUvPlane(gx.texturedUvPlane.data(), static_cast<i32>(rect.x0), static_cast<i32>(rect.y0),
		gxGpuTextureU(textureWord), gxGpuTextureV(textureWord), drawModeWord);
	size_t offset = vertexFloatCount;
	offset = writeTexturedVertex(gx, offset, rect.x0, rect.y0, colorWord);
	offset = writeTexturedVertex(gx, offset, rect.x1, rect.y0, colorWord);
	offset = writeTexturedVertex(gx, offset, rect.x0, rect.y1, colorWord);
	offset = writeTexturedVertex(gx, offset, rect.x0, rect.y1, colorWord);
	offset = writeTexturedVertex(gx, offset, rect.x1, rect.y0, colorWord);
	offset = writeTexturedVertex(gx, offset, rect.x1, rect.y1, colorWord);
	for (size_t vertex = vertexFloatCount; vertex < offset; vertex += kGxGpuTexturedVertexFloats)
		for (size_t component = 0u; component < gx.texturedUvPlane.size(); ++component)
			gx.texturedGeometry.vertices[vertex + 5u + component] = static_cast<f32>(gx.texturedUvPlane[component]);
	return offset;
}

size_t writeTransferVertex(f32* vertices, size_t offset, size_t vertexFloatStride, f32 x, f32 y, f32 sourceOffsetX, f32 sourceOffsetY) {
	vertices[offset] = x;
	vertices[offset + 1u] = y;
	vertices[offset + 2u] = sourceOffsetX;
	vertices[offset + 3u] = sourceOffsetY;
	return offset + vertexFloatStride;
}

size_t appendTransferTriangle(OpenGLES2GxGpuState& gx,
	size_t vertexFloatCount,
	f32 x0,
	f32 y0,
	f32 x1,
	f32 y1,
	f32 x2,
	f32 y2,
	f32 sourceOffsetX,
	f32 sourceOffsetY) {
	size_t offset = vertexFloatCount;
	offset = writeTransferVertex(gx.transferVertices.data(), offset, kGxGpuTransferVertexFloats, x0, y0, sourceOffsetX, sourceOffsetY);
	offset = writeTransferVertex(gx.transferVertices.data(), offset, kGxGpuTransferVertexFloats, x1, y1, sourceOffsetX, sourceOffsetY);
	offset = writeTransferVertex(gx.transferVertices.data(), offset, kGxGpuTransferVertexFloats, x2, y2, sourceOffsetX, sourceOffsetY);
	return offset;
}

size_t appendTransferQuad(OpenGLES2GxGpuState& gx, size_t vertexFloatCount, u32 x, u32 y, u32 width, u32 height, u32 u, u32 v) {
	const f32 x0 = static_cast<f32>(x);
	const f32 y0 = static_cast<f32>(y);
	const f32 x1 = static_cast<f32>(x + width);
	const f32 y1 = static_cast<f32>(y + height);
	const f32 sourceOffsetX = static_cast<f32>(u) - x0;
	const f32 sourceOffsetY = static_cast<f32>(v) - y0;
	size_t offset = vertexFloatCount;
	offset = appendTransferTriangle(gx, offset, x0, y0, x1, y0, x0, y1, sourceOffsetX, sourceOffsetY);
	offset = appendTransferTriangle(gx, offset, x0, y1, x1, y0, x1, y1, sourceOffsetX, sourceOffsetY);
	return offset;
}

void uploadGxGpuVramSnapshot(OpenGLES2GxGpuState& gx, std::span<const u8> snapshotBytes) {
	gx.drawTargets.replace();
	gx.backend->setRenderTarget(0, kGxGpuVramXAddressPeriod, gx.vramTextureRows);
	gx.backend->setActiveTextureUnit(GLES2_TEXTURE_UNIT_GX_SCANOUT);
	gx.backend->bindTexture2D(&gx.vramTexture);
	glTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, kGxGpuVramXAddressPeriod, gx.vramTextureRows, GL_RGBA, GL_UNSIGNED_SHORT_4_4_4_4, snapshotBytes.data());
	gx.sampleDirtyRegions.clear();
	gx.sampleDirtyRegions.mark(0, 0, kGxGpuVramXAddressPeriod, gx.vramTextureRows);
	std::copy(snapshotBytes.begin(), snapshotBytes.end(), gx.vramSnapshotScratch.begin());
	gx.snapshotDirtyRect = {};
}

void writeGxGpuVramSnapshotFromReadback(OpenGLES2GxGpuState& gx, const GxGpuVramCopyRect& rect) {
	size_t readbackByteOffset = 0u;
	for (i32 textureRow = rect.top; textureRow < rect.bottom; textureRow += 1) {
		size_t snapshotByteOffset = (static_cast<size_t>(textureRow) * kGxGpuVramXAddressPeriod
			+ static_cast<size_t>(rect.left)) * 2u;
		for (i32 column = rect.left; column < rect.right; column += 1) {
			const u8 highNibble = gx.pixelTransferScratch[readbackByteOffset] / 17u;
			const u8 midHighNibble = gx.pixelTransferScratch[readbackByteOffset + 1u] / 17u;
			const u8 midLowNibble = gx.pixelTransferScratch[readbackByteOffset + 2u] / 17u;
			const u8 lowNibble = gx.pixelTransferScratch[readbackByteOffset + 3u] / 17u;
			gx.vramSnapshotScratch[snapshotByteOffset] = static_cast<u8>((midLowNibble << 4u) | lowNibble);
			gx.vramSnapshotScratch[snapshotByteOffset + 1u] = static_cast<u8>((highNibble << 4u) | midHighNibble);
			snapshotByteOffset += 2u;
			readbackByteOffset += kGxGpuRawVramBytesPerPixel;
		}
	}
}

void readGxGpuVram(OpenGLES2GxGpuState& gx, const GxGpuReadbackRequest& request, u8* pixels) {
	gx.drawTargets.resolveLogical(request.x, request.y, request.width, request.height,
		request.vramYAddressExtensionWord, gx.sampleDirtyRegions, false);
	const u32 pixelCount = request.width * request.height;
	const u32 wordCount = (pixelCount + 1u) >> 1u;
	const u32 packedWidth = wordCount < static_cast<u32>(kGxGpuReadbackPackWidth) ? wordCount : static_cast<u32>(kGxGpuReadbackPackWidth);
	const u32 packedHeight = ((wordCount - 1u) / packedWidth) + 1u;
	gx.backend->setRenderTarget(gx.readbackFramebuffer, static_cast<i32>(packedWidth), static_cast<i32>(packedHeight));
	gx.backend->drawState.disable(GLES2Capability::ScissorTest);
	gx.backend->drawState.disable(GLES2Capability::DepthTest);
	gx.backend->drawState.depthMask(GL_FALSE);
	gx.backend->drawState.disable(GLES2Capability::CullFace);
	gx.backend->drawState.disable(GLES2Capability::Blend);
	gx.backend->drawState.disable(GLES2Capability::Dither);
	gx.backend->drawState.colorMask(GL_TRUE, GL_TRUE, GL_TRUE, GL_TRUE);
	gx.backend->drawState.useProgram(gx.readbackProgram);
	glUniform4i(gx.readbackParamsUniform, static_cast<GLint>(request.x), static_cast<GLint>(request.y), static_cast<GLint>(request.width), static_cast<GLint>(packedWidth));
	glUniform1i(gx.readbackVramYAddressExtensionUniform, static_cast<GLint>(request.vramYAddressExtensionWord));
	gx.backend->setActiveTextureUnit(GLES2_TEXTURE_UNIT_GX_SCANOUT);
	gx.backend->bindTexture2D(&gx.vramTexture);
	gx.backend->drawState.bindBuffer(GL_ARRAY_BUFFER, gx.scanoutVertexBuffer);
	gx.backend->drawState.enableVertexAttribArray(kGxGpuScanoutPositionAttrib);
	gx.backend->drawState.vertexAttribPointer(kGxGpuScanoutPositionAttrib, 2, GL_FLOAT, GL_FALSE, kGxGpuScanoutVertexStride, nullptr);
	glDrawArrays(GL_TRIANGLES, 0, static_cast<GLsizei>(kGxGpuScanoutVertexCount));
	glReadPixels(0, 0, static_cast<GLsizei>(packedWidth), static_cast<GLsizei>(packedHeight), GL_RGBA, GL_UNSIGNED_BYTE, pixels);
}

void completeGxGpuReadback(OpenGLES2GxGpuState& gx, size_t commandLimit, GxGpuReadbackPort& readback) {
	if (!readback.claimReadback(commandLimit)) return;
	const u32 token = readback.token();
	const GxGpuReadbackRequest request{readback.x(), readback.y(), readback.width(), readback.height(), readback.vramYAddressExtensionWord()};
	readGxGpuVram(gx, request, readback.pixelBytes());
	readback.completeReadback(token);
}

template <bool Profile>
void uploadCpuToVramPayload(OpenGLES2GxGpuState& gx,
		const u8* sourceBytes,
		u32 pixelCount,
		GLES2Texture& texture,
		GxCpuToVramUploadProfile* profile) {
	const u32 fullRows = pixelCount >> 10u;
	const u32 lastRowWidth = pixelCount & (static_cast<u32>(kGxGpuVramXAddressPeriod) - 1u);
	gx.backend->setActiveTextureUnit(GLES2_TEXTURE_UNIT_GX_TRANSFER);
	gx.backend->bindTexture2D(&texture);
	if (fullRows != 0u) {
		glTexSubImage2D(
			GL_TEXTURE_2D,
			0,
			0,
			0,
			kGxGpuVramXAddressPeriod,
			static_cast<GLsizei>(fullRows),
			GL_RGBA,
			GL_UNSIGNED_SHORT_4_4_4_4,
			sourceBytes);
		if constexpr (Profile) {
			profile->hostCalls += 1u;
			profile->hostBytes += static_cast<u64>(fullRows)
				* static_cast<u64>(kGxGpuVramXAddressPeriod)
				* kGxGpuCpuUploadBytesPerPixel;
		}
		sourceBytes += static_cast<size_t>(fullRows)
			* static_cast<size_t>(kGxGpuVramXAddressPeriod)
			* kGxGpuCpuUploadBytesPerPixel;
	}
	if (lastRowWidth != 0u) {
		glTexSubImage2D(
			GL_TEXTURE_2D,
			0,
			0,
			static_cast<GLint>(fullRows),
			static_cast<GLsizei>(lastRowWidth),
			1,
			GL_RGBA,
			GL_UNSIGNED_SHORT_4_4_4_4,
			sourceBytes);
		if constexpr (Profile) {
			profile->hostCalls += 1u;
			profile->hostBytes += static_cast<u64>(lastRowWidth) * kGxGpuCpuUploadBytesPerPixel;
		}
	}
}

size_t appendCpuToVramRows(OpenGLES2GxGpuState& gx,
	u32 x, u32 y, u32 sourceRowStart, u32 payloadWidth, u32 rowWidth, u32 rowCount,
	size_t transferVertexFloatCount, u32 vramYAddressExtensionWord, u32 sourcePixelOffset) {
	// Split at both destination wraps and packed-payload texture rows. The
	// fragment stage consumes actual source X/Y, never a large linear index.
	for (u32 row = 0u; row < rowCount; ++row) {
		const u32 targetY = gxGpuVramYAddress(y + sourceRowStart + row, vramYAddressExtensionWord);
		u32 targetX = x;
		u32 pixelIndex = sourcePixelOffset + (sourceRowStart + row) * payloadWidth;
		u32 remaining = rowWidth;
		while (remaining != 0u) {
			const u32 sourceX = pixelIndex & (GX_GPU_VRAM_X_ADDRESS_PERIOD - 1u);
			const u32 sourceY = pixelIndex >> 10u;
			const u32 targetRun = gxGpuVramWrappedWidth(targetX, remaining);
			const u32 run = gxGpuVramWrappedWidth(sourceX, targetRun);
			transferVertexFloatCount = appendTransferQuad(gx, transferVertexFloatCount,
				targetX, targetY, run, 1u, sourceX, sourceY);
			remaining -= run;
			pixelIndex += run;
			targetX = (targetX + run) & (GX_GPU_VRAM_X_ADDRESS_PERIOD - 1u);
		}
	}
	return transferVertexFloatCount;
}

void markGxGpuSampleTextureDirtyLogicalArea(OpenGLES2GxGpuState& gx, u32 x, u32 y, u32 width, u32 height, u32 vramYAddressExtensionWord);
void syncGxGpuSampleTextureLogicalArea(OpenGLES2GxGpuState& gx, u32 x, u32 y, u32 width, u32 height, u32 vramYAddressExtensionWord);
void renderTransferCommands(OpenGLES2GxGpuState& gx,
	size_t vertexFloatCount,
	GLES2Texture& sourceTexture,
	i32 sourceTextureUnit,
	u32 maskBitModeWord,
	bool syncSampleBetweenAliasBands,
	GxGpuTransferProgram& program);
void submitGxGpuPrimitiveBatches(OpenGLES2GxGpuState& gx);

template <bool Profile>
u32 executeCpuToVramUpload(OpenGLES2GxGpuState& gx,
	const GxGpuCommandStorage& commandBuffer,
	u32 commandIndex,
	GxCpuToVramUploadProfile* profile,
	GLES2Texture* preparedTexture = nullptr,
	u32 sourcePixelOffset = 0u) {
	const u32 wordStart = commandBuffer.commandWordStart[commandIndex];
	const u32 xyWord = commandBuffer.words[wordStart + 1u];
	const u32 sizeWord = commandBuffer.words[wordStart + 2u];
	const u32 vramYAddressExtensionWord = commandBuffer.commandVramYAddressExtensionWord[commandIndex];
	const u32 x = gxGpuTransferX(xyWord);
	const u32 y = gxGpuTransferY(xyWord, vramYAddressExtensionWord);
	const u32 width = gxGpuTransferWidth(sizeWord);
	const u32 height = gxGpuTransferHeight(sizeWord);
	const u32 uploadedPixels = gxGpuTransferEmittedPixelCount(width, height, commandBuffer.commandWordCount[commandIndex]);
	const u32 fullRows = (uploadedPixels - (uploadedPixels % width)) / width;
	const u32 lastRowWidth = uploadedPixels % width;
	const u32 uploadHeight = fullRows + (lastRowWidth != 0u ? 1u : 0u);
	gx.drawTargets.resolveLogical(x, y, width, uploadHeight, vramYAddressExtensionWord, gx.sampleDirtyRegions, true);
	const u32 payloadWordStart = wordStart + 3u;
	const u32 maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
	size_t transferVertexFloatCount = 0u;
	if (!gx.drawTargets.enabled()
		&& !gxGpuMaskBitCheckBeforeDraw(maskBitModeWord)
		&& !gxGpuMaskBitSetWhileDrawing(maskBitModeWord)
		&& uploadedPixels == width * height
		&& x + width <= static_cast<u32>(kGxGpuVramXAddressPeriod)
		&& y + height <= (gxGpuVramYAddressMask(vramYAddressExtensionWord) & gx.vramTextureRowMask) + 1u) {
		gx.backend->setRenderTarget(0, kGxGpuVramXAddressPeriod, gx.vramTextureRows);
		gx.backend->setActiveTextureUnit(GLES2_TEXTURE_UNIT_GX_SCANOUT);
		gx.backend->bindTexture2D(&gx.vramTexture);
		if (height > 1u && (width & 3u) != 0u) {
			glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
		}
		glTexSubImage2D(
			GL_TEXTURE_2D,
			0,
			static_cast<GLint>(x),
			static_cast<GLint>(y),
			static_cast<GLsizei>(width),
			static_cast<GLsizei>(height),
			GL_RGBA,
			GL_UNSIGNED_SHORT_4_4_4_4,
			commandBuffer.words.data() + payloadWordStart);
		if constexpr (Profile) {
			profile->hostCalls += 1u;
			profile->hostBytes += static_cast<u64>(uploadedPixels) * kGxGpuCpuUploadBytesPerPixel;
		}
		markGxGpuSampleTextureDirtyLogicalArea(gx, x, y, width, height, vramYAddressExtensionWord);
		return uploadedPixels;
	}
	if (preparedTexture == nullptr) {
		preparedTexture = &gx.cpuUploadTextures[gx.nextCpuUploadTexture];
		gx.nextCpuUploadTexture += 1u;
		if (gx.nextCpuUploadTexture == gx.cpuUploadTextureCount) gx.nextCpuUploadTexture = 0u;
		uploadCpuToVramPayload<Profile>(gx, reinterpret_cast<const u8*>(commandBuffer.words.data() + payloadWordStart),
			uploadedPixels, *preparedTexture, profile);
	}
	if (fullRows != 0u) {
		transferVertexFloatCount = appendCpuToVramRows(gx,
			x,
			y,
			0u,
			width,
			width,
			fullRows,
			transferVertexFloatCount,
			vramYAddressExtensionWord, sourcePixelOffset);
	}
	if (lastRowWidth != 0u) {
		transferVertexFloatCount = appendCpuToVramRows(gx,
			x,
			y,
			fullRows,
			width,
			lastRowWidth,
			1u,
			transferVertexFloatCount,
			vramYAddressExtensionWord, sourcePixelOffset);
	}
	if (gxGpuMaskBitCheckBeforeDraw(maskBitModeWord)) {
		syncGxGpuSampleTextureLogicalArea(gx, x, y, width, uploadHeight, vramYAddressExtensionWord);
	}
	if (transferVertexFloatCount != 0u) {
		renderTransferCommands(gx,
			transferVertexFloatCount,
			*preparedTexture,
			GLES2_TEXTURE_UNIT_GX_TRANSFER,
			maskBitModeWord,
			gxGpuMaskBitCheckBeforeDraw(maskBitModeWord),
			gx.cpuUploadProgram);
	}
	if (gx.vramTextureRows == kGxGpuVramYAddressPeriod) {
		if (fullRows != 0u) {
			markGxGpuSampleTextureDirtyLogicalArea(gx, x, y, width, fullRows, vramYAddressExtensionWord);
		}
		if (lastRowWidth != 0u) {
			markGxGpuSampleTextureDirtyLogicalArea(gx, x, y + fullRows, lastRowWidth, 1u, vramYAddressExtensionWord);
		}
	}
	return uploadedPixels;
}

// Publish every source page before executing any command in this interval.
// Only immutable payload preparation moves: transfer draws, mask tests,
// destination resolves and all dependent primitives still execute in GP0 order.
// The existing texture ring also rotates between intervals; this does not claim
// that an earlier interval has finished on a GLES2 GPU without fences.
template <bool Profile>
void prepareGxGpuCpuUploads(OpenGLES2GxGpuState& gx, const GxGpuCommandStorage& commands, size_t commandLimit) {
	u32 first = gx.processedCommandCount;
	while (first < commandLimit && commands.commandKind[first] != GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM) ++first;
	if (first == commandLimit) return;
	std::chrono::steady_clock::time_point start;
	if constexpr (Profile) start = std::chrono::steady_clock::now();
	u32 pageIndex = 0u, totalPixels = 0u;
	const u8* pageSource = nullptr;
	auto& pages = gx.cpuUploadGeneration.pages;
	pages[pageIndex].textureIndex = gx.nextCpuUploadTexture;
	if constexpr (Profile) pages[pageIndex].profile = {};
	for (u32 index = first; index < commandLimit; ++index) {
		if (commands.commandKind[index] != GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM) continue;
		const u32 wordStart = commands.commandWordStart[index];
		const u32 sizeWord = commands.words[wordStart + 2u];
		const u32 pixels = gxGpuTransferEmittedPixelCount(gxGpuTransferWidth(sizeWord), gxGpuTransferHeight(sizeWord),
			commands.commandWordCount[index]);
		if (pixels > GX_GPU_TRANSFER_MAX_PIXEL_COUNT - totalPixels) {
			auto& page = pages[pageIndex];
			uploadCpuToVramPayload<Profile>(gx, pageSource, totalPixels,
				gx.cpuUploadTextures[page.textureIndex], &page.profile);
			if constexpr (Profile) {
				const auto now = std::chrono::steady_clock::now();
				page.cpuNanoseconds = static_cast<u64>(std::chrono::duration_cast<std::chrono::nanoseconds>(now - start).count());
				start = now;
			}
			const u32 nextTexture = page.textureIndex + 1u;
			++pageIndex;
			pages[pageIndex].textureIndex = nextTexture == gx.cpuUploadTextureCount ? 0u : nextTexture;
			if constexpr (Profile) pages[pageIndex].profile = {};
			totalPixels = 0u;
		}
		gx.cpuUploadGeneration.commands[index] = {pageIndex, totalPixels};
		const auto* source = reinterpret_cast<const u8*>(commands.words.data() + wordStart + 3u);
		if (totalPixels == 0u) {
			// A single-command page can publish directly from immutable command
			// storage, without an extra CPU copy (including a maximal image).
			pageSource = source;
		} else {
			if (pageSource != gx.pixelTransferScratch.data()) {
				std::memcpy(gx.pixelTransferScratch.data(), pageSource, static_cast<size_t>(totalPixels) * sizeof(u16));
				pageSource = gx.pixelTransferScratch.data();
			}
			std::memcpy(gx.pixelTransferScratch.data() + static_cast<size_t>(totalPixels) * sizeof(u16),
				source, static_cast<size_t>(pixels) * sizeof(u16));
		}
		totalPixels += pixels;
	}
	auto& page = pages[pageIndex];
	uploadCpuToVramPayload<Profile>(gx, pageSource, totalPixels,
		gx.cpuUploadTextures[page.textureIndex], &page.profile);
	if constexpr (Profile) page.cpuNanoseconds = static_cast<u64>(std::chrono::duration_cast<std::chrono::nanoseconds>(
		std::chrono::steady_clock::now() - start).count());
	gx.nextCpuUploadTexture = page.textureIndex + 1u;
	if (gx.nextCpuUploadTexture == gx.cpuUploadTextureCount) gx.nextCpuUploadTexture = 0u;
}

void uploadCpuToVram(OpenGLES2GxGpuState& gx, const GxGpuCommandStorage& commandBuffer, u32 commandIndex) {
	GLES2Texture* preparedTexture = nullptr;
	u32 pixelOffset = 0u;
	GxGpuCpuUploadGeneration::Page* page = nullptr;
	if (gx.drawTargets.enabled()) {
		const auto& span = gx.cpuUploadGeneration.commands[commandIndex];
		page = &gx.cpuUploadGeneration.pages[span.pageIndex];
		preparedTexture = &gx.cpuUploadTextures[page->textureIndex];
		pixelOffset = span.pixelOffset;
	}
	if (!gx.backend->profilesGxUploads()) {
		executeCpuToVramUpload<false>(gx, commandBuffer, commandIndex, nullptr, preparedTexture, pixelOffset);
		return;
	}
	GxCpuToVramUploadProfile profile{};
	u64 preparationNanoseconds = 0u;
	if (page != nullptr && pixelOffset == 0u) {
		// Attribute preparation exactly once, to the page's first logical upload.
		profile = page->profile;
		preparationNanoseconds = page->cpuNanoseconds;
	}
	const auto start = std::chrono::steady_clock::now();
	const u32 uploadedPixels = executeCpuToVramUpload<true>(gx, commandBuffer, commandIndex, &profile,
		preparedTexture, pixelOffset);
	const u64 cpuNanoseconds = preparationNanoseconds + static_cast<u64>(std::chrono::duration_cast<std::chrono::nanoseconds>(
		std::chrono::steady_clock::now() - start).count());
	gx.backend->recordGxCpuToVramUpload(
		static_cast<u64>(uploadedPixels) * sizeof(u16),
		profile.hostCalls,
		profile.hostBytes,
		cpuNanoseconds);
}

void copyVramToVramArea(OpenGLES2GxGpuState& gx,
	u32 sourceX,
	u32 sourceY,
	u32 targetX,
	u32 targetY,
	u32 width,
	u32 height,
	u32 maskBitModeWord,
	u32 vramYAddressExtensionWord) {
	size_t transferVertexFloatCount = 0u;
	u32 runSourceY = gxGpuVramYAddress(sourceY, vramYAddressExtensionWord);
	u32 runTargetY = gxGpuVramYAddress(targetY, vramYAddressExtensionWord);
	u32 remainingHeight = height;
	while (remainingHeight != 0u) {
		const u32 sourceRunHeight = gxGpuVramWrappedHeight(runSourceY, remainingHeight, vramYAddressExtensionWord, gx.vramTextureRowMask);
		const u32 targetRunHeight = gxGpuVramWrappedHeight(runTargetY, remainingHeight, vramYAddressExtensionWord, gx.vramTextureRowMask);
		const u32 runHeight = sourceRunHeight < targetRunHeight ? sourceRunHeight : targetRunHeight;
		syncGxGpuSampleTextureLogicalArea(gx, sourceX, runSourceY, width, runHeight, vramYAddressExtensionWord);
		if (gxGpuMaskBitCheckBeforeDraw(maskBitModeWord)) {
			syncGxGpuSampleTextureLogicalArea(gx, targetX, runTargetY, width, runHeight, vramYAddressExtensionWord);
		}
		runSourceY = gxGpuVramYAddress(runSourceY + runHeight, vramYAddressExtensionWord);
		runTargetY = gxGpuVramYAddress(runTargetY + runHeight, vramYAddressExtensionWord);
		remainingHeight -= runHeight;
	}
	runSourceY = gxGpuVramYAddress(sourceY, vramYAddressExtensionWord);
	runTargetY = gxGpuVramYAddress(targetY, vramYAddressExtensionWord);
	remainingHeight = height;
	while (remainingHeight != 0u) {
		const u32 sourceRunHeight = gxGpuVramWrappedHeight(runSourceY, remainingHeight, vramYAddressExtensionWord, gx.vramTextureRowMask);
		const u32 targetRunHeight = gxGpuVramWrappedHeight(runTargetY, remainingHeight, vramYAddressExtensionWord, gx.vramTextureRowMask);
		const u32 runHeight = sourceRunHeight < targetRunHeight ? sourceRunHeight : targetRunHeight;
		u32 runSourceX = sourceX;
		u32 runTargetX = targetX;
		u32 remainingWidth = width;
		while (remainingWidth != 0u) {
			const u32 sourceRunWidth = gxGpuVramWrappedWidth(runSourceX, remainingWidth);
			const u32 targetRunWidth = gxGpuVramWrappedWidth(runTargetX, remainingWidth);
			const u32 runWidth = sourceRunWidth < targetRunWidth ? sourceRunWidth : targetRunWidth;
			transferVertexFloatCount = appendTransferQuad(gx, transferVertexFloatCount, runTargetX, runTargetY, runWidth, runHeight, runSourceX, runSourceY);
			runSourceX = (runSourceX + runWidth) & (static_cast<u32>(kGxGpuVramXAddressPeriod) - 1u);
			runTargetX = (runTargetX + runWidth) & (static_cast<u32>(kGxGpuVramXAddressPeriod) - 1u);
			remainingWidth -= runWidth;
		}
		runSourceY = gxGpuVramYAddress(runSourceY + runHeight, vramYAddressExtensionWord);
		runTargetY = gxGpuVramYAddress(runTargetY + runHeight, vramYAddressExtensionWord);
		remainingHeight -= runHeight;
	}
	if (transferVertexFloatCount != 0u) {
		gx.backend->drawState.useProgram(gx.transferProgram.id);
		renderTransferCommands(gx,
			transferVertexFloatCount,
			gx.vramSampleTexture,
			GLES2_TEXTURE_UNIT_GX_SAMPLE,
			maskBitModeWord,
			true,
			gx.transferProgram);
	}
	if (gx.vramTextureRows == kGxGpuVramYAddressPeriod) {
		markGxGpuSampleTextureDirtyLogicalArea(gx, targetX, targetY, width, height, vramYAddressExtensionWord);
	}
}

void copyVramToVram(OpenGLES2GxGpuState& gx, const GxGpuCommandStorage& commandBuffer, u32 commandIndex) {
	const u32 wordStart = commandBuffer.commandWordStart[commandIndex];
	const u32 sourceWord = commandBuffer.words[wordStart + 1u];
	const u32 targetWord = commandBuffer.words[wordStart + 2u];
	const u32 sizeWord = commandBuffer.words[wordStart + 3u];
	const u32 vramYAddressExtensionWord = commandBuffer.commandVramYAddressExtensionWord[commandIndex];
	const u32 sourceX = gxGpuTransferX(sourceWord);
	const u32 sourceY = gxGpuTransferY(sourceWord, vramYAddressExtensionWord);
	const u32 targetX = gxGpuTransferX(targetWord);
	const u32 targetY = gxGpuTransferY(targetWord, vramYAddressExtensionWord);
	const u32 width = gxGpuTransferWidth(sizeWord);
	const u32 height = gxGpuTransferHeight(sizeWord);
	const u32 maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
	gx.drawTargets.resolveLogical(targetX, targetY, width, height, vramYAddressExtensionWord, gx.sampleDirtyRegions, true);
	if (gxGpuVramCopyNeedsChunking(
		sourceX,
		sourceY,
		targetX,
		targetY,
		width,
		height,
		vramYAddressExtensionWord,
		gx.vramTextureRowMask
	)) {
		const u32 chunkHeight = gxGpuVramCopyChunkHeight(
			sourceY,
			targetY,
			height,
			vramYAddressExtensionWord,
			gx.vramTextureRowMask);
		for (u32 chunkTargetY = targetY; chunkTargetY < targetY + height; chunkTargetY += chunkHeight) {
			const u32 chunkSourceY = sourceY + (chunkTargetY - targetY);
			const u32 remainingHeight = targetY + height - chunkTargetY;
			const u32 currentChunkHeight = chunkHeight < remainingHeight ? chunkHeight : remainingHeight;
			copyVramToVramArea(gx, sourceX, chunkSourceY, targetX, chunkTargetY, width, currentChunkHeight, maskBitModeWord, vramYAddressExtensionWord);
		}
		return;
	}
	copyVramToVramArea(gx, sourceX, sourceY, targetX, targetY, width, height, maskBitModeWord, vramYAddressExtensionWord);
}

bool gxGpuVramCopyRectsOverlap(OpenGLES2GxGpuState& gx, const GxGpuVramCopyRect& a, const GxGpuVramCopyRect& b, u32 vramYAddressExtensionWord) {
	if (a.right <= a.left || a.bottom <= a.top) {
		return false;
	}
	return gxGpuVramLogicalAreaOverlapsBounds(
		static_cast<u32>(a.left),
		static_cast<u32>(a.top),
		static_cast<u32>(a.right - a.left),
		static_cast<u32>(a.bottom - a.top),
		b.left,
		b.top,
		b.right,
		b.bottom,
		vramYAddressExtensionWord,
		gx.vramTextureRowMask);
}

void clipGxGpuVramCopyRectToDrawingArea(GxGpuVramCopyRect& rect, u32 topLeftWord, u32 bottomRightWord, u32 vramYAddressExtensionWord) {
	const i32 drawingLeft = static_cast<i32>(gxGpuDrawingAreaLeft(topLeftWord, bottomRightWord));
	const i32 drawingTop = static_cast<i32>(gxGpuDrawingAreaTop(topLeftWord, bottomRightWord, vramYAddressExtensionWord));
	const i32 drawingRight = static_cast<i32>(gxGpuDrawingAreaRightExclusive(topLeftWord, bottomRightWord));
	const i32 drawingBottom = static_cast<i32>(gxGpuDrawingAreaBottomExclusive(topLeftWord, bottomRightWord, vramYAddressExtensionWord));
	if (rect.left < drawingLeft) {
		rect.left = drawingLeft;
	}
	if (rect.top < drawingTop) {
		rect.top = drawingTop;
	}
	if (rect.right > drawingRight) {
		rect.right = drawingRight;
	}
	if (rect.bottom > drawingBottom) {
		rect.bottom = drawingBottom;
	}
	if (rect.right < rect.left) {
		rect.right = rect.left;
	}
	if (rect.bottom < rect.top) {
		rect.bottom = rect.top;
	}
}

void prepareGxGpuLineSegment(
	GxGpuPreparedRasterPrimitive& line,
	i32 x0,
	i32 y0,
	u32 color0,
	i32 x1,
	i32 y1,
	u32 color1,
	u32 topLeftWord,
	u32 bottomRightWord,
	u32 vramYAddressExtensionWord) {
	if (gxGpuSegmentExceedsPrimitiveSize(x0, y0, x1, y1)) {
		line.emitsVertices = false;
		resetGxGpuVramCopyRect(line.clippedBounds);
		return;
	}
	const i32 absDx = x0 < x1 ? x1 - x0 : x0 - x1;
	const i32 absDy = y0 < y1 ? y1 - y0 : y0 - y1;
	if (x0 > x1) {
		const i32 swapX = x0;
		const i32 swapY = y0;
		const u32 swapColor = color0;
		x0 = x1;
		y0 = y1;
		color0 = color1;
		x1 = swapX;
		y1 = swapY;
		color1 = swapColor;
	}
	const i32 xShift = (x0 < x1 ? x0 : x1) < -(GX_GPU_VERTEX_COORD_PERIOD >> 1) ? GX_GPU_VERTEX_COORD_PERIOD : 0;
	const i32 yShift = (y0 < y1 ? y0 : y1) < -(GX_GPU_VERTEX_COORD_PERIOD >> 1) ? GX_GPU_VERTEX_COORD_PERIOD : 0;
	x0 += xShift;
	y0 += yShift;
	x1 += xShift;
	y1 += yShift;
	line.x0 = x0;
	line.y0 = y0;
	line.x1 = x1;
	line.y1 = y1;
	line.color0 = color0;
	line.color1 = color1;
	line.emitsVertices = true;
	if (absDx >= absDy) {
		const i32 minimumY = y0 < y1 ? y0 : y1;
		const i32 maximumY = y0 < y1 ? y1 : y0;
		line.lineRasterCase = GxGpuLineRasterCase::HorizontalMajor;
		line.clippedBounds.left = x0;
		line.clippedBounds.top = minimumY - 1;
		line.clippedBounds.right = x1 + 2;
		line.clippedBounds.bottom = maximumY + 3;
	} else {
		const i32 minimumX = x0 < x1 ? x0 : x1;
		const i32 maximumX = x0 < x1 ? x1 : x0;
		line.clippedBounds.left = minimumX - 1;
		line.clippedBounds.right = maximumX + 3;
		if (y0 < y1) {
			line.lineRasterCase = GxGpuLineRasterCase::VerticalIncreasing;
			line.clippedBounds.top = y0;
			line.clippedBounds.bottom = y1 + 2;
		} else {
			line.lineRasterCase = GxGpuLineRasterCase::VerticalDecreasing;
			line.clippedBounds.top = y1;
			line.clippedBounds.bottom = y0 + 2;
		}
	}
	clipGxGpuVramCopyRectToDrawingArea(line.clippedBounds, topLeftWord, bottomRightWord, vramYAddressExtensionWord);
	line.emitsVertices = line.clippedBounds.right > line.clippedBounds.left
		&& line.clippedBounds.bottom > line.clippedBounds.top;
}

void prepareGxGpuSolidRectangle(
	OpenGLES2GxGpuState& gx,
	GxGpuPreparedRasterPrimitive& rectangle,
	const GxGpuCommandStorage& commandBuffer,
	u32 commandIndex,
	u32 topLeftWord,
	u32 bottomRightWord,
	u32 vramYAddressExtensionWord) {
	const u32 opcode = commandBuffer.commandOpcode[commandIndex];
	const GxGpuRectangle& source = readGxGpuRectangle(gx, commandBuffer, commandIndex, opcode);
	rectangle.emitsVertices = source.width != 0u && source.height != 0u;
	if (!rectangle.emitsVertices) {
		resetGxGpuVramCopyRect(rectangle.clippedBounds);
		return;
	}
	rectangle.x0 = static_cast<i32>(source.x0);
	rectangle.y0 = static_cast<i32>(source.y0);
	rectangle.x1 = static_cast<i32>(source.x1);
	rectangle.y1 = static_cast<i32>(source.y1);
	rectangle.color0 = commandBuffer.words[commandBuffer.commandWordStart[commandIndex]];
	rectangle.clippedBounds.left = rectangle.x0;
	rectangle.clippedBounds.top = rectangle.y0;
	rectangle.clippedBounds.right = rectangle.x1;
	rectangle.clippedBounds.bottom = rectangle.y1;
	clipGxGpuVramCopyRectToDrawingArea(rectangle.clippedBounds, topLeftWord, bottomRightWord, vramYAddressExtensionWord);
	rectangle.emitsVertices = rectangle.clippedBounds.right > rectangle.clippedBounds.left
		&& rectangle.clippedBounds.bottom > rectangle.clippedBounds.top;
}

void markGxGpuSampleTextureDirtyArea(OpenGLES2GxGpuState& gx, i32 left, i32 top, i32 right, i32 bottom) {
	if (right <= left || bottom <= top) {
		return;
	}
	includeGxGpuVramCopyRect(gx.snapshotDirtyRect, {left, top, right, bottom});
	gx.sampleDirtyRegions.mark(left, top, right, bottom);
}

void markGxGpuSampleTextureDirtyLogicalArea(OpenGLES2GxGpuState& gx, u32 x, u32 y, u32 width, u32 height, u32 vramYAddressExtensionWord) {
	const u32 yAddressMask = gxGpuVramYAddressMask(vramYAddressExtensionWord) & gx.vramTextureRowMask;
	u32 rowY = y & yAddressMask;
	u32 remainingHeight = height;
	while (remainingHeight != 0u) {
		const u32 runHeight = gxGpuVramWrappedHeight(
			rowY,
			remainingHeight,
			vramYAddressExtensionWord,
			gx.vramTextureRowMask);
		u32 columnX = x & (GX_GPU_VRAM_X_ADDRESS_PERIOD - 1u);
		u32 remainingWidth = width;
		while (remainingWidth != 0u) {
			const u32 runWidth = gxGpuVramWrappedWidth(columnX, remainingWidth);
			markGxGpuSampleTextureDirtyArea(gx,
				static_cast<i32>(columnX),
				static_cast<i32>(rowY),
				static_cast<i32>(columnX + runWidth),
				static_cast<i32>(rowY + runHeight));
			columnX = (columnX + runWidth) & (GX_GPU_VRAM_X_ADDRESS_PERIOD - 1u);
			remainingWidth -= runWidth;
		}
		rowY = (rowY + runHeight) & yAddressMask;
		remainingHeight -= runHeight;
	}
}

void copyGxGpuVramAreaToSampleTexture(OpenGLES2GxGpuState& gx, i32 left, i32 top, i32 right, i32 bottom) {
	if (right <= left || bottom <= top) {
		return;
	}
	gx.sampleCopy.copy(*gx.backend, gx.vramTexture, left, top, right, bottom);
}

bool syncGxGpuSampleTextureArea(OpenGLES2GxGpuState& gx, i32 left, i32 top, i32 right, i32 bottom) {
	return gx.sampleDirtyRegions.consume(left, top, right, bottom,
		[&](i32 copyLeft, i32 copyTop, i32 copyRight, i32 copyBottom) {
			copyGxGpuVramAreaToSampleTexture(gx, copyLeft, copyTop, copyRight, copyBottom);
		});
}

void syncGxGpuSampleTextureLogicalArea(OpenGLES2GxGpuState& gx, u32 x, u32 y, u32 width, u32 height, u32 vramYAddressExtensionWord) {
	gx.drawTargets.resolveLogical(x, y, width, height, vramYAddressExtensionWord, gx.sampleDirtyRegions, false);
	const u32 yAddressMask = gxGpuVramYAddressMask(vramYAddressExtensionWord) & gx.vramTextureRowMask;
	u32 rowY = y & yAddressMask;
	u32 remainingHeight = height;
	while (remainingHeight != 0u) {
		const u32 runHeight = gxGpuVramWrappedHeight(
			rowY,
			remainingHeight,
			vramYAddressExtensionWord,
			gx.vramTextureRowMask);
		u32 columnX = x & (GX_GPU_VRAM_X_ADDRESS_PERIOD - 1u);
		u32 remainingWidth = width;
		while (remainingWidth != 0u) {
			const u32 runWidth = gxGpuVramWrappedWidth(columnX, remainingWidth);
			syncGxGpuSampleTextureArea(gx,
				static_cast<i32>(columnX),
				static_cast<i32>(rowY),
				static_cast<i32>(columnX + runWidth),
				static_cast<i32>(rowY + runHeight));
			columnX = (columnX + runWidth) & (GX_GPU_VRAM_X_ADDRESS_PERIOD - 1u);
			remainingWidth -= runWidth;
		}
		rowY = (rowY + runHeight) & yAddressMask;
		remainingHeight -= runHeight;
	}
}

template <typename BindDrawState>
void drawGxGpuLogicalVramArea(OpenGLES2GxGpuState& gx,
	const GxGpuVramCopyRect& rect, GLint firstVertex, GLsizei vertexCount,
	bool textureBarrier, bool syncSampleBetweenAliasBands, bool samplesDestination,
	GxGpuRasterProgram& program, u32 blendMode, GLint logicalYBaseUniform,
	const BindDrawState& bindDrawState) {
	if (rect.right <= rect.left || rect.bottom <= rect.top) return;
	const i32 firstBandBase = (rect.top / gx.vramTextureRows) * gx.vramTextureRows;
	for (i32 bandBase = firstBandBase; bandBase < rect.bottom; bandBase += gx.vramTextureRows) {
		const GxGpuVramCopyRect physical{rect.left, std::max(rect.top, bandBase) - bandBase,
			rect.right, std::min(rect.bottom, bandBase + gx.vramTextureRows) - bandBase};
		if (gx.vramTextureRows != kGxGpuVramYAddressPeriod && syncSampleBetweenAliasBands) {
			gx.drawTargets.resolve(physical, gx.sampleDirtyRegions, false);
			syncGxGpuSampleTextureArea(gx, physical.left, physical.top, physical.right, physical.bottom);
		}
		gx.drawTargets.select(physical, gx.sampleDirtyRegions);
		if (gx.drawTargets.enabled() && samplesDestination) gx.drawTargets.synchronizeDestination(physical);
		bindDrawState();
		const auto& target = gx.drawTargets.bounds();
		gx.backend->drawState.enable(GLES2Capability::ScissorTest);
		if (gx.vramTextureRows != kGxGpuVramYAddressPeriod) {
			gx.backend->drawState.viewport(-target.left, -target.top - bandBase, kGxGpuVramXAddressPeriod, kGxGpuVramYAddressPeriod);
			glUniform1i(logicalYBaseUniform, bandBase);
		}
		gx.backend->drawState.scissor(physical.left - target.left, physical.top - target.top,
			physical.right - physical.left, physical.bottom - physical.top);
		if (textureBarrier) gx.backend->textureBarrier();
		if (program.hardwareBlending) {
			if (program.twoPassTexturing) {
				gx.backend->drawState.disable(GLES2Capability::Blend); glUniform1i(program.blendClassUniform, 0);
				glDrawArrays(GL_TRIANGLES, firstVertex, vertexCount);
			}
			gx.drawTargets.bindHardwareBlend(blendMode);
			if (program.twoPassTexturing) glUniform1i(program.blendClassUniform, 1);
		}
		glDrawArrays(GL_TRIANGLES, firstVertex, vertexCount);
		if (gx.drawTargets.enabled()) {
			gx.drawTargets.markDrawn(physical);
			includeGxGpuVramCopyRect(gx.snapshotDirtyRect, physical);
		} else markGxGpuSampleTextureDirtyArea(gx, physical.left, physical.top, physical.right, physical.bottom);
	}
}

void setGxGpuVertexBoundsRect(
	GxGpuRasterKind rasterKind,
	GxGpuVramCopyRect& rect,
	const f32* vertices,
	size_t vertexFloatStart,
	size_t vertexFloatEnd,
	size_t vertexFloatStride,
	u32 topLeftWord,
	u32 bottomRightWord,
	u32 vramYAddressExtensionWord) {
	resetGxGpuVramCopyRect(rect);
	for (size_t offset = vertexFloatStart; offset < vertexFloatEnd; offset += vertexFloatStride) {
		includeGxGpuVramCopyVertex(rect, static_cast<i32>(vertices[offset]), static_cast<i32>(vertices[offset + 1u]));
	}
	if (rasterKind == GxGpuRasterKind::Rectangle) {
		rect.right -= 1;
		rect.bottom -= 1;
	}
	clipGxGpuVramCopyRectToDrawingArea(rect, topLeftWord, bottomRightWord, vramYAddressExtensionWord);
}

template <bool BatchSourceReads = false>
u32 prepareGxGpuTexturedSourceReads(OpenGLES2GxGpuState& gx,
	const GxGpuCommandStorage& commandBuffer,
	u32 commandIndex,
	size_t vertexFloatStart,
	size_t vertexFloatEnd,
	const GxGpuVramCopyRect& commandRect,
	const GxGpuVramCopyRect& batchRect,
	bool fixedColor) {
	submitGxGpuPrimitiveBatches(gx);
	if (commandRect.right <= commandRect.left || commandRect.bottom <= commandRect.top) return 0u;
	const u32 wordStart = commandBuffer.commandWordStart[commandIndex];
	const u32 textureWord = commandBuffer.words[wordStart + 2u];
	const u32 drawModeWord = commandBuffer.commandDrawModeWord[commandIndex];
	const u32 vramYAddressExtensionWord = commandBuffer.commandVramYAddressExtensionWord[commandIndex];
	const u32 textureMode = gxGpuDrawModeTextureMode(drawModeWord);
	const u32 pageX = gxGpuDrawModeTexturePageBaseX(drawModeWord);
	const u32 pageY = gxGpuDrawModeTexturePageBaseY(drawModeWord, vramYAddressExtensionWord);
	GxGpuVramCopyRect& rect = gx.vramCopyRectScratch;
	resetGxGpuVramCopyRect(rect);
	const size_t vertexFloatStride = fixedColor ? kGxGpuFixedTexturedVertexFloats : kGxGpuTexturedVertexFloats;
	const size_t planeOffset = fixedColor ? 2u : 5u;
	const bool rectangle = commandBuffer.commandKind[commandIndex] == GX_GPU_COMMAND_DRAW_RECTANGLE;
	// Keep each triangle's UV interval unwrapped until its extent is known.
	// Wrapped endpoints alone omit texels on either side of a 255->0 crossing.
	for (size_t triangle = vertexFloatStart; triangle < vertexFloatEnd; triangle += vertexFloatStride * 3u) {
		const i32 originX = rectangle ? std::clamp(static_cast<i32>(gx.texturedGeometry.vertices[triangle]), commandRect.left, commandRect.right - 1) : static_cast<i32>(gx.texturedGeometry.vertices[triangle]);
		const i32 originY = rectangle ? std::clamp(static_cast<i32>(gx.texturedGeometry.vertices[triangle + 1u]), commandRect.top, commandRect.bottom - 1) : static_cast<i32>(gx.texturedGeometry.vertices[triangle + 1u]);
		const i64 ux = gxGpuTriangleAttributeSignedStep(static_cast<u32>(gx.texturedGeometry.vertices[triangle + planeOffset + 2u]));
		const i64 vx = gxGpuTriangleAttributeSignedStep(static_cast<u32>(gx.texturedGeometry.vertices[triangle + planeOffset + 3u]));
		const i64 uy = gxGpuTriangleAttributeSignedStep(static_cast<u32>(gx.texturedGeometry.vertices[triangle + planeOffset + 4u]));
		const i64 vy = gxGpuTriangleAttributeSignedStep(static_cast<u32>(gx.texturedGeometry.vertices[triangle + planeOffset + 5u]));
		const i64 u0 = (static_cast<i64>(gx.texturedGeometry.vertices[triangle + planeOffset]) + ux * originX + uy * originY) & GX_GPU_TRIANGLE_ATTRIBUTE_ACCUMULATOR_MASK;
		const i64 v0 = (static_cast<i64>(gx.texturedGeometry.vertices[triangle + planeOffset + 1u]) + vx * originX + vy * originY) & GX_GPU_TRIANGLE_ATTRIBUTE_ACCUMULATOR_MASK;
		for (size_t vertex = 0u; vertex < 3u; ++vertex) {
			const size_t offset = triangle + vertex * vertexFloatStride;
			const i32 x = rectangle ? std::clamp(static_cast<i32>(gx.texturedGeometry.vertices[offset]), commandRect.left, commandRect.right - 1) : static_cast<i32>(gx.texturedGeometry.vertices[offset]);
			const i32 y = rectangle ? std::clamp(static_cast<i32>(gx.texturedGeometry.vertices[offset + 1u]), commandRect.top, commandRect.bottom - 1) : static_cast<i32>(gx.texturedGeometry.vertices[offset + 1u]);
			const i32 u = static_cast<i32>((u0 + ux * (x - originX) + uy * (y - originY)) >> GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS);
			const i32 v = static_cast<i32>((v0 + vx * (x - originX) + vy * (y - originY)) >> GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS);
			includeGxGpuVramCopyVertex(rect, u, v);
		}
	}
	const bool completeTexturePage = commandBuffer.commandTextureWindowWord[commandIndex] != 0u
		|| rect.left < 0
		|| rect.top < 0
		|| rect.right > static_cast<i32>(kGxGpuTexturePageCoordSize)
		|| rect.bottom > static_cast<i32>(kGxGpuTexturePageCoordSize);
	u32 sourceX;
	u32 sourceY;
	u32 sourceWidth;
	u32 sourceHeight;
	if (textureMode == 0u) {
		if (completeTexturePage) {
			sourceX = pageX;
			sourceY = pageY;
			sourceWidth = kGxGpuTexturePage4BitWidthWords;
			sourceHeight = kGxGpuTexturePageCoordSize;
		} else {
			const u32 wordLeft = static_cast<u32>(rect.left) >> 2u;
			const u32 wordRight = static_cast<u32>(rect.right + 3) >> 2u;
			sourceX = pageX + wordLeft;
			sourceY = pageY + static_cast<u32>(rect.top);
			sourceWidth = wordRight - wordLeft;
			sourceHeight = static_cast<u32>(rect.bottom - rect.top);
		}
	} else if (textureMode == 1u) {
		if (completeTexturePage) {
			sourceX = pageX;
			sourceY = pageY;
			sourceWidth = kGxGpuTexturePage8BitWidthWords;
			sourceHeight = kGxGpuTexturePageCoordSize;
		} else {
			const u32 wordLeft = static_cast<u32>(rect.left) >> 1u;
			const u32 wordRight = static_cast<u32>(rect.right + 1) >> 1u;
			sourceX = pageX + wordLeft;
			sourceY = pageY + static_cast<u32>(rect.top);
			sourceWidth = wordRight - wordLeft;
			sourceHeight = static_cast<u32>(rect.bottom - rect.top);
		}
	} else if (completeTexturePage) {
		sourceX = pageX;
		sourceY = pageY;
		sourceWidth = kGxGpuTexturePageCoordSize;
		sourceHeight = kGxGpuTexturePageCoordSize;
	} else {
		sourceX = pageX + static_cast<u32>(rect.left);
		sourceY = pageY + static_cast<u32>(rect.top);
		sourceWidth = static_cast<u32>(rect.right - rect.left);
		sourceHeight = static_cast<u32>(rect.bottom - rect.top);
	}
	u32 overlaps = 0u;
	if (gxGpuVramLogicalAreaOverlapsBounds(sourceX, sourceY, sourceWidth, sourceHeight, commandRect.left, commandRect.top, commandRect.right, commandRect.bottom, vramYAddressExtensionWord, gx.vramTextureRowMask)) overlaps |= GX_GPU_TEXTURE_SOURCE_COMMAND_OVERLAP;
	if (gxGpuVramLogicalAreaOverlapsBounds(sourceX, sourceY, sourceWidth, sourceHeight, batchRect.left, batchRect.top, batchRect.right, batchRect.bottom, vramYAddressExtensionWord, gx.vramTextureRowMask)) overlaps |= GX_GPU_TEXTURE_SOURCE_BATCH_OVERLAP;
	const u32 clutX = gxGpuTextureClutBaseX(textureWord);
	const u32 clutY = gxGpuTextureClutBaseY(textureWord, vramYAddressExtensionWord);
	const u32 clutWidth = textureMode == 0u ? GX_GPU_CLUT_4BIT_WORDS : GX_GPU_CLUT_8BIT_WORDS;
	if (textureMode < 2u) {
		if (gxGpuVramLogicalAreaOverlapsBounds(clutX, clutY, clutWidth, 1u, commandRect.left, commandRect.top, commandRect.right, commandRect.bottom, vramYAddressExtensionWord, gx.vramTextureRowMask)) overlaps |= GX_GPU_TEXTURE_SOURCE_COMMAND_OVERLAP;
		if (gxGpuVramLogicalAreaOverlapsBounds(clutX, clutY, clutWidth, 1u, batchRect.left, batchRect.top, batchRect.right, batchRect.bottom, vramYAddressExtensionWord, gx.vramTextureRowMask)) overlaps |= GX_GPU_TEXTURE_SOURCE_BATCH_OVERLAP;
	}
	if constexpr (BatchSourceReads) {
		// A dependent command is not admitted until its preceding batch has
		// drawn. Self-reading primitives retain immediate per-triangle reads.
		if (overlaps == 0u) {
			gx.texturedSourceReads.markLogical(sourceX, sourceY, sourceWidth, sourceHeight,
				vramYAddressExtensionWord, gx.vramTextureRowMask);
			if (textureMode < 2u) gx.texturedSourceReads.markLogical(clutX, clutY, clutWidth, 1u,
				vramYAddressExtensionWord, gx.vramTextureRowMask);
		}
	} else {
		syncGxGpuSampleTextureLogicalArea(gx, sourceX, sourceY, sourceWidth, sourceHeight, vramYAddressExtensionWord);
		if (textureMode < 2u) syncGxGpuSampleTextureLogicalArea(gx, clutX, clutY, clutWidth, 1u, vramYAddressExtensionWord);
	}
	return overlaps;
}

void writePrimitiveUniforms(GxGpuPrimitiveProgram& program,
	bool blendEnabled, u32 blendMode, u32 maskBitModeWord, bool ditherEnabled,
	u32 skippedLineParity, bool polygon) {
	const std::array<GLint, 7> state{
		blendEnabled ? 1 : 0, static_cast<GLint>(blendMode),
		gxGpuMaskBitCheckBeforeDraw(maskBitModeWord) ? 1 : 0,
		gxGpuMaskBitSetWhileDrawing(maskBitModeWord) ? 1 : 0,
		ditherEnabled ? 1 : 0, static_cast<GLint>(skippedLineParity), polygon ? 1 : 0,
	};
	if (program.uniformStateValid && program.uniformState == state) return;
	const std::array<GLint, 6> locations{program.blendEnableUniform, program.blendModeUniform,
		program.checkMaskBitUniform, program.setMaskBitUniform, program.ditherEnableUniform,
		program.skippedLineParityUniform};
	for (size_t i = 0; i < locations.size(); ++i)
		if (!program.uniformStateValid || program.uniformState[i] != state[i]) glUniform1i(locations[i], state[i]);
	if (!program.uniformStateValid || program.uniformState[6] != state[6])
		glUniform1f(program.rasterPhaseUniform, polygon ? 0.5f : 0.0f);
	program.uniformState = state;
	program.uniformStateValid = true;
}

void writeTexturedUniforms(GxGpuTexturedProgram& program, const GxGpuCommandStorage& commandBuffer, u32 commandIndex) {
	const u32 opcode = commandBuffer.commandOpcode[commandIndex];
	const u32 drawModeWord = commandBuffer.commandDrawModeWord[commandIndex];
	const u32 textureWindowWord = commandBuffer.commandTextureWindowWord[commandIndex];
	const u32 maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
	const bool polygon = commandBuffer.commandKind[commandIndex] == GX_GPU_COMMAND_DRAW_POLYGON;
	std::array<GLint, 13> state{
		gxGpuMaskBitSetWhileDrawing(maskBitModeWord) ? 1 : 0,
		static_cast<GLint>(commandBuffer.commandSkippedLineParity[commandIndex]), polygon ? 1 : 0,
	};
	if (!program.opaqueWordOutput) {
		state[3] = static_cast<GLint>(gxGpuTextureWindowAndX(textureWindowWord));
		state[4] = static_cast<GLint>(gxGpuTextureWindowAndY(textureWindowWord));
		state[5] = static_cast<GLint>(gxGpuTextureWindowOrX(textureWindowWord));
		state[6] = static_cast<GLint>(gxGpuTextureWindowOrY(textureWindowWord));
		state[7] = static_cast<GLint>(gxGpuDrawModeTextureMode(drawModeWord));
		state[8] = gxGpuCommandRawTextureEnabled(opcode) ? 1 : 0;
		state[9] = gxGpuCommandSemiTransparencyEnabled(opcode) ? 1 : 0;
		state[10] = static_cast<GLint>(gxGpuDrawModeTransparencyMode(drawModeWord));
		state[11] = gxGpuMaskBitCheckBeforeDraw(maskBitModeWord) ? 1 : 0;
		state[12] = polygon && gxGpuDitheredPolygon(drawModeWord, opcode) ? 1 : 0;
	}
	if (program.uniformStateValid && program.uniformState == state) return;
	if (!program.uniformStateValid || program.uniformState[0] != state[0]) glUniform1i(program.setMaskBitUniform, state[0]);
	if (!program.uniformStateValid || program.uniformState[1] != state[1]) glUniform1i(program.skippedLineParityUniform, state[1]);
	if (!program.uniformStateValid || program.uniformState[2] != state[2]) glUniform1f(program.rasterPhaseUniform, polygon ? 0.5f : 0.0f);
	if (!program.opaqueWordOutput) {
		if (!program.uniformStateValid || program.uniformState[3] != state[3] || program.uniformState[4] != state[4])
			glUniform2i(program.textureWindowAndUniform, state[3], state[4]);
		if (!program.uniformStateValid || program.uniformState[5] != state[5] || program.uniformState[6] != state[6])
			glUniform2i(program.textureWindowOrUniform, state[5], state[6]);
		const std::array<GLint, 6> locations{program.textureModeUniform, program.rawTextureUniform,
			program.blendEnableUniform, program.blendModeUniform, program.checkMaskBitUniform, program.ditherEnableUniform};
		for (size_t i = 0; i < locations.size(); ++i)
			if (!program.uniformStateValid || program.uniformState[i + 7] != state[i + 7]) glUniform1i(locations[i], state[i + 7]);
	}
	program.uniformState = state;
	program.uniformStateValid = true;
}

void writeTransferUniforms(GxGpuTransferProgram& program, i32 sourceTextureUnit, u32 maskBitModeWord) {
	if (program.sourceTextureUnit != sourceTextureUnit) {
		glUniform1i(program.sourceUniform, sourceTextureUnit);
		program.sourceTextureUnit = sourceTextureUnit;
	}
	if (!program.maskBitModeValid || program.maskBitModeWord != maskBitModeWord) {
		glUniform1i(program.checkMaskBitUniform, gxGpuMaskBitCheckBeforeDraw(maskBitModeWord) ? 1 : 0);
		glUniform1i(program.setMaskBitUniform, gxGpuMaskBitSetWhileDrawing(maskBitModeWord) ? 1 : 0);
		program.maskBitModeWord = maskBitModeWord;
		program.maskBitModeValid = true;
	}
}

void renderNewSolidCommands(OpenGLES2GxGpuState& gx, bool fixedColor, size_t vertexFloatCount, GLintptr vertexBufferOffset, const GxGpuVramCopyRect& drawBounds, bool blendEnabled, u32 blendMode, u32 maskBitModeWord, bool ditherEnabled, u32 skippedLineParity, GxGpuRasterKind rasterKind);
void renderReadVramSolidQuad(OpenGLES2GxGpuState& gx, bool fixedColor, u32 topLeftWord, u32 bottomRightWord, u32 vramYAddressExtensionWord, bool blendEnabled, u32 blendMode, u32 maskBitModeWord, bool ditherEnabled, u32 skippedLineParity);
size_t appendLineCommandVertices(OpenGLES2GxGpuState& gx, const GxGpuCommandStorage& commandBuffer, u32 commandIndex, size_t vertexFloatCount);
void renderTexturedCommand(OpenGLES2GxGpuState& gx, const GxGpuCommandStorage& commandBuffer, u32 commandIndex, u32 topLeftWord, u32 bottomRightWord);
size_t appendTexturedCommandVertices(OpenGLES2GxGpuState& gx, const GxGpuCommandStorage& commandBuffer, u32 commandIndex, size_t vertexFloatCount);
size_t flushTexturedCommands(OpenGLES2GxGpuState& gx, const GxGpuCommandStorage& commandBuffer, size_t vertexFloatCount, u32 batchCommandIndex);

void finishSolidBatch(OpenGLES2GxGpuState& gx,
	size_t vertexFloatEnd,
	bool fixedColor,
	bool blendEnabled,
	u32 blendMode,
	u32 maskBitModeWord,
	u32 vramYAddressExtensionWord,
	bool ditherEnabled,
	u32 skippedLineParity,
	bool readsVram,
	GxGpuRasterKind rasterKind) {
	if (gx.primitiveSubmission.solidBatchStart != vertexFloatEnd) {
		GxGpuPrimitiveBatch& batch = gx.primitiveSubmission.batches[gx.primitiveSubmission.batchCount];
		batch.rasterKind = rasterKind;
		batch.vertexFloatStart = gx.primitiveSubmission.solidBatchStart;
		batch.vertexFloatCount = vertexFloatEnd - gx.primitiveSubmission.solidBatchStart;
		batch.drawBounds = gx.solidBatchRect;
		batch.maskBitModeWord = maskBitModeWord;
		batch.blendMode = blendMode;
		batch.skippedLineParity = skippedLineParity;
		batch.vramYAddressExtensionWord = vramYAddressExtensionWord;
		batch.sampleSyncBefore = readsVram && !gx.framebufferFetch && !gx.textureBarrier;
		batch.fixedColor = fixedColor;
		batch.blendEnabled = blendEnabled;
		batch.ditherEnabled = ditherEnabled;
		gx.primitiveSubmission.batchCount += 1u;
	}
	gx.primitiveSubmission.solidBatchStart = vertexFloatEnd;
	resetGxGpuVramCopyRect(gx.solidBatchRect);
}

size_t appendSolidCommandVertices(OpenGLES2GxGpuState& gx, const GxGpuCommandStorage& commandBuffer, u32 commandIndex, size_t vertexFloatCount) {
	switch (commandBuffer.commandKind[commandIndex]) {
		case GX_GPU_COMMAND_DRAW_POLYGON:
			return appendSolidPolygon(gx, commandBuffer, commandIndex, vertexFloatCount);
		case GX_GPU_COMMAND_DRAW_RECTANGLE:
			return appendSolidRectangle(gx, commandBuffer, commandIndex, vertexFloatCount);
		default:
			return appendFillRectangle(gx, commandBuffer, commandIndex, vertexFloatCount);
	}
}

void beginGxGpuVramRenderTarget(OpenGLES2GxGpuState& gx) {
	gx.drawTargets.bind();
	gx.backend->drawState.disable(GLES2Capability::DepthTest);
	gx.backend->drawState.depthMask(GL_FALSE);
	gx.backend->drawState.disable(GLES2Capability::CullFace);
	gx.backend->drawState.disable(GLES2Capability::Blend);
}

void renderNewLineCommands(OpenGLES2GxGpuState& gx,
	size_t vertexFloatCount,
	GLintptr vertexBufferOffset,
	const GxGpuVramCopyRect& drawBounds,
	bool blendEnabled,
	u32 blendMode,
	u32 maskBitModeWord,
	bool ditherEnabled,
	u32 skippedLineParity) {
	const bool hardware = gx.drawTargets.hardwareBlending() && blendEnabled && !gxGpuMaskBitCheckBeforeDraw(maskBitModeWord);
	GxGpuPrimitiveProgram& program = hardware ? gx.hardwareLineProgram : gx.lineProgram;
	const bool textureBarrier = gx.textureBarrier
		&& (blendEnabled || gxGpuMaskBitCheckBeforeDraw(maskBitModeWord));
	const bool samplesDestination = !gx.framebufferFetch && !textureBarrier && !hardware
		&& (blendEnabled || gxGpuMaskBitCheckBeforeDraw(maskBitModeWord));
	const uintptr_t vertexBufferAddress = static_cast<uintptr_t>(vertexBufferOffset);
	const auto bindDrawState = [&] {
		beginGxGpuVramRenderTarget(gx);
		gx.backend->drawState.useProgram(program.id);
		const auto& targetBounds = gx.drawTargets.bounds();
		program.target.write(targetBounds.left, targetBounds.top, targetBounds.right - targetBounds.left, targetBounds.bottom - targetBounds.top);
		writePrimitiveUniforms(program, blendEnabled, blendMode, maskBitModeWord,
			ditherEnabled, skippedLineParity, false);
		if (!gx.framebufferFetch) {
			gx.backend->setActiveTextureUnit(GLES2_TEXTURE_UNIT_GX_SAMPLE);
			gx.backend->bindTexture2D(textureBarrier ? &gx.drawTargets.color() : &gx.drawTargets.destinationSample());
		}
		gx.backend->drawState.bindBuffer(GL_ARRAY_BUFFER, gx.vertexStream.buffer);
		gx.backend->drawState.enableVertexAttribArray(static_cast<GLuint>(program.positionAttrib));
		gx.backend->drawState.vertexAttribPointer(static_cast<GLuint>(program.positionAttrib), 2, GL_FLOAT, GL_FALSE, kGxGpuLineVertexStride, reinterpret_cast<const void*>(vertexBufferAddress));
		gx.backend->drawState.enableVertexAttribArray(static_cast<GLuint>(program.startAttrib));
		gx.backend->drawState.vertexAttribPointer(static_cast<GLuint>(program.startAttrib), 2, GL_FLOAT, GL_FALSE, kGxGpuLineVertexStride, reinterpret_cast<const void*>(vertexBufferAddress + 2u * sizeof(f32)));
		gx.backend->drawState.enableVertexAttribArray(static_cast<GLuint>(program.endAttrib));
		gx.backend->drawState.vertexAttribPointer(static_cast<GLuint>(program.endAttrib), 2, GL_FLOAT, GL_FALSE, kGxGpuLineVertexStride, reinterpret_cast<const void*>(vertexBufferAddress + 4u * sizeof(f32)));
		gx.backend->drawState.enableVertexAttribArray(static_cast<GLuint>(program.color0Attrib));
		gx.backend->drawState.vertexAttribPointer(static_cast<GLuint>(program.color0Attrib), 3, GL_FLOAT, GL_FALSE, kGxGpuLineVertexStride, reinterpret_cast<const void*>(vertexBufferAddress + 6u * sizeof(f32)));
		gx.backend->drawState.enableVertexAttribArray(static_cast<GLuint>(program.color1Attrib));
		gx.backend->drawState.vertexAttribPointer(static_cast<GLuint>(program.color1Attrib), 3, GL_FLOAT, GL_FALSE, kGxGpuLineVertexStride, reinterpret_cast<const void*>(vertexBufferAddress + 9u * sizeof(f32)));
	};
	const GLsizei vertexCount = static_cast<GLsizei>(vertexFloatCount / kGxGpuLineVertexFloats);
	if (gx.vramTextureRows == kGxGpuVramYAddressPeriod) {
		drawGxGpuLogicalVramArea(gx,
			drawBounds,
			0,
			vertexCount,
			textureBarrier,
			false,
			samplesDestination,
			program, blendMode,
			program.logicalYBaseUniform, bindDrawState);
	} else {
		const bool syncSampleBetweenAliasBands = !gx.framebufferFetch
			&& !textureBarrier
			&& (blendEnabled || gxGpuMaskBitCheckBeforeDraw(maskBitModeWord));
		for (GLint firstVertex = 0; firstVertex < vertexCount; firstVertex += static_cast<GLint>(kGxGpuLineVerticesPerSegment)) {
			drawGxGpuLogicalVramArea(gx,
				drawBounds,
				firstVertex,
				static_cast<GLsizei>(kGxGpuLineVerticesPerSegment),
				textureBarrier,
				syncSampleBetweenAliasBands,
				samplesDestination,
				program, blendMode,
				program.logicalYBaseUniform, bindDrawState);
		}
	}
	gx.backend->drawState.disable(GLES2Capability::ScissorTest);
}

void finishLineBatch(OpenGLES2GxGpuState& gx, size_t vertexFloatEnd) {
	if (gx.primitiveSubmission.lineBatchStart != vertexFloatEnd) {
		GxGpuPrimitiveBatch& batch = gx.primitiveSubmission.batches[gx.primitiveSubmission.batchCount];
		batch.rasterKind = GxGpuRasterKind::Line;
		batch.vertexFloatStart = gx.primitiveSubmission.lineBatchStart;
		batch.vertexFloatCount = vertexFloatEnd - gx.primitiveSubmission.lineBatchStart;
		batch.drawBounds = gx.lineBatchRect;
		batch.maskBitModeWord = gx.lineBatchState.maskBitModeWord;
		batch.blendMode = gx.lineBatchState.blendMode;
		batch.skippedLineParity = gx.lineBatchState.skippedLineParity;
		batch.vramYAddressExtensionWord = gx.lineBatchState.vramYAddressExtensionWord;
		batch.sampleSyncBefore = gx.lineBatchState.readsVram && !gx.framebufferFetch && !gx.textureBarrier;
		batch.fixedColor = false;
		batch.blendEnabled = gx.lineBatchState.blendEnabled;
		batch.ditherEnabled = gx.lineBatchState.ditherEnabled;
		gx.primitiveSubmission.batchCount += 1u;
	}
	gx.primitiveSubmission.lineBatchStart = vertexFloatEnd;
	resetGxGpuVramCopyRect(gx.lineBatchRect);
}

void submitGxGpuPrimitiveBatches(OpenGLES2GxGpuState& gx) {
	if (gx.primitiveSubmission.batchCount == 0u) {
		return;
	}
	const GLsizeiptr solidByteCount = static_cast<GLsizeiptr>(gx.primitiveSubmission.solidFloatCount * sizeof(f32));
	const GLsizeiptr lineByteCount = static_cast<GLsizeiptr>(gx.primitiveSubmission.lineFloatCount * sizeof(f32));
	gx.vertexStream.reserve(solidByteCount + lineByteCount);
	GLintptr solidBufferOffset = 0;
	GLintptr lineBufferOffset = 0;
	if (solidByteCount != 0) {
		solidBufferOffset = gx.vertexStream.append(gx.solidVertices.data(), solidByteCount);
	}
	if (lineByteCount != 0) {
		lineBufferOffset = gx.vertexStream.append(gx.lineVertices.data(), lineByteCount);
	}

	// Vertices stay append-only until this ordered drain. Every operation that
	// observes or mutates VRAM must drain first; otherwise its texture copy would
	// observe commands that still exist only in the retained CPU arenas.
	for (size_t batchIndex = 0u; batchIndex < gx.primitiveSubmission.batchCount; batchIndex += 1u) {
		const GxGpuPrimitiveBatch& batch = gx.primitiveSubmission.batches[batchIndex];
		if (batch.sampleSyncBefore && !gx.drawTargets.enabled()) {
			syncGxGpuSampleTextureLogicalArea(gx,
				static_cast<u32>(batch.drawBounds.left),
				static_cast<u32>(batch.drawBounds.top),
				static_cast<u32>(batch.drawBounds.right - batch.drawBounds.left),
				static_cast<u32>(batch.drawBounds.bottom - batch.drawBounds.top),
				batch.vramYAddressExtensionWord);
		}
		if (batch.rasterKind != GxGpuRasterKind::Line) {
			renderNewSolidCommands(gx,
				batch.fixedColor,
				batch.vertexFloatCount,
				solidBufferOffset + static_cast<GLintptr>(batch.vertexFloatStart * sizeof(f32)),
				batch.drawBounds,
				batch.blendEnabled,
				batch.blendMode,
				batch.maskBitModeWord,
				batch.ditherEnabled,
				batch.skippedLineParity,
				batch.rasterKind);
		} else {
			renderNewLineCommands(gx,
				batch.vertexFloatCount,
				lineBufferOffset + static_cast<GLintptr>(batch.vertexFloatStart * sizeof(f32)),
				batch.drawBounds,
				batch.blendEnabled,
				batch.blendMode,
				batch.maskBitModeWord,
				batch.ditherEnabled,
				batch.skippedLineParity);
		}
	}
	gx.primitiveSubmission.batchCount = 0u;
	gx.primitiveSubmission.solidFloatCount = 0u;
	gx.primitiveSubmission.solidBatchStart = 0u;
	gx.primitiveSubmission.lineFloatCount = 0u;
	gx.primitiveSubmission.lineBatchStart = 0u;
}

size_t appendBatchedLineSegment(OpenGLES2GxGpuState& gx,
	size_t vertexFloatCount,
	i32 x0,
	i32 y0,
	u32 color0,
	i32 x1,
	i32 y1,
	u32 color1) {
	prepareGxGpuLineSegment(
		gx.linePreparedScratch,
		x0,
		y0,
		color0,
		x1,
		y1,
		color1,
		gx.lineBatchState.topLeftWord,
		gx.lineBatchState.bottomRightWord,
		gx.lineBatchState.vramYAddressExtensionWord);
	if (!gx.linePreparedScratch.emitsVertices) {
		return vertexFloatCount;
	}
	size_t offset = vertexFloatCount;
	if (offset + kGxGpuLineSegmentFloats > kGxGpuLineFloatCapacity) {
		gx.primitiveSubmission.lineFloatCount = offset;
		finishLineBatch(gx, offset);
		submitGxGpuPrimitiveBatches(gx);
		offset = 0u;
	}
	const size_t commandVertexStart = offset;
	offset = appendPreparedLineSegment(gx, offset, gx.linePreparedScratch);
	if (commandVertexStart != gx.primitiveSubmission.lineBatchStart
		&& gx.lineBatchState.readsVram
		&& gxGpuVramCopyRectsOverlap(gx, gx.lineBatchRect, gx.linePreparedScratch.clippedBounds, gx.lineBatchState.vramYAddressExtensionWord)) {
		finishLineBatch(gx, commandVertexStart);
	}
	includeGxGpuVramCopyRect(gx.lineBatchRect, gx.linePreparedScratch.clippedBounds);
	return offset;
}

bool gxGpuBlendPlanCommandMatches(const GxGpuCommandStorage& commandBuffer, u32 commandIndex, u32 firstCommandIndex) {
	const u8 kind = commandBuffer.commandKind[commandIndex];
	if (kind != GX_GPU_COMMAND_DRAW_LINE && kind != GX_GPU_COMMAND_DRAW_RECTANGLE) {
		return false;
	}
	const u32 opcode = commandBuffer.commandOpcode[commandIndex];
	if (!gxGpuCommandSemiTransparencyEnabled(opcode)
		|| (kind == GX_GPU_COMMAND_DRAW_RECTANGLE && gxGpuCommandTextureEnabled(opcode))) {
		return false;
	}
	const u32 firstOpcode = commandBuffer.commandOpcode[firstCommandIndex];
	return commandBuffer.commandDrawingAreaTopLeftWord[commandIndex] == commandBuffer.commandDrawingAreaTopLeftWord[firstCommandIndex]
		&& commandBuffer.commandDrawingAreaBottomRightWord[commandIndex] == commandBuffer.commandDrawingAreaBottomRightWord[firstCommandIndex]
		&& commandBuffer.commandVramYAddressExtensionWord[commandIndex] == commandBuffer.commandVramYAddressExtensionWord[firstCommandIndex]
		&& commandBuffer.commandMaskBitModeWord[commandIndex] == commandBuffer.commandMaskBitModeWord[firstCommandIndex]
		&& commandBuffer.commandSkippedLineParity[commandIndex] == commandBuffer.commandSkippedLineParity[firstCommandIndex]
		&& gxGpuDrawModeTransparencyMode(commandBuffer.commandDrawModeWord[commandIndex]) == gxGpuDrawModeTransparencyMode(commandBuffer.commandDrawModeWord[firstCommandIndex])
		&& (kind == GX_GPU_COMMAND_DRAW_LINE && gxGpuDrawModeDitherEnabled(commandBuffer.commandDrawModeWord[commandIndex]))
			== (commandBuffer.commandKind[firstCommandIndex] == GX_GPU_COMMAND_DRAW_LINE && gxGpuDrawModeDitherEnabled(commandBuffer.commandDrawModeWord[firstCommandIndex]))
		&& gxGpuCommandSemiTransparencyEnabled(firstOpcode);
}

void prepareGxGpuLineCommand(
	GxGpuPreparedRasterPrimitive& line,
	const GxGpuCommandStorage& commandBuffer,
	u32 commandIndex,
	u32 topLeftWord,
	u32 bottomRightWord,
	u32 vramYAddressExtensionWord) {
	const u32 wordStart = commandBuffer.commandWordStart[commandIndex];
	const u32 record = commandBuffer.commandDrawIndex[commandIndex];
	const u32 drawingOffsetWord = commandBuffer.commandDrawingOffsetWord[commandIndex];
	const i32 dx = gxGpuSigned11(drawingOffsetWord);
	const i32 dy = gxGpuDrawingOffsetY(drawingOffsetWord);
	const u32 color0 = commandBuffer.words[wordStart];
	const u32 xy0 = commandBuffer.words[wordStart + 1u];
	const u32 color1 = commandBuffer.words[wordStart + commandBuffer.drawColorStride[record]];
	const u32 xy1 = commandBuffer.words[wordStart + 1u + commandBuffer.drawPositionStride[record]];
	prepareGxGpuLineSegment(
		line,
		dx + gxGpuSigned11(xy0),
		dy + gxGpuVertexY(xy0),
		color0,
		dx + gxGpuSigned11(xy1),
		dy + gxGpuVertexY(xy1),
		color1,
		topLeftWord,
		bottomRightWord,
		vramYAddressExtensionWord);
}

u32 executeGxGpuBlendPlan(OpenGLES2GxGpuState& gx, const GxGpuCommandStorage& commandBuffer, u32 commandStart, u32 commandEnd) {
	const u32 topLeftWord = commandBuffer.commandDrawingAreaTopLeftWord[commandStart];
	const u32 bottomRightWord = commandBuffer.commandDrawingAreaBottomRightWord[commandStart];
	const u32 vramYAddressExtensionWord = commandBuffer.commandVramYAddressExtensionWord[commandStart];
	gx.blendPlanLayerFirst.fill(kGxGpuBlendPlanCommandEnd);
	gx.blendPlanLayerLast.fill(kGxGpuBlendPlanCommandEnd);
	u16 layerCount = 0u;
	for (u32 commandIndex = commandStart; commandIndex < commandEnd; commandIndex += 1u) {
		const u16 commandOffset = static_cast<u16>(commandIndex - commandStart);
		GxGpuPreparedBlendCommand& command = gx.blendPlanCommands[commandOffset];
		if (commandBuffer.commandKind[commandIndex] == GX_GPU_COMMAND_DRAW_LINE) {
			command.rasterKind = GxGpuRasterKind::Line;
			prepareGxGpuLineCommand(command.primitive, commandBuffer, commandIndex, topLeftWord, bottomRightWord, vramYAddressExtensionWord);
		} else {
			command.rasterKind = GxGpuRasterKind::Rectangle;
			prepareGxGpuSolidRectangle(gx, command.primitive, commandBuffer, commandIndex, topLeftWord, bottomRightWord, vramYAddressExtensionWord);
		}
		if (!command.primitive.emitsVertices) {
			continue;
		}
		u16 layer = 1u;
		for (u16 previousOffset = 0u; previousOffset < commandOffset; previousOffset += 1u) {
			const GxGpuPreparedBlendCommand& previous = gx.blendPlanCommands[previousOffset];
			if (previous.primitive.emitsVertices
				&& gxGpuVramCopyRectsOverlap(gx, command.primitive.clippedBounds, previous.primitive.clippedBounds, vramYAddressExtensionWord)
				&& layer <= previous.layer) {
				layer = previous.layer + 1u;
			}
		}
		command.layer = layer;
		command.next = kGxGpuBlendPlanCommandEnd;
		if (gx.blendPlanLayerFirst[layer] == kGxGpuBlendPlanCommandEnd) {
			gx.blendPlanLayerFirst[layer] = commandOffset;
		} else {
			gx.blendPlanCommands[gx.blendPlanLayerLast[layer]].next = commandOffset;
		}
		gx.blendPlanLayerLast[layer] = commandOffset;
		if (layerCount < layer) {
			layerCount = layer;
		}
	}
	if (layerCount == 0u) {
		return commandEnd;
	}
	submitGxGpuPrimitiveBatches(gx);

	const u32 maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandStart];
	const u32 blendMode = gxGpuDrawModeTransparencyMode(commandBuffer.commandDrawModeWord[commandStart]);
	const bool ditherEnabled = commandBuffer.commandKind[commandStart] == GX_GPU_COMMAND_DRAW_LINE
		&& gxGpuDrawModeDitherEnabled(commandBuffer.commandDrawModeWord[commandStart]);
	const u32 skippedLineParity = commandBuffer.commandSkippedLineParity[commandStart];
	for (u16 layer = 1u; layer <= layerCount; layer += 1u) {
		const size_t solidFloatStart = gx.primitiveSubmission.solidFloatCount;
		const size_t lineFloatStart = gx.primitiveSubmission.lineFloatCount;
		resetGxGpuVramCopyRect(gx.blendPlanLineBounds);
		resetGxGpuVramCopyRect(gx.blendPlanSolidBounds);
		for (u16 commandOffset = gx.blendPlanLayerFirst[layer]; commandOffset != kGxGpuBlendPlanCommandEnd; commandOffset = gx.blendPlanCommands[commandOffset].next) {
			const GxGpuPreparedBlendCommand& command = gx.blendPlanCommands[commandOffset];
			if (!command.primitive.emitsVertices) {
				continue;
			}
			if (command.rasterKind == GxGpuRasterKind::Line) {
				gx.primitiveSubmission.lineFloatCount = appendPreparedLineSegment(gx, gx.primitiveSubmission.lineFloatCount, command.primitive);
				includeGxGpuVramCopyRect(gx.blendPlanLineBounds, command.primitive.clippedBounds);
			} else {
				gx.primitiveSubmission.solidFloatCount = appendPreparedSolidRectangle(gx, gx.primitiveSubmission.solidFloatCount, command.primitive);
				includeGxGpuVramCopyRect(gx.blendPlanSolidBounds, command.primitive.clippedBounds);
			}
		}
		if (gx.primitiveSubmission.lineFloatCount != lineFloatStart) {
			GxGpuPrimitiveBatch& batch = gx.primitiveSubmission.batches[gx.primitiveSubmission.batchCount];
			batch.rasterKind = GxGpuRasterKind::Line;
			batch.vertexFloatStart = lineFloatStart;
			batch.vertexFloatCount = gx.primitiveSubmission.lineFloatCount - lineFloatStart;
			batch.drawBounds = gx.blendPlanLineBounds;
			batch.maskBitModeWord = maskBitModeWord;
			batch.blendMode = blendMode;
			batch.skippedLineParity = skippedLineParity;
			batch.vramYAddressExtensionWord = vramYAddressExtensionWord;
			batch.sampleSyncBefore = !gx.framebufferFetch && !gx.textureBarrier;
			batch.fixedColor = false;
			batch.blendEnabled = true;
			batch.ditherEnabled = ditherEnabled;
			gx.primitiveSubmission.batchCount += 1u;
		}
		if (gx.primitiveSubmission.solidFloatCount != solidFloatStart) {
			GxGpuPrimitiveBatch& batch = gx.primitiveSubmission.batches[gx.primitiveSubmission.batchCount];
			batch.rasterKind = GxGpuRasterKind::Rectangle;
			batch.vertexFloatStart = solidFloatStart;
			batch.vertexFloatCount = gx.primitiveSubmission.solidFloatCount - solidFloatStart;
			batch.drawBounds = gx.blendPlanSolidBounds;
			batch.maskBitModeWord = maskBitModeWord;
			batch.blendMode = blendMode;
			batch.skippedLineParity = skippedLineParity;
			batch.vramYAddressExtensionWord = vramYAddressExtensionWord;
			batch.sampleSyncBefore = !gx.framebufferFetch && !gx.textureBarrier;
			batch.fixedColor = false;
			batch.blendEnabled = true;
			batch.ditherEnabled = false;
			gx.primitiveSubmission.batchCount += 1u;
		}
	}
	submitGxGpuPrimitiveBatches(gx);
	return commandEnd;
}

void prepareGxGpuTexturedGeometry(OpenGLES2GxGpuState& gx, const GxGpuCommandStorage& commandBuffer, size_t commandLimit) {
	size_t floatCount = 0u;
	for (size_t commandIndex = gx.processedCommandCount; commandIndex < commandLimit; ++commandIndex) {
		gx.texturedGeometry.commandFloatOffsets[commandIndex] = static_cast<u32>(floatCount);
		const u8 kind = commandBuffer.commandKind[commandIndex];
		if ((kind == GX_GPU_COMMAND_DRAW_POLYGON || kind == GX_GPU_COMMAND_DRAW_RECTANGLE)
			&& gxGpuCommandTextureEnabled(commandBuffer.commandOpcode[commandIndex])) {
			floatCount = appendTexturedCommandVertices(gx, commandBuffer, commandIndex, floatCount);
		}
	}
	gx.texturedGeometry.commandFloatOffsets[commandLimit] = static_cast<u32>(floatCount);
	if (floatCount == 0u) return;
	gx.backend->drawState.bindBuffer(GL_ARRAY_BUFFER, gx.texturedGeometry.buffer);
	// Replace the preceding generation in one call. No writes to this store
	// occur after its first draw, even across atlas uploads and sample copies.
	glBufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(floatCount * sizeof(f32)),
		gx.texturedGeometry.vertices.data(), GL_STREAM_DRAW);
}

void executeNewGxGpuCommands(OpenGLES2GxGpuState& gx, const GxGpuCommandStorage& commandBuffer, size_t commandLimit) {
	if (gx.drawTargets.enabled()) {
		if (gx.backend->profilesGxUploads()) prepareGxGpuCpuUploads<true>(gx, commandBuffer, commandLimit);
		else prepareGxGpuCpuUploads<false>(gx, commandBuffer, commandLimit);
	}
	prepareGxGpuTexturedGeometry(gx, commandBuffer, commandLimit);
	u32 commandIndex = gx.processedCommandCount;
	u32 solidBatchTopLeftWord = kGxGpuFullDrawingAreaTopLeftWord;
	u32 solidBatchBottomRightWord = kGxGpuFullDrawingAreaBottomRightWord;
	u32 solidBatchVramYAddressExtensionWord = 0u;
	u32 solidBatchMaskBitModeWord = 0u;
	bool solidBatchDitherEnabled = false;
	u32 solidBatchSkippedLineParity = GX_GPU_SKIPPED_LINE_NONE;
	bool solidBatchBlendEnabled = false;
	u32 solidBatchBlendMode = 0u;
	bool solidBatchReadsVram = false;
	bool solidBatchFixedColor = false;
	GxGpuRasterKind solidBatchRasterKind = GxGpuRasterKind::Rectangle;
	size_t texturedVertexFloatCount = 0u;
	u32 texturedBatchCommandIndex = 0u;
	resetGxGpuVramCopyRect(gx.solidBatchRect);
	resetGxGpuVramCopyRect(gx.texturedBatchRect);
	resetGxGpuVramCopyRect(gx.lineBatchRect);
	gx.texturedSourceReads.clear();
	for (; commandIndex < commandLimit; commandIndex += 1u) {
		const u8 commandKind = commandBuffer.commandKind[commandIndex];
		const bool commandDrawsTexture = (commandKind == GX_GPU_COMMAND_DRAW_POLYGON || commandKind == GX_GPU_COMMAND_DRAW_RECTANGLE)
			&& gxGpuCommandTextureEnabled(commandBuffer.commandOpcode[commandIndex]);
		const bool hardwareSolidBlend = gx.drawTargets.hardwareBlending()
			&& !gxGpuMaskBitCheckBeforeDraw(commandBuffer.commandMaskBitModeWord[commandIndex]);
		if (!hardwareSolidBlend && gxGpuBlendPlanCommandMatches(commandBuffer, commandIndex, commandIndex)) {
			u32 blendPlanEnd = commandIndex + 1u;
			while (blendPlanEnd < commandLimit
				&& blendPlanEnd - commandIndex < kGxGpuLineSegmentCapacity
				&& gxGpuBlendPlanCommandMatches(commandBuffer, blendPlanEnd, commandIndex)) {
				blendPlanEnd += 1u;
			}
			if (blendPlanEnd - commandIndex > 1u) {
				finishSolidBatch(gx, gx.primitiveSubmission.solidFloatCount, solidBatchFixedColor, solidBatchBlendEnabled, solidBatchBlendMode, solidBatchMaskBitModeWord, solidBatchVramYAddressExtensionWord, solidBatchDitherEnabled, solidBatchSkippedLineParity, solidBatchReadsVram, solidBatchRasterKind);
				texturedVertexFloatCount = flushTexturedCommands(gx, commandBuffer, texturedVertexFloatCount, texturedBatchCommandIndex);
				finishLineBatch(gx, gx.primitiveSubmission.lineFloatCount);
				commandIndex = executeGxGpuBlendPlan(gx, commandBuffer, commandIndex, blendPlanEnd) - 1u;
				continue;
			}
		}
		if (texturedVertexFloatCount != 0u && !commandDrawsTexture) {
			texturedVertexFloatCount = flushTexturedCommands(gx, commandBuffer, texturedVertexFloatCount, texturedBatchCommandIndex);
		}
		if (gx.primitiveSubmission.lineFloatCount != gx.primitiveSubmission.lineBatchStart
			&& commandKind != GX_GPU_COMMAND_DRAW_LINE && commandKind != GX_GPU_COMMAND_DRAW_POLYLINE) {
			finishLineBatch(gx, gx.primitiveSubmission.lineFloatCount);
		}
		switch (commandKind) {
		case GX_GPU_COMMAND_DRAW_POLYGON:
		case GX_GPU_COMMAND_DRAW_RECTANGLE: {
			const u32 opcode = commandBuffer.commandOpcode[commandIndex];
			const u32 drawModeWord = commandBuffer.commandDrawModeWord[commandIndex];
			const u32 topLeftWord = commandBuffer.commandDrawingAreaTopLeftWord[commandIndex];
			const u32 bottomRightWord = commandBuffer.commandDrawingAreaBottomRightWord[commandIndex];
			const u32 vramYAddressExtensionWord = commandBuffer.commandVramYAddressExtensionWord[commandIndex];
			const u32 maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
			const bool drawsTexture = commandDrawsTexture;
			const bool fixedSolidColor = commandKind == GX_GPU_COMMAND_DRAW_POLYGON
				&& (commandBuffer.drawColorStride[commandBuffer.commandDrawIndex[commandIndex]] != 0u);
			const GxGpuRasterKind rasterKind = commandKind == GX_GPU_COMMAND_DRAW_POLYGON
				? GxGpuRasterKind::Polygon
				: GxGpuRasterKind::Rectangle;
			const bool fixedTexturedColor = drawsTexture
				&& commandKind == GX_GPU_COMMAND_DRAW_POLYGON
				&& (commandBuffer.drawColorStride[commandBuffer.commandDrawIndex[commandIndex]] != 0u)
				&& !gxGpuCommandRawTextureEnabled(opcode);
			const bool ditherEnabled = commandBuffer.commandKind[commandIndex] == GX_GPU_COMMAND_DRAW_POLYGON && gxGpuDitheredPolygon(drawModeWord, opcode);
			const bool blendEnabled = gxGpuCommandSemiTransparencyEnabled(opcode);
			const u32 blendMode = blendEnabled ? gxGpuDrawModeTransparencyMode(drawModeWord) : 0u;
			const bool readsVram = (blendEnabled && (!hardwareSolidBlend || drawsTexture)) || gxGpuMaskBitCheckBeforeDraw(maskBitModeWord);
			const bool splitReadVramQuad = readsVram
				&& commandBuffer.commandKind[commandIndex] == GX_GPU_COMMAND_DRAW_POLYGON
				&& (commandBuffer.drawVertexCount[commandBuffer.commandDrawIndex[commandIndex]] == 4u);
			const u32 skippedLineParity = commandBuffer.commandSkippedLineParity[commandIndex];
			const bool batchMaskChange = maskBitModeWord != solidBatchMaskBitModeWord;
			const bool batchStateChanged = topLeftWord != solidBatchTopLeftWord
				|| bottomRightWord != solidBatchBottomRightWord
				|| vramYAddressExtensionWord != solidBatchVramYAddressExtensionWord
				|| batchMaskChange
				|| solidBatchDitherEnabled != ditherEnabled
				|| solidBatchSkippedLineParity != skippedLineParity
				|| solidBatchBlendEnabled != blendEnabled
				|| solidBatchBlendMode != blendMode
				|| solidBatchReadsVram != readsVram
				|| solidBatchFixedColor != fixedSolidColor
				|| solidBatchRasterKind != rasterKind;
			if (gx.primitiveSubmission.solidFloatCount != gx.primitiveSubmission.solidBatchStart
				&& (batchStateChanged || drawsTexture || splitReadVramQuad)) {
				finishSolidBatch(gx, gx.primitiveSubmission.solidFloatCount, solidBatchFixedColor, solidBatchBlendEnabled, solidBatchBlendMode, solidBatchMaskBitModeWord, solidBatchVramYAddressExtensionWord, solidBatchDitherEnabled, solidBatchSkippedLineParity, solidBatchReadsVram, solidBatchRasterKind);
			}
			solidBatchTopLeftWord = topLeftWord;
			solidBatchBottomRightWord = bottomRightWord;
			solidBatchVramYAddressExtensionWord = vramYAddressExtensionWord;
			solidBatchMaskBitModeWord = maskBitModeWord;
			solidBatchDitherEnabled = ditherEnabled;
			solidBatchSkippedLineParity = skippedLineParity;
			solidBatchBlendEnabled = blendEnabled;
			solidBatchBlendMode = blendMode;
			solidBatchReadsVram = readsVram;
			solidBatchFixedColor = fixedSolidColor;
			solidBatchRasterKind = rasterKind;
			if (drawsTexture) {
				if (texturedVertexFloatCount != 0u) {
					const u32 batchDrawModeWord = commandBuffer.commandDrawModeWord[texturedBatchCommandIndex];
					const u32 batchOpcode = commandBuffer.commandOpcode[texturedBatchCommandIndex];
					const bool batchBlendEnabled = gxGpuCommandSemiTransparencyEnabled(batchOpcode);
					const bool batchDitherEnabled = commandBuffer.commandKind[texturedBatchCommandIndex] == GX_GPU_COMMAND_DRAW_POLYGON && gxGpuDitheredPolygon(batchDrawModeWord, batchOpcode);
					const bool batchFixedTexturedColor = commandBuffer.commandKind[texturedBatchCommandIndex] == GX_GPU_COMMAND_DRAW_POLYGON
						&& (commandBuffer.drawColorStride[commandBuffer.commandDrawIndex[texturedBatchCommandIndex]] != 0u)
						&& !gxGpuCommandRawTextureEnabled(batchOpcode);
					const bool batchStateChanged = topLeftWord != commandBuffer.commandDrawingAreaTopLeftWord[texturedBatchCommandIndex]
						|| bottomRightWord != commandBuffer.commandDrawingAreaBottomRightWord[texturedBatchCommandIndex]
						|| vramYAddressExtensionWord != commandBuffer.commandVramYAddressExtensionWord[texturedBatchCommandIndex]
						|| commandKind != commandBuffer.commandKind[texturedBatchCommandIndex]
						|| gxGpuTexturedBatchDrawModeWord(drawModeWord, blendEnabled) != gxGpuTexturedBatchDrawModeWord(batchDrawModeWord, batchBlendEnabled)
						|| commandBuffer.commandTextureWindowWord[commandIndex] != commandBuffer.commandTextureWindowWord[texturedBatchCommandIndex]
						|| maskBitModeWord != commandBuffer.commandMaskBitModeWord[texturedBatchCommandIndex]
						|| skippedLineParity != commandBuffer.commandSkippedLineParity[texturedBatchCommandIndex]
						|| gxGpuCommandRawTextureEnabled(opcode) != gxGpuCommandRawTextureEnabled(batchOpcode)
						|| blendEnabled != batchBlendEnabled
						|| ditherEnabled != batchDitherEnabled
						|| fixedTexturedColor != batchFixedTexturedColor;
					if (batchStateChanged) {
						texturedVertexFloatCount = flushTexturedCommands(gx, commandBuffer, texturedVertexFloatCount, texturedBatchCommandIndex);
					}
				}
				if (texturedVertexFloatCount == 0u) {
					texturedBatchCommandIndex = commandIndex;
				}
				size_t precedingVertexFloatCount = texturedVertexFloatCount;
				const size_t texturedCommandVertexStart = gx.texturedGeometry.commandFloatOffsets[commandIndex];
				const size_t texturedCommandVertexEnd = gx.texturedGeometry.commandFloatOffsets[commandIndex + 1u];
				const size_t commandVertexFloatCount = texturedCommandVertexEnd - texturedCommandVertexStart;
				texturedVertexFloatCount += commandVertexFloatCount;
				if (commandVertexFloatCount != 0u) {
					const size_t texturedVertexFloatStride = fixedTexturedColor ? kGxGpuFixedTexturedVertexFloats : kGxGpuTexturedVertexFloats;
					setGxGpuVertexBoundsRect(rasterKind, gx.texturedCommandRect, gx.texturedGeometry.vertices.data(), texturedCommandVertexStart, texturedCommandVertexEnd, texturedVertexFloatStride, topLeftWord, bottomRightWord, vramYAddressExtensionWord);
					u32 sourceOverlaps = prepareGxGpuTexturedSourceReads<true>(gx, commandBuffer, commandIndex, texturedCommandVertexStart, texturedCommandVertexEnd, gx.texturedCommandRect, gx.texturedBatchRect, fixedTexturedColor);
					if ((sourceOverlaps & GX_GPU_TEXTURE_SOURCE_BATCH_OVERLAP) != 0u) {
						flushTexturedCommands(gx, commandBuffer, precedingVertexFloatCount, texturedBatchCommandIndex);
						texturedBatchCommandIndex = commandIndex;
						precedingVertexFloatCount = 0u;
						texturedVertexFloatCount = commandVertexFloatCount;
						setGxGpuVertexBoundsRect(rasterKind, gx.texturedCommandRect, gx.texturedGeometry.vertices.data(), texturedCommandVertexStart, texturedCommandVertexEnd, texturedVertexFloatStride, topLeftWord, bottomRightWord, vramYAddressExtensionWord);
						sourceOverlaps = prepareGxGpuTexturedSourceReads<true>(gx, commandBuffer, commandIndex, texturedCommandVertexStart, texturedCommandVertexEnd, gx.texturedCommandRect, gx.texturedBatchRect, fixedTexturedColor);
					}
					if ((sourceOverlaps & GX_GPU_TEXTURE_SOURCE_COMMAND_OVERLAP) != 0u) {
						if (precedingVertexFloatCount != 0u) {
							texturedVertexFloatCount = flushTexturedCommands(gx, commandBuffer, precedingVertexFloatCount, texturedBatchCommandIndex);
						}
						texturedVertexFloatCount = 0u;
						resetGxGpuVramCopyRect(gx.texturedBatchRect);
						renderTexturedCommand(gx, commandBuffer, commandIndex, topLeftWord, bottomRightWord);
					} else {
						// Classify only commands admitted to this batch. A dependency
						// can flush the preceding prefix after this command was
						// admitted; its geometry remains in the same generation.
						if (precedingVertexFloatCount == 0u) {
							gx.texturedBatchUniformGain = true;
						} else {
							const u32 colorWord = commandBuffer.words[commandBuffer.commandWordStart[commandIndex]];
							const u32 batchColorWord = commandBuffer.words[commandBuffer.commandWordStart[texturedBatchCommandIndex]];
							gx.texturedBatchUniformGain &= ((colorWord ^ batchColorWord) & 0x00ffffffu) == 0u;
						}
						includeGxGpuVramCopyRect(gx.texturedBatchRect, gx.texturedCommandRect);
					}
				}
			} else {
				const size_t commandVertexStart = gx.primitiveSubmission.solidFloatCount;
				gx.primitiveSubmission.solidFloatCount = appendSolidCommandVertices(gx, commandBuffer, commandIndex, gx.primitiveSubmission.solidFloatCount);
				const size_t vertexFloatStride = fixedSolidColor ? kGxGpuFixedSolidVertexFloats : kGxGpuSolidVertexFloats;
				if (gx.primitiveSubmission.solidFloatCount != commandVertexStart) {
					setGxGpuVertexBoundsRect(rasterKind, gx.solidCommandRect, gx.solidVertices.data(), commandVertexStart, gx.primitiveSubmission.solidFloatCount, vertexFloatStride, topLeftWord, bottomRightWord, vramYAddressExtensionWord);
					if (splitReadVramQuad && gx.primitiveSubmission.solidFloatCount - commandVertexStart == (fixedSolidColor ? kGxGpuFixedSolidTriangleFloats : kGxGpuSolidTriangleFloats) * 2u) {
						gx.primitiveSubmission.solidFloatCount = commandVertexStart;
						submitGxGpuPrimitiveBatches(gx);
						gx.primitiveSubmission.solidFloatCount = appendSolidCommandVertices(gx, commandBuffer, commandIndex, 0u);
						renderReadVramSolidQuad(gx, fixedSolidColor, topLeftWord, bottomRightWord, vramYAddressExtensionWord, blendEnabled, blendMode, maskBitModeWord, ditherEnabled, skippedLineParity);
						gx.primitiveSubmission.solidFloatCount = 0u;
						gx.primitiveSubmission.solidBatchStart = 0u;
					} else {
						if (readsVram && commandVertexStart != gx.primitiveSubmission.solidBatchStart && gxGpuVramCopyRectsOverlap(gx, gx.solidBatchRect, gx.solidCommandRect, vramYAddressExtensionWord)) {
							finishSolidBatch(gx, commandVertexStart, solidBatchFixedColor, solidBatchBlendEnabled, solidBatchBlendMode, solidBatchMaskBitModeWord, solidBatchVramYAddressExtensionWord, solidBatchDitherEnabled, solidBatchSkippedLineParity, solidBatchReadsVram, solidBatchRasterKind);
						}
						includeGxGpuVramCopyRect(gx.solidBatchRect, gx.solidCommandRect);
					}
				}
			}
			break;
		}
		case GX_GPU_COMMAND_FILL_RECTANGLE: {
			const u32 topLeftWord = kGxGpuFullDrawingAreaTopLeftWord;
			const u32 vramYAddressExtensionWord = commandBuffer.commandVramYAddressExtensionWord[commandIndex];
			const u32 bottomRightWord = kGxGpuFullDrawingAreaBottomRightWord;
			const u32 skippedLineParity = commandBuffer.commandSkippedLineParity[commandIndex];
			const bool batchMaskChange = gxGpuMaskBitSetWhileDrawing(solidBatchMaskBitModeWord);
			if (gx.primitiveSubmission.solidFloatCount != gx.primitiveSubmission.solidBatchStart
				&& (solidBatchTopLeftWord != topLeftWord || solidBatchBottomRightWord != bottomRightWord || solidBatchVramYAddressExtensionWord != vramYAddressExtensionWord || batchMaskChange || solidBatchDitherEnabled || solidBatchSkippedLineParity != skippedLineParity || solidBatchBlendEnabled || solidBatchReadsVram || solidBatchFixedColor || solidBatchRasterKind != GxGpuRasterKind::Rectangle)) {
				finishSolidBatch(gx, gx.primitiveSubmission.solidFloatCount, solidBatchFixedColor, solidBatchBlendEnabled, solidBatchBlendMode, solidBatchMaskBitModeWord, solidBatchVramYAddressExtensionWord, solidBatchDitherEnabled, solidBatchSkippedLineParity, solidBatchReadsVram, solidBatchRasterKind);
			}
			solidBatchTopLeftWord = topLeftWord;
			solidBatchBottomRightWord = bottomRightWord;
			solidBatchVramYAddressExtensionWord = vramYAddressExtensionWord;
			solidBatchMaskBitModeWord = 0u;
			solidBatchDitherEnabled = false;
			solidBatchSkippedLineParity = skippedLineParity;
			solidBatchBlendEnabled = false;
			solidBatchBlendMode = 0u;
			solidBatchReadsVram = false;
			solidBatchFixedColor = false;
			solidBatchRasterKind = GxGpuRasterKind::Rectangle;
			const size_t commandVertexStart = gx.primitiveSubmission.solidFloatCount;
			gx.primitiveSubmission.solidFloatCount = appendFillRectangle(gx, commandBuffer, commandIndex, commandVertexStart);
			if (gx.primitiveSubmission.solidFloatCount != commandVertexStart) {
				setGxGpuVertexBoundsRect(
					GxGpuRasterKind::Rectangle,
					gx.solidCommandRect,
					gx.solidVertices.data(),
					commandVertexStart,
					gx.primitiveSubmission.solidFloatCount,
					kGxGpuSolidVertexFloats,
					topLeftWord,
					bottomRightWord,
					vramYAddressExtensionWord);
				includeGxGpuVramCopyRect(gx.solidBatchRect, gx.solidCommandRect);
			}
			break;
		}
		case GX_GPU_COMMAND_DRAW_LINE:
		case GX_GPU_COMMAND_DRAW_POLYLINE: {
			finishSolidBatch(gx, gx.primitiveSubmission.solidFloatCount, solidBatchFixedColor, solidBatchBlendEnabled, solidBatchBlendMode, solidBatchMaskBitModeWord, solidBatchVramYAddressExtensionWord, solidBatchDitherEnabled, solidBatchSkippedLineParity, solidBatchReadsVram, solidBatchRasterKind);
			const u32 opcode = commandBuffer.commandOpcode[commandIndex];
			const u32 drawModeWord = commandBuffer.commandDrawModeWord[commandIndex];
			const u32 topLeftWord = commandBuffer.commandDrawingAreaTopLeftWord[commandIndex];
			const u32 bottomRightWord = commandBuffer.commandDrawingAreaBottomRightWord[commandIndex];
			const u32 vramYAddressExtensionWord = commandBuffer.commandVramYAddressExtensionWord[commandIndex];
			const u32 maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
			const bool blendEnabled = gxGpuCommandSemiTransparencyEnabled(opcode);
			const u32 blendMode = blendEnabled ? gxGpuDrawModeTransparencyMode(drawModeWord) : 0u;
			const bool ditherEnabled = gxGpuDrawModeDitherEnabled(drawModeWord);
			const u32 skippedLineParity = commandBuffer.commandSkippedLineParity[commandIndex];
			const bool readsVram = (blendEnabled && !hardwareSolidBlend) || gxGpuMaskBitCheckBeforeDraw(maskBitModeWord);
			if (gx.primitiveSubmission.lineFloatCount != gx.primitiveSubmission.lineBatchStart && (topLeftWord != gx.lineBatchState.topLeftWord
				|| bottomRightWord != gx.lineBatchState.bottomRightWord
				|| vramYAddressExtensionWord != gx.lineBatchState.vramYAddressExtensionWord
				|| maskBitModeWord != gx.lineBatchState.maskBitModeWord
				|| ditherEnabled != gx.lineBatchState.ditherEnabled
				|| skippedLineParity != gx.lineBatchState.skippedLineParity
				|| blendEnabled != gx.lineBatchState.blendEnabled
				|| blendMode != gx.lineBatchState.blendMode
				|| readsVram != gx.lineBatchState.readsVram)) {
				finishLineBatch(gx, gx.primitiveSubmission.lineFloatCount);
			}
			gx.lineBatchState.topLeftWord = topLeftWord;
			gx.lineBatchState.bottomRightWord = bottomRightWord;
			gx.lineBatchState.vramYAddressExtensionWord = vramYAddressExtensionWord;
			gx.lineBatchState.maskBitModeWord = maskBitModeWord;
			gx.lineBatchState.ditherEnabled = ditherEnabled;
			gx.lineBatchState.skippedLineParity = skippedLineParity;
			gx.lineBatchState.blendEnabled = blendEnabled;
			gx.lineBatchState.blendMode = blendMode;
			gx.lineBatchState.readsVram = readsVram;
			gx.primitiveSubmission.lineFloatCount = appendLineCommandVertices(gx, commandBuffer, commandIndex, gx.primitiveSubmission.lineFloatCount);
			break;
		}
		case GX_GPU_COMMAND_COPY_VRAM_TO_VRAM:
			finishSolidBatch(gx, gx.primitiveSubmission.solidFloatCount, solidBatchFixedColor, solidBatchBlendEnabled, solidBatchBlendMode, solidBatchMaskBitModeWord, solidBatchVramYAddressExtensionWord, solidBatchDitherEnabled, solidBatchSkippedLineParity, solidBatchReadsVram, solidBatchRasterKind);
			submitGxGpuPrimitiveBatches(gx);
			copyVramToVram(gx, commandBuffer, commandIndex);
			break;
		case GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM:
			finishSolidBatch(gx, gx.primitiveSubmission.solidFloatCount, solidBatchFixedColor, solidBatchBlendEnabled, solidBatchBlendMode, solidBatchMaskBitModeWord, solidBatchVramYAddressExtensionWord, solidBatchDitherEnabled, solidBatchSkippedLineParity, solidBatchReadsVram, solidBatchRasterKind);
			submitGxGpuPrimitiveBatches(gx);
			uploadCpuToVram(gx, commandBuffer, commandIndex);
			break;
		}
		if (gx.vramTextureRows != kGxGpuVramYAddressPeriod) {
			finishSolidBatch(gx, gx.primitiveSubmission.solidFloatCount, solidBatchFixedColor, solidBatchBlendEnabled, solidBatchBlendMode, solidBatchMaskBitModeWord, solidBatchVramYAddressExtensionWord, solidBatchDitherEnabled, solidBatchSkippedLineParity, solidBatchReadsVram, solidBatchRasterKind);
			texturedVertexFloatCount = flushTexturedCommands(gx, commandBuffer, texturedVertexFloatCount, texturedBatchCommandIndex);
			finishLineBatch(gx, gx.primitiveSubmission.lineFloatCount);
			submitGxGpuPrimitiveBatches(gx);
		}
	}
	gx.processedCommandCount = commandIndex;
	finishSolidBatch(gx, gx.primitiveSubmission.solidFloatCount, solidBatchFixedColor, solidBatchBlendEnabled, solidBatchBlendMode, solidBatchMaskBitModeWord, solidBatchVramYAddressExtensionWord, solidBatchDitherEnabled, solidBatchSkippedLineParity, solidBatchReadsVram, solidBatchRasterKind);
	flushTexturedCommands(gx, commandBuffer, texturedVertexFloatCount, texturedBatchCommandIndex);
	finishLineBatch(gx, gx.primitiveSubmission.lineFloatCount);
	submitGxGpuPrimitiveBatches(gx);
}

size_t appendLineCommandVertices(OpenGLES2GxGpuState& gx,
	const GxGpuCommandStorage& commandBuffer,
	u32 commandIndex,
	size_t vertexFloatCount) {
	const u32 wordStart = commandBuffer.commandWordStart[commandIndex];
	const u32 record = commandBuffer.commandDrawIndex[commandIndex];
	const u32 positionStride = commandBuffer.drawPositionStride[record];
	const u32 colorStride = commandBuffer.drawColorStride[record];
	const u32 drawingOffsetWord = commandBuffer.commandDrawingOffsetWord[commandIndex];
	const i32 dx = gxGpuSigned11(drawingOffsetWord);
	const i32 dy = gxGpuDrawingOffsetY(drawingOffsetWord);
	u32 color0 = commandBuffer.words[wordStart];
	u32 xy0 = commandBuffer.words[wordStart + 1u];
	for (u32 vertex = 1u; vertex < commandBuffer.drawVertexCount[record]; ++vertex) {
		const u32 color1 = commandBuffer.words[wordStart + vertex * colorStride];
		const u32 xy1 = commandBuffer.words[wordStart + 1u + vertex * positionStride];
		vertexFloatCount = appendBatchedLineSegment(gx, vertexFloatCount,
			dx + gxGpuSigned11(xy0), dy + gxGpuVertexY(xy0), color0,
			dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color1);
		color0 = color1;
		xy0 = xy1;
	}
	return vertexFloatCount;
}

void renderNewSolidCommands(OpenGLES2GxGpuState& gx, bool fixedColor, size_t vertexFloatCount, GLintptr vertexBufferOffset, const GxGpuVramCopyRect& drawBounds, bool blendEnabled, u32 blendMode, u32 maskBitModeWord, bool ditherEnabled, u32 skippedLineParity, GxGpuRasterKind rasterKind) {
	const bool hardware = gx.drawTargets.hardwareBlending() && blendEnabled && !gxGpuMaskBitCheckBeforeDraw(maskBitModeWord);
	GxGpuPrimitiveProgram& program = fixedColor ? (hardware ? gx.hardwareFixedSolidProgram : gx.fixedSolidProgram)
		: (hardware ? gx.hardwareSolidProgram : gx.solidProgram);
	const bool textureBarrier = gx.textureBarrier
		&& (blendEnabled || gxGpuMaskBitCheckBeforeDraw(maskBitModeWord));
	const bool samplesDestination = !gx.framebufferFetch && !textureBarrier && !hardware
		&& (blendEnabled || gxGpuMaskBitCheckBeforeDraw(maskBitModeWord));
	const size_t vertexFloatStride = fixedColor ? kGxGpuFixedSolidVertexFloats : kGxGpuSolidVertexFloats;
	const uintptr_t vertexBufferAddress = static_cast<uintptr_t>(vertexBufferOffset);
	const auto bindDrawState = [&] {
		beginGxGpuVramRenderTarget(gx);
		gx.backend->drawState.useProgram(program.id);
		const auto& targetBounds = gx.drawTargets.bounds();
		program.target.write(targetBounds.left, targetBounds.top, targetBounds.right - targetBounds.left, targetBounds.bottom - targetBounds.top);
		writePrimitiveUniforms(program, blendEnabled, blendMode, maskBitModeWord,
			ditherEnabled, skippedLineParity, rasterKind == GxGpuRasterKind::Polygon);
		if (!gx.framebufferFetch) {
			gx.backend->setActiveTextureUnit(GLES2_TEXTURE_UNIT_GX_SAMPLE);
			gx.backend->bindTexture2D(textureBarrier ? &gx.drawTargets.color() : &gx.drawTargets.destinationSample());
		}
		gx.backend->drawState.bindBuffer(GL_ARRAY_BUFFER, gx.vertexStream.buffer);
		if (fixedColor) {
			gx.backend->drawState.enableVertexAttribArray(static_cast<GLuint>(program.positionAttrib));
			gx.backend->drawState.vertexAttribPointer(static_cast<GLuint>(program.positionAttrib), 2, GL_FLOAT, GL_FALSE, kGxGpuFixedSolidVertexStride, reinterpret_cast<const void*>(vertexBufferAddress));
			gx.backend->drawState.enableVertexAttribArray(static_cast<GLuint>(program.colorPlaneBaseAttrib));
			gx.backend->drawState.vertexAttribPointer(static_cast<GLuint>(program.colorPlaneBaseAttrib), 3, GL_FLOAT, GL_FALSE, kGxGpuFixedSolidVertexStride, reinterpret_cast<const void*>(vertexBufferAddress + 2u * sizeof(f32)));
			gx.backend->drawState.enableVertexAttribArray(static_cast<GLuint>(program.colorPlaneStepXAttrib));
			gx.backend->drawState.vertexAttribPointer(static_cast<GLuint>(program.colorPlaneStepXAttrib), 3, GL_FLOAT, GL_FALSE, kGxGpuFixedSolidVertexStride, reinterpret_cast<const void*>(vertexBufferAddress + 5u * sizeof(f32)));
			gx.backend->drawState.enableVertexAttribArray(static_cast<GLuint>(program.colorPlaneStepYAttrib));
			gx.backend->drawState.vertexAttribPointer(static_cast<GLuint>(program.colorPlaneStepYAttrib), 3, GL_FLOAT, GL_FALSE, kGxGpuFixedSolidVertexStride, reinterpret_cast<const void*>(vertexBufferAddress + 8u * sizeof(f32)));
		} else {
			gx.backend->drawState.enableVertexAttribArray(static_cast<GLuint>(program.positionAttrib));
			gx.backend->drawState.vertexAttribPointer(static_cast<GLuint>(program.positionAttrib), 2, GL_FLOAT, GL_FALSE, kGxGpuSolidVertexStride, reinterpret_cast<const void*>(vertexBufferAddress));
			gx.backend->drawState.enableVertexAttribArray(static_cast<GLuint>(program.colorAttrib));
			gx.backend->drawState.vertexAttribPointer(static_cast<GLuint>(program.colorAttrib), 4, GL_FLOAT, GL_FALSE, kGxGpuSolidVertexStride, reinterpret_cast<const void*>(vertexBufferAddress + 2u * sizeof(f32)));
		}
	};
	const GLsizei vertexCount = static_cast<GLsizei>(vertexFloatCount / vertexFloatStride);
	const GLint logicalYBaseUniform = fixedColor
		? program.logicalYBaseUniform
		: program.logicalYBaseUniform;
	if (gx.vramTextureRows == kGxGpuVramYAddressPeriod) {
		drawGxGpuLogicalVramArea(gx,
			drawBounds,
			0,
			vertexCount,
			textureBarrier,
			false,
			samplesDestination,
			program, blendMode,
			logicalYBaseUniform, bindDrawState);
	} else {
		const GLsizei primitiveVertexCount = rasterKind == GxGpuRasterKind::Polygon ? 3 : 6;
		const bool syncSampleBetweenAliasBands = !gx.framebufferFetch
			&& !textureBarrier
			&& (blendEnabled || gxGpuMaskBitCheckBeforeDraw(maskBitModeWord));
		for (GLint firstVertex = 0; firstVertex < vertexCount; firstVertex += primitiveVertexCount) {
			drawGxGpuLogicalVramArea(gx,
				drawBounds,
				firstVertex,
				primitiveVertexCount,
				textureBarrier,
				syncSampleBetweenAliasBands,
				samplesDestination,
				program, blendMode,
				logicalYBaseUniform, bindDrawState);
		}
	}
	gx.backend->drawState.disable(GLES2Capability::ScissorTest);
}

void renderReadVramSolidQuad(OpenGLES2GxGpuState& gx, bool fixedColor, u32 topLeftWord, u32 bottomRightWord, u32 vramYAddressExtensionWord, bool blendEnabled, u32 blendMode, u32 maskBitModeWord, bool ditherEnabled, u32 skippedLineParity) {
	const size_t triangleFloatCount = fixedColor ? kGxGpuFixedSolidTriangleFloats : kGxGpuSolidTriangleFloats;
	const size_t vertexFloatStride = fixedColor ? kGxGpuFixedSolidVertexFloats : kGxGpuSolidVertexFloats;
	const GLsizeiptr vertexByteCount = static_cast<GLsizeiptr>(triangleFloatCount * 2u * sizeof(f32));
	gx.vertexStream.reserve(vertexByteCount);
	const GLintptr vertexBufferOffset = gx.vertexStream.append(gx.solidVertices.data(), vertexByteCount);
	setGxGpuVertexBoundsRect(GxGpuRasterKind::Polygon, gx.solidCommandRect, gx.solidVertices.data(), 0u, triangleFloatCount, vertexFloatStride, topLeftWord, bottomRightWord, vramYAddressExtensionWord);
	if (!gx.framebufferFetch && !gx.textureBarrier && !gx.drawTargets.enabled()) {
		syncGxGpuSampleTextureLogicalArea(gx,
			static_cast<u32>(gx.solidCommandRect.left),
			static_cast<u32>(gx.solidCommandRect.top),
			static_cast<u32>(gx.solidCommandRect.right - gx.solidCommandRect.left),
			static_cast<u32>(gx.solidCommandRect.bottom - gx.solidCommandRect.top),
			vramYAddressExtensionWord);
	}
	renderNewSolidCommands(gx, fixedColor, triangleFloatCount, vertexBufferOffset, gx.solidCommandRect, blendEnabled, blendMode, maskBitModeWord, ditherEnabled, skippedLineParity, GxGpuRasterKind::Polygon);
	setGxGpuVertexBoundsRect(GxGpuRasterKind::Polygon, gx.solidCommandRect, gx.solidVertices.data(), triangleFloatCount, triangleFloatCount * 2u, vertexFloatStride, topLeftWord, bottomRightWord, vramYAddressExtensionWord);
	if (!gx.framebufferFetch && !gx.textureBarrier && !gx.drawTargets.enabled()) {
		syncGxGpuSampleTextureLogicalArea(gx,
			static_cast<u32>(gx.solidCommandRect.left),
			static_cast<u32>(gx.solidCommandRect.top),
			static_cast<u32>(gx.solidCommandRect.right - gx.solidCommandRect.left),
			static_cast<u32>(gx.solidCommandRect.bottom - gx.solidCommandRect.top),
			vramYAddressExtensionWord);
	}
	renderNewSolidCommands(gx, fixedColor, triangleFloatCount, vertexBufferOffset + static_cast<GLintptr>(triangleFloatCount * sizeof(f32)), gx.solidCommandRect, blendEnabled, blendMode, maskBitModeWord, ditherEnabled, skippedLineParity, GxGpuRasterKind::Polygon);
}

void renderTransferCommands(OpenGLES2GxGpuState& gx,
	size_t vertexFloatCount,
	GLES2Texture& sourceTexture,
	i32 sourceTextureUnit,
	u32 maskBitModeWord,
	bool syncSampleBetweenAliasBands,
	GxGpuTransferProgram& program) {
	const GLsizeiptr vertexByteCount = static_cast<GLsizeiptr>(vertexFloatCount * sizeof(f32));
	gx.vertexStream.reserve(vertexByteCount);
	const GLintptr vertexBufferOffset = gx.vertexStream.append(gx.transferVertices.data(), vertexByteCount);
	const uintptr_t vertexBufferAddress = static_cast<uintptr_t>(vertexBufferOffset);
	const auto bindDrawState = [&] {
		gx.backend->drawState.useProgram(program.id);
		gx.backend->setRenderTarget(gx.vramFramebuffer, kGxGpuVramXAddressPeriod, gx.vramTextureRows);
		// Transfer vertices use physical VRAM coordinates, not a cached region's viewport.
		gx.backend->drawState.viewport(0, 0, kGxGpuVramXAddressPeriod, gx.vramTextureRows);
		gx.backend->drawState.disable(GLES2Capability::DepthTest);
		gx.backend->drawState.depthMask(GL_FALSE);
		gx.backend->drawState.disable(GLES2Capability::CullFace);
		gx.backend->drawState.disable(GLES2Capability::Blend);
		gx.backend->drawState.disable(GLES2Capability::ScissorTest);
		writeTransferUniforms(program, sourceTextureUnit, maskBitModeWord);
		gx.backend->setActiveTextureUnit(sourceTextureUnit);
		gx.backend->bindTexture2D(&sourceTexture);
		gx.backend->setActiveTextureUnit(GLES2_TEXTURE_UNIT_GX_SAMPLE);
		gx.backend->bindTexture2D(&gx.vramSampleTexture);
		gx.backend->drawState.bindBuffer(GL_ARRAY_BUFFER, gx.vertexStream.buffer);
		gx.backend->drawState.enableVertexAttribArray(kGxGpuTransferPositionAttrib);
		gx.backend->drawState.vertexAttribPointer(kGxGpuTransferPositionAttrib, 2, GL_FLOAT, GL_FALSE, kGxGpuTransferVertexStride, reinterpret_cast<const void*>(vertexBufferAddress));
		gx.backend->drawState.enableVertexAttribArray(kGxGpuTransferSourceOffsetAttrib);
		gx.backend->drawState.vertexAttribPointer(kGxGpuTransferSourceOffsetAttrib, 2, GL_FLOAT, GL_FALSE, kGxGpuTransferVertexStride, reinterpret_cast<const void*>(vertexBufferAddress + 2u * sizeof(f32)));
	};
	if (gx.vramTextureRows == kGxGpuVramYAddressPeriod) {
		bindDrawState();
		glDrawArrays(GL_TRIANGLES, 0, static_cast<GLsizei>(vertexFloatCount / kGxGpuTransferVertexFloats));
		return;
	}
	gx.backend->drawState.enable(GLES2Capability::ScissorTest);
	for (size_t vertexFloatStart = 0u; vertexFloatStart < vertexFloatCount; vertexFloatStart += kGxGpuTransferSegmentFloats) {
		const i32 left = static_cast<i32>(gx.transferVertices[vertexFloatStart]);
		const i32 top = static_cast<i32>(gx.transferVertices[vertexFloatStart + 1u]);
		const i32 right = static_cast<i32>(gx.transferVertices[vertexFloatStart + kGxGpuTransferVertexFloats]);
		const i32 bottom = static_cast<i32>(gx.transferVertices[vertexFloatStart + kGxGpuTransferVertexFloats * 2u + 1u]);
		const i32 firstBandBase = (top / gx.vramTextureRows) * gx.vramTextureRows;
		for (i32 bandBase = firstBandBase; bandBase < bottom; bandBase += gx.vramTextureRows) {
			const i32 logicalTop = top > bandBase ? top : bandBase;
			const i32 bandBottom = bandBase + gx.vramTextureRows;
			const i32 logicalBottom = bottom < bandBottom ? bottom : bandBottom;
			if (logicalBottom <= logicalTop) {
				continue;
			}
			if (syncSampleBetweenAliasBands) {
				syncGxGpuSampleTextureArea(gx,
					left,
					logicalTop - bandBase,
					right,
					logicalBottom - bandBase);
			}
			bindDrawState();
			gx.backend->drawState.enable(GLES2Capability::ScissorTest);
			gx.backend->drawState.viewport(0, -bandBase, kGxGpuVramXAddressPeriod, kGxGpuVramYAddressPeriod);
			gx.backend->drawState.scissor(left, logicalTop - bandBase, right - left, logicalBottom - logicalTop);
			glUniform1i(program.logicalYBaseUniform, bandBase);
			glDrawArrays(
				GL_TRIANGLES,
				static_cast<GLint>(vertexFloatStart / kGxGpuTransferVertexFloats),
				static_cast<GLsizei>(kGxGpuTransferVerticesPerSegment));
			markGxGpuSampleTextureDirtyArea(gx,
				left,
				logicalTop - bandBase,
				right,
				logicalBottom - bandBase);
		}
	}
	gx.backend->drawState.disable(GLES2Capability::ScissorTest);
}

size_t appendTexturedCommandVertices(OpenGLES2GxGpuState& gx, const GxGpuCommandStorage& commandBuffer, u32 commandIndex, size_t vertexFloatCount) {
	const u32 drawModeWord = commandBuffer.commandDrawModeWord[commandIndex];
	const u32 textureWord = commandBuffer.words[commandBuffer.commandWordStart[commandIndex] + 2u];
	const u32 vramYAddressExtensionWord = commandBuffer.commandVramYAddressExtensionWord[commandIndex];
	gx.texturedTextureSource[0u] = static_cast<u16>(gxGpuDrawModeTexturePageBaseX(drawModeWord));
	gx.texturedTextureSource[1u] = static_cast<u16>(gxGpuDrawModeTexturePageBaseY(drawModeWord, vramYAddressExtensionWord));
	gx.texturedTextureSource[2u] = static_cast<u16>(gxGpuTextureClutBaseX(textureWord));
	gx.texturedTextureSource[3u] = static_cast<u16>(gxGpuTextureClutBaseY(textureWord, vramYAddressExtensionWord));

	return commandBuffer.commandKind[commandIndex] == GX_GPU_COMMAND_DRAW_POLYGON
		? appendTexturedPolygon(gx, commandBuffer, commandIndex, vertexFloatCount)
		: appendTexturedRectangle(gx, commandBuffer, commandIndex, vertexFloatCount);
}

bool canInterpolateGxGpuIntegerUv(std::span<const f32> vertices, bool rectangle) {
	// Integer unit-step planes need no fragment Q12 multiplication. This also
	// covers translated, mirrored and quarter-turned sprites emitted as quads.
	// Keep the quarter-texel bias representable by the minimum mediump mantissa.
	const f32 samplePhase = rectangle ? -0.5f : 0.0f;
	for (size_t triangle = 0u; triangle < vertices.size(); triangle += kGxGpuTexturedVertexFloats * 3u) {
		const i32 ux = gxGpuTriangleAttributeSignedStep(static_cast<u32>(vertices[triangle + 7u]));
		const i32 vx = gxGpuTriangleAttributeSignedStep(static_cast<u32>(vertices[triangle + 8u]));
		const i32 uy = gxGpuTriangleAttributeSignedStep(static_cast<u32>(vertices[triangle + 9u]));
		const i32 vy = gxGpuTriangleAttributeSignedStep(static_cast<u32>(vertices[triangle + 10u]));
		if (ux % 4096 != 0 || vx % 4096 != 0 || uy % 4096 != 0 || vy % 4096 != 0
			|| ux < -4096 || ux > 4096 || vx < -4096 || vx > 4096
			|| uy < -4096 || uy > 4096 || vy < -4096 || vy > 4096) return false;
		const i32 baseU = (static_cast<u32>(vertices[triangle + 5u]) >> 12u) - (ux > 0 || uy > 0 ? 256 : 0);
		const i32 baseV = (static_cast<u32>(vertices[triangle + 6u]) >> 12u) - (vx > 0 || vy > 0 ? 256 : 0);
		for (size_t vertex = 0u; vertex < 3u; ++vertex) {
			const size_t offset = triangle + vertex * kGxGpuTexturedVertexFloats;
			const f32 x = vertices[offset] + samplePhase;
			const f32 y = vertices[offset + 1u] + samplePhase;
			const f32 u = baseU + (ux / 4096) * x + (uy / 4096) * y + 0.25f;
			const f32 v = baseV + (vx / 4096) * x + (vy / 4096) * y + 0.25f;
			if (u <= -512.0f || u >= 512.0f || v <= -512.0f || v >= 512.0f) return false;
		}
	}
	return true;
}

void renderTexturedVertices(OpenGLES2GxGpuState& gx,
	const GxGpuCommandStorage& commandBuffer,
	u32 commandIndex,
	size_t vertexFloatCount,
	bool uniformGain,
	u32 topLeftWord,
	u32 bottomRightWord,
	bool textureBarrier,
	bool syncSampleBetweenAliasBands,
	bool splitTriangles,
	bool syncSourceBetweenTriangles) {
	const size_t generationFloatStart = gx.texturedGeometry.commandFloatOffsets[commandIndex];
	const f32* vertices = gx.texturedGeometry.vertices.data() + generationFloatStart;
	const u32 vramYAddressExtensionWord = commandBuffer.commandVramYAddressExtensionWord[commandIndex];
	const u32 opcode = commandBuffer.commandOpcode[commandIndex];
	const bool hardware = gx.drawTargets.hardwareBlending() && gxGpuCommandSemiTransparencyEnabled(opcode)
		&& !gxGpuMaskBitCheckBeforeDraw(commandBuffer.commandMaskBitModeWord[commandIndex]);
	const bool samplesDestination = !hardware && !gx.framebufferFetch && !textureBarrier
		&& (gxGpuCommandSemiTransparencyEnabled(opcode) || gxGpuMaskBitCheckBeforeDraw(commandBuffer.commandMaskBitModeWord[commandIndex]));
	const bool fixedColor = commandBuffer.commandKind[commandIndex] == GX_GPU_COMMAND_DRAW_POLYGON
		&& (commandBuffer.drawColorStride[commandBuffer.commandDrawIndex[commandIndex]] != 0u)
		&& !gxGpuCommandRawTextureEnabled(opcode);
	const size_t vertexFloatStride = fixedColor ? kGxGpuFixedTexturedVertexFloats : kGxGpuTexturedVertexFloats;
	const bool integerUv = !fixedColor && canInterpolateGxGpuIntegerUv({vertices, vertexFloatCount},
		commandBuffer.commandKind[commandIndex] == GX_GPU_COMMAND_DRAW_RECTANGLE);
	const u32 drawModeWord = commandBuffer.commandDrawModeWord[commandIndex];
	const u32 textureMode = gxGpuDrawModeTextureMode(drawModeWord);
	const bool rawTexture = gxGpuCommandRawTextureEnabled(opcode);
	const bool opaqueWordEligible = !fixedColor && !gxGpuCommandSemiTransparencyEnabled(opcode)
		&& !gxGpuMaskBitCheckBeforeDraw(commandBuffer.commandMaskBitModeWord[commandIndex])
		&& commandBuffer.commandTextureWindowWord[commandIndex] == 0u;
	const u32 gainRgb = commandBuffer.words[commandBuffer.commandWordStart[commandIndex]] & 0x00ffffffu;
	const bool zeroGain = opaqueWordEligible && !rawTexture && uniformGain && gainRgb == 0u;
	const bool neutralGain = opaqueWordEligible && !rawTexture && uniformGain && gainRgb == 0x00808080u
		&& (commandBuffer.commandKind[commandIndex] != GX_GPU_COMMAND_DRAW_POLYGON || !gxGpuDitheredPolygon(drawModeWord, opcode));
	GxGpuTexturedProgram& program = hardware
		? (fixedColor ? gx.hardwareFixedTexturedProgram : (integerUv ? gx.hardwareIntegerTexturedProgram : gx.hardwareTexturedProgram))
		: fixedColor ? gx.fixedTexturedProgram
		: (opaqueWordEligible && (rawTexture || zeroGain || neutralGain)
			? gx.opaqueWordPrograms[zeroGain ? 1u : 0u][integerUv ? 1u : 0u][textureMode < 2u ? textureMode : 2u]
			: (integerUv ? gx.integerTexturedProgram : gx.texturedProgram));
	const GLint logicalYBaseUniform = program.logicalYBaseUniform;

	submitGxGpuPrimitiveBatches(gx);
	const uintptr_t vertexBufferAddress = generationFloatStart * sizeof(f32);
	const auto bindDrawState = [&] {
		beginGxGpuVramRenderTarget(gx);
		gx.backend->drawState.useProgram(program.id);
		const auto& targetBounds = gx.drawTargets.bounds();
		program.target.write(targetBounds.left, targetBounds.top, targetBounds.right - targetBounds.left, targetBounds.bottom - targetBounds.top);
		writeTexturedUniforms(program, commandBuffer, commandIndex);
		gx.backend->setActiveTextureUnit(GLES2_TEXTURE_UNIT_GX_SAMPLE);
		gx.backend->bindTexture2D(&gx.vramSampleTexture);
		if (!gx.framebufferFetch && (textureBarrier || gx.drawTargets.enabled())) {
			gx.backend->setActiveTextureUnit(GLES2_TEXTURE_UNIT_GX_DESTINATION);
			gx.backend->bindTexture2D(textureBarrier ? &gx.drawTargets.color() : &gx.drawTargets.destinationSample());
		}
		gx.backend->drawState.bindBuffer(GL_ARRAY_BUFFER, gx.texturedGeometry.buffer);
		if (fixedColor) {
			gx.backend->drawState.enableVertexAttribArray(static_cast<GLuint>(program.positionAttrib));
			gx.backend->drawState.vertexAttribPointer(static_cast<GLuint>(program.positionAttrib), 2, GL_FLOAT, GL_FALSE, kGxGpuFixedTexturedVertexStride, reinterpret_cast<const void*>(vertexBufferAddress));
			gx.backend->drawState.enableVertexAttribArray(static_cast<GLuint>(program.uvPlaneBaseAttrib));
			gx.backend->drawState.vertexAttribPointer(static_cast<GLuint>(program.uvPlaneBaseAttrib), 2, GL_FLOAT, GL_FALSE, kGxGpuFixedTexturedVertexStride, reinterpret_cast<const void*>(vertexBufferAddress + 2u * sizeof(f32)));
			gx.backend->drawState.enableVertexAttribArray(static_cast<GLuint>(program.uvPlaneStepXAttrib));
			gx.backend->drawState.vertexAttribPointer(static_cast<GLuint>(program.uvPlaneStepXAttrib), 2, GL_FLOAT, GL_FALSE, kGxGpuFixedTexturedVertexStride, reinterpret_cast<const void*>(vertexBufferAddress + 4u * sizeof(f32)));
			gx.backend->drawState.enableVertexAttribArray(static_cast<GLuint>(program.uvPlaneStepYAttrib));
			gx.backend->drawState.vertexAttribPointer(static_cast<GLuint>(program.uvPlaneStepYAttrib), 2, GL_FLOAT, GL_FALSE, kGxGpuFixedTexturedVertexStride, reinterpret_cast<const void*>(vertexBufferAddress + 6u * sizeof(f32)));
			gx.backend->drawState.enableVertexAttribArray(static_cast<GLuint>(program.colorPlaneBaseAttrib));
			gx.backend->drawState.vertexAttribPointer(static_cast<GLuint>(program.colorPlaneBaseAttrib), 3, GL_FLOAT, GL_FALSE, kGxGpuFixedTexturedVertexStride, reinterpret_cast<const void*>(vertexBufferAddress + 8u * sizeof(f32)));
			gx.backend->drawState.enableVertexAttribArray(static_cast<GLuint>(program.colorPlaneStepXAttrib));
			gx.backend->drawState.vertexAttribPointer(static_cast<GLuint>(program.colorPlaneStepXAttrib), 3, GL_FLOAT, GL_FALSE, kGxGpuFixedTexturedVertexStride, reinterpret_cast<const void*>(vertexBufferAddress + 11u * sizeof(f32)));
			gx.backend->drawState.enableVertexAttribArray(static_cast<GLuint>(program.colorPlaneStepYAttrib));
			gx.backend->drawState.vertexAttribPointer(static_cast<GLuint>(program.colorPlaneStepYAttrib), 3, GL_FLOAT, GL_FALSE, kGxGpuFixedTexturedVertexStride, reinterpret_cast<const void*>(vertexBufferAddress + 14u * sizeof(f32)));
			gx.backend->drawState.enableVertexAttribArray(static_cast<GLuint>(program.textureSourceAttrib));
			gx.backend->drawState.vertexAttribPointer(static_cast<GLuint>(program.textureSourceAttrib), 4, GL_UNSIGNED_SHORT, GL_FALSE, kGxGpuFixedTexturedVertexStride, reinterpret_cast<const void*>(vertexBufferAddress + kGxGpuFixedTexturedTextureSourceFloatOffset * sizeof(f32)));
		} else {
			gx.backend->drawState.enableVertexAttribArray(static_cast<GLuint>(program.positionAttrib));
			gx.backend->drawState.vertexAttribPointer(static_cast<GLuint>(program.positionAttrib), 2, GL_FLOAT, GL_FALSE, kGxGpuTexturedVertexStride, reinterpret_cast<const void*>(vertexBufferAddress));
			if (!program.opaqueWordOutput) {
				gx.backend->drawState.enableVertexAttribArray(static_cast<GLuint>(program.colorAttrib));
				gx.backend->drawState.vertexAttribPointer(static_cast<GLuint>(program.colorAttrib), 3, GL_FLOAT, GL_FALSE, kGxGpuTexturedVertexStride, reinterpret_cast<const void*>(vertexBufferAddress + 2u * sizeof(f32)));
			}
			gx.backend->drawState.enableVertexAttribArray(static_cast<GLuint>(program.uvPlaneBaseAttrib));
			gx.backend->drawState.vertexAttribPointer(static_cast<GLuint>(program.uvPlaneBaseAttrib), 2, GL_FLOAT, GL_FALSE, kGxGpuTexturedVertexStride, reinterpret_cast<const void*>(vertexBufferAddress + 5u * sizeof(f32)));
			gx.backend->drawState.enableVertexAttribArray(static_cast<GLuint>(program.uvPlaneStepXAttrib));
			gx.backend->drawState.vertexAttribPointer(static_cast<GLuint>(program.uvPlaneStepXAttrib), 2, GL_FLOAT, GL_FALSE, kGxGpuTexturedVertexStride, reinterpret_cast<const void*>(vertexBufferAddress + 7u * sizeof(f32)));
			gx.backend->drawState.enableVertexAttribArray(static_cast<GLuint>(program.uvPlaneStepYAttrib));
			gx.backend->drawState.vertexAttribPointer(static_cast<GLuint>(program.uvPlaneStepYAttrib), 2, GL_FLOAT, GL_FALSE, kGxGpuTexturedVertexStride, reinterpret_cast<const void*>(vertexBufferAddress + 9u * sizeof(f32)));
			gx.backend->drawState.enableVertexAttribArray(static_cast<GLuint>(program.textureSourceAttrib));
			gx.backend->drawState.vertexAttribPointer(static_cast<GLuint>(program.textureSourceAttrib), 4, GL_UNSIGNED_SHORT, GL_FALSE, kGxGpuTexturedVertexStride, reinterpret_cast<const void*>(vertexBufferAddress + kGxGpuTexturedTextureSourceFloatOffset * sizeof(f32)));
		}
	};
	if (!splitTriangles) {
		drawGxGpuLogicalVramArea(gx,
			gx.texturedCommandRect,
			0,
			static_cast<GLsizei>(vertexFloatCount / vertexFloatStride),
			textureBarrier,
			syncSampleBetweenAliasBands,
			samplesDestination,
			program, gxGpuDrawModeTransparencyMode(drawModeWord),
			logicalYBaseUniform, bindDrawState);
	} else {
		const u32 maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
		const bool readsVram = gxGpuCommandSemiTransparencyEnabled(opcode) || gxGpuMaskBitCheckBeforeDraw(maskBitModeWord);
		// A rectangle's two triangles have disjoint coverage. Keep them in one
		// two-pass hardware blend submission; arbitrary polygon quads can overlap.
		const size_t dependencyPrimitiveFloatCount = hardware && !syncSourceBetweenTriangles
			&& commandBuffer.commandKind[commandIndex] == GX_GPU_COMMAND_DRAW_RECTANGLE
			? 6u * vertexFloatStride : 3u * vertexFloatStride;
		if (!syncSourceBetweenTriangles
			&& !readsVram
			&& gx.vramTextureRows == kGxGpuVramYAddressPeriod) {
			drawGxGpuLogicalVramArea(gx,
				gx.texturedCommandRect,
				0,
				static_cast<GLsizei>(vertexFloatCount / vertexFloatStride),
				false,
				false,
				samplesDestination,
				program, gxGpuDrawModeTransparencyMode(drawModeWord),
				logicalYBaseUniform, bindDrawState);
		} else {
			size_t dependencyBatchFloatStart = 0u;
			resetGxGpuVramCopyRect(gx.texturedDependencyBatchRect);
			for (size_t vertexFloatStart = 0u; vertexFloatStart < vertexFloatCount; vertexFloatStart += dependencyPrimitiveFloatCount) {
				const size_t vertexFloatEnd = vertexFloatStart + dependencyPrimitiveFloatCount;
				setGxGpuVertexBoundsRect(commandBuffer.commandKind[commandIndex] == GX_GPU_COMMAND_DRAW_POLYGON ? GxGpuRasterKind::Polygon : GxGpuRasterKind::Rectangle, gx.vramCopyRectScratch, vertices, vertexFloatStart, vertexFloatEnd, vertexFloatStride, topLeftWord, bottomRightWord, vramYAddressExtensionWord);
				if (vertexFloatStart != dependencyBatchFloatStart
					&& (gx.vramTextureRows != kGxGpuVramYAddressPeriod
						|| syncSourceBetweenTriangles
						|| gxGpuVramCopyRectsOverlap(gx, gx.texturedDependencyBatchRect, gx.vramCopyRectScratch, vramYAddressExtensionWord))) {
					if (dependencyBatchFloatStart != 0u) {
						if (syncSourceBetweenTriangles) {
							prepareGxGpuTexturedSourceReads(gx, commandBuffer, commandIndex, generationFloatStart, generationFloatStart + vertexFloatCount, gx.texturedCommandRect, gx.texturedBatchRect, fixedColor);
						}
						if (samplesDestination && !gx.drawTargets.enabled()) {
							syncGxGpuSampleTextureLogicalArea(gx,
								static_cast<u32>(gx.texturedDependencyBatchRect.left),
								static_cast<u32>(gx.texturedDependencyBatchRect.top),
								static_cast<u32>(gx.texturedDependencyBatchRect.right - gx.texturedDependencyBatchRect.left),
								static_cast<u32>(gx.texturedDependencyBatchRect.bottom - gx.texturedDependencyBatchRect.top),
								vramYAddressExtensionWord);
						}
					}
					drawGxGpuLogicalVramArea(gx,
						gx.texturedDependencyBatchRect,
						static_cast<GLint>(dependencyBatchFloatStart / vertexFloatStride),
						static_cast<GLsizei>((vertexFloatStart - dependencyBatchFloatStart) / vertexFloatStride),
						textureBarrier,
						syncSampleBetweenAliasBands,
						samplesDestination,
						program, gxGpuDrawModeTransparencyMode(drawModeWord),
						logicalYBaseUniform, bindDrawState);
					dependencyBatchFloatStart = vertexFloatStart;
					resetGxGpuVramCopyRect(gx.texturedDependencyBatchRect);
				}
				includeGxGpuVramCopyRect(gx.texturedDependencyBatchRect, gx.vramCopyRectScratch);
			}
			if (dependencyBatchFloatStart != 0u) {
				if (syncSourceBetweenTriangles) {
					prepareGxGpuTexturedSourceReads(gx, commandBuffer, commandIndex, generationFloatStart, generationFloatStart + vertexFloatCount, gx.texturedCommandRect, gx.texturedBatchRect, fixedColor);
				}
				if (samplesDestination && !gx.drawTargets.enabled()) {
					syncGxGpuSampleTextureLogicalArea(gx,
						static_cast<u32>(gx.texturedDependencyBatchRect.left),
						static_cast<u32>(gx.texturedDependencyBatchRect.top),
						static_cast<u32>(gx.texturedDependencyBatchRect.right - gx.texturedDependencyBatchRect.left),
						static_cast<u32>(gx.texturedDependencyBatchRect.bottom - gx.texturedDependencyBatchRect.top),
						vramYAddressExtensionWord);
				}
			}
			drawGxGpuLogicalVramArea(gx,
				gx.texturedDependencyBatchRect,
				static_cast<GLint>(dependencyBatchFloatStart / vertexFloatStride),
				static_cast<GLsizei>((vertexFloatCount - dependencyBatchFloatStart) / vertexFloatStride),
				textureBarrier,
				syncSampleBetweenAliasBands,
				samplesDestination,
				program, gxGpuDrawModeTransparencyMode(drawModeWord),
				logicalYBaseUniform, bindDrawState);
		}
	}
	gx.backend->drawState.disable(GLES2Capability::ScissorTest);
}

void renderTexturedCommand(OpenGLES2GxGpuState& gx,
	const GxGpuCommandStorage& commandBuffer,
	u32 commandIndex,
	u32 topLeftWord,
	u32 bottomRightWord) {
	const size_t generationFloatStart = gx.texturedGeometry.commandFloatOffsets[commandIndex];
	const size_t vertexFloatCount = gx.texturedGeometry.commandFloatOffsets[commandIndex + 1u] - generationFloatStart;
	if (vertexFloatCount == 0u) {
		return;
	}
	const u32 opcode = commandBuffer.commandOpcode[commandIndex];
	const u32 vramYAddressExtensionWord = commandBuffer.commandVramYAddressExtensionWord[commandIndex];
	const bool fixedColor = commandBuffer.commandKind[commandIndex] == GX_GPU_COMMAND_DRAW_POLYGON
		&& (commandBuffer.drawColorStride[commandBuffer.commandDrawIndex[commandIndex]] != 0u)
		&& !gxGpuCommandRawTextureEnabled(opcode);
	setGxGpuVertexBoundsRect(
		commandBuffer.commandKind[commandIndex] == GX_GPU_COMMAND_DRAW_POLYGON ? GxGpuRasterKind::Polygon : GxGpuRasterKind::Rectangle,
		gx.texturedCommandRect,
		gx.texturedGeometry.vertices.data() + generationFloatStart,
		0u,
		vertexFloatCount,
		fixedColor ? kGxGpuFixedTexturedVertexFloats : kGxGpuTexturedVertexFloats,
		topLeftWord,
		bottomRightWord,
		vramYAddressExtensionWord);
	const u32 maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
	const bool readsVram = gxGpuCommandSemiTransparencyEnabled(opcode) || gxGpuMaskBitCheckBeforeDraw(maskBitModeWord);
	const u32 sourceOverlaps = prepareGxGpuTexturedSourceReads(gx, commandBuffer, commandIndex, generationFloatStart, generationFloatStart + vertexFloatCount, gx.texturedCommandRect, gx.texturedBatchRect, fixedColor);
	const bool sourceOverlapsDestination = (sourceOverlaps & GX_GPU_TEXTURE_SOURCE_COMMAND_OVERLAP) != 0u;
	const bool textureBarrier = readsVram && gx.textureBarrier;
	const bool samplesDestination = readsVram && !gx.framebufferFetch && !textureBarrier;
	if (samplesDestination && !gx.drawTargets.enabled()) {
		syncGxGpuSampleTextureLogicalArea(gx,
			static_cast<u32>(gx.texturedCommandRect.left),
			static_cast<u32>(gx.texturedCommandRect.top),
			static_cast<u32>(gx.texturedCommandRect.right - gx.texturedCommandRect.left),
			static_cast<u32>(gx.texturedCommandRect.bottom - gx.texturedCommandRect.top),
			vramYAddressExtensionWord);
	}
	renderTexturedVertices(gx,
		commandBuffer,
		commandIndex,
		vertexFloatCount,
		true,
		topLeftWord,
		bottomRightWord,
		textureBarrier,
		samplesDestination || sourceOverlapsDestination,
		commandBuffer.commandKind[commandIndex] == GX_GPU_COMMAND_DRAW_POLYGON,
		sourceOverlapsDestination);
}

size_t flushTexturedCommands(OpenGLES2GxGpuState& gx, const GxGpuCommandStorage& commandBuffer, size_t vertexFloatCount, u32 batchCommandIndex) {
	if (vertexFloatCount != 0u) {
		// Each admitted source is independent of earlier writes in this batch.
		// Publish the demanded cells together before drawing, not once per tile.
		gx.texturedSourceReads.consume(0, 0, kGxGpuVramXAddressPeriod, gx.vramTextureRows,
			[&](i32 left, i32 top, i32 right, i32 bottom) {
				gx.drawTargets.resolve({left, top, right, bottom}, gx.sampleDirtyRegions, false);
				syncGxGpuSampleTextureArea(gx, left, top, right, bottom);
			});
		const size_t generationFloatStart = gx.texturedGeometry.commandFloatOffsets[batchCommandIndex];
		const u32 topLeftWord = commandBuffer.commandDrawingAreaTopLeftWord[batchCommandIndex];
		const u32 bottomRightWord = commandBuffer.commandDrawingAreaBottomRightWord[batchCommandIndex];
		const u32 opcode = commandBuffer.commandOpcode[batchCommandIndex];
		const u32 vramYAddressExtensionWord = commandBuffer.commandVramYAddressExtensionWord[batchCommandIndex];
		const bool fixedColor = commandBuffer.commandKind[batchCommandIndex] == GX_GPU_COMMAND_DRAW_POLYGON
			&& commandBuffer.drawColorStride[commandBuffer.commandDrawIndex[batchCommandIndex]] != 0u
			&& !gxGpuCommandRawTextureEnabled(opcode);
		setGxGpuVertexBoundsRect(
			commandBuffer.commandKind[batchCommandIndex] == GX_GPU_COMMAND_DRAW_POLYGON ? GxGpuRasterKind::Polygon : GxGpuRasterKind::Rectangle,
			gx.texturedCommandRect,
			gx.texturedGeometry.vertices.data() + generationFloatStart,
			0u,
			vertexFloatCount,
			fixedColor ? kGxGpuFixedTexturedVertexFloats : kGxGpuTexturedVertexFloats,
			topLeftWord,
			bottomRightWord,
			vramYAddressExtensionWord);
		const u32 maskBitModeWord = commandBuffer.commandMaskBitModeWord[batchCommandIndex];
		const bool readsVram = gxGpuCommandSemiTransparencyEnabled(opcode) || gxGpuMaskBitCheckBeforeDraw(maskBitModeWord);
		const bool textureBarrier = readsVram && gx.textureBarrier;
		const bool samplesDestination = readsVram && !gx.framebufferFetch && !textureBarrier;
		if (samplesDestination && !gx.drawTargets.enabled()) {
			syncGxGpuSampleTextureLogicalArea(gx,
				static_cast<u32>(gx.texturedCommandRect.left),
				static_cast<u32>(gx.texturedCommandRect.top),
				static_cast<u32>(gx.texturedCommandRect.right - gx.texturedCommandRect.left),
				static_cast<u32>(gx.texturedCommandRect.bottom - gx.texturedCommandRect.top),
				vramYAddressExtensionWord);
		}
		renderTexturedVertices(gx,
			commandBuffer,
			batchCommandIndex,
			vertexFloatCount,
			gx.texturedBatchUniformGain,
			topLeftWord,
			bottomRightWord,
			textureBarrier,
			samplesDestination,
			readsVram
				|| (gx.vramTextureRows != kGxGpuVramYAddressPeriod
					&& commandBuffer.commandKind[batchCommandIndex] == GX_GPU_COMMAND_DRAW_POLYGON),
			false);
	}
	resetGxGpuVramCopyRect(gx.texturedBatchRect);
	return 0u;
}

void writeGxGpuScanoutCircuitUniforms(
	std::array<GLint, 20u>& words,
	const GxGpuPcrtcScanout& scanout,
	const GxGpuPcrtcCircuit& circuit) {
	words[0u] = static_cast<GLint>(circuit.framebufferBaseWord);
	words[1u] = static_cast<GLint>(circuit.framebufferWidth);
	words[2u] = static_cast<GLint>(circuit.framebufferPagesPerRow);
	words[3u] = static_cast<GLint>(circuit.framebufferX);
	words[4u] = static_cast<GLint>(circuit.framebufferY);
	words[5u] = static_cast<GLint>(circuit.displayX);
	words[6u] = static_cast<GLint>(circuit.displayY);
	words[7u] = static_cast<GLint>(circuit.fieldSourceDivisionMultiplierY);
	words[8u] = static_cast<GLint>(circuit.sourcePhaseX);
	words[9u] = static_cast<GLint>(circuit.fieldSourcePhase);
	words[10u] = static_cast<GLint>(circuit.sourceStepX);
	words[11u] = static_cast<GLint>(circuit.fieldSourceStride);
	words[12u] = static_cast<GLint>(circuit.sourceDivisionMultiplierX);
	words[13u] = static_cast<GLint>(scanout.outputHeight);
	words[14u] = static_cast<GLint>(circuit.fieldDisplayY);
	words[15u] = static_cast<GLint>(circuit.linearFieldSourceY);
	words[16u] = static_cast<GLint>(circuit.linearFieldSourceRowStep);
	const u32 linearBase = circuit.framebufferBaseWord
		+ circuit.linearFieldSourceY * circuit.framebufferWidth + circuit.framebufferX;
	words[17u] = static_cast<GLint>(linearBase & (GX_GPU_VRAM_X_ADDRESS_PERIOD - 1u));
	words[18u] = static_cast<GLint>((linearBase >> 10u) & ((GX_GPU_VRAM_ADDRESS_WORD_COUNT - 1u) >> 10u));
	words[19u] = static_cast<GLint>(circuit.framebufferWidth >> 6u);
}

void prepareGxGpuScanoutState(OpenGLES2GxGpuState& gx, const GxGpuPcrtcScanout& scanout) {
	const i32 field = scanout.interlaced ? static_cast<i32>(scanout.field) : -1;
	if (!gx.scanoutCircuitWordsValid
		|| gx.scanoutCircuitWordRevision != scanout.revision
		|| gx.scanoutCircuitWordField != field) {
		writeGxGpuScanoutCircuitUniforms(gx.scanoutCircuitWords[0u], scanout, scanout.circuits[0u]);
		writeGxGpuScanoutCircuitUniforms(gx.scanoutCircuitWords[1u], scanout, scanout.circuits[1u]);
		gx.scanoutCircuitWordRevision = scanout.revision;
		gx.scanoutCircuitWordField = field;
		gx.scanoutCircuitWordsValid = true;
	}
	if (!gx.scanoutFixedStateValid || gx.scanoutFixedStateRevision != scanout.revision) {
		gx.scanoutBackgroundRed = static_cast<GLfloat>(scanout.backgroundColor & 0xffu) / 255.0f;
		gx.scanoutBackgroundGreen = static_cast<GLfloat>((scanout.backgroundColor >> 8u) & 0xffu) / 255.0f;
		gx.scanoutBackgroundBlue = static_cast<GLfloat>((scanout.backgroundColor >> 16u) & 0xffu) / 255.0f;
		gx.scanoutBlendAlpha = static_cast<GLfloat>(scanout.blendAlpha) / 255.0f;
		gx.scanoutFixedStateRevision = scanout.revision;
		gx.scanoutFixedStateValid = true;
	}
}

void publishGxGpuScanoutCircuitUniforms(OpenGLES2GxGpuState& gx,
	const GxGpuPcrtcScanout& scanout,
	u32 circuitIndex,
	GxGpuScanoutProgram& program,
	bool fieldProgram) {
	if (program.circuit != static_cast<i8>(circuitIndex)
		|| program.circuitRevision != scanout.revision
		|| (fieldProgram && program.circuitField != static_cast<i8>(scanout.field))) {
		glUniform4iv(
			program.circuitUniform,
			static_cast<GLsizei>(kGxGpuScanoutCircuitUniformVectorCount),
			gx.scanoutCircuitWords[circuitIndex].data());
		program.circuitRevision = scanout.revision;
		program.circuit = static_cast<i8>(circuitIndex);
		program.circuitField = static_cast<i8>(scanout.field);
	}
	if (fieldProgram
		&& (program.interlaceRevision != scanout.revision
			|| program.interlaceField != static_cast<i8>(scanout.field))) {
		glUniform4i(
			program.interlaceUniform,
			static_cast<GLint>(scanout.fieldHeight),
			static_cast<GLint>(scanout.outputHeight),
			static_cast<GLint>(scanout.field),
			static_cast<GLint>(scanout.fieldOffset));
		program.interlaceRevision = scanout.revision;
		program.interlaceField = static_cast<i8>(scanout.field);
	}
}

void drawGxGpuScanoutPass(OpenGLES2GxGpuState& gx,
	const GxGpuPcrtcScanout& scanout,
	u32 circuitIndex,
	u32 drawPath,
	bool fieldProgram,
	GLuint& boundProgram) {
	const GxGpuPcrtcCircuit& circuit = scanout.circuits[circuitIndex];
	size_t programIndex = static_cast<size_t>(circuit.samplePath);
	if (drawPath == GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_SOURCE_RGB) {
		programIndex += kGxGpuScanoutDoubleAlphaProgramBase;
	}
	GxGpuScanoutProgram& program = fieldProgram
		? gx.scanoutFieldPrograms[programIndex]
		: gx.scanoutPrograms[programIndex];
	if (boundProgram != program.id) {
		gx.backend->drawState.useProgram(program.id);
		boundProgram = program.id;
	}
	publishGxGpuScanoutCircuitUniforms(gx, scanout, circuitIndex, program, fieldProgram);
	if (gx.drawTargets.enabled() && program.cachedTargetRevision != gx.drawTargets.revision()) {
		for (size_t i = 0; i < 2; ++i) {
			const auto& rect = gx.drawTargets.scanoutBounds(i);
			glUniform4i(program.cachedRectUniforms[i], rect.left, rect.top,
				gx.drawTargets.valid(i) ? rect.right - rect.left : 0,
				gx.drawTargets.valid(i) ? rect.bottom - rect.top : 0);
		}
		program.cachedTargetRevision = gx.drawTargets.revision();
	}
	if (drawPath == GX_GPU_PCRTC_SCANOUT_DRAW_RAW_RGB) {
		gx.backend->drawState.disable(GLES2Capability::Blend);
		gx.backend->drawState.colorMask(GL_TRUE, GL_TRUE, GL_TRUE, GL_FALSE);
	} else if (drawPath == GX_GPU_PCRTC_SCANOUT_DRAW_RAW_RGBA) {
		gx.backend->drawState.disable(GLES2Capability::Blend);
		gx.backend->drawState.colorMask(GL_TRUE, GL_TRUE, GL_TRUE, GL_TRUE);
	} else if (drawPath == GX_GPU_PCRTC_SCANOUT_DRAW_RAW_ALPHA) {
		gx.backend->drawState.disable(GLES2Capability::Blend);
		gx.backend->drawState.colorMask(GL_FALSE, GL_FALSE, GL_FALSE, GL_TRUE);
	} else if (drawPath == GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_SOURCE_RGB) {
		gx.backend->drawState.enable(GLES2Capability::Blend);
		gx.backend->drawState.blendFuncSeparate(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA, GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
		gx.backend->drawState.colorMask(GL_TRUE, GL_TRUE, GL_TRUE, GL_FALSE);
	} else if (drawPath == GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_CONSTANT_RGB) {
		gx.backend->drawState.enable(GLES2Capability::Blend);
		gx.backend->drawState.blendColor(0.0f, 0.0f, 0.0f, gx.scanoutBlendAlpha);
		gx.backend->drawState.blendFuncSeparate(GL_CONSTANT_ALPHA, GL_ONE_MINUS_CONSTANT_ALPHA, GL_CONSTANT_ALPHA, GL_ONE_MINUS_CONSTANT_ALPHA);
		gx.backend->drawState.colorMask(GL_TRUE, GL_TRUE, GL_TRUE, GL_FALSE);
	} else if (drawPath == GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_CONSTANT_RGBA) {
		gx.backend->drawState.enable(GLES2Capability::Blend);
		gx.backend->drawState.blendColor(0.0f, 0.0f, 0.0f, gx.scanoutBlendAlpha);
		gx.backend->drawState.blendFuncSeparate(GL_CONSTANT_ALPHA, GL_ONE_MINUS_CONSTANT_ALPHA, GL_ONE, GL_ZERO);
		gx.backend->drawState.colorMask(GL_TRUE, GL_TRUE, GL_TRUE, GL_TRUE);
	}
	glDrawArrays(GL_TRIANGLES, 0, static_cast<GLsizei>(kGxGpuScanoutVertexCount));
}

void drawGxGpuScanoutCircuit(OpenGLES2GxGpuState& gx,
	const GxGpuPcrtcScanout& scanout,
	u32 circuitIndex,
	u32 drawPath,
	bool fieldProgram,
	GLuint& boundProgram) {
	if (drawPath == GX_GPU_PCRTC_SCANOUT_DRAW_NONE) return;
	const GxGpuPcrtcCircuit& circuit = scanout.circuits[circuitIndex];
	if (fieldProgram) {
		gx.backend->drawState.scissor(
			static_cast<GLint>(circuit.displayX),
			static_cast<GLint>(scanout.fieldOffset)
				+ static_cast<GLint>(scanout.fieldHeight)
				- static_cast<GLint>(circuit.fieldDisplayLineStart)
				- static_cast<GLint>(circuit.fieldDisplayLineCount),
			static_cast<GLsizei>(circuit.displayWidth),
			static_cast<GLsizei>(circuit.fieldDisplayLineCount));
	} else {
		gx.backend->drawState.scissor(
			static_cast<GLint>(circuit.displayX),
			static_cast<GLint>(scanout.outputHeight - circuit.displayBottom),
			static_cast<GLsizei>(circuit.displayWidth),
			static_cast<GLsizei>(circuit.displayHeight));
	}
	if (drawPath == GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_SOURCE_RGBA) {
		drawGxGpuScanoutPass(gx, scanout, circuitIndex, GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_SOURCE_RGB, fieldProgram, boundProgram);
		drawGxGpuScanoutPass(gx, scanout, circuitIndex, GX_GPU_PCRTC_SCANOUT_DRAW_RAW_ALPHA, fieldProgram, boundProgram);
		return;
	}
	drawGxGpuScanoutPass(gx, scanout, circuitIndex, drawPath, fieldProgram, boundProgram);
}

void prepareGxGpuScanoutDraw(OpenGLES2GxGpuState& gx) {
	gx.backend->drawState.disable(GLES2Capability::ScissorTest);
	gx.backend->drawState.disable(GLES2Capability::DepthTest);
	gx.backend->drawState.depthMask(GL_FALSE);
	gx.backend->drawState.disable(GLES2Capability::CullFace);
	gx.backend->drawState.disable(GLES2Capability::Blend);
	if (gx.drawTargets.hardwareBlending()) gx.backend->drawState.blendEquationSeparate(GL_FUNC_ADD, GL_FUNC_ADD);
	gx.backend->drawState.colorMask(GL_TRUE, GL_TRUE, GL_TRUE, GL_TRUE);
	gx.backend->setActiveTextureUnit(GLES2_TEXTURE_UNIT_GX_SCANOUT);
	gx.backend->bindTexture2D(&gx.vramTexture);
	if (gx.drawTargets.enabled()) {
		gx.backend->setActiveTextureUnit(GLES2_TEXTURE_UNIT_GX_TRANSFER);
		gx.backend->bindTexture2D(&gx.drawTargets.scanoutTexture(0));
		gx.backend->setActiveTextureUnit(GLES2_TEXTURE_UNIT_GX_DESTINATION);
		gx.backend->bindTexture2D(&gx.drawTargets.scanoutTexture(1));
	}
	gx.backend->drawState.bindBuffer(GL_ARRAY_BUFFER, gx.scanoutVertexBuffer);
	gx.backend->drawState.enableVertexAttribArray(kGxGpuScanoutPositionAttrib);
	gx.backend->drawState.vertexAttribPointer(kGxGpuScanoutPositionAttrib, 2, GL_FLOAT, GL_FALSE, kGxGpuScanoutVertexStride, nullptr);
}

void scanoutProgressiveGxGpuVram(OpenGLES2GxGpuState& gx,
	GLuint frameFbo,
	const GxGpuPipelineState& state,
	const GxGpuPcrtcScanout& scanout,
	GLuint& boundProgram
) {
	gx.backend->setRenderTarget(frameFbo, state.width, state.height);
	prepareGxGpuScanoutDraw(gx);
	if (scanout.backgroundRequired != 0u) {
		glClearColor(gx.scanoutBackgroundRed, gx.scanoutBackgroundGreen, gx.scanoutBackgroundBlue, 0.0f);
		glClear(GL_COLOR_BUFFER_BIT);
	}
	gx.backend->drawState.enable(GLES2Capability::ScissorTest);
	drawGxGpuScanoutCircuit(gx, scanout, 1u, scanout.circuit2OutputPath, false, boundProgram);
	drawGxGpuScanoutCircuit(gx, scanout, 0u, scanout.circuit1OutputPath, false, boundProgram);
	gx.backend->drawState.disable(GLES2Capability::ScissorTest);
	gx.backend->drawState.disable(GLES2Capability::Blend);
	gx.backend->drawState.colorMask(GL_TRUE, GL_TRUE, GL_TRUE, GL_TRUE);
}

void scanoutInterlacedGxGpuVram(OpenGLES2GxGpuState& gx,
	GLuint frameFbo,
	const GxGpuPipelineState& state,
	const GxGpuPcrtcScanout& scanout,
	u64 vramReplacementSerial,
	GLuint& boundProgram
) {
	const i32 width = state.width;
	const i32 height = state.height;
	const i32 fieldHeight = static_cast<i32>(scanout.fieldHeight);
	const i32 fieldOffset = static_cast<i32>(scanout.fieldOffset);
	const bool sizeChanged = gx.scanoutFieldsTexture.width != width || gx.scanoutFieldsTexture.height != height;
	const bool invalid = !gx.scanoutFieldsValid
		|| sizeChanged
		|| gx.scanoutFieldsVramReplacementSerial != vramReplacementSerial;
	if (sizeChanged) {
		gx.backend->setActiveTextureUnit(GLES2_TEXTURE_UNIT_GX_SCANOUT_FIELDS);
		gx.backend->bindTexture2D(&gx.scanoutFieldsTexture);
		glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, width, height, 0, GL_RGBA, GL_UNSIGNED_BYTE, nullptr);
		gx.scanoutFieldsTexture.width = width;
		gx.scanoutFieldsTexture.height = height;
	}

	gx.backend->setRenderTarget(gx.scanoutFieldsFramebuffer, width, height);
	gx.backend->drawState.viewport(0, fieldOffset, width, fieldHeight);
	prepareGxGpuScanoutDraw(gx);
	if (invalid || scanout.backgroundRequired != 0u) {
		glClearColor(gx.scanoutBackgroundRed, gx.scanoutBackgroundGreen, gx.scanoutBackgroundBlue, 0.0f);
	}
	if (invalid) {
		glClear(GL_COLOR_BUFFER_BIT);
	}
	gx.backend->drawState.enable(GLES2Capability::ScissorTest);
	if (scanout.backgroundRequired != 0u && !invalid) {
		gx.backend->drawState.scissor(0, fieldOffset, width, fieldHeight);
		glClear(GL_COLOR_BUFFER_BIT);
	}
	drawGxGpuScanoutCircuit(gx, scanout, 1u, scanout.circuit2OutputPath, true, boundProgram);
	drawGxGpuScanoutCircuit(gx, scanout, 0u, scanout.circuit1OutputPath, true, boundProgram);
	gx.scanoutFieldsValid = true;
	gx.scanoutFieldsVramReplacementSerial = vramReplacementSerial;

	gx.backend->setRenderTarget(frameFbo, width, height);
	gx.backend->drawState.disable(GLES2Capability::ScissorTest);
	gx.backend->drawState.disable(GLES2Capability::Blend);
	gx.backend->drawState.colorMask(GL_TRUE, GL_TRUE, GL_TRUE, GL_TRUE);
	gx.backend->drawState.useProgram(gx.scanoutWeaveProgram);
	if (sizeChanged) {
		glUniform4i(
			gx.scanoutWeaveInterlaceUniform,
			static_cast<GLint>(scanout.evenFieldHeight),
			height,
			width,
			static_cast<GLint>(scanout.oddFieldHeight));
	}
	gx.backend->setActiveTextureUnit(GLES2_TEXTURE_UNIT_GX_SCANOUT_FIELDS);
	gx.backend->bindTexture2D(&gx.scanoutFieldsTexture);
	glDrawArrays(GL_TRIANGLES, 0, static_cast<GLsizei>(kGxGpuScanoutVertexCount));
}

void scanoutGxGpuVram(OpenGLES2GxGpuState& gx,
	GLuint frameFbo,
	const GxGpuPipelineState& state,
	const GxGpuPresentation& output
) {
	const GxGpuPcrtcScanout& scanout = output.pcrtcScanout;
	prepareGxGpuScanoutState(gx, scanout);
	GLuint boundProgram = 0u;
	if (scanout.interlaced) {
		scanoutInterlacedGxGpuVram(gx,
			frameFbo,
			state,
			scanout,
			output.vramReplacementSerial,
			boundProgram);
		return;
	}
	gx.scanoutFieldsValid = false;
	scanoutProgressiveGxGpuVram(gx, frameFbo, state, scanout, boundProgram);
}

void replaceGxGpuVramSnapshot(OpenGLES2GxGpuState& gx, std::span<const u8> bytes, u64 serial) {
	if (!gx.vramSnapshotValid || gx.vramSnapshotSerial != serial) {
		uploadGxGpuVramSnapshot(gx, bytes);
		gx.processedCommandCount = 0u;
		gx.vramSnapshotSerial = serial;
		gx.vramSnapshotValid = true;
	}
}

void executeGxGpuCommandPrefix(OpenGLES2GxGpuState& gx, const GxGpuCommandStorage& commands, size_t commandLimit) {
	// Drains/readbacks can run before beginFrame, after the frontend used the
	// context. These are GX invariants, independent of the selected primitive.
	gx.backend->drawState.disable(GLES2Capability::Dither);
	gx.backend->drawState.disable(GLES2Capability::StencilTest);
	gx.backend->drawState.colorMask(GL_TRUE, GL_TRUE, GL_TRUE, GL_TRUE);
	if (gx.processedCommandSerial != commands.serial) {
		gx.processedCommandCount = 0u;
		gx.processedCommandSerial = commands.serial;
	}
	executeNewGxGpuCommands(gx, commands, commandLimit);
}

void executeGxGpuVramCommands(OpenGLES2GxGpuState& gx, const GxGpuCommandStorage& commandBuffer, GxGpuReadbackPort& readback, std::span<const u8> snapshotBytes, u64 snapshotSerial, size_t commandLimit) {
	replaceGxGpuVramSnapshot(gx, snapshotBytes, snapshotSerial);
	executeGxGpuCommandPrefix(gx, commandBuffer, commandLimit);
	completeGxGpuReadback(gx, commandLimit, readback);
}

} // namespace

void executeGxGpuPass(
	GPUBackend* backend,
	VideoPresenter*,
	void* fbo,
	RenderPassStateStorage& stateStorage,
	void*,
	const GxGpuPresentation& output
) {
	auto& gles = *static_cast<OpenGLES2Backend*>(backend);
	OpenGLES2GxGpuState& gx = *gles.m_gx_gpu;
	scanoutGxGpuVram(gx, gles.framebufferName(fbo), stateStorage.gxGpu, output);
}

void OpenGLES2Backend::executeGxGpuPresentation(const GxGpuDeviceOutput& output) {
	invalidateContextState();
	executeGxGpuVramCommands(*m_gx_gpu, output.commandBuffer, output.readbackPort,
		output.vramSnapshotBytes, output.vramSnapshotSerial, output.commandBuffer.presentCommandCount);
}

void OpenGLES2Backend::executeGxGpuCommands(const GxGpuCommandStorage& commands) {
	executeGxGpuCommandPrefix(*m_gx_gpu, commands, commands.executedCommandCount);
}

void OpenGLES2Backend::replaceGxGpuVramSnapshot(std::span<const u8> bytes, u64 serial) {
	bmsx::replaceGxGpuVramSnapshot(*m_gx_gpu, bytes, serial);
}

void OpenGLES2Backend::readGxGpuVram(const GxGpuReadbackRequest& request, u8* pixels) {
	bmsx::readGxGpuVram(*m_gx_gpu, request, pixels);
}

void OpenGLES2Backend::executeGxGpuReadback(GxGpu& gxGpu) {
	OpenGLES2GxGpuState& gx = *m_gx_gpu;
	const GxGpuDeviceOutput& output = gxGpu.readDeviceOutput();
	executeGxGpuVramCommands(gx, output.commandBuffer, output.readbackPort, output.vramSnapshotBytes, output.vramSnapshotSerial, output.readbackPort.fenceCommandCount());
}

void OpenGLES2Backend::executeGxGpuCommandDrain(GxGpu& gxGpu) {
	OpenGLES2GxGpuState& gx = *m_gx_gpu;
	const GxGpuDeviceOutput& output = gxGpu.readDeviceOutput();
	executeGxGpuVramCommands(gx, output.commandBuffer, output.readbackPort, output.vramSnapshotBytes, output.vramSnapshotSerial, output.commandBuffer.executedCommandCount);
	gxGpu.retireExecutedCommands();
}

void OpenGLES2Backend::finishGxGpuReadbacks() {
	// GPUREAD completes synchronously on this backend.
}

void OpenGLES2Backend::captureGxGpuVramSnapshot(GxGpu& gxGpu) {
	OpenGLES2GxGpuState& gx = *m_gx_gpu;
	const GxGpuDeviceOutput& output = gxGpu.readDeviceOutput();
	executeGxGpuVramCommands(gx, output.commandBuffer, output.readbackPort, output.vramSnapshotBytes, output.vramSnapshotSerial, output.commandBuffer.executedCommandCount);
	gx.drawTargets.resolveAll(gx.sampleDirtyRegions);
	const GxGpuVramCopyRect& dirty = gx.snapshotDirtyRect;
	if (dirty.right > dirty.left && dirty.bottom > dirty.top) {
		setRenderTarget(gx.vramFramebuffer, kGxGpuVramXAddressPeriod, gx.vramTextureRows);
		glPixelStorei(GL_PACK_ALIGNMENT, 4);
		glReadPixels(dirty.left, dirty.top, dirty.right - dirty.left, dirty.bottom - dirty.top,
			GL_RGBA, GL_UNSIGNED_BYTE, gx.pixelTransferScratch.data());
		writeGxGpuVramSnapshotFromReadback(gx, dirty);
		gx.snapshotDirtyRect = {};
	}
	gx.vramSnapshotSerial = gxGpu.commitRenderedVramSnapshotBytes(
		gx.vramSnapshotScratch,
		gx.processedCommandCount);
	gx.vramSnapshotValid = true;
}

void registerGxGpuPass(RenderPassLibrary& registry) {
	RenderPassDef desc;
	desc.id = "gx_gpu";
	desc.name = "GXGPU";
	setGxGpuGraph(desc);
	desc.bootstrap = bootstrapBackendRenderPass<OpenGLES2Backend, initGxGpu>;
	desc.teardown = teardownBackendRenderPass<OpenGLES2Backend, shutdownGxGpu>;
	desc.exec = executeGxGpuPass;
	registry.registerPass(desc);
}

} // namespace bmsx
