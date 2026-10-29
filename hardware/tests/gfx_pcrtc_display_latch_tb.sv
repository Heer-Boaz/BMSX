`timescale 1ns/1ps
// Actual system-clock timing, programmed words, beam and display latch.
module gfx_pcrtc_display_latch_tb;
 reg clk=0;always #5 clk=~clk;
 reg reset_n=0,write_valid=0;reg [4:0] write_index=0;reg [31:0] write_word=0;
 wire [703:0] shown,programmed;wire [7:0] pre_events;wire post_event;
 gfx_pcrtc_system_beam dut(.clk(clk),.reset_n(reset_n),.soft_reset(1'b0),.write_valid(write_valid),.write_index(write_index),.write_word(write_word),
  .read_index(5'd0),.read_word(),.programmed_words(programmed),.displayed_words(shown),.vblank_before_write(pre_events),.vblank_after_restart(post_event),
  .timing_restart(),.running(),.period_numerator(),.phase(),.increment(),.total_half_lines(),.field_half_line(),.active_half_lines(),.vsync_half_line(),
  .elapsed_half_lines(),.elapsed_fields(),.crossed_half_lines(),.crossed_fields(),.crossed_vblank_entries(),.crossed_vsyncs(),.vblank_active(),.field());
 integer file,count,n,rc,i,old_count=0,new_count=0,both_count=0;reg [31:0] valid,index,word,pre,post;reg [31:0] expected[0:21];
 initial begin
  file=$fopen("build/tests/gfx-pcrtc-display-latch-vectors.txt","r");if(!file)$fatal(1,"missing vectors");
  rc=$fscanf(file,"%d\n",count);repeat(2)@(negedge clk);#1;
  if(shown!==programmed || pre_events!=0 || post_event!=0)$fatal(1,"reset display/event state");
  reset_n=1;@(negedge clk);#1;
  for(n=0;n<count;n=n+1)begin
   rc=$fscanf(file,"%h %h %h %h %h",valid,index,word,pre,post);if(rc!=5)$fatal(1,"vector header");
   for(i=0;i<22;i=i+1)begin rc=$fscanf(file,"%h",expected[i]);if(rc!=1)$fatal(1,"vector word");end
   write_valid=valid[0];write_index=index[4:0];write_word=word;#1;
   if((pre_events!=0)!==pre[0] || post_event!==post[0])$fatal(1,"event mismatch cycle %d pre %d/%d post %d/%d",n+1,pre_events,pre,post_event,post);
   old_count=old_count+pre;new_count=new_count+post;both_count=both_count+(pre&&post);
   @(negedge clk);#1;
   for(i=0;i<22;i=i+1)if(shown[i*32+:32]!==expected[i])$fatal(1,"cycle %d word %d actual %h expected %h",n+1,i,shown[i*32+:32],expected[i]);
  end
  if(!old_count||!new_count||!both_count)$fatal(1,"missing latch coverage");
  @(negedge clk);reset_n=0;#1;
  if(shown!==programmed || pre_events!=0 || post_event!=0)$fatal(1,"warm reset display/event state");
  $display("PASS %0d pre/post-write VBlank cycles with all 22 displayed words; pre=%0d post=%0d both=%0d",count,old_count,new_count,both_count);$finish;
 end
 initial begin #1000000;$fatal(1,"timeout");end
endmodule
