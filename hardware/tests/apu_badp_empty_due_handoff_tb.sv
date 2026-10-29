`timescale 1ns/1ps
// Real decoder and upload owner: late rendering must use per-snapshot provenance.
module apu_badp_empty_due_handoff_tb;
    reg clk=0;
    always #5 clk=~clk;
    reg reset_n=0, bind_valid=0, req_valid=0, req_reset=0;
    reg [31:0] req_frame=0;
    reg epoch_begin=0, epoch_end=0, decoder_begin=0;
    wire snapshot_change_valid; wire [16:0] snapshot_change_first,snapshot_change_last;
    wire req_ready, rsp_valid;
    wire [31:0] rsp_samples;
    wire memory_req_valid;
    wire [16:0] memory_req_word_address;
    reg [31:0] memory [0:127];
    reg stage_valid=0,start_valid=0;
    wire start_ready,batch_busy,publish_valid,read_ready,read_rsp_valid,store_req_valid,store_req_write;
    wire [4:0] snapshots_pending;
    wire [31:0] read_rsp_word,store_req_wdata; wire [16:0] store_req_addr;
    reg store_rsp_valid=0; reg [31:0] store_rsp_rdata=0; wire upload_epoch_active;
    apu_upload_commit upload(.clk(clk),.reset_n(reset_n),.power_reset_n(1'b1),
      .stage_valid(stage_valid),.stage_index(4'd0),.stage_word(32'h001403e8),
      .start_valid(start_valid),.start_ready(start_ready),.start_words(5'd1),.cancel(1'b0),
      .live_word_address(17'd17),.batch_busy(batch_busy),.publish_valid(publish_valid),.publish_words(),.publish_base(),
      .commit_valid(),.commit_words(),.commit_base(),.commit_next_address(),.epoch_begin(epoch_begin),.epoch_end(epoch_end),
      .epoch_active(upload_epoch_active),.snapshot_change_valid(snapshot_change_valid),.snapshot_change_first(snapshot_change_first),.snapshot_change_last(snapshot_change_last),.snapshot_ready(),.snapshot_overflow(),.snapshots_pending(snapshots_pending),.queued_words(),.epoch_words(),
      .read_valid(memory_req_valid),.read_ready(read_ready),.read_word_address(memory_req_word_address),
      .read_rsp_valid(read_rsp_valid),.read_rsp_word(read_rsp_word),.memory_ready(1'b1),
      .store_req_valid(store_req_valid),.store_req_ready(1'b1),.store_req_write(store_req_write),
      .store_req_word_address(store_req_addr),.store_req_wdata(store_req_wdata),.store_req_be_n(),
      .store_rsp_valid(store_rsp_valid),.store_rsp_rdata(store_rsp_rdata));
    always @(posedge clk) begin
      store_rsp_valid<=reset_n&&store_req_valid;
      if(store_req_valid) begin
        if(store_req_write) memory[store_req_addr]<=store_req_wdata;
        else store_rsp_rdata<=memory[store_req_addr];
      end
    end

    apu_badp_decoder decoder (
        .clk(clk), .reset_n(reset_n), .bind_valid(bind_valid), .bind_voice(4'd0),
        .bind_source_base(19'd0), .bind_source_bytes(20'd4), .bind_data_offset(19'd64),
        .bind_frames(32'd8), .bind_channels(2'd1), .bind_seek_base(19'd0),
        .bind_seek_count(32'd0), .bind_loop_start(32'd0), .bind_loop_end(32'd8),
        .req_valid(req_valid), .req_ready(req_ready), .req_reset(req_reset),
        .req_voice(4'd0), .req_frame(req_frame), .rsp_valid(rsp_valid), .rsp_samples(rsp_samples),
        .source_write_valid(1'b0), .source_write_word(17'd0), .source_write_words(5'd0),
        .epoch_begin(decoder_begin), .epoch_active(upload_epoch_active), .epoch_change_valid(snapshot_change_valid), .epoch_change_first(snapshot_change_first), .epoch_change_last(snapshot_change_last), .memory_req_valid(memory_req_valid),
        .memory_req_ready(read_ready), .memory_req_word_address(memory_req_word_address),
        .memory_rsp_valid(read_rsp_valid), .memory_rsp_word(read_rsp_word)
    );

    task automatic request(input bit reset_op, input [31:0] frame);
        begin
            @(negedge clk);
            while(!req_ready) @(negedge clk);
            req_reset=reset_op; req_frame=frame; req_valid=1;
            @(negedge clk); req_valid=0;
            while(!rsp_valid) @(negedge clk);
        end
    endtask

    integer i;
    initial begin
        for(i=0;i<128;i=i+1) memory[i]=0;
        memory[16]=32'h000c0008;memory[17]=32'h00140064;memory[18]=32'h11111111;
        repeat(2) @(negedge clk); reset_n=1;
        @(negedge clk);bind_valid=1;@(negedge clk);bind_valid=0;
        @(negedge clk);epoch_begin=1;@(negedge clk);epoch_begin=0;
        @(negedge clk);decoder_begin=1;@(negedge clk);decoder_begin=0;
        request(1,0);request(0,0);request(0,1);request(0,2);
        if(!decoder.checkpoint_valid[0])$fatal(1,"missing checkpoint");
        @(negedge clk);epoch_end=1;@(negedge clk);epoch_end=0;
        if(snapshots_pending!=0)$fatal(1,"A should have retired");
        @(negedge clk);stage_valid=1;@(negedge clk);stage_valid=0;
        if(!start_ready)$fatal(1,"start blocked");start_valid=1;
        @(negedge clk);start_valid=0;while(!publish_valid)@(negedge clk);
        epoch_begin=1;decoder_begin=1;#1;
        $display("at capture epoch change %b %d .. %d",snapshot_change_valid,snapshot_change_first,snapshot_change_last);
        @(negedge clk);epoch_begin=0;decoder_begin=0;
        request(0,0);
        if(rsp_samples!==32'h03fa03fa)$fatal(1,"first snapshot same-edge handoff stale %h",rsp_samples);
        $display("PASS first snapshot capture and decoder start share one edge");$finish;
    end
    initial begin #100000; $fatal(1,"timeout"); end
endmodule
