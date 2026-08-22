import { readFileSync } from "node:fs";

const identityUrl = new URL("../data/company-identity.json", import.meta.url);

const requiredText = (value, field) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`company_identity:${field}_required`);
  }
  return value.trim();
};

const validateEmail = (value, field) => {
  const email = requiredText(value, field).toLowerCase();
  if (!/^[^@\s]+@masest\.co$/.test(email)) {
    throw new Error(`company_identity:${field}_invalid`);
  }
  return email;
};

const validatePhone = (value, field) => {
  const phone = requiredText(value, field);
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
    throw new Error(`company_identity:${field}_invalid`);
  }
  return phone;
};

export function validateCompanyIdentity(identity) {
  if (!identity || typeof identity !== "object" || Array.isArray(identity)) {
    throw new Error("company_identity:object_required");
  }

  const control = identity.identity_control;
  requiredText(control?.owner, "identity_control.owner");
  requiredText(control?.revision, "identity_control.revision");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(control?.effective_date || "")) {
    throw new Error("company_identity:identity_control.effective_date_invalid");
  }
  requiredText(control?.rule, "identity_control.rule");

  requiredText(identity.legal_name, "legal_name");
  requiredText(identity.public_name, "public_name");
  requiredText(identity.product_brand, "product_brand");
  if (identity.website !== "https://masest.co/") {
    throw new Error("company_identity:website_must_be_canonical");
  }
  if (identity.logo_url !== "https://masest.co/img/masest-logo.png") {
    throw new Error("company_identity:logo_url_must_be_canonical");
  }
  const description = requiredText(identity.organization_description, "organization_description");
  if (/HMIS|safe|non[- ]toxic|certif/i.test(description)) {
    throw new Error("company_identity:description_contains_uncontrolled_claim");
  }
  requiredText(identity.service_area, "service_area");
  requiredText(identity.location?.locality, "location.locality");
  requiredText(identity.location?.region, "location.region");
  requiredText(identity.location?.country, "location.country");

  const address = identity.street_address;
  if (!address || !["confirmed_public", "withheld_pending_confirmation"].includes(address.status)) {
    throw new Error("company_identity:street_address.status_invalid");
  }
  if (address.status === "confirmed_public") {
    requiredText(address.value, "street_address.value");
  } else if (address.value !== null) {
    throw new Error("company_identity:unconfirmed_street_address_must_be_null");
  }

  validateEmail(identity.primary_contact?.email, "primary_contact.email");
  validatePhone(identity.primary_contact?.phone_e164, "primary_contact.phone_e164");
  requiredText(identity.primary_contact?.phone_display, "primary_contact.phone_display");
  if (identity.primary_contact?.url !== "https://masest.co/contact") {
    throw new Error("company_identity:primary_contact.url_invalid");
  }

  if (!Array.isArray(identity.named_contacts) || identity.named_contacts.length < 1) {
    throw new Error("company_identity:named_contacts_required");
  }
  const emails = new Set();
  for (const [index, contact] of identity.named_contacts.entries()) {
    requiredText(contact?.name, `named_contacts.${index}.name`);
    requiredText(contact?.role, `named_contacts.${index}.role`);
    const email = validateEmail(contact?.email, `named_contacts.${index}.email`);
    if (emails.has(email)) throw new Error("company_identity:duplicate_named_contact_email");
    emails.add(email);
    validatePhone(contact?.phone_e164, `named_contacts.${index}.phone_e164`);
    requiredText(contact?.phone_display, `named_contacts.${index}.phone_display`);
  }

  return identity;
}

export const COMPANY_IDENTITY = validateCompanyIdentity(
  JSON.parse(readFileSync(identityUrl, "utf8")),
);

export function organizationJsonLd() {
  const identity = COMPANY_IDENTITY;
  const organization = {
    "@type": "Organization",
    name: identity.legal_name,
    url: identity.website,
    logo: identity.logo_url,
    brand: identity.product_brand,
    description: identity.organization_description,
    areaServed: identity.service_area,
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "sales",
      url: identity.primary_contact.url,
      email: identity.primary_contact.email,
      telephone: identity.primary_contact.phone_e164,
    },
  };

  if (identity.street_address.status === "confirmed_public") {
    organization.address = {
      "@type": "PostalAddress",
      streetAddress: identity.street_address.value,
      addressLocality: identity.location.locality,
      addressRegion: identity.location.region,
      addressCountry: identity.location.country,
    };
  }

  return organization;
}
