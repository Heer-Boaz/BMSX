`timescale 1ns/1ps
// Real control + PLAY-rate + cursor/mixer/end path with local source binder.
// Default variant uses a sample-memory response and output-consumer fixture.
// APU_FULL_SERIAL_TEST replaces these with timed SRAM pins and an I2S output; its
// setup writes sample RAM through the store owner before releasing APU reset.
// Neither variant models ROM binding or proves all playback deadlines.
// Production reference: MAME C140 separates voice gain/mix from output stream:
// https://github.com/mamedev/mame/blob/master/src/devices/sound/c140.cpp
module apu_control_sample_bind_tb;
`ifdef APU_FULL_SERIAL_TEST
 localparam real PERIOD=1000000000.0/33868800.0;
 reg clk=0;always #(PERIOD/2.0) clk=~clk;
`else
 reg clk=0;always #5 clk=~clk;
`endif
 reg reset_n=0;
`ifdef APU_SYS_SERIAL_TEST
 wire iv,iw;wire [4:0] ii;wire [31:0] id;
`else
 reg iv=0,iw=0;reg [4:0] ii=0;reg [31:0] id=0;
`endif
 wire ir,iv_rsp;wire [31:0] ir_data;
`ifdef APU_SYS_SERIAL_TEST
 // A real SYS transport and the APU control owner's sole ingress.
 reg bus_req_valid=0;reg [31:0] bus_req_addr=0,bus_req_data=0;
 wire bus_req_ready,bus_rsp_valid,bus_rsp_timeout;wire [31:0] bus_rsp_data,bus_rsp_fault;
 wire [31:0] master_out,endpoint_out;wire master_oe,endpoint_oe,as_n,rd_n,wr_n,ready_low;
 wire [3:0] be_n;tri [31:0] ad;tri1 ready_n;
 assign ad=master_oe ? master_out : 32'bz;
 assign ad=endpoint_oe ? endpoint_out : 32'bz;
 assign ready_n=ready_low ? 1'b0 : 1'bz;
 system_bus_master bus(.clk(clk),.reset_n(reset_n),.req_valid(bus_req_valid),.req_ready(bus_req_ready),
  .req_write(1'b1),.req_addr(bus_req_addr),.req_wdata(bus_req_data),.req_be_n(4'b0000),
  .req_header_be_n(4'hf),.bus_busy(),.req_meta(32'd0),.req_data_timeout_enable(1'b0),.req_data_wait_last(18'd0),
  .rsp_valid(bus_rsp_valid),.rsp_rdata(bus_rsp_data),.rsp_fault_code(bus_rsp_fault),.rsp_timeout(bus_rsp_timeout),
  .bus_ad_in(ad),.bus_ad_out(master_out),.bus_ad_oe(master_oe),.bus_as_n(as_n),.bus_rd_n(rd_n),
  .bus_wr_n(wr_n),.bus_be_n(be_n),.bus_ready_n(ready_n));
 always @(posedge clk) if(reset_n && master_oe && endpoint_oe) $fatal(1,"SYS bus contention");
`endif
 wire bv,brspready;wire [671:0] bp;wire bc;
 wire cv,cr;wire [31:0] cc;wire [3:0] cs;wire [671:0] cp;
 wire lv,cmd_fault;wire [31:0] cmd_fault_code,cmd_fault_detail;wire [31:0] sample_seq,done_seq;wire [63:0] pending;
 wire frame_valid,frame_ready,frame_done,frame_tick;
 wire end_valid,end_ready;wire [3:0] end_slot;
 wire [31:0] event_kind,event_slot,event_address,event_seq,irq;
 wire [3:0] fetch_slot;wire [671:0] fetch_params;wire [15:0] active,render;
 wire load_valid,load_ready,bind_commit,load_reset,filter_clear;
 wire real_bind_ready,real_bind_rsp,real_bind_ok,real_bind_commit_ready,pub_valid,pub_cart;
 wire [671:0] pub_parameters;wire [1:0] pub_region;
 apu_source_bind source_bind(.clk(clk),.reset_n(reset_n),.bind_valid(bv),.bind_ready(real_bind_ready),
  .bind_parameters(bp),.bind_cartridge(bc),.bind_rsp_valid(real_bind_rsp),.bind_rsp_ready(brspready),.bind_rsp_ok(real_bind_ok),
  .external_valid(),.external_ready(1'b0),.external_parameters(),.external_cartridge(),.external_region(),
  .external_rsp_valid(1'b0),.external_rsp_ready(),.external_rsp_ok(1'b0),.commit_ready(real_bind_commit_ready),
  .commit_valid(bind_commit),.published_valid(pub_valid),.published_parameters(pub_parameters),.published_cartridge(pub_cart),.published_region(pub_region));
 wire [3:0] load_slot;wire signed [63:0] cursor,step;wire signed [31:0] rem,step_rem;
 wire [31:0] frames,loop_start,loop_end;
 reg bind_allow=0;wire output_valid;wire signed [15:0] left,right;
 wire pcm_req;wire [31:0] pcm_address;integer count_load=0,count_bind=0,count_end=0,count_irq=0;
`ifdef APU_FULL_SERIAL_TEST
 wire output_ready,pcm_rsp,pcm_ready;wire [31:0] pcm_word;
`else
 reg output_ready=0,pcm_rsp=0;wire pcm_ready=1'b1;wire [31:0] pcm_word=32'h000003e8;
`endif
 reg stalled_play=0;reg [3:0] stalled_slot;reg [671:0] stalled_parameters;
`ifdef APU_SYS_SERIAL_TEST
 apu_sys_control control(.clk(clk),.reset_n(reset_n),.cs_apu_n(1'b0),.bus_ad_in(ad),
  .bus_as_n(as_n),.bus_rd_n(rd_n),.bus_wr_n(wr_n),.bus_be_n(be_n),.bus_ad_out(endpoint_out),
  .bus_ad_oe(endpoint_oe),.bus_ready_drive_low(ready_low),
`else
 apu_control_integration control(.clk(clk),.reset_n(reset_n),
  .ingress_valid(iv),.ingress_write(iw),.ingress_index(ii),.ingress_wdata(id),.ingress_ready(ir),.ingress_response(iv_rsp),.ingress_rdata(ir_data),
`endif
  .ingress_fault(),.ingress_fault_detail(),.selected_valid(1'b0),.selected_write(1'b0),.selected_index(5'd0),.selected_wdata(32'd0),
  .selected_ready(),.selected_response(),.selected_rdata(),.selected_cartridge(1'b0),
  .bind_valid(bv),.bind_ready(real_bind_ready),.bind_parameters(bp),.bind_cartridge(bc),.bind_rsp_valid(real_bind_rsp),.bind_rsp_ready(brspready),.bind_rsp_ok(real_bind_ok),
  .cmd_effect_valid(cv),.cmd_effect_ready(cr),.cmd_effect_command(cc),.cmd_effect_slot(cs),.cmd_effect_parameters(cp),.cmd_effect_phase(),.cmd_effect_cartridge(),
  .live_effect_valid(lv),.live_effect_ready(1'b0),.live_effect_success(),.live_effect_source_replace(),.live_effect_slot(),.live_effect_index(),.live_effect_word(),.live_effect_parameters(),.live_effect_cartridge(),
  .cmd_fault_valid(cmd_fault),.cmd_fault_ready(1'b1),.cmd_fault_code(cmd_fault_code),.cmd_fault_detail(cmd_fault_detail),.live_fault_valid(),.live_fault_ready(1'b1),.live_fault_code(),.live_fault_detail(),
  .snapshot_overflow(1'b0),.snapshot_history_lost(),.frame_valid(frame_valid),.frame_ready(frame_ready),.frame_done(frame_done),.frame_tick(frame_tick),
  .sample_sequence(sample_seq),.completed_sequence(done_seq),.pending_frames(pending),.end_valid(end_valid),.end_ready(end_ready),.end_slot(end_slot),
  .event_kind(event_kind),.event_slot(event_slot),.event_source_address(event_address),.event_sequence(event_seq),.user_irq_raise(irq),
  .fetch_slot(fetch_slot),.fetch_parameters(fetch_params),.fetch_active(),.fetch_cartridge(),.active_mask(active),.render_mask(render),.queued_count());
 apu_play_start play(.clk(clk),.reset_n(reset_n),.play_valid(cv && cc==1),.play_ready(cr),.play_slot(cs),.play_parameters(cp),
  .bind_commit_ready(bind_allow && real_bind_commit_ready),.bind_commit_valid(bind_commit),.load_valid(load_valid),.load_ready(load_ready),.load_slot(load_slot),
  .load_cursor_q16(cursor),.load_step_q16(step),.load_remainder(rem),.load_step_remainder(step_rem),.load_frames(frames),
  .load_loop_start(loop_start),.load_loop_end(loop_end),.load_decoder_reset(load_reset),.load_filter_clear(filter_clear));
 apu_playback_frame playback(.clk(clk),.reset_n(reset_n),.frame_valid(frame_valid),.frame_ready(frame_ready),.frame_done(frame_done),
  .render_mask(render),.fetch_slot(fetch_slot),.fetch_parameters(fetch_params),.load_valid(load_valid),.load_authorized(1'b1),.load_ready(load_ready),.load_slot(load_slot),
  .load_cursor_q16(cursor),.load_step_q16(step),.load_remainder(rem),.load_step_remainder(step_rem),.load_frames(frames),.load_loop_start(loop_start),.load_loop_end(loop_end),
  .load_decoder_reset(load_reset),.load_filter_clear(filter_clear),.bind_valid(1'b0),.bind_voice(4'd0),.bind_source_base(19'd0),.bind_source_bytes(20'd0),
  .bind_data_offset(19'd0),.bind_frames(32'd0),.bind_channels(2'd0),.bind_seek_base(19'd0),.bind_seek_count(32'd0),.bind_loop_start(32'd0),.bind_loop_end(32'd0),
  .source_write_valid(1'b0),.source_write_word(17'd0),.source_write_words(5'd0),.epoch_active(1'b0),.epoch_change_valid(1'b0),.epoch_change_first(17'd0),.epoch_change_last(17'd0),.decoder_epoch_begin(),
  .memory_req_valid(),.memory_req_ready(1'b0),.memory_req_word_address(),.memory_rsp_valid(1'b0),.memory_rsp_word(32'd0),
  .pcm_memory_req_valid(pcm_req),.pcm_memory_req_ready(pcm_ready),.pcm_memory_req_address(pcm_address),.pcm_memory_rsp_valid(pcm_rsp),.pcm_memory_rsp_word(pcm_word),
  .output_valid(output_valid),.output_ready(output_ready),.output_left(left),.output_right(right),.end_valid(end_valid),.end_ready(end_ready),.end_slot(end_slot),.busy());
`ifdef APU_FULL_SERIAL_TEST
 reg store_reset_n=0,init_mode=1,init_valid=0;
 wire store_ready,store_rsp,memory_ready;wire [31:0] store_data;
 wire [17:0] mem_address;tri [15:0] mem_data;wire mem_ce_n,mem_oe_n,mem_we_n;wire [1:0] mem_be_n;
 apu_sample_store store(.clk(clk),.reset_n(store_reset_n),.power_reset_n(1'b1),
  .req_valid(init_mode ? init_valid : pcm_req),.req_ready(store_ready),.req_write(init_mode),
  .req_word_address(init_mode ? 17'd100 : pcm_address[18:2]),.req_wdata(32'h000003e8),.req_be_n(4'b0000),
  .rsp_valid(store_rsp),.rsp_rdata(store_data),.memory_ready(memory_ready),.mem_address(mem_address),.mem_data(mem_data),
  .mem_ce_n(mem_ce_n),.mem_oe_n(mem_oe_n),.mem_we_n(mem_we_n),.mem_be_n(mem_be_n));
 issi_bll_pin_model #(.ADDRESS_WIDTH(18)) ram(.address(mem_address),.data(mem_data),
  .ce_n(mem_ce_n),.oe_n(mem_oe_n),.we_n(mem_we_n),.be_n(mem_be_n),.drive_active());
 assign pcm_ready=!init_mode && store_ready;
 assign pcm_rsp=!init_mode && store_rsp;
 assign pcm_word=store_data;
 wire frame_latch,deadline_missed,mclk,bclk,lrck,serial_data;
 apu_serial_output serial(.clk(clk),.reset_n(reset_n),.frame_valid(output_valid),.frame_ready(output_ready),
  .frame_left(left),.frame_right(right),.frame_latch(frame_latch),.deadline_missed(deadline_missed),
  .mclk(mclk),.bclk(bclk),.lrck(lrck),.serial_data(serial_data));
 integer pcm_reads=0,nonzero_frames=0,serial_bits=0,serial_bit_index=0;
 reg check_serial=0;reg expected_bit;
 always @(posedge clk) if(reset_n) begin
  if(frame_tick!==frame_latch)$fatal(1,"timeline and DAC frame edges diverged");
  if(pcm_req && pcm_ready)pcm_reads=pcm_reads+1;
  if(output_valid && output_ready && {right,left}==32'h03e803e8) nonzero_frames=nonzero_frames+1;
  if(frame_latch && serial.held_valid && {serial.held_right,serial.held_left}==32'h03e803e8) begin
   if(check_serial)$fatal(1,"overlapping serial frame");
   check_serial=1;serial_bit_index=0;
  end
 end
 always @(posedge bclk) if(reset_n && check_serial) begin
  if(lrck!==(serial_bit_index>=32))$fatal(1,"LRCK mismatch bit %0d",serial_bit_index);
  expected_bit=0;
  if(serial_bit_index>=1 && serial_bit_index<=16)expected_bit=16'h03e8 >> (16-serial_bit_index);
  if(serial_bit_index>=33 && serial_bit_index<=48)expected_bit=16'h03e8 >> (48-serial_bit_index);
  if(serial_data!==expected_bit)$fatal(1,"serial mismatch bit %0d",serial_bit_index);
  serial_bits=serial_bits+1;serial_bit_index=serial_bit_index+1;
  if(serial_bit_index==64)check_serial=0;
 end
`endif
 always @(posedge clk) begin
`ifndef APU_FULL_SERIAL_TEST
  pcm_rsp<=pcm_req;
`endif
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
   if(bind_commit)begin
    count_bind=count_bind+1;
    if(!pub_valid || pub_region!==0 || pub_cart!==0 || pub_parameters[0+:32]!==cp[0+:32] || pub_parameters[32+:32]!==32'd2)
     $fatal(1,"local source commit not atomic");
   end
   if(end_valid && end_ready)count_end=count_end+1;
   if(irq==32'h20)count_irq=count_irq+1;
   if(frame_done && end_valid)$fatal(1,"frame retired before end");
  end
 end
 task automatic wr(input [4:0] index,input [31:0] value);
`ifdef APU_SYS_SERIAL_TEST
  begin @(negedge clk);while(!bus_req_ready)@(negedge clk);
   bus_req_valid=1;bus_req_addr=32'h08000120+({27'd0,index}<<2);bus_req_data=value;
   @(negedge clk);bus_req_valid=0;while(!bus_rsp_valid)@(negedge clk);
   if(bus_rsp_timeout || bus_rsp_fault!=0) $fatal(1,"APU SYS write fault address=%h fault=%h",bus_req_addr,bus_rsp_fault);
  end
`else
  begin @(negedge clk);iv=1;iw=1;ii=index;id=value;do @(posedge clk);while(!ir);@(negedge clk);iv=0;iw=0;end
`endif
 endtask
 task automatic play_cmd(input [31:0] address);
  begin wr(0,address);wr(1,2);wr(2,44100);wr(3,1);wr(4,16);wr(5,1);wr(10,2);wr(21,1);end
 endtask
`ifdef APU_FULL_SERIAL_TEST
 initial begin
  repeat(3)@(negedge clk);store_reset_n=1;wait(memory_ready);
  @(negedge clk);init_valid=1;while(!store_ready)@(negedge clk);
  @(negedge clk);init_valid=0;wait(store_rsp);@(negedge clk);init_mode=0;
  reset_n=1;bind_allow=1;play_cmd(32'h40000190);wait(count_bind==1);
  wait(serial_bits==64);@(negedge clk);
  if(deadline_missed || pcm_reads==0 || nonzero_frames!=1 || count_end!=1 || count_irq!=1 || event_address!==32'h40000190)
   $fatal(1,"full path status miss=%b reads=%0d frames=%0d end=%0d irq=%0d addr=%h",deadline_missed,pcm_reads,nonzero_frames,count_end,count_irq,event_address);
  `ifdef APU_SYS_SERIAL_TEST
  $display("PASS SYS -> PLAY -> local binder -> timed sample SRAM -> cursor/mixer -> PCM1754 I2S pins: one mono voice, end and APU IRQ; reads=%0d",pcm_reads);
`else
  $display("PASS PLAY -> source binder -> timed sample SRAM -> cursor/mixer -> buffered PCM1754 I2S: one 64-bit stereo frame, end and IRQ; reads=%0d",pcm_reads);
`endif
  $finish;
 end
 initial begin #40000000;$fatal(1,"full serial watchdog ready=%b seq=%0d",memory_ready,sample_seq);end
`else
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
  // A physically out-of-range local-RAM replacement fails before touching
  // the installed slot or publishing a new decoder binding.
  play_cmd(32'h40000300);wait(cv && cc==1);wait(play.rate_valid);
  @(negedge clk);bind_allow=1;wait(cr);@(negedge clk);bind_allow=0;
  if(!active[2] || count_bind!=3)$fatal(1,"third PLAY not installed");
  play_cmd(32'h4007ffff);
  wait(cmd_fault);@(negedge clk);
  if(cmd_fault_code!==32'h102 || cmd_fault_detail!==32'h4007ffff || !active[2] || control.bank.banks[2][0+:32]!==32'h40000300 || count_bind!=3)
   $fatal(1,"failed local binding: code=%h detail=%h active=%h source=%h binds=%0d",cmd_fault_code,cmd_fault_detail,active,control.bank.banks[2][0+:32],count_bind);
  $display("PASS real control + rate + cursor + PCM mixer: atomic PLAY, stalled bind, output/end/frame ordering, same-slot replay and IRQ; local sample binder real; PCM-memory fixture");$finish;
 end
 initial begin #3000000;$fatal(1,"watchdog active=%h frame=%b output=%b seq=%0d done=%0d cv=%b rate=%b",active,frame_valid,output_valid,sample_seq,done_seq,cv,play.rate_valid);end
`endif
endmodule
