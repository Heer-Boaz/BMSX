`timescale 1ns/1ps
module imgdec_payload_tb;
    reg clk=0; always #5 clk=!clk;
    reg reset_n=0, stream_start=0, input_valid=0, output_ready=1;
    reg [31:0] input_word=0;
    wire input_ready, output_valid, between_tokens, needs_input, format_fault;
    wire [31:0] output_word, decoded_words;
    reg [31:0] expected [0:5000];
    reg [31:0] held_word, held_count;
    integer received=0, expected_count=0, i;
    wire [31:0] run_remaining; wire literal_mode;
    imgdec_payload dut (.*);

    always @(posedge clk) if (reset_n && output_valid && output_ready) begin
        if (received >= expected_count || output_word !== expected[received])
            $fatal(1,"payload mismatch index=%0d got=%h expected=%h",received,output_word,expected[received]);
        received=received+1;
    end

    task automatic send(input [31:0] word);
        begin
            @(negedge clk); input_word=word; input_valid=1;
            @(posedge clk); while (!input_ready) @(posedge clk);
            @(negedge clk); input_valid=0;
        end
    endtask
    task automatic drain;
        begin
            while (received != expected_count) @(negedge clk);
            repeat (2) @(negedge clk);
            if (decoded_words !== expected_count || !between_tokens || format_fault)
                $fatal(1,"unexpected completed run state count=%0d expected=%0d",decoded_words,expected_count);
        end
    endtask
    task automatic fresh;
        begin
            @(negedge clk);stream_start=1;
            @(negedge clk);stream_start=0;
            received=0;expected_count=0;
        end
    endtask
    initial begin
        repeat (3) @(negedge clk); reset_n=1;
        // Book I's 12-word texture payload: literal, repeat, back-reference,
        // then zeros. Generated packet headers are outside this block.
        expected[0]=32'h11112222; expected[1]=32'h33334444;
        expected[2]=32'h55556666; expected[3]=32'h55556666;
        expected[4]=expected[0]; expected[5]=expected[1];
        expected[6]=expected[2]; expected[7]=expected[3];
        expected[8]=0; expected[9]=0; expected[10]=0; expected[11]=0;
        expected_count=12;
        send(32'h00000001); send(expected[0]); send(expected[1]);
        send(32'h40000001); send(expected[2]);
        send(32'h80001003); send(32'hc0000003);
        drain();
        // Thirteen words back is invalid when only twelve are in history.
        send(32'h8000000c);
        @(negedge clk);
        if (!format_fault || decoded_words!=12 || output_valid) $fatal(1,"invalid distance accepted");
        fresh();
        send(32'h80000000);
        @(negedge clk);
        if (!format_fault || decoded_words!=0 || output_valid) $fatal(1,"old stream history survived");
        fresh();
        // A,B,R,R,0 followed by an eleven-word distance-five copy. This
        // repeats words produced during the same back-reference run.
        expected[0]=32'h11112222;expected[1]=32'h33334444;
        expected[2]=32'h55556666;expected[3]=expected[2];expected[4]=0;
        for(i=5;i<16;i=i+1) expected[i]=expected[i-5];
        expected_count=16;
        send(32'h00000004);
        // Hold a literal stable for three clocks while output is blocked.
        @(negedge clk); output_ready=0;input_valid=1;input_word=expected[0];
        repeat(3) begin @(posedge clk); #1;
            if (!output_valid || input_ready || output_word!==expected[0] || decoded_words!=0)
                $fatal(1,"literal advanced while output stalled");
        end
        @(negedge clk);output_ready=1;
        @(posedge clk);@(negedge clk);input_valid=0;
        for(i=1;i<5;i=i+1) send(expected[i]);
        send(32'h80008004);
        // A blocked reference must not advance history or its output word.
        wait(output_valid); @(negedge clk); output_ready=0;
        held_word=output_word;held_count=decoded_words;
        repeat(3) begin @(posedge clk);#1;
            if (!output_valid || output_word!==held_word || decoded_words!==held_count)
                $fatal(1,"reference changed while stalled");
        end
        @(negedge clk);output_ready=1;
        drain();
        fresh();
        // Fill the complete ring with distinguishable data, then read with
        // distance 4096 across the write-index wrap and same-address reuse.
        for(i=0;i<4096;i=i+1) expected[i]=32'h5a000000 ^ i;
        expected[4096]=expected[0];expected[4097]=expected[1];expected[4098]=expected[2];
        expected_count=4099;
        send(32'd4095);
        for(i=0;i<4096;i=i+1) send(expected[i]);
        send(32'h80000fff);
        drain();
        fresh();
        // Full-width zero-run word is representable: count 2^30, not zero.
        // Stop after its first word; a surrounding stream owner decides the
        // endpoint and reports an overlong tail at the specified boundary.
        expected[0]=0;expected_count=1;
        output_ready=0;
        send(32'hffffffff);
        if (dut.remaining!==32'h40000000 || !output_valid)
            $fatal(1,"maximum zero-run length decoded incorrectly");
        @(negedge clk);output_ready=1;
        @(posedge clk);@(negedge clk);output_ready=0;
        if (received!=1 || dut.remaining!==32'h3fffffff || between_tokens)
            $fatal(1,"maximum zero-run did not retain its remaining words");
        $display("PASS IMGDEC payload: four token kinds, overlap, stalls, reset, invalid distance and full 4096-word ring");
        $finish;
    end
    initial begin #5000000; $fatal(1,"IMGDEC payload watchdog"); end
endmodule
