#version 300 es
precision mediump float;

in vec3 v_texcoord;
uniform samplerCube u_skybox;
out vec4 outputColor;

void main() {
    outputColor = texture(u_skybox, v_texcoord);
}
