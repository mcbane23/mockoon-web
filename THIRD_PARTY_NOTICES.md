# Third-party notices

Stubhouse uses the open-source engine of [Mockoon](https://mockoon.com) to load, migrate and run
environments. Stubhouse is not affiliated with or endorsed by the Mockoon team. "Mockoon" is a
registered trademark of its owner (EU trademark 018918009) and is used here only to describe
compatibility. Stubhouse does not use the Mockoon logo.

## @mockoon/commons and @mockoon/commons-server

Version 9.10.0, <https://github.com/mockoon/mockoon>

```
The MIT License (MIT)

Copyright (c) 2020-present Guillaume Monnet

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## Other dependencies

The server and the web interface also depend, directly or through the packages above, on other
open-source packages. All of them are under permissive licences (MIT, ISC, BSD-2-Clause,
BSD-3-Clause, 0BSD, BlueOak-1.0.0, Apache-2.0), with one exception under a weak copyleft licence:

| Package                                                           | Licence       | Note                                                                                   |
| ----------------------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------- |
| @jmespath-community/jmespath                                      | MPL-2.0       | Used unmodified; source at <https://github.com/jmespath-community/typescript-jmespath> |
| rxjs                                                              | Apache-2.0    | Used unmodified                                                                        |
| glob, minimatch, minipass, lru-cache, path-scurry, sax            | BlueOak-1.0.0 |                                                                                        |
| fastify, @fastify/cookie, @fastify/static                         | MIT           |                                                                                        |
| react, react-dom, react-router-dom, zustand                       | MIT           |                                                                                        |
| @dnd-kit/core, @dnd-kit/sortable, @dnd-kit/utilities              | MIT           |                                                                                        |
| @uiw/react-codemirror, @codemirror/lang-json, lang-xml, lang-html | MIT           |                                                                                        |

The full licence text of every package is in its own folder under `node_modules` (in the Docker
image: `/app/apps/server/node_modules`). The complete list can be printed with
`pnpm licenses list --prod`.
