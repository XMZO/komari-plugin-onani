import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { JsonStore } from "../src/shared/json-store";

type State = { value: number };

function normalize(value: unknown): State {
  if (value && typeof value === "object" && "value" in value && typeof value.value === "number") {
    return { value: value.value };
  }
  return { value: 0 };
}

test("JSON store replaces values and recovers from a valid temporary file", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onani-json-store-"));
  try {
    const store = new JsonStore(directory, "state.json", normalize);
    assert.deepEqual(store.read(), { value: 0 });
    store.write({ value: 1 });
    store.write({ value: 2 });
    assert.deepEqual(store.read(), { value: 2 });

    fs.writeFileSync(path.join(directory, "state.json"), "invalid json", "utf8");
    fs.writeFileSync(path.join(directory, "state.json.tmp"), JSON.stringify({ value: 3 }), "utf8");
    assert.deepEqual(store.read(), { value: 3 });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
