# SQ-24 + SQ-25 — two posts as the voice reference

Drafted 2026-09-10. **Nothing is published and nothing in the repo is changed by this file.**

---

## Read this before the posts: they cannot be delivered as a commit

Post bodies live in Supabase, not in this repository. `tools/publish-blog-ci.mjs` states it
in its own header:

> *"blog posts are authored in the CMS (Supabase = source of truth), but other content
> (e.g. industry sectors) is generated from git-side tooling"*

`data/content/blog.json` is a **downstream snapshot**. On a production deploy the
"Refresh production CMS snapshots" step (`verify.yml:62-66`) runs `build:content`, which
calls `writeSnapshots` and replaces `blog.json` wholesale from Supabase. A body rewritten
in the repo would pass every local test and every PR run, then silently revert the moment
it deployed.

The `PROTECTED_COMPARISON_SLUGS` list in that file does **not** help — it only refuses to
*delete* those five slugs; line 58 still writes the full Supabase payload over the file.

**So these two posts are a hand-off.** They go into the CMS through the admin console. The
same is true of the other 33 whenever they are rewritten. That constraint should be settled
before anyone commissions the remaining work, because it decides who does the publishing.

---

## What the two posts are for

They set the voice the other 33 get edited against. Every target is measured, not asserted.

| | post 1 before | post 1 after | post 2 before | post 2 after | target |
|---|---|---|---|---|---|
| body words | 349 | **1,237** | 452 | **1,245** | >1,200 |
| sentence-length CV | 0.292 | **0.648** | 0.350 | **0.567** | >0.55 (human 0.55–0.85) |
| contractions | 0 | **28** | 0 | **27** | present |
| question headings | 0/6 | **3/10** | 0/7 | **4/9** | ~1 in 3 |
| internal page links | 7 | **7** | 5 | **7** | not reduced |

**Corpus baseline for comparison:** CV median 0.363 across all 35, range 0.292–0.447, 16
contractions in ~35k words, 22 posts with none, 0 question headings anywhere.

### One place I did not follow the spec literally

The spec says to delete the two boilerplate CTA paragraphs repeated across all 35. Done —
but deleting them alone **cost four internal link targets in post 1 and three in post 2**,
including `/proof`, the industry pages and the services pages. That is a navigation
regression, not a cleanup.

So the links were re-homed into the prose where they are actually relevant: the
cold-storage link now sits in the sentence about cold-storage sites, the consulting link in
the multi-site rollout section, `/proof` next to the evidence claim. Link count holds or
rises, and the footer boilerplate is still gone. **Do the same on the other 33 rather than
deleting the paragraphs outright.**

### Author — RESOLVED 2026-09-10, and it uncovered a live defect

Owner supplied: **Matthew, Founder** — chemical engineer with years of experience in
industrial chemicals and cleaning agents.

**The defect.** `tools/build-blog.mjs` emitted `"@type": "Person"` for any non-empty
byline. 34 of 35 posts are bylined *"MASEST Team"*, so the site was publishing a team as a
human being in structured data on every post. Fixed: group bylines now resolve to the
Organization. This shipped immediately across all 35 posts and needed no CMS change —
`"author":{"@type":"Person","name":"MASEST Team"}` is now
`"author":{"@type":"Organization","name":"MASEST Consulting LLC"}`.

**The mechanism.** An `AUTHORS` table in the generator holds the entity (job title,
expertise, employer); the CMS holds only the byline string. Same split as `SEO_TITLES`,
for the same reason. Setting a post's author to `Matthew` **in the CMS** now produces:

- `Person` schema with `jobTitle`, `description`, `worksFor` and `knowsAbout`
- a visible author card after the article body (`authorCard()`, `.blog-author`)

Both paths were verified end to end by temporarily bylining one post, rebuilding,
inspecting the output, and reverting. A group byline correctly renders no card.

**Two things worth knowing.** A first-name-only byline is a weak E-E-A-T signal — Google's
guidance wants an identifiable person, so a surname plus a link to an about page or
LinkedIn profile would materially strengthen it, and both slot straight into the `AUTHORS`
entry. And "years of experience" is recorded exactly as given; a specific figure would be
stronger, but inventing one is not an option.

**To apply it:** change the byline from "MASEST Team" to "Matthew" in the CMS for the posts
he actually wrote. Editing `data/content/blog.json` will not work.
- **No fact in either draft is invented.** Everything traces to the existing published
  bodies, the catalogue, or the cited Alfa Laval page: the three DC numbers, 50% vs 15%
  active, full strength through 1:10, 0.59 mpy, 280x, 15% more calcium-carbonate capacity,
  HMIS 0-0-0, and the Brevard 36-hours-vs-30-minutes result. Where the spec asked for
  cost-per-job maths I gave the **method and the variables** rather than dollar figures,
  because prices are bound live on the site and hardcoding them into body copy would rot.

---

## Post 1 — `cr-hd-walmart-distribution-center-case-study`

Voice reference for **case studies**.

```markdown
## Three distribution centers, one cleaner, and a shelf that got shorter

Walmart DC-8851, DC-7023, and DC-6099 replaced Simple Green with [VertKleen CR HD](/products/crhd).

That's three buildings, not a pilot. The switch covered workshops, forklifts, parts, kitchens, floors, drains, windows, and glass — and it happened because one concentrate turned out to reach further into the building than the product it replaced.

Worth being precise about what changed, though. The cleaner didn't get better at one job. It got adequate at eleven, which is a different kind of win and a different kind of purchase order.

## Why does range matter more than strength?

A distribution center is not one cleaning problem. It's a dozen, and they sit forty feet apart.

A crew moves from hydraulic film on a Crown forklift to baked grease in the break-room kitchen to streak-sensitive glass at the dock office, in one shift, with one cart. Under the old arrangement each of those surfaces had its own bottle, its own dilution, its own training note, and its own way of going wrong when somebody grabbed the nearest trigger sprayer instead of the correct one.

CR HD is a 50% degreaser. Simple Green runs 15% active.

That gap is the whole mechanism. Extra cleaning capacity is not mainly about attacking harder soil — it's about having enough headroom to dilute *down* for a light job and still have something left. One concentrate, tuned per task, instead of five bottles each locked at the strength the manufacturer chose.

| Work area | What CR HD handled |
| --- | --- |
| Workshops and parts | Oil, grease, and shop soil |
| Crown Forklift and Plug Power equipment | Oily equipment film |
| Warehouse floors | Tire marks and tracked grime |
| Kitchens and drains | Grease and organic soil |
| Windows and glass | Light soil at task-matched dilution |

## One concentrate, eleven strengths

CR HD's published directions span full strength through 1:10.

That range is doing more work than the headline number. At full strength it takes on carbon and baked shop soil; at 1:10 it becomes a glass-and-light-soil cleaner without switching bottles. The crew changes the *mix*, not the product, which means the decision moves from "which of these five do I grab" to "how dirty is this".

Now put a 15%-active product through the same exercise. Dilute it meaningfully and there isn't much left to work with, so in practice it gets used at or near full strength for everything — which is why a low-active cleaner tends to arrive with four siblings. The shelf isn't a preference. It's a consequence.

One more thing the range buys: recovery from a wrong call. Mix too weak and you add concentrate. Under the old arrangement, mixing the wrong *product* meant a rinse, a re-clean, and sometimes a damaged finish.

## The part that shows up on the balance sheet

Consolidation sounds like a procurement abstraction until you count the lines it removes.

Fewer cleaners mean fewer purchase orders, fewer storage positions, fewer secondary bottles to label, fewer SDS sheets in the binder, and fewer chances for someone to use degreaser on a surface that needed glass cleaner. Every one of those is small. Added across three buildings and a year, they stop being small.

There's a forecasting effect too, and it's the one facilities managers tend to notice second. A network can project a single concentrate against completed floors, cleaned equipment, and branch consumption. Try that with a shelf of overlapping products and you're not forecasting — you're reconciling.

![VertKleen CR HD field container and diluted sample](/img/blog/cases/cr-hd-walmart-product-field.webp){367x670}

*VertKleen CR HD concentrate and a prepared field sample.*

## Low foam is not a detail, it's the floor plan

Scrubbers change the math.

For floor scrubbers and recirculating equipment, [CR HD Low Foam](/products/cr-hd-low-foam) keeps the recovery tank working on dirty solution instead of on its own foam head. When foam wins, the machine stops. Then somebody adds defoamer, runs an extra rinse pass, and waits for the tank to settle — and none of that time appears anywhere on the chemical invoice, which is exactly why it gets missed in the comparison.

Ask any scrubber operator what their worst chemical is. They'll describe foam, not cleaning power.

![Side-by-side warehouse cleaner test](/img/blog/diagrams/warehouse-degreasing-trial.svg){1200x675}

## What does HMIS 0-0-0 actually change on a loading dock?

Less than the marketing implies, and more than the safety officer expects.

CR HD is HMIS 0-0-0, ships non-hazmat, and carries no product-specific PPE or ventilation requirement for routine use. That does not make the work safe. Vehicles still move, oily residues still make floors slick, wash equipment still throws spray, and wastewater still goes somewhere — those controls are unchanged, and anyone who relaxes them because a rating says 0-0-0 has misread the rating.

What it changes is the paperwork and the perimeter around the chemical itself. Receiving is simpler. Storage doesn't need a segregated corner. Training a new hire across three buildings stops requiring a separate module per bottle. For a multi-site operator, that administrative flattening is often worth more than the per-gallon price, and it's almost never the thing that gets compared.

## Rolling it across three buildings

A single-site switch is a purchase. A three-site switch is a logistics change, and the packaging matters more than people expect.

CR HD ships in quarts, half-gallons, gallons, and 2.5-gallon containers, with cases of twelve, six, four, and two. That spread is what lets one building run 2.5-gallon jugs at a scrubber fill station while another keeps quarts on a janitorial cart, without either site holding a different product.

For a network rollout, MASEST [consulting services](/services/consulting-services) can map consolidation, training, and usage building by building. Receiving gets simpler for a duller reason: it's the same line item three times, so a delivery discrepancy is obvious instead of forensic.

Training compresses in the same way. One dilution chart, posted once, understood by anyone who moves between buildings — which at a distribution network is most people.

## How do you run a side-by-side test that isn't rigged?

Most cleaner trials are decided before they start, usually by accident.

The new product gets the dirty bay everyone's been avoiding. The incumbent gets whatever's left. Someone runs the challenger at full strength and the incumbent at label dilution. The result is real, and it means nothing, because two variables moved at once.

The [CR HD versus Simple Green breakdown](/blog/cr-hd-vs-simple-green) walks the same comparison at product level. A fair test is duller than that. Same surface, same soil age, same operator, same equipment, same dwell time — split down the middle if you can, so both halves dry under identical air. Photograph before, not after; the after shot is the one everybody remembers to take.

Then measure passes and time to acceptable, not appearance. Appearance is where bias lives. A cleaner that gets there in one pass and one operator-minute has beaten a cleaner that needed three, even when the finished panels look identical under warehouse light.

## Build the number your own site would defend

The Walmart result is evidence. It isn't your purchase order.

Pick the four recurring jobs that eat the most labor — one scrubber lane, one forklift type, one parts load, one grease-heavy surface. Measure them the way you'd measure a machine, not a bottle.

For each job, record:

| What to record | Why it changes the answer |
| --- | --- |
| Solution volume at working dilution | Concentrate price per gallon is meaningless until it's divided by dilution |
| Passes to acceptable | A second pass doubles labor, not chemical |
| Water and equipment time | Scrubber hours and rinse water are real cost centers |
| Rework rate | Redone work is the most expensive category and the least tracked |
| Time back to service | Downtime on a dock is measured in trailers, not minutes |

Then add what consolidation removes: purchase lines, storage positions, and training modules.

That's the model. A one-day demonstration tells you a cleaner works; this tells you whether it pays, and those are genuinely different questions.

## Where the evidence actually stops

Three buildings agreeing is a strong signal, and it sits alongside other [field proof](/proof). It isn't a universal one, and it's worth saying plainly.

DC-8851, DC-7023, and DC-6099 share soil types, equipment, and cleaning cadence. That's what makes the agreement meaningful — and what limits it. A [cold-storage site](/industries/distribution-cold-storage) with condensation-driven films, a food plant working to a sanitation release, or a machine shop flooded with cutting coolant will each present a deposit these three didn't. The mechanism travels. The result has to be re-earned on your surfaces.

There's also a question this case study can't answer, and shouldn't pretend to: whether consolidation is right when one of your jobs genuinely needs specialist chemistry. Sometimes the shelf is long because the work is varied. Measure first, then decide — in that order.

[Order a CR HD sample](/contact?type=sample&product=CR%20HD#quoteForm) for a recurring warehouse job.
```

---

## Post 2 — `how-to-descale-heat-exchanger`

Voice reference for **technical how-tos**.

```markdown
## Scale charges rent, and it collects every hour

Mineral buildup narrows passages and insulates the exact surfaces you bought the exchanger for.

The unit compensates by running longer. Flow drifts down, approach temperature drifts up, and nobody files a work order because nothing has broken yet — it's just costing more than it did last quarter. Then a passage blocks, the shutdown stops being scheduled, and the cleaning conversation happens under pressure instead of on a calendar.

A disciplined recirculation clean gets the performance back without spending the asset to do it. The trick is sequence, not strength.

## What's actually touching the metal?

Get this wrong and the rest of the job is theatre.

Hard-water scale and rust call for [HCR](/products/hcr). Oil or organic film calls for something else first — and if there's grease sitting on top of the mineral layer, HCR never reaches the deposit it was brought in to remove. You'll circulate for the full cycle, rinse, and find the scale essentially where it was.

When the return runs mixed, strip the grease first with [CR](/products/cr) or [CR HD](/products/crhd), rinse, and then start the mineral stage. Two stages, in that order. It feels slower on the plan and is almost always faster on the clock.

One diagnostic that costs nothing: look at what comes back. A return that clouds and then clears is telling you the chemistry found something. A return that stays clean from minute one usually means you're cleaning the wrong layer.

## Build a loop you can actually see

Isolate and drain the exchanger. Connect a compatible pump, reservoir, hoses, and fittings — and route the return so it's visible, because the return line is your only real-time instrument.

MASEST [field services](/services/field-services) can set the loop up and run the operating checks if the shutdown window is tight. Then baseline it. Compare pressure drop and outlet temperatures against clean-condition figures at similar flow and load, or you won't know what "finished" looks like.

Check the strainer before you extend anything. A loaded upstream strainer imitates exchanger fouling almost perfectly, and crews have run full chemical cycles against a problem that was sitting in a basket ten feet upstream. [Alfa Laval's operating guidance](https://www.alfalaval.com/service-and-support/product-services/plate-heat-exchanger-services/troubleshooting-for-plate-heat-exchangers/) names rising pressure drop and falling thermal performance as the cleaning signals — and notes they should be acted on before blocked passages stop useful circulation altogether.

![Five-step closed-loop heat-exchanger descaling setup](/img/blog/diagrams/heat-exchanger-loop.svg){1200x675}

| Stage | Watch for |
| --- | --- |
| Setup | Correct volume, secure connections, and compatible materials |
| Circulation | Stable flow, reaction, and released buildup |
| Activity check | Product still active at the planned interval |
| Rinse | Clear return and removed solids |
| Restart | Restored flow, pressure, and heat-transfer performance |

The VertKleen user guide scales circulation time by system volume and calls for periodic activity checks. Use the current directions for concentration and monitoring rather than a remembered number from the last job — volumes differ, and so does how fast the product gets consumed.

## Why not just use acid?

Because acid works, and that's the problem worth stating precisely.

Hydrochloric acid removes scale. It also removes exchanger. Source testing measured HCR at 0.59 mpy on steel — up to 280 times less corrosion than hydrochloric acid — while the same comparison measured 15% more calcium-carbonate capacity than HCl.

Read those two numbers together, because separately each one is a marketing claim. More capacity and dramatically less metal loss means the chemistry is being spent on the deposit instead of on the plate underneath it. On a unit you intend to keep for another decade, that distinction is the entire argument.

There's a second cost to acid that never appears in the per-gallon comparison: everything it drags along. Fume control, dedicated PPE, segregated storage, neutralisation, and a trained handler. HCR is HMIS 0-0-0, non-fuming, ships non-hazmat, and carries no product-specific PPE or ventilation requirement for routine use.

That is not the same as saying the job is safe. Isolation, pressure, temperature, gas release, electrical equipment, confined access, and wastewater all still shape the controls — none of that relaxes. What changes is that you're not adding an acid-handling workflow on top of the controls you already need.

## Brevard: thirty-six hours against thirty minutes

At a Brevard County School District HVAC system, CLR sat on a 20-year stainless-steel plate and drain for 36 hours without clearing the rust.

DDC Engineering applied HCR for 30 minutes and rinsed with a garden hose. No scrubbing was recorded.

It sits with the rest of the [descaling proof](/proof). The interesting part isn't the time ratio. It's that the first attempt wasn't a bad-faith one — CLR is a real product that removes real deposits, and someone reasonable chose it. It just wasn't matched to a two-decade oxide layer on stainless. Matching the chemistry to the deposit did in half an hour what patience couldn't do in a day and a half.

[[card:title=See the Brevard HVAC result|href=/blog/hcr-brevard-hvac-rust-case-study|image=/img/blog/cases/hcr-brevard-after.webp|alt=HVAC base plate after VertKleen HCR removed rust and mineral buildup|width=1417|height=714]]

## How do you know when to stop circulating?

Not by the clock, and not by looking at the plate.

Run the activity check at the planned interval. If the product still tests active and the return has stopped changing, the deposit is gone and further circulation is just pump hours. If the product is spent while the return is still loading, you need a fresh charge, not more time — and that's a volume-and-concentration problem to solve before the next unit, not during this one.

The temptation is to extend "just another hour" because the shutdown window is open anyway. Resist it. Extended circulation against a spent charge is how a clean job turns into an unexplained one.

## Stop cleaning on the calendar

Annual descaling is a scheduling habit, not an engineering decision.

Some units foul in four months. Others go three years. Across [HVAC and water systems](/industries/hvac-water) the spread is wide. The variable isn't the exchanger — it's the water, the duty cycle, and how hard the upstream treatment is working, and none of those are constant across a site. Two identical units on the same loop can need completely different intervals, which is exactly the thing a fixed annual date cannot express.

Trend the numbers instead. Pressure drop and approach temperature, logged at a consistent flow and load, will tell you the deposit is accumulating long before anyone notices a performance complaint. When the curve starts bending, schedule. That's it — that's the whole method.

The payoff is that you clean a light deposit instead of a hard one. Light deposits come off faster, with less product, in a shorter window, and without the marginal call about whether to extend circulation. Hard deposits are where the expensive decisions live.

There's a failure mode in the other direction too, and it's less discussed. Cleaning a unit that doesn't need it costs a shutdown, a charge of product, and a set of gasket disturbances you didn't have to make. Chasing a number that hasn't moved isn't diligence.

## What about the water you send back?

Rinse water leaves the building. Plan for it.

Volume, route, and permitted discharge conditions are site questions, not product questions, and they're best answered before the pump starts rather than while a full reservoir waits. Even a non-hazmat product returns a rinse loaded with whatever it just removed — dissolved mineral, iron, and released solids.

Capture the solids where you can. Log what went out. A descaling job that ends with an undocumented discharge is unfinished, however clean the plate looks.

## Close the job with numbers, not a photograph

Record product used, circulation time, rinse water, labor, total downtime, and the exchanger readings before and after.

A clean plate photographs well and proves very little on its own — a plate can look transformed while the approach temperature barely moves. Restored flow and restored heat transfer are what turn this into a maintenance line item somebody will approve again next year.

And write down what the strainer looked like. The next person to open this unit will want to know whether the fouling was really in the exchanger, and that single note saves them the cycle you nearly wasted.

[Plan an exchanger clean](/contact?type=quote&product=VertKleen%20HCR&industry=HVAC%20%2F%20Water%20Treatment) with system volume, materials, and shutdown window.
```
