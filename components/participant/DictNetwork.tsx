import { DICT_EDGES, DICT_NODES } from '@/lib/dict-network';

// Depth of every region from the northernmost dot: the network "switches on"
// from Luzon southward, the way the logo's 17 regions link up through ICT.
function depths(): number[] {
  const d = DICT_NODES.map(() => -1);
  d[0] = 0;
  const queue = [0];
  while (queue.length) {
    const n = queue.shift() as number;
    for (const [a, b] of DICT_EDGES) {
      const o = a === n ? b : b === n ? a : -1;
      if (o >= 0 && d[o] < 0) {
        d[o] = d[n] + 1;
        queue.push(o);
      }
    }
  }
  return d.map((v) => (v < 0 ? 0 : v));
}

export const NET_DEPTH = depths();

// Every edge is oriented from its shallower to its deeper dot so it draws outward.
export const NET_EDGES = DICT_EDGES.map(([a, b]) => (NET_DEPTH[a] <= NET_DEPTH[b] ? [a, b] : [b, a]) as [number, number]);

export default function DictNetwork() {
  return (
    <svg className="welcome-net" viewBox="0 0 700 700" aria-hidden="true">
      <g className="net-lines">
        {NET_EDGES.map(([a, b], i) => (
          <line
            key={i}
            className="net-edge"
            data-a={a}
            data-b={b}
            x1={DICT_NODES[a][0]}
            y1={DICT_NODES[a][1]}
            x2={DICT_NODES[b][0]}
            y2={DICT_NODES[b][1]}
            pathLength={1}
          />
        ))}
      </g>
      <g className="net-packets">
        {NET_EDGES.map(([a, b], i) => (
          <line
            key={i}
            className="net-pulse"
            data-a={a}
            data-b={b}
            x1={DICT_NODES[a][0]}
            y1={DICT_NODES[a][1]}
            x2={DICT_NODES[b][0]}
            y2={DICT_NODES[b][1]}
            pathLength={1}
          />
        ))}
      </g>
      <g className="net-nodes">
        {DICT_NODES.map(([x, y], i) => (
          <g key={i}>
            <circle className="net-ring" data-n={i} cx={x} cy={y} r={6} />
            <circle className="net-node" data-n={i} cx={x} cy={y} r={6.2} />
          </g>
        ))}
      </g>
    </svg>
  );
}
