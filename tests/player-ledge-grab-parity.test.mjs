import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { createLedgePath } from '../src/player/ledge-path.mjs';
import { alignToLedge, beginLedgeGrab, detectLedgeGrab } from '../src/player/ledge-grab.mjs';

const source = await readFile(
  new URL('../sumiro/bundle/player-1_KrBWnI.js', import.meta.url), 'utf8',
);
const excerpt = source.match(/function St\(e,t\)\{[\s\S]*?\}(?=function Tt\()/);
assert.ok(excerpt, 'Published GRAB boundary changed: review extraction before updating the adapter');

function buildLedges() {
  return [
    createLedgePath({id:'left', points:[[0,2.1,0,0,1],[1,2.1,0,0,1]]}),
    createLedgePath({id:'middle',points:[[0,2.1,0,0,1],[1,2.1,0,0,1]]}),
    createLedgePath({id:'moving',body:{id:'platform',enabled:true},
      points:[[0,2.1,0,0,1],[1,2.1,0,0,1]]}),
    createLedgePath({id:'distant', points:[[20,2.1,20,1,0],[21,2.1,20,1,0]]}),
  ];
}
function state(overrides={}) {
  return {
    state:'FALL',stateT:.6,x:.4,y:0,z:.26,
    vx:1,vz:0,vy:-3,speed:2,heading:Math.PI,
    rootY:0,lastGroundY:2.5,grounded:false,guardsInAir:true,
    hangForward:.5,hangBack:.2,hangBackFresh:true,
    shimmyHold:{key:1},fade:.4,dissolve:.3,airDashed:true,
    ledge:null,ledgeS:0,carrier:null,...overrides,
  };
}
const snapshot = (q,K,events) => ({
  q: {...q,ledge:q.ledge?.id??null,carrier:q.carrier?.id??null},
  K: {...K,ledge:K.ledge?.id??null},
  events,
});
function makeOriginal(q,ledges,view,sample,events,assist,assistReach=1.5) {
  const J=state=>{events.push(['state',state]);q.state=state;q.stateT=0};
  return runInNewContext(excerpt[0]+';({St,Ct,wt})',{
    q,K:view,O:sample,C:new Map(ledges.map(l=>[l.id,l])),
    j:.26,A:2.1,Pe:()=>assist,k:{assistReach},
    y:{play:(clip,options)=>events.push(['play',clip,{...options}])},
    J,
  });
}
function makeRecovered(q,ledges,view,sample,events,assist,assistReach=1.5) {
  const stateChange=name=>{events.push(['state',name]);q.state=name;q.stateT=0};
  const St=(ledge,distance)=>beginLedgeGrab(q,ledge,distance,sample,view,
    .26,2.1,(clip,options)=>events.push(['play',clip,{...options}]),stateChange);
  return {
    St,
    Ct:()=>alignToLedge(q,sample,view,.26,2.1),
    wt:()=>detectLedgeGrab(q,ledges.values(),sample,.26,2.1,
      assist?assistReach:1,St),
  };
}
function compare(mode,overrides={},opts={}) {
  const ledgesA=buildLedges(),ledgesB=buildLedges();
  if(opts.disabled) {
    ledgesA[2].body.enabled=false;
    ledgesB[2].body.enabled=false;
  }
  if(opts.onlyMoving) {
    ledgesA.splice(0,2);ledgesB.splice(0,2);
  }
  const a=state(overrides),b=state(overrides);
  const ka={},kb={},oa={},ob={},ea=[],eb=[];
  const got=makeRecovered(a,ledgesA,ka,oa,ea,!!opts.assist);
  const expected=makeOriginal(b,ledgesB,kb,ob,eb,!!opts.assist);
  let actual,reference;
  switch(mode) {
    case 'detect':
      actual=got.wt(); reference=expected.wt(); break;
    case 'enter':
      actual=got.St(ledgesA[opts.ledgeIndex??0],opts.distance??.3);
      reference=expected.St(ledgesB[opts.ledgeIndex??0],opts.distance??.3);
      break;
    case 'align':
      a.ledge=ledgesA[opts.ledgeIndex??0];b.ledge=ledgesB[opts.ledgeIndex??0];
      a.ledgeS=b.ledgeS=opts.distance??.3;
      actual=got.Ct(); reference=expected.Ct();break;
  }
  assert.equal(actual,reference,'return value mismatch in '+mode);
  assert.deepEqual(snapshot(a,ka,ea),snapshot(b,kb,eb),
    'differing '+mode+' '+JSON.stringify({overrides,opts}));
}

test('GRAB initializes all movement state, visual hooks and carrier reference',()=>{
  for(const ledgeIndex of [0,2]) for(const distance of [0,.3,1,3]) {
    compare('enter',{state:'JUMP',vy:7,fade:1,hangBack:.3}, {ledgeIndex,distance});
  }
});
test('ledge alignment preserves heading, hanging offset and view yaw',()=>{
  for(const ledgeIndex of [0,2]) for(const distance of [-1,0,.5,1,2]) {
    compare('align',{x:4,y:-2,z:7,heading:0}, {ledgeIndex,distance});
  }
});
test('ledge detection respects orientation, reach, assist, order and disabled bodies',()=>{
  const cases=[
    [{x:.4,y:0,z:.26,heading:Math.PI,vx:1,vz:0},{}],
    [{x:.4,y:0,z:.26,heading:0,vx:0,vz:-1},{}],
    [{x:.4,y:.8,z:.26},{}],
    [{x:.4,y:.8,z:.26},{assist:true}],
    [{x:.4,y:0,z:.26},{disabled:true,onlyMoving:true}],
    [{x:.4,y:0,z:.26},{onlyMoving:true}],
    [{x:20.2,y:0,z:20.26,heading:2,vx:1},{}],
    [{x:100,y:100,z:100},{}],
  ];
  for(const [overrides,opts] of cases) compare('detect',overrides,opts);
});

test('seeded differential GRAB detection covers range and orientation edge cases',()=>{
  let seed=0x5ab1;
  const rand=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
  for(let i=0;i<240;i++) {
    compare('detect',{
      x:(rand()-.5)*3, y:(rand()-.5)*2, z:(rand()-.5)*2,
      vx:(rand()-.5)*8,vz:(rand()-.5)*8,
      heading:rand()*Math.PI*2-Math.PI,
    },{assist:rand()>.5,disabled:rand()>.7,onlyMoving:rand()>.8});
  }
});
