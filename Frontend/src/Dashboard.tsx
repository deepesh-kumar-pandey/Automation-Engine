import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { 
  Shield, Zap, Activity, Trash2, ShieldAlert, RefreshCw, 
  Terminal as TerminalIcon, Square, Search, PlusCircle
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

const socket = io('http://localhost:3001');

interface Packet {
  id: string;
  level: 'CRITICAL' | 'SUCCESS' | 'INFO' | 'WARN' | 'ERROR';
  sourceIp: string;
  payload: string;
  timestamp: string;
  raw?: string;
}

interface Vitals {
  cpu: number;
  ram: number;
}

interface WorkflowStep {
  task: 'SHELL' | 'BLOCK_IP' | 'DOCKER';
  input?: {
    command?: string;
    ip?: string;
    image?: string;
  };
}

interface Workflow {
  name: string;
  duration: number;
  routine: WorkflowStep[];
}

export default function Dashboard() {
  const [packets, setPackets] = useState<Packet[]>([]);
  const [vitals, setVitals] = useState<Vitals>({ cpu: 0, ram: 0 });
  const [logs, setLogs] = useState<string[]>([]);
  const [selectedPacket, setSelectedPacket] = useState<Packet | null>(null);
  const [filter, setFilter] = useState('');
  const [levelFilter, setLevelFilter] = useState<'ALL' | 'EXPLOIT' | 'SAFE'>('ALL');
  const [workflowProgress, setWorkflowProgress] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [workflowTimer, setWorkflowTimer] = useState<number | null>(null);
  const [duration, setDuration] = useState(10);
  
  const [newWorkflow, setNewWorkflow] = useState<Workflow>({
    name: "New Security Routine",
    duration: 10,
    routine: [{ task: 'SHELL', input: { command: "echo starting audit" } }]
  });

  const terminalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    socket.on('connect', () => console.log('Socket connected'));
    
    socket.on('packet-received', (packet: Packet) => {
      if (!isPaused) {
        setPackets((prev: Packet[]) => [packet, ...prev].slice(0, 100));
      }
    });

    socket.on('system-vitals', (data: Vitals) => {
      setVitals(data);
    });

    socket.on('raw-log', (log: string) => {
      if (!isPaused) {
        setLogs((prev: string[]) => [...prev, log].slice(-50));
      }
    });

    return () => {
      socket.off('packet-received');
      socket.off('system-vitals');
      socket.off('raw-log');
    };
  }, [isPaused]);

  useEffect(() => {
    let interval: any;
    if (workflowTimer !== null && workflowTimer > 0) {
      interval = setInterval(() => {
        setWorkflowTimer(prev => (prev !== null ? prev - 1 : null));
        setWorkflowProgress(prev => Math.min(100, prev + (100 / duration)));
      }, 1000);
    } else if (workflowTimer === 0) {
      setWorkflowTimer(null);
      setWorkflowProgress(0);
      console.log("Workflow auto-closed.");
    }
    return () => clearInterval(interval);
  }, [workflowTimer, duration]);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logs]);

  const filteredPackets = packets.filter((p: Packet) => {
    const matchesSearch = p.sourceIp.includes(filter) || p.payload.toLowerCase().includes(filter.toLowerCase());
    const matchesLevel = levelFilter === 'ALL' || 
                         (levelFilter === 'EXPLOIT' && p.level === 'CRITICAL') ||
                         (levelFilter === 'SAFE' && (p.level === 'INFO' || p.level === 'SUCCESS'));
    return matchesSearch && matchesLevel;
  });

  const handleRestart = () => fetch('http://localhost:3001/api/restart-core', { method: 'POST' });
  const handlePurge = () => {
    fetch('http://localhost:3001/api/purge-logs', { method: 'POST' });
    setPackets([]);
    setLogs([]);
  };

  const handleCreateWorkflow = () => {
    fetch('http://localhost:3001/api/save-workflow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newWorkflow),
    }).then(() => {
      alert("Workflow Saved and Initiated in Shared Storage");
    });
  };

  const addStep = () => {
    setNewWorkflow((prev: Workflow) => ({
      ...prev,
      routine: [...prev.routine, { task: 'SHELL', input: { command: "" } }]
    }));
  };

  const removeStep = (index: number) => {
    setNewWorkflow((prev: Workflow) => ({
      ...prev,
      routine: prev.routine.filter((_, i) => i !== index)
    }));
  };

  const updateStep = (index: number, updates: Partial<WorkflowStep>) => {
    setNewWorkflow((prev: Workflow) => {
      const newRoutine = [...prev.routine];
      newRoutine[index] = { ...newRoutine[index], ...updates };
      return { ...prev, routine: newRoutine };
    });
  };

  return (
    <div className="flex h-screen w-full bg-[#020617] text-slate-200 overflow-hidden font-sans">
      {/* ACTION SIDEBAR */}
      <aside className="w-16 border-r border-slate-800 flex flex-col items-center py-6 gap-6 bg-[#020617]/50 backdrop-blur-sm z-20">
        <div className="p-2 bg-blue-600/20 rounded-lg text-blue-400">
          <Shield size={24} />
        </div>
        <Separator className="w-8 bg-slate-800" />
        <Button variant="ghost" size="icon" className="hover:bg-red-950/30 hover:text-red-400" onClick={handlePurge}>
          <Trash2 size={20} />
        </Button>
        <Button variant="ghost" size="icon" className="hover:bg-orange-950/30 hover:text-orange-400">
          <ShieldAlert size={20} />
        </Button>
        <Button variant="ghost" size="icon" className="hover:bg-blue-950/30 hover:text-blue-400" onClick={handleRestart}>
          <RefreshCw size={20} />
        </Button>
      </aside>

      <main className="flex-1 flex flex-col min-w-0">
        {/* GLOBAL HEADER */}
        <header className="h-16 border-b border-slate-800 flex items-center px-6 justify-between bg-[#020617]/50 backdrop-blur-md">
          <div className="flex items-center gap-4">
            <h1 className="text-sm font-bold tracking-widest text-[#f8fafc] flex items-center gap-2 flex-shrink-0">
              TACTICAL THREAT ANALYZER <span className="text-[10px] text-slate-500 font-mono hidden sm:inline">v4.2.1 // WIRESHARE-MODE</span>
            </h1>
          </div>

          <div className="flex items-center gap-6 flex-1 justify-end min-w-0">
            <div className="flex items-center gap-3 bg-slate-900/50 border border-slate-800 rounded-lg px-2 h-8 flex-shrink-0">
              <div className={`w-1.5 h-1.5 rounded-full ${!isPaused ? 'bg-emerald-500 led-glow' : 'bg-amber-500 shadow-[0_0_8px_#f59e0b]'}`} />
              <span className="text-[9px] font-bold tracking-tighter text-slate-400">{isPaused ? 'PAUSED' : 'LIVE'}</span>
              <Button 
                variant="ghost" 
                size="sm" 
                className={`h-6 px-2 text-[8px] font-bold border ${isPaused ? 'bg-emerald-600/20 text-emerald-400 border-emerald-600/50 hover:bg-emerald-600/30' : 'bg-amber-600/20 text-amber-500 border-amber-600/50 hover:bg-amber-600/30'}`}
                onClick={() => setIsPaused(!isPaused)}
              >
                {isPaused ? 'RESUME' : 'PAUSE'}
              </Button>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex flex-col items-end">
                <span className="text-[10px] text-slate-500 font-mono uppercase tracking-tighter">CPU USAGE</span>
                <span className="text-xs font-mono text-emerald-400">{vitals.cpu}%</span>
              </div>
              <div className="w-24 h-1 bg-slate-800 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: `${vitals.cpu}%` }} />
              </div>
            </div>
            
            <div className="flex items-center gap-4">
              <div className="flex flex-col items-end">
                <span className="text-[10px] text-slate-500 font-mono uppercase tracking-tighter">RAM VITALITY</span>
                <span className="text-xs font-mono text-blue-400">{vitals.ram}%</span>
              </div>
              <div className="w-24 h-1 bg-slate-800 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 transition-all duration-500" style={{ width: `${vitals.ram}%` }} />
              </div>
            </div>

            <div className="flex bg-slate-900/80 rounded-lg p-1 border border-slate-800 self-center">
              <Button 
                variant="ghost" 
                size="sm" 
                className={`h-7 px-3 text-[10px] font-bold rounded-md transition-all ${levelFilter === 'ALL' ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-300'}`}
                onClick={() => setLevelFilter('ALL')}
              >
                ALL
              </Button>
              <Button 
                variant="ghost" 
                size="sm" 
                className={`h-7 px-3 text-[10px] font-bold rounded-md transition-all ${levelFilter === 'EXPLOIT' ? 'bg-red-900/40 text-red-400' : 'text-slate-500 hover:text-slate-300'}`}
                onClick={() => setLevelFilter('EXPLOIT')}
              >
                EXPLOIT
              </Button>
              <Button 
                variant="ghost" 
                size="sm" 
                className={`h-7 px-3 text-[10px] font-bold rounded-md transition-all ${levelFilter === 'SAFE' ? 'bg-emerald-900/40 text-emerald-400' : 'text-slate-500 hover:text-slate-300'}`}
                onClick={() => setLevelFilter('SAFE')}
              >
                SAFE
              </Button>
            </div>

            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Filter by IP..."
                className="pl-8 h-9 w-[200px] lg:w-[300px] bg-slate-900/50 border-slate-700 text-xs"
                value={filter}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFilter(e.target.value)}
              />
            </div>
          </div>
        </header>

        {/* THE WIRE (Live List) */}
        <section className="flex-1 min-h-[300px] border-b border-slate-800 overflow-hidden flex flex-col">
          <ScrollArea className="flex-1">
            <Table className="text-[11px] font-mono border-collapse">
              <TableHeader className="sticky top-0 bg-[#020617] z-10 border-b border-slate-800">
                <TableRow className="hover:bg-transparent border-slate-800">
                  <TableHead className="w-[80px]">ID</TableHead>
                  <TableHead className="w-[100px]">LEVEL</TableHead>
                  <TableHead className="w-[150px]">SOURCE IP</TableHead>
                  <TableHead>PAYLOAD</TableHead>
                  <TableHead className="w-[120px] text-right">TIMESTAMP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredPackets.map((p: Packet) => (
                  <TableRow 
                    key={p.id} 
                    className={`cursor-pointer border-slate-900/50 transition-colors ${
                      p.level === 'CRITICAL' ? 'bg-red-600/20 text-red-50 hover:bg-red-600/30' : 'hover:bg-slate-800/50'
                    }`}
                    onClick={() => setSelectedPacket(p)}
                  >
                    <TableCell className="font-bold text-slate-500">{p.id}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-[9px] h-4 border-none px-1 rounded-none ${
                        p.level === 'CRITICAL' ? 'bg-red-500 text-white' : 
                        p.level === 'SUCCESS' ? 'text-emerald-400' : 'text-slate-400'
                      }`}>
                        {p.level}
                      </Badge>
                    </TableCell>
                    <TableCell className={p.level === 'CRITICAL' ? 'text-red-400' : 'text-blue-400'}>{p.sourceIp}</TableCell>
                    <TableCell className="truncate max-w-[400px]">{p.payload}</TableCell>
                    <TableCell className="text-right text-slate-500">{p.timestamp}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </section>

        {/* WORKFLOW DISPATCHER */}
        <section className="h-14 bg-slate-900/30 border-b border-slate-800 flex items-center px-6 gap-4">
          <div className="flex items-center gap-2">
            <Zap size={16} className="text-yellow-500" />
            <span className="text-xs font-bold tracking-tighter">DISPATCHER:</span>
          </div>
          <Select defaultValue="sec-audit">
            <SelectTrigger className="w-[200px] h-8 bg-slate-900 border-slate-700 text-xs">
              <SelectValue placeholder="Select Schema" />
            </SelectTrigger>
            <SelectContent className="bg-slate-900 border-slate-700">
              <SelectItem value="sec-audit">Security Audit v2</SelectItem>
              <SelectItem value="infra-setup">Infrastructure Provision</SelectItem>
              <SelectItem value="data-sync">Data Pipeline Sync</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded px-2 h-8">
            <span className="text-[10px] text-slate-500 font-mono">SEC:</span>
            <input 
              type="number" 
              className="w-10 bg-transparent border-none text-xs font-mono text-blue-400 focus:outline-none" 
              value={duration}
              onChange={(e) => setDuration(parseInt(e.target.value) || 1)}
            />
          </div>

          <Button 
            size="sm" 
            className={`h-8 font-bold px-4 transition-all ${workflowTimer !== null ? 'bg-amber-600' : 'bg-blue-600 hover:bg-blue-500'}`}
            disabled={workflowTimer !== null}
            onClick={() => {
              console.log("Initiating Workflow with timer...");
              setWorkflowTimer(duration);
              setWorkflowProgress(0);
              fetch('http://localhost:3001/api/save-workflow', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: "Timed Trigger", duration, routine: [{ task: 'SHELL', input: { command: "echo timed trigger" } }] }),
              });
            }}
          >
            {workflowTimer !== null ? `ACTIVE: ${workflowTimer}s` : 'INITIATE WORKFLOW'}
          </Button>

          <Dialog>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" className="h-8 border-slate-700 text-xs flex items-center gap-2">
                <PlusCircle size={14} /> NEW WORKFLOW
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px] bg-[#020617] border-slate-800 text-slate-200">
              <DialogHeader>
                <DialogTitle>Create Automation Workflow</DialogTitle>
                <DialogDescription>
                  Define a sequence of C++ engine tasks.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="name" className="text-right text-xs text-slate-400">Name</Label>
                  <Input id="name" value={newWorkflow.name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewWorkflow({...newWorkflow, name: e.target.value})} className="col-span-3 h-8 bg-slate-900 border-slate-700 text-xs" />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="duration" className="text-right text-xs text-slate-400">Duration (s)</Label>
                  <Input id="duration" type="number" value={newWorkflow.duration} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewWorkflow({...newWorkflow, duration: parseInt(e.target.value) || 1})} className="col-span-3 h-8 bg-slate-900 border-slate-700 text-xs" />
                </div>
                <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                   <Label className="text-[10px] text-slate-500 uppercase font-bold">Routine Steps</Label>
                   {newWorkflow.routine.map((step: WorkflowStep, idx: number) => (
                     <div key={idx} className="p-3 border border-slate-800 rounded bg-slate-900/50 space-y-3 relative group">
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="absolute right-1 top-1 h-6 w-6 text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => removeStep(idx)}
                        >
                          <Trash2 size={12} />
                        </Button>
                        <div className="flex gap-2 items-center">
                           <Badge variant="outline" className="h-5 text-[9px] border-slate-700">STEP {idx+1}</Badge>
                           <Select 
                              value={step.task} 
                              onValueChange={(val: 'SHELL' | 'BLOCK_IP' | 'DOCKER') => {
                                let defaultInput = {};
                                if (val === 'SHELL') defaultInput = { command: "" };
                                if (val === 'BLOCK_IP') defaultInput = { ip: "" };
                                if (val === 'DOCKER') defaultInput = { image: "" };
                                updateStep(idx, { task: val, input: defaultInput });
                              }}
                           >
                              <SelectTrigger className="h-7 bg-[#020617] border-slate-700 text-[10px] w-[120px]">
                                 <SelectValue />
                              </SelectTrigger>
                              <SelectContent className="bg-slate-900 border-slate-800">
                                 <SelectItem value="SHELL">SHELL CMD</SelectItem>
                                 <SelectItem value="BLOCK_IP">BLOCK IP</SelectItem>
                                 <SelectItem value="DOCKER">DOCKER RUN</SelectItem>
                              </SelectContent>
                           </Select>
                        </div>

                        {step.task === 'SHELL' && (
                          <div className="space-y-1">
                            <Label className="text-[9px] text-slate-400">COMMAND</Label>
                            <Input 
                              placeholder="e.g. echo 'Security scan started'" 
                              className="h-7 bg-[#020617] border-slate-800 text-xs font-mono"
                              value={step.input?.command || ''}
                              onChange={(e) => updateStep(idx, { input: { ...step.input, command: e.target.value } })}
                            />
                          </div>
                        )}

                        {step.task === 'BLOCK_IP' && (
                          <div className="space-y-1">
                            <Label className="text-[9px] text-slate-400">TARGET IP</Label>
                            <Input 
                              placeholder="e.g. 192.168.1.100" 
                              className="h-7 bg-[#020617] border-slate-800 text-xs font-mono"
                              value={step.input?.ip || ''}
                              onChange={(e) => updateStep(idx, { input: { ...step.input, ip: e.target.value } })}
                            />
                          </div>
                        )}

                        {step.task === 'DOCKER' && (
                          <div className="space-y-1">
                            <Label className="text-[9px] text-slate-400">IMAGE NAME</Label>
                            <Input 
                              placeholder="e.g. alpine/curl" 
                              className="h-7 bg-[#020617] border-slate-800 text-xs font-mono"
                              value={step.input?.image || ''}
                              onChange={(e) => updateStep(idx, { input: { ...step.input, image: e.target.value } })}
                            />
                          </div>
                        )}
                     </div>
                   ))}
                   <Button variant="ghost" size="sm" onClick={addStep} className="w-full text-[10px] border-dashed border border-slate-800 mt-2 h-8 text-blue-400 hover:bg-blue-950/20">
                      + ADD AUTOMATION STEP
                   </Button>
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" onClick={handleCreateWorkflow} className="bg-emerald-600 hover:bg-emerald-500">SAVE & RUN</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Separator orientation="vertical" className="h-6 bg-slate-800" />
          <div className="flex-1 flex items-center gap-3">
            <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden relative">
              <div className="absolute inset-0 bg-emerald-500/20 shadow-[0_0_10px_#10b981]" style={{ width: `${workflowProgress}%` }} />
              <div className="h-full bg-emerald-500 shadow-[0_0_10px_#10b981]" style={{ width: `${workflowProgress}%` }} />
            </div>
            <span className="text-[10px] font-mono text-emerald-500 w-8">{workflowProgress}%</span>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:bg-red-950/20">
              <Square size={14} />
            </Button>
          </div>
        </section>

        {/* BOTTOM SPLIT-PANE */}
        <section className="flex-1 flex min-h-0 bg-[#020617]">
          {/* PACKET DETAIL */}
          <div className="w-1/2 border-r border-slate-800 flex flex-col">
            <header className="h-8 px-4 flex items-center bg-slate-900/50 border-b border-slate-800">
              <span className="text-[10px] font-bold tracking-widest text-slate-400">PACKET DETAIL INSPECTOR</span>
            </header>
            <div className="p-4 flex flex-col gap-4 overflow-auto">
              {selectedPacket ? (
                <div className="grid grid-cols-2 gap-4">
                  <DetailItem label="PACKET ID" value={selectedPacket.id} />
                  <DetailItem label="THREAT LEVEL" value={selectedPacket.level} color={selectedPacket.level === 'CRITICAL' ? 'text-red-500' : 'text-emerald-500'} />
                  <DetailItem label="SOURCE IP" value={selectedPacket.sourceIp} mono />
                  <DetailItem label="TIMESTAMP" value={selectedPacket.timestamp} mono />
                  <div className="col-span-2">
                    <span className="text-[9px] text-slate-500 block mb-1">RAW PAYLOAD</span>
                    <div className="bg-slate-900 border border-slate-800 p-2 rounded text-[11px] font-mono break-all text-blue-300">
                      {selectedPacket.payload}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-slate-600 gap-2 opacity-30 mt-10">
                  <Activity size={48} />
                  <span className="text-xs uppercase tracking-tighter">Select packet to inspect</span>
                </div>
              )}
            </div>
          </div>

          {/* RAW TELEMETRY */}
          <div className="w-1/2 flex flex-col">
            <header className="h-8 px-4 flex items-center justify-between bg-slate-900/50 border-b border-slate-800">
              <span className="text-[10px] font-bold tracking-widest text-slate-400 flex items-center gap-2">
                <TerminalIcon size={12} /> RAW TELEMETRY // engine.log stream
              </span>
              <div className="flex items-center gap-2">
                 <Badge variant="outline" className="text-[8px] h-4 border-slate-700 text-slate-500">REAL-TIME</Badge>
              </div>
            </header>
            <div 
              ref={terminalRef}
              className="flex-1 bg-black p-4 font-mono text-[11px] overflow-auto scrollbar-hide whitespace-pre-wrap leading-relaxed"
            >
              {logs.map((log, i) => (
                <div key={i} className="mb-1">
                  <span className="text-slate-600 font-bold mr-2">[{i}]</span>
                  <span className={log.includes('ERROR') || log.includes('CRITICAL') ? 'text-red-500' : log.includes('METRIC') ? 'text-emerald-500/80' : 'text-slate-300'}>
                    {log}
                  </span>
                </div>
              ))}
              <div className="h-4" />
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

interface DetailItemProps {
  label: string;
  value: string;
  color?: string;
  mono?: boolean;
}

function DetailItem({ label, value, color = 'text-slate-200', mono = false }: DetailItemProps) {
  return (
    <div className="flex flex-col">
      <span className="text-[9px] text-slate-500 mb-0.5">{label}</span>
      <span className={`text-xs font-bold ${mono ? 'font-mono' : ''} ${color}`}>{value}</span>
    </div>
  );
}
