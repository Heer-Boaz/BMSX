`timescale 1ns/1ps
// Exercise the real U7 INPUT producer plus U1 receiver with split-clock phase
// and delayed open-drain release. Delays model digital threshold crossings, not
// analogue Schmitt/RC qualification or synchronizer metastability simulation.
module core_events_case #(
    parameter real PHASE_NS = 0,
    parameter real RELEASE_NS = 0
) (output reg done = 0);
    reg clk_io=0, clk_core=0;
    always #14.762849584278 clk_io=!clk_io;
    initial begin #(PHASE_NS); forever #14.762849584278 clk_core=!clk_core; end
    reg reset_n=1, vblank_evt=0, vblank_consume=0;
    reg io_vblank=0, supervisor_request=0;
    reg access_valid=0;
    reg [5:0] word_index=0;
    reg [31:0] write_word=0;
    wire [31:0] read_word;
    wire producer_event;
    reg direct_mode=0, direct_low=0;
    wire drive_low=direct_mode ? direct_low : producer_event;
    tri1 supervisor_n;
    assign #(0,0,RELEASE_NS) supervisor_n=drive_low ? 1'b0 : 1'bz;
    wire supervisor_event, vblank_event, vblank_pending;
    integer supervisor_count=0, vblank_count=0;
    integer before_supervisor, before_vblank;

    io_registerfile producer (
        .clk(clk_io), .reset_n(reset_n), .vblank_begin(io_vblank),
        .supervisor_request(supervisor_request), .keyboard_words(256'd0),
        .held_reply(2048'd0), .snapshot_taken(), .supervisor_edge(producer_event),
        .access_valid(access_valid), .access_write(1'b1), .word_index(word_index),
        .write_word(write_word), .access_ready(), .read_word(read_word), .fault_code(),
        .apply_valid(), .apply_ready(1'b1), .apply_port(),
        .apply_intensity(), .apply_duration_ms()
    );
    core_events dut (.clk(clk_core), .reset_n(reset_n), .supervisor_n(supervisor_n),
        .vblank_evt(vblank_evt), .vblank_consume(vblank_consume),
        .supervisor_event(supervisor_event), .vblank_event(vblank_event),
        .vblank_pending(vblank_pending));

    always @(posedge clk_core) if (reset_n) begin
        // A high event on successive cycles means successive source events,
        // not a demand for an artificial low-cycle gap in the GFX producer.
        if (supervisor_event) supervisor_count=supervisor_count+1;
        if (vblank_event) vblank_count=vblank_count+1;
    end
    task automatic settle;
        begin repeat(12) @(negedge clk_core); end
    endtask
    task automatic sample_input;
        begin
            @(negedge clk_io); io_vblank=1; vblank_evt=!vblank_evt;
            @(negedge clk_io); io_vblank=0;
        end
    endtask
    task automatic control(input [31:0] value);
        begin
            @(negedge clk_io);access_valid=1;word_index=0;write_word=value;
            @(negedge clk_io);access_valid=0;
        end
    endtask
    task automatic consume;
        begin
            @(negedge clk_core);vblank_consume=1;
            @(negedge clk_core);vblank_consume=0;
        end
    endtask
    task automatic direct_pulse;
        begin
            @(negedge clk_io);direct_low=1;
            @(negedge clk_io);direct_low=0;
            settle();
        end
    endtask
    initial begin
        #1;reset_n=0;vblank_evt=0;
        repeat(5) @(negedge clk_io);reset_n=1;settle();
        if(supervisor_count || vblank_count || vblank_pending)
            $fatal(1,"Reset created an event");
        // Real U7 producer emits independently of ARM; held raw button gives
        // only one event even across INPUT RESET, exactly as the TS/C++ owner.
        supervisor_request=1;sample_input();settle();
        if(supervisor_count!=1 || vblank_count!=1 || !vblank_pending)
            $fatal(1,"Unarmed request/VBlank was lost across clock skew");
        word_index=1;#1;
        if(read_word!=0) $fatal(1,"Unarmed observation published INPUT");
        sample_input();settle();
        control(2);sample_input();settle();
        if(supervisor_count!=1 || !vblank_pending)
            $fatal(1,"Held button or INPUT RESET altered independent event state");
        control(1);sample_input();settle();word_index=1;#1;
        if(read_word!=1 || supervisor_count!=1)
            $fatal(1,"ARM publication changed supervisor edge history");
        supervisor_request=0;sample_input();settle();
        supervisor_request=1;sample_input();settle();
        if(supervisor_count!=2) $fatal(1,"Released/repressed request was not received");
        // No supervisor consume or phase input exists: the pulse must expire
        // even when a SYSTEM stage ignores it. It cannot replay on later USER.
        before_supervisor=supervisor_count;settle();
        if(supervisor_count!=before_supervisor || supervisor_event)
            $fatal(1,"Supervisor boundary retained/replayed an ignored event");
        consume();settle();
        if(vblank_pending) $fatal(1,"VBlank consume failed");
        // New VBlank wins a simultaneous consume, rather than disappearing.
        sample_input();wait(vblank_event);
        @(negedge clk_core);vblank_consume=1;
        @(posedge clk_core);#1;
        if(!vblank_pending) $fatal(1,"Concurrent consume lost new VBlank");
        @(negedge clk_core);vblank_consume=0;settle();
        before_vblank=vblank_count;sample_input();settle();sample_input();settle();
        if(vblank_count!=before_vblank+2 || !vblank_pending)
            $fatal(1,"Both toggle polarities or pending coalescence failed");
        // Common-reference branches can carry one sampled toggle per SYS clock.
        // CDC latency does not impose a four-clock source-spacing restriction.
        before_vblank=vblank_count;
        repeat(16) begin @(negedge clk_io);vblank_evt=!vblank_evt;end
        settle();
        if(vblank_count!=before_vblank+16 || !vblank_pending)
            $fatal(1,"One-toggle-per-SYS throughput was changed by receiver latency");
        // Drive the actual pin directly for held-low, one-CLK_IO and sub-clock
        // capture cases, without replacing the event receiver with a fake peer.
        direct_mode=1;before_supervisor=supervisor_count;
        @(negedge clk_io);direct_low=1;settle();settle();
        if(supervisor_count!=before_supervisor+1)
            $fatal(1,"Held-low pin repeated/dropped an event");
        direct_low=0;settle();
        if(supervisor_count!=before_supervisor+1)
            $fatal(1,"Slow open-drain rise created an event");
        repeat(4) direct_pulse();
        if(supervisor_count!=before_supervisor+5)
            $fatal(1,"One-CLK_IO pin pulses were lost");
        // Entire low pulse can lie between CORE samples (RELEASE_NS=0). A
        // naive direct two-flop pulse receiver would not capture that case.
        @(negedge clk_core);#1;direct_low=1;#5;direct_low=0;settle();
        if(supervisor_count!=before_supervisor+6)
            $fatal(1,"Pin-edge capture depended on a CORE sampling instant");
        // Consuming one source never masks the other; both events are present.
        before_supervisor=supervisor_count;before_vblank=vblank_count;
        @(negedge clk_io);direct_low=1;vblank_evt=!vblank_evt;
        @(negedge clk_io);direct_low=0;
        wait(vblank_event);@(negedge clk_core);vblank_consume=1;
        @(posedge clk_core);#1;
        if(!vblank_pending) $fatal(1,"Concurrent VBlank event was not set-dominant");
        @(negedge clk_core);vblank_consume=0;settle();
        if(supervisor_count!=before_supervisor+1 || vblank_count!=before_vblank+1)
            $fatal(1,"Event sources interfered with one another");
        // Shared hardware reset clears queued IRQ and CDC history. An assertion
        // while reset is held is not replayed when its pin later rises.
        reset_n=0;vblank_evt=0;direct_low=0;settle();
        direct_low=1;settle();
        before_supervisor=supervisor_count;before_vblank=vblank_count;
        reset_n=1;settle();direct_low=0;settle();
        if(vblank_pending || supervisor_count!=before_supervisor || vblank_count!=before_vblank)
            $fatal(1,"Reset replayed stale pin/toggle state");
        direct_pulse();sample_input();settle();
        if(supervisor_count!=before_supervisor+1 || vblank_count!=before_vblank+1)
            $fatal(1,"Fresh post-reset events failed");
        done=1;
    end
endmodule

module core_events_tb;
    wire [7:0] done;
    genvar i;
    generate for(i=0;i<8;i=i+1) begin : skew
        core_events_case #(.PHASE_NS(i==0 ? 0 : i==1 ? 0.001 :
            i==2 ? 14.761 : i==3 ? 14.764 : i==4 ? 29.524 : (i-4)*5.0),
            .RELEASE_NS(i<4 ? 0 : 70)) check_case (.done(done[i]));
    end endgenerate
    initial begin
        wait(&done);
        $display("PASS: CORE event-clock capture, eight clock-skew/open-drain-rise cases, real U7 ARM/RESET independence, held/repressed supervisor, VBlank toggle/pending/consume and shared reset");
        $finish;
    end
    initial begin #100000;$fatal(1,"CORE event test timeout");end
endmodule
