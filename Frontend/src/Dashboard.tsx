import React, { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import {
  Zap, Activity, Trash2, RefreshCw, Square, Check, Lock, Unlock,
  Play, Pause, Settings, Database, Terminal, GitBranch, RotateCcw, X, Layers, Cpu, MemoryStick
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Label } from "@/components/ui/label";

// ─── Types ──────────────────────────────────────────────────────────────────

interface Packet {
  id: string;
  level: 'CRITICAL' | 'SUCCESS' | 'INFO' | 'WARN' | 'ERROR' | 'EXPLOIT';
  sourceIp: string;
  payload: string;
  timestamp: string;
}

interface Vitals { cpu: number; ram: number; }

interface CanvasBlock {
  id: string;
  type: 'INIT_THREAD' | 'SCAN_PORT' | 'RUN_SCRIPT' | 'LOOP' | 'CONDITION' | 'SAVE_DB';
  label: string;
  x: number;
  y: number;
  settings: BlockSettings;
  color: string;
  icon: any;
}

interface BlockSettings {
  target?: string;
  command?: string;
  startDelay: number;
  iterDelay: number;
  maxDuration: number;
  aesSecure: boolean;
  dynamicVar?: string;
  varValue?: string;
}

interface Workflow {
  id?: number;
  name: string;
  schema_type: string;
  parameters: string;
  created_at?: string;
  last_status?: 'active' | 'idle' | 'error';
}

// ─── Constants ───────────────────────────────────────────────────────────────

const RELAY = 'http://localhost:3001';
const socket = io(RELAY);

const MODULE_PALETTE = [
  { type: 'RUN_SCRIPT',  label: '>_ Custom SSH Command', icon: Terminal,   color: 'border-emerald-500/40 text-emerald-400' },
  { type: 'INIT_THREAD', label: '◆ Python Script',      icon: Zap,        color: 'border-violet-500/40 text-violet-400' },
  { type: 'SCAN_PORT',   label: '⚙ API Call',           icon: Activity,   color: 'border-amber-500/40 text-amber-400' },
  { type: 'SAVE_DB',     label: '☷ Save DB',            icon: Database,   color: 'border-sky-500/40 text-sky-400' },
  { type: 'LOOP',        label: '⟳ Loop Execution',     icon: RotateCcw,  color: 'border-amber-500/40 text-amber-400' },
  { type: 'CONDITION',   label: '⑂ If Condition',      icon: GitBranch,  color: 'border-red-500/40 text-red-400' },
] as const;

const DEFAULT_SETTINGS: BlockSettings = {
  startDelay: 0, iterDelay: 500, maxDuration: 30, aesSecure: true,
};

function mkBlock(type: CanvasBlock['type'], x: number, y: number): CanvasBlock {
  const def = MODULE_PALETTE.find(m => m.type === type)!;
  return { id: Math.random().toString(36).slice(2, 8).toUpperCase(), type, label: def.label, x, y, settings: { ...DEFAULT_SETTINGS }, color: def.color, icon: def.icon };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function levelClass(level: string) {
  switch (level) {
    case 'CRITICAL': return 'bg-red-500/20 text-red-400 border border-red-500/30';
    case 'EXPLOIT':  return 'bg-pink-500/20 text-pink-400 border border-pink-500/30';
    case 'SUCCESS':  return 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30';
    case 'WARN':     return 'bg-amber-500/20 text-amber-400 border border-amber-500/30';
    case 'ERROR':    return 'bg-orange-500/20 text-orange-400 border border-orange-500/30';
    default:         return 'bg-slate-800/60 text-slate-400 border border-slate-700/50';
  }
}

function RadialGauge({ value, label, color, size = 70 }: { value: number; label: string; color: string; size?: number }) {
  const r = (size / 2) - 7, circ = 2 * Math.PI * r;
  const offset = circ - (value / 100) * circ;
  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#1e293b" strokeWidth="4.5" />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth="4.5"
          strokeDasharray={circ} strokeDashoffset={offset}
          strokeLinecap="round" transform={`rotate(-90 ${size/2} ${size/2})`}
          style={{ transition: 'stroke-dashoffset 0.5s ease' }} />
        <text x={size/2} y={size/2 + 4} textAnchor="middle" fill="white"
          fontSize={size < 65 ? "10" : "12"} fontWeight="700" fontFamily="JetBrains Mono">{value}%</text>
      </svg>
      <span className="text-[9px] text-slate-500 tracking-widest font-bold">{label}</span>
    </div>
  );
}

// ─── Settings Modal ───────────────────────────────────────────────────────────

function SettingsModal({ block, onClose, onSave }: { block: CanvasBlock; onClose: () => void; onSave: (s: BlockSettings) => void; }) {
  const [s, setS] = useState<BlockSettings>({ ...block.settings });
  const upd = (k: keyof BlockSettings, v: any) => setS(p => ({ ...p, [k]: v }));

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="w-[480px] bg-[#020617] border border-slate-700/50 rounded shadow-[0_20px_50px_rgba(0,0,0,0.8)] p-6 font-mono text-slate-300">
        <div className="flex justify-between items-center mb-6 border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <Settings size={18} className="text-emerald-500" />
            <span className="text-[12px] font-bold tracking-widest text-white uppercase">ACTION SETTINGS — {block.label.replace(/[^a-zA-Z ]/g, '')}</span>
          </div>
          <button onClick={onClose} className="hover:text-white transition-colors"><X size={16}/></button>
        </div>

        <div className="space-y-5">
          {/* AES Toggle */}
          <div className="flex items-center justify-between p-4 rounded bg-[#0f172a] border border-slate-800">
            <div className="flex items-center gap-3">
              <Lock size={16} className={s.aesSecure ? "text-emerald-500" : "text-slate-500"} />
              <div>
                <div className="text-[11px] font-bold text-white tracking-widest leading-none">AES-256 SECURE</div>
                <div className="text-[9px] text-slate-500 mt-1.5 leading-none">Encrypts parameters before workflow dispatch</div>
              </div>
            </div>
            <button onClick={() => upd('aesSecure', !s.aesSecure)} className={`w-12 h-6 rounded-full relative transition-colors ${s.aesSecure ? 'bg-emerald-600' : 'bg-slate-700'}`}>
              <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all shadow ${s.aesSecure ? 'left-7' : 'left-1'}`} />
            </button>
          </div>

          {/* Payload / Target */}
          {(block.type === 'RUN_SCRIPT' || block.type === 'SCAN_PORT') && (
             <div className="space-y-2">
               <Label className="text-[10px] text-slate-400 tracking-widest font-bold">PAYLOAD / TARGET SCRIPT</Label>
               <Input value={s.target || ''} onChange={e => upd('target', e.target.value)}
                 className="bg-[#0f172a] border-slate-800 h-10 text-[12px] text-emerald-400 font-mono focus-visible:ring-emerald-500/30" placeholder="e.g. ./deploy.sh or 192.168.1.1" />
             </div>
          )}

          {/* Precision Timers */}
          <div className="grid grid-cols-3 gap-4 border-t border-slate-800/80 pt-5 mt-2">
            {[
              { key: 'startDelay', label: 'START DELAY', unit: 'ms' },
              { key: 'iterDelay', label: 'ITER DELAY', unit: 'ms' },
              { key: 'maxDuration', label: 'MAX TIME TTL', unit: 's' }
            ].map(t => (
              <div key={t.key} className="space-y-2">
                <Label className="text-[9px] text-slate-400 tracking-widest font-bold uppercase">{t.label}</Label>
                <div className="flex border border-slate-700 bg-[#0a0f1c] rounded overflow-hidden shadow-inner">
                  <Input type="number" value={(s as any)[t.key]} onChange={e => upd(t.key as any, parseInt(e.target.value)||0)}
                    className="border-0 bg-transparent h-9 text-[13px] text-white w-full text-right focus-visible:ring-0 font-mono" />
                  <span className="flex items-center px-2.5 text-[9px] bg-slate-900 border-l border-slate-800 text-slate-500 font-bold">{t.unit}</span>
                </div>
              </div>
            ))}
          </div>
          
          <div className="pt-4 flex justify-end gap-3 border-t border-slate-800/50">
            <Button variant="outline" onClick={onClose} className="h-9 px-6 text-[10px] border-slate-700 hover:bg-slate-800 rounded font-bold tracking-widest transition-colors">CANCEL</Button>
            <Button onClick={() => onSave(s)} className="h-9 px-6 text-[10px] bg-emerald-600 hover:bg-emerald-500 text-white rounded font-black tracking-widest transition-colors shadow-[0_0_15px_rgba(16,185,129,0.2)]">SAVE CONFIG</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Blueprint Creation Tab ───────────────────────────────────────────────────

function BlueprintTab({ fetchWorkflows }: { fetchWorkflows: () => void }) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [blocks, setBlocks] = useState<CanvasBlock[]>([]);
  const [settingsModal, setSettingsModal] = useState<string | null>(null);
  const [selectedSchema, setSelectedSchema] = useState<string>('Sec Audit v3.json');
  const [securedScript, setSecuredScript] = useState('target_server_deploy.sh');
  const [aesEnabled, setAesEnabled] = useState(true);

  useEffect(() => {
    const handleEdit = (e: Event) => {
      const w = (e as CustomEvent).detail as Workflow;
      setSelectedSchema(w.name);
      setBlocks([mkBlock('INIT_THREAD', 80, 150), mkBlock('RUN_SCRIPT', 350, 150)]);
    };
    window.addEventListener('edit-workflow', handleEdit);
    return () => window.removeEventListener('edit-workflow', handleEdit);
  }, []);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (!canvasRef.current) return;
    const type = e.dataTransfer.getData('type') as CanvasBlock['type'];
    if (!type) {
      const id = e.dataTransfer.getData('id');
      const rect = canvasRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left - 75;
      const y = e.clientY - rect.top - 20;
      setBlocks(b => b.map(bl => bl.id === id ? { ...bl, x, y } : bl));
      return;
    }
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left - 75;
    const y = e.clientY - rect.top - 20;
    setBlocks(b => [...b, mkBlock(type, x, y)]);
  };

  return (
    <div className="flex-1 flex h-full relative overflow-hidden bg-[#020617]">
      {/* Palette */}
      <div className="w-[280px] bg-[#050914] border-r border-slate-800 flex flex-col z-10 shadow-[10px_0_30px_#00000080]">
        <div className="px-5 py-4 border-b border-slate-800">
          <span className="text-[11px] text-slate-500 tracking-widest font-black uppercase">MODULE_PALETTE</span>
        </div>
        <div className="flex-1 p-4 space-y-3 overflow-y-auto">
          {MODULE_PALETTE.map(m => (
            <div key={m.type} draggable onDragStart={e => e.dataTransfer.setData('type', m.type)}
              className={`w-full py-3 px-4 rounded-md border ${m.color} bg-[#020617] hover:bg-[#091122] cursor-grab active:cursor-grabbing text-[11px] font-black tracking-widest flex items-center justify-start gap-3 transition-all shadow-[0_0_10px_rgba(0,0,0,0.3)]`}>
              <m.icon size={14} />
              {m.label}
            </div>
          ))}
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 flex flex-col relative bg-[#020617]">
        <div className="h-[56px] border-b border-slate-800/80 flex items-center justify-between px-6 bg-transparent absolute top-0 w-full z-10 pointer-events-none">
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-slate-500 tracking-widest font-bold">BLUEPRINT_CANVAS</span>
            <span className="text-[14px] font-black tracking-widest text-slate-200 uppercase">Custom Command Builder</span>
          </div>
          <div className="flex items-center gap-4 pointer-events-auto">
            <span className="text-[9px] text-slate-600 font-bold tracking-widest">CPU &nbsp; RAM</span>
            <button onClick={() => setBlocks([])} className="bg-red-950/40 text-red-400 hover:text-red-300 border border-red-500/30 px-4 py-1.5 rounded-sm transition-colors text-[9px] tracking-widest font-bold">CLEAR</button>
            <button className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-[10px] tracking-widest px-5 py-2 rounded-sm transition-colors shadow-[0_0_15px_rgba(16,185,129,0.3)]">
              SAVE WORKFLOW
            </button>
          </div>
        </div>

        <div ref={canvasRef} 
             className="flex-1 relative w-full h-full bg-[#020617]" 
             style={{ backgroundImage: 'radial-gradient(circle, #1e293b 1px, transparent 1px)', backgroundSize: '24px 24px' }}
             onDragOver={e => e.preventDefault()} onDrop={handleDrop}>
          
          {/* SVG Connection Lines */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none z-0">
             {blocks.map((b, i) => {
               if (i === blocks.length - 1) return null;
               const next = blocks[i+1];
               const startX = b.x + 180;
               const startY = b.y + 16;
               const endX = next.x;
               const endY = next.y + 16;
               const path = `M ${startX} ${startY + 2} C ${startX + 50} ${startY + 2}, ${endX - 50} ${endY + 2}, ${endX - 8} ${endY + 2}`;
               return <path key={`link-${i}`} d={path} fill="none" stroke="#10b981" strokeWidth="2" strokeDasharray="4 2" className="opacity-40 drop-shadow-[0_0_5px_rgba(16,185,129,0.5)]" />;
             })}
          </svg>

          {blocks.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-700 pointer-events-none z-0">
              <Layers size={56} className="mb-4 opacity-40 text-emerald-500" />
              <span className="text-[14px] font-black tracking-[0.2em] mb-2 text-slate-400">DRAG TO CHAIN</span>
              <span className="text-[11px] text-slate-600 tracking-widest">Drag modules from the palette to orchestrate execution</span>
            </div>
          )}

          {blocks.map(b => (
            <div key={b.id} draggable onDragStart={e => e.dataTransfer.setData('id', b.id)}
              className={`absolute flex items-center justify-between px-4 py-2 rounded-full border bg-[#020617]/90 backdrop-blur-md cursor-grab active:cursor-grabbing shadow-[0_10px_20px_#00000080] min-w-[180px] ${b.color} hover:bg-[#0f172a] transition-all group border-opacity-70 z-10`}
              style={{ left: b.x, top: b.y }}>
              <div className="absolute -left-1.5 w-3 h-3 rounded-full bg-[#020617] border-2 border-slate-500 z-10" />
              <div className="flex items-center gap-3">
                 <b.icon size={13} className="shrink-0" />
                 <span className="text-[11px] font-black tracking-widest uppercase whitespace-nowrap">{b.label.replace(/[^a-zA-Z ]/g, '')}</span>
              </div>
              <div className="opacity-0 group-hover:opacity-100 flex items-center transition-all ml-4 gap-0.5 shrink-0 bg-black/50 p-0.5 rounded">
                <button onClick={() => setSettingsModal(b.id)} className="p-1 hover:text-emerald-400 transition-colors"><Settings size={12} /></button>
                <button onClick={() => setBlocks(p => p.filter(bl => bl.id !== b.id))} className="p-1 hover:text-red-400 transition-colors"><Trash2 size={12} /></button>
              </div>
              <div className="absolute -right-1.5 w-3 h-3 rounded-full bg-[#020617] border-2 border-emerald-500 drop-shadow-[0_0_5px_rgba(16,185,129,0.8)] z-10" />
            </div>
          ))}
        </div>
      </div>

      {/* Right Column: Dispatcher & Builder Config */}
      <div className="w-[420px] bg-[#091122] border-l border-slate-800 flex flex-col z-10 shadow-[-10px_0_30px_#00000080] overflow-y-auto">
        <div className="p-6 space-y-8">
          {/* Dispatcher */}
          <div className="border border-emerald-500/30 rounded-lg p-5 bg-[#020617]/50 shadow-[0_0_15px_rgba(16,185,129,0.05)]">
            <div className="text-[11px] font-black tracking-widest text-emerald-500 mb-5 relative flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              WORKFLOW DISPATCHER
            </div>
            <div className="space-y-4">
              <Label className="text-[10px] text-slate-400 tracking-widest font-bold">Schema Selector</Label>
              <Select value={selectedSchema} onValueChange={setSelectedSchema}>
                <SelectTrigger className="w-full bg-[#0f172a] border-[#1e293b] text-[12px] h-10 font-bold text-slate-200">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#0f172a] border-[#1e293b]">
                  <SelectItem value="Sec Audit v3.json">Sec Audit v3.json</SelectItem>
                  <SelectItem value="Target Deploy">Target Deploy.json</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex flex-col gap-3 pt-4 border-t border-slate-800">
                <button className="w-full py-3 border border-red-500/50 bg-red-950/20 rounded text-red-500 text-[11px] font-black tracking-[0.2em] hover:bg-red-900/40 hover:border-red-400 transition-all shadow-[0_0_10px_rgba(239,68,68,0.15)] flex justify-center items-center gap-2">
                  <Zap size={14} /> EXECUTE WORKFLOW
                </button>
                <span className="text-[10px] text-slate-500 tracking-widest">Active: {selectedSchema} <span className="text-emerald-400 font-bold">(Ready to Dispatch)</span></span>
              </div>
            </div>
          </div>

          {/* Builder */}
          <div className="border border-[#1e293b] rounded-lg p-5 bg-[#020617]">
            <div className="text-[11px] font-black tracking-widest text-emerald-500 mb-6 uppercase">CUSTOM COMMAND BUILDER</div>
            
            <div className="flex items-end justify-between gap-4 mb-6">
              <div className="space-y-2 flex-1">
                <Label className="text-[10px] text-slate-400 tracking-widest font-bold">Secured Script Type</Label>
                <Select value={securedScript} onValueChange={setSecuredScript}>
                  <SelectTrigger className="w-full bg-[#0f172a] border-[#334155] text-[12px] h-9 font-bold text-slate-200 text-left">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#0f172a] border-[#1e293b]">
                    <SelectItem value="target_server_deploy.sh">target_server_deploy.sh</SelectItem>
                    <SelectItem value="nmap_aggr.py">nmap_aggr.py</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col items-end gap-1.5 pb-1">
                <span className="text-[9px] font-bold tracking-widest text-slate-400 uppercase">AES-256 secure</span>
                <button onClick={() => setAesEnabled(!aesEnabled)} 
                  className={`w-10 h-5 rounded-full relative transition-colors ${aesEnabled ? 'bg-emerald-500' : 'bg-slate-700'}`}>
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all shadow ${aesEnabled ? 'left-5' : 'left-0.5'}`} />
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-[10px] text-slate-400 tracking-widest font-bold">Decrypted Secured Command Script</Label>
              <div className="w-full bg-[#0a0f1c] border border-[#1e293b] rounded-md p-4 text-[11px] text-slate-400 font-mono leading-loose overflow-x-auto whitespace-nowrap shadow-inner">
                {aesEnabled ? (
                  <>
                    <span className="text-slate-600">--2026-03-27T10:15:30Z --cond secradmin:HRP:/\esstkh?*</span><br/>
                    <span className="text-emerald-400">`{securedScript}`|='$0' -dd '{securedScript}'</span>
                  </>
                ) : (
                  <span className="text-slate-400">./{securedScript} --no-encryption --verbose</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {settingsModal && <SettingsModal block={blocks.find(b => b.id === settingsModal)!} onClose={() => setSettingsModal(null)} onSave={s => { setBlocks(b => b.map(bl => bl.id === settingsModal ? {...bl, settings: s} : bl)); setSettingsModal(null); }} />}
    </div>
  );
}

// ─── Workflows Library Tab ────────────────────────────────────────────────────

function WorkflowsTab({ library, fetchWorkflows, onRun }: { library: Workflow[]; fetchWorkflows: () => void; onRun: (w: any) => void; }) {
  const [injecting, setInjecting] = useState<number | null>(null);
  const [dynVars, setDynVars] = useState<Record<number, string>>({});

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#020617] p-8">
      <div className="flex justify-between items-end mb-8 border-b border-slate-800 pb-4">
        <div>
           <h2 className="text-xl font-bold text-white tracking-widest uppercase">Saved Workflows</h2>
           <p className="text-slate-500 text-xs tracking-widest mt-1">PostgreSQL Persistent Library</p>
        </div>
        <Button onClick={fetchWorkflows} variant="outline" className="h-8 text-xs border-slate-700 bg-slate-900 font-mono">
          <RefreshCw size={14} className="mr-2" /> Sync DB
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 overflow-y-auto">
        {library.length === 0 ? (
          <div className="col-span-full text-center py-20 text-slate-500 text-sm tracking-widest font-mono">No workflows currently saved in DB.</div>
        ) : library.map(w => (
          <div key={w.id} className="p-5 rounded-lg border border-slate-800 bg-[#0a0f1c] hover:border-emerald-500/50 transition-all shadow-lg flex flex-col group">
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-lg font-black text-emerald-400 tracking-widest">{w.name}</h3>
              <Badge variant="outline" className="text-[10px] border-slate-700 bg-black tracking-widest font-mono text-slate-300">{w.schema_type}</Badge>
            </div>
            
            <p className="text-[11px] text-slate-500 mb-6 font-mono leading-relaxed bg-black/50 p-2 border border-slate-800/50 rounded flex-1">
               {w.parameters.length > 100 ? w.parameters.substring(0,100) + '...' : w.parameters}
            </p>
            
            {/* Dynamic Injector inline */}
            {injecting === w.id && (
              <div className="mb-4 p-3 bg-emerald-950/20 rounded border border-emerald-500/30 space-y-2 animate-in fade-in slide-in-from-top-2">
                <Label className="text-[9px] text-emerald-400 tracking-widest font-bold">DYNAMIC VARIABLE OVERRIDE</Label>
                <div className="flex gap-2">
                  <Input placeholder="TARGET_IP val..." value={dynVars[w.id!] ?? ''}
                    onChange={e => setDynVars(p => ({ ...p, [w.id!]: e.target.value }))}
                    className="bg-black/80 border-emerald-500/50 h-8 text-[11px] font-mono text-emerald-300 focus-visible:ring-0" />
                  <Button size="sm" className="h-8 bg-emerald-600 hover:bg-emerald-500 text-[10px] font-bold tracking-widest px-4">SET</Button>
                </div>
              </div>
            )}

            <div className="flex justify-between items-center border-t border-slate-800 pt-4 mt-auto">
              <div className="flex flex-col">
                <span className="text-[9px] text-slate-500 font-bold tracking-widest">LAST STATUS</span>
                <span className="text-[11px] text-slate-300 font-mono">{w.last_status?.toUpperCase() || 'IDLE'}</span>
              </div>
              <div className="flex gap-1.5 opacity-60 group-hover:opacity-100 transition-opacity">
                <Button onClick={() => {
                   window.dispatchEvent(new CustomEvent('switch-tab', { detail: 'creation' }));
                   setTimeout(() => window.dispatchEvent(new CustomEvent('edit-workflow', { detail: w })), 100);
                }} size="sm" variant="ghost" className="h-8 px-2 text-[10px] border border-slate-700 bg-slate-900 hover:bg-slate-800 tracking-widest hover:text-emerald-400">
                  EDIT
                </Button>
                <Button onClick={async () => {
                   await fetch(`${RELAY}/api/workflows/${w.id}`, { method: 'DELETE' }).catch(()=>null);
                   fetchWorkflows();
                }} size="sm" variant="ghost" className="h-8 px-2 text-[10px] border border-slate-700 bg-slate-900 hover:bg-red-900 hover:border-red-500 hover:text-red-400 tracking-widest">
                  DEL
                </Button>
                <Button onClick={() => setInjecting(injecting === w.id ? null : (w.id ?? null))} size="sm" variant="ghost"
                  className="h-8 px-2 text-[10px] border border-slate-700 bg-slate-900 hover:bg-slate-800 tracking-widest">
                  {"{}"}
                </Button>
                <Button onClick={() => onRun(w)} size="sm" className="h-8 px-3 text-[10px] bg-blue-600 hover:bg-blue-500 font-bold tracking-widest shadow-md">
                   <Play size={10} className="mr-1.5" /> RUN
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Dashboard Tab (Live Monitor) ─────────────────────────────────────────────

function DashboardTab({ packets, logs, logsRef, onRun, library }: {
  packets: Packet[];
  logs: string[];
  logsRef: React.RefObject<HTMLDivElement>;
  onRun: (w: any) => void;
  library: Workflow[];
}) {
  const [filterStr, setFilterStr] = useState('');
  const [levelFilter, setLevelFilter] = useState<'ALL' | 'INFO' | 'SUCCESS' | 'EXPLOIT' | 'CRITICAL'>('ALL');
  const [selectedPkt, setSelectedPkt] = useState<Packet | null>(null);
  const [isPaused, setIsPaused]       = useState(false);
  const [schema, setSchema]           = useState('sec-audit');
  const [isRunning, setIsRunning]     = useState(false);
  const [progress, setProgress]       = useState(0);
  const [visPackets, setVisPackets]   = useState<Packet[]>([]);

  useEffect(() => { if (!isPaused) setVisPackets(packets); }, [packets, isPaused]);

  useEffect(() => {
    const last = logs[logs.length - 1] ?? '';
    const m = last.match(/\[PROGRESS\]\s*(\d+)%/);
    if (m) setProgress(parseInt(m[1]));
    if (last.includes('[COMPLETE]')) { setProgress(100); setTimeout(() => { setIsRunning(false); setProgress(0); }, 2000); }
  }, [logs]);

  const filtered = visPackets.filter(p => {
    const q = filterStr.toLowerCase();
    const matchSearch = !q || p.sourceIp.includes(q) || p.payload.toLowerCase().includes(q);
    const matchLevel = levelFilter === 'ALL' || p.level === levelFilter;
    return matchSearch && matchLevel;
  });

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#020617]">

      {/* ── COMMAND DECK & FILTERS ── */}
      <section className="border-b border-[#1e293b] bg-[#050914] flex flex-col z-20 shadow-md">
        
        {/* The Exact Tool-bar Row requested */}
        <div className="h-[54px] flex items-center justify-between border-b border-[#1e293b] px-0 pl-6 w-full shrink-0">
          <div className="flex items-center gap-4 h-full border-r border-[#1e293b] pr-6">
            <span className="text-[11px] font-black tracking-widest text-[#475569] uppercase">GLOBAL LEVELR</span>
            <div className="relative">
               <Input placeholder="Filter by IP or payload..." value={filterStr} onChange={e => setFilterStr(e.target.value)}
                 className="h-8 text-[11px] font-mono bg-[#0f172a] border-[#1e293b] focus-visible:ring-emerald-500/50 rounded-sm px-3 w-[250px] text-emerald-400 placeholder:text-slate-600 shadow-inner" />
            </div>
          </div>
          
          <div className="flex items-center gap-2 px-6 h-full flex-1">
            {['ALL', 'INFO', 'SUCCESS', 'EXPLOIT', 'CRITICAL'].map(l => (
              <button key={l} onClick={() => setLevelFilter(l as any)}
                className={`px-4 py-1.5 rounded-[4px] text-[10px] font-black tracking-[0.15em] border transition-all ${
                  levelFilter === l 
                    ? `bg-emerald-950/40 border-emerald-500/60 text-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.1)]` 
                    : `bg-transparent border-[#1e293b] text-slate-500 hover:text-slate-300 hover:border-slate-600`
                }`}>
                {l}
              </button>
            ))}
          </div>

          <div className="flex items-center border-l border-[#1e293b] h-full px-6 gap-3">
             <Button onClick={() => setIsRunning(true)} className="h-8 text-[10px] bg-blue-700 hover:bg-blue-600 font-bold tracking-widest uppercase">
               <Play size={12} className="mr-1.5" /> Execute Standard Routine
             </Button>
          </div>
        </div>
        
        {isRunning && (
           <div className="h-1 bg-slate-900 w-full overflow-hidden">
             <div className="h-full bg-blue-500 shadow-[0_0_8px_#3b82f6] transition-all duration-300" style={{ width: `${progress}%` }} />
           </div>
        )}
      </section>

      {/* ── MIDDLE PANE: Table & Inspector ── */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Packet Table */}
        <div className="flex-1 border-r border-[#1e293b] bg-[#020617] flex flex-col font-mono text-[11px]">
          <div className="h-8 border-b border-[#1e293b] bg-[#091122] flex items-center justify-between px-4 font-bold text-slate-500 tracking-widest text-[10px] uppercase">
            <span>Live Security Feed</span>
            <button onClick={() => setIsPaused(!isPaused)} className={`flex items-center gap-1 ${isPaused ? 'text-red-400' : 'text-emerald-400 hover:text-emerald-300'}`}>
              {isPaused ? <><Play size={10}/> RESUME</> : <><Pause size={10}/> LIVE</>}
            </button>
          </div>
          <ScrollArea className="flex-1 bg-[#020617]">
            <Table>
              <TableHeader className="bg-[#050914] sticky top-0 z-10 shadow-sm">
                <TableRow className="border-b border-slate-800 hover:bg-transparent">
                  <TableHead className="w-24 text-[10px] text-slate-500">TIME</TableHead>
                  <TableHead className="w-24 text-[10px] text-slate-500">LEVEL</TableHead>
                  <TableHead className="w-32 text-[10px] text-slate-500">SOURCE IP</TableHead>
                  <TableHead className="text-[10px] text-slate-500">PAYLOAD</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(p => (
                  <TableRow key={p.id} onClick={() => setSelectedPkt(p)}
                     className={`cursor-pointer border-b border-slate-800/50 hover:bg-[#0f172a] transition-colors ${selectedPkt?.id === p.id ? 'bg-[#0f172a] border-emerald-900 flex-none' : ''}`}>
                    <TableCell className="text-slate-500">{p.timestamp}</TableCell>
                    <TableCell><span className={`px-2 py-0.5 rounded text-[9px] font-bold ${levelClass(p.level)}`}>{p.level}</span></TableCell>
                    <TableCell className="text-slate-400">{p.sourceIp}</TableCell>
                    <TableCell className="text-slate-300 truncate max-w-[200px]">{p.payload}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </div>

        {/* Inspector */}
        <div className="w-[380px] bg-[#050914] flex flex-col shadow-[-5px_0_15px_rgba(0,0,0,0.5)] z-10">
          <div className="h-8 border-b border-[#1e293b] bg-[#091122] flex items-center px-4 text-[10px] font-bold text-slate-500 tracking-widest uppercase shadow-md">DETAIL INSPECTOR</div>
          <div className="flex-1 p-5 overflow-y-auto">
            {!selectedPkt ? (
              <div className="h-full flex items-center justify-center text-[11px] text-slate-600 font-mono tracking-widest text-center">Select a packet from the feed<br/>to inspect payload</div>
            ) : (
              <div className="space-y-6">
                <div className="flex justify-between items-center border-b border-slate-800 pb-4">
                  <div>
                    <div className="text-[10px] text-slate-500 tracking-widest mb-1 uppercase font-bold">Event ID</div>
                    <div className="text-[12px] text-emerald-400 font-mono">{selectedPkt.id}</div>
                  </div>
                  <Badge className={`text-[10px] font-black tracking-widest px-3 py-1 ${levelClass(selectedPkt.level)}`}>{selectedPkt.level}</Badge>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-[#0a0f1c] p-3 rounded border border-slate-800 shadow-inner">
                    <div className="text-[9px] text-slate-500 tracking-widest mb-1.5 font-bold uppercase">Source IP</div>
                    <div className="text-[11px] text-slate-200 font-mono">{selectedPkt.sourceIp}</div>
                  </div>
                  <div className="bg-[#0a0f1c] p-3 rounded border border-slate-800 shadow-inner">
                    <div className="text-[9px] text-slate-500 tracking-widest mb-1.5 font-bold uppercase">Timestamp</div>
                    <div className="text-[11px] text-slate-200 font-mono">{selectedPkt.timestamp}</div>
                  </div>
                </div>

                <div className="space-y-2 pt-2">
                  <div className="text-[10px] text-slate-500 tracking-widest font-bold uppercase">Decoded Payload Segment</div>
                  <div className="w-full bg-[#0a0f1c] border border-slate-700/60 rounded p-4 text-[11px] text-orange-400 font-mono break-all leading-loose shadow-[inset_0_4px_10px_rgba(0,0,0,0.5)]">
                    {selectedPkt.payload}
                  </div>
                </div>
                
                <div className="pt-4 border-t border-slate-800 flex gap-2">
                  <Button size="sm" className="flex-1 text-[10px] font-bold tracking-widest bg-emerald-900 border border-emerald-500/50 text-emerald-400 hover:bg-emerald-800">TRACE ORIGIN</Button>
                  <Button size="sm" className="flex-1 text-[10px] font-bold tracking-widest bg-red-900 border border-red-500/50 text-red-400 hover:bg-red-800">BLOCK IP</Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── BOTTOM TERMINAL (On-the-fly Decryption) ── */}
      <div className="h-[220px] bg-black border-t border-[#1e293b] flex flex-col font-mono text-[11px] shrink-0 z-20 shadow-[0_-5px_20px_rgba(0,0,0,0.5)]">
        <div className="flex items-center justify-between px-4 h-8 border-b border-[#1e293b] bg-[#050914]">
          <div className="flex items-center gap-2">
            <Terminal size={12} className="text-emerald-500" />
            <span className="tracking-widest font-bold text-slate-500 text-[10px]">RAW TELEMETRY / ON-THE-FLY ENGINE LOG DECRYPTION</span>
          </div>
          <div className="flex items-center gap-2">
             <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
             <span className="text-[9px] font-bold text-slate-400 tracking-widest">STREAMING</span>
          </div>
        </div>
        <div ref={logsRef} className="flex-1 p-4 overflow-y-auto leading-[1.6]">
           {logs.length === 0 ? <div className="text-slate-600">Waiting for C++ engine byte-stream...</div> : logs.map((l, i) => {
              
              // Progress Bar parser
              if (l.includes('[PROGRESS]')) {
                 const m = l.match(/\[PROGRESS\]\s*(\d+)%/);
                 const pct = m ? m[1] : 0;
                 return (
                   <div key={i} className="flex items-center gap-3 py-1">
                      <span className="text-blue-500">[{new Date().toISOString().substring(11,19)}]</span>
                      <span className="bg-blue-500/20 text-blue-400 px-1 rounded text-[10px]">SYS</span>
                      <div className="w-[180px] h-2 bg-slate-800 rounded overflow-hidden">
                        <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-blue-400 font-bold">{pct}%</span>
                      <span className="text-slate-400 ml-2">{l.split('—')[1]}</span>
                   </div>
                 );
              }

              // Decryption parsing simulator
              let displayLine = l;
              if (l.includes('[ENGINE]') && l.length > 50) {
                 displayLine = `<span class="text-slate-500">[${new Date().toISOString().substring(11,19)}]</span> ` + 
                               `<span class="text-orange-400">[AES-256 DECRYPTED]</span> ` + 
                               `<span class="text-slate-300">${l.substring(20, 60)}...</span>`;
              }

              return (
                 <div key={i} className={`py-1 ${l.includes('[CRITICAL]') || l.includes('ERROR') ? 'text-red-400' : 'text-slate-400'}`}>
                   {displayLine === l ? <span className="text-slate-500">[{new Date().toISOString().substring(11,23)}] <span className="text-slate-400">{l}</span></span> : <span dangerouslySetInnerHTML={{ __html: displayLine }} />}
                 </div>
              );
           })}
        </div>
      </div>
    </div>
  );
}

// ─── Root Dashboard Router ───────────────────────────────────────────────────

export default function Dashboard() {
  const [tab, setTab]                 = useState<'dashboard' | 'workflows' | 'creation'>('dashboard');
  const [packets, setPackets]         = useState<Packet[]>([]);
  const [vitals, setVitals]           = useState<Vitals>({ cpu: 0, ram: 0 });
  const [logs, setLogs]               = useState<string[]>([]);
  const [library, setLibrary]         = useState<Workflow[]>([]);
  const [totalPackets, setTotalPkts]  = useState(0);
  const logsRef                       = useRef<HTMLDivElement>(null);
  const isPausedRef                   = useRef(false);

  const fetchWorkflows = useCallback(async () => {
    try {
      const r = await fetch(`${RELAY}/api/workflows`);
      setLibrary(await r.json());
    } catch { } // ignore
  }, []);

  useEffect(() => {
    const handleTab = (e: Event) => setTab((e as CustomEvent).detail);
    window.addEventListener('switch-tab', handleTab);
    return () => window.removeEventListener('switch-tab', handleTab);
  }, []);

  useEffect(() => {
    socket.on('packet-received', (pkt: Packet) => {
      if (isPausedRef.current) return;
      setPackets(p => [pkt, ...p].slice(0, 400));
      setTotalPkts(n => n + 1);
    });
    socket.on('system-vitals', (d: Vitals) => setVitals(d));
    socket.on('raw-log', (l: string) => setLogs(p => [...p, l].slice(-100)));
    fetchWorkflows();
    return () => { socket.off('packet-received'); socket.off('system-vitals'); socket.off('raw-log'); };
  }, [fetchWorkflows]);

  useEffect(() => {
    if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight;
  }, [logs]);

  const handleRun = (workflowObj: any) => {
    fetch(`${RELAY}/api/execute-workflow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(workflowObj),
    });
  };

  const handlePurge = () => { fetch(`${RELAY}/api/purge-logs`, { method: 'POST' }); setPackets([]); setLogs([]); };
  const criticalCount = packets.filter(p => p.level === 'CRITICAL' || p.level === 'EXPLOIT').length;

  return (
    <div className="flex flex-col h-screen w-full bg-[#020617] text-slate-200 overflow-hidden font-mono">
      {/* ── GLOBAL HEADER ── */}
      <div className="h-[56px] flex items-center justify-between px-6 border-b border-[#1e293b] bg-[#020617]/95 backdrop-blur-md z-50 shrink-0">
        <div className="flex items-center gap-4">
          <div className="p-2 border border-emerald-500/30 rounded-md bg-emerald-500/10 shadow-[0_0_15px_rgba(16,185,129,0.2)]">
            <Zap size={14} className="text-emerald-400" />
          </div>
          <div>
            <p className="text-[13px] font-black tracking-[0.2em] text-white leading-tight">AUTOMATION ORCHESTRATOR</p>
            <p className="text-[9px] text-[#475569] tracking-[0.25em] font-bold">v4.2.1 // WIRESHARK-MODE</p>
          </div>
        </div>

        {/* Tab Router */}
        <nav className="flex items-center gap-2 absolute left-1/2 -translate-x-1/2">
          {[{ id: 'dashboard', label: 'Monitor' }, { id: 'creation', label: 'Blueprint' }, { id: 'workflows', label: 'Library' }].map(t => (
            <button key={t.id} onClick={() => setTab(t.id as any)}
              className={`px-5 py-1.5 rounded-full text-[11px] font-black tracking-widest transition-all border ${
                tab === t.id ? 'bg-[#0f172a] border-emerald-500/50 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.1)]' : 'border-transparent text-slate-500 hover:text-slate-300'
              }`}>{t.label.toUpperCase()}</button>
          ))}
        </nav>

        <div className="flex items-center gap-6 h-full py-1">
          <div className="flex items-center gap-5 mr-4">
            <RadialGauge value={vitals.cpu} label="CPU" color="#ef4444" size={40} />
            <RadialGauge value={vitals.ram} label="RAM" color="#10b981" size={40} />
          </div>
          {[
            { label: 'PACKETS',  val: totalPackets, color: 'text-slate-200' },
            { label: 'THREATS',  val: criticalCount, color: 'text-red-500 shadow-[0_0_10px_rgba(239,68,68,0.2)]' },
          ].map((s) => (
            <div key={s.label} className="flex flex-col items-center border-l border-[#1e293b] pl-5 h-full justify-center">
              <span className={`text-[12px] font-black tracking-widest ${s.color}`}>{s.val}</span>
              <span className="text-[8px] text-slate-600 font-bold tracking-[0.2em] mt-0.5">{s.label}</span>
            </div>
          ))}
          <div className="flex items-center gap-1 border-l border-[#1e293b] pl-5 ml-1 h-full">
            <button onClick={handlePurge} className="p-2 rounded hover:bg-red-950/40 hover:text-red-400 text-slate-600 transition-colors"><Trash2 size={13} /></button>
            <button onClick={() => fetch(`${RELAY}/api/restart-core`, { method: 'POST' })} className="p-2 rounded hover:bg-blue-950/40 hover:text-blue-400 text-slate-600 transition-colors"><RefreshCw size={13} /></button>
          </div>
        </div>
      </div>

      {/* ── TAB OUTLET ROUTER ── */}
      <div className="flex-1 flex flex-col min-h-0 bg-[#020617] overflow-hidden">
        {tab === 'dashboard'  && <DashboardTab packets={packets} logs={logs} logsRef={logsRef as React.RefObject<HTMLDivElement>} onRun={handleRun} library={library} />}
        {tab === 'workflows'  && <WorkflowsTab library={library} fetchWorkflows={fetchWorkflows} onRun={handleRun} />}
        {tab === 'creation'   && <BlueprintTab fetchWorkflows={fetchWorkflows} />}
      </div>
    </div>
  );
}
