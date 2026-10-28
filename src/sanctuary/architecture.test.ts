// Roof tiles are mapped by inverting screen pixels back onto the roof plane; this checks the inversion.
import assert from "node:assert/strict";
import { test } from "node:test";
import { onPlane, type Plane } from "./architecture.ts";
import { sx, sy } from "./engine.ts";

test("onPlane recovers the world position of a point on a sloped roof", () => {
  const planes: Plane[] = [{ axis: "y", eave: 5.5, z: 28, k: 7.5 }, { axis: "x", eave: 21.7, z: 24, k: 6.3 }];
  for (const p of planes)
    for (const [along, up] of [[7.2, 0.4], [9.9, 1.7], [15.3, 2.4]]) {
      // A point `up` tiles in from the eave, `along` it; its height follows the slope.
      const [x, y] = p.axis === "y" ? [along, p.eave - up] : [p.eave - up, along];
      const z = p.z + up * p.k;
      const r = onPlane(p, sx(x, y), sy(x, y, z));
      assert.ok(Math.abs(r.along - along) < 1e-9 && Math.abs(r.up - up) < 1e-9, `${p.axis}: ${JSON.stringify(r)} vs ${along},${up}`);
    }
});
