`timescale 1ns/1ps
// Experimental ordered transfer of *changed* latched words, not a complete
// DAC interface. The source uses a four-system-clock minimum write interval;
// the video consumer accepts one entry on every 13.5 MHz edge. A full FIFO is
// a failed assumption, not an invitation to stall the actual VBlank latch or
// discard a state. Field, display phase, epoch alignment and reset handoff are
// intentionally outside this test. Both source and sink share power reset.
module gfx_pcrtc_display_transport_tb;
 reg sysclk=0,vidclk=0,reset_n=0,vid_ready=1;
 always #14.763 sysclk=~sysclk;
 integer video_phase=0,stall_test=0;
 initial begin
  if($value$plusargs("phase=%d",video_phase)) begin end
  if($test$plusargs("stall")) stall_test=1;
  #(video_phase * 1.0);
  forever #37.037 vidclk=~vidclk;
 end
 reg wvalid=0;reg [4:0] windex=0;reg [31:0] wword=0;
 wire [703:0] programmed,displayed;
 wire [7:0] vblank_before;wire vblank_after;
 gfx_pcrtc_system_beam beam(.clk(sysclk),.reset_n(reset_n),.soft_reset(1'b0),
  .write_valid(wvalid),.write_index(windex),.write_word(wword),.read_index(5'd0),.read_word(),
  .programmed_words(programmed),.displayed_words(displayed),.vblank_before_write(vblank_before),
  .vblank_after_restart(vblank_after),.hsync_before_write(),.vsync_before_write(),.vsync_after_restart(),
  .field_before_write(),.timing_restart(),.running(),.period_numerator(),.phase(),.increment(),
  .total_half_lines(),.field_half_line(),.active_half_lines(),.vsync_half_line(),.elapsed_half_lines(),
  .elapsed_fields(),.crossed_half_lines(),.crossed_fields(),.crossed_vblank_entries(),
  .crossed_vsyncs(),.vblank_active(),.field());
 reg [703:0] published=0;
 wire src_valid=displayed!=published;
 wire src_ready,dst_valid;wire [703:0] dst_data;
 async_fifo #(.WIDTH(704),.ADDR_BITS(2)) fifo(.reset_n(reset_n),.w_clk(sysclk),
  .w_valid(src_valid),.w_ready(src_ready),.w_data(displayed),.r_clk(vidclk),
  .r_valid(dst_valid),.r_ready(vid_ready),.r_data(dst_data));
 reg [703:0] expected[0:255],first_blocked=0;integer accepted=0,received=0,pmode_sequence=0;
 reg saw_blocked=0,saw_overwrite=0;
 always @(posedge sysclk) begin
  if(!reset_n) published<=0;
  else if(src_valid) begin
   if(!src_ready && accepted!=0) begin
    if(!stall_test) $fatal(1,"state offered while FIFO not ready");
    if(!saw_blocked) begin saw_blocked=1;first_blocked=displayed;end
    else if(displayed!=first_blocked) saw_overwrite=1;
   end
   if(src_ready) begin
    expected[accepted]=displayed;accepted=accepted+1;published<=displayed;
   end
  end
 end
 always @(posedge vidclk) if(reset_n && dst_valid && vid_ready) begin
  if(received>=accepted || dst_data!==expected[received])
   $fatal(1,"incoherent/out of order state %0d/%0d",received,accepted);
  if(dst_data[31:0]!=0) begin
   if(dst_data[31:0]!==pmode_sequence+1) $fatal(1,"missed PMODE state: %0d after %0d",dst_data[31:0],pmode_sequence);
   pmode_sequence=pmode_sequence+1;
  end
  received=received+1;
 end
 task automatic writeword(input [4:0] idx,input [31:0] value);
  begin @(negedge sysclk);wvalid=1;windex=idx;wword=value;
   @(negedge sysclk);wvalid=0;repeat(2)@(negedge sysclk);
  end
 endtask
 integer i;
 initial begin
  repeat(4)@(negedge sysclk);reset_n=1;repeat(5)@(negedge sysclk);
  // Minimum positive horizontal period and high LC yield many VBlank
  // crossings per SYS edge; successive distinct register words still enter
  // no faster than the assumed packet admission interval.
  writeword(12,32'h000003f9);writeword(13,0);writeword(16,1);
  writeword(17,0);writeword(18,0);writeword(20,0);writeword(21,32'h00200400);
  repeat(4)@(negedge sysclk);
  if(stall_test)begin @(negedge vidclk);vid_ready=0;end
  for(i=1;i<=128;i=i+1)writeword(0,i);
  repeat(30)@(negedge sysclk);
  if(stall_test) begin
   if(!saw_blocked || !saw_overwrite)$fatal(1,"expected full FIFO and changing display snapshot");
   $display("PASS observed FIFO-full producer hold violation with a stopped sink; raw display words cannot be wired as lossless ready/valid without further architecture");
   $finish;
  end
  if(accepted!=received || accepted<128 || pmode_sequence!=128 || displayed[31:0]!=128)
   $fatal(1,"incomplete transferred snapshots %0d accepted, %0d received",accepted,received);
  $display("PASS coherent changed PCRTC display words through 4-entry async FIFO: %0d snapshots; 4 SYS-clock source spacing and always-ready 13.5 MHz sink; no field/phase or arbitrary-stall guarantee",received);
  $finish;
 end
 initial begin #1000000;$fatal(1,"timeout");end
endmodule
