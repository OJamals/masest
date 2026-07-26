import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  renderIndustryDiscovery,
  renderIndustryPage,
  renderIndustryRedirects,
} from '../tools/build-industry-pages.mjs';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const industryRegistry = JSON.parse(read('data/industry-applications.json'));
const { industries } = industryRegistry;
const roleIds = industryRegistry.discovery.roles.map(({ id }) => id);
const jobIds = industryRegistry.discovery.jobs.map(({ id }) => id);
const siteImages = JSON.parse(read('data/content/site-images.json')).assets;
const siteImageByPath = new Map(siteImages.map((asset) => [asset.public_url, asset]));
const documentReview = JSON.parse(read('data/public-document-review.json'));
const fieldSourceRoot = process.env.MASEST_DOCUMENT_SOURCE_ROOT
  || join(homedir(), 'Desktop', 'masest');
const restrictedDocuments = new Set(documentReview.documents
  .filter((document) => document.status === 'restricted')
  .map((document) => document.path));
const industryFiles = readdirSync(new URL('industries/', root))
  .filter((file) => file.endsWith('.html'))
  .sort();

test('canonical industry registry owns discovery taxonomy and presentation', () => {
  assert.deepEqual(roleIds, [
    'facility-operations', 'ehs-compliance', 'procurement', 'service-contractors',
  ]);
  assert.deepEqual(
    jobIds,
    ['degrease', 'descale', 'cip', 'cooling-water', 'fleet-wash', 'exterior-bio-soil'],
  );

  const customDiscovery = structuredClone(industryRegistry.discovery);
  customDiscovery.roles[0].label = 'Custom facility role';
  assert.match(
    renderIndustryDiscovery([industries[0]], customDiscovery),
    /Custom facility role/,
  );
});

test('P3 keeps distinct industry routes and permanently redirects retired overlaps', () => {
  const redirects = new Map([
    ['/industries/food-processing-agriculture', '/industries/agriculture'],
    ['/industries/golf-courses-sports-facilities', '/industries/golf-courses'],
    ['/industries/hotels-resorts-property-management', '/industries/hotels-property-management'],
    ['/industries/oil-gas-industrial-plants', '/industries/oil-gas'],
    ['/industries/schools-universities', '/industries/education'],
    ['/industries/solar-farms-panel-cleaning', '/industries/solar-panel-cleaning'],
  ]);
  const slugs = new Set(industries.map((industry) => industry.slug));

  assert.equal(industries.length, 27);
  assert.equal(industries.filter((industry) => industry.kind === 'supplemental').length, 11);
  assert.equal(slugs.has('agriculture'), true);

  for (const [from, to] of redirects) {
    assert.equal(existsSync(new URL(`${from}.html`.slice(1), root)), false, `${from}: stale page`);
    assert.equal(slugs.has(from.split('/').pop()), false, `${from}: stale registry route`);
    assert.equal(slugs.has(to.split('/').pop()), true, `${to}: redirect target`);
  }

  assert.equal(
    renderIndustryRedirects(industries),
    [...redirects].map(([from, to]) => `${from} ${to} 301`).join('\n') + '\n',
  );
});

test('industry redirects reject unsafe or duplicate current routes', () => {
  assert.throws(
    () => renderIndustryRedirects([
      { slug: 'safe\n/injected', redirect_from: ['retired-route'] },
    ]),
    /invalid current route/,
  );
  assert.throws(
    () => renderIndustryRedirects([
      { slug: 'duplicate-route' },
      { slug: 'duplicate-route' },
    ]),
    /duplicate current route/,
  );
});

test('each industry route has one captioned image gallery containing every accepted generated image', () => {
  assert.equal(industries.length, 27);
  const renderedTaskImages = new Set();
  const renderedSupplementalImages = new Set();
  const sampleFiles = siteImages
    .filter((asset) => asset.public_url.startsWith('/img/industries/samples/'))
    .map((asset) => asset.filename)
    .sort();
  const catalogHtml = `${read('industries.html')}\n${read('data/content/industry-sectors.json')}`;
  const catalogSampleImages = new Set([...catalogHtml.matchAll(
    /img\/industries\/samples\/([^"]+\.webp)/g,
  )].map((match) => match[1]));
  const supplementalSampleFiles = sampleFiles
    .filter((file) => !catalogSampleImages.has(file));
  const supplementalSampleSlugs = new Set(
    supplementalSampleFiles.map((file) => file.replace(/\.webp$/, '')),
  );
  assert.deepEqual(
    supplementalSampleFiles,
    ['pressure-washing-soft-wash-contractors.webp'],
    'only exact-route supplemental imagery belongs in an individual gallery',
  );
  for (const industry of industries) {
    const html = read(`industries/${industry.slug}.html`);
    const gallery = html.match(
      /<section class="section section-slim ind-gallery-sec" aria-label="[^"]+ image gallery">([\s\S]*?)<\/section>/,
    );
    assert.ok(gallery, `${industry.slug}: image gallery`);
    assert.equal((html.match(/class="ind-gallery ind-image-gallery"/g) || []).length, 1);
    assert.doesNotMatch(html, /ind-task-gallery|Representative cleaning tasks|Representative tasks/);

    const taskImages = [...gallery[1].matchAll(
      /<img src="\.\.\/img\/industries\/tasks\/([^"]+\.webp)"[^>]+width="1200" height="750">/g,
    )].map((match) => match[1]);

    assert.ok(taskImages.length >= 2, `${industry.slug}: task gallery`);

    const sampleImages = [...gallery[1].matchAll(
      /<img src="\.\.\/img\/industries\/samples\/([^"]+\.webp)"[^>]+width="840" height="520">/g,
    )].map((match) => match[1]);
    assert.deepEqual(
      sampleImages,
      supplementalSampleSlugs.has(industry.slug) ? [`${industry.slug}.webp`] : [],
      `${industry.slug}: exact-route supplemental image`,
    );
    assert.equal(
      (gallery[1].match(/<figure class="ind-shot(?: ind-shot-wide)?"[^>]*>/g) || []).length,
      (gallery[1].match(/<figcaption>/g) || []).length,
      `${industry.slug}: every gallery image has a caption`,
    );

    for (const image of taskImages) {
      renderedTaskImages.add(image);
      const asset = siteImageByPath.get(`/img/industries/tasks/${image}`);
      assert.ok(asset, `${industry.slug}: missing ${image}`);
      assert.deepEqual(
        { width: asset.width, height: asset.height },
        { width: 1200, height: 750 },
        `${image}: dimensions`,
      );
    }
    for (const image of sampleImages) {
      renderedSupplementalImages.add(image);
      const asset = siteImageByPath.get(`/img/industries/samples/${image}`);
      assert.ok(asset, `${industry.slug}: missing ${image}`);
      assert.deepEqual(
        { width: asset.width, height: asset.height },
        { width: 840, height: 520 },
        `${image}: dimensions`,
      );
    }
  }

  const taskFiles = siteImages
    .filter((asset) => asset.public_url.startsWith('/img/industries/tasks/'))
    .map((asset) => asset.filename);
  assert.equal(renderedTaskImages.size, 75);
  assert.deepEqual([...renderedTaskImages].sort(), taskFiles.sort(), 'no orphan task images');
  assert.deepEqual(
    [...new Set([...catalogSampleImages, ...renderedSupplementalImages])].sort(),
    sampleFiles,
    'every accepted sample image is assigned to its intended surface',
  );
});

test('gallery media fails closed between generated scenes, field context, and qualified proof', () => {
  const requiredProofFields = [
    'permission',
    'date',
    'asset',
    'soil',
    'product',
    'concentration',
    'procedure',
    'endpoint',
    'result',
    'limitations',
  ];
  const statusCounts = { absent: 0, context_only: 0, qualified: 0 };

  for (const industry of industries) {
    const evidence = industry.field_evidence;
    assert.ok(evidence, `${industry.slug}: field_evidence is required`);
    assert.ok(
      Object.hasOwn(statusCounts, evidence.status),
      `${industry.slug}: invalid field evidence status`,
    );
    statusCounts[evidence.status] += 1;

    if (evidence.status === 'qualified') {
      for (const field of requiredProofFields) {
        assert.ok(evidence.record?.[field]?.trim(), `${industry.slug}: qualified ${field}`);
      }
      assert.deepEqual(evidence.missing || [], [], `${industry.slug}: qualified record gaps`);
    } else {
      assert.ok(evidence.missing?.length, `${industry.slug}: incomplete record gaps required`);
      const gaps = evidence.missing.join(' ');
      if (evidence.status === 'context_only') {
        assert.match(
          evidence.source || '',
          /^case studies\/[^/]+\.(?:pdf|docx)$/i,
          `${industry.slug}: controlled context source`,
        );
        assert.match(evidence.source_sha256 || '', /^[a-f0-9]{64}$/, `${industry.slug}: source hash`);
        if (existsSync(fieldSourceRoot)) {
          const sourcePath = join(fieldSourceRoot, evidence.source);
          assert.ok(existsSync(sourcePath), `${industry.slug}: missing context source ${evidence.source}`);
          assert.equal(
            createHash('sha256').update(readFileSync(sourcePath)).digest('hex'),
            evidence.source_sha256,
            `${industry.slug}: context source changed`,
          );
        }
        assert.match(
          evidence.publication_basis || '',
          /owner-confirmed public field media/i,
          `${industry.slug}: publication basis`,
        );
        assert.match(gaps, /date/i, `${industry.slug}: date gap`);
        assert.match(gaps, /method.*result.*limitations/i, `${industry.slug}: record gaps`);
      } else {
        assert.match(gaps, /approved field photos/i, `${industry.slug}: absent-photo gap`);
        assert.equal(evidence.source, undefined, `${industry.slug}: absent evidence must not expose source`);
        assert.equal(evidence.source_sha256, undefined, `${industry.slug}: absent evidence must not expose source hash`);
      }
    }

    const html = read(`industries/${industry.slug}.html`);
    const gallery = html.match(
      /<section class="section section-slim ind-gallery-sec" aria-label="[^"]+ image gallery">([\s\S]*?)<\/section>/,
    )?.[1] || '';
    const figures = [...gallery.matchAll(/<figure class="ind-shot(?: ind-shot-wide)?" data-evidence-kind="([^"]+)">/g)]
      .map((match) => match[1]);
    const expectedFigures = (gallery.match(/<figure class="ind-shot(?: ind-shot-wide)?"/g) || []).length;

    assert.equal(figures.length, expectedFigures, `${industry.slug}: every figure declares evidence kind`);
    assert.ok(figures.includes('generated'), `${industry.slug}: generated scenes identified`);
    assert.equal(
      figures.includes('field-proof'),
      evidence.status === 'qualified',
      `${industry.slug}: field proof must follow record status`,
    );
    assert.equal(
      figures.includes('field-context'),
      evidence.status === 'context_only',
      `${industry.slug}: field context must follow record status`,
    );

    const fieldImages = [...gallery.matchAll(
      /<figure class="ind-shot" data-evidence-kind="(?:field-context|field-proof)">\s*<img src="\.\.(\/img\/industries\/[^"]+)" alt="([^"]+)"[^>]+width="(\d+)" height="(\d+)">/g,
    )];
    assert.equal(
      fieldImages.length,
      evidence.status === 'absent' ? 0 : 3,
      `${industry.slug}: canonical field-image count`,
    );
    for (const [, path, alt, width, height] of fieldImages) {
      const asset = siteImageByPath.get(path);
      assert.ok(asset, `${industry.slug}: ${path} must exist in the public image registry`);
      assert.equal(alt, asset.alt, `${industry.slug}: field alt must come from the canonical image registry`);
      assert.match(alt, /context/i, `${industry.slug}: public field media must state its context boundary`);
      assert.deepEqual(
        { width: Number(width), height: Number(height) },
        { width: asset.width, height: asset.height },
        `${industry.slug}: field dimensions must come from the canonical image registry`,
      );
    }
  }

  assert.deepEqual(statusCounts, { absent: 17, context_only: 10, qualified: 0 });
});

test("public image registry excludes customer logos but retains owner-approved field records", () => {
  const manifest = JSON.parse(read("data/content/site-images.json"));
  const paths = manifest.assets.map((asset) => asset.public_url);

  for (const path of paths) {
    assert.doesNotMatch(path, /^\/img\/clients\//, `${path}: customer logo`);
  }
  assert.equal(paths.filter((path) => /^\/img\/industries\/[^/]+\/g\d+\.webp$/.test(path)).length, 31);
  assert.ok(paths.includes("/img/proof/cases/marine.webp"));
});

test('P1 registry covers every industry route with task-specific operating context', () => {
  const expectedSlugs = industryFiles.map((file) => file.replace(/\.html$/, '')).sort();
  const actualSlugs = industries.map((industry) => industry.slug).sort();

  assert.equal(industries.length, 27);
  assert.deepEqual(actualSlugs, expectedSlugs);
  assert.equal(new Set(actualSlugs).size, actualSlugs.length);

  const supplemental = industries.filter((industry) => industry.kind === 'supplemental');
  assert.equal(supplemental.length, 11);

  for (const industry of industries) {
    for (const field of [
      'label',
      'lead_task',
      'asset',
      'soil',
      'method',
      'concentration',
      'process',
      'boundary',
      'verification',
      'materials',
      'wastewater',
    ]) {
      assert.ok(industry[field]?.trim(), `${industry.slug}: ${field} is required`);
    }
    assert.ok(industry.products?.length, `${industry.slug}: products are required`);
    assert.ok(industry.document_products?.length, `${industry.slug}: document products are required`);
    if (industry.kind === 'supplemental') {
      assert.ok(actualSlugs.includes(industry.parent), `${industry.slug}: parent must be a current route`);
      assert.notEqual(industry.parent, industry.slug);
    }
  }
});

test('P1 discovery registry maps every route to supported buyer roles and job paths', () => {
  const roleCoverage = new Map(roleIds.map((id) => [id, 0]));
  const jobCoverage = new Map(jobIds.map((id) => [id, 0]));

  for (const industry of industries) {
    assert.ok(industry.buyer_roles?.length, `${industry.slug}: buyer roles are required`);
    assert.ok(
      Object.keys(industry.job_paths || {}).length,
      `${industry.slug}: at least one job path is required`,
    );

    for (const role of industry.buyer_roles) {
      assert.ok(roleCoverage.has(role), `${industry.slug}: unsupported buyer role ${role}`);
      roleCoverage.set(role, roleCoverage.get(role) + 1);
    }

    for (const [job, productIds] of Object.entries(industry.job_paths)) {
      assert.ok(jobCoverage.has(job), `${industry.slug}: unsupported job path ${job}`);
      assert.ok(productIds.length, `${industry.slug}: ${job} needs starting products`);
      assert.equal(new Set(productIds).size, productIds.length, `${industry.slug}: ${job} products`);
      for (const productId of productIds) {
        assert.ok(
          industry.products.includes(productId),
          `${industry.slug}: ${job} product ${productId} must be a route starting product`,
        );
      }
      jobCoverage.set(job, jobCoverage.get(job) + 1);
    }
  }

  for (const [role, count] of roleCoverage) {
    assert.ok(count >= 3, `${role}: needs at least three useful routes`);
  }
  for (const [job, count] of jobCoverage) {
    assert.ok(count >= 3, `${job}: needs at least three useful routes`);
  }
});

test('industry hub generates linkable role and job discovery with decision context', () => {
  const hub = read('industries.html');

  assert.equal((hub.match(/data-industry-discovery(?!-)/g) || []).length, 1);
  assert.equal((hub.match(/data-industry-discovery-card/g) || []).length, industries.length);
  assert.doesNotMatch(hub, /Start with a quote/);

  for (const role of roleIds) {
    assert.match(hub, new RegExp(`href="\\?role=${role}#industry-discovery"`));
    assert.match(
      hub,
      new RegExp(`data-filter-value="${role}"[^>]+data-result-detail="[^"]+"[^>]+data-cta-type="(?:audit|quote)"`),
    );
  }
  for (const job of jobIds) {
    assert.match(hub, new RegExp(`href="\\?job=${job}#industry-discovery"`));
    assert.match(
      hub,
      new RegExp(`data-filter-value="${job}"[^>]+data-result-detail="[^"]+"[^>]+data-cta-type="(?:audit|quote)"`),
    );
  }

  for (const industry of industries) {
    const card = hub.match(
      new RegExp(
        `<article[^>]+data-industry-discovery-card[^>]+data-industry-slug="${industry.slug}"[\\s\\S]*?</article>`,
      ),
    )?.[0] || '';
    assert.match(card, new RegExp(`href="industries/${industry.slug}"`), `${industry.slug}: route`);
    assert.match(card, /data-buyer-roles="[^"]+"/, `${industry.slug}: roles`);
    assert.match(card, /data-job-paths="[^"]+"/, `${industry.slug}: jobs`);
    assert.match(card, /Starting chemistry/, `${industry.slug}: products`);
    assert.match(card, /class="industry-discovery-products"/, `${industry.slug}: product list`);
    assert.doesNotMatch(card, /data-industry-discovery-product[^>]*>[^<]+<\/a>,/);
    assert.match(card, /Evidence status/, `${industry.slug}: evidence`);
    assert.match(card, /data-industry-discovery-path hidden/, `${industry.slug}: path framing`);
    assert.match(card, /href="contact\?[^"]+type=(?:audit|quote)/, `${industry.slug}: prefilled CTA`);
  }
});

test('generated route product mounts follow the canonical industry registry', () => {
  for (const industry of industries) {
    const html = read(`industries/${industry.slug}.html`);
    const productIds = html.match(/data-ind-products="([^"]+)"/)?.[1].split(/\s+/) || [];
    assert.deepEqual(productIds, industry.products, `${industry.slug}: starting products`);
  }
});

test('supplemental routes state a narrower buyer, task scope, and search intent than their parent', () => {
  const bySlug = new Map(industries.map((industry) => [industry.slug, industry]));
  const ignoredTerms = new Set(
    'the and for with from into not general cleaning chemical chemistry cleaner teams team work route facility facilities industrial task tasks this that'
      .split(' '),
  );
  const meaningfulTerms = (value) => new Set(
    String(value || '').toLowerCase().match(/[a-z0-9]+/g)
      ?.filter((term) => term.length > 3 && !ignoredTerms.has(term)) || [],
  );

  for (const industry of industries.filter((candidate) => candidate.kind === 'supplemental')) {
    const parent = bySlug.get(industry.parent);
    assert.ok(parent, `${industry.slug}: parent route`);
    const parentTerms = meaningfulTerms(
      [parent.label, parent.lead_task, parent.asset, parent.soil, parent.method].join(' '),
    );

    for (const [field, minimumUniqueTerms] of [
      ['buyer', 3],
      ['distinct_scope', 5],
      ['search_intent', 3],
    ]) {
      assert.ok(industry[field]?.trim(), `${industry.slug}: ${field} is required`);
      assert.notEqual(
        industry[field].trim().toLowerCase(),
        String(parent[field] || '').trim().toLowerCase(),
        `${industry.slug}: ${field} must differ from parent`,
      );
      const uniqueTerms = [...meaningfulTerms(industry[field])]
        .filter((term) => !parentTerms.has(term));
      assert.ok(
        uniqueTerms.length >= minimumUniqueTerms,
        `${industry.slug}: ${field} must add route-specific terms`,
      );
    }
    assert.match(industry.distinct_scope, /\bnot\b/i, `${industry.slug}: parent boundary`);
    assert.notEqual(industry.lead_task, parent.lead_task, `${industry.slug}: narrower task`);

    const html = read(`industries/${industry.slug}.html`);
    const scope = html.match(
      /<aside class="ind-scope-note" data-supplemental-scope>([\s\S]*?)<\/aside>/,
    )?.[1] || '';
    assert.match(scope, /Focused buyer route/);
    assert.match(scope, new RegExp(industry.buyer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(scope, new RegExp(industry.distinct_scope.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(scope, new RegExp(industry.search_intent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(scope, new RegExp(`href="./${industry.parent}"`));
  }
});

test('every industry page renders one task-led applications and verification module', () => {
  for (const file of industryFiles) {
    const slug = file.replace(/\.html$/, '');
    const html = read(`industries/${file}`);

    assert.equal((html.match(/data-industry-hero-facts/g) || []).length, 1, `${slug}: hero facts`);
    assert.equal(
      (html.match(/data-industry-applications-proof/g) || []).length,
      1,
      `${slug}: applications/proof module`,
    );
    assert.equal((html.match(/data-industry-local-cta/g) || []).length, 1, `${slug}: localized CTA`);
    assert.doesNotMatch(html, /Put the current chemical on the table\./);
    assert.match(html, /Applications and verification/);
    assert.doesNotMatch(html, /Applications and proof|Field-proof standard/);

    for (const label of [
      'Task',
      'Asset / substrate',
      'Soil / deposit',
      'Starting chemistry',
      'Concentration',
      'Process controls',
      'Shutdown / containment',
      'Verification endpoint',
    ]) {
      assert.match(html, new RegExp(`>${label}<`), `${slug}: missing ${label}`);
    }

    assert.match(html, /No field result is presented as proof unless/i, `${slug}: evidence boundary`);
    assert.match(html, /message=/, `${slug}: CTA must prefill the cleaning brief`);
  }
});

test('P2 industries publish registry-driven controlled-trial briefs without promoting references to proof', () => {
  const trialIndustries = industries.filter((industry) => industry.trial_brief);
  const titleBySlug = new Map([
    ['breweries-distilleries-wineries', /brewery CIP controlled-trial brief/i],
    ['distribution-cold-storage', /distribution.*cold storage.*controlled-trial brief/i],
    ['hvac-water', /HVAC.*water treatment.*controlled-trial brief/i],
    ['restaurants-commercial-kitchens', /commercial kitchen.*controlled-trial brief/i],
  ]);
  assert.deepEqual(
    trialIndustries.map((industry) => industry.slug),
    [...titleBySlug.keys()],
  );

  const trialBySlug = new Map(trialIndustries.map((industry) => [industry.slug, industry]));
  for (const [slug, title] of titleBySlug) {
    assert.match(trialBySlug.get(slug).trial_brief.title, title);
  }
  const brewery = trialBySlug.get('breweries-distilleries-wineries');
  const hvac = trialBySlug.get('hvac-water');

  for (const industry of trialIndustries) {
    assert.ok(industry.trial_brief.objective?.trim(), `${industry.slug}: trial objective`);
    assert.equal(
      industry.trial_brief.compatibility_checks?.length,
      3,
      `${industry.slug}: material compatibility gates`,
    );
    for (const check of industry.trial_brief.compatibility_checks) {
      assert.ok(check.material?.trim(), `${industry.slug}: compatibility material`);
      assert.ok(check.gate?.trim(), `${industry.slug}: compatibility gate`);
    }
  }

  for (const industry of industries) {
    const html = read(`industries/${industry.slug}.html`);
    const briefCount = (html.match(/data-industry-trial-brief/g) || []).length;
    assert.equal(
      briefCount,
      industry.trial_brief ? 1 : 0,
      `${industry.slug}: controlled-trial brief scope`,
    );
  }

  const briefs = new Map();
  for (const industry of trialIndustries) {
    const html = read(`industries/${industry.slug}.html`);
    const brief = html.match(
      /<section class="[^"]*\bind-trial-brief\b[^"]*"[\s\S]*?<\/section>/,
    )?.[0] || '';
    briefs.set(industry.slug, brief);

    assert.match(brief, new RegExp(industry.trial_brief.title, 'i'));
    assert.match(brief, new RegExp(industry.trial_brief.objective, 'i'));
    assert.match(brief, /Material compatibility gate/);
    assert.match(brief, /<caption>Materials to approve before the trial<\/caption>/);
    assert.equal(
      (brief.match(/<tbody>[\s\S]*<\/tbody>/)?.[0].match(/<tr>/g) || []).length,
      industry.trial_brief.compatibility_checks.length,
    );
    const stepLabels = [...brief.matchAll(/<li><h5>([^<]+)<\/h5>/g)]
      .map(([, label]) => label);
    assert.deepEqual(stepLabels, [
      'Scope and baseline',
      'Compatibility gate',
      'Witnessed method',
      'Release and record',
    ]);
    for (const value of [
      industry.asset,
      industry.soil,
      industry.method,
      industry.materials,
      industry.concentration,
      industry.process,
      industry.boundary,
      industry.verification,
      industry.wastewater,
    ]) {
      assert.match(
        brief,
        new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
        `${industry.slug}: trial brief must use canonical controls`,
      );
    }
    assert.match(brief, /href="\.\.\/contact\?[^"]+type=sample/);
  }

  const breweryBrief = briefs.get(brewery.slug);
  assert.match(breweryBrief, /No field record/);
  assert.match(breweryBrief, /Brewlando CIP Trial/);
  assert.match(breweryBrief, /Carib Brewery Laboratory Report/);
  assert.match(breweryBrief, /controlled references/i);
  assert.match(breweryBrief, /flagged statements[^.]+do not substantiate/i);
  assert.doesNotMatch(
    breweryBrief,
    /worked better|more effective|non-fuming|non-corrosive|safe environment|green option for CIP/i,
  );

  const referenceFiles = brewery.evidence_files.map(({ file }) => (
    documentReview.documents.find((document) => document.path === file)
  ));
  assert.equal(referenceFiles.every((document) => document?.status === 'reference_only'), true);

  for (const [slug, forbidden] of [
    [
      'distribution-cold-storage',
      /\b94%|\b8[–-]22%|\b4[–-]8 hr|\$\d/i,
    ],
    [
      'restaurants-commercial-kitchens',
      /NeatFreaks|customer|before.?after|food[- ]safe|saniti[sz]es|disinfects?|kills?|non[- ]toxic|non[- ]corrosive|NSF|EPA[- ]registered|health[- ]department approved|code compliant|\$\d|\b\d+%/i,
    ],
  ]) {
    const industry = trialBySlug.get(slug);
    const brief = briefs.get(slug);
    assert.equal(industry.field_evidence.status, 'absent');
    assert.equal(industry.evidence_files, undefined);
    assert.match(brief, /Planning asset · No field record/);
    assert.match(brief, /planning brief, not field proof/i);
    assert.match(brief, /No controlled reference is being used to substantiate/i);
    assert.doesNotMatch(
      `${JSON.stringify(industry.trial_brief)}\n${brief}`,
      forbidden,
      `${slug}: restricted source detail or claim`,
    );
  }

  const hvacBrief = briefs.get(hvac.slug);
  assert.equal(hvac.field_evidence.status, 'context_only');
  assert.equal(hvac.evidence_files, undefined);
  assert.match(hvacBrief, /Planning asset · Field context; verification incomplete/);
  assert.match(hvacBrief, /planning brief, not field proof/i);
  assert.match(hvacBrief, /WaterSafe60 Safety Data Sheet/);
  assert.match(hvacBrief, /controlled references/i);
  assert.doesNotMatch(hvacBrief, /customer references?/i);
  assert.doesNotMatch(
    `${JSON.stringify(hvac.trial_brief)}\n${hvacBrief}`,
    /Brevard|Schools|DDC|Legionella[- ]compliant|EPA[- ]registered|NSF(?:\/ANSI)? 60|kills? Legionella|non[- ]corrosive|safe for all|OEM[- ]approved/i,
  );

});

test('industry proof links resolve locally and exclude restricted customer records', () => {
  for (const file of industryFiles) {
    const slug = file.replace(/\.html$/, '');
    const html = read(`industries/${file}`);
    const module = html.match(
      /<!-- industry:applications:start -->([\s\S]*?)<!-- industry:applications:end -->/,
    )?.[1] || '';
    const documents = [...module.matchAll(/href="\.\.\/(docs\/[^"]+\.pdf)"/g)]
      .map((match) => match[1]);
    const requestIds = [...module.matchAll(/data-document-request[^>]*data-document-id="(MAS-[A-Z0-9-]+)"/g)]
      .map((match) => match[1]);

    assert.ok(
      documents.length + requestIds.length >= 2,
      `${slug}: controlled document links or request controls required`,
    );
    for (const document of documents) {
      assert.equal(restrictedDocuments.has(document), false, `${slug}: restricted ${document}`);
      assert.ok(existsSync(new URL(document, root)), `${slug}: missing ${document}`);
    }
  }
});

test('localized CTA requests the six inputs needed to scope a cleaning trial', () => {
  const contactHtml = read('contact.html');
  const contactIndustries = new Set(
    [...contactHtml.matchAll(/<option>([^<]+)<\/option>/g)]
      .map((match) => match[1].replaceAll('&amp;', '&')),
  );

  for (const file of industryFiles) {
    const slug = file.replace(/\.html$/, '');
    const html = read(`industries/${file}`);
    const cta = html.match(/<!-- industry:cta:start -->([\s\S]*?)<!-- industry:cta:end -->/)?.[1] || '';
    const href = cta.match(/href="\.\.\/contact\?([^"]+)"/)?.[1];
    assert.ok(href, `${slug}: contact CTA missing`);

    const params = new URLSearchParams(href.replaceAll('&amp;', '&'));
    assert.ok(contactIndustries.has(params.get('industry')), `${slug}: contact industry must preselect`);
    const message = params.get('message') || '';
    for (const prompt of [
      'Asset / substrate:',
      'Soil / deposit:',
      'Operating conditions:',
      'Materials:',
      'Wastewater route:',
      'Buying deadline:',
    ]) {
      assert.match(message, new RegExp(prompt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${slug}: ${prompt}`);
    }
  }
});

test('supplemental buyer routes are discoverable from the hub and canonical parent', () => {
  const hub = read('industries.html');

  for (const industry of industries.filter((candidate) => candidate.kind === 'supplemental')) {
    assert.match(
      hub,
      new RegExp(`href="industries/${industry.slug}"`),
      `${industry.slug}: hub link`,
    );

    const parentHtml = read(`industries/${industry.parent}.html`);
    const applications = parentHtml.match(
      /<!-- industry:applications:start -->([\s\S]*?)<!-- industry:applications:end -->/,
    )?.[1] || '';
    assert.match(
      applications,
      new RegExp(`href="./${industry.slug}"`),
      `${industry.slug}: parent link`,
    );
  }
});

test('industry page generation is idempotent', () => {
  const review = JSON.parse(read('data/public-document-review.json'));
  const reviewByPath = new Map(review.documents.map((document) => [document.path, document]));

  for (const industry of industries) {
    const html = read(`industries/${industry.slug}.html`);
    assert.equal(
      renderIndustryPage(html, industry, industries, reviewByPath),
      html,
      `${industry.slug}: second render changed output`,
    );
  }
});

test('applications anchor clears the sticky navigation', () => {
  const css = read('css/style.css');
  const offset = css.match(/\.ind-applications\s*\{[^}]*scroll-margin-top:\s*(\d+)px/s)?.[1];
  assert.ok(Number(offset) >= 120, 'applications anchor needs room for the sticky navigation');
});
