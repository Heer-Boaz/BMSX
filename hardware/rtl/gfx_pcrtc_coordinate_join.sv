`timescale 1ns/1ps
// Logical-position ingress for the two-circuit PCRTC sample/compose pipeline.
// The coordinate owner receives the already selected logical output-grid X and
// signal-row Y, not a physical DAC beam. A single elastic control latch is
// reserved on the exact same handshake as the coordinate result. When that
// result is consumed and a new input is accepted on one edge, the join sees
// the preceding tag/config while the latch captures the new one. The existing
// join and memory pipelines own their subsequent ordering and backpressure.
// Display latching, beam/physical-sample mapping, framebuffer write visibility,
// CDC and actual DAC deadline remain separate and are not invented here.
// Professional video pipelines similarly keep fetch metadata coupled to their
// elastic data stream: https://github.com/enjoy-digital/litex/blob/master/litex/soc/cores/video.py
module gfx_pcrtc_coordinate_join (
 input wire clk,reset_n,
 input wire req_valid,output wire req_ready,input wire [31:0] req_tag,
 input wire req_timing_running,input wire [31:0] req_pmode,req_bgcolor,req_smode1,req_smode2,
 input wire req_field,input wire [31:0] req_output_x,req_signal_y,
 input wire [31:0] req_c1_dispfb,req_c1_origin,req_c1_display,req_c1_extent,
 input wire [31:0] req_c2_dispfb,req_c2_origin,req_c2_display,req_c2_extent,
 output wire [1:0] mem_req_valid,input wire [1:0] mem_req_ready,
 output wire [37:0] mem_req_address,output wire [11:0] mem_req_tag,
 input wire [1:0] mem_rsp_valid,output wire [1:0] mem_rsp_ready,
 input wire [63:0] mem_rsp_data,input wire [11:0] mem_rsp_tag,
 output wire rsp_valid,input wire rsp_ready,output wire [31:0] rsp_tag,rsp_rgba
);
 reg [31:0] meta_tag,meta_pmode,meta_bgcolor,meta_dispfb1,meta_dispfb2;
 wire coords_valid,coords_ready;wire [1:0] coords_inside;wire [31:0] x1,y1,x2,y2;
 gfx_pcrtc_window_coords coords(.clk(clk),.reset_n(reset_n),.req_valid(req_valid),.req_ready(req_ready),
  .req_timing_running(req_timing_running),.req_pmode(req_pmode),.req_smode1(req_smode1),.req_smode2(req_smode2),
  .req_field(req_field),.req_output_x(req_output_x),.req_signal_y(req_signal_y),
  .req_display1_low(req_c1_display),.req_display1_high(req_c1_extent),.req_dispfb1_high(req_c1_origin),
  .req_display2_low(req_c2_display),.req_display2_high(req_c2_extent),.req_dispfb2_high(req_c2_origin),
  .rsp_valid(coords_valid),.rsp_ready(coords_ready),.rsp_inside(coords_inside),.rsp_x1(x1),.rsp_y1(y1),.rsp_x2(x2),.rsp_y2(y2));
 gfx_pcrtc_join join_engine(.clk(clk),.reset_n(reset_n),.req_valid(coords_valid),.req_ready(coords_ready),
  .req_tag(meta_tag),.req_pmode(meta_pmode),.req_bgcolor(meta_bgcolor),
  .req_c1_inside(coords_inside[0]),.req_c2_inside(coords_inside[1]),
  .req_c1_dispfb(meta_dispfb1),.req_c1_x(x1),.req_c1_y(y1),
  .req_c2_dispfb(meta_dispfb2),.req_c2_x(x2),.req_c2_y(y2),
  .mem_req_valid(mem_req_valid),.mem_req_ready(mem_req_ready),.mem_req_address(mem_req_address),.mem_req_tag(mem_req_tag),
  .mem_rsp_valid(mem_rsp_valid),.mem_rsp_ready(mem_rsp_ready),.mem_rsp_data(mem_rsp_data),.mem_rsp_tag(mem_rsp_tag),
  .rsp_valid(rsp_valid),.rsp_ready(rsp_ready),.rsp_tag(rsp_tag),.rsp_rgba(rsp_rgba));
 always @(posedge clk or negedge reset_n) begin
  if(!reset_n) begin meta_tag<=0;meta_pmode<=0;meta_bgcolor<=0;meta_dispfb1<=0;meta_dispfb2<=0;end
  else if(req_valid && req_ready) begin
   meta_tag<=req_tag;meta_pmode<=req_pmode;meta_bgcolor<=req_bgcolor;
   meta_dispfb1<=req_c1_dispfb;meta_dispfb2<=req_c2_dispfb;
  end
 end
endmodule
