import { copyFile, cp, mkdir, writeFile } from "node:fs/promises";

// Sites exposes static files from dist/public; retain the Worker separately in dist/server.
const publicDir = new URL("../dist/public/", import.meta.url);
await mkdir(publicDir, { recursive: true });
await copyFile(new URL("../dist/index.html", import.meta.url), new URL("index.html", publicDir));
await cp(new URL("../dist/assets/", import.meta.url), new URL("assets/", publicDir), { recursive: true });

// Sites serves the Vite output through Cloudflare's static-assets binding.
await mkdir(new URL("../dist/server/", import.meta.url), { recursive: true });
await writeFile(
  new URL("../dist/server/index.js", import.meta.url),
  `const assetsRoot = "https://raw.githubusercontent.com/pagefaultgames/pokerogue-assets/beta";
const localesRoot = "https://raw.githubusercontent.com/pagefaultgames/pokerogue-locales/main";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const isLocale = url.pathname.startsWith("/locales/");
    const isGameMedia = ["/audio/", "/battle-anims/", "/fonts/", "/images/"].some(prefix => url.pathname.startsWith(prefix));

    if (isLocale || isGameMedia) {
      const source = isLocale ? localesRoot : assetsRoot;
      return fetch(source + url.pathname + url.search);
    }

    if (url.pathname === "/") {
      return env.ASSETS.fetch(new Request(new URL("/index.html", request.url), request));
    }

    return env.ASSETS.fetch(request);
  },
};
`,
);

await mkdir(new URL("../dist/.openai/", import.meta.url), { recursive: true });
await copyFile(
  new URL("../.openai/hosting.json", import.meta.url),
  new URL("../dist/.openai/hosting.json", import.meta.url),
);
