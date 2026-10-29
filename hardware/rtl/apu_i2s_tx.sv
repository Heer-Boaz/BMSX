`timescale 1ns/1ps
// PCM1754 FMT=0: continuous 64-fs I2S and 256-fs system clock from the
// 33.8688-MHz APU clock. A 16-bit signed stereo sample is left-aligned in each
// 32-bit channel slot; the remaining bits are zero. LRCK changes on a falling
// BCK edge one bit before the new channel's MSB. The DAC samples rising BCK.
//
// frame_latch identifies the system edge where the producing owner must supply
// the next full stereo frame. This block samples those raw wires unconditionally:
// it does not invent a silence/repeat policy or claim the producer meets this
// deadline. Reset initializes the output shift registers and clock phase.
// TI PCM1754 SLES092E, sections 7.6 and 8.3.2:
// https://www.ti.com/lit/ds/symlink/pcm1754.pdf
// MiSTer audio also separates serial output from the sample producer:
// https://github.com/mist-devel/MSX_MiST/blob/master/mist/MSX.sv
module apu_i2s_tx (
 input wire clk,reset_n,
 input wire [15:0] frame_left,frame_right,
 output wire frame_latch,
 output wire mclk,bclk,lrck,serial_data
);
 reg [1:0] mclk_phase;
 reg [3:0] bclk_phase;
 reg [5:0] bit_index;
 reg [15:0] left_word,right_word;
 assign mclk=reset_n && mclk_phase==0;
 assign bclk=reset_n && bclk_phase>=6;
 assign lrck=bit_index[5];
 assign frame_latch=reset_n && bit_index==63 && bclk_phase==11;
 wire [4:0] bit_cell=bit_index[4:0];
 wire [15:0] word=lrck ? right_word : left_word;
 assign serial_data=bit_cell>=1 && bit_cell<=16 ? word[16-bit_cell] : 1'b0;
 always @(posedge clk or negedge reset_n) begin
  if(!reset_n) begin
   mclk_phase<=0;bclk_phase<=0;bit_index<=0;left_word<=0;right_word<=0;
  end else begin
   if(mclk_phase==2) mclk_phase<=0;else mclk_phase<=mclk_phase+1'b1;
   if(bclk_phase==11) begin
    bclk_phase<=0;bit_index<=bit_index+1'b1;
    if(frame_latch) begin left_word<=frame_left;right_word<=frame_right;end
   end else bclk_phase<=bclk_phase+1'b1;
  end
 end
endmodule
