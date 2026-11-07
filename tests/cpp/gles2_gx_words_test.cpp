#include "gx_gpu_words_shader.h"
#include <EGL/egl.h>
#include <GLES2/gl2.h>
#include <array>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>
extern "C" {
#include "video_context.h"
}

static void require(bool value, const char* message) {
	if (!value) { std::fprintf(stderr, "%s\n", message); std::exit(1); }
}

static GLuint shader(GLenum type, const char* body, bool words) {
	const GLuint result = glCreateShader(type);
	const char* sources[]{"precision mediump float; precision mediump int;\n", words ? kGxGpuWordFunctions : "", body};
	glShaderSource(result, 3, sources, nullptr);
	glCompileShader(result);
	GLint compiled; glGetShaderiv(result, GL_COMPILE_STATUS, &compiled);
	char log[2048]; glGetShaderInfoLog(result, sizeof(log), nullptr, log);
	require(compiled != 0, log);
	return result;
}

static GLuint program(const char* body) {
	const GLuint vertex = shader(GL_VERTEX_SHADER,
		"attribute vec2 a;void main(){gl_Position=vec4(a,0.0,1.0);}", false);
	const GLuint fragment = shader(GL_FRAGMENT_SHADER, body, true);
	const GLuint result = glCreateProgram();
	glAttachShader(result, vertex); glAttachShader(result, fragment);
	glBindAttribLocation(result, 0, "a"); glLinkProgram(result);
	glDeleteShader(vertex); glDeleteShader(fragment);
	GLint linked; glGetProgramiv(result, GL_LINK_STATUS, &linked);
	char log[2048]; glGetProgramInfoLog(result, sizeof(log), nullptr, log);
	require(linked != 0, log);
	return result;
}

int main(int argc, char** argv) {
	const bool framebuffer = argc == 2 && std::strcmp(argv[1], "--fb") == 0;
	EGLDisplay display = EGL_NO_DISPLAY;
	EGLSurface surface = EGL_NO_SURFACE;
	EGLContext context = EGL_NO_CONTEXT;
	if (framebuffer) {
		bmsx_video_context_open(BMSX_VIDEO_CONTEXT_FBDEV, false);
		require(bmsx_video_context_enable_gles2(), "open explicit framebuffer GLES2 context");
	} else {
		display = eglGetDisplay(EGL_DEFAULT_DISPLAY);
		require(eglInitialize(display, nullptr, nullptr), "initialize EGL");
		require(eglBindAPI(EGL_OPENGL_ES_API), "bind GLES");
		const EGLint attrs[]{EGL_SURFACE_TYPE,EGL_PBUFFER_BIT,EGL_RENDERABLE_TYPE,EGL_OPENGL_ES2_BIT,
			EGL_RED_SIZE,8,EGL_GREEN_SIZE,8,EGL_BLUE_SIZE,8,EGL_ALPHA_SIZE,8,EGL_NONE};
		EGLConfig config; EGLint count;
		require(eglChooseConfig(display,attrs,&config,1,&count) && count == 1,"choose EGL config");
		const EGLint size[]{EGL_WIDTH,256,EGL_HEIGHT,256,EGL_NONE};
		surface = eglCreatePbufferSurface(display,config,size);
		const EGLint ctx[]{EGL_CONTEXT_CLIENT_VERSION,2,EGL_NONE};
		context = eglCreateContext(display,config,EGL_NO_CONTEXT,ctx);
		require(eglMakeCurrent(display,surface,surface,context),"make EGL context current");
	}
	glDisable(GL_DITHER);
	std::vector<unsigned char> bytes(256u*256u*2u), pixels(256u*256u*4u);
	for (unsigned i=0;i<65536u;++i) { bytes[i*2u]=i & 255u; bytes[i*2u+1u]=i >> 8u; }
	GLuint input, output, fbo, vbo;
	glGenTextures(1,&input); glBindTexture(GL_TEXTURE_2D,input);
	glTexImage2D(GL_TEXTURE_2D,0,GL_LUMINANCE_ALPHA,256,256,0,GL_LUMINANCE_ALPHA,GL_UNSIGNED_BYTE,bytes.data());
	glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,GL_NEAREST);
	glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAG_FILTER,GL_NEAREST);
	glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_WRAP_S,GL_CLAMP_TO_EDGE);
	glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_WRAP_T,GL_CLAMP_TO_EDGE);
	glGenTextures(1,&output); glBindTexture(GL_TEXTURE_2D,output);
	glTexImage2D(GL_TEXTURE_2D,0,GL_RGBA,256,256,0,GL_RGBA,GL_UNSIGNED_BYTE,nullptr);
	glGenFramebuffers(1,&fbo); glBindFramebuffer(GL_FRAMEBUFFER,fbo);
	glFramebufferTexture2D(GL_FRAMEBUFFER,GL_COLOR_ATTACHMENT0,GL_TEXTURE_2D,output,0);
	require(glCheckFramebufferStatus(GL_FRAMEBUFFER)==GL_FRAMEBUFFER_COMPLETE,"word-test render target");
	const GLfloat quad[]{-1,-1,1,-1,-1,1,1,1};
	glGenBuffers(1,&vbo); glBindBuffer(GL_ARRAY_BUFFER,vbo);
	glBufferData(GL_ARRAY_BUFFER,sizeof(quad),quad,GL_STATIC_DRAW);
	glEnableVertexAttribArray(0); glVertexAttribPointer(0,2,GL_FLOAT,GL_FALSE,0,nullptr);
	const GLuint wordProgram = program(
		"uniform sampler2D t;void main(){ivec2 word=ivec2(texture2D(t,gl_FragCoord.xy/256.0).ra*255.0+0.5);"
		"gl_FragColor=encodeRgb555(decodeRgb555To5(word),word.y/128);}");
	glUseProgram(wordProgram); glActiveTexture(GL_TEXTURE0); glBindTexture(GL_TEXTURE_2D,input);
	glUniform1i(glGetUniformLocation(wordProgram,"t"),0); glViewport(0,0,256,256);
	glDrawArrays(GL_TRIANGLE_STRIP,0,4); glReadPixels(0,0,256,256,GL_RGBA,GL_UNSIGNED_BYTE,pixels.data());
	for (unsigned word=0;word<65536u;++word) for(unsigned nibble=0;nibble<4;++nibble)
		require(pixels[word*4u+nibble]==((word >> ((3u-nibble)*4u)) & 15u)*17u,
			"mediump RGB555/mask packing preserves every bit of every VRAM word");
	glDeleteProgram(wordProgram);
	const GLuint planeProgram=program(
		"uniform vec4 b;uniform vec4 x;uniform vec4 y;uniform ivec2 origin;"
		"void main(){int value=gxAttributeByte(b.xz,x.xz,y.xz,ivec2(gl_FragCoord.xy)+origin);"
		"gl_FragColor=vec4(float(value)/255.0,0.0,0.0,1.0);}");
	glUseProgram(planeProgram); glViewport(0,0,32,32);
	glUniform2i(glGetUniformLocation(planeProgram,"origin"),992,2016);
	unsigned random=0x5932u;
	for(unsigned trial=0;trial<128;++trial) {
		std::array<unsigned,3> plane;
		for(unsigned i=0;i<3;++i){ random=random*1664525u+1013904223u; plane[i]=random & 0xfffffu;
			const char* name=i==0?"b":i==1?"x":"y";
			glUniform4f(glGetUniformLocation(planeProgram,name),float(plane[i]&1023u),0,float(plane[i]>>10u),0); }
		glDrawArrays(GL_TRIANGLE_STRIP,0,4);glReadPixels(0,0,32,32,GL_RGBA,GL_UNSIGNED_BYTE,pixels.data());
		for(unsigned y=0;y<32;++y)for(unsigned x=0;x<32;++x){
			const unsigned expected=((plane[0]+plane[1]*(x+992u)+plane[2]*(y+2016u))>>12u)&255u;
			require(pixels[(y*32u+x)*4u]==expected,"mediump Q12 keeps all twenty accumulator bits at VRAM edges");
		}
	}
	require(glGetError()==GL_NO_ERROR,"word/plane tests leave no GLES error");
	std::printf("GX-MEDIUMP:PASS 65536 words, 131072 Q12 samples, %s\n",glGetString(GL_RENDERER));
	glDeleteProgram(planeProgram);glDeleteBuffers(1,&vbo);glDeleteFramebuffers(1,&fbo);
	glDeleteTextures(1,&input);glDeleteTextures(1,&output);
	if(framebuffer) bmsx_video_context_close();
	else {eglMakeCurrent(display,EGL_NO_SURFACE,EGL_NO_SURFACE,EGL_NO_CONTEXT);
		eglDestroyContext(display,context);eglDestroySurface(display,surface);eglTerminate(display);}
}
