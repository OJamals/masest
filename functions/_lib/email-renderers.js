import {
  EMAIL_BASE,
  EMAIL_LOGO,
  emailBrandHeader,
  emailBusinessAddress,
  emailButton,
  emailDocument,
  emailEscape,
  emailSafeUrl,
  marketingEmailFooter,
  transactionalEmailFooter,
} from './email-template.js';
import companyIdentity from '../../data/company-identity.json' with { type: 'json' };

const text = (value, max = 500) => String(value ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);
const bodyText = (value, max = 4000) => String(value ?? '').trim().slice(0, max);

function referenceOf(order = {}) {
  return text(order.order_number || order.reference || order.id || 'Order', 80);
}

function formatDate(value, withTime = false) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return text(value, 80);
  return new Intl.DateTimeFormat('en-US', withTime ? {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/New_York',
  } : {
    dateStyle: 'medium',
    timeZone: 'America/New_York',
  }).format(date);
}

function money(value, currency = 'usd') {
  return `${text(currency || 'usd', 3).toUpperCase()} ${Number(value || 0).toFixed(2)}`;
}

function safeMediaUrl(value) {
  const href = emailSafeUrl(value);
  if (!href) return '';
  try {
    const url = new URL(href);
    return url.protocol === 'https:' && url.hostname === 'media.masest.co' ? url.toString() : '';
  } catch {
    return '';
  }
}

function emailImageDimensions(sourceWidth, sourceHeight, targetWidth, fallbackHeight) {
  const dimension = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 && parsed <= 10000 ? Math.round(parsed) : 0;
  };
  const width = dimension(sourceWidth);
  const height = dimension(sourceHeight);
  return {
    width: targetWidth,
    height: width && height
      ? Math.max(1, Math.min(10000, Math.round((targetWidth * height) / width)))
      : fallbackHeight,
  };
}

function plainHtml(value) {
  return String(value || '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n\n')
    .replace(/<\/h[1-6]\s*>/gi, '\n\n')
    .replace(/<li\b[^>]*>/gi, '- ')
    .replace(/<\/li\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&middot;/gi, '·')
    .replace(/&times;/gi, '×')
    .replace(/&minus;/gi, '−')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function bodyAsHtml(value) {
  return emailEscape(bodyText(value)).replace(/\n/g, '<br>');
}

function supportSender(message, participant, audience) {
  if (text(message?.sender_name, 120)) return text(message.sender_name, 120);
  if (message?.sender_role === 'staff') return 'MASEST Support';
  if (audience === 'staff') return text(participant?.name, 120) || 'Customer';
  return 'You';
}

function priorSender(message, participant, audience) {
  if (audience === 'buyer') return message?.sender_role === 'buyer'
    ? 'You'
    : text(message?.sender_name, 120) || 'MASEST Support';
  return message?.sender_role === 'staff'
    ? 'You'
    : text(message?.sender_name, 120) || text(participant?.name, 120) || 'Customer';
}

export function renderSupportEmail({
  thread = {},
  message = {},
  priorMessages = [],
  participant = {},
  order = null,
  audience = 'buyer',
} = {}) {
  const orderReference = order?.id ? referenceOf(order) : '';
  const participantName = text(participant.name || 'Customer', 120) || 'Customer';
  const hasParent = Boolean(thread?.headers?.['In-Reply-To']);
  const subjectBase = `MASEST support · ${participantName}${orderReference ? ` · Order ${orderReference}` : ''}`;
  const subject = `${hasParent ? 'Re: ' : ''}${subjectBase}`;
  const sender = supportSender(message, participant, audience);
  const timestamp = formatDate(message.created_at, true);
  const topic = text(thread.topic, 180);
  const previewText = `New reply from ${sender} — respond by email or continue online.`;
  const viewUrl = emailSafeUrl(thread.viewUrl);
  const orderUrl = emailSafeUrl(order?.viewUrl);
  const latest = bodyAsHtml(message.body);
  const history = (Array.isArray(priorMessages) ? priorMessages : []).slice(0, 2);
  const historyHtml = history.length ? `<tr><td class="email-pad" style="padding:0 28px 28px;font-family:Arial,sans-serif">
    <table role="presentation" width="100%" class="email-card" style="width:100%;background:#f7f9fa;border:1px solid #e4e6e9;border-collapse:separate;border-spacing:0;border-radius:10px"><tr><td style="padding:14px 16px">
      <p style="margin:0 0 10px;color:#5f656d;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase">Earlier in this conversation</p>
      ${history.map((prior) => `<p style="margin:0 0 11px;font-size:13px;line-height:1.55"><strong>${emailEscape(priorSender(prior, participant, audience))}${prior.created_at ? ` · ${emailEscape(formatDate(prior.created_at, true))}` : ''}</strong><br><span style="color:#5f656d">${bodyAsHtml(prior.body)}</span></p>`).join('')}
      ${history.length === 2 ? '<p style="margin:0;color:#5f656d;font-size:12px">More history is available online.</p>' : ''}
    </td></tr></table>
  </td></tr>` : '';
  const rows = emailBrandHeader('CUSTOMER SUPPORT', orderReference ? `Order ${orderReference}` : '')
    + `<tr><td class="email-pad" style="padding:34px 28px 16px;font-family:Arial,sans-serif">
      <p style="margin:0 0 8px;color:#0a5b62;font-size:11px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase">New support reply</p>
      <h1 style="margin:0;color:#15171c;font-size:27px;line-height:1.18;letter-spacing:-.5px">New message from ${emailEscape(sender)}</h1>
      ${topic ? `<p style="margin:10px 0 0;color:#5f656d;font-size:14px;line-height:1.55">Re: ${emailEscape(topic)}</p>` : ''}
    </td></tr>
    <tr><td class="email-pad" style="padding:0 28px 18px;font-family:Arial,sans-serif">
      <table role="presentation" width="100%" class="email-card" style="width:100%;background:#f7f9fa;border:1px solid #e4e6e9;border-collapse:separate;border-spacing:0;border-radius:12px"><tr><td style="padding:18px;border-left:4px solid #0e7c86">
        <table role="presentation" width="100%"><tr><td style="font-size:13px;font-weight:700">${emailEscape(sender)}</td>${timestamp ? `<td align="right" style="color:#5f656d;font-size:12px">${emailEscape(timestamp)}</td>` : ''}</tr></table>
        <p style="margin:14px 0 0;font-size:16px;line-height:1.65">${latest}</p>
      </td></tr></table>
    </td></tr>
    <tr><td class="email-pad" style="padding:0 28px 24px;font-family:Arial,sans-serif">
      ${viewUrl ? emailButton('View conversation online', viewUrl) : ''}
      <p style="margin:14px 0 0;font-size:13px;line-height:1.55"><strong>Reply directly to this email</strong> to respond. Your reply will appear in the same support conversation.</p>
      ${orderReference && orderUrl ? `<p style="margin:8px 0 0;font-size:13px"><a href="${emailEscape(orderUrl)}" style="color:#0a5b62;text-decoration:underline">View order ${emailEscape(orderReference)}</a></p>` : ''}
    </td></tr>`
    + historyHtml
    + transactionalEmailFooter('support');
  const html = emailDocument({ title: subjectBase, preheader: previewText, rows });
  const historyText = history.map((prior) =>
    `${priorSender(prior, participant, audience)}${prior.created_at ? ` · ${formatDate(prior.created_at, true)}` : ''}\n${bodyText(prior.body)}`
  ).join('\n\n');
  const plain = [
    'MASEST CUSTOMER SUPPORT',
    orderReference ? `Order ${orderReference}` : '',
    '',
    'NEW SUPPORT REPLY',
    `New message from ${sender}`,
    topic ? `Re: ${topic}` : '',
    '',
    `${sender}${timestamp ? ` · ${timestamp}` : ''}`,
    bodyText(message.body),
    '',
    'Reply directly to this email to respond. Your reply will appear in the same support conversation.',
    viewUrl ? `View conversation: ${viewUrl}` : '',
    orderReference && orderUrl ? `View order ${orderReference}: ${orderUrl}` : '',
    historyText ? `\nEARLIER\n${historyText}` : '',
    '',
    `Support conversation notification · Manage settings: ${EMAIL_BASE}/dashboard.html#notifications`,
  ].filter((line) => line !== '').join('\n');
  return {
    subject,
    previewText,
    html,
    text: plain,
    headers: { ...(thread.headers || {}) },
  };
}

function eventConfig(event, order, payment, fulfillment, refund) {
  const reference = referenceOf(order);
  const amount = money(refund?.amount, refund?.currency || order.currency);
  const pending = payment?.status === 'pending' || payment?.pending === true;
  const config = {
    confirmed: {
      label: pending ? 'Order received' : 'Order confirmed',
      heading: 'We received your order.',
      summary: pending
        ? 'Your bank payment is processing. We will confirm fulfillment after it clears.'
        : 'Payment is complete. We will email tracking details when your order ships.',
      subject: pending ? `Order ${reference} received — payment processing` : `Order ${reference} confirmed`,
      preview: pending
        ? 'Payment is processing — review items, total, and delivery details.'
        : 'Payment complete — review items, total, and delivery details.',
    },
    shipped: {
      label: 'Shipment sent',
      heading: 'Your order is on the way.',
      summary: fulfillment?.summary || (fulfillment?.estimatedDelivery
        ? `${fulfillment.carrier || 'Carrier'} expects delivery ${formatDate(fulfillment.estimatedDelivery)}.`
        : 'Tracking details are available below.'),
      subject: `Order ${reference} is on the way`,
      preview: fulfillment?.estimatedDelivery
        ? `${fulfillment.carrier || 'Carrier'} expects delivery ${formatDate(fulfillment.estimatedDelivery)}.`
        : `Tracking is available for order ${reference}.`,
    },
    delivered: {
      label: 'Delivered',
      heading: 'Your order was delivered.',
      summary: fulfillment?.summary || 'Reply to this email if anything arrived short or damaged.',
      subject: `Order ${reference} was delivered`,
      preview: `Delivery completed for order ${reference}.`,
    },
    canceled: {
      label: 'Order canceled',
      heading: 'Your order was canceled.',
      summary: refund?.amount > 0
        ? `${amount} is returning to the original payment method.`
        : 'Nothing else will ship. No card refund is included with this notice.',
      subject: `Order ${reference} was canceled`,
      preview: refund?.amount > 0
        ? `${amount} is returning to the original payment method.`
        : 'Nothing else will ship; no card refund is included with this notice.',
    },
    refunded: {
      label: 'Refund issued',
      heading: `${amount} is headed back to you.`,
      summary: `We issued the refund to ${text(refund?.methodLabel || 'the original payment method', 120)}. Your bank may take 5–10 business days to post it.`,
      subject: `${amount} refund issued for order ${reference}`,
      preview: `Refund sent to ${text(refund?.methodLabel || 'the original payment method', 120)}; bank posting may take 5–10 business days.`,
    },
    return_label: {
      label: 'Return label ready',
      heading: 'Your return label is ready.',
      summary: 'Print the label, attach it to the sealed carton, and keep the products in their original packaging where possible.',
      subject: `Return label ready for order ${reference}`,
      preview: `Return instructions and tracking for order ${reference}.`,
    },
    payment: {
      label: 'Payment update',
      heading: payment?.heading || 'Your payment status changed.',
      summary: payment?.summary || 'Review the payment and order details below.',
      subject: payment?.subject || `Payment update for order ${reference}`,
      preview: payment?.previewText || `Payment update for order ${reference}.`,
    },
    delivery_update: {
      label: text(fulfillment?.label || 'Delivery update', 80),
      heading: fulfillment?.heading || 'Your delivery status changed.',
      summary: fulfillment?.summary || 'Review the latest carrier details below.',
      subject: `Order ${reference} ${text(fulfillment?.label || 'delivery updated', 80)}`,
      preview: fulfillment?.summary || `Delivery update for order ${reference}.`,
    },
  };
  return config[event] || config.delivery_update;
}

function orderItems(items, currency, { refund = false } = {}) {
  const list = (Array.isArray(items) ? items : []).slice(0, 20);
  if (!list.length) return { html: '', text: '' };
  const rows = list.map((item) => {
    const qty = Number(item.qty || item.quantity) || 0;
    const amount = refund
      ? Number(item.amount ?? item.line_total ?? 0)
      : (Number(item.unit_price) || 0) * qty;
    const image = safeMediaUrl(item.image_url || item.image);
    const imageSize = emailImageDimensions(
      item.image_width || item.width,
      item.image_height || item.height,
      70,
      88,
    );
    return `<tr>${image ? `<td width="70" style="padding:0 14px 16px 0;vertical-align:top"><img src="${emailEscape(image)}" width="${imageSize.width}" height="${imageSize.height}" alt="${emailEscape(item.image_alt || item.name || 'Product')}" style="display:block;width:70px;height:auto;border-radius:8px"></td>` : ''}<td style="padding:0 10px 16px 0;vertical-align:top"><strong style="font-size:14px">${emailEscape(item.name || item.sku || 'Order item')}</strong><br><span style="color:#5f656d;font-size:12px;line-height:1.5">${item.pack ? `${emailEscape(item.pack)} · ` : ''}${item.sku ? `SKU ${emailEscape(item.sku)} · ` : ''}Quantity ${qty}</span></td><td align="right" style="padding:0 0 16px;vertical-align:top;font-size:14px;font-weight:700">${money(amount, currency)}</td></tr>`;
  }).join('');
  const plain = list.map((item) => {
    const qty = Number(item.qty || item.quantity) || 0;
    const amount = refund
      ? Number(item.amount ?? item.line_total ?? 0)
      : (Number(item.unit_price) || 0) * qty;
    return `${qty} × ${text(item.name || item.sku || 'Order item', 200)}${item.sku ? ` (${text(item.sku, 80)})` : ''}  ${money(amount, currency)}`;
  }).join('\n');
  return {
    html: `<table role="presentation" width="100%" style="border-collapse:collapse">${rows}</table>`,
    text: plain,
  };
}

function totalsBlock(order, adjustments = {}) {
  const currency = order.currency || 'usd';
  const rows = [
    ['Subtotal', order.subtotal],
    ['Account credit', adjustments.storeCredit > 0 ? -Number(adjustments.storeCredit) : null],
    ['Discount', adjustments.discount > 0 ? -Number(adjustments.discount) : null],
    ['Shipping', order.shipping],
    ['Tax', order.tax],
    ['Total', order.total],
  ].filter(([, value]) => value != null);
  if (!rows.length) return { html: '', text: '' };
  return {
    html: `<table role="presentation" width="100%" style="border-top:1px solid #e4e6e9;border-collapse:collapse">${rows.map(([label, value], index) => {
      const total = label === 'Total';
      return `<tr><td style="padding-top:${index ? 8 : 14}px;font-size:${total ? 16 : 13}px;font-weight:${total ? 700 : 400}">${label}</td><td align="right" style="padding-top:${index ? 8 : 14}px;font-size:${total ? 16 : 13}px;font-weight:${total ? 700 : 400}">${Number(value) < 0 ? '&minus;' : ''}${money(Math.abs(Number(value)), currency)}</td></tr>`;
    }).join('')}</table>`,
    text: rows.map(([label, value]) => `${label}: ${Number(value) < 0 ? '−' : ''}${money(Math.abs(Number(value)), currency)}`).join('\n'),
  };
}

function addressLines(order = {}) {
  const shipAddress = order.ship_address?.address || order.ship_address;
  const address = order.shipping_address || order.shipping_address_json || shipAddress || order.address || {};
  if (!address || typeof address !== 'object') return [];
  return [
    address.name,
    address.company,
    address.line1 || address.address1,
    address.line2 || address.address2,
    [address.city, address.state, address.postal_code || address.zip].filter(Boolean).join(', '),
    address.country && address.country !== 'US' ? address.country : '',
  ].map((part) => text(part, 180)).filter(Boolean);
}

export function renderCommerceEmail({
  event = 'delivery_update',
  order = {},
  payment = {},
  fulfillment = {},
  refund = {},
  items = null,
  adjustments = {},
  notes = [],
  appUrl = EMAIL_BASE,
} = {}) {
  const base = emailSafeUrl(appUrl) || EMAIL_BASE;
  const reference = referenceOf(order);
  const config = eventConfig(event, order, payment, fulfillment, refund);
  const currency = refund.currency || order.currency || 'usd';
  const selectedItems = items || (event === 'refunded' ? refund.items : fulfillment.items) || order.order_items || [];
  const itemBlock = orderItems(selectedItems, currency, { refund: event === 'refunded' });
  const totals = event === 'confirmed' ? totalsBlock(order, adjustments) : { html: '', text: '' };
  const address = addressLines(order);
  const accountOrder = order.user_id || order.company_id;
  const orderUrl = emailSafeUrl(order.viewUrl || (accountOrder
    ? `${String(base).replace(/\/+$/, '')}/dashboard.html?order=${encodeURIComponent(order.id || '')}#orders`
    : `${String(base).replace(/\/+$/, '')}/contact.html?message=${encodeURIComponent(`Question about order ${reference}`)}`));
  const trackingUrl = emailSafeUrl(fulfillment.trackingUrl || order.tracking_url);
  const cta = event === 'shipped' && trackingUrl
    ? { text: 'Track shipment', url: trackingUrl }
    : event === 'return_label' && emailSafeUrl(fulfillment.labelUrl)
      ? { text: 'Print return label', url: emailSafeUrl(fulfillment.labelUrl) }
      : event === 'refunded'
        ? { text: 'View refund details', url: orderUrl }
        : event === 'canceled' && !accountOrder
          ? { text: 'Get order help', url: orderUrl }
          : { text: text(order.ctaText || 'View order', 80), url: orderUrl };
  const detailCells = [
    order.created_at ? ['ORDER DATE', formatDate(order.created_at)] : null,
    payment.label || payment.status ? ['PAYMENT', text(payment.label || payment.status, 80)] : null,
    event === 'confirmed' ? ['STATUS', payment.status === 'pending' || payment.pending ? 'Processing' : text(payment.label || 'Confirmed', 80)] : null,
  ].filter(Boolean);
  const detailHtml = detailCells.length ? `<tr><td class="email-pad" style="padding:0 28px 24px;font-family:Arial,sans-serif"><table role="presentation" width="100%" class="email-card" style="width:100%;background:#f7f9fa;border:1px solid #e4e6e9;border-collapse:separate;border-spacing:0;border-radius:12px"><tr>${detailCells.map(([label, value]) => `<td class="email-stack" style="padding:15px;vertical-align:top"><span style="display:block;color:#5f656d;font-size:11px">${emailEscape(label)}</span><strong style="font-size:13px">${emailEscape(value)}</strong></td>`).join('')}</tr></table></td></tr>` : '';
  const shipmentHtml = ['shipped', 'delivered', 'delivery_update', 'return_label'].includes(event)
    ? `<tr><td class="email-pad" style="padding:0 28px 24px;font-family:Arial,sans-serif"><table role="presentation" width="100%" class="email-card" style="width:100%;background:#f7f9fa;border:1px solid #e4e6e9;border-collapse:separate;border-spacing:0;border-radius:12px"><tr><td style="padding:17px"><table role="presentation" width="100%"><tr><td><span style="display:block;color:#5f656d;font-size:11px">CARRIER</span><strong style="font-size:14px">${emailEscape(fulfillment.carrier || order.carrier || 'Carrier update pending')}</strong></td><td align="right"><span style="display:block;color:#5f656d;font-size:11px">TRACKING</span><strong style="font-size:13px">${emailEscape(fulfillment.trackingNumber || order.tracking_number || 'Pending')}</strong></td></tr></table></td></tr></table></td></tr>`
    : '';
  const refundHtml = event === 'refunded' ? `<tr><td class="email-pad" style="padding:0 28px 26px;font-family:Arial,sans-serif"><table role="presentation" width="100%" class="email-card" style="width:100%;background:#f7f9fa;border:1px solid #e4e6e9;border-collapse:separate;border-spacing:0;border-radius:12px"><tr><td style="padding:18px"><span style="display:block;color:#5f656d;font-size:11px">REFUND SUMMARY</span>${itemBlock.html ? `<div style="margin-top:14px">${itemBlock.html}</div>` : ''}<table role="presentation" width="100%" style="margin-top:12px"><tr><td style="font-size:15px;font-weight:700">Total refunded</td><td align="right" style="font-size:15px;font-weight:700">${money(refund.amount, currency)}</td></tr>${refund.remainingTotal != null ? `<tr><td style="padding-top:10px;font-size:13px">Remaining order total</td><td align="right" style="padding-top:10px;font-size:13px">${money(refund.remainingTotal, currency)}</td></tr>` : ''}</table></td></tr></table></td></tr>` : '';
  const orderItemsHtml = itemBlock.html && event !== 'refunded' ? `<tr><td class="email-pad" style="padding:0 28px;font-family:Arial,sans-serif"><h2 style="margin:0 0 12px;font-size:17px">${event === 'confirmed' ? 'Order summary' : 'In this shipment'}</h2></td></tr><tr><td class="email-pad" style="padding:0 28px 18px;font-family:Arial,sans-serif">${itemBlock.html}${totals.html}</td></tr>` : '';
  const addressHtml = address.length || order.purchase_order_number || fulfillment.method
    ? `<tr><td class="email-pad" style="padding:8px 28px 28px;font-family:Arial,sans-serif"><table role="presentation" width="100%" class="email-card" style="width:100%;background:#f7f9fa;border:1px solid #e4e6e9;border-collapse:separate;border-spacing:0;border-radius:12px"><tr>${address.length ? `<td class="email-stack" width="50%" style="padding:16px;vertical-align:top"><strong style="font-size:12px">SHIP TO</strong><p style="margin:7px 0 0;color:#5f656d;font-size:12px;line-height:1.55">${address.map(emailEscape).join('<br>')}</p></td>` : ''}<td class="email-stack" width="50%" style="padding:16px;vertical-align:top"><strong style="font-size:12px">ORDER DETAILS</strong><p style="margin:7px 0 0;color:#5f656d;font-size:12px;line-height:1.55">${order.purchase_order_number ? `Purchase order: ${emailEscape(order.purchase_order_number)}<br>` : ''}${fulfillment.method ? emailEscape(fulfillment.method) : 'Tracking follows by email'}</p></td></tr></table></td></tr>`
    : '';
  const noteHtml = (Array.isArray(notes) ? notes : []).filter(Boolean).slice(0, 4)
    .map((note) => `<p style="margin:0 0 10px;color:#5f656d;font-size:13px;line-height:1.55">${emailEscape(note)}</p>`).join('');
  const rows = emailBrandHeader('ORDER', reference)
    + `<tr><td class="email-pad" style="padding:36px 28px 24px;font-family:Arial,sans-serif"><p style="margin:0 0 8px;color:${event === 'confirmed' || event === 'refunded' ? '#17623b' : '#0a5b62'};font-size:11px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase">${emailEscape(config.label)}</p><h1 style="margin:0;color:#15171c;font-size:30px;line-height:1.15;letter-spacing:-.6px">${emailEscape(config.heading)}</h1><p style="margin:12px 0 20px;color:#5f656d;font-size:15px;line-height:1.6">${emailEscape(config.summary)}</p>${emailButton(cta.text, cta.url)}${trackingUrl && cta.url !== orderUrl && orderUrl ? `<p style="margin:12px 0 0;font-size:12px"><a href="${emailEscape(orderUrl)}" style="color:#0a5b62">View full order</a></p>` : ''}${event === 'confirmed' ? `<p style="margin:12px 0 0;font-size:12px"><a href="${EMAIL_BASE}/resources" style="color:#0a5b62">Product labels and public documents</a></p>` : ''}${noteHtml ? `<div style="margin-top:18px">${noteHtml}</div>` : ''}</td></tr>`
    + detailHtml
    + shipmentHtml
    + orderItemsHtml
    + refundHtml
    + addressHtml
    + transactionalEmailFooter('order');
  const html = emailDocument({ title: config.subject, preheader: config.preview, rows });
  const plain = [
    `MASEST · ORDER ${reference}`,
    '',
    config.label.toUpperCase(),
    config.heading,
    config.summary,
    '',
    detailCells.map(([label, value]) => `${label}: ${value}`).join('\n'),
    itemBlock.text ? `\n${event === 'refunded' ? 'REFUND SUMMARY' : event === 'confirmed' ? 'ORDER SUMMARY' : 'IN THIS SHIPMENT'}\n${itemBlock.text}` : '',
    totals.text,
    event === 'refunded' ? `Total refunded: ${money(refund.amount, currency)}${refund.remainingTotal != null ? `\nRemaining order total: ${money(refund.remainingTotal, currency)}` : ''}` : '',
    fulfillment.carrier || order.carrier ? `Carrier: ${fulfillment.carrier || order.carrier}` : '',
    fulfillment.trackingNumber || order.tracking_number ? `Tracking: ${fulfillment.trackingNumber || order.tracking_number}` : '',
    address.length ? `Ship to: ${address.join(', ')}` : '',
    order.purchase_order_number ? `Purchase order: ${order.purchase_order_number}` : '',
    ...(Array.isArray(notes) ? notes.map((note) => text(note, 500)) : []),
    '',
    `${cta.text}: ${cta.url}`,
    trackingUrl && cta.url !== orderUrl ? `View full order: ${orderUrl}` : '',
    event === 'confirmed' ? `Product labels and public documents: ${EMAIL_BASE}/resources` : '',
    `Questions: ${EMAIL_BASE}/contact`,
    '',
    `Required order notice · Privacy: ${EMAIL_BASE}/privacy.html`,
  ].filter((line) => line !== '').join('\n');
  return {
    subject: text(config.subject, 180),
    previewText: text(config.preview, 255),
    html,
    text: plain,
    headers: {},
  };
}

function renderMarketingModule(module = {}) {
  if (module.type === 'links') {
    const links = (Array.isArray(module.items) ? module.items : []).slice(0, 5)
      .map((item) => {
        const href = emailSafeUrl(item.href);
        if (!href) return '';
        return `<p style="margin:0;padding:12px 0;border-top:1px solid #e4e6e9;font-size:13px"><a href="${emailEscape(href)}" style="color:#0a5b62;font-weight:700">${emailEscape(item.title)}</a>${item.body ? `<br><span style="color:#5f656d;font-size:12px">${emailEscape(item.body)}</span>` : ''}</p>`;
      }).filter(Boolean).join('');
    return links ? `<tr><td class="email-pad" style="padding:0 28px 30px;font-family:Arial,sans-serif">${module.heading ? `<h2 style="margin:0 0 14px;font-size:17px">${emailEscape(module.heading)}</h2>` : ''}${links}</td></tr>` : '';
  }
  if (module.type === 'feature') {
    const image = safeMediaUrl(module.image);
    const href = emailSafeUrl(module.href);
    const imageSize = emailImageDimensions(
      module.imageWidth || module.image_width,
      module.imageHeight || module.image_height,
      220,
      111,
    );
    return `<tr><td class="email-pad" style="padding:0 28px 26px;font-family:Arial,sans-serif"><table role="presentation" width="100%" class="email-card" style="width:100%;background:#f7f9fa;border:1px solid #e4e6e9;border-collapse:separate;border-spacing:0;border-radius:12px"><tr>${image ? `<td class="email-stack" width="42%" style="vertical-align:top"><img src="${emailEscape(image)}" width="${imageSize.width}" height="${imageSize.height}" alt="${emailEscape(module.imageAlt || module.title || '')}" style="display:block;width:100%;height:auto;border-radius:11px 0 0 11px"></td>` : ''}<td class="email-stack" style="padding:18px;vertical-align:middle">${module.eyebrow ? `<p style="margin:0 0 7px;color:#0a5b62;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase">${emailEscape(module.eyebrow)}</p>` : ''}<h2 style="margin:0;font-size:18px;line-height:1.25">${emailEscape(module.title)}</h2>${module.body ? `<p style="margin:9px 0 0;color:#5f656d;font-size:12px;line-height:1.55">${emailEscape(module.body)}</p>` : ''}${href ? `<p style="margin:10px 0 0;font-size:12px"><a href="${emailEscape(href)}" style="color:#0a5b62;font-weight:700">${emailEscape(module.linkText || 'Learn more')}</a></p>` : ''}</td></tr></table></td></tr>`;
  }
  return '';
}

// campaign.bodyHtml is trusted presentation markup. Callers must sanitize or
// escape all variable content before passing it into this renderer.
export function renderMarketingEmail({
  kind = 'newsletter',
  campaign = {},
  modules = [],
  recipientContext = {},
} = {}) {
  const subject = text(campaign.subject || campaign.heading || 'MASEST VertKleen', 180);
  const previewText = text(campaign.previewText || subject, 255);
  const heading = text(campaign.heading || subject, 220);
  const hero = safeMediaUrl(campaign.heroImage);
  const ctaUrl = emailSafeUrl(campaign.ctaUrl);
  const cta = campaign.ctaText && ctaUrl ? emailButton(campaign.ctaText, ctaUrl, { light: campaign.darkHero === true }) : '';
  const moduleHtml = (Array.isArray(modules) ? modules : []).map(renderMarketingModule).join('');
  const reason = text(recipientContext.reason, 500)
    || 'You received this because you subscribed to VertKleen updates or asked MASEST for product information.';
  const disclosure = ['product', 'promotion', 'offer'].includes(kind) ? `Advertisement. ${reason}` : reason;
  const heroSize = emailImageDimensions(
    campaign.heroWidth || campaign.hero_width,
    campaign.heroHeight || campaign.hero_height,
    600,
    338,
  );
  const heroHtml = hero ? `<tr><td><img src="${emailEscape(hero)}" width="${heroSize.width}" height="${heroSize.height}" alt="${emailEscape(campaign.heroAlt || heading)}" style="display:block;width:100%;height:auto"></td></tr>` : '';
  const darkHero = campaign.darkHero === true;
  const rows = `<tr><td style="padding:10px 24px;background:#fff;font-family:Arial,sans-serif"><table role="presentation" width="100%"><tr><td style="color:#5f656d;font-size:10px">${emailEscape(previewText)}</td><!--WEB_VIEW_START--><td align="right" style="font-size:10px"><a href="{{web_view_url}}" style="color:#0a5b62">View in browser</a></td><!--WEB_VIEW_END--></tr></table></td></tr>`
    + `<tr><td style="padding:18px 28px;background:#111518"><table role="presentation" width="100%"><tr><td><a href="${EMAIL_BASE}"><img src="${EMAIL_LOGO}" width="38" height="47" alt="MASEST" style="display:block;width:38px;height:47px;border:0;object-fit:contain"></a></td><td align="right" style="font-family:Arial,sans-serif;font-size:11px"><a href="${EMAIL_BASE}/products" style="color:#dce4e6;text-decoration:none">Products</a>&nbsp;&nbsp;&nbsp;<a href="${EMAIL_BASE}/industries" style="color:#dce4e6;text-decoration:none">Industries</a>&nbsp;&nbsp;&nbsp;<a href="${EMAIL_BASE}/blog" style="color:#dce4e6;text-decoration:none">Blog</a></td></tr></table></td></tr>`
    + heroHtml
    + `<tr><td class="email-pad" style="padding:34px 28px 26px;background:${darkHero ? '#0d1517' : '#fff'};font-family:Arial,sans-serif">${campaign.eyebrow ? `<p style="margin:0 0 9px;color:${darkHero ? '#9dd5d8' : '#0a5b62'};font-size:11px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase">${emailEscape(campaign.eyebrow)}</p>` : ''}<h1 style="margin:0;color:${darkHero ? '#fff' : '#15171c'};font-size:31px;line-height:1.13;letter-spacing:-.7px">${emailEscape(heading)}</h1><div style="margin:13px 0 0;color:${darkHero ? '#c8d2d5' : '#5f656d'};font-size:15px;line-height:1.65">${campaign.bodyHtml || ''}</div>${cta ? `<div style="margin-top:21px">${cta}</div>` : ''}</td></tr>`
    + moduleHtml
    + marketingEmailFooter(disclosure);
  const html = emailDocument({ title: subject, preheader: previewText, rows });
  const moduleText = (Array.isArray(modules) ? modules : []).flatMap((module) => {
    if (module.type === 'feature') {
      return [module.eyebrow, module.title, module.body, module.href ? `${module.linkText || 'Learn more'}: ${emailSafeUrl(module.href)}` : ''];
    }
    if (module.type === 'links') {
      const items = Array.isArray(module.items) ? module.items : [];
      return [module.heading, ...items.flatMap((item) => [`${item.title}: ${emailSafeUrl(item.href)}`, item.body])];
    }
    return [];
  }).map((line) => text(line, 500)).filter(Boolean).join('\n');
  const address = emailBusinessAddress();
  const plain = [
    ['product', 'promotion', 'offer'].includes(kind) ? 'ADVERTISEMENT · MASEST VERTKLEEN' : 'MASEST VERTKLEEN',
    '',
    campaign.eyebrow ? text(campaign.eyebrow, 180).toUpperCase() : '',
    heading.toUpperCase(),
    campaign.bodyText ? String(campaign.bodyText).trim() : plainHtml(campaign.bodyHtml),
    ctaUrl ? `${campaign.ctaText || 'Open'}: ${ctaUrl}` : '',
    moduleText ? `\n${moduleText}` : '',
    '',
    '<!--WEB_VIEW_START-->View in browser: {{web_view_url}}<!--WEB_VIEW_END-->',
    `Website: ${EMAIL_BASE}`,
    `Products: ${EMAIL_BASE}/products`,
    `Blog: ${EMAIL_BASE}/blog`,
    `Manage email settings: ${EMAIL_BASE}/dashboard.html#notifications`,
    'Unsubscribe: {{unsubscribe_url}}',
    '',
    disclosure,
    `${companyIdentity.legal_name} · ${address}`,
  ].filter((line) => line !== '').join('\n');
  return { subject, previewText, html, text: plain, headers: {} };
}
