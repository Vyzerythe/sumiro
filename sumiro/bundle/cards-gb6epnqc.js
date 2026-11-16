import{J as e,ht as t}from"./index-DnHRwVtn.js";import{n}from"./ink_material-CrFtRYQr.js";var r=new e().setFromAxisAngle(new t(0,1,0),Math.PI/2),i=1.12;function a(e,t){return t&1&&e.premultiply(r),e}function o(e,t,n){let r=e.onBeforeCompile,i=e.customProgramCacheKey();return e.onBeforeCompile=(e,i)=>{r(e,i),e.uniforms.uWashCol={value:t},e.uniforms.uWashAmt={value:n},e.fragmentShader=e.fragmentShader.replace(`#include <common>`,`#include <common>
uniform vec3 uWashCol;
uniform float uWashAmt;`).replace(`uLineWeight * inkPaint.a);`,`uLineWeight * inkPaint.a);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uWashCol, uWashAmt);`)},e.customProgramCacheKey=()=>`${i}:wash`,e}function s(e){let t=e.onBeforeCompile,n=e.customProgramCacheKey();return e.onBeforeCompile=(e,n)=>{t(e,n),e.fragmentShader=e.fragmentShader.replace(`#include <common>`,`#include <common>
uniform float uInkFade;`).replace(`#include <clipping_planes_fragment>`,`#include <clipping_planes_fragment>
if (uInkFade < 0.999) {
  vec3 inkCell = floor(vInkPatPos * 7.0);
  if (fract(sin(dot(inkCell, vec3(12.9898, 78.233, 37.719))) * 43758.5453) >= uInkFade) discard;
}`)},e.customProgramCacheKey=()=>`${n}:fade`,e}function c(e,t){let r=n({preset:`pineNeedles`,color:16777215,map:e,alphaTest:.42,side:2,shadeTint:[.82,.84,.84],lineWeight:.06,wrap:.8,skyFill:.5,name:`pine_needles`}),i=r.onBeforeCompile;return r.onBeforeCompile=(e,n)=>{i(e,n),e.uniforms.uWindT=t.uWindT,e.vertexShader=e.vertexShader.replace(`#include <common>`,`#include <common>
uniform float uWindT;
varying float vCardLate;`).replace(`#include <begin_vertex>`,`#include <begin_vertex>
vCardLate = 0.0;
#ifdef USE_INSTANCING
{
  vec3 o = instanceMatrix[3].xyz;
  vCardLate = fract(sin(dot(o, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  float ph = o.x * 1.3 + o.z * 0.9 + o.y * 0.7;
  float w = sin(uWindT * 0.9 + ph) + 0.5 * sin(uWindT * 1.7 + ph * 2.1);
  transformed.xz += vec2(0.018, 0.012) * w * max(position.y, 0.0) * 2.0;
}
#endif`),e.fragmentShader=e.fragmentShader.replace(`#include <common>`,`#include <common>
uniform float uInkFade;
varying float vCardLate;`).replace(`#include <alphatest_fragment>`,`{
  // A tree fading (uInkFade under 1, set per mesh: env_pines/fade.js) thins out card by card, each at its own time, as ink drying
  // off: its fine needles go first, then its heart. At 1 this is the card as it always was.
  float inkCut = clamp((uInkFade - 0.4 * vCardLate) / 0.6, 0.0, 1.0);
  if (inkCut <= 0.0) discard;
  vec2 dx = dFdx(vMapUv) * 2048.0, dy = dFdy(vMapUv) * 2048.0;
  float lod = 0.5 * log2(max(max(dot(dx, dx), dot(dy, dy)), 1e-6));
  if (diffuseColor.a < mix(1.001, mix(alphaTest, 0.1, smoothstep(2.0, 5.5, lod)), inkCut)) {
    // Between the needles, a blurred read of the same fan fills in a solid dark heart: a pad is one wet dab with needles at its rim.
    if (texture2D(map, vMapUv, 2.4).a < mix(1.001, 0.42, inkCut)) discard;
    diffuseColor.rgb = vec3(0.075, 0.085, 0.078);
  }
}`)},r.customProgramCacheKey=()=>`ink3:pinecards4`,r}export{a,c as i,s as n,o as r,i as t};