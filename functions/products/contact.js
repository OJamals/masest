// Historical product pages resolved relative quote links under /products/.
// This route uses a Function because /products/* already runs Pages middleware.
export function onRequestGet({ request }) {
  const target = new URL(request.url);
  target.pathname = "/contact";
  return Response.redirect(target.toString(), 301);
}

export const onRequestHead = onRequestGet;
