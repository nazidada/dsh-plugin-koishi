import { createRequire } from "node:module";

import type * as Koishi from "koishi";

// Koishi's public ESM entry eagerly loads its application loader. A library
// plugin only needs runtime exports; the CommonJS entry works in both ESM and
// CommonJS hosts without triggering that loader during module evaluation.
const koishi = createRequire(import.meta.url)("koishi") as typeof Koishi;

export const { Schema, Service } = koishi;
