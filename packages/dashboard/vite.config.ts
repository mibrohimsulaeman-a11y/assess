import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// The dashboard normally loads the bundled sample graph from public/.
// For a real assessment run, start it with:
//
//   ASSESS_GRAPH=/abs/path/to/.assessment/assessment-graph.json pnpm dev:dashboard
//
// The dev server then exposes that generated graph at /__assessment_graph__ so
// the browser can load the exact artifact emitted by the assessment process.
const graphFile = process.env.ASSESS_GRAPH ? path.resolve(process.env.ASSESS_GRAPH) : "";
const defaultGraphUrl = graphFile ? "/__assessment_graph__" : "/assessment-graph.json";

function assessmentGraphPlugin(): Plugin {
  return {
    name: "assess-generated-graph",
    configureServer(server) {
      if (!graphFile) return;
      server.middlewares.use("/__assessment_graph__", (_req, res) => {
        if (!fs.existsSync(graphFile)) {
          res.statusCode = 404;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: `ASSESS_GRAPH not found: ${graphFile}` }));
          return;
        }
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(fs.readFileSync(graphFile, "utf8"));
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), assessmentGraphPlugin()],
  define: {
    __ASSESS_DEFAULT_GRAPH__: JSON.stringify(defaultGraphUrl),
  },
  server: { port: 5180, open: true },
});
