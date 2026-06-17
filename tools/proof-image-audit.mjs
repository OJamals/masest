import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const proof = readFileSync(join(root, "proof.html"), "utf8");

const requiredCards = [
  {
    title: "20-year rust and scale, cleared in 30 minutes",
    images: ["img/proof/cases/ddc-rust.webp"],
  },
  {
    title: "Full CR + HCR CIP at seven Florida breweries",
    images: ["img/proof/cases/brewery.webp"],
  },
  {
    title: "Simple Green replaced across Walmart DCs",
    images: ["img/proof/walmart-dc-proof-enhanced.webp"],
  },
  {
    title: "43-foot Yellowfin washed and waxed dockside",
    images: ["img/proof/cases/marine.webp"],
  },
  {
    title: "Occupied campus cleaned by drone at UF Shands",
    images: ["img/proof/cases/drone-before.webp", "img/proof/cases/drone-after.webp"],
  },
  {
    title: "Restaurant hood filters and floors degreased",
    images: ["img/proof/cases/hood-before.webp", "img/proof/cases/hood-after.webp"],
  },
  {
    title: "Fire-pump solenoid and cavity descaled",
    images: ["img/proof/cases/fire-pump.webp"],
  },
  {
    title: "AC coil cleaned, lower monthly bill",
    images: ["img/proof/cases/ac-coil.webp"],
  },
  {
    title: "Commercial tourist airboat aluminum restored",
    images: ["img/proof/cases/airboat-before.webp", "img/proof/cases/airboat-after.webp"],
  },
  {
    title: "Farm HVAC rust removed, one application",
    images: ["img/proof/cases/farm-rust-before.webp", "img/proof/cases/farm-rust-after.webp"],
  },
  {
    title: "Grout, grime, moss, and algae cleared",
    images: ["img/proof/cases/grout-before.webp", "img/proof/cases/grout-after.webp"],
  },
  {
    title: "Commercial kitchen deep-degreased",
    images: ["img/proof/cases/kitchen-before.webp", "img/proof/cases/kitchen-after.webp"],
  },
];

const failures = [];

for (const cardSpec of requiredCards) {
  const titleIndex = proof.indexOf(`<h3>${cardSpec.title}</h3>`);
  if (titleIndex === -1) {
    failures.push(`Missing proof card: ${cardSpec.title}`);
    continue;
  }

  const cardStart = proof.lastIndexOf("<article", titleIndex);
  const cardEnd = proof.indexOf("</article>", titleIndex);
  const card = proof.slice(cardStart, cardEnd);

  for (const relPath of cardSpec.images) {
    if (!card.includes(`src="${relPath}"`)) {
      failures.push(`${cardSpec.title} does not reference ${relPath}`);
    }

    if (!existsSync(join(root, relPath))) {
      failures.push(`Missing image file: ${relPath}`);
    }
  }

  if (cardSpec.images.length === 2) {
    if (!card.includes("<figcaption>Before</figcaption>")) {
      failures.push(`${cardSpec.title} missing Before caption`);
    }

    if (!card.includes("<figcaption>After</figcaption>")) {
      failures.push(`${cardSpec.title} missing After caption`);
    }
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("proof image audit passed");
