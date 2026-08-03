// Phase 0 spike registry — throwaway, replaced by real island definitions
// once contextual editing is proven out (see the plan this was built from).
import type { IslandRegistry } from "@tinacms/astro/experimental";
import { requestWithMetadata } from "@tinacms/astro/data";
import client from "../../tina/__generated__/client";
import SpikeBlock from "../components/islands/SpikeBlock.astro";

export const islands: IslandRegistry = {
  spikeTest: {
    fetch: async () =>
      requestWithMetadata(client.queries.spikeTest({ relativePath: "hello.json" }), {
        priority: "primary",
      }),
    component: SpikeBlock,
    wrapper: { tag: "div" },
    propsFromData: (result: any) => ({ spikeTest: result?.data?.spikeTest }),
  },
};
