-- P3 authority articles for the existing Blog CMS and static snapshot path.
-- Idempotent. Apply through an approved service-role workflow; this file does
-- not publish or mutate production by itself.

insert into public.content_entries (type, slug, title, status, locale, payload, seo)
values
  (
    'blog_post',
    'industrial-cleaning-trial-scope-isolate-contain-release',
    'Industrial cleaning trials: scope, isolate, contain, release',
    'published',
    'en',
    $post${
      "title": "Industrial cleaning trials: scope, isolate, contain, release",
      "body": "## Treat the trial as maintenance work\n\nAn industrial cleaning trial starts with the asset and work controls, not a product promise. Record the equipment, soil or deposit, materials, current chemical, operating window, people who can authorize the work, and the acceptance endpoint before choosing chemistry.\n\n## The four-gate plan\n\n1. **Scope.** Review the exact SKU's current SDS and label against the task, concentration, substrate, ventilation, and site chemical-approval process.\n2. **Isolate.** Where cleaning exposes workers to unexpected energization or stored energy, the site's hazardous-energy procedure and authorized personnel control the isolation.\n3. **Contain.** Decide where rinse water, removed solids, oil, and spent solution will go before opening the container. Stormwater, sewer, waste, and permit decisions remain site- and jurisdiction-specific.\n4. **Release.** Name the person who accepts the result and the recorded endpoint for rinsing, inspection, testing, reassembly, and return to service.\n\n## Evidence boundary\n\nA product document does not replace the site work plan, permit, lockout procedure, wastewater decision, or competent-person approval. This article is a planning framework, not legal, safety, environmental, or engineering approval.\n\n## Primary sources\n\n- [OSHA Hazard Communication, 29 CFR 1910.1200](https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.1200)\n- [OSHA Control of Hazardous Energy, 29 CFR 1910.147](https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.147)\n- [EPA industrial stormwater fact sheets](https://www.epa.gov/npdes/industrial-stormwater-fact-sheet-series)\n\nSend the current chemical, task, asset, material, wastewater route, and reopening criteria through the [chemical-mapping intake](/contact?type=audit).",
      "date": "2026-07-26",
      "hero": "/img/site/scenes/technical-resources.webp",
      "tags": ["operations", "controlled-trial", "hazard-communication", "wastewater"],
      "author": "MASEST Technical Team",
      "excerpt": "A four-gate framework for scoping an industrial cleaning trial around exact-SKU documents, hazardous-energy isolation, containment, and return to service.",
      "category": "technical",
      "hero_alt": "Representative engineering documents, pipe samples, and water-system components"
    }$post$::jsonb,
    '{}'::jsonb
  ),
  (
    'blog_post',
    'food-plant-cleaning-cip-sanitation-release',
    'Food-plant cleaning: keep CIP, sanitation, and release separate',
    'published',
    'en',
    $post${
      "title": "Food-plant cleaning: keep CIP, sanitation, and release separate",
      "body": "## First decide whether the method is CIP\n\nThe FDA Food Code describes clean-in-place equipment as equipment cleaned by circulating or flowing detergent, rinse water, and sanitizing solution through fixed piping and equipment surfaces. Manual in-place cleaning is not automatically CIP. Map the circuit, flow path, temperature, concentration, contact time, drain points, and rinse endpoint before naming the method.\n\n## Cleaning and sanitation answer different questions\n\nCleaning removes soil from the defined equipment and surface. The food-safety plan still controls allergen cross-contact, contamination prevention, sanitizing or disinfection, chemical suitability, and records. A cleaning observation cannot establish a microbiological, allergen, or food-contact release.\n\n## Define release before the trial\n\nThe customer should select the acceptance method for the hazard and process: documented visual inspection, rinse endpoint, residue check, ATP, allergen, microbiological, or another validated method as applicable. Record limitations and failed criteria as well as the accepted result.\n\n## Evidence boundary\n\nCleaning evidence is not sanitation or disinfection evidence. An antimicrobial or disinfectant claim requires the exact EPA-registered product used according to its label; one product cannot borrow another product's registration. Product selection remains subject to current exact-SKU documents, material review, the food-safety plan, and site approval.\n\n## Primary sources\n\n- [FDA Food Code 2022](https://www.fda.gov/media/184685/download)\n- [21 CFR 117.35, Sanitary operations](https://www.ecfr.gov/current/title-21/chapter-I/subchapter-B/part-117/subpart-B/section-117.35)\n- [EPA selected registered disinfectants](https://www.epa.gov/pesticide-registration/selected-epa-registered-disinfectants)\n\nUse the [food-and-beverage audit intake](/contact?type=audit&industry=Food%20%26%20Beverage) to provide the circuit, soil, current method, and release criteria.",
      "date": "2026-07-26",
      "hero": "/img/industries/samples/food-beverage.webp",
      "tags": ["operations", "food-beverage", "cip", "verification"],
      "author": "MASEST Technical Team",
      "excerpt": "A source-led way to separate the CIP method, cleaning result, sanitation decision, and customer-defined release criteria.",
      "category": "technical",
      "hero_alt": "Representative food-processing technician operating a clean-in-place skid beside stainless tanks"
    }$post$::jsonb,
    '{}'::jsonb
  ),
  (
    'blog_post',
    'cooling-tower-cleaning-water-management-plan',
    'Cooling-tower cleaning belongs inside the water-management plan',
    'published',
    'en',
    $post${
      "title": "Cooling-tower cleaning belongs inside the water-management plan",
      "body": "## Start with the facility program\n\nCooling-tower cleaning is one controlled task inside a broader water-management program. The facility team owns system scope, responsible people, control locations, monitoring, corrective action, shutdown coordination, and return to service. A cleaner does not create a water-management program or establish that the facility meets its water-management obligations.\n\n## Build the maintenance window around the system\n\nRecord tower duty and redundancy, system volume, metallurgy, deposits, prior treatment, monitoring points, isolation limits, aerosol controls, worker protection, containment, disposal route, and the operating endpoint needed for reopening. Use the current equipment requirements and facility procedure to set circulation, inspection, flushing, refill, and verification steps.\n\n## Keep product and program evidence separate\n\nScale, corrosion, suspended solids, and microbiological growth are different control problems. Review each proposed product against its exact function and current records. Certification, performance, potable-water, antimicrobial, safety, and discharge statements require their own exact-product evidence and cannot be inferred from the water-management plan.\n\n## Evidence boundary\n\nCleaning chemistry is one controlled task inside the facility program, not a substitute for risk management, monitoring, disinfection strategy, engineering review, or jurisdictional requirements. This article provides intake structure, not site approval.\n\n## Primary sources\n\n- [ASHRAE Standard 188 and Guideline 12 scopes](https://www.ashrae.org/technical-resources/standards-and-guidelines/titles-purposes-and-scopes)\n- [CDC cooling-tower cleaning procedure](https://www.cdc.gov/infection-control/hcp/environmental-control/appendix-c-water.html)\n- [DOE cooling-water efficiency opportunities for federal data centers](https://www.energy.gov/cmei/femp/cooling-water-efficiency-opportunities-federal-data-centers)\n\nUse the [water-treatment audit intake](/contact?type=audit&industry=HVAC%20%2F%20Water%20Treatment) to send system volume, metallurgy, current program, wastewater route, and reopening criteria.",
      "date": "2026-07-26",
      "hero": "/img/industries/samples/hvac-water.webp",
      "tags": ["operations", "cooling-tower", "water-management", "hvac"],
      "author": "MASEST Technical Team",
      "excerpt": "An operations-first framework for placing cooling-tower cleaning inside the facility water-management, maintenance, containment, and return-to-service process.",
      "category": "technical",
      "hero_alt": "Representative HVAC technician servicing cooling-tower and heat-exchanger water equipment"
    }$post$::jsonb,
    '{}'::jsonb
  )
on conflict (type, slug, locale) do update
  set title = excluded.title,
      status = excluded.status,
      payload = excluded.payload,
      seo = excluded.seo,
      published_at = coalesce(public.content_entries.published_at, now()),
      updated_at = now();

update public.content_entries
  set published_at = coalesce(published_at, now())
  where type = 'blog_post' and slug in (
    'industrial-cleaning-trial-scope-isolate-contain-release',
    'food-plant-cleaning-cip-sanitation-release',
    'cooling-tower-cleaning-water-management-plan'
  ) and status = 'published';
