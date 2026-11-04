# Third-party notices

## pyembroidery

The DST, EXP and PES (PEC) encoders in `src/lib/embroidery/formats.ts` and the data tables in
`src/lib/embroidery/pecTables.ts` are ported from pyembroidery
(https://github.com/EmbroidePy/pyembroidery). The tests compare our output byte-for-byte with it.

```
MIT License

Copyright (c) 2018 

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
```

## Fonts

Inter and JetBrains Mono are bundled through @fontsource under the SIL Open Font License 1.1.

## Bundled npm libraries (MIT)

The app bundles these MIT-licensed libraries; their license text ships in each package under `node_modules/<name>/LICENSE`.

| Library | Used for | Copyright |
| --- | --- | --- |
| three | 3D viewer | Copyright © 2010-2024 three.js authors |
| mp4-muxer | Turntable MP4 files | Copyright (c) 2023 Vanilagy |
| webm-muxer | Turntable WebM fallback | Copyright (c) 2022 Vanilagy |
| jsPDF | PDF export | Copyright (c) 2010-2025 James Hall, yWorks GmbH and contributors |
