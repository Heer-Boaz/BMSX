`timescale 1ns/1ps
// Logical PCRTC display-window/source-coordinate datapath. The caller supplies
// an absolute horizontal pixel index on the logical output grid and an
// absolute vertical signal row, along
// with one latched display configuration and its current FIELD. It does not
// infer the mapping from a 13.5 MHz physical sample to those logical inputs;
// that choice, beam/sync generation and output pacing belong to other owners.
// Each circuit computes coordinates from the Book I window equations; the
// consumer uses a coordinate only when that circuit's inside_mask bit is asserted.
// Register words remain raw, with encoded-plus-one magnifications decoded here.
// Full ready/valid result is held under backpressure.
// Production video designs likewise separate timing/window control from DMA
// fetch: https://github.com/enjoy-digital/litex/blob/master/litex/soc/cores/video.py
module gfx_pcrtc_window_coords (
 input wire clk,reset_n,
 input wire req_valid,output wire req_ready,
 input wire req_timing_running,input wire [31:0] req_pmode,req_smode1,req_smode2,
 input wire req_field,input wire [31:0] req_output_x,req_signal_y,
 input wire [31:0] req_display1_low,req_display1_high,req_dispfb1_high,
 input wire [31:0] req_display2_low,req_display2_high,req_dispfb2_high,
 output reg rsp_valid,input wire rsp_ready,
 output reg [1:0] rsp_inside,output reg [31:0] rsp_x1,rsp_y1,rsp_x2,rsp_y2
);
 wire enabled1=req_pmode[0],enabled2=req_pmode[1];
 wire [10:0] origin_y1=req_display1_low[22:12],origin_y2=req_display2_low[22:12];
 wire [10:0] crop_y=enabled1 && (!enabled2 || origin_y1<=origin_y2) ? origin_y1 : origin_y2;
 wire interlaced=req_smode2[0],frame_mode=req_smode2[1];
 wire pixel_enabled=req_timing_running && req_smode1[24:21]!=0;
 wire [35:0] signal_x={4'b0,req_output_x}*req_smode1[24:21];
 wire [31:0] display_low[0:1],display_high[0:1],dispfb_high[0:1];
 assign display_low[0]=req_display1_low;assign display_low[1]=req_display2_low;
 assign display_high[0]=req_display1_high;assign display_high[1]=req_display2_high;
 assign dispfb_high[0]=req_dispfb1_high;assign dispfb_high[1]=req_dispfb2_high;
 wire [1:0] inside_mask;
 wire [31:0] source_x[0:1],source_y[0:1];
 // ceil(2^18 / (encoded + 1)); the encoded field covers all 16 rows.
 // For in-window offsets 0..4095 this yields the exact integer quotient.
 function automatic [18:0] reciprocal(input [3:0] encoded);
  case(encoded)
   0:reciprocal=19'h40000; 1:reciprocal=19'h20000;
   2:reciprocal=19'h15556; 3:reciprocal=19'h10000;
   4:reciprocal=19'h0cccd; 5:reciprocal=19'h0aaab;
   6:reciprocal=19'h0924a; 7:reciprocal=19'h08000;
   8:reciprocal=19'h071c8; 9:reciprocal=19'h06667;
   10:reciprocal=19'h05d18;11:reciprocal=19'h05556;
   12:reciprocal=19'h04ec5;13:reciprocal=19'h04925;
   14:reciprocal=19'h04445;15:reciprocal=19'h04000;
  endcase
 endfunction
 genvar j;
 generate for(j=0;j<2;j=j+1) begin : circuit
  wire [31:0] sx={20'd0,display_low[j][11:0]},sy={21'd0,display_low[j][22:12]};
  wire [31:0] xend=sx+{20'd0,display_high[j][11:0]}+32'd1;
  wire [31:0] yend=sy+{21'd0,display_high[j][22:12]}+32'd1;
  // Within each window, differences are bounded by its 12-/11-bit extent.
  wire [11:0] nx=signal_x[11:0]-display_low[j][11:0];
  wire [10:0] ny=req_signal_y[10:0]-display_low[j][22:12];
  wire [3:0] y_divisor_index=interlaced ? {1'b0,display_low[j][28:27],1'b1} : {2'b0,display_low[j][28:27]};
  wire [30:0] x_product=nx*reciprocal(display_low[j][26:23]);
  wire [29:0] y_product=ny*reciprocal(y_divisor_index);
  wire [12:0] xquotient=x_product[30:18];
  wire [11:0] yquotient=y_product[29:18];
  assign inside_mask[j]=pixel_enabled && req_pmode[j] && signal_x>={4'b0,sx} && signal_x<{4'b0,xend} &&
                   req_signal_y>=sy && req_signal_y<yend &&
                   (!interlaced || ((req_signal_y-crop_y)&32'd1)=={31'd0,req_field});
  assign source_x[j]={21'd0,dispfb_high[j][10:0]}+xquotient;
  assign source_y[j]={21'd0,dispfb_high[j][21:11]}+
    (interlaced && !frame_mode ? ({20'd0,yquotient}<<1)+{31'd0,(display_low[j][12]^req_field)} : {20'd0,yquotient});
 end endgenerate
 assign req_ready=reset_n && (!rsp_valid || rsp_ready);
 always @(posedge clk or negedge reset_n) begin
  if(!reset_n) begin rsp_valid<=0;rsp_inside<=0;rsp_x1<=0;rsp_y1<=0;rsp_x2<=0;rsp_y2<=0;end
  else if(req_ready) begin
   rsp_valid<=req_valid;
   if(req_valid) begin rsp_inside<=inside_mask;rsp_x1<=source_x[0];rsp_y1<=source_y[0];rsp_x2<=source_x[1];rsp_y2<=source_y[1];end
  end
 end
endmodule
