`timescale 1ns/1ps
// One pixel of Book I PCRTC composition. The beam/window owner supplies the
// membership of both already-fetched samples and a latched raw PMODE/BGCOLOR.
// It is a one-entry elastic register: accepted pixel/controls are committed
// together and held through output stalls. Division by 255 is exact over the
// entire 0..65152 numerator range using (n+1+(n>>8))>>8. No beam, scanout
// memory coherence, CDC, or DAC deadline is inferred by this datapath.
// CPU/renderer source implementations use the same independently specified
// weighted arithmetic; PSX MAME similarly keeps rendering and presentation
// in separate owners: https://github.com/mamedev/mame/blob/master/src/devices/video/psx.cpp
module gfx_pcrtc_compositor (
 input wire clk,reset_n,
 input wire req_valid,output wire req_ready,
 input wire [31:0] req_pmode,req_bgcolor,req_c1_rgba,req_c2_rgba,
 input wire req_c1_inside,req_c2_inside,
 output reg rsp_valid,input wire rsp_ready,output reg [31:0] rsp_rgba
);
 wire en1=req_pmode[0] && req_c1_inside;
 wire en2=req_pmode[1] && req_c2_inside;
 wire mmod=req_pmode[5],amod=req_pmode[6],slbg=req_pmode[7];
 wire [23:0] prior_rgb=en2 && !slbg ? req_c2_rgba[23:0] : req_bgcolor[23:0];
 wire [7:0] prior_alpha=en2 && amod ? req_c2_rgba[31:24] : 8'd0;
 wire [7:0] src_alpha=req_c1_rgba[31:24];
 wire [7:0] alpha=mmod ? req_pmode[15:8] : src_alpha[7] ? 8'hff : {src_alpha[6:0],1'b0};
 wire [7:0] inverse_alpha=8'd255-alpha;
 wire [7:0] result_alpha=en1 && !amod ? src_alpha : prior_alpha;
 wire [23:0] result_rgb;
 genvar ch;
 generate for(ch=0;ch<3;ch=ch+1) begin : component
  wire [15:0] numerator=req_c1_rgba[ch*8+:8]*alpha+prior_rgb[ch*8+:8]*inverse_alpha+16'd127;
  wire [16:0] exact_quotient=( {1'b0,numerator}+17'd1+({1'b0,numerator}>>8))>>8;
  assign result_rgb[ch*8+:8]=!en1 || alpha==0 ? prior_rgb[ch*8+:8] :
                               alpha==255 ? req_c1_rgba[ch*8+:8] : exact_quotient[7:0];
 end endgenerate
 assign req_ready=reset_n && (!rsp_valid || rsp_ready);
 always @(posedge clk or negedge reset_n) begin
  if(!reset_n) begin rsp_valid<=0;rsp_rgba<=0;end
  else if(req_ready) begin
   rsp_valid<=req_valid;
   if(req_valid) rsp_rgba<={result_alpha,result_rgb};
  end
 end
endmodule
