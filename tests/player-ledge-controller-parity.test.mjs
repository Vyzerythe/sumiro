import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { createLedgePath } from '../src/player/ledge-path.mts';
import {
  shimmyAlongLedge, updateLedgeHang, completeLedgeClimb,
} from '../src/player/ledge-controller.mts';

const bundle=await readFile(new URL('../sumiro/bundle/player-1_KrBWnI.js',import.meta.url),'utf8');
function slice(pattern,label) {
  const match=bundle.match(pattern);
  assert.ok(match,'Published '+label+' changed; re-audit adapter boundary');
  return match[0];
}
const originalHang=slice(/function kt\(e\)\{[\s\S]*?\}(?=function At\()/,'hang');
const originalShimmy=slice(/function At\(e,t\)\{[\s\S]*?\}(?=function jt\()/,'shimmy');
const originalClimb=slice(/function jt\(\)\{[\s\S]*?\}(?=function Mt\()/,'climb');

function ledge({body=false}={}) {
  return createLedgePath({
    id:'ledge',body:body?{id:'platform',enabled:true}:null,
    points:[[0,2.5,0,1,0],[3,2.5,0,1,0],[6,2.5,0,1,0]],
  });
}
function state(overrides={}) {
  return {
    state:'HANG',stateT:.5,x:2,y:1,z:0,
    heading:0,rootY:1,ledge:ledge(),ledgeS:2.5,
    carrier:null,lastGroundY:1,shimmyHold:null,
    hangForward:0,hangBack:0,hangBackFresh:false,
    jumpBuf:0,grounded:false,surface:'stone',fromY:1,
    ...overrides,
  };
}
function normalize(value) {
  return JSON.parse(JSON.stringify(value,(k,v)=>{
    if (k==='ledge' && v?.points) return {id:v.id,body:v.body?.id??null};
    if (k==='carrier' && v?.id) return v.id;
    return v;
  }));
}
const effect=(events,name,...args)=>events.push([name,...args]);

function compareShimmy(initial,strafe,delta,railYaw) {
  const a=state(initial),b=state(initial);
  const ea=[],eb=[];
  const alignA=()=>effect(ea,'align'),alignB=()=>effect(eb,'align');
  const changeA=name=>{effect(ea,'state',name);a.state=name;a.stateT=0};
  const changeB=name=>{effect(eb,'state',name);b.state=name;b.stateT=0};
  const original=runInNewContext(originalShimmy+';At',{
    q:b,p:{get:()=>({railYaw})},V:(v,min,max)=>Math.min(Math.max(v,min),max),
    k:{shimmyRate:2.75},J:changeB,Ct:alignB,
  });
  shimmyAlongLedge(a,strafe,delta,railYaw,2.75,alignA,changeA);
  original(delta,strafe);
  assert.deepEqual(normalize(a),normalize(b));
  assert.deepEqual(ea,eb);
}

test('shimmy input, ledge endpoints, tangent projection and state transition parity',()=>{
  for(const railYaw of [-180,-90,-10,0,45,90,180]) {
    for(const direction of [-1,-.5,0,.3,1]) {
      for(const seconds of [0,.01,.1,.3,1]) {
        compareShimmy({ledgeS:2.8,state:'HANG'},direction,seconds,railYaw);
      }
    }
  }
});

function compareHang(initial,forward,strafe,dt,enabled=true) {
  const a=state(initial),b=state(initial),ea=[],eb=[];
  if(a.ledge.body) a.ledge.body.enabled=enabled;
  if(b.ledge.body) b.ledge.body.enabled=enabled;
  function hooks(q,events) {
    const changeState=name=>{effect(events,'state',name);q.state=name;q.stateT=0};
    return {
      align:()=>effect(events,'align'),
      drop:()=>effect(events,'drop'),
      leapBack:()=>effect(events,'leapBack'),
      leapSide:(dir,up)=>{effect(events,'leapSide',dir,up);return false},
      climbOrLeap:()=>effect(events,'climb'),
      shimmy:(time,input)=>effect(events,'shimmy',time,input),
      changeState,
    };
  }
  const aa=hooks(a,ea),bb=hooks(b,eb);
  const original=runInNewContext(originalHang+';kt',{
    q:b,m:{forward,strafe},ye:.12,J:bb.changeState,
    Ct:bb.align,Dt:bb.drop,Et:bb.leapBack,
    Tt:bb.leapSide,Ot:bb.climbOrLeap,At:bb.shimmy,
  });
  updateLedgeHang(a,{forward,strafe},dt,.12,aa);
  original(dt);
  assert.deepEqual(normalize(a),normalize(b),'hang mismatch '+JSON.stringify({initial,forward,strafe,dt}));
  assert.deepEqual(ea,eb);
}

test('hang state prioritizes carrier loss, grab wait, jump, climb, drop, shimmy and idle',()=>{
  const contexts=[
    {state:'GRAB',stateT:0,hangBackFresh:false},
    {state:'GRAB',stateT:.5,hangBackFresh:true},
    {state:'HANG',jumpBuf:.15,hangBackFresh:true},
    {state:'SHIMMY',hangForward:.11,hangBackFresh:true},
    {state:'HANG',hangBack:.2,hangBackFresh:true},
    {state:'SHIMMY',shimmyHold:{key:1},hangBackFresh:true},
    {state:'HANG',ledge:ledge({body:true})},
  ];
  for(const initial of contexts) {
    for(const forward of [-1,-.31,-.2,0,.35,1]) {
      for(const strafe of [-1,-.4,0,.35,1]) {
        compareHang(initial,forward,strafe,.13, true);
      }
    }
  }
  compareHang({ledge:ledge({body:true})},0,0,.13,false);
});

function compareClimb(initial,frame,done,ground) {
  const a=state(initial),b=state(initial);
  const ka={kind:'climb',p:0},kb={kind:'climb',p:0},ea=[],eb=[];
  const createAnim=events=>({
    key:()=>frame,
    finished:()=>done,
    gait:{idleT:3},
    playGait:value=>effect(events,'gait',value),
  });
  const ya=createAnim(ea),yb=createAnim(eb);
  const world={groundAt:()=>ground ? {...ground} : null};
  const states=(q,events)=>name=>{effect(events,'state',name);q.state=name;q.stateT=0};
  const options={forwardOffset:.6,heightGain:2.1,surface:s=>s==='pond'?'ink':s};
  const original=runInNewContext(originalClimb+';jt',{
    q:b,K:kb,y:yb,v:world,N:options.forwardOffset,
    M:options.heightGain,Y:options.surface,J:states(b,eb),
  });
  completeLedgeClimb(a,ka,ya,world,options,states(a,ea));
  original();
  assert.deepEqual(normalize(a),normalize(b));
  assert.deepEqual(ka,kb);
  assert.deepEqual(ya.gait,yb.gait);
  assert.deepEqual(ea,eb);
}

test('climb animation progress, successful landing and missed-ground behavior match',()=>{
  for(const progress of [0,3,15,29,30,60])for(const done of [false,true]){
    compareClimb({state:'CLIMB',heading:Math.PI/3},progress,done,null);
    compareClimb({state:'CLIMB',heading:-1.2},progress,done,
      {y:5,surface:'pond',body:{id:'raft'}});
  }
});
