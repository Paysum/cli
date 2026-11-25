# Paysum CLI

Develop Paysum storefront themes locally. Pull a theme, preview your changes, and publish when ready.

## Install

Requires Node.js 20 or later.

```sh
npm install --global @paysum_io/cli
paysum --help
```

## Quick Start

Create a store API key in **Dashboard > Developers > API keys**. Give it the theme scopes required by the commands you use.

```sh
paysum login
paysum init my-theme
cd my-theme
paysum watch --open
```

`paysum watch` uploads drafts. Use `paysum publish` when you want to make the changes live.

To convert a SellAuth theme ZIP without changing your storefront, use a key with `themes:read`:

```sh
paysum theme-port source.zip --out liquid.zip
```

Read the conversion report before using the ZIP. Some SellAuth features do not have Paysum equivalents.

## Development

```sh
npm test
node bin/paysum.js --help
```
