// Tina's contextual (click-on-page) editing bridge posts here from inside
// the /admin iframe to re-render one island with draft content overlaid.
// Rejects anything that isn't that exact request shape — see
// experimental_createIslandRoute in @tinacms/astro. Not reachable by a normal
// page load. The one on-demand route this static site needs for Tina.
export const prerender = false;

import { experimental_createIslandRoute } from "@tinacms/astro/experimental";
import { islands } from "../../lib/islands";

export const ALL = experimental_createIslandRoute(islands);
