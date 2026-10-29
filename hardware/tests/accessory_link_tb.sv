`timescale 1ns/1ps
module accessory_link_tb;
    reg clk=0;
    always #14.762849584278 clk=!clk;
    reg accessory_clk=0;
    initial begin #11;forever #14.762849584278 accessory_clk=!accessory_clk;end
    reg host_reset_n=0,reset_n=1;
    reg apply_valid=0;
    wire apply_ready;
    reg [31:0] intensity=0,duration_ms=0;
    reg display_context_valid=1;
    reg [15:0] width=256,height=192;
    reg [31:0] epoch=1;
    wire pad_clk;
    wire [3:0] pad_cmd,select_n;
    tri1 [3:0] data;
    wire [2047:0] held;
    wire [3:0] valid,link_error;
    wire request_accepted,apply_accepted,oe,device_data;
    wire [31:0] last_tag,raw_intensity,raw_duration,remaining;
    wire [16:0] motor;
    wire device_context;
    wire [15:0] device_width,device_height;
    wire [31:0] device_epoch;
    reg [223:0] pad_words=224'h80000000_ffffffff_12345678_80008000_00010000_ffff8000_deadbeef;
    reg [127:0] pointer_words={32'hffff8000,32'h00020000,32'hffff0000,32'h80000001};
    reg corrupt=0;
    integer applies=0,requests=0;
    wire command=pad_cmd[0] ^ (corrupt && host.serial.bit_index==500);
    assign data[0]=oe?device_data:1'bz;
    assign data[3:1]=3'b111;
    pad_host host (.clk(clk),.reset_n(host_reset_n),.display_context_valid(display_context_valid),
        .display_width(width),.display_height(height),.display_epoch(epoch),
        .apply_valid(apply_valid),.apply_ready(apply_ready),.apply_port(2'd0),
        .reserve_accept(1'b0),.cancel_accept(1'b0),.apply_ready_cycles(),
        .apply_intensity(intensity),.apply_duration_ms(duration_ms),.dispatch_done(),.dispatch_tag(),
        .packet_valid(valid),.link_error(link_error),.held_reply(held),
        .pad_clk(pad_clk),.pad_cmd(pad_cmd),.pad_data(data),.pad_select_n(select_n));
    pad_accessory accessory (.clk(accessory_clk),.reset_n(reset_n),.pad_clk(pad_clk),
        .pad_select_n(select_n[0]),.pad_command(command),.pad_data(device_data),.pad_data_oe(oe),
        .pad_words(pad_words),.pointer_words(pointer_words),.request_accepted(request_accepted),
        .apply_accepted(apply_accepted),.last_apply_tag(last_tag),.requested_intensity(raw_intensity),
        .requested_duration_ms(raw_duration),.motor_level_q16(motor),.remaining_ms(remaining),
        .context_valid(device_context),.display_width(device_width),.display_height(device_height),
        .display_epoch(device_epoch));
    always @(posedge accessory_clk) begin
        if(apply_accepted) applies=applies+1;
        if(request_accepted) requests=requests+1;
    end
    task automatic frame;
        begin @(posedge select_n[0]);repeat(10) @(negedge clk);end
    endtask
    task automatic apply(input [31:0] level,duration);
        begin
            @(negedge clk);intensity=level;duration_ms=duration;apply_valid=1;
            @(posedge clk);while(!apply_ready) @(posedge clk);
            @(negedge clk);apply_valid=0;
        end
    endtask
    initial begin
        #1;reset_n=0;repeat(5) @(negedge clk);reset_n=1;
        repeat(700) @(negedge clk); //real response bank staged before selection
        apply_valid=1;intensity=32'hffffffff;duration_ms=32'hffffffff;
        host_reset_n=1;
        wait(apply_ready);@(posedge clk);@(negedge clk);apply_valid=0;
        frame();
        if(applies!=1 || last_tag!=0 || raw_intensity!=32'hffffffff || raw_duration!=32'hffffffff || motor!=17'h10000)
            $fatal(1,"First tag-zero APPLY/raw extreme/actuator saturation failed");
        if(!valid[0] || held[41] || held[42]) $fatal(1,"Initial frozen reply advertised unowned context or same-frame receipt");
        frame();
        if(!held[41] || !held[42] || held[96+:32]!=0) $fatal(1,"Later APPLY_SEEN must disambiguate accepted tagzero");
        if(held[128+:224]!=pad_words || held[352+:32]!=32'h80000001 || held[448+:32]!=32'hffff8000)
            $fatal(1,"Raw pad/buttons/wheel words were altered");
        if(held[384+:32]!=0 || held[416+:32]!=32'h00bf0000)
            $fatal(1,"Standard normalized pointer conversion/clipping failed");
        // Accepted CRC-valid context changes even without a sensor update.
        pointer_words[32+:32]=32'h8000;pointer_words[64+:32]=32'h10000;
        width=11;height=7;epoch=2;
        frame();frame();frame();
        if(device_epoch!=2 || held[384+:32]!=32'h50000 || held[416+:32]!=32'h60000)
            $fatal(1,"Context change failed to remap stationary pointer");
        width=0;height=0;epoch=3;
        frame();frame();frame();
        if(!held[41] || held[384+:32]!=32'hffff0000 || held[416+:32]!=32'hffff0000)
            $fatal(1,"Zero extent did not use deterministic empty-range clipping");
        // No accidental deduplication/coalescing of identical APPLY operands.
        apply(32'h8000,32'hffffffff);frame();
        apply(32'h8000,32'hffffffff);frame();
        if(applies!=3 || raw_duration!=32'hffffffff || motor!=17'h08000)
            $fatal(1,"Repeated APPLY or full32-bit duration was altered");
        apply(0,32'hffffffff);frame();
        if(motor!=0 || raw_duration!=32'hffffffff || remaining!=0) $fatal(1,"Zero intensity stop failed");
        apply(32'hffffffff,0);frame();
        if(motor!=0 || raw_intensity!=32'hffffffff) $fatal(1,"Zero duration stop failed");
        // Corrupt request CRC cannot commit output OR its new context fields.
        corrupt=1;width=123;epoch=4;
        apply(32'h10000,99);frame();
        if(applies!=5 || device_epoch!=3 || motor!=0) $fatal(1,"CRC-failed request changed accessory state");
        corrupt=0;
        // Abort a real host frame, leaving independently powered accessory alive.
        apply(32'h10000,99);repeat(1000) @(negedge clk);host_reset_n=0;
        repeat(20) @(negedge clk);
        if(applies!=5 || oe) $fatal(1,"Truncated transfer committed or DATA remained driven");
        host_reset_n=1;frame();
        // Last effect expires with *no serial clocks*, measured from commit.
        apply(32'h10000,3);frame();
        host_reset_n=0;
        if(motor!=17'h10000 || remaining!=3) $fatal(1,"Timed effect was not started at commit");
        repeat(67737) @(negedge accessory_clk); //<2ms after commit
        if(motor==0) $fatal(1,"Duration shortened by polling/clock phase");
        repeat(33880) @(negedge accessory_clk);
        if(motor!=0 || remaining!=0 || raw_duration!=3 || raw_intensity!=32'h10000)
            $fatal(1,"Independent millisecond expiration failed");
        if(applies!=6 || requests<12) $fatal(1,"Unexpected accepted request counts");
        $display("PASS: real PAD host/accessory SPI, CRC/abort, raw words, tagzero receipt, standard context mapping, repeat APPLY and independent actuator duration");
        $finish;
    end
    initial begin #100000000;$fatal(1,"Accessory test timeout");end
endmodule
