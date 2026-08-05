import assert from "node:assert/strict";
import test from "node:test";
import {
  AddressValidationError,
  validateGoogleAddress,
} from "../functions/_lib/address-validation.js";

const input = {
  name: "Omar Buyer",
  company: "Acme HVAC",
  phone: "321-555-0100",
  address1: "100 main st",
  address2: "suite 2",
  city: "Melbourne",
  state: "fl",
  postal_code: "32901",
  country: "US",
};

test("Google validation returns standardized deliverable address and preserves contact fields", async () => {
  let request;
  const result = await validateGoogleAddress(input, {
    GC_AUTOCOMPLETE_API_KEY: "browser-key",
  }, {
    async fetchImpl(url, init) {
      request = { url, init };
      return new Response(JSON.stringify({
        responseId: "google-response-1",
        result: {
          verdict: {
            addressComplete: true,
            validationGranularity: "SUB_PREMISE",
            possibleNextAction: "ACCEPT",
          },
          address: {
            formattedAddress: "100 Main St Ste 2, Melbourne, FL 32901-1234, USA",
            postalAddress: {
              regionCode: "US",
              administrativeArea: "FL",
              locality: "Melbourne",
              postalCode: "32901-1234",
              addressLines: ["100 Main St", "Ste 2"],
            },
          },
          metadata: { residential: false },
        },
      }), { status: 200 });
    },
  });

  assert.equal(request.url, "https://addressvalidation.googleapis.com/v1:validateAddress?key=browser-key");
  assert.equal(request.init.headers.Referer, "https://masest.co/");
  assert.deepEqual(JSON.parse(request.init.body), {
    address: {
      regionCode: "US",
      administrativeArea: "FL",
      locality: "Melbourne",
      postalCode: "32901",
      addressLines: ["100 main st", "suite 2"],
    },
    enableUspsCass: true,
  });
  assert.deepEqual(result.address, {
    ...input,
    address1: "100 Main St",
    address2: "Ste 2",
    state: "FL",
    postal_code: "32901-1234",
    residential: false,
  });
  assert.equal(result.corrected, true);
  assert.equal(result.response_id, "google-response-1");
});

test("Google validation rejects incomplete or non-deliverable addresses", async () => {
  await assert.rejects(
    () => validateGoogleAddress(input, { GC_ADDRESS_VALIDATION_API_KEY: "server-key" }, {
      async fetchImpl() {
        return new Response(JSON.stringify({
          result: {
            verdict: {
              addressComplete: false,
              validationGranularity: "OTHER",
              possibleNextAction: "FIX",
            },
          },
        }), { status: 200 });
      },
    }),
    (error) => error instanceof AddressValidationError
      && error.code === "address_not_deliverable"
      && error.status === 422,
  );

  await assert.rejects(
    () => validateGoogleAddress(input, { GC_ADDRESS_VALIDATION_API_KEY: "server-key" }, {
      async fetchImpl() {
        return new Response(JSON.stringify({
          result: {
            verdict: {
              addressComplete: true,
              validationGranularity: "PREMISE",
              possibleNextAction: "CONFIRM_ADD_SUBPREMISES",
            },
            address: { formattedAddress: "100 Main St, Melbourne, FL 32901, USA" },
          },
        }), { status: 200 });
      },
    }),
    (error) => error.code === "address_not_deliverable"
      && error.details.possible_next_action === "CONFIRM_ADD_SUBPREMISES",
  );
});

test("Google validation fails closed when key or provider is unavailable", async () => {
  await assert.rejects(
    () => validateGoogleAddress(input, {}),
    (error) => error.code === "address_validation_not_configured" && error.status === 503,
  );
  await assert.rejects(
    () => validateGoogleAddress(input, { GC_AUTOCOMPLETE_API_KEY: "key" }, {
      async fetchImpl() { return new Response("denied", { status: 403 }); },
    }),
    (error) => error.code === "address_validation_unavailable" && error.status === 503,
  );
});
