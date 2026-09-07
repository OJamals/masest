import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("medicux main pushes verify before deploying the existing Pages project", () => {
  const workflow = read(".github/workflows/verify.yml");
  const refreshStep = workflow.indexOf("- name: Refresh production CMS snapshots");
  const verifyStep = workflow.indexOf("run: npm run verify:core");
  const performanceJob = workflow.indexOf("  story_performance:");
  const deployJob = workflow.indexOf("  deploy:");
  const deployStep = workflow.indexOf("- name: Deploy production to Cloudflare Pages");
  const newsletterStep = workflow.indexOf("- name: Email newly published blog posts");

  assert.ok(refreshStep >= 0 && refreshStep < verifyStep, "production snapshots must refresh before verification");
  assert.ok(verifyStep >= 0, "workflow must retain the full verification gate");
  assert.ok(performanceJob > verifyStep, "story performance must remain an isolated job");
  assert.equal(deployJob, -1, "production deploy must reuse the verified job workspace");
  assert.ok(deployStep > verifyStep && deployStep < performanceJob, "the verified dist must deploy only after core verification");
  assert.match(workflow, /verify:\s+needs: \[story_performance\]/);
  assert.doesNotMatch(workflow, /actions\/(?:upload|download)-artifact/);
  assert.match(
    workflow,
    /if: github\.repository == 'medicux\/masest' && github\.ref == 'refs\/heads\/main' && github\.event_name != 'pull_request'/,
    "only medicux/masest main push or workflow-dispatch runs may deploy production",
  );
  assert.match(workflow, /CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/);
  assert.match(workflow, /CLOUDFLARE_ACCOUNT_ID: \$\{\{ secrets\.CLOUDFLARE_ACCOUNT_ID \}\}/);
  assert.match(workflow, /repository_dispatch:\s+types: \[site-content-published\]/);
  assert.match(workflow, /SUPABASE_URL: \$\{\{ secrets\.SUPABASE_URL \}\}/);
  assert.match(workflow, /SUPABASE_PUBLISHABLE_KEY: \$\{\{ secrets\.SUPABASE_PUBLISHABLE_KEY \}\}/);
  assert.doesNotMatch(workflow, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(workflow, /run: npm run build:content/);
  assert.match(
    workflow,
    /npx wrangler pages deploy dist --project-name=masest-commerce --branch=main --commit-hash="\$GITHUB_SHA" --commit-dirty=false/,
  );
  assert.ok(newsletterStep > deployStep, "blog email may run only after the new static page is deployed");
  assert.match(workflow, /blog_newsletter:\s+description:[^\n]+\s+required: false\s+type: boolean\s+default: false/);
  assert.match(
    workflow,
    /if: github\.repository == 'medicux\/masest' && github\.ref == 'refs\/heads\/main' && github\.event_name == 'workflow_dispatch' && inputs\.blog_newsletter/,
  );
  assert.doesNotMatch(workflow.slice(verifyStep, deployStep), /run: npm run (?:build|build:content)/, "verified dist must not be rebuilt before deployment");
  assert.match(workflow, /BLOG_NEWSLETTER_SECRET: \$\{\{ secrets\.BLOG_NEWSLETTER_SECRET \}\}/);
});

test("automated content commits explicitly dispatch the verified medicux deployment", () => {
  const workflow = read(".github/workflows/publish-blog.yml");

  assert.match(workflow, /permissions:\s+actions: write\s+contents: write/);
  assert.match(workflow, /- name: Commit \+ push if changed\s+id: content_commit/);
  assert.match(workflow, /echo "changed=false" >> "\$GITHUB_OUTPUT"/);
  assert.match(workflow, /echo "changed=true" >> "\$GITHUB_OUTPUT"/);
  assert.match(workflow, /git commit -m "content: publish blog updates"/);
  assert.doesNotMatch(workflow, /\[(?:skip ci|ci skip|no ci)\]/i);
  assert.match(workflow, /if: steps\.content_commit\.outputs\.changed == 'true'/);
  assert.match(workflow, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(workflow, /gh workflow run verify\.yml --repo medicux\/masest --ref main -f blog_newsletter=true/);
  assert.doesNotMatch(workflow, /sleep 75|Email new posts to the newsletter list/);
  assert.match(workflow, /SUPABASE_PUBLISHABLE_KEY: \$\{\{ secrets\.SUPABASE_PUBLISHABLE_KEY \}\}/);
  assert.doesNotMatch(workflow, /SUPABASE_SERVICE_ROLE_KEY/);
});

test("GitHub workflows use Node 24 action runtimes", () => {
  for (const path of [".github/workflows/verify.yml", ".github/workflows/publish-blog.yml"]) {
    const workflow = read(path);
    assert.match(workflow, /actions\/checkout@v5/, `${path} must use checkout v5`);
    assert.match(workflow, /actions\/setup-node@v5/, `${path} must use setup-node v5`);
    assert.doesNotMatch(workflow, /actions\/(?:checkout|setup-node)@v4/);
  }

  const verifyWorkflow = read(".github/workflows/verify.yml");
  assert.doesNotMatch(verifyWorkflow, /actions\/(?:upload|download)-artifact/);
});

test("Pages deployment contract owns public images through one R2 binding and domain", () => {
  const pages = read("CLOUDFLARE_PAGES.md");
  const publishing = read("docs/CONTENT_PUBLISHING.md");

  assert.match(pages, /CONTENT_IMAGES[^\n]+masest-site-images/);
  assert.match(pages, /https:\/\/media\.masest\.co/);
  assert.match(pages, /production and preview/);
  assert.match(publishing, /Cloudflare R2 is the source of truth for public content images/);
  assert.match(publishing, /npm run migrate:content-images -- --execute/);
  assert.match(publishing, /Supabase copy remains intact/);
});
