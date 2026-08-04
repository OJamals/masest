# Saved-address autocomplete

The authenticated dashboard saved-address form progressively enhances manual U.S. address fields with Google Places `PlaceAutocompleteElement`. Checkout still uses Stripe-hosted address collection; this integration does not duplicate or override Stripe's checkout address.

## Runtime variable

```dotenv
GC_AUTOCOMPLETE_API_KEY=YOUR_BROWSER_KEY
```

Keep the value in gitignored `.dev.vars` and the Cloudflare Pages production secret named `GC_AUTOCOMPLETE_API_KEY`. `/api/address-autocomplete-config` exposes it to the browser only when it has a valid Google key shape. Browser keys are client-visible by design.

Apply both Google Cloud restrictions:

- Website referrers (all four entries are required because some browsers send only the origin):
  - `https://masest.co`
  - `https://masest.co/*`
  - `https://www.masest.co`
  - `https://www.masest.co/*`
- API restrictions: **Maps JavaScript API**, **Places API (New)**

Do not authorize preview or localhost hosts on the production key. Use a separate restricted development key if local autocomplete is needed. Missing/invalid config leaves all manual address fields functional.

The production CSP allows Google Maps JavaScript/Places resources through `*.googleapis.com`, `*.gstatic.com`, `fonts.googleapis.com`, and `fonts.gstatic.com`. Keep those directives aligned with Google's current CSP guide when changing the widget or Maps loader.

References: [Place Autocomplete Widget](https://developers.google.com/maps/documentation/javascript/place-autocomplete-new), [Google Maps Platform CSP guide](https://developers.google.com/maps/documentation/javascript/content-security-policy), [Google Maps Platform security guidance](https://developers.google.com/maps/api-security-best-practices).
