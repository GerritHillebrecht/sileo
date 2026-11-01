import { defineConfig } from "vitest/config";

// Tests of the OneServe fork: the store (ids, updates, lifetimes, races) and the rendered toast (controls, focus,
// announcements) in a simulated DOM. Motion, focus rings and the gooey filter are checked in a real browser by OneServe.
export default defineConfig({
  test: { include: ["test/**/*.test.tsx"], environment: "happy-dom" },
});
