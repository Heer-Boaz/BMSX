`timescale 1ns/1ps
// PCRTC programmed-word bank and beam candidate in the 33.8688 MHz system
// clock domain. An accepted changed timing-word write restarts the rational
// phase on that same edge, using the newly written word. No finite CDC queue
// is placed between the CPU-facing bank and its live beam. Unchanged writes
// and changed non-timing words do not restart it.
//
// The input is already decoded as one of the 22 PCRTC configuration words;
// MMIO bus ownership and CSR/IRQ are separate owners; software reset restores
// the configuration and displayed words on its accepted system edge.
// The separate display bank captures all words at each VBlank entry. An old
// event on a write edge sees the pre-write words; a zero-position event after
// a timing restart sees the new word. When both occur the second snapshot wins.
// The separate pre/post event outputs remain available for other owners. The
// 13.5 MHz output domain must still sample the resulting display state with a
// qualified clock-domain protocol. A real ASIC must close timing on the phase
// arithmetic, synchronizers, output path and pad clocks.
module gfx_pcrtc_system_beam (
 input wire clk,reset_n,soft_reset,
 input wire write_valid,input wire [4:0] write_index,input wire [31:0] write_word,
 input wire [4:0] read_index,output wire [31:0] read_word,
 output wire [703:0] programmed_words,displayed_words,
 output wire display_update_valid,display_update_reset,
 output wire [703:0] display_update_words,
 output wire [7:0] vblank_before_write,
 output wire vblank_after_restart,
 output wire hsync_before_write,vsync_before_write,vsync_after_restart,field_before_write,
 output wire timing_restart,
 output wire running,output wire [31:0] period_numerator,phase,
 output wire [16:0] increment,
 output wire [14:0] total_half_lines,field_half_line,active_half_lines,vsync_half_line,
 output wire [63:0] elapsed_half_lines,elapsed_fields,
 output wire [7:0] crossed_half_lines,crossed_fields,crossed_vblank_entries,crossed_vsyncs,
 output wire vblank_active,field
);
 localparam [703:0] RESET_WORDS={32'h00a90005,32'h02101404,32'h00000000,32'h003484bc,
  32'h0007f5c2,32'h1fc83030,32'h00000000,32'h00000000,32'h00000007,32'h40806504,
  32'h00000000,32'h00000000,32'h000ef4ff,32'h018252a8,32'h00000000,32'h000fa000,
  32'h000ef4ff,32'h018252a8,32'h00000000,32'h000fa000,32'h00000000,32'h00000000};
 reg [31:0] words[0:21],display[0:21];
 // Exact per-word difference, maintained by the bank that owns writes and
 // VBlank capture. This avoids comparing the entire 704-bit bank every SYS
 // clock. After an old VBlank and a same-edge write, only the written word
 // can differ from the just-captured pre-write bank.
 reg [21:0] display_dirty;
 reg [21:0] post_write_dirty;
 reg bootstrap;
 wire changed=write_valid && words[write_index]!=write_word;
 wire timing_word=write_index==12 || write_index==13 || (write_index>=16 && write_index<=21);
 wire replace_timing=changed && timing_word;
 assign timing_restart=replace_timing;
 assign read_word=words[read_index];
 // Export the transaction that actually changes the displayed bank, before
 // its committing clock edge, instead of watching the bank after the fact.
 // The reset marker is independent of word equality: an identical reset must
 // still restart the output-domain phase. If old and restarted VBlank both
 // occur on this edge, the same post-write snapshot that wins the bank wins
 // the transfer. A CDC owner must accept each asserted transaction; this
 // interface cannot stall the system-side latch and does not assume a queue
 // can absorb arbitrary source traffic or a stopped output clock.
 assign display_update_reset=soft_reset;
 assign display_update_valid=reset_n && (bootstrap || soft_reset ||
  (vblank_after_restart ? |post_write_dirty : vblank_before_write!=0 && |display_dirty));
 always @* begin
  post_write_dirty=display_dirty;
  if(write_valid)post_write_dirty[write_index]=write_word!=display[write_index];
 end
 genvar i;
 generate for(i=0;i<22;i=i+1) begin: output_words
  assign programmed_words[i*32+:32]=words[i];
  assign displayed_words[i*32+:32]=display[i];
  assign display_update_words[i*32+:32]=soft_reset ? RESET_WORDS[i*32+:32] :
   vblank_after_restart ? (write_valid && write_index==i ? write_word : words[i]) :
   vblank_before_write!=0 ? words[i] : display[i];
 end endgenerate
 gfx_pcrtc_beam_phase #(.SYSTEM_CLOCK(1)) beam(
  .clk(clk),.reset_n(reset_n),.soft_reset(soft_reset),.cfg_valid(bootstrap || replace_timing),
  .cfg_smode1(soft_reset ? RESET_WORDS[12*32+:32] : replace_timing && write_index==12 ? write_word : words[12]),
  .cfg_smode1_high(soft_reset ? RESET_WORDS[13*32+:32] : replace_timing && write_index==13 ? write_word : words[13]),
  .cfg_synch1_low(soft_reset ? RESET_WORDS[16*32+:32] : replace_timing && write_index==16 ? write_word : words[16]),
  .cfg_synch1_high(soft_reset ? RESET_WORDS[17*32+:32] : replace_timing && write_index==17 ? write_word : words[17]),
  .cfg_synch2_low(soft_reset ? RESET_WORDS[18*32+:32] : replace_timing && write_index==18 ? write_word : words[18]),
  .cfg_syncv_low(soft_reset ? RESET_WORDS[20*32+:32] : replace_timing && write_index==20 ? write_word : words[20]),
  .cfg_syncv_high(soft_reset ? RESET_WORDS[21*32+:32] : replace_timing && write_index==21 ? write_word : words[21]),
  .running(running),.period_numerator(period_numerator),.phase(phase),.increment(increment),
  .total_half_lines(total_half_lines),.field_half_line(field_half_line),
  .active_half_lines(active_half_lines),.vsync_half_line(vsync_half_line),
  .elapsed_half_lines(elapsed_half_lines),.elapsed_fields(elapsed_fields),
  .crossed_half_lines(crossed_half_lines),.crossed_fields(crossed_fields),
  .crossed_vblank_entries(crossed_vblank_entries),.crossed_vsyncs(crossed_vsyncs),
  .vblank_before_write(vblank_before_write),.vblank_after_restart(vblank_after_restart),
  .hsync_before_write(hsync_before_write),.vsync_before_write(vsync_before_write),.vsync_after_restart(vsync_after_restart),.field_before_write(field_before_write),
  .vblank_active(vblank_active),.field(field)
 );
 integer n;
 always @(posedge clk or negedge reset_n) begin
  if(!reset_n) begin
   bootstrap<=1;display_dirty<=0;
   for(n=0;n<22;n=n+1) begin
    words[n]<=RESET_WORDS[n*32+:32];display[n]<=RESET_WORDS[n*32+:32];
   end
  end else if(soft_reset) begin
   bootstrap<=0;display_dirty<=0;
   for(n=0;n<22;n=n+1) begin
    words[n]<=RESET_WORDS[n*32+:32];display[n]<=RESET_WORDS[n*32+:32];
   end
  end else begin
   bootstrap<=0;
   if(write_valid) words[write_index]<=write_word;
   if(vblank_after_restart) begin
    display_dirty<=0;
    for(n=0;n<22;n=n+1) display[n]<=write_valid && write_index==n ? write_word : words[n];
   end else if(vblank_before_write!=0) begin
    display_dirty<=0;
    if(write_valid)display_dirty[write_index]<=write_word!=words[write_index];
    for(n=0;n<22;n=n+1) display[n]<=words[n];
   end else if(write_valid)display_dirty[write_index]<=write_word!=display[write_index];
  end
 end
endmodule
