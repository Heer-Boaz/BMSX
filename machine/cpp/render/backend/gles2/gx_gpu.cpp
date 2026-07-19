#include "render/backend/gles2/gx_gpu.h"

#include "machine/devices/gx/gpu.h"
#include "machine/devices/gx/gpu_command_buffer.h"
#include "machine/devices/gx/gpu_pcrtc.h"
#include "render/backend/gx_gpu_render_rules.h"
#include "render/backend/gles2/backend.h"
#include "render/backend/texture_params.h"
#include "render/backend/gles2/shaders/gx_gpu_shaders.h"
#include "render/backend/pass/library.h"

#include <array>
#include <chrono>
#include <cstdint>

namespace bmsx {
namespace {

constexpr i32 kGxGpuVramWidth = static_cast<i32>(GX_GPU_VRAM_WIDTH);
constexpr i32 kGxGpuVramHeight = static_cast<i32>(GX_GPU_VRAM_HEIGHT);
constexpr i32 kGxGpuScanoutTextureUnit = 0;
constexpr i32 kGxGpuTextureSampleUnit = 1;
constexpr i32 kGxGpuTextureTransferUnit = 2;
constexpr i32 kGxGpuScanoutFieldsTextureUnit = 3;
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
constexpr size_t kGxGpuTexturedVertexFloats = 11u;
constexpr size_t kGxGpuFixedTexturedVertexFloats = 17u;
constexpr size_t kGxGpuTexturedFloatCapacity = GX_GPU_COMMAND_CAPACITY * kGxGpuPolygonVerticesPerCommand * kGxGpuFixedTexturedVertexFloats;
constexpr u32 kGxGpuTexturePageCoordSize = 256u;
constexpr u32 kGxGpuTexturePage4BitWidthWords = 64u;
constexpr u32 kGxGpuTexturePage8BitWidthWords = 128u;
constexpr u32 kGxGpuClut4BitWords = 16u;
constexpr u32 kGxGpuClut8BitWords = 256u;
constexpr size_t kGxGpuTransferVertexFloats = 4u;
constexpr size_t kGxGpuTransferVerticesPerSegment = 6u;
constexpr size_t kGxGpuTransferSegmentsPerRow = 3u;
constexpr size_t kGxGpuTransferFloatCapacity = static_cast<size_t>(GX_GPU_TRANSFER_MAX_HEIGHT) * kGxGpuTransferSegmentsPerRow * kGxGpuTransferVerticesPerSegment * kGxGpuTransferVertexFloats;
constexpr size_t kGxGpuScanoutVertexFloats = 2u;
constexpr size_t kGxGpuScanoutVertexCount = 3u;
constexpr size_t kGxGpuScanoutFloatCount = kGxGpuScanoutVertexCount * kGxGpuScanoutVertexFloats;
constexpr size_t kGxGpuRawVramBytesPerPixel = 4u;
constexpr size_t kGxGpuRawVramUploadBytes = static_cast<size_t>(kGxGpuVramWidth) * static_cast<size_t>(kGxGpuVramHeight) * kGxGpuRawVramBytesPerPixel;
constexpr size_t kGxGpuRawVramReadbackBytes = static_cast<size_t>(kGxGpuVramWidth) * static_cast<size_t>(kGxGpuVramHeight) * kGxGpuRawVramBytesPerPixel;
constexpr i32 kGxGpuReadbackPackWidth = 512;
constexpr u32 kGxGpuFullDrawingAreaTopLeftWord = 0u;
constexpr u32 kGxGpuFullDrawingAreaBottomRightWord = (static_cast<u32>(kGxGpuVramWidth) - 1u) | ((static_cast<u32>(kGxGpuVramHeight) - 1u) << 10u);
constexpr char kGxGpuFixedColorPlaneShaderDefine[] = "#define GX_GPU_FIXED_COLOR_PLANE 1\n";
constexpr char kGxGpuInterlacedFieldShaderDefine[] = "#define GX_GPU_INTERLACED_FIELD 1\n";
constexpr char kGxGpuInterlacedWeaveShaderDefine[] = "#define GX_GPU_INTERLACED_WEAVE 1\n";
constexpr char kGxGpuScanoutGx16ShaderDefine[] = "#define GX_GPU_SCANOUT_GX16 1\n";
constexpr char kGxGpuScanoutGx16DirectShaderDefine[] = "#define GX_GPU_SCANOUT_GX16 1\n#define GX_GPU_SCANOUT_GX16_DIRECT 1\n";
constexpr char kGxGpuScanoutFieldGx16ShaderDefine[] = "#define GX_GPU_INTERLACED_FIELD 1\n#define GX_GPU_SCANOUT_GX16 1\n";
constexpr char kGxGpuScanoutFieldGx16DirectShaderDefine[] = "#define GX_GPU_INTERLACED_FIELD 1\n#define GX_GPU_SCANOUT_GX16 1\n#define GX_GPU_SCANOUT_GX16_DIRECT 1\n";
constexpr size_t kGxGpuScanoutPathCount = static_cast<size_t>(GX_GPU_PCRTC_COMPOSE_GX16_DIRECT_CIRCUIT1) + 1u;
static_assert(kGxGpuScanoutPathCount == 3u);
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

std::array<f32, kGxGpuSolidFloatCapacity> g_solidVertices{};
std::array<f32, kGxGpuLineFloatCapacity> g_lineVertices{};
std::array<f32, kGxGpuTexturedFloatCapacity> g_texturedVertices{};
std::array<i64, kGxGpuTexturedUvComponents * GX_GPU_TRIANGLE_ATTRIBUTE_PLANE_PHASES> g_texturedUvPlane{};
std::array<i64, kGxGpuColorComponents * GX_GPU_TRIANGLE_ATTRIBUTE_PLANE_PHASES> g_colorPlane{};
std::array<f32, kGxGpuTransferFloatCapacity> g_transferVertices{};
std::array<u8, kGxGpuRawVramUploadBytes> g_rawVramUpload{};
std::array<u8, kGxGpuRawVramReadbackBytes> g_rawVramReadback{};
std::array<u8, GX_GPU_VRAM_BYTE_COUNT> g_vramSnapshotScratch{};
constexpr std::array<f32, kGxGpuScanoutFloatCount> g_scanoutVertices{
	-1.0f, -1.0f,
	3.0f, -1.0f,
	-1.0f, 3.0f,
};
std::array<GLint, 44u> g_scanoutPcrtcUniforms{};

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

GxGpuVramCopyRect g_vramCopyRectScratch{};
GxGpuVramCopyRect g_solidBatchRect{};
GxGpuVramCopyRect g_solidCommandRect{};
GxGpuVramCopyRect g_lineBatchRect{};
GxGpuVramCopyRect g_texturedBatchRect{};
GxGpuVramCopyRect g_texturedCommandRect{};
GxGpuVramCopyRect g_sampleDirtyRect{};
GxGpuRectangle g_rectangleScratch{};
GxGpuPreparedRasterPrimitive g_linePreparedScratch{};
GxGpuLineBatchState g_lineBatchState{};
GxGpuPrimitiveSubmission g_primitiveSubmission{};
std::array<GxGpuPreparedBlendCommand, kGxGpuLineSegmentCapacity> g_blendPlanCommands{};
std::array<u16, kGxGpuLineSegmentCapacity + 1u> g_blendPlanLayerFirst{};
std::array<u16, kGxGpuLineSegmentCapacity + 1u> g_blendPlanLayerLast{};
GxGpuVramCopyRect g_blendPlanLineBounds{};
GxGpuVramCopyRect g_blendPlanSolidBounds{};

struct GxGpuRuntime {
	OpenGLES2Backend* backend = nullptr;
	u32 generation = 0u;
	GLuint solidProgram = 0;
	GLuint fixedSolidProgram = 0;
	GLuint lineProgram = 0;
	GLuint texturedProgram = 0;
	GLuint fixedTexturedProgram = 0;
	GLuint transferProgram = 0;
	std::array<GLuint, kGxGpuScanoutPathCount> scanoutPrograms{};
	std::array<GLuint, kGxGpuScanoutPathCount> scanoutFieldPrograms{};
	GLuint scanoutWeaveProgram = 0;
	GLuint readbackProgram = 0;
	GLES2Texture vramTexture{};
	GLES2Texture vramSampleTexture{};
	GLES2Texture vramTransferTexture{};
	GLES2Texture readbackTexture{};
	GLES2Texture scanoutFieldsTexture{};
	GLuint vramFramebuffer = 0;
	GLuint readbackFramebuffer = 0;
	GLuint scanoutFieldsFramebuffer = 0;
	GxGpuVertexStream vertexStream{};
	GLuint scanoutVertexBuffer = 0;
	GLint solidPositionAttrib = -1;
	GLint solidColorAttrib = -1;
	GLint solidVramUniform = -1;
	GLint solidBlendEnableUniform = -1;
	GLint solidBlendModeUniform = -1;
	GLint solidCheckMaskBitUniform = -1;
	GLint solidSetMaskBitUniform = -1;
	GLint solidDitherEnableUniform = -1;
	GLint solidSkippedLineParityUniform = -1;
	GLint solidRasterPhaseUniform = -1;
	GLint fixedSolidPositionAttrib = -1;
	GLint fixedSolidColorPlaneBaseAttrib = -1;
	GLint fixedSolidColorPlaneStepXAttrib = -1;
	GLint fixedSolidColorPlaneStepYAttrib = -1;
	GLint fixedSolidVramUniform = -1;
	GLint fixedSolidBlendEnableUniform = -1;
	GLint fixedSolidBlendModeUniform = -1;
	GLint fixedSolidCheckMaskBitUniform = -1;
	GLint fixedSolidSetMaskBitUniform = -1;
	GLint fixedSolidDitherEnableUniform = -1;
	GLint fixedSolidSkippedLineParityUniform = -1;
	GLint fixedSolidRasterPhaseUniform = -1;
	GLint linePositionAttrib = -1;
	GLint lineStartAttrib = -1;
	GLint lineEndAttrib = -1;
	GLint lineColor0Attrib = -1;
	GLint lineColor1Attrib = -1;
	GLint lineVramUniform = -1;
	GLint lineBlendEnableUniform = -1;
	GLint lineBlendModeUniform = -1;
	GLint lineCheckMaskBitUniform = -1;
	GLint lineSetMaskBitUniform = -1;
	GLint lineDitherEnableUniform = -1;
	GLint lineSkippedLineParityUniform = -1;
	GLint texturedPositionAttrib = -1;
	GLint texturedColorAttrib = -1;
	GLint texturedUvPlaneBaseAttrib = -1;
	GLint texturedUvPlaneStepXAttrib = -1;
	GLint texturedUvPlaneStepYAttrib = -1;
	GLint texturedVramUniform = -1;
	GLint texturedTexPageBaseUniform = -1;
	GLint texturedClutBaseUniform = -1;
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
	GLint fixedTexturedPositionAttrib = -1;
	GLint fixedTexturedUvPlaneBaseAttrib = -1;
	GLint fixedTexturedUvPlaneStepXAttrib = -1;
	GLint fixedTexturedUvPlaneStepYAttrib = -1;
	GLint fixedTexturedColorPlaneBaseAttrib = -1;
	GLint fixedTexturedColorPlaneStepXAttrib = -1;
	GLint fixedTexturedColorPlaneStepYAttrib = -1;
	GLint fixedTexturedVramUniform = -1;
	GLint fixedTexturedTexPageBaseUniform = -1;
	GLint fixedTexturedClutBaseUniform = -1;
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
	GLint transferPositionAttrib = -1;
	GLint transferSourceOffsetAttrib = -1;
	GLint transferSourceUniform = -1;
	GLint transferVramUniform = -1;
	GLint transferCheckMaskBitUniform = -1;
	GLint transferSetMaskBitUniform = -1;
	std::array<GLint, kGxGpuScanoutPathCount> scanoutPositionAttribs{};
	std::array<GLint, kGxGpuScanoutPathCount> scanoutVramUniforms{};
	std::array<GLint, kGxGpuScanoutPathCount> scanoutPcrtcUniforms{};
	std::array<GLint, kGxGpuScanoutPathCount> scanoutFieldPositionAttribs{};
	std::array<GLint, kGxGpuScanoutPathCount> scanoutFieldVramUniforms{};
	std::array<GLint, kGxGpuScanoutPathCount> scanoutFieldPcrtcUniforms{};
	std::array<GLint, kGxGpuScanoutPathCount> scanoutFieldInterlaceUniforms{};
	GLint scanoutWeavePositionAttrib = -1;
	GLint scanoutWeaveVramUniform = -1;
	GLint scanoutWeaveInterlaceUniform = -1;
	GLint readbackPositionAttrib = -1;
	GLint readbackVramUniform = -1;
	GLint readbackParamsUniform = -1;
	GLint readbackVramYAddressExtensionUniform = -1;
	u32 scanoutPcrtcRevision = 0u;
	u32 scanoutFieldPcrtcRevision = 0u;
	u32 scanoutFieldValue = 0u;
	bool scanoutPcrtcUniformValid = false;
	bool scanoutFieldPcrtcUniformValid = false;
	bool scanoutFieldsValid = false;
	u64 scanoutFieldsVramReplacementSerial = 0u;
	u32 processedCommandCount = 0;
	u32 processedCommandSerial = 0;
	u64 vramSnapshotSerial = 0u;
	bool vramSnapshotValid = false;
	bool textureBarrier = false;
};

GxGpuRuntime g_gxGpu;

void initializeGxGpuTexture(GLES2Texture& texture, i32 textureUnit, i32 width, i32 height) {
	glGenTextures(1, &texture.id);
	texture.generation = g_gxGpu.generation;
	texture.width = width;
	texture.height = height;
	g_gxGpu.backend->setActiveTextureUnit(textureUnit);
	g_gxGpu.backend->bindTexture2D(&texture);
	glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, width, height, 0, GL_RGBA, GL_UNSIGNED_BYTE, nullptr);
	applyGLES2TextureParams(RGBA8_LINEAR_TEXTURE_PARAMS);
}

void initGxGpu(OpenGLES2Backend& backend) {
	g_gxGpu.backend = &backend;
	g_gxGpu.generation = backend.contextGeneration();
	g_primitiveSubmission.batchCount = 0u;
	g_primitiveSubmission.solidFloatCount = 0u;
	g_primitiveSubmission.solidBatchStart = 0u;
	g_primitiveSubmission.lineFloatCount = 0u;
	g_primitiveSubmission.lineBatchStart = 0u;
	g_gxGpu.processedCommandCount = 0u;
	g_gxGpu.processedCommandSerial = 0u;
	g_gxGpu.vramSnapshotSerial = 0u;
	g_gxGpu.vramSnapshotValid = false;
	g_gxGpu.textureBarrier = backend.textureBarrierAvailable();
	g_gxGpu.solidProgram = g_gxGpu.backend->buildProgram(kGxGpuFillVertexShader, kGxGpuFillFragmentShader, "gx_gpu_fill");
	g_gxGpu.fixedSolidProgram = g_gxGpu.backend->buildProgram(kGxGpuFillVertexShader, kGxGpuFillFragmentShader, "gx_gpu_fixed_fill", kGxGpuFixedColorPlaneShaderDefine);
	g_gxGpu.lineProgram = g_gxGpu.backend->buildProgram(kGxGpuLineVertexShader, kGxGpuLineFragmentShader, "gx_gpu_line");
	g_gxGpu.texturedProgram = g_gxGpu.backend->buildProgram(kGxGpuTexturedVertexShader, kGxGpuTexturedFragmentShader, "gx_gpu_textured");
	g_gxGpu.fixedTexturedProgram = g_gxGpu.backend->buildProgram(kGxGpuTexturedVertexShader, kGxGpuTexturedFragmentShader, "gx_gpu_fixed_textured", kGxGpuFixedColorPlaneShaderDefine);
	g_gxGpu.transferProgram = g_gxGpu.backend->buildProgram(kGxGpuTransferVertexShader, kGxGpuTransferFragmentShader, "gx_gpu_transfer");
	g_gxGpu.scanoutPrograms = {
		g_gxGpu.backend->buildProgram(kGxGpuScanoutVertexShader, kGxGpuScanoutFragmentShader, "gx_gpu_scanout"),
		g_gxGpu.backend->buildProgram(kGxGpuScanoutVertexShader, kGxGpuScanoutFragmentShader, "gx_gpu_scanout_gx16", kGxGpuScanoutGx16ShaderDefine),
		g_gxGpu.backend->buildProgram(kGxGpuScanoutVertexShader, kGxGpuScanoutFragmentShader, "gx_gpu_scanout_gx16_direct", kGxGpuScanoutGx16DirectShaderDefine),
	};
	g_gxGpu.scanoutFieldPrograms = {
		g_gxGpu.backend->buildProgram(kGxGpuScanoutVertexShader, kGxGpuScanoutFragmentShader, "gx_gpu_scanout_field", kGxGpuInterlacedFieldShaderDefine),
		g_gxGpu.backend->buildProgram(kGxGpuScanoutVertexShader, kGxGpuScanoutFragmentShader, "gx_gpu_scanout_field_gx16", kGxGpuScanoutFieldGx16ShaderDefine),
		g_gxGpu.backend->buildProgram(kGxGpuScanoutVertexShader, kGxGpuScanoutFragmentShader, "gx_gpu_scanout_field_gx16_direct", kGxGpuScanoutFieldGx16DirectShaderDefine),
	};
	g_gxGpu.scanoutWeaveProgram = g_gxGpu.backend->buildProgram(kGxGpuScanoutVertexShader, kGxGpuScanoutFragmentShader, "gx_gpu_scanout_weave", kGxGpuInterlacedWeaveShaderDefine);
	g_gxGpu.readbackProgram = g_gxGpu.backend->buildProgram(kGxGpuScanoutVertexShader, kGxGpuReadbackFragmentShader, "gx_gpu_readback");

	initializeGxGpuTexture(g_gxGpu.vramTexture, kGxGpuScanoutTextureUnit, kGxGpuVramWidth, kGxGpuVramHeight);
	initializeGxGpuTexture(g_gxGpu.vramSampleTexture, kGxGpuTextureSampleUnit, kGxGpuVramWidth, kGxGpuVramHeight);
	initializeGxGpuTexture(g_gxGpu.vramTransferTexture, kGxGpuTextureTransferUnit, kGxGpuVramWidth, kGxGpuVramHeight);
	initializeGxGpuTexture(g_gxGpu.readbackTexture, kGxGpuScanoutTextureUnit, kGxGpuReadbackPackWidth, static_cast<i32>(GX_GPU_TRANSFER_MAX_HEIGHT));

	glGenFramebuffers(1, &g_gxGpu.vramFramebuffer);
	glBindFramebuffer(GL_FRAMEBUFFER, g_gxGpu.vramFramebuffer);
	glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, g_gxGpu.vramTexture.id, 0);
	glViewport(0, 0, kGxGpuVramWidth, kGxGpuVramHeight);
	glClearColor(0.0f, 0.0f, 0.0f, 1.0f);
	glClear(GL_COLOR_BUFFER_BIT);
	g_sampleDirtyRect = {0, 0, kGxGpuVramWidth, kGxGpuVramHeight};
	glGenFramebuffers(1, &g_gxGpu.readbackFramebuffer);
	glBindFramebuffer(GL_FRAMEBUFFER, g_gxGpu.readbackFramebuffer);
	glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, g_gxGpu.readbackTexture.id, 0);
	g_gxGpu.scanoutFieldsTexture.width = 0;
	g_gxGpu.scanoutFieldsTexture.height = 0;
	glGenTextures(1, &g_gxGpu.scanoutFieldsTexture.id);
	g_gxGpu.scanoutFieldsTexture.generation = g_gxGpu.generation;
	g_gxGpu.backend->setActiveTextureUnit(kGxGpuScanoutFieldsTextureUnit);
	g_gxGpu.backend->bindTexture2D(&g_gxGpu.scanoutFieldsTexture);
	applyGLES2TextureParams(RGBA8_LINEAR_TEXTURE_PARAMS);
	glGenFramebuffers(1, &g_gxGpu.scanoutFieldsFramebuffer);
	glBindFramebuffer(GL_FRAMEBUFFER, g_gxGpu.scanoutFieldsFramebuffer);
	glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, g_gxGpu.scanoutFieldsTexture.id, 0);

	g_gxGpu.vertexStream.initialize(kGxGpuVertexStreamBufferBytes);

	glGenBuffers(1, &g_gxGpu.scanoutVertexBuffer);
	glBindBuffer(GL_ARRAY_BUFFER, g_gxGpu.scanoutVertexBuffer);
	glBufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(g_scanoutVertices.size() * sizeof(f32)), g_scanoutVertices.data(), GL_STATIC_DRAW);

	g_gxGpu.solidPositionAttrib = glGetAttribLocation(g_gxGpu.solidProgram, "a_position");
	g_gxGpu.solidColorAttrib = glGetAttribLocation(g_gxGpu.solidProgram, "a_color");
	g_gxGpu.solidVramUniform = glGetUniformLocation(g_gxGpu.solidProgram, "u_vram");
	g_gxGpu.solidBlendEnableUniform = glGetUniformLocation(g_gxGpu.solidProgram, "u_blendEnable");
	g_gxGpu.solidBlendModeUniform = glGetUniformLocation(g_gxGpu.solidProgram, "u_blendMode");
	g_gxGpu.solidCheckMaskBitUniform = glGetUniformLocation(g_gxGpu.solidProgram, "u_checkMaskBit");
	g_gxGpu.solidSetMaskBitUniform = glGetUniformLocation(g_gxGpu.solidProgram, "u_setMaskBit");
	g_gxGpu.solidDitherEnableUniform = glGetUniformLocation(g_gxGpu.solidProgram, "u_ditherEnable");
	g_gxGpu.solidSkippedLineParityUniform = glGetUniformLocation(g_gxGpu.solidProgram, "u_skippedLineParity");
	g_gxGpu.solidRasterPhaseUniform = glGetUniformLocation(g_gxGpu.solidProgram, "u_rasterPhase");
	g_gxGpu.fixedSolidPositionAttrib = glGetAttribLocation(g_gxGpu.fixedSolidProgram, "a_position");
	g_gxGpu.fixedSolidColorPlaneBaseAttrib = glGetAttribLocation(g_gxGpu.fixedSolidProgram, "a_colorPlaneBase");
	g_gxGpu.fixedSolidColorPlaneStepXAttrib = glGetAttribLocation(g_gxGpu.fixedSolidProgram, "a_colorPlaneStepX");
	g_gxGpu.fixedSolidColorPlaneStepYAttrib = glGetAttribLocation(g_gxGpu.fixedSolidProgram, "a_colorPlaneStepY");
	g_gxGpu.fixedSolidVramUniform = glGetUniformLocation(g_gxGpu.fixedSolidProgram, "u_vram");
	g_gxGpu.fixedSolidBlendEnableUniform = glGetUniformLocation(g_gxGpu.fixedSolidProgram, "u_blendEnable");
	g_gxGpu.fixedSolidBlendModeUniform = glGetUniformLocation(g_gxGpu.fixedSolidProgram, "u_blendMode");
	g_gxGpu.fixedSolidCheckMaskBitUniform = glGetUniformLocation(g_gxGpu.fixedSolidProgram, "u_checkMaskBit");
	g_gxGpu.fixedSolidSetMaskBitUniform = glGetUniformLocation(g_gxGpu.fixedSolidProgram, "u_setMaskBit");
	g_gxGpu.fixedSolidDitherEnableUniform = glGetUniformLocation(g_gxGpu.fixedSolidProgram, "u_ditherEnable");
	g_gxGpu.fixedSolidSkippedLineParityUniform = glGetUniformLocation(g_gxGpu.fixedSolidProgram, "u_skippedLineParity");
	g_gxGpu.fixedSolidRasterPhaseUniform = glGetUniformLocation(g_gxGpu.fixedSolidProgram, "u_rasterPhase");
	g_gxGpu.linePositionAttrib = glGetAttribLocation(g_gxGpu.lineProgram, "a_position");
	g_gxGpu.lineStartAttrib = glGetAttribLocation(g_gxGpu.lineProgram, "a_lineStart");
	g_gxGpu.lineEndAttrib = glGetAttribLocation(g_gxGpu.lineProgram, "a_lineEnd");
	g_gxGpu.lineColor0Attrib = glGetAttribLocation(g_gxGpu.lineProgram, "a_color0");
	g_gxGpu.lineColor1Attrib = glGetAttribLocation(g_gxGpu.lineProgram, "a_color1");
	g_gxGpu.lineVramUniform = glGetUniformLocation(g_gxGpu.lineProgram, "u_vram");
	g_gxGpu.lineBlendEnableUniform = glGetUniformLocation(g_gxGpu.lineProgram, "u_blendEnable");
	g_gxGpu.lineBlendModeUniform = glGetUniformLocation(g_gxGpu.lineProgram, "u_blendMode");
	g_gxGpu.lineCheckMaskBitUniform = glGetUniformLocation(g_gxGpu.lineProgram, "u_checkMaskBit");
	g_gxGpu.lineSetMaskBitUniform = glGetUniformLocation(g_gxGpu.lineProgram, "u_setMaskBit");
	g_gxGpu.lineDitherEnableUniform = glGetUniformLocation(g_gxGpu.lineProgram, "u_ditherEnable");
	g_gxGpu.lineSkippedLineParityUniform = glGetUniformLocation(g_gxGpu.lineProgram, "u_skippedLineParity");
	g_gxGpu.texturedPositionAttrib = glGetAttribLocation(g_gxGpu.texturedProgram, "a_position");
	g_gxGpu.texturedColorAttrib = glGetAttribLocation(g_gxGpu.texturedProgram, "a_color");
	g_gxGpu.texturedUvPlaneBaseAttrib = glGetAttribLocation(g_gxGpu.texturedProgram, "a_uvPlaneBase");
	g_gxGpu.texturedUvPlaneStepXAttrib = glGetAttribLocation(g_gxGpu.texturedProgram, "a_uvPlaneStepX");
	g_gxGpu.texturedUvPlaneStepYAttrib = glGetAttribLocation(g_gxGpu.texturedProgram, "a_uvPlaneStepY");
	g_gxGpu.texturedVramUniform = glGetUniformLocation(g_gxGpu.texturedProgram, "u_vram");
	g_gxGpu.texturedTexPageBaseUniform = glGetUniformLocation(g_gxGpu.texturedProgram, "u_texPageBase");
	g_gxGpu.texturedClutBaseUniform = glGetUniformLocation(g_gxGpu.texturedProgram, "u_clutBase");
	g_gxGpu.texturedTextureWindowAndUniform = glGetUniformLocation(g_gxGpu.texturedProgram, "u_textureWindowAnd");
	g_gxGpu.texturedTextureWindowOrUniform = glGetUniformLocation(g_gxGpu.texturedProgram, "u_textureWindowOr");
	g_gxGpu.texturedTextureModeUniform = glGetUniformLocation(g_gxGpu.texturedProgram, "u_textureMode");
	g_gxGpu.texturedRawTextureUniform = glGetUniformLocation(g_gxGpu.texturedProgram, "u_rawTexture");
	g_gxGpu.texturedBlendEnableUniform = glGetUniformLocation(g_gxGpu.texturedProgram, "u_blendEnable");
	g_gxGpu.texturedBlendModeUniform = glGetUniformLocation(g_gxGpu.texturedProgram, "u_blendMode");
	g_gxGpu.texturedCheckMaskBitUniform = glGetUniformLocation(g_gxGpu.texturedProgram, "u_checkMaskBit");
	g_gxGpu.texturedSetMaskBitUniform = glGetUniformLocation(g_gxGpu.texturedProgram, "u_setMaskBit");
	g_gxGpu.texturedDitherEnableUniform = glGetUniformLocation(g_gxGpu.texturedProgram, "u_ditherEnable");
	g_gxGpu.texturedSkippedLineParityUniform = glGetUniformLocation(g_gxGpu.texturedProgram, "u_skippedLineParity");
	g_gxGpu.texturedRasterPhaseUniform = glGetUniformLocation(g_gxGpu.texturedProgram, "u_rasterPhase");
	g_gxGpu.fixedTexturedPositionAttrib = glGetAttribLocation(g_gxGpu.fixedTexturedProgram, "a_position");
	g_gxGpu.fixedTexturedUvPlaneBaseAttrib = glGetAttribLocation(g_gxGpu.fixedTexturedProgram, "a_uvPlaneBase");
	g_gxGpu.fixedTexturedUvPlaneStepXAttrib = glGetAttribLocation(g_gxGpu.fixedTexturedProgram, "a_uvPlaneStepX");
	g_gxGpu.fixedTexturedUvPlaneStepYAttrib = glGetAttribLocation(g_gxGpu.fixedTexturedProgram, "a_uvPlaneStepY");
	g_gxGpu.fixedTexturedColorPlaneBaseAttrib = glGetAttribLocation(g_gxGpu.fixedTexturedProgram, "a_colorPlaneBase");
	g_gxGpu.fixedTexturedColorPlaneStepXAttrib = glGetAttribLocation(g_gxGpu.fixedTexturedProgram, "a_colorPlaneStepX");
	g_gxGpu.fixedTexturedColorPlaneStepYAttrib = glGetAttribLocation(g_gxGpu.fixedTexturedProgram, "a_colorPlaneStepY");
	g_gxGpu.fixedTexturedVramUniform = glGetUniformLocation(g_gxGpu.fixedTexturedProgram, "u_vram");
	g_gxGpu.fixedTexturedTexPageBaseUniform = glGetUniformLocation(g_gxGpu.fixedTexturedProgram, "u_texPageBase");
	g_gxGpu.fixedTexturedClutBaseUniform = glGetUniformLocation(g_gxGpu.fixedTexturedProgram, "u_clutBase");
	g_gxGpu.fixedTexturedTextureWindowAndUniform = glGetUniformLocation(g_gxGpu.fixedTexturedProgram, "u_textureWindowAnd");
	g_gxGpu.fixedTexturedTextureWindowOrUniform = glGetUniformLocation(g_gxGpu.fixedTexturedProgram, "u_textureWindowOr");
	g_gxGpu.fixedTexturedTextureModeUniform = glGetUniformLocation(g_gxGpu.fixedTexturedProgram, "u_textureMode");
	g_gxGpu.fixedTexturedRawTextureUniform = glGetUniformLocation(g_gxGpu.fixedTexturedProgram, "u_rawTexture");
	g_gxGpu.fixedTexturedBlendEnableUniform = glGetUniformLocation(g_gxGpu.fixedTexturedProgram, "u_blendEnable");
	g_gxGpu.fixedTexturedBlendModeUniform = glGetUniformLocation(g_gxGpu.fixedTexturedProgram, "u_blendMode");
	g_gxGpu.fixedTexturedCheckMaskBitUniform = glGetUniformLocation(g_gxGpu.fixedTexturedProgram, "u_checkMaskBit");
	g_gxGpu.fixedTexturedSetMaskBitUniform = glGetUniformLocation(g_gxGpu.fixedTexturedProgram, "u_setMaskBit");
	g_gxGpu.fixedTexturedDitherEnableUniform = glGetUniformLocation(g_gxGpu.fixedTexturedProgram, "u_ditherEnable");
	g_gxGpu.fixedTexturedSkippedLineParityUniform = glGetUniformLocation(g_gxGpu.fixedTexturedProgram, "u_skippedLineParity");
	g_gxGpu.fixedTexturedRasterPhaseUniform = glGetUniformLocation(g_gxGpu.fixedTexturedProgram, "u_rasterPhase");
	g_gxGpu.transferPositionAttrib = glGetAttribLocation(g_gxGpu.transferProgram, "a_position");
	g_gxGpu.transferSourceOffsetAttrib = glGetAttribLocation(g_gxGpu.transferProgram, "a_sourceOffset");
	g_gxGpu.transferSourceUniform = glGetUniformLocation(g_gxGpu.transferProgram, "u_source");
	g_gxGpu.transferVramUniform = glGetUniformLocation(g_gxGpu.transferProgram, "u_vram");
	g_gxGpu.transferCheckMaskBitUniform = glGetUniformLocation(g_gxGpu.transferProgram, "u_checkMaskBit");
	g_gxGpu.transferSetMaskBitUniform = glGetUniformLocation(g_gxGpu.transferProgram, "u_setMaskBit");
	for (size_t path = 0u; path < kGxGpuScanoutPathCount; path += 1u) {
		g_gxGpu.scanoutPositionAttribs[path] = glGetAttribLocation(g_gxGpu.scanoutPrograms[path], "a_position");
		g_gxGpu.scanoutVramUniforms[path] = glGetUniformLocation(g_gxGpu.scanoutPrograms[path], "u_vram");
		g_gxGpu.scanoutPcrtcUniforms[path] = glGetUniformLocation(g_gxGpu.scanoutPrograms[path], "u_pcrtc[0]");
		g_gxGpu.scanoutFieldPositionAttribs[path] = glGetAttribLocation(g_gxGpu.scanoutFieldPrograms[path], "a_position");
		g_gxGpu.scanoutFieldVramUniforms[path] = glGetUniformLocation(g_gxGpu.scanoutFieldPrograms[path], "u_vram");
		g_gxGpu.scanoutFieldPcrtcUniforms[path] = glGetUniformLocation(g_gxGpu.scanoutFieldPrograms[path], "u_pcrtc[0]");
		g_gxGpu.scanoutFieldInterlaceUniforms[path] = glGetUniformLocation(g_gxGpu.scanoutFieldPrograms[path], "u_interlace");
	}
	g_gxGpu.scanoutWeavePositionAttrib = glGetAttribLocation(g_gxGpu.scanoutWeaveProgram, "a_position");
	g_gxGpu.scanoutWeaveVramUniform = glGetUniformLocation(g_gxGpu.scanoutWeaveProgram, "u_vram");
	g_gxGpu.scanoutWeaveInterlaceUniform = glGetUniformLocation(g_gxGpu.scanoutWeaveProgram, "u_interlace");
	g_gxGpu.readbackPositionAttrib = glGetAttribLocation(g_gxGpu.readbackProgram, "a_position");
	g_gxGpu.readbackVramUniform = glGetUniformLocation(g_gxGpu.readbackProgram, "u_vram");
	g_gxGpu.readbackParamsUniform = glGetUniformLocation(g_gxGpu.readbackProgram, "u_readback");
	g_gxGpu.readbackVramYAddressExtensionUniform = glGetUniformLocation(g_gxGpu.readbackProgram, "u_vramYAddressExtensionWord");
	g_gxGpu.scanoutPcrtcUniformValid = false;
	g_gxGpu.scanoutFieldPcrtcUniformValid = false;
	g_gxGpu.scanoutFieldsValid = false;
	glBindFramebuffer(GL_FRAMEBUFFER, 0);
}

void shutdownGxGpu(OpenGLES2Backend& backend) {
	if (g_gxGpu.generation == backend.contextGeneration()) {
		const std::array<GLuint, 5> textures{
			g_gxGpu.vramTexture.id,
			g_gxGpu.vramSampleTexture.id,
			g_gxGpu.vramTransferTexture.id,
			g_gxGpu.readbackTexture.id,
			g_gxGpu.scanoutFieldsTexture.id,
		};
		glDeleteTextures(static_cast<GLsizei>(textures.size()), textures.data());

		const std::array<GLuint, 3> framebuffers{
			g_gxGpu.vramFramebuffer,
			g_gxGpu.readbackFramebuffer,
			g_gxGpu.scanoutFieldsFramebuffer,
		};
		glDeleteFramebuffers(static_cast<GLsizei>(framebuffers.size()), framebuffers.data());

		const std::array<GLuint, 2> buffers{
			g_gxGpu.vertexStream.buffer,
			g_gxGpu.scanoutVertexBuffer,
		};
		glDeleteBuffers(static_cast<GLsizei>(buffers.size()), buffers.data());

		const std::array<GLuint, 8> programs{
			g_gxGpu.solidProgram,
			g_gxGpu.fixedSolidProgram,
			g_gxGpu.lineProgram,
			g_gxGpu.texturedProgram,
			g_gxGpu.fixedTexturedProgram,
			g_gxGpu.transferProgram,
			g_gxGpu.scanoutWeaveProgram,
			g_gxGpu.readbackProgram,
		};
		for (GLuint program : programs) {
			glDeleteProgram(program);
		}
		for (size_t path = 0u; path < kGxGpuScanoutPathCount; path += 1u) {
			glDeleteProgram(g_gxGpu.scanoutPrograms[path]);
			glDeleteProgram(g_gxGpu.scanoutFieldPrograms[path]);
		}
	}

	g_gxGpu = GxGpuRuntime{};
	g_primitiveSubmission = GxGpuPrimitiveSubmission{};
	g_lineBatchState = GxGpuLineBatchState{};
	g_sampleDirtyRect = GxGpuVramCopyRect{};
	backend.invalidateTextureBindingCache();
}

size_t writeSolidVertex(size_t offset, f32 x, f32 y, f32 r, f32 g, f32 b) {
	g_solidVertices[offset] = x;
	g_solidVertices[offset + 1u] = y;
	g_solidVertices[offset + 2u] = r;
	g_solidVertices[offset + 3u] = g;
	g_solidVertices[offset + 4u] = b;
	g_solidVertices[offset + 5u] = 1.0f;
	return offset + kGxGpuSolidVertexFloats;
}

size_t writeSolidColorVertex(size_t offset, f32 x, f32 y, u32 colorWord) {
	return writeSolidVertex(
		offset,
		x,
		y,
		static_cast<f32>(colorWord & 0xffu) / 255.0f,
		static_cast<f32>((colorWord >> 8u) & 0xffu) / 255.0f,
		static_cast<f32>((colorWord >> 16u) & 0xffu) / 255.0f);
}

size_t appendSolidTriangle(
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
	offset = writeSolidColorVertex(offset, x0, y0, color0);
	offset = writeSolidColorVertex(offset, x1, y1, color1);
	offset = writeSolidColorVertex(offset, x2, y2, color2);
	return offset;
}

size_t writeFixedSolidVertex(size_t offset, i32 x, i32 y) {
	g_solidVertices[offset] = static_cast<f32>(x);
	g_solidVertices[offset + 1u] = static_cast<f32>(y);
	for (size_t component = 0u; component < kGxGpuColorComponents; component += 1u) {
		g_solidVertices[offset + 2u + component] = static_cast<f32>(g_colorPlane[component]);
		g_solidVertices[offset + 5u + component] = static_cast<f32>(g_colorPlane[kGxGpuColorComponents + component]);
		g_solidVertices[offset + 8u + component] = static_cast<f32>(g_colorPlane[kGxGpuColorComponents * 2u + component]);
	}
	return offset + kGxGpuFixedSolidVertexFloats;
}

size_t appendSolidPrimitiveTriangle(
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
		g_colorPlane[0] = color0 & 0xffu;
		g_colorPlane[1] = (color0 >> 8u) & 0xffu;
		g_colorPlane[2] = (color0 >> 16u) & 0xffu;
		g_colorPlane[3] = color1 & 0xffu;
		g_colorPlane[4] = (color1 >> 8u) & 0xffu;
		g_colorPlane[5] = (color1 >> 16u) & 0xffu;
		g_colorPlane[6] = color2 & 0xffu;
		g_colorPlane[7] = (color2 >> 8u) & 0xffu;
		g_colorPlane[8] = (color2 >> 16u) & 0xffu;
		gxGpuTriangleAttributePlane(g_colorPlane.data(), 0u, kGxGpuColorComponents, determinant, x0, y0, x1, y1, x2, y2);
		size_t offset = vertexFloatCount;
		offset = writeFixedSolidVertex(offset, x0, y0);
		offset = writeFixedSolidVertex(offset, x1, y1);
		offset = writeFixedSolidVertex(offset, x2, y2);
		return offset;
	}
	return appendSolidTriangle(
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

size_t appendSolidQuad(
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
	offset = appendSolidTriangle(offset, x0, y0, color0, x1, y1, color1, x2, y2, color2);
	offset = appendSolidTriangle(offset, x2, y2, color2, x1, y1, color1, x3, y3, color3);
	return offset;
}

size_t appendFillRectangle(const GxGpuCommandBuffer& commandBuffer, u32 commandIndex, size_t vertexFloatCount) {
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
		const u32 rowHeight = gxGpuVramWrappedHeight(y, remainingHeight, vramYAddressExtensionWord);
		u32 x = gxGpuFillX(xyWord);
		u32 remainingWidth = width;
		while (remainingWidth != 0u) {
			const u32 runWidth = gxGpuVramWrappedWidth(x, remainingWidth);
			offset = appendSolidQuad(
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
			x = (x + runWidth) & (static_cast<u32>(kGxGpuVramWidth) - 1u);
			remainingWidth -= runWidth;
		}
		y = gxGpuVramYAddress(y + rowHeight, vramYAddressExtensionWord);
		remainingHeight -= rowHeight;
	}
	return offset;
}

size_t appendSolidPolygon(const GxGpuCommandBuffer& commandBuffer, u32 commandIndex, size_t vertexFloatCount) {
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
		size_t offset = appendSolidPrimitiveTriangle(
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
			offset = appendSolidPrimitiveTriangle(
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
	size_t offset = appendSolidPrimitiveTriangle(
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
		offset = appendSolidPrimitiveTriangle(
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

GxGpuRectangle& readGxGpuRectangle(const GxGpuCommandBuffer& commandBuffer, u32 commandIndex, u32 opcode) {
	const u32 wordStart = commandBuffer.commandWordStart[commandIndex];
	const u32 xyWord = commandBuffer.words[wordStart + 1u];
	const u32 sizeWord = commandBuffer.words[wordStart + commandBuffer.commandWordCount[commandIndex] - 1u];
	const u32 width = gxGpuCommandRectangleWidth(opcode, sizeWord);
	const u32 height = gxGpuCommandRectangleHeight(opcode, sizeWord);
	const u32 drawingOffsetWord = commandBuffer.commandDrawingOffsetWord[commandIndex];
	const f32 x0 = static_cast<f32>(gxGpuSigned11(static_cast<u32>(gxGpuSigned11(drawingOffsetWord) + gxGpuSigned11(xyWord))));
	const f32 y0 = static_cast<f32>(gxGpuSigned11(static_cast<u32>(gxGpuDrawingOffsetY(drawingOffsetWord) + gxGpuVertexY(xyWord))));
	g_rectangleScratch.x0 = x0;
	g_rectangleScratch.y0 = y0;
	g_rectangleScratch.x1 = x0 + static_cast<f32>(width);
	g_rectangleScratch.y1 = y0 + static_cast<f32>(height);
	g_rectangleScratch.width = width;
	g_rectangleScratch.height = height;
	return g_rectangleScratch;
}

size_t appendSolidRectangle(const GxGpuCommandBuffer& commandBuffer, u32 commandIndex, size_t vertexFloatCount) {
	const u32 opcode = commandBuffer.commandOpcode[commandIndex];
	if (gxGpuCommandTextureEnabled(opcode)) {
		return vertexFloatCount;
	}
	const u32 wordStart = commandBuffer.commandWordStart[commandIndex];
	const u32 colorWord = commandBuffer.words[wordStart];
	const GxGpuRectangle& rect = readGxGpuRectangle(commandBuffer, commandIndex, opcode);
	if (rect.width == 0u || rect.height == 0u) {
		return vertexFloatCount;
	}
	return appendSolidQuad(vertexFloatCount, rect.x0, rect.y0, colorWord, rect.x0, rect.y1, colorWord, rect.x1, rect.y0, colorWord, rect.x1, rect.y1, colorWord);
}

size_t appendPreparedSolidRectangle(size_t vertexFloatCount, const GxGpuPreparedRasterPrimitive& rectangle) {
	const f32 x0 = static_cast<f32>(rectangle.x0);
	const f32 y0 = static_cast<f32>(rectangle.y0);
	const f32 x1 = static_cast<f32>(rectangle.x1);
	const f32 y1 = static_cast<f32>(rectangle.y1);
	return appendSolidQuad(
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

size_t writeLineVertex(
	size_t offset,
	f32 x,
	f32 y,
	f32 x0,
	f32 y0,
	f32 x1,
	f32 y1,
	u32 color0,
	u32 color1) {
	g_lineVertices[offset] = x;
	g_lineVertices[offset + 1u] = y;
	g_lineVertices[offset + 2u] = x0;
	g_lineVertices[offset + 3u] = y0;
	g_lineVertices[offset + 4u] = x1;
	g_lineVertices[offset + 5u] = y1;
	g_lineVertices[offset + 6u] = static_cast<f32>(color0 & 0xffu) / 255.0f;
	g_lineVertices[offset + 7u] = static_cast<f32>((color0 >> 8u) & 0xffu) / 255.0f;
	g_lineVertices[offset + 8u] = static_cast<f32>((color0 >> 16u) & 0xffu) / 255.0f;
	g_lineVertices[offset + 9u] = static_cast<f32>(color1 & 0xffu) / 255.0f;
	g_lineVertices[offset + 10u] = static_cast<f32>((color1 >> 8u) & 0xffu) / 255.0f;
	g_lineVertices[offset + 11u] = static_cast<f32>((color1 >> 16u) & 0xffu) / 255.0f;
	return offset + kGxGpuLineVertexFloats;
}

size_t appendPreparedLineSegment(size_t vertexFloatCount, const GxGpuPreparedRasterPrimitive& line) {
	const f32 x0Float = static_cast<f32>(line.x0);
	const f32 y0Float = static_cast<f32>(line.y0);
	const f32 x1Float = static_cast<f32>(line.x1);
	const f32 y1Float = static_cast<f32>(line.y1);
	size_t offset = vertexFloatCount;
	if (line.lineRasterCase == GxGpuLineRasterCase::HorizontalMajor) {
		offset = writeLineVertex(offset, x0Float, y0Float - 1.0f, x0Float, y0Float, x1Float, y1Float, line.color0, line.color1);
		offset = writeLineVertex(offset, x0Float, y0Float + 2.0f, x0Float, y0Float, x1Float, y1Float, line.color0, line.color1);
		offset = writeLineVertex(offset, x1Float + 1.0f, y1Float - 1.0f, x0Float, y0Float, x1Float, y1Float, line.color0, line.color1);
		offset = writeLineVertex(offset, x0Float, y0Float + 2.0f, x0Float, y0Float, x1Float, y1Float, line.color0, line.color1);
		offset = writeLineVertex(offset, x1Float + 1.0f, y1Float - 1.0f, x0Float, y0Float, x1Float, y1Float, line.color0, line.color1);
		offset = writeLineVertex(offset, x1Float + 1.0f, y1Float + 2.0f, x0Float, y0Float, x1Float, y1Float, line.color0, line.color1);
		return offset;
	}
	if (line.lineRasterCase == GxGpuLineRasterCase::VerticalIncreasing) {
		offset = writeLineVertex(offset, x0Float - 1.0f, y0Float, x0Float, y0Float, x1Float, y1Float, line.color0, line.color1);
		offset = writeLineVertex(offset, x1Float - 1.0f, y1Float + 1.0f, x0Float, y0Float, x1Float, y1Float, line.color0, line.color1);
		offset = writeLineVertex(offset, x0Float + 2.0f, y0Float, x0Float, y0Float, x1Float, y1Float, line.color0, line.color1);
		offset = writeLineVertex(offset, x1Float - 1.0f, y1Float + 1.0f, x0Float, y0Float, x1Float, y1Float, line.color0, line.color1);
		offset = writeLineVertex(offset, x0Float + 2.0f, y0Float, x0Float, y0Float, x1Float, y1Float, line.color0, line.color1);
		offset = writeLineVertex(offset, x1Float + 2.0f, y1Float + 1.0f, x0Float, y0Float, x1Float, y1Float, line.color0, line.color1);
		return offset;
	}
	offset = writeLineVertex(offset, x1Float - 1.0f, y1Float, x0Float, y0Float, x1Float, y1Float, line.color0, line.color1);
	offset = writeLineVertex(offset, x0Float - 1.0f, y0Float + 1.0f, x0Float, y0Float, x1Float, y1Float, line.color0, line.color1);
	offset = writeLineVertex(offset, x1Float + 2.0f, y1Float, x0Float, y0Float, x1Float, y1Float, line.color0, line.color1);
	offset = writeLineVertex(offset, x0Float - 1.0f, y0Float + 1.0f, x0Float, y0Float, x1Float, y1Float, line.color0, line.color1);
	offset = writeLineVertex(offset, x1Float + 2.0f, y1Float, x0Float, y0Float, x1Float, y1Float, line.color0, line.color1);
	offset = writeLineVertex(offset, x0Float + 2.0f, y0Float + 1.0f, x0Float, y0Float, x1Float, y1Float, line.color0, line.color1);
	return offset;
}

size_t writeTexturedVertex(size_t offset, i32 x, i32 y, u32 colorWord) {
	g_texturedVertices[offset] = static_cast<f32>(x);
	g_texturedVertices[offset + 1u] = static_cast<f32>(y);
	g_texturedVertices[offset + 2u] = static_cast<f32>(colorWord & 0xffu) / 255.0f;
	g_texturedVertices[offset + 3u] = static_cast<f32>((colorWord >> 8u) & 0xffu) / 255.0f;
	g_texturedVertices[offset + 4u] = static_cast<f32>((colorWord >> 16u) & 0xffu) / 255.0f;
	return offset + kGxGpuTexturedVertexFloats;
}

void prepareTexturedUvPlane(
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
	g_texturedUvPlane[0] = u0;
	g_texturedUvPlane[1] = v0;
	g_texturedUvPlane[2] = u1;
	g_texturedUvPlane[3] = v1;
	g_texturedUvPlane[4] = u2;
	g_texturedUvPlane[5] = v2;
	gxGpuTriangleAttributePlane(g_texturedUvPlane.data(), 0u, kGxGpuTexturedUvComponents, determinant, x0, y0, x1, y1, x2, y2);
}

size_t appendTexturedTriangle(
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
	prepareTexturedUvPlane(determinant, x0, y0, u0, v0, x1, y1, u1, v1, x2, y2, u2, v2);
	size_t offset = vertexFloatCount;
	offset = writeTexturedVertex(offset, x0, y0, color0);
	offset = writeTexturedVertex(offset, x1, y1, color1);
	offset = writeTexturedVertex(offset, x2, y2, color2);
	for (size_t vertexOffset = vertexFloatCount; vertexOffset < offset; vertexOffset += kGxGpuTexturedVertexFloats) {
		g_texturedVertices[vertexOffset + 5u] = static_cast<f32>(g_texturedUvPlane[0]);
		g_texturedVertices[vertexOffset + 6u] = static_cast<f32>(g_texturedUvPlane[1]);
		g_texturedVertices[vertexOffset + 7u] = static_cast<f32>(g_texturedUvPlane[2]);
		g_texturedVertices[vertexOffset + 8u] = static_cast<f32>(g_texturedUvPlane[3]);
		g_texturedVertices[vertexOffset + 9u] = static_cast<f32>(g_texturedUvPlane[4]);
		g_texturedVertices[vertexOffset + 10u] = static_cast<f32>(g_texturedUvPlane[5]);
	}
	return offset;
}

size_t writeFixedTexturedVertex(size_t offset, i32 x, i32 y) {
	g_texturedVertices[offset] = static_cast<f32>(x);
	g_texturedVertices[offset + 1u] = static_cast<f32>(y);
	for (size_t component = 0u; component < kGxGpuTexturedUvComponents; component += 1u) {
		g_texturedVertices[offset + 2u + component] = static_cast<f32>(g_texturedUvPlane[component]);
		g_texturedVertices[offset + 4u + component] = static_cast<f32>(g_texturedUvPlane[kGxGpuTexturedUvComponents + component]);
		g_texturedVertices[offset + 6u + component] = static_cast<f32>(g_texturedUvPlane[kGxGpuTexturedUvComponents * 2u + component]);
	}
	for (size_t component = 0u; component < kGxGpuColorComponents; component += 1u) {
		g_texturedVertices[offset + 8u + component] = static_cast<f32>(g_colorPlane[component]);
		g_texturedVertices[offset + 11u + component] = static_cast<f32>(g_colorPlane[kGxGpuColorComponents + component]);
		g_texturedVertices[offset + 14u + component] = static_cast<f32>(g_colorPlane[kGxGpuColorComponents * 2u + component]);
	}
	return offset + kGxGpuFixedTexturedVertexFloats;
}

size_t appendTexturedPrimitiveTriangle(
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
		prepareTexturedUvPlane(determinant, x0, y0, u0, v0, x1, y1, u1, v1, x2, y2, u2, v2);
		g_colorPlane[0] = color0 & 0xffu;
		g_colorPlane[1] = (color0 >> 8u) & 0xffu;
		g_colorPlane[2] = (color0 >> 16u) & 0xffu;
		g_colorPlane[3] = color1 & 0xffu;
		g_colorPlane[4] = (color1 >> 8u) & 0xffu;
		g_colorPlane[5] = (color1 >> 16u) & 0xffu;
		g_colorPlane[6] = color2 & 0xffu;
		g_colorPlane[7] = (color2 >> 8u) & 0xffu;
		g_colorPlane[8] = (color2 >> 16u) & 0xffu;
		gxGpuTriangleAttributePlane(g_colorPlane.data(), 0u, kGxGpuColorComponents, determinant, x0, y0, x1, y1, x2, y2);
		size_t offset = vertexFloatCount;
		offset = writeFixedTexturedVertex(offset, x0, y0);
		offset = writeFixedTexturedVertex(offset, x1, y1);
		offset = writeFixedTexturedVertex(offset, x2, y2);
		return offset;
	}
	return appendTexturedTriangle(
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

size_t appendTexturedPolygon(const GxGpuCommandBuffer& commandBuffer, u32 commandIndex, size_t vertexFloatCount) {
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
		size_t offset = appendTexturedPrimitiveTriangle(
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
			offset = appendTexturedPrimitiveTriangle(
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
	size_t offset = appendTexturedPrimitiveTriangle(
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
		offset = appendTexturedPrimitiveTriangle(
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

size_t appendTexturedRectangle(const GxGpuCommandBuffer& commandBuffer, u32 commandIndex, size_t vertexFloatCount) {
	const u32 opcode = commandBuffer.commandOpcode[commandIndex];
	const u32 wordStart = commandBuffer.commandWordStart[commandIndex];
	const u32 colorWord = commandBuffer.words[wordStart];
	const u32 textureWord = commandBuffer.words[wordStart + 2u];
	const GxGpuRectangle& rect = readGxGpuRectangle(commandBuffer, commandIndex, opcode);
	if (rect.width == 0u || rect.height == 0u) {
		return vertexFloatCount;
	}
	const u32 drawModeWord = commandBuffer.commandDrawModeWord[commandIndex];
	const bool xFlip = gxGpuDrawModeTextureRectangleXFlip(drawModeWord);
	const bool yFlip = gxGpuDrawModeTextureRectangleYFlip(drawModeWord);
	const i32 u0 = static_cast<i32>(gxGpuTextureU(textureWord)) + (xFlip ? 1 : 0);
	const i32 v0 = static_cast<i32>(gxGpuTextureV(textureWord)) + (yFlip ? 1 : 0);
	const i32 u1 = u0 + (xFlip ? -static_cast<i32>(rect.width) : static_cast<i32>(rect.width));
	const i32 v1 = v0 + (yFlip ? -static_cast<i32>(rect.height) : static_cast<i32>(rect.height));
	const i64 determinant = static_cast<i64>(rect.width) * static_cast<i64>(rect.height);
	size_t offset = vertexFloatCount;
	offset = appendTexturedTriangle(offset, determinant, static_cast<i32>(rect.x0), static_cast<i32>(rect.y0), colorWord, u0, v0, static_cast<i32>(rect.x1), static_cast<i32>(rect.y0), colorWord, u1, v0, static_cast<i32>(rect.x0), static_cast<i32>(rect.y1), colorWord, u0, v1);
	offset = appendTexturedTriangle(offset, determinant, static_cast<i32>(rect.x0), static_cast<i32>(rect.y1), colorWord, u0, v1, static_cast<i32>(rect.x1), static_cast<i32>(rect.y0), colorWord, u1, v0, static_cast<i32>(rect.x1), static_cast<i32>(rect.y1), colorWord, u1, v1);
	return offset;
}

size_t writeTransferVertex(f32* vertices, size_t offset, size_t vertexFloatStride, f32 x, f32 y, f32 sourceOffsetX, f32 sourceOffsetY) {
	vertices[offset] = x;
	vertices[offset + 1u] = y;
	vertices[offset + 2u] = sourceOffsetX;
	vertices[offset + 3u] = sourceOffsetY;
	return offset + vertexFloatStride;
}

size_t appendTransferTriangle(
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
	offset = writeTransferVertex(g_transferVertices.data(), offset, kGxGpuTransferVertexFloats, x0, y0, sourceOffsetX, sourceOffsetY);
	offset = writeTransferVertex(g_transferVertices.data(), offset, kGxGpuTransferVertexFloats, x1, y1, sourceOffsetX, sourceOffsetY);
	offset = writeTransferVertex(g_transferVertices.data(), offset, kGxGpuTransferVertexFloats, x2, y2, sourceOffsetX, sourceOffsetY);
	return offset;
}

size_t appendTransferQuad(size_t vertexFloatCount, u32 x, u32 y, u32 width, u32 height, u32 u, u32 v) {
	const f32 x0 = static_cast<f32>(x);
	const f32 y0 = static_cast<f32>(y);
	const f32 x1 = static_cast<f32>(x + width);
	const f32 y1 = static_cast<f32>(y + height);
	const f32 sourceOffsetX = static_cast<f32>(u) - x0;
	const f32 sourceOffsetY = static_cast<f32>(v) - y0;
	size_t offset = vertexFloatCount;
	offset = appendTransferTriangle(offset, x0, y0, x1, y0, x0, y1, sourceOffsetX, sourceOffsetY);
	offset = appendTransferTriangle(offset, x0, y1, x1, y0, x1, y1, sourceOffsetX, sourceOffsetY);
	return offset;
}

void writeVramSnapshotUpload(const std::array<u8, GX_GPU_VRAM_BYTE_COUNT>& snapshotBytes) {
	for (i32 logicalY = 0; logicalY < kGxGpuVramHeight; logicalY += 1) {
		size_t uploadByteOffset = static_cast<size_t>(logicalY) * static_cast<size_t>(kGxGpuVramWidth) * kGxGpuRawVramBytesPerPixel;
		size_t snapshotByteOffset = static_cast<size_t>(logicalY) * static_cast<size_t>(kGxGpuVramWidth) * 2u;
		for (i32 column = 0; column < kGxGpuVramWidth; column += 1) {
			g_rawVramUpload[uploadByteOffset] = snapshotBytes[snapshotByteOffset];
			g_rawVramUpload[uploadByteOffset + 1u] = snapshotBytes[snapshotByteOffset + 1u];
			g_rawVramUpload[uploadByteOffset + 2u] = 0u;
			g_rawVramUpload[uploadByteOffset + 3u] = 0xffu;
			uploadByteOffset += kGxGpuRawVramBytesPerPixel;
			snapshotByteOffset += 2u;
		}
	}
}

void uploadGxGpuVramSnapshot(const std::array<u8, GX_GPU_VRAM_BYTE_COUNT>& snapshotBytes) {
	writeVramSnapshotUpload(snapshotBytes);
	g_gxGpu.backend->setRenderTarget(0, kGxGpuVramWidth, kGxGpuVramHeight);
	g_gxGpu.backend->setActiveTextureUnit(kGxGpuScanoutTextureUnit);
	g_gxGpu.backend->bindTexture2D(&g_gxGpu.vramTexture);
	glTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, kGxGpuVramWidth, kGxGpuVramHeight, GL_RGBA, GL_UNSIGNED_BYTE, g_rawVramUpload.data());
	g_sampleDirtyRect = {0, 0, kGxGpuVramWidth, kGxGpuVramHeight};
}

void writeGxGpuVramSnapshotFromReadback() {
	size_t snapshotByteOffset = 0u;
	for (i32 logicalY = 0; logicalY < kGxGpuVramHeight; logicalY += 1) {
		size_t readbackByteOffset = static_cast<size_t>(logicalY) * static_cast<size_t>(kGxGpuVramWidth) * kGxGpuRawVramBytesPerPixel;
		for (i32 column = 0; column < kGxGpuVramWidth; column += 1) {
			g_vramSnapshotScratch[snapshotByteOffset] = g_rawVramReadback[readbackByteOffset];
			g_vramSnapshotScratch[snapshotByteOffset + 1u] = g_rawVramReadback[readbackByteOffset + 1u];
			snapshotByteOffset += 2u;
			readbackByteOffset += kGxGpuRawVramBytesPerPixel;
		}
	}
}

void completeGxGpuReadback(size_t commandLimit, GxGpuReadbackPort& readback) {
	if (!readback.claimReadback(commandLimit)) {
		return;
	}
	const u32 readbackToken = readback.token();
	const u32 pixelCount = readback.width() * readback.height();
	const u32 wordCount = (pixelCount + 1u) >> 1u;
	const u32 packedWidth = wordCount < static_cast<u32>(kGxGpuReadbackPackWidth) ? wordCount : static_cast<u32>(kGxGpuReadbackPackWidth);
	const u32 packedHeight = ((wordCount - 1u) / packedWidth) + 1u;
	g_gxGpu.backend->setRenderTarget(g_gxGpu.readbackFramebuffer, static_cast<i32>(packedWidth), static_cast<i32>(packedHeight));
	glDisable(GL_SCISSOR_TEST);
	glDisable(GL_DEPTH_TEST);
	glDepthMask(GL_FALSE);
	glDisable(GL_CULL_FACE);
	glDisable(GL_BLEND);
	glDisable(GL_DITHER);
	glColorMask(GL_TRUE, GL_TRUE, GL_TRUE, GL_TRUE);
	glUseProgram(g_gxGpu.readbackProgram);
	glUniform1i(g_gxGpu.readbackVramUniform, kGxGpuScanoutTextureUnit);
	glUniform4i(g_gxGpu.readbackParamsUniform, static_cast<GLint>(readback.x()), static_cast<GLint>(readback.y()), static_cast<GLint>(readback.width()), static_cast<GLint>(packedWidth));
	glUniform1i(g_gxGpu.readbackVramYAddressExtensionUniform, static_cast<GLint>(readback.vramYAddressExtensionWord()));
	g_gxGpu.backend->setActiveTextureUnit(kGxGpuScanoutTextureUnit);
	g_gxGpu.backend->bindTexture2D(&g_gxGpu.vramTexture);
	glBindBuffer(GL_ARRAY_BUFFER, g_gxGpu.scanoutVertexBuffer);
	glEnableVertexAttribArray(static_cast<GLuint>(g_gxGpu.readbackPositionAttrib));
	glVertexAttribPointer(static_cast<GLuint>(g_gxGpu.readbackPositionAttrib), 2, GL_FLOAT, GL_FALSE, kGxGpuScanoutVertexStride, nullptr);
	glDrawArrays(GL_TRIANGLES, 0, static_cast<GLsizei>(kGxGpuScanoutVertexCount));
	glReadPixels(0, 0, static_cast<GLsizei>(packedWidth), static_cast<GLsizei>(packedHeight), GL_RGBA, GL_UNSIGNED_BYTE, readback.pixelBytes());
	readback.completeReadback(readbackToken);
}

void writeCpuToVramUploadRun(
	const GxGpuCommandBuffer& commandBuffer,
	u32 payloadWordStart,
	u32 sourceRowStart,
	u32 sourceColumnStart,
	u32 sourceStride,
	u32 runWidth,
	u32 runHeight) {
	size_t uploadByteOffset = 0u;
	for (u32 storageRow = 0u; storageRow < runHeight; storageRow += 1u) {
		u32 pixelIndex = (sourceRowStart + storageRow) * sourceStride + sourceColumnStart;
		for (u32 column = 0u; column < runWidth; column += 1u) {
			const u32 payloadWord = commandBuffer.words[payloadWordStart + (pixelIndex >> 1u)];
			const u32 pixelWord = gxGpuTransferPixelWord(payloadWord, pixelIndex);
			g_rawVramUpload[uploadByteOffset] = static_cast<u8>(pixelWord & 0xffu);
			g_rawVramUpload[uploadByteOffset + 1u] = static_cast<u8>((pixelWord >> 8u) & 0xffu);
			g_rawVramUpload[uploadByteOffset + 2u] = 0u;
			g_rawVramUpload[uploadByteOffset + 3u] = 0xffu;
			uploadByteOffset += kGxGpuRawVramBytesPerPixel;
			pixelIndex += 1u;
		}
	}
}

struct GxCpuToVramUploadProfile {
	u64 hostCalls = 0u;
	u64 hostBytes = 0u;
};

template <bool Profile>
size_t uploadCpuToVramRows(
	const GxGpuCommandBuffer& commandBuffer,
	u32 payloadWordStart,
	u32 x,
	u32 y,
	u32 sourceStride,
	u32 sourceRowStart,
	u32 rowWidth,
	u32 rowCount,
	u32 maskBitModeWord,
	size_t transferVertexFloatCount,
	u32 vramYAddressExtensionWord,
	GxCpuToVramUploadProfile* profile) {
	u32 targetRunY = gxGpuVramYAddress(y + sourceRowStart, vramYAddressExtensionWord);
	u32 sourceRunRow = sourceRowStart;
	u32 remainingRows = rowCount;
	while (remainingRows != 0u) {
		const u32 runHeight = gxGpuVramWrappedHeight(targetRunY, remainingRows, vramYAddressExtensionWord);
		u32 targetRunX = x;
		u32 sourceColumnStart = 0u;
		u32 remainingWidth = rowWidth;
		while (remainingWidth != 0u) {
			const u32 runWidth = gxGpuVramWrappedWidth(targetRunX, remainingWidth);
			writeCpuToVramUploadRun(commandBuffer, payloadWordStart, sourceRunRow, sourceColumnStart, sourceStride, runWidth, runHeight);
			glTexSubImage2D(
				GL_TEXTURE_2D,
				0,
				static_cast<GLint>(targetRunX),
				static_cast<GLint>(targetRunY),
				static_cast<GLsizei>(runWidth),
				static_cast<GLsizei>(runHeight),
				GL_RGBA,
				GL_UNSIGNED_BYTE,
				g_rawVramUpload.data());
			if constexpr (Profile) {
				profile->hostCalls += 1u;
				profile->hostBytes += static_cast<u64>(runWidth)
					* static_cast<u64>(runHeight)
					* kGxGpuRawVramBytesPerPixel;
			}
			if (maskBitModeWord != 0u) {
				transferVertexFloatCount = appendTransferQuad(transferVertexFloatCount, targetRunX, targetRunY, runWidth, runHeight, targetRunX, targetRunY);
			}
			remainingWidth -= runWidth;
			sourceColumnStart += runWidth;
			targetRunX = 0u;
		}
		remainingRows -= runHeight;
		sourceRunRow += runHeight;
		targetRunY = gxGpuVramYAddress(targetRunY + runHeight, vramYAddressExtensionWord);
	}
	return transferVertexFloatCount;
}

void markGxGpuSampleTextureDirtyLogicalArea(u32 x, u32 y, u32 width, u32 height, u32 vramYAddressExtensionWord);
void syncGxGpuSampleTextureLogicalArea(u32 x, u32 y, u32 width, u32 height, u32 vramYAddressExtensionWord);
void renderTransferCommands(size_t vertexFloatCount, GLES2Texture& sourceTexture, i32 sourceTextureUnit, u32 maskBitModeWord);
void submitGxGpuPrimitiveBatches();

template <bool Profile>
u32 executeCpuToVramUpload(
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

	g_gxGpu.backend->setRenderTarget(0, kGxGpuVramWidth, kGxGpuVramHeight);
	g_gxGpu.backend->setActiveTextureUnit(maskBitModeWord == 0u ? kGxGpuScanoutTextureUnit : kGxGpuTextureTransferUnit);
	g_gxGpu.backend->bindTexture2D(maskBitModeWord == 0u ? &g_gxGpu.vramTexture : &g_gxGpu.vramTransferTexture);
	if (fullRows != 0u) {
		transferVertexFloatCount = uploadCpuToVramRows<Profile>(
			commandBuffer,
			payloadWordStart,
			x,
			y,
			width,
			0u,
			width,
			fullRows,
			maskBitModeWord,
			transferVertexFloatCount,
			vramYAddressExtensionWord,
			profile);
	}
	if (lastRowWidth != 0u) {
		transferVertexFloatCount = uploadCpuToVramRows<Profile>(
			commandBuffer,
			payloadWordStart,
			x,
			y,
			width,
			fullRows,
			lastRowWidth,
			1u,
			maskBitModeWord,
			transferVertexFloatCount,
			vramYAddressExtensionWord,
			profile);
	}
	if (maskBitModeWord != 0u) {
		if (gxGpuMaskBitCheckBeforeDraw(maskBitModeWord)) {
			syncGxGpuSampleTextureLogicalArea(x, y, width, uploadHeight, vramYAddressExtensionWord);
		}
		if (transferVertexFloatCount != 0u) {
			renderTransferCommands(transferVertexFloatCount, g_gxGpu.vramTransferTexture, kGxGpuTextureTransferUnit, maskBitModeWord);
		}
	}
	if (fullRows != 0u) {
		markGxGpuSampleTextureDirtyLogicalArea(x, y, width, fullRows, vramYAddressExtensionWord);
	}
	if (lastRowWidth != 0u) {
		markGxGpuSampleTextureDirtyLogicalArea(x, y + fullRows, lastRowWidth, 1u, vramYAddressExtensionWord);
	}
	return uploadedPixels;
}

void uploadCpuToVram(const GxGpuCommandBuffer& commandBuffer, u32 commandIndex) {
	if (!g_gxGpu.backend->profilesGxUploads()) {
		executeCpuToVramUpload<false>(commandBuffer, commandIndex, nullptr);
		return;
	}
	GxCpuToVramUploadProfile profile{};
	const auto start = std::chrono::steady_clock::now();
	const u32 uploadedPixels = executeCpuToVramUpload<true>(commandBuffer, commandIndex, &profile);
	const u64 cpuNanoseconds = static_cast<u64>(std::chrono::duration_cast<std::chrono::nanoseconds>(
		std::chrono::steady_clock::now() - start).count());
	g_gxGpu.backend->recordGxCpuToVramUpload(
		static_cast<u64>(uploadedPixels) * sizeof(u16),
		profile.hostCalls,
		profile.hostBytes,
		cpuNanoseconds);
}

void copyVramToVramArea(
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
		const u32 sourceRunHeight = gxGpuVramWrappedHeight(runSourceY, remainingHeight, vramYAddressExtensionWord);
		const u32 targetRunHeight = gxGpuVramWrappedHeight(runTargetY, remainingHeight, vramYAddressExtensionWord);
		const u32 runHeight = sourceRunHeight < targetRunHeight ? sourceRunHeight : targetRunHeight;
		syncGxGpuSampleTextureLogicalArea(sourceX, runSourceY, width, runHeight, vramYAddressExtensionWord);
		if (gxGpuMaskBitCheckBeforeDraw(maskBitModeWord)) {
			syncGxGpuSampleTextureLogicalArea(targetX, runTargetY, width, runHeight, vramYAddressExtensionWord);
		}
		runSourceY = gxGpuVramYAddress(runSourceY + runHeight, vramYAddressExtensionWord);
		runTargetY = gxGpuVramYAddress(runTargetY + runHeight, vramYAddressExtensionWord);
		remainingHeight -= runHeight;
	}
	runSourceY = gxGpuVramYAddress(sourceY, vramYAddressExtensionWord);
	runTargetY = gxGpuVramYAddress(targetY, vramYAddressExtensionWord);
	remainingHeight = height;
	while (remainingHeight != 0u) {
		const u32 sourceRunHeight = gxGpuVramWrappedHeight(runSourceY, remainingHeight, vramYAddressExtensionWord);
		const u32 targetRunHeight = gxGpuVramWrappedHeight(runTargetY, remainingHeight, vramYAddressExtensionWord);
		const u32 runHeight = sourceRunHeight < targetRunHeight ? sourceRunHeight : targetRunHeight;
		u32 runSourceX = sourceX;
		u32 runTargetX = targetX;
		u32 remainingWidth = width;
		while (remainingWidth != 0u) {
			const u32 sourceRunWidth = gxGpuVramWrappedWidth(runSourceX, remainingWidth);
			const u32 targetRunWidth = gxGpuVramWrappedWidth(runTargetX, remainingWidth);
			const u32 runWidth = sourceRunWidth < targetRunWidth ? sourceRunWidth : targetRunWidth;
			transferVertexFloatCount = appendTransferQuad(transferVertexFloatCount, runTargetX, runTargetY, runWidth, runHeight, runSourceX, runSourceY);
			runSourceX = (runSourceX + runWidth) & (static_cast<u32>(kGxGpuVramWidth) - 1u);
			runTargetX = (runTargetX + runWidth) & (static_cast<u32>(kGxGpuVramWidth) - 1u);
			remainingWidth -= runWidth;
		}
		runSourceY = gxGpuVramYAddress(runSourceY + runHeight, vramYAddressExtensionWord);
		runTargetY = gxGpuVramYAddress(runTargetY + runHeight, vramYAddressExtensionWord);
		remainingHeight -= runHeight;
	}
	if (transferVertexFloatCount != 0u) {
		renderTransferCommands(transferVertexFloatCount, g_gxGpu.vramSampleTexture, kGxGpuTextureSampleUnit, maskBitModeWord);
	}
	markGxGpuSampleTextureDirtyLogicalArea(targetX, targetY, width, height, vramYAddressExtensionWord);
}

void copyVramToVram(const GxGpuCommandBuffer& commandBuffer, u32 commandIndex) {
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
	if (gxGpuVramCopyNeedsChunking(sourceX, sourceY, targetX, targetY, width, height)) {
		const u32 chunkHeight = gxGpuVramCopyChunkHeight(sourceY, targetY, height);
		for (u32 chunkTargetY = targetY; chunkTargetY < targetY + height; chunkTargetY += chunkHeight) {
			const u32 chunkSourceY = sourceY + (chunkTargetY - targetY);
			const u32 remainingHeight = targetY + height - chunkTargetY;
			const u32 currentChunkHeight = chunkHeight < remainingHeight ? chunkHeight : remainingHeight;
			copyVramToVramArea(sourceX, chunkSourceY, targetX, chunkTargetY, width, currentChunkHeight, maskBitModeWord, vramYAddressExtensionWord);
		}
		return;
	}
	copyVramToVramArea(sourceX, sourceY, targetX, targetY, width, height, maskBitModeWord, vramYAddressExtensionWord);
}

void resetGxGpuVramCopyRect(GxGpuVramCopyRect& rect) {
	rect.left = kGxGpuVramWidth;
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

bool gxGpuVramCopyRectsOverlap(const GxGpuVramCopyRect& a, const GxGpuVramCopyRect& b, u32 vramYAddressExtensionWord) {
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
		vramYAddressExtensionWord);
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
	GxGpuPreparedRasterPrimitive& rectangle,
	const GxGpuCommandBuffer& commandBuffer,
	u32 commandIndex,
	u32 topLeftWord,
	u32 bottomRightWord,
	u32 vramYAddressExtensionWord) {
	const u32 opcode = commandBuffer.commandOpcode[commandIndex];
	const GxGpuRectangle& source = readGxGpuRectangle(commandBuffer, commandIndex, opcode);
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

void markGxGpuSampleTextureDirtyArea(i32 left, i32 top, i32 right, i32 bottom) {
	if (right <= left || bottom <= top) {
		return;
	}
	if (left < g_sampleDirtyRect.left) {
		g_sampleDirtyRect.left = left;
	}
	if (top < g_sampleDirtyRect.top) {
		g_sampleDirtyRect.top = top;
	}
	if (right > g_sampleDirtyRect.right) {
		g_sampleDirtyRect.right = right;
	}
	if (bottom > g_sampleDirtyRect.bottom) {
		g_sampleDirtyRect.bottom = bottom;
	}
}

void markGxGpuSampleTextureDirtyLogicalArea(u32 x, u32 y, u32 width, u32 height, u32 vramYAddressExtensionWord) {
	u32 rowY = gxGpuVramYAddress(y, vramYAddressExtensionWord);
	u32 remainingHeight = height;
	while (remainingHeight != 0u) {
		const u32 runHeight = gxGpuVramWrappedHeight(rowY, remainingHeight, vramYAddressExtensionWord);
		u32 columnX = x & (GX_GPU_VRAM_WIDTH - 1u);
		u32 remainingWidth = width;
		while (remainingWidth != 0u) {
			const u32 runWidth = gxGpuVramWrappedWidth(columnX, remainingWidth);
			markGxGpuSampleTextureDirtyArea(
				static_cast<i32>(columnX),
				static_cast<i32>(rowY),
				static_cast<i32>(columnX + runWidth),
				static_cast<i32>(rowY + runHeight));
			columnX = (columnX + runWidth) & (GX_GPU_VRAM_WIDTH - 1u);
			remainingWidth -= runWidth;
		}
		rowY = gxGpuVramYAddress(rowY + runHeight, vramYAddressExtensionWord);
		remainingHeight -= runHeight;
	}
}

void copyGxGpuVramAreaToSampleTexture(i32 left, i32 top, i32 right, i32 bottom) {
	if (right <= left || bottom <= top) {
		return;
	}
	g_gxGpu.backend->setRenderTarget(g_gxGpu.vramFramebuffer, kGxGpuVramWidth, kGxGpuVramHeight);
	g_gxGpu.backend->setActiveTextureUnit(kGxGpuTextureSampleUnit);
	g_gxGpu.backend->bindTexture2D(&g_gxGpu.vramSampleTexture);
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

bool syncGxGpuSampleTextureArea(i32 left, i32 top, i32 right, i32 bottom) {
	if (left >= g_sampleDirtyRect.right
		|| g_sampleDirtyRect.left >= right
		|| top >= g_sampleDirtyRect.bottom
		|| g_sampleDirtyRect.top >= bottom) {
		return false;
	}
	copyGxGpuVramAreaToSampleTexture(g_sampleDirtyRect.left, g_sampleDirtyRect.top, g_sampleDirtyRect.right, g_sampleDirtyRect.bottom);
	resetGxGpuVramCopyRect(g_sampleDirtyRect);
	return true;
}

void syncGxGpuSampleTextureLogicalArea(u32 x, u32 y, u32 width, u32 height, u32 vramYAddressExtensionWord) {
	u32 rowY = gxGpuVramYAddress(y, vramYAddressExtensionWord);
	u32 remainingHeight = height;
	while (remainingHeight != 0u) {
		const u32 runHeight = gxGpuVramWrappedHeight(rowY, remainingHeight, vramYAddressExtensionWord);
		u32 columnX = x & (GX_GPU_VRAM_WIDTH - 1u);
		u32 remainingWidth = width;
		while (remainingWidth != 0u) {
			const u32 runWidth = gxGpuVramWrappedWidth(columnX, remainingWidth);
			if (syncGxGpuSampleTextureArea(
				static_cast<i32>(columnX),
				static_cast<i32>(rowY),
				static_cast<i32>(columnX + runWidth),
				static_cast<i32>(rowY + runHeight))) {
				return;
			}
			columnX = (columnX + runWidth) & (GX_GPU_VRAM_WIDTH - 1u);
			remainingWidth -= runWidth;
		}
		rowY = gxGpuVramYAddress(rowY + runHeight, vramYAddressExtensionWord);
		remainingHeight -= runHeight;
	}
}

void drawGxGpuLogicalVramArea(
	const GxGpuVramCopyRect& rect,
	GLint firstVertex,
	GLsizei vertexCount,
	bool textureBarrier,
	u32 vramYAddressExtensionWord) {
	if (rect.right <= rect.left || rect.bottom <= rect.top) {
		return;
	}
	glEnable(GL_SCISSOR_TEST);
	const i32 width = rect.right - rect.left;
	glScissor(
		static_cast<GLint>(rect.left),
		static_cast<GLint>(rect.top),
		static_cast<GLsizei>(width),
		static_cast<GLsizei>(rect.bottom - rect.top));
	if (textureBarrier) {
		g_gxGpu.backend->textureBarrier();
	}
	glDrawArrays(GL_TRIANGLES, firstVertex, vertexCount);
	markGxGpuSampleTextureDirtyLogicalArea(
		static_cast<u32>(rect.left),
		static_cast<u32>(rect.top),
		static_cast<u32>(width),
		static_cast<u32>(rect.bottom - rect.top),
		vramYAddressExtensionWord);
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

u32 syncGxGpuTexturedSourceTexture(
	const GxGpuCommandBuffer& commandBuffer,
	u32 commandIndex,
	size_t vertexFloatStart,
	size_t vertexFloatEnd,
	const GxGpuVramCopyRect& commandRect,
	const GxGpuVramCopyRect& batchRect,
	bool fixedColor) {
	submitGxGpuPrimitiveBatches();
	const u32 wordStart = commandBuffer.commandWordStart[commandIndex];
	const u32 textureWord = commandBuffer.words[wordStart + 2u];
	const u32 drawModeWord = commandBuffer.commandDrawModeWord[commandIndex];
	const u32 vramYAddressExtensionWord = commandBuffer.commandVramYAddressExtensionWord[commandIndex];
	const u32 textureMode = gxGpuDrawModeTextureMode(drawModeWord);
	const u32 pageX = gxGpuDrawModeTexturePageBaseX(drawModeWord);
	const u32 pageY = gxGpuDrawModeTexturePageBaseY(drawModeWord, vramYAddressExtensionWord);
	GxGpuVramCopyRect& rect = g_vramCopyRectScratch;
	resetGxGpuVramCopyRect(rect);
	const size_t vertexFloatStride = fixedColor ? kGxGpuFixedTexturedVertexFloats : kGxGpuTexturedVertexFloats;
	const size_t planeOffset = fixedColor ? 2u : 5u;
	for (size_t offset = vertexFloatStart; offset < vertexFloatEnd; offset += vertexFloatStride) {
		const i64 x = static_cast<i64>(g_texturedVertices[offset]);
		const i64 y = static_cast<i64>(g_texturedVertices[offset + 1u]);
		const u32 u = static_cast<u32>((static_cast<i64>(g_texturedVertices[offset + planeOffset]) + static_cast<i64>(g_texturedVertices[offset + planeOffset + 2u]) * x + static_cast<i64>(g_texturedVertices[offset + planeOffset + 4u]) * y) & GX_GPU_TRIANGLE_ATTRIBUTE_ACCUMULATOR_MASK) >> GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS;
		const u32 v = static_cast<u32>((static_cast<i64>(g_texturedVertices[offset + planeOffset + 1u]) + static_cast<i64>(g_texturedVertices[offset + planeOffset + 3u]) * x + static_cast<i64>(g_texturedVertices[offset + planeOffset + 5u]) * y) & GX_GPU_TRIANGLE_ATTRIBUTE_ACCUMULATOR_MASK) >> GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS;
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
	if (gxGpuVramLogicalAreaOverlapsBounds(sourceX, sourceY, sourceWidth, sourceHeight, commandRect.left, commandRect.top, commandRect.right, commandRect.bottom, vramYAddressExtensionWord)) overlaps |= GX_GPU_TEXTURE_SOURCE_COMMAND_OVERLAP;
	if (gxGpuVramLogicalAreaOverlapsBounds(sourceX, sourceY, sourceWidth, sourceHeight, batchRect.left, batchRect.top, batchRect.right, batchRect.bottom, vramYAddressExtensionWord)) overlaps |= GX_GPU_TEXTURE_SOURCE_BATCH_OVERLAP;
	syncGxGpuSampleTextureLogicalArea(sourceX, sourceY, sourceWidth, sourceHeight, vramYAddressExtensionWord);
	if (textureMode < 2u) {
		const u32 clutX = gxGpuTextureClutBaseX(textureWord);
		const u32 clutY = gxGpuTextureClutBaseY(textureWord, vramYAddressExtensionWord);
		const u32 clutWidth = textureMode == 0u ? kGxGpuClut4BitWords : kGxGpuClut8BitWords;
		if (gxGpuVramLogicalAreaOverlapsBounds(clutX, clutY, clutWidth, 1u, commandRect.left, commandRect.top, commandRect.right, commandRect.bottom, vramYAddressExtensionWord)) overlaps |= GX_GPU_TEXTURE_SOURCE_COMMAND_OVERLAP;
		if (gxGpuVramLogicalAreaOverlapsBounds(clutX, clutY, clutWidth, 1u, batchRect.left, batchRect.top, batchRect.right, batchRect.bottom, vramYAddressExtensionWord)) overlaps |= GX_GPU_TEXTURE_SOURCE_BATCH_OVERLAP;
		syncGxGpuSampleTextureLogicalArea(clutX, clutY, clutWidth, 1u, vramYAddressExtensionWord);
	}
	return overlaps;
}

void writePrimitiveUniforms(
	GLint vramUniform,
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
	glUniform1i(vramUniform, kGxGpuTextureSampleUnit);
	glUniform1i(blendEnableUniform, blendEnabled ? 1 : 0);
	glUniform1i(blendModeUniform, static_cast<GLint>(blendMode));
	glUniform1i(checkMaskBitUniform, gxGpuMaskBitCheckBeforeDraw(maskBitModeWord) ? 1 : 0);
	glUniform1i(setMaskBitUniform, gxGpuMaskBitSetWhileDrawing(maskBitModeWord) ? 1 : 0);
	glUniform1i(ditherEnableUniform, ditherEnabled ? 1 : 0);
	glUniform1i(skippedLineParityUniform, static_cast<GLint>(skippedLineParity));
}

void writeTexturedUniforms(const GxGpuCommandBuffer& commandBuffer, u32 commandIndex, bool fixedColor) {
	const u32 opcode = commandBuffer.commandOpcode[commandIndex];
	const u32 vramYAddressExtensionWord = commandBuffer.commandVramYAddressExtensionWord[commandIndex];
	const u32 drawModeWord = commandBuffer.commandDrawModeWord[commandIndex];
	const u32 textureWord = commandBuffer.words[commandBuffer.commandWordStart[commandIndex] + 2u];
	const u32 textureWindowWord = commandBuffer.commandTextureWindowWord[commandIndex];
	const u32 maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
	const u32 texturePageY = gxGpuDrawModeTexturePageBaseY(drawModeWord, vramYAddressExtensionWord);
	const u32 clutY = gxGpuTextureClutBaseY(textureWord, vramYAddressExtensionWord);
	glUniform1i(fixedColor ? g_gxGpu.fixedTexturedVramUniform : g_gxGpu.texturedVramUniform, kGxGpuTextureSampleUnit);
	glUniform2i(fixedColor ? g_gxGpu.fixedTexturedTexPageBaseUniform : g_gxGpu.texturedTexPageBaseUniform, static_cast<GLint>(gxGpuDrawModeTexturePageBaseX(drawModeWord)), static_cast<GLint>(texturePageY));
	glUniform2i(fixedColor ? g_gxGpu.fixedTexturedClutBaseUniform : g_gxGpu.texturedClutBaseUniform, static_cast<GLint>(gxGpuTextureClutBaseX(textureWord)), static_cast<GLint>(clutY));
	glUniform2i(fixedColor ? g_gxGpu.fixedTexturedTextureWindowAndUniform : g_gxGpu.texturedTextureWindowAndUniform, static_cast<GLint>(gxGpuTextureWindowAndX(textureWindowWord)), static_cast<GLint>(gxGpuTextureWindowAndY(textureWindowWord)));
	glUniform2i(fixedColor ? g_gxGpu.fixedTexturedTextureWindowOrUniform : g_gxGpu.texturedTextureWindowOrUniform, static_cast<GLint>(gxGpuTextureWindowOrX(textureWindowWord)), static_cast<GLint>(gxGpuTextureWindowOrY(textureWindowWord)));
	glUniform1i(fixedColor ? g_gxGpu.fixedTexturedTextureModeUniform : g_gxGpu.texturedTextureModeUniform, static_cast<GLint>(gxGpuDrawModeTextureMode(drawModeWord)));
	glUniform1i(fixedColor ? g_gxGpu.fixedTexturedRawTextureUniform : g_gxGpu.texturedRawTextureUniform, gxGpuCommandRawTextureEnabled(opcode) ? 1 : 0);
	glUniform1i(fixedColor ? g_gxGpu.fixedTexturedBlendEnableUniform : g_gxGpu.texturedBlendEnableUniform, gxGpuCommandSemiTransparencyEnabled(opcode) ? 1 : 0);
	glUniform1i(fixedColor ? g_gxGpu.fixedTexturedBlendModeUniform : g_gxGpu.texturedBlendModeUniform, static_cast<GLint>(gxGpuDrawModeTransparencyMode(drawModeWord)));
	glUniform1i(fixedColor ? g_gxGpu.fixedTexturedCheckMaskBitUniform : g_gxGpu.texturedCheckMaskBitUniform, gxGpuMaskBitCheckBeforeDraw(maskBitModeWord) ? 1 : 0);
	glUniform1i(fixedColor ? g_gxGpu.fixedTexturedSetMaskBitUniform : g_gxGpu.texturedSetMaskBitUniform, gxGpuMaskBitSetWhileDrawing(maskBitModeWord) ? 1 : 0);
	glUniform1i(
		fixedColor ? g_gxGpu.fixedTexturedDitherEnableUniform : g_gxGpu.texturedDitherEnableUniform,
		commandBuffer.commandKind[commandIndex] == GX_GPU_COMMAND_DRAW_POLYGON && gxGpuDitheredPolygon(drawModeWord, opcode) ? 1 : 0);
	glUniform1i(fixedColor ? g_gxGpu.fixedTexturedSkippedLineParityUniform : g_gxGpu.texturedSkippedLineParityUniform, static_cast<GLint>(commandBuffer.commandSkippedLineParity[commandIndex]));
	glUniform1f(
		fixedColor ? g_gxGpu.fixedTexturedRasterPhaseUniform : g_gxGpu.texturedRasterPhaseUniform,
		commandBuffer.commandKind[commandIndex] == GX_GPU_COMMAND_DRAW_POLYGON ? 0.5f : 0.0f);
}

void writeTransferUniforms(i32 sourceTextureUnit, u32 maskBitModeWord) {
	glUniform1i(g_gxGpu.transferSourceUniform, sourceTextureUnit);
	glUniform1i(g_gxGpu.transferVramUniform, kGxGpuTextureSampleUnit);
	glUniform1i(g_gxGpu.transferCheckMaskBitUniform, gxGpuMaskBitCheckBeforeDraw(maskBitModeWord) ? 1 : 0);
	glUniform1i(g_gxGpu.transferSetMaskBitUniform, gxGpuMaskBitSetWhileDrawing(maskBitModeWord) ? 1 : 0);
}

void renderNewSolidCommands(bool fixedColor, size_t vertexFloatCount, GLintptr vertexBufferOffset, const GxGpuVramCopyRect& drawBounds, u32 vramYAddressExtensionWord, bool blendEnabled, u32 blendMode, u32 maskBitModeWord, bool ditherEnabled, u32 skippedLineParity, GxGpuRasterKind rasterKind);
void renderReadVramSolidQuad(bool fixedColor, u32 topLeftWord, u32 bottomRightWord, u32 vramYAddressExtensionWord, bool blendEnabled, u32 blendMode, u32 maskBitModeWord, bool ditherEnabled, u32 skippedLineParity);
size_t appendLineCommandVertices(const GxGpuCommandBuffer& commandBuffer, u32 commandIndex, size_t vertexFloatCount);
void renderTexturedCommand(const GxGpuCommandBuffer& commandBuffer, u32 commandIndex, u32 topLeftWord, u32 bottomRightWord);
size_t appendTexturedCommandVertices(const GxGpuCommandBuffer& commandBuffer, u32 commandIndex, size_t vertexFloatCount);
size_t flushTexturedCommands(const GxGpuCommandBuffer& commandBuffer, size_t vertexFloatCount, u32 batchCommandIndex);

void finishSolidBatch(
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
	if (g_primitiveSubmission.solidBatchStart != vertexFloatEnd) {
		GxGpuPrimitiveBatch& batch = g_primitiveSubmission.batches[g_primitiveSubmission.batchCount];
		batch.rasterKind = rasterKind;
		batch.vertexFloatStart = g_primitiveSubmission.solidBatchStart;
		batch.vertexFloatCount = vertexFloatEnd - g_primitiveSubmission.solidBatchStart;
		batch.drawBounds = g_solidBatchRect;
		batch.maskBitModeWord = maskBitModeWord;
		batch.blendMode = blendMode;
		batch.skippedLineParity = skippedLineParity;
		batch.vramYAddressExtensionWord = vramYAddressExtensionWord;
		batch.sampleSyncBefore = readsVram && !g_gxGpu.textureBarrier;
		batch.fixedColor = fixedColor;
		batch.blendEnabled = blendEnabled;
		batch.ditherEnabled = ditherEnabled;
		g_primitiveSubmission.batchCount += 1u;
	}
	g_primitiveSubmission.solidBatchStart = vertexFloatEnd;
	resetGxGpuVramCopyRect(g_solidBatchRect);
}

size_t appendSolidCommandVertices(const GxGpuCommandBuffer& commandBuffer, u32 commandIndex, size_t vertexFloatCount) {
	switch (commandBuffer.commandKind[commandIndex]) {
		case GX_GPU_COMMAND_DRAW_POLYGON:
			return appendSolidPolygon(commandBuffer, commandIndex, vertexFloatCount);
		case GX_GPU_COMMAND_DRAW_RECTANGLE:
			return appendSolidRectangle(commandBuffer, commandIndex, vertexFloatCount);
		default:
			return appendFillRectangle(commandBuffer, commandIndex, vertexFloatCount);
	}
}

void beginGxGpuVramRenderTarget() {
	g_gxGpu.backend->setRenderTarget(g_gxGpu.vramFramebuffer, kGxGpuVramWidth, kGxGpuVramHeight);
	glDisable(GL_DEPTH_TEST);
	glDepthMask(GL_FALSE);
	glDisable(GL_CULL_FACE);
	glDisable(GL_BLEND);
}

void renderNewLineCommands(
	size_t vertexFloatCount,
	GLintptr vertexBufferOffset,
	const GxGpuVramCopyRect& drawBounds,
	u32 vramYAddressExtensionWord,
	bool blendEnabled,
	u32 blendMode,
	u32 maskBitModeWord,
	bool ditherEnabled,
	u32 skippedLineParity) {
	const bool textureBarrier = g_gxGpu.textureBarrier
		&& (blendEnabled || gxGpuMaskBitCheckBeforeDraw(maskBitModeWord));
	const uintptr_t vertexBufferAddress = static_cast<uintptr_t>(vertexBufferOffset);
	beginGxGpuVramRenderTarget();
	glUseProgram(g_gxGpu.lineProgram);
	writePrimitiveUniforms(
		g_gxGpu.lineVramUniform,
		g_gxGpu.lineBlendEnableUniform,
		g_gxGpu.lineBlendModeUniform,
		g_gxGpu.lineCheckMaskBitUniform,
		g_gxGpu.lineSetMaskBitUniform,
		g_gxGpu.lineDitherEnableUniform,
		g_gxGpu.lineSkippedLineParityUniform,
		blendEnabled,
		blendMode,
		maskBitModeWord,
		ditherEnabled,
		skippedLineParity);
	g_gxGpu.backend->setActiveTextureUnit(kGxGpuTextureSampleUnit);
	g_gxGpu.backend->bindTexture2D(textureBarrier ? &g_gxGpu.vramTexture : &g_gxGpu.vramSampleTexture);
	glBindBuffer(GL_ARRAY_BUFFER, g_gxGpu.vertexStream.buffer);
	glEnableVertexAttribArray(static_cast<GLuint>(g_gxGpu.linePositionAttrib));
	glVertexAttribPointer(static_cast<GLuint>(g_gxGpu.linePositionAttrib), 2, GL_FLOAT, GL_FALSE, kGxGpuLineVertexStride, reinterpret_cast<const void*>(vertexBufferAddress));
	glEnableVertexAttribArray(static_cast<GLuint>(g_gxGpu.lineStartAttrib));
	glVertexAttribPointer(static_cast<GLuint>(g_gxGpu.lineStartAttrib), 2, GL_FLOAT, GL_FALSE, kGxGpuLineVertexStride, reinterpret_cast<const void*>(vertexBufferAddress + 2u * sizeof(f32)));
	glEnableVertexAttribArray(static_cast<GLuint>(g_gxGpu.lineEndAttrib));
	glVertexAttribPointer(static_cast<GLuint>(g_gxGpu.lineEndAttrib), 2, GL_FLOAT, GL_FALSE, kGxGpuLineVertexStride, reinterpret_cast<const void*>(vertexBufferAddress + 4u * sizeof(f32)));
	glEnableVertexAttribArray(static_cast<GLuint>(g_gxGpu.lineColor0Attrib));
	glVertexAttribPointer(static_cast<GLuint>(g_gxGpu.lineColor0Attrib), 3, GL_FLOAT, GL_FALSE, kGxGpuLineVertexStride, reinterpret_cast<const void*>(vertexBufferAddress + 6u * sizeof(f32)));
	glEnableVertexAttribArray(static_cast<GLuint>(g_gxGpu.lineColor1Attrib));
	glVertexAttribPointer(static_cast<GLuint>(g_gxGpu.lineColor1Attrib), 3, GL_FLOAT, GL_FALSE, kGxGpuLineVertexStride, reinterpret_cast<const void*>(vertexBufferAddress + 9u * sizeof(f32)));
	drawGxGpuLogicalVramArea(
		drawBounds,
		0,
		static_cast<GLsizei>(vertexFloatCount / kGxGpuLineVertexFloats),
		textureBarrier,
		vramYAddressExtensionWord);
	glDisable(GL_SCISSOR_TEST);
}

void finishLineBatch(size_t vertexFloatEnd) {
	if (g_primitiveSubmission.lineBatchStart != vertexFloatEnd) {
		GxGpuPrimitiveBatch& batch = g_primitiveSubmission.batches[g_primitiveSubmission.batchCount];
		batch.rasterKind = GxGpuRasterKind::Line;
		batch.vertexFloatStart = g_primitiveSubmission.lineBatchStart;
		batch.vertexFloatCount = vertexFloatEnd - g_primitiveSubmission.lineBatchStart;
		batch.drawBounds = g_lineBatchRect;
		batch.maskBitModeWord = g_lineBatchState.maskBitModeWord;
		batch.blendMode = g_lineBatchState.blendMode;
		batch.skippedLineParity = g_lineBatchState.skippedLineParity;
		batch.vramYAddressExtensionWord = g_lineBatchState.vramYAddressExtensionWord;
		batch.sampleSyncBefore = g_lineBatchState.readsVram && !g_gxGpu.textureBarrier;
		batch.fixedColor = false;
		batch.blendEnabled = g_lineBatchState.blendEnabled;
		batch.ditherEnabled = g_lineBatchState.ditherEnabled;
		g_primitiveSubmission.batchCount += 1u;
	}
	g_primitiveSubmission.lineBatchStart = vertexFloatEnd;
	resetGxGpuVramCopyRect(g_lineBatchRect);
}

void submitGxGpuPrimitiveBatches() {
	if (g_primitiveSubmission.batchCount == 0u) {
		return;
	}
	const GLsizeiptr solidByteCount = static_cast<GLsizeiptr>(g_primitiveSubmission.solidFloatCount * sizeof(f32));
	const GLsizeiptr lineByteCount = static_cast<GLsizeiptr>(g_primitiveSubmission.lineFloatCount * sizeof(f32));
	g_gxGpu.vertexStream.reserve(solidByteCount + lineByteCount);
	GLintptr solidBufferOffset = 0;
	GLintptr lineBufferOffset = 0;
	if (solidByteCount != 0) {
		solidBufferOffset = g_gxGpu.vertexStream.append(g_solidVertices.data(), solidByteCount);
	}
	if (lineByteCount != 0) {
		lineBufferOffset = g_gxGpu.vertexStream.append(g_lineVertices.data(), lineByteCount);
	}

	// Vertices stay append-only until this ordered drain. Every operation that
	// observes or mutates VRAM must drain first; otherwise its texture copy would
	// observe commands that still exist only in the retained CPU arenas.
	for (size_t batchIndex = 0u; batchIndex < g_primitiveSubmission.batchCount; batchIndex += 1u) {
		const GxGpuPrimitiveBatch& batch = g_primitiveSubmission.batches[batchIndex];
		if (batch.sampleSyncBefore) {
			syncGxGpuSampleTextureLogicalArea(
				static_cast<u32>(batch.drawBounds.left),
				static_cast<u32>(batch.drawBounds.top),
				static_cast<u32>(batch.drawBounds.right - batch.drawBounds.left),
				static_cast<u32>(batch.drawBounds.bottom - batch.drawBounds.top),
				batch.vramYAddressExtensionWord);
		}
		if (batch.rasterKind != GxGpuRasterKind::Line) {
			renderNewSolidCommands(
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
			renderNewLineCommands(
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
	g_primitiveSubmission.batchCount = 0u;
	g_primitiveSubmission.solidFloatCount = 0u;
	g_primitiveSubmission.solidBatchStart = 0u;
	g_primitiveSubmission.lineFloatCount = 0u;
	g_primitiveSubmission.lineBatchStart = 0u;
}

size_t appendBatchedLineSegment(
	size_t vertexFloatCount,
	i32 x0,
	i32 y0,
	u32 color0,
	i32 x1,
	i32 y1,
	u32 color1) {
	prepareGxGpuLineSegment(
		g_linePreparedScratch,
		x0,
		y0,
		color0,
		x1,
		y1,
		color1,
		g_lineBatchState.topLeftWord,
		g_lineBatchState.bottomRightWord,
		g_lineBatchState.vramYAddressExtensionWord);
	if (!g_linePreparedScratch.emitsVertices) {
		return vertexFloatCount;
	}
	size_t offset = vertexFloatCount;
	if (offset + kGxGpuLineSegmentFloats > kGxGpuLineFloatCapacity) {
		g_primitiveSubmission.lineFloatCount = offset;
		finishLineBatch(offset);
		submitGxGpuPrimitiveBatches();
		offset = 0u;
	}
	const size_t commandVertexStart = offset;
	offset = appendPreparedLineSegment(offset, g_linePreparedScratch);
	if (commandVertexStart != g_primitiveSubmission.lineBatchStart
		&& g_lineBatchState.readsVram
		&& gxGpuVramCopyRectsOverlap(g_lineBatchRect, g_linePreparedScratch.clippedBounds, g_lineBatchState.vramYAddressExtensionWord)) {
		finishLineBatch(commandVertexStart);
	}
	includeGxGpuVramCopyRect(g_lineBatchRect, g_linePreparedScratch.clippedBounds);
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

u32 executeGxGpuBlendPlan(const GxGpuCommandBuffer& commandBuffer, u32 commandStart, u32 commandEnd) {
	const u32 topLeftWord = commandBuffer.commandDrawingAreaTopLeftWord[commandStart];
	const u32 bottomRightWord = commandBuffer.commandDrawingAreaBottomRightWord[commandStart];
	const u32 vramYAddressExtensionWord = commandBuffer.commandVramYAddressExtensionWord[commandStart];
	g_blendPlanLayerFirst.fill(kGxGpuBlendPlanCommandEnd);
	g_blendPlanLayerLast.fill(kGxGpuBlendPlanCommandEnd);
	u16 layerCount = 0u;
	for (u32 commandIndex = commandStart; commandIndex < commandEnd; commandIndex += 1u) {
		const u16 commandOffset = static_cast<u16>(commandIndex - commandStart);
		GxGpuPreparedBlendCommand& command = g_blendPlanCommands[commandOffset];
		if (commandBuffer.commandKind[commandIndex] == GX_GPU_COMMAND_DRAW_LINE) {
			command.rasterKind = GxGpuRasterKind::Line;
			prepareGxGpuLineCommand(command.primitive, commandBuffer, commandIndex, topLeftWord, bottomRightWord, vramYAddressExtensionWord);
		} else {
			command.rasterKind = GxGpuRasterKind::Rectangle;
			prepareGxGpuSolidRectangle(command.primitive, commandBuffer, commandIndex, topLeftWord, bottomRightWord, vramYAddressExtensionWord);
		}
		if (!command.primitive.emitsVertices) {
			continue;
		}
		u16 layer = 1u;
		for (u16 previousOffset = 0u; previousOffset < commandOffset; previousOffset += 1u) {
			const GxGpuPreparedBlendCommand& previous = g_blendPlanCommands[previousOffset];
			if (previous.primitive.emitsVertices
				&& gxGpuVramCopyRectsOverlap(command.primitive.clippedBounds, previous.primitive.clippedBounds, vramYAddressExtensionWord)
				&& layer <= previous.layer) {
				layer = previous.layer + 1u;
			}
		}
		command.layer = layer;
		command.next = kGxGpuBlendPlanCommandEnd;
		if (g_blendPlanLayerFirst[layer] == kGxGpuBlendPlanCommandEnd) {
			g_blendPlanLayerFirst[layer] = commandOffset;
		} else {
			g_blendPlanCommands[g_blendPlanLayerLast[layer]].next = commandOffset;
		}
		g_blendPlanLayerLast[layer] = commandOffset;
		if (layerCount < layer) {
			layerCount = layer;
		}
	}
	if (layerCount == 0u) {
		return commandEnd;
	}
	submitGxGpuPrimitiveBatches();

	const u32 maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandStart];
	const u32 blendMode = gxGpuDrawModeTransparencyMode(commandBuffer.commandDrawModeWord[commandStart]);
	const bool ditherEnabled = commandBuffer.commandKind[commandStart] == GX_GPU_COMMAND_DRAW_LINE
		&& gxGpuDrawModeDitherEnabled(commandBuffer.commandDrawModeWord[commandStart]);
	const u32 skippedLineParity = commandBuffer.commandSkippedLineParity[commandStart];
	for (u16 layer = 1u; layer <= layerCount; layer += 1u) {
		const size_t solidFloatStart = g_primitiveSubmission.solidFloatCount;
		const size_t lineFloatStart = g_primitiveSubmission.lineFloatCount;
		resetGxGpuVramCopyRect(g_blendPlanLineBounds);
		resetGxGpuVramCopyRect(g_blendPlanSolidBounds);
		for (u16 commandOffset = g_blendPlanLayerFirst[layer]; commandOffset != kGxGpuBlendPlanCommandEnd; commandOffset = g_blendPlanCommands[commandOffset].next) {
			const GxGpuPreparedBlendCommand& command = g_blendPlanCommands[commandOffset];
			if (!command.primitive.emitsVertices) {
				continue;
			}
			if (command.rasterKind == GxGpuRasterKind::Line) {
				g_primitiveSubmission.lineFloatCount = appendPreparedLineSegment(g_primitiveSubmission.lineFloatCount, command.primitive);
				includeGxGpuVramCopyRect(g_blendPlanLineBounds, command.primitive.clippedBounds);
			} else {
				g_primitiveSubmission.solidFloatCount = appendPreparedSolidRectangle(g_primitiveSubmission.solidFloatCount, command.primitive);
				includeGxGpuVramCopyRect(g_blendPlanSolidBounds, command.primitive.clippedBounds);
			}
		}
		if (g_primitiveSubmission.lineFloatCount != lineFloatStart) {
			GxGpuPrimitiveBatch& batch = g_primitiveSubmission.batches[g_primitiveSubmission.batchCount];
			batch.rasterKind = GxGpuRasterKind::Line;
			batch.vertexFloatStart = lineFloatStart;
			batch.vertexFloatCount = g_primitiveSubmission.lineFloatCount - lineFloatStart;
			batch.drawBounds = g_blendPlanLineBounds;
			batch.maskBitModeWord = maskBitModeWord;
			batch.blendMode = blendMode;
			batch.skippedLineParity = skippedLineParity;
			batch.vramYAddressExtensionWord = vramYAddressExtensionWord;
			batch.sampleSyncBefore = true;
			batch.fixedColor = false;
			batch.blendEnabled = true;
			batch.ditherEnabled = ditherEnabled;
			g_primitiveSubmission.batchCount += 1u;
		}
		if (g_primitiveSubmission.solidFloatCount != solidFloatStart) {
			GxGpuPrimitiveBatch& batch = g_primitiveSubmission.batches[g_primitiveSubmission.batchCount];
			batch.rasterKind = GxGpuRasterKind::Rectangle;
			batch.vertexFloatStart = solidFloatStart;
			batch.vertexFloatCount = g_primitiveSubmission.solidFloatCount - solidFloatStart;
			batch.drawBounds = g_blendPlanSolidBounds;
			batch.maskBitModeWord = maskBitModeWord;
			batch.blendMode = blendMode;
			batch.skippedLineParity = skippedLineParity;
			batch.vramYAddressExtensionWord = vramYAddressExtensionWord;
			batch.sampleSyncBefore = true;
			batch.fixedColor = false;
			batch.blendEnabled = true;
			batch.ditherEnabled = false;
			g_primitiveSubmission.batchCount += 1u;
		}
	}
	submitGxGpuPrimitiveBatches();
	return commandEnd;
}

void executeNewGxGpuCommands(const GxGpuCommandBuffer& commandBuffer, size_t commandLimit) {
	u32 commandIndex = g_gxGpu.processedCommandCount;
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
	resetGxGpuVramCopyRect(g_solidBatchRect);
	resetGxGpuVramCopyRect(g_texturedBatchRect);
	resetGxGpuVramCopyRect(g_lineBatchRect);
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
				finishSolidBatch(g_primitiveSubmission.solidFloatCount, solidBatchFixedColor, solidBatchBlendEnabled, solidBatchBlendMode, solidBatchMaskBitModeWord, solidBatchVramYAddressExtensionWord, solidBatchDitherEnabled, solidBatchSkippedLineParity, solidBatchReadsVram, solidBatchRasterKind);
				texturedVertexFloatCount = flushTexturedCommands(commandBuffer, texturedVertexFloatCount, texturedBatchCommandIndex);
				finishLineBatch(g_primitiveSubmission.lineFloatCount);
				commandIndex = executeGxGpuBlendPlan(commandBuffer, commandIndex, blendPlanEnd) - 1u;
				continue;
			}
		}
		if (texturedVertexFloatCount != 0u && !commandDrawsTexture) {
			texturedVertexFloatCount = flushTexturedCommands(commandBuffer, texturedVertexFloatCount, texturedBatchCommandIndex);
		}
		if (g_primitiveSubmission.lineFloatCount != g_primitiveSubmission.lineBatchStart
			&& commandKind != GX_GPU_COMMAND_DRAW_LINE && commandKind != GX_GPU_COMMAND_DRAW_POLYLINE) {
			finishLineBatch(g_primitiveSubmission.lineFloatCount);
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
			if (g_primitiveSubmission.solidFloatCount != g_primitiveSubmission.solidBatchStart
				&& (batchStateChanged || drawsTexture || splitReadVramQuad)) {
				finishSolidBatch(g_primitiveSubmission.solidFloatCount, solidBatchFixedColor, solidBatchBlendEnabled, solidBatchBlendMode, solidBatchMaskBitModeWord, solidBatchVramYAddressExtensionWord, solidBatchDitherEnabled, solidBatchSkippedLineParity, solidBatchReadsVram, solidBatchRasterKind);
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
				const u32 textureWord = commandBuffer.words[commandBuffer.commandWordStart[commandIndex] + 2u];
				if (texturedVertexFloatCount != 0u) {
					const u32 batchDrawModeWord = commandBuffer.commandDrawModeWord[texturedBatchCommandIndex];
					const u32 batchOpcode = commandBuffer.commandOpcode[texturedBatchCommandIndex];
					const u32 batchTextureWord = commandBuffer.words[commandBuffer.commandWordStart[texturedBatchCommandIndex] + 2u];
					const bool batchDitherEnabled = commandBuffer.commandKind[texturedBatchCommandIndex] == GX_GPU_COMMAND_DRAW_POLYGON && gxGpuDitheredPolygon(batchDrawModeWord, batchOpcode);
					const bool batchFixedTexturedColor = commandBuffer.commandKind[texturedBatchCommandIndex] == GX_GPU_COMMAND_DRAW_POLYGON
						&& gxGpuCommandGouraud(batchOpcode)
						&& !gxGpuCommandRawTextureEnabled(batchOpcode);
					const bool batchStateChanged = topLeftWord != commandBuffer.commandDrawingAreaTopLeftWord[texturedBatchCommandIndex]
						|| bottomRightWord != commandBuffer.commandDrawingAreaBottomRightWord[texturedBatchCommandIndex]
						|| vramYAddressExtensionWord != commandBuffer.commandVramYAddressExtensionWord[texturedBatchCommandIndex]
						|| commandKind != commandBuffer.commandKind[texturedBatchCommandIndex]
						|| drawModeWord != batchDrawModeWord
						|| commandBuffer.commandTextureWindowWord[commandIndex] != commandBuffer.commandTextureWindowWord[texturedBatchCommandIndex]
						|| maskBitModeWord != commandBuffer.commandMaskBitModeWord[texturedBatchCommandIndex]
						|| skippedLineParity != commandBuffer.commandSkippedLineParity[texturedBatchCommandIndex]
						|| (textureWord >> 16u) != (batchTextureWord >> 16u)
						|| gxGpuCommandRawTextureEnabled(opcode) != gxGpuCommandRawTextureEnabled(batchOpcode)
						|| gxGpuCommandSemiTransparencyEnabled(opcode) != gxGpuCommandSemiTransparencyEnabled(batchOpcode)
						|| ditherEnabled != batchDitherEnabled
						|| fixedTexturedColor != batchFixedTexturedColor;
					if (batchStateChanged) {
						texturedVertexFloatCount = flushTexturedCommands(commandBuffer, texturedVertexFloatCount, texturedBatchCommandIndex);
					}
				}
				if (texturedVertexFloatCount == 0u) {
					texturedBatchCommandIndex = commandIndex;
				}
				size_t texturedCommandVertexStart = texturedVertexFloatCount;
				texturedVertexFloatCount = appendTexturedCommandVertices(commandBuffer, commandIndex, texturedVertexFloatCount);
				if (texturedVertexFloatCount != texturedCommandVertexStart) {
					const size_t texturedVertexFloatStride = fixedTexturedColor ? kGxGpuFixedTexturedVertexFloats : kGxGpuTexturedVertexFloats;
					setGxGpuVertexBoundsRect(g_texturedCommandRect, g_texturedVertices.data(), texturedCommandVertexStart, texturedVertexFloatCount, texturedVertexFloatStride, topLeftWord, bottomRightWord, vramYAddressExtensionWord);
					u32 sourceOverlaps = syncGxGpuTexturedSourceTexture(commandBuffer, commandIndex, texturedCommandVertexStart, texturedVertexFloatCount, g_texturedCommandRect, g_texturedBatchRect, fixedTexturedColor);
					if ((sourceOverlaps & GX_GPU_TEXTURE_SOURCE_BATCH_OVERLAP) != 0u) {
						texturedVertexFloatCount = flushTexturedCommands(commandBuffer, texturedCommandVertexStart, texturedBatchCommandIndex);
						texturedBatchCommandIndex = commandIndex;
						texturedCommandVertexStart = 0u;
						texturedVertexFloatCount = appendTexturedCommandVertices(commandBuffer, commandIndex, 0u);
						setGxGpuVertexBoundsRect(g_texturedCommandRect, g_texturedVertices.data(), 0u, texturedVertexFloatCount, texturedVertexFloatStride, topLeftWord, bottomRightWord, vramYAddressExtensionWord);
						sourceOverlaps = syncGxGpuTexturedSourceTexture(commandBuffer, commandIndex, 0u, texturedVertexFloatCount, g_texturedCommandRect, g_texturedBatchRect, fixedTexturedColor);
					}
					if ((sourceOverlaps & GX_GPU_TEXTURE_SOURCE_COMMAND_OVERLAP) != 0u) {
						if (texturedCommandVertexStart != 0u) {
							texturedVertexFloatCount = flushTexturedCommands(commandBuffer, texturedCommandVertexStart, texturedBatchCommandIndex);
						}
						texturedVertexFloatCount = 0u;
						resetGxGpuVramCopyRect(g_texturedBatchRect);
						renderTexturedCommand(commandBuffer, commandIndex, topLeftWord, bottomRightWord);
					} else {
						includeGxGpuVramCopyRect(g_texturedBatchRect, g_texturedCommandRect);
					}
				}
			} else {
				const size_t commandVertexStart = g_primitiveSubmission.solidFloatCount;
				g_primitiveSubmission.solidFloatCount = appendSolidCommandVertices(commandBuffer, commandIndex, g_primitiveSubmission.solidFloatCount);
				const size_t vertexFloatStride = fixedSolidColor ? kGxGpuFixedSolidVertexFloats : kGxGpuSolidVertexFloats;
				if (g_primitiveSubmission.solidFloatCount != commandVertexStart) {
					setGxGpuVertexBoundsRect(g_solidCommandRect, g_solidVertices.data(), commandVertexStart, g_primitiveSubmission.solidFloatCount, vertexFloatStride, topLeftWord, bottomRightWord, vramYAddressExtensionWord);
					if (splitReadVramQuad && g_primitiveSubmission.solidFloatCount - commandVertexStart == (fixedSolidColor ? kGxGpuFixedSolidTriangleFloats : kGxGpuSolidTriangleFloats) * 2u) {
						g_primitiveSubmission.solidFloatCount = commandVertexStart;
						submitGxGpuPrimitiveBatches();
						g_primitiveSubmission.solidFloatCount = appendSolidCommandVertices(commandBuffer, commandIndex, 0u);
						renderReadVramSolidQuad(fixedSolidColor, topLeftWord, bottomRightWord, vramYAddressExtensionWord, blendEnabled, blendMode, maskBitModeWord, ditherEnabled, skippedLineParity);
						g_primitiveSubmission.solidFloatCount = 0u;
						g_primitiveSubmission.solidBatchStart = 0u;
					} else {
						if (readsVram && commandVertexStart != g_primitiveSubmission.solidBatchStart && gxGpuVramCopyRectsOverlap(g_solidBatchRect, g_solidCommandRect, vramYAddressExtensionWord)) {
							finishSolidBatch(commandVertexStart, solidBatchFixedColor, solidBatchBlendEnabled, solidBatchBlendMode, solidBatchMaskBitModeWord, solidBatchVramYAddressExtensionWord, solidBatchDitherEnabled, solidBatchSkippedLineParity, solidBatchReadsVram, solidBatchRasterKind);
						}
						includeGxGpuVramCopyRect(g_solidBatchRect, g_solidCommandRect);
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
			if (g_primitiveSubmission.solidFloatCount != g_primitiveSubmission.solidBatchStart
				&& (solidBatchTopLeftWord != topLeftWord || solidBatchBottomRightWord != bottomRightWord || solidBatchVramYAddressExtensionWord != vramYAddressExtensionWord || batchMaskChange || solidBatchDitherEnabled || solidBatchSkippedLineParity != skippedLineParity || solidBatchBlendEnabled || solidBatchReadsVram || solidBatchFixedColor || solidBatchRasterKind != GxGpuRasterKind::Rectangle)) {
				finishSolidBatch(g_primitiveSubmission.solidFloatCount, solidBatchFixedColor, solidBatchBlendEnabled, solidBatchBlendMode, solidBatchMaskBitModeWord, solidBatchVramYAddressExtensionWord, solidBatchDitherEnabled, solidBatchSkippedLineParity, solidBatchReadsVram, solidBatchRasterKind);
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
			const size_t commandVertexStart = g_primitiveSubmission.solidFloatCount;
			g_primitiveSubmission.solidFloatCount = appendFillRectangle(commandBuffer, commandIndex, commandVertexStart);
			if (g_primitiveSubmission.solidFloatCount != commandVertexStart) {
				setGxGpuVertexBoundsRect(
					g_solidCommandRect,
					g_solidVertices.data(),
					commandVertexStart,
					g_primitiveSubmission.solidFloatCount,
					kGxGpuSolidVertexFloats,
					topLeftWord,
					bottomRightWord,
					vramYAddressExtensionWord);
				includeGxGpuVramCopyRect(g_solidBatchRect, g_solidCommandRect);
			}
			break;
		}
		case GX_GPU_COMMAND_DRAW_LINE:
		case GX_GPU_COMMAND_DRAW_POLYLINE: {
			finishSolidBatch(g_primitiveSubmission.solidFloatCount, solidBatchFixedColor, solidBatchBlendEnabled, solidBatchBlendMode, solidBatchMaskBitModeWord, solidBatchVramYAddressExtensionWord, solidBatchDitherEnabled, solidBatchSkippedLineParity, solidBatchReadsVram, solidBatchRasterKind);
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
			if (g_primitiveSubmission.lineFloatCount != g_primitiveSubmission.lineBatchStart && (topLeftWord != g_lineBatchState.topLeftWord
				|| bottomRightWord != g_lineBatchState.bottomRightWord
				|| vramYAddressExtensionWord != g_lineBatchState.vramYAddressExtensionWord
				|| maskBitModeWord != g_lineBatchState.maskBitModeWord
				|| ditherEnabled != g_lineBatchState.ditherEnabled
				|| skippedLineParity != g_lineBatchState.skippedLineParity
				|| blendEnabled != g_lineBatchState.blendEnabled
				|| blendMode != g_lineBatchState.blendMode
				|| readsVram != g_lineBatchState.readsVram)) {
				finishLineBatch(g_primitiveSubmission.lineFloatCount);
			}
			g_lineBatchState.topLeftWord = topLeftWord;
			g_lineBatchState.bottomRightWord = bottomRightWord;
			g_lineBatchState.vramYAddressExtensionWord = vramYAddressExtensionWord;
			g_lineBatchState.maskBitModeWord = maskBitModeWord;
			g_lineBatchState.ditherEnabled = ditherEnabled;
			g_lineBatchState.skippedLineParity = skippedLineParity;
			g_lineBatchState.blendEnabled = blendEnabled;
			g_lineBatchState.blendMode = blendMode;
			g_lineBatchState.readsVram = readsVram;
			g_primitiveSubmission.lineFloatCount = appendLineCommandVertices(commandBuffer, commandIndex, g_primitiveSubmission.lineFloatCount);
			break;
		}
		case GX_GPU_COMMAND_COPY_VRAM_TO_VRAM:
			finishSolidBatch(g_primitiveSubmission.solidFloatCount, solidBatchFixedColor, solidBatchBlendEnabled, solidBatchBlendMode, solidBatchMaskBitModeWord, solidBatchVramYAddressExtensionWord, solidBatchDitherEnabled, solidBatchSkippedLineParity, solidBatchReadsVram, solidBatchRasterKind);
			submitGxGpuPrimitiveBatches();
			copyVramToVram(commandBuffer, commandIndex);
			break;
		case GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM:
			finishSolidBatch(g_primitiveSubmission.solidFloatCount, solidBatchFixedColor, solidBatchBlendEnabled, solidBatchBlendMode, solidBatchMaskBitModeWord, solidBatchVramYAddressExtensionWord, solidBatchDitherEnabled, solidBatchSkippedLineParity, solidBatchReadsVram, solidBatchRasterKind);
			submitGxGpuPrimitiveBatches();
			uploadCpuToVram(commandBuffer, commandIndex);
			break;
		}
	}
	g_gxGpu.processedCommandCount = commandIndex;
	finishSolidBatch(g_primitiveSubmission.solidFloatCount, solidBatchFixedColor, solidBatchBlendEnabled, solidBatchBlendMode, solidBatchMaskBitModeWord, solidBatchVramYAddressExtensionWord, solidBatchDitherEnabled, solidBatchSkippedLineParity, solidBatchReadsVram, solidBatchRasterKind);
	flushTexturedCommands(commandBuffer, texturedVertexFloatCount, texturedBatchCommandIndex);
	finishLineBatch(g_primitiveSubmission.lineFloatCount);
	submitGxGpuPrimitiveBatches();
}

size_t appendLineCommandVertices(
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
			vertexFloatCount = appendBatchedLineSegment(
				vertexFloatCount,
				dx + gxGpuSigned11(xy0),
				dy + gxGpuVertexY(xy0),
				color0,
				dx + gxGpuSigned11(xy1),
				dy + gxGpuVertexY(xy1),
				color1);
		} else {
			const u32 xy1 = commandBuffer.words[wordStart + 2u];
			vertexFloatCount = appendBatchedLineSegment(
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
			vertexFloatCount = appendBatchedLineSegment(
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
			vertexFloatCount = appendBatchedLineSegment(
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

void renderNewSolidCommands(bool fixedColor, size_t vertexFloatCount, GLintptr vertexBufferOffset, const GxGpuVramCopyRect& drawBounds, u32 vramYAddressExtensionWord, bool blendEnabled, u32 blendMode, u32 maskBitModeWord, bool ditherEnabled, u32 skippedLineParity, GxGpuRasterKind rasterKind) {
	const bool textureBarrier = g_gxGpu.textureBarrier
		&& (blendEnabled || gxGpuMaskBitCheckBeforeDraw(maskBitModeWord));
	const size_t vertexFloatStride = fixedColor ? kGxGpuFixedSolidVertexFloats : kGxGpuSolidVertexFloats;
	const uintptr_t vertexBufferAddress = static_cast<uintptr_t>(vertexBufferOffset);
	beginGxGpuVramRenderTarget();
	glUseProgram(fixedColor ? g_gxGpu.fixedSolidProgram : g_gxGpu.solidProgram);
	glUniform1f(fixedColor ? g_gxGpu.fixedSolidRasterPhaseUniform : g_gxGpu.solidRasterPhaseUniform, rasterKind == GxGpuRasterKind::Polygon ? 0.5f : 0.0f);
	writePrimitiveUniforms(
		fixedColor ? g_gxGpu.fixedSolidVramUniform : g_gxGpu.solidVramUniform,
		fixedColor ? g_gxGpu.fixedSolidBlendEnableUniform : g_gxGpu.solidBlendEnableUniform,
		fixedColor ? g_gxGpu.fixedSolidBlendModeUniform : g_gxGpu.solidBlendModeUniform,
		fixedColor ? g_gxGpu.fixedSolidCheckMaskBitUniform : g_gxGpu.solidCheckMaskBitUniform,
		fixedColor ? g_gxGpu.fixedSolidSetMaskBitUniform : g_gxGpu.solidSetMaskBitUniform,
		fixedColor ? g_gxGpu.fixedSolidDitherEnableUniform : g_gxGpu.solidDitherEnableUniform,
		fixedColor ? g_gxGpu.fixedSolidSkippedLineParityUniform : g_gxGpu.solidSkippedLineParityUniform,
		blendEnabled,
		blendMode,
		maskBitModeWord,
		ditherEnabled,
		skippedLineParity);
	g_gxGpu.backend->setActiveTextureUnit(kGxGpuTextureSampleUnit);
	g_gxGpu.backend->bindTexture2D(textureBarrier ? &g_gxGpu.vramTexture : &g_gxGpu.vramSampleTexture);
	glBindBuffer(GL_ARRAY_BUFFER, g_gxGpu.vertexStream.buffer);
	if (fixedColor) {
		glEnableVertexAttribArray(static_cast<GLuint>(g_gxGpu.fixedSolidPositionAttrib));
		glVertexAttribPointer(static_cast<GLuint>(g_gxGpu.fixedSolidPositionAttrib), 2, GL_FLOAT, GL_FALSE, kGxGpuFixedSolidVertexStride, reinterpret_cast<const void*>(vertexBufferAddress));
		glEnableVertexAttribArray(static_cast<GLuint>(g_gxGpu.fixedSolidColorPlaneBaseAttrib));
		glVertexAttribPointer(static_cast<GLuint>(g_gxGpu.fixedSolidColorPlaneBaseAttrib), 3, GL_FLOAT, GL_FALSE, kGxGpuFixedSolidVertexStride, reinterpret_cast<const void*>(vertexBufferAddress + 2u * sizeof(f32)));
		glEnableVertexAttribArray(static_cast<GLuint>(g_gxGpu.fixedSolidColorPlaneStepXAttrib));
		glVertexAttribPointer(static_cast<GLuint>(g_gxGpu.fixedSolidColorPlaneStepXAttrib), 3, GL_FLOAT, GL_FALSE, kGxGpuFixedSolidVertexStride, reinterpret_cast<const void*>(vertexBufferAddress + 5u * sizeof(f32)));
		glEnableVertexAttribArray(static_cast<GLuint>(g_gxGpu.fixedSolidColorPlaneStepYAttrib));
		glVertexAttribPointer(static_cast<GLuint>(g_gxGpu.fixedSolidColorPlaneStepYAttrib), 3, GL_FLOAT, GL_FALSE, kGxGpuFixedSolidVertexStride, reinterpret_cast<const void*>(vertexBufferAddress + 8u * sizeof(f32)));
	} else {
		glEnableVertexAttribArray(static_cast<GLuint>(g_gxGpu.solidPositionAttrib));
		glVertexAttribPointer(static_cast<GLuint>(g_gxGpu.solidPositionAttrib), 2, GL_FLOAT, GL_FALSE, kGxGpuSolidVertexStride, reinterpret_cast<const void*>(vertexBufferAddress));
		glEnableVertexAttribArray(static_cast<GLuint>(g_gxGpu.solidColorAttrib));
		glVertexAttribPointer(static_cast<GLuint>(g_gxGpu.solidColorAttrib), 4, GL_FLOAT, GL_FALSE, kGxGpuSolidVertexStride, reinterpret_cast<const void*>(vertexBufferAddress + 2u * sizeof(f32)));
	}
	drawGxGpuLogicalVramArea(
		drawBounds,
		0,
		static_cast<GLsizei>(vertexFloatCount / vertexFloatStride),
		textureBarrier,
		vramYAddressExtensionWord);
	glDisable(GL_SCISSOR_TEST);
}

void renderReadVramSolidQuad(bool fixedColor, u32 topLeftWord, u32 bottomRightWord, u32 vramYAddressExtensionWord, bool blendEnabled, u32 blendMode, u32 maskBitModeWord, bool ditherEnabled, u32 skippedLineParity) {
	const size_t triangleFloatCount = fixedColor ? kGxGpuFixedSolidTriangleFloats : kGxGpuSolidTriangleFloats;
	const size_t vertexFloatStride = fixedColor ? kGxGpuFixedSolidVertexFloats : kGxGpuSolidVertexFloats;
	const GLsizeiptr vertexByteCount = static_cast<GLsizeiptr>(triangleFloatCount * 2u * sizeof(f32));
	g_gxGpu.vertexStream.reserve(vertexByteCount);
	const GLintptr vertexBufferOffset = g_gxGpu.vertexStream.append(g_solidVertices.data(), vertexByteCount);
	setGxGpuVertexBoundsRect(g_solidCommandRect, g_solidVertices.data(), 0u, triangleFloatCount, vertexFloatStride, topLeftWord, bottomRightWord, vramYAddressExtensionWord);
	if (!g_gxGpu.textureBarrier) {
		syncGxGpuSampleTextureLogicalArea(
			static_cast<u32>(g_solidCommandRect.left),
			static_cast<u32>(g_solidCommandRect.top),
			static_cast<u32>(g_solidCommandRect.right - g_solidCommandRect.left),
			static_cast<u32>(g_solidCommandRect.bottom - g_solidCommandRect.top),
			vramYAddressExtensionWord);
	}
	renderNewSolidCommands(fixedColor, triangleFloatCount, vertexBufferOffset, g_solidCommandRect, vramYAddressExtensionWord, blendEnabled, blendMode, maskBitModeWord, ditherEnabled, skippedLineParity, GxGpuRasterKind::Polygon);
	setGxGpuVertexBoundsRect(g_solidCommandRect, g_solidVertices.data(), triangleFloatCount, triangleFloatCount * 2u, vertexFloatStride, topLeftWord, bottomRightWord, vramYAddressExtensionWord);
	if (!g_gxGpu.textureBarrier) {
		syncGxGpuSampleTextureLogicalArea(
			static_cast<u32>(g_solidCommandRect.left),
			static_cast<u32>(g_solidCommandRect.top),
			static_cast<u32>(g_solidCommandRect.right - g_solidCommandRect.left),
			static_cast<u32>(g_solidCommandRect.bottom - g_solidCommandRect.top),
			vramYAddressExtensionWord);
	}
	renderNewSolidCommands(fixedColor, triangleFloatCount, vertexBufferOffset + static_cast<GLintptr>(triangleFloatCount * sizeof(f32)), g_solidCommandRect, vramYAddressExtensionWord, blendEnabled, blendMode, maskBitModeWord, ditherEnabled, skippedLineParity, GxGpuRasterKind::Polygon);
}

void renderTransferCommands(size_t vertexFloatCount, GLES2Texture& sourceTexture, i32 sourceTextureUnit, u32 maskBitModeWord) {
	const GLsizeiptr vertexByteCount = static_cast<GLsizeiptr>(vertexFloatCount * sizeof(f32));
	g_gxGpu.vertexStream.reserve(vertexByteCount);
	const GLintptr vertexBufferOffset = g_gxGpu.vertexStream.append(g_transferVertices.data(), vertexByteCount);
	const uintptr_t vertexBufferAddress = static_cast<uintptr_t>(vertexBufferOffset);
	beginGxGpuVramRenderTarget();
	glDisable(GL_SCISSOR_TEST);
	glUseProgram(g_gxGpu.transferProgram);
	writeTransferUniforms(sourceTextureUnit, maskBitModeWord);
	g_gxGpu.backend->setActiveTextureUnit(sourceTextureUnit);
	g_gxGpu.backend->bindTexture2D(&sourceTexture);
	g_gxGpu.backend->setActiveTextureUnit(kGxGpuTextureSampleUnit);
	g_gxGpu.backend->bindTexture2D(&g_gxGpu.vramSampleTexture);
	glBindBuffer(GL_ARRAY_BUFFER, g_gxGpu.vertexStream.buffer);
	glEnableVertexAttribArray(static_cast<GLuint>(g_gxGpu.transferPositionAttrib));
	glVertexAttribPointer(static_cast<GLuint>(g_gxGpu.transferPositionAttrib), 2, GL_FLOAT, GL_FALSE, kGxGpuTransferVertexStride, reinterpret_cast<const void*>(vertexBufferAddress));
	glEnableVertexAttribArray(static_cast<GLuint>(g_gxGpu.transferSourceOffsetAttrib));
	glVertexAttribPointer(static_cast<GLuint>(g_gxGpu.transferSourceOffsetAttrib), 2, GL_FLOAT, GL_FALSE, kGxGpuTransferVertexStride, reinterpret_cast<const void*>(vertexBufferAddress + 2u * sizeof(f32)));
	glDrawArrays(GL_TRIANGLES, 0, static_cast<GLsizei>(vertexFloatCount / kGxGpuTransferVertexFloats));
}

size_t appendTexturedCommandVertices(const GxGpuCommandBuffer& commandBuffer, u32 commandIndex, size_t vertexFloatCount) {
	return commandBuffer.commandKind[commandIndex] == GX_GPU_COMMAND_DRAW_POLYGON
		? appendTexturedPolygon(commandBuffer, commandIndex, vertexFloatCount)
		: appendTexturedRectangle(commandBuffer, commandIndex, vertexFloatCount);
}

void renderTexturedVertices(
	const GxGpuCommandBuffer& commandBuffer,
	u32 commandIndex,
	size_t vertexFloatCount,
	u32 topLeftWord,
	u32 bottomRightWord,
	bool textureBarrier,
	bool splitTriangles,
	bool syncSourceBetweenTriangles) {
	const u32 vramYAddressExtensionWord = commandBuffer.commandVramYAddressExtensionWord[commandIndex];
	const u32 opcode = commandBuffer.commandOpcode[commandIndex];
	const bool fixedColor = commandBuffer.commandKind[commandIndex] == GX_GPU_COMMAND_DRAW_POLYGON
		&& gxGpuCommandGouraud(opcode)
		&& !gxGpuCommandRawTextureEnabled(opcode);
	const size_t vertexFloatStride = fixedColor ? kGxGpuFixedTexturedVertexFloats : kGxGpuTexturedVertexFloats;
	submitGxGpuPrimitiveBatches();
	const GLsizeiptr vertexByteCount = static_cast<GLsizeiptr>(vertexFloatCount * sizeof(f32));
	g_gxGpu.vertexStream.reserve(vertexByteCount);
	const GLintptr vertexBufferOffset = g_gxGpu.vertexStream.append(g_texturedVertices.data(), vertexByteCount);
	const uintptr_t vertexBufferAddress = static_cast<uintptr_t>(vertexBufferOffset);
	beginGxGpuVramRenderTarget();
	glUseProgram(fixedColor ? g_gxGpu.fixedTexturedProgram : g_gxGpu.texturedProgram);
	writeTexturedUniforms(commandBuffer, commandIndex, fixedColor);
	g_gxGpu.backend->setActiveTextureUnit(kGxGpuTextureSampleUnit);
	g_gxGpu.backend->bindTexture2D(textureBarrier ? &g_gxGpu.vramTexture : &g_gxGpu.vramSampleTexture);
	glBindBuffer(GL_ARRAY_BUFFER, g_gxGpu.vertexStream.buffer);
	if (fixedColor) {
		glEnableVertexAttribArray(static_cast<GLuint>(g_gxGpu.fixedTexturedPositionAttrib));
		glVertexAttribPointer(static_cast<GLuint>(g_gxGpu.fixedTexturedPositionAttrib), 2, GL_FLOAT, GL_FALSE, kGxGpuFixedTexturedVertexStride, reinterpret_cast<const void*>(vertexBufferAddress));
		glEnableVertexAttribArray(static_cast<GLuint>(g_gxGpu.fixedTexturedUvPlaneBaseAttrib));
		glVertexAttribPointer(static_cast<GLuint>(g_gxGpu.fixedTexturedUvPlaneBaseAttrib), 2, GL_FLOAT, GL_FALSE, kGxGpuFixedTexturedVertexStride, reinterpret_cast<const void*>(vertexBufferAddress + 2u * sizeof(f32)));
		glEnableVertexAttribArray(static_cast<GLuint>(g_gxGpu.fixedTexturedUvPlaneStepXAttrib));
		glVertexAttribPointer(static_cast<GLuint>(g_gxGpu.fixedTexturedUvPlaneStepXAttrib), 2, GL_FLOAT, GL_FALSE, kGxGpuFixedTexturedVertexStride, reinterpret_cast<const void*>(vertexBufferAddress + 4u * sizeof(f32)));
		glEnableVertexAttribArray(static_cast<GLuint>(g_gxGpu.fixedTexturedUvPlaneStepYAttrib));
		glVertexAttribPointer(static_cast<GLuint>(g_gxGpu.fixedTexturedUvPlaneStepYAttrib), 2, GL_FLOAT, GL_FALSE, kGxGpuFixedTexturedVertexStride, reinterpret_cast<const void*>(vertexBufferAddress + 6u * sizeof(f32)));
		glEnableVertexAttribArray(static_cast<GLuint>(g_gxGpu.fixedTexturedColorPlaneBaseAttrib));
		glVertexAttribPointer(static_cast<GLuint>(g_gxGpu.fixedTexturedColorPlaneBaseAttrib), 3, GL_FLOAT, GL_FALSE, kGxGpuFixedTexturedVertexStride, reinterpret_cast<const void*>(vertexBufferAddress + 8u * sizeof(f32)));
		glEnableVertexAttribArray(static_cast<GLuint>(g_gxGpu.fixedTexturedColorPlaneStepXAttrib));
		glVertexAttribPointer(static_cast<GLuint>(g_gxGpu.fixedTexturedColorPlaneStepXAttrib), 3, GL_FLOAT, GL_FALSE, kGxGpuFixedTexturedVertexStride, reinterpret_cast<const void*>(vertexBufferAddress + 11u * sizeof(f32)));
		glEnableVertexAttribArray(static_cast<GLuint>(g_gxGpu.fixedTexturedColorPlaneStepYAttrib));
		glVertexAttribPointer(static_cast<GLuint>(g_gxGpu.fixedTexturedColorPlaneStepYAttrib), 3, GL_FLOAT, GL_FALSE, kGxGpuFixedTexturedVertexStride, reinterpret_cast<const void*>(vertexBufferAddress + 14u * sizeof(f32)));
	} else {
		glEnableVertexAttribArray(static_cast<GLuint>(g_gxGpu.texturedPositionAttrib));
		glVertexAttribPointer(static_cast<GLuint>(g_gxGpu.texturedPositionAttrib), 2, GL_FLOAT, GL_FALSE, kGxGpuTexturedVertexStride, reinterpret_cast<const void*>(vertexBufferAddress));
		glEnableVertexAttribArray(static_cast<GLuint>(g_gxGpu.texturedColorAttrib));
		glVertexAttribPointer(static_cast<GLuint>(g_gxGpu.texturedColorAttrib), 3, GL_FLOAT, GL_FALSE, kGxGpuTexturedVertexStride, reinterpret_cast<const void*>(vertexBufferAddress + 2u * sizeof(f32)));
		glEnableVertexAttribArray(static_cast<GLuint>(g_gxGpu.texturedUvPlaneBaseAttrib));
		glVertexAttribPointer(static_cast<GLuint>(g_gxGpu.texturedUvPlaneBaseAttrib), 2, GL_FLOAT, GL_FALSE, kGxGpuTexturedVertexStride, reinterpret_cast<const void*>(vertexBufferAddress + 5u * sizeof(f32)));
		glEnableVertexAttribArray(static_cast<GLuint>(g_gxGpu.texturedUvPlaneStepXAttrib));
		glVertexAttribPointer(static_cast<GLuint>(g_gxGpu.texturedUvPlaneStepXAttrib), 2, GL_FLOAT, GL_FALSE, kGxGpuTexturedVertexStride, reinterpret_cast<const void*>(vertexBufferAddress + 7u * sizeof(f32)));
		glEnableVertexAttribArray(static_cast<GLuint>(g_gxGpu.texturedUvPlaneStepYAttrib));
		glVertexAttribPointer(static_cast<GLuint>(g_gxGpu.texturedUvPlaneStepYAttrib), 2, GL_FLOAT, GL_FALSE, kGxGpuTexturedVertexStride, reinterpret_cast<const void*>(vertexBufferAddress + 9u * sizeof(f32)));
	}
	if (!splitTriangles) {
		drawGxGpuLogicalVramArea(
			g_texturedCommandRect,
			0,
			static_cast<GLsizei>(vertexFloatCount / vertexFloatStride),
			textureBarrier,
			vramYAddressExtensionWord);
	} else {
		const u32 maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
		const bool readsVram = gxGpuCommandSemiTransparencyEnabled(opcode) || gxGpuMaskBitCheckBeforeDraw(maskBitModeWord);
		const size_t triangleFloatCount = 3u * vertexFloatStride;
		for (size_t vertexFloatStart = 0u; vertexFloatStart < vertexFloatCount; vertexFloatStart += triangleFloatCount) {
			if (vertexFloatStart != 0u && syncSourceBetweenTriangles && !textureBarrier) {
				syncGxGpuTexturedSourceTexture(commandBuffer, commandIndex, 0u, vertexFloatCount, g_texturedCommandRect, g_texturedBatchRect, fixedColor);
			}
			const size_t vertexFloatEnd = vertexFloatStart + triangleFloatCount;
			setGxGpuVertexBoundsRect(g_vramCopyRectScratch, g_texturedVertices.data(), vertexFloatStart, vertexFloatEnd, vertexFloatStride, topLeftWord, bottomRightWord, vramYAddressExtensionWord);
			if (readsVram && vertexFloatStart != 0u && !textureBarrier) {
				syncGxGpuSampleTextureLogicalArea(
					static_cast<u32>(g_vramCopyRectScratch.left),
					static_cast<u32>(g_vramCopyRectScratch.top),
					static_cast<u32>(g_vramCopyRectScratch.right - g_vramCopyRectScratch.left),
					static_cast<u32>(g_vramCopyRectScratch.bottom - g_vramCopyRectScratch.top),
					vramYAddressExtensionWord);
			}
			drawGxGpuLogicalVramArea(
				g_vramCopyRectScratch,
				static_cast<GLint>(vertexFloatStart / vertexFloatStride),
				3,
				textureBarrier,
				vramYAddressExtensionWord);
		}
	}
	glDisable(GL_SCISSOR_TEST);
}

void renderTexturedCommand(
	const GxGpuCommandBuffer& commandBuffer,
	u32 commandIndex,
	u32 topLeftWord,
	u32 bottomRightWord) {
	const size_t vertexFloatCount = appendTexturedCommandVertices(commandBuffer, commandIndex, 0u);
	if (vertexFloatCount == 0u) {
		return;
	}
	const u32 opcode = commandBuffer.commandOpcode[commandIndex];
	const u32 vramYAddressExtensionWord = commandBuffer.commandVramYAddressExtensionWord[commandIndex];
	const bool fixedColor = commandBuffer.commandKind[commandIndex] == GX_GPU_COMMAND_DRAW_POLYGON
		&& gxGpuCommandGouraud(opcode)
		&& !gxGpuCommandRawTextureEnabled(opcode);
	setGxGpuVertexBoundsRect(
		g_texturedCommandRect,
		g_texturedVertices.data(),
		0u,
		vertexFloatCount,
		fixedColor ? kGxGpuFixedTexturedVertexFloats : kGxGpuTexturedVertexFloats,
		topLeftWord,
		bottomRightWord,
		vramYAddressExtensionWord);
	const u32 maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
	const bool readsVram = gxGpuCommandSemiTransparencyEnabled(opcode) || gxGpuMaskBitCheckBeforeDraw(maskBitModeWord);
	const u32 sourceOverlaps = syncGxGpuTexturedSourceTexture(commandBuffer, commandIndex, 0u, vertexFloatCount, g_texturedCommandRect, g_texturedBatchRect, fixedColor);
	const bool sourceOverlapsDestination = (sourceOverlaps & GX_GPU_TEXTURE_SOURCE_COMMAND_OVERLAP) != 0u;
	const bool textureBarrier = g_gxGpu.textureBarrier && !sourceOverlapsDestination;
	if (readsVram && !textureBarrier) {
		syncGxGpuSampleTextureLogicalArea(
			static_cast<u32>(g_texturedCommandRect.left),
			static_cast<u32>(g_texturedCommandRect.top),
			static_cast<u32>(g_texturedCommandRect.right - g_texturedCommandRect.left),
			static_cast<u32>(g_texturedCommandRect.bottom - g_texturedCommandRect.top),
			vramYAddressExtensionWord);
	}
	renderTexturedVertices(
		commandBuffer,
		commandIndex,
		vertexFloatCount,
		topLeftWord,
		bottomRightWord,
		textureBarrier,
		commandBuffer.commandKind[commandIndex] == GX_GPU_COMMAND_DRAW_POLYGON,
		sourceOverlapsDestination);
}

size_t flushTexturedCommands(const GxGpuCommandBuffer& commandBuffer, size_t vertexFloatCount, u32 batchCommandIndex) {
	if (vertexFloatCount != 0u) {
		const u32 topLeftWord = commandBuffer.commandDrawingAreaTopLeftWord[batchCommandIndex];
		const u32 bottomRightWord = commandBuffer.commandDrawingAreaBottomRightWord[batchCommandIndex];
		const u32 opcode = commandBuffer.commandOpcode[batchCommandIndex];
		const u32 vramYAddressExtensionWord = commandBuffer.commandVramYAddressExtensionWord[batchCommandIndex];
		const bool fixedColor = commandBuffer.commandKind[batchCommandIndex] == GX_GPU_COMMAND_DRAW_POLYGON
			&& gxGpuCommandGouraud(opcode)
			&& !gxGpuCommandRawTextureEnabled(opcode);
		setGxGpuVertexBoundsRect(
			g_texturedCommandRect,
			g_texturedVertices.data(),
			0u,
			vertexFloatCount,
			fixedColor ? kGxGpuFixedTexturedVertexFloats : kGxGpuTexturedVertexFloats,
			topLeftWord,
			bottomRightWord,
			vramYAddressExtensionWord);
		const u32 maskBitModeWord = commandBuffer.commandMaskBitModeWord[batchCommandIndex];
		const bool readsVram = gxGpuCommandSemiTransparencyEnabled(opcode) || gxGpuMaskBitCheckBeforeDraw(maskBitModeWord);
		const bool textureBarrier = readsVram && g_gxGpu.textureBarrier;
		if (readsVram && !textureBarrier) {
			syncGxGpuSampleTextureLogicalArea(
				static_cast<u32>(g_texturedCommandRect.left),
				static_cast<u32>(g_texturedCommandRect.top),
				static_cast<u32>(g_texturedCommandRect.right - g_texturedCommandRect.left),
				static_cast<u32>(g_texturedCommandRect.bottom - g_texturedCommandRect.top),
				vramYAddressExtensionWord);
		}
		renderTexturedVertices(commandBuffer, batchCommandIndex, vertexFloatCount, topLeftWord, bottomRightWord, textureBarrier, readsVram, false);
	}
	resetGxGpuVramCopyRect(g_texturedBatchRect);
	return 0u;
}

void writeGxGpuScanoutPcrtcUniforms(const GxGpuPcrtcScanout& scanout) {
	g_scanoutPcrtcUniforms[0] = scanout.circuits[0u].enabled ? 1 : 0;
	g_scanoutPcrtcUniforms[1] = scanout.circuit2SampleRequired ? 1 : 0;
	g_scanoutPcrtcUniforms[2] = scanout.blendAlphaFromRegister ? 1 : 0;
	g_scanoutPcrtcUniforms[3] = scanout.preserveUnderlayAlpha ? 1 : 0;
	g_scanoutPcrtcUniforms[4] = static_cast<GLint>(scanout.outputHeight);
	g_scanoutPcrtcUniforms[5] = static_cast<GLint>(scanout.backgroundColor & 0xffu);
	g_scanoutPcrtcUniforms[6] = static_cast<GLint>((scanout.backgroundColor >> 8u) & 0xffu);
	g_scanoutPcrtcUniforms[7] = static_cast<GLint>((scanout.backgroundColor >> 16u) & 0xffu);
	g_scanoutPcrtcUniforms[8] = static_cast<GLint>(scanout.blendAlpha);
	g_scanoutPcrtcUniforms[9] = 0;
	g_scanoutPcrtcUniforms[10] = static_cast<GLint>(scanout.backgroundColor >> 24u);
	g_scanoutPcrtcUniforms[11] = 0;
	for (u32 circuit = 0u; circuit < 2u; circuit += 1u) {
		const size_t offset = 12u + static_cast<size_t>(circuit) * 16u;
		const GxGpuPcrtcCircuit& scanoutCircuit = scanout.circuits[circuit];
		g_scanoutPcrtcUniforms[offset] = static_cast<GLint>(scanoutCircuit.framebufferBaseWord);
		g_scanoutPcrtcUniforms[offset + 1u] = static_cast<GLint>(scanoutCircuit.framebufferWidth);
		g_scanoutPcrtcUniforms[offset + 2u] = static_cast<GLint>(scanoutCircuit.framebufferPsm);
		g_scanoutPcrtcUniforms[offset + 3u] = static_cast<GLint>(scanoutCircuit.framebufferX);
		g_scanoutPcrtcUniforms[offset + 4u] = static_cast<GLint>(scanoutCircuit.framebufferY);
		g_scanoutPcrtcUniforms[offset + 5u] = static_cast<GLint>(scanoutCircuit.displayX);
		g_scanoutPcrtcUniforms[offset + 6u] = static_cast<GLint>(scanoutCircuit.displayY);
		g_scanoutPcrtcUniforms[offset + 7u] = static_cast<GLint>(scanout.interlaced
			? scanoutCircuit.interlacedSourceDivisionMultiplierY
			: scanoutCircuit.sourceDivisionMultiplierY);
		g_scanoutPcrtcUniforms[offset + 8u] = static_cast<GLint>(scanoutCircuit.displayRight);
		g_scanoutPcrtcUniforms[offset + 9u] = static_cast<GLint>(scanoutCircuit.displayBottom);
		g_scanoutPcrtcUniforms[offset + 10u] = static_cast<GLint>(scanoutCircuit.sourcePhaseX);
		g_scanoutPcrtcUniforms[offset + 11u] = static_cast<GLint>(scanoutCircuit.fieldSourcePhase);
		g_scanoutPcrtcUniforms[offset + 12u] = static_cast<GLint>(scanoutCircuit.sourceStepX);
		g_scanoutPcrtcUniforms[offset + 13u] = static_cast<GLint>(scanoutCircuit.fieldSourceStride);
		g_scanoutPcrtcUniforms[offset + 14u] = static_cast<GLint>(scanoutCircuit.sourceDivisionMultiplierX);
		g_scanoutPcrtcUniforms[offset + 15u] = 0;
	}
}

void scanoutProgressiveGxGpuVram(GLuint frameFbo, const GxGpuPipelineState& state) {
	const size_t compositionPath = state.pcrtcScanout->compositionPath;
	const GLint positionAttrib = g_gxGpu.scanoutPositionAttribs[compositionPath];
	g_gxGpu.backend->setRenderTarget(frameFbo, state.width, state.height);
	glDisable(GL_SCISSOR_TEST);
	glDisable(GL_DEPTH_TEST);
	glDepthMask(GL_FALSE);
	glDisable(GL_CULL_FACE);
	glDisable(GL_BLEND);
	glUseProgram(g_gxGpu.scanoutPrograms[compositionPath]);
	glUniform1i(g_gxGpu.scanoutVramUniforms[compositionPath], kGxGpuScanoutTextureUnit);
	if (!g_gxGpu.scanoutPcrtcUniformValid || g_gxGpu.scanoutPcrtcRevision != state.pcrtcScanout->revision) {
		writeGxGpuScanoutPcrtcUniforms(*state.pcrtcScanout);
		glUniform4iv(g_gxGpu.scanoutPcrtcUniforms[compositionPath], 11, g_scanoutPcrtcUniforms.data());
		g_gxGpu.scanoutPcrtcRevision = state.pcrtcScanout->revision;
		g_gxGpu.scanoutPcrtcUniformValid = true;
	}
	g_gxGpu.backend->setActiveTextureUnit(kGxGpuScanoutTextureUnit);
	g_gxGpu.backend->bindTexture2D(&g_gxGpu.vramTexture);
	glBindBuffer(GL_ARRAY_BUFFER, g_gxGpu.scanoutVertexBuffer);
	glEnableVertexAttribArray(static_cast<GLuint>(positionAttrib));
	glVertexAttribPointer(static_cast<GLuint>(positionAttrib), 2, GL_FLOAT, GL_FALSE, kGxGpuScanoutVertexStride, nullptr);
	glDrawArrays(GL_TRIANGLES, 0, static_cast<GLsizei>(kGxGpuScanoutVertexCount));
}

void scanoutInterlacedGxGpuVram(GLuint frameFbo, const GxGpuPipelineState& state) {
	const i32 width = state.width;
	const i32 height = state.height;
	const i32 evenFieldHeight = (height + 1) >> 1;
	const i32 oddFieldHeight = height >> 1;
	const u32 field = state.pcrtcScanout->field;
	const size_t compositionPath = state.pcrtcScanout->compositionPath;
	const GLint positionAttrib = g_gxGpu.scanoutFieldPositionAttribs[compositionPath];
	const i32 fieldHeight = field == 0u ? evenFieldHeight : oddFieldHeight;
	const i32 fieldOffset = field == 0u ? 0 : evenFieldHeight;
	const bool sizeChanged = g_gxGpu.scanoutFieldsTexture.width != width || g_gxGpu.scanoutFieldsTexture.height != height;
	const bool pcrtcChanged = g_gxGpu.scanoutFieldPcrtcRevision != state.pcrtcScanout->revision
		|| g_gxGpu.scanoutFieldValue != field;
	const bool invalid = !g_gxGpu.scanoutFieldsValid
		|| sizeChanged
		|| g_gxGpu.scanoutFieldsVramReplacementSerial != state.vramReplacementSerial;
	if (sizeChanged) {
		g_gxGpu.backend->setActiveTextureUnit(kGxGpuScanoutFieldsTextureUnit);
		g_gxGpu.backend->bindTexture2D(&g_gxGpu.scanoutFieldsTexture);
		glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, width, height, 0, GL_RGBA, GL_UNSIGNED_BYTE, nullptr);
		g_gxGpu.scanoutFieldsTexture.width = width;
		g_gxGpu.scanoutFieldsTexture.height = height;
	}

	g_gxGpu.backend->setRenderTarget(g_gxGpu.scanoutFieldsFramebuffer, width, height);
	glDisable(GL_SCISSOR_TEST);
	glDisable(GL_DEPTH_TEST);
	glDepthMask(GL_FALSE);
	glDisable(GL_CULL_FACE);
	glDisable(GL_BLEND);
	glUseProgram(g_gxGpu.scanoutFieldPrograms[compositionPath]);
	glUniform1i(g_gxGpu.scanoutFieldVramUniforms[compositionPath], kGxGpuScanoutTextureUnit);
	if (!g_gxGpu.scanoutFieldPcrtcUniformValid || pcrtcChanged) {
		writeGxGpuScanoutPcrtcUniforms(*state.pcrtcScanout);
		glUniform4iv(g_gxGpu.scanoutFieldPcrtcUniforms[compositionPath], 11, g_scanoutPcrtcUniforms.data());
		g_gxGpu.scanoutFieldPcrtcRevision = state.pcrtcScanout->revision;
		g_gxGpu.scanoutFieldValue = field;
		g_gxGpu.scanoutFieldPcrtcUniformValid = true;
	}
	g_gxGpu.backend->setActiveTextureUnit(kGxGpuScanoutTextureUnit);
	g_gxGpu.backend->bindTexture2D(&g_gxGpu.vramTexture);
	glBindBuffer(GL_ARRAY_BUFFER, g_gxGpu.scanoutVertexBuffer);
	glEnableVertexAttribArray(static_cast<GLuint>(positionAttrib));
	glVertexAttribPointer(static_cast<GLuint>(positionAttrib), 2, GL_FLOAT, GL_FALSE, kGxGpuScanoutVertexStride, nullptr);
	if (invalid) {
		glClearColor(
			static_cast<GLfloat>(state.pcrtcScanout->backgroundColor & 0xffu) / 255.0f,
			static_cast<GLfloat>((state.pcrtcScanout->backgroundColor >> 8u) & 0xffu) / 255.0f,
			static_cast<GLfloat>((state.pcrtcScanout->backgroundColor >> 16u) & 0xffu) / 255.0f,
			static_cast<GLfloat>(state.pcrtcScanout->backgroundColor >> 24u) / 255.0f);
		glClear(GL_COLOR_BUFFER_BIT);
	}
	glViewport(0, fieldOffset, width, fieldHeight);
	glUniform4i(
		g_gxGpu.scanoutFieldInterlaceUniforms[compositionPath],
		fieldHeight,
		height,
		static_cast<GLint>(field),
		fieldOffset);
	glDrawArrays(GL_TRIANGLES, 0, static_cast<GLsizei>(kGxGpuScanoutVertexCount));
	if (invalid) {
		g_gxGpu.scanoutFieldsValid = true;
		g_gxGpu.scanoutFieldsVramReplacementSerial = state.vramReplacementSerial;
	}

	g_gxGpu.backend->setRenderTarget(frameFbo, width, height);
	glUseProgram(g_gxGpu.scanoutWeaveProgram);
	glUniform1i(g_gxGpu.scanoutWeaveVramUniform, kGxGpuScanoutFieldsTextureUnit);
	if (sizeChanged) {
		glUniform4i(
			g_gxGpu.scanoutWeaveInterlaceUniform,
			evenFieldHeight,
			height,
			width,
			oddFieldHeight);
	}
	g_gxGpu.backend->setActiveTextureUnit(kGxGpuScanoutFieldsTextureUnit);
	g_gxGpu.backend->bindTexture2D(&g_gxGpu.scanoutFieldsTexture);
	glEnableVertexAttribArray(static_cast<GLuint>(g_gxGpu.scanoutWeavePositionAttrib));
	glVertexAttribPointer(static_cast<GLuint>(g_gxGpu.scanoutWeavePositionAttrib), 2, GL_FLOAT, GL_FALSE, kGxGpuScanoutVertexStride, nullptr);
	glDrawArrays(GL_TRIANGLES, 0, static_cast<GLsizei>(kGxGpuScanoutVertexCount));
}

void scanoutGxGpuVram(GLuint frameFbo, const GxGpuPipelineState& state) {
	if (state.pcrtcScanout->interlaced) {
		scanoutInterlacedGxGpuVram(frameFbo, state);
		return;
	}
	g_gxGpu.scanoutFieldsValid = false;
	scanoutProgressiveGxGpuVram(frameFbo, state);
}

void executeGxGpuVramCommands(const GxGpuCommandBuffer& commandBuffer, GxGpuReadbackPort& readback, const std::array<u8, GX_GPU_VRAM_BYTE_COUNT>& snapshotBytes, u64 snapshotSerial, size_t commandLimit) {
	if (!g_gxGpu.vramSnapshotValid || g_gxGpu.vramSnapshotSerial != snapshotSerial) {
		uploadGxGpuVramSnapshot(snapshotBytes);
		g_gxGpu.processedCommandCount = 0u;
		g_gxGpu.processedCommandSerial = commandBuffer.serial;
		g_gxGpu.vramSnapshotSerial = snapshotSerial;
		g_gxGpu.vramSnapshotValid = true;
	} else if (g_gxGpu.processedCommandSerial != commandBuffer.serial) {
		g_gxGpu.processedCommandCount = 0u;
		g_gxGpu.processedCommandSerial = commandBuffer.serial;
	}
	executeNewGxGpuCommands(commandBuffer, commandLimit);
	completeGxGpuReadback(commandLimit, readback);
}

void renderGxGpu(GLuint frameFbo, const GxGpuPipelineState& state) {
	executeGxGpuVramCommands(*state.commandBuffer, *state.readbackPort, *state.vramSnapshotBytes, state.vramSnapshotSerial, state.commandBuffer->presentCommandCount);
	scanoutGxGpuVram(frameFbo, state);
}

void executeGxGpuPass(GPUBackend* backend, GameView*, void* fbo, RenderPassStateStorage& stateStorage, void*) {
	auto& gles = *static_cast<OpenGLES2Backend*>(backend);
	renderGxGpu(gles.framebufferName(fbo), stateStorage.gxGpu);
}

} // namespace

void OpenGLES2Backend::executeGxGpuReadback(GxGpu& gxGpu) {
	const GxGpuDeviceOutput& output = gxGpu.readDeviceOutput();
	executeGxGpuVramCommands(output.commandBuffer, output.readbackPort, output.vramSnapshotBytes, output.vramSnapshotSerial, output.readbackPort.fenceCommandCount());
}

void OpenGLES2Backend::captureGxGpuVramSnapshot(GxGpu& gxGpu) {
	const GxGpuDeviceOutput& output = gxGpu.readDeviceOutput();
	executeGxGpuVramCommands(output.commandBuffer, output.readbackPort, output.vramSnapshotBytes, output.vramSnapshotSerial, output.commandBuffer.executedCommandCount);
	setRenderTarget(g_gxGpu.vramFramebuffer, kGxGpuVramWidth, kGxGpuVramHeight);
	glReadPixels(0, 0, kGxGpuVramWidth, kGxGpuVramHeight, GL_RGBA, GL_UNSIGNED_BYTE, g_rawVramReadback.data());
	writeGxGpuVramSnapshotFromReadback();
	g_gxGpu.vramSnapshotSerial = gxGpu.commitRenderedVramSnapshotBytes(g_vramSnapshotScratch.data(), g_gxGpu.processedCommandCount);
	g_gxGpu.vramSnapshotValid = true;
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
