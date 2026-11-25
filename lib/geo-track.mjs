export function trackSegments(points) {
  if (points.length < 2) return [];
  const lines = [[points[0]]];
  for (let i=1;i<points.length;i++) {
    const a=points[i-1], b=points[i], delta=b[0]-a[0];
    if (Math.abs(delta)>180) {
      const edge = delta<0 ? 180 : -180;
      const wrapped = b[0]+(delta<0 ? 360 : -360);
      const fraction = (edge-a[0]) / (wrapped-a[0]);
      const lat = Number.isFinite(fraction) ? a[1]+(b[1]-a[1])*fraction : a[1];
      lines.at(-1).push([edge,lat]);
      lines.push([[-edge,lat],b]);
    } else lines.at(-1).push(b);
  }
  return lines;
}
