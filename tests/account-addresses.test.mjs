import assert from "node:assert/strict";
import test from "node:test";
import { createAddressesHandler } from "../functions/api/account/addresses.js";

test("saved account addresses are Google-verified and standardized before persistence", async () => {
  let rpcArgs;
  const handler = createAddressesHandler({
    requireCompany: async () => ({
      companyId: "company-1",
      sb: {
        async rpc(name, args) {
          assert.equal(name, "create_company_address");
          rpcArgs = args;
          return { data: "address-1", error: null };
        },
      },
    }),
    validateAddress: async (address) => ({
      address: {
        ...address,
        address1: "100 Main St",
        address2: "Ste 2",
        postal_code: "32901-1234",
      },
      corrected: true,
      formatted_address: "100 Main St Ste 2, Melbourne, FL 32901-1234, USA",
      possible_next_action: "ACCEPT",
    }),
  });
  const response = await handler({
    request: new Request("https://masest.co/api/account/addresses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: {
        type: "ship",
        line1: "100 main st",
        line2: "suite 2",
        city: "Melbourne",
        state: "fl",
        zip: "32901",
        is_default: true,
      } }),
    }),
    env: {},
  });

  assert.equal(response.status, 201);
  assert.equal(rpcArgs.p_line1, "100 Main St");
  assert.equal(rpcArgs.p_line2, "Ste 2");
  assert.equal(rpcArgs.p_zip, "32901-1234");
  assert.deepEqual(await response.json(), {
    ok: true,
    id: "address-1",
    validation: {
      corrected: true,
      formatted_address: "100 Main St Ste 2, Melbourne, FL 32901-1234, USA",
      possible_next_action: "ACCEPT",
    },
  });
});
