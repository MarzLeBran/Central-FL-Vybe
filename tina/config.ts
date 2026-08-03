// Phase 0 spike — throwaway config to prove the local Tina + Astro contextual-
// editing toolchain works before wiring any real content. See
// docs/tinacms.md (once written) and the plan this was built from for the
// full phased rollout. Do not build real collections on top of this file
// until the Phase 0 go/no-go (contextual editing works locally) is settled.
import { defineConfig } from "tinacms";

const branch =
  process.env.TINA_BRANCH ||
  process.env.VERCEL_GIT_COMMIT_REF ||
  process.env.HEAD ||
  "main";

export default defineConfig({
  token: process.env.TINA_TOKEN,
  clientId: process.env.TINA_CLIENT_ID,
  branch,
  build: {
    outputFolder: "admin",
    publicFolder: "public",
  },
  media: {
    tina: {
      mediaRoot: "",
      publicFolder: "public",
    },
  },
  schema: {
    collections: [
      {
        name: "spikeTest",
        label: "Phase 0 Spike (throwaway)",
        path: "content/spike-test",
        format: "json",
        fields: [{ type: "string", name: "message", label: "Message" }],
      },
    ],
  },
});
