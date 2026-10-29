`timescale 1ns/1ps
// Candidate SYS-to-54-MHz display-state transfer. The real SYS PCRTC owner
// remains the authority for programming, reset, displayed words and FIELD.
// Each SYS edge after startup transfers the preceding settled display bank,
// FIELD and whether that settled state was installed by a PCRTC RESET. The
// receiver consumes one snapshot per local edge and retains the last bank and
// FIELD atomically. Intermediate source states are not coalesced or hidden.
//
// local_clk is the proposed free-running 54 MHz PLL-derived GFX clock; it must
// remain locked and faster than the 33.8688 MHz SYS clock while the source is
// active. The PLL lock input gates startup only; loss of lock in service and
// FIFO overflow are not recovered here. Clock tolerance, analog metastability,
// Gray skew, ASIC storage, PLL and physical timing still require qualification.
// A stopped/slow destination can overflow the FIFO: overflow is reported rather
// than claiming to reconstruct lost history. This block does NOT implement
// time-aligned pixel sampling, beam-phase transfer, output reset, DAC timing,
// supervisor quiescence or change the public PCRTC specification.
//
// Separate coherent payload and Gray-pointer CDC, with common reset, follows
// the structure of PULP's production asynchronous FIFO:
// https://github.com/pulp-platform/common_cells/blob/master/src/cc_cdc_fifo_gray.sv
module gfx_pcrtc_fast_snapshot (
 input wire sysclk,local_clk,reset_n,pll_locked,
 input wire access_valid,access_write,input wire [4:0] access_index,
 input wire [31:0] access_wdata,output wire access_ready,output wire [31:0] access_rdata,
 input wire [4:0] other_events,
 output wire irq_raise,gpu_queue_action,gpu_reset_action,
 output wire [703:0] programmed_words,displayed_words,
 output wire field,output wire [14:0] field_half_line,
 output wire source_reset_n,local_reset_n,output wire fifo_ready,overflow,
 output reg history_lost,
 output wire snapshot_valid,snapshot_reset,snapshot_field,
 output wire [703:0] snapshot_words,
 output reg [703:0] local_words,output reg local_field
);
 reg source_run,source_admit,prior_reset;
 (* async_reg = "true" *) reg [1:0] lock_sys,local_release;
 wire [705:0] fifo_data;
 wire fifo_valid;
 // Local reset release requires actual local edges and PLL lock. The source
 // begins only after synchronized lock and the FIFO's own write release.
 always @(posedge local_clk or negedge reset_n)
  if(!reset_n) local_release<=0;
  else if(!pll_locked) local_release<=0;
  else local_release<={local_release[0],1'b1};
 always @(posedge sysclk or negedge reset_n)
  if(!reset_n) begin lock_sys<=0;source_run<=0;source_admit<=0;prior_reset<=0;history_lost<=0;end
  else begin
   lock_sys<={lock_sys[0],local_release[1]};
   if(fifo_ready && lock_sys[1]) source_run<=1;
   source_admit<=source_run;
   prior_reset<=gpu_reset_action;
   if(overflow) history_lost<=1;
  end
 assign source_reset_n=reset_n && source_run;
 assign local_reset_n=reset_n && local_release[1];
 assign access_ready=reset_n && source_admit;
 assign overflow=source_reset_n && !fifo_ready;
 assign snapshot_valid=fifo_valid && local_reset_n;
 assign snapshot_reset=fifo_data[705];
 assign snapshot_field=fifo_data[704];
 assign snapshot_words=fifo_data[703:0];
 gfx_pcrtc_control source(.clk(sysclk),.reset_n(source_reset_n),
  .access_valid(access_valid && access_ready),.access_write(access_write),.access_index(access_index),
  .access_wdata(access_wdata),.access_rdata(access_rdata),.other_events(other_events),
  .irq_raise(irq_raise),.gpu_queue_action(gpu_queue_action),.gpu_reset_action(gpu_reset_action),
  .programmed_words(programmed_words),.displayed_words(displayed_words),
  .display_update_valid(),.display_update_reset(),.display_update_words(),
  .timing_restart(),.running(),.vblank_active(),.field(field),.field_half_line(field_half_line),
  .csr_word(),.imr_word());
 async_fifo #(.WIDTH(706),.ADDR_BITS(2)) fifo(.reset_n(reset_n),.w_clk(sysclk),
  .w_valid(source_reset_n),.w_ready(fifo_ready),.w_data({prior_reset,field,displayed_words}),
  .r_clk(local_clk),.r_valid(fifo_valid),.r_ready(local_reset_n),.r_data(fifo_data));
 always @(posedge local_clk or negedge reset_n)
  if(!reset_n) begin local_words<=0;local_field<=0;end
  else if(snapshot_valid) begin local_words<=snapshot_words;local_field<=snapshot_field;end
endmodule
