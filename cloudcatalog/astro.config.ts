import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import starlightTypeDoc, { typeDocSidebarGroup } from "starlight-typedoc";

// https://astro.build/config
export default defineConfig({
  outDir: "../public",
  publicDir: "./src/assets",
  integrations: [
    starlight({
      title: "HEMS AWS-lib",
      sidebar: [
        {
          label: "Libraries",
          autogenerate: { directory: "lib" },
        },
        typeDocSidebarGroup,
      ],
      plugins: [
        // Generate the documentation.
        starlightTypeDoc({
          entryPoints: ["../packages/cdk/index.ts", "../packages/lambda/index.ts"],
          tsconfig: "../tsconfig.build.json",
          typeDoc: {
            plugin: ["typedoc-plugin-mermaid", "typedoc-plugin-zod"],
          },
          watch: true,
        }),
      ],
    }),
  ],
});
