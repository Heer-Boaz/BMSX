`timescale 1ns/1ps
// Join one ordered stream of physical output coordinates with the two existing
// per-circuit sample pipelines and the existing PMODE compositor. Each accepted
// output position reserves an ordered record carrying its own tag and control
// words. Each circuit is fetched only where it contributes; lane results are
// consumed with the oldest matching record, never independently advanced.
//
// Two scheduler lanes retain the normal per-lane in-order response contract.
// Beam/window generation, memory-write vs fetch ordering, pixel-clock crossing,
// and physical DAC deadlines remain separate owners. The flow is an elastic
// multi-stream join, as in mature video DMA pipelines such as LiteX:
// https://github.com/enjoy-digital/litex/blob/master/litex/soc/cores/video.py
module gfx_pcrtc_join (
 input wire clk,reset_n,
 input wire req_valid,output wire req_ready,input wire [31:0] req_tag,
 input wire [31:0] req_pmode,req_bgcolor,
 input wire req_c1_inside,req_c2_inside,
 input wire [31:0] req_c1_dispfb,req_c1_x,req_c1_y,
 input wire [31:0] req_c2_dispfb,req_c2_x,req_c2_y,
 output wire [1:0] mem_req_valid,input wire [1:0] mem_req_ready,
 output wire [37:0] mem_req_address,output wire [11:0] mem_req_tag,
 input wire [1:0] mem_rsp_valid,output wire [1:0] mem_rsp_ready,
 input wire [63:0] mem_rsp_data,input wire [11:0] mem_rsp_tag,
 output wire rsp_valid,input wire rsp_ready,output wire [31:0] rsp_tag,rsp_rgba
);
 reg [31:0] pmode[0:31],bgcolor[0:31],tags[0:31];
 reg [31:0] inside1,inside2,needed1,needed2;
 reg [4:0] head,tail;reg [5:0] count;
 reg [31:0] result_tag;
 wire [1:0] lane_req_ready,lane_rsp_valid,lane_rsp_ready;
 wire [31:0] lane1_rgba,lane2_rgba;
 // With fixed ALP=0 and AMOD=1 circuit 1 changes neither RGB nor alpha.
 wire need1=req_pmode[0] && req_c1_inside &&
            !(req_pmode[5] && req_pmode[6] && req_pmode[15:8]==0);
 wire need2=req_pmode[1] && req_c2_inside && (!req_pmode[7] || req_pmode[6]);
 wire output_ready,join_valid;
 wire consume=join_valid && output_ready;
 wire room=count<32 || consume;
 wire push=req_valid && req_ready;
 assign req_ready=reset_n && room && (!need1 || lane_req_ready[0]) && (!need2 || lane_req_ready[1]);
 wire lane1_valid=req_valid && room && need1 && (!need2 || lane_req_ready[1]);
 wire lane2_valid=req_valid && room && need2 && (!need1 || lane_req_ready[0]);
 assign join_valid=reset_n && count!=0 && (!needed1[head] || lane_rsp_valid[0]) && (!needed2[head] || lane_rsp_valid[1]);
 assign lane_rsp_ready[0]=reset_n && count!=0 && needed1[head] && (!needed2[head] || lane_rsp_valid[1]) && output_ready;
 assign lane_rsp_ready[1]=reset_n && count!=0 && needed2[head] && (!needed1[head] || lane_rsp_valid[0]) && output_ready;
 gfx_pcrtc_sample_pipeline #(.CIRCUIT2(0)) circuit1(
  .clk(clk),.reset_n(reset_n),.req_valid(lane1_valid),.req_ready(lane_req_ready[0]),
  .req_dispfb(req_c1_dispfb),.req_x(req_c1_x),.req_y(req_c1_y),
  .mem_req_valid(mem_req_valid[0]),.mem_req_ready(mem_req_ready[0]),.mem_req_address(mem_req_address[18:0]),.mem_req_tag(mem_req_tag[5:0]),
  .mem_rsp_valid(mem_rsp_valid[0]),.mem_rsp_ready(mem_rsp_ready[0]),.mem_rsp_data(mem_rsp_data[31:0]),.mem_rsp_tag(mem_rsp_tag[5:0]),
  .rsp_valid(lane_rsp_valid[0]),.rsp_ready(lane_rsp_ready[0]),.rsp_rgba(lane1_rgba));
 gfx_pcrtc_sample_pipeline #(.CIRCUIT2(1)) circuit2(
  .clk(clk),.reset_n(reset_n),.req_valid(lane2_valid),.req_ready(lane_req_ready[1]),
  .req_dispfb(req_c2_dispfb),.req_x(req_c2_x),.req_y(req_c2_y),
  .mem_req_valid(mem_req_valid[1]),.mem_req_ready(mem_req_ready[1]),.mem_req_address(mem_req_address[37:19]),.mem_req_tag(mem_req_tag[11:6]),
  .mem_rsp_valid(mem_rsp_valid[1]),.mem_rsp_ready(mem_rsp_ready[1]),.mem_rsp_data(mem_rsp_data[63:32]),.mem_rsp_tag(mem_rsp_tag[11:6]),
  .rsp_valid(lane_rsp_valid[1]),.rsp_ready(lane_rsp_ready[1]),.rsp_rgba(lane2_rgba));
 gfx_pcrtc_compositor compositor(.clk(clk),.reset_n(reset_n),.req_valid(join_valid),.req_ready(output_ready),
  .req_pmode(pmode[head]),.req_bgcolor(bgcolor[head]),.req_c1_rgba(lane1_rgba),.req_c2_rgba(lane2_rgba),
  .req_c1_inside(inside1[head]),.req_c2_inside(inside2[head]),.rsp_valid(rsp_valid),.rsp_ready(rsp_ready),.rsp_rgba(rsp_rgba));
 assign rsp_tag=result_tag;
 always @(posedge clk or negedge reset_n) begin
  if(!reset_n) begin head<=0;tail<=0;count<=0;inside1<=0;inside2<=0;needed1<=0;needed2<=0;result_tag<=0;end
  else begin
   case({push,consume}) 2'b10:count<=count+1'b1;2'b01:count<=count-1'b1;endcase
   if(push) begin
    pmode[tail]<=req_pmode;bgcolor[tail]<=req_bgcolor;tags[tail]<=req_tag;
    inside1[tail]<=req_c1_inside;inside2[tail]<=req_c2_inside;needed1[tail]<=need1;needed2[tail]<=need2;
    tail<=tail+1'b1;
   end
   if(consume) begin result_tag<=tags[head];head<=head+1'b1;end
  end
 end
endmodule
