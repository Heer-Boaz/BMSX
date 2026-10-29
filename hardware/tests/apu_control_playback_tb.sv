`timescale 1ns/1ps
// Real control + PLAY-rate + cursor/mixer/end path. Only the binder commit,
// sample-memory response and final output consumer are fixtures. The test
// does not claim BADP binding or deadline closure.
module apu_control_playback_tb;
 reg clk=0;always #5 clk=~clk;
 reg reset_n=0,iv=0,iw=0;reg [4:0] ii=0;reg [31:0] id=0;
 wire ir,iv_rsp;wire [31:0] ir_data;
 wire bv,brspready;wire [671:0] bp;wire bc;
 wire cv,cr;wire [31:0] cc;wire [3:0] cs;wire [671:0] cp;
 wire lv;wire [31:0] sample_seq,done_seq;wire [63:0] pending;
 wire frame_valid,frame_ready,frame_done,frame_tick;
 wire end_valid,end_ready;wire [3:0] end_slot;
 wire [31:0] event_kind,event_slot,event_address,event_seq,irq;
 wire [3:0] fetch_slot;wire [671:0] fetch_params;wire [15:0] active,render;
 wire load_valid,load_ready,bind_commit,load_reset,filter_clear;
 wire [3:0] load_slot;wire signed [63:0] cursor,step;wire signed [31:0] rem,step_rem;
 wire [31:0] frames,loop_start,loop_end;
 reg bind_allow=0,output_ready=0;wire output_valid;wire signed [15:0] left,right;
 wire pcm_req;wire [31:0] pcm_address;reg pcm_rsp=0;integer count_load=0,count_bind=0,count_end=0,count_irq=0;
 reg stalled_play=0;reg [3:0] stalled_slot;reg [671:0] stalled_parameters;
 apu_control_integration control(.clk(clk),.reset_n(reset_n),
  .ingress_valid(iv),.ingress_write(iw),.ingress_index(ii),.ingress_wdata(id),.ingress_ready(ir),.ingress_response(iv_rsp),.ingress_rdata(ir_data),
  .ingress_fault(),.ingress_fault_detail(),.selected_valid(1'b0),.selected_write(1'b0),.selected_index(5'd0),.selected_wdata(32'd0),
  .selected_ready(),.selected_response(),.selected_rdata(),.selected_cartridge(1'b0),
  .bind_valid(bv),.bind_ready(1'b1),.bind_parameters(bp),.bind_cartridge(bc),.bind_rsp_valid(bv),.bind_rsp_ready(brspready),.bind_rsp_ok(1'b1),
  .cmd_effect_valid(cv),.cmd_effect_ready(cr),.cmd_effect_command(cc),.cmd_effect_slot(cs),.cmd_effect_parameters(cp),.cmd_effect_phase(),.cmd_effect_cartridge(),
  .live_effect_valid(lv),.live_effect_ready(1'b0),.live_effect_success(),.live_effect_source_replace(),.live_effect_slot(),.live_effect_index(),.live_effect_word(),.live_effect_parameters(),.live_effect_cartridge(),
  .cmd_fault_valid(),.cmd_fault_ready(1'b1),.cmd_fault_code(),.cmd_fault_detail(),.live_fault_valid(),.live_fault_ready(1'b1),.live_fault_code(),.live_fault_detail(),
  .snapshot_overflow(1'b0),.snapshot_history_lost(),.frame_valid(frame_valid),.frame_ready(frame_ready),.frame_done(frame_done),.frame_tick(frame_tick),
  .sample_sequence(sample_seq),.completed_sequence(done_seq),.pending_frames(pending),.end_valid(end_valid),.end_ready(end_ready),.end_slot(end_slot),
  .event_kind(event_kind),.event_slot(event_slot),.event_source_address(event_address),.event_sequence(event_seq),.user_irq_raise(irq),
  .fetch_slot(fetch_slot),.fetch_parameters(fetch_params),.fetch_active(),.fetch_cartridge(),.active_mask(active),.render_mask(render),.queued_count());
 apu_play_start play(.clk(clk),.reset_n(reset_n),.play_valid(cv && cc==1),.play_ready(cr),.play_slot(cs),.play_parameters(cp),
  .bind_commit_ready(bind_allow),.bind_commit_valid(bind_commit),.load_valid(load_valid),.load_ready(load_ready),.load_slot(load_slot),
  .load_cursor_q16(cursor),.load_step_q16(step),.load_remainder(rem),.load_step_remainder(step_rem),.load_frames(frames),
  .load_loop_start(loop_start),.load_loop_end(loop_end),.load_decoder_reset(load_reset),.load_filter_clear(filter_clear));
 apu_playback_frame playback(.clk(clk),.reset_n(reset_n),.frame_valid(frame_valid),.frame_ready(frame_ready),.frame_done(frame_done),
  .render_mask(render),.fetch_slot(fetch_slot),.fetch_parameters(fetch_params),.load_valid(load_valid),.load_authorized(1'b1),.load_ready(load_ready),.load_slot(load_slot),
  .load_cursor_q16(cursor),.load_step_q16(step),.load_remainder(rem),.load_step_remainder(step_rem),.load_frames(frames),.load_loop_start(loop_start),.load_loop_end(loop_end),
  .load_decoder_reset(load_reset),.load_filter_clear(filter_clear),.bind_valid(1'b0),.bind_voice(4'd0),.bind_source_base(19'd0),.bind_source_bytes(20'd0),
  .bind_data_offset(19'd0),.bind_frames(32'd0),.bind_channels(2'd0),.bind_seek_base(19'd0),.bind_seek_count(32'd0),.bind_loop_start(32'd0),.bind_loop_end(32'd0),
  .source_write_valid(1'b0),.source_write_word(17'd0),.source_write_words(5'd0),.epoch_active(1'b0),.epoch_change_valid(1'b0),.epoch_change_first(17'd0),.epoch_change_last(17'd0),.decoder_epoch_begin(),
  .memory_req_valid(),.memory_req_ready(1'b0),.memory_req_word_address(),.memory_rsp_valid(1'b0),.memory_rsp_word(32'd0),
  .pcm_memory_req_valid(pcm_req),.pcm_memory_req_ready(1'b1),.pcm_memory_req_address(pcm_address),.pcm_memory_rsp_valid(pcm_rsp),.pcm_memory_rsp_word(32'h000003e8),
  .output_valid(output_valid),.output_ready(output_ready),.output_left(left),.output_right(right),.end_valid(end_valid),.end_ready(end_ready),.end_slot(end_slot),.busy());
 always @(posedge clk) begin
  pcm_rsp<=pcm_req;
  if(!reset_n) stalled_play<=0;
  else begin
   if(stalled_play && (!cv || cc!==1 || cs!==stalled_slot || cp!==stalled_parameters))
    $fatal(1,"PLAY action changed while stalled");
   stalled_play<=cv && cc==1 && !cr;
   if(cv && cc==1 && !cr) begin stalled_slot<=cs;stalled_parameters<=cp;end
   if(load_valid && load_ready) begin
    count_load=count_load+1;
    if(!cr || !bind_commit || step!==64'sd65536 || step_rem!==0 || cursor!==0 || frames!==1) $fatal(1,"PLAY setup not atomic or rate wrong");
   end
   if(bind_commit)count_bind=count_bind+1;
   if(end_valid && end_ready)count_end=count_end+1;
   if(irq==32'h20)count_irq=count_irq+1;
   if(frame_done && end_valid)$fatal(1,"frame retired before end");
  end
 end
 task automatic wr(input [4:0] index,input [31:0] value);
  begin @(negedge clk);iv=1;iw=1;ii=index;id=value;do @(posedge clk);while(!ir);@(negedge clk);iv=0;iw=0;end
 endtask
 task automatic play_cmd(input [31:0] address);
  begin wr(0,address);wr(1,2);wr(2,44100);wr(3,1);wr(4,16);wr(5,1);wr(10,2);wr(21,1);end
 endtask
 initial begin
  repeat(3)@(negedge clk);reset_n=1;
  play_cmd(32'h40000190);wait(cv);wait(play.rate_valid);
  // An already accepted PLAY keeps its reservation through the next frame
  // edge; the real cursor load must still make progress when released.
  wait(frame_tick);@(posedge clk);@(negedge clk);
  if(active!==0 || count_load!=0 || count_bind!=0 || cr || pending!=1 || frame_valid)
   $fatal(1,"stalled binder partially installed PLAY or lost reservation");
  @(negedge clk);bind_allow=1;wait(cr);@(negedge clk);bind_allow=0;
  if(!active[2] || count_load!=1 || count_bind!=1)$fatal(1,"PLAY did not install");
  wait(output_valid);@(negedge clk);
  if({right,left}!==32'h03e803e8 || end_valid || event_seq!=0)$fatal(1,"first output or early end %h",{right,left});
  // Queueing a new same-slot PLAY cannot pass an unfinished frame.
  fork
   begin play_cmd(32'h40000200);end
   begin repeat(10)@(negedge clk);if(!output_valid || end_valid || frame_done || !active[2])$fatal(1,"held output lost frame");
    output_ready=1;@(negedge clk);output_ready=0;end
  join
  wait(event_seq==1);if(event_kind!==1 || event_slot!==2 || event_address!==32'h40000190)$fatal(1,"old ending event");
  wait(cv && cc==1);wait(play.rate_valid);@(negedge clk);bind_allow=1;wait(cr);@(negedge clk);bind_allow=0;
  if(!active[2] || count_load!=2 || count_bind!=2 || count_end!=1)$fatal(1,"new PLAY after ending");
  wait(output_valid);@(negedge clk);if({right,left}!==32'h03e803e8)$fatal(1,"second output");
  output_ready=1;@(negedge clk);output_ready=0;wait(event_seq==2);repeat(3)@(negedge clk);
  if(event_address!==32'h40000200 || count_end!=2 || count_irq!=2 || active!=0)$fatal(1,"second ending or IRQ");
  $display("PASS real control + rate + cursor + PCM mixer: atomic PLAY, stalled bind, output/end/frame ordering, same-slot replay and IRQ; binder/memory remain fixtures");$finish;
 end
 initial begin #3000000;$fatal(1,"watchdog active=%h frame=%b output=%b seq=%0d done=%0d cv=%b rate=%b",active,frame_valid,output_valid,sample_seq,done_seq,cv,play.rate_valid);end
endmodule
