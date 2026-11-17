import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { createLedgePath } from '../src/player/ledge-path.mjs';

const originalBundle = await readFile(
  new URL('../sumiro/bundle/player-1_KrBWnI.js', import.meta.url), 'utf8',
);
const excerpt=originalBundle.match(/function Ae\(e\)\{[\s\S]*?\}(?=function je\()/);
assert.ok(excerpt, 'Published ledge path factory changed; manually re-audit the source mapping');
const original = runInNewContext(
  excerpt[0] + ';({Ae})',
  {V:(v,min,max)=>Math.min(Math.max(v,min),max)}
).Ae;
const plain = value => value===undefined ? undefined : JSON.parse(JSON.stringify(value));

function ledgeWithBody() {
  return {
    points:[[0,1,0,1,0],[3,2,4,1,1],[3,4,4,0,0],[8,5,4,-1,0]],
    body:{
      toWorld(x,y,z,out) {out.x=x+10;out.y=y-2;out.z=z+3;return out},
      dirToWorld(x,z,out) {out.ox=-z;out.oz=x;return out},
    },
  };
}
const ledges = [
  {id:'flat',points:[[0,0,0,1,0],[3,0,4,1,0]]},
  {id:'corner',points:[[0,1,0,1,0],[3,2,4,1,1],[3,4,4,0,0],[8,5,4,-1,0]]},
  {id:'repeated',points:[[0,0,0,1,0],[0,1,0,0,0],[0,2,5,0,1]]},
  ledgeWithBody(),
];

test('ledge lengths and metadata match original source',()=>{
  for(const input of ledges) {
    const found=createLedgePath(input);
    const expected=original(input);
    assert.deepEqual(plain({s:found.s,length:found.length}),plain({s:expected.s,length:expected.length}));
    assert.equal(found.points,input.points);
    assert.equal(found.body,input.body);
    assert.equal(found.id,input.id);
  }
});

test('ledge sampling matches published interpolation and moving-body transforms',()=>{
  for(const input of ledges) {
    const found=createLedgePath(input), expected=original(input);
    const samples=[-10,-1,0,.01,.1,.49,1,2,3,5,8,10,100,undefined];
    for(const distance of samples) {
      const destinationA={sentinel:'ok'},destinationB={sentinel:'ok'};
      assert.strictEqual(found.at(distance,destinationA),destinationA);
      assert.strictEqual(expected.at(distance,destinationB),destinationB);
      assert.deepEqual(destinationA,destinationB);
      assert.deepEqual(plain(found.at(distance)),plain(expected.at(distance)));
      // Preserve a separate non-finite check: JSON normalization maps NaN to null.
      if (distance === undefined) assert.ok(Number.isNaN(found.at(distance).x));
    }
  }
});

test('nearest ledge searches reproduce sample ordering and endpoint behavior',()=>{
  for(const input of ledges) {
    const found=createLedgePath(input),expected=original(input);
    let seed=15391;
    const random=()=>((seed=(1664525*seed+1013904223)>>>0)/4294967296);
    for(let i=0;i<90;i++) {
      const x=(random()-.5)*30,z=(random()-.5)*30;
      const start=random()*found.length*.65;
      const end=start+random()*(found.length-start);
      for(const args of [[x,z],[x,z,0,found.length],[x,z,start,end],[x,z,end,start]]) {
        assert.equal(found.nearest(...args),expected.nearest(...args),JSON.stringify(args));
      }
    }
  }
});
