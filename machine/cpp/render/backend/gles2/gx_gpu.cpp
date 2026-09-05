#include "render/backend/gles2/gx_gpu.h"

#include "machine/devices/gx/gpu.h"
#include "machine/devices/gx/gpu_command_buffer.h"
#include "spec/gx/gp0.h"
#include "machine/devices/gx/gpu_pcrtc.h"
#include "render/backend/gx_gpu_render_rules.h"
#include "render/backend/gles2/backend.h"
#include "render/backend/gles2/texture_units.h"
#include "render/backend/texture_params.h"
#include "render/backend/gles2/shaders/gx_gpu_shaders.h"
#include "render/backend/pass/library.h"

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
constexpr GLsizeiptr kGxGpuSolidBufferBytes = static_cast<GLsizeiptr>(kGxGpuSolidFloatCapacity * sizeof(f32));
constexpr GLsizeiptr kGxGpuLineBufferBytes = static_cast<GLsizeiptr>(kGxGpuLineFloatCapacity * sizeof(f32));
constexpr GLsizeiptr kGxGpuTexturedBufferBytes = static_cast<GLsizeiptr>(kGxGpuTexturedFloatCapacity * sizeof(f32));
constexpr GLsizeiptr kGxGpuTransferBufferBytes = static_cast<GLsizeiptr>(kGxGpuTransferFloatCapacity * sizeof(f32));
// Solid and line arenas may coexist; direct textured and transfer draws drain them first.
constexpr GLsizeiptr kGxGpuVertexStreamBufferBytes = kGxGpuSolidBufferBytes + kGxGpuLineBufferBytes;
static_assert(kGxGpuTexturedBufferBytes <= kGxGpuVertexStreamBufferBytes);
static_assert(kGxGpuTransferBufferBytes <= kGxGpuVertexStreamBufferBytes);
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

struct GxGpuVramCopyRect {
	i32 left = 0;
	i32 top = 0;
	i32 right = 0;
	i32 bottom = 0;
};

struct GxGpuVertexStream {
	GLuint buffer = 0;
	GLsizeiptr capacity = 0;
	GLintptr cursor = 0;

	void initialize(GLsizeiptr byteCapacity) {
		capacity = byteCapacity;
		cursor = 0;
		glGenBuffers(1, &buffer);
		glBindBuffer(GL_ARRAY_BUFFER, buffer);
		glBufferData(GL_ARRAY_BUFFER, capacity, nullptr, GL_STREAM_DRAW);
	}

	void reserve(GLsizeiptr byteCount) {
		glBindBuffer(GL_ARRAY_BUFFER, buffer);
		if (cursor + byteCount > capacity) {
			glBufferData(GL_ARRAY_BUFFER, capacity, nullptr, GL_STREAM_DRAW);
			cursor = 0;
		}
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
	GLint uploadUniform = -1;
	GLint logicalYBaseUniform = -1;
	i32 sourceTextureUnit = -1;
};

struct GxGpuScanoutProgram {
	GLuint id = 0;
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
	std::array<f32, kGxGpuTexturedFloatCapacity> texturedVertices{};
	std::array<u32, kGxGpuTexturedUvComponents * GX_GPU_TRIANGLE_ATTRIBUTE_PLANE_PHASES> texturedUvPlane{};
	std::array<u32, kGxGpuColorComponents * GX_GPU_TRIANGLE_ATTRIBUTE_PLANE_PHASES> colorPlane{};
	std::array<u16, kGxGpuTextureSourceComponents> texturedTextureSource{};
	std::array<f32, kGxGpuTransferFloatCapacity> transferVertices{};
	std::vector<u8> rawVramReadback;
	std::vector<u8> vramSnapshotScratch;
	GxGpuVramCopyRect vramCopyRectScratch{};
	GxGpuVramCopyRect solidBatchRect{};
	GxGpuVramCopyRect solidCommandRect{};
	GxGpuVramCopyRect lineBatchRect{};
	GxGpuVramCopyRect texturedBatchRect{};
	GxGpuVramCopyRect texturedCommandRect{};
	GxGpuVramCopyRect texturedDependencyBatchRect{};
	GxGpuVramCopyRect sampleDirtyRect{};
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
	GLuint solidProgram = 0;
	GLuint fixedSolidProgram = 0;
	GLuint lineProgram = 0;
	GLuint texturedProgram = 0;
	GLuint fixedTexturedProgram = 0;
	GxGpuTransferProgram transferProgram{};
	GxGpuTransferProgram cpuUploadProgram{};
	std::array<GxGpuScanoutProgram, kGxGpuScanoutProgramCount> scanoutPrograms{};
	std::array<GxGpuScanoutProgram, kGxGpuScanoutProgramCount> scanoutFieldPrograms{};
	GLuint scanoutWeaveProgram = 0;
	GLuint readbackProgram = 0;
	GLES2Texture vramTexture{};
	GLES2Texture vramSampleTexture{};
	GLES2Texture cpuUploadTexture{};
	GLES2Texture readbackTexture{};
	GLES2Texture scanoutFieldsTexture{};
	GLuint vramFramebuffer = 0;
	GLuint readbackFramebuffer = 0;
	GLuint scanoutFieldsFramebuffer = 0;
	GxGpuVertexStream vertexStream{};
	GLuint scanoutVertexBuffer = 0;
	GLint solidPositionAttrib = -1;
	GLint solidColorAttrib = -1;
	GLint solidBlendEnableUniform = -1;
	GLint solidBlendModeUniform = -1;
	GLint solidCheckMaskBitUniform = -1;
	GLint solidSetMaskBitUniform = -1;
	GLint solidDitherEnableUniform = -1;
	GLint solidSkippedLineParityUniform = -1;
	GLint solidRasterPhaseUniform = -1;
	GLint solidLogicalYBaseUniform = -1;
	GLint fixedSolidPositionAttrib = -1;
	GLint fixedSolidColorPlaneBaseAttrib = -1;
	GLint fixedSolidColorPlaneStepXAttrib = -1;
	GLint fixedSolidColorPlaneStepYAttrib = -1;
	GLint fixedSolidBlendEnableUniform = -1;
	GLint fixedSolidBlendModeUniform = -1;
	GLint fixedSolidCheckMaskBitUniform = -1;
	GLint fixedSolidSetMaskBitUniform = -1;
	GLint fixedSolidDitherEnableUniform = -1;
	GLint fixedSolidSkippedLineParityUniform = -1;
	GLint fixedSolidRasterPhaseUniform = -1;
	GLint fixedSolidLogicalYBaseUniform = -1;
	GLint linePositionAttrib = -1;
	GLint lineStartAttrib = -1;
	GLint lineEndAttrib = -1;
	GLint lineColor0Attrib = -1;
	GLint lineColor1Attrib = -1;
	GLint lineBlendEnableUniform = -1;
	GLint lineBlendModeUniform = -1;
	GLint lineCheckMaskBitUniform = -1;
	GLint lineSetMaskBitUniform = -1;
	GLint lineDitherEnableUniform = -1;
	GLint lineSkippedLineParityUniform = -1;
	GLint lineLogicalYBaseUniform = -1;
	GLint texturedPositionAttrib = -1;
	GLint texturedColorAttrib = -1;
	GLint texturedUvPlaneBaseAttrib = -1;
	GLint texturedUvPlaneStepXAttrib = -1;
	GLint texturedUvPlaneStepYAttrib = -1;
	GLint texturedTextureSourceAttrib = -1;
	GLint texturedTextureWindowAndUniform = -1;
	GLint texturedTextureWindowOrUniform = -1;
	GLint texturedTextureModeUniform = -1;
	GLint texturedRawTextureUniform = -1;
	GLint texturedBlendEnableUniform = -1;
	GLint texturedBlendModeUniform = -1;
	GLint texturedCheckMaskBitUniform = -1;
	GLint texturedSetMaskBitUniform = -1;
	GLint texturedDitherEnableUniform = -1;
	GLint texturedSkippedLineParityUniform = -1;
	GLint texturedRasterPhaseUniform = -1;
	GLint texturedLogicalYBaseUniform = -1;
	GLint fixedTexturedPositionAttrib = -1;
	GLint fixedTexturedUvPlaneBaseAttrib = -1;
	GLint fixedTexturedUvPlaneStepXAttrib = -1;
	GLint fixedTexturedUvPlaneStepYAttrib = -1;
	GLint fixedTexturedColorPlaneBaseAttrib = -1;
	GLint fixedTexturedColorPlaneStepXAttrib = -1;
	GLint fixedTexturedColorPlaneStepYAttrib = -1;
	GLint fixedTexturedTextureSourceAttrib = -1;
	GLint fixedTexturedTextureWindowAndUniform = -1;
	GLint fixedTexturedTextureWindowOrUniform = -1;
	GLint fixedTexturedTextureModeUniform = -1;
	GLint fixedTexturedRawTextureUniform = -1;
	GLint fixedTexturedBlendEnableUniform = -1;
	GLint fixedTexturedBlendModeUniform = -1;
	GLint fixedTexturedCheckMaskBitUniform = -1;
	GLint fixedTexturedSetMaskBitUniform = -1;
	GLint fixedTexturedDitherEnableUniform = -1;
	GLint fixedTexturedSkippedLineParityUniform = -1;
	GLint fixedTexturedRasterPhaseUniform = -1;
	GLint fixedTexturedLogicalYBaseUniform = -1;
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

void initializeGxGpuTexture(OpenGLES2GxGpuState& gx, GLES2Texture& texture, i32 textureUnit, i32 width, i32 height, GLenum format) {
	glGenTextures(1, &texture.id);
	texture.generation = gx.generation;
	texture.width = width;
	texture.height = height;
	gx.backend->setActiveTextureUnit(textureUnit);
	gx.backend->bindTexture2D(&texture);
	glTexImage2D(GL_TEXTURE_2D, 0, format, width, height, 0, format, GL_UNSIGNED_BYTE, nullptr);
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
	gx.rawVramReadback.resize(
		static_cast<size_t>(kGxGpuVramXAddressPeriod)
		* static_cast<size_t>(gx.vramTextureRows)
		* kGxGpuRawVramBytesPerPixel);
	gx.vramSnapshotScratch.resize(
		static_cast<size_t>(kGxGpuVramXAddressPeriod)
		* static_cast<size_t>(gx.vramTextureRows)
		* kGxGpuCpuUploadBytesPerPixel);
	gx.framebufferFetch = backend.armFramebufferFetchAvailable();
	gx.textureBarrier = !gx.framebufferFetch && backend.textureBarrierAvailable();
	const char* framebufferFetchShaderDefine = gx.framebufferFetch ? kGxGpuFramebufferFetchArmShaderDefine : "";
	const char* vramAliasShaderDefine = gx.vramTextureRows == kGxGpuVramYAddressPeriod ? "" : kGxGpuVramAliasShaderDefine;
	char vramShaderDefines[384]{};
	std::snprintf(
		vramShaderDefines,
		sizeof(vramShaderDefines),
		"#define GX_GPU_VRAM_X_ADDRESS_PERIOD %u\n"
		"#define GX_GPU_VRAM_Y_ADDRESS_PERIOD %u\n"
		"#define GX_GPU_VRAM_Y_ADDRESS_EXTENSION_BIT %u\n"
		"#define GX_GPU_VRAM_ADDRESS_WORD_COUNT %zu\n"
		"#define GX_GPU_VRAM_TEXTURE_ROWS %d\n"
		"#define GX_GPU_VRAM_INSTALLED_WORDS %d\n%s",
		GX_GPU_VRAM_X_ADDRESS_PERIOD,
		GX_GPU_VRAM_Y_ADDRESS_PERIOD,
		GX_GPU_VRAM_Y_ADDRESS_EXTENSION_BIT,
		GX_GPU_VRAM_ADDRESS_WORD_COUNT,
		gx.vramTextureRows,
		kGxGpuVramXAddressPeriod * gx.vramTextureRows,
		vramAliasShaderDefine);
	char rasterShaderDefines[384]{};
	std::snprintf(rasterShaderDefines, sizeof(rasterShaderDefines), "%s%s", vramShaderDefines, framebufferFetchShaderDefine);
	char fixedColorShaderDefines[448]{};
	std::snprintf(fixedColorShaderDefines, sizeof(fixedColorShaderDefines), "%s%s", kGxGpuFixedColorPlaneShaderDefine, rasterShaderDefines);
	char cpuUploadShaderDefines[416]{};
	std::snprintf(
		cpuUploadShaderDefines,
		sizeof(cpuUploadShaderDefines),
		"%s#define GX_GPU_TRANSFER_HEIGHT %u\n%s",
		kGxGpuCpuUploadShaderDefine,
		GX_GPU_TRANSFER_MAX_HEIGHT,
		vramShaderDefines);
	gx.solidProgram = gx.backend->buildProgram(kGxGpuFillVertexShader, kGxGpuFillFragmentShader, "gx_gpu_fill", rasterShaderDefines);
	gx.fixedSolidProgram = gx.backend->buildProgram(kGxGpuFillVertexShader, kGxGpuFillFragmentShader, "gx_gpu_fixed_fill", fixedColorShaderDefines);
	gx.lineProgram = gx.backend->buildProgram(kGxGpuLineVertexShader, kGxGpuLineFragmentShader, "gx_gpu_line", rasterShaderDefines);
	gx.texturedProgram = gx.backend->buildProgram(kGxGpuTexturedVertexShader, kGxGpuTexturedFragmentShader, "gx_gpu_textured", rasterShaderDefines);
	gx.fixedTexturedProgram = gx.backend->buildProgram(kGxGpuTexturedVertexShader, kGxGpuTexturedFragmentShader, "gx_gpu_fixed_textured", fixedColorShaderDefines);
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
		char scanoutWeaveDefines[416]{};
		std::snprintf(
			scanoutWeaveDefines,
			sizeof(scanoutWeaveDefines),
			"%s#define GX_GPU_INTERLACED_WEAVE 1\n#define GX_GPU_SCANOUT_STORAGE_PATH 6\n",
			vramShaderDefines);
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

	initializeGxGpuTexture(gx, gx.vramTexture, GLES2_TEXTURE_UNIT_GX_SCANOUT, kGxGpuVramXAddressPeriod, gx.vramTextureRows, GL_RGBA);
	initializeGxGpuTexture(gx, gx.vramSampleTexture, GLES2_TEXTURE_UNIT_GX_SAMPLE, kGxGpuVramXAddressPeriod, gx.vramTextureRows, GL_RGBA);
	initializeGxGpuTexture(gx, gx.cpuUploadTexture, GLES2_TEXTURE_UNIT_GX_TRANSFER, kGxGpuVramXAddressPeriod, static_cast<i32>(GX_GPU_TRANSFER_MAX_HEIGHT), GL_LUMINANCE_ALPHA);
	initializeGxGpuTexture(gx, gx.readbackTexture, GLES2_TEXTURE_UNIT_GX_SCANOUT, kGxGpuReadbackPackWidth, static_cast<i32>(GX_GPU_TRANSFER_MAX_HEIGHT), GL_RGBA);

	glGenFramebuffers(1, &gx.vramFramebuffer);
	glBindFramebuffer(GL_FRAMEBUFFER, gx.vramFramebuffer);
	glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, gx.vramTexture.id, 0);
	glViewport(0, 0, kGxGpuVramXAddressPeriod, gx.vramTextureRows);
	glClearColor(0.0f, 0.0f, 0.0f, 0.0f);
	glClear(GL_COLOR_BUFFER_BIT);
	gx.sampleDirtyRect = {0, 0, kGxGpuVramXAddressPeriod, gx.vramTextureRows};
	glGenFramebuffers(1, &gx.readbackFramebuffer);
	glBindFramebuffer(GL_FRAMEBUFFER, gx.readbackFramebuffer);
	glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, gx.readbackTexture.id, 0);
	gx.scanoutFieldsTexture.width = 0;
	gx.scanoutFieldsTexture.height = 0;
	glGenTextures(1, &gx.scanoutFieldsTexture.id);
	gx.scanoutFieldsTexture.generation = gx.generation;
	gx.backend->setActiveTextureUnit(GLES2_TEXTURE_UNIT_GX_SCANOUT_FIELDS);
	gx.backend->bindTexture2D(&gx.scanoutFieldsTexture);
	applyGLES2TextureParams(RGBA8_LINEAR_TEXTURE_PARAMS);
	glGenFramebuffers(1, &gx.scanoutFieldsFramebuffer);
	glBindFramebuffer(GL_FRAMEBUFFER, gx.scanoutFieldsFramebuffer);
	glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, gx.scanoutFieldsTexture.id, 0);

	gx.vertexStream.initialize(kGxGpuVertexStreamBufferBytes);

	glGenBuffers(1, &gx.scanoutVertexBuffer);
	glBindBuffer(GL_ARRAY_BUFFER, gx.scanoutVertexBuffer);
	glBufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(kGxGpuScanoutVertices.size() * sizeof(f32)), kGxGpuScanoutVertices.data(), GL_STATIC_DRAW);

	gx.solidPositionAttrib = glGetAttribLocation(gx.solidProgram, "a_position");
	gx.solidColorAttrib = glGetAttribLocation(gx.solidProgram, "a_color");
	gx.solidBlendEnableUniform = glGetUniformLocation(gx.solidProgram, "u_blendEnable");
	gx.solidBlendModeUniform = glGetUniformLocation(gx.solidProgram, "u_blendMode");
	gx.solidCheckMaskBitUniform = glGetUniformLocation(gx.solidProgram, "u_checkMaskBit");
	gx.solidSetMaskBitUniform = glGetUniformLocation(gx.solidProgram, "u_setMaskBit");
	gx.solidDitherEnableUniform = glGetUniformLocation(gx.solidProgram, "u_ditherEnable");
	gx.solidSkippedLineParityUniform = glGetUniformLocation(gx.solidProgram, "u_skippedLineParity");
	gx.solidRasterPhaseUniform = glGetUniformLocation(gx.solidProgram, "u_rasterPhase");
	gx.solidLogicalYBaseUniform = glGetUniformLocation(gx.solidProgram, "u_logicalYBase");
	glUseProgram(gx.solidProgram);
	glUniform1i(glGetUniformLocation(gx.solidProgram, "u_vram"), GLES2_TEXTURE_UNIT_GX_SAMPLE);
	gx.fixedSolidPositionAttrib = glGetAttribLocation(gx.fixedSolidProgram, "a_position");
	gx.fixedSolidColorPlaneBaseAttrib = glGetAttribLocation(gx.fixedSolidProgram, "a_colorPlaneBase");
	gx.fixedSolidColorPlaneStepXAttrib = glGetAttribLocation(gx.fixedSolidProgram, "a_colorPlaneStepX");
	gx.fixedSolidColorPlaneStepYAttrib = glGetAttribLocation(gx.fixedSolidProgram, "a_colorPlaneStepY");
	gx.fixedSolidBlendEnableUniform = glGetUniformLocation(gx.fixedSolidProgram, "u_blendEnable");
	gx.fixedSolidBlendModeUniform = glGetUniformLocation(gx.fixedSolidProgram, "u_blendMode");
	gx.fixedSolidCheckMaskBitUniform = glGetUniformLocation(gx.fixedSolidProgram, "u_checkMaskBit");
	gx.fixedSolidSetMaskBitUniform = glGetUniformLocation(gx.fixedSolidProgram, "u_setMaskBit");
	gx.fixedSolidDitherEnableUniform = glGetUniformLocation(gx.fixedSolidProgram, "u_ditherEnable");
	gx.fixedSolidSkippedLineParityUniform = glGetUniformLocation(gx.fixedSolidProgram, "u_skippedLineParity");
	gx.fixedSolidRasterPhaseUniform = glGetUniformLocation(gx.fixedSolidProgram, "u_rasterPhase");
	gx.fixedSolidLogicalYBaseUniform = glGetUniformLocation(gx.fixedSolidProgram, "u_logicalYBase");
	glUseProgram(gx.fixedSolidProgram);
	glUniform1i(glGetUniformLocation(gx.fixedSolidProgram, "u_vram"), GLES2_TEXTURE_UNIT_GX_SAMPLE);
	gx.linePositionAttrib = glGetAttribLocation(gx.lineProgram, "a_position");
	gx.lineStartAttrib = glGetAttribLocation(gx.lineProgram, "a_lineStart");
	gx.lineEndAttrib = glGetAttribLocation(gx.lineProgram, "a_lineEnd");
	gx.lineColor0Attrib = glGetAttribLocation(gx.lineProgram, "a_color0");
	gx.lineColor1Attrib = glGetAttribLocation(gx.lineProgram, "a_color1");
	gx.lineBlendEnableUniform = glGetUniformLocation(gx.lineProgram, "u_blendEnable");
	gx.lineBlendModeUniform = glGetUniformLocation(gx.lineProgram, "u_blendMode");
	gx.lineCheckMaskBitUniform = glGetUniformLocation(gx.lineProgram, "u_checkMaskBit");
	gx.lineSetMaskBitUniform = glGetUniformLocation(gx.lineProgram, "u_setMaskBit");
	gx.lineDitherEnableUniform = glGetUniformLocation(gx.lineProgram, "u_ditherEnable");
	gx.lineSkippedLineParityUniform = glGetUniformLocation(gx.lineProgram, "u_skippedLineParity");
	gx.lineLogicalYBaseUniform = glGetUniformLocation(gx.lineProgram, "u_logicalYBase");
	glUseProgram(gx.lineProgram);
	glUniform1i(glGetUniformLocation(gx.lineProgram, "u_vram"), GLES2_TEXTURE_UNIT_GX_SAMPLE);
	gx.texturedPositionAttrib = glGetAttribLocation(gx.texturedProgram, "a_position");
	gx.texturedColorAttrib = glGetAttribLocation(gx.texturedProgram, "a_color");
	gx.texturedUvPlaneBaseAttrib = glGetAttribLocation(gx.texturedProgram, "a_uvPlaneBase");
	gx.texturedUvPlaneStepXAttrib = glGetAttribLocation(gx.texturedProgram, "a_uvPlaneStepX");
	gx.texturedUvPlaneStepYAttrib = glGetAttribLocation(gx.texturedProgram, "a_uvPlaneStepY");
	gx.texturedTextureSourceAttrib = glGetAttribLocation(gx.texturedProgram, "a_textureSource");
	gx.texturedTextureWindowAndUniform = glGetUniformLocation(gx.texturedProgram, "u_textureWindowAnd");
	gx.texturedTextureWindowOrUniform = glGetUniformLocation(gx.texturedProgram, "u_textureWindowOr");
	gx.texturedTextureModeUniform = glGetUniformLocation(gx.texturedProgram, "u_textureMode");
	gx.texturedRawTextureUniform = glGetUniformLocation(gx.texturedProgram, "u_rawTexture");
	gx.texturedBlendEnableUniform = glGetUniformLocation(gx.texturedProgram, "u_blendEnable");
	gx.texturedBlendModeUniform = glGetUniformLocation(gx.texturedProgram, "u_blendMode");
	gx.texturedCheckMaskBitUniform = glGetUniformLocation(gx.texturedProgram, "u_checkMaskBit");
	gx.texturedSetMaskBitUniform = glGetUniformLocation(gx.texturedProgram, "u_setMaskBit");
	gx.texturedDitherEnableUniform = glGetUniformLocation(gx.texturedProgram, "u_ditherEnable");
	gx.texturedSkippedLineParityUniform = glGetUniformLocation(gx.texturedProgram, "u_skippedLineParity");
	gx.texturedRasterPhaseUniform = glGetUniformLocation(gx.texturedProgram, "u_rasterPhase");
	gx.texturedLogicalYBaseUniform = glGetUniformLocation(gx.texturedProgram, "u_logicalYBase");
	glUseProgram(gx.texturedProgram);
	glUniform1i(glGetUniformLocation(gx.texturedProgram, "u_vram"), GLES2_TEXTURE_UNIT_GX_SAMPLE);
	if (!gx.framebufferFetch) {
		glUniform1i(
			glGetUniformLocation(gx.texturedProgram, "u_destination"),
			gx.textureBarrier ? GLES2_TEXTURE_UNIT_GX_DESTINATION : GLES2_TEXTURE_UNIT_GX_SAMPLE);
	}
	gx.fixedTexturedPositionAttrib = glGetAttribLocation(gx.fixedTexturedProgram, "a_position");
	gx.fixedTexturedUvPlaneBaseAttrib = glGetAttribLocation(gx.fixedTexturedProgram, "a_uvPlaneBase");
	gx.fixedTexturedUvPlaneStepXAttrib = glGetAttribLocation(gx.fixedTexturedProgram, "a_uvPlaneStepX");
	gx.fixedTexturedUvPlaneStepYAttrib = glGetAttribLocation(gx.fixedTexturedProgram, "a_uvPlaneStepY");
	gx.fixedTexturedColorPlaneBaseAttrib = glGetAttribLocation(gx.fixedTexturedProgram, "a_colorPlaneBase");
	gx.fixedTexturedColorPlaneStepXAttrib = glGetAttribLocation(gx.fixedTexturedProgram, "a_colorPlaneStepX");
	gx.fixedTexturedColorPlaneStepYAttrib = glGetAttribLocation(gx.fixedTexturedProgram, "a_colorPlaneStepY");
	gx.fixedTexturedTextureSourceAttrib = glGetAttribLocation(gx.fixedTexturedProgram, "a_textureSource");
	gx.fixedTexturedTextureWindowAndUniform = glGetUniformLocation(gx.fixedTexturedProgram, "u_textureWindowAnd");
	gx.fixedTexturedTextureWindowOrUniform = glGetUniformLocation(gx.fixedTexturedProgram, "u_textureWindowOr");
	gx.fixedTexturedTextureModeUniform = glGetUniformLocation(gx.fixedTexturedProgram, "u_textureMode");
	gx.fixedTexturedRawTextureUniform = glGetUniformLocation(gx.fixedTexturedProgram, "u_rawTexture");
	gx.fixedTexturedBlendEnableUniform = glGetUniformLocation(gx.fixedTexturedProgram, "u_blendEnable");
	gx.fixedTexturedBlendModeUniform = glGetUniformLocation(gx.fixedTexturedProgram, "u_blendMode");
	gx.fixedTexturedCheckMaskBitUniform = glGetUniformLocation(gx.fixedTexturedProgram, "u_checkMaskBit");
	gx.fixedTexturedSetMaskBitUniform = glGetUniformLocation(gx.fixedTexturedProgram, "u_setMaskBit");
	gx.fixedTexturedDitherEnableUniform = glGetUniformLocation(gx.fixedTexturedProgram, "u_ditherEnable");
	gx.fixedTexturedSkippedLineParityUniform = glGetUniformLocation(gx.fixedTexturedProgram, "u_skippedLineParity");
	gx.fixedTexturedRasterPhaseUniform = glGetUniformLocation(gx.fixedTexturedProgram, "u_rasterPhase");
	gx.fixedTexturedLogicalYBaseUniform = glGetUniformLocation(gx.fixedTexturedProgram, "u_logicalYBase");
	glUseProgram(gx.fixedTexturedProgram);
	glUniform1i(glGetUniformLocation(gx.fixedTexturedProgram, "u_vram"), GLES2_TEXTURE_UNIT_GX_SAMPLE);
	if (!gx.framebufferFetch) {
		glUniform1i(
			glGetUniformLocation(gx.fixedTexturedProgram, "u_destination"),
			gx.textureBarrier ? GLES2_TEXTURE_UNIT_GX_DESTINATION : GLES2_TEXTURE_UNIT_GX_SAMPLE);
	}
	const std::array<GxGpuTransferProgram*, 2u> transferPrograms{
		&gx.transferProgram,
		&gx.cpuUploadProgram,
	};
	for (GxGpuTransferProgram* program : transferPrograms) {
		program->sourceUniform = glGetUniformLocation(program->id, "u_source");
		program->checkMaskBitUniform = glGetUniformLocation(program->id, "u_checkMaskBit");
		program->setMaskBitUniform = glGetUniformLocation(program->id, "u_setMaskBit");
		program->logicalYBaseUniform = glGetUniformLocation(program->id, "u_logicalYBase");
		glUseProgram(program->id);
		glUniform1i(glGetUniformLocation(program->id, "u_vram"), GLES2_TEXTURE_UNIT_GX_SAMPLE);
	}
	gx.cpuUploadProgram.uploadUniform = glGetUniformLocation(gx.cpuUploadProgram.id, "u_upload");
	for (size_t path = 0u; path < kGxGpuScanoutProgramCount; path += 1u) {
		GxGpuScanoutProgram& scanoutProgram = gx.scanoutPrograms[path];
		GxGpuScanoutProgram& scanoutFieldProgram = gx.scanoutFieldPrograms[path];
		const std::array<GxGpuScanoutProgram*, 2u> programs{&scanoutProgram, &scanoutFieldProgram};
		for (GxGpuScanoutProgram* program : programs) {
			program->circuitUniform = glGetUniformLocation(program->id, "u_circuit[0]");
			glUseProgram(program->id);
			glUniform1i(glGetUniformLocation(program->id, "u_vram"), GLES2_TEXTURE_UNIT_GX_SCANOUT);
		}
		scanoutFieldProgram.interlaceUniform = glGetUniformLocation(scanoutFieldProgram.id, "u_interlace");
	}
	gx.scanoutWeaveInterlaceUniform = glGetUniformLocation(gx.scanoutWeaveProgram, "u_interlace");
	gx.readbackParamsUniform = glGetUniformLocation(gx.readbackProgram, "u_readback");
	gx.readbackVramYAddressExtensionUniform = glGetUniformLocation(gx.readbackProgram, "u_vramYAddressExtensionWord");
	glUseProgram(gx.scanoutWeaveProgram);
	glUniform1i(glGetUniformLocation(gx.scanoutWeaveProgram, "u_vram"), GLES2_TEXTURE_UNIT_GX_SCANOUT_FIELDS);
	glUseProgram(gx.readbackProgram);
	glUniform1i(glGetUniformLocation(gx.readbackProgram, "u_vram"), GLES2_TEXTURE_UNIT_GX_SCANOUT);
	glBindFramebuffer(GL_FRAMEBUFFER, 0);
}

namespace {

} // namespace

void shutdownGxGpu(OpenGLES2Backend& backend) {
	OpenGLES2GxGpuState& gx = *backend.m_gx_gpu;
	if (gx.generation == backend.contextGeneration()) {
		const std::array<GLuint, 5> textures{
			gx.vramTexture.id,
			gx.vramSampleTexture.id,
			gx.cpuUploadTexture.id,
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

		const std::array<GLuint, 2> buffers{
			gx.vertexStream.buffer,
			gx.scanoutVertexBuffer,
		};
		glDeleteBuffers(static_cast<GLsizei>(buffers.size()), buffers.data());

		const std::array<GLuint, 9> programs{
			gx.solidProgram,
			gx.fixedSolidProgram,
			gx.lineProgram,
			gx.texturedProgram,
			gx.fixedTexturedProgram,
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
		static_cast<f32>(colorWord & 0xffu) / 255.0f,
		static_cast<f32>((colorWord >> 8u) & 0xffu) / 255.0f,
		static_cast<f32>((colorWord >> 16u) & 0xffu) / 255.0f);
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

size_t appendFillRectangle(OpenGLES2GxGpuState& gx, const GxGpuCommandBuffer& commandBuffer, u32 commandIndex, size_t vertexFloatCount) {
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

size_t appendSolidPolygon(OpenGLES2GxGpuState& gx, const GxGpuCommandBuffer& commandBuffer, u32 commandIndex, size_t vertexFloatCount) {
	const u32 opcode = commandBuffer.commandOpcode[commandIndex];
	if (gxGpuCommandTextureEnabled(opcode)) {
		return vertexFloatCount;
	}
	const u32 wordStart = commandBuffer.commandWordStart[commandIndex];
	const auto& words = commandBuffer.words;
	const u32 drawingOffsetWord = commandBuffer.commandDrawingOffsetWord[commandIndex];
	const i32 dx = gxGpuSigned11(drawingOffsetWord);
	const i32 dy = gxGpuDrawingOffsetY(drawingOffsetWord);
	const bool gouraud = gxGpuCommandGouraud(opcode);
	const bool quadPolygon = gxGpuCommandQuadPolygon(opcode);
	if (gouraud) {
		const u32 color0 = words[wordStart];
		const u32 xy0 = words[wordStart + 1u];
		const u32 color1 = words[wordStart + 2u];
		const u32 xy1 = words[wordStart + 3u];
		const u32 color2 = words[wordStart + 4u];
		const u32 xy2 = words[wordStart + 5u];
		size_t offset = appendSolidPrimitiveTriangle(gx,
			vertexFloatCount,
			true,
			dx + gxGpuSigned11(xy0),
			dy + gxGpuVertexY(xy0),
			color0,
			dx + gxGpuSigned11(xy1),
			dy + gxGpuVertexY(xy1),
			color1,
			dx + gxGpuSigned11(xy2),
			dy + gxGpuVertexY(xy2),
			color2);
		if (quadPolygon) {
			const u32 color3 = words[wordStart + 6u];
			const u32 xy3 = words[wordStart + 7u];
			offset = appendSolidPrimitiveTriangle(gx,
				offset,
				true,
				dx + gxGpuSigned11(xy2),
				dy + gxGpuVertexY(xy2),
				color2,
				dx + gxGpuSigned11(xy1),
				dy + gxGpuVertexY(xy1),
				color1,
				dx + gxGpuSigned11(xy3),
				dy + gxGpuVertexY(xy3),
				color3);
		}
		return offset;
	}

	const u32 color = words[wordStart];
	const u32 xy0 = words[wordStart + 1u];
	const u32 xy1 = words[wordStart + 2u];
	const u32 xy2 = words[wordStart + 3u];
	size_t offset = appendSolidPrimitiveTriangle(gx,
		vertexFloatCount,
		false,
		dx + gxGpuSigned11(xy0),
		dy + gxGpuVertexY(xy0),
		color,
		dx + gxGpuSigned11(xy1),
		dy + gxGpuVertexY(xy1),
		color,
		dx + gxGpuSigned11(xy2),
		dy + gxGpuVertexY(xy2),
		color);
	if (quadPolygon) {
		const u32 xy3 = words[wordStart + 4u];
		offset = appendSolidPrimitiveTriangle(gx,
			offset,
			false,
			dx + gxGpuSigned11(xy2),
			dy + gxGpuVertexY(xy2),
			color,
			dx + gxGpuSigned11(xy1),
			dy + gxGpuVertexY(xy1),
			color,
			dx + gxGpuSigned11(xy3),
			dy + gxGpuVertexY(xy3),
			color);
	}
	return offset;
}

GxGpuRectangle& readGxGpuRectangle(
	OpenGLES2GxGpuState& gx,
	const GxGpuCommandBuffer& commandBuffer,
	u32 commandIndex,
	u32 opcode
) {
	const u32 wordStart = commandBuffer.commandWordStart[commandIndex];
	const u32 xyWord = commandBuffer.words[wordStart + 1u];
	const u32 sizeWord = commandBuffer.words[wordStart + commandBuffer.commandWordCount[commandIndex] - 1u];
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

size_t appendSolidRectangle(OpenGLES2GxGpuState& gx, const GxGpuCommandBuffer& commandBuffer, u32 commandIndex, size_t vertexFloatCount) {
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
	gx.lineVertices[offset + 6u] = static_cast<f32>(color0 & 0xffu) / 255.0f;
	gx.lineVertices[offset + 7u] = static_cast<f32>((color0 >> 8u) & 0xffu) / 255.0f;
	gx.lineVertices[offset + 8u] = static_cast<f32>((color0 >> 16u) & 0xffu) / 255.0f;
	gx.lineVertices[offset + 9u] = static_cast<f32>(color1 & 0xffu) / 255.0f;
	gx.lineVertices[offset + 10u] = static_cast<f32>((color1 >> 8u) & 0xffu) / 255.0f;
	gx.lineVertices[offset + 11u] = static_cast<f32>((color1 >> 16u) & 0xffu) / 255.0f;
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
	std::memcpy(gx.texturedVertices.data() + offset, gx.texturedTextureSource.data(), sizeof(gx.texturedTextureSource));
}

size_t writeTexturedVertex(OpenGLES2GxGpuState& gx, size_t offset, i32 x, i32 y, u32 colorWord) {
	gx.texturedVertices[offset] = static_cast<f32>(x);
	gx.texturedVertices[offset + 1u] = static_cast<f32>(y);
	gx.texturedVertices[offset + 2u] = static_cast<f32>(colorWord & 0xffu) / 255.0f;
	gx.texturedVertices[offset + 3u] = static_cast<f32>((colorWord >> 8u) & 0xffu) / 255.0f;
	gx.texturedVertices[offset + 4u] = static_cast<f32>((colorWord >> 16u) & 0xffu) / 255.0f;
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
		gx.texturedVertices[vertexOffset + 5u] = static_cast<f32>(gx.texturedUvPlane[0]);
		gx.texturedVertices[vertexOffset + 6u] = static_cast<f32>(gx.texturedUvPlane[1]);
		gx.texturedVertices[vertexOffset + 7u] = static_cast<f32>(gx.texturedUvPlane[2]);
		gx.texturedVertices[vertexOffset + 8u] = static_cast<f32>(gx.texturedUvPlane[3]);
		gx.texturedVertices[vertexOffset + 9u] = static_cast<f32>(gx.texturedUvPlane[4]);
		gx.texturedVertices[vertexOffset + 10u] = static_cast<f32>(gx.texturedUvPlane[5]);
	}
	return offset;
}

size_t writeFixedTexturedVertex(OpenGLES2GxGpuState& gx, size_t offset, i32 x, i32 y) {
	gx.texturedVertices[offset] = static_cast<f32>(x);
	gx.texturedVertices[offset + 1u] = static_cast<f32>(y);
	for (size_t component = 0u; component < kGxGpuTexturedUvComponents; component += 1u) {
		gx.texturedVertices[offset + 2u + component] = static_cast<f32>(gx.texturedUvPlane[component]);
		gx.texturedVertices[offset + 4u + component] = static_cast<f32>(gx.texturedUvPlane[kGxGpuTexturedUvComponents + component]);
		gx.texturedVertices[offset + 6u + component] = static_cast<f32>(gx.texturedUvPlane[kGxGpuTexturedUvComponents * 2u + component]);
	}
	for (size_t component = 0u; component < kGxGpuColorComponents; component += 1u) {
		gx.texturedVertices[offset + 8u + component] = static_cast<f32>(gx.colorPlane[component]);
		gx.texturedVertices[offset + 11u + component] = static_cast<f32>(gx.colorPlane[kGxGpuColorComponents + component]);
		gx.texturedVertices[offset + 14u + component] = static_cast<f32>(gx.colorPlane[kGxGpuColorComponents * 2u + component]);
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

size_t appendTexturedPolygon(OpenGLES2GxGpuState& gx, const GxGpuCommandBuffer& commandBuffer, u32 commandIndex, size_t vertexFloatCount) {
	const u32 opcode = commandBuffer.commandOpcode[commandIndex];
	const u32 wordStart = commandBuffer.commandWordStart[commandIndex];
	const u32 drawingOffsetWord = commandBuffer.commandDrawingOffsetWord[commandIndex];
	const i32 dx = gxGpuSigned11(drawingOffsetWord);
	const i32 dy = gxGpuDrawingOffsetY(drawingOffsetWord);
	if (gxGpuCommandGouraud(opcode)) {
		const bool fixedColor = !gxGpuCommandRawTextureEnabled(opcode);
		const u32 color0 = commandBuffer.words[wordStart];
		const u32 xy0 = commandBuffer.words[wordStart + 1u];
		const u32 texture0 = commandBuffer.words[wordStart + 2u];
		const u32 color1 = commandBuffer.words[wordStart + 3u];
		const u32 xy1 = commandBuffer.words[wordStart + 4u];
		const u32 texture1 = commandBuffer.words[wordStart + 5u];
		const u32 color2 = commandBuffer.words[wordStart + 6u];
		const u32 xy2 = commandBuffer.words[wordStart + 7u];
		const u32 texture2 = commandBuffer.words[wordStart + 8u];
		size_t offset = appendTexturedPrimitiveTriangle(gx,
			vertexFloatCount,
			fixedColor,
			dx + gxGpuSigned11(xy0),
			dy + gxGpuVertexY(xy0),
			color0,
			gxGpuTextureU(texture0),
			gxGpuTextureV(texture0),
			dx + gxGpuSigned11(xy1),
			dy + gxGpuVertexY(xy1),
			color1,
			gxGpuTextureU(texture1),
			gxGpuTextureV(texture1),
			dx + gxGpuSigned11(xy2),
			dy + gxGpuVertexY(xy2),
			color2,
			gxGpuTextureU(texture2),
			gxGpuTextureV(texture2));
		if (gxGpuCommandQuadPolygon(opcode)) {
			const u32 color3 = commandBuffer.words[wordStart + 9u];
			const u32 xy3 = commandBuffer.words[wordStart + 10u];
			const u32 texture3 = commandBuffer.words[wordStart + 11u];
			offset = appendTexturedPrimitiveTriangle(gx,
				offset,
				fixedColor,
				dx + gxGpuSigned11(xy2),
				dy + gxGpuVertexY(xy2),
				color2,
				gxGpuTextureU(texture2),
				gxGpuTextureV(texture2),
				dx + gxGpuSigned11(xy1),
				dy + gxGpuVertexY(xy1),
				color1,
				gxGpuTextureU(texture1),
				gxGpuTextureV(texture1),
				dx + gxGpuSigned11(xy3),
				dy + gxGpuVertexY(xy3),
				color3,
				gxGpuTextureU(texture3),
				gxGpuTextureV(texture3));
		}
		return offset;
	}

	const u32 color = commandBuffer.words[wordStart];
	const u32 xy0 = commandBuffer.words[wordStart + 1u];
	const u32 texture0 = commandBuffer.words[wordStart + 2u];
	const u32 xy1 = commandBuffer.words[wordStart + 3u];
	const u32 texture1 = commandBuffer.words[wordStart + 4u];
	const u32 xy2 = commandBuffer.words[wordStart + 5u];
	const u32 texture2 = commandBuffer.words[wordStart + 6u];
	size_t offset = appendTexturedPrimitiveTriangle(gx,
		vertexFloatCount,
		false,
		dx + gxGpuSigned11(xy0),
		dy + gxGpuVertexY(xy0),
		color,
		gxGpuTextureU(texture0),
		gxGpuTextureV(texture0),
		dx + gxGpuSigned11(xy1),
		dy + gxGpuVertexY(xy1),
		color,
		gxGpuTextureU(texture1),
		gxGpuTextureV(texture1),
		dx + gxGpuSigned11(xy2),
		dy + gxGpuVertexY(xy2),
		color,
		gxGpuTextureU(texture2),
		gxGpuTextureV(texture2));
	if (gxGpuCommandQuadPolygon(opcode)) {
		const u32 xy3 = commandBuffer.words[wordStart + 7u];
		const u32 texture3 = commandBuffer.words[wordStart + 8u];
		offset = appendTexturedPrimitiveTriangle(gx,
			offset,
			false,
			dx + gxGpuSigned11(xy2),
			dy + gxGpuVertexY(xy2),
			color,
			gxGpuTextureU(texture2),
			gxGpuTextureV(texture2),
			dx + gxGpuSigned11(xy1),
			dy + gxGpuVertexY(xy1),
			color,
			gxGpuTextureU(texture1),
			gxGpuTextureV(texture1),
			dx + gxGpuSigned11(xy3),
			dy + gxGpuVertexY(xy3),
			color,
			gxGpuTextureU(texture3),
			gxGpuTextureV(texture3));
	}
	return offset;
}

size_t appendTexturedRectangle(OpenGLES2GxGpuState& gx, const GxGpuCommandBuffer& commandBuffer, u32 commandIndex, size_t vertexFloatCount) {
	const u32 opcode = commandBuffer.commandOpcode[commandIndex];
	const u32 wordStart = commandBuffer.commandWordStart[commandIndex];
	const u32 colorWord = commandBuffer.words[wordStart];
	const u32 textureWord = commandBuffer.words[wordStart + 2u];
	const GxGpuRectangle& rect = readGxGpuRectangle(gx, commandBuffer, commandIndex, opcode);
	if (rect.width == 0u || rect.height == 0u) {
		return vertexFloatCount;
	}
	const u32 drawModeWord = commandBuffer.commandDrawModeWord[commandIndex];
	const bool xFlip = gxGpuDrawModeTextureRectangleXFlip(drawModeWord);
	const bool yFlip = gxGpuDrawModeTextureRectangleYFlip(drawModeWord);
	const i32 u0 = static_cast<i32>(gxGpuTextureU(textureWord));
	const i32 v0 = static_cast<i32>(gxGpuTextureV(textureWord));
	const i32 u1 = u0 + (xFlip ? -static_cast<i32>(rect.width) : static_cast<i32>(rect.width));
	const i32 v1 = v0 + (yFlip ? -static_cast<i32>(rect.height) : static_cast<i32>(rect.height));
	const i64 determinant = static_cast<i64>(rect.width) * static_cast<i64>(rect.height);
	size_t offset = vertexFloatCount;
	offset = appendTexturedTriangle(gx, offset, determinant, static_cast<i32>(rect.x0), static_cast<i32>(rect.y0), colorWord, u0, v0, static_cast<i32>(rect.x1), static_cast<i32>(rect.y0), colorWord, u1, v0, static_cast<i32>(rect.x0), static_cast<i32>(rect.y1), colorWord, u0, v1);
	offset = appendTexturedTriangle(gx, offset, determinant, static_cast<i32>(rect.x0), static_cast<i32>(rect.y1), colorWord, u0, v1, static_cast<i32>(rect.x1), static_cast<i32>(rect.y0), colorWord, u1, v0, static_cast<i32>(rect.x1), static_cast<i32>(rect.y1), colorWord, u1, v1);
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
	gx.backend->setRenderTarget(0, kGxGpuVramXAddressPeriod, gx.vramTextureRows);
	gx.backend->setActiveTextureUnit(GLES2_TEXTURE_UNIT_GX_SCANOUT);
	gx.backend->bindTexture2D(&gx.vramTexture);
	glTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, kGxGpuVramXAddressPeriod, gx.vramTextureRows, GL_RGBA, GL_UNSIGNED_SHORT_4_4_4_4, snapshotBytes.data());
	gx.sampleDirtyRect = {0, 0, kGxGpuVramXAddressPeriod, gx.vramTextureRows};
}

void writeGxGpuVramSnapshotFromReadback(OpenGLES2GxGpuState& gx) {
	size_t snapshotByteOffset = 0u;
	for (i32 textureRow = 0; textureRow < gx.vramTextureRows; textureRow += 1) {
		size_t readbackByteOffset = static_cast<size_t>(textureRow) * static_cast<size_t>(kGxGpuVramXAddressPeriod) * kGxGpuRawVramBytesPerPixel;
		for (i32 column = 0; column < kGxGpuVramXAddressPeriod; column += 1) {
			const u8 highNibble = gx.rawVramReadback[readbackByteOffset] / 17u;
			const u8 midHighNibble = gx.rawVramReadback[readbackByteOffset + 1u] / 17u;
			const u8 midLowNibble = gx.rawVramReadback[readbackByteOffset + 2u] / 17u;
			const u8 lowNibble = gx.rawVramReadback[readbackByteOffset + 3u] / 17u;
			gx.vramSnapshotScratch[snapshotByteOffset] = static_cast<u8>((midLowNibble << 4u) | lowNibble);
			gx.vramSnapshotScratch[snapshotByteOffset + 1u] = static_cast<u8>((highNibble << 4u) | midHighNibble);
			snapshotByteOffset += 2u;
			readbackByteOffset += kGxGpuRawVramBytesPerPixel;
		}
	}
}

void completeGxGpuReadback(OpenGLES2GxGpuState& gx, size_t commandLimit, GxGpuReadbackPort& readback) {
	if (!readback.claimReadback(commandLimit)) {
		return;
	}
	const u32 readbackToken = readback.token();
	const u32 pixelCount = readback.width() * readback.height();
	const u32 wordCount = (pixelCount + 1u) >> 1u;
	const u32 packedWidth = wordCount < static_cast<u32>(kGxGpuReadbackPackWidth) ? wordCount : static_cast<u32>(kGxGpuReadbackPackWidth);
	const u32 packedHeight = ((wordCount - 1u) / packedWidth) + 1u;
	gx.backend->setRenderTarget(gx.readbackFramebuffer, static_cast<i32>(packedWidth), static_cast<i32>(packedHeight));
	glDisable(GL_SCISSOR_TEST);
	glDisable(GL_DEPTH_TEST);
	glDepthMask(GL_FALSE);
	glDisable(GL_CULL_FACE);
	glDisable(GL_BLEND);
	glDisable(GL_DITHER);
	glColorMask(GL_TRUE, GL_TRUE, GL_TRUE, GL_TRUE);
	glUseProgram(gx.readbackProgram);
	glUniform4i(gx.readbackParamsUniform, static_cast<GLint>(readback.x()), static_cast<GLint>(readback.y()), static_cast<GLint>(readback.width()), static_cast<GLint>(packedWidth));
	glUniform1i(gx.readbackVramYAddressExtensionUniform, static_cast<GLint>(readback.vramYAddressExtensionWord()));
	gx.backend->setActiveTextureUnit(GLES2_TEXTURE_UNIT_GX_SCANOUT);
	gx.backend->bindTexture2D(&gx.vramTexture);
	glBindBuffer(GL_ARRAY_BUFFER, gx.scanoutVertexBuffer);
	glEnableVertexAttribArray(kGxGpuScanoutPositionAttrib);
	glVertexAttribPointer(kGxGpuScanoutPositionAttrib, 2, GL_FLOAT, GL_FALSE, kGxGpuScanoutVertexStride, nullptr);
	glDrawArrays(GL_TRIANGLES, 0, static_cast<GLsizei>(kGxGpuScanoutVertexCount));
	glReadPixels(0, 0, static_cast<GLsizei>(packedWidth), static_cast<GLsizei>(packedHeight), GL_RGBA, GL_UNSIGNED_BYTE, readback.pixelBytes());
	readback.completeReadback(readbackToken);
}

struct GxCpuToVramUploadProfile {
	u64 hostCalls = 0u;
	u64 hostBytes = 0u;
};

template <bool Profile>
void uploadCpuToVramPayload(OpenGLES2GxGpuState& gx,
		const GxGpuCommandBuffer& commandBuffer,
		u32 payloadWordStart,
		u32 pixelCount,
		GxCpuToVramUploadProfile* profile) {
	const u32 fullRows = pixelCount >> 10u;
	const u32 lastRowWidth = pixelCount & (static_cast<u32>(kGxGpuVramXAddressPeriod) - 1u);
	const u8* sourceBytes = reinterpret_cast<const u8*>(commandBuffer.words.data() + payloadWordStart);
	gx.backend->setActiveTextureUnit(GLES2_TEXTURE_UNIT_GX_TRANSFER);
	gx.backend->bindTexture2D(&gx.cpuUploadTexture);
	if (fullRows != 0u) {
		glTexSubImage2D(
			GL_TEXTURE_2D,
			0,
			0,
			0,
			kGxGpuVramXAddressPeriod,
			static_cast<GLsizei>(fullRows),
			GL_LUMINANCE_ALPHA,
			GL_UNSIGNED_BYTE,
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
			GL_LUMINANCE_ALPHA,
			GL_UNSIGNED_BYTE,
			sourceBytes);
		if constexpr (Profile) {
			profile->hostCalls += 1u;
			profile->hostBytes += static_cast<u64>(lastRowWidth) * kGxGpuCpuUploadBytesPerPixel;
		}
	}
}

size_t appendCpuToVramRows(OpenGLES2GxGpuState& gx,
	u32 x,
	u32 y,
	u32 sourceRowStart,
	u32 rowWidth,
	u32 rowCount,
	size_t transferVertexFloatCount,
	u32 vramYAddressExtensionWord) {
	u32 targetY = gxGpuVramYAddress(y + sourceRowStart, vramYAddressExtensionWord);
	u32 remainingRows = rowCount;
	while (remainingRows != 0u) {
		const u32 runHeight = gxGpuVramWrappedHeight(targetY, remainingRows, vramYAddressExtensionWord, gx.vramTextureRowMask);
		u32 targetRunX = x;
		u32 remainingWidth = rowWidth;
		while (remainingWidth != 0u) {
			const u32 runWidth = gxGpuVramWrappedWidth(targetRunX, remainingWidth);
			transferVertexFloatCount = appendTransferQuad(gx,
				transferVertexFloatCount,
				targetRunX,
				targetY,
				runWidth,
				runHeight,
				targetRunX,
				targetY);
			remainingWidth -= runWidth;
			targetRunX = (targetRunX + runWidth) & (static_cast<u32>(kGxGpuVramXAddressPeriod) - 1u);
		}
		remainingRows -= runHeight;
		targetY = gxGpuVramYAddress(targetY + runHeight, vramYAddressExtensionWord);
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
	const GxGpuCommandBuffer& commandBuffer,
	u32 commandIndex,
	GxCpuToVramUploadProfile* profile) {
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
	const u32 payloadWordStart = wordStart + 3u;
	const u32 maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
	size_t transferVertexFloatCount = 0u;
	if (!gxGpuMaskBitCheckBeforeDraw(maskBitModeWord)
		&& !gxGpuMaskBitSetWhileDrawing(maskBitModeWord)
		&& uploadedPixels == width * height
		&& x + width <= static_cast<u32>(kGxGpuVramXAddressPeriod)
		&& y + height <= (gxGpuVramYAddressMask(vramYAddressExtensionWord) & gx.vramTextureRowMask) + 1u) {
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
	uploadCpuToVramPayload<Profile>(gx, commandBuffer, payloadWordStart, uploadedPixels, profile);
	if (fullRows != 0u) {
		transferVertexFloatCount = appendCpuToVramRows(gx,
			x,
			y,
			0u,
			width,
			fullRows,
			transferVertexFloatCount,
			vramYAddressExtensionWord);
	}
	if (lastRowWidth != 0u) {
		transferVertexFloatCount = appendCpuToVramRows(gx,
			x,
			y,
			fullRows,
			lastRowWidth,
			1u,
			transferVertexFloatCount,
			vramYAddressExtensionWord);
	}
	if (gxGpuMaskBitCheckBeforeDraw(maskBitModeWord)) {
		syncGxGpuSampleTextureLogicalArea(gx, x, y, width, uploadHeight, vramYAddressExtensionWord);
	}
	if (transferVertexFloatCount != 0u) {
		glUseProgram(gx.cpuUploadProgram.id);
		glUniform4i(
			gx.cpuUploadProgram.uploadUniform,
			static_cast<GLint>(x),
			static_cast<GLint>(y),
			static_cast<GLint>(width),
			static_cast<GLint>(gxGpuVramYAddressMask(vramYAddressExtensionWord) + 1u));
		renderTransferCommands(gx,
			transferVertexFloatCount,
			gx.cpuUploadTexture,
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

void uploadCpuToVram(OpenGLES2GxGpuState& gx, const GxGpuCommandBuffer& commandBuffer, u32 commandIndex) {
	if (!gx.backend->profilesGxUploads()) {
		executeCpuToVramUpload<false>(gx, commandBuffer, commandIndex, nullptr);
		return;
	}
	GxCpuToVramUploadProfile profile{};
	const auto start = std::chrono::steady_clock::now();
	const u32 uploadedPixels = executeCpuToVramUpload<true>(gx, commandBuffer, commandIndex, &profile);
	const u64 cpuNanoseconds = static_cast<u64>(std::chrono::duration_cast<std::chrono::nanoseconds>(
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
		glUseProgram(gx.transferProgram.id);
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

void copyVramToVram(OpenGLES2GxGpuState& gx, const GxGpuCommandBuffer& commandBuffer, u32 commandIndex) {
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

void resetGxGpuVramCopyRect(GxGpuVramCopyRect& rect) {
	rect.left = kGxGpuVramXAddressPeriod;
	rect.top = static_cast<i32>(GX_GPU_VRAM_Y_ADDRESS_PERIOD);
	rect.right = 0;
	rect.bottom = 0;
}

void includeGxGpuVramCopyVertex(GxGpuVramCopyRect& rect, i32 x, i32 y) {
	if (x < rect.left) {
		rect.left = x;
	}
	if (y < rect.top) {
		rect.top = y;
	}
	const i32 right = x + 1;
	const i32 bottom = y + 1;
	if (right > rect.right) {
		rect.right = right;
	}
	if (bottom > rect.bottom) {
		rect.bottom = bottom;
	}
}

void includeGxGpuVramCopyRect(GxGpuVramCopyRect& target, const GxGpuVramCopyRect& source) {
	if (target.right <= target.left || target.bottom <= target.top) {
		target = source;
		return;
	}
	if (source.right <= source.left || source.bottom <= source.top) {
		return;
	}
	if (source.left < target.left) {
		target.left = source.left;
	}
	if (source.top < target.top) {
		target.top = source.top;
	}
	if (source.right > target.right) {
		target.right = source.right;
	}
	if (source.bottom > target.bottom) {
		target.bottom = source.bottom;
	}
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
	const GxGpuCommandBuffer& commandBuffer,
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
	rectangle.clippedBounds.right = rectangle.x1 + 1;
	rectangle.clippedBounds.bottom = rectangle.y1 + 1;
	clipGxGpuVramCopyRectToDrawingArea(rectangle.clippedBounds, topLeftWord, bottomRightWord, vramYAddressExtensionWord);
	rectangle.emitsVertices = rectangle.clippedBounds.right > rectangle.clippedBounds.left
		&& rectangle.clippedBounds.bottom > rectangle.clippedBounds.top;
}

void markGxGpuSampleTextureDirtyArea(OpenGLES2GxGpuState& gx, i32 left, i32 top, i32 right, i32 bottom) {
	if (right <= left || bottom <= top) {
		return;
	}
	if (left < gx.sampleDirtyRect.left) {
		gx.sampleDirtyRect.left = left;
	}
	if (top < gx.sampleDirtyRect.top) {
		gx.sampleDirtyRect.top = top;
	}
	if (right > gx.sampleDirtyRect.right) {
		gx.sampleDirtyRect.right = right;
	}
	if (bottom > gx.sampleDirtyRect.bottom) {
		gx.sampleDirtyRect.bottom = bottom;
	}
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
	gx.backend->setRenderTarget(gx.vramFramebuffer, kGxGpuVramXAddressPeriod, gx.vramTextureRows);
	gx.backend->setActiveTextureUnit(GLES2_TEXTURE_UNIT_GX_SAMPLE);
	gx.backend->bindTexture2D(&gx.vramSampleTexture);
	glCopyTexSubImage2D(
		GL_TEXTURE_2D,
		0,
		static_cast<GLint>(left),
		static_cast<GLint>(top),
		static_cast<GLint>(left),
		static_cast<GLint>(top),
		static_cast<GLsizei>(right - left),
		static_cast<GLsizei>(bottom - top));
}

bool syncGxGpuSampleTextureArea(OpenGLES2GxGpuState& gx, i32 left, i32 top, i32 right, i32 bottom) {
	if (left >= gx.sampleDirtyRect.right
		|| gx.sampleDirtyRect.left >= right
		|| top >= gx.sampleDirtyRect.bottom
		|| gx.sampleDirtyRect.top >= bottom) {
		return false;
	}
	copyGxGpuVramAreaToSampleTexture(gx, gx.sampleDirtyRect.left, gx.sampleDirtyRect.top, gx.sampleDirtyRect.right, gx.sampleDirtyRect.bottom);
	resetGxGpuVramCopyRect(gx.sampleDirtyRect);
	return true;
}

void syncGxGpuSampleTextureLogicalArea(OpenGLES2GxGpuState& gx, u32 x, u32 y, u32 width, u32 height, u32 vramYAddressExtensionWord) {
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
			if (syncGxGpuSampleTextureArea(gx,
				static_cast<i32>(columnX),
				static_cast<i32>(rowY),
				static_cast<i32>(columnX + runWidth),
				static_cast<i32>(rowY + runHeight))) {
				return;
			}
			columnX = (columnX + runWidth) & (GX_GPU_VRAM_X_ADDRESS_PERIOD - 1u);
			remainingWidth -= runWidth;
		}
		rowY = (rowY + runHeight) & yAddressMask;
		remainingHeight -= runHeight;
	}
}

void drawGxGpuLogicalVramArea(OpenGLES2GxGpuState& gx,
	const GxGpuVramCopyRect& rect,
	GLint firstVertex,
	GLsizei vertexCount,
	bool textureBarrier,
	bool syncSampleBetweenAliasBands,
	u32 vramYAddressExtensionWord,
	GLint logicalYBaseUniform) {
	if (rect.right <= rect.left || rect.bottom <= rect.top) {
		return;
	}
	glEnable(GL_SCISSOR_TEST);
	const i32 width = rect.right - rect.left;
	if (gx.vramTextureRows == kGxGpuVramYAddressPeriod) {
		glScissor(
			static_cast<GLint>(rect.left),
			static_cast<GLint>(rect.top),
			static_cast<GLsizei>(width),
			static_cast<GLsizei>(rect.bottom - rect.top));
		if (textureBarrier) {
			gx.backend->textureBarrier();
		}
		glDrawArrays(GL_TRIANGLES, firstVertex, vertexCount);
		markGxGpuSampleTextureDirtyLogicalArea(gx,
			static_cast<u32>(rect.left),
			static_cast<u32>(rect.top),
			static_cast<u32>(width),
			static_cast<u32>(rect.bottom - rect.top),
			vramYAddressExtensionWord);
		return;
	}
	const i32 firstBandBase = (rect.top / gx.vramTextureRows) * gx.vramTextureRows;
	for (i32 bandBase = firstBandBase; bandBase < rect.bottom; bandBase += gx.vramTextureRows) {
		const i32 logicalTop = rect.top > bandBase ? rect.top : bandBase;
		const i32 bandBottom = bandBase + gx.vramTextureRows;
		const i32 logicalBottom = rect.bottom < bandBottom ? rect.bottom : bandBottom;
		if (logicalBottom <= logicalTop) {
			continue;
		}
		if (syncSampleBetweenAliasBands) {
			syncGxGpuSampleTextureArea(gx,
				rect.left,
				logicalTop - bandBase,
				rect.right,
				logicalBottom - bandBase);
		}
		glViewport(0, -bandBase, kGxGpuVramXAddressPeriod, kGxGpuVramYAddressPeriod);
		glScissor(
			static_cast<GLint>(rect.left),
			static_cast<GLint>(logicalTop - bandBase),
			static_cast<GLsizei>(width),
			static_cast<GLsizei>(logicalBottom - logicalTop));
		glUniform1i(logicalYBaseUniform, bandBase);
		if (textureBarrier) {
			gx.backend->textureBarrier();
		}
		glDrawArrays(GL_TRIANGLES, firstVertex, vertexCount);
		markGxGpuSampleTextureDirtyArea(gx,
			rect.left,
			logicalTop - bandBase,
			rect.right,
			logicalBottom - bandBase);
	}
}

void setGxGpuVertexBoundsRect(
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
	clipGxGpuVramCopyRectToDrawingArea(rect, topLeftWord, bottomRightWord, vramYAddressExtensionWord);
}

u32 syncGxGpuTexturedSourceTexture(OpenGLES2GxGpuState& gx,
	const GxGpuCommandBuffer& commandBuffer,
	u32 commandIndex,
	size_t vertexFloatStart,
	size_t vertexFloatEnd,
	const GxGpuVramCopyRect& commandRect,
	const GxGpuVramCopyRect& batchRect,
	bool fixedColor) {
	submitGxGpuPrimitiveBatches(gx);
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
	for (size_t offset = vertexFloatStart; offset < vertexFloatEnd; offset += vertexFloatStride) {
		const i64 x = static_cast<i64>(gx.texturedVertices[offset]);
		const i64 y = static_cast<i64>(gx.texturedVertices[offset + 1u]);
		const u32 u = static_cast<u32>((static_cast<i64>(gx.texturedVertices[offset + planeOffset]) + static_cast<i64>(gx.texturedVertices[offset + planeOffset + 2u]) * x + static_cast<i64>(gx.texturedVertices[offset + planeOffset + 4u]) * y) & GX_GPU_TRIANGLE_ATTRIBUTE_ACCUMULATOR_MASK) >> GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS;
		const u32 v = static_cast<u32>((static_cast<i64>(gx.texturedVertices[offset + planeOffset + 1u]) + static_cast<i64>(gx.texturedVertices[offset + planeOffset + 3u]) * x + static_cast<i64>(gx.texturedVertices[offset + planeOffset + 5u]) * y) & GX_GPU_TRIANGLE_ATTRIBUTE_ACCUMULATOR_MASK) >> GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS;
		includeGxGpuVramCopyVertex(rect, static_cast<i32>(u), static_cast<i32>(v));
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
	syncGxGpuSampleTextureLogicalArea(gx, sourceX, sourceY, sourceWidth, sourceHeight, vramYAddressExtensionWord);
	if (textureMode < 2u) {
		const u32 clutX = gxGpuTextureClutBaseX(textureWord);
		const u32 clutY = gxGpuTextureClutBaseY(textureWord, vramYAddressExtensionWord);
		const u32 clutWidth = textureMode == 0u ? GX_GPU_CLUT_4BIT_WORDS : GX_GPU_CLUT_8BIT_WORDS;
		if (gxGpuVramLogicalAreaOverlapsBounds(clutX, clutY, clutWidth, 1u, commandRect.left, commandRect.top, commandRect.right, commandRect.bottom, vramYAddressExtensionWord, gx.vramTextureRowMask)) overlaps |= GX_GPU_TEXTURE_SOURCE_COMMAND_OVERLAP;
		if (gxGpuVramLogicalAreaOverlapsBounds(clutX, clutY, clutWidth, 1u, batchRect.left, batchRect.top, batchRect.right, batchRect.bottom, vramYAddressExtensionWord, gx.vramTextureRowMask)) overlaps |= GX_GPU_TEXTURE_SOURCE_BATCH_OVERLAP;
		syncGxGpuSampleTextureLogicalArea(gx, clutX, clutY, clutWidth, 1u, vramYAddressExtensionWord);
	}
	return overlaps;
}

void writePrimitiveUniforms(
	GLint blendEnableUniform,
	GLint blendModeUniform,
	GLint checkMaskBitUniform,
	GLint setMaskBitUniform,
	GLint ditherEnableUniform,
	GLint skippedLineParityUniform,
	bool blendEnabled,
	u32 blendMode,
	u32 maskBitModeWord,
	bool ditherEnabled,
	u32 skippedLineParity) {
	glUniform1i(blendEnableUniform, blendEnabled ? 1 : 0);
	glUniform1i(blendModeUniform, static_cast<GLint>(blendMode));
	glUniform1i(checkMaskBitUniform, gxGpuMaskBitCheckBeforeDraw(maskBitModeWord) ? 1 : 0);
	glUniform1i(setMaskBitUniform, gxGpuMaskBitSetWhileDrawing(maskBitModeWord) ? 1 : 0);
	glUniform1i(ditherEnableUniform, ditherEnabled ? 1 : 0);
	glUniform1i(skippedLineParityUniform, static_cast<GLint>(skippedLineParity));
}

void writeTexturedUniforms(OpenGLES2GxGpuState& gx, const GxGpuCommandBuffer& commandBuffer, u32 commandIndex, bool fixedColor) {
	const u32 opcode = commandBuffer.commandOpcode[commandIndex];
	const u32 drawModeWord = commandBuffer.commandDrawModeWord[commandIndex];
	const u32 textureWindowWord = commandBuffer.commandTextureWindowWord[commandIndex];
	const u32 maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
	glUniform2i(fixedColor ? gx.fixedTexturedTextureWindowAndUniform : gx.texturedTextureWindowAndUniform, static_cast<GLint>(gxGpuTextureWindowAndX(textureWindowWord)), static_cast<GLint>(gxGpuTextureWindowAndY(textureWindowWord)));
	glUniform2i(fixedColor ? gx.fixedTexturedTextureWindowOrUniform : gx.texturedTextureWindowOrUniform, static_cast<GLint>(gxGpuTextureWindowOrX(textureWindowWord)), static_cast<GLint>(gxGpuTextureWindowOrY(textureWindowWord)));
	glUniform1i(fixedColor ? gx.fixedTexturedTextureModeUniform : gx.texturedTextureModeUniform, static_cast<GLint>(gxGpuDrawModeTextureMode(drawModeWord)));
	glUniform1i(fixedColor ? gx.fixedTexturedRawTextureUniform : gx.texturedRawTextureUniform, gxGpuCommandRawTextureEnabled(opcode) ? 1 : 0);
	glUniform1i(fixedColor ? gx.fixedTexturedBlendEnableUniform : gx.texturedBlendEnableUniform, gxGpuCommandSemiTransparencyEnabled(opcode) ? 1 : 0);
	glUniform1i(fixedColor ? gx.fixedTexturedBlendModeUniform : gx.texturedBlendModeUniform, static_cast<GLint>(gxGpuDrawModeTransparencyMode(drawModeWord)));
	glUniform1i(fixedColor ? gx.fixedTexturedCheckMaskBitUniform : gx.texturedCheckMaskBitUniform, gxGpuMaskBitCheckBeforeDraw(maskBitModeWord) ? 1 : 0);
	glUniform1i(fixedColor ? gx.fixedTexturedSetMaskBitUniform : gx.texturedSetMaskBitUniform, gxGpuMaskBitSetWhileDrawing(maskBitModeWord) ? 1 : 0);
	glUniform1i(
		fixedColor ? gx.fixedTexturedDitherEnableUniform : gx.texturedDitherEnableUniform,
		commandBuffer.commandKind[commandIndex] == GX_GPU_COMMAND_DRAW_POLYGON && gxGpuDitheredPolygon(drawModeWord, opcode) ? 1 : 0);
	glUniform1i(fixedColor ? gx.fixedTexturedSkippedLineParityUniform : gx.texturedSkippedLineParityUniform, static_cast<GLint>(commandBuffer.commandSkippedLineParity[commandIndex]));
	glUniform1f(
		fixedColor ? gx.fixedTexturedRasterPhaseUniform : gx.texturedRasterPhaseUniform,
		commandBuffer.commandKind[commandIndex] == GX_GPU_COMMAND_DRAW_POLYGON ? 0.5f : 0.0f);
}

void writeTransferUniforms(GxGpuTransferProgram& program, i32 sourceTextureUnit, u32 maskBitModeWord) {
	if (program.sourceTextureUnit != sourceTextureUnit) {
		glUniform1i(program.sourceUniform, sourceTextureUnit);
		program.sourceTextureUnit = sourceTextureUnit;
	}
	glUniform1i(program.checkMaskBitUniform, gxGpuMaskBitCheckBeforeDraw(maskBitModeWord) ? 1 : 0);
	glUniform1i(program.setMaskBitUniform, gxGpuMaskBitSetWhileDrawing(maskBitModeWord) ? 1 : 0);
}

void renderNewSolidCommands(OpenGLES2GxGpuState& gx, bool fixedColor, size_t vertexFloatCount, GLintptr vertexBufferOffset, const GxGpuVramCopyRect& drawBounds, u32 vramYAddressExtensionWord, bool blendEnabled, u32 blendMode, u32 maskBitModeWord, bool ditherEnabled, u32 skippedLineParity, GxGpuRasterKind rasterKind);
void renderReadVramSolidQuad(OpenGLES2GxGpuState& gx, bool fixedColor, u32 topLeftWord, u32 bottomRightWord, u32 vramYAddressExtensionWord, bool blendEnabled, u32 blendMode, u32 maskBitModeWord, bool ditherEnabled, u32 skippedLineParity);
size_t appendLineCommandVertices(OpenGLES2GxGpuState& gx, const GxGpuCommandBuffer& commandBuffer, u32 commandIndex, size_t vertexFloatCount);
void renderTexturedCommand(OpenGLES2GxGpuState& gx, const GxGpuCommandBuffer& commandBuffer, u32 commandIndex, u32 topLeftWord, u32 bottomRightWord);
size_t appendTexturedCommandVertices(OpenGLES2GxGpuState& gx, const GxGpuCommandBuffer& commandBuffer, u32 commandIndex, size_t vertexFloatCount);
size_t flushTexturedCommands(OpenGLES2GxGpuState& gx, const GxGpuCommandBuffer& commandBuffer, size_t vertexFloatCount, u32 batchCommandIndex);

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

size_t appendSolidCommandVertices(OpenGLES2GxGpuState& gx, const GxGpuCommandBuffer& commandBuffer, u32 commandIndex, size_t vertexFloatCount) {
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
	gx.backend->setRenderTarget(gx.vramFramebuffer, kGxGpuVramXAddressPeriod, gx.vramTextureRows);
	glDisable(GL_DEPTH_TEST);
	glDepthMask(GL_FALSE);
	glDisable(GL_CULL_FACE);
	glDisable(GL_BLEND);
}

void renderNewLineCommands(OpenGLES2GxGpuState& gx,
	size_t vertexFloatCount,
	GLintptr vertexBufferOffset,
	const GxGpuVramCopyRect& drawBounds,
	u32 vramYAddressExtensionWord,
	bool blendEnabled,
	u32 blendMode,
	u32 maskBitModeWord,
	bool ditherEnabled,
	u32 skippedLineParity) {
	const bool textureBarrier = gx.textureBarrier
		&& (blendEnabled || gxGpuMaskBitCheckBeforeDraw(maskBitModeWord));
	const uintptr_t vertexBufferAddress = static_cast<uintptr_t>(vertexBufferOffset);
	beginGxGpuVramRenderTarget(gx);
	glUseProgram(gx.lineProgram);
	writePrimitiveUniforms(
		gx.lineBlendEnableUniform,
		gx.lineBlendModeUniform,
		gx.lineCheckMaskBitUniform,
		gx.lineSetMaskBitUniform,
		gx.lineDitherEnableUniform,
		gx.lineSkippedLineParityUniform,
		blendEnabled,
		blendMode,
		maskBitModeWord,
		ditherEnabled,
		skippedLineParity);
	if (!gx.framebufferFetch) {
		gx.backend->setActiveTextureUnit(GLES2_TEXTURE_UNIT_GX_SAMPLE);
		gx.backend->bindTexture2D(textureBarrier ? &gx.vramTexture : &gx.vramSampleTexture);
	}
	glBindBuffer(GL_ARRAY_BUFFER, gx.vertexStream.buffer);
	glEnableVertexAttribArray(static_cast<GLuint>(gx.linePositionAttrib));
	glVertexAttribPointer(static_cast<GLuint>(gx.linePositionAttrib), 2, GL_FLOAT, GL_FALSE, kGxGpuLineVertexStride, reinterpret_cast<const void*>(vertexBufferAddress));
	glEnableVertexAttribArray(static_cast<GLuint>(gx.lineStartAttrib));
	glVertexAttribPointer(static_cast<GLuint>(gx.lineStartAttrib), 2, GL_FLOAT, GL_FALSE, kGxGpuLineVertexStride, reinterpret_cast<const void*>(vertexBufferAddress + 2u * sizeof(f32)));
	glEnableVertexAttribArray(static_cast<GLuint>(gx.lineEndAttrib));
	glVertexAttribPointer(static_cast<GLuint>(gx.lineEndAttrib), 2, GL_FLOAT, GL_FALSE, kGxGpuLineVertexStride, reinterpret_cast<const void*>(vertexBufferAddress + 4u * sizeof(f32)));
	glEnableVertexAttribArray(static_cast<GLuint>(gx.lineColor0Attrib));
	glVertexAttribPointer(static_cast<GLuint>(gx.lineColor0Attrib), 3, GL_FLOAT, GL_FALSE, kGxGpuLineVertexStride, reinterpret_cast<const void*>(vertexBufferAddress + 6u * sizeof(f32)));
	glEnableVertexAttribArray(static_cast<GLuint>(gx.lineColor1Attrib));
	glVertexAttribPointer(static_cast<GLuint>(gx.lineColor1Attrib), 3, GL_FLOAT, GL_FALSE, kGxGpuLineVertexStride, reinterpret_cast<const void*>(vertexBufferAddress + 9u * sizeof(f32)));
	const GLsizei vertexCount = static_cast<GLsizei>(vertexFloatCount / kGxGpuLineVertexFloats);
	if (gx.vramTextureRows == kGxGpuVramYAddressPeriod) {
		drawGxGpuLogicalVramArea(gx,
			drawBounds,
			0,
			vertexCount,
			textureBarrier,
			false,
			vramYAddressExtensionWord,
			gx.lineLogicalYBaseUniform);
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
				vramYAddressExtensionWord,
				gx.lineLogicalYBaseUniform);
		}
	}
	glDisable(GL_SCISSOR_TEST);
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
		if (batch.sampleSyncBefore) {
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
				batch.vramYAddressExtensionWord,
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
				batch.vramYAddressExtensionWord,
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

bool gxGpuBlendPlanCommandMatches(const GxGpuCommandBuffer& commandBuffer, u32 commandIndex, u32 firstCommandIndex) {
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
	const GxGpuCommandBuffer& commandBuffer,
	u32 commandIndex,
	u32 topLeftWord,
	u32 bottomRightWord,
	u32 vramYAddressExtensionWord) {
	const u32 opcode = commandBuffer.commandOpcode[commandIndex];
	const u32 wordStart = commandBuffer.commandWordStart[commandIndex];
	const u32 drawingOffsetWord = commandBuffer.commandDrawingOffsetWord[commandIndex];
	const i32 dx = gxGpuSigned11(drawingOffsetWord);
	const i32 dy = gxGpuDrawingOffsetY(drawingOffsetWord);
	const u32 color0 = commandBuffer.words[wordStart];
	const u32 xy0 = commandBuffer.words[wordStart + 1u];
	const bool gouraud = gxGpuCommandGouraud(opcode);
	const u32 color1 = gouraud ? commandBuffer.words[wordStart + 2u] : color0;
	const u32 xy1 = commandBuffer.words[wordStart + (gouraud ? 3u : 2u)];
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

u32 executeGxGpuBlendPlan(OpenGLES2GxGpuState& gx, const GxGpuCommandBuffer& commandBuffer, u32 commandStart, u32 commandEnd) {
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

void executeNewGxGpuCommands(OpenGLES2GxGpuState& gx, const GxGpuCommandBuffer& commandBuffer, size_t commandLimit) {
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
	for (; commandIndex < commandLimit; commandIndex += 1u) {
		const u8 commandKind = commandBuffer.commandKind[commandIndex];
		const bool commandDrawsTexture = (commandKind == GX_GPU_COMMAND_DRAW_POLYGON || commandKind == GX_GPU_COMMAND_DRAW_RECTANGLE)
			&& gxGpuCommandTextureEnabled(commandBuffer.commandOpcode[commandIndex]);
		if (gxGpuBlendPlanCommandMatches(commandBuffer, commandIndex, commandIndex)) {
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
				&& gxGpuCommandGouraud(opcode);
			const GxGpuRasterKind rasterKind = commandKind == GX_GPU_COMMAND_DRAW_POLYGON
				? GxGpuRasterKind::Polygon
				: GxGpuRasterKind::Rectangle;
			const bool fixedTexturedColor = drawsTexture
				&& commandKind == GX_GPU_COMMAND_DRAW_POLYGON
				&& gxGpuCommandGouraud(opcode)
				&& !gxGpuCommandRawTextureEnabled(opcode);
			const bool ditherEnabled = commandBuffer.commandKind[commandIndex] == GX_GPU_COMMAND_DRAW_POLYGON && gxGpuDitheredPolygon(drawModeWord, opcode);
			const bool blendEnabled = gxGpuCommandSemiTransparencyEnabled(opcode);
			const u32 blendMode = blendEnabled ? gxGpuDrawModeTransparencyMode(drawModeWord) : 0u;
			const bool readsVram = blendEnabled || gxGpuMaskBitCheckBeforeDraw(maskBitModeWord);
			const bool splitReadVramQuad = readsVram
				&& commandBuffer.commandKind[commandIndex] == GX_GPU_COMMAND_DRAW_POLYGON
				&& gxGpuCommandQuadPolygon(opcode);
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
						&& gxGpuCommandGouraud(batchOpcode)
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
				size_t texturedCommandVertexStart = texturedVertexFloatCount;
				texturedVertexFloatCount = appendTexturedCommandVertices(gx, commandBuffer, commandIndex, texturedVertexFloatCount);
				if (texturedVertexFloatCount != texturedCommandVertexStart) {
					const size_t texturedVertexFloatStride = fixedTexturedColor ? kGxGpuFixedTexturedVertexFloats : kGxGpuTexturedVertexFloats;
					setGxGpuVertexBoundsRect(gx.texturedCommandRect, gx.texturedVertices.data(), texturedCommandVertexStart, texturedVertexFloatCount, texturedVertexFloatStride, topLeftWord, bottomRightWord, vramYAddressExtensionWord);
					u32 sourceOverlaps = syncGxGpuTexturedSourceTexture(gx, commandBuffer, commandIndex, texturedCommandVertexStart, texturedVertexFloatCount, gx.texturedCommandRect, gx.texturedBatchRect, fixedTexturedColor);
					if ((sourceOverlaps & GX_GPU_TEXTURE_SOURCE_BATCH_OVERLAP) != 0u) {
						texturedVertexFloatCount = flushTexturedCommands(gx, commandBuffer, texturedCommandVertexStart, texturedBatchCommandIndex);
						texturedBatchCommandIndex = commandIndex;
						texturedCommandVertexStart = 0u;
						texturedVertexFloatCount = appendTexturedCommandVertices(gx, commandBuffer, commandIndex, 0u);
						setGxGpuVertexBoundsRect(gx.texturedCommandRect, gx.texturedVertices.data(), 0u, texturedVertexFloatCount, texturedVertexFloatStride, topLeftWord, bottomRightWord, vramYAddressExtensionWord);
						sourceOverlaps = syncGxGpuTexturedSourceTexture(gx, commandBuffer, commandIndex, 0u, texturedVertexFloatCount, gx.texturedCommandRect, gx.texturedBatchRect, fixedTexturedColor);
					}
					if ((sourceOverlaps & GX_GPU_TEXTURE_SOURCE_COMMAND_OVERLAP) != 0u) {
						if (texturedCommandVertexStart != 0u) {
							texturedVertexFloatCount = flushTexturedCommands(gx, commandBuffer, texturedCommandVertexStart, texturedBatchCommandIndex);
						}
						texturedVertexFloatCount = 0u;
						resetGxGpuVramCopyRect(gx.texturedBatchRect);
						renderTexturedCommand(gx, commandBuffer, commandIndex, topLeftWord, bottomRightWord);
					} else {
						includeGxGpuVramCopyRect(gx.texturedBatchRect, gx.texturedCommandRect);
					}
				}
			} else {
				const size_t commandVertexStart = gx.primitiveSubmission.solidFloatCount;
				gx.primitiveSubmission.solidFloatCount = appendSolidCommandVertices(gx, commandBuffer, commandIndex, gx.primitiveSubmission.solidFloatCount);
				const size_t vertexFloatStride = fixedSolidColor ? kGxGpuFixedSolidVertexFloats : kGxGpuSolidVertexFloats;
				if (gx.primitiveSubmission.solidFloatCount != commandVertexStart) {
					setGxGpuVertexBoundsRect(gx.solidCommandRect, gx.solidVertices.data(), commandVertexStart, gx.primitiveSubmission.solidFloatCount, vertexFloatStride, topLeftWord, bottomRightWord, vramYAddressExtensionWord);
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
			const bool readsVram = blendEnabled || gxGpuMaskBitCheckBeforeDraw(maskBitModeWord);
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
		const GxGpuCommandBuffer& commandBuffer,
	u32 commandIndex,
	size_t vertexFloatCount) {
	const u32 opcode = commandBuffer.commandOpcode[commandIndex];
	const u32 wordStart = commandBuffer.commandWordStart[commandIndex];
	const u32 wordEnd = wordStart + commandBuffer.commandWordCount[commandIndex];
	const u32 drawingOffsetWord = commandBuffer.commandDrawingOffsetWord[commandIndex];
	const i32 dx = gxGpuSigned11(drawingOffsetWord);
	const i32 dy = gxGpuDrawingOffsetY(drawingOffsetWord);

	if (commandBuffer.commandKind[commandIndex] == GX_GPU_COMMAND_DRAW_LINE) {
		const u32 color0 = commandBuffer.words[wordStart];
		const u32 xy0 = commandBuffer.words[wordStart + 1u];
		if (gxGpuCommandGouraud(opcode)) {
			const u32 color1 = commandBuffer.words[wordStart + 2u];
			const u32 xy1 = commandBuffer.words[wordStart + 3u];
			vertexFloatCount = appendBatchedLineSegment(gx,
				vertexFloatCount,
				dx + gxGpuSigned11(xy0),
				dy + gxGpuVertexY(xy0),
				color0,
				dx + gxGpuSigned11(xy1),
				dy + gxGpuVertexY(xy1),
				color1);
		} else {
			const u32 xy1 = commandBuffer.words[wordStart + 2u];
			vertexFloatCount = appendBatchedLineSegment(gx,
				vertexFloatCount,
				dx + gxGpuSigned11(xy0),
				dy + gxGpuVertexY(xy0),
				color0,
				dx + gxGpuSigned11(xy1),
				dy + gxGpuVertexY(xy1),
				color0);
		}
		return vertexFloatCount;
	}

	if (gxGpuCommandGouraud(opcode)) {
		u32 color0 = commandBuffer.words[wordStart];
		u32 xy0 = commandBuffer.words[wordStart + 1u];
		for (u32 wordIndex = wordStart + 2u; wordIndex + 1u < wordEnd; wordIndex += 2u) {
			const u32 color1 = commandBuffer.words[wordIndex];
			const u32 xy1 = commandBuffer.words[wordIndex + 1u];
			vertexFloatCount = appendBatchedLineSegment(gx,
				vertexFloatCount,
				dx + gxGpuSigned11(xy0),
				dy + gxGpuVertexY(xy0),
				color0,
				dx + gxGpuSigned11(xy1),
				dy + gxGpuVertexY(xy1),
				color1);
			color0 = color1;
			xy0 = xy1;
		}
	} else {
		const u32 color = commandBuffer.words[wordStart];
		u32 xy0 = commandBuffer.words[wordStart + 1u];
		for (u32 wordIndex = wordStart + 2u; wordIndex < wordEnd; wordIndex += 1u) {
			const u32 xy1 = commandBuffer.words[wordIndex];
			vertexFloatCount = appendBatchedLineSegment(gx,
				vertexFloatCount,
				dx + gxGpuSigned11(xy0),
				dy + gxGpuVertexY(xy0),
				color,
				dx + gxGpuSigned11(xy1),
				dy + gxGpuVertexY(xy1),
				color);
			xy0 = xy1;
		}
	}
	return vertexFloatCount;
}

void renderNewSolidCommands(OpenGLES2GxGpuState& gx, bool fixedColor, size_t vertexFloatCount, GLintptr vertexBufferOffset, const GxGpuVramCopyRect& drawBounds, u32 vramYAddressExtensionWord, bool blendEnabled, u32 blendMode, u32 maskBitModeWord, bool ditherEnabled, u32 skippedLineParity, GxGpuRasterKind rasterKind) {
	const bool textureBarrier = gx.textureBarrier
		&& (blendEnabled || gxGpuMaskBitCheckBeforeDraw(maskBitModeWord));
	const size_t vertexFloatStride = fixedColor ? kGxGpuFixedSolidVertexFloats : kGxGpuSolidVertexFloats;
	const uintptr_t vertexBufferAddress = static_cast<uintptr_t>(vertexBufferOffset);
	beginGxGpuVramRenderTarget(gx);
	glUseProgram(fixedColor ? gx.fixedSolidProgram : gx.solidProgram);
	glUniform1f(fixedColor ? gx.fixedSolidRasterPhaseUniform : gx.solidRasterPhaseUniform, rasterKind == GxGpuRasterKind::Polygon ? 0.5f : 0.0f);
	writePrimitiveUniforms(
		fixedColor ? gx.fixedSolidBlendEnableUniform : gx.solidBlendEnableUniform,
		fixedColor ? gx.fixedSolidBlendModeUniform : gx.solidBlendModeUniform,
		fixedColor ? gx.fixedSolidCheckMaskBitUniform : gx.solidCheckMaskBitUniform,
		fixedColor ? gx.fixedSolidSetMaskBitUniform : gx.solidSetMaskBitUniform,
		fixedColor ? gx.fixedSolidDitherEnableUniform : gx.solidDitherEnableUniform,
		fixedColor ? gx.fixedSolidSkippedLineParityUniform : gx.solidSkippedLineParityUniform,
		blendEnabled,
		blendMode,
		maskBitModeWord,
		ditherEnabled,
		skippedLineParity);
	if (!gx.framebufferFetch) {
		gx.backend->setActiveTextureUnit(GLES2_TEXTURE_UNIT_GX_SAMPLE);
		gx.backend->bindTexture2D(textureBarrier ? &gx.vramTexture : &gx.vramSampleTexture);
	}
	glBindBuffer(GL_ARRAY_BUFFER, gx.vertexStream.buffer);
	if (fixedColor) {
		glEnableVertexAttribArray(static_cast<GLuint>(gx.fixedSolidPositionAttrib));
		glVertexAttribPointer(static_cast<GLuint>(gx.fixedSolidPositionAttrib), 2, GL_FLOAT, GL_FALSE, kGxGpuFixedSolidVertexStride, reinterpret_cast<const void*>(vertexBufferAddress));
		glEnableVertexAttribArray(static_cast<GLuint>(gx.fixedSolidColorPlaneBaseAttrib));
		glVertexAttribPointer(static_cast<GLuint>(gx.fixedSolidColorPlaneBaseAttrib), 3, GL_FLOAT, GL_FALSE, kGxGpuFixedSolidVertexStride, reinterpret_cast<const void*>(vertexBufferAddress + 2u * sizeof(f32)));
		glEnableVertexAttribArray(static_cast<GLuint>(gx.fixedSolidColorPlaneStepXAttrib));
		glVertexAttribPointer(static_cast<GLuint>(gx.fixedSolidColorPlaneStepXAttrib), 3, GL_FLOAT, GL_FALSE, kGxGpuFixedSolidVertexStride, reinterpret_cast<const void*>(vertexBufferAddress + 5u * sizeof(f32)));
		glEnableVertexAttribArray(static_cast<GLuint>(gx.fixedSolidColorPlaneStepYAttrib));
		glVertexAttribPointer(static_cast<GLuint>(gx.fixedSolidColorPlaneStepYAttrib), 3, GL_FLOAT, GL_FALSE, kGxGpuFixedSolidVertexStride, reinterpret_cast<const void*>(vertexBufferAddress + 8u * sizeof(f32)));
	} else {
		glEnableVertexAttribArray(static_cast<GLuint>(gx.solidPositionAttrib));
		glVertexAttribPointer(static_cast<GLuint>(gx.solidPositionAttrib), 2, GL_FLOAT, GL_FALSE, kGxGpuSolidVertexStride, reinterpret_cast<const void*>(vertexBufferAddress));
		glEnableVertexAttribArray(static_cast<GLuint>(gx.solidColorAttrib));
		glVertexAttribPointer(static_cast<GLuint>(gx.solidColorAttrib), 4, GL_FLOAT, GL_FALSE, kGxGpuSolidVertexStride, reinterpret_cast<const void*>(vertexBufferAddress + 2u * sizeof(f32)));
	}
	const GLsizei vertexCount = static_cast<GLsizei>(vertexFloatCount / vertexFloatStride);
	const GLint logicalYBaseUniform = fixedColor
		? gx.fixedSolidLogicalYBaseUniform
		: gx.solidLogicalYBaseUniform;
	if (gx.vramTextureRows == kGxGpuVramYAddressPeriod) {
		drawGxGpuLogicalVramArea(gx,
			drawBounds,
			0,
			vertexCount,
			textureBarrier,
			false,
			vramYAddressExtensionWord,
			logicalYBaseUniform);
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
				vramYAddressExtensionWord,
				logicalYBaseUniform);
		}
	}
	glDisable(GL_SCISSOR_TEST);
}

void renderReadVramSolidQuad(OpenGLES2GxGpuState& gx, bool fixedColor, u32 topLeftWord, u32 bottomRightWord, u32 vramYAddressExtensionWord, bool blendEnabled, u32 blendMode, u32 maskBitModeWord, bool ditherEnabled, u32 skippedLineParity) {
	const size_t triangleFloatCount = fixedColor ? kGxGpuFixedSolidTriangleFloats : kGxGpuSolidTriangleFloats;
	const size_t vertexFloatStride = fixedColor ? kGxGpuFixedSolidVertexFloats : kGxGpuSolidVertexFloats;
	const GLsizeiptr vertexByteCount = static_cast<GLsizeiptr>(triangleFloatCount * 2u * sizeof(f32));
	gx.vertexStream.reserve(vertexByteCount);
	const GLintptr vertexBufferOffset = gx.vertexStream.append(gx.solidVertices.data(), vertexByteCount);
	setGxGpuVertexBoundsRect(gx.solidCommandRect, gx.solidVertices.data(), 0u, triangleFloatCount, vertexFloatStride, topLeftWord, bottomRightWord, vramYAddressExtensionWord);
	if (!gx.framebufferFetch && !gx.textureBarrier) {
		syncGxGpuSampleTextureLogicalArea(gx,
			static_cast<u32>(gx.solidCommandRect.left),
			static_cast<u32>(gx.solidCommandRect.top),
			static_cast<u32>(gx.solidCommandRect.right - gx.solidCommandRect.left),
			static_cast<u32>(gx.solidCommandRect.bottom - gx.solidCommandRect.top),
			vramYAddressExtensionWord);
	}
	renderNewSolidCommands(gx, fixedColor, triangleFloatCount, vertexBufferOffset, gx.solidCommandRect, vramYAddressExtensionWord, blendEnabled, blendMode, maskBitModeWord, ditherEnabled, skippedLineParity, GxGpuRasterKind::Polygon);
	setGxGpuVertexBoundsRect(gx.solidCommandRect, gx.solidVertices.data(), triangleFloatCount, triangleFloatCount * 2u, vertexFloatStride, topLeftWord, bottomRightWord, vramYAddressExtensionWord);
	if (!gx.framebufferFetch && !gx.textureBarrier) {
		syncGxGpuSampleTextureLogicalArea(gx,
			static_cast<u32>(gx.solidCommandRect.left),
			static_cast<u32>(gx.solidCommandRect.top),
			static_cast<u32>(gx.solidCommandRect.right - gx.solidCommandRect.left),
			static_cast<u32>(gx.solidCommandRect.bottom - gx.solidCommandRect.top),
			vramYAddressExtensionWord);
	}
	renderNewSolidCommands(gx, fixedColor, triangleFloatCount, vertexBufferOffset + static_cast<GLintptr>(triangleFloatCount * sizeof(f32)), gx.solidCommandRect, vramYAddressExtensionWord, blendEnabled, blendMode, maskBitModeWord, ditherEnabled, skippedLineParity, GxGpuRasterKind::Polygon);
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
	beginGxGpuVramRenderTarget(gx);
	glDisable(GL_SCISSOR_TEST);
	writeTransferUniforms(program, sourceTextureUnit, maskBitModeWord);
	gx.backend->setActiveTextureUnit(sourceTextureUnit);
	gx.backend->bindTexture2D(&sourceTexture);
	gx.backend->setActiveTextureUnit(GLES2_TEXTURE_UNIT_GX_SAMPLE);
	gx.backend->bindTexture2D(&gx.vramSampleTexture);
	glBindBuffer(GL_ARRAY_BUFFER, gx.vertexStream.buffer);
	glEnableVertexAttribArray(kGxGpuTransferPositionAttrib);
	glVertexAttribPointer(kGxGpuTransferPositionAttrib, 2, GL_FLOAT, GL_FALSE, kGxGpuTransferVertexStride, reinterpret_cast<const void*>(vertexBufferAddress));
	glEnableVertexAttribArray(kGxGpuTransferSourceOffsetAttrib);
	glVertexAttribPointer(kGxGpuTransferSourceOffsetAttrib, 2, GL_FLOAT, GL_FALSE, kGxGpuTransferVertexStride, reinterpret_cast<const void*>(vertexBufferAddress + 2u * sizeof(f32)));
	if (gx.vramTextureRows == kGxGpuVramYAddressPeriod) {
		glDrawArrays(GL_TRIANGLES, 0, static_cast<GLsizei>(vertexFloatCount / kGxGpuTransferVertexFloats));
		return;
	}
	glEnable(GL_SCISSOR_TEST);
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
			glViewport(0, -bandBase, kGxGpuVramXAddressPeriod, kGxGpuVramYAddressPeriod);
			glScissor(left, logicalTop - bandBase, right - left, logicalBottom - logicalTop);
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
	glDisable(GL_SCISSOR_TEST);
}

size_t appendTexturedCommandVertices(OpenGLES2GxGpuState& gx, const GxGpuCommandBuffer& commandBuffer, u32 commandIndex, size_t vertexFloatCount) {
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

void renderTexturedVertices(OpenGLES2GxGpuState& gx,
	const GxGpuCommandBuffer& commandBuffer,
	u32 commandIndex,
	size_t vertexFloatCount,
	u32 topLeftWord,
	u32 bottomRightWord,
	bool textureBarrier,
	bool syncSampleBetweenAliasBands,
	bool splitTriangles,
	bool syncSourceBetweenTriangles) {
	const u32 vramYAddressExtensionWord = commandBuffer.commandVramYAddressExtensionWord[commandIndex];
	const u32 opcode = commandBuffer.commandOpcode[commandIndex];
	const bool fixedColor = commandBuffer.commandKind[commandIndex] == GX_GPU_COMMAND_DRAW_POLYGON
		&& gxGpuCommandGouraud(opcode)
		&& !gxGpuCommandRawTextureEnabled(opcode);
	const size_t vertexFloatStride = fixedColor ? kGxGpuFixedTexturedVertexFloats : kGxGpuTexturedVertexFloats;
	const GLint logicalYBaseUniform = fixedColor
		? gx.fixedTexturedLogicalYBaseUniform
		: gx.texturedLogicalYBaseUniform;
	submitGxGpuPrimitiveBatches(gx);
	const GLsizeiptr vertexByteCount = static_cast<GLsizeiptr>(vertexFloatCount * sizeof(f32));
	gx.vertexStream.reserve(vertexByteCount);
	const GLintptr vertexBufferOffset = gx.vertexStream.append(gx.texturedVertices.data(), vertexByteCount);
	const uintptr_t vertexBufferAddress = static_cast<uintptr_t>(vertexBufferOffset);
	beginGxGpuVramRenderTarget(gx);
	glUseProgram(fixedColor ? gx.fixedTexturedProgram : gx.texturedProgram);
	writeTexturedUniforms(gx, commandBuffer, commandIndex, fixedColor);
	gx.backend->setActiveTextureUnit(GLES2_TEXTURE_UNIT_GX_SAMPLE);
	gx.backend->bindTexture2D(&gx.vramSampleTexture);
	if (textureBarrier) {
		gx.backend->setActiveTextureUnit(GLES2_TEXTURE_UNIT_GX_DESTINATION);
		gx.backend->bindTexture2D(&gx.vramTexture);
	}
	glBindBuffer(GL_ARRAY_BUFFER, gx.vertexStream.buffer);
	if (fixedColor) {
		glEnableVertexAttribArray(static_cast<GLuint>(gx.fixedTexturedPositionAttrib));
		glVertexAttribPointer(static_cast<GLuint>(gx.fixedTexturedPositionAttrib), 2, GL_FLOAT, GL_FALSE, kGxGpuFixedTexturedVertexStride, reinterpret_cast<const void*>(vertexBufferAddress));
		glEnableVertexAttribArray(static_cast<GLuint>(gx.fixedTexturedUvPlaneBaseAttrib));
		glVertexAttribPointer(static_cast<GLuint>(gx.fixedTexturedUvPlaneBaseAttrib), 2, GL_FLOAT, GL_FALSE, kGxGpuFixedTexturedVertexStride, reinterpret_cast<const void*>(vertexBufferAddress + 2u * sizeof(f32)));
		glEnableVertexAttribArray(static_cast<GLuint>(gx.fixedTexturedUvPlaneStepXAttrib));
		glVertexAttribPointer(static_cast<GLuint>(gx.fixedTexturedUvPlaneStepXAttrib), 2, GL_FLOAT, GL_FALSE, kGxGpuFixedTexturedVertexStride, reinterpret_cast<const void*>(vertexBufferAddress + 4u * sizeof(f32)));
		glEnableVertexAttribArray(static_cast<GLuint>(gx.fixedTexturedUvPlaneStepYAttrib));
		glVertexAttribPointer(static_cast<GLuint>(gx.fixedTexturedUvPlaneStepYAttrib), 2, GL_FLOAT, GL_FALSE, kGxGpuFixedTexturedVertexStride, reinterpret_cast<const void*>(vertexBufferAddress + 6u * sizeof(f32)));
		glEnableVertexAttribArray(static_cast<GLuint>(gx.fixedTexturedColorPlaneBaseAttrib));
		glVertexAttribPointer(static_cast<GLuint>(gx.fixedTexturedColorPlaneBaseAttrib), 3, GL_FLOAT, GL_FALSE, kGxGpuFixedTexturedVertexStride, reinterpret_cast<const void*>(vertexBufferAddress + 8u * sizeof(f32)));
		glEnableVertexAttribArray(static_cast<GLuint>(gx.fixedTexturedColorPlaneStepXAttrib));
		glVertexAttribPointer(static_cast<GLuint>(gx.fixedTexturedColorPlaneStepXAttrib), 3, GL_FLOAT, GL_FALSE, kGxGpuFixedTexturedVertexStride, reinterpret_cast<const void*>(vertexBufferAddress + 11u * sizeof(f32)));
		glEnableVertexAttribArray(static_cast<GLuint>(gx.fixedTexturedColorPlaneStepYAttrib));
		glVertexAttribPointer(static_cast<GLuint>(gx.fixedTexturedColorPlaneStepYAttrib), 3, GL_FLOAT, GL_FALSE, kGxGpuFixedTexturedVertexStride, reinterpret_cast<const void*>(vertexBufferAddress + 14u * sizeof(f32)));
		glEnableVertexAttribArray(static_cast<GLuint>(gx.fixedTexturedTextureSourceAttrib));
		glVertexAttribPointer(static_cast<GLuint>(gx.fixedTexturedTextureSourceAttrib), 4, GL_UNSIGNED_SHORT, GL_FALSE, kGxGpuFixedTexturedVertexStride, reinterpret_cast<const void*>(vertexBufferAddress + kGxGpuFixedTexturedTextureSourceFloatOffset * sizeof(f32)));
	} else {
		glEnableVertexAttribArray(static_cast<GLuint>(gx.texturedPositionAttrib));
		glVertexAttribPointer(static_cast<GLuint>(gx.texturedPositionAttrib), 2, GL_FLOAT, GL_FALSE, kGxGpuTexturedVertexStride, reinterpret_cast<const void*>(vertexBufferAddress));
		glEnableVertexAttribArray(static_cast<GLuint>(gx.texturedColorAttrib));
		glVertexAttribPointer(static_cast<GLuint>(gx.texturedColorAttrib), 3, GL_FLOAT, GL_FALSE, kGxGpuTexturedVertexStride, reinterpret_cast<const void*>(vertexBufferAddress + 2u * sizeof(f32)));
		glEnableVertexAttribArray(static_cast<GLuint>(gx.texturedUvPlaneBaseAttrib));
		glVertexAttribPointer(static_cast<GLuint>(gx.texturedUvPlaneBaseAttrib), 2, GL_FLOAT, GL_FALSE, kGxGpuTexturedVertexStride, reinterpret_cast<const void*>(vertexBufferAddress + 5u * sizeof(f32)));
		glEnableVertexAttribArray(static_cast<GLuint>(gx.texturedUvPlaneStepXAttrib));
		glVertexAttribPointer(static_cast<GLuint>(gx.texturedUvPlaneStepXAttrib), 2, GL_FLOAT, GL_FALSE, kGxGpuTexturedVertexStride, reinterpret_cast<const void*>(vertexBufferAddress + 7u * sizeof(f32)));
		glEnableVertexAttribArray(static_cast<GLuint>(gx.texturedUvPlaneStepYAttrib));
		glVertexAttribPointer(static_cast<GLuint>(gx.texturedUvPlaneStepYAttrib), 2, GL_FLOAT, GL_FALSE, kGxGpuTexturedVertexStride, reinterpret_cast<const void*>(vertexBufferAddress + 9u * sizeof(f32)));
		glEnableVertexAttribArray(static_cast<GLuint>(gx.texturedTextureSourceAttrib));
		glVertexAttribPointer(static_cast<GLuint>(gx.texturedTextureSourceAttrib), 4, GL_UNSIGNED_SHORT, GL_FALSE, kGxGpuTexturedVertexStride, reinterpret_cast<const void*>(vertexBufferAddress + kGxGpuTexturedTextureSourceFloatOffset * sizeof(f32)));
	}
	if (!splitTriangles) {
		drawGxGpuLogicalVramArea(gx,
			gx.texturedCommandRect,
			0,
			static_cast<GLsizei>(vertexFloatCount / vertexFloatStride),
			textureBarrier,
			syncSampleBetweenAliasBands,
			vramYAddressExtensionWord,
			logicalYBaseUniform);
	} else {
		const u32 maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
		const bool readsVram = gxGpuCommandSemiTransparencyEnabled(opcode) || gxGpuMaskBitCheckBeforeDraw(maskBitModeWord);
		const size_t triangleFloatCount = 3u * vertexFloatStride;
		if (!syncSourceBetweenTriangles
			&& !readsVram
			&& gx.vramTextureRows == kGxGpuVramYAddressPeriod) {
			drawGxGpuLogicalVramArea(gx,
				gx.texturedCommandRect,
				0,
				static_cast<GLsizei>(vertexFloatCount / vertexFloatStride),
				false,
				false,
				vramYAddressExtensionWord,
				logicalYBaseUniform);
		} else {
			const bool samplesDestination = !gx.framebufferFetch && !textureBarrier && readsVram;
			size_t dependencyBatchFloatStart = 0u;
			resetGxGpuVramCopyRect(gx.texturedDependencyBatchRect);
			for (size_t vertexFloatStart = 0u; vertexFloatStart < vertexFloatCount; vertexFloatStart += triangleFloatCount) {
				const size_t vertexFloatEnd = vertexFloatStart + triangleFloatCount;
				setGxGpuVertexBoundsRect(gx.vramCopyRectScratch, gx.texturedVertices.data(), vertexFloatStart, vertexFloatEnd, vertexFloatStride, topLeftWord, bottomRightWord, vramYAddressExtensionWord);
				if (vertexFloatStart != dependencyBatchFloatStart
					&& (gx.vramTextureRows != kGxGpuVramYAddressPeriod
						|| syncSourceBetweenTriangles
						|| gxGpuVramCopyRectsOverlap(gx, gx.texturedDependencyBatchRect, gx.vramCopyRectScratch, vramYAddressExtensionWord))) {
					if (dependencyBatchFloatStart != 0u) {
						if (syncSourceBetweenTriangles) {
							syncGxGpuTexturedSourceTexture(gx, commandBuffer, commandIndex, 0u, vertexFloatCount, gx.texturedCommandRect, gx.texturedBatchRect, fixedColor);
						}
						if (samplesDestination) {
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
						vramYAddressExtensionWord,
						logicalYBaseUniform);
					dependencyBatchFloatStart = vertexFloatStart;
					resetGxGpuVramCopyRect(gx.texturedDependencyBatchRect);
				}
				includeGxGpuVramCopyRect(gx.texturedDependencyBatchRect, gx.vramCopyRectScratch);
			}
			if (dependencyBatchFloatStart != 0u) {
				if (syncSourceBetweenTriangles) {
					syncGxGpuTexturedSourceTexture(gx, commandBuffer, commandIndex, 0u, vertexFloatCount, gx.texturedCommandRect, gx.texturedBatchRect, fixedColor);
				}
				if (samplesDestination) {
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
				vramYAddressExtensionWord,
				logicalYBaseUniform);
		}
	}
	glDisable(GL_SCISSOR_TEST);
}

void renderTexturedCommand(OpenGLES2GxGpuState& gx,
	const GxGpuCommandBuffer& commandBuffer,
	u32 commandIndex,
	u32 topLeftWord,
	u32 bottomRightWord) {
	const size_t vertexFloatCount = appendTexturedCommandVertices(gx, commandBuffer, commandIndex, 0u);
	if (vertexFloatCount == 0u) {
		return;
	}
	const u32 opcode = commandBuffer.commandOpcode[commandIndex];
	const u32 vramYAddressExtensionWord = commandBuffer.commandVramYAddressExtensionWord[commandIndex];
	const bool fixedColor = commandBuffer.commandKind[commandIndex] == GX_GPU_COMMAND_DRAW_POLYGON
		&& gxGpuCommandGouraud(opcode)
		&& !gxGpuCommandRawTextureEnabled(opcode);
	setGxGpuVertexBoundsRect(
		gx.texturedCommandRect,
		gx.texturedVertices.data(),
		0u,
		vertexFloatCount,
		fixedColor ? kGxGpuFixedTexturedVertexFloats : kGxGpuTexturedVertexFloats,
		topLeftWord,
		bottomRightWord,
		vramYAddressExtensionWord);
	const u32 maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
	const bool readsVram = gxGpuCommandSemiTransparencyEnabled(opcode) || gxGpuMaskBitCheckBeforeDraw(maskBitModeWord);
	const u32 sourceOverlaps = syncGxGpuTexturedSourceTexture(gx, commandBuffer, commandIndex, 0u, vertexFloatCount, gx.texturedCommandRect, gx.texturedBatchRect, fixedColor);
	const bool sourceOverlapsDestination = (sourceOverlaps & GX_GPU_TEXTURE_SOURCE_COMMAND_OVERLAP) != 0u;
	const bool textureBarrier = readsVram && gx.textureBarrier;
	const bool samplesDestination = readsVram && !gx.framebufferFetch && !textureBarrier;
	if (samplesDestination) {
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
		topLeftWord,
		bottomRightWord,
		textureBarrier,
		samplesDestination || sourceOverlapsDestination,
		commandBuffer.commandKind[commandIndex] == GX_GPU_COMMAND_DRAW_POLYGON,
		sourceOverlapsDestination);
}

size_t flushTexturedCommands(OpenGLES2GxGpuState& gx, const GxGpuCommandBuffer& commandBuffer, size_t vertexFloatCount, u32 batchCommandIndex) {
	if (vertexFloatCount != 0u) {
		const u32 topLeftWord = commandBuffer.commandDrawingAreaTopLeftWord[batchCommandIndex];
		const u32 bottomRightWord = commandBuffer.commandDrawingAreaBottomRightWord[batchCommandIndex];
		const u32 opcode = commandBuffer.commandOpcode[batchCommandIndex];
		const u32 vramYAddressExtensionWord = commandBuffer.commandVramYAddressExtensionWord[batchCommandIndex];
		const bool fixedColor = commandBuffer.commandKind[batchCommandIndex] == GX_GPU_COMMAND_DRAW_POLYGON
			&& gxGpuCommandGouraud(opcode)
			&& !gxGpuCommandRawTextureEnabled(opcode);
		setGxGpuVertexBoundsRect(
			gx.texturedCommandRect,
			gx.texturedVertices.data(),
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
		if (samplesDestination) {
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
		glUseProgram(program.id);
		boundProgram = program.id;
	}
	publishGxGpuScanoutCircuitUniforms(gx, scanout, circuitIndex, program, fieldProgram);
	if (drawPath == GX_GPU_PCRTC_SCANOUT_DRAW_RAW_RGB) {
		glDisable(GL_BLEND);
		glColorMask(GL_TRUE, GL_TRUE, GL_TRUE, GL_FALSE);
	} else if (drawPath == GX_GPU_PCRTC_SCANOUT_DRAW_RAW_RGBA) {
		glDisable(GL_BLEND);
		glColorMask(GL_TRUE, GL_TRUE, GL_TRUE, GL_TRUE);
	} else if (drawPath == GX_GPU_PCRTC_SCANOUT_DRAW_RAW_ALPHA) {
		glDisable(GL_BLEND);
		glColorMask(GL_FALSE, GL_FALSE, GL_FALSE, GL_TRUE);
	} else if (drawPath == GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_SOURCE_RGB) {
		glEnable(GL_BLEND);
		glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
		glColorMask(GL_TRUE, GL_TRUE, GL_TRUE, GL_FALSE);
	} else if (drawPath == GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_CONSTANT_RGB) {
		glEnable(GL_BLEND);
		gx.backend->setBlendColor(0.0f, 0.0f, 0.0f, gx.scanoutBlendAlpha);
		glBlendFunc(GL_CONSTANT_ALPHA, GL_ONE_MINUS_CONSTANT_ALPHA);
		glColorMask(GL_TRUE, GL_TRUE, GL_TRUE, GL_FALSE);
	} else if (drawPath == GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_CONSTANT_RGBA) {
		glEnable(GL_BLEND);
		gx.backend->setBlendColor(0.0f, 0.0f, 0.0f, gx.scanoutBlendAlpha);
		glBlendFuncSeparate(GL_CONSTANT_ALPHA, GL_ONE_MINUS_CONSTANT_ALPHA, GL_ONE, GL_ZERO);
		glColorMask(GL_TRUE, GL_TRUE, GL_TRUE, GL_TRUE);
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
		glScissor(
			static_cast<GLint>(circuit.displayX),
			static_cast<GLint>(scanout.fieldOffset)
				+ static_cast<GLint>(scanout.fieldHeight)
				- static_cast<GLint>(circuit.fieldDisplayLineStart)
				- static_cast<GLint>(circuit.fieldDisplayLineCount),
			static_cast<GLsizei>(circuit.displayWidth),
			static_cast<GLsizei>(circuit.fieldDisplayLineCount));
	} else {
		glScissor(
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
	glDisable(GL_SCISSOR_TEST);
	glDisable(GL_DEPTH_TEST);
	glDepthMask(GL_FALSE);
	glDisable(GL_CULL_FACE);
	glDisable(GL_BLEND);
	glColorMask(GL_TRUE, GL_TRUE, GL_TRUE, GL_TRUE);
	gx.backend->setActiveTextureUnit(GLES2_TEXTURE_UNIT_GX_SCANOUT);
	gx.backend->bindTexture2D(&gx.vramTexture);
	glBindBuffer(GL_ARRAY_BUFFER, gx.scanoutVertexBuffer);
	glEnableVertexAttribArray(kGxGpuScanoutPositionAttrib);
	glVertexAttribPointer(kGxGpuScanoutPositionAttrib, 2, GL_FLOAT, GL_FALSE, kGxGpuScanoutVertexStride, nullptr);
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
	glEnable(GL_SCISSOR_TEST);
	drawGxGpuScanoutCircuit(gx, scanout, 1u, scanout.circuit2OutputPath, false, boundProgram);
	drawGxGpuScanoutCircuit(gx, scanout, 0u, scanout.circuit1OutputPath, false, boundProgram);
	glDisable(GL_SCISSOR_TEST);
	glDisable(GL_BLEND);
	glColorMask(GL_TRUE, GL_TRUE, GL_TRUE, GL_TRUE);
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
	glViewport(0, fieldOffset, width, fieldHeight);
	prepareGxGpuScanoutDraw(gx);
	if (invalid || scanout.backgroundRequired != 0u) {
		glClearColor(gx.scanoutBackgroundRed, gx.scanoutBackgroundGreen, gx.scanoutBackgroundBlue, 0.0f);
	}
	if (invalid) {
		glClear(GL_COLOR_BUFFER_BIT);
	}
	glEnable(GL_SCISSOR_TEST);
	if (scanout.backgroundRequired != 0u && !invalid) {
		glScissor(0, fieldOffset, width, fieldHeight);
		glClear(GL_COLOR_BUFFER_BIT);
	}
	drawGxGpuScanoutCircuit(gx, scanout, 1u, scanout.circuit2OutputPath, true, boundProgram);
	drawGxGpuScanoutCircuit(gx, scanout, 0u, scanout.circuit1OutputPath, true, boundProgram);
	gx.scanoutFieldsValid = true;
	gx.scanoutFieldsVramReplacementSerial = vramReplacementSerial;

	gx.backend->setRenderTarget(frameFbo, width, height);
	glDisable(GL_SCISSOR_TEST);
	glDisable(GL_BLEND);
	glColorMask(GL_TRUE, GL_TRUE, GL_TRUE, GL_TRUE);
	glUseProgram(gx.scanoutWeaveProgram);
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
	const GxGpuDeviceOutput& output
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

void executeGxGpuVramCommands(OpenGLES2GxGpuState& gx, const GxGpuCommandBuffer& commandBuffer, GxGpuReadbackPort& readback, std::span<const u8> snapshotBytes, u64 snapshotSerial, size_t commandLimit) {
	if (!gx.vramSnapshotValid || gx.vramSnapshotSerial != snapshotSerial) {
		uploadGxGpuVramSnapshot(gx, snapshotBytes);
		gx.processedCommandCount = 0u;
		gx.processedCommandSerial = commandBuffer.serial;
		gx.vramSnapshotSerial = snapshotSerial;
		gx.vramSnapshotValid = true;
	} else if (gx.processedCommandSerial != commandBuffer.serial) {
		gx.processedCommandCount = 0u;
		gx.processedCommandSerial = commandBuffer.serial;
	}
	executeNewGxGpuCommands(gx, commandBuffer, commandLimit);
	completeGxGpuReadback(gx, commandLimit, readback);
}

void renderGxGpu(OpenGLES2GxGpuState& gx,
	GLuint frameFbo,
	const GxGpuPipelineState& state,
	const GxGpuDeviceOutput& output
) {
	executeGxGpuVramCommands(gx,
		output.commandBuffer,
		output.readbackPort,
		output.vramSnapshotBytes,
		output.vramSnapshotSerial,
		output.commandBuffer.presentCommandCount);
	scanoutGxGpuVram(gx, frameFbo, state, output);
}

} // namespace

void executeGxGpuPass(
	GPUBackend* backend,
	VideoPresenter*,
	void* fbo,
	RenderPassStateStorage& stateStorage,
	void*,
	const GxGpuDeviceOutput& output
) {
	auto& gles = *static_cast<OpenGLES2Backend*>(backend);
	OpenGLES2GxGpuState& gx = *gles.m_gx_gpu;
	renderGxGpu(gx, gles.framebufferName(fbo), stateStorage.gxGpu, output);
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
	setRenderTarget(gx.vramFramebuffer, kGxGpuVramXAddressPeriod, gx.vramTextureRows);
	glReadPixels(0, 0, kGxGpuVramXAddressPeriod, gx.vramTextureRows, GL_RGBA, GL_UNSIGNED_BYTE, gx.rawVramReadback.data());
	writeGxGpuVramSnapshotFromReadback(gx);
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
