`timescale 1ns/1ps
// Candidate reference-clock display phase to the absolute output-grid index.
// Phase, period and SMODE1 must belong to the SAME LATCHED DISPLAY timing
// epoch.  The live system beam is not this phase owner: its timing can restart
// or stop on a register write while the latched display continues.  The
// candidate display-phase owner is gfx_pcrtc_display_epoch; its complete
// VBlank/configuration CDC and source-rate proof remain open. Direct connection
// to the live beam does not implement the public contract.
// The index feeds gfx_pcrtc_window_coords, not a display-window crop.
//
// In a line, the phase numerator is phase in its first half and period+phase
// in its second half.  Division by 2*D converts that numerator to signal X;
// division by StepX selects the logical pixel containing the physical sample.
// Both operations are combined without an intermediate rounding error.
//
// A zero StepX disables pixel output in the existing window datapath.  The
// quotient is only meaningful when sample_valid is asserted; there is no
// replacement pixel or output-underflow policy here.  The alignment of a
// new display epoch to the physical reference clock remains a design choice;
// Book I does not establish this exact sampling phase. Vertical mapping, sync,
// SYS-to-video CDC, framebuffer fetch and physical timing closure are separate.
module gfx_pcrtc_sample_x (
 input wire running,
 input wire [31:0] smode1,
 input wire [22:0] period_numerator,phase,
 input wire [63:0] elapsed_half_lines,
 output wire sample_valid,
 output wire [31:0] output_x
);
 wire [4:0] divider={2'd0,smode1[2:0]}*({3'd0,smode1[11:10]}+5'd1);
 wire [9:0] divisor=({5'd0,divider}*{6'd0,smode1[24:21]})<<1;
 wire [23:0] line_phase={1'b0,phase}+
  (elapsed_half_lines[0] ? {1'b0,period_numerator} : 24'd0);
 assign sample_valid=running && smode1[24:21]!=0;
 assign output_x={8'd0,line_phase/divisor};
endmodule
