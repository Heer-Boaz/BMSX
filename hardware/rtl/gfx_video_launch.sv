`timescale 1ns/1ps
// GFX 13.5-MHz output registers. ADV7125 CLOCK and BLANK_N use the common
// pixel clock; CSYNC_N goes to the separate analogue sync path, not SYNC_N on
// the DAC (which is tied low on the board). The output data/control register
// launches on the falling pixel-clock edge, providing half a period before
// the DAC's next rising capture edge. Alpha is not an external DAC signal.
// The upstream owner supplies already ordered, CDC-safe RGBA/blank/sync wires;
// this register does not choose a value on an upstream deadline miss or
// implement beam generation, a FIFO, or inter-domain synchronization.
// ADV7125 timing, ADI datasheet rev. D tables 3/4 and section Digital
// Inputs: https://www.analog.com/media/en/technical-documentation/data-sheets/adv7125.pdf
module gfx_video_launch (
 input wire pixel_clk,reset_n,
 input wire [31:0] pixel_rgba,input wire blank_n_in,csync_n_in,
 output wire video_pclk,output reg [7:0] video_r,video_g,video_b,
 output reg video_blank_n,video_csync_n
);
 assign video_pclk=pixel_clk;
 always @(negedge pixel_clk or negedge reset_n) begin
  if(!reset_n) begin video_r<=0;video_g<=0;video_b<=0;video_blank_n<=0;video_csync_n<=1;end
  else begin video_r<=pixel_rgba[7:0];video_g<=pixel_rgba[15:8];video_b<=pixel_rgba[23:16];
   video_blank_n<=blank_n_in;video_csync_n<=csync_n_in;end
 end
endmodule
