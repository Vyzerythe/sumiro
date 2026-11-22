import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { updateInputSteering } from '../src/player/input-steering.mts';

/**
 * Execute the original interactive input function, extracted unchanged from
 * its bundled player closure. Only its stateful dependencies are stubbed.
 * Fail closed if the published chunk/function boundary changes.
 */
const published = await readFile(
  new URL('../sumiro/bundle/player-1_KrBWnI.js', import.meta.url), 'utf8',
);
const match = published.match(/function Le\(e\)\{[\s\S]*?\}(?=function Re\(\)\{)/);
assert.ok(match, 'published player input-steering boundary changed: re-audit');

function defaultState() {
  return {
    state: 'IDLE', zone: null, holdActive: false,
    yaw: 0, holdYaw: 0, holdAngle: 0, grounded: true,
    stickX: 0, stickZ: 0, stickMag: 0,
    stickAngle: 0, jumpBuf: 0,
  };
}

function originalStep(state, input, rail, script, dt, jumpBuffer, holdYawRate) {
  const registry = {get: key => key === 'camera_rig.rail' ? rail : null};
  const wrap = angle => {
    let r = (angle + Math.PI) % (Math.PI * 2);
    if (r < 0) r += Math.PI * 2;
    return r - Math.PI;
  };
  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
  const reference = runInNewContext(match[0] + ';Le', {
    q: state,
    m: input,
    p: registry,
    sn: {script},
    k: {buffer: jumpBuffer},
    me: holdYawRate,
    B: wrap,
    V: clamp,
  });
  return reference(dt);
}

function compare(input, rail, script, dt, initial = defaultState(),
  jumpBuffer = 0.15, holdYawRate = 1.6) {
  const actual = structuredClone(initial);
  const expected = structuredClone(initial);
  const result = updateInputSteering(
    actual, input, rail, script, dt, jumpBuffer, holdYawRate,
  );
  const original = originalStep(
    expected, input, rail, script, dt, jumpBuffer, holdYawRate,
  );
  assert.strictEqual(result, original);
  assert.deepEqual(actual, expected, 'input steering diverged for ' + JSON.stringify({
    input, rail, script, dt, initial,
  }));
  return actual;
}

test('scripted player routing overrides camera-relative manual steering', () => {
  for (const script of [
    {x:1,z:0}, {x:0,z:1,mag:.4},
    {x:-3,z:4,mag:2}, {x:0,z:0,mag:1},
    {x:0.00001,z:0}, {x:2,z:3,mag:0},
  ]) {
    compare({forward:1,strafe:1,jump:true},
      {railYaw:45,zone:'bridge'},script,1/60,
      {...defaultState(),holdActive:true,holdYaw:1,zone:'cliff'});
  }
});

test('zone changes, held yaw, grounded correction and leap exceptions agree', () => {
  for (const state of ['IDLE','LEAP','JUMP','FALL','TURN','GRAB']) {
    for (const grounded of [true,false]) {
      for (const holdActive of [true,false]) {
        for (const railYaw of [-270,-180,-30,0,45,180,270]) {
          compare({forward:1,strafe:-.5,jump:true},
            {railYaw,zone:'next'},null,1/30,
            {...defaultState(),state,grounded,holdActive,
              zone:'previous',yaw:1.1,holdYaw:-2.9,holdAngle:-.4});
        }
      }
    }
  }
});

test('direction normalization, dead zones and jump buffering match', () => {
  const inputs = [
    {forward:0,strafe:0,jump:false},
    {forward:1,strafe:0,jump:false},
    {forward:0,strafe:-1,jump:true},
    {forward:.0001,strafe:0,jump:false},
    {forward:5,strafe:-3,jump:true},
    {forward:0.05,strafe:0.05,jump:false},
    {forward:-.75,strafe:-.75,jump:false},
  ];
  for (const input of inputs) for (const rail of [
    null, {railYaw:0}, {railYaw:90,zone:'a'}, {railYaw:-150,zone:'b'},
  ]) compare(input,rail,null,1/120);
});

test('seeded multi-frame movement remains exactly equivalent', () => {
  let seed=0x6c277;
  const random=()=>((seed=(Math.imul(1664525,seed)+1013904223)>>>0)/4294967296);
  let expected=defaultState(), actual=defaultState();
  for(let i=0;i<450;i++) {
    const input={
      forward:(random()-.5)*2.5,
      strafe:(random()-.5)*2.5,
      jump:random()>.91,
    };
    const rail={railYaw:random()*720-360,
      zone:['cliff','bridge',null,'temple'][Math.floor(random()*4)]};
    const scripted=random()>.97 ?
      {x:random()-.5,z:random()-.5,mag:random()} : null;
    const dt=random()*.06;
    const state=['IDLE','LEAP','JUMP','HANG'][Math.floor(random()*4)];
    const grounded=random()>.3;
    expected.state=actual.state=state;
    expected.grounded=actual.grounded=grounded;
    const a=updateInputSteering(actual,input,rail,scripted,dt,.15,1.6);
    const b=originalStep(expected,input,rail,scripted,dt,.15,1.6);
    assert.equal(a,b);
    assert.deepEqual(actual,expected,'differed at frame '+i);
  }
});
