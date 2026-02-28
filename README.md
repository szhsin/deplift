# deplift

> CLI to update deps in monorepos

[![NPM](https://img.shields.io/npm/v/deplift.svg)](https://www.npmjs.com/package/deplift)

## Install

```bash
npm install -D deplift
```

## Usage

```bash
npx deplift

Positionals:
  pkgPath  Path to package.json                                   [string]

Options:
      --major    Set major version caps: dep=version pairs
                                                     [array] [default: []]
  -d, --dry-run  Run without making changes     [boolean] [default: false]
      --install  Run npm install                 [boolean] [default: true]
  -v, --version  Show version number                             [boolean]
  -h, --help     Show help
```
