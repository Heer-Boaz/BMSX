#include "render/3d/particles/pipeline.h"

#if BMSX_ENABLE_GLES2
#include "core/console.h"
#include "machine/bus/io.h"
#include "render/3d/shaders/render_3d_shaders.h"
#include "render/backend/gles2_backend.h"
#include "render/gameview.h"
#include "rompack/format.h"

#include <GLES2/gl2.h>
#include <array>
#include <cstddef>
#include <cstdint>

namespace bmsx {
namespace {

constexpr f32 PARTICLE_TEXTPAGE_PRIMARY = 0.0f;
constexpr f32 PARTICLE_TEXTPAGE_SECONDARY = 1.0f;
constexpr f32 PARTICLE_TEXTPAGE_SYSTEM = 2.0f;
constexpr i32 PARTICLE_TEXTURE_UNIT_PRIMARY = 0;
constexpr i32 PARTICLE_TEXTURE_UNIT_SECONDARY = 1;
constexpr i32 PARTICLE_TEXTURE_UNIT_SYSTEM = 2;
constexpr size_t PARTICLE_VERTEX_LIMIT = VDP_BBU_BILLBOARD_LIMIT * 6u;

// TS WebGL2 reads frame ambient from a FrameUniforms UBO and batches
// mode/factor as uniforms. Strict GLES2 has no UBO, and this backend merges the
// old-GLES2 expanded billboards into one vertex stream, so mode/factor are
// vertex attributes while the resolved frame ambient remains one pass uniform.
struct ParticleGLES2Vertex {
	f32 x = 0.0f;
	f32 y = 0.0f;
	f32 z = 0.0f;
	f32 u = 0.0f;
	f32 v = 0.0f;
	f32 textpageId = 0.0f;
	f32 r = 1.0f;
	f32 g = 1.0f;
	f32 b = 1.0f;
	f32 a = 1.0f;
	f32 ambientMode = 0.0f;
	f32 ambientFactor = 1.0f;
};

struct ParticleGLES2Runtime {
	GLuint program = 0;
	GLint attribPosition = -1;
	GLint attribUv = -1;
	GLint attribTextpageId = -1;
	GLint attribColor = -1;
	GLint attribAmbientMode = -1;
	GLint attribAmbientFactor = -1;
	GLint uniformViewProjection = -1;
	GLint uniformTexture0 = -1;
	GLint uniformTexture1 = -1;
	GLint uniformTexture2 = -1;
	GLint uniformAmbientColorIntensity = -1;
	GLuint vertexBuffer = 0;
	std::array<ParticleGLES2Vertex, PARTICLE_VERTEX_LIMIT> vertices{};
	size_t vertexCount = 0u;
};

ParticleGLES2Runtime g_particles{};

f32 textpageIdForSlot(u32 slot) {
	switch (slot) {
		case VDP_SLOT_PRIMARY: return PARTICLE_TEXTPAGE_PRIMARY;
		case VDP_SLOT_SECONDARY: return PARTICLE_TEXTPAGE_SECONDARY;
		case VDP_SLOT_SYSTEM: return PARTICLE_TEXTPAGE_SYSTEM;
	}
	throw BMSX_RUNTIME_ERROR("[ParticlesPipeline] particle slot is outside the VDP texture slot set.");
}

void bindParticleTextpages(OpenGLES2Backend& backend, const ParticlePipelineState& state) {
	backend.setActiveTextureUnit(PARTICLE_TEXTURE_UNIT_PRIMARY);
	backend.bindTexture2D(state.textpagePrimaryTex);
	backend.setActiveTextureUnit(PARTICLE_TEXTURE_UNIT_SECONDARY);
	backend.bindTexture2D(state.textpageSecondaryTex);
	backend.setActiveTextureUnit(PARTICLE_TEXTURE_UNIT_SYSTEM);
	backend.bindTexture2D(state.systemSlotTex);
}

void writeParticleVertex(ParticleGLES2Vertex& vertex,
							f32 x,
							f32 y,
							f32 z,
							f32 u,
							f32 v,
							f32 textpageId,
							f32 r,
							f32 g,
							f32 b,
							f32 a,
							f32 ambientMode,
							f32 ambientFactor) {
	vertex.x = x;
	vertex.y = y;
	vertex.z = z;
	vertex.u = u;
	vertex.v = v;
	vertex.textpageId = textpageId;
	vertex.r = r;
	vertex.g = g;
	vertex.b = b;
	vertex.a = a;
	vertex.ambientMode = ambientMode;
	vertex.ambientFactor = ambientFactor;
}

// TS WebGL2 uses instanced particle attributes. The C++ libretro backend must
// stay on the SNES-mini GLES2 floor, where instanced arrays are not core GLES2
// and GL_EXT_PROTOTYPES is unavailable. This backend therefore expands
// billboards into a fixed preallocated vertex stream; that is the explicit
// parity exclusion for this file, and it must not move to a manifest skip.
void appendParticleQuad(ParticleGLES2Runtime& runtime,
						const std::array<f32, 3>& camRight,
						const std::array<f32, 3>& camUp,
						const Vec3& position,
						f32 size,
						u32 color,
						f32 textpageId,
						const std::array<f32, 2>& uv0,
						const std::array<f32, 2>& uv1,
						i32 ambientMode,
						f32 ambientFactor) {
	const f32 halfRightX = camRight[0] * size * 0.5f;
	const f32 halfRightY = camRight[1] * size * 0.5f;
	const f32 halfRightZ = camRight[2] * size * 0.5f;
	const f32 halfUpX = camUp[0] * size * 0.5f;
	const f32 halfUpY = camUp[1] * size * 0.5f;
	const f32 halfUpZ = camUp[2] * size * 0.5f;
	const f32 r = static_cast<f32>((color >> 16u) & 0xffu) / 255.0f;
	const f32 g = static_cast<f32>((color >> 8u) & 0xffu) / 255.0f;
	const f32 b = static_cast<f32>(color & 0xffu) / 255.0f;
	const f32 a = static_cast<f32>((color >> 24u) & 0xffu) / 255.0f;
	const f32 x00 = position.x - halfRightX + halfUpX;
	const f32 y00 = position.y - halfRightY + halfUpY;
	const f32 z00 = position.z - halfRightZ + halfUpZ;
	const f32 x10 = position.x + halfRightX + halfUpX;
	const f32 y10 = position.y + halfRightY + halfUpY;
	const f32 z10 = position.z + halfRightZ + halfUpZ;
	const f32 x01 = position.x - halfRightX - halfUpX;
	const f32 y01 = position.y - halfRightY - halfUpY;
	const f32 z01 = position.z - halfRightZ - halfUpZ;
	const f32 x11 = position.x + halfRightX - halfUpX;
	const f32 y11 = position.y + halfRightY - halfUpY;
	const f32 z11 = position.z + halfRightZ - halfUpZ;
	const f32 ambientModeValue = static_cast<f32>(ambientMode);
	ParticleGLES2Vertex* const vertices = runtime.vertices.data() + runtime.vertexCount;
	writeParticleVertex(vertices[0], x00, y00, z00, uv0[0], uv1[1], textpageId, r, g, b, a, ambientModeValue, ambientFactor);
	writeParticleVertex(vertices[1], x10, y10, z10, uv1[0], uv1[1], textpageId, r, g, b, a, ambientModeValue, ambientFactor);
	writeParticleVertex(vertices[2], x01, y01, z01, uv0[0], uv0[1], textpageId, r, g, b, a, ambientModeValue, ambientFactor);
	writeParticleVertex(vertices[3], x01, y01, z01, uv0[0], uv0[1], textpageId, r, g, b, a, ambientModeValue, ambientFactor);
	writeParticleVertex(vertices[4], x10, y10, z10, uv1[0], uv1[1], textpageId, r, g, b, a, ambientModeValue, ambientFactor);
	writeParticleVertex(vertices[5], x11, y11, z11, uv1[0], uv0[1], textpageId, r, g, b, a, ambientModeValue, ambientFactor);
	runtime.vertexCount += 6u;
}

ParticlePipelineState buildParticlePipelineState(const RenderPassDef::RenderGraphPassContext& ctx,
												const FrameSharedState& frameShared) {
	const VdpTransformSnapshot& transform = ctx.view->vdpTransform;
	ParticlePipelineState state;
	state.width = static_cast<i32>(ctx.view->offscreenCanvasSize.x);
	state.height = static_cast<i32>(ctx.view->offscreenCanvasSize.y);
	state.viewProj = transform.viewProj;
	state.camRight = {transform.view[0], transform.view[4], transform.view[8]};
	state.camUp = {transform.view[1], transform.view[5], transform.view[9]};
	state.textpagePrimaryTex = ctx.view->textures.at(VDP_PRIMARY_SLOT_TEXTURE_KEY);
	state.textpageSecondaryTex = ctx.view->textures.at(VDP_SECONDARY_SLOT_TEXTURE_KEY);
	state.systemSlotTex = ctx.view->textures.at(SYSTEM_SLOT_TEXTURE_KEY);
	if (frameShared.lighting.ambient.has_value()) {
		state.ambientColor = frameShared.lighting.ambient->color;
		state.ambientIntensity = frameShared.lighting.ambient->intensity;
	}
	return state;
}

} // namespace

void initParticlePipeline(OpenGLES2Backend& backend) {
	g_particles.program = backend.buildProgram(kRender3DParticleVertexShader, kRender3DParticleFragmentShader, "particles");
	setupParticleLocations();
	setupParticleUniforms();
}

void setupParticleLocations() {
	auto& state = g_particles;
	state.attribPosition = glGetAttribLocation(state.program, "a_position");
	state.attribUv = glGetAttribLocation(state.program, "a_uv");
	state.attribTextpageId = glGetAttribLocation(state.program, "a_textpage_id");
	state.attribColor = glGetAttribLocation(state.program, "a_color");
	state.attribAmbientMode = glGetAttribLocation(state.program, "a_ambient_mode");
	state.attribAmbientFactor = glGetAttribLocation(state.program, "a_ambient_factor");
	glGenBuffers(1, &state.vertexBuffer);
}

void setupParticleUniforms() {
	auto& state = g_particles;
	state.uniformViewProjection = glGetUniformLocation(state.program, "u_viewProjection");
	state.uniformTexture0 = glGetUniformLocation(state.program, "u_texture0");
	state.uniformTexture1 = glGetUniformLocation(state.program, "u_texture1");
	state.uniformTexture2 = glGetUniformLocation(state.program, "u_texture2");
	state.uniformAmbientColorIntensity = glGetUniformLocation(state.program, "u_ambient_color_intensity");
	glUseProgram(state.program);
	// TS WebGL2 can reserve texture unit 11 for the engine/system textpage.
	// The SNES-mini GLES2 floor only requires a much smaller texture-unit set,
	// so this GLES2 pass binds its three particle textpages to local units 0..2.
	glUniform1i(state.uniformTexture0, PARTICLE_TEXTURE_UNIT_PRIMARY);
	glUniform1i(state.uniformTexture1, PARTICLE_TEXTURE_UNIT_SECONDARY);
	glUniform1i(state.uniformTexture2, PARTICLE_TEXTURE_UNIT_SYSTEM);
}

void renderParticleBatch(ParticleRuntime& runtime, void* framebuffer, const ParticlePipelineState& pipelineState) {
	OpenGLES2Backend& backend = runtime.backend;
	const GameView& view = runtime.context;
	if (view.vdpBillboardCount == 0u) {
		return;
	}
	auto& state = g_particles;
	state.vertexCount = 0u;
	for (size_t index = 0; index < view.vdpBillboardCount; index += 1u) {
		const GameView::VdpBillboardRenderEntry& submission = view.vdpBillboards[index];
		appendParticleQuad(
			state,
			pipelineState.camRight,
			pipelineState.camUp,
			submission.position,
			submission.size,
			submission.color,
			textpageIdForSlot(submission.slot),
			submission.uv0,
			submission.uv1,
			0,
			1.0f
		);
	}
	backend.setRenderTarget(static_cast<GLuint>(reinterpret_cast<uintptr_t>(framebuffer)), pipelineState.width, pipelineState.height);
	glUseProgram(state.program);
	glUniformMatrix4fv(state.uniformViewProjection, 1, GL_FALSE, pipelineState.viewProj.data());
	glUniform4f(state.uniformAmbientColorIntensity,
				pipelineState.ambientColor[0],
				pipelineState.ambientColor[1],
				pipelineState.ambientColor[2],
				pipelineState.ambientIntensity);
	glDisable(GL_CULL_FACE);
	glDisable(GL_DEPTH_TEST);
	glEnable(GL_BLEND);
	glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
	glDepthMask(GL_FALSE);
	bindParticleTextpages(backend, pipelineState);
	glBindBuffer(GL_ARRAY_BUFFER, state.vertexBuffer);
	glEnableVertexAttribArray(static_cast<GLuint>(state.attribPosition));
	glEnableVertexAttribArray(static_cast<GLuint>(state.attribUv));
	glEnableVertexAttribArray(static_cast<GLuint>(state.attribTextpageId));
	glEnableVertexAttribArray(static_cast<GLuint>(state.attribColor));
	glEnableVertexAttribArray(static_cast<GLuint>(state.attribAmbientMode));
	glEnableVertexAttribArray(static_cast<GLuint>(state.attribAmbientFactor));
	glVertexAttribPointer(state.attribPosition, 3, GL_FLOAT, GL_FALSE, sizeof(ParticleGLES2Vertex), reinterpret_cast<const void*>(offsetof(ParticleGLES2Vertex, x)));
	glVertexAttribPointer(state.attribUv, 2, GL_FLOAT, GL_FALSE, sizeof(ParticleGLES2Vertex), reinterpret_cast<const void*>(offsetof(ParticleGLES2Vertex, u)));
	glVertexAttribPointer(state.attribTextpageId, 1, GL_FLOAT, GL_FALSE, sizeof(ParticleGLES2Vertex), reinterpret_cast<const void*>(offsetof(ParticleGLES2Vertex, textpageId)));
	glVertexAttribPointer(state.attribColor, 4, GL_FLOAT, GL_FALSE, sizeof(ParticleGLES2Vertex), reinterpret_cast<const void*>(offsetof(ParticleGLES2Vertex, r)));
	glVertexAttribPointer(state.attribAmbientMode, 1, GL_FLOAT, GL_FALSE, sizeof(ParticleGLES2Vertex), reinterpret_cast<const void*>(offsetof(ParticleGLES2Vertex, ambientMode)));
	glVertexAttribPointer(state.attribAmbientFactor, 1, GL_FLOAT, GL_FALSE, sizeof(ParticleGLES2Vertex), reinterpret_cast<const void*>(offsetof(ParticleGLES2Vertex, ambientFactor)));
	glBufferData(
		GL_ARRAY_BUFFER,
		static_cast<GLsizeiptr>(state.vertexCount * sizeof(ParticleGLES2Vertex)),
		state.vertices.data(),
		GL_STREAM_DRAW
	);
	glDrawArrays(GL_TRIANGLES, 0, static_cast<GLsizei>(state.vertexCount));
	glDepthMask(GL_TRUE);
	state.vertexCount = 0u;
}

void registerParticlesPass_GLES2(RenderPassLibrary& registry) {
	RenderPassDef desc;
	desc.id = "particles";
	desc.name = "Particles";
	desc.graph = RenderPassDef::RenderPassGraphDef{};
	desc.graph->writes = { RenderPassDef::RenderGraphSlot::FrameColor };
	desc.graph->buildState = [&registry](const RenderPassDef::RenderGraphPassContext& ctx) -> std::any {
		return buildParticlePipelineState(ctx, registry.getStateRef<FrameSharedState>("frame_shared"));
	};
	desc.bootstrap = [](GPUBackend* backend) {
		initParticlePipeline(*static_cast<OpenGLES2Backend*>(backend));
	};
	desc.shouldExecute = []() {
		const GameView* view = ConsoleCore::instance().view();
		return view->vdpBillboardCount > 0u;
	};
	desc.exec = [](GPUBackend* backend, void* framebuffer, std::any& state) {
		ParticleRuntime runtime{*static_cast<OpenGLES2Backend*>(backend), *ConsoleCore::instance().view()};
		renderParticleBatch(runtime, framebuffer, std::any_cast<ParticlePipelineState&>(state));
	};
	registry.registerPass(desc);
}

} // namespace bmsx
#endif
