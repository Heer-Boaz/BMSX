#include "render/backend/gles2/gx_gpu.h"

#include "machine/devices/gx/gpu.h"
#include "machine/devices/gx/gpu_command_buffer.h"
#include "render/backend/gx_gpu_render_rules.h"
#include "render/backend/gles2/backend.h"
#include "render/backend/texture_params.h"
#include "render/backend/gles2/shaders/gx_gpu_shaders.h"
#include "render/backend/pass/library.h"

#include <array>
#include <cstdint>

namespace bmsx {
namespace {

constexpr i32 kGxGpuVramWidth = static_cast<i32>(GX_GPU_VRAM_WIDTH);
constexpr i32 kGxGpuVramHeight = static_cast<i32>(GX_GPU_VRAM_HEIGHT);
constexpr i32 kGxGpuScanoutTextureUnit = 0;
constexpr i32 kGxGpuTextureSampleUnit = 1;
constexpr i32 kGxGpuTextureTransferUnit = 2;
constexpr size_t kGxGpuSolidVertexFloats = 6u;
constexpr size_t kGxGpuSolidVerticesPerCommand = 24u;
constexpr size_t kGxGpuSolidFloatCapacity = GX_GPU_COMMAND_CAPACITY * kGxGpuSolidVerticesPerCommand * kGxGpuSolidVertexFloats;
constexpr size_t kGxGpuLineVertexFloats = 12u;
constexpr size_t kGxGpuLineVerticesPerSegment = 6u;
constexpr size_t kGxGpuLineSegmentFloats = kGxGpuLineVerticesPerSegment * kGxGpuLineVertexFloats;
constexpr size_t kGxGpuLineSegmentCapacity = 1024u;
constexpr size_t kGxGpuLineFloatCapacity = kGxGpuLineSegmentCapacity * kGxGpuLineSegmentFloats;
constexpr size_t kGxGpuTexturedVertexFloats = 7u;
constexpr size_t kGxGpuTexturedVerticesPerCommand = 6u;
constexpr size_t kGxGpuTexturedFloatCapacity = kGxGpuTexturedVerticesPerCommand * kGxGpuTexturedVertexFloats;
constexpr u32 kGxGpuTexturePageCoordSize = 256u;
constexpr u32 kGxGpuTexturePage4BitWidthWords = 64u;
constexpr u32 kGxGpuTexturePage8BitWidthWords = 128u;
constexpr u32 kGxGpuClut4BitWords = 16u;
constexpr u32 kGxGpuClut8BitWords = 256u;
constexpr size_t kGxGpuTransferVertexFloats = 4u;
constexpr size_t kGxGpuTransferVerticesPerSegment = 6u;
constexpr size_t kGxGpuTransferSegmentsPerRow = 3u;
constexpr size_t kGxGpuTransferFloatCapacity = static_cast<size_t>(kGxGpuVramHeight) * kGxGpuTransferSegmentsPerRow * kGxGpuTransferVerticesPerSegment * kGxGpuTransferVertexFloats;
constexpr size_t kGxGpuScanoutVertexFloats = 4u;
constexpr size_t kGxGpuScanoutFloatCount = 6u * kGxGpuScanoutVertexFloats;
constexpr size_t kGxGpuRawVramBytesPerPixel = 4u;
constexpr size_t kGxGpuRawVramUploadRowBytes = static_cast<size_t>(kGxGpuVramWidth) * kGxGpuRawVramBytesPerPixel;
constexpr size_t kGxGpuRawVramReadbackBytes = static_cast<size_t>(kGxGpuVramWidth) * static_cast<size_t>(kGxGpuVramHeight) * kGxGpuRawVramBytesPerPixel;
constexpr u32 kGxGpuFullDrawingAreaTopLeftWord = 0u;
constexpr u32 kGxGpuFullDrawingAreaBottomRightWord = (static_cast<u32>(kGxGpuVramWidth) - 1u) | ((static_cast<u32>(kGxGpuVramHeight) - 1u) << 10u);
constexpr u32 kGxGpuSampleSourceTileShift = 6u;
constexpr u32 kGxGpuSampleSourceTileColumns = GX_GPU_VRAM_WIDTH >> kGxGpuSampleSourceTileShift;
constexpr GLsizeiptr kGxGpuSolidBufferBytes = static_cast<GLsizeiptr>(kGxGpuSolidFloatCapacity * sizeof(f32));
constexpr GLsizeiptr kGxGpuLineBufferBytes = static_cast<GLsizeiptr>(kGxGpuLineFloatCapacity * sizeof(f32));
constexpr GLsizeiptr kGxGpuTexturedBufferBytes = static_cast<GLsizeiptr>(kGxGpuTexturedFloatCapacity * sizeof(f32));
constexpr GLsizeiptr kGxGpuTransferBufferBytes = static_cast<GLsizeiptr>(kGxGpuTransferFloatCapacity * sizeof(f32));
constexpr GLsizei kGxGpuSolidVertexStride = static_cast<GLsizei>(kGxGpuSolidVertexFloats * sizeof(f32));
constexpr GLsizei kGxGpuLineVertexStride = static_cast<GLsizei>(kGxGpuLineVertexFloats * sizeof(f32));
constexpr GLsizei kGxGpuTexturedVertexStride = static_cast<GLsizei>(kGxGpuTexturedVertexFloats * sizeof(f32));
constexpr GLsizei kGxGpuTransferVertexStride = static_cast<GLsizei>(kGxGpuTransferVertexFloats * sizeof(f32));
constexpr GLsizei kGxGpuScanoutVertexStride = static_cast<GLsizei>(kGxGpuScanoutVertexFloats * sizeof(f32));

std::array<f32, kGxGpuSolidFloatCapacity> g_solidVertices{};
std::array<f32, kGxGpuLineFloatCapacity> g_lineVertices{};
std::array<f32, kGxGpuTexturedFloatCapacity> g_texturedVertices{};
std::array<i64, GX_GPU_TRIANGLE_UV_PLANE_WORDS * 2> g_texturedUvPlanes{};
size_t g_texturedUvPlaneCount = 0u;
std::array<f32, kGxGpuTransferFloatCapacity> g_transferVertices{};
std::array<u8, kGxGpuRawVramUploadRowBytes> g_rawVramUploadRow{};
std::array<u8, kGxGpuRawVramReadbackBytes> g_rawVramReadback{};
std::array<u8, GX_GPU_VRAM_BYTE_COUNT> g_vramSnapshotScratch{};
std::array<f32, kGxGpuScanoutFloatCount> g_scanoutVertices{};

struct GxGpuVramCopyRect {
	i32 left = 0;
	i32 top = 0;
	i32 right = 0;
	i32 bottom = 0;
};

struct GxGpuRectangle {
	f32 x0 = 0.0f;
	f32 y0 = 0.0f;
	f32 x1 = 0.0f;
	f32 y1 = 0.0f;
	u32 width = 0u;
	u32 height = 0u;
};

GxGpuVramCopyRect g_vramCopyRectScratch{};
GxGpuVramCopyRect g_solidBatchRect{};
GxGpuVramCopyRect g_solidCommandRect{};
GxGpuVramCopyRect g_lineBatchRect{};
GxGpuVramCopyRect g_lineCommandRect{};
GxGpuRectangle g_rectangleScratch{};

void invalidateGxGpuSampleSourceCache();
void invalidateGxGpuSampleSourceCacheForWrite(i32 left, i32 top, i32 right, i32 bottom);

struct GxGpuRuntime {
	OpenGLES2Backend* backend = nullptr;
	GLuint solidProgram = 0;
	GLuint lineProgram = 0;
	GLuint texturedProgram = 0;
	GLuint transferProgram = 0;
	GLuint scanoutProgram = 0;
	GLES2Texture vramTexture{};
	GLES2Texture vramSampleTexture{};
	GLES2Texture vramTransferTexture{};
	GLuint vramFramebuffer = 0;
	GLuint solidVertexBuffer = 0;
	GLuint lineVertexBuffer = 0;
	GLuint texturedVertexBuffer = 0;
	GLuint transferVertexBuffer = 0;
	GLuint scanoutVertexBuffer = 0;
	GLint solidPositionAttrib = -1;
	GLint solidColorAttrib = -1;
	GLint solidVramUniform = -1;
	GLint solidBlendEnableUniform = -1;
	GLint solidBlendModeUniform = -1;
	GLint solidCheckMaskBitUniform = -1;
	GLint solidSetMaskBitUniform = -1;
	GLint solidDitherEnableUniform = -1;
	GLint solidInterlacedRenderWordUniform = -1;
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
	GLint lineInterlacedRenderWordUniform = -1;
	GLint texturedPositionAttrib = -1;
	GLint texturedColorAttrib = -1;
	GLint texturedTexcoordAttrib = -1;
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
	GLint texturedInterlacedRenderWordUniform = -1;
	GLint texturedUvPlaneEnableUniform = -1;
	GLint texturedUvPlaneBase01Uniform = -1;
	GLint texturedUvPlaneBase23Uniform = -1;
	GLint texturedUvPlaneStepX01Uniform = -1;
	GLint texturedUvPlaneStepX23Uniform = -1;
	GLint texturedUvPlaneStepY01Uniform = -1;
	GLint texturedUvPlaneStepY23Uniform = -1;
	GLint texturedUvPlaneDigit4BaseStepXUniform = -1;
	GLint texturedUvPlaneDigit4StepYOriginUniform = -1;
	GLint transferPositionAttrib = -1;
	GLint transferTexcoordAttrib = -1;
	GLint transferSourceUniform = -1;
	GLint transferVramUniform = -1;
	GLint transferCheckMaskBitUniform = -1;
	GLint transferSetMaskBitUniform = -1;
	GLint scanoutPositionAttrib = -1;
	GLint scanoutTexcoordAttrib = -1;
	GLint scanoutVramUniform = -1;
	GLint scanoutDisplayModeUniform = -1;
	GLint scanoutDisplayStartWordUniform = -1;
	GLint scanoutHorizontalDisplayRangeUniform = -1;
	GLint scanoutVerticalDisplayRangeUniform = -1;
	u32 scanoutUniformDisplayModeWord = 0xffffffffu;
	u32 scanoutUniformDisplayStartWord = 0xffffffffu;
	u32 scanoutUniformHorizontalDisplayRangeWord = 0xffffffffu;
	u32 scanoutUniformVerticalDisplayRangeWord = 0xffffffffu;
	u32 processedCommandCount = 0;
	u32 processedCommandSerial = 0;
	u32 vramClearSerial = 0u;
	u32 vramSnapshotSerial = 0u;
	std::array<GxGpuVramCopyRect, 3u> sampleSourceRects{};
	std::array<GxGpuVramCopyRect, 3u> sampleSourceCandidateRects{};
	u32 sampleSourceRectCount = 0u;
	u32 sampleSourceCandidateRectCount = 0u;
	u32 sampleSourceRectHash = 0u;
	u32 sampleSourceCandidateRectHash = 0u;
	u32 sampleSourceTileMask0 = 0u;
	u32 sampleSourceTileMask1 = 0u;
	u32 sampleSourceTileMask2 = 0u;
	u32 sampleSourceTileMask3 = 0u;
	u32 sampleSourceCandidateTileMask0 = 0u;
	u32 sampleSourceCandidateTileMask1 = 0u;
	u32 sampleSourceCandidateTileMask2 = 0u;
	u32 sampleSourceCandidateTileMask3 = 0u;
};

GxGpuRuntime g_gxGpu;

void updateGxGpuScanoutVertices();

void initializeGxGpuTexture(GLES2Texture& texture, i32 textureUnit) {
	glGenTextures(1, &texture.id);
	texture.width = kGxGpuVramWidth;
	texture.height = kGxGpuVramHeight;
	g_gxGpu.backend->setActiveTextureUnit(textureUnit);
	g_gxGpu.backend->bindTexture2D(&texture);
	glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, kGxGpuVramWidth, kGxGpuVramHeight, 0, GL_RGBA, GL_UNSIGNED_BYTE, nullptr);
	applyGLES2TextureParams(RGBA8_LINEAR_TEXTURE_PARAMS);
}

void initGxGpu(OpenGLES2Backend& backend) {
	g_gxGpu.backend = &backend;
	g_gxGpu.solidProgram = g_gxGpu.backend->buildProgram(kGxGpuFillVertexShader, kGxGpuFillFragmentShader, "gx_gpu_fill");
	g_gxGpu.lineProgram = g_gxGpu.backend->buildProgram(kGxGpuLineVertexShader, kGxGpuLineFragmentShader, "gx_gpu_line");
	g_gxGpu.texturedProgram = g_gxGpu.backend->buildProgram(kGxGpuTexturedVertexShader, kGxGpuTexturedFragmentShader, "gx_gpu_textured");
	g_gxGpu.transferProgram = g_gxGpu.backend->buildProgram(kGxGpuTransferVertexShader, kGxGpuTransferFragmentShader, "gx_gpu_transfer");
	g_gxGpu.scanoutProgram = g_gxGpu.backend->buildProgram(kGxGpuScanoutVertexShader, kGxGpuScanoutFragmentShader, "gx_gpu_scanout");

	initializeGxGpuTexture(g_gxGpu.vramTexture, kGxGpuScanoutTextureUnit);
	initializeGxGpuTexture(g_gxGpu.vramSampleTexture, kGxGpuTextureSampleUnit);
	initializeGxGpuTexture(g_gxGpu.vramTransferTexture, kGxGpuTextureTransferUnit);

	glGenFramebuffers(1, &g_gxGpu.vramFramebuffer);
	glBindFramebuffer(GL_FRAMEBUFFER, g_gxGpu.vramFramebuffer);
	glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, g_gxGpu.vramTexture.id, 0);
	glViewport(0, 0, kGxGpuVramWidth, kGxGpuVramHeight);
	glClearColor(0.0f, 0.0f, 0.0f, 1.0f);
	glClear(GL_COLOR_BUFFER_BIT);

	glGenBuffers(1, &g_gxGpu.solidVertexBuffer);
	glBindBuffer(GL_ARRAY_BUFFER, g_gxGpu.solidVertexBuffer);
	glBufferData(GL_ARRAY_BUFFER, kGxGpuSolidBufferBytes, nullptr, GL_DYNAMIC_DRAW);

	glGenBuffers(1, &g_gxGpu.lineVertexBuffer);
	glBindBuffer(GL_ARRAY_BUFFER, g_gxGpu.lineVertexBuffer);
	glBufferData(GL_ARRAY_BUFFER, kGxGpuLineBufferBytes, nullptr, GL_DYNAMIC_DRAW);

	glGenBuffers(1, &g_gxGpu.texturedVertexBuffer);
	glBindBuffer(GL_ARRAY_BUFFER, g_gxGpu.texturedVertexBuffer);
	glBufferData(GL_ARRAY_BUFFER, kGxGpuTexturedBufferBytes, nullptr, GL_DYNAMIC_DRAW);

	glGenBuffers(1, &g_gxGpu.transferVertexBuffer);
	glBindBuffer(GL_ARRAY_BUFFER, g_gxGpu.transferVertexBuffer);
	glBufferData(GL_ARRAY_BUFFER, kGxGpuTransferBufferBytes, nullptr, GL_DYNAMIC_DRAW);

	glGenBuffers(1, &g_gxGpu.scanoutVertexBuffer);
	glBindBuffer(GL_ARRAY_BUFFER, g_gxGpu.scanoutVertexBuffer);
	updateGxGpuScanoutVertices();
	glBufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(g_scanoutVertices.size() * sizeof(f32)), g_scanoutVertices.data(), GL_STATIC_DRAW);

	g_gxGpu.solidPositionAttrib = glGetAttribLocation(g_gxGpu.solidProgram, "a_position");
	g_gxGpu.solidColorAttrib = glGetAttribLocation(g_gxGpu.solidProgram, "a_color");
	g_gxGpu.solidVramUniform = glGetUniformLocation(g_gxGpu.solidProgram, "u_vram");
	g_gxGpu.solidBlendEnableUniform = glGetUniformLocation(g_gxGpu.solidProgram, "u_blendEnable");
	g_gxGpu.solidBlendModeUniform = glGetUniformLocation(g_gxGpu.solidProgram, "u_blendMode");
	g_gxGpu.solidCheckMaskBitUniform = glGetUniformLocation(g_gxGpu.solidProgram, "u_checkMaskBit");
	g_gxGpu.solidSetMaskBitUniform = glGetUniformLocation(g_gxGpu.solidProgram, "u_setMaskBit");
	g_gxGpu.solidDitherEnableUniform = glGetUniformLocation(g_gxGpu.solidProgram, "u_ditherEnable");
	g_gxGpu.solidInterlacedRenderWordUniform = glGetUniformLocation(g_gxGpu.solidProgram, "u_interlacedRenderWord");
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
	g_gxGpu.lineInterlacedRenderWordUniform = glGetUniformLocation(g_gxGpu.lineProgram, "u_interlacedRenderWord");
	g_gxGpu.texturedPositionAttrib = glGetAttribLocation(g_gxGpu.texturedProgram, "a_position");
	g_gxGpu.texturedColorAttrib = glGetAttribLocation(g_gxGpu.texturedProgram, "a_color");
	g_gxGpu.texturedTexcoordAttrib = glGetAttribLocation(g_gxGpu.texturedProgram, "a_texcoord");
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
	g_gxGpu.texturedInterlacedRenderWordUniform = glGetUniformLocation(g_gxGpu.texturedProgram, "u_interlacedRenderWord");
	g_gxGpu.texturedUvPlaneEnableUniform = glGetUniformLocation(g_gxGpu.texturedProgram, "u_uvPlaneEnable");
	g_gxGpu.texturedUvPlaneBase01Uniform = glGetUniformLocation(g_gxGpu.texturedProgram, "u_uvPlaneBase01");
	g_gxGpu.texturedUvPlaneBase23Uniform = glGetUniformLocation(g_gxGpu.texturedProgram, "u_uvPlaneBase23");
	g_gxGpu.texturedUvPlaneStepX01Uniform = glGetUniformLocation(g_gxGpu.texturedProgram, "u_uvPlaneStepX01");
	g_gxGpu.texturedUvPlaneStepX23Uniform = glGetUniformLocation(g_gxGpu.texturedProgram, "u_uvPlaneStepX23");
	g_gxGpu.texturedUvPlaneStepY01Uniform = glGetUniformLocation(g_gxGpu.texturedProgram, "u_uvPlaneStepY01");
	g_gxGpu.texturedUvPlaneStepY23Uniform = glGetUniformLocation(g_gxGpu.texturedProgram, "u_uvPlaneStepY23");
	g_gxGpu.texturedUvPlaneDigit4BaseStepXUniform = glGetUniformLocation(g_gxGpu.texturedProgram, "u_uvPlaneDigit4BaseStepX");
	g_gxGpu.texturedUvPlaneDigit4StepYOriginUniform = glGetUniformLocation(g_gxGpu.texturedProgram, "u_uvPlaneDigit4StepYOrigin");
	g_gxGpu.transferPositionAttrib = glGetAttribLocation(g_gxGpu.transferProgram, "a_position");
	g_gxGpu.transferTexcoordAttrib = glGetAttribLocation(g_gxGpu.transferProgram, "a_texcoord");
	g_gxGpu.transferSourceUniform = glGetUniformLocation(g_gxGpu.transferProgram, "u_source");
	g_gxGpu.transferVramUniform = glGetUniformLocation(g_gxGpu.transferProgram, "u_vram");
	g_gxGpu.transferCheckMaskBitUniform = glGetUniformLocation(g_gxGpu.transferProgram, "u_checkMaskBit");
	g_gxGpu.transferSetMaskBitUniform = glGetUniformLocation(g_gxGpu.transferProgram, "u_setMaskBit");
	g_gxGpu.scanoutPositionAttrib = glGetAttribLocation(g_gxGpu.scanoutProgram, "a_position");
	g_gxGpu.scanoutTexcoordAttrib = glGetAttribLocation(g_gxGpu.scanoutProgram, "a_texcoord");
	g_gxGpu.scanoutVramUniform = glGetUniformLocation(g_gxGpu.scanoutProgram, "u_vram");
	g_gxGpu.scanoutDisplayModeUniform = glGetUniformLocation(g_gxGpu.scanoutProgram, "u_displayModeWord");
	g_gxGpu.scanoutDisplayStartWordUniform = glGetUniformLocation(g_gxGpu.scanoutProgram, "u_displayStartWord");
	g_gxGpu.scanoutHorizontalDisplayRangeUniform = glGetUniformLocation(g_gxGpu.scanoutProgram, "u_horizontalDisplayRangeWord");
	g_gxGpu.scanoutVerticalDisplayRangeUniform = glGetUniformLocation(g_gxGpu.scanoutProgram, "u_verticalDisplayRangeWord");
	g_gxGpu.scanoutUniformDisplayModeWord = 0xffffffffu;
	g_gxGpu.scanoutUniformDisplayStartWord = 0xffffffffu;
	g_gxGpu.scanoutUniformHorizontalDisplayRangeWord = 0xffffffffu;
	g_gxGpu.scanoutUniformVerticalDisplayRangeWord = 0xffffffffu;
	glBindFramebuffer(GL_FRAMEBUFFER, 0);
}

void clearGxGpuVram() {
	invalidateGxGpuSampleSourceCache();
	g_gxGpu.backend->setRenderTarget(g_gxGpu.vramFramebuffer, kGxGpuVramWidth, kGxGpuVramHeight);
	glDisable(GL_SCISSOR_TEST);
	glClearColor(0.0f, 0.0f, 0.0f, 1.0f);
	glClear(GL_COLOR_BUFFER_BIT);
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

size_t appendSolidPrimitiveTriangle(
	size_t vertexFloatCount,
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
	return appendSolidTriangle(
		vertexFloatCount,
		static_cast<f32>(x0 + xShift),
		static_cast<f32>(y0 + yShift),
		color0,
		static_cast<f32>(x1 + xShift),
		static_cast<f32>(y1 + yShift),
		color1,
		static_cast<f32>(x2 + xShift),
		static_cast<f32>(y2 + yShift),
		color2);
}

size_t appendSolidPrimitiveQuadTail(
	size_t vertexFloatCount,
	i32 dx,
	i32 dy,
	u32 xy1,
	u32 color1,
	u32 xy2,
	u32 color2,
	u32 xy3,
	u32 color3) {
	return appendSolidPrimitiveTriangle(
		vertexFloatCount,
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

size_t appendSolidPrimitivePolygonVertices(
	size_t vertexFloatCount,
	i32 dx,
	i32 dy,
	u32 opcode,
	u32 xy0,
	u32 color0,
	u32 xy1,
	u32 color1,
	u32 xy2,
	u32 color2,
	u32 xy3,
	u32 color3) {
	size_t offset = appendSolidPrimitiveTriangle(
		vertexFloatCount,
		dx + gxGpuSigned11(xy0),
		dy + gxGpuVertexY(xy0),
		color0,
		dx + gxGpuSigned11(xy1),
		dy + gxGpuVertexY(xy1),
		color1,
		dx + gxGpuSigned11(xy2),
		dy + gxGpuVertexY(xy2),
		color2);
	if (gxGpuCommandQuadPolygon(opcode)) {
		offset = appendSolidPrimitiveQuadTail(offset, dx, dy, xy1, color1, xy2, color2, xy3, color3);
	}
	return offset;
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
	if (width == 0u || height == 0u) {
		return vertexFloatCount;
	}
	u32 y = gxGpuTransferY(xyWord);
	u32 remainingHeight = height;
	size_t offset = vertexFloatCount;
	while (remainingHeight != 0u) {
		const u32 rowHeight = gxGpuVramWrappedHeight(y, remainingHeight);
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
		y = (y + rowHeight) & (static_cast<u32>(kGxGpuVramHeight) - 1u);
		remainingHeight -= rowHeight;
	}
	return offset;
}

size_t appendSolidPolygon(const GxGpuCommandBuffer& commandBuffer, u32 commandIndex, size_t vertexFloatCount) {
	const u32 opcode = commandBuffer.commandOpcode[commandIndex];
	const u32 drawModeWord = commandBuffer.commandDrawModeWord[commandIndex];
	if (gxGpuCommandDrawsTexture(opcode, drawModeWord)) {
		return vertexFloatCount;
	}
	const u32 wordStart = commandBuffer.commandWordStart[commandIndex];
	const auto& words = commandBuffer.words;
	const u32 drawingOffsetWord = commandBuffer.commandDrawingOffsetWord[commandIndex];
	const i32 dx = gxGpuSigned11(drawingOffsetWord);
	const i32 dy = gxGpuDrawingOffsetY(drawingOffsetWord);
	const bool gouraud = gxGpuCommandGouraud(opcode);
	const bool textureEnabled = gxGpuCommandTextureEnabled(opcode);
	const bool quadPolygon = gxGpuCommandQuadPolygon(opcode);
	if (gouraud) {
		const u32 color0 = words[wordStart];
		const u32 xy0 = words[wordStart + 1u];
		const u32 color1 = words[wordStart + (textureEnabled ? 3u : 2u)];
		const u32 xy1 = words[wordStart + (textureEnabled ? 4u : 3u)];
		const u32 color2 = words[wordStart + (textureEnabled ? 6u : 4u)];
		const u32 xy2 = words[wordStart + (textureEnabled ? 7u : 5u)];
		const u32 color3 = quadPolygon ? words[wordStart + (textureEnabled ? 9u : 6u)] : 0u;
		const u32 xy3 = quadPolygon ? words[wordStart + (textureEnabled ? 10u : 7u)] : 0u;
		return appendSolidPrimitivePolygonVertices(vertexFloatCount, dx, dy, opcode, xy0, color0, xy1, color1, xy2, color2, xy3, color3);
	}

	const u32 color = words[wordStart];
	const u32 xy0 = words[wordStart + 1u];
	const u32 xy1 = words[wordStart + (textureEnabled ? 3u : 2u)];
	const u32 xy2 = words[wordStart + (textureEnabled ? 5u : 3u)];
	const u32 xy3 = quadPolygon ? words[wordStart + (textureEnabled ? 7u : 4u)] : 0u;
	return appendSolidPrimitivePolygonVertices(
		vertexFloatCount,
		dx,
		dy,
		opcode,
		xy0,
		color,
		xy1,
		color,
		xy2,
		color,
		xy3,
		color);
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
	if (gxGpuCommandDrawsTexture(opcode, commandBuffer.commandDrawModeWord[commandIndex])) {
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

size_t appendLineSegment(size_t vertexFloatCount, i32 x0, i32 y0, u32 color0, i32 x1, i32 y1, u32 color1) {
	if (gxGpuSegmentExceedsPrimitiveSize(x0, y0, x1, y1)) {
		return vertexFloatCount;
	}
	const i32 absDx = x0 < x1 ? x1 - x0 : x0 - x1;
	const i32 absDy = y0 < y1 ? y1 - y0 : y0 - y1;
	const i32 steps = absDx >= absDy ? absDx : absDy;
	if (x0 >= x1 && steps > 0) {
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
	const f32 x0Float = static_cast<f32>(x0);
	const f32 y0Float = static_cast<f32>(y0);
	const f32 x1Float = static_cast<f32>(x1);
	const f32 y1Float = static_cast<f32>(y1);
	size_t offset = vertexFloatCount;
	if (absDx >= absDy) {
		offset = writeLineVertex(offset, x0Float, y0Float - 1.0f, x0Float, y0Float, x1Float, y1Float, color0, color1);
		offset = writeLineVertex(offset, x0Float, y0Float + 2.0f, x0Float, y0Float, x1Float, y1Float, color0, color1);
		offset = writeLineVertex(offset, x1Float + 1.0f, y1Float - 1.0f, x0Float, y0Float, x1Float, y1Float, color0, color1);
		offset = writeLineVertex(offset, x0Float, y0Float + 2.0f, x0Float, y0Float, x1Float, y1Float, color0, color1);
		offset = writeLineVertex(offset, x1Float + 1.0f, y1Float - 1.0f, x0Float, y0Float, x1Float, y1Float, color0, color1);
		offset = writeLineVertex(offset, x1Float + 1.0f, y1Float + 2.0f, x0Float, y0Float, x1Float, y1Float, color0, color1);
		return offset;
	}
	if (y0 < y1) {
		offset = writeLineVertex(offset, x0Float - 1.0f, y0Float, x0Float, y0Float, x1Float, y1Float, color0, color1);
		offset = writeLineVertex(offset, x1Float - 1.0f, y1Float + 1.0f, x0Float, y0Float, x1Float, y1Float, color0, color1);
		offset = writeLineVertex(offset, x0Float + 2.0f, y0Float, x0Float, y0Float, x1Float, y1Float, color0, color1);
		offset = writeLineVertex(offset, x1Float - 1.0f, y1Float + 1.0f, x0Float, y0Float, x1Float, y1Float, color0, color1);
		offset = writeLineVertex(offset, x0Float + 2.0f, y0Float, x0Float, y0Float, x1Float, y1Float, color0, color1);
		offset = writeLineVertex(offset, x1Float + 2.0f, y1Float + 1.0f, x0Float, y0Float, x1Float, y1Float, color0, color1);
		return offset;
	}
	offset = writeLineVertex(offset, x1Float - 1.0f, y1Float, x0Float, y0Float, x1Float, y1Float, color0, color1);
	offset = writeLineVertex(offset, x0Float - 1.0f, y0Float + 1.0f, x0Float, y0Float, x1Float, y1Float, color0, color1);
	offset = writeLineVertex(offset, x1Float + 2.0f, y1Float, x0Float, y0Float, x1Float, y1Float, color0, color1);
	offset = writeLineVertex(offset, x0Float - 1.0f, y0Float + 1.0f, x0Float, y0Float, x1Float, y1Float, color0, color1);
	offset = writeLineVertex(offset, x1Float + 2.0f, y1Float, x0Float, y0Float, x1Float, y1Float, color0, color1);
	offset = writeLineVertex(offset, x0Float + 2.0f, y0Float + 1.0f, x0Float, y0Float, x1Float, y1Float, color0, color1);
	return offset;
}

size_t writeTexturedVertex(size_t offset, f32 x, f32 y, u32 colorWord, i32 u, i32 v) {
	g_texturedVertices[offset] = x;
	g_texturedVertices[offset + 1u] = y;
	g_texturedVertices[offset + 2u] = static_cast<f32>(colorWord & 0xffu) / 255.0f;
	g_texturedVertices[offset + 3u] = static_cast<f32>((colorWord >> 8u) & 0xffu) / 255.0f;
	g_texturedVertices[offset + 4u] = static_cast<f32>((colorWord >> 16u) & 0xffu) / 255.0f;
	g_texturedVertices[offset + 5u] = static_cast<f32>(u);
	g_texturedVertices[offset + 6u] = static_cast<f32>(v);
	return offset + kGxGpuTexturedVertexFloats;
}

size_t appendTexturedTriangle(
	size_t vertexFloatCount,
	f32 x0,
	f32 y0,
	u32 color0,
	i32 u0,
	i32 v0,
	f32 x1,
	f32 y1,
	u32 color1,
	i32 u1,
	i32 v1,
	f32 x2,
	f32 y2,
	u32 color2,
	i32 u2,
	i32 v2) {
	size_t offset = vertexFloatCount;
	offset = writeTexturedVertex(offset, x0, y0, color0, u0, v0);
	offset = writeTexturedVertex(offset, x1, y1, color1, u1, v1);
	offset = writeTexturedVertex(offset, x2, y2, color2, u2, v2);
	return offset;
}

size_t appendTexturedPrimitiveTriangle(
	size_t vertexFloatCount,
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
	gxGpuTriangleUvPlane(g_texturedUvPlanes.data(), static_cast<i32>(g_texturedUvPlaneCount * GX_GPU_TRIANGLE_UV_PLANE_WORDS), determinant, x0, y0, u0, v0, x1, y1, u1, v1, x2, y2, u2, v2);
	g_texturedUvPlaneCount += 1u;
	return appendTexturedTriangle(
		vertexFloatCount,
		static_cast<f32>(x0),
		static_cast<f32>(y0),
		color0,
		u0,
		v0,
		static_cast<f32>(x1),
		static_cast<f32>(y1),
		color1,
		u1,
		v1,
		static_cast<f32>(x2),
		static_cast<f32>(y2),
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
	const i32 u0 = static_cast<i32>(gxGpuTextureU(textureWord));
	const i32 v0 = static_cast<i32>(gxGpuTextureV(textureWord));
	const i32 u1 = u0 + (xFlip ? -static_cast<i32>(rect.width) : static_cast<i32>(rect.width));
	const i32 v1 = v0 + (yFlip ? -static_cast<i32>(rect.height) : static_cast<i32>(rect.height));
	size_t offset = vertexFloatCount;
	offset = appendTexturedTriangle(offset, rect.x0, rect.y0, colorWord, u0, v0, rect.x1, rect.y0, colorWord, u1, v0, rect.x0, rect.y1, colorWord, u0, v1);
	offset = appendTexturedTriangle(offset, rect.x0, rect.y1, colorWord, u0, v1, rect.x1, rect.y0, colorWord, u1, v0, rect.x1, rect.y1, colorWord, u1, v1);
	return offset;
}

size_t writeUvVertex(f32* vertices, size_t offset, size_t vertexFloatStride, f32 x, f32 y, f32 u, f32 v) {
	vertices[offset] = x;
	vertices[offset + 1u] = y;
	vertices[offset + 2u] = u;
	vertices[offset + 3u] = v;
	return offset + vertexFloatStride;
}

size_t appendTransferTriangle(
	size_t vertexFloatCount,
	f32 x0,
	f32 y0,
	f32 u0,
	f32 v0,
	f32 x1,
	f32 y1,
	f32 u1,
	f32 v1,
	f32 x2,
	f32 y2,
	f32 u2,
	f32 v2) {
	size_t offset = vertexFloatCount;
	offset = writeUvVertex(g_transferVertices.data(), offset, kGxGpuTransferVertexFloats, x0, y0, u0, v0);
	offset = writeUvVertex(g_transferVertices.data(), offset, kGxGpuTransferVertexFloats, x1, y1, u1, v1);
	offset = writeUvVertex(g_transferVertices.data(), offset, kGxGpuTransferVertexFloats, x2, y2, u2, v2);
	return offset;
}

size_t appendTransferQuad(size_t vertexFloatCount, u32 x, u32 y, u32 width, u32 height, u32 u, u32 v) {
	const f32 x0 = static_cast<f32>(x);
	const f32 y0 = static_cast<f32>(y);
	const f32 x1 = static_cast<f32>(x + width);
	const f32 y1 = static_cast<f32>(y + height);
	const f32 u0 = static_cast<f32>(u);
	const f32 v0 = static_cast<f32>(v);
	const f32 u1 = static_cast<f32>(u + width);
	const f32 v1 = static_cast<f32>(v + height);
	size_t offset = vertexFloatCount;
	offset = appendTransferTriangle(offset, x0, y0, u0, v0, x1, y0, u1, v0, x0, y1, u0, v1);
	offset = appendTransferTriangle(offset, x0, y1, u0, v1, x1, y0, u1, v0, x1, y1, u1, v1);
	return offset;
}

size_t writeRawVramUploadPixel(size_t rowByteOffset, u32 pixelWord) {
	g_rawVramUploadRow[rowByteOffset] = static_cast<u8>(pixelWord & 0xffu);
	g_rawVramUploadRow[rowByteOffset + 1u] = static_cast<u8>((pixelWord >> 8u) & 0xffu);
	g_rawVramUploadRow[rowByteOffset + 2u] = 0u;
	g_rawVramUploadRow[rowByteOffset + 3u] = 0xffu;
	return rowByteOffset + kGxGpuRawVramBytesPerPixel;
}

void writeVramSnapshotUploadRow(const std::array<u8, GX_GPU_VRAM_BYTE_COUNT>& snapshotBytes, u32 logicalY) {
	size_t rowByteOffset = 0u;
	size_t snapshotByteOffset = static_cast<size_t>(logicalY) * static_cast<size_t>(kGxGpuVramWidth) * 2u;
	for (i32 column = 0; column < kGxGpuVramWidth; column += 1) {
		g_rawVramUploadRow[rowByteOffset] = snapshotBytes[snapshotByteOffset];
		g_rawVramUploadRow[rowByteOffset + 1u] = snapshotBytes[snapshotByteOffset + 1u];
		g_rawVramUploadRow[rowByteOffset + 2u] = 0u;
		g_rawVramUploadRow[rowByteOffset + 3u] = 0xffu;
		rowByteOffset += kGxGpuRawVramBytesPerPixel;
		snapshotByteOffset += 2u;
	}
}

void uploadGxGpuVramSnapshot(const std::array<u8, GX_GPU_VRAM_BYTE_COUNT>& snapshotBytes) {
	invalidateGxGpuSampleSourceCache();
	g_gxGpu.backend->setRenderTarget(0, kGxGpuVramWidth, kGxGpuVramHeight);
	g_gxGpu.backend->setActiveTextureUnit(kGxGpuScanoutTextureUnit);
	g_gxGpu.backend->bindTexture2D(&g_gxGpu.vramTexture);
	for (i32 logicalY = 0; logicalY < kGxGpuVramHeight; logicalY += 1) {
		writeVramSnapshotUploadRow(snapshotBytes, static_cast<u32>(logicalY));
		glTexSubImage2D(GL_TEXTURE_2D, 0, 0, (kGxGpuVramHeight - 1) - logicalY, kGxGpuVramWidth, 1, GL_RGBA, GL_UNSIGNED_BYTE, g_rawVramUploadRow.data());
	}
}

void writeGxGpuVramSnapshotFromReadback() {
	size_t snapshotByteOffset = 0u;
	for (i32 logicalY = 0; logicalY < kGxGpuVramHeight; logicalY += 1) {
		size_t readbackByteOffset = static_cast<size_t>((kGxGpuVramHeight - 1) - logicalY) * static_cast<size_t>(kGxGpuVramWidth) * kGxGpuRawVramBytesPerPixel;
		for (i32 column = 0; column < kGxGpuVramWidth; column += 1) {
			g_vramSnapshotScratch[snapshotByteOffset] = g_rawVramReadback[readbackByteOffset];
			g_vramSnapshotScratch[snapshotByteOffset + 1u] = g_rawVramReadback[readbackByteOffset + 1u];
			snapshotByteOffset += 2u;
			readbackByteOffset += kGxGpuRawVramBytesPerPixel;
		}
	}
}

void writeCpuToVramUploadRow(const GxGpuCommandBuffer& commandBuffer, u32 payloadWordStart, u32 rowPixelStart, u32 width) {
	size_t rowByteOffset = 0u;
	for (u32 column = 0u; column < width; column += 1u) {
		const u32 pixelIndex = rowPixelStart + column;
		const u32 payloadWord = commandBuffer.words[payloadWordStart + (pixelIndex >> 1u)];
		rowByteOffset = writeRawVramUploadPixel(rowByteOffset, gxGpuTransferPixelWord(payloadWord, pixelIndex));
	}
}

void copyGxGpuVramLogicalAreaToSampleTexture(u32 x, u32 y, u32 width, u32 height);
void renderTransferCommands(size_t vertexFloatCount, GLES2Texture& sourceTexture, i32 sourceTextureUnit, u32 maskBitModeWord);

void uploadCpuToVram(const GxGpuCommandBuffer& commandBuffer, u32 commandIndex) {
	const u32 wordStart = commandBuffer.commandWordStart[commandIndex];
	const u32 xyWord = commandBuffer.words[wordStart + 1u];
	const u32 sizeWord = commandBuffer.words[wordStart + 2u];
	const u32 x = gxGpuTransferX(xyWord);
	const u32 y = gxGpuTransferY(xyWord);
	const u32 width = gxGpuTransferWidth(sizeWord);
	const u32 height = gxGpuTransferHeight(sizeWord);
	const u32 uploadedPixels = gxGpuTransferEmittedPixelCount(width, height, commandBuffer.commandWordCount[commandIndex]);
	const u32 fullRows = (uploadedPixels - (uploadedPixels % width)) / width;
	const u32 lastRowWidth = uploadedPixels % width;
	const u32 uploadHeight = fullRows + (lastRowWidth != 0u ? 1u : 0u);
	const u32 payloadWordStart = wordStart + 3u;
	const u32 maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
	size_t transferVertexFloatCount = 0u;
	invalidateGxGpuSampleSourceCacheForWrite(static_cast<i32>(x), static_cast<i32>(y), static_cast<i32>(x + width), static_cast<i32>(y + uploadHeight));

	g_gxGpu.backend->setRenderTarget(0, kGxGpuVramWidth, kGxGpuVramHeight);
	g_gxGpu.backend->setActiveTextureUnit(maskBitModeWord == 0u ? kGxGpuScanoutTextureUnit : kGxGpuTextureTransferUnit);
	g_gxGpu.backend->bindTexture2D(maskBitModeWord == 0u ? &g_gxGpu.vramTexture : &g_gxGpu.vramTransferTexture);
	for (u32 row = 0u; row < uploadHeight; row += 1u) {
		const u32 rowWidth = row == fullRows ? lastRowWidth : width;
		writeCpuToVramUploadRow(commandBuffer, payloadWordStart, row * width, rowWidth);
		const u32 targetY = (y + row) & (static_cast<u32>(kGxGpuVramHeight) - 1u);
		const u32 storageY = (static_cast<u32>(kGxGpuVramHeight) - 1u) - targetY;
		const u32 firstWidth = gxGpuVramWrappedWidth(x, rowWidth);
		glTexSubImage2D(GL_TEXTURE_2D, 0, static_cast<GLint>(x), static_cast<GLint>(storageY), static_cast<GLsizei>(firstWidth), 1, GL_RGBA, GL_UNSIGNED_BYTE, g_rawVramUploadRow.data());
		if (maskBitModeWord != 0u) {
			transferVertexFloatCount = appendTransferQuad(transferVertexFloatCount, x, targetY, firstWidth, 1u, x, targetY);
		}
		if (firstWidth != rowWidth) {
			glTexSubImage2D(
				GL_TEXTURE_2D,
				0,
				0,
				static_cast<GLint>(storageY),
				static_cast<GLsizei>(rowWidth - firstWidth),
				1,
				GL_RGBA,
				GL_UNSIGNED_BYTE,
				g_rawVramUploadRow.data() + firstWidth * kGxGpuRawVramBytesPerPixel);
			if (maskBitModeWord != 0u) {
				transferVertexFloatCount = appendTransferQuad(transferVertexFloatCount, 0u, targetY, rowWidth - firstWidth, 1u, 0u, targetY);
			}
		}
	}
	if (maskBitModeWord != 0u) {
		if (gxGpuMaskBitCheckBeforeDraw(maskBitModeWord)) {
			copyGxGpuVramLogicalAreaToSampleTexture(x, y, width, uploadHeight);
		}
		renderTransferCommands(transferVertexFloatCount, g_gxGpu.vramTransferTexture, kGxGpuTextureTransferUnit, maskBitModeWord);
	}
}

void copyVramToVramArea(
		u32 sourceX,
	u32 sourceY,
	u32 targetX,
	u32 targetY,
	u32 width,
	u32 height,
	u32 maskBitModeWord) {
	invalidateGxGpuSampleSourceCacheForWrite(static_cast<i32>(targetX), static_cast<i32>(targetY), static_cast<i32>(targetX + width), static_cast<i32>(targetY + height));
	size_t transferVertexFloatCount = 0u;
	for (u32 row = 0u; row < height; row += 1u) {
		const u32 rowSourceY = (sourceY + row) & (static_cast<u32>(kGxGpuVramHeight) - 1u);
		const u32 rowTargetY = (targetY + row) & (static_cast<u32>(kGxGpuVramHeight) - 1u);
		u32 rowSourceX = sourceX;
		u32 rowTargetX = targetX;
		u32 remainingWidth = width;
		while (remainingWidth != 0u) {
			const u32 sourceRunWidth = gxGpuVramWrappedWidth(rowSourceX, remainingWidth);
			const u32 targetRunWidth = gxGpuVramWrappedWidth(rowTargetX, remainingWidth);
			const u32 runWidth = sourceRunWidth < targetRunWidth ? sourceRunWidth : targetRunWidth;
			transferVertexFloatCount = appendTransferQuad(transferVertexFloatCount, rowTargetX, rowTargetY, runWidth, 1u, rowSourceX, rowSourceY);
			rowSourceX = (rowSourceX + runWidth) & (static_cast<u32>(kGxGpuVramWidth) - 1u);
			rowTargetX = (rowTargetX + runWidth) & (static_cast<u32>(kGxGpuVramWidth) - 1u);
			remainingWidth -= runWidth;
		}
	}
	copyGxGpuVramLogicalAreaToSampleTexture(sourceX, sourceY, width, height);
	if (gxGpuMaskBitCheckBeforeDraw(maskBitModeWord)) {
		copyGxGpuVramLogicalAreaToSampleTexture(targetX, targetY, width, height);
	}
	renderTransferCommands(transferVertexFloatCount, g_gxGpu.vramSampleTexture, kGxGpuTextureSampleUnit, maskBitModeWord);
}

void copyVramToVram(const GxGpuCommandBuffer& commandBuffer, u32 commandIndex) {
	const u32 wordStart = commandBuffer.commandWordStart[commandIndex];
	const u32 sourceWord = commandBuffer.words[wordStart + 1u];
	const u32 targetWord = commandBuffer.words[wordStart + 2u];
	const u32 sizeWord = commandBuffer.words[wordStart + 3u];
	const u32 sourceX = gxGpuTransferX(sourceWord);
	const u32 sourceY = gxGpuTransferY(sourceWord);
	const u32 targetX = gxGpuTransferX(targetWord);
	const u32 targetY = gxGpuTransferY(targetWord);
	const u32 width = gxGpuTransferWidth(sizeWord);
	const u32 height = gxGpuTransferHeight(sizeWord);
	const u32 maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
	if (gxGpuVramCopyNeedsChunking(sourceX, sourceY, targetX, targetY, width, height)) {
		const u32 chunkHeight = gxGpuVramCopyChunkHeight(sourceY, targetY, height);
		for (u32 chunkTargetY = targetY; chunkTargetY < targetY + height; chunkTargetY += chunkHeight) {
			const u32 chunkSourceY = sourceY + (chunkTargetY - targetY);
			const u32 remainingHeight = targetY + height - chunkTargetY;
			const u32 currentChunkHeight = chunkHeight < remainingHeight ? chunkHeight : remainingHeight;
			copyVramToVramArea(sourceX, chunkSourceY, targetX, chunkTargetY, width, currentChunkHeight, maskBitModeWord);
		}
		return;
	}
	copyVramToVramArea(sourceX, sourceY, targetX, targetY, width, height, maskBitModeWord);
}

void applyGxGpuDrawingAreaScissor(u32 topLeftWord, u32 bottomRightWord) {
	const u32 left = gxGpuDrawingAreaLeft(topLeftWord, bottomRightWord);
	const u32 top = gxGpuDrawingAreaTop(topLeftWord, bottomRightWord);
	const u32 right = gxGpuDrawingAreaRightExclusive(topLeftWord, bottomRightWord);
	const u32 bottom = gxGpuDrawingAreaBottomExclusive(topLeftWord, bottomRightWord);
	glEnable(GL_SCISSOR_TEST);
	glScissor(
		static_cast<GLint>(left),
		static_cast<GLint>(static_cast<u32>(kGxGpuVramHeight) - bottom),
		static_cast<GLsizei>(right - left),
		static_cast<GLsizei>(bottom - top));
}

void resetGxGpuVramCopyRect(GxGpuVramCopyRect& rect) {
	rect.left = kGxGpuVramWidth;
	rect.top = kGxGpuVramHeight;
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

bool gxGpuVramCopyRectsOverlap(const GxGpuVramCopyRect& a, const GxGpuVramCopyRect& b) {
	return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

bool gxGpuVramCopyRectsEqual(const GxGpuVramCopyRect& a, const GxGpuVramCopyRect& b) {
	return a.left == b.left && a.top == b.top && a.right == b.right && a.bottom == b.bottom;
}

void invalidateGxGpuSampleSourceCache() {
	g_gxGpu.sampleSourceRectCount = 0u;
	g_gxGpu.sampleSourceRectHash = 0u;
	g_gxGpu.sampleSourceTileMask0 = 0u;
	g_gxGpu.sampleSourceTileMask1 = 0u;
	g_gxGpu.sampleSourceTileMask2 = 0u;
	g_gxGpu.sampleSourceTileMask3 = 0u;
}

void resetGxGpuSampleSourceCandidateMasks() {
	g_gxGpu.sampleSourceCandidateTileMask0 = 0u;
	g_gxGpu.sampleSourceCandidateTileMask1 = 0u;
	g_gxGpu.sampleSourceCandidateTileMask2 = 0u;
	g_gxGpu.sampleSourceCandidateTileMask3 = 0u;
}

void includeGxGpuSampleSourceCandidateMaskArea(i32 left, i32 top, i32 right, i32 bottom) {
	if (right <= left || bottom <= top) {
		return;
	}
	const u32 tileLeft = static_cast<u32>(left) >> kGxGpuSampleSourceTileShift;
	const u32 tileRight = static_cast<u32>(right - 1) >> kGxGpuSampleSourceTileShift;
	const u32 tileTop = static_cast<u32>(top) >> kGxGpuSampleSourceTileShift;
	const u32 tileBottom = static_cast<u32>(bottom - 1) >> kGxGpuSampleSourceTileShift;
	for (u32 tileY = tileTop; tileY <= tileBottom; tileY += 1u) {
		for (u32 tileX = tileLeft; tileX <= tileRight; tileX += 1u) {
			const u32 tileIndex = tileY * kGxGpuSampleSourceTileColumns + tileX;
			const u32 bit = 1u << (tileIndex & 31u);
			switch (tileIndex >> 5u) {
				case 0u:
					g_gxGpu.sampleSourceCandidateTileMask0 |= bit;
					break;
				case 1u:
					g_gxGpu.sampleSourceCandidateTileMask1 |= bit;
					break;
				case 2u:
					g_gxGpu.sampleSourceCandidateTileMask2 |= bit;
					break;
				default:
					g_gxGpu.sampleSourceCandidateTileMask3 |= bit;
					break;
			}
		}
	}
}

void appendGxGpuSampleSourceCandidateMaskRect(i32 x, i32 y, i32 width, i32 height) {
	if (width <= 0 || height <= 0) {
		return;
	}
	u32 rowY = static_cast<u32>(y) & (GX_GPU_VRAM_HEIGHT - 1u);
	u32 remainingHeight = static_cast<u32>(height);
	while (remainingHeight != 0u) {
		const u32 runHeight = gxGpuVramWrappedHeight(rowY, remainingHeight);
		u32 columnX = static_cast<u32>(x) & (GX_GPU_VRAM_WIDTH - 1u);
		u32 remainingWidth = static_cast<u32>(width);
		while (remainingWidth != 0u) {
			const u32 runWidth = gxGpuVramWrappedWidth(columnX, remainingWidth);
			includeGxGpuSampleSourceCandidateMaskArea(
				static_cast<i32>(columnX),
				static_cast<i32>(rowY),
				static_cast<i32>(columnX + runWidth),
				static_cast<i32>(rowY + runHeight));
			columnX = (columnX + runWidth) & (GX_GPU_VRAM_WIDTH - 1u);
			remainingWidth -= runWidth;
		}
		rowY = (rowY + runHeight) & (GX_GPU_VRAM_HEIGHT - 1u);
		remainingHeight -= runHeight;
	}
}

void invalidateGxGpuSampleSourceCacheForWrite(i32 left, i32 top, i32 right, i32 bottom) {
	if (g_gxGpu.sampleSourceRectCount == 0u || right <= left || bottom <= top) {
		return;
	}
	resetGxGpuSampleSourceCandidateMasks();
	appendGxGpuSampleSourceCandidateMaskRect(left, top, right - left, bottom - top);
	if (((g_gxGpu.sampleSourceCandidateTileMask0 & g_gxGpu.sampleSourceTileMask0)
			| (g_gxGpu.sampleSourceCandidateTileMask1 & g_gxGpu.sampleSourceTileMask1)
			| (g_gxGpu.sampleSourceCandidateTileMask2 & g_gxGpu.sampleSourceTileMask2)
			| (g_gxGpu.sampleSourceCandidateTileMask3 & g_gxGpu.sampleSourceTileMask3)) != 0u) {
		invalidateGxGpuSampleSourceCache();
	}
}

void resetGxGpuSampleSourceCandidateRects() {
	g_gxGpu.sampleSourceCandidateRectCount = 0u;
	g_gxGpu.sampleSourceCandidateRectHash = 0u;
	resetGxGpuSampleSourceCandidateMasks();
}

u32 hashGxGpuSampleSourceRect(u32 hash, u32 x, u32 y, u32 width, u32 height) {
	u32 value = (hash ^ x) * 0x45d9f3bu;
	value = (value ^ y) * 0x45d9f3bu;
	value = (value ^ width) * 0x45d9f3bu;
	return (value ^ height) * 0x45d9f3bu;
}

void appendGxGpuSampleSourceCandidateRect(u32 x, u32 y, u32 width, u32 height) {
	GxGpuVramCopyRect& rect = g_gxGpu.sampleSourceCandidateRects[g_gxGpu.sampleSourceCandidateRectCount];
	rect.left = static_cast<i32>(x);
	rect.top = static_cast<i32>(y);
	rect.right = static_cast<i32>(x + width);
	rect.bottom = static_cast<i32>(y + height);
	g_gxGpu.sampleSourceCandidateRectHash = hashGxGpuSampleSourceRect(g_gxGpu.sampleSourceCandidateRectHash, x, y, width, height);
	appendGxGpuSampleSourceCandidateMaskRect(static_cast<i32>(x), static_cast<i32>(y), static_cast<i32>(width), static_cast<i32>(height));
	g_gxGpu.sampleSourceCandidateRectCount += 1u;
}

bool gxGpuSampleSourceCandidateCacheMatches() {
	return g_gxGpu.sampleSourceRectCount == g_gxGpu.sampleSourceCandidateRectCount
		&& g_gxGpu.sampleSourceRectHash == g_gxGpu.sampleSourceCandidateRectHash
		&& g_gxGpu.sampleSourceTileMask0 == g_gxGpu.sampleSourceCandidateTileMask0
		&& g_gxGpu.sampleSourceTileMask1 == g_gxGpu.sampleSourceCandidateTileMask1
		&& g_gxGpu.sampleSourceTileMask2 == g_gxGpu.sampleSourceCandidateTileMask2
		&& g_gxGpu.sampleSourceTileMask3 == g_gxGpu.sampleSourceCandidateTileMask3
		&& gxGpuVramCopyRectsEqual(g_gxGpu.sampleSourceRects[0], g_gxGpu.sampleSourceCandidateRects[0])
		&& gxGpuVramCopyRectsEqual(g_gxGpu.sampleSourceRects[1], g_gxGpu.sampleSourceCandidateRects[1])
		&& gxGpuVramCopyRectsEqual(g_gxGpu.sampleSourceRects[2], g_gxGpu.sampleSourceCandidateRects[2]);
}

void writeGxGpuSampleSourceCandidateCache() {
	g_gxGpu.sampleSourceRects[0] = g_gxGpu.sampleSourceCandidateRects[0];
	g_gxGpu.sampleSourceRects[1] = g_gxGpu.sampleSourceCandidateRects[1];
	g_gxGpu.sampleSourceRects[2] = g_gxGpu.sampleSourceCandidateRects[2];
	g_gxGpu.sampleSourceRectCount = g_gxGpu.sampleSourceCandidateRectCount;
	g_gxGpu.sampleSourceRectHash = g_gxGpu.sampleSourceCandidateRectHash;
	g_gxGpu.sampleSourceTileMask0 = g_gxGpu.sampleSourceCandidateTileMask0;
	g_gxGpu.sampleSourceTileMask1 = g_gxGpu.sampleSourceCandidateTileMask1;
	g_gxGpu.sampleSourceTileMask2 = g_gxGpu.sampleSourceCandidateTileMask2;
	g_gxGpu.sampleSourceTileMask3 = g_gxGpu.sampleSourceCandidateTileMask3;
}

void copyGxGpuVramAreaToSampleTexture(i32 left, i32 top, i32 right, i32 bottom) {
	if (right <= left || bottom <= top) {
		return;
	}
	const i32 storageY = kGxGpuVramHeight - bottom;
	g_gxGpu.backend->setRenderTarget(g_gxGpu.vramFramebuffer, kGxGpuVramWidth, kGxGpuVramHeight);
	g_gxGpu.backend->setActiveTextureUnit(kGxGpuTextureSampleUnit);
	g_gxGpu.backend->bindTexture2D(&g_gxGpu.vramSampleTexture);
	glCopyTexSubImage2D(
		GL_TEXTURE_2D,
		0,
		static_cast<GLint>(left),
		static_cast<GLint>(storageY),
		static_cast<GLint>(left),
		static_cast<GLint>(storageY),
		static_cast<GLsizei>(right - left),
		static_cast<GLsizei>(bottom - top));
}

void copyGxGpuVramLogicalAreaToSampleTexture(u32 x, u32 y, u32 width, u32 height) {
	u32 rowY = y & (GX_GPU_VRAM_HEIGHT - 1u);
	u32 remainingHeight = height;
	while (remainingHeight != 0u) {
		const u32 runHeight = gxGpuVramWrappedHeight(rowY, remainingHeight);
		u32 columnX = x & (GX_GPU_VRAM_WIDTH - 1u);
		u32 remainingWidth = width;
		while (remainingWidth != 0u) {
			const u32 runWidth = gxGpuVramWrappedWidth(columnX, remainingWidth);
			copyGxGpuVramAreaToSampleTexture(
				static_cast<i32>(columnX),
				static_cast<i32>(rowY),
				static_cast<i32>(columnX + runWidth),
				static_cast<i32>(rowY + runHeight));
			columnX = (columnX + runWidth) & (GX_GPU_VRAM_WIDTH - 1u);
			remainingWidth -= runWidth;
		}
		rowY = (rowY + runHeight) & (GX_GPU_VRAM_HEIGHT - 1u);
		remainingHeight -= runHeight;
	}
}

void setGxGpuVertexBoundsRect(
	GxGpuVramCopyRect& rect,
	const f32* vertices,
	size_t vertexFloatStart,
	size_t vertexFloatEnd,
	size_t vertexFloatStride,
	u32 topLeftWord,
	u32 bottomRightWord) {
	resetGxGpuVramCopyRect(rect);
	for (size_t offset = vertexFloatStart; offset < vertexFloatEnd; offset += vertexFloatStride) {
		includeGxGpuVramCopyVertex(rect, static_cast<i32>(vertices[offset]), static_cast<i32>(vertices[offset + 1u]));
	}
	const i32 drawingLeft = static_cast<i32>(gxGpuDrawingAreaLeft(topLeftWord, bottomRightWord));
	const i32 drawingTop = static_cast<i32>(gxGpuDrawingAreaTop(topLeftWord, bottomRightWord));
	const i32 drawingRight = static_cast<i32>(gxGpuDrawingAreaRightExclusive(topLeftWord, bottomRightWord));
	const i32 drawingBottom = static_cast<i32>(gxGpuDrawingAreaBottomExclusive(topLeftWord, bottomRightWord));
	const i32 left = rect.left > drawingLeft ? rect.left : drawingLeft;
	const i32 top = rect.top > drawingTop ? rect.top : drawingTop;
	const i32 right = rect.right < drawingRight ? rect.right : drawingRight;
	const i32 bottom = rect.bottom < drawingBottom ? rect.bottom : drawingBottom;
	rect.left = left;
	rect.top = top;
	rect.right = right;
	rect.bottom = bottom;
}

void copyGxGpuVertexBoundsToSampleTexture(
		const f32* vertices,
	size_t vertexFloatCount,
	size_t vertexFloatStride,
	u32 topLeftWord,
	u32 bottomRightWord) {
	setGxGpuVertexBoundsRect(g_vramCopyRectScratch, vertices, 0u, vertexFloatCount, vertexFloatStride, topLeftWord, bottomRightWord);
	copyGxGpuVramAreaToSampleTexture(g_vramCopyRectScratch.left, g_vramCopyRectScratch.top, g_vramCopyRectScratch.right, g_vramCopyRectScratch.bottom);
}

void copyGxGpuTexturedSourceToSampleTexture(const GxGpuCommandBuffer& commandBuffer, u32 commandIndex, size_t vertexFloatCount) {
	const u32 wordStart = commandBuffer.commandWordStart[commandIndex];
	const u32 textureWord = commandBuffer.words[wordStart + 2u];
	const u32 drawModeWord = commandBuffer.commandDrawModeWord[commandIndex];
	const u32 textureMode = gxGpuDrawModeTextureMode(drawModeWord);
	const u32 pageX = gxGpuDrawModeTexturePageBaseX(drawModeWord);
	const u32 pageY = gxGpuDrawModeTexturePageBaseY(drawModeWord);
	const u32 clutX = gxGpuTextureClutBaseX(textureWord);
	const u32 clutY = gxGpuTextureClutBaseY(textureWord);
	resetGxGpuSampleSourceCandidateRects();
	GxGpuVramCopyRect& rect = g_vramCopyRectScratch;
	resetGxGpuVramCopyRect(rect);
	for (size_t offset = 0u; offset < vertexFloatCount; offset += kGxGpuTexturedVertexFloats) {
		includeGxGpuVramCopyVertex(rect, static_cast<i32>(g_texturedVertices[offset + 5u]), static_cast<i32>(g_texturedVertices[offset + 6u]));
	}
	const bool copyCompleteTexturePage = commandBuffer.commandTextureWindowWord[commandIndex] != 0u
		|| rect.left < 0
		|| rect.top < 0
		|| rect.right > static_cast<i32>(kGxGpuTexturePageCoordSize)
		|| rect.bottom > static_cast<i32>(kGxGpuTexturePageCoordSize);
	if (textureMode == 0u) {
		if (copyCompleteTexturePage) {
			appendGxGpuSampleSourceCandidateRect(pageX, pageY, kGxGpuTexturePage4BitWidthWords, kGxGpuTexturePageCoordSize);
			appendGxGpuSampleSourceCandidateRect(clutX, clutY, kGxGpuClut4BitWords, 1u);
			if (gxGpuSampleSourceCandidateCacheMatches()) {
				return;
			}
			copyGxGpuVramLogicalAreaToSampleTexture(pageX, pageY, kGxGpuTexturePage4BitWidthWords, kGxGpuTexturePageCoordSize);
		} else {
			const u32 wordLeft = static_cast<u32>(rect.left) >> 2u;
			const u32 wordRight = static_cast<u32>(rect.right + 3) >> 2u;
			appendGxGpuSampleSourceCandidateRect(pageX + wordLeft, pageY + static_cast<u32>(rect.top), wordRight - wordLeft, static_cast<u32>(rect.bottom - rect.top));
			appendGxGpuSampleSourceCandidateRect(clutX, clutY, kGxGpuClut4BitWords, 1u);
			if (gxGpuSampleSourceCandidateCacheMatches()) {
				return;
			}
			copyGxGpuVramLogicalAreaToSampleTexture(pageX + wordLeft, pageY + static_cast<u32>(rect.top), wordRight - wordLeft, static_cast<u32>(rect.bottom - rect.top));
		}
		copyGxGpuVramLogicalAreaToSampleTexture(clutX, clutY, kGxGpuClut4BitWords, 1u);
		writeGxGpuSampleSourceCandidateCache();
		return;
	}
	if (textureMode == 1u) {
		if (copyCompleteTexturePage) {
			appendGxGpuSampleSourceCandidateRect(pageX, pageY, kGxGpuTexturePage8BitWidthWords, kGxGpuTexturePageCoordSize);
			appendGxGpuSampleSourceCandidateRect(clutX, clutY, kGxGpuClut8BitWords, 1u);
			if (gxGpuSampleSourceCandidateCacheMatches()) {
				return;
			}
			copyGxGpuVramLogicalAreaToSampleTexture(pageX, pageY, kGxGpuTexturePage8BitWidthWords, kGxGpuTexturePageCoordSize);
		} else {
			const u32 wordLeft = static_cast<u32>(rect.left) >> 1u;
			const u32 wordRight = static_cast<u32>(rect.right + 1) >> 1u;
			appendGxGpuSampleSourceCandidateRect(pageX + wordLeft, pageY + static_cast<u32>(rect.top), wordRight - wordLeft, static_cast<u32>(rect.bottom - rect.top));
			appendGxGpuSampleSourceCandidateRect(clutX, clutY, kGxGpuClut8BitWords, 1u);
			if (gxGpuSampleSourceCandidateCacheMatches()) {
				return;
			}
			copyGxGpuVramLogicalAreaToSampleTexture(pageX + wordLeft, pageY + static_cast<u32>(rect.top), wordRight - wordLeft, static_cast<u32>(rect.bottom - rect.top));
		}
		copyGxGpuVramLogicalAreaToSampleTexture(clutX, clutY, kGxGpuClut8BitWords, 1u);
		writeGxGpuSampleSourceCandidateCache();
		return;
	}
	if (copyCompleteTexturePage) {
		appendGxGpuSampleSourceCandidateRect(pageX, pageY, kGxGpuTexturePageCoordSize, kGxGpuTexturePageCoordSize);
		if (gxGpuSampleSourceCandidateCacheMatches()) {
			return;
		}
		copyGxGpuVramLogicalAreaToSampleTexture(pageX, pageY, kGxGpuTexturePageCoordSize, kGxGpuTexturePageCoordSize);
		writeGxGpuSampleSourceCandidateCache();
		return;
	}
	appendGxGpuSampleSourceCandidateRect(pageX + static_cast<u32>(rect.left), pageY + static_cast<u32>(rect.top), static_cast<u32>(rect.right - rect.left), static_cast<u32>(rect.bottom - rect.top));
	if (gxGpuSampleSourceCandidateCacheMatches()) {
		return;
	}
	copyGxGpuVramLogicalAreaToSampleTexture(pageX + static_cast<u32>(rect.left), pageY + static_cast<u32>(rect.top), static_cast<u32>(rect.right - rect.left), static_cast<u32>(rect.bottom - rect.top));
	writeGxGpuSampleSourceCandidateCache();
}

void copyGxGpuTexturedSampleRegionsToTexture(
		const GxGpuCommandBuffer& commandBuffer,
	u32 commandIndex,
	size_t vertexFloatCount,
	u32 topLeftWord,
	u32 bottomRightWord) {
	copyGxGpuTexturedSourceToSampleTexture(commandBuffer, commandIndex, vertexFloatCount);
	const u32 opcode = commandBuffer.commandOpcode[commandIndex];
	const u32 maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
	if (gxGpuCommandSemiTransparencyEnabled(opcode) || gxGpuMaskBitCheckBeforeDraw(maskBitModeWord)) {
		copyGxGpuVertexBoundsToSampleTexture(g_texturedVertices.data(), vertexFloatCount, kGxGpuTexturedVertexFloats, topLeftWord, bottomRightWord);
	}
}

void writePrimitiveUniforms(
	GLint vramUniform,
	GLint blendEnableUniform,
	GLint blendModeUniform,
	GLint checkMaskBitUniform,
	GLint setMaskBitUniform,
	GLint ditherEnableUniform,
	GLint interlacedRenderWordUniform,
	bool blendEnabled,
	u32 blendMode,
	u32 maskBitModeWord,
	bool ditherEnabled,
	u32 interlacedRenderWord) {
	glUniform1i(vramUniform, kGxGpuTextureSampleUnit);
	glUniform1f(blendEnableUniform, blendEnabled ? 1.0f : 0.0f);
	glUniform1f(blendModeUniform, static_cast<f32>(blendMode));
	glUniform1f(checkMaskBitUniform, gxGpuMaskBitCheckBeforeDraw(maskBitModeWord) ? 1.0f : 0.0f);
	glUniform1f(setMaskBitUniform, gxGpuMaskBitSetWhileDrawing(maskBitModeWord) ? 1.0f : 0.0f);
	glUniform1f(ditherEnableUniform, ditherEnabled ? 1.0f : 0.0f);
	glUniform1f(interlacedRenderWordUniform, static_cast<f32>(interlacedRenderWord));
}

void writeTexturedUniforms(const GxGpuCommandBuffer& commandBuffer, u32 commandIndex) {
	const u32 opcode = commandBuffer.commandOpcode[commandIndex];
	const u32 drawModeWord = commandBuffer.commandDrawModeWord[commandIndex];
	const u32 textureWord = commandBuffer.words[commandBuffer.commandWordStart[commandIndex] + 2u];
	const u32 textureWindowWord = commandBuffer.commandTextureWindowWord[commandIndex];
	const u32 maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
	glUniform1i(g_gxGpu.texturedVramUniform, kGxGpuTextureSampleUnit);
	glUniform2f(g_gxGpu.texturedTexPageBaseUniform, static_cast<f32>(gxGpuDrawModeTexturePageBaseX(drawModeWord)), static_cast<f32>(gxGpuDrawModeTexturePageBaseY(drawModeWord)));
	glUniform2f(g_gxGpu.texturedClutBaseUniform, static_cast<f32>(gxGpuTextureClutBaseX(textureWord)), static_cast<f32>(gxGpuTextureClutBaseY(textureWord)));
	glUniform2f(g_gxGpu.texturedTextureWindowAndUniform, static_cast<f32>(gxGpuTextureWindowAndX(textureWindowWord)), static_cast<f32>(gxGpuTextureWindowAndY(textureWindowWord)));
	glUniform2f(g_gxGpu.texturedTextureWindowOrUniform, static_cast<f32>(gxGpuTextureWindowOrX(textureWindowWord)), static_cast<f32>(gxGpuTextureWindowOrY(textureWindowWord)));
	glUniform1f(g_gxGpu.texturedTextureModeUniform, static_cast<f32>(gxGpuDrawModeTextureMode(drawModeWord)));
	glUniform1f(g_gxGpu.texturedRawTextureUniform, gxGpuCommandRawTextureEnabled(opcode) ? 1.0f : 0.0f);
	glUniform1f(g_gxGpu.texturedBlendEnableUniform, gxGpuCommandSemiTransparencyEnabled(opcode) ? 1.0f : 0.0f);
	glUniform1f(g_gxGpu.texturedBlendModeUniform, static_cast<f32>(gxGpuDrawModeTransparencyMode(drawModeWord)));
	glUniform1f(g_gxGpu.texturedCheckMaskBitUniform, gxGpuMaskBitCheckBeforeDraw(maskBitModeWord) ? 1.0f : 0.0f);
	glUniform1f(g_gxGpu.texturedSetMaskBitUniform, gxGpuMaskBitSetWhileDrawing(maskBitModeWord) ? 1.0f : 0.0f);
	glUniform1f(
		g_gxGpu.texturedDitherEnableUniform,
		commandBuffer.commandKind[commandIndex] == GX_GPU_COMMAND_DRAW_POLYGON && gxGpuDitheredPolygon(drawModeWord, opcode) ? 1.0f : 0.0f);
	glUniform1f(g_gxGpu.texturedInterlacedRenderWordUniform, static_cast<f32>(commandBuffer.commandInterlacedRenderWord[commandIndex]));
}

void writeTexturedUvPlaneUniforms(size_t planeIndex) {
	const size_t offset = planeIndex * GX_GPU_TRIANGLE_UV_PLANE_WORDS;
	const u32 baseU = static_cast<u32>(g_texturedUvPlanes[offset + GX_GPU_TRIANGLE_UV_BASE_U]);
	const u32 baseV = static_cast<u32>(g_texturedUvPlanes[offset + GX_GPU_TRIANGLE_UV_BASE_V]);
	const u32 stepXU = static_cast<u32>(g_texturedUvPlanes[offset + GX_GPU_TRIANGLE_UV_STEP_X_U]);
	const u32 stepXV = static_cast<u32>(g_texturedUvPlanes[offset + GX_GPU_TRIANGLE_UV_STEP_X_V]);
	const u32 stepYU = static_cast<u32>(g_texturedUvPlanes[offset + GX_GPU_TRIANGLE_UV_STEP_Y_U]);
	const u32 stepYV = static_cast<u32>(g_texturedUvPlanes[offset + GX_GPU_TRIANGLE_UV_STEP_Y_V]);
	const size_t vertexOffset = planeIndex * 3u * kGxGpuTexturedVertexFloats;
	const i32 originX = static_cast<i32>(g_texturedVertices[vertexOffset]);
	const i32 originY = static_cast<i32>(g_texturedVertices[vertexOffset + 1u]);
	const u32 originU = static_cast<u32>((static_cast<i64>(baseU) + static_cast<i64>(originX) * stepXU + static_cast<i64>(originY) * stepYU) & GX_GPU_TRIANGLE_UV_ACCUMULATOR_MASK);
	const u32 originV = static_cast<u32>((static_cast<i64>(baseV) + static_cast<i64>(originX) * stepXV + static_cast<i64>(originY) * stepYV) & GX_GPU_TRIANGLE_UV_ACCUMULATOR_MASK);
	glUniform1f(g_gxGpu.texturedUvPlaneEnableUniform, 1.0f);
	glUniform4f(g_gxGpu.texturedUvPlaneBase01Uniform, static_cast<f32>(originU & 0x0fu), static_cast<f32>(originV & 0x0fu), static_cast<f32>((originU >> 4u) & 0x0fu), static_cast<f32>((originV >> 4u) & 0x0fu));
	glUniform4f(g_gxGpu.texturedUvPlaneBase23Uniform, static_cast<f32>((originU >> 8u) & 0x0fu), static_cast<f32>((originV >> 8u) & 0x0fu), static_cast<f32>((originU >> 12u) & 0x0fu), static_cast<f32>((originV >> 12u) & 0x0fu));
	glUniform4f(g_gxGpu.texturedUvPlaneStepX01Uniform, static_cast<f32>(stepXU & 0x0fu), static_cast<f32>(stepXV & 0x0fu), static_cast<f32>((stepXU >> 4u) & 0x0fu), static_cast<f32>((stepXV >> 4u) & 0x0fu));
	glUniform4f(g_gxGpu.texturedUvPlaneStepX23Uniform, static_cast<f32>((stepXU >> 8u) & 0x0fu), static_cast<f32>((stepXV >> 8u) & 0x0fu), static_cast<f32>((stepXU >> 12u) & 0x0fu), static_cast<f32>((stepXV >> 12u) & 0x0fu));
	glUniform4f(g_gxGpu.texturedUvPlaneStepY01Uniform, static_cast<f32>(stepYU & 0x0fu), static_cast<f32>(stepYV & 0x0fu), static_cast<f32>((stepYU >> 4u) & 0x0fu), static_cast<f32>((stepYV >> 4u) & 0x0fu));
	glUniform4f(g_gxGpu.texturedUvPlaneStepY23Uniform, static_cast<f32>((stepYU >> 8u) & 0x0fu), static_cast<f32>((stepYV >> 8u) & 0x0fu), static_cast<f32>((stepYU >> 12u) & 0x0fu), static_cast<f32>((stepYV >> 12u) & 0x0fu));
	glUniform4f(g_gxGpu.texturedUvPlaneDigit4BaseStepXUniform, static_cast<f32>((originU >> 16u) & 0x0fu), static_cast<f32>((originV >> 16u) & 0x0fu), static_cast<f32>((stepXU >> 16u) & 0x0fu), static_cast<f32>((stepXV >> 16u) & 0x0fu));
	glUniform4f(g_gxGpu.texturedUvPlaneDigit4StepYOriginUniform, static_cast<f32>((stepYU >> 16u) & 0x0fu), static_cast<f32>((stepYV >> 16u) & 0x0fu), static_cast<f32>(originX), static_cast<f32>(originY));
}

void writeTransferUniforms(i32 sourceTextureUnit, u32 maskBitModeWord) {
	glUniform1i(g_gxGpu.transferSourceUniform, sourceTextureUnit);
	glUniform1i(g_gxGpu.transferVramUniform, kGxGpuTextureSampleUnit);
	glUniform1f(g_gxGpu.transferCheckMaskBitUniform, gxGpuMaskBitCheckBeforeDraw(maskBitModeWord) ? 1.0f : 0.0f);
	glUniform1f(g_gxGpu.transferSetMaskBitUniform, gxGpuMaskBitSetWhileDrawing(maskBitModeWord) ? 1.0f : 0.0f);
}

void renderNewSolidCommands(GLsizei vertexCount, u32 topLeftWord, u32 bottomRightWord, bool blendEnabled, u32 blendMode, u32 maskBitModeWord, bool ditherEnabled, u32 interlacedRenderWord);
void renderLineCommand(const GxGpuCommandBuffer& commandBuffer, u32 commandIndex, u32 topLeftWord, u32 bottomRightWord);
void renderTexturedCommand(const GxGpuCommandBuffer& commandBuffer, u32 commandIndex, u32 topLeftWord, u32 bottomRightWord);

size_t flushSolidCommands(
		size_t vertexFloatCount,
	u32 topLeftWord,
	u32 bottomRightWord,
	bool blendEnabled,
	u32 blendMode,
	u32 maskBitModeWord,
	bool ditherEnabled,
	u32 interlacedRenderWord,
	bool readsVram,
	const GxGpuVramCopyRect& batchRect) {
	if (vertexFloatCount != 0u) {
		if (readsVram) {
			copyGxGpuVramAreaToSampleTexture(batchRect.left, batchRect.top, batchRect.right, batchRect.bottom);
		}
		glBindBuffer(GL_ARRAY_BUFFER, g_gxGpu.solidVertexBuffer);
		glBufferSubData(GL_ARRAY_BUFFER, 0, static_cast<GLsizeiptr>(vertexFloatCount * sizeof(f32)), g_solidVertices.data());
		renderNewSolidCommands(static_cast<GLsizei>(vertexFloatCount / kGxGpuSolidVertexFloats), topLeftWord, bottomRightWord, blendEnabled, blendMode, maskBitModeWord, ditherEnabled, interlacedRenderWord);
	}
	return 0u;
}

size_t finishSolidBatch(
		size_t vertexFloatCount,
	u32 topLeftWord,
	u32 bottomRightWord,
	bool blendEnabled,
	u32 blendMode,
	u32 maskBitModeWord,
	bool ditherEnabled,
	u32 interlacedRenderWord,
	bool readsVram) {
	flushSolidCommands(vertexFloatCount, topLeftWord, bottomRightWord, blendEnabled, blendMode, maskBitModeWord, ditherEnabled, interlacedRenderWord, readsVram, g_solidBatchRect);
	resetGxGpuVramCopyRect(g_solidBatchRect);
	return 0u;
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
	u32 topLeftWord,
	u32 bottomRightWord,
	bool blendEnabled,
	u32 blendMode,
	u32 maskBitModeWord,
	bool ditherEnabled,
	u32 interlacedRenderWord) {
	invalidateGxGpuSampleSourceCacheForWrite(
		static_cast<i32>(gxGpuDrawingAreaLeft(topLeftWord, bottomRightWord)),
		static_cast<i32>(gxGpuDrawingAreaTop(topLeftWord, bottomRightWord)),
		static_cast<i32>(gxGpuDrawingAreaRightExclusive(topLeftWord, bottomRightWord)),
		static_cast<i32>(gxGpuDrawingAreaBottomExclusive(topLeftWord, bottomRightWord)));
	glBindBuffer(GL_ARRAY_BUFFER, g_gxGpu.lineVertexBuffer);
	glBufferSubData(GL_ARRAY_BUFFER, 0, static_cast<GLsizeiptr>(vertexFloatCount * sizeof(f32)), g_lineVertices.data());
	beginGxGpuVramRenderTarget();
	applyGxGpuDrawingAreaScissor(topLeftWord, bottomRightWord);
	glUseProgram(g_gxGpu.lineProgram);
	writePrimitiveUniforms(
		g_gxGpu.lineVramUniform,
		g_gxGpu.lineBlendEnableUniform,
		g_gxGpu.lineBlendModeUniform,
		g_gxGpu.lineCheckMaskBitUniform,
		g_gxGpu.lineSetMaskBitUniform,
		g_gxGpu.lineDitherEnableUniform,
		g_gxGpu.lineInterlacedRenderWordUniform,
		blendEnabled,
		blendMode,
		maskBitModeWord,
		ditherEnabled,
		interlacedRenderWord);
	g_gxGpu.backend->setActiveTextureUnit(kGxGpuTextureSampleUnit);
	g_gxGpu.backend->bindTexture2D(&g_gxGpu.vramSampleTexture);
	glBindBuffer(GL_ARRAY_BUFFER, g_gxGpu.lineVertexBuffer);
	glEnableVertexAttribArray(static_cast<GLuint>(g_gxGpu.linePositionAttrib));
	glVertexAttribPointer(static_cast<GLuint>(g_gxGpu.linePositionAttrib), 2, GL_FLOAT, GL_FALSE, kGxGpuLineVertexStride, nullptr);
	glEnableVertexAttribArray(static_cast<GLuint>(g_gxGpu.lineStartAttrib));
	glVertexAttribPointer(static_cast<GLuint>(g_gxGpu.lineStartAttrib), 2, GL_FLOAT, GL_FALSE, kGxGpuLineVertexStride, reinterpret_cast<const void*>(2u * sizeof(f32)));
	glEnableVertexAttribArray(static_cast<GLuint>(g_gxGpu.lineEndAttrib));
	glVertexAttribPointer(static_cast<GLuint>(g_gxGpu.lineEndAttrib), 2, GL_FLOAT, GL_FALSE, kGxGpuLineVertexStride, reinterpret_cast<const void*>(4u * sizeof(f32)));
	glEnableVertexAttribArray(static_cast<GLuint>(g_gxGpu.lineColor0Attrib));
	glVertexAttribPointer(static_cast<GLuint>(g_gxGpu.lineColor0Attrib), 3, GL_FLOAT, GL_FALSE, kGxGpuLineVertexStride, reinterpret_cast<const void*>(6u * sizeof(f32)));
	glEnableVertexAttribArray(static_cast<GLuint>(g_gxGpu.lineColor1Attrib));
	glVertexAttribPointer(static_cast<GLuint>(g_gxGpu.lineColor1Attrib), 3, GL_FLOAT, GL_FALSE, kGxGpuLineVertexStride, reinterpret_cast<const void*>(9u * sizeof(f32)));
	glDrawArrays(GL_TRIANGLES, 0, static_cast<GLsizei>(vertexFloatCount / kGxGpuLineVertexFloats));
	glDisable(GL_SCISSOR_TEST);
}

size_t flushLineCommands(
		size_t vertexFloatCount,
	u32 topLeftWord,
	u32 bottomRightWord,
	bool blendEnabled,
	u32 blendMode,
	u32 maskBitModeWord,
	bool ditherEnabled,
	u32 interlacedRenderWord,
	bool readsVram,
	const GxGpuVramCopyRect& batchRect) {
	if (vertexFloatCount != 0u) {
		if (readsVram) {
			copyGxGpuVramAreaToSampleTexture(batchRect.left, batchRect.top, batchRect.right, batchRect.bottom);
		}
		renderNewLineCommands(vertexFloatCount, topLeftWord, bottomRightWord, blendEnabled, blendMode, maskBitModeWord, ditherEnabled, interlacedRenderWord);
	}
	return 0u;
}

size_t appendBatchedLineSegment(
		size_t vertexFloatCount,
	u32 topLeftWord,
	u32 bottomRightWord,
	bool blendEnabled,
	u32 blendMode,
	u32 maskBitModeWord,
	bool ditherEnabled,
	u32 interlacedRenderWord,
	bool readsVram,
	i32 x0,
	i32 y0,
	u32 color0,
	i32 x1,
	i32 y1,
	u32 color1) {
	size_t offset = vertexFloatCount;
	if (offset + kGxGpuLineSegmentFloats > kGxGpuLineFloatCapacity) {
		offset = flushLineCommands(
			offset,
			topLeftWord,
			bottomRightWord,
			blendEnabled,
			blendMode,
			maskBitModeWord,
			ditherEnabled,
			interlacedRenderWord,
			readsVram,
			g_lineBatchRect);
		resetGxGpuVramCopyRect(g_lineBatchRect);
	}
	const size_t commandVertexStart = offset;
	offset = appendLineSegment(offset, x0, y0, color0, x1, y1, color1);
	if (readsVram && offset != commandVertexStart) {
		setGxGpuVertexBoundsRect(
			g_lineCommandRect,
			g_lineVertices.data(),
			commandVertexStart,
			offset,
			kGxGpuLineVertexFloats,
			topLeftWord,
			bottomRightWord);
		if (commandVertexStart != 0u && gxGpuVramCopyRectsOverlap(g_lineBatchRect, g_lineCommandRect)) {
			offset = flushLineCommands(
				commandVertexStart,
				topLeftWord,
				bottomRightWord,
				blendEnabled,
				blendMode,
				maskBitModeWord,
				ditherEnabled,
				interlacedRenderWord,
				readsVram,
				g_lineBatchRect);
			resetGxGpuVramCopyRect(g_lineBatchRect);
			offset = appendLineSegment(offset, x0, y0, color0, x1, y1, color1);
			setGxGpuVertexBoundsRect(
				g_lineCommandRect,
				g_lineVertices.data(),
				0u,
				offset,
				kGxGpuLineVertexFloats,
				topLeftWord,
				bottomRightWord);
		}
		includeGxGpuVramCopyRect(g_lineBatchRect, g_lineCommandRect);
	}
	return offset;
}

void executeNewGxGpuCommands(const GxGpuCommandBuffer& commandBuffer) {
	u32 commandIndex = g_gxGpu.processedCommandCount;
	const size_t presentCommandCount = commandBuffer.presentCommandCount;
	size_t vertexFloatCount = 0u;
	u32 solidBatchTopLeftWord = kGxGpuFullDrawingAreaTopLeftWord;
	u32 solidBatchBottomRightWord = kGxGpuFullDrawingAreaBottomRightWord;
	u32 solidBatchMaskBitModeWord = 0u;
	bool solidBatchDitherEnabled = false;
	u32 solidBatchInterlacedRenderWord = 0u;
	bool solidBatchBlendEnabled = false;
	u32 solidBatchBlendMode = 0u;
	bool solidBatchReadsVram = false;
	resetGxGpuVramCopyRect(g_solidBatchRect);
	for (; commandIndex < presentCommandCount; commandIndex += 1u) {
		switch (commandBuffer.commandKind[commandIndex]) {
		case GX_GPU_COMMAND_DRAW_POLYGON:
		case GX_GPU_COMMAND_DRAW_RECTANGLE: {
			const u32 opcode = commandBuffer.commandOpcode[commandIndex];
			const u32 drawModeWord = commandBuffer.commandDrawModeWord[commandIndex];
			const u32 topLeftWord = commandBuffer.commandDrawingAreaTopLeftWord[commandIndex];
			const u32 bottomRightWord = commandBuffer.commandDrawingAreaBottomRightWord[commandIndex];
			const u32 maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
			const bool drawsTexture = gxGpuCommandDrawsTexture(opcode, drawModeWord);
			const bool ditherEnabled = commandBuffer.commandKind[commandIndex] == GX_GPU_COMMAND_DRAW_POLYGON && gxGpuDitheredPolygon(drawModeWord, opcode);
			const bool blendEnabled = gxGpuCommandSemiTransparencyEnabled(opcode);
			const u32 blendMode = blendEnabled ? gxGpuDrawModeTransparencyMode(drawModeWord) : 0u;
			const bool readsVram = blendEnabled || gxGpuMaskBitCheckBeforeDraw(maskBitModeWord);
			const u32 interlacedRenderWord = commandBuffer.commandInterlacedRenderWord[commandIndex];
			const bool batchMaskChange = gxGpuMaskBitSetWhileDrawing(maskBitModeWord) != gxGpuMaskBitSetWhileDrawing(solidBatchMaskBitModeWord);
			const bool batchStateChanged = topLeftWord != solidBatchTopLeftWord
				|| bottomRightWord != solidBatchBottomRightWord
				|| batchMaskChange
				|| solidBatchDitherEnabled != ditherEnabled
				|| solidBatchInterlacedRenderWord != interlacedRenderWord
				|| solidBatchBlendEnabled != blendEnabled
				|| solidBatchBlendMode != blendMode
				|| solidBatchReadsVram != readsVram;
			if (vertexFloatCount != 0u && (batchStateChanged || drawsTexture)) {
				vertexFloatCount = finishSolidBatch(vertexFloatCount, solidBatchTopLeftWord, solidBatchBottomRightWord, solidBatchBlendEnabled, solidBatchBlendMode, solidBatchMaskBitModeWord, solidBatchDitherEnabled, solidBatchInterlacedRenderWord, solidBatchReadsVram);
			}
			solidBatchTopLeftWord = topLeftWord;
			solidBatchBottomRightWord = bottomRightWord;
			solidBatchMaskBitModeWord = maskBitModeWord;
			solidBatchDitherEnabled = ditherEnabled;
			solidBatchInterlacedRenderWord = interlacedRenderWord;
			solidBatchBlendEnabled = blendEnabled;
			solidBatchBlendMode = blendMode;
			solidBatchReadsVram = readsVram;
			if (drawsTexture) {
				renderTexturedCommand(commandBuffer, commandIndex, topLeftWord, bottomRightWord);
			} else {
				const size_t commandVertexStart = vertexFloatCount;
				vertexFloatCount = appendSolidCommandVertices(commandBuffer, commandIndex, vertexFloatCount);
				if (readsVram && vertexFloatCount != commandVertexStart) {
					setGxGpuVertexBoundsRect(g_solidCommandRect, g_solidVertices.data(), commandVertexStart, vertexFloatCount, kGxGpuSolidVertexFloats, topLeftWord, bottomRightWord);
					if (commandVertexStart != 0u && gxGpuVramCopyRectsOverlap(g_solidBatchRect, g_solidCommandRect)) {
						vertexFloatCount = finishSolidBatch(commandVertexStart, solidBatchTopLeftWord, solidBatchBottomRightWord, solidBatchBlendEnabled, solidBatchBlendMode, solidBatchMaskBitModeWord, solidBatchDitherEnabled, solidBatchInterlacedRenderWord, solidBatchReadsVram);
						vertexFloatCount = appendSolidCommandVertices(commandBuffer, commandIndex, vertexFloatCount);
						setGxGpuVertexBoundsRect(g_solidCommandRect, g_solidVertices.data(), 0u, vertexFloatCount, kGxGpuSolidVertexFloats, topLeftWord, bottomRightWord);
					}
					includeGxGpuVramCopyRect(g_solidBatchRect, g_solidCommandRect);
				}
			}
			break;
		}
		case GX_GPU_COMMAND_FILL_RECTANGLE: {
			const u32 topLeftWord = kGxGpuFullDrawingAreaTopLeftWord;
			const u32 bottomRightWord = kGxGpuFullDrawingAreaBottomRightWord;
			const u32 interlacedRenderWord = commandBuffer.commandInterlacedRenderWord[commandIndex];
			const bool batchMaskChange = gxGpuMaskBitSetWhileDrawing(solidBatchMaskBitModeWord);
			if (vertexFloatCount != 0u && (solidBatchTopLeftWord != topLeftWord || solidBatchBottomRightWord != bottomRightWord || batchMaskChange || solidBatchDitherEnabled || solidBatchInterlacedRenderWord != interlacedRenderWord || solidBatchBlendEnabled || solidBatchReadsVram)) {
				vertexFloatCount = finishSolidBatch(vertexFloatCount, solidBatchTopLeftWord, solidBatchBottomRightWord, solidBatchBlendEnabled, solidBatchBlendMode, solidBatchMaskBitModeWord, solidBatchDitherEnabled, solidBatchInterlacedRenderWord, solidBatchReadsVram);
			}
			solidBatchTopLeftWord = topLeftWord;
			solidBatchBottomRightWord = bottomRightWord;
			solidBatchMaskBitModeWord = 0u;
			solidBatchDitherEnabled = false;
			solidBatchInterlacedRenderWord = interlacedRenderWord;
			solidBatchBlendEnabled = false;
			solidBatchBlendMode = 0u;
			solidBatchReadsVram = false;
			vertexFloatCount = appendFillRectangle(commandBuffer, commandIndex, vertexFloatCount);
			break;
		}
		case GX_GPU_COMMAND_DRAW_LINE:
		case GX_GPU_COMMAND_DRAW_POLYLINE: {
			vertexFloatCount = finishSolidBatch(vertexFloatCount, solidBatchTopLeftWord, solidBatchBottomRightWord, solidBatchBlendEnabled, solidBatchBlendMode, solidBatchMaskBitModeWord, solidBatchDitherEnabled, solidBatchInterlacedRenderWord, solidBatchReadsVram);
			const u32 topLeftWord = commandBuffer.commandDrawingAreaTopLeftWord[commandIndex];
			const u32 bottomRightWord = commandBuffer.commandDrawingAreaBottomRightWord[commandIndex];
			renderLineCommand(commandBuffer, commandIndex, topLeftWord, bottomRightWord);
			break;
		}
		case GX_GPU_COMMAND_COPY_VRAM_TO_VRAM:
			vertexFloatCount = finishSolidBatch(vertexFloatCount, solidBatchTopLeftWord, solidBatchBottomRightWord, solidBatchBlendEnabled, solidBatchBlendMode, solidBatchMaskBitModeWord, solidBatchDitherEnabled, solidBatchInterlacedRenderWord, solidBatchReadsVram);
			copyVramToVram(commandBuffer, commandIndex);
			break;
		case GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM:
			vertexFloatCount = finishSolidBatch(vertexFloatCount, solidBatchTopLeftWord, solidBatchBottomRightWord, solidBatchBlendEnabled, solidBatchBlendMode, solidBatchMaskBitModeWord, solidBatchDitherEnabled, solidBatchInterlacedRenderWord, solidBatchReadsVram);
			uploadCpuToVram(commandBuffer, commandIndex);
			break;
		}
	}
	g_gxGpu.processedCommandCount = static_cast<u32>(presentCommandCount);
	finishSolidBatch(vertexFloatCount, solidBatchTopLeftWord, solidBatchBottomRightWord, solidBatchBlendEnabled, solidBatchBlendMode, solidBatchMaskBitModeWord, solidBatchDitherEnabled, solidBatchInterlacedRenderWord, solidBatchReadsVram);
}

void renderLineCommand(
		const GxGpuCommandBuffer& commandBuffer,
	u32 commandIndex,
	u32 topLeftWord,
	u32 bottomRightWord) {
	const u32 opcode = commandBuffer.commandOpcode[commandIndex];
	const u32 wordStart = commandBuffer.commandWordStart[commandIndex];
	const u32 wordEnd = wordStart + commandBuffer.commandWordCount[commandIndex];
	const u32 drawingOffsetWord = commandBuffer.commandDrawingOffsetWord[commandIndex];
	const i32 dx = gxGpuSigned11(drawingOffsetWord);
	const i32 dy = gxGpuDrawingOffsetY(drawingOffsetWord);
	const bool blendEnabled = gxGpuCommandSemiTransparencyEnabled(opcode);
	const u32 blendMode = gxGpuDrawModeTransparencyMode(commandBuffer.commandDrawModeWord[commandIndex]);
	const u32 maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
	const bool ditherEnabled = gxGpuDrawModeDitherEnabled(commandBuffer.commandDrawModeWord[commandIndex]);
	const bool readsVram = blendEnabled || gxGpuMaskBitCheckBeforeDraw(maskBitModeWord);
	const u32 interlacedRenderWord = commandBuffer.commandInterlacedRenderWord[commandIndex];
	size_t vertexFloatCount = 0u;
	resetGxGpuVramCopyRect(g_lineBatchRect);

	if (commandBuffer.commandKind[commandIndex] == GX_GPU_COMMAND_DRAW_LINE) {
		const u32 color0 = commandBuffer.words[wordStart];
		const u32 xy0 = commandBuffer.words[wordStart + 1u];
		if (gxGpuCommandGouraud(opcode)) {
			const u32 color1 = commandBuffer.words[wordStart + 2u];
			const u32 xy1 = commandBuffer.words[wordStart + 3u];
			vertexFloatCount = appendBatchedLineSegment(
				vertexFloatCount,
				topLeftWord,
				bottomRightWord,
				blendEnabled,
				blendMode,
				maskBitModeWord,
				ditherEnabled,
				interlacedRenderWord,
				readsVram,
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
				topLeftWord,
				bottomRightWord,
				blendEnabled,
				blendMode,
				maskBitModeWord,
				ditherEnabled,
				interlacedRenderWord,
				readsVram,
				dx + gxGpuSigned11(xy0),
				dy + gxGpuVertexY(xy0),
				color0,
				dx + gxGpuSigned11(xy1),
				dy + gxGpuVertexY(xy1),
				color0);
		}
		flushLineCommands(
			vertexFloatCount,
			topLeftWord,
			bottomRightWord,
			blendEnabled,
			blendMode,
			maskBitModeWord,
			ditherEnabled,
			interlacedRenderWord,
			readsVram,
			g_lineBatchRect);
		resetGxGpuVramCopyRect(g_lineBatchRect);
		return;
	}

	if (gxGpuCommandGouraud(opcode)) {
		u32 color0 = commandBuffer.words[wordStart];
		u32 xy0 = commandBuffer.words[wordStart + 1u];
		for (u32 wordIndex = wordStart + 2u; wordIndex + 1u < wordEnd; wordIndex += 2u) {
			const u32 color1 = commandBuffer.words[wordIndex];
			const u32 xy1 = commandBuffer.words[wordIndex + 1u];
			vertexFloatCount = appendBatchedLineSegment(
				vertexFloatCount,
				topLeftWord,
				bottomRightWord,
				blendEnabled,
				blendMode,
				maskBitModeWord,
				ditherEnabled,
				interlacedRenderWord,
				readsVram,
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
				topLeftWord,
				bottomRightWord,
				blendEnabled,
				blendMode,
				maskBitModeWord,
				ditherEnabled,
				interlacedRenderWord,
				readsVram,
				dx + gxGpuSigned11(xy0),
				dy + gxGpuVertexY(xy0),
				color,
				dx + gxGpuSigned11(xy1),
				dy + gxGpuVertexY(xy1),
				color);
			xy0 = xy1;
		}
	}
	flushLineCommands(
		vertexFloatCount,
		topLeftWord,
		bottomRightWord,
		blendEnabled,
		blendMode,
		maskBitModeWord,
		ditherEnabled,
		interlacedRenderWord,
		readsVram,
		g_lineBatchRect);
	resetGxGpuVramCopyRect(g_lineBatchRect);
}

void renderNewSolidCommands(GLsizei vertexCount, u32 topLeftWord, u32 bottomRightWord, bool blendEnabled, u32 blendMode, u32 maskBitModeWord, bool ditherEnabled, u32 interlacedRenderWord) {
	invalidateGxGpuSampleSourceCacheForWrite(
		static_cast<i32>(gxGpuDrawingAreaLeft(topLeftWord, bottomRightWord)),
		static_cast<i32>(gxGpuDrawingAreaTop(topLeftWord, bottomRightWord)),
		static_cast<i32>(gxGpuDrawingAreaRightExclusive(topLeftWord, bottomRightWord)),
		static_cast<i32>(gxGpuDrawingAreaBottomExclusive(topLeftWord, bottomRightWord)));
	beginGxGpuVramRenderTarget();
	applyGxGpuDrawingAreaScissor(topLeftWord, bottomRightWord);
	glUseProgram(g_gxGpu.solidProgram);
	writePrimitiveUniforms(
		g_gxGpu.solidVramUniform,
		g_gxGpu.solidBlendEnableUniform,
		g_gxGpu.solidBlendModeUniform,
		g_gxGpu.solidCheckMaskBitUniform,
		g_gxGpu.solidSetMaskBitUniform,
		g_gxGpu.solidDitherEnableUniform,
		g_gxGpu.solidInterlacedRenderWordUniform,
		blendEnabled,
		blendMode,
		maskBitModeWord,
		ditherEnabled,
		interlacedRenderWord);
	g_gxGpu.backend->setActiveTextureUnit(kGxGpuTextureSampleUnit);
	g_gxGpu.backend->bindTexture2D(&g_gxGpu.vramSampleTexture);
	glBindBuffer(GL_ARRAY_BUFFER, g_gxGpu.solidVertexBuffer);
	glEnableVertexAttribArray(static_cast<GLuint>(g_gxGpu.solidPositionAttrib));
	glVertexAttribPointer(static_cast<GLuint>(g_gxGpu.solidPositionAttrib), 2, GL_FLOAT, GL_FALSE, kGxGpuSolidVertexStride, nullptr);
	glEnableVertexAttribArray(static_cast<GLuint>(g_gxGpu.solidColorAttrib));
	glVertexAttribPointer(static_cast<GLuint>(g_gxGpu.solidColorAttrib), 4, GL_FLOAT, GL_FALSE, kGxGpuSolidVertexStride, reinterpret_cast<const void*>(2u * sizeof(f32)));
	glDrawArrays(GL_TRIANGLES, 0, vertexCount);
	glDisable(GL_SCISSOR_TEST);
}

void renderTransferCommands(size_t vertexFloatCount, GLES2Texture& sourceTexture, i32 sourceTextureUnit, u32 maskBitModeWord) {
	glBindBuffer(GL_ARRAY_BUFFER, g_gxGpu.transferVertexBuffer);
	glBufferSubData(GL_ARRAY_BUFFER, 0, static_cast<GLsizeiptr>(vertexFloatCount * sizeof(f32)), g_transferVertices.data());
	beginGxGpuVramRenderTarget();
	glDisable(GL_SCISSOR_TEST);
	glUseProgram(g_gxGpu.transferProgram);
	writeTransferUniforms(sourceTextureUnit, maskBitModeWord);
	g_gxGpu.backend->setActiveTextureUnit(sourceTextureUnit);
	g_gxGpu.backend->bindTexture2D(&sourceTexture);
	g_gxGpu.backend->setActiveTextureUnit(kGxGpuTextureSampleUnit);
	g_gxGpu.backend->bindTexture2D(&g_gxGpu.vramSampleTexture);
	glBindBuffer(GL_ARRAY_BUFFER, g_gxGpu.transferVertexBuffer);
	glEnableVertexAttribArray(static_cast<GLuint>(g_gxGpu.transferPositionAttrib));
	glVertexAttribPointer(static_cast<GLuint>(g_gxGpu.transferPositionAttrib), 2, GL_FLOAT, GL_FALSE, kGxGpuTransferVertexStride, nullptr);
	glEnableVertexAttribArray(static_cast<GLuint>(g_gxGpu.transferTexcoordAttrib));
	glVertexAttribPointer(static_cast<GLuint>(g_gxGpu.transferTexcoordAttrib), 2, GL_FLOAT, GL_FALSE, kGxGpuTransferVertexStride, reinterpret_cast<const void*>(2u * sizeof(f32)));
	glDrawArrays(GL_TRIANGLES, 0, static_cast<GLsizei>(vertexFloatCount / kGxGpuTransferVertexFloats));
}

void renderTexturedCommand(
		const GxGpuCommandBuffer& commandBuffer,
	u32 commandIndex,
	u32 topLeftWord,
	u32 bottomRightWord) {
	size_t vertexFloatCount = 0u;
	g_texturedUvPlaneCount = 0u;
	if (commandBuffer.commandKind[commandIndex] == GX_GPU_COMMAND_DRAW_POLYGON) {
		vertexFloatCount = appendTexturedPolygon(commandBuffer, commandIndex, vertexFloatCount);
	} else {
		vertexFloatCount = appendTexturedRectangle(commandBuffer, commandIndex, vertexFloatCount);
	}
	if (vertexFloatCount == 0u) {
		return;
	}
	copyGxGpuTexturedSampleRegionsToTexture(commandBuffer, commandIndex, vertexFloatCount, topLeftWord, bottomRightWord);
	setGxGpuVertexBoundsRect(g_vramCopyRectScratch, g_texturedVertices.data(), 0u, vertexFloatCount, kGxGpuTexturedVertexFloats, topLeftWord, bottomRightWord);
	invalidateGxGpuSampleSourceCacheForWrite(g_vramCopyRectScratch.left, g_vramCopyRectScratch.top, g_vramCopyRectScratch.right, g_vramCopyRectScratch.bottom);
	glBindBuffer(GL_ARRAY_BUFFER, g_gxGpu.texturedVertexBuffer);
	glBufferSubData(GL_ARRAY_BUFFER, 0, static_cast<GLsizeiptr>(vertexFloatCount * sizeof(f32)), g_texturedVertices.data());
	beginGxGpuVramRenderTarget();
	applyGxGpuDrawingAreaScissor(topLeftWord, bottomRightWord);
	glUseProgram(g_gxGpu.texturedProgram);
	writeTexturedUniforms(commandBuffer, commandIndex);
	g_gxGpu.backend->setActiveTextureUnit(kGxGpuTextureSampleUnit);
	g_gxGpu.backend->bindTexture2D(&g_gxGpu.vramSampleTexture);
	glBindBuffer(GL_ARRAY_BUFFER, g_gxGpu.texturedVertexBuffer);
	glEnableVertexAttribArray(static_cast<GLuint>(g_gxGpu.texturedPositionAttrib));
	glVertexAttribPointer(static_cast<GLuint>(g_gxGpu.texturedPositionAttrib), 2, GL_FLOAT, GL_FALSE, kGxGpuTexturedVertexStride, nullptr);
	glEnableVertexAttribArray(static_cast<GLuint>(g_gxGpu.texturedColorAttrib));
	glVertexAttribPointer(static_cast<GLuint>(g_gxGpu.texturedColorAttrib), 3, GL_FLOAT, GL_FALSE, kGxGpuTexturedVertexStride, reinterpret_cast<const void*>(2u * sizeof(f32)));
	glEnableVertexAttribArray(static_cast<GLuint>(g_gxGpu.texturedTexcoordAttrib));
	glVertexAttribPointer(static_cast<GLuint>(g_gxGpu.texturedTexcoordAttrib), 2, GL_FLOAT, GL_FALSE, kGxGpuTexturedVertexStride, reinterpret_cast<const void*>(5u * sizeof(f32)));
	if (g_texturedUvPlaneCount == 0u) {
		glUniform1f(g_gxGpu.texturedUvPlaneEnableUniform, 0.0f);
		glDrawArrays(GL_TRIANGLES, 0, static_cast<GLsizei>(vertexFloatCount / kGxGpuTexturedVertexFloats));
	} else {
		const u32 opcode = commandBuffer.commandOpcode[commandIndex];
		const u32 maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
		const bool readsVram = gxGpuCommandSemiTransparencyEnabled(opcode) || gxGpuMaskBitCheckBeforeDraw(maskBitModeWord);
		for (size_t planeIndex = 0u; planeIndex < g_texturedUvPlaneCount; planeIndex += 1u) {
			writeTexturedUvPlaneUniforms(planeIndex);
			glDrawArrays(GL_TRIANGLES, static_cast<GLint>(planeIndex * 3u), 3);
			if (readsVram && planeIndex + 1u < g_texturedUvPlaneCount) {
				copyGxGpuVertexBoundsToSampleTexture(g_texturedVertices.data(), kGxGpuTexturedVertexFloats * 3u, kGxGpuTexturedVertexFloats, topLeftWord, bottomRightWord);
			}
		}
	}
	glDisable(GL_SCISSOR_TEST);
}

void updateGxGpuScanoutVertices() {
	size_t offset = 0u;
	f32* scanoutVertices = g_scanoutVertices.data();
	offset = writeUvVertex(scanoutVertices, offset, kGxGpuScanoutVertexFloats, -1.0f, 1.0f, 0.0f, 0.0f);
	offset = writeUvVertex(scanoutVertices, offset, kGxGpuScanoutVertexFloats, -1.0f, -1.0f, 0.0f, 1.0f);
	offset = writeUvVertex(scanoutVertices, offset, kGxGpuScanoutVertexFloats, 1.0f, 1.0f, 1.0f, 0.0f);
	offset = writeUvVertex(scanoutVertices, offset, kGxGpuScanoutVertexFloats, -1.0f, -1.0f, 0.0f, 1.0f);
	offset = writeUvVertex(scanoutVertices, offset, kGxGpuScanoutVertexFloats, 1.0f, -1.0f, 1.0f, 1.0f);
	writeUvVertex(scanoutVertices, offset, kGxGpuScanoutVertexFloats, 1.0f, 1.0f, 1.0f, 0.0f);
}

void scanoutGxGpuVram(GLuint frameFbo, const GxGpuPipelineState& state) {
	g_gxGpu.backend->setRenderTarget(frameFbo, state.width, state.height);
	glDisable(GL_SCISSOR_TEST);
	if ((state.statusWord & GX_GPU_STATUS_DISPLAY_DISABLE) != 0u) {
		glClearColor(0.0f, 0.0f, 0.0f, 1.0f);
		glClear(GL_COLOR_BUFFER_BIT);
		return;
	}
	glDisable(GL_DEPTH_TEST);
	glDepthMask(GL_FALSE);
	glDisable(GL_CULL_FACE);
	glDisable(GL_BLEND);
	glUseProgram(g_gxGpu.scanoutProgram);
	glUniform1i(g_gxGpu.scanoutVramUniform, kGxGpuScanoutTextureUnit);
	if (g_gxGpu.scanoutUniformDisplayModeWord != state.displayModeWord) {
		glUniform1f(g_gxGpu.scanoutDisplayModeUniform, static_cast<f32>(state.displayModeWord));
		g_gxGpu.scanoutUniformDisplayModeWord = state.displayModeWord;
	}
	if (g_gxGpu.scanoutUniformDisplayStartWord != state.displayStartWord) {
		glUniform1f(g_gxGpu.scanoutDisplayStartWordUniform, static_cast<f32>(state.displayStartWord));
		g_gxGpu.scanoutUniformDisplayStartWord = state.displayStartWord;
	}
	if (g_gxGpu.scanoutUniformHorizontalDisplayRangeWord != state.horizontalDisplayRangeWord) {
		glUniform1f(g_gxGpu.scanoutHorizontalDisplayRangeUniform, static_cast<f32>(state.horizontalDisplayRangeWord));
		g_gxGpu.scanoutUniformHorizontalDisplayRangeWord = state.horizontalDisplayRangeWord;
	}
	if (g_gxGpu.scanoutUniformVerticalDisplayRangeWord != state.verticalDisplayRangeWord) {
		glUniform1f(g_gxGpu.scanoutVerticalDisplayRangeUniform, static_cast<f32>(state.verticalDisplayRangeWord));
		g_gxGpu.scanoutUniformVerticalDisplayRangeWord = state.verticalDisplayRangeWord;
	}
	g_gxGpu.backend->setActiveTextureUnit(kGxGpuScanoutTextureUnit);
	g_gxGpu.backend->bindTexture2D(&g_gxGpu.vramTexture);
	glBindBuffer(GL_ARRAY_BUFFER, g_gxGpu.scanoutVertexBuffer);
	glEnableVertexAttribArray(static_cast<GLuint>(g_gxGpu.scanoutPositionAttrib));
	glVertexAttribPointer(static_cast<GLuint>(g_gxGpu.scanoutPositionAttrib), 2, GL_FLOAT, GL_FALSE, kGxGpuScanoutVertexStride, nullptr);
	glEnableVertexAttribArray(static_cast<GLuint>(g_gxGpu.scanoutTexcoordAttrib));
	glVertexAttribPointer(static_cast<GLuint>(g_gxGpu.scanoutTexcoordAttrib), 2, GL_FLOAT, GL_FALSE, kGxGpuScanoutVertexStride, reinterpret_cast<const void*>(2u * sizeof(f32)));
	glDrawArrays(GL_TRIANGLES, 0, 6);
}

void executeGxGpuVramCommands(const GxGpuCommandBuffer& commandBuffer, const std::array<u8, GX_GPU_VRAM_BYTE_COUNT>& snapshotBytes, u32 snapshotSerial) {
	if (g_gxGpu.vramSnapshotSerial != snapshotSerial) {
		uploadGxGpuVramSnapshot(snapshotBytes);
		g_gxGpu.processedCommandCount = 0u;
		g_gxGpu.processedCommandSerial = commandBuffer.serial;
		g_gxGpu.vramClearSerial = commandBuffer.vramClearSerial;
		g_gxGpu.vramSnapshotSerial = snapshotSerial;
	} else if (g_gxGpu.vramClearSerial != commandBuffer.vramClearSerial) {
		clearGxGpuVram();
		g_gxGpu.processedCommandCount = 0u;
		g_gxGpu.processedCommandSerial = commandBuffer.serial;
		g_gxGpu.vramClearSerial = commandBuffer.vramClearSerial;
	} else if (g_gxGpu.processedCommandSerial != commandBuffer.serial) {
		g_gxGpu.processedCommandCount = 0u;
		g_gxGpu.processedCommandSerial = commandBuffer.serial;
	}
	executeNewGxGpuCommands(commandBuffer);
}

void renderGxGpu(GLuint frameFbo, const GxGpuPipelineState& state) {
	executeGxGpuVramCommands(*state.commandBuffer, *state.vramSnapshotBytes, state.vramSnapshotSerial);
	scanoutGxGpuVram(frameFbo, state);
}

void executeGxGpuPass(GPUBackend*, GameView*, void* fbo, RenderPassStateStorage& stateStorage, void*) {
	const uintptr_t frameFbo = reinterpret_cast<uintptr_t>(fbo);
	renderGxGpu(static_cast<GLuint>(frameFbo), stateStorage.gxGpu);
}

} // namespace

void OpenGLES2Backend::captureGxGpuVramSnapshot(GxGpu& gxGpu) {
	const GxGpuDeviceOutput& output = gxGpu.readDeviceOutput();
	executeGxGpuVramCommands(*output.commandBuffer, *output.vramSnapshotBytes, output.vramSnapshotSerial);
	setRenderTarget(g_gxGpu.vramFramebuffer, kGxGpuVramWidth, kGxGpuVramHeight);
	glReadPixels(0, 0, kGxGpuVramWidth, kGxGpuVramHeight, GL_RGBA, GL_UNSIGNED_BYTE, g_rawVramReadback.data());
	writeGxGpuVramSnapshotFromReadback();
	g_gxGpu.vramSnapshotSerial = gxGpu.commitRenderedVramSnapshotBytes(g_vramSnapshotScratch.data());
}

void registerGxGpuPass(RenderPassLibrary& registry) {
	RenderPassDef desc;
	desc.id = "gx_gpu";
	desc.name = "GXGPU";
	setGxGpuGraph(desc);
	desc.bootstrap = bootstrapBackendRenderPass<OpenGLES2Backend, initGxGpu>;
	desc.exec = executeGxGpuPass;
	registry.registerPass(desc);
}

} // namespace bmsx
