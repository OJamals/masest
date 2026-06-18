-- MASEST service catalog generated from latest services workbook.
-- Services are quote-confirmed and not auto-charged.
create table if not exists public.services (
  sku text primary key,
  name text not null,
  category text not null,
  unit text,
  public_price numeric(12,2),
  mode text not null default 'quote_service',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Grants + RLS so `npm run seed` (service_role) can upsert and the public can read
-- the catalog once a services UI ships. Pooler-created tables get no grants by default,
-- so an explicit service_role grant is required or inserts fail with 42501.
alter table public.services enable row level security;
drop policy if exists services_public_read on public.services;
create policy services_public_read on public.services for select using (active = true);
grant select on public.services to anon, authenticated;
grant select, insert, update, delete on public.services to service_role;

insert into public.services (sku, name, category, unit, public_price, mode, active) values
  ('MS-LAB-WTR-RAW-WATER-STANDARD-ANALYSIS','Raw Water — Standard Analysis','Lab Testing — Water Analysis','per sample',278.57,'quote_service',true),
  ('MS-LAB-WTR-TOWER-WATER-STANDARD-BIO-COUNTS','Tower Water — Standard + Bio Counts','Lab Testing — Water Analysis','per sample',607.14,'quote_service',true),
  ('MS-LAB-WTR-CHILL-WATER-STANDARD-BIO-COUNTS','Chill Water — Standard + Bio Counts','Lab Testing — Water Analysis','per sample',464.29,'quote_service',true),
  ('MS-LAB-WTR-CLOSED-LOOP-WATER-STANDARD-BIO-COUNTS','Closed Loop Water — Standard + Bio Counts','Lab Testing — Water Analysis','per sample',464.29,'quote_service',true),
  ('MS-LAB-WTR-STEAM-BOILER-WATER-STANDARD','Steam Boiler Water — Standard','Lab Testing — Water Analysis','per sample',307.14,'quote_service',true),
  ('MS-LAB-WTR-PRETREATMENT-WATER-SOFT-DEGAS','Pretreatment Water (Soft/Degas)','Lab Testing — Water Analysis','per sample',307.14,'quote_service',true),
  ('MS-LAB-WTR-BOILER-FEED-WATER-STANDARD','Boiler Feed Water — Standard','Lab Testing — Water Analysis','per sample',307.14,'quote_service',true),
  ('MS-LAB-WTR-POLISHER-WATER-STANDARD','Polisher Water — Standard','Lab Testing — Water Analysis','per sample',307.14,'quote_service',true),
  ('MS-LAB-WTR-STEAM-CONDENSATE-STANDARD','Steam Condensate — Standard','Lab Testing — Water Analysis','per sample',428.57,'quote_service',true),
  ('MS-LAB-BIO-BIOLOGICAL-COUNTS-HPC-DIP-SLIDE','Biological Counts (HPC/dip-slide)','Lab Testing — Biological','per sample',92.86,'quote_service',true),
  ('MS-LAB-BIO-LEGIONELLA-FULL-CULTURE-SPECIE-ID','Legionella — Full Culture + Specie ID','Lab Testing — Biological','per sample',421.43,'quote_service',true),
  ('MS-LAB-BIO-LEGIONELLA-PCR-POS-NEG','Legionella — PCR Pos/Neg','Lab Testing — Biological','per sample',285.71,'quote_service',true),
  ('MS-LAB-BIO-BIOLOGICAL-IDENTIFICATIONS','Biological Identifications','Lab Testing — Biological','per sample',292.86,'quote_service',true),
  ('MS-LAB-MAT-CORROSION-COUPON-ANALYSIS-INCL-PHOTO','Corrosion Coupon Analysis (incl. photo)','Lab Testing — Materials','per coupon',108.57,'quote_service',true),
  ('MS-LAB-MAT-PIPE-ANALYSIS-DEPOSIT-MEASUREMENTS-PHOTOS','Pipe Analysis (Deposit + Measurements + Photos)','Lab Testing — Materials','per pipe',2500.00,'quote_service',true),
  ('MS-LAB-MAT-DEPOSIT-ANALYSIS-STANDARD','Deposit Analysis — Standard','Lab Testing — Materials','per sample',464.29,'quote_service',true),
  ('MS-LAB-MAT-SINGLE-ELEMENT-ANALYSIS-ICP-OR-IC','Single Element Analysis (ICP or IC)','Lab Testing — Materials','per sample',92.86,'quote_service',true),
  ('MS-LAB-MAT-ABBREVIATED-ANALYSIS-ICP-OR-IC','Abbreviated Analysis (ICP or IC)','Lab Testing — Materials','per sample',250.00,'quote_service',true),
  ('MS-BID-SPEC-CREATION','Water Treatment Bid Specification Creation','Bid Support','each',2714.29,'quote_service',true),
  ('MS-BID-SPEC-REVIEW','Water Treatment Bid Review','Bid Support','each',1357.14,'quote_service',true),
  ('MS-BID-BID-INTERVIEW','Water Treatment Bid Interview','Bid Support','each',1357.14,'quote_service',true),
  ('MS-CONS-CONSULTING-SERVICES-GENERAL','Consulting Services (general)','Consulting Services','per hour, 2hr min',421.43,'quote_service',true),
  ('MS-CONS-EQUIPMENT-INSPECTIONS','Equipment Inspections','Consulting Services','per hour, 2hr min',421.43,'quote_service',true),
  ('MS-CONS-ULTRASONIC-BORESCOPE-TESTING','Ultrasonic / Borescope Testing','Consulting Services','per hour, 2hr min',500.00,'quote_service',true),
  ('MS-CONS-SCANNING-ELECTRON-MICROSCOPE-TESTING','Scanning Electron Microscope Testing','Consulting Services','per hour, 2hr min',1785.71,'quote_service',true),
  ('MS-CONS-SPRINKLER-SYSTEM-TESTING','Sprinkler System Testing','Consulting Services','per hour, 2hr min',1785.71,'quote_service',true),
  ('MS-CONS-PARTICLE-SIZE','Particle Size Analysis','Consulting Services','per sample',292.86,'quote_service',true),
  ('MS-CONS-PARTICLE-ID','Particle Size Analysis + Particle ID','Consulting Services','per sample',564.29,'quote_service',true),
  ('MS-FLD-ON-SITE-SAMPLE-COLLECTION-TRAVEL-QUOTED','On-Site Sample Collection (travel quoted)','Field Services','per visit',1142.86,'quote_service',true),
  ('MS-FLD-ON-SITE-SAMPLING-FEE-STANDARD-VISIT','On-Site Sampling Fee (standard visit)','Field Services','per visit',714.29,'quote_service',true),
  ('MS-WMP-RISK-ASSESSMENT-ASHRAE-188','Risk Assessment (ASHRAE 188)','Water Management Plan','each',842.86,'quote_service',true),
  ('MS-WMP-WMP-DEVELOPMENT-ASHRAE-188','WMP Development (ASHRAE 188)','Water Management Plan','each',2528.57,'quote_service',true),
  ('MS-WMP-PLAN-CERTIFICATION','Plan Certification','Water Management Plan','each',842.86,'quote_service',true),
  ('MS-WMP-PLAN-RENEWAL-ANNUAL','Plan Renewal (annual)','Water Management Plan','each',1685.71,'quote_service',true),
  ('MS-WMP-MONTHLY-DASHBOARD-ACCESS','Monthly Dashboard Access','Water Management Plan','per month',71.43,'quote_service',true),
  ('MS-PKG-INITIAL-SAMPLING-VISIT-PACKAGE','Initial Sampling Visit Package','Service Packages','package',1835.71,'quote_service',true),
  ('MS-PKG-WATER-MANAGEMENT-PLAN-SETUP-ANNUAL','Water Management Plan Setup (annual)','Service Packages','package',4942.86,'quote_service',true),
  ('MS-PKG-QUARTERLY-AUDIT','Quarterly Audit','Service Packages','per quarter',3374.29,'quote_service',true),
  ('MS-PKG-YEARLY-RECERTIFICATION','Yearly Recertification','Service Packages','per year',4085.71,'quote_service',true)
on conflict (sku) do update set
  name = excluded.name,
  category = excluded.category,
  unit = excluded.unit,
  public_price = excluded.public_price,
  mode = excluded.mode,
  active = excluded.active,
  updated_at = now();
