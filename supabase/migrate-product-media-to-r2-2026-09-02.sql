-- Product metadata stays in Supabase. Product image bytes are served by Cloudflare R2.
-- Idempotently rewrites only the former content-assets bucket URLs; unrelated CDN URLs
-- remain unchanged. The Supabase objects remain available for rollback.

begin;

update products
set image_url = replace(
  image_url,
  'https://mvfxzvkzcqmnwcoblvfc.supabase.co/storage/v1/object/public/content-assets/',
  'https://media.masest.co/'
)
where image_url like
  'https://mvfxzvkzcqmnwcoblvfc.supabase.co/storage/v1/object/public/content-assets/%';

with rewritten_gallery as (
  select
    products.sku,
    jsonb_agg(
      case
        when jsonb_typeof(item.value) = 'string' then to_jsonb(replace(
          item.value #>> '{}',
          'https://mvfxzvkzcqmnwcoblvfc.supabase.co/storage/v1/object/public/content-assets/',
          'https://media.masest.co/'
        ))
        else item.value
      end
      order by item.ordinality
    ) as gallery
  from products
  cross join lateral jsonb_array_elements(
    case
      when jsonb_typeof(products.gallery) = 'array' then products.gallery
      else '[]'::jsonb
    end
  ) with ordinality as item(value, ordinality)
  where jsonb_typeof(products.gallery) = 'array'
    and products.gallery::text like '%mvfxzvkzcqmnwcoblvfc.supabase.co/storage/v1/object/public/content-assets/%'
  group by products.sku
)
update products
set gallery = rewritten_gallery.gallery
from rewritten_gallery
where products.sku = rewritten_gallery.sku;

commit;
