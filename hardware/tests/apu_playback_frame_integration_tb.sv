`timescale 1ns/1ps
// Timeline, raw slot bank, four-lane cursors, mixed PCM/BADP, word router,
// publication snapshots and real timed ISSI sample SRAM. The initial install,
// BADP bind and cursor load are explicit external stimuli. End events use
// the real slot-clear/event owner; the test controls bank-port availability.
module apu_playback_frame_integration_tb;
 localparam real PERIOD=1000000000.0/33868800.0;
 reg clk=0;always #(PERIOD/2.0) clk=~clk;
 reg reset_n=0,time_reset_n=0,executor_busy=0,test_load_authorization=0;
 wire timeline_ready,frame_valid,frame_ready,frame_done,frame_tick,history_lost;
 wire [63:0] pending_frames;wire snapshot_overflow;
 apu_frame_timeline timeline(.clk(clk),.reset_n(time_reset_n),.executor_busy(executor_busy),.snapshot_overflow(snapshot_overflow),
  .snapshot_history_lost(history_lost),.timeline_ready(timeline_ready),.frame_valid(frame_valid),.frame_ready(frame_ready),
  .frame_done(frame_done),.sample_sequence(),.completed_sequence(),.pending_frames(pending_frames),.frame_tick(frame_tick));
 reg stage_valid=0,upload_start=0;reg [3:0] stage_index=0;reg [31:0] stage_word=0;reg [4:0] upload_words=1;reg [16:0] upload_base=0;
 wire upload_ready,upload_busy,publish_valid,epoch_active,snapshot_ready,change_valid;wire [4:0] publish_words,snapshot_count;
 wire [16:0] publish_base,change_first,change_last;wire [6:0] queued_words;
 wire read_valid,read_ready,read_rsp;wire [16:0] read_addr;wire [31:0] read_word;
 wire store_valid,store_ready,store_write,store_rsp,memory_ready;wire [16:0] store_addr;wire [31:0] store_wdata,store_rdata;wire [3:0] store_be_n;
 wire [17:0] mem_address;tri [15:0] mem_data;wire mem_ce_n,mem_oe_n,mem_we_n;wire [1:0] mem_be_n;
 apu_upload_commit upload(.clk(clk),.reset_n(reset_n),.power_reset_n(1'b1),.stage_valid(stage_valid),.stage_index(stage_index),.stage_word(stage_word),
  .start_valid(upload_start),.start_ready(upload_ready),.start_words(upload_words),.cancel(1'b0),.live_word_address(upload_base),
  .batch_busy(upload_busy),.publish_valid(publish_valid),.publish_words(publish_words),.publish_base(publish_base),.commit_valid(),.commit_words(),.commit_base(),.commit_next_address(),
  .epoch_begin(frame_tick),.epoch_end(frame_done),.epoch_active(epoch_active),.snapshot_ready(snapshot_ready),.snapshot_overflow(snapshot_overflow),.snapshots_pending(snapshot_count),
  .snapshot_change_valid(change_valid),.snapshot_change_first(change_first),.snapshot_change_last(change_last),.queued_words(queued_words),.epoch_words(),
  .read_valid(read_valid),.read_ready(read_ready),.read_word_address(read_addr),.read_rsp_valid(read_rsp),.read_rsp_word(read_word),.memory_ready(memory_ready),
  .store_req_valid(store_valid),.store_req_ready(store_ready),.store_req_write(store_write),.store_req_word_address(store_addr),.store_req_wdata(store_wdata),.store_req_be_n(store_be_n),
  .store_rsp_valid(store_rsp),.store_rsp_rdata(store_rdata));
 apu_sample_store store(.clk(clk),.reset_n(reset_n),.power_reset_n(1'b1),.req_valid(store_valid),.req_ready(store_ready),.req_write(store_write),
  .req_word_address(store_addr),.req_wdata(store_wdata),.req_be_n(store_be_n),.rsp_valid(store_rsp),.rsp_rdata(store_rdata),.memory_ready(memory_ready),
  .mem_address(mem_address),.mem_data(mem_data),.mem_ce_n(mem_ce_n),.mem_oe_n(mem_oe_n),.mem_we_n(mem_we_n),.mem_be_n(mem_be_n));
 issi_bll_pin_model #(.ADDRESS_WIDTH(18)) ram(.address(mem_address),.data(mem_data),.ce_n(mem_ce_n),.oe_n(mem_oe_n),.we_n(mem_we_n),.be_n(mem_be_n),.drive_active());
 reg ext_commit=0;reg [1:0] ext_action=0;reg [3:0] ext_slot=0;reg [2:0] ext_phase=0;reg [671:0] ext_parameters=0;
 reg end_allow=0;wire end_valid,end_ready;wire [3:0] end_slot;wire commit_ready;
 wire [3:0] fetch_slot;wire [671:0] fetch_parameters;wire [15:0] render_mask,active_mask;
 wire end_commit;wire [3:0] end_commit_slot;
 wire [31:0] event_kind,event_slot,event_source,event_sequence,user_irq_raise;
 apu_end_event events(.clk(clk),.reset_n(reset_n),.end_valid(end_valid),.end_ready(end_ready),.end_slot(end_slot),
  .end_source_address(fetch_parameters[0+:32]),.commit_valid(end_commit),.commit_ready(end_allow && commit_ready),.commit_slot(end_commit_slot),
  .event_kind(event_kind),.event_slot(event_slot),.event_source_address(event_source),.event_sequence(event_sequence),.user_irq_raise(user_irq_raise));
 apu_slot_bank bank(.clk(clk),.reset_n(reset_n),.selected_slot(4'd0),.access_valid(1'b0),.access_write(1'b0),.access_index(5'd0),.access_wdata(32'd0),
  .timeline_ready(timeline_ready),.access_ready(),.response_valid(),.response_data(),.commit_valid(ext_commit || (end_commit && end_allow)),.commit_ready(commit_ready),
  .commit_action(end_commit && end_allow ? 2'd1 : ext_action),.commit_slot(end_commit && end_allow ? end_commit_slot : ext_slot),.commit_parameters(ext_parameters),
  .commit_phase(ext_phase),.commit_index(5'd0),.commit_word(32'd0),.commit_cartridge(1'b0),.rebind_valid(1'b0),.rebind_slot(4'd0),.rebind_cartridge(1'b0),
  .fetch_slot(end_valid ? end_slot : fetch_slot),.fetch_active(),.fetch_cartridge(),.event_slot(4'd0),.event_source_address(),.fetch_parameters(fetch_parameters),.render_mask(render_mask),
  .update_valid(),.update_ready(1'b1),.update_slot(),.update_index(),.update_word(),.update_parameters(),
  .selected_phase(),.selected_active(),.selected_source_address(),.active_mask(active_mask));
 reg load_valid=0;reg [3:0] load_slot=0;reg signed [63:0] load_step=0;reg [31:0] load_frames=8,load_loop_end=8;
 reg bind_valid=0,load_decoder_reset=1,load_filter_clear=1;wire load_ready,decoder_epoch,busy;
 wire badp_req,pcm_req;wire [16:0] badp_addr;wire [31:0] pcm_addr;wire source_ready,source_rsp,source_timeout;wire [31:0] source_word,source_fault;
 integer irq_count=0;reg square_only=0;
 reg response_pcm=0;reg output_ready=0;wire output_valid;wire signed [15:0] left,right;
`ifdef APU_SERIAL_MIXED_TEST
 wire serial_ready,serial_latch,deadline_missed,serial_bclk,serial_lrck,serial_data;
 wire playback_output_ready=serial_ready;
 apu_serial_output serial(.clk(clk),.reset_n(time_reset_n),.frame_valid(output_valid),.frame_ready(serial_ready),
  .frame_left(left),.frame_right(right),.frame_latch(serial_latch),.deadline_missed(deadline_missed),
  .mclk(),.bclk(serial_bclk),.lrck(serial_lrck),.serial_data(serial_data));
`else
 wire playback_output_ready=output_ready;
`endif
 apu_playback_frame playback(.clk(clk),.reset_n(reset_n),.frame_valid(frame_valid),.frame_ready(frame_ready),.frame_done(frame_done),
  .render_mask(render_mask),.fetch_slot(fetch_slot),.fetch_parameters(fetch_parameters),.load_valid(load_valid),
  .load_authorized(!time_reset_n || timeline_ready || executor_busy || test_load_authorization),.load_ready(load_ready),.load_slot(load_slot),
  .load_cursor_q16(64'sd0),.load_step_q16(load_step),.load_remainder(32'sd0),.load_step_remainder(32'sd0),.load_frames(load_frames),
  .load_loop_start(32'd0),.load_loop_end(load_loop_end),.load_decoder_reset(load_decoder_reset),.load_filter_clear(load_filter_clear),
  .bind_valid(bind_valid),.bind_voice(4'd1),.bind_source_base(19'd0),.bind_source_bytes(20'd128),.bind_data_offset(19'd64),.bind_frames(32'd8),
  .bind_channels(2'd1),.bind_seek_base(19'd0),.bind_seek_count(32'd0),.bind_loop_start(32'd0),.bind_loop_end(32'd8),
  .source_write_valid(publish_valid),.source_write_word(publish_base),.source_write_words(publish_words),.epoch_active(epoch_active),
  .epoch_change_valid(change_valid),.epoch_change_first(change_first),.epoch_change_last(change_last),.decoder_epoch_begin(decoder_epoch),
  .memory_req_valid(badp_req),.memory_req_ready(source_ready),.memory_req_word_address(badp_addr),.memory_rsp_valid(source_rsp && !response_pcm),.memory_rsp_word(source_word),
  .pcm_memory_req_valid(pcm_req),.pcm_memory_req_ready(source_ready),.pcm_memory_req_address(pcm_addr),.pcm_memory_rsp_valid(source_rsp && response_pcm),.pcm_memory_rsp_word(source_word),
  .output_valid(output_valid),.output_ready(playback_output_ready),.output_left(left),.output_right(right),.end_valid(end_valid),.end_ready(end_ready),.end_slot(end_slot),.busy(busy));
 apu_source_word_router route(.clk(clk),.reset_n(reset_n),.req_valid(badp_req || pcm_req),.req_ready(source_ready),.req_local(1'b1),
  .req_local_word(pcm_req ? pcm_addr[18:2] : badp_addr),.req_rom_address(32'd0),.req_rom_signals(8'd0),.req_timeout_enable(1'b0),.req_wait_last(18'd0),
  .local_valid(read_valid),.local_ready(read_ready),.local_word(read_addr),.local_rsp_valid(read_rsp),.local_rsp_data(read_word),
  .rom_valid(),.rom_ready(1'b0),.rom_address(),.rom_signals(),.rom_timeout_enable(),.rom_wait_last(),.rom_rsp_valid(1'b0),.rom_rsp_ready(),.rom_rsp_data(32'd0),.rom_rsp_fault(32'd0),.rom_rsp_timeout(1'b0),
  .rsp_valid(source_rsp),.rsp_ready(1'b1),.rsp_data(source_word),.rsp_fault(source_fault),.rsp_timeout(source_timeout));
 always @(posedge clk)if(reset_n)begin
  if(user_irq_raise==32'h20)irq_count=irq_count+1;
  if((badp_req || pcm_req) && source_ready)response_pcm<=pcm_req;
  if(badp_req && pcm_req)$fatal(1,"simultaneous requests");
  if(square_only && (badp_req || pcm_req))$fatal(1,"square source accessed sample memory");
  if(snapshot_overflow || history_lost)$fatal(1,"snapshot lost");
 end
 task automatic stage(input [3:0] index,input [31:0] word);
  begin @(negedge clk);stage_index=index;stage_word=word;stage_valid=1;@(negedge clk);stage_valid=0;end
 endtask
 task automatic submit_upload(input [16:0] address,input [4:0] words);
  begin @(negedge clk);upload_base=address;upload_words=words;while(!upload_ready)@(negedge clk);upload_start=1;@(negedge clk);upload_start=0;end
 endtask
 task automatic install(input [3:0] slot,input [31:0] address,input [31:0] bits,input [31:0] offset);
  begin @(negedge clk);ext_slot=slot;ext_action=0;ext_parameters=0;ext_parameters[0+:32]=address;ext_parameters[1*32+:32]=128;
   ext_parameters[3*32+:32]=1;ext_parameters[4*32+:32]=bits;ext_parameters[5*32+:32]=8;ext_parameters[6*32+:32]=offset;ext_parameters[12*32+:32]=4096;
   ext_commit=1;@(negedge clk);ext_commit=0;end
 endtask
 task automatic load(input [3:0] slot,input signed [63:0] step,input [31:0] frames,input [31:0] loop_end);
  begin @(negedge clk);load_slot=slot;load_step=step;load_frames=frames;load_loop_end=loop_end;while(!load_ready)@(negedge clk);load_valid=1;@(negedge clk);load_valid=0;end
 endtask
 task automatic accept_output(input [31:0] expected);
  begin @(negedge clk);while(!output_valid)@(negedge clk);if({right,left}!==expected)$fatal(1,"audio %h expected %h snapshots=%d pending=%d",{right,left},expected,snapshot_count,pending_frames);
   $display("accept audio %h snapshot_count=%0d pending=%0d",{right,left},snapshot_count,pending_frames);
   output_ready=1;@(negedge clk);output_ready=0;end
 endtask
 integer f,rc,count;reg [31:0] expected0,expected1;
`ifdef APU_SERIAL_MIXED_TEST
 integer serial_ticks=0,serial_produced=0,serial_accepted=0,serial_bits=0,serial_bit_index=0;
 integer pcm_reads=0,badp_reads=0,serial_cycle=0,last_tick_cycle=0,max_mix_cycles=0;
 reg serial_check=0,serial_expected_bit;reg [31:0] serial_expected_frame;
 always @(posedge clk) if(time_reset_n) begin
  serial_cycle=serial_cycle+1;
  if(frame_tick!==serial_latch)$fatal(1,"timeline and serial sample edge differ");
  if(pcm_req && source_ready)pcm_reads=pcm_reads+1;
  if(badp_req && source_ready)badp_reads=badp_reads+1;
  if(output_valid && serial_ready) begin
   if(serial_produced==0 && {right,left}!==expected0)$fatal(1,"first mixed frame mismatch");
   if(serial_produced==1 && {right,left}!==expected1)$fatal(1,"second mixed frame mismatch");
   if(serial_cycle-last_tick_cycle>max_mix_cycles)max_mix_cycles=serial_cycle-last_tick_cycle;
   serial_produced=serial_produced+1;
  end
  if(serial_latch) begin
   last_tick_cycle=serial_cycle;
   serial_ticks=serial_ticks+1;
   if(serial_ticks>=2 && serial_ticks<=3) begin
    if(deadline_missed || serial_produced<serial_ticks-1)$fatal(1,"mixed frame missed serial deadline at tick %0d",serial_ticks);
    if(serial_check)$fatal(1,"previous serial frame incomplete");
    serial_expected_frame=serial_ticks==2 ? expected0 : expected1;
    serial_bit_index=0;serial_check=1;serial_accepted=serial_accepted+1;
   end
  end
 end
 always @(posedge serial_bclk) if(time_reset_n && serial_check) begin
  if(serial_lrck!==(serial_bit_index>=32))$fatal(1,"LRCK mismatch at bit %0d",serial_bit_index);
  serial_expected_bit=0;
  if(serial_bit_index>=1 && serial_bit_index<=16)serial_expected_bit=serial_expected_frame[16-serial_bit_index];
  if(serial_bit_index>=33 && serial_bit_index<=48)serial_expected_bit=serial_expected_frame[48-serial_bit_index+16];
  if(serial_data!==serial_expected_bit)$fatal(1,"mixed I2S mismatch frame=%0d bit=%0d",serial_accepted,serial_bit_index);
  serial_bits=serial_bits+1;serial_bit_index=serial_bit_index+1;
  if(serial_bit_index==64)serial_check=0;
 end
`endif
 initial begin
  f=$fopen("build/tests/apu-mixed-snapshot-vectors.txt","r");if(!f)$fatal(1,"missing TS/C++ fixture");
  rc=$fscanf(f,"%d %h %h",count,expected0,expected1);if(rc!=3 || count!=2)$fatal(1,"bad fixture");
  repeat(2)@(negedge clk);reset_n=1;wait(memory_ready);
  stage(0,32'h000c0008);stage(1,32'h00140064);stage(2,32'h11111111);submit_upload(16,3);wait(publish_valid);wait(!upload_busy && queued_words==0);
  stage(0,32'h000003e8);submit_upload(100,1);wait(publish_valid);wait(!upload_busy && queued_words==0);
  install(0,32'h40000190,16,0);install(1,32'h40000000,4,64);
  load(0,0,8,8);
  // A seek/rate update can arrive before PLAY's first rendered descriptor.
  // Its lack of a new clear request must not cancel PLAY's pending clears.
  load_decoder_reset=0;load_filter_clear=0;load(0,0,8,8);
  if(playback.decoder_reset_pending[0]!==1 || playback.filter_clear_pending[0]!==1)
   $fatal(1,"later cursor load discarded a pending PLAY clear");
  load_decoder_reset=1;load_filter_clear=1;load(1,0,8,8);
  // A newly played voice can be paused before its first rendered frame.
  install(2,32'h40000190,16,0);load(2,0,8,8);
  @(negedge clk);ext_slot=2;ext_action=2;ext_phase=5;ext_commit=1;@(negedge clk);ext_commit=0;
  @(negedge clk);bind_valid=1;@(negedge clk);bind_valid=0;
  @(negedge clk);time_reset_n=1;
`ifdef APU_SERIAL_MIXED_TEST
  // The two independently generated software vectors describe an upload
  // between output edges. The upload uses the real RAM path and published
  // epoch snapshots; test its arrival before the second tick, not just output.
  wait(serial_produced==1);@(negedge clk);
  stage(0,32'h00000bb8);submit_upload(100,1);wait(publish_valid);@(negedge clk);
  if(serial_ticks!=1)$fatal(1,"PCM update was not published before the second edge");
  wait(serial_accepted==2);wait(!serial_check);@(negedge clk);
  if(serial_bits!=128 || pcm_reads==0 || badp_reads==0 || deadline_missed || history_lost)
   $fatal(1,"mixed serial result incomplete: bits=%0d PCM=%0d BADP=%0d",serial_bits,pcm_reads,badp_reads);
  $display("PASS two TS/C++ PCM+BADP frames and intervening PCM upload through real sample SRAM, playback and PCM1754 I2S: 128 serial bits; first two deadlines met; max mix clocks=%0d",max_mix_cycles);
  $finish;
`endif
  // A fresh unreserved cursor mutation presented on the tick must wait,
  // even before the timeline has raised its deferred frame_valid.
  wait(frame_tick);@(negedge clk);load_slot=0;load_frames=0;load_valid=1;#1;
  if(timeline_ready || load_ready || frame_valid)$fatal(1,"unreserved load won the frame edge");
  @(negedge clk);test_load_authorization=1;#1;
  if(!frame_valid || load_ready)$fatal(1,"cursor load won simultaneous frame dispatch");
  @(negedge clk);load_valid=0;test_load_authorization=0;load_frames=8;
  wait(output_valid);@(negedge clk);if({right,left}!==expected0)$fatal(1,"first frame mismatch");
  // Hold the first frame while a new upload is published and a second edge
  // captures the subsequent immutable source view.
  stage(0,32'h00000bb8);submit_upload(100,1);wait(publish_valid);wait(frame_tick);@(posedge clk);@(negedge clk);
  if(snapshot_count!=2 || pending_frames!=2 || !output_valid || {right,left}!==expected0)$fatal(1,"overlapping snapshot/frame hold %0d %0d",snapshot_count,pending_frames);
  accept_output(expected0);accept_output(expected1);wait(timeline_ready);if(epoch_active)$fatal(1,"snapshot not retired");
  if(playback.decoder_reset_pending[2]!==1 || playback.filter_clear_pending[2]!==1)
   $fatal(1,"paused, unrendered voice lost its pending clears");
  @(negedge clk);ext_slot=2;ext_action=2;ext_phase=1;ext_commit=1;@(negedge clk);ext_commit=0;
  accept_output(((expected1 & 32'hffff)+32'd3000)*32'h00010001);
  if(playback.decoder_reset_pending[2]!==0 || playback.filter_clear_pending[2]!==0)
   $fatal(1,"resumed voice did not consume its pending clears");
  wait(timeline_ready);@(negedge clk);ext_slot=2;ext_action=1;ext_commit=1;@(negedge clk);ext_commit=0;
  // Pause the BADP voice; the PCM voice must still render from its retained cursor.
  @(negedge clk);ext_slot=1;ext_action=2;ext_phase=5;ext_commit=1;@(negedge clk);ext_commit=0;
  if(active_mask!==3 || render_mask!==1)$fatal(1,"paused public/render masks");
  // Load one non-looped PCM sample: its post-render end is retained until the
  // consumer accepts the sound, then until the external clear/event action.
  load(0,64'sd65536,1,0);wait(output_valid);@(negedge clk);
  if({right,left}!==32'h0bb80bb8 || end_valid)$fatal(1,"natural end before output");
  output_ready=1;@(negedge clk);output_ready=0;wait(end_valid);
  load_slot=0;load_valid=1;
  repeat(4)begin @(negedge clk);if(!end_valid || end_slot!=0 || frame_done || !active_mask[0] || load_ready)$fatal(1,"end hold ordering or early reload");end
  load_valid=0;
  end_allow=1;@(negedge clk);end_allow=0;
  if(user_irq_raise!==0 || event_sequence!==1 || active_mask!==2)$fatal(1,"event publication or clear did not precede IRQ");
  wait(frame_done);@(negedge clk);
  if(user_irq_raise!==32'h20)$fatal(1,"delayed IRQ request missing");
  if(active_mask!==2 || history_lost)$fatal(1,"end did not clear correct slot");
  if(event_kind!==1 || event_slot!==0 || event_source!==32'h40000190 || event_sequence!==1)$fatal(1,"first event payload");
  // Two simultaneous ends must each be delivered once, in slot order. The
  // consumer can hold either event without allowing frame completion.
  wait(timeline_ready);install(0,32'h40000190,16,0);
  @(negedge clk);ext_slot=1;ext_action=2;ext_phase=1;ext_commit=1;@(negedge clk);ext_commit=0;
  load(0,64'sd65536,1,0);load(1,64'sd65536,1,0);
  accept_output(expected1);wait(end_valid);@(negedge clk);
  if(end_slot!=0 || active_mask!==3 || frame_done)$fatal(1,"first simultaneous end");
  end_allow=1;@(negedge clk);end_allow=0;@(negedge clk);
  if(!end_valid || end_slot!=1 || active_mask!==2 || frame_done)$fatal(1,"second simultaneous end");
  repeat(3)@(negedge clk);if(!end_valid || end_slot!=1 || frame_done)$fatal(1,"second end hold");
  end_allow=1;@(negedge clk);end_allow=0;wait(frame_done);@(negedge clk);
  if(active_mask!==0 || history_lost)$fatal(1,"simultaneous ends not retired");
  if(event_kind!==1 || event_slot!==1 || event_source!==32'h40000000 || event_sequence!==3)$fatal(1,"latest event payload %h %h %h %h",event_kind,event_slot,event_source,event_sequence);
  repeat(2)@(negedge clk);
  if(irq_count!==3)$fatal(1,"wrong count of end IRQ requests: %0d",irq_count);
  // A command admitted before an edge keeps its reservation across that
  // edge; its cursor load must not deadlock just because timeline_ready is low.
  wait(timeline_ready);@(negedge clk);executor_busy=1;
  wait(frame_tick);@(negedge clk);load_slot=3;load_valid=1;#1;
  if(timeline_ready || frame_valid || !load_ready)$fatal(1,"reserved cursor load blocked at frame edge");
  @(negedge clk);load_valid=0;executor_busy=0;
  accept_output(32'd0);wait(timeline_ready);
  // Install a real bank descriptor for a mono square source. The selected
  // cursor and descriptor traverse the existing playback scheduler/mixer;
  // no PCM or BADP source-memory request is allowed for this frame.
  @(negedge clk);ext_slot=0;ext_action=0;ext_phase=1;ext_parameters=0;
  ext_parameters[3*32+:32]=1;ext_parameters[4*32+:32]=16;ext_parameters[5*32+:32]=8;
  ext_parameters[12*32+:32]=4096;ext_parameters[19*32+:32]=1;ext_parameters[20*32+:32]=2048;
  ext_commit=1;@(negedge clk);ext_commit=0;
  load(0,0,8,8);square_only=1;accept_output(32'h7fff7fff);square_only=0;
  $display("PASS timeline + 4-lane cursor + slot bank + PCM/BADP/square + upload snapshots + timed SRAM; pending clears, pause, tick/load reservation and output/end handshake; authorization and initial bind/load are stimuli");$finish;
 end
 initial begin #100000000;$fatal(1,"watchdog");end
endmodule
