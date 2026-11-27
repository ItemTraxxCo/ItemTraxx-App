import { decryptSuperBorrowersWithJit } from "./superEncryptedBorrowers.ts";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const WS_A = "10000000-0000-4000-8000-000000000001";
const WS_B = "10000000-0000-4000-8000-000000000002";

Deno.test("decryptSuperBorrowersWithJit enforces single workspace and forwards JIT token", async () => {
  let receivedToken = "";
  const gateway = async (
    op: "encrypt" | "decrypt",
    body: Record<string, unknown>,
    _secret: string,
    jitToken: string,
  ) => {
    assert(op === "decrypt", "expected decrypt op");
    receivedToken = jitToken;
    const items = body.items as Array<{ id: string }>;
    return {
      items: items.map((item) => ({
        id: item.id,
        payload: { first_name: "Ada", last_name: "Lovelace", borrower_id: "B001" },
      })),
    };
  };

  const rows = [
    {
      id: "20000000-0000-4000-8000-000000000001",
      workspace_id: WS_A,
      encrypted_data: "cipher",
      nonce: "nonce",
      auth_tag: "tag",
      key_version: 1,
    },
  ];
  const result = await decryptSuperBorrowersWithJit(WS_A, rows, "s".repeat(32), "signed.jit.token", gateway);
  assert(receivedToken === "signed.jit.token", "JIT token must be passed to gateway");
  assert(result.length === 1 && result[0].username === "Ada Lovelace", "decrypted borrower mismatch");

  let crossWorkspaceFailed = false;
  try {
    await decryptSuperBorrowersWithJit(
      WS_A,
      [...rows, { ...rows[0], id: "20000000-0000-4000-8000-000000000002", workspace_id: WS_B }],
      "s".repeat(32),
      "signed.jit.token",
      gateway,
    );
  } catch {
    crossWorkspaceFailed = true;
  }
  assert(crossWorkspaceFailed, "mixed-workspace rows must be rejected");
});
