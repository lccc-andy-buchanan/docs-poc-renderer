// @ts-check
import { defineConfig } from "astro/config";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import starlight from "@astrojs/starlight";
import tailwind from "@astrojs/tailwind";
import sitemap from "@astrojs/sitemap";
import remarkMath from "remark-math";
import rehypeMathjax from "rehype-mathjax";
import cspInlineStyleHashes from "./integrations/csp-inline-style-hashes.mjs";

const projectSourcesDirectory = new URL("./src/content/docs/projects/", import.meta.url);
const projectSlugs = process.env.DOCS_RENDERER_PROJECT_SLUGS ? JSON.parse(process.env.DOCS_RENDERER_PROJECT_SLUGS) : existsSync(projectSourcesDirectory)
    ? readdirSync(projectSourcesDirectory, { withFileTypes: true })
          .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
          .map((entry) => entry.name)
    : [];

const titleFor = (file, fallback) =>
    readFileSync(file, "utf8").match(/^title:\s*["']?([^"'\n]+)["']?\s*$/m)?.[1] ?? fallback;

const labelFor = (name) => name.replace(/[-_]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());

const projectNavigation = existsSync(projectSourcesDirectory)
    ? projectSlugs.flatMap((slug) => {
          const docsDirectory = new URL(`./src/content/docs/projects/${slug}/`, import.meta.url);
          const indexFile = new URL(existsSync(new URL("./index.mdx", docsDirectory)) ? "./index.mdx" : "./index.md", docsDirectory);
          if (!existsSync(indexFile)) return [];

          const entries = readdirSync(docsDirectory, { withFileTypes: true });
          const pages = entries
              .filter((entry) => entry.isFile() && /\.mdx?$/.test(entry.name) && !/^index\.mdx?$/.test(entry.name))
              .map((entry) => {
                  const page = entry.name.replace(/\.mdx?$/, "");
                  return {
                      label: titleFor(new URL(`./${entry.name}`, docsDirectory), labelFor(page)),
                      link: `/projects/${slug}/${page}/`,
                  };
              });
          const sections = entries
              .filter((entry) => entry.isDirectory())
              .map((entry) => ({
                  label: labelFor(entry.name),
                  autogenerate: { directory: `projects/${slug}/${entry.name}`, collapsed: true },
              }));

          return [{ slug, title: titleFor(indexFile, labelFor(slug)), items: [...pages, ...sections] }];
      })
    : [];

// Google Analytics is only *permitted* when both of these are true:
//   - PUBLIC_GA_MEASUREMENT_ID is set (only populated by infra for the
//     production Amplify app; empty/unset everywhere else)
//   - PUBLIC_DEPLOYMENT_ENVIRONMENT is exactly "production"
// This dual gate means a misconfiguration in either layer alone (e.g. the ID
// accidentally being set for a non-prod environment) still won't cause
// analytics to be sent from localhost or a lower environment.
//
// Even when permitted, the GA script itself is never injected at build
// time: it's loaded client-side by /public/cookies.js, and only after the
// visitor accepts the cookie consent banner. Here we only expose the
// measurement ID (via a meta tag) for cookies.js to read - no script tags.
const gaMeasurementId = process.env.PUBLIC_GA_MEASUREMENT_ID;
const isProductionDeployment = process.env.PUBLIC_DEPLOYMENT_ENVIRONMENT === "production";
const gaEnabled = Boolean(gaMeasurementId && isProductionDeployment);

const analyticsHead = gaEnabled
    ? [
          {
              tag: "meta",
              attrs: { name: "ga-measurement-id", content: gaMeasurementId },
          },
      ]
    : [];

// The cookie consent banner/toast (rendered by src/components/CookieConsent.astro,
// included via the Footer override) is driven by this external, same-origin
// script - loaded unconditionally since the banner must appear regardless of
// whether GA is enabled at all. Being an external file, it needs no CSP hash.
const cookieConsentHead = [
    {
        tag: "script",
        attrs: { src: "/cookies.js", defer: true },
    },
];

// Preload the two Latin Atkinson weights used throughout the interface. The
// files live in /public/fonts with versioned names so these URLs remain stable
// for both the development server and the production image.
const fontPreloadHead = [
    {
        tag: "link",
        attrs: {
            rel: "preload",
            href: "/fonts/atkinson-hyperlegible-latin-400-normal-v5.3.0.woff2",
            as: "font",
            type: "font/woff2",
            crossorigin: "anonymous",
        },
    },
    {
        tag: "link",
        attrs: {
            rel: "preload",
            href: "/fonts/atkinson-hyperlegible-latin-700-normal-v5.3.0.woff2",
            as: "font",
            type: "font/woff2",
            crossorigin: "anonymous",
        },
    },
];

// https://astro.build/config
export default defineConfig({
    site: process.env.DOCS_SITE_URL || "https://example.invalid",
    experimental: {
        // Emit per-page CSP <meta> tags with hashes for Astro/Starlight's
        // bundled inline scripts so they satisfy a strict `script-src 'self'`
        // policy (e.g. the default security headers applied by AWS Amplify
        // Hosting) without needing 'unsafe-inline'.
        //
        // Astro only auto-hashes inline scripts/styles that pass through its
        // own build pipeline. A few pieces of inline content bypass that
        // pipeline by design and are therefore never auto-hashed, so their
        // hashes are listed explicitly below:
        //   - Starlight's `<script is:inline>` tags (ThemeProvider,
        //     SidebarPersister, Search) are intentionally left untouched by
        //     Astro to avoid a flash of unstyled/wrong-theme content.
        //   - The `<style>` block injected by rehype-mathjax for SVG math
        //     rendering is raw HTML emitted by the markdown pipeline, not an
        //     Astro-owned `<style>` tag.
        //
        // NOTE: if `@astrojs/starlight` or `rehype-mathjax` are upgraded and
        // change the exact content of these scripts/styles, these hashes will
        // no longer match and the CSP will block them again. Recompute them
        // (e.g. `openssl dgst -sha256 -binary <<< '<script content>' | openssl base64`)
        // if console CSP errors reappear after a dependency upgrade.
        csp: {
            scriptDirective: {
                hashes: [
                    // @astrojs/starlight/components/ThemeProvider.astro
                    "sha256-VWo5Wp4aqSj6nSgMpeAp9cKieaoIfwFUAunAVugI5gA=",
                    // @astrojs/starlight/components/Search.astro
                    "sha256-f/zAUE74ucc3JYp4r4QQvkJofoQdkOIhHYK+jeZ6eko=",
                    // @astrojs/starlight/components/SidebarPersister.astro (x2)
                    "sha256-wX2yOADeV+NMngflD5uYi3vl50SHC4sfM1EmylVjlX4=",
                    "sha256-7eCV4jtsr4t4knb3c4FCRPeu7GGZeOUGE3XvWix0XOQ=",
                ],
                // Astro's default script-src resources already include
                // 'self'; since setting `resources` overrides that default
                // entirely, 'self' must be repeated here whenever we add the
                // Google Tag Manager host. This is still needed even though
                // no GA <script> tag is emitted at build time: /public/cookies.js
                // dynamically injects the gtag.js loader (from this host) once
                // the visitor accepts the cookie consent banner.
                ...(gaEnabled && { resources: ["'self'", "https://www.googletagmanager.com"] }),
            },
            styleDirective: {
                hashes: [
                    // rehype-mathjax SVG output styles
                    "sha256-kuk5TvxZ/Kwuobo4g6uasb1xRQwr1+nfa1A3YGePO7U=",
                ],
            },
        },
    },
    vite: {
        resolve: {
            alias: {
                "@": new URL("./src", import.meta.url).pathname,
            },
        },
    },
    markdown: {
        remarkPlugins: [remarkMath],
        rehypePlugins: [rehypeMathjax],
    },
    integrations: [
        starlight({
            title: "Example project documentation",
            favicon: "/favicon.svg",
            head: [...fontPreloadHead, ...cookieConsentHead, ...analyticsHead],
            social: [
                {
                    icon: "github",
                    label: "GitHub",
                    href: "https://github.com/lccc-andy-buchanan/docs-poc-renderer",
                },
            ],
            sidebar: [
                {
                    label: "All projects",
                    link: "/",
                },
                ...projectNavigation.map((project) => ({
                    label: project.title,
                    items: [
                        { label: "Overview", link: `/projects/${project.slug}/` },
                        ...project.items,
                    ],
                })),
            ],
            customCss: ["./src/global.css"],
            components: {
                Header: "./src/components/Header.astro",
                ThemeSelect: "./src/components/ThemeSelect.astro",
                TwoColumnContent: "./src/components/AccessibleTwoColumnContent.astro",
                Footer: "./src/components/Footer.astro",
                PageFrame: "./src/components/PageFrame.astro",
            },
        }),
        tailwind({ applyBaseStyles: false }),
        sitemap(),
        // Must run after all other integrations so it patches the final,
        // fully-rendered HTML output. See integrations/csp-inline-style-hashes.mjs
        // for why this is needed alongside experimental.csp above.
        cspInlineStyleHashes(),
    ],
});
