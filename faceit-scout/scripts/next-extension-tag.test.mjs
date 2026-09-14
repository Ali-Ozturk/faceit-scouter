import { test } from "node:test";
import assert from "node:assert/strict";
import { nextTag } from "./next-extension-tag.mjs";
test("increments the highest numeric version, not lexical order", () => assert.equal(nextTag(["v0.9.9", "v0.10.2", "preview"]), "v0.10.3"));
test("reuses the existing release on reruns", () => assert.equal(nextTag(["v0.10.2"], ["v0.9.8"]), "v0.9.8"));
test("starts without tags", () => assert.equal(nextTag([]), "v0.1.1"));
test("carries when a browser version component reaches its maximum", () => assert.equal(nextTag(["v0.2.65535"]), "v0.3.0"));
