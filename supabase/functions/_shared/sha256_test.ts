import { sha256Hex } from "./sha256.ts";

const assertEquals = (actual: unknown, expected: unknown, message: string) => {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, received ${actual}`);
  }
};

Deno.test("sha256Hex returns the exact lowercase digest for empty and ASCII strings", async () => {
  assertEquals(
    await sha256Hex(""),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "empty digest",
  );
  assertEquals(
    await sha256Hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    "ASCII digest",
  );
});

Deno.test("sha256Hex hashes UTF-8 input without lossy normalization", async () => {
  assertEquals(
    await sha256Hex("ItemTraxx 🔒"),
    "12a3107636e00643afc863b10429cc35c69fefa576303dc449ab121f60fcbc7d",
    "UTF-8 digest",
  );
});
