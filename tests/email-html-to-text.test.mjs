import assert from 'node:assert/strict';
import test from 'node:test';
import { htmlToText } from '../functions/_lib/email.js';

test('empty / blank / nullish input yields an empty string', () => {
  assert.equal(htmlToText(''), '');
  assert.equal(htmlToText('   '), '');
  assert.equal(htmlToText(null), '');
  assert.equal(htmlToText(undefined), '');
});

test('strips tags and decodes entities', () => {
  assert.equal(htmlToText('<p>Hello&nbsp;<b>world</b> &amp; co &middot; done</p>'), 'Hello world & co · done');
});

test('block elements and <br> become line breaks', () => {
  const out = htmlToText('<h2>Order confirmed</h2><p>Line one<br>Line two</p>');
  assert.equal(out, 'Order confirmed\nLine one\nLine two');
});

test('links render as "label (url)"', () => {
  assert.equal(htmlToText('<a href="https://masest.co/x">View order</a>'), 'View order (https://masest.co/x)');
});

test('a link whose label already is the url is not duplicated', () => {
  assert.equal(htmlToText('<a href="https://masest.co">https://masest.co</a>'), 'https://masest.co');
});

test('mailto links keep only the label', () => {
  assert.equal(htmlToText('Reach <a href="mailto:hi@masest.co">us</a>'), 'Reach us');
});

test('style and script blocks are removed entirely', () => {
  assert.equal(htmlToText('<style>.a{color:red}</style><p>Body</p><script>x()</script>'), 'Body');
});

test('list items get a bullet', () => {
  const out = htmlToText('<ul><li>First</li><li>Second</li></ul>');
  assert.equal(out, '• First\n• Second');
});

test('collapses excess whitespace and blank lines', () => {
  const out = htmlToText('<p>One</p>\n\n\n<p>   Two   </p>');
  assert.equal(out, 'One\n\nTwo');
});

test('table cells are separated and rows broken (real order-row shape)', () => {
  const html = '<tr><td>VertKleen HCR (VK-HCR-1)</td><td>2</td><td>USD 34.60</td></tr>';
  const out = htmlToText(html);
  assert.match(out, /VertKleen HCR \(VK-HCR-1\)/);
  assert.match(out, /USD 34\.60/);
  assert.ok(!out.includes('<'), 'no residual tags');
});
