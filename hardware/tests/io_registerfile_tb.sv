`timescale 1ns/1ps
module io_registerfile_tb;
    reg clk=0;
    always #5 clk=!clk;
    reg reset_n=1, vblank_begin=0, supervisor_request=0;
    reg [255:0] keyboard_words=0;
    reg [2047:0] held_reply=0;
    wire snapshot_taken, supervisor_edge;
    reg access_valid=0, access_write=0;
    reg [5:0] word_index=0;
    reg [31:0] write_word=0;
    wire access_ready;
    wire [31:0] read_word, fault_code;
    wire apply_valid;
    reg apply_ready=1;
    wire [1:0] apply_port;
    wire [31:0] apply_intensity, apply_duration_ms;
    integer samples=0, supervisor_edges=0;
    reg source_update=0;
    io_registerfile dut (.*);
    always @(posedge clk) begin
        if (snapshot_taken) samples=samples+1;
        // Producer update and consumer publication share an edge: the old
        // bank is the published observation, never a mixture of both banks.
        if (source_update) begin
            keyboard_words <= {8{32'hf00dcafe}};
            held_reply[128 +:224] <= {7{32'hfedcba98}};
        end
    end
    always @(negedge clk) if (supervisor_edge) supervisor_edges=supervisor_edges+1;
    task automatic tick; @(posedge clk); #1; endtask
    task automatic check_word(input [5:0] index,input [31:0] expected);
        word_index=index; #1;
        if (read_word !== expected) $fatal(1,"Register %0d got %h expected %h",index,read_word,expected);
    endtask
    task automatic store(input [5:0] index,input [31:0] value);
        @(negedge clk); access_valid=1; access_write=1; word_index=index; write_word=value;
        #1; if (!access_ready || fault_code != 0) $fatal(1,"Writable access not admitted");
        tick(); @(negedge clk); access_valid=0; access_write=0;
    endtask
    task automatic blank;
        @(negedge clk); vblank_begin=1; tick(); @(negedge clk); vblank_begin=0;
    endtask
    initial begin
        #2; reset_n=0; tick(); reset_n=1; tick();
        for (integer i=0;i<47;i=i+1) check_word(i,0);
        for (integer i=0;i<8;i=i+1) keyboard_words[i*32 +:32]=32'h80000000+i;
        for (integer p=0;p<4;p=p+1) begin
            held_reply[p*512+64 +:32]=32'h1000000f << p;
            for (integer i=0;i<7;i=i+1) held_reply[p*512+128+i*32 +:32]=32'hcafe0000+p*7+i;
            held_reply[p*512+352 +:128]={4{32'hdead0000+p}};
        end
        held_reply[512+41]=1; held_reply[1536+41]=1;
        blank(); check_word(1,0); check_word(2,0);
        store(0,1); store(0,3); check_word(0,3);
        blank(); check_word(1,1);
        for (integer i=0;i<8;i=i+1) check_word(2+i,32'h80000000+i);
        for (integer i=0;i<4;i=i+1) check_word(10+i,32'hdead0001);
        for (integer i=0;i<28;i=i+1) check_word(14+i,32'hcafe0000+i);
        check_word(45,32'hf0000071);
        blank(); check_word(1,1); // one request, not a queue

        // All publication words and STATUS reject stores without mutation.
        for (integer i=1;i<=45;i=i+1) if (i<=41 || i==45) begin
            @(negedge clk); word_index=i; access_valid=1; access_write=1; write_word=32'hffffffff;
            #1; if (!access_ready || fault_code !== 3) $fatal(1,"Readonly code lost at %0d",i);
            tick(); @(negedge clk); access_valid=0; access_write=0;
        end
        check_word(1,1); check_word(14,32'hcafe0000); check_word(45,32'hf0000071);
        store(42,32'hffffffff); store(43,32'h80000001); store(44,32'hffffffff);
        if (apply_port !== 3 || apply_intensity !== 32'h80000001 || apply_duration_ms !== 32'hffffffff)
            $fatal(1,"Output operands were normalized");
        store(46,3); check_word(46,0);
        @(negedge clk); word_index=46; write_word=1; access_write=1; access_valid=1; apply_ready=0;
        #1; if (!apply_valid || access_ready) $fatal(1,"APPLY did not wait for admission");
        repeat(7) tick();
        @(negedge clk); apply_ready=1; #1;
        if (!access_ready || !apply_valid) $fatal(1,"Ready frame did not accept APPLY");
        tick(); @(negedge clk); access_valid=0; access_write=0;
        check_word(46,0);

        // Same-edge acquisition uses old data; concurrent ARM preserves the
        // following request even when an existing request is consumed.
        store(0,1);
        @(negedge clk); source_update=1; vblank_begin=1;
        access_valid=1; access_write=1; word_index=0; write_word=1;
        tick(); @(negedge clk); source_update=0; vblank_begin=0; access_valid=0; access_write=0;
        check_word(1,2); check_word(2,32'h80000000); check_word(14,32'hcafe0000);
        blank(); check_word(1,3); check_word(2,32'hf00dcafe); check_word(14,32'hfedcba98);
        // Supervisor history is observed even without ARM and survives RESET.
        supervisor_request=1; blank();
        if (supervisor_edges != 1) $fatal(1,"Missing unarmed supervisor edge");
        blank(); store(0,2); blank();
        if (supervisor_edges != 1) $fatal(1,"RESET manufactured another supervisor edge");
        for (integer i=0;i<47;i=i+1) check_word(i,0);
        supervisor_request=0; blank(); supervisor_request=1; blank();
        if (supervisor_edges != 2) $fatal(1,"New supervisor transition lost");
        // Input RESET keeps source banks; next ARM can republish their words.
        store(0,1); blank(); check_word(2,32'hf00dcafe); check_word(14,32'hfedcba98);
        held_reply[512+41]=0; held_reply[1536+41]=0;
        store(0,1); blank(); check_word(10,32'hdead0001);
        // ARM on an unarmed VBlank does not retroactively capture that edge.
        @(negedge clk); vblank_begin=1; access_valid=1; access_write=1; word_index=0; write_word=1;
        tick(); @(negedge clk); vblank_begin=0; access_valid=0; access_write=0;
        check_word(1,2); blank(); check_word(1,3);
        // RESET on an armed VBlank suppresses publication (also its consume
        // handshake), but does not suppress supervisor-wire sampling.
        supervisor_request=0; blank(); supervisor_request=1; store(0,1);
        @(negedge clk); vblank_begin=1; access_valid=1; access_write=1; word_index=0; write_word=2;
        #1; if (snapshot_taken) $fatal(1,"RESET consumed keyboard source state");
        tick(); @(negedge clk); vblank_begin=0; access_valid=0; access_write=0;
        check_word(1,0); check_word(14,0);
        if (supervisor_edges != 3) $fatal(1,"RESET suppressed supervisor transition");
        reset_n=0; tick(); reset_n=1; blank();
        if (supervisor_edges != 4) $fatal(1,"Whole-unit reset did not initialize edge history");
        $display("PASS io_registerfile samples=%0d supervisor_edges=%0d raw_words=41",samples,supervisor_edges);
        $finish;
    end
    initial begin #100000; $fatal(1,"Registerfile watchdog"); end
endmodule
