const REQUIRED = [
  'config/theme.json',
  'layout/theme.liquid',
  'templates/index.liquid',
  'templates/product.liquid',
  'templates/page.liquid',
]

export function themeProblems(files) {
  const problems = REQUIRED.filter((file) => !files[file]?.content.trim()).map(
    (file) => `Missing ${file}`,
  )
  if (!files['config/theme.json']?.content.trim()) return problems
  let manifest
  try {
    manifest = JSON.parse(files['config/theme.json'].content)
  } catch {
    return [...problems, 'config/theme.json must be valid JSON']
  }
  if (typeof manifest?.slug !== 'string' || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(manifest.slug))
    problems.push('config/theme.json needs a valid theme slug')
  for (const [key, prefix, suffix] of [
    ['sections', 'sections/', '.liquid'],
    ['stylesheets', 'assets/', ''],
    ['scripts', 'assets/', ''],
  ]) {
    const entries = manifest?.[key] ?? []
    if (!Array.isArray(entries)) {
      problems.push(`config/theme.json ${key} must be a list`)
      continue
    }
    for (const entry of entries) {
      if (typeof entry !== 'string' || entry.includes('..') || !Object.hasOwn(files, `${prefix}${entry}${suffix}`))
        problems.push(`Missing or invalid ${key} file: ${String(entry)}`)
    }
  }
  return problems
}

export function starterFiles(name, slug) {
  const manifest = { slug, name, sections: ['products'], stylesheets: ['starter.css'] }
  return {
    'config/theme.json': `${JSON.stringify(manifest, null, 2)}\n`,
    'layout/theme.liquid': `<header><a href="/">{{ shop.name | escape }}</a> / <a href="/products">Products</a></header>
<main>{{ content_for_layout }}</main>
{{ platform.attribution }}
`,
    'templates/index.liquid': `<h1>{{ shop.name | escape }}</h1>
{% for id in page.sections %}{% section id %}{% endfor %}
`,
    'sections/products.liquid': `<h2>Products</h2>
<ul>
{% for product in products %}
  <li><a href="{{ product.href | escape }}">{{ product.title | escape }}</a></li>
{% else %}
  <li>No products yet.</li>
{% endfor %}
</ul>
`,
    'templates/product.liquid': `{% if page.missing %}
<h1>Product not found</h1>
{% else %}
{% assign product = page.product %}
{% assign blocked = page.sold_out %}
{% if product.variants.size > 0 and page.selected_variant == blank %}{% assign blocked = true %}{% endif %}
<article data-os-product-page="{{ product.id | escape }}" data-os-require-variant="">
  <h1>{{ product.title | escape }}</h1>
  <p>{{ product.excerpt | escape }}</p>
  <p data-os-total="">{{ page.price_formatted | escape }}</p>
  {% if product.variants.size > 0 %}
  <div role="group" aria-label="Options">
    {% for variant in product.variants %}
    <button type="button" data-os-variant="{{ variant.id | escape }}" aria-pressed="{% if variant.id == page.selected_variant %}true{% else %}false{% endif %}"{% if variant.own_stock != nil and variant.own_stock <= 0 %} disabled{% endif %}>{{ variant.name | escape }}</button>
    {% endfor %}
  </div>
  {% endif %}
  <button type="button" data-os-buy-now=""{% if blocked %} disabled{% endif %}>Buy now</button>
  <button type="button" data-os-add-to-cart=""{% if blocked %} disabled{% endif %}>Add to cart</button>
</article>
{% endif %}
`,
    'templates/page.liquid': `{% if page.section == 'products' %}
{% section 'products' %}
{% else %}
<h1>{{ page.title | escape }}</h1>
{% if page.policy %}<p style="white-space: pre-wrap">{{ page.text | default: page.fallback | escape }}</p>
{% else %}{{ page.html }}{% endif %}
{% endif %}
`,
    'assets/starter.css': `header, main { max-width: 60rem; margin: auto; padding: 1rem; }
main a { text-decoration: underline; }
article button { margin: .25rem; padding: .5rem 1rem; }
article button[aria-pressed="true"] { outline: 2px solid currentColor; }
`,
  }
}
