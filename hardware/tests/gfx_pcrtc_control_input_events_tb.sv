`timescale 1ns/1ps
// Test the public control boundary against existing machine-owner vectors.
// Those vectors explicitly service the beam before and after each write; they
// do not exercise the actual CPU scheduler's atomic-instruction boundary.
// The count retains old-beam multiplicity and the separate bit identifies the
// later restart event; a display update is not a substitute for either event.
module gfx_pcrtc_control_input_events_tb;
 reg clk=0; always #5 clk=~clk;
 reg reset_n=0,valid=0; reg [4:0] index=0; reg [31:0] word=0;
 wire [7:0] pre_count; wire post_event,update_valid,update_reset,reset_action;
 wire [703:0] displayed,update_words;
 gfx_pcrtc_control dut(
  .clk(clk),.reset_n(reset_n),.access_valid(valid),.access_write(1'b1),
  .access_index(index),.access_wdata(word),.access_rdata(),.other_events(5'd0),
  .irq_raise(),.gpu_queue_action(),.gpu_reset_action(reset_action),.programmed_words(),
  .displayed_words(displayed),.display_update_valid(update_valid),
  .display_update_reset(update_reset),.display_update_words(update_words),.timing_restart(),
  .running(),.vblank_active(),.field(),.vblank_before_write(pre_count),
  .vblank_after_restart(post_event),.field_half_line(),.csr_word(),.imr_word());
 integer beam_file,latch_file,total,latch_total,n,i,rc;
 integer old_count=0,new_count=0,both_count=0,multi_count=0,unchanged_count=0;
 reg [31:0] v,idx,data,restart,running,line,blank,field,readback,events,vsync,phase;
 reg [31:0] v2,idx2,data2,pre,post,expected[0:21];
 task automatic write_config(input [4:0] ix,input [31:0] w);
  begin @(negedge clk);valid=1;index=ix;word=w;@(negedge clk);valid=0;end
 endtask
 initial begin
  beam_file=$fopen("build/tests/gfx-pcrtc-system-beam-vectors.txt","r");
  latch_file=$fopen("build/tests/gfx-pcrtc-display-latch-vectors.txt","r");
  if(!beam_file || !latch_file)$fatal(1,"missing existing machine-owner vectors");
  rc=$fscanf(beam_file,"%d\n",total); if(rc!=1)$fatal(1,"beam header");
  rc=$fscanf(latch_file,"%d\n",latch_total); if(rc!=1 || latch_total!=total)$fatal(1,"latch header");
  repeat(2)@(negedge clk);reset_n=1;@(negedge clk);#1;
  for(n=0;n<total;n=n+1)begin
   rc=$fscanf(beam_file,"%h %h %h %h %h %h %h %h %h %h %h %h\n",v,idx,data,restart,running,line,blank,field,readback,events,vsync,phase);
   if(rc!=12)$fatal(1,"beam vector %0d",n);
   rc=$fscanf(latch_file,"%h %h %h %h %h",v2,idx2,data2,pre,post);
   if(rc!=5 || v!==v2 || idx!==idx2 || data!==data2)$fatal(1,"trace mismatch %0d",n);
   for(i=0;i<22;i=i+1)begin rc=$fscanf(latch_file,"%h",expected[i]);if(rc!=1)$fatal(1,"latch word");end
   valid=v[0];index=idx[4:0];word=data;#1;
   if((pre_count!=0)!==pre[0] || post_event!==post[0] || pre_count+post_event!==events)
    $fatal(1,"event mismatch cycle %0d pre=%0d post=%b expected=%0d/%0d/%0d",n+1,pre_count,post_event,pre,post,events);
   old_count=old_count+(pre_count!=0);new_count=new_count+post_event;
   both_count=both_count+(pre_count!=0 && post_event);
   multi_count=multi_count+(pre_count>1);unchanged_count=unchanged_count+((pre_count!=0 || post_event) && !update_valid);
   @(negedge clk);#1;
   for(i=0;i<22;i=i+1)if(displayed[i*32+:32]!==expected[i])$fatal(1,"presentation mismatch cycle %0d word %0d",n+1,i);
  end
  if(!old_count || !new_count || !both_count || !multi_count || !unchanged_count)$fatal(1,"missing event coverage");
  // A CSR RESET and an old-beam event can coincide. This captures the raw
  // producer boundary only; it does not decide whether INPUT accepts that
  // event or prove an IRQ ordering on the reset edge.
  valid=0;@(negedge clk);reset_n=0;@(negedge clk);reset_n=1;
  write_config(12,(127<<3)|1|(1<<13));write_config(16,1);write_config(17,0);
  write_config(18,0);write_config(13,0);write_config(20,1);write_config(21,0);
  @(negedge clk);valid=1;index=22;word=32'h200;#1;
  if(pre_count==0 || post_event!==0 || !reset_action || !update_reset || !update_valid)
   $fatal(1,"missing simultaneous old VBlank and PCRTC reset");
  @(negedge clk);#1;
  if(displayed!==update_words)$fatal(1,"reset display bank was not installed");
  valid=0;
  $display("PASS %0d cycles: pre=%0d post=%0d both=%0d multiple=%0d events-without-display-change=%0d; CSR reset coincidence exposed",total,old_count,new_count,both_count,multi_count,unchanged_count);
  $finish;
 end
 initial begin #1000000;$fatal(1,"timeout");end
endmodule
