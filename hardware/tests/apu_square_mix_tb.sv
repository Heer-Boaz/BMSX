`timescale 1ns/1ps
// Square sources through the existing PCM/BADP filter and mixer owner.
// The first cases use the actual TS mixer vectors cross-checked by C++.
// Directed cases then exercise the full duty word and filter-clear path.
module apu_square_mix_tb;
 reg clk=0; always #5 clk=~clk;
 reg reset_n=0,start_valid=0,slot_valid=0,slot_active=0,frame_ready_out=0;
 reg [15:0] slot_fraction=0;
 reg [31:0] slot_generator_duty_q12=0,slot_filter_control=0,slot_filter_b0_b1=32'h00004000;
 reg slot_filter_clear=0;
 wire start_ready,slot_ready,frame_valid,memory_req_valid,pcm_memory_req_valid;
 wire signed [15:0] frame_left,frame_right;
 apu_badp_mix dut(.clk(clk),.reset_n(reset_n),
  .bind_valid(1'b0),.bind_voice(4'd0),.bind_source_base(19'd0),.bind_source_bytes(20'd0),
  .bind_data_offset(19'd0),.bind_frames(32'd0),.bind_channels(2'd0),.bind_seek_base(19'd0),
  .bind_seek_count(32'd0),.bind_loop_start(32'd0),.bind_loop_end(32'd0),
  .source_write_valid(1'b0),.source_write_word(17'd0),.source_write_words(5'd0),
  .epoch_begin(1'b0),.epoch_active(1'b0),.epoch_change_valid(1'b0),
  .epoch_change_first(17'd0),.epoch_change_last(17'd0),
  .memory_req_valid(memory_req_valid),.memory_req_ready(1'b0),.memory_req_word_address(),
  .memory_rsp_valid(1'b0),.memory_rsp_word(32'd0),
  .pcm_memory_req_valid(pcm_memory_req_valid),.pcm_memory_req_ready(1'b0),.pcm_memory_req_address(),
  .pcm_memory_rsp_valid(1'b0),.pcm_memory_rsp_word(32'd0),
  .start_valid(start_valid),.start_ready(start_ready),.slot_valid(slot_valid),.slot_ready(slot_ready),
  .slot_active(slot_active),.slot_reset(1'b0),.slot_frame(32'd0),.slot_neighbor(32'd0),
  .slot_bits_per_sample(32'd16),.slot_channels(32'd1),.slot_data_address(32'd0),
  .slot_generator_kind(32'd1),.slot_generator_duty_q12(slot_generator_duty_q12),
  .slot_fraction(slot_fraction),.slot_gain_q12(32'sd4096),.slot_level_lr_q14(32'h40004000),
  .slot_filter_clear(slot_filter_clear),.slot_filter_control(slot_filter_control),
  .slot_filter_b0_b1(slot_filter_b0_b1),.slot_filter_b2_a1(32'd0),.slot_filter_a2(32'd0),
  .frame_valid(frame_valid),.frame_ready_out(frame_ready_out),.frame_left(frame_left),.frame_right(frame_right));
 always @(posedge clk) if(reset_n && (memory_req_valid || pcm_memory_req_valid))
  $fatal(1,"Square voice issued a source-memory request");
 task automatic render(input bit active,input [15:0] phase,input [31:0] duty,
                       input bit filtered,input bit clear_history,input [31:0] expected);
  begin
   while(!start_ready) @(negedge clk);
   start_valid=1; @(negedge clk);start_valid=0;
   for(integer slot=0;slot<16;slot=slot+1) begin
    while(!slot_ready) @(negedge clk);
    slot_active=active && slot==0;slot_fraction=phase;slot_generator_duty_q12=duty;
    slot_filter_control=filtered;slot_filter_clear=clear_history && slot_active;
    slot_valid=1;@(negedge clk);slot_valid=0;
   end
   while(!frame_valid) @(negedge clk);
   if({frame_right,frame_left}!==expected)
    $fatal(1,"square phase=%h duty=%h filtered=%0d got=%h expected=%h",phase,duty,filtered,{frame_right,frame_left},expected);
   frame_ready_out=1;@(negedge clk);frame_ready_out=0;
  end
 endtask
 integer f,rc,cases,frames,case_no,frame_no,phase_no,duty_no;
 reg [31:0] start_word,count,lo,hi,rate,hz,rem,was,active,ended,cur,next,frac,remainder,expected_word;
 reg [63:0] whole,cursor,lhs,rhs;
 reg [31:0] duties[0:5];reg [15:0] phases[0:5];
 initial begin #50000000;$fatal(1,"square-mix watchdog");end
 initial begin
  f=$fopen("build/tests/apu-voice-cursor-vectors.txt","r");if(!f)$fatal(1,"missing real mixer vectors");
  rc=$fscanf(f,"%d %d",cases,frames);if(rc!=2)$fatal(1,"vector header");
  duties[0]=0;duties[1]=1;duties[2]=2048;duties[3]=4095;duties[4]=4096;duties[5]=32'hffffffff;
  phases[0]=0;phases[1]=15;phases[2]=16;phases[3]=32767;phases[4]=32768;phases[5]=65535;
  repeat(4)@(negedge clk);reset_n=1;@(negedge clk);
  for(case_no=0;case_no<cases;case_no=case_no+1)begin
   rc=$fscanf(f,"%h %h %h %h %h %h %h %h",start_word,count,lo,hi,rate,hz,whole,rem);
   if(rc!=8)$fatal(1,"case header %0d",case_no);
   for(frame_no=0;frame_no<frames;frame_no=frame_no+1)begin
    rc=$fscanf(f,"%h %h %h %h %h %h %h %h %h",was,active,ended,cur,next,frac,cursor,remainder,expected_word);
    if(rc!=9)$fatal(1,"case %0d frame %0d",case_no,frame_no);
    render(active!=0,frac[15:0],32'd2048,0,0,expected_word);
   end
  end
  $fclose(f);
  for(duty_no=0;duty_no<6;duty_no=duty_no+1)
   for(phase_no=0;phase_no<6;phase_no=phase_no+1)begin
    lhs={48'd0,phases[phase_no]}*64'd4096;
    rhs={32'd0,duties[duty_no]}*64'd65536;
    render(1,phases[phase_no],duties[duty_no],1,1,lhs<rhs ? 32'h7fff7fff : 32'h80008000);
   end
  // b0=0.5, b1=0.25. The second frame retains the positive first
  // sample in the actual filter state; no PLAY/clear occurs between them.
  slot_filter_b0_b1=32'h10002000;
  render(1,0,32'd4096,1,1,32'h3fff3fff);
  render(1,0,32'd0,1,0,32'hdfffdfff);
  $display("PASS square mixer: %0d real TS/C++ frames, 36 duty/phase boundaries and retained filter state; no memory requests",cases*frames);
  $finish;
 end
endmodule
