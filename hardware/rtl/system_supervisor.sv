`timescale 1ns/1ps
// SYSTEM supervisor/control/fault-word owner, millisecond timebase and
// diagnostic line output. This is not CPU execution, frame timing or the
// still separate GPU/GEO/IMGDEC implementations.
// Frame timing and other local addresses have distinct owners and must not
// be routed here. GPU enter/leave are synchronous
// boundary pulses to the GPU context owner, not an implemented GPU bank.
// The local register transaction is answered before a context exchange waits
// for LOCAL drain: ENTER and LEAVE must not wait on their own response.
// Book I command bits are processed RESET, ENTER, FAULT, PUBLISH, LEAVE.
// The CONTROL write is admitted even while no context boundary is ready.
// OpenHW controller uses explicit quiescence/control states at exception edges:
// https://github.com/openhwfoundation/cv32e40p/blob/master/rtl/cv32e40p_controller.sv
module system_supervisor (
    input wire clk, reset_n,
    input wire access_valid, access_write,
    input wire [31:0] access_address, access_wdata,
    output wire access_ready,
    output wire response_valid,
    output wire [31:0] response_data, response_fault,
    output wire diagnostic_valid,
    output wire [7:0] diagnostic_data,
    input wire diagnostic_ready,
    input wire cpu_user_mode,
    input wire [31:0] cpu_cause, cpu_epc, cpu_bad_address, cpu_lua_reason, cpu_domain,
    input wire supervisor_edge, cpu_nmi_accepted, reset_taken,
    input wire geo_quiescent, imgdec_quiescent, gpu_quiescent,
    input wire dma_local_boundary_ready,
    output wire producer_quiesce, gpu_control_quiesce, gpu_boundary_quiesce,
    output wire dma_trigger_inhibit, dma_admission_inhibit,
    output wire apu_voice_hold, cpu_boundary_hold, cpu_local_withdraw,
    output reg enter_supervisor, leave_supervisor, gpu_enter, gpu_leave,
    output wire nmi_request, reset_request,
    output wire [31:0] status_word
);
    localparam [2:0] USER=0, PRODUCER=1, BUS=2, GPU=3, VECTOR=4, ACTIVE=5;
    localparam [1:0] TARGET_USER=0, TARGET_SUPERVISOR=1, TARGET_FAULT=2;
    reg [2:0] phase, next_phase;
    reg [1:0] target, next_target;
    reg resumable, exit_requested, nmi, reset_pending;
    reg next_resumable, next_exit, next_nmi, next_reset;
    reg activation_pending, gpu_activation_pending, return_pending;
    // These are physical context ownership states, changed only when the
    // corresponding synchronous exchange pulse is sampled by its owner.
    reg context_banked, gpu_supervisor;
    reg next_activation_pending, next_gpu_activation_pending, next_return_pending;
    reg [31:0] sequence_word, cause_word, epc_word, bad_word, lua_word, domain_word;
    reg [31:0] next_sequence, next_cause, next_epc, next_bad, next_lua, next_domain;
    reg next_enter, next_leave, next_gpu_enter, next_gpu_leave;
    wire [31:0] time_ms;
    system_time timebase(.clk(clk),.reset_n(reset_n),.time_ms(time_ms));
    wire diagnostic_selected=access_address==32'h08010230 || access_address==32'h08010234;
    wire diagnostic_access_ready,diagnostic_response_valid;
    wire [31:0] diagnostic_response_data;
    reg local_response_valid;
    reg [31:0] local_response_data,local_response_fault;
    system_debug_transmit diagnostic(.clk(clk),.reset_n(reset_n),
        .access_valid(access_valid && diagnostic_selected),.access_write(access_write),
        .access_address(access_address),.access_wdata(access_wdata),.access_ready(diagnostic_access_ready),
        .response_valid(diagnostic_response_valid),.response_data(diagnostic_response_data),
        .byte_valid(diagnostic_valid),.byte_data(diagnostic_data),.byte_ready(diagnostic_ready));
    assign response_valid=local_response_valid || diagnostic_response_valid;
    assign response_data=diagnostic_response_valid ? diagnostic_response_data : local_response_data;
    assign response_fault=diagnostic_response_valid ? 32'd0 : local_response_fault;
    wire command = access_valid && access_ready && access_write && access_address==32'h0801034c;
    wire [31:0] control = command ? access_wdata : 0;
    wire operational_active = phase==ACTIVE && !activation_pending && !gpu_activation_pending && !enter_supervisor && !gpu_enter;
    assign access_ready=diagnostic_selected ? diagnostic_access_ready : 1'b1;
    // A logical ENTER can be followed by other bits in the same CONTROL
    // word, but RESUMABLE is externally visible only after IRQ/DMA and GPU
    // have consumed their physical context-exchange pulses.
    wire context_ready = resumable && !activation_pending && !gpu_activation_pending &&
                         !enter_supervisor && !gpu_enter;
    assign status_word={29'd0,context_ready,exit_requested,(phase!=USER)};
    assign nmi_request=nmi;
    assign reset_request=reset_pending;
    assign producer_quiesce=phase!=USER;
    assign gpu_control_quiesce=phase!=USER && !operational_active;
    assign dma_trigger_inhibit=phase!=USER && !operational_active;
    assign dma_admission_inhibit=(phase==BUS || phase==GPU || phase==VECTOR ||
                                  activation_pending || gpu_activation_pending || return_pending || enter_supervisor || gpu_enter || leave_supervisor || gpu_leave);
    assign gpu_boundary_quiesce=(phase==GPU || phase==VECTOR || activation_pending ||
                                 gpu_activation_pending || return_pending || enter_supervisor || gpu_enter || leave_supervisor || gpu_leave);
    assign apu_voice_hold=phase!=USER || leave_supervisor;
    // CPU may run in producer quiescence. Once DMA drain starts, stop the old
    // producer, withdraw only a still-unaccepted local write and retain its PC.
    // VECTOR releases CPU for NMI/ENTER except during physical bank exchange.
    assign cpu_boundary_hold=(phase==BUS || phase==GPU || activation_pending ||
                              gpu_activation_pending || return_pending || enter_supervisor || gpu_enter || leave_supervisor || gpu_leave);
    assign cpu_local_withdraw=cpu_boundary_hold;
    always @* begin
        next_phase=phase;next_target=target;next_resumable=resumable;next_exit=exit_requested;
        next_nmi=nmi;next_reset=reset_pending;next_sequence=sequence_word;
        next_cause=cause_word;next_epc=epc_word;next_bad=bad_word;next_lua=lua_word;next_domain=domain_word;
        next_activation_pending=activation_pending;next_gpu_activation_pending=gpu_activation_pending;
        next_return_pending=return_pending;
        next_enter=0;next_leave=0;next_gpu_enter=0;next_gpu_leave=0;
        if(reset_taken) next_reset=0;
        if(cpu_nmi_accepted) next_nmi=0;
        if(supervisor_edge) begin
            if(next_phase==USER) begin
                next_phase=PRODUCER;next_target=TARGET_SUPERVISOR;next_resumable=0;
            end else if(next_phase==ACTIVE && context_ready) next_exit=1;
        end
        if(control[0]) next_reset=1;
        if(!cpu_user_mode) begin
            if(control[1] && next_phase==VECTOR) begin
                next_phase=ACTIVE;next_resumable=1;next_target=TARGET_SUPERVISOR;
                next_activation_pending=1;
            end
            if(control[3]) begin
                next_cause=cpu_cause;next_epc=cpu_epc;next_bad=cpu_bad_address;
                next_lua=cpu_lua_reason;next_domain=cpu_domain;
                if(next_phase!=ACTIVE) begin
                    next_nmi=0;
                    if(next_phase==USER) next_phase=PRODUCER;
                    next_target=TARGET_FAULT;next_resumable=0;
                end
            end
            if(control[4]) next_sequence=sequence_word+1'b1;
            if(control[2] && next_phase==ACTIVE && next_resumable) begin
                next_phase=BUS;next_target=TARGET_USER;next_exit=0;
            end
        end
        // Context loads are explicit hardware transactions. They occur after
        // the causing CONTROL acknowledgement leaves the local bus.
        if(activation_pending && dma_local_boundary_ready && !command && !supervisor_edge) begin
            // A FAULT can redirect a LEAVE while the user IRQ/DMA bank is
            // already retained. Re-entering would overwrite that bank.
            if(!context_banked) next_enter=1;
            next_activation_pending=0;
            if(!gpu_supervisor) next_gpu_activation_pending=1;
        end else if(gpu_activation_pending && !command && !supervisor_edge) begin
            next_gpu_enter=1;next_gpu_activation_pending=0;
        end else if(return_pending && !command && !supervisor_edge && target==TARGET_FAULT) begin
            // GPU has been asked to restore; re-enter it after that pulse is
            // consumed, without re-banking still-retained IRQ/DMA state.
            next_return_pending=0;next_phase=ACTIVE;next_resumable=1;next_activation_pending=1;
        end else if(return_pending && dma_local_boundary_ready && !command && !supervisor_edge) begin
            // Present LEAVE for one full clock; the IRQ/DMA owner samples it
            // on the next edge. Keep ACTIVE and RESUMABLE until that edge.
            next_leave=1;next_return_pending=0;
        end else if(leave_supervisor) begin
            if(command && !cpu_user_mode && control[3]) begin
                // IRQ/DMA consume the already-issued restore on this edge.
                // A simultaneous FAULT must re-bank the now-restored user
                // context instead of dropping the redirected transition.
                next_phase=ACTIVE;next_resumable=1;next_activation_pending=1;
            end else begin next_phase=USER;next_target=TARGET_USER;next_resumable=0;end
        end else if(!command && !supervisor_edge && !activation_pending && !gpu_activation_pending && !return_pending) begin
            case(phase)
                PRODUCER: if(geo_quiescent && imgdec_quiescent) next_phase=BUS;
                BUS: if(dma_local_boundary_ready) next_phase=GPU;
                GPU: if(gpu_quiescent) begin
                    if(target==TARGET_SUPERVISOR) begin next_phase=VECTOR;next_nmi=1;end
                    else if(target==TARGET_FAULT) begin
                        next_phase=ACTIVE;next_resumable=1;next_activation_pending=1;
                    end else begin
                        next_gpu_leave=1;next_return_pending=1;
                    end
                end
                default: begin end
            endcase
        end
    end
    always @(posedge clk or negedge reset_n) begin
        if(!reset_n) begin
            phase<=USER;target<=TARGET_USER;resumable<=0;exit_requested<=0;nmi<=0;reset_pending<=0;
            activation_pending<=0;gpu_activation_pending<=0;return_pending<=0;
            context_banked<=0;gpu_supervisor<=0;
            sequence_word<=0;cause_word<=0;epc_word<=0;bad_word<=0;lua_word<=0;domain_word<=0;
            enter_supervisor<=0;leave_supervisor<=0;gpu_enter<=0;gpu_leave<=0;
            local_response_valid<=0;local_response_data<=0;local_response_fault<=0;
        end else begin
            phase<=next_phase;target<=next_target;resumable<=next_resumable;exit_requested<=next_exit;
            nmi<=next_nmi;reset_pending<=next_reset;activation_pending<=next_activation_pending;
            gpu_activation_pending<=next_gpu_activation_pending;return_pending<=next_return_pending;
            sequence_word<=next_sequence;cause_word<=next_cause;epc_word<=next_epc;
            bad_word<=next_bad;lua_word<=next_lua;domain_word<=next_domain;
            enter_supervisor<=next_enter;leave_supervisor<=next_leave;
            gpu_enter<=next_gpu_enter;gpu_leave<=next_gpu_leave;
            if(enter_supervisor) context_banked<=1;
            if(leave_supervisor) context_banked<=0;
            if(gpu_enter) gpu_supervisor<=1;
            if(gpu_leave) gpu_supervisor<=0;
            local_response_valid<=access_valid && access_ready && !diagnostic_selected;
            if(access_valid && access_ready && !diagnostic_selected) begin
                local_response_data<=0;local_response_fault<=0;
                case(access_address)
                    // If a read coincides with the increment edge, the bus
                    // samples the pre-edge word; the next read sees the tick.
                    32'h08010228: begin local_response_data<=time_ms;if(access_write) local_response_fault<=3;end
                    32'h0801034c: local_response_data<=0;
                    32'h08010350: begin local_response_data<=status_word;if(access_write) local_response_fault<=3;end
                    32'h08010428: begin local_response_data<=sequence_word;if(access_write) local_response_fault<=3;end
                    32'h0801042c: begin local_response_data<=cause_word;if(access_write) local_response_fault<=3;end
                    32'h08010430: begin local_response_data<=epc_word;if(access_write) local_response_fault<=3;end
                    32'h08010434: begin local_response_data<=bad_word;if(access_write) local_response_fault<=3;end
                    32'h08010438: begin local_response_data<=lua_word;if(access_write) local_response_fault<=3;end
                    32'h0801043c: begin local_response_data<=domain_word;if(access_write) local_response_fault<=3;end
                endcase
            end
        end
    end
endmodule
