# Paysum CLI

Develop Paysum storefront themes locally. Pull a theme, preview your changes, and publish when ready.

## Install

Requires Node.js 20 or later.

```sh
npm install --global --ignore-scripts https://github.com/Paysum/cli/archive/refs/tags/v1.1.0.tar.gz
paysum --help
```

`paysum update` installs the latest stable GitHub release over your global npm install. Use `paysum update --check` to check without installing. The CLI checks for updates at most once a day in interactive terminals. Set `PAYSUM_NO_UPDATE_CHECK=1` to disable these notices. It does not install updates without the `update` command.

## Quick Start

`paysum login` opens the Paysum dashboard when the API supports browser sign-in. Sign in, select a store, and approve the theme permissions you need. Until the API supports it, the CLI prompts for a store API key instead.

```sh
paysum login
paysum init my-theme
cd my-theme
paysum watch --open
```

`paysum watch` uploads drafts. Use `paysum publish` when you want to make the changes live.

Use `paysum login --api-key` to enter an existing key instead, or use `PAYSUM_API_KEY` for scripts. Browser credentials expire after 30 days. `paysum logout` removes the local credential. To revoke browser access before it expires, remove its `Paysum CLI` key in the dashboard's **API keys** page.

## Commands

| Task | Command |
| --- | --- |
| List saved stores or set the default | `paysum stores`, `paysum use <store-id>` |
| Start a new Liquid theme locally | `paysum create my-theme --name "My Theme"` |
| Download your existing theme | `paysum init my-theme` |
| List local files or saved drafts | `paysum files`, `paysum files --remote` |
| Check local file sizes, required files, and the manifest | `paysum check` |
| Check sync changes and conflicts without uploading | `paysum push --dry-run` |
| Sync drafts | `paysum pull`, `paysum push` |
| Preview and publish | `paysum preview --open`, `paysum watch --open`, `paysum publish` |
| List published versions | `paysum versions` |

Use `--store <id>` to select a saved store for a command. A theme folder stays linked to its own store. `paysum apply` is an alias for `paysum publish`.

`paysum create` does not create a new theme slot on the server or change drafts. To develop against drafts, run `paysum push --dry-run` first. Existing draft paths can conflict with the starter. `paysum check` does not render Liquid; use the draft preview to check rendering.

## SellAuth Import

`theme-port` is not yet available on the production Paysum API. It requires a server that supports theme conversion.

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
