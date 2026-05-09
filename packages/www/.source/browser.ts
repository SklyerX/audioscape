// @ts-nocheck
import { browser } from 'fumadocs-mdx/runtime/browser';
import type * as Config from '../source.config';

const create = browser<typeof Config, import("fumadocs-mdx/runtime/types").InternalTypeConfig & {
  DocData: {
  }
}>();
const browserCollections = {
  docs: create.doc("docs", {"changelog.mdx": () => import("../content/docs/changelog.mdx?collection=docs"), "code-base.mdx": () => import("../content/docs/code-base.mdx?collection=docs"), "contributing.mdx": () => import("../content/docs/contributing.mdx?collection=docs"), "get-started.mdx": () => import("../content/docs/get-started.mdx?collection=docs"), "index.mdx": () => import("../content/docs/index.mdx?collection=docs"), "queue.mdx": () => import("../content/docs/queue.mdx?collection=docs"), "self-hosting.mdx": () => import("../content/docs/self-hosting.mdx?collection=docs"), "webhooks.mdx": () => import("../content/docs/webhooks.mdx?collection=docs"), "API/analysis.mdx": () => import("../content/docs/API/analysis.mdx?collection=docs"), "API/search.mdx": () => import("../content/docs/API/search.mdx?collection=docs"), }),
};
export default browserCollections;