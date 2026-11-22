import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import {
  probeLowMantle, probeWallMantle, beginLowMantle, updateLowMantle,
} from '../src/player/mantle.mts';

const bundle=await readFile(new URL('../sumiro/bundle/player-1_KrBWnI.js',import.meta.url),'utf8');
function extract(pattern,name) {
  const match=bundle.match(pattern);
  assert.ok(match, 'Published mantle boundary '+name+' changed: re-audit');
  return match[0];
}
const originals = {
  low: extract(/function pt\(e=1\)\{[\s\S]*?\}(?=function mt\()/,'pt'),
  wall: extract(/function mt\(\)\{[\s\S]*?\}(?=function ht\()/,'mt'),
  start: extract(/function ht\(e\)\{[\s\S]*?\}(?=function gt\()/,'ht'),
  finish: extract(/function gt\(\)\{[\s\S]*?\}(?=function _t\()/,'gt'),
};
const clean=x=>JSON.parse(JSON.stringify(x));
const base=()=>({
  x:2,y:1,z:3,heading:.5,stickMag:0,stickX:0,stickZ:0,
  vx:2,vz:-1,vy:-4,speed:3,grounded:true,
  airDashed:true,fade:.6,dissolve:.2,
  state:'JUMP',stateT:.3,mantle:null,carrier:null,
  rootY:1,lastGroundY:1,surface:'stone',
});
function ref(name,env) {
  return runInNewContext(originals[name]+';'+({low:'pt',wall:'mt',start:'ht',finish:'gt'})[name],env);
}
function worldFixture(ray,groundFn) {
  const calls=[];
  const world={
    raycast(...args){calls.push(['raycast',...args]);return ray;},
    groundAt(...args){calls.push(['ground',...args]);return groundFn(...args);},
  };
  return {world,calls};
}
test('short-mantle ray/ground probes retain every query bound and fallback',()=>{
  for(const distance of [.4,1,2]) for(const ray of [.1,.39,.4,.8,1,Infinity]) {
    for(const stickMag of [0,.05,.4,1]) for(const found of [false,true]) {
      const q={...base(),stickMag,stickX:.3,stickZ:-.8};
      const create=()=>worldFixture(ray,()=>found?{y:2.5,body:{id:'raft'}}:null);
      const a=create(),b=create();
      const actual=probeLowMantle(q,a.world,distance);
      const expected=ref('low',{q,v:b.world}).call(null,distance);
      assert.deepEqual(clean(actual),clean(expected));
      assert.deepEqual(a.calls,b.calls);
    }
  }
});

test('wall-mantle detection respects rejection, world queries and heading mutation',()=>{
  const cases=[
    {result:'none'},
    {result:'first',reject:true},
    {result:'first',noLanding:true},
    {result:'first'},
    {result:'second'},
  ];
  for(const scenario of cases) {
    const make=()=>{
      const q=base(),events=[];
      let calls=0;
      const collision={nx:.6,nz:-.8};
      const world={groundAt(...args){
        calls++;
        if (scenario.result==='none') return null;
        if (scenario.result==='second' && calls===1) return null;
        const y0=args[2], y1=args[3];
        if (y0===Infinity) return scenario.reject ? {y:4} : null;
        if (y0===3.5 && y1===2.5) return scenario.noLanding?null:{y:3};
        return {y:3,body:{id:'raft'}};
      }};
      return {q,events,collision,world,enter:target=>events.push(['enter',clean(target)])};
    };
    const a=make(),b=make();
    const actual=probeWallMantle(a.q,a.collision,a.world,a.enter);
    const expected=ref('wall',{q:b.q,E:b.collision,v:b.world,ht:b.enter})();
    assert.equal(actual,expected);
    assert.deepEqual(a.q,b.q);
    assert.deepEqual(a.events,b.events);
  }
});

function setupMantle(initial) {
  const q={...base(),...structuredClone(initial)};
  const events=[];
  const changeState=name=>{events.push(['state',name]);q.state=name;q.stateT=0};
  const play=(name,options)=>events.push(['play',name,clean(options)]);
  return {q,events,changeState,play};
}
test('low mantle entry matches original heading, carrier and animation side effects',()=>{
  for(const destination of [
    {x:5,z:6,height:1.1,body:null},
    {x:-2,z:4,height:2.4,heading:-2.7,body:{id:'platform'}},
    {x:0,z:0,height:.5,heading:0},
  ]) {
    const a=setupMantle({}),b=setupMantle({});
    const actual=beginLowMantle(a.q,destination,.38,a.play,a.changeState);
    const expected=ref('start',{
      q:b.q,F:.38,y:{play:b.play},J:b.changeState,
    })(destination);
    assert.equal(actual,expected);
    assert.deepEqual(clean(a.q),clean(b.q));
    assert.deepEqual(a.events,b.events);
  }
});

test('mantle clip movement and final ground/fall decisions match published implementation',()=>{
  const destination={x:4,z:-2,height:2.2,heading:.4,body:null};
  for(const key of [0,1,3,5,8,11,14,20])for(const finished of [false,true])
    for(const found of [false,true]) {
      const a=setupMantle({}),b=setupMantle({});
      beginLowMantle(a.q,destination,.38,a.play,a.changeState);
      ref('start',{q:b.q,F:.38,y:{play:b.play},J:b.changeState})(destination);
      a.events.length=0;b.events.length=0;
      const animation=events=>({
        key:()=>key,finished:()=>finished,gait:{idleT:4},
        playGait:value=>events.push(['gait',value]),
      });
      const ya=animation(a.events),yb=animation(b.events);
      const ground=found?{y:3,surface:'stone',body:{id:'moving'}}:null;
      const world={groundAt:()=>ground};
      const beginFallA=()=>{a.events.push(['fall']);a.q.state='FALL';a.q.grounded=false};
      const beginFallB=()=>{b.events.push(['fall']);b.q.state='FALL';b.q.grounded=false};
      const smooth=(start,end,x)=>{
        const r=Math.min(Math.max((x-start)/(end-start),0),1);
        return r*r*(3-2*r);
      };
      const actual=updateLowMantle(a.q,ya,world,.7,2.1,x=>x,a.changeState,beginFallA);
      const expected=ref('finish',{
        q:b.q,y:yb,v:world,P:.7,z:smooth,
        Y:x=>x,J:b.changeState,it:beginFallB,
      })();
      assert.equal(actual,expected);
      assert.deepEqual(clean(a.q),clean(b.q));
      assert.deepEqual(ya.gait,yb.gait);
      assert.deepEqual(a.events,b.events);
    }
});
