# Third-party notices

The TypeSafe operation/target fanout and response validation in `src/navigators.ts`
are adapted from [Jev Ultrafast](https://github.com/browser-use/jev-ultrafast),
`jev_ultrafast/model.py`, revision `8251e272398011cdef648965204d1c20cd838333`.
The TypeScript executor, control journal and remaining plugin code are separate.
No upstream Python runtime or browser harness is bundled.

## Jev Ultrafast license

MIT License

Copyright (c) 2026 Browser Use

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Playwriter compatibility build

The optional SDK and patched extension use Playwriter revision `bf2b96717e2b36ee9781d260d4ed8a7228f47c48`, copyright (c) 2026 Tommy D. Rossi, under the MIT license. The build copies the complete upstream LICENSE into `dist/extension/LICENSE`. The compatibility patch and local control additions are in this repository. Transitive dependencies retain their own licenses in their packages.
