import { lounge, room, spa, study, type Interior } from "./interiors.ts";
import type { Place } from "./occupancy.ts";

const cache = new Map<string, Interior>();

/** The interior for a place, built once per page load: building is deterministic. */
export function interiorFor(place: Place, ids: string[]): Interior {
  const key = place === "lounge" ? `lounge:${ids.join(",")}` : place;
  let it = cache.get(key);
  if (!it) {
    it = place === "study" ? study() : place === "lounge" ? lounge(ids) : place === "spa" ? spa() : room(place.slice(5));
    cache.set(key, it);
  }
  return it;
}
