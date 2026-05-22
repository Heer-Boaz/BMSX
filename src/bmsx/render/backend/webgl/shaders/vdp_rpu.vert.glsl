#version 300 es
precision highp float;
in vec3 a_position;
in vec2 a_uv0;
in vec4 a_color;
in vec3 a_normal;
in vec4 a_joints;
in vec4 a_weights;
in vec4 a_instance0;
in vec4 a_instance1;
in vec4 a_instance2;
in vec4 a_instance3;
in vec4 a_instance_color;
in vec4 a_instance_uvrect;
uniform mat4 u_c0;
uniform mat4 u_joint[24];
uniform int u_instanceMode;
uniform int u_skinningMode;
out vec2 v_uv0;
out vec4 v_color;
out vec3 v_normal;
void main() {
	vec4 position = vec4(a_position, 1.0);
	vec3 normal = a_normal;
	if (u_skinningMode != 0) {
		int j0 = int(a_joints.x);
		int j1 = int(a_joints.y);
		int j2 = int(a_joints.z);
		int j3 = int(a_joints.w);
		mat4 skin = u_joint[j0] * a_weights.x + u_joint[j1] * a_weights.y + u_joint[j2] * a_weights.z + u_joint[j3] * a_weights.w;
		position = skin * position;
		normal = (skin * vec4(normal, 0.0)).xyz;
	}
	v_uv0 = a_uv0;
	v_color = a_color;
	v_normal = normal;
	if (u_instanceMode == 1) {
		vec2 p = vec2(dot(a_instance0.xy, a_position.xy) + a_instance0.z, dot(a_instance1.xy, a_position.xy) + a_instance1.z);
		position = vec4(p, a_instance0.w, 1.0);
		v_uv0 = a_instance_uvrect.xy + a_uv0 * a_instance_uvrect.zw;
		v_color *= a_instance_color;
	} else if (u_instanceMode == 2) {
		position = mat4(a_instance0, a_instance1, a_instance2, a_instance3) * position;
		v_color *= a_instance_color;
	}
	gl_PointSize = 3.0;
	gl_Position = u_c0 * position;
}
