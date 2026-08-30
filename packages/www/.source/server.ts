// @ts-nocheck
import * as __fd_glob_9 from "../content/docs/API/search.mdx?collection=docs"
import * as __fd_glob_8 from "../content/docs/API/analysis.mdx?collection=docs"
import * as __fd_glob_7 from "../content/docs/webhooks.mdx?collection=docs"
import * as __fd_glob_6 from "../content/docs/self-hosting.mdx?collection=docs"
import * as __fd_glob_5 from "../content/docs/queue.mdx?collection=docs"
import * as __fd_glob_4 from "../content/docs/index.mdx?collection=docs"
import * as __fd_glob_3 from "../content/docs/get-started.mdx?collection=docs"
import * as __fd_glob_2 from "../content/docs/contributing.mdx?collection=docs"
import * as __fd_glob_1 from "../content/docs/code-base.mdx?collection=docs"
import * as __fd_glob_0 from "../content/docs/changelog.mdx?collection=docs"
import { server } from 'fumadocs-mdx/runtime/server';
import type * as Config from '../source.config';

const create = server<typeof Config, import("fumadocs-mdx/runtime/types").InternalTypeConfig & {
  DocData: {
  }
}>();

export const docs = await create.docs("docs", "content/docs", {}, {"changelog.mdx": __fd_glob_0, "code-base.mdx": __fd_glob_1, "contributing.mdx": __fd_glob_2, "get-started.mdx": __fd_glob_3, "index.mdx": __fd_glob_4, "queue.mdx": __fd_glob_5, "self-hosting.mdx": __fd_glob_6, "webhooks.mdx": __fd_glob_7, "API/analysis.mdx": __fd_glob_8, "API/search.mdx": __fd_glob_9, });