import { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import {
  Zap, Activity, Trash2, RefreshCw, Square,
  Play, Pause, ChevronRight, Settings, Database, Terminal,
  GitBranch, RotateCcw, X, Check, Lock, Unlock,
  GripVertical, ArrowRight, Layers, Cpu, MemoryStick
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Label } from "@/components/ui/label";

// ─── Types ──────────────────────────────────────────────────────────────────

interface Packet {
  id: string;
  level: 'CRITICAL' | 'SUCCESS' | 'INFO' | 'WARN' | 'ERROR';
  sourceIp: string;
  payload: string;
  timestamp: string;
  raw?: string;
}

interface Vitals { cpu: number; ram: number; }

interface CanvasBlock {
  id: string;
  type: 'INIT_THREAD' | 'SCAN_PORT' | 'RUN_SCRIPT' | 'LOOP' | 'CONDITION' | 'SAVE_DB';
  label: string;
  x: number;
  y: number;
  settings: BlockSettings;
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

const MODULE_PALETTE: { type: CanvasBlock['type']; label: string; icon: typeof Zap; color: string }[] = [
  { type: 'INIT_THREAD', label: 'Init Thread',  icon: Zap,        color: 'text-cyan-400 border-cyan-500/40' },
  { type: 'SCAN_PORT',   label: 'Scan Port',    icon: Activity,   color: 'text-emerald-400 border-emerald-500/40' },
  { type: 'RUN_SCRIPT',  label: 'Run Script',   icon: Terminal,   color: 'text-violet-400 border-violet-500/40' },
  { type: 'LOOP',        label: 'Loop',         icon: RotateCcw,  color: 'text-amber-400 border-amber-500/40' },
  { type: 'CONDITION',   label: 'Condition',    icon: GitBranch,  color: 'text-red-400 border-red-500/40' },
  { type: 'SAVE_DB',     label: 'Save DB',      icon: Database,   color: 'text-sky-400 border-sky-500/40' },
];

const DEFAULT_SETTINGS: BlockSettings = {
  startDelay: 0, iterDelay: 500, maxDuration: 30, aesSecure: true,
};

function mkBlock(type: CanvasBlock['type'], x: number, y: number): CanvasBlock {
  const def = MODULE_PALETTE.find(m => m.type === type)!;
  return { id: Math.random().toString(36).slice(2, 8).toUpperCase(), type, label: def.label, x, y, settings: { ...DEFAULT_SETTINGS } };
}

// ─── Level colour helper ──────────────────────────────────────────────────────

function levelClass(level: Packet['level']) {
  switch (level) {
    case 'CRITICAL': return 'bg-red-500/20 text-red-400 border border-red-500/30';
    case 'SUCCESS':  return 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30';
    case 'WARN':     return 'bg-amber-500/20 text-amber-400 border border-amber-500/30';
    case 'ERROR':    return 'bg-orange-500/20 text-orange-400 border border-orange-500/30';
    default:         return 'bg-slate-800/60 text-slate-400 border border-slate-700/50';
  }
}

// ─── Radial gauge ─────────────────────────────────────────────────────────────

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

// ─── Block Settings Modal ─────────────────────────────────────────────────────

function BlockSettingsModal({ block, onClose, onSave }: {
  block: CanvasBlock;
  onClose: () => void;
  onSave: (s: BlockSettings) => void;
}) {
  const [s, setS] = useState<BlockSettings>({ ...block.settings });
  const upd = (k: keyof BlockSettings, v: any) => setS(p => ({ ...p, [k]: v }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-[420px] bg-[#0f172a] border border-slate-700 rounded-xl shadow-2xl shadow-black/60 font-mono">
        {/* header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Settings size={14} className="text-emerald-400" />
            <span className="text-[11px] font-bold text-white tracking-widest">ACTION SETTINGS — {block.label}</span>
          </div>
          <button onClick={onClose} className="text-slate-600 hover:text-slate-300 transition-colors"><X size={16}/></button>
        </div>
        <div className="p-5 space-y-4">
          {/* target / command */}
          {(block.type === 'SCAN_PORT' || block.type === 'RUN_SCRIPT') && (
            <div className="space-y-1">
              <Label className="text-[9px] text-slate-500 tracking-widest">{block.type === 'SCAN_PORT' ? 'TARGET_IP / PORT_RANGE' : 'SCRIPT_COMMAND'}</Label>
              <Input value={s.target ?? ''} onChange={e => upd('target', e.target.value)}
                className="bg-black border-slate-800 h-8 text-[11px] text-slate-200" placeholder="e.g. 203.0.113.1:80" />
            </div>
          )}
          {/* AES toggle */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-black/40 border border-slate-800">
            <div className="flex items-center gap-2">
              {s.aesSecure ? <Lock size={13} className="text-emerald-400" /> : <Unlock size={13} className="text-slate-500" />}
              <span className="text-[10px] text-slate-300 font-bold">AES-256 SECURE</span>
              <span className="text-[8px] text-slate-600">Encrypts params before dispatch</span>
            </div>
            <button onClick={() => upd('aesSecure', !s.aesSecure)}
              className={`w-10 h-5 rounded-full relative transition-colors ${s.aesSecure ? 'bg-emerald-600' : 'bg-slate-700'}`}>
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${s.aesSecure ? 'left-5' : 'left-0.5'}`} />
            </button>
          </div>
          {/* timers */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { key: 'startDelay',   label: 'START DELAY',       unit: 'ms'  },
              { key: 'iterDelay',    label: 'ITERATION DELAY',   unit: 'ms'  },
              { key: 'maxDuration',  label: 'MAX DURATION (TTL)',  unit: 's'  },
            ].map(({ key, label, unit }) => (
              <div key={key} className="space-y-1">
                <Label className="text-[8px] text-slate-500 tracking-widest">{label}</Label>
                <div className="flex items-center gap-1">
                  <Input type="number" value={(s as any)[key]}
                    onChange={e => upd(key as keyof BlockSettings, parseInt(e.target.value) || 0)}
                    className="bg-black border-slate-800 h-8 text-[11px] text-slate-200 w-full" />
                  <span className="text-[9px] text-slate-600">{unit}</span>
                </div>
              </div>
            ))}
          </div>
          {/* dynamic var injector */}
          <div className="space-y-2 p-3 rounded-lg bg-black/40 border border-slate-800">
            <Label className="text-[9px] text-slate-400 tracking-widest font-bold">DYNAMIC VARIABLE INJECTOR</Label>
            <Select value={s.dynamicVar ?? 'none'} onValueChange={v => upd('dynamicVar', v)}>
              <SelectTrigger className="bg-black border-slate-700 h-8 text-[10px]"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-[#0f172a] border-slate-700">
                <SelectItem value="none">— No Dynamic Var —</SelectItem>
                <SelectItem value="TARGET_IP">TARGET_IP</SelectItem>
                <SelectItem value="ACCESS_CREDS">ACCESS_CREDS</SelectItem>
                <SelectItem value="PRIORITY">PRIORITY</SelectItem>
              </SelectContent>
            </Select>
            {s.dynamicVar && s.dynamicVar !== 'none' && (
              <Input placeholder={`Value for ${s.dynamicVar}`} value={s.varValue ?? ''}
                onChange={e => upd('varValue', e.target.value)}
                className="bg-black border-slate-800 h-8 text-[11px] text-slate-200" />
            )}
          </div>
          {/* wait/timeout row */}
          <div className="p-3 rounded-lg bg-black/40 border border-slate-800 space-y-2">
            <Label className="text-[9px] text-slate-500 tracking-widest">WAIT FOR RESULT BEFORE NEXT ACTION</Label>
            <div className="flex items-center gap-2 text-[10px] text-slate-400">
              <Input type="number" defaultValue={200} className="bg-black border-slate-700 h-7 w-20 text-[10px]" />
              <span>ms, Timeout:</span>
              <Input type="number" defaultValue={5000} className="bg-black border-slate-700 h-7 w-20 text-[10px]" />
              <span>ms</span>
            </div>
          </div>
        </div>
        <div className="px-5 pb-5 flex justify-end gap-3">
          <Button variant="ghost" onClick={onClose} className="h-8 text-[10px] border border-slate-700 hover:bg-slate-800">CANCEL</Button>
          <Button onClick={() => { onSave(s); onClose(); }}
            className="h-8 text-[10px] bg-emerald-600 hover:bg-emerald-500 font-bold tracking-widest">
            <Check size={12} className="mr-1" /> APPLY
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Blueprint Canvas Tab ─────────────────────────────────────────────────────

function BlueprintTab({ fetchWorkflows }: { fetchWorkflows: () => void }) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [blocks, setBlocks] = useState<CanvasBlock[]>([]);
  const [editingBlock, setEditingBlock] = useState<CanvasBlock | null>(null);
  const [dragging, setDragging] = useState<{ id: string; ox: number; oy: number } | null>(null);
  const [workflowName, setWorkflowName] = useState('New Automation Routine');
  const [saving, setSaving] = useState(false);

  const dropBlock = (type: CanvasBlock['type'], e: React.DragEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left - 60;
    const y = e.clientY - rect.top - 20;
    setBlocks(p => [...p, mkBlock(type, x, y)]);
  };

  const onBlockMouseDown = (id: string, e: React.MouseEvent) => {
    const b = blocks.find(b => b.id === id)!;
    setDragging({ id, ox: e.clientX - b.x, oy: e.clientY - b.y });
    e.preventDefault();
  };

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!dragging) return;
    setBlocks(p => p.map(b => b.id === dragging.id
      ? { ...b, x: e.clientX - dragging.ox, y: e.clientY - dragging.oy }
      : b));
  }, [dragging]);

  const onMouseUp = useCallback(() => setDragging(null), []);

  useEffect(() => {
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => { window.removeEventListener('mousemove', onMouseMove); window.removeEventListener('mouseup', onMouseUp); };
  }, [onMouseMove, onMouseUp]);

  const saveBlock = (id: string, s: BlockSettings) =>
    setBlocks(p => p.map(b => b.id === id ? { ...b, settings: s } : b));

  const removeBlock = (id: string) => setBlocks(p => p.filter(b => b.id !== id));

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch(`${RELAY}/api/save-workflow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: workflowName, schema: 'blueprint', routine: blocks.map(b => ({ task: b.type, settings: b.settings })) }),
      });
      fetchWorkflows();
    } finally { setSaving(false); }
  };

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* Module Palette */}
      <aside className="w-44 border-r border-slate-800 bg-black/30 flex flex-col">
        <div className="px-4 py-3 border-b border-slate-800">
          <span className="text-[9px] text-slate-500 font-bold tracking-widest">MODULE_PALETTE</span>
        </div>
        <div className="p-3 space-y-2 flex-1">
          {MODULE_PALETTE.map(mod => {
            const Icon = mod.icon;
            return (
              <div key={mod.type}
                draggable
                onDragStart={e => e.dataTransfer.setData('blockType', mod.type)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border bg-black/40 cursor-grab active:cursor-grabbing text-[10px] font-bold hover:bg-slate-800/60 transition-all select-none ${mod.color}`}>
                <GripVertical size={10} className="text-slate-600" />
                <Icon size={12} />
                {mod.label}
              </div>
            );
          })}
        </div>
      </aside>

      {/* Canvas */}
      <div className="flex-1 flex flex-col">
        {/* canvas toolbar */}
        <div className="h-12 border-b border-slate-800 flex items-center px-6 gap-4 bg-black/20">
          <span className="text-[10px] text-slate-500 tracking-widest font-bold">BLUEPRINT_CANVAS</span>
          <div className="flex-1">
            <Input value={workflowName} onChange={e => setWorkflowName(e.target.value)}
              className="bg-transparent border-none h-7 text-[11px] text-slate-300 font-mono focus:ring-0 max-w-xs" />
          </div>
          <Button onClick={handleSave} disabled={saving}
            className="h-8 px-4 bg-emerald-600 hover:bg-emerald-500 text-[10px] font-black tracking-widest border-b-2 border-emerald-400 active:border-b-0">
            {saving ? 'SAVING...' : 'SAVE WORKFLOW'}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setBlocks([])}
            className="h-8 text-[10px] text-slate-500 hover:text-red-400 border border-slate-800 hover:border-red-800">
            <Trash2 size={12} className="mr-1" /> CLEAR
          </Button>
        </div>

        {/* drop zone */}
        <div ref={canvasRef} className="flex-1 relative bg-[#020617] overflow-hidden"
          style={{ backgroundImage: 'radial-gradient(circle, #1e293b 1px, transparent 1px)', backgroundSize: '28px 28px' }}
          onDragOver={e => e.preventDefault()}
          onDrop={e => { const t = e.dataTransfer.getData('blockType') as CanvasBlock['type']; if (t) dropBlock(t, e); }}>

          {/* connectors (SVG) */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 0 }}>
            {blocks.slice(0, -1).map((b, i) => {
              const next = blocks[i + 1];
              if (!next) return null;
              const x1 = b.x + 100, y1 = b.y + 20, x2 = next.x, y2 = next.y + 20;
              return <path key={b.id + next.id} d={`M${x1},${y1} C${(x1+x2)/2},${y1} ${(x1+x2)/2},${y2} ${x2},${y2}`}
                fill="none" stroke="#334155" strokeWidth="1.5" strokeDasharray="4 3" />;
            })}
          </svg>

          {/* blocks */}
          {blocks.map((b, i) => {
            const mod = MODULE_PALETTE.find(m => m.type === b.type)!;
            const Icon = mod.icon;
            return (
              <div key={b.id}
                style={{ position: 'absolute', left: b.x, top: b.y, zIndex: 10 }}
                className="group select-none"
                onMouseDown={e => onBlockMouseDown(b.id, e)}>
                <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border bg-[#0f172a] cursor-grab shadow-lg text-[10px] font-bold ${mod.color} min-w-[120px]`}>
                  {i > 0 && <ArrowRight size={10} className="text-slate-600 -ml-1 -mr-1 absolute -left-5 top-2" />}
                  <Icon size={12} />
                  <span className="flex-1">{b.label}</span>
                  <span className="text-[8px] text-slate-700 font-mono">{b.id}</span>
                  <button onClick={e => { e.stopPropagation(); setEditingBlock(b); }}
                    className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-white transition-all ml-1">
                    <Settings size={10} />
                  </button>
                  <button onClick={e => { e.stopPropagation(); removeBlock(b.id); }}
                    className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 transition-all">
                    <X size={10} />
                  </button>
                </div>
                {b.settings.aesSecure && (
                  <span className="absolute -bottom-4 left-0 text-[7px] text-emerald-600 flex items-center gap-1"><Lock size={7} />AES-256</span>
                )}
              </div>
            );
          })}

          {blocks.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-700 pointer-events-none">
              <Layers size={40} className="mb-3 opacity-30" />
              <p className="text-[11px] tracking-widest font-bold">DRAG MODULES FROM PALETTE</p>
              <p className="text-[9px] mt-1">Drop blocks to chain automation routines</p>
            </div>
          )}
        </div>
      </div>

      {editingBlock && (
        <BlockSettingsModal
          block={editingBlock}
          onClose={() => setEditingBlock(null)}
          onSave={s => { saveBlock(editingBlock.id, s); setEditingBlock(null); }}
        />
      )}
    </div>
  );
}

// ─── Workflow Library Tab ─────────────────────────────────────────────────────

function WorkflowsTab({ library, fetchWorkflows, onRun }: {
  library: Workflow[];
  fetchWorkflows: () => void;
  onRun: (w: Workflow) => void;
}) {
  const [injecting, setInjecting] = useState<number | null>(null);
  const [dynVars, setDynVars] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState('');

  const filtered = library.filter(w => w.name.toLowerCase().includes(filter.toLowerCase()));

  const deleteWorkflow = async (id?: number) => {
    if (!id) return;
    await fetch(`${RELAY}/api/workflows/${id}`, { method: 'DELETE' });
    fetchWorkflows();
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 p-6 overflow-auto">
      {/* toolbar */}
      <div className="flex items-center gap-3 mb-5">
        <span className="text-[10px] text-slate-500 font-bold tracking-widest">WORKFLOW_LIBRARY</span>
        <div className="flex-1">
          <Input placeholder="Filter workflows..." value={filter} onChange={e => setFilter(e.target.value)}
            className="bg-black/40 border-slate-800 h-8 text-[10px] max-w-xs" />
        </div>
        <Button variant="ghost" size="sm" onClick={fetchWorkflows} className="h-8 text-[10px] border border-slate-800 hover:bg-slate-800">
          <RefreshCw size={12} className="mr-1" /> REFRESH
        </Button>
        <Badge variant="outline" className="text-[9px] border-slate-700 text-slate-500">{library.length} SCHEMAS</Badge>
      </div>

      {/* grid */}
      {filtered.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center text-slate-700">
          <Database size={36} className="mb-3 opacity-30" />
          <p className="text-[11px] tracking-widest font-bold">NO WORKFLOWS SAVED</p>
          <p className="text-[9px] mt-1">Build one on the Blueprint canvas and save it.</p>
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        {filtered.map(w => {
          const params = (() => { try { return JSON.parse(w.parameters); } catch { return {}; } })();
          const steps = Array.isArray(params.routine) ? params.routine.length : '—';
          return (
            <div key={w.id} className="group border border-slate-800 bg-black/40 rounded-xl p-4 hover:border-emerald-500/40 transition-all">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="text-[12px] font-black text-slate-100">{w.name}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge className="text-[7px] bg-slate-900 border-slate-700 text-slate-400">{w.schema_type}</Badge>
                    <span className={`text-[7px] font-bold px-1 rounded ${w.last_status === 'active' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-500'}`}>
                      {w.last_status?.toUpperCase() ?? 'IDLE'}
                    </span>
                  </div>
                </div>
                <span className="text-[8px] text-slate-700">{steps} steps</span>
              </div>

              <p className="text-[8px] text-slate-600 mb-3">{new Date(w.created_at!).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })}</p>

              {/* dynamic var injector for this workflow */}
              {injecting === w.id && (
                <div className="mb-3 p-3 bg-black/60 rounded-lg border border-slate-800 space-y-2">
                  <Label className="text-[8px] text-slate-500 tracking-widest">DYNAMIC VARIABLE</Label>
                  <Input placeholder="IP-188T-43 / override val…" value={dynVars[w.id!] ?? ''}
                    onChange={e => setDynVars(p => ({ ...p, [w.id!]: e.target.value }))}
                    className="bg-black border-slate-700 h-7 text-[10px]" />
                </div>
              )}

              <div className="flex gap-2">
                <Button onClick={() => onRun(w)} size="sm"
                  className="flex-1 h-7 text-[9px] bg-blue-700 hover:bg-blue-600 font-bold tracking-widest">
                  <Play size={10} className="mr-1" /> RUN
                </Button>
                <Button onClick={() => setInjecting(injecting === w.id ? null : (w.id ?? null))} size="sm" variant="ghost"
                  className="h-7 px-2 text-[9px] border border-slate-800 hover:bg-slate-800">
                  Δ EDIT
                </Button>
                <Button onClick={() => deleteWorkflow(w.id)} size="sm" variant="ghost"
                  className="h-7 px-2 text-[9px] border border-slate-800 hover:border-red-800 hover:text-red-400">
                  <Trash2 size={10} />
                </Button>
              </div>
            </div>
          );
        })}
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
  const [filter, setFilter]           = useState('');
  const [levelFilter, setLevelFilter] = useState<'ALL' | 'EXPLOIT' | 'SAFE'>('ALL');
  const [selectedPkt, setSelectedPkt] = useState<Packet | null>(null);
  const [isPaused, setIsPaused]       = useState(false);
  const [schema, setSchema]           = useState('sec-audit');
  const [dynVars, setDynVars]         = useState({ target: '', creds: '', priority: '' });
  const [isRunning, setIsRunning]     = useState(false);
  const [progress, setProgress]       = useState(0);
  const [visPackets, setVisPackets]   = useState<Packet[]>([]);

  // Mirror live packets only when not paused
  useEffect(() => {
    if (!isPaused) setVisPackets(packets);
  }, [packets, isPaused]);

  // parse progress from logs
  useEffect(() => {
    const last = logs[logs.length - 1] ?? '';
    const m = last.match(/\[PROGRESS\]\s*(\d+)%/);
    if (m) setProgress(parseInt(m[1]));
    if (last.includes('[COMPLETE]')) { setProgress(100); setTimeout(() => { setIsRunning(false); setProgress(0); }, 2000); }
  }, [logs]);

  const filtered = visPackets.filter(p => {
    const q = filter.toLowerCase();
    const matchSearch = !q || p.sourceIp.includes(q) || p.payload.toLowerCase().includes(q);
    const matchLevel = levelFilter === 'ALL'
      || (levelFilter === 'EXPLOIT' && p.level === 'CRITICAL')
      || (levelFilter === 'SAFE'    && (p.level === 'INFO' || p.level === 'SUCCESS'));
    return matchSearch && matchLevel;
  });

  const handleExecute = () => {
    setIsRunning(true); setProgress(5);
    onRun({ name: schema, schema: schema, routine: [{ task: 'SHELL', input: { command: `echo ${schema} ${dynVars.target}` } }] });
  };

  const handleInterrupt = () => {
    fetch(`${RELAY}/api/restart-core`, { method: 'POST' });
    setIsRunning(false); setProgress(0);
  };

  const totalThreats = visPackets.filter(p => p.level === 'CRITICAL').length;
  const successCount = visPackets.filter(p => p.level === 'SUCCESS').length;

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">

      {/* ── COMMAND DECK ── */}
      <section className="border-b border-slate-800 bg-slate-900/10 px-6 py-4 grid grid-cols-12 gap-4 items-end">
        {/* schema selector */}
        <div className="col-span-2 space-y-1">
          <Label className="text-[9px] text-slate-500 tracking-widest font-bold">SCHEMA_SELECTOR</Label>
          <Select value={schema} onValueChange={setSchema}>
            <SelectTrigger className="bg-black/40 border-slate-700 h-9 text-[10px]"><SelectValue /></SelectTrigger>
            <SelectContent className="bg-[#020617] border-slate-700">
              <SelectItem value="sec-audit">Sec Audit v3.json</SelectItem>
              <SelectItem value="infra-setup">Infra Setup</SelectItem>
              <SelectItem value="data-sync">Database Sync</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* variable injector */}
        <div className="col-span-5 space-y-1">
          <Label className="text-[9px] text-slate-500 tracking-widest font-bold">VARIABLE_INJECTOR</Label>
          <div className="flex gap-2">
            <Input placeholder="IP-492.260.1.390" value={dynVars.target}
              onChange={e => setDynVars(p => ({...p, target: e.target.value}))}
              className="bg-black/40 border-slate-700 h-9 text-[10px] flex-1" />
            <Input placeholder="MSH:1337+66,A3" value={dynVars.creds} type="password"
              onChange={e => setDynVars(p => ({...p, creds: e.target.value}))}
              className="bg-black/40 border-slate-700 h-9 text-[10px] flex-1" />
            <Input placeholder="Priority" value={dynVars.priority}
              onChange={e => setDynVars(p => ({...p, priority: e.target.value}))}
              className="bg-black/40 border-slate-700 h-9 text-[10px] w-24" />
          </div>
        </div>

        {/* action buttons */}
        <div className="col-span-3 flex gap-2 items-end">
          <Button onClick={handleExecute} disabled={isRunning}
            className={`flex-1 h-9 font-black text-[10px] tracking-widest transition-all
              ${isRunning ? 'bg-amber-600 hover:bg-amber-500 border-amber-400' : 'bg-blue-700 hover:bg-blue-600 border-blue-500 shadow-[0_0_15px_rgba(37,99,235,0.3)]'}
              border-b-4 active:border-b-0 active:translate-y-0.5`}>
            {isRunning ? '⚙ RUNNING...' : '⚡ EXECUTE WORKFLOW'}
          </Button>
          <Button onClick={handleInterrupt} variant="ghost" size="sm"
            className="h-9 px-3 border border-red-800/60 text-red-500 hover:bg-red-950/30">
            <Square size={14} fill="currentColor" />
          </Button>
        </div>

        {/* running status text */}
        <div className="col-span-2 space-y-1">
          {isRunning && <Label className="text-[8px] text-amber-400 tracking-widest animate-pulse">Active: {schema} (Step 1/25 — Port Scan)</Label>}
          {!isRunning && <Label className="text-[8px] text-slate-600 tracking-widest">IDLE — No active routine</Label>}
          <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
            <div className="h-full bg-emerald-500 shadow-[0_0_6px_#10b981] transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
        </div>
      </section>

      {/* ── MIDDLE PANE ── */}
      <div className="flex-1 flex min-h-0 overflow-hidden">

        {/* LEFT: Packet Feed */}
        <div className="flex-1 flex flex-col border-r border-slate-800">
          {/* feed header */}
          <div className="h-10 px-4 border-b border-slate-800 flex items-center gap-3 bg-black/20 flex-shrink-0">
            <Activity size={12} className="text-emerald-400" />
            <span className="text-[9px] font-bold tracking-widest text-slate-500">GLOBAL_PACKET_FEED</span>
            <span className="text-[9px] text-slate-700">Filter by IP:</span>
            <Input value={filter} onChange={e => setFilter(e.target.value)} placeholder="0.0.0.0"
              className="bg-transparent border-slate-800 h-6 w-28 text-[9px]" />
            {/* level filter */}
            {(['ALL', 'EXPLOIT', 'SAFE'] as const).map(lv => (
              <button key={lv} onClick={() => setLevelFilter(lv)}
                className={`text-[8px] font-bold px-2 py-0.5 rounded transition-all ${levelFilter === lv ? 'bg-slate-700 text-white' : 'text-slate-600 hover:text-slate-400'}`}>
                {lv}
              </button>
            ))}
            <div className="flex-1" />
            <span className="text-[8px] text-slate-700">{filtered.length} packets</span>
            <button onClick={() => setIsPaused(p => !p)}
              className={`flex items-center gap-1 text-[8px] font-bold px-2 py-1 rounded border transition-all
                ${isPaused ? 'bg-amber-950/40 border-amber-600/50 text-amber-400' : 'bg-emerald-950/40 border-emerald-600/50 text-emerald-400'}`}>
              {isPaused ? <><Play size={9}/> LIVE</> : <><Pause size={9}/> PAUSE</>}
            </button>
          </div>

          {/* table */}
          <div className="flex-1 overflow-auto">
            <Table className="text-[10px]">
              <TableHeader className="sticky top-0 bg-black/60 z-10">
                <TableRow className="border-slate-800 hover:bg-transparent">
                  <TableHead className="w-10 px-3 text-slate-600 text-[8px]">NO.</TableHead>
                  <TableHead className="w-24 text-slate-600 text-[8px]">SOURCE_IP</TableHead>
                  <TableHead className="w-20 text-slate-600 text-[8px]">LVL</TableHead>
                  <TableHead className="text-slate-600 text-[8px]">PAYLOAD</TableHead>
                  <TableHead className="w-28 text-right pr-4 text-slate-600 text-[8px]">TIMESTAMP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((p, i) => (
                  <TableRow key={p.id} onClick={() => setSelectedPkt(prev => prev?.id === p.id ? null : p)}
                    className={`border-b border-slate-900/60 cursor-pointer transition-colors
                      ${selectedPkt?.id === p.id ? 'bg-blue-950/30 border-blue-800/40' : 'hover:bg-slate-800/20'}
                      ${p.level === 'CRITICAL' ? 'hover:bg-red-950/20' : ''}`}>
                    <TableCell className="px-3 text-slate-700 font-mono">{(i + 1).toString().padStart(4, '0')}</TableCell>
                    <TableCell className="font-mono text-slate-400">{p.sourceIp}</TableCell>
                    <TableCell>
                      <span className={`px-1.5 py-0.5 rounded-sm text-[7px] font-black ${levelClass(p.level)}`}>{p.level}</span>
                    </TableCell>
                    <TableCell className={`font-mono max-w-xs truncate ${p.level === 'CRITICAL' ? 'text-red-300' : 'text-slate-300'}`}>
                      {p.payload}
                    </TableCell>
                    <TableCell className="text-right pr-4 font-mono text-slate-600">
                      {p.timestamp?.split(' ')[1] ?? p.timestamp}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {filtered.length === 0 && (
              <div className="flex items-center justify-center h-32 text-[9px] text-slate-700 tracking-widest">AWAITING STREAM…</div>
            )}
          </div>
        </div>

        {/* RIGHT SIDEBAR — overflow-y-auto to prevent long lists from overflowing */}
        <aside className="w-[340px] flex flex-col flex-shrink-0 bg-[rgba(4,9,26,0.8)] overflow-y-auto">

          {/* Packet Detail Inspector — flex:0 0 auto so it grows with content */}
          <div style={{ flex: '0 0 auto', minHeight: '240px' }} className="flex flex-col border-b border-slate-800">
            <div className="h-9 px-4 border-b border-slate-800 flex items-center" style={{ background: 'rgba(4,9,26,0.8)', backdropFilter: 'blur(8px)' }}>
              <span className="text-[10px] font-bold tracking-widest text-slate-500">PACKET_DETAIL_INSPECTOR</span>
            </div>
            {selectedPkt ? (
              <div className="flex-1 overflow-auto p-3 space-y-2">
                {/* auto-fit responsive grid — never squashes below 140px per cell */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '8px' }}>
                  {([
                    ['PACKET ID',  selectedPkt.id],
                    ['LEVEL',      selectedPkt.level],
                    ['SOURCE IP',  selectedPkt.sourceIp],
                    ['TIMESTAMP',  selectedPkt.timestamp],
                  ] as [string, string][]).map(([label, val]) => (
                    <div key={label} className="space-y-0.5 min-w-0">
                      <p className="text-[9px] text-slate-500 uppercase tracking-widest">{label}</p>
                      <p className={`font-mono text-[11px] font-bold truncate ${
                        label === 'LEVEL'
                          ? (levelClass(selectedPkt.level).split(' ').find(c => c.startsWith('text-')) ?? 'text-white')
                          : 'text-slate-200'
                      }`} title={val}>{val}</p>
                    </div>
                  ))}
                </div>

                {/* PAYLOAD — truncated, expands on hover */}
                <div className="space-y-0.5 pt-2 border-t border-slate-800">
                  <p className="text-[9px] text-slate-500 uppercase tracking-widest">PAYLOAD</p>
                  <p className="font-mono text-[11px] text-slate-300 leading-relaxed overflow-hidden"
                    style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', cursor: 'pointer' }}
                    onClick={e => { const el = e.currentTarget; el.style.webkitLineClamp = el.style.webkitLineClamp === 'unset' ? '2' : 'unset'; }}>
                    {selectedPkt.payload}
                  </p>
                </div>

                {selectedPkt.raw && (
                  <div className="space-y-0.5 pt-2 border-t border-slate-800">
                    <p className="text-[9px] text-slate-500 uppercase tracking-widest">RAW</p>
                    <p className="font-mono text-[9px] text-slate-600 break-all leading-relaxed overflow-hidden"
                      style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', cursor: 'pointer' }}
                      onClick={e => { const el = e.currentTarget; el.style.webkitLineClamp = el.style.webkitLineClamp === 'unset' ? '2' : 'unset'; }}>
                      {selectedPkt.raw}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-[9px] text-slate-700 tracking-widest" style={{ minHeight: '100px' }}>
                ← CLICK A ROW TO INSPECT
              </div>
            )}
          </div>

          {/* Workflow Dispatcher quick-launch */}
          <div className="flex flex-col border-b border-slate-800" style={{ flex: '1 1 auto', minHeight: '140px' }}>
            <div className="h-9 px-4 border-b border-slate-800 flex items-center" style={{ background: 'rgba(4,9,26,0.8)', backdropFilter: 'blur(8px)' }}>
              <span className="text-[10px] font-bold tracking-widest text-slate-500">WORKFLOW_DISPATCHER</span>
            </div>
            <ScrollArea className="p-3" style={{ flex: '1 1 0', minHeight: '80px' }}>
              <div className="flex flex-col gap-2">
                {library.slice(0, 5).map(w => (
                  <div key={w.id}
                    className="flex items-center gap-2 p-2 border border-slate-800 rounded-lg bg-black/30 hover:border-blue-500/40 cursor-pointer group transition-all"
                    style={{ minHeight: '36px' }}
                    onClick={() => { try { onRun(JSON.parse(w.parameters)); } catch {} }}>
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
                    <span className="text-[11px] text-slate-300 flex-1 truncate">{w.name}</span>
                    <Badge className="text-[7px] bg-slate-900 border-slate-700 text-slate-500 flex-shrink-0">{w.schema_type}</Badge>
                    <ChevronRight size={12} className="text-slate-700 group-hover:text-blue-400 transition-colors flex-shrink-0" />
                  </div>
                ))}
                {library.length === 0 && <p className="text-[9px] text-slate-700 text-center py-4">No saved workflows</p>}
              </div>
            </ScrollArea>
          </div>

          {/* RAW Telemetry */}
          <div className="flex flex-col" style={{ flex: '0 0 auto', height: '200px' }}>
            <div className="h-9 px-4 border-b border-slate-800 flex items-center justify-between" style={{ background: 'rgba(4,9,26,0.8)', backdropFilter: 'blur(8px)' }}>
              <span className="text-[10px] font-bold tracking-widest text-slate-500">RAW_TELEMETRY</span>
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[9px] text-emerald-500 font-bold">STREAM_LIVE</span>
              </div>
            </div>
            <ScrollArea ref={logsRef} className="flex-1 p-3 font-mono leading-relaxed">
              {logs.map((l, i) => (
                <div key={i} className="mb-0.5 flex gap-2">
                  <span className="text-slate-700 w-6 text-right flex-shrink-0 text-[9px]">{i}</span>
                  <span className={`text-[9px] break-all ${
                    l.includes('[PROGRESS]') ? 'text-blue-400 font-bold' :
                    l.includes('SUCCESS')    ? 'text-emerald-400' :
                    l.includes('ERROR')      ? 'text-red-400' :
                    l.includes('WARN')       ? 'text-amber-400' : 'text-slate-500'
                  }`}>{l}</span>
                </div>
              ))}
            </ScrollArea>
          </div>

          {/* Threat breakdown — always visible, tight */}
          <div className="border-t border-slate-800 p-3 flex-shrink-0" style={{ background: 'rgba(4,9,26,0.8)', backdropFilter: 'blur(8px)' }}>
            <p className="text-[9px] text-slate-600 font-bold tracking-widest mb-2">THREAT_BREAKDOWN</p>
            <div className="space-y-1.5">
              {[
                { label: 'CRITICAL', val: totalThreats, color: 'bg-red-500' },
                { label: 'SUCCESS',  val: successCount, color: 'bg-emerald-500' },
              ].map(({ label, val, color }) => (
                <div key={label} className="flex items-center gap-2">
                  <span className="text-[9px] text-slate-600 w-16">{label}</span>
                  <div className="flex-1 h-1.5 bg-slate-900 rounded-full overflow-hidden">
                    <div className={`h-full ${color} transition-all duration-500`}
                      style={{ width: `${Math.min(100, (val / Math.max(visPackets.length, 1)) * 100)}%` }} />
                  </div>
                  <span className="text-[11px] font-mono text-slate-400 w-6 text-right font-bold">{val}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

// ─── Root Dashboard ───────────────────────────────────────────────────────────

export default function Dashboard() {
  const [tab, setTab]                 = useState<'dashboard' | 'workflows' | 'creation'>('dashboard');
  const [packets, setPackets]         = useState<Packet[]>([]);
  const [vitals, setVitals]           = useState<Vitals>({ cpu: 0, ram: 0 });
  const [logs, setLogs]               = useState<string[]>([]);
  const [library, setLibrary]         = useState<Workflow[]>([]);
  const [totalPackets, setTotalPkts]  = useState(0);
  const logsRef                       = useRef<HTMLDivElement>(null);
  const isPausedRef                   = useRef(false); // shared ref for socket handler

  const fetchWorkflows = useCallback(async () => {
    try {
      const r = await fetch(`${RELAY}/api/workflows`);
      const d = await r.json();
      setLibrary(d);
    } catch { /* relay may not be running */ }
  }, []);

  useEffect(() => {
    socket.on('packet-received', (pkt: Packet) => {
      if (isPausedRef.current) return;
      setPackets(p => [pkt, ...p].slice(0, 200));
      setTotalPkts(n => n + 1);
    });
    socket.on('system-vitals', (d: Vitals) => setVitals(d));
    socket.on('raw-log', (l: string) => setLogs(p => [...p, l].slice(-80)));
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

  const handlePurge = () => {
    fetch(`${RELAY}/api/purge-logs`, { method: 'POST' });
    setPackets([]); setLogs([]);
  };

  const criticalCount = packets.filter(p => p.level === 'CRITICAL').length;

  const TABS = [
    { id: 'dashboard',  label: '⬡ Dashboard' },
    { id: 'workflows',  label: '⬡ Workflows' },
    { id: 'creation',   label: '⬡ Creation'  },
  ] as const;

  return (
    <div className="flex h-screen w-full bg-[#020617] text-slate-200 overflow-hidden" style={{ fontFamily: "'JetBrains Mono', monospace" }}>

      {/* ── GLOBAL HEADER ── */}
      <div className="absolute top-0 left-0 right-0 z-20 flex items-center border-b border-slate-800 h-14 px-6 gap-6"
        style={{ background: 'rgba(4,9,26,0.95)', backdropFilter: 'blur(12px)' }}>

        {/* brand */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="p-1.5 bg-emerald-600/20 rounded-md border border-emerald-600/30 led-glow">
            <Zap size={16} className="text-emerald-400" />
          </div>
          <div>
            <p className="text-[11px] font-black tracking-tighter text-white leading-none">TACTICAL THREAT ANALYZER</p>
            <p className="text-[8px] text-slate-600 tracking-widest">v3.1 // #STEAKMARK-NONE</p>
          </div>
        </div>

        {/* tabs */}
        <nav className="flex items-center gap-1">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-4 py-1.5 rounded text-[10px] font-bold tracking-widest transition-all border
                ${tab === t.id
                  ? 'bg-slate-800 border-slate-700 text-white'
                  : 'border-transparent text-slate-500 hover:text-slate-300'}`}>
              {t.label}
            </button>
          ))}
        </nav>

        {/* stat counters */}
        <div className="flex items-center gap-6 ml-auto">
          {[
            { label: 'PACKETS',  val: totalPackets.toString().padStart(3,'0') },
            { label: 'THREATS',  val: criticalCount.toString().padStart(3,'0'), color: 'text-red-400' },
            { label: 'WORKFLOWS',val: library.length.toString().padStart(2,'0'), color: 'text-blue-400' },
          ].map(({ label, val, color }) => (
            <div key={label} className="flex flex-col items-center border-l border-slate-800 pl-5 first:border-0 first:pl-0">
              <span className={`text-sm font-black tracking-tighter ${color ?? 'text-white'}`}>{val}</span>
              <span className="text-[7px] text-slate-600 font-bold tracking-widest">{label}</span>
            </div>
          ))}
        </div>
        {/* vitals gauges — 60px gauges to save header space */}
        <div className="flex items-center gap-3 border-l border-slate-800 pl-6 flex-shrink-0">
          <div className="flex flex-col items-end gap-0.5">
            <div className="flex items-center gap-1.5">
              <Cpu size={10} className="text-emerald-500" />
              <span className="text-[9px] text-slate-500">CPU</span>
              <span className="text-[11px] text-emerald-400 font-bold">{vitals.cpu}%</span>
            </div>
            <div className="w-24 h-1 bg-slate-900 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 shadow-[0_0_4px_#10b981] transition-all duration-500" style={{ width: `${vitals.cpu}%` }} />
            </div>
          </div>
          <div className="flex flex-col items-end gap-0.5">
            <div className="flex items-center gap-1.5">
              <MemoryStick size={10} className="text-blue-500" />
              <span className="text-[9px] text-slate-500">RAM</span>
              <span className="text-[11px] text-blue-400 font-bold">{vitals.ram}%</span>
            </div>
            <div className="w-24 h-1 bg-slate-900 rounded-full overflow-hidden">
              <div className="h-full bg-blue-500 shadow-[0_0_4px_#3b82f6] transition-all duration-500" style={{ width: `${vitals.ram}%` }} />
            </div>
          </div>
          <RadialGauge value={vitals.cpu} label="CPU" color="#10b981" size={60} />
          <RadialGauge value={vitals.ram} label="RAM" color="#3b82f6" size={60} />
        </div>

        {/* action icons */}
        <div className="flex items-center gap-1 border-l border-slate-800 pl-4 flex-shrink-0">
          <button onClick={handlePurge} title="Purge logs"
            className="p-2 rounded hover:bg-red-950/30 hover:text-red-400 text-slate-600 transition-colors">
            <Trash2 size={14} />
          </button>
          <button onClick={() => fetch(`${RELAY}/api/restart-core`, { method: 'POST' })} title="Restart core"
            className="p-2 rounded hover:bg-blue-950/30 hover:text-blue-400 text-slate-600 transition-colors">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* ── BODY (below header) ── */}
      <div className="flex flex-col w-full pt-14" style={{ height: 'calc(100vh)' }}>
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {tab === 'dashboard'  && <DashboardTab packets={packets} logs={logs} logsRef={logsRef as React.RefObject<HTMLDivElement>} onRun={handleRun} library={library} />}
          {tab === 'workflows'  && <WorkflowsTab library={library} fetchWorkflows={fetchWorkflows} onRun={handleRun} />}
          {tab === 'creation'   && <BlueprintTab fetchWorkflows={fetchWorkflows} />}
        </div>
      </div>
    </div>
  );
}
