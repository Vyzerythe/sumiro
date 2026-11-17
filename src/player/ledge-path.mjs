/**
 * Recover the player ledge-path sampling/nearest-hold helper from the
 * immutable published bundle. NOT original authoring source.
 *
 * Each point is [x, y, z, outwardX, outwardZ]. Length is measured in the
 * horizontal X/Z plane; output positions include interpolated height.
 */
export function createLedgePath(ledge) {
  const points = ledge.points;
  const distances = [0];
  for (let i = 1; i < points.length; i++) {
    distances.push(distances[i-1] + Math.hypot(
      points[i][0] - points[i-1][0],
      points[i][2] - points[i-1][2],
    ));
  }
  const totalLength = distances[distances.length - 1];

  function at(distance, out = {}) {
    const amount = Math.min(Math.max(distance, 0), totalLength);
    let segment = 0;
    while (segment < distances.length - 2 && distances[segment+1] < amount) segment++;
    const fraction = (amount-distances[segment]) /
      (distances[segment+1]-distances[segment] || 1);
    const start = points[segment], end = points[segment+1];
    out.x = start[0] + (end[0]-start[0])*fraction;
    out.y = start[1] + (end[1]-start[1])*fraction;
    out.z = start[2] + (end[2]-start[2])*fraction;
    const outwardX = start[3] + (end[3]-start[3])*fraction;
    const outwardZ = start[4] + (end[4]-start[4])*fraction;
    const length = Math.hypot(outwardX, outwardZ) || 1;
    out.ox = outwardX/length;
    out.oz = outwardZ/length;
    out.s = amount;
    if (ledge.body) {
      ledge.body.toWorld(out.x,out.y,out.z,out);
      ledge.body.dirToWorld(out.ox,out.oz,out);
    }
    return out;
  }

  function nearest(x,z,minimum=0,maximum=totalLength) {
    let best = minimum;
    let bestSquaredDistance = Infinity;
    const sample = {};
    // Preserve the published 0.1-unit sampling rather than optimizing it:
    // changes in tie-breaking can affect grip and movement behavior.
    for(let distance=minimum;distance<=maximum+1e-6;distance+=.1) {
      at(distance,sample);
      const squared = (sample.x-x)**2+(sample.z-z)**2;
      if(squared<bestSquaredDistance) {
        bestSquaredDistance=squared;
        best=distance;
      }
    }
    return best;
  }

  return {...ledge,s:distances,length:totalLength,at,nearest};
}
