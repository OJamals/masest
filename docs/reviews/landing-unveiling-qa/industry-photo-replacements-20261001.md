# Homepage photo replacements

Real stock photographs represent Marine, Industrial cleaning, Water treatment, CIP & brewing, Auto & fleet, and Hotels & property. The grease job keeps its existing baked-on grease photograph; the industry card uses a separate commercial-kitchen scene. Clean, wax & shine retains the owner's red SUV photograph; fleet uses trucks. Wash & odor control uses a generated representative dirty hallway. All 16 job and industry cards use distinct images. These tiles show application context, not documented VertKleen results or customer endorsements.

Sources and the [Pexels license](https://www.pexels.com/license/) verified October 1, 2026. Commercial website use is permitted; attribution is optional. No generated edits.

| Asset | Photographer | Source | Delivery |
| --- | --- | --- | --- |
| `img/home/industry-marine-yacht-20261001.webp` | Mehmet Mert Mutlu | [White Motor Yacht Sailing in a Blue Sea](https://www.pexels.com/photo/white-motor-yacht-sailing-in-a-blue-sea-17630892/) | Pexels CDN WebP, 800 × 500, focal point x=0.5/y=0.65 |
| `img/home/industry-industrial-wash-20261001.webp` | Bulat843 | [Industrial Cleaning Worker with Power Washer](https://www.pexels.com/photo/industrial-cleaning-worker-with-power-washer-30589158/) | Pexels CDN WebP, 800 × 500, focal point x=0.5/y=0.60 |
| `img/home/industry-water-clarifiers-20261001.webp` | Giant Asparagus | [Aerial View of Modern Water Treatment Facility](https://www.pexels.com/photo/aerial-view-of-modern-water-treatment-facility-35425759/) | Pexels CDN WebP, 800 × 500, center crop |
| `img/home/industry-commercial-kitchen-20261001.webp` | Bruno Makori | [Commercial Kitchen with Stainless Steel Equipment](https://www.pexels.com/photo/commercial-kitchen-with-stainless-steel-equipment-28704740/) | Pexels CDN WebP, 800 × 500, center crop |
| `img/home/industry-brewing-tanks-20261001.webp` | Mark Stebnicki | [Steel Tanks in Brewery](https://www.pexels.com/photo/steel-tanks-in-brewery-17765433/) | Pexels CDN WebP, 800 × 500, center crop |
| `img/home/industry-fleet-trucks-20261001.webp` | K | [Trucks Parked](https://www.pexels.com/photo/trucks-parked-4320464/) | Pexels CDN WebP, 800 × 500, center crop |
| `img/home/industry-hotel-lobby-20261001.webp` | Katie Cerami | [Interior Design of a Hotel Lobby](https://www.pexels.com/photo/interior-design-of-a-hotel-lobby-12284844/) | Pexels CDN WebP, 800 × 500, center crop |

Files retain explicit dimensions, descriptive alt text, lazy loading, and asynchronous decoding. New dated filenames avoid stale immutable cache objects. Register metadata in `data/content/site-images.json`; upload binaries to `masest-site-images/site/img/home/` before deployment.

The wash-bay stock photograph remains available in the image library; it is no longer used in the homepage tiles.

The existing job-finder water-pipeline photo remains in use with its visible Commons credit. The job-finder marina photo has been replaced by the car, so its courtesy credit was removed.

## Gateway destinations

Photo and heading share one anchor. Jobs open matching product pages or catalog categories. Industry gateways open HVAC / Water Treatment, Marine, Restaurants & Commercial Kitchens, Municipalities & Water Utilities, Breweries / Distilleries / Wineries, Fleet / Trucking / Car Washes, and Hotels / Property Management pages. Gyms & fitness opens the existing commercial-gym cleaning guide because no dedicated gym industry page exists. Product links below each card remain direct product routes.

The homepage regression test checks all 16 gateway labels and destinations and rejects duplicate photograph bytes across both grids.

Wash & odor control opens MultiWash directly; Purgo remains a direct link underneath. The former exterior catalog filter excludes both hallway products and has been removed from this gateway.

## Representative dirty hallway

- Final asset: `img/home/job-dirty-hallway-illustration-20261001.webp`, 800 × 500, 56,794 bytes.
- Generated with the built-in Image Generation tool. Output: `/Users/omar/.codex/generated_images/01a0f5be-c207-76b1-a08c-f6d2594641e8/exec-224907e4-5f25-42f9-ad11-7c4e27c227c5.png`. WebP encoding and delivery-size reduction preserve the generated composition.
- Both alt text and visible credit identify it as a representative illustration. It depicts no real customer site or cleaning result.
- Prompt: Create one photorealistic representative application image for an industrial cleaning website card. Landscape 8:5 composition, natural documentary lighting. Show a recognizable intact commercial hallway with doors along both sides and a long tiled floor receding into perspective. Floor visibly dirty with muddy shoe tracks, dark scuff marks, dusty grime and a few small litter pieces near edges. Ordinary neglected facility needing routine floor washing and odor control, not an abandoned ruin: walls, ceiling, lights, and doors structurally intact, no broken windows, demolition rubble, graffiti, horror atmosphere, or major damage. No people, no products, no logos, no lettering, no before/after or result claim. Neutral pale gray walls, brown dirt contrasts clearly on light gray tiled floor. Eye-level view slightly angled downward, floor occupies lower two thirds, hallway perspective visible even when displayed in a small wide website tile. Professional realistic photographic aesthetic. Entire frame filled by scene; no borders.
