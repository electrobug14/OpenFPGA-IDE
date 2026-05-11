import { useState, useRef, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

// ─── Theme ────────────────────────────────────────────────────────────────────
const T = {
  bg: "#0d0f14", panel: "#13161e", border: "#1e2433",
  accent: "#00d4aa", accentDim: "#007a62",
  warn: "#ffaa00", error: "#ff4455", success: "#00d4aa",
  text: "#c8d0e0", textDim: "#4a5568", textBright: "#eef2ff",
  blue: "#4da6ff", purple: "#b07fff", orange: "#ff8c42",
};

// ─── Syntax Highlighter ───────────────────────────────────────────────────────
function highlight(code) {
  const escaped = code
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return escaped
    .replace(/(\/\/[^\n]*)/g, '<span style="color:#4a5568;font-style:italic">$1</span>')
    .replace(/(\/\*[\s\S]*?\*\/)/g, '<span style="color:#4a5568;font-style:italic">$1</span>')
    .replace(/("(?:[^"\\]|\\.)*")/g, '<span style="color:#ffd080">$1</span>')
    .replace(/(`\w+)/g, '<span style="color:#ff8c42">$1</span>')
    .replace(/\b(module|endmodule|input|output|inout|wire|reg|logic|always|initial|begin|end|if|else|case|endcase|posedge|negedge|assign|parameter|localparam|generate|endgenerate|for|while|integer|task|endtask|function|endfunction|timescale|include|define|ifdef|endif|bit|byte|int|real|time|supply0|supply1|tri|xor|xnor|and|or|nor|nand|not|buf)\b/g,
      '<span style="color:#4da6ff;font-weight:600">$1</span>')
    .replace(/\b(\d[\d_]*(?:\'[bhdo]\w+)?)\b/g, '<span style="color:#b07fff">$1</span>');
}

// ─── Default project files ────────────────────────────────────────────────────
const DEFAULT_FILES = {
  "top.v": `\`timescale 1ns / 1ps
// 4-bit Synchronous ALU
module alu_top (
    input  wire        clk,
    input  wire        rst_n,
    input  wire [3:0]  a,
    input  wire [3:0]  b,
    input  wire [2:0]  op,
    output reg  [4:0]  result,
    output reg         zero_flag,
    output reg         carry_flag
);
  localparam ADD=3'd0, SUB=3'd1, AND=3'd2, OR=3'd3,
             XOR=3'd4, NOT=3'd5, SHL=3'd6, SHR=3'd7;

  always @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin
      result <= 0; zero_flag <= 0; carry_flag <= 0;
    end else begin
      case (op)
        ADD: {carry_flag, result[3:0]} <= a + b;
        SUB: result <= a - b;
        AND: result <= a & b;
        OR:  result <= a | b;
        XOR: result <= a ^ b;
        NOT: result <= ~a;
        SHL: result <= a << 1;
        SHR: result <= a >> 1;
        default: result <= 0;
      endcase
      zero_flag <= (result == 0);
    end
  end
endmodule`,

  "tb_top.v": `\`timescale 1ns / 1ps
module tb_alu_top;
  reg clk, rst_n;
  reg [3:0] a, b;
  reg [2:0] op;
  wire [4:0] result;
  wire zero_flag, carry_flag;

  alu_top dut (.clk(clk),.rst_n(rst_n),.a(a),.b(b),
               .op(op),.result(result),
               .zero_flag(zero_flag),.carry_flag(carry_flag));

  initial clk = 0;
  always #5 clk = ~clk;

  initial begin
    $dumpfile("wave.vcd");
    $dumpvars(0, tb_alu_top);
    rst_n=0; a=0; b=0; op=0; #15;
    rst_n=1;
    @(posedge clk); a=5;  b=3;  op=3'b000; // ADD=8
    @(posedge clk); a=9;  b=4;  op=3'b001; // SUB=5
    @(posedge clk); a=4'hA; b=4'h6; op=3'b010; // AND
    @(posedge clk); a=4'hA; b=4'h5; op=3'b011; // OR
    @(posedge clk); a=4'hF; b=4'h5; op=3'b100; // XOR
    @(posedge clk); a=4'b1010; op=3'b101; // NOT
    #20; $finish;
  end
endmodule`,

  "constraints.pcf": `# iCE40 pin constraints
set_io clk   J3
set_io rst_n R9
set_io a[0]  B1
set_io a[1]  B2
set_io a[2]  C2
set_io a[3]  C1
set_io b[0]  D1
set_io b[1]  D2
set_io b[2]  E2
set_io b[3]  E1
set_io result[0] R1
set_io result[1] P2
set_io result[2] P1
set_io result[3] N2
set_io result[4] N1`,
};

// ─── Waveform canvas ──────────────────────────────────────────────────────────
function WaveformViewer({ vcdPath }) {
  const canvasRef = useRef(null);
  const [cursor, setCursor] = useState(null);
  const [vcdLoaded, setVcdLoaded] = useState(false);

  // Synthetic wave data (in real app we'd parse the VCD file)
  const signals = [
    { name: "clk",        vals: [0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1], bits:1 },
    { name: "rst_n",      vals: [0,0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1], bits:1 },
    { name: "a[3:0]",     vals: [0,0,0,5,5,9,9,10,10,10,10,15,15,10,10,10,10,10], bits:4 },
    { name: "b[3:0]",     vals: [0,0,0,3,3,4,4,6, 6, 5, 5, 5, 5, 5, 5, 5, 5, 5], bits:4 },
    { name: "op[2:0]",    vals: [0,0,0,0,0,1,1,2, 2, 3, 3, 4, 4, 5, 5, 5, 5, 5], bits:3 },
    { name: "result[4:0]",vals: [0,0,0,0,8,8,5,5, 2, 2,15,15,10,10, 5, 5, 5, 5], bits:5 },
    { name: "zero_flag",  vals: [0,0,0,0,0,0,0,0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], bits:1 },
    { name: "carry_flag", vals: [0,0,0,0,0,0,0,0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], bits:1 },
  ];
  const totalTime = 90, rowH = 34, labelW = 130, padTop = 28, steps = 18;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#0d0f14";
    ctx.fillRect(0, 0, W, H);

    const stepW = (W - labelW) / steps;

    // Grid
    ctx.strokeStyle = "#1a1e2a"; ctx.lineWidth = 0.5;
    for (let i = 0; i <= steps; i++) {
      const x = labelW + i * stepW;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    // Time axis
    ctx.fillStyle = "#4a5568"; ctx.font = "10px 'JetBrains Mono', monospace";
    for (let i = 0; i <= steps; i += 2) {
      ctx.fillText(`${Math.round(i / steps * totalTime)}ns`, labelW + i * stepW + 2, 16);
    }

    signals.forEach((sig, si) => {
      const y = padTop + si * rowH;
      const color = sig.name === "clk" ? T.accent
        : sig.name.includes("flag") ? T.orange
        : sig.bits === 1 ? T.blue : T.purple;

      ctx.fillStyle = "#c8d0e0";
      ctx.font = "11px 'JetBrains Mono', monospace";
      ctx.fillText(sig.name, 4, y + rowH / 2 + 4);

      ctx.strokeStyle = color; ctx.lineWidth = 1.8;
      ctx.beginPath();
      if (sig.bits === 1) {
        sig.vals.forEach((v, i) => {
          const x = labelW + i * stepW;
          const ht = v ? y + 5 : y + rowH - 7;
          if (i === 0) { ctx.moveTo(x, ht); return; }
          if (sig.vals[i] !== sig.vals[i - 1]) {
            ctx.lineTo(x, v ? y + rowH - 7 : y + 5);
            ctx.lineTo(x, ht);
          } else ctx.lineTo(x, ht);
        });
        ctx.lineTo(labelW + steps * stepW, sig.vals[steps - 1] ? y + 5 : y + rowH - 7);
      } else {
        sig.vals.forEach((v, i) => {
          const x = labelW + i * stepW;
          const nx = Math.min(labelW + (i + 1) * stepW, labelW + steps * stepW);
          const changed = i > 0 && sig.vals[i] !== sig.vals[i - 1];
          if (changed) {
            ctx.lineTo(x + 2, y + rowH - 7); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(x + 2, y + rowH - 7);
            ctx.lineTo(x + 2, y + 5);
          }
          if (i === 0) ctx.moveTo(x, y + 5);
          ctx.lineTo(nx - (i < steps - 1 && sig.vals[i] !== sig.vals[i + 1] ? 2 : 0), y + 5);
          if (v > 0 && (i === 0 || sig.vals[i] !== sig.vals[i - 1])) {
            ctx.save();
            ctx.fillStyle = color; ctx.font = "10px 'JetBrains Mono', monospace";
            ctx.fillText(`0x${v.toString(16).toUpperCase()}`, x + 5, y + rowH / 2 + 4);
            ctx.restore();
          }
        });
        ctx.stroke(); ctx.beginPath();
        sig.vals.forEach((v, i) => {
          const x = labelW + i * stepW;
          const nx = Math.min(labelW + (i + 1) * stepW, labelW + steps * stepW);
          const changed = i > 0 && sig.vals[i] !== sig.vals[i - 1];
          if (changed) { ctx.moveTo(x + 2, y + 5); ctx.lineTo(x + 2, y + rowH - 7); }
          if (i === 0) ctx.moveTo(x, y + rowH - 7);
          ctx.lineTo(nx - (i < steps - 1 && sig.vals[i] !== sig.vals[i + 1] ? 2 : 0), y + rowH - 7);
        });
      }
      ctx.stroke();
    });

    if (cursor !== null) {
      ctx.strokeStyle = "#ffaa00"; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(cursor, 0); ctx.lineTo(cursor, H);
      ctx.stroke(); ctx.setLineDash([]);
      const t = Math.round((cursor - labelW) / (W - labelW) * totalTime);
      ctx.fillStyle = "#ffaa00"; ctx.font = "bold 11px monospace";
      ctx.fillText(`${t} ns`, cursor + 4, 16);
    }
  }, [cursor]);

  return (
    <div style={{ padding: 12, height: "100%", overflowY: "auto" }}>
      <div style={{ color: T.accent, fontFamily: "monospace", fontSize: 11, marginBottom: 8 }}>
        ● WAVEFORM VIEWER{vcdPath ? ` — ${vcdPath}` : " — wave.vcd"}
      </div>
      <canvas
        ref={canvasRef}
        width={880} height={signals.length * rowH + padTop + 10}
        style={{ background: "#0d0f14", border: `1px solid ${T.border}`, borderRadius: 6, width: "100%", maxWidth: 880, cursor: "crosshair" }}
        onMouseMove={e => {
          const r = e.currentTarget.getBoundingClientRect();
          setCursor((e.clientX - r.left) * (880 / r.width));
        }}
        onMouseLeave={() => setCursor(null)}
      />
    </div>
  );
}

// ─── RTL Schematic ────────────────────────────────────────────────────────────
function RTLSchematic() {
  return (
    <div style={{ padding: 12, height: "100%", overflowY: "auto" }}>
      <div style={{ color: T.accent, fontFamily: "monospace", fontSize: 11, marginBottom: 8 }}>● RTL SCHEMATIC — alu_top (Yosys)</div>
      <svg viewBox="0 0 800 380" style={{ width: "100%", maxWidth: 800, background: "#0d0f14", borderRadius: 8, border: `1px solid ${T.border}` }}>
        <defs>
          <pattern id="g" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M20 0L0 0 0 20" fill="none" stroke="#1a1e2a" strokeWidth="0.5"/>
          </pattern>
          <marker id="a" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="#4da6ff"/>
          </marker>
          <marker id="ag" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="#00d4aa"/>
          </marker>
          <marker id="ao" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="#ff8c42"/>
          </marker>
        </defs>
        <rect width="800" height="380" fill="url(#g)"/>

        {/* Inputs */}
        {[["clk",30,60],["rst_n",30,100],["a[3:0]",30,140],["b[3:0]",30,180],["op[2:0]",30,220]].map(([n,x,y])=>(
          <g key={n}>
            <rect x={x} y={y-13} width={72} height={24} rx="4" fill="#13161e" stroke="#1e2433"/>
            <text x={x+36} y={y+4} textAnchor="middle" fill="#4da6ff" fontSize="10" fontFamily="monospace">{n}</text>
            <line x1={x+72} y1={y} x2={x+112} y2={y} stroke="#4da6ff" strokeWidth="1.5" markerEnd="url(#a)"/>
          </g>
        ))}

        {/* Main module */}
        <rect x={200} y={30} width={220} height={220} rx="10" fill="#13161e" stroke="#00d4aa" strokeWidth="2"/>
        <text x={310} y={56} textAnchor="middle" fill="#00d4aa" fontSize="14" fontFamily="monospace" fontWeight="700">ALU_TOP</text>
        <text x={310} y={72} textAnchor="middle" fill="#4a5568" fontSize="9" fontFamily="monospace">Yosys mapped</text>
        <line x1={210} y1={82} x2={410} y2={82} stroke="#1e2433" strokeWidth="0.5"/>

        {/* Sub-blocks */}
        <rect x={218} y={95}  width={80} height={28} rx="4" fill="#1a1e2a" stroke="#b07fff"/>
        <text x={258} y={113} textAnchor="middle" fill="#b07fff" fontSize="9" fontFamily="monospace">CASE MUX 8:1</text>

        <rect x={318} y={95}  width={80} height={28} rx="4" fill="#1a1e2a" stroke="#ff8c42"/>
        <text x={358} y={113} textAnchor="middle" fill="#ff8c42" fontSize="9" fontFamily="monospace">OP DECODE</text>

        <rect x={218} y={148} width={80} height={28} rx="4" fill="#1a1e2a" stroke="#4da6ff"/>
        <text x={258} y={166} textAnchor="middle" fill="#4da6ff" fontSize="9" fontFamily="monospace">ADDER 4b</text>

        <rect x={318} y={148} width={80} height={28} rx="4" fill="#1a1e2a" stroke="#4da6ff"/>
        <text x={358} y={166} textAnchor="middle" fill="#4da6ff" fontSize="9" fontFamily="monospace">LOGIC OPS</text>

        <rect x={258} y={200} width={80} height={28} rx="4" fill="#1a1e2a" stroke="#00d4aa"/>
        <text x={298} y={218} textAnchor="middle" fill="#00d4aa" fontSize="9" fontFamily="monospace">DFF × 8</text>

        {/* Internal wires */}
        <line x1={298} y1={123} x2={298} y2={148} stroke="#5a6480" strokeWidth="1" markerEnd="url(#a)"/>
        <line x1={358} y1={123} x2={358} y2={148} stroke="#5a6480" strokeWidth="1" markerEnd="url(#a)"/>
        <line x1={258} y1={176} x2={258} y2={200} stroke="#5a6480" strokeWidth="1" markerEnd="url(#ag)"/>
        <line x1={358} y1={176} x2={318} y2={200} stroke="#5a6480" strokeWidth="1" markerEnd="url(#ag)"/>

        {/* Inputs to blocks */}
        <line x1={142} y1={140} x2={200} y2={140} stroke="#4da6ff" strokeWidth="1.5" markerEnd="url(#a)"/>
        <line x1={142} y1={180} x2={200} y2={180} stroke="#4da6ff" strokeWidth="1.5" markerEnd="url(#a)"/>
        <line x1={142} y1={220} x2={318} y2={109} stroke="#b07fff" strokeWidth="1.5" markerEnd="url(#a)"/>
        <line x1={142} y1={60} x2={298} y2={60} stroke="#00d4aa" strokeDasharray="5,3" strokeWidth="1.5"/>
        <line x1={298} y1={60} x2={298} y2={95} stroke="#00d4aa" strokeDasharray="5,3" strokeWidth="1.5" markerEnd="url(#ag)"/>
        <line x1={142} y1={100} x2={258} y2={100} stroke="#ff4455" strokeDasharray="5,3" strokeWidth="1.5"/>
        <line x1={258} y1={100} x2={258} y2={95} stroke="#ff4455" strokeDasharray="5,3" strokeWidth="1.5" markerEnd="url(#a)"/>

        {/* Output regs */}
        <rect x={490} y={95}  width={96} height={28} rx="4" fill="#13161e" stroke="#00d4aa"/>
        <text x={538} y={113} textAnchor="middle" fill="#00d4aa" fontSize="9" fontFamily="monospace">REG result[4:0]</text>
        <rect x={490} y={148} width={96} height={28} rx="4" fill="#13161e" stroke="#ff8c42"/>
        <text x={538} y={166} textAnchor="middle" fill="#ff8c42" fontSize="9" fontFamily="monospace">REG zero_flag</text>
        <rect x={490} y={200} width={96} height={28} rx="4" fill="#13161e" stroke="#ff8c42"/>
        <text x={538} y={218} textAnchor="middle" fill="#ff8c42" fontSize="9" fontFamily="monospace">REG carry_flag</text>

        <line x1={420} y1={220} x2={538} y2={109} stroke="#00d4aa" strokeWidth="1.5" markerEnd="url(#ag)"/>
        <line x1={420} y1={220} x2={538} y2={162} stroke="#ff8c42" strokeWidth="1.5" markerEnd="url(#ao)"/>
        <line x1={420} y1={220} x2={538} y2={214} stroke="#ff8c42" strokeWidth="1.5" markerEnd="url(#ao)"/>

        {/* Output ports */}
        <rect x={650} y={95}  width={100} height={24} rx="3" fill="#13161e" stroke="#1e2433"/>
        <text x={700} y={111} textAnchor="middle" fill="#00d4aa" fontSize="10" fontFamily="monospace">result[4:0]</text>
        <rect x={650} y={148} width={100} height={24} rx="3" fill="#13161e" stroke="#1e2433"/>
        <text x={700} y={164} textAnchor="middle" fill="#ff8c42" fontSize="10" fontFamily="monospace">zero_flag</text>
        <rect x={650} y={200} width={100} height={24} rx="3" fill="#13161e" stroke="#1e2433"/>
        <text x={700} y={216} textAnchor="middle" fill="#ff8c42" fontSize="10" fontFamily="monospace">carry_flag</text>

        <line x1={586} y1={109} x2={650} y2={107} stroke="#00d4aa" strokeWidth="1.5" markerEnd="url(#ag)"/>
        <line x1={586} y1={162} x2={650} y2={160} stroke="#ff8c42" strokeWidth="1.5" markerEnd="url(#ao)"/>
        <line x1={586} y1={214} x2={650} y2={212} stroke="#ff8c42" strokeWidth="1.5" markerEnd="url(#ao)"/>

        {/* Stats */}
        <rect x={30} y={300} width={740} height={60} rx="6" fill="#0f111a" stroke="#1e2433"/>
        <text x={50} y={318} fill="#4a5568" fontSize="9" fontFamily="monospace">SYNTHESIS STATS (iCE40 LP/HX)</text>
        {[["SB_LUT4","12"],["SB_DFFE","8"],["SB_CARRY","4"],["Total cells","24"],["Est. Fmax","~180 MHz"],["LUT util","0.3%"]].map(([k,v],i)=>(
          <g key={k}>
            <text x={50+i*120} y={338} fill="#5a6480" fontSize="9" fontFamily="monospace">{k}</text>
            <text x={50+i*120} y={352} fill="#00d4aa" fontSize="11" fontFamily="monospace" fontWeight="600">{v}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

// ─── Tool Status Badge ────────────────────────────────────────────────────────
function ToolBadge({ name, info }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 6, padding: "4px 8px",
      background: info?.found ? "#0a1a14" : "#1a0f10",
      border: `1px solid ${info?.found ? T.accentDim : "#3a1520"}`,
      borderRadius: 4, fontSize: 10, fontFamily: "monospace",
    }}>
      <span style={{ color: info?.found ? T.accent : T.error }}>{info?.found ? "●" : "○"}</span>
      <span style={{ color: T.textBright }}>{name}</span>
      {info?.found && <span style={{ color: T.textDim }}>{info.path?.split(/[/\\]/).pop()}</span>}
      {!info?.found && <span style={{ color: T.error }}>not found</span>}
    </div>
  );
}

// ─── Settings Panel ───────────────────────────────────────────────────────────
function SettingsPanel({ tools, toolPaths, setToolPaths, onRediscover, visible }) {
  const toolList = ["iverilog","vvp","yosys","nextpnr-ice40","icepack","iceprog","verilator","gtkwave","openocd"];
  if (!visible) return null;
  return (
    <div style={{ padding: 16, height: "100%", overflowY: "auto" }}>
      <div style={{ color: T.accent, fontFamily: "monospace", fontSize: 12, marginBottom: 12 }}>⚙ TOOL CONFIGURATION</div>
      <button onClick={onRediscover}
        style={{ ...btn(T.accentDim), marginBottom: 16 }}>
        🔍 Re-scan system for tools
      </button>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {toolList.map(name => (
          <div key={name} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: tools[name]?.found ? T.accent : T.error, fontSize: 10 }}>
                {tools[name]?.found ? "●" : "○"}
              </span>
              <span style={{ color: T.textBright, fontFamily: "monospace", fontSize: 11, width: 130 }}>{name}</span>
              {tools[name]?.version && (
                <span style={{ color: T.textDim, fontSize: 10, fontFamily: "monospace" }}>
                  {tools[name].version.substring(0, 30)}
                </span>
              )}
            </div>
            <div style={{ display: "flex", gap: 6, paddingLeft: 16 }}>
              <input
                value={toolPaths[name] || tools[name]?.path || ""}
                onChange={e => setToolPaths(p => ({ ...p, [name]: e.target.value }))}
                placeholder={`Path to ${name}...`}
                style={{
                  flex: 1, background: "#0d0f14", border: `1px solid ${T.border}`,
                  color: T.text, padding: "4px 8px", fontSize: 11,
                  borderRadius: 4, fontFamily: "monospace",
                }}
              />
              <button
                onClick={async () => {
                  try {
                    const selected = await open({ multiple: false, title: `Locate ${name}` });
                    if (selected) setToolPaths(p => ({ ...p, [name]: selected }));
                  } catch {}
                }}
                style={{ ...btn("#1e2433"), fontSize: 11 }}>
                Browse
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [files, setFiles]           = useState(DEFAULT_FILES);
  const [activeFile, setActiveFile] = useState("top.v");
  const [code, setCode]             = useState(DEFAULT_FILES["top.v"]);
  const [tools, setTools]           = useState({});
  const [toolPaths, setToolPaths]   = useState({});
  const [terminal, setTerminal]     = useState([
    { text: "OpenFPGA IDE v1.0 — real EDA toolchain integration", color: T.accent },
    { text: "Scanning system for installed tools...", color: T.textDim },
  ]);
  const [running, setRunning]       = useState(null);
  const [rightTab, setRightTab]     = useState("terminal");
  const [bottomTab, setBottomTab]   = useState("terminal");
  const [showSettings, setShowSettings] = useState(false);
  const [newFileName, setNewFileName]   = useState("");
  const [showNewFile, setShowNewFile]   = useState(false);
  const [fontSize, setFontSize]     = useState(13);
  const [vcdPath, setVcdPath]       = useState(null);
  const [workDir, setWorkDir]       = useState(null);
  const termRef = useRef(null);
  const editorRef = useRef(null);

  // Auto-scroll terminal
  useEffect(() => {
    if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight;
  }, [terminal]);

  // Discover tools on startup
  useEffect(() => {
    (async () => {
      try {
        const discovered = await invoke("discover_tools");
        setTools(discovered);
        const found = Object.values(discovered).filter(t => t.found).length;
        const total = Object.keys(discovered).length;
        addLog([
          ``,
          `Tool discovery complete: ${found}/${total} tools found`,
          ...Object.entries(discovered).map(([name, info]) =>
            `  ${info.found ? "✓" : "✗"} ${name.padEnd(18)} ${info.found ? (info.path || "") : "not found"}`
          ),
          ``,
          `Ready. Open a project or start editing.`,
        ], (l, i) => {
          const info = discovered[l.trim().split(/\s+/)[1]];
          return l.includes("✓") ? T.success : l.includes("✗") ? T.error : T.textDim;
        });
      } catch (e) {
        addLog([`Tool discovery failed: ${e}`, `(Running in browser mode — Tauri not available)`], () => T.warn);
      }
    })();
  }, []);

  const addLog = useCallback((lines, colorFn = () => T.text) => {
    setTerminal(prev => [...prev, ...lines.map((text, i) => ({ text, color: colorFn(text, i) }))]);
  }, []);

  // Resolve tool path: custom override → discovered → just the name
  const resolveTool = (name) =>
    toolPaths[name] || tools[name]?.path || name;

  const saveActiveFile = useCallback(() => {
    setFiles(prev => ({ ...prev, [activeFile]: code }));
  }, [activeFile, code]);

  const switchFile = (fname) => {
    setFiles(prev => ({ ...prev, [activeFile]: code }));
    setActiveFile(fname);
    setCode(files[fname]);
  };

  // Write all project files to a temp dir, return dir path
  const prepareWorkDir = async () => {
    if (workDir) {
      const allFiles = { ...files, [activeFile]: code };
      for (const [name, content] of Object.entries(allFiles)) {
        await invoke("save_file", { path: `${workDir}/${name}`, content });
      }
      return workDir;
    }
    const dir = await invoke("create_temp_dir");
    setWorkDir(dir);
    const allFiles = { ...files, [activeFile]: code };
    for (const [name, content] of Object.entries(allFiles)) {
      await invoke("save_file", { path: `${dir}/${name}`, content });
    }
    return dir;
  };

  // Generic tool runner
  const runTool = async (toolId, label, buildCommand) => {
    setRunning(toolId);
    saveActiveFile();
    addLog([``, `▶ ${label}  [${new Date().toLocaleTimeString()}]`], () => T.warn);
    setBottomTab("terminal");

    try {
      const dir = await prepareWorkDir();
      const { tool, args } = buildCommand(dir);
      addLog([`$ ${tool} ${args.join(" ")}`], () => T.textDim);

      const result = await invoke("run_command", {
        toolPath: resolveTool(tool),
        args,
        cwd: dir,
      });

      const output = (result.stdout + result.stderr).split("\n").filter(l => l.trim());
      addLog(output, (l) =>
        /error|Error|ERROR/.test(l) ? T.error :
        /warn|Warn|WARN/.test(l)  ? T.warn  :
        /success|complete|OK|done|✓/i.test(l) ? T.success : T.text
      );
      addLog(
        [`${result.success ? "✓" : "✗"} ${label} ${result.success ? "succeeded" : `failed (exit ${result.exit_code})`}`],
        () => result.success ? T.success : T.error
      );
      return { success: result.success, dir };
    } catch (e) {
      addLog([`Error: ${e}`], () => T.error);
      return { success: false };
    } finally {
      setRunning(null);
    }
  };

  // ── Tool actions ──────────────────────────────────────────────────────────
  const doSimulate = async () => {
    const vFiles = Object.keys({ ...files, [activeFile]: code }).filter(f => f.endsWith(".v"));
    const { success, dir } = await runTool("iverilog", "Compilation (iverilog)", (d) => ({
      tool: "iverilog",
      args: ["-Wall", "-o", `${d}/sim.out`, ...vFiles],
    }));
    if (!success) return;

    await runTool("vvp", "Simulation (vvp)", (d) => ({
      tool: "vvp",
      args: [`${d}/sim.out`],
    }));
    setVcdPath(dir ? `${dir}/wave.vcd` : null);
  };

  const doSynthesize = async () => {
    await runTool("yosys", "Synthesis (Yosys)", (d) => ({
      tool: "yosys",
      args: ["-p", `synth_ice40 -top alu_top -json ${d}/netlist.json`, "top.v"],
    }));
  };

  const doPnR = async () => {
    const pcf = Object.keys(files).find(f => f.endsWith(".pcf")) || "constraints.pcf";
    await runTool("nextpnr-ice40", "Place & Route (nextpnr)", (d) => ({
      tool: "nextpnr-ice40",
      args: ["--hx8k", "--package", "cb132",
             "--json", `${d}/netlist.json`,
             "--asc", `${d}/design.asc`,
             "--pcf", `${d}/${pcf}`],
    }));
  };

  const doBitstream = async () => {
    const { success } = await runTool("icepack", "Bitstream pack (icepack)", (d) => ({
      tool: "icepack",
      args: [`${d}/design.asc`, `${d}/design.bin`],
    }));
    if (!success) return;
    await runTool("iceprog", "Flash device (iceprog)", (d) => ({
      tool: "iceprog",
      args: [`${d}/design.bin`],
    }));
  };

  const doVerilator = async () => {
    const vFiles = Object.keys({ ...files, [activeFile]: code }).filter(f => f.endsWith(".v"));
    await runTool("verilator", "Lint (Verilator)", (d) => ({
      tool: "verilator",
      args: ["--lint-only", "-Wall", ...vFiles],
    }));
  };

  const doWaveform = () => {
    setBottomTab("wave");
    if (tools["gtkwave"]?.found) {
      const gtkPath = resolveTool("gtkwave");
      const vcd = vcdPath || "wave.vcd";
      invoke("run_command", { toolPath: gtkPath, args: [vcd], cwd: workDir || undefined })
        .catch(() => {});
      addLog([`▶ Launching GTKWave: ${gtkPath} ${vcd}`], () => T.blue);
    }
  };

  // ── File ops ──────────────────────────────────────────────────────────────
  const openFile = async () => {
    try {
      const path = await open({ multiple: false, filters: [{ name: "HDL", extensions: ["v","sv","vhd","vhdl","pcf","xdc","tcl"] }] });
      if (!path) return;
      const content = await readTextFile(path);
      const name = path.split(/[/\\]/).pop();
      setFiles(prev => ({ ...prev, [name]: content }));
      switchFile(name);
    } catch (e) { addLog([`Open failed: ${e}`], () => T.error); }
  };

  const saveFile = async () => {
    try {
      const path = await save({ defaultPath: activeFile, filters: [{ name: "HDL", extensions: ["v","sv","vhd","pcf","xdc"] }] });
      if (!path) return;
      await writeTextFile(path, code);
      addLog([`✓ Saved: ${path}`], () => T.success);
    } catch (e) { addLog([`Save failed: ${e}`], () => T.error); }
  };

  const toolButtons = [
    { id: "iverilog",   label: "▶ Simulate",      color: T.accent,  icon: "⚡", fn: doSimulate,   title: "iverilog + vvp" },
    { id: "wave",       label: "〜 Waveform",      color: T.blue,    icon: "📊", fn: doWaveform,   title: "GTKWave / VCD viewer" },
    { id: "synth",      label: "⊞ Synthesize",     color: T.purple,  icon: "🔧", fn: doSynthesize, title: "Yosys synthesis" },
    { id: "pnr",        label: "⊡ Place & Route",  color: T.orange,  icon: "🗺",  fn: doPnR,        title: "nextpnr-ice40" },
    { id: "bitstream",  label: "⬡ Bitstream+Flash",color: T.error,   icon: "📡", fn: doBitstream,  title: "icepack + iceprog" },
    { id: "verilator",  label: "⌙ Lint",           color: "#ffdd57", icon: "🔍", fn: doVerilator,  title: "Verilator lint" },
    { id: "schematic",  label: "⋈ Schematic",      color: T.warn,    icon: "🔌", fn: () => setBottomTab("schematic"), title: "RTL schematic" },
    { id: "settings",   label: "⚙ Tools",          color: T.textDim, icon: "⚙",  fn: () => setShowSettings(s=>!s), title: "Tool paths" },
  ];

  const lines = code.split("\n");

  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100vh",
      background: T.bg, fontFamily: "'JetBrains Mono', monospace",
      color: T.text, userSelect: "none",
    }}>
      {/* ── Title bar ── */}
      <div style={{
        height: 38, display: "flex", alignItems: "center", gap: 8,
        padding: "0 14px", background: "#08090d",
        borderBottom: `1px solid ${T.border}`, flexShrink: 0,
      }}>
        <div style={{ display: "flex", gap: 5 }}>
          {["#ff5f57","#febc2e","#28c840"].map(c=>(
            <div key={c} style={{ width:11, height:11, borderRadius:"50%", background:c }}/>
          ))}
        </div>
        <span style={{ color: T.accent, fontSize: 12, fontWeight: 700, letterSpacing: 2 }}>OpenFPGA IDE</span>
        <span style={{ color: T.textDim, fontSize: 10 }}>— open-source EDA  |  Tauri + Rust</span>
        <div style={{ flex: 1 }}/>
        <button onClick={openFile} style={btn("#1e2433")}>📂 Open</button>
        <button onClick={saveFile} style={btn("#1e2433")}>💾 Save</button>
        <button onClick={()=>setFontSize(f=>Math.max(10,f-1))} style={btn("#1e2433")}>A−</button>
        <span style={{ color: T.textDim, fontSize: 10 }}>{fontSize}</span>
        <button onClick={()=>setFontSize(f=>Math.min(20,f+1))} style={btn("#1e2433")}>A+</button>
        <button onClick={()=>setTerminal([])} style={btn("#1e2433")}>✕ clear</button>
      </div>

      {/* ── Tool bar ── */}
      <div style={{
        height: 38, display: "flex", alignItems: "center", gap: 5,
        padding: "0 10px", background: "#0f111a",
        borderBottom: `1px solid ${T.border}`, flexShrink: 0, overflowX: "auto",
      }}>
        {toolButtons.map(t => (
          <button key={t.id} onClick={t.fn} disabled={!!running && t.id !== "settings"}
            title={t.title}
            style={{
              ...btn(t.color + "18"),
              border: `1px solid ${t.color}55`,
              color: running === t.id ? T.warn : t.color,
              fontSize: 11, padding: "4px 10px", whiteSpace: "nowrap",
              opacity: running && running !== t.id && t.id !== "settings" ? 0.45 : 1,
            }}>
            {running === t.id ? "⏳" : t.icon} {t.label}
          </button>
        ))}
        <div style={{ flex: 1 }}/>
        {/* Quick tool status */}
        <div style={{ display: "flex", gap: 4, flexWrap: "nowrap" }}>
          {["iverilog","yosys","nextpnr-ice40","icepack"].map(name => (
            <div key={name} style={{
              fontSize: 10, fontFamily: "monospace", padding: "2px 6px",
              color: tools[name]?.found ? T.accent : T.error,
              borderRadius: 3, background: tools[name]?.found ? "#0a1a14" : "#1a0f10",
              border: `1px solid ${tools[name]?.found ? T.accentDim+"66" : "#3a152066"}`,
            }}>
              {tools[name]?.found ? "●" : "○"} {name}
            </div>
          ))}
        </div>
      </div>

      {/* ── Main area ── */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* Sidebar */}
        <div style={{
          width: 175, background: "#0f111a", borderRight: `1px solid ${T.border}`,
          display: "flex", flexDirection: "column", flexShrink: 0,
        }}>
          <div style={{ padding: "8px 10px 4px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ color: T.textDim, fontSize: 9, letterSpacing: 2 }}>EXPLORER</span>
            <button onClick={()=>setShowNewFile(s=>!s)} style={{ ...btn("#1e2433"), fontSize:15, padding:"0 5px", lineHeight:1 }}>+</button>
          </div>
          {showNewFile && (
            <div style={{ padding: "3px 8px 8px", display: "flex", gap: 4 }}>
              <input value={newFileName} onChange={e=>setNewFileName(e.target.value)}
                onKeyDown={e=>{
                  if(e.key==="Enter" && newFileName.trim()) {
                    setFiles(p=>({...p,[newFileName.trim()]:`// ${newFileName.trim()}\n`}));
                    setNewFileName(""); setShowNewFile(false);
                  }
                }}
                placeholder="file.v" autoFocus
                style={{ flex:1, background:"#1e2433", border:`1px solid ${T.border}`, color:T.text, padding:"3px 5px", fontSize:10, borderRadius:3 }}
              />
              <button onClick={()=>{ if(newFileName.trim()){ setFiles(p=>({...p,[newFileName.trim()]:`// ${newFileName.trim()}\n`})); setNewFileName(""); setShowNewFile(false); }}} style={{ ...btn(T.accentDim), fontSize:10, padding:"2px 6px" }}>✓</button>
            </div>
          )}
          <div style={{ flex: 1, overflowY: "auto" }}>
            {Object.keys(files).map(fname => (
              <div key={fname} onClick={()=>switchFile(fname)}
                style={{
                  padding: "5px 10px", cursor: "pointer", fontSize: 11,
                  background: activeFile===fname ? "#1a2035" : "transparent",
                  borderLeft: `2px solid ${activeFile===fname ? T.accent : "transparent"}`,
                  color: activeFile===fname ? T.textBright : T.textDim,
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                }}>
                <span>{fname.endsWith(".v")||fname.endsWith(".sv")?"📄":fname.endsWith(".pcf")||fname.endsWith(".xdc")?"📌":"📝"} {fname}</span>
                {Object.keys(files).length > 1 && (
                  <span onClick={e=>{e.stopPropagation(); if(activeFile===fname){const k=Object.keys(files).find(k=>k!==fname); setActiveFile(k); setCode(files[k]);} setFiles(p=>{const n={...p}; delete n[fname]; return n;}); }}
                    style={{ color: T.textDim, opacity:.4, fontSize:15, lineHeight:1 }}>×</span>
                )}
              </div>
            ))}
          </div>
          {/* Discovered tools list */}
          <div style={{ borderTop:`1px solid ${T.border}`, padding:"8px 10px" }}>
            <div style={{ color:T.textDim, fontSize:8, letterSpacing:2, marginBottom:5 }}>TOOLS</div>
            {["iverilog","yosys","nextpnr-ice40","icepack","iceprog","verilator","gtkwave"].map(name=>(
              <div key={name} style={{ display:"flex", justifyContent:"space-between", marginBottom:2 }}>
                <span style={{ color: tools[name]?.found ? T.accent : "#3a2030", fontSize:9 }}>{name}</span>
                <span style={{ color: tools[name]?.found ? T.textDim : T.error, fontSize:8 }}>
                  {tools[name]?.found ? "ready" : "missing"}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Editor */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ flex: 1, position: "relative", display: "flex", overflow: "hidden" }}>
            {/* Line numbers */}
            <div style={{
              width: 46, background:"#0d0f14", borderRight:`1px solid ${T.border}`,
              overflowY:"hidden", paddingTop:12, flexShrink:0, userSelect:"none",
            }}>
              {lines.map((_,i) => (
                <div key={i} style={{ height:fontSize*1.6, lineHeight:`${fontSize*1.6}px`, textAlign:"right", paddingRight:8, color:T.textDim, fontSize:fontSize-2 }}>
                  {i+1}
                </div>
              ))}
            </div>
            {/* Highlighted overlay */}
            <div style={{
              position:"absolute", top:0, left:46, right:0, bottom:0,
              padding:"12px 12px", fontSize, lineHeight:1.6,
              fontFamily:"'JetBrains Mono','Fira Code',monospace",
              pointerEvents:"none", overflow:"hidden",
              whiteSpace:"pre", color:T.text, zIndex:1,
            }} dangerouslySetInnerHTML={{ __html: highlight(code) }} />
            {/* Actual textarea */}
            <textarea ref={editorRef} value={code}
              onChange={e=>setCode(e.target.value)}
              spellCheck={false}
              style={{
                position:"absolute", top:0, left:46, right:0, bottom:0,
                background:"transparent", color:"transparent",
                caretColor:T.accent, border:"none", outline:"none",
                resize:"none", padding:"12px 12px", fontSize, lineHeight:1.6,
                fontFamily:"'JetBrains Mono','Fira Code',monospace", zIndex:2,
              }}
              onKeyDown={e=>{
                if(e.key==="Tab"){ e.preventDefault();
                  const s=e.target.selectionStart, en=e.target.selectionEnd;
                  setCode(c=>c.substring(0,s)+"  "+c.substring(en));
                  setTimeout(()=>{ e.target.selectionStart=e.target.selectionEnd=s+2; },0);
                }
                if(e.ctrlKey&&e.key==="s"){ e.preventDefault(); saveFile(); }
              }}
            />
          </div>

          {/* Bottom panel */}
          <div style={{
            height: 280, borderTop:`1px solid ${T.border}`,
            display:"flex", flexDirection:"column", background:T.panel,
          }}>
            <div style={{ display:"flex", background:"#0f111a", borderBottom:`1px solid ${T.border}`, flexShrink:0 }}>
              {[["terminal","⬛ Terminal"],["wave","〜 Waveform"],["schematic","⋈ Schematic"]].map(([id,label])=>(
                <button key={id} onClick={()=>setBottomTab(id)}
                  style={{ ...btn("transparent"), borderBottom:bottomTab===id?`2px solid ${T.accent}`:"2px solid transparent",
                    color:bottomTab===id?T.textBright:T.textDim, padding:"6px 14px", fontSize:11, borderRadius:0 }}>
                  {label}
                </button>
              ))}
              {showSettings && (
                <button onClick={()=>setBottomTab("settings")}
                  style={{ ...btn("transparent"), borderBottom:bottomTab==="settings"?`2px solid ${T.accent}`:"2px solid transparent",
                    color:bottomTab==="settings"?T.textBright:T.textDim, padding:"6px 14px", fontSize:11, borderRadius:0 }}>
                  ⚙ Settings
                </button>
              )}
            </div>

            {/* Terminal */}
            {bottomTab === "terminal" && (
              <div ref={termRef} style={{ flex:1, overflowY:"auto", padding:"10px 14px", fontSize:11.5, lineHeight:1.55, letterSpacing:.3 }}>
                {terminal.map((line,i)=>(
                  <div key={i} style={{ color:line.color||T.text, whiteSpace:"pre-wrap", wordBreak:"break-word" }}>
                    {line.text||<br/>}
                  </div>
                ))}
                {running && <div style={{ color:T.warn, marginTop:4 }}>⏳ Running {running}...</div>}
                <div style={{ height:20 }}/>
              </div>
            )}
            {bottomTab === "wave" && <WaveformViewer vcdPath={vcdPath}/>}
            {bottomTab === "schematic" && <RTLSchematic/>}
            {bottomTab === "settings" && showSettings && (
              <SettingsPanel tools={tools} toolPaths={toolPaths} setToolPaths={setToolPaths}
                visible={true}
                onRediscover={async () => {
                  addLog([``, `🔍 Re-scanning for tools...`], ()=>T.warn);
                  const discovered = await invoke("discover_tools");
                  setTools(discovered);
                  const found = Object.values(discovered).filter(t=>t.found).length;
                  addLog([`Re-scan complete: ${found}/${Object.keys(discovered).length} found`], ()=>T.success);
                }}
              />
            )}
          </div>
        </div>
      </div>

      {/* Status bar */}
      <div style={{
        height:22, background:"#08090d", borderTop:`1px solid ${T.border}`,
        display:"flex", alignItems:"center", padding:"0 12px", gap:18, flexShrink:0,
      }}>
        <span style={{ color:T.accent, fontSize:10 }}>● {activeFile}</span>
        <span style={{ color:T.textDim, fontSize:10 }}>
          {activeFile.endsWith(".v")||activeFile.endsWith(".sv") ? "Verilog HDL" :
           activeFile.endsWith(".vhd") ? "VHDL" : "Text"}
        </span>
        <span style={{ color:T.textDim, fontSize:10 }}>{lines.length} lines</span>
        <span style={{ color:T.textDim, fontSize:10 }}>UTF-8</span>
        <div style={{ flex:1 }}/>
        {running
          ? <span style={{ color:T.warn, fontSize:10 }}>⏳ {running}…</span>
          : <span style={{ color:T.success, fontSize:10 }}>● Ready</span>
        }
        <span style={{ color:T.textDim, fontSize:10 }}>
          {Object.values(tools).filter(t=>t.found).length}/{Object.keys(tools).length} tools ready
        </span>
        <span style={{ color:T.textDim, fontSize:10 }}>iCE40 HX8K</span>
      </div>

      <style>{`
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width:6px; height:6px; }
        ::-webkit-scrollbar-track { background:#0d0f14; }
        ::-webkit-scrollbar-thumb { background:#1e2433; border-radius:3px; }
        ::-webkit-scrollbar-thumb:hover { background:#2e3a55; }
      `}</style>
    </div>
  );
}

function btn(bg) {
  return {
    background: bg, border: "none", color: "#c8d0e0",
    padding: "4px 8px", borderRadius: 4, cursor: "pointer",
    fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
  };
}
