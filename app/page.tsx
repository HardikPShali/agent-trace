"use client";
import { useMemo, useState } from "react";
import { Activity, AlertCircle, ArrowRight, Box, Braces, Check, ChevronRight, CircleStop, Clock3, Command, Copy, GitCompare, PanelLeft, Play, Search, Settings2, Sparkles, Terminal, TestTube2, Wrench } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Step={id:number;type:"model"|"tool"|"decision";title:string;meta:string;duration:number;tokens?:number;status:"ok"|"warning";detail:string};
const runs=[
 {id:"run_9fa21",task:"Refund a duplicate payment",model:"gpt-5.2",time:"2 min ago",duration:"4.8s",cost:"$0.031",score:92,status:"passed"},
 {id:"run_9f8dc",task:"Refund a duplicate payment",model:"gpt-5.2",time:"18 min ago",duration:"7.1s",cost:"$0.048",score:71,status:"failed"},
 {id:"run_9f02a",task:"Triage an account takeover",model:"gpt-5.1",time:"34 min ago",duration:"5.4s",cost:"$0.029",score:87,status:"passed"},
 {id:"run_9e991",task:"Update delivery address",model:"gpt-5.1",time:"1 hour ago",duration:"3.2s",cost:"$0.018",score:96,status:"passed"}
];
const steps:Step[]=[
 {id:1,type:"model",title:"Interpret customer request",meta:"gpt-5.2 · 1,284 tokens",duration:620,tokens:1284,status:"ok",detail:"The customer reports two identical charges on order ORD-44182 and asks for one to be reversed."},
 {id:2,type:"tool",title:"Fetch payment history",meta:"payments.getTransactions",duration:184,status:"ok",detail:'{ "orderId": "ORD-44182", "transactions": 2, "amount": "€86.40" }'},
 {id:3,type:"decision",title:"Duplicate confirmed",meta:"Confidence 0.97",duration:34,status:"ok",detail:"Both transactions share the order, amount and capture window. One capture is safe to reverse."},
 {id:4,type:"tool",title:"Check refund policy",meta:"policy.search",duration:241,status:"warning",detail:"Policy permits an automatic refund under €100. No manager approval required."},
 {id:5,type:"model",title:"Prepare resolution",meta:"gpt-5.2 · 612 tokens",duration:488,tokens:612,status:"ok",detail:"Refund the second capture and tell the customer when the funds should return."},
 {id:6,type:"tool",title:"Issue refund",meta:"payments.refund",duration:197,status:"ok",detail:'{ "refundId": "RF-10892", "status": "accepted", "eta": "3-5 days" }'}
];
const icon={model:<Sparkles/>,tool:<Wrench/>,decision:<Braces/>};

export default function Home(){
 const [run,setRun]=useState(runs[0]);const [selected,setSelected]=useState(steps[3]);const [query,setQuery]=useState("");const [copied,setCopied]=useState(false);
 const filtered=useMemo(()=>runs.filter(r=>(r.task+r.id).toLowerCase().includes(query.toLowerCase())),[query]);
 const copy=()=>{navigator.clipboard?.writeText(selected.detail);setCopied(true);setTimeout(()=>setCopied(false),1200)};
 return <main className="shell">
  <aside className="side">
   <div className="logo"><Command/><b>AT</b></div>
   <button className="new-run"><Play/> New run</button>
   <label className="run-search"><Search/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search runs"/></label>
   <div className="side-label">Recent runs <span>{filtered.length}</span></div>
   <div className="run-list">{filtered.map(r=><button key={r.id} className={run.id===r.id?"run active":"run"} onClick={()=>setRun(r)}>
    <span className={`run-dot ${r.status}`}/><span><b>{r.task}</b><small>{r.id} · {r.time}</small></span><ChevronRight/>
   </button>)}</div>
   <div className="side-foot"><button><Settings2/> Project settings</button><div><span>HS</span><p><b>Hardik Shali</b><small>Personal workspace</small></p></div></div>
  </aside>
  <section className="work">
   <header><button className="menu" aria-label="Open menu"><PanelLeft/></button><div><span className="crumb">Runs / {run.id}</span><h1>{run.task}</h1></div><div className="head-actions"><button><CircleStop/> Stop</button><button className="primary"><Play/> Run again</button></div></header>
   <div className="summary">
    <div><span className={`result ${run.status}`}><Check/> {run.status}</span><p>Completed {run.time}</p></div>
    <dl><div><dt>Duration</dt><dd>{run.duration}</dd></div><div><dt>Model</dt><dd>{run.model}</dd></div><div><dt>Cost</dt><dd>{run.cost}</dd></div><div><dt>Evaluation</dt><dd className={run.score<80?"low":""}>{run.score}/100</dd></div></dl>
   </div>
   <Tabs defaultValue="trace" className="tabs">
    <TabsList variant="line" className="tab-list"><TabsTrigger value="trace"><Activity/>Trace</TabsTrigger><TabsTrigger value="compare"><GitCompare/>Compare</TabsTrigger><TabsTrigger value="evals"><TestTube2/>Evaluations</TabsTrigger></TabsList>
    <TabsContent value="trace"><div className="trace-grid">
     <section className="flow"><div className="flow-head"><div><span>Execution path</span><b>6 steps · 2,137 tokens</b></div><button><Clock3/> Waterfall</button></div>
      <div className="steps">{steps.map((s,i)=><button key={s.id} className={selected.id===s.id?"step selected":"step"} onClick={()=>setSelected(s)}>
       <span className={`step-icon ${s.type}`}>{icon[s.type]}</span><span className="step-line"/><span className="step-copy"><small>Step {i+1} · {s.type}</small><b>{s.title}</b><em>{s.meta}</em></span><span className="duration">{s.duration}ms</span>{s.status==="warning"&&<AlertCircle className="alert"/>}
      </button>)}</div>
     </section>
     <aside className="inspector"><div className="inspect-head"><span>Step {selected.id}</span><div><button onClick={copy} aria-label="Copy detail">{copied?<Check/>:<Copy/>}</button><button aria-label="Open terminal"><Terminal/></button></div></div>
      <div className="inspect-title"><span className={`step-icon ${selected.type}`}>{icon[selected.type]}</span><div><small>{selected.type}</small><h2>{selected.title}</h2></div></div>
      <div className="inspect-block"><span>Output</span><pre>{selected.detail}</pre></div>
      <div className="inspect-block"><span>Telemetry</span><dl><div><dt>Latency</dt><dd>{selected.duration}ms</dd></div><div><dt>Tokens</dt><dd>{selected.tokens||"None"}</dd></div><div><dt>Status</dt><dd className="ok">Completed</dd></div></dl></div>
      <button className="open-log"><Box/> Open raw event <ArrowRight/></button>
     </aside>
    </div></TabsContent>
    <TabsContent value="compare"><div className="placeholder"><GitCompare/><h2>Compare agent decisions</h2><p>Choose a second run to inspect changed prompts, tools, latency and output side by side.</p><button>Select comparison run</button></div></TabsContent>
    <TabsContent value="evals"><div className="eval-grid">{["Policy compliance","Tool selection","Answer groundedness"].map((x,i)=><article key={x}><span>{x}</span><b>{[100,88,91][i]}%</b><div><i style={{width:`${[100,88,91][i]}%`}}/></div><small>{i===0?"All checks passed":"Within acceptance threshold"}</small></article>)}</div></TabsContent>
   </Tabs>
  </section>
 </main>
}
