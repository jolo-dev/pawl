import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import starlightTypeDoc, {
  typeDocSidebarGroup,
  createStarlightTypeDocPlugin,
} from "starlight-typedoc";

const [cdkStarlightTypeDoc, cdkTypeDocSidebarGroup] = createStarlightTypeDocPlugin();
const [lambdaStarlightTypeDoc, lambdaTypeDocSidebarGroup] = createStarlightTypeDocPlugin();

const common = {
  typeDoc: {
    plugin: ["typedoc-plugin-mermaid", "typedoc-plugin-zod"],
  },
  tsconfig: "../tsconfig.build.json",
};

// https://astro.build/config
export default defineConfig({
  outDir: "../public",
  // publicDir: "public",
  base: process.env.NODE_ENV === "production" ? "j64223/aws-lib/" : ".",
  integrations: [
    starlight({
      title: "HEMS AWS-lib",
      sidebar: [
        {
          label: "Libraries",
          autogenerate: { directory: "lib" },
        },
        {
          label: "References",
          items: [cdkTypeDocSidebarGroup, lambdaTypeDocSidebarGroup],
        },
      ],
      plugins: [
        cdkStarlightTypeDoc({
          entryPoints: ["../packages/cdk/index.ts"],
          output: "cdk",
          sidebar: {
            label: "@hems-aws/cdk",
          },
          ...common,
        }),
        lambdaStarlightTypeDoc({
          entryPoints: ["../packages/lambda/index.ts"],
          output: "lambda",
          sidebar: {
            label: "@hems-aws/lambda",
          },
          ...common,
        }),
      ],
    }),
  ],
});
