#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderMarkdown } from "./_md.mjs";
import { organizationJsonLd } from "./company-identity.mjs";
import { BLOG_VERSION, COMPONENT_VERSION, MAIN_VERSION, NAVIGATION_VERSION, STYLE_VERSION } from "./static-release.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "..", "comparisons");
const BASE = "https://masest.co";

const html = (s) => String(s)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

/* `body` — long-form markdown, rendered through the same renderer the blog uses, so
 * [[price:...]] and [[card:...]] bindings work here identically.
 *
 * Why the prose lives here and not in the CMS. Ruled 2026-09-10: /comparisons/<slug> is
 * canonical for these five topics and /blog/<slug> 301s to it. A redirect into a page
 * thinner than the one it replaces deletes content, and three of the five comparison pages
 * were thinner than their blog twin (beer-line -183w, lam3 -90w, hcr-vs-rydlyme -57w), so
 * every body below is carried across before the redirect ships. All five canonical pages
 * are now larger than what they replace.
 *
 * Two of them (cr-hd-vs-simple-green, vertkleen-hcr-vs-clr) are the SQ-24 expansions —
 * ~1,200 words at sentence-length CV 0.58/0.61, inside the human 0.55-0.85 band. Those two
 * must NOT also be pasted into the CMS: the CMS copy would land on the retired URL.
 * The other three are their blog body carried verbatim.
 *
 * These are snapshots, deliberately. The Supabase post they came from is retired and will
 * not be edited again; this generator is the live copy from here on.
 */
const pages = [
  {
    slug: "vertkleen-hcr-vs-clr",
    datePublished: "2026-07-09",
    dateModified: "2026-09-10",
    body: `## The Brevard job turned a product comparison into a time comparison

CLR remained on a rusted 20-year stainless-steel HVAC plate and drain for 36 hours without clearing the area.

DDC Engineering then applied [VertKleen HCR](/products/hcr) for 30 minutes and rinsed it with a garden hose. No scrubbing was recorded.

Put those two facts next to each other and the decision stops being about chemistry. It's about labour and downtime, which is where descaling money actually goes.

One clarification first, because it matters for a fair comparison. The Brevard report names CLR. The product weighed up below is **CLR PRO MAX**, the industrial descaler in the CLR range — a heavier product than the one that sat on the plate for a day and a half. Comparing HCR to the industrial version is the harder test, so it's the one worth running.

## What CLR PRO MAX is actually built for

It's a serious product, and this comparison is worthless if it pretends otherwise.

CLR PRO MAX is sold for industrial rust, lime, calcium, and scale. Its product guide starts heavy-duty work at 1:1 and lists a two-to-three-hour use window. That's a legitimate industrial descaling spec, and on plenty of deposits it will do the job.

Its current SDS lists corrosive skin and eye hazards for the sold product and use dilution. That's not a criticism — it's a property, and it's a common one across effective descalers. What it does is set the workflow around the product, and the workflow is where most of the cost difference lives.

Check the current SDS yourself before any comparison reaches a purchase decision. Formulations and classifications change, and a claim about a competitor's product is only as current as the document behind it.

[[card:title=See CLR PRO MAX product information|href=https://www.clrbrands.com/proline/products/clr-pro/clr-pro-max-industrial-descaler/|image=/img/blog/comparisons/vertkleen-hcr-vs-clr-split.webp|alt=VertKleen HCR container beside a CLR PRO MAX industrial descaler container|width=1448|height=1086]]

## Why does corrosion rate belong in a cleaning decision?

Because you are not buying clean. You're buying clean minus whatever the cleaning cost the asset.

Source testing measured HCR at 0.59 mpy on steel — up to 280 times less corrosion than hydrochloric acid. The same testing measured 15% more calcium-carbonate capacity than hydrochloric acid.

Those two numbers have to be read together or they mislead. Capacity alone is a strength claim, and any aggressive acid can win it. Low corrosion alone is a gentleness claim, and plenty of mild products win that by not working. More capacity *and* less metal loss is a different statement: the chemistry is being spent on the deposit rather than on the substrate under it.

On a twenty-year exchanger, plate, or pump housing, that ratio is the whole argument. There's a finite amount of metal left, and every descaling cycle spends some of it. A method that spends less buys more cycles before replacement — which is the number a capital budget actually cares about.

| Decision factor | HCR | CLR PRO MAX |
| --- | --- | --- |
| Primary work | Industrial carbonate scale and rust | Heavy rust, lime, calcium, and scale |
| Concentration | Matched to deposit and reaction | Published 1:1 heavy-duty starting point |
| Product profile | HMIS 0-0-0, non-fuming | Corrosive hazards in current SDS |
| Shipping | Non-hazmat | Confirm for selected pack and route |

## The workflow around the product, not just the product

HCR adds no product-specific PPE or ventilation requirement for routine use, and creates no hazmat shipping surcharge.

Follow what a corrosive classification adds instead, because none of it appears on a price comparison. Dedicated PPE. Eyewash provision within reach. Segregated storage away from incompatible stock. Splash and fume controls. A trained handler on site. Freight handling for a regulated pack. Disposal and neutralisation planning.

Each item is manageable. Together they're the difference between a maintenance task and a small project, and they recur every time the job runs.

The maintenance controls don't move either way. Pressure, isolation, access, gas release, rinsate, and the equipment itself all still govern the job, and no product rating relaxes any of them. The gain is narrower and real: fewer acid-specific complications before, during, and after the shutdown.

That matters most where the shutdown window is fixed. A school in a term break, a plant between runs, a hospital mechanical room — the setup time you don't spend on chemical containment is time you spend on the actual deposit.

## Where would you still choose the other product?

Two situations, honestly.

If your existing programme is built around a corrosive descaler and the controls are already in place — the storage, the PPE stock, the trained crew, the disposal route — then the marginal cost of continuing is much lower than the cost of the switch. Sunk infrastructure counts.

And if the deposit is one the incumbent clears reliably inside its two-to-three-hour window, on an asset with plenty of life left, you're optimising something that isn't hurting you. Descaling chemistry is worth changing when the deposit is stubborn, the asset is old, or the workflow overhead is heavy. Absent all three, habit is a reasonable answer.

The Brevard job had two of the three. Twenty-year stainless, and a deposit the first attempt didn't move.

## Fixed starting point, or matched to the deposit?

This is the difference that shows up on the second job rather than the first.

CLR PRO MAX publishes a 1:1 heavy-duty starting point and a two-to-three-hour window. That's clear, repeatable, and easy to train — genuine advantages. It also treats every heavy deposit as the same deposit.

HCR's directions allow the starting concentration to be matched to buildup severity and reaction rate. More judgement required, and more room to spend less product on a light deposit or push harder on a packed one.

Which is better depends entirely on who's running it. A crew that descales twice a year is better served by a fixed number they can't get wrong. A maintenance team doing this monthly, across units with different water and different ages, will save real product by matching — and will notice within a quarter that half their jobs never needed the heavy mix.

Match the method to the frequency, not to the marketing. And write down which concentration actually cleared each deposit, because after three or four jobs that record becomes your own dilution table — better than either published figure, because it's built on your water and your equipment.

## What to check before you switch anything

Three things, and none of them are about the chemistry.

Materials first. Compatible hose, fitting, and system materials are part of the setup regardless of product, and a descaler that's kind to steel may still be wrong for a gasket, a seal, or a soft metal somewhere in the loop. Confirm against the actual system, not the general case.

Then the disposal route. Rinsate has to go somewhere, and a change of product can change what's permitted. Settle it before the first job, not while a reservoir is waiting.

Last, the controls you'd be retiring. If the corrosive workflow disappears, someone has to decide what stays — eyewash provision, storage segregation, the training module. Retiring a control because the new product doesn't need it is correct. Retiring it by accident, because nobody reviewed the list, is how a site ends up unprepared for the next corrosive thing that arrives.

## Compare cost through restart, not per gallon

HCR lists at [[price:HCR-25G|retail|per_gallon]].

That number decides nothing on its own. Count mixed solution, application or circulation, monitoring, water, labour, repeat work, and the time until the asset returns to useful service — then add the workflow items above, because they are real hours somebody is paid for.

On the Brevard job, faster effective cleaning directly reduced the time required to reach the visible finish. Thirty-five and a half hours of difference is not a chemistry margin. It's a scheduling outcome, and it's the kind of figure that survives contact with a finance review.

The [full Brevard case study](/blog/hcr-brevard-hvac-rust-case-study) has the sequence, and the [descaling resources](/resources) cover concentration, monitoring, and material compatibility for planning the loop.

[Request HCR pricing](/contact?type=quote&product=VertKleen%20HCR%20vs%20CLR) for your system volume and deposit.`,
    title: "VertKleen HCR vs CLR",
    seoTitle: "HCR vs CLR: Industrial Descaling",
    description: "Compare VertKleen HCR with CLR for rust, mineral scale, circulation cleaning, crew time, rinsing, and total job cost.",
    eyebrow: "Descaler comparison",
    h1: "VertKleen HCR vs CLR: which fits your descaling job?",
    subhead: "Compare the buildup, equipment, cleaning time, rinsing, handling, and total cost—not the jug price alone.",
    product: "VertKleen HCR",
    productHref: "../products/hcr-t16",
    competitor: "CLR PRO MAX",
    vkPrices: [{ vsku: "HCR-25G", tier: "retail", gallons: 2.5 }],
    marketMath: "$1,600-$1,800 / 55 gal = $29.09-$32.73/gal",
    priceNote: "Jug price is only the start. Mix, cleaning time, labor, water, repeat passes, and downtime decide what the whole job costs.",
    swapCurrent: "CLR / Calci-Solve",
    swapJob: "Rust, scale, calcium, and heat-transfer fouling",
    swapUse: "VertKleen HCR for heavy rust and scale; Descaler when the job is coil-specific line cleaning.",
    proofTitle: "See HCR on heavy rust and scale",
    proof: "A real HCR job shows heavy rust and mineral scale breaking free from metal and revealing a visibly cleaner surface.",
    image: "../img/blog/comparisons/vertkleen-hcr-vs-clr-split.webp",
    imageAlt: "VertKleen HVAC HCR and CLR PRO MAX Industrial Descaler containers side by side",
    ctaProduct: "VertKleen HCR vs CLR",
    ctaLabel: "Try HCR on my buildup",
    decision: "A light spot and a scaled heat exchanger are very different jobs. Compare both products on the same buildup, surface, area, working time, and finished result."
  },
  {
    slug: "hcr-vs-rydlyme",
    datePublished: "2026-07-09",
    dateModified: "2026-09-10",
    body: `## Both products descale. The buying decision is the complete shutdown.

RYDLYME is a familiar biodegradable descaler. Its maker publishes capacity of two pounds of calcium carbonate per gallon and typical circulation of two to four hours.

VertKleen HCR combines scale and rust removal with measured corrosion control, high calcium-carbonate capacity, and HMIS 0-0-0 handling.

[[card:title=See RYDLYME's published specifications|href=https://www.apexengineeringproducts.com/rydlyme-specifications/|image=/img/blog/comparisons/hcr-vs-rydlyme-split.webp|alt=VertKleen HCR container beside a RYDLYME descaler container|width=1448|height=1086]]

## Compare the evidence each product brings

| Decision factor | VertKleen HCR | RYDLYME |
| --- | --- | --- |
| Primary fit | Carbonate scale and rust | Water-scale buildup |
| Published capacity | 15% more CaCO3 capacity than HCl | 2 lb CaCO3 per gallon |
| Published cycle | Match to system and buildup | Typical 2–4 hours |
| HMIS | 0-0-0 | See current RYDLYME SDS |
| Transport | Non-hazmat | Confirm for selected pack and route |

These figures are starting points. System volume, deposit, material, temperature, flow, and release standard determine the actual job.

## HCR protects more of the asset beneath the scale

Source testing measured HCR at 0.59 mpy on steel, up to 280 times less corrosion than hydrochloric acid in the same comparison.

That matters because the exchanger, piping, pump, or vessel is worth far more than the chemical charge.

Material compatibility still belongs in the work plan. HCR directions specifically call for compatible fittings and prohibit aluminum fittings in the noted pumping setup.

## A simpler product changes shutdown logistics

HCR ships non-hazmat and adds no product-specific PPE or ventilation requirement for routine use.

The job may still require lockout, pressure isolation, confined-space controls, gas management, splash protection, and wastewater handling.

For multi-site operators, HCR can simplify freight, storage, and technician training before the maintenance window begins.

## The Brevard job provides a time-and-labor result

At a Brevard County School District HVAC system, CLR remained on a 20-year stainless-steel plate and drain for 36 hours without clearing the rust.

HCR completed the visible cleaning in 30 minutes, followed by a garden-hose rinse and no recorded scrubbing.

Read the [full Brevard result](/blog/hcr-brevard-hvac-rust-case-study).

## Price product through restart

HCR lists at [[price:HCR-25G|retail|per_gallon]].

Compare delivered product, mixed volume, circulation, water, crew hours, inspection, repeat work, and the time the equipment returns to service.

Review [HCR](/products/hcr), [technical documents](/resources), and [descaling proof](/proof).

[Request an HCR comparison quote](/contact?type=quote&product=HCR%20vs%20RYDLYME) with system volume and current cycle.`,
    title: "HCR vs RYDLYME",
    seoTitle: "HCR vs RYDLYME: System-Cost Guide",
    description: "Compare VertKleen HCR and RYDLYME by product use, cleaning time, rinsing, crew handling, downtime, and total descaling cost.",
    eyebrow: "Descaler comparison",
    h1: "VertKleen HCR vs RYDLYME on the same descaling job.",
    subhead: "Compare how much product, crew time, rinse water, and downtime each cleaner needs to deliver the result.",
    product: "VertKleen HCR",
    productHref: "../products/hcr-t16",
    competitor: "RYDLYME",
    vkPrices: [{ vsku: "HCR-25G", tier: "retail", gallons: 2.5 }],
    marketMath: "$170-$243 / 5 gal = $34.00-$48.60/gal",
    priceNote: "Current pack prices start the comparison; circulation dose, cycle, rinse, labor, wastewater, and shutdown finish it.",
    swapCurrent: "RYDLYME biodegradable descaler",
    swapJob: "Cooling tower, heat exchanger, and facility scale removal",
    swapUse: "VertKleen HCR for heavy mineral scale and rust in towers, heat exchangers, coils, and facility equipment.",
    proofTitle: "See HCR on HVAC metal",
    proof: "A real HVAC job shows HCR releasing heavy rust and scale and leaving the metal visibly cleaner.",
    image: "../img/blog/comparisons/hcr-vs-rydlyme-split.webp",
    imageAlt: "VertKleen HVAC HCR and RYDLYME descaler containers side by side",
    ctaProduct: "HCR vs RYDLYME",
    ctaLabel: "Plan a side-by-side test",
    decision: "Use the same equipment, buildup, temperature, circulation time, and finish target. Then compare product, crew time, rinse water, and downtime."
  },
  {
    slug: "cr-hd-vs-simple-green",
    datePublished: "2026-07-09",
    dateModified: "2026-09-10",
    body: `## Simple Green is familiar. CR HD is built for the harder shift.

Simple Green Industrial is a broad cleaner and degreaser, and it earned that position honestly. Its published directions span full strength through 1:10.

[CR HD](/products/crhd) is aimed somewhere narrower and heavier: oil, grease, carbon, and tracked shop soil, with a dilution range wide enough that one concentrate covers equipment, floors, and glass.

Both statements are true at once, which is why this comparison is usually argued badly. The question isn't which cleaner is better. It's which one matches the dirtiest thing you clean regularly — because that job sets your whole shelf.

## Why does active percentage decide the shelf?

CR HD is a 50% degreaser. Simple Green Industrial runs 15% active.

Follow what that does downstream. A high-active concentrate can be cut hard for light work and still perform, so one bottle stretches across tasks. A lower-active product has less room to give away, so in practice it gets used at or near full strength — and anything beyond its range needs a different product entirely.

That's the mechanism behind a long shelf. Not preference, not procurement laziness. Arithmetic.

The added capacity shows up most clearly where the current cleaner needs repeated application, long scrubbing, or a nearly neat mix to reach an acceptable finish. If that describes your worst job, the comparison is already decided. If it doesn't, it honestly may not be.

CR HD wets through oily film, releases it from the surface, and helps carry the loosened soil away — the release step being the one that saves the scrubbing.

| Decision | CR HD | Simple Green Industrial |
| --- | --- | --- |
| Best fit | Heavy industrial grease, oil, carbon, and mixed facility soil | General cleaning and degreasing |
| Dilution strategy | Match a broad range to the job | Full strength to 1:10 by published task |
| HMIS | 0-0-0 | See current Simple Green SDS |
| Transport | Non-hazmat | Confirm for the selected product and pack |
| Buying measure | Cost per completed job | Cost per completed job |

[[card:title=See Simple Green Industrial Cleaner & Degreaser|href=https://simplegreen.com/industrial/products/industrial-cleaner-degreaser/|image=/img/blog/comparisons/cr-hd-vs-simple-green-split.webp|alt=VertKleen CR HD container beside Simple Green Industrial Cleaner and Degreaser|width=1448|height=1086]]

## Three distribution centers ran the experiment

Walmart distribution centers DC-8851, DC-7023, and DC-6099 replaced Simple Green with CR HD.

The same concentrate then served workshops, Crown Forklift and Plug Power equipment, parts, kitchens, floors, drains, windows, and glass. That's the consolidation claim tested under a mixed industrial workload rather than argued on a spec sheet.

Three sites matter more than one. A single building can be an unusual building — odd water, unusual soil, one persuasive maintenance lead. Three agreeing is harder to explain away.

The [full three-site case study](/blog/cr-hd-walmart-distribution-center-case-study) covers what each area actually demanded.

## Where Simple Green is still the right answer

This section exists because a comparison without one isn't a comparison.

If your heaviest recurring job is light-to-moderate facility soil, a 50% degreaser is capacity you'll pay for and dilute away. Familiarity has real value too — a crew that already knows a product's behaviour makes fewer mistakes with it than with a better product they've just met. That's not sentiment. Errors cost rework, and rework is the most expensive line in the whole comparison.

And if your operation genuinely needs specialist chemistry in one area, consolidation doesn't remove that bottle. It removes the three general-purpose ones around it.

So the honest test is narrow: does your hardest routine job currently need repeat passes or a nearly neat mix? If yes, the case for more capacity is strong. If no, you're comparing on price and habit, and habit usually deserves to win.

## What about scrubbers and parts washers?

Different problem. Same family, different product.

Recirculating equipment punishes foam. A scrubber's recovery tank is supposed to hold dirty solution; when it fills with foam head instead, pickup degrades, the machine stops, and somebody reaches for defoamer. [CR HD Low Foam](/products/cr-hd-low-foam) exists for exactly that equipment class — parts washers, floor scrubbers, and anything that recirculates.

This is worth checking before any comparison, because it's where product-versus-product arguments quietly go wrong. A degreaser that wins on an open surface can lose badly in a tank, and the operator experiencing that failure will describe it as the cleaner not working. It is working. It's foaming, in a machine that can't tolerate foam.

So split the question. Open surfaces and manual application are one test. Recirculating equipment is a second, and it needs the low-foam variant to be a fair fight.

## How do you switch without a bad first week?

Badly-run switches fail on dilution, not on chemistry.

A crew that's spent years with a 15%-active product has calibrated their hands to it. Give them a 50% concentrate and the first instinct is to mix it the way they always have — which wastes product, leaves residue on glass, and produces exactly the complaint that kills a rollout in week one. The product didn't fail. The habit did.

Three things prevent it.

Post a dilution chart at the fill point, not in a binder. Pre-mix the first week's bottles yourself so nobody is estimating. And start on the hardest job rather than the easiest, because that's where the difference is visible enough to earn the crew's patience for everything else.

Then leave the old product on the shelf for a fortnight. Not as a hedge — as a control. If a crew can reach for the incumbent and stops choosing to, that's a stronger result than any panel test, and it costs nothing to run.

The one thing not to do is switch everything on a Monday across every area at once. Rollouts fail on the surface nobody thought about — usually glass, usually because someone used the equipment dilution on a window and left streaks that took an hour to fix.

## The logistics gain is the one purchasing notices

CR HD is HMIS 0-0-0, ships non-hazmat, and adds no product-specific PPE or ventilation requirement for routine use.

Crews still use the protection the task demands — oily soil, pressure equipment, traffic, and wastewater don't care what the container is rated. That's unchanged and shouldn't be softened.

What changes sits upstream of the work. Receiving, storage, branch transfers, training, and day-to-day handling all get shorter, and for a multi-site operator that administrative flattening frequently outweighs the per-gallon difference. It's also the part that never appears in a side-by-side product comparison, because it isn't a property of the product — it's a property of owning fewer of them.

## Compare on completed-job cost, not per gallon

CR HD lists at [[price:CRHD-25G|retail|per_gallon]].

That figure is close to meaningless on its own, and quoting it against another list price is the most common way this decision gets made badly. A concentrate's real price is its list price divided by the dilution the job actually needs.

Calculate mixed product used, application and scrub time, rinse water, repeat passes, cleanup, and minutes until the asset or area returns to service.

| Term | Why it moves the answer |
| --- | --- |
| Working dilution | Converts list price into cost per bucket |
| Repeat passes | A second pass doubles labour, not chemical |
| Scrub time | Usually the largest line, almost never measured |
| Rinse water and cleanup | Real, recurring, and easy to forget |
| Time back to service | On a dock or a line, this dwarfs the rest |

A concentrate earns the switch when it lowers that complete number while delivering the required finish. Both halves matter — a cheaper completed job that doesn't reach the finish isn't cheaper, it's deferred.

One more thing the completed-job view exposes: which jobs you're currently choosing not to do. Every facility has a surface that gets wiped rather than cleaned, because cleaning it properly takes passes nobody has time for. That job never appears in a cost comparison — it isn't in the schedule. It's in the backlog.

Extra capacity sometimes pays for itself there rather than on the jobs you already do. A surface that moves from "wipe it and move on" to "clean it in one pass" is new work completed, not existing work made cheaper, and the two are easy to confuse when the invoice looks identical.

Other [documented results](/proof) show the same pattern across different soils.

Run it on your four worst recurring jobs, not on a demo panel. And run both products under identical conditions, or the result tells you about the test rather than the products.

[Order a CR HD sample](/contact?type=sample&product=CR%20HD#quoteForm) for the job that currently takes the most passes.`,
    title: "CR HD vs Simple Green",
    seoTitle: "CR HD vs Simple Green: Degreasers",
    description: "Compare VertKleen CR HD with Simple Green for heavy grease, repeat passes, rinsing, crew time, and total cleaning cost.",
    eyebrow: "Degreaser comparison",
    h1: "VertKleen CR HD vs Simple Green on heavy grease.",
    subhead: "Compare cleaning power, repeat passes, foam, rinsing, crew time, and what the finished job costs.",
    product: "VertKleen CR HD",
    productHref: "../products/crhd",
    competitor: "Simple Green Industrial",
    vkPrices: [{ vsku: "CRHD-25G", tier: "retail", gallons: 2.5 }],
    marketMath: "$66-$184 / 5 gal = $13.20-$36.80/gal",
    priceNote: "Pack price matters, but product use, repeat passes, water, labor, cleanup, and downtime decide the real cost.",
    swapCurrent: "Simple Green / Zep / butyl degreasers",
    swapJob: "Heavy-duty degreasing",
    swapUse: "VertKleen CR HD for warehouse floors, forklifts, kitchens, drains, parts, and heavy oil.",
    proofTitle: "Compare it on your hardest grease job",
    proof: "Tell us what you clean today, how much product and time it takes, and what a good finish looks like. We will help you set up a fair side-by-side test.",
    proofHref: "../contact?type=audit&product=CR%20HD%20vs%20Simple%20Green",
    proofCta: "Plan my comparison",
    image: "../img/comparisons/cr-hd-vs-simple-green-split.webp",
    imageAlt: "VertKleen CR HD and Simple Green Industrial cleaner containers side by side",
    ctaProduct: "CR HD vs Simple Green",
    ctaLabel: "Try CR HD on my grease job",
    decision: "A general cleaner may need repeat passes on heavy oil and grease. Clean equal areas, then compare product, brushing, passes, water, labor, and leftover film."
  },
  {
    slug: "lam3-vs-wet-forget",
    datePublished: "2026-07-09",
    dateModified: "2026-09-10",
    body: `## Choose by the finish schedule, not the bottle

Wet & Forget and VertKleen LAM3 both use time instead of aggressive pressure, but they serve different operating needs.

Wet & Forget is designed for gradual weather-assisted stain removal. LAM3 gives contractors a long-working formula for moss, algae, lichen, mold, and mildew across mixed exterior surfaces.

## What Wet & Forget publishes

Wet & Forget directs users to dilute concentrate 1:5, saturate a dry surface, and leave it without scrubbing or rinsing.

The company says visible results may take days to months. That can fit properties where weather can finish the work and the appearance does not need to change on a tighter schedule.

[[card:title=See Wet & Forget's use directions|href=https://www.wetandforget.com/wet-and-forget-concentrate.html|image=/img/blog/comparisons/lam3-vs-wet-forget-split.webp|alt=VertKleen LAM3 container beside a Wet and Forget exterior cleaner container|width=1448|height=1086]]

## LAM3 gives crews more control over the treatment

LAM3 directions call for 1:5 on heavy staining and 1:10 on lighter staining.

Apply with a low-pressure sprayer or brush and leave the treatment to work. Visible change can begin within one or two weeks, with maximum results developing over as long as a month.

For heavily dirted surfaces, the label allows brushing and rinsing before reapplication. That flexibility helps contractors match the method to the property’s finish date.

## One neutral formula crosses more surfaces

LAM3 contains no acid, caustic, solvent, bleach, quat, or peroxide. It is pH neutral, HMIS 0-0-0, zero-VOC, mild in odor, and ships non-hazmat.

It is designed for pavers, wood, stucco, siding, metal, aluminum, paint, concrete, brick, glass, tile, and roofing materials.

Routine use adds no product-specific PPE or ventilation requirement. Access, spray equipment, weather, runoff, biological soil, and the surface still determine the job controls.

## A brighter property over two weeks

MASEST has a LAM3 and Purgo result on a painted exterior column with visible improvement after two weeks.

The same-angle progress view matters because this kind of treatment keeps working after the crew leaves.

The [property grout and moss result](/proof#property-grout-moss) also paired CR for ground-in dirt with LAM3 for longer-working exterior treatment.

## Price the area that reaches the promised finish

LAM3 lists at [[price:LAM3-25G|retail|per_gallon]].

Calculate mixed gallons, application labor, access, return visits, rinse work, and square feet reaching the agreed finish by the required date.

That completed-area cost tells a contractor which method creates the better margin.

Explore [LAM3](/products/lam3), the [low-pressure cleaning guide](/blog/how-to-remove-moss-algae-without-pressure-washing), and [exterior results](/proof#property-grout-moss).

[Order LAM3 or request project pricing](/contact?type=quote&product=LAM3%20vs%20Wet%20%26%20Forget).`,
    title: "LAM3 vs Wet & Forget",
    seoTitle: "LAM3 vs Wet & Forget: Finished-Area Guide",
    description: "Compare VertKleen LAM3 against Wet & Forget for moss, algae, mold, mildew, and exterior stain removal.",
    eyebrow: "Exterior stain comparison",
    h1: "Compare the finished area, labor, and maintenance cycle.",
    subhead: "Compare coverage, working time, visible stain removal, labor, repeat visits, and cost per finished area.",
    product: "VertKleen LAM3",
    productHref: "../products/lam3",
    competitor: "Wet & Forget",
    vkPrices: [{ vsku: "LAM3-25G", tier: "retail", gallons: 2.5 }],
    marketMath: "$34.00/gal",
    priceNote: "Compare pack price with coverage, application time, repeat visits, water, cleanup, and how long the result lasts.",
    swapCurrent: "Wet & Forget / bleach roof cleaners",
    swapJob: "Exterior moss, algae, mold, mildew, lichen, and stain removal",
    swapUse: "VertKleen LAM3 for spray-and-walk-away exterior biological staining.",
    proofTitle: "See a real exterior result",
    proof: "Before-and-after photos show CR and LAM3 lifting ground-in grime, outdoor growth, and dark grout stains from hardscape.",
    image: "../img/blog/comparisons/lam3-vs-wet-forget-split.webp",
    imageAlt: "VertKleen LAM3 and Wet and Forget Outdoor Concentrate containers side by side",
    ctaProduct: "LAM3 vs Wet & Forget",
    ctaLabel: "Price my exterior cleaning job",
    decision: "Judge the finished area, not the concentrate price. Use the same surface, stain, weather, application method, working time, and final inspection for both products."
  },
  {
    slug: "beer-line-cleaner-cost-comparison",
    datePublished: "2026-07-09",
    dateModified: "2026-09-10",
    body: `## The expensive cleaner is the one that keeps the line down

Chemical price is a small part of a CIP cycle. Labor, water, circulation, rinsing, lost pours, and a repeat clean usually cost more than the concentrate.

Price the result that matters: a verified clean line returned to production.

At taproom opening, the rinse must be complete, couplers and faucets reassembled, and the cleaning log current. The [Brewers Association's draught-line log](https://www.brewersassociation.org/educational-publications/draught-beer-line-cleaning-log/) gives the team a visible record of its two-week cleaning cycle.

Beerstone is calcium oxalate, an inorganic deposit. If a hard gray-white layer remains after organic soil is removed, identify it before adding another dose of the same cleaner. The [Draught Beer Quality Manual](https://cdn.brewersassociation.org/wp-content/uploads/2019/03/13094643/Draught-Beer-Quality-Manual-2019.pdf) distinguishes that mineral deposit from organic buildup.

## Separate organic soil from mineral scale

Beer systems collect two different layers. Yeast, protein, fat, and organic film respond to alkaline cleaning. Beer stone, rust, and carbonate scale need mineral removal.

One chemistry rarely does both jobs efficiently.

| Buildup | VertKleen stage | Purpose |
| --- | --- | --- |
| Yeast, protein, and fat | CIP CR | Lift organic soil and carry it out of the circuit |
| Krausen and process film | CIP CR | Clear the layer covering the hard deposit |
| Beer stone and carbonate | CIP HCR | Release mineral buildup |
| Rust and mineral film | CIP HCR | Clean the remaining inorganic layer |

Run [CIP CR](/products/cr) first, rinse it out, then circulate [CIP HCR](/products/hcr). Each product reaches the soil it was designed to remove, and the crew gets a cycle that is easier to teach and repeat.

## Compare complete cycles, not container prices

Micro Matic’s published guidance uses caustic alkaline cleaner at 2–3% and also separates alkaline cleaning from acid work.

[[card:title=See Micro Matic's beer-line cleaning guidance|href=https://www.micromatic.com/en-us/seo/cleaningequip-top/cleaningchemicals-top/beer-line-cleaning-chemicals-bot|image=/img/proof/cases/brewery.webp|alt=Brewery piping and tank used for clean-in-place work|width=1200|height=900]]

VertKleen keeps the useful two-stage logic while replacing the harsh caustic and acid profile. CIP CR and CIP HCR are HMIS 0-0-0 and ship non-hazmat.

For routine use, the products add no product-specific PPE or ventilation requirement. Brewery controls for hot liquid, pressure, confined spaces, sanitation, and the equipment still apply.

## Build a cycle-cost sheet

CR lists at [[price:CRCIP-25G|hvac|per_gallon]] and HCR at [[price:HCRCIP-25G|hvac|per_gallon]] in the CIP pricing set.

Use the working dilution and actual circuit volume. Then count the entire job.

| Cost line | Record |
| --- | --- |
| Chemistry | Concentrate and mixed solution used |
| Utilities | Water, heat, and pump time |
| Labor | Setup, circulation, rinse, inspection, and cleanup |
| Production | Minutes from isolation to release |
| Quality | Repeat cycles, residue, and failed checks |

A higher concentrate price can produce a lower completed-cycle cost when it reduces repeat work, water, and downtime.

## Seven Florida breweries provide the operating proof

MASEST has CR and HCR results from seven Florida breweries. The work covered tanks, kegs, lines, heat exchangers, organic buildup, and beer stone.

The seven-site record shows the two-stage system working across real brewery equipment, giving operators a practical basis for cycle planning.

Cleaning still ends with the brewery’s established rinse, sanitation, inspection, and release process. CIP cleaning does not replace that final sanitation control.

Review [brewery proof](/proof#brewery-cip-trials), [CIP product documents](/resources), and [food-and-beverage pricing](/pricing-cip-food-beverage).

[Request brewery-cycle pricing](/contact?type=quote&industry=Food%20%26%20Beverage&product=beer%20line%20cleaner%20cost%20comparison) with your circuit volume and current cycle.`,
    title: "Beer line cleaner cost comparison",
    seoTitle: "Brewery CIP: Full-Cycle Cost Guide",
    description: "Compare a complete VertKleen CR and HCR brewery CIP cycle with beer-line cleaner pricing, labor, water, rinsing, and downtime.",
    eyebrow: "Brewery CIP comparison",
    h1: "Clean brewery organics first. Remove beer stone second.",
    subhead: "CR lifts yeast, protein, fat, and film. HCR removes beer stone, scale, and rust. Compare the full cleaning cycle, not one gallon.",
    product: "VertKleen CR + HCR",
    productHref: "../pricing-cip-food-beverage",
    competitor: "Micro Matic beer-line cleaner",
    vkPrices: [
      { label: "CR", vsku: "CRCIP-25G", tier: "retail", gallons: 2.5 },
      { label: "HCR", vsku: "HCRCIP-25G", tier: "retail", gallons: 2.5 },
    ],
    marketMath: "$38.85/gal",
    priceNote: "Compare product used with cycle time, rinses, labor, water, wastewater, downtime, and return-to-production.",
    swapCurrent: "Caustic soda + brewing acid blends",
    swapJob: "Beer line, tank, mash tank, and heat-exchanger CIP/SIP",
    swapUse: "VertKleen CR for alkaline wash followed by VertKleen HCR for acid wash.",
    proofTitle: "See the two-step brewery result",
    proof: "Brewlando Brewing field and lab results show CR and HCR replacing the caustic and acid steps in brewery CIP.",
    image: "../img/blog/comparisons/beer-line-cleaner-cost-comparison-split.webp",
    imageAlt: "VertKleen CIP CR and CIP HCR beside Micro Matic Alkaline Beer Line Cleaner",
    ctaProduct: "beer line cleaner cost comparison",
    ctaLabel: "Price my brewery cycle",
    decision: "Organic film and mineral beer stone need different cleaning steps. Compare the complete VertKleen cycle with your current process on the same circuit, temperature, buildup, rinse, and finish target."
  }
];

const IMAGE_DIMENSIONS = {
  "../img/blog/comparisons/vertkleen-hcr-vs-clr-split.webp": [1448, 1086],
  "../img/blog/comparisons/hcr-vs-rydlyme-split.webp": [1448, 1086],
  "../img/comparisons/cr-hd-vs-simple-green-split.webp": [1086, 1448],
  "../img/blog/comparisons/lam3-vs-wet-forget-split.webp": [1448, 1086],
  "../img/blog/comparisons/beer-line-cleaner-cost-comparison-split.webp": [1448, 1086],
};

const ORG = organizationJsonLd();

/* These five pages are canonical for their topic as of 2026-09-10 (see the `pages` header),
 * so the structured data has to carry the weight the retired /blog/ twins used to. Those
 * emitted BlogPosting + Organization; emitting only WebPage here would have made the page
 * canonical and its schema poorer at the same time.
 *
 * Article, not BlogPosting: these are product comparisons on a comparisons route, not blog
 * posts, and Article is the honest parent type.
 *
 * `author` is the Organization, deliberately. build-blog.mjs treats a group byline as the
 * Organization rather than publishing a company as a schema.org/Person, and the originating
 * posts are all bylined "MASEST Team". Naming a person here would be inventing authorship.
 * To byline these to a real person, add that Person entity the way AUTHORS does in
 * build-blog.mjs -- but only once someone confirms they wrote them.
 *
 * The breadcrumb is two levels because there is no comparisons index page. It previously
 * had three, with positions 2 and 3 pointing at the same leaf URL, which is a malformed
 * trail Google is entitled to ignore. If a /comparisons index is ever built, restore the
 * middle rung pointing at it.
 */
function schema(page) {
  const url = `${BASE}/comparisons/${page.slug}`;
  const graph = [
    {
      "@type": "WebPage",
      name: page.seoTitle,
      url,
      description: page.description
    },
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${BASE}/` },
        { "@type": "ListItem", position: 2, name: page.title, item: url }
      ]
    }
  ];

  // Only a page with a body is an Article. A 340-word spec sheet is a WebPage and saying
  // otherwise would be the same overclaim the schema is meant to fix.
  if (page.body) {
    graph.push({
      "@type": "Article",
      headline: page.seoTitle,
      description: page.description,
      url,
      mainEntityOfPage: url,
      image: `${BASE}${page.image.replace(/^\.\./, "")}`,
      author: ORG,
      publisher: ORG,
      datePublished: page.datePublished,
      dateModified: page.dateModified,
      about: [page.product, page.competitor],
      wordCount: page.body.replace(/\[\[[^\]]*\]\]/g, " ").split(/\s+/).filter(Boolean).length
    });
  }

  return { "@context": "https://schema.org", "@graph": graph };
}

function priceBinding({ vsku, tier }, field) {
  return `<span data-price-vsku="${html(vsku)}" data-price-tier="${html(tier)}" data-price-field="${field}"></span>`;
}

function vertKleenMath(page) {
  return page.vkPrices.map((price) => {
    const prefix = price.label ? `${html(price.label)}: ` : "";
    return `${prefix}${priceBinding(price, "unit")} / ${html(price.gallons)} gal = ${priceBinding(price, "per_gallon")}`;
  }).join("; ");
}

function pageHtml(page) {
  const [imageWidth, imageHeight] = IMAGE_DIMENSIONS[page.image] || [1200, 900];
  const quoteHref = `../contact?type=quote&product=${encodeURIComponent(page.ctaProduct)}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${html(page.seoTitle)} | MASEST VertKleen</title>
<meta name="description" content="${html(page.description)}">
<meta name="theme-color" content="#fafbfc">
<link rel="icon" type="image/png" href="../img/favicon-enhanced.png?v=20260617c">
<link rel="stylesheet" href="../vendor/phosphor/style.css">
<link rel="stylesheet" href="../css/style.css?v=${STYLE_VERSION}">
<link rel="stylesheet" href="../css/navigation.css?v=${NAVIGATION_VERSION}">
<link rel="stylesheet" href="../css/components.css?v=${COMPONENT_VERSION}">${page.body ? `
<link rel="stylesheet" href="../css/blog.css?v=${BLOG_VERSION}">` : ""}
<meta property="og:title" content="${html(page.seoTitle)} | MASEST VertKleen">
<meta property="og:description" content="${html(page.description)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="MASEST VertKleen">
<script type="application/ld+json">${JSON.stringify(schema(page))}</script>
<!-- seo:auto -->
<link rel="canonical" href="${BASE}/comparisons/${page.slug}">
<meta property="og:url" content="${BASE}/comparisons/${page.slug}">
<meta property="og:image" content="${BASE}/img/og-card.png">
<meta name="twitter:card" content="summary_large_image">
<!-- /seo:auto -->
</head>
<body class="site-soft-bg comparison-page">
<!-- Reserves the nav's 59px height. chrome.js injects the nav, so without this the
     page paints once without it and again 59px lower: 0.041 CLS, attributed to
     MAIN#main, on every page that lacked it. Height lives in css/style.css. -->
<div id="nav-reserve" aria-hidden="true"></div>
<noscript><style>#nav-reserve{display:none}</style></noscript>
<a class="skip-link" href="#main">Skip to content</a>
<noscript>
<nav class="nojs-nav" aria-label="Site">
  <a href="../"><b>MASEST</b></a>
  <a href="../products">Products</a>
  <a href="../services">Services</a>
  <span>Applications</span>
  <a href="../industries">Industries</a>
  <a href="../proof">Results</a>
  <a href="../resources">SDS &amp; Resources</a>
</nav>
</noscript>

<main id="main">
  <section class="hero product-detail-hero">
    <div class="wrap hero-grid">
      <div class="hero-copy reveal">
        <span class="eyebrow">${html(page.eyebrow)}</span>
        <h1 class="display">${html(page.h1)}</h1>
        <p class="subhead">${html(page.subhead)}</p>
        <div class="hero-actions">
          <a class="btn btn-primary" href="${quoteHref}">${html(page.ctaLabel)}</a>
          <a class="btn btn-secondary" href="${page.productHref}">View ${html(page.product)}</a>
        </div>
      </div>
      <figure class="product-hero-media reveal">
        <img src="${page.image}" alt="${html(page.imageAlt)}" width="${imageWidth}" height="${imageHeight}" fetchpriority="high" decoding="async">
      </figure>
    </div>
  </section>

  <section class="section section-slim">
    <div class="wrap product-static-grid">
      <article class="product-static-panel">
        <h2>${html(page.product)} vs ${html(page.competitor)}</h2>
        <div class="table-scroll">
          <table class="cmp-table">
            <thead><tr><th scope="col">Product</th><th scope="col">Package price</th><th scope="col">Per gallon</th></tr></thead>
            <tbody>
              <tr><td class="job">${html(page.product)}</td><td>${vertKleenMath(page)}</td><td><strong>${priceBinding(page.vkPrices[0], "per_gallon")}</strong></td></tr>
              <tr><td class="job">${html(page.competitor)}</td><td>${html(page.marketMath)}</td><td><strong>${html(page.marketMath.match(/\$[0-9.,]+(?:-\$[0-9.,]+)?\/gal/)?.[0] || page.marketMath)}</strong></td></tr>
            </tbody>
          </table>
        </div>
        <p class="product-data-note">${html(page.priceNote)}</p>
      </article>

      <article class="product-static-panel">
        <h2>${html(page.proofTitle)}</h2>
        <p>${html(page.proof)}</p>
        <a class="btn btn-ink" href="${page.proofHref || "../proof"}">${html(page.proofCta || "See customer results")}</a>
      </article>
    </div>
  </section>
${page.body ? `
  <section class="section section-slim">
    <div class="wrap comparison-body">
      <div class="blog-body">
${renderMarkdown(page.body)}
      </div>
    </div>
  </section>
` : ""}
  <section class="section section-slim">
    <div class="wrap">
      <div class="section-head">
        <h2 class="headline">Which product fits this job?</h2>
      </div>
      <div class="table-scroll">
        <table class="cmp-table comparison-swap-table">
          <thead><tr><th scope="col">Replace</th><th scope="col">For</th><th scope="col">Use</th></tr></thead>
          <tbody>
            <tr><td class="job">${html(page.swapCurrent)}</td><td>${html(page.swapJob)}</td><td><strong>${html(page.swapUse)}</strong></td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>

  <section class="section section-slim">
    <div class="wrap">
      <div class="section-head">
        <span class="eyebrow">Try them side by side</span>
        <h2 class="headline">Let one real cleaning job decide.</h2>
        <p class="subhead">${html(page.decision)}</p>
      </div>
      <div class="product-static-grid">
        <article class="product-static-panel">
          <h3>Keep the comparison fair</h3>
          <ol class="comparison-trial-list">
            <li><b>Take a before photo.</b> Note the surface, mess, cleaner, mix, tools, time, water, and downtime you use today.</li>
            <li><b>Agree on a good result.</b> Decide what clean looks like before either product touches the surface.</li>
            <li><b>Clean equal areas.</b> Give both products the same crew, tools, area, working time, and final check.</li>
            <li><b>Count the whole job.</b> Compare product, labor, water, repeat passes, downtime, and the finished result.</li>
          </ol>
        </article>
        <article class="product-static-panel">
          <h3>Before you start</h3>
          <p>Read the latest label and SDS for both cleaners. Try a small, hidden area first.</p>
          <p>Follow your workplace rules for PPE, ventilation, storage, surface care, and rinse water. Need help? MASEST can plan the first test with you.</p>
          <a class="btn btn-secondary" href="../resources">Get labels, SDS, and guides</a>
        </article>
      </div>
    </div>
  </section>

  <div class="cms-page-sections" data-cms-content="page_sections" data-cms-page="comparisons/${page.slug}" data-cms-region="body"></div>

  <section class="block-dark">
    <div class="wrap">
      <div class="section-head center">
        <h2 class="headline">See what the whole job really costs.</h2>
        <p class="subhead">Send what you use now, how long the job takes, and what clean needs to look like. We will help you build a fair comparison.</p>
        <a class="btn btn-light" href="${quoteHref}">${html(page.ctaLabel)}</a>
      </div>
    </div>
  </section>
</main>

<script type="module" src="../js/main.js?v=${MAIN_VERSION}"></script>
<script src="../js/track.js" defer></script>
</body>
</html>
`;
}

mkdirSync(OUT, { recursive: true });
for (const page of pages) {
  writeFileSync(resolve(OUT, `${page.slug}.html`), pageHtml(page), "utf8");
  console.log(`wrote comparisons/${page.slug}.html`);
}
console.log(`OK ${pages.length} comparison pages -> ${OUT}`);
